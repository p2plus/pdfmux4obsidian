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
  llmBaseUrl: "",
  llmModel: "",
  overwrite: false,
  openAfterConvert: true
};
var openAiParseModels = (json) => {
  var _a;
  return ((_a = json == null ? void 0 : json.data) != null ? _a : []).map((m) => m.id).filter(Boolean).sort();
};
var PROVIDERS = {
  gemini: {
    label: "Gemini (Google)",
    keyRequired: true,
    keyPlaceholder: "AIza\u2026",
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    pdfmuxId: "gemini",
    healthUrl: (_, k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
    healthHeaders: () => ({}),
    modelsUrl: (_, k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
    modelsHeaders: () => ({}),
    parseModels: (json) => {
      var _a;
      const models = (_a = json == null ? void 0 : json.models) != null ? _a : [];
      return models.filter((m) => {
        var _a2;
        return (_a2 = m.supportedGenerationMethods) == null ? void 0 : _a2.includes("generateContent");
      }).map((m) => m.name.replace(/^models\//, "")).sort();
    }
  },
  claude: {
    label: "Claude (Anthropic)",
    keyRequired: true,
    keyPlaceholder: "sk-ant-\u2026",
    defaultUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-haiku-20241022",
    pdfmuxId: "claude",
    healthUrl: () => "https://api.anthropic.com/v1/models",
    healthHeaders: (_, k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    modelsUrl: () => "https://api.anthropic.com/v1/models",
    modelsHeaders: (_, k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    parseModels: openAiParseModels
  },
  openai: {
    label: "OpenAI / GPT-4o",
    keyRequired: true,
    keyPlaceholder: "sk-\u2026",
    defaultUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    pdfmuxId: "openai",
    healthUrl: (b) => `${b}/models`,
    healthHeaders: (_, k) => ({ Authorization: `Bearer ${k}` }),
    modelsUrl: (b) => `${b}/models`,
    modelsHeaders: (_, k) => ({ Authorization: `Bearer ${k}` }),
    parseModels: openAiParseModels
  },
  zai: {
    label: "Z AI (GLM)",
    keyRequired: true,
    keyPlaceholder: "your Z.AI API key",
    defaultUrl: "https://api.z.ai/api/coding/paas/v4",
    defaultModel: "glm-5.1",
    pdfmuxId: "openai",
    // OpenAI-compatible
    healthUrl: (b) => `${b}/models`,
    healthHeaders: (_, k) => ({ Authorization: `Bearer ${k}` }),
    modelsUrl: (b) => `${b}/models`,
    modelsHeaders: (_, k) => ({ Authorization: `Bearer ${k}` }),
    parseModels: openAiParseModels
  },
  lmstudio: {
    label: "LM Studio (local)",
    keyRequired: false,
    keyPlaceholder: "lm-studio (any string works)",
    defaultUrl: "http://localhost:1234/v1",
    defaultModel: "",
    pdfmuxId: "openai",
    healthUrl: (b) => `${b}/models`,
    healthHeaders: () => ({}),
    modelsUrl: (b) => `${b}/models`,
    modelsHeaders: () => ({}),
    parseModels: openAiParseModels
  },
  ollama: {
    label: "Ollama (local)",
    keyRequired: false,
    keyPlaceholder: "\u2014 not needed \u2014",
    defaultUrl: "http://localhost:11434",
    defaultModel: "",
    pdfmuxId: "ollama",
    healthUrl: (b) => `${b}/api/tags`,
    healthHeaders: () => ({}),
    modelsUrl: (b) => `${b}/api/tags`,
    modelsHeaders: () => ({}),
    parseModels: (json) => {
      var _a;
      return ((_a = json == null ? void 0 : json.models) != null ? _a : []).map((m) => m.name).filter(Boolean).sort();
    }
  },
  anythingllm: {
    label: "AnythingLLM (local)",
    keyRequired: true,
    keyPlaceholder: "workspace API token",
    defaultUrl: "http://localhost:3001/api/v1",
    defaultModel: "",
    pdfmuxId: "openai",
    healthUrl: (b) => `${b}/auth`,
    healthHeaders: (_, k) => ({ Authorization: `Bearer ${k}` }),
    modelsUrl: (b) => `${b}/openai/models`,
    modelsHeaders: (_, k) => ({ Authorization: `Bearer ${k}` }),
    parseModels: openAiParseModels
  }
};
async function probeEndpoint(url, headers) {
  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(6e3)
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}
async function fetchModels(def, baseUrl, apiKey) {
  const url = def.modelsUrl(baseUrl, apiKey);
  const headers = def.modelsHeaders(baseUrl, apiKey);
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8e3) });
    if (!resp.ok)
      return [];
    const json = await resp.json();
    return def.parseModels(json);
  } catch (e) {
    return [];
  }
}
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
  // ── conversion ───────────────────────────────────────────────────────────
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
    this.runConversion(path.join(this.vaultRoot(), file.path));
  }
  runConversion(pdfPath) {
    const script = this.scriptPath();
    if (!script) {
      new import_obsidian.Notice("pdfmux4obsidian.py not found.\nPut it in: .obsidian/plugins/pdfmux4obsidian/");
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
        new import_obsidian.Notice(`\u274C Conversion failed
${stderr.slice(0, 300)}

See console (Ctrl+Shift+I)`);
        return;
      }
      const stem = path.basename(pdfPath, path.extname(pdfPath)).replace(/[\\/:*?"<>|]/g, "-").trim();
      const notePath = (0, import_obsidian.normalizePath)(`${this.settings.outputFolder}/${stem}.md`);
      new import_obsidian.Notice(`\u2705 Done \u2014 ${stem}.md`);
      if (this.settings.openAfterConvert) {
        setTimeout(() => {
          const f = this.app.vault.getAbstractFileByPath(notePath);
          if (f instanceof import_obsidian.TFile)
            this.app.workspace.getLeaf().openFile(f);
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
    const p = this.settings.llmProvider;
    const key = this.settings.apiKey;
    const url = this.effectiveBaseUrl();
    const mdl = this.settings.llmModel;
    switch (p) {
      case "gemini":
        if (key)
          env["GEMINI_API_KEY"] = key;
        break;
      case "claude":
        if (key)
          env["ANTHROPIC_API_KEY"] = key;
        break;
      case "openai":
        if (key)
          env["OPENAI_API_KEY"] = key;
        if (url)
          env["OPENAI_BASE_URL"] = url;
        break;
      case "zai":
        if (key)
          env["OPENAI_API_KEY"] = key;
        env["OPENAI_BASE_URL"] = url;
        break;
      case "lmstudio":
        env["OPENAI_API_KEY"] = key || "lm-studio";
        env["OPENAI_BASE_URL"] = url;
        break;
      case "ollama":
        env["OPENAI_API_KEY"] = "ollama";
        env["OPENAI_BASE_URL"] = `${url}/v1`;
        break;
      case "anythingllm":
        if (key)
          env["OPENAI_API_KEY"] = key;
        env["OPENAI_BASE_URL"] = url;
        break;
    }
    if (mdl && p)
      env["OPENAI_MODEL"] = mdl;
    return env;
  }
  effectiveBaseUrl() {
    var _a;
    if (this.settings.llmBaseUrl.trim())
      return this.settings.llmBaseUrl.trim();
    const def = PROVIDERS[this.settings.llmProvider];
    return (_a = def == null ? void 0 : def.defaultUrl) != null ? _a : "";
  }
  vaultRoot() {
    const a = this.app.vault.adapter;
    if (a instanceof import_obsidian.FileSystemAdapter)
      return a.getBasePath();
    throw new Error("pdfmux4obsidian: not a FileSystemAdapter");
  }
  scriptPath() {
    const c = path.join(this.vaultRoot(), ".obsidian", "plugins", "pdfmux4obsidian", "pdfmux4obsidian.py");
    return fs.existsSync(c) ? c : null;
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
    this._connStatus = "idle";
    this._connMsg = "";
    this._models = [];
    this._modLoading = false;
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
    new import_obsidian.Setting(containerEl).setName("Python executable").setDesc("python3, python, or absolute path \u2014 e.g. /home/you/.venv/bin/python").addText((t) => t.setPlaceholder("python3").setValue(this.plugin.settings.pythonPath).onChange(async (v) => {
      this.plugin.settings.pythonPath = v.trim() || "python3";
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Output folder").setDesc("Vault subfolder for converted notes \u2014 auto-created if missing").addText((t) => t.setPlaceholder("PDFs").setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
      this.plugin.settings.outputFolder = v.trim() || "PDFs";
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Extraction quality").setDesc("fast = digital PDFs  \xB7  standard = most docs  \xB7  high = scans, tables, mixed layouts").addDropdown((d) => d.addOption("fast", "fast").addOption("standard", "standard").addOption("high", "high").setValue(this.plugin.settings.quality).onChange(async (v) => {
      this.plugin.settings.quality = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Default schema").setDesc("Structured extraction preset \u2014 blank = plain text").addDropdown((d) => d.addOption("", "none (plain text)").addOption("invoice", "invoice").addOption("receipt", "receipt").addOption("contract", "contract").addOption("resume", "resume").addOption("paper", "paper").setValue(this.plugin.settings.schema).onChange(async (v) => {
      this.plugin.settings.schema = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Chunk size (tokens)").setDesc("RAG-ready chunks. 0 = off.").addText((t) => t.setPlaceholder("0").setValue(String(this.plugin.settings.chunkTokens)).onChange(async (v) => {
      this.plugin.settings.chunkTokens = parseInt(v) || 0;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "LLM fallback (optional)" });
    containerEl.createEl("p", {
      text: "Kicks in only at quality = high, on pages that rule-based extraction fails. Requires: pip install 'pdfmux[llm]'",
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(containerEl).setName("Provider").addDropdown((d) => {
      d.addOption("", "\u2014 none \u2014");
      for (const [id, def2] of Object.entries(PROVIDERS))
        d.addOption(id, def2.label);
      d.setValue(this.plugin.settings.llmProvider).onChange(async (v) => {
        this.plugin.settings.llmProvider = v;
        this.plugin.settings.llmBaseUrl = "";
        this.plugin.settings.llmModel = "";
        this._connStatus = "idle";
        this._models = [];
        await this.plugin.saveSettings();
        this.display();
      });
    });
    const prov = this.plugin.settings.llmProvider;
    if (!prov)
      return this._renderBehaviour(containerEl);
    const def = PROVIDERS[prov];
    if (def.keyRequired) {
      const keySetting = new import_obsidian.Setting(containerEl).setName("API key").setDesc("Stored in Obsidian's data.json \u2014 only sent to this provider during conversion.").addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder(def.keyPlaceholder).setValue(this.plugin.settings.apiKey).onChange(async (v) => {
          this.plugin.settings.apiKey = v;
          this._connStatus = "idle";
          await this.plugin.saveSettings();
        });
      });
      const badge = keySetting.controlEl.createEl("span");
      badge.style.cssText = "margin-left:8px;font-size:12px;";
      badge.setText(this._connBadge());
      keySetting.addButton((btn) => {
        btn.setButtonText(this._connStatus === "loading" ? "Testing\u2026" : "Test").setDisabled(this._connStatus === "loading").onClick(async () => {
          var _a;
          this._connStatus = "loading";
          this.display();
          const baseUrl = this.plugin.effectiveBaseUrl();
          const result = await probeEndpoint(
            def.healthUrl(baseUrl, this.plugin.settings.apiKey),
            def.healthHeaders(baseUrl, this.plugin.settings.apiKey)
          );
          this._connStatus = result.ok ? "ok" : "fail";
          this._connMsg = result.ok ? `HTTP ${result.status}` : (_a = result.error) != null ? _a : `HTTP ${result.status}`;
          this.display();
        });
      });
    }
    if (prov !== "gemini" && prov !== "claude") {
      new import_obsidian.Setting(containerEl).setName("Base URL").setDesc(`Default: ${def.defaultUrl}`).addText((t) => t.setPlaceholder(def.defaultUrl).setValue(this.plugin.settings.llmBaseUrl).onChange(async (v) => {
        this.plugin.settings.llmBaseUrl = v.trim();
        this._connStatus = "idle";
        await this.plugin.saveSettings();
      }));
    }
    this._renderModelPicker(containerEl, def);
    this._renderBehaviour(containerEl);
  }
  // ── model picker ─────────────────────────────────────────────────────────
  _renderModelPicker(containerEl, def) {
    const modelSetting = new import_obsidian.Setting(containerEl).setName("Model");
    if (this._models.length > 0) {
      modelSetting.setDesc("Fetched from provider \u2014 select one");
      modelSetting.addDropdown((d) => {
        if (!this.plugin.settings.llmModel)
          d.addOption("", "\u2014 select \u2014");
        for (const m of this._models)
          d.addOption(m, m);
        d.setValue(this.plugin.settings.llmModel).onChange(async (v) => {
          this.plugin.settings.llmModel = v;
          await this.plugin.saveSettings();
        });
      });
    } else {
      const placeholder = def.defaultModel || "e.g. " + (def.label.includes("GLM") ? "glm-5.1" : "llama3");
      modelSetting.setDesc("Type a model name, or click \u21BA to load available models from the provider");
      modelSetting.addText((t) => t.setPlaceholder(placeholder).setValue(this.plugin.settings.llmModel).onChange(async (v) => {
        this.plugin.settings.llmModel = v.trim();
        await this.plugin.saveSettings();
      }));
    }
    modelSetting.addButton((btn) => {
      btn.setIcon("refresh-cw").setTooltip("Load models from provider").setDisabled(this._modLoading).onClick(async () => {
        this._modLoading = true;
        this.display();
        const base = this.plugin.effectiveBaseUrl();
        const models = await fetchModels(def, base, this.plugin.settings.apiKey);
        this._models = models;
        this._modLoading = false;
        if (models.length === 0) {
          new import_obsidian.Notice("No models returned \u2014 check your connection and API key.");
        } else if (models.length > 0 && !this.plugin.settings.llmModel) {
          const preferred = def.defaultModel;
          this.plugin.settings.llmModel = models.includes(preferred) ? preferred : models[0];
          await this.plugin.saveSettings();
        }
        this.display();
      });
    });
  }
  // ── behaviour section ─────────────────────────────────────────────────────
  _renderBehaviour(containerEl) {
    containerEl.createEl("h3", { text: "Behaviour" });
    new import_obsidian.Setting(containerEl).setName("Open note after conversion").setDesc("Automatically switch to the new note when done").addToggle((t) => t.setValue(this.plugin.settings.openAfterConvert).onChange(async (v) => {
      this.plugin.settings.openAfterConvert = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Overwrite existing notes").setDesc("Re-convert and replace if the note already exists").addToggle((t) => t.setValue(this.plugin.settings.overwrite).onChange(async (v) => {
      this.plugin.settings.overwrite = v;
      await this.plugin.saveSettings();
    }));
  }
  // ── helpers ──────────────────────────────────────────────────────────────
  _connBadge() {
    switch (this._connStatus) {
      case "ok":
        return `\u2705 ${this._connMsg}`;
      case "fail":
        return `\u274C ${this._connMsg}`;
      case "loading":
        return "\u23F3";
      default:
        return "";
    }
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
      text: "Enter full path \u2014 anywhere on disk, not just inside the vault.",
      cls: "setting-item-description"
    });
    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = "~/Downloads/paper.pdf  or  /path/to/invoice.pdf";
    input.style.cssText = "width:100%;margin:12px 0 16px;padding:6px 10px;font-size:14px;border-radius:4px;border:1px solid var(--background-modifier-border);";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        this.submit(input.value);
    });
    const row = contentEl.createDiv();
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    row.createEl("button", { text: "Convert", cls: "mod-cta" }).addEventListener("click", () => this.submit(input.value));
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
