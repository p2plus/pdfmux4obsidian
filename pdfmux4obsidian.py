#!/usr/bin/env python3
"""
pdfmux4obsidian — drop PDFs into your Obsidian vault as clean Markdown notes.

Built on top of pdfmux by NameetP (https://github.com/NameetP/pdfmux),
which handles all the heavy lifting: routing each page to the right extractor,
OCR fallback, table parsing — the whole deal.

Usage:
    python pdfmux4obsidian.py convert paper.pdf --vault ~/vault/Inbox
    python pdfmux4obsidian.py convert invoice.pdf --schema invoice --vault ~/vault/Docs
    python pdfmux4obsidian.py convert report.pdf --chunk 500 --vault ~/vault/Research
    python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/Inbox
"""

import argparse
import hashlib
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional


# ── helpers ──────────────────────────────────────────────────────────────────

def check_pdfmux():
    try:
        import pdfmux  # noqa: F401
    except ImportError:
        print("pdfmux not found.")
        print("  pip install pdfmux")
        print("  pip install 'pdfmux[all]'  # all backends")
        print("  https://github.com/NameetP/pdfmux")
        sys.exit(1)


def sanitize_filename(name: str) -> str:
    """Turn a PDF filename into something Obsidian won't choke on."""
    stem = Path(name).stem
    for ch in r'\/:*?"<>|':
        stem = stem.replace(ch, "-")
    return stem.strip()


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
        f'source: "{pdf_path.resolve()}"',
        f"tags: [{', '.join(tags)}]",
    ]
    if extra.get("pages"):
        lines.append(f"pages: {extra['pages']}")
    if extra.get("confidence") is not None:
        lines.append(f"confidence: {extra['confidence']:.2f}")
    if schema:
        lines.append(f"schema: {schema}")
    lines.append("---")
    return "\n".join(lines)


# ── core conversion ───────────────────────────────────────────────────────────

def convert(
    pdf_path: Path,
    vault_dir: Path,
    schema: Optional[str] = None,
    quality: str = "standard",
    max_tokens: Optional[int] = None,
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

    extra: dict = {}

    if schema:
        # structured extraction — returns dict with page_count, confidence, pages, …
        result = pdfmux.extract_json(str(pdf_path), schema=schema)
        body = _json_to_md(result)
        if isinstance(result, dict):
            if result.get("page_count"):
                extra["pages"] = result["page_count"]
            if result.get("confidence") is not None:
                extra["confidence"] = result["confidence"]

    elif max_tokens:
        # chunked output — each chunk is a dict: {title, text, tokens, page_start, page_end}
        chunks = pdfmux.chunk(str(pdf_path), max_tokens=max_tokens)
        parts = []
        for i, ch in enumerate(chunks, 1):
            title = ch.get("title") or f"Chunk {i}"
            text = ch.get("text", "").strip()
            pg_start = ch.get("page_start")
            pg_end = ch.get("page_end")
            pg_info = f"_p.{pg_start}–{pg_end}_" if pg_start is not None else ""
            header = f"## {title}"
            chunk_body = f"{header}  {pg_info}\n\n{text}" if pg_info else f"{header}\n\n{text}"
            parts.append(chunk_body.strip())
        body = "\n\n---\n\n".join(parts)

    else:
        # plain text extraction — returns markdown-formatted str
        body = pdfmux.extract_text(str(pdf_path), quality=quality)

    fm = make_frontmatter(pdf_path, schema, extra)
    note = f"{fm}\n\n{body.strip()}\n"

    out_path.write_text(note, encoding="utf-8")
    print(f"  done  → {out_path}")
    return out_path


def _json_to_md(data: dict, depth: int = 2) -> str:
    """Render a pdfmux extract_json result as readable Markdown."""
    lines: list[str] = []
    prefix = "#" * min(depth, 6)

    # hoist top-level metadata fields into a short summary block
    meta_keys = {"page_count", "confidence", "ocr_pages"}
    meta = {k: v for k, v in data.items() if k in meta_keys and v is not None}
    if meta and depth == 2:
        for k, v in meta.items():
            label = k.replace("_", " ").title()
            lines.append(f"**{label}:** {v}")
        lines.append("")

    for key, val in data.items():
        if key in meta_keys:
            continue
        label = key.replace("_", " ").title()

        if isinstance(val, dict):
            lines.append(f"{prefix} {label}")
            lines.append(_json_to_md(val, depth + 1))
        elif isinstance(val, list):
            lines.append(f"{prefix} {label}")
            for item in val:
                if isinstance(item, dict):
                    # render dicts inside lists as sub-sections or bullet pairs
                    if len(item) <= 3 and all(not isinstance(v, (dict, list)) for v in item.values()):
                        pairs = ", ".join(f"**{k}:** {v}" for k, v in item.items())
                        lines.append(f"- {pairs}")
                    else:
                        lines.append(_json_to_md(item, depth + 1))
                else:
                    lines.append(f"- {item}")
        elif val is not None:
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

    # seed with already-existing files so we don't re-convert on startup
    for pdf in watch_dir.glob("*.pdf"):
        seen.add(_file_id(pdf))

    print(f"watching  {watch_dir}")
    print(f"vault     {vault_dir}")
    print(f"interval  {interval}s  |  ctrl+c to stop\n")

    while True:
        time.sleep(interval)
        for pdf in watch_dir.glob("*.pdf"):
            file_id = _file_id(pdf)
            if file_id not in seen:
                seen.add(file_id)
                try:
                    convert(pdf, vault_dir, **convert_kwargs)
                except Exception as exc:
                    print(f"  error  {pdf.name}: {exc}")


def _file_id(path: Path) -> str:
    """Stable ID: size + name (avoids re-hashing file content on every poll)."""
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
  python pdfmux4obsidian.py convert scan.pdf --quality high --vault ~/vault/Inbox

powered by pdfmux (https://github.com/NameetP/pdfmux) — credit: NameetP
        """,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # ── convert ──
    c = sub.add_parser("convert", help="convert a single PDF to an Obsidian note")
    c.add_argument("pdf", type=Path, help="path to PDF file")
    c.add_argument("--vault", type=Path, required=True, help="destination Obsidian folder")
    c.add_argument(
        "--schema",
        choices=["invoice", "receipt", "contract", "resume", "paper"],
        help="structured extraction schema (uses extract_json)",
    )
    c.add_argument(
        "--quality",
        choices=["fast", "standard", "high"],
        default="standard",
        help="extraction quality (default: standard)",
    )
    c.add_argument(
        "--chunk",
        dest="max_tokens",
        type=int,
        metavar="TOKENS",
        help="output RAG-ready chunks, max N tokens each",
    )
    c.add_argument("--overwrite", action="store_true", help="overwrite existing note")

    # ── watch ──
    w = sub.add_parser("watch", help="watch a folder and auto-convert new PDFs")
    w.add_argument("dir", type=Path, help="directory to watch")
    w.add_argument("--vault", type=Path, required=True, help="destination Obsidian folder")
    w.add_argument("--schema", choices=["invoice", "receipt", "contract", "resume", "paper"])
    w.add_argument("--quality", choices=["fast", "standard", "high"], default="standard")
    w.add_argument("--chunk", dest="max_tokens", type=int, metavar="TOKENS")
    w.add_argument(
        "--interval",
        type=int,
        default=5,
        help="poll interval in seconds (default: 5)",
    )
    w.add_argument("--overwrite", action="store_true")

    return p


def main():
    parser = build_parser()
    args = parser.parse_args()

    convert_kwargs = dict(
        vault_dir=args.vault,
        schema=args.schema,
        quality=args.quality,
        max_tokens=args.max_tokens,
        overwrite=args.overwrite,
    )

    if args.cmd == "convert":
        convert(args.pdf, **convert_kwargs)
    elif args.cmd == "watch":
        watch(args.dir, interval=args.interval, **convert_kwargs)


if __name__ == "__main__":
    main()
