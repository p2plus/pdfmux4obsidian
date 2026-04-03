# pdfmux4obsidian

Drop any PDF into your Obsidian vault as a clean Markdown note — frontmatter and all. One command, done.

Built on top of **[pdfmux](https://github.com/NameetP/pdfmux) by [NameetP](https://github.com/NameetP)** — a genuinely clever PDF extraction orchestrator that routes each page to the best available backend (PyMuPDF, OCR, table parsers, optional LLM fallback). This repo is just a thin Obsidian-friendly wrapper around that.

---

## What it does

```
paper.pdf  →  vault/Inbox/paper.md
```

Each note gets:
- YAML frontmatter (title, date, source path, tags, page count)
- Clean extracted body text
- Optional structured output when you pass a schema (`invoice`, `resume`, `paper`, …)
- Optional chunked output for RAG-style notes

---

## Setup

```bash
pip install pdfmux PyMuPDF
```

That's it. No config files, no daemons, nothing fancy.

---

## Usage

**Convert a single PDF:**
```bash
python pdfmux4obsidian.py convert paper.pdf --vault ~/vault/Inbox
```

**With a schema (structured extraction):**
```bash
python pdfmux4obsidian.py convert invoice.pdf --schema invoice --vault ~/vault/Docs
```

**Chunked output (good for longer docs you want to query later):**
```bash
python pdfmux4obsidian.py convert report.pdf --chunk 500 --vault ~/vault/Research
```

**Watch a folder — new PDFs get converted automatically:**
```bash
python pdfmux4obsidian.py watch ~/Downloads --vault ~/vault/Inbox
```

**With an LLM in the loop for tricky pages:**
```bash
python pdfmux4obsidian.py convert scan.pdf --llm claude --cost-mode balanced --vault ~/vault/Inbox
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
---

Lorem ipsum extracted content here...
```

The source path lets you link back to the original file from within Obsidian.

---

## Schemas

pdfmux ships five built-in extraction schemas. Pass `--schema <name>`:

| Schema     | What it pulls out                            |
|------------|----------------------------------------------|
| `invoice`  | vendor, amount, line items, dates            |
| `receipt`  | merchant, total, items                       |
| `contract` | parties, dates, key clauses                  |
| `resume`   | name, contact, experience, education, skills |
| `paper`    | title, abstract, authors, references         |

---

## Cost modes

pdfmux's `--cost-mode` controls which backends get used:

- `economy` — rule-based only, free, default
- `balanced` — rule-based + LLM fallback on hard pages
- `premium` — LLM on everything

---

## Options

```
convert <pdf> --vault <dir>
  --schema   invoice | receipt | contract | resume | paper
  --cost-mode  economy | balanced | premium  (default: economy)
  --llm        gemini | claude | gpt4o | ollama
  --chunk N    chunk output at N tokens
  --overwrite  replace existing note

watch <dir> --vault <dir>
  (same options as convert, plus:)
  --interval N   poll every N seconds (default: 5)
```

---

## Credit

All the actual extraction magic is **[pdfmux](https://github.com/NameetP/pdfmux)** — go give [NameetP](https://github.com/NameetP) a star if this is useful to you. This repo is just the Obsidian glue layer on top.

---

## License

MIT
