"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PdfMuxPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var DEFAULTS = {
  pythonPath: "python3",
  outputFolder: "PDFs",
  quality: "standard",
  schema: "",
  chunkTokens: 0,
  llmProvider: "",
  apiKey: "",
  overwrite: false,
  openAfterConvert: true
};
var LLM_ENV_VARS = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY"
};
var PdfMuxPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("file-text", "Convert PDF with pdfmux", () => {
      this.convertActiveFile();
    });
    this.addCommand({
      id: "convert-active-pdf",
      name: "Convert active PDF",
      callback: () => this.convertActiveFile()
    });
    this.addCommand({
      id: "convert-pdf-pick",
      name: "Convert PDF \u2014 enter path\u2026",
      callback: () => new PdfPathModal(this.app, (p) => this.runConversion(p)).open()
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "pdf") {
          menu.addItem(
            (item) => item.setTitle("Convert with pdfmux").setIcon("file-text").onClick(() => this.convertFile(file))
          );
        }
      })
    );
    this.addSettingTab(new PdfMuxSettingTab(this.app, this));
  }
  // ── conversion flow ──────────────────────────────────────────────────────
  convertActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian.Notice("No file open.");
      return;
    }
    if (file.extension !== "pdf") {
      new import_obsidian.Notice("Active file is not a PDF.");
      return;
    }
    this.convertFile(file);
  }
  convertFile(file) {
    const pdfPath = path.join(this.vaultRoot(), file.path);
    this.runConversion(pdfPath);
  }
  runConversion(pdfPath) {
    const script = this.scriptPath();
    if (!script) {
      new import_obsidian.Notice(
        "pdfmux4obsidian.py not found.\nPut it in: .obsidian/plugins/pdfmux4obsidian/"
      );
      return;
    }
    const outFolder = path.join(this.vaultRoot(), this.settings.outputFolder);
    fs.mkdirSync(outFolder, { recursive: true });
    const args = this.buildArgs(script, pdfPath, outFolder);
    const env = this.buildEnv();
    const notice = new import_obsidian.Notice(`\u23F3 Converting ${path.basename(pdfPath)}\u2026`, 0);
    (0, import_child_process.execFile)(this.settings.pythonPath, args, { env }, (_err, _stdout, stderr) => {
      notice.hide();
      if (_err) {
        console.error("[pdfmux4obsidian]", stderr);
        new import_obsidian.Notice(
          `\u274C Conversion failed
${stderr.slice(0, 300)}

See console for details (Ctrl+Shift+I)`
        );
        return;
      }
      const stem = path.basename(pdfPath, path.extname(pdfPath)).replace(/[\\/:*?"<>|]/g, "-").trim();
      const notePath = (0, import_obsidian.normalizePath)(`${this.settings.outputFolder}/${stem}.md`);
      new import_obsidian.Notice(`\u2705 Done \u2014 ${stem}.md`);
      if (this.settings.openAfterConvert) {
        setTimeout(() => {
          const mdFile = this.app.vault.getAbstractFileByPath(notePath);
          if (mdFile instanceof import_obsidian.TFile) {
            this.app.workspace.getLeaf().openFile(mdFile);
          }
        }, 800);
      }
    });
  }
  // ── helpers ──────────────────────────────────────────────────────────────
  buildArgs(script, pdfPath, outFolder) {
    const args = [script, "convert", pdfPath, "--vault", outFolder, "--quality", this.settings.quality];
    if (this.settings.schema)
      args.push("--schema", this.settings.schema);
    if (this.settings.chunkTokens > 0)
      args.push("--chunk", String(this.settings.chunkTokens));
    if (this.settings.overwrite)
      args.push("--overwrite");
    return args;
  }
  buildEnv() {
    const env = { ...process.env };
    if (this.settings.apiKey && this.settings.llmProvider) {
      const varName = LLM_ENV_VARS[this.settings.llmProvider];
      if (varName)
        env[varName] = this.settings.apiKey;
    }
    return env;
  }
  vaultRoot() {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof import_obsidian.FileSystemAdapter)
      return adapter.getBasePath();
    throw new Error("pdfmux4obsidian: vault adapter is not FileSystemAdapter");
  }
  scriptPath() {
    const candidate = path.join(
      this.vaultRoot(),
      ".obsidian",
      "plugins",
      "pdfmux4obsidian",
      "pdfmux4obsidian.py"
    );
    return fs.existsSync(candidate) ? candidate : null;
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var PdfMuxSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "pdfmux4obsidian" });
    containerEl.createEl("p", {
      text: "Powered by pdfmux \u2014 github.com/NameetP/pdfmux",
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(containerEl).setName("Python executable").setDesc("python3, python, or full path \u2014 e.g. /home/you/.venv/bin/python").addText(
      (t) => t.setPlaceholder("python3").setValue(this.plugin.settings.pythonPath).onChange(async (v) => {
        this.plugin.settings.pythonPath = v.trim() || "python3";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Output folder").setDesc("Vault subfolder where converted notes land \u2014 auto-created if missing").addText(
      (t) => t.setPlaceholder("PDFs").setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
        this.plugin.settings.outputFolder = v.trim() || "PDFs";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Extraction quality").setDesc("fast = digital PDFs  \xB7  standard = most docs  \xB7  high = scans, tables, mixed layouts").addDropdown(
      (d) => d.addOption("fast", "fast").addOption("standard", "standard").addOption("high", "high").setValue(this.plugin.settings.quality).onChange(async (v) => {
        this.plugin.settings.quality = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Default schema").setDesc("Structured extraction preset \u2014 blank = plain text").addDropdown(
      (d) => d.addOption("", "none (plain text)").addOption("invoice", "invoice").addOption("receipt", "receipt").addOption("contract", "contract").addOption("resume", "resume").addOption("paper", "paper").setValue(this.plugin.settings.schema).onChange(async (v) => {
        this.plugin.settings.schema = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Chunk size (tokens)").setDesc("Split output into RAG-ready chunks. 0 = off.").addText(
      (t) => t.setPlaceholder("0").setValue(String(this.plugin.settings.chunkTokens)).onChange(async (v) => {
        this.plugin.settings.chunkTokens = parseInt(v) || 0;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "LLM fallback (optional)" });
    containerEl.createEl("p", {
      text: "Only needed for quality = high with LLM-assisted re-extraction on hard pages. Requires: pip install 'pdfmux[llm]'",
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(containerEl).setName("LLM provider").addDropdown(
      (d) => d.addOption("", "none").addOption("gemini", "Gemini").addOption("claude", "Claude (Anthropic)").addOption("openai", "OpenAI / GPT-4o").addOption("ollama", "Ollama (local \u2014 no key needed)").setValue(this.plugin.settings.llmProvider).onChange(async (v) => {
        this.plugin.settings.llmProvider = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("API key").setDesc(
      "Stored in Obsidian's data.json inside your vault \u2014 only sent to the selected provider during conversion."
    ).addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("sk-\u2026 / AIza\u2026 / your-key-here").setValue(this.plugin.settings.apiKey).onChange(async (v) => {
        this.plugin.settings.apiKey = v;
        await this.plugin.saveSettings();
      });
    });
    containerEl.createEl("h3", { text: "Behaviour" });
    new import_obsidian.Setting(containerEl).setName("Open note after conversion").setDesc("Automatically switch to the newly created note when done").addToggle(
      (t) => t.setValue(this.plugin.settings.openAfterConvert).onChange(async (v) => {
        this.plugin.settings.openAfterConvert = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Overwrite existing notes").setDesc("Re-convert and replace if a note with the same name already exists").addToggle(
      (t) => t.setValue(this.plugin.settings.overwrite).onChange(async (v) => {
        this.plugin.settings.overwrite = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
var PdfPathModal = class extends import_obsidian.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Convert PDF" });
    contentEl.createEl("p", {
      text: "Enter full path to a PDF \u2014 anywhere on disk, not just inside the vault.",
      cls: "setting-item-description"
    });
    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = "~/Downloads/paper.pdf  or  /path/to/invoice.pdf";
    input.style.cssText = "width:100%;margin:12px 0 16px;padding:6px 10px;font-size:14px;border-radius:4px;border:1px solid var(--background-modifier-border);";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        this.submit(input.value);
    });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const btn = row.createEl("button", { text: "Convert", cls: "mod-cta" });
    btn.addEventListener("click", () => this.submit(input.value));
    setTimeout(() => input.focus(), 50);
  }
  submit(raw) {
    var _a;
    const val = raw.trim().replace(/^~/, (_a = process.env.HOME) != null ? _a : "~");
    if (!val)
      return;
    this.close();
    this.onSubmit(val);
  }
  onClose() {
    this.contentEl.empty();
  }
};
