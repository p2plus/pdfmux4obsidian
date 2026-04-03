# pdfmux4obsidian

Drop any PDF into your Obsidian vault as a clean Markdown note — frontmatter, body, confidence scores and all. One command.

Built on **[pdfmux](https://github.com/NameetP/pdfmux) by [NameetP](https://github.com/NameetP)** — a smart PDF extraction orchestrator that routes each page to the best available backend (PyMuPDF, OCR, table parsers, optional LLM fallback). This repo is the Obsidian glue layer on top.

---

## What it does

```
paper.pdf  →  vault/Inbox/paper.md
```

Each note gets:

- YAML frontmatter: title, date, source path, tags, page count, confidence score
- Clean extracted body text (markdown-formatted by pdfmux)
- Optional structured output when you pass a `--schema` (invoice, resume, paper, …)
- Optional chunked output via `--chunk N` for RAG-style notes

---

## Setup

Python 3.11+ required.

```bash
pip install pdfmux
```

For scanned PDFs, tables, or complex layouts:

```bash
pip install "pdfmux[ocr]"           # RapidOCR — scanned/image pages
pip install "pdfmux[tables]"        # Docling — table-heavy docs
pip install "pdfmux[all]"           # everything
```

No other dependencies. No config file needed.

---

## Usage

**Convert a single PDF:**
```bash
python pdfmux4obsidian.py convert paper.pdf --vault ~/vault/Inbox
```

**With a schema — structured extraction:**
```bash
python pdfmux4obsidian.py convert invoice.pdf --schema invoice --vault ~/vault/Docs
```

**Chunked output — good for longer docs you want to query later:**
```bash
python pdfmux4obsidian.py convert report.pdf --chunk 500 --vault ~/vault/Research
```

**Higher quality for tricky PDFs (scans, mixed layouts):**
```bash
python pdfmux4obsidian.py convert scan.pdf --quality high --vault ~/vault/Inbox
```

**Watch mode — new PDF in the folder? Gets converted automatically:**
```bash
python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/Inbox
python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/Inbox --interval 10
```

---

## Output format

```markdown
---
title: "paper"
date: 2024-01-15
source: "/Users/you/Downloads/paper.pdf"
tags: [pdf, pdfmux]
pages: 12
confidence: 0.94
---

# Introduction

Lorem ipsum extracted content here...
```

The `source` field lets you link back to the original file from within Obsidian. The `confidence` score comes directly from pdfmux's extraction audit.

---

## Schemas

Pass `--schema <name>` to get structured extraction instead of raw text:

| Schema     | What it pulls out                            |
|------------|----------------------------------------------|
| `invoice`  | vendor, amount, line items, dates            |
| `receipt`  | merchant, total, items                       |
| `contract` | parties, dates, key clauses                  |
| `resume`   | name, contact, experience, education, skills |
| `paper`    | title, abstract, authors, references         |

Schema output is rendered as a structured Markdown note, not raw JSON.

---

## Quality modes

Controls which backends pdfmux uses:

| Flag              | When to use                            |
|-------------------|----------------------------------------|
| `--quality fast`  | digital-text PDFs, speed matters       |
| `--quality standard` | default, good for most docs        |
| `--quality high`  | scans, mixed layouts, tricky tables    |

---

## All options

```
convert <pdf> --vault <dir>
  --schema    invoice | receipt | contract | resume | paper
  --quality   fast | standard | high  (default: standard)
  --chunk N   RAG-ready chunks, max N tokens each
  --overwrite replace existing note

watch <dir> --vault <dir>
  --schema, --quality, --chunk, --overwrite  (same as convert)
  --interval N   poll every N seconds (default: 5)
```

---

## Credit

All extraction logic is **[pdfmux](https://github.com/NameetP/pdfmux)** — go give [NameetP](https://github.com/NameetP) a star if this is useful to you. This repo is just a thin wrapper that speaks Obsidian.

---

## License

MIT
