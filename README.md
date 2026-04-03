# pdfmux4obsidian

Obsidian plugin that converts PDFs to Markdown notes — right inside the app. No terminal, no extra windows.

Ribbon button, command palette, right-click in the file explorer — however you want to trigger it. The result lands in your vault as a properly formatted note with YAML frontmatter.

Built on **[pdfmux](https://github.com/NameetP/pdfmux) by [NameetP](https://github.com/NameetP)** — a PDF extraction orchestrator that routes each page to the best available backend: PyMuPDF for digital text, OCR for scans, Docling for tables, optional LLM fallback for the hard stuff. This plugin is the Obsidian UI on top.

---

## What it looks like

**Ribbon icon** → click → PDF converts → note opens automatically:

```
📄 paper.pdf  →  vault/PDFs/paper.md
```

**Right-click any PDF in the file explorer:**

```
Open
Open to the right
...
✦ Convert with pdfmux     ← here
```

**Command palette** (`Cmd/Ctrl+P`):
- `pdfmux: Convert active PDF`
- `pdfmux: Convert PDF — enter path…` — for PDFs outside the vault

**Settings tab** (`Settings → Community Plugins → pdfmux4obsidian`):

| Setting | What it does |
|---|---|
| Python executable | path to python3 or your venv |
| Output folder | vault subfolder for converted notes |
| Extraction quality | fast / standard / high |
| Default schema | structured extraction preset |
| Chunk size | RAG-ready chunks in tokens |
| LLM provider | Gemini / Claude / OpenAI / Ollama |
| API key | stored in Obsidian's data.json |
| Open after conversion | auto-switch to new note |
| Overwrite | replace existing notes |

---

## Install

### 1. Install pdfmux (Python)

```bash
pip install pdfmux
```

For scanned PDFs, tables, or LLM fallback:
```bash
pip install "pdfmux[ocr]"      # scanned / image-only pages
pip install "pdfmux[tables]"   # table-heavy documents
pip install "pdfmux[llm]"      # LLM fallback
pip install "pdfmux[all]"      # everything
```

Requires **Python 3.11+**.

### 2. Install the plugin

**Option A — manually (until it's in the community plugin list):**

1. Download `manifest.json`, `main.js`, `pdfmux4obsidian.py` from [Releases](https://github.com/p2plus/pdfmux4obsidian/releases)
2. Create folder: `YourVault/.obsidian/plugins/pdfmux4obsidian/`
3. Drop the three files in there
4. Reload Obsidian → Settings → Community Plugins → enable **pdfmux4obsidian**

**Option B — build from source:**
```bash
git clone https://github.com/p2plus/pdfmux4obsidian
cd pdfmux4obsidian
npm install
npm run build
# then copy manifest.json, main.js, pdfmux4obsidian.py → vault/.obsidian/plugins/pdfmux4obsidian/
```

### 3. Configure the plugin

Open Settings → Community Plugins → pdfmux4obsidian:

- **Python executable** — run `which python3` in Terminal to find yours
- **Output folder** — e.g. `PDFs` or `Inbox/PDFs` (auto-created)
- Everything else is optional

---

## How it lands in Obsidian

Every converted PDF becomes a note with YAML frontmatter Obsidian understands natively:

```markdown
---
title: "research-paper"
date: 2024-01-15
source: "/Users/you/Downloads/research-paper.pdf"
tags: [pdf, pdfmux]
pages: 12
confidence: 0.94
---

# Introduction

Extracted content here, formatted as Markdown by pdfmux...
```

The `source` field links back to the original PDF. The `tags`, `date`, and `pages` fields are fully compatible with **Dataview**.

### Dataview query for all converted PDFs

```dataview
TABLE date, pages, confidence, source
FROM #pdf
SORT date DESC
```

Or filter by schema:

```dataview
TABLE date, source
FROM #pdf
WHERE schema = "invoice"
SORT date DESC
```

---

## Schemas

Set a default schema in plugin settings, or use the CLI `--schema` flag. Five built-in presets:

| Schema | What gets extracted |
|---|---|
| `invoice` | vendor, amount, line items, due date |
| `receipt` | merchant, total, items |
| `contract` | parties, dates, key clauses |
| `resume` | name, contact, experience, education, skills |
| `paper` | title, abstract, authors, references |

Schema output is rendered as structured Markdown — not raw JSON.

---

## LLM credentials

The API key lives in **Obsidian's plugin settings** — it's stored in `.obsidian/plugins/pdfmux4obsidian/data.json` inside your vault. It's only sent to the provider you pick, during conversion, when pdfmux decides a page needs LLM-assisted re-extraction.

No `.env` file needed when using the plugin. The plugin injects the key as an environment variable for pdfmux behind the scenes.

LLM fallback only kicks in with `quality: high`. The default (`standard`) is fully local and free.

---

## Quality modes

| Mode | What it uses | Cost |
|---|---|---|
| `fast` | PyMuPDF only | free |
| `standard` | rule-based routing (default) | free |
| `high` | rule-based + LLM on hard pages | depends on provider |

---

## CLI mode (optional)

The Python script also works standalone — useful for batch jobs or watch mode:

```bash
# first-time setup wizard
python pdfmux4obsidian.py setup

# single file
python pdfmux4obsidian.py convert paper.pdf --vault ~/vault/PDFs

# with schema
python pdfmux4obsidian.py convert invoice.pdf --schema invoice --vault ~/vault/Docs

# watch a folder — new PDFs auto-convert
python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/PDFs
```

`config.yaml` (created by `setup`) sets defaults so you don't have to pass `--vault` every time. See `config.example.yaml`.

---

## Credit

All extraction logic is **[pdfmux](https://github.com/NameetP/pdfmux)** — go star [NameetP's repo](https://github.com/NameetP) if this is useful. This plugin is just the Obsidian wrapper.

---

## License

MIT
