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

// ── types ─────────────────────────────────────────────────────────────────────

type LlmProvider =
  | ""
  | "gemini"
  | "claude"
  | "openai"
  | "zai"
  | "lmstudio"
  | "ollama"
  | "anythingllm";

interface PdfMuxSettings {
  pythonPath:       string;
  outputFolder:     string;
  quality:          "fast" | "standard" | "high";
  schema:           "" | "invoice" | "receipt" | "contract" | "resume" | "paper";
  chunkTokens:      number;
  llmProvider:      LlmProvider;
  apiKey:           string;
  llmBaseUrl:       string;
  llmModel:         string;
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
  llmBaseUrl:       "",
  llmModel:         "",
  overwrite:        false,
  openAfterConvert: true,
};

// ── provider definitions ──────────────────────────────────────────────────────

interface ProviderDef {
  label:          string;
  keyRequired:    boolean;
  keyPlaceholder: string;
  defaultUrl:     string;
  defaultModel:   string;
  /** pdfmux llm_provider value to forward to Python */
  pdfmuxId:       string;
  healthUrl:      (base: string, key: string) => string;
  healthHeaders:  (base: string, key: string) => Record<string, string>;
  modelsUrl:      (base: string, key: string) => string;
  modelsHeaders:  (base: string, key: string) => Record<string, string>;
  parseModels:    (json: unknown) => string[];
}

const openAiParseModels = (json: unknown): string[] =>
  ((json as Record<string, unknown>)?.data as {id: string}[] ?? [])
    .map(m => m.id)
    .filter(Boolean)
    .sort();

const PROVIDERS: Record<string, ProviderDef> = {
  gemini: {
    label:          "Gemini (Google)",
    keyRequired:    true,
    keyPlaceholder: "AIza…",
    defaultUrl:     "https://generativelanguage.googleapis.com/v1beta",
    defaultModel:   "gemini-2.0-flash",
    pdfmuxId:       "gemini",
    healthUrl:      (_, k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
    healthHeaders:  ()     => ({}),
    modelsUrl:      (_, k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
    modelsHeaders:  ()     => ({}),
    parseModels: (json) => {
      const models = ((json as Record<string, unknown>)?.models as {name:string; supportedGenerationMethods?:string[]}[] ?? []);
      return models
        .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
        .map(m => m.name.replace(/^models\//, ""))
        .sort();
    },
  },
  claude: {
    label:          "Claude (Anthropic)",
    keyRequired:    true,
    keyPlaceholder: "sk-ant-…",
    defaultUrl:     "https://api.anthropic.com",
    defaultModel:   "claude-3-5-haiku-20241022",
    pdfmuxId:       "claude",
    healthUrl:      () => "https://api.anthropic.com/v1/models",
    healthHeaders:  (_, k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    modelsUrl:      () => "https://api.anthropic.com/v1/models",
    modelsHeaders:  (_, k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    parseModels:    openAiParseModels,
  },
  openai: {
    label:          "OpenAI / GPT-4o",
    keyRequired:    true,
    keyPlaceholder: "sk-…",
    defaultUrl:     "https://api.openai.com/v1",
    defaultModel:   "gpt-4o-mini",
    pdfmuxId:       "openai",
    healthUrl:      (b) => `${b}/models`,
    healthHeaders:  (_, k) => ({ Authorization: `Bearer ${k}` }),
    modelsUrl:      (b) => `${b}/models`,
    modelsHeaders:  (_, k) => ({ Authorization: `Bearer ${k}` }),
    parseModels:    openAiParseModels,
  },
  zai: {
    label:          "Z AI (GLM)",
    keyRequired:    true,
    keyPlaceholder: "your Z.AI API key",
    defaultUrl:     "https://api.z.ai/api/coding/paas/v4",
    defaultModel:   "glm-5.1",
    pdfmuxId:       "openai",   // OpenAI-compatible
    healthUrl:      (b) => `${b}/models`,
    healthHeaders:  (_, k) => ({ Authorization: `Bearer ${k}` }),
    modelsUrl:      (b) => `${b}/models`,
    modelsHeaders:  (_, k) => ({ Authorization: `Bearer ${k}` }),
    parseModels:    openAiParseModels,
  },
  lmstudio: {
    label:          "LM Studio (local)",
    keyRequired:    false,
    keyPlaceholder: "lm-studio (any string works)",
    defaultUrl:     "http://localhost:1234/v1",
    defaultModel:   "",
    pdfmuxId:       "openai",
    healthUrl:      (b) => `${b}/models`,
    healthHeaders:  () => ({}),
    modelsUrl:      (b) => `${b}/models`,
    modelsHeaders:  () => ({}),
    parseModels:    openAiParseModels,
  },
  ollama: {
    label:          "Ollama (local)",
    keyRequired:    false,
    keyPlaceholder: "— not needed —",
    defaultUrl:     "http://localhost:11434",
    defaultModel:   "",
    pdfmuxId:       "ollama",
    healthUrl:      (b) => `${b}/api/tags`,
    healthHeaders:  () => ({}),
    modelsUrl:      (b) => `${b}/api/tags`,
    modelsHeaders:  () => ({}),
    parseModels: (json) =>
      ((json as Record<string, unknown>)?.models as {name:string}[] ?? [])
        .map(m => m.name)
        .filter(Boolean)
        .sort(),
  },
  anythingllm: {
    label:          "AnythingLLM (local)",
    keyRequired:    true,
    keyPlaceholder: "workspace API token",
    defaultUrl:     "http://localhost:3001/api/v1",
    defaultModel:   "",
    pdfmuxId:       "openai",
    healthUrl:      (b) => `${b}/auth`,
    healthHeaders:  (_, k) => ({ Authorization: `Bearer ${k}` }),
    modelsUrl:      (b) => `${b}/openai/models`,
    modelsHeaders:  (_, k) => ({ Authorization: `Bearer ${k}` }),
    parseModels:    openAiParseModels,
  },
};

// ── network helpers ───────────────────────────────────────────────────────────

async function probeEndpoint(
  url: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(6000),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

async function fetchModels(
  def: ProviderDef,
  baseUrl: string,
  apiKey:  string
): Promise<string[]> {
  const url     = def.modelsUrl(baseUrl, apiKey);
  const headers = def.modelsHeaders(baseUrl, apiKey);
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const json = await resp.json();
    return def.parseModels(json);
  } catch {
    return [];
  }
}

// ── plugin ────────────────────────────────────────────────────────────────────

export default class PdfMuxPlugin extends Plugin {
  settings!: PdfMuxSettings;

  async onload() {
    await this.loadSettings();

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

  // ── conversion ───────────────────────────────────────────────────────────

  private convertActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file)                    { new Notice("No file open."); return; }
    if (file.extension !== "pdf") { new Notice("Active file is not a PDF."); return; }
    this.convertFile(file);
  }

  private convertFile(file: TFile) {
    this.runConversion(path.join(this.vaultRoot(), file.path));
  }

  private runConversion(pdfPath: string) {
    const script = this.scriptPath();
    if (!script) {
      new Notice("pdfmux4obsidian.py not found.\nPut it in: .obsidian/plugins/pdfmux4obsidian/");
      return;
    }

    const outFolder = path.join(this.vaultRoot(), this.settings.outputFolder);
    fs.mkdirSync(outFolder, { recursive: true });

    const args   = this.buildArgs(script, pdfPath, outFolder);
    const env    = this.buildEnv();
    const notice = new Notice(`⏳ Converting ${path.basename(pdfPath)}…`, 0);

    execFile(this.settings.pythonPath, args, { env }, (_err, _stdout, stderr) => {
      notice.hide();
      if (_err) {
        console.error("[pdfmux4obsidian]", stderr);
        new Notice(`❌ Conversion failed\n${stderr.slice(0, 300)}\n\nSee console (Ctrl+Shift+I)`);
        return;
      }
      const stem     = path.basename(pdfPath, path.extname(pdfPath))
                           .replace(/[\\/:*?"<>|]/g, "-").trim();
      const notePath = normalizePath(`${this.settings.outputFolder}/${stem}.md`);
      new Notice(`✅ Done — ${stem}.md`);
      if (this.settings.openAfterConvert) {
        setTimeout(() => {
          const f = this.app.vault.getAbstractFileByPath(notePath);
          if (f instanceof TFile) this.app.workspace.getLeaf().openFile(f);
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

  buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const p   = this.settings.llmProvider;
    const key = this.settings.apiKey;
    const url = this.effectiveBaseUrl();
    const mdl = this.settings.llmModel;

    switch (p) {
      case "gemini":
        if (key) env["GEMINI_API_KEY"] = key;
        break;
      case "claude":
        if (key) env["ANTHROPIC_API_KEY"] = key;
        break;
      case "openai":
        if (key) env["OPENAI_API_KEY"] = key;
        if (url) env["OPENAI_BASE_URL"] = url;
        break;
      case "zai":
        if (key) env["OPENAI_API_KEY"]  = key;
        env["OPENAI_BASE_URL"] = url;
        break;
      case "lmstudio":
        env["OPENAI_API_KEY"]  = key || "lm-studio";
        env["OPENAI_BASE_URL"] = url;
        break;
      case "ollama":
        env["OPENAI_API_KEY"]  = "ollama";
        env["OPENAI_BASE_URL"] = `${url}/v1`;
        break;
      case "anythingllm":
        if (key) env["OPENAI_API_KEY"]  = key;
        env["OPENAI_BASE_URL"] = url;
        break;
    }

    if (mdl && p) env["OPENAI_MODEL"] = mdl;
    return env;
  }

  effectiveBaseUrl(): string {
    if (this.settings.llmBaseUrl.trim()) return this.settings.llmBaseUrl.trim();
    const def = PROVIDERS[this.settings.llmProvider];
    return def?.defaultUrl ?? "";
  }

  private vaultRoot(): string {
    const a = this.app.vault.adapter;
    if (a instanceof FileSystemAdapter) return a.getBasePath();
    throw new Error("pdfmux4obsidian: not a FileSystemAdapter");
  }

  private scriptPath(): string | null {
    const c = path.join(this.vaultRoot(), ".obsidian", "plugins", "pdfmux4obsidian", "pdfmux4obsidian.py");
    return fs.existsSync(c) ? c : null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ── settings tab ─────────────────────────────────────────────────────────────

type ConnStatus = "idle" | "loading" | "ok" | "fail";

class PdfMuxSettingTab extends PluginSettingTab {
  plugin:      PdfMuxPlugin;
  private _connStatus: ConnStatus = "idle";
  private _connMsg:    string     = "";
  private _models:     string[]   = [];
  private _modLoading: boolean    = false;

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

    // ── core ──────────────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName("Python executable")
      .setDesc("python3, python, or absolute path — e.g. /home/you/.venv/bin/python")
      .addText(t => t.setPlaceholder("python3").setValue(this.plugin.settings.pythonPath)
        .onChange(async v => { this.plugin.settings.pythonPath = v.trim() || "python3"; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Vault subfolder for converted notes — auto-created if missing")
      .addText(t => t.setPlaceholder("PDFs").setValue(this.plugin.settings.outputFolder)
        .onChange(async v => { this.plugin.settings.outputFolder = v.trim() || "PDFs"; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Extraction quality")
      .setDesc("fast = digital PDFs  ·  standard = most docs  ·  high = scans, tables, mixed layouts")
      .addDropdown(d => d
        .addOption("fast",     "fast")
        .addOption("standard", "standard")
        .addOption("high",     "high")
        .setValue(this.plugin.settings.quality)
        .onChange(async v => { this.plugin.settings.quality = v as PdfMuxSettings["quality"]; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Default schema")
      .setDesc("Structured extraction preset — blank = plain text")
      .addDropdown(d => d
        .addOption("",         "none (plain text)")
        .addOption("invoice",  "invoice")
        .addOption("receipt",  "receipt")
        .addOption("contract", "contract")
        .addOption("resume",   "resume")
        .addOption("paper",    "paper")
        .setValue(this.plugin.settings.schema)
        .onChange(async v => { this.plugin.settings.schema = v as PdfMuxSettings["schema"]; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Chunk size (tokens)")
      .setDesc("RAG-ready chunks. 0 = off.")
      .addText(t => t.setPlaceholder("0").setValue(String(this.plugin.settings.chunkTokens))
        .onChange(async v => { this.plugin.settings.chunkTokens = parseInt(v) || 0; await this.plugin.saveSettings(); }));

    // ── LLM section ───────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "LLM fallback (optional)" });
    containerEl.createEl("p", {
      text: "Kicks in only at quality = high, on pages that rule-based extraction fails. Requires: pip install 'pdfmux[llm]'",
      cls:  "setting-item-description",
    });

    // provider dropdown — changing it resets state and redraws
    new Setting(containerEl)
      .setName("Provider")
      .addDropdown(d => {
        d.addOption("", "— none —");
        for (const [id, def] of Object.entries(PROVIDERS)) d.addOption(id, def.label);
        d.setValue(this.plugin.settings.llmProvider)
          .onChange(async v => {
            this.plugin.settings.llmProvider = v as LlmProvider;
            // auto-fill base URL default; clear model
            this.plugin.settings.llmBaseUrl = "";
            this.plugin.settings.llmModel   = "";
            this._connStatus = "idle";
            this._models     = [];
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const prov = this.plugin.settings.llmProvider;
    if (!prov) return this._renderBehaviour(containerEl);

    const def = PROVIDERS[prov];

    // API key — only if required (or always for non-local)
    if (def.keyRequired) {
      const keySetting = new Setting(containerEl)
        .setName("API key")
        .setDesc("Stored in Obsidian's data.json — only sent to this provider during conversion.")
        .addText(t => {
          t.inputEl.type = "password";
          t.setPlaceholder(def.keyPlaceholder)
            .setValue(this.plugin.settings.apiKey)
            .onChange(async v => {
              this.plugin.settings.apiKey = v;
              this._connStatus = "idle";
              await this.plugin.saveSettings();
            });
        });

      // connection test button + status badge
      const badge = keySetting.controlEl.createEl("span");
      badge.style.cssText = "margin-left:8px;font-size:12px;";
      badge.setText(this._connBadge());

      keySetting.addButton(btn => {
        btn.setButtonText(this._connStatus === "loading" ? "Testing…" : "Test")
          .setDisabled(this._connStatus === "loading")
          .onClick(async () => {
            this._connStatus = "loading";
            this.display();
            const baseUrl = this.plugin.effectiveBaseUrl();
            const result  = await probeEndpoint(
              def.healthUrl(baseUrl, this.plugin.settings.apiKey),
              def.healthHeaders(baseUrl, this.plugin.settings.apiKey)
            );
            this._connStatus = result.ok ? "ok" : "fail";
            this._connMsg    = result.ok
              ? `HTTP ${result.status}`
              : result.error ?? `HTTP ${result.status}`;
            this.display();
          });
      });
    }

    // base URL — editable, shows provider default as placeholder
    if (prov !== "gemini" && prov !== "claude") {
      new Setting(containerEl)
        .setName("Base URL")
        .setDesc(`Default: ${def.defaultUrl}`)
        .addText(t => t
          .setPlaceholder(def.defaultUrl)
          .setValue(this.plugin.settings.llmBaseUrl)
          .onChange(async v => {
            this.plugin.settings.llmBaseUrl = v.trim();
            this._connStatus = "idle";
            await this.plugin.saveSettings();
          }));
    }

    // model picker
    this._renderModelPicker(containerEl, def);

    this._renderBehaviour(containerEl);
  }

  // ── model picker ─────────────────────────────────────────────────────────

  private _renderModelPicker(containerEl: HTMLElement, def: ProviderDef): void {
    const modelSetting = new Setting(containerEl).setName("Model");

    if (this._models.length > 0) {
      // dropdown populated from API
      modelSetting.setDesc("Fetched from provider — select one");
      modelSetting.addDropdown(d => {
        if (!this.plugin.settings.llmModel) d.addOption("", "— select —");
        for (const m of this._models) d.addOption(m, m);
        d.setValue(this.plugin.settings.llmModel)
          .onChange(async v => { this.plugin.settings.llmModel = v; await this.plugin.saveSettings(); });
      });
    } else {
      // free-text fallback
      const placeholder = def.defaultModel || "e.g. " + (def.label.includes("GLM") ? "glm-5.1" : "llama3");
      modelSetting.setDesc("Type a model name, or click ↺ to load available models from the provider");
      modelSetting.addText(t => t
        .setPlaceholder(placeholder)
        .setValue(this.plugin.settings.llmModel)
        .onChange(async v => { this.plugin.settings.llmModel = v.trim(); await this.plugin.saveSettings(); }));
    }

    modelSetting.addButton(btn => {
      btn.setIcon("refresh-cw")
        .setTooltip("Load models from provider")
        .setDisabled(this._modLoading)
        .onClick(async () => {
          this._modLoading = true;
          this.display();
          const base   = this.plugin.effectiveBaseUrl();
          const models = await fetchModels(def, base, this.plugin.settings.apiKey);
          this._models     = models;
          this._modLoading = false;
          if (models.length === 0) {
            new Notice("No models returned — check your connection and API key.");
          } else if (models.length > 0 && !this.plugin.settings.llmModel) {
            // auto-select default model if nothing chosen
            const preferred = def.defaultModel;
            this.plugin.settings.llmModel = models.includes(preferred) ? preferred : models[0];
            await this.plugin.saveSettings();
          }
          this.display();
        });
    });
  }

  // ── behaviour section ─────────────────────────────────────────────────────

  private _renderBehaviour(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Behaviour" });

    new Setting(containerEl)
      .setName("Open note after conversion")
      .setDesc("Automatically switch to the new note when done")
      .addToggle(t => t.setValue(this.plugin.settings.openAfterConvert)
        .onChange(async v => { this.plugin.settings.openAfterConvert = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Overwrite existing notes")
      .setDesc("Re-convert and replace if the note already exists")
      .addToggle(t => t.setValue(this.plugin.settings.overwrite)
        .onChange(async v => { this.plugin.settings.overwrite = v; await this.plugin.saveSettings(); }));
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private _connBadge(): string {
    switch (this._connStatus) {
      case "ok":      return `✅ ${this._connMsg}`;
      case "fail":    return `❌ ${this._connMsg}`;
      case "loading": return "⏳";
      default:        return "";
    }
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
      text: "Enter full path — anywhere on disk, not just inside the vault.",
      cls:  "setting-item-description",
    });

    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = "~/Downloads/paper.pdf  or  /path/to/invoice.pdf";
    input.style.cssText = "width:100%;margin:12px 0 16px;padding:6px 10px;font-size:14px;border-radius:4px;border:1px solid var(--background-modifier-border);";
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(input.value); });

    const row = contentEl.createDiv();
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    row.createEl("button", { text: "Convert", cls: "mod-cta" }).addEventListener("click", () => this.submit(input.value));

    setTimeout(() => input.focus(), 50);
  }

  private submit(raw: string) {
    const val = raw.trim().replace(/^~/, process.env.HOME ?? "~");
    if (!val) return;
    this.close();
    this.onSubmit(val);
  }

  onClose() { this.contentEl.empty(); }
}
