#!/usr/bin/env python3
"""
pdfmux4obsidian — drop PDFs into your Obsidian vault as clean Markdown notes.

Built on top of pdfmux by NameetP (https://github.com/NameetP/pdfmux),
which handles all the heavy lifting: routing each page to the right extractor,
OCR fallback, table parsing — the whole deal.

Usage:
    python pdfmux4obsidian.py convert paper.pdf --vault ~/vault/Inbox
    python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/Inbox
    python pdfmux4obsidian.py convert invoice.pdf --schema invoice
"""

import argparse
import os
import sys
import time
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional


# ── helpers ──────────────────────────────────────────────────────────────────

def check_pdfmux():
    try:
        import pdfmux  # noqa: F401
    except ImportError:
        print("pdfmux not found. Install it: pip install pdfmux")
        print("See: https://github.com/NameetP/pdfmux")
        sys.exit(1)


def sanitize_filename(name: str) -> str:
    """Turn a PDF filename into something Obsidian won't choke on."""
    name = Path(name).stem
    for ch in r'\/:*?"<>|':
        name = name.replace(ch, "-")
    return name.strip()


def make_frontmatter(pdf_path: Path, schema: Optional[str], extra: dict) -> str:
    """Build YAML frontmatter block."""
    title = sanitize_filename(pdf_path.name)
    date = datetime.now().strftime("%Y-%m-%d")
    tags = ["pdf", "pdfmux"]
    if schema:
        tags.append(schema)

    lines = [
        "---",
        f'title: "{title}"',
        f"date: {date}",
        f"source: \"{pdf_path.resolve()}\"",
        f"tags: [{', '.join(tags)}]",
    ]
    if extra.get("pages"):
        lines.append(f"pages: {extra['pages']}")
    if schema:
        lines.append(f"schema: {schema}")
    lines.append("---")
    return "\n".join(lines)


# ── core conversion ───────────────────────────────────────────────────────────

def convert(
    pdf_path: Path,
    vault_dir: Path,
    schema: Optional[str] = None,
    cost_mode: str = "economy",
    max_tokens: Optional[int] = None,
    llm_provider: Optional[str] = None,
    overwrite: bool = False,
) -> Path:
    """Convert a single PDF → Obsidian Markdown note."""
    check_pdfmux()
    import pdfmux

    pdf_path = pdf_path.resolve()
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    vault_dir = vault_dir.expanduser().resolve()
    vault_dir.mkdir(parents=True, exist_ok=True)

    out_name = sanitize_filename(pdf_path.name) + ".md"
    out_path = vault_dir / out_name

    if out_path.exists() and not overwrite:
        print(f"  skip  {out_name} (already exists, use --overwrite)")
        return out_path

    print(f"  extract  {pdf_path.name} …")

    kwargs = {"cost_mode": cost_mode}
    if llm_provider:
        kwargs["llm_provider"] = llm_provider

    # structured extraction when a schema is given, plain text otherwise
    if schema:
        result = pdfmux.extract_json(str(pdf_path), schema=schema, **kwargs)
        if isinstance(result, dict):
            body = _json_to_md(result)
        else:
            body = str(result)
        page_count = None
    elif max_tokens:
        chunks = pdfmux.chunk(str(pdf_path), max_tokens=max_tokens, **kwargs)
        body = "\n\n---\n\n".join(chunks)
        page_count = None
    else:
        body = pdfmux.extract_text(str(pdf_path), **kwargs)
        page_count = None

    # rough page count from metadata if available
    extra = {}
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(str(pdf_path))
        extra["pages"] = len(doc)
        doc.close()
    except Exception:
        pass

    fm = make_frontmatter(pdf_path, schema, extra)
    note = f"{fm}\n\n{body.strip()}\n"

    out_path.write_text(note, encoding="utf-8")
    print(f"  done  → {out_path}")
    return out_path


def _json_to_md(data: dict, depth: int = 2) -> str:
    """Flatten a schema result dict into readable Markdown."""
    lines = []
    prefix = "#" * depth
    for key, val in data.items():
        label = key.replace("_", " ").title()
        if isinstance(val, dict):
            lines.append(f"{prefix} {label}")
            lines.append(_json_to_md(val, depth + 1))
        elif isinstance(val, list):
            lines.append(f"{prefix} {label}")
            for item in val:
                if isinstance(item, dict):
                    lines.append(_json_to_md(item, depth + 1))
                else:
                    lines.append(f"- {item}")
        else:
            lines.append(f"**{label}:** {val}")
    return "\n".join(lines)


# ── watch mode ────────────────────────────────────────────────────────────────

def watch(
    watch_dir: Path,
    vault_dir: Path,
    interval: int = 5,
    **convert_kwargs,
):
    """Poll watch_dir for new PDFs and convert them automatically."""
    watch_dir = watch_dir.expanduser().resolve()
    seen: set[str] = set()

    print(f"watching  {watch_dir}")
    print(f"vault     {vault_dir}")
    print("ctrl+c to stop\n")

    while True:
        for pdf in watch_dir.glob("*.pdf"):
            # use content hash so renames / re-downloads still trigger
            file_id = _file_id(pdf)
            if file_id not in seen:
                seen.add(file_id)
                try:
                    convert(pdf, vault_dir, **convert_kwargs)
                except Exception as exc:
                    print(f"  error  {pdf.name}: {exc}")
        time.sleep(interval)


def _file_id(path: Path) -> str:
    h = hashlib.md5()
    h.update(str(path.stat().st_size).encode())
    h.update(path.name.encode())
    return h.hexdigest()


# ── CLI ───────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pdfmux4obsidian",
        description="Convert PDFs → Obsidian notes via pdfmux",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python pdfmux4obsidian.py convert paper.pdf --vault ~/vault/Inbox
  python pdfmux4obsidian.py convert invoice.pdf --schema invoice --vault ~/vault/Docs
  python pdfmux4obsidian.py convert report.pdf --chunk 500 --vault ~/vault/Research
  python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/Inbox --interval 10

powered by pdfmux (https://github.com/NameetP/pdfmux)
        """,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # convert
    c = sub.add_parser("convert", help="convert a single PDF")
    c.add_argument("pdf", type=Path, help="path to PDF file")
    c.add_argument("--vault", type=Path, required=True, help="destination Obsidian folder")
    c.add_argument("--schema", choices=["invoice", "receipt", "contract", "resume", "paper"],
                   help="structured extraction schema")
    c.add_argument("--cost-mode", choices=["economy", "balanced", "premium"], default="economy")
    c.add_argument("--llm", dest="llm_provider", help="LLM provider (gemini/claude/gpt4o/ollama)")
    c.add_argument("--chunk", dest="max_tokens", type=int, metavar="TOKENS",
                   help="chunk output at N tokens (good for RAG notes)")
    c.add_argument("--overwrite", action="store_true")

    # watch
    w = sub.add_parser("watch", help="watch a folder and auto-convert new PDFs")
    w.add_argument("dir", type=Path, help="directory to watch")
    w.add_argument("--vault", type=Path, required=True, help="destination Obsidian folder")
    w.add_argument("--schema", choices=["invoice", "receipt", "contract", "resume", "paper"])
    w.add_argument("--cost-mode", choices=["economy", "balanced", "premium"], default="economy")
    w.add_argument("--llm", dest="llm_provider")
    w.add_argument("--chunk", dest="max_tokens", type=int, metavar="TOKENS")
    w.add_argument("--interval", type=int, default=5, help="poll interval in seconds (default 5)")
    w.add_argument("--overwrite", action="store_true")

    return p


def main():
    parser = build_parser()
    args = parser.parse_args()

    shared = dict(
        vault_dir=args.vault,
        schema=args.schema,
        cost_mode=args.cost_mode,
        llm_provider=args.llm_provider,
        max_tokens=args.max_tokens,
        overwrite=args.overwrite,
    )

    if args.cmd == "convert":
        convert(args.pdf, **shared)
    elif args.cmd == "watch":
        watch(args.dir, interval=args.interval, **shared)


if __name__ == "__main__":
    main()
