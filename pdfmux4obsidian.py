#!/usr/bin/env python3
"""
pdfmux4obsidian — Python backend for the Obsidian plugin.

Gets called by the plugin via execFile — you don't need to run this manually.
But you can, if you want the CLI:

    python pdfmux4obsidian.py setup
    python pdfmux4obsidian.py convert paper.pdf --vault ~/vault/PDFs
    python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/PDFs

Built on pdfmux by NameetP — https://github.com/NameetP/pdfmux
"""

import argparse
import hashlib
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── config paths ─────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
CONFIG_PATHS = [
    Path.home() / ".config" / "pdfmux4obsidian" / "config.yaml",
    SCRIPT_DIR / "config.yaml",
]
ENV_PATHS = [
    Path.home() / ".config" / "pdfmux4obsidian" / ".env",
    SCRIPT_DIR / ".env",
]


# ── env / config loading ──────────────────────────────────────────────────────

def load_env_file():
    """Load .env files (local overrides global). Never overwrites existing env vars."""
    for env_path in ENV_PATHS:
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                val = val.strip().strip("\"'")
                os.environ.setdefault(key.strip(), val)


def load_config() -> dict:
    """
    Load config.yaml — local overrides global.
    Falls back to empty dict if PyYAML isn't installed.
    """
    cfg: dict = {}
    try:
        import yaml  # type: ignore
        for cfg_path in CONFIG_PATHS:
            if cfg_path.exists():
                data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
                cfg.update(data)
    except ImportError:
        pass  # no yaml — CLI args or defaults take over
    return cfg


# ── provider env mapping ──────────────────────────────────────────────────────

# Maps our provider ID → how to set env vars so pdfmux picks up the right backend.
# All OpenAI-compatible providers use OPENAI_API_KEY + OPENAI_BASE_URL.
PROVIDER_CONFIGS: dict[str, dict] = {
    "gemini":      {"key_var": "GEMINI_API_KEY",    "pdfmux_id": "gemini"},
    "claude":      {"key_var": "ANTHROPIC_API_KEY", "pdfmux_id": "claude"},
    "openai":      {"key_var": "OPENAI_API_KEY",    "pdfmux_id": "openai"},
    "zai":         {"key_var": "OPENAI_API_KEY",    "pdfmux_id": "openai",
                    "default_url": "https://api.z.ai/api/coding/paas/v4",
                    "default_model": "glm-5.1"},
    "lmstudio":    {"key_var": "OPENAI_API_KEY",    "pdfmux_id": "openai",
                    "default_url": "http://localhost:1234/v1",
                    "default_key": "lm-studio"},
    "ollama":      {"key_var": None,                "pdfmux_id": "ollama",
                    "default_url": "http://localhost:11434"},
    "anythingllm": {"key_var": "OPENAI_API_KEY",    "pdfmux_id": "openai",
                    "default_url": "http://localhost:3001/api/v1"},
}


def apply_provider_env(
    provider:  str,
    api_key:   str = "",
    base_url:  str = "",
    model:     str = "",
):
    """Set env vars so pdfmux reads the right LLM backend."""
    cfg = PROVIDER_CONFIGS.get(provider)
    if not cfg:
        return

    # API key
    key_var = cfg.get("key_var")
    if key_var:
        val = api_key or cfg.get("default_key", "")
        if val:
            os.environ.setdefault(key_var, val)

    # base URL (for OpenAI-compatible providers)
    effective_url = base_url or cfg.get("default_url", "")
    if effective_url:
        if provider == "ollama":
            # Ollama: pdfmux expects the OpenAI-compat path
            os.environ.setdefault("OPENAI_BASE_URL", effective_url.rstrip("/") + "/v1")
        else:
            os.environ.setdefault("OPENAI_BASE_URL", effective_url)

    # model
    effective_model = model or cfg.get("default_model", "")
    if effective_model:
        os.environ.setdefault("OPENAI_MODEL", effective_model)


# ── helpers ───────────────────────────────────────────────────────────────────

def check_pdfmux():
    try:
        import pdfmux  # noqa: F401
    except ImportError:
        sys.exit(
            "pdfmux not found.\n"
            "  pip install pdfmux\n"
            "  pip install 'pdfmux[all]'   ← all backends (OCR, tables, LLM)\n"
            "  https://github.com/NameetP/pdfmux"
        )


def sanitize_filename(name: str) -> str:
    """Make a PDF filename safe for Obsidian."""
    stem = Path(name).stem
    for ch in r'\/:*?"<>|':
        stem = stem.replace(ch, "-")
    return stem.strip()


def make_frontmatter(pdf_path: Path, schema: Optional[str], extra: dict) -> str:
    title = sanitize_filename(pdf_path.name)
    date  = datetime.now().strftime("%Y-%m-%d")
    tags  = ["pdf", "pdfmux"]
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
    schema:     Optional[str] = None,
    quality:    str           = "standard",
    max_tokens: Optional[int] = None,
    overwrite:  bool          = False,
) -> Path:
    """Convert a single PDF → Obsidian Markdown note."""
    check_pdfmux()
    import pdfmux

    pdf_path  = pdf_path.resolve()
    if not pdf_path.exists():
        sys.exit(f"PDF not found: {pdf_path}")

    vault_dir = vault_dir.expanduser().resolve()
    vault_dir.mkdir(parents=True, exist_ok=True)

    out_name = sanitize_filename(pdf_path.name) + ".md"
    out_path = vault_dir / out_name

    if out_path.exists() and not overwrite:
        print(f"skip  {out_name}  (already exists — pass --overwrite to replace)")
        return out_path

    print(f"extract  {pdf_path.name} …")
    extra: dict = {}

    if schema:
        result = pdfmux.extract_json(str(pdf_path), schema=schema)
        body   = _json_to_md(result)
        if isinstance(result, dict):
            if result.get("page_count"):  extra["pages"]      = result["page_count"]
            if result.get("confidence") is not None: extra["confidence"] = result["confidence"]

    elif max_tokens:
        chunks = pdfmux.chunk(str(pdf_path), max_tokens=max_tokens)
        parts  = []
        for i, ch in enumerate(chunks, 1):
            title    = ch.get("title") or f"Chunk {i}"
            text     = ch.get("text", "").strip()
            pg_start = ch.get("page_start")
            pg_end   = ch.get("page_end")
            pg_info  = f"_p.{pg_start}–{pg_end}_" if pg_start is not None else ""
            entry    = f"## {title}  {pg_info}\n\n{text}" if pg_info else f"## {title}\n\n{text}"
            parts.append(entry.strip())
        body = "\n\n---\n\n".join(parts)

    else:
        body = pdfmux.extract_text(str(pdf_path), quality=quality)

    fm   = make_frontmatter(pdf_path, schema, extra)
    note = f"{fm}\n\n{body.strip()}\n"

    out_path.write_text(note, encoding="utf-8")
    print(f"done  → {out_path}")
    return out_path


def _json_to_md(data: dict, depth: int = 2) -> str:
    lines:     list[str] = []
    prefix   = "#" * min(depth, 6)
    meta_keys = {"page_count", "confidence", "ocr_pages"}

    if depth == 2:
        for k in meta_keys:
            v = data.get(k)
            if v is not None:
                lines.append(f"**{k.replace('_',' ').title()}:** {v}")
        if any(data.get(k) is not None for k in meta_keys):
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

def watch(watch_dir: Path, vault_dir: Path, interval: int = 5, **convert_kwargs):
    watch_dir = watch_dir.expanduser().resolve()
    seen: set[str] = {_file_id(p) for p in watch_dir.glob("*.pdf")}

    print(f"watching  {watch_dir}")
    print(f"vault     {vault_dir.expanduser().resolve()}")
    print(f"interval  {interval}s  |  ctrl+c to stop\n")

    while True:
        time.sleep(interval)
        for pdf in watch_dir.glob("*.pdf"):
            fid = _file_id(pdf)
            if fid not in seen:
                seen.add(fid)
                try:
                    convert(pdf, vault_dir, **convert_kwargs)
                except Exception as exc:
                    print(f"error  {pdf.name}: {exc}", file=sys.stderr)


def _file_id(path: Path) -> str:
    h = hashlib.md5()
    h.update(str(path.stat().st_size).encode())
    h.update(path.name.encode())
    return h.hexdigest()


# ── setup wizard ──────────────────────────────────────────────────────────────

def run_setup():
    """One-time interactive setup — writes config.yaml and optionally .env."""
    print("\npdfmux4obsidian — setup\n")

    default_vault = str(Path.home() / "Documents" / "Obsidian" / "PDFs")
    vault = input(f"Vault output folder [{default_vault}]: ").strip() or default_vault

    print("\nExtraction quality:")
    print("  fast      — digital text PDFs, quickest")
    print("  standard  — good for most documents  [default]")
    print("  high      — scans, mixed layouts, heavy tables")
    quality = input("Quality [standard]: ").strip() or "standard"
    if quality not in ("fast", "standard", "high"):
        quality = "standard"

    print("\nLLM provider (leave blank to skip):")
    for pid, cfg in PROVIDER_CONFIGS.items():
        url_hint = f"  @ {cfg['default_url']}" if cfg.get("default_url") else ""
        print(f"  {pid:<14}{url_hint}")
    llm_provider = input("Provider [none]: ").strip().lower()

    cfg_write:  dict[str, str] = {"vault": vault, "quality": quality}
    env_lines:  list[str]      = []

    if llm_provider and llm_provider in PROVIDER_CONFIGS:
        pcfg      = PROVIDER_CONFIGS[llm_provider]
        key_var   = pcfg.get("key_var")
        def_url   = pcfg.get("default_url", "")
        def_model = pcfg.get("default_model", "")

        cfg_write["llm_provider"] = llm_provider

        # base URL (for OpenAI-compat providers)
        if def_url:
            custom_url = input(f"Base URL [{def_url}]: ").strip()
            if custom_url and custom_url != def_url:
                cfg_write["llm_base_url"] = custom_url

        # model
        if def_model:
            model = input(f"Model [{def_model}]: ").strip() or def_model
        else:
            model = input("Model (leave blank to decide later): ").strip()
        if model:
            cfg_write["llm_model"] = model

        # API key
        if key_var:
            existing = os.environ.get(key_var, "")
            hint     = "  (already in env — press Enter to keep)" if existing else ""
            key_val  = input(f"{key_var}{hint}: ").strip()
            if key_val:
                env_lines.append(f"{key_var}={key_val}")
    elif llm_provider and llm_provider not in PROVIDER_CONFIGS:
        print(f"  unknown provider '{llm_provider}' — skipped")

    # write config.yaml
    cfg_path  = SCRIPT_DIR / "config.yaml"
    yaml_body = "\n".join(f"{k}: {v}" for k, v in cfg_write.items()) + "\n"
    cfg_path.write_text(yaml_body, encoding="utf-8")
    print(f"\n  wrote  {cfg_path}")

    # write .env
    if env_lines:
        env_path = SCRIPT_DIR / ".env"
        env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
        print(f"  wrote  {env_path}")

    print("\nDone. The Obsidian plugin picks this up automatically.")
    print("CLI usage:")
    print("  python pdfmux4obsidian.py convert file.pdf")
    print("  python pdfmux4obsidian.py watch ~/Downloads\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

def build_parser(cfg: dict) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pdfmux4obsidian",
        description="PDF → Obsidian notes via pdfmux (CLI / plugin backend)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python pdfmux4obsidian.py setup
  python pdfmux4obsidian.py convert paper.pdf
  python pdfmux4obsidian.py convert invoice.pdf --schema invoice
  python pdfmux4obsidian.py convert report.pdf --chunk 500
  python pdfmux4obsidian.py watch ~/Downloads --interval 10

config:  ./config.yaml  or  ~/.config/pdfmux4obsidian/config.yaml
env:     ./.env         or  ~/.config/pdfmux4obsidian/.env

powered by pdfmux — https://github.com/NameetP/pdfmux (credit: NameetP)
        """,
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup", help="interactive first-time setup wizard")

    vault_default  = cfg.get("vault")
    vault_kwargs: dict = dict(type=Path, help="destination Obsidian folder")
    if vault_default:
        vault_kwargs["default"] = Path(vault_default)
    else:
        vault_kwargs["required"] = True

    provider_choices = list(PROVIDER_CONFIGS.keys())

    for name, positional in (("convert", "pdf"), ("watch", "dir")):
        sp = sub.add_parser(name, help=f"{'convert a single PDF' if name=='convert' else 'watch a folder for new PDFs'}")
        sp.add_argument(positional, type=Path)
        sp.add_argument("--vault", **vault_kwargs)
        sp.add_argument("--schema", choices=["invoice", "receipt", "contract", "resume", "paper"],
                        default=cfg.get("schema"))
        sp.add_argument("--quality", choices=["fast", "standard", "high"],
                        default=cfg.get("quality", "standard"))
        sp.add_argument("--chunk", dest="max_tokens", type=int, metavar="TOKENS")
        sp.add_argument("--overwrite", action="store_true")
        sp.add_argument("--llm-provider", choices=provider_choices,
                        default=cfg.get("llm_provider"),
                        help="LLM provider for quality=high fallback")
        sp.add_argument("--llm-base-url", default=cfg.get("llm_base_url", ""),
                        help="Override base URL for OpenAI-compatible providers")
        sp.add_argument("--llm-model", default=cfg.get("llm_model", ""),
                        help="Model name to use")
        sp.add_argument("--llm-api-key", default="",
                        help="API key (prefer .env or plugin settings instead)")
        if name == "watch":
            sp.add_argument("--interval", type=int, default=cfg.get("interval", 5))

    return p


def main():
    load_env_file()
    cfg    = load_config()
    parser = build_parser(cfg)
    args   = parser.parse_args()

    if args.cmd == "setup":
        run_setup()
        return

    # apply LLM provider env vars before calling pdfmux
    if args.llm_provider:
        apply_provider_env(
            provider  = args.llm_provider,
            api_key   = args.llm_api_key,
            base_url  = args.llm_base_url,
            model     = args.llm_model,
        )

    convert_kwargs = dict(
        vault_dir  = args.vault,
        schema     = args.schema,
        quality    = args.quality,
        max_tokens = args.max_tokens,
        overwrite  = args.overwrite,
    )

    if args.cmd == "convert":
        convert(args.pdf, **convert_kwargs)
    elif args.cmd == "watch":
        watch(args.dir, interval=args.interval, **convert_kwargs)


if __name__ == "__main__":
    main()
