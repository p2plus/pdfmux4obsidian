import {
  App,
  FileSystemAdapter,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";

// ── types ────────────────────────────────────────────────────────────────────

interface PdfMuxSettings {
  pythonPath:       string;
  outputFolder:     string;
  quality:          "fast" | "standard" | "high";
  schema:           "" | "invoice" | "receipt" | "contract" | "resume" | "paper";
  chunkTokens:      number;
  llmProvider:      "" | "gemini" | "claude" | "openai" | "ollama";
  apiKey:           string;
  overwrite:        boolean;
  openAfterConvert: boolean;
}

const DEFAULTS: PdfMuxSettings = {
  pythonPath:       "python3",
  outputFolder:     "PDFs",
  quality:          "standard",
  schema:           "",
  chunkTokens:      0,
  llmProvider:      "",
  apiKey:           "",
  overwrite:        false,
  openAfterConvert: true,
};

const LLM_ENV_VARS: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

// ── plugin ───────────────────────────────────────────────────────────────────

export default class PdfMuxPlugin extends Plugin {
  settings!: PdfMuxSettings;

  async onload() {
    await this.loadSettings();

    // ribbon — always visible, one click to convert
    this.addRibbonIcon("file-text", "Convert PDF with pdfmux", () => {
      this.convertActiveFile();
    });

    this.addCommand({
      id:       "convert-active-pdf",
      name:     "Convert active PDF",
      callback: () => this.convertActiveFile(),
    });

    this.addCommand({
      id:       "convert-pdf-pick",
      name:     "Convert PDF — enter path…",
      callback: () => new PdfPathModal(this.app, (p) => this.runConversion(p)).open(),
    });

    // right-click on any .pdf in the file explorer
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "pdf") {
          menu.addItem((item) =>
            item
              .setTitle("Convert with pdfmux")
              .setIcon("file-text")
              .onClick(() => this.convertFile(file))
          );
        }
      })
    );

    this.addSettingTab(new PdfMuxSettingTab(this.app, this));
  }

  // ── conversion flow ──────────────────────────────────────────────────────

  private convertActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file)                     { new Notice("No file open."); return; }
    if (file.extension !== "pdf")  { new Notice("Active file is not a PDF."); return; }
    this.convertFile(file);
  }

  private convertFile(file: TFile) {
    const pdfPath = path.join(this.vaultRoot(), file.path);
    this.runConversion(pdfPath);
  }

  private runConversion(pdfPath: string) {
    const script = this.scriptPath();
    if (!script) {
      new Notice(
        "pdfmux4obsidian.py not found.\n" +
        "Put it in: .obsidian/plugins/pdfmux4obsidian/"
      );
      return;
    }

    const outFolder = path.join(this.vaultRoot(), this.settings.outputFolder);
    fs.mkdirSync(outFolder, { recursive: true });

    // execFile takes an args array — no shell, no injection risk
    const args = this.buildArgs(script, pdfPath, outFolder);
    const env  = this.buildEnv();

    const notice = new Notice(`⏳ Converting ${path.basename(pdfPath)}…`, 0);

    execFile(this.settings.pythonPath, args, { env }, (_err, _stdout, stderr) => {
      notice.hide();

      if (_err) {
        console.error("[pdfmux4obsidian]", stderr);
        new Notice(
          `❌ Conversion failed\n${stderr.slice(0, 300)}\n\nSee console for details (Ctrl+Shift+I)`
        );
        return;
      }

      const stem     = path.basename(pdfPath, path.extname(pdfPath))
                           .replace(/[\\/:*?"<>|]/g, "-")
                           .trim();
      const notePath = normalizePath(`${this.settings.outputFolder}/${stem}.md`);

      new Notice(`✅ Done — ${stem}.md`);

      if (this.settings.openAfterConvert) {
        setTimeout(() => {
          const mdFile = this.app.vault.getAbstractFileByPath(notePath);
          if (mdFile instanceof TFile) {
            this.app.workspace.getLeaf().openFile(mdFile);
          }
        }, 800);
      }
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private buildArgs(script: string, pdfPath: string, outFolder: string): string[] {
    const args: string[] = [script, "convert", pdfPath, "--vault", outFolder, "--quality", this.settings.quality];
    if (this.settings.schema)          args.push("--schema",  this.settings.schema);
    if (this.settings.chunkTokens > 0) args.push("--chunk",   String(this.settings.chunkTokens));
    if (this.settings.overwrite)       args.push("--overwrite");
    return args;
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (this.settings.apiKey && this.settings.llmProvider) {
      const varName = LLM_ENV_VARS[this.settings.llmProvider];
      if (varName) env[varName] = this.settings.apiKey;
    }
    return env;
  }

  private vaultRoot(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    throw new Error("pdfmux4obsidian: vault adapter is not FileSystemAdapter");
  }

  private scriptPath(): string | null {
    const candidate = path.join(
      this.vaultRoot(),
      ".obsidian", "plugins", "pdfmux4obsidian", "pdfmux4obsidian.py"
    );
    return fs.existsSync(candidate) ? candidate : null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ── settings tab ─────────────────────────────────────────────────────────────

class PdfMuxSettingTab extends PluginSettingTab {
  plugin: PdfMuxPlugin;

  constructor(app: App, plugin: PdfMuxPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "pdfmux4obsidian" });
    containerEl.createEl("p", {
      text: "Powered by pdfmux — github.com/NameetP/pdfmux",
      cls:  "setting-item-description",
    });

    // ── core ──

    new Setting(containerEl)
      .setName("Python executable")
      .setDesc("python3, python, or full path — e.g. /home/you/.venv/bin/python")
      .addText(t =>
        t.setPlaceholder("python3")
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async v => {
            this.plugin.settings.pythonPath = v.trim() || "python3";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Vault subfolder where converted notes land — auto-created if missing")
      .addText(t =>
        t.setPlaceholder("PDFs")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async v => {
            this.plugin.settings.outputFolder = v.trim() || "PDFs";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extraction quality")
      .setDesc("fast = digital PDFs  ·  standard = most docs  ·  high = scans, tables, mixed layouts")
      .addDropdown(d =>
        d.addOption("fast",     "fast")
          .addOption("standard", "standard")
          .addOption("high",     "high")
          .setValue(this.plugin.settings.quality)
          .onChange(async v => {
            this.plugin.settings.quality = v as PdfMuxSettings["quality"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default schema")
      .setDesc("Structured extraction preset — blank = plain text")
      .addDropdown(d =>
        d.addOption("",         "none (plain text)")
          .addOption("invoice",  "invoice")
          .addOption("receipt",  "receipt")
          .addOption("contract", "contract")
          .addOption("resume",   "resume")
          .addOption("paper",    "paper")
          .setValue(this.plugin.settings.schema)
          .onChange(async v => {
            this.plugin.settings.schema = v as PdfMuxSettings["schema"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chunk size (tokens)")
      .setDesc("Split output into RAG-ready chunks. 0 = off.")
      .addText(t =>
        t.setPlaceholder("0")
          .setValue(String(this.plugin.settings.chunkTokens))
          .onChange(async v => {
            this.plugin.settings.chunkTokens = parseInt(v) || 0;
            await this.plugin.saveSettings();
          })
      );

    // ── LLM ──

    containerEl.createEl("h3", { text: "LLM fallback (optional)" });
    containerEl.createEl("p", {
      text: "Only needed for quality = high with LLM-assisted re-extraction on hard pages. Requires: pip install 'pdfmux[llm]'",
      cls:  "setting-item-description",
    });

    new Setting(containerEl)
      .setName("LLM provider")
      .addDropdown(d =>
        d.addOption("",       "none")
          .addOption("gemini", "Gemini")
          .addOption("claude", "Claude (Anthropic)")
          .addOption("openai", "OpenAI / GPT-4o")
          .addOption("ollama", "Ollama (local — no key needed)")
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async v => {
            this.plugin.settings.llmProvider = v as PdfMuxSettings["llmProvider"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc(
        "Stored in Obsidian's data.json inside your vault — only sent to the selected provider during conversion."
      )
      .addText(t => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-… / AIza… / your-key-here")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async v => {
            this.plugin.settings.apiKey = v;
            await this.plugin.saveSettings();
          });
      });

    // ── behaviour ──

    containerEl.createEl("h3", { text: "Behaviour" });

    new Setting(containerEl)
      .setName("Open note after conversion")
      .setDesc("Automatically switch to the newly created note when done")
      .addToggle(t =>
        t.setValue(this.plugin.settings.openAfterConvert)
          .onChange(async v => {
            this.plugin.settings.openAfterConvert = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Overwrite existing notes")
      .setDesc("Re-convert and replace if a note with the same name already exists")
      .addToggle(t =>
        t.setValue(this.plugin.settings.overwrite)
          .onChange(async v => {
            this.plugin.settings.overwrite = v;
            await this.plugin.saveSettings();
          })
      );
  }
}

// ── pdf path modal ────────────────────────────────────────────────────────────

class PdfPathModal extends Modal {
  private onSubmit: (filePath: string) => void;

  constructor(app: App, onSubmit: (filePath: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Convert PDF" });
    contentEl.createEl("p", {
      text: "Enter full path to a PDF — anywhere on disk, not just inside the vault.",
      cls:  "setting-item-description",
    });

    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = "~/Downloads/paper.pdf  or  /path/to/invoice.pdf";
    input.style.cssText = "width:100%;margin:12px 0 16px;padding:6px 10px;font-size:14px;border-radius:4px;border:1px solid var(--background-modifier-border);";

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit(input.value);
    });

    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());

    const btn = row.createEl("button", { text: "Convert", cls: "mod-cta" });
    btn.addEventListener("click", () => this.submit(input.value));

    setTimeout(() => input.focus(), 50);
  }

  private submit(raw: string) {
    const val = raw.trim().replace(/^~/, process.env.HOME ?? "~");
    if (!val) return;
    this.close();
    this.onSubmit(val);
  }

  onClose() {
    this.contentEl.empty();
  }
}
