import "./style.css";
import { formatAgentBrief, formatHumanBrief } from "./brief";
import { diffAgainstRecommended, type DiffRow } from "./diff-conf";
import {
  buildExports,
  type ExportTab,
  type ManagedTarget,
} from "./export-formats";
import { detectLocale, t, type MessageKey } from "./i18n";
import { parsePostgresSettings } from "./parse-conf";
import { registerServiceWorker } from "./register-sw";
import { SITE_ORIGIN, type Locale } from "./site-config";
import {
  INSTANCE_PRESETS,
  applyPresetToInput,
  findPreset,
  type InstancePresetId,
} from "./presets";
import {
  STATS_COLLECT_SQL,
  analyzeStatsPaste,
  type StatsAnalysis,
} from "./stats";
import {
  DB_VERSIONS,
  DEFAULT_INPUT,
  clampPeakQueries,
  clampPgRamPercent,
  formatConf,
  formatMemoryKb,
  settingDocsUrl,
  settingExplanationKey,
  tune,
  type DbSize,
  type DbType,
  type DbVersion,
  type HdType,
  type MemoryUnit,
  type OsType,
  type PoolerMode,
  type ServerRole,
  type TuneInput,
  type TuneResult,
  type TuneWarning,
} from "./tune";

const APP_VERSION = "1.1.0";
const appVersionEl = document.getElementById("app-version");
if (appVersionEl) appVersionEl.textContent = APP_VERSION;

type AppState = {
  locale: Locale;
  input: TuneInput;
  result: TuneResult | null;
  exportTab: ExportTab;
  managed: ManagedTarget;
  presetId: InstancePresetId;
  stats: StatsAnalysis | null;
  diffRows: DiffRow[] | null;
  diffRiskIds: Array<{ id: string; params?: Record<string, string | number> }> | null;
};

const state: AppState = {
  locale: "ru",
  input: { ...DEFAULT_INPUT },
  result: null,
  exportTab: "conf",
  managed: "selfhosted",
  presetId: "custom",
  stats: null,
  diffRows: null,
  diffRiskIds: null,
};

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

function setStatus(message: string, isError = false): void {
  const el = byId<HTMLElement>("status");
  el.textContent = message;
  el.classList.toggle("is-error", isError);
}

function collectorCurl(): string {
  return `curl -fsSL ${SITE_ORIGIN}/collect.sh | bash -s -- ${state.locale}`;
}

function collectorPs(): string {
  return `$env:PGTUNE_LANG='${state.locale}'; irm ${SITE_ORIGIN}/collect.ps1 | iex`;
}

function refreshCollectorChrome(): void {
  const curlEl = document.getElementById("collector-curl");
  const psEl = document.getElementById("collector-ps");
  if (curlEl) curlEl.textContent = collectorCurl();
  if (psEl) psEl.textContent = collectorPs();
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function briefContext() {
  if (!state.result) return null;
  const input = readForm() ?? state.input;
  syncUrl(input);
  return {
    input,
    result: state.result,
    managed: state.managed,
    localePath: `/${state.locale}/`,
    shareUrl: window.location.href,
    exportTab: state.exportTab,
    confText: currentExportText(),
  };
}

function downloadBrief(kind: "human" | "agent"): void {
  const ctx = briefContext();
  if (!ctx) return;
  const text = kind === "human" ? formatHumanBrief(ctx) : formatAgentBrief(ctx);
  const name = kind === "human" ? "pgtune-brief-human.md" : "pgtune-brief-agent.md";
  downloadTextFile(name, text);
  setStatus(t(state.locale, "briefDownloaded"));
}

async function copyText(text: string, okKey: "copied" | "shareCopied" = "copied"): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(t(state.locale, okKey));
  } catch {
    setStatus(t(state.locale, "copyError"), true);
  }
}

function bindLangMenu(): void {
  const langRoot = document.querySelector<HTMLDetailsElement>(".lang");
  if (!langRoot) return;
  document.addEventListener("click", (event) => {
    if (!langRoot.open) return;
    const target = event.target;
    if (target instanceof Node && !langRoot.contains(target)) langRoot.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && langRoot.open) langRoot.open = false;
  });
}

function readForm(): TuneInput | null {
  const ram = Number(byId<HTMLInputElement>("ram").value);
  if (!Number.isFinite(ram) || ram <= 0) {
    setStatus(t(state.locale, "invalidRam"), true);
    return null;
  }
  const cpuRaw = byId<HTMLInputElement>("cpu").value.trim();
  let cpuNum: number | null = null;
  if (cpuRaw) {
    cpuNum = Number(cpuRaw);
    if (!Number.isFinite(cpuNum) || cpuNum < 1 || !Number.isInteger(cpuNum)) {
      setStatus(t(state.locale, "invalidCpu"), true);
      return null;
    }
  }
  const connRaw = byId<HTMLInputElement>("connections").value.trim();
  let connectionNum: number | null = null;
  if (connRaw) {
    connectionNum = Number(connRaw);
    if (
      !Number.isFinite(connectionNum) ||
      connectionNum < 1 ||
      !Number.isInteger(connectionNum)
    ) {
      setStatus(t(state.locale, "invalidConnections"), true);
      return null;
    }
  }
  return {
    dbVersion: Number(byId<HTMLSelectElement>("db-version").value) as DbVersion,
    osType: byId<HTMLSelectElement>("os-type").value as OsType,
    dbType: byId<HTMLSelectElement>("db-type").value as DbType,
    totalMemory: ram,
    totalMemoryUnit: byId<HTMLSelectElement>("ram-unit").value as MemoryUnit,
    pgRamPercent: clampPgRamPercent(
      Number(byId<HTMLInputElement>("pg-ram-percent").value),
    ),
    serverRole: byId<HTMLSelectElement>("server-role").value as ServerRole,
    peakComplexQueries: clampPeakQueries(
      Number(byId<HTMLInputElement>("peak-queries").value),
    ),
    poolerMode: byId<HTMLSelectElement>("pooler-mode").value as PoolerMode,
    cpuNum,
    connectionNum,
    hdType: byId<HTMLSelectElement>("hd-type").value as HdType,
    dbSize: byId<HTMLSelectElement>("db-size").value as DbSize,
    workMemScale: state.input.workMemScale,
    maxWalScale: state.input.maxWalScale,
    sharedBuffersScale: state.input.sharedBuffersScale,
  };
}

function syncRangeOutputs(): void {
  byId("pg-ram-percent-out").textContent =
    `${byId<HTMLInputElement>("pg-ram-percent").value}%`;
  byId("peak-queries-out").textContent =
    byId<HTMLInputElement>("peak-queries").value;
}

function writeForm(input: TuneInput): void {
  byId<HTMLSelectElement>("db-version").value = String(input.dbVersion);
  byId<HTMLSelectElement>("os-type").value = input.osType;
  byId<HTMLSelectElement>("db-type").value = input.dbType;
  byId<HTMLInputElement>("ram").value = String(input.totalMemory);
  byId<HTMLSelectElement>("ram-unit").value = input.totalMemoryUnit;
  byId<HTMLInputElement>("pg-ram-percent").value = String(
    clampPgRamPercent(input.pgRamPercent ?? 100),
  );
  byId<HTMLSelectElement>("server-role").value = input.serverRole ?? "standalone";
  byId<HTMLInputElement>("peak-queries").value = String(
    clampPeakQueries(input.peakComplexQueries ?? 2),
  );
  byId<HTMLSelectElement>("pooler-mode").value = input.poolerMode ?? "none";
  byId<HTMLSelectElement>("instance-preset").value = state.presetId;
  byId<HTMLInputElement>("cpu").value = input.cpuNum ? String(input.cpuNum) : "";
  byId<HTMLInputElement>("connections").value = input.connectionNum
    ? String(input.connectionNum)
    : "";
  byId<HTMLSelectElement>("hd-type").value = input.hdType;
  byId<HTMLSelectElement>("db-size").value = input.dbSize;
  syncRangeOutputs();
}

function syncUrl(input: TuneInput): void {
  const p = new URLSearchParams();
  p.set("v", String(input.dbVersion));
  p.set("os", input.osType);
  p.set("db", input.dbType);
  p.set("ram", String(input.totalMemory));
  p.set("unit", input.totalMemoryUnit);
  if (input.cpuNum) p.set("cpu", String(input.cpuNum));
  if (input.connectionNum) p.set("conn", String(input.connectionNum));
  p.set("hd", input.hdType);
  p.set("size", input.dbSize);
  if (input.pgRamPercent !== 100) p.set("pgp", String(input.pgRamPercent));
  if (input.serverRole !== "standalone") p.set("role", input.serverRole);
  if (input.peakComplexQueries !== 2) p.set("peak", String(input.peakComplexQueries));
  if (input.poolerMode && input.poolerMode !== "none") p.set("pool", input.poolerMode);
  if (state.presetId !== "custom") p.set("preset", state.presetId);
  if (state.managed !== "selfhosted") p.set("plat", state.managed);
  if (state.exportTab !== "conf") p.set("out", state.exportTab);
  const qs = p.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

function parseUrl(): Partial<TuneInput> | null {
  const p = new URLSearchParams(window.location.search);
  if (![...p.keys()].length) return null;
  const out: Partial<TuneInput> = {};
  const v = Number(p.get("v"));
  if (DB_VERSIONS.includes(v as DbVersion)) out.dbVersion = v as DbVersion;
  const os = p.get("os");
  if (os === "linux" || os === "windows" || os === "mac") out.osType = os;
  const db = p.get("db");
  if (db === "web" || db === "oltp" || db === "dw" || db === "desktop" || db === "mixed") {
    out.dbType = db;
  }
  const ram = Number(p.get("ram"));
  if (Number.isFinite(ram) && ram > 0) out.totalMemory = ram;
  const unit = p.get("unit");
  if (unit === "MB" || unit === "GB" || unit === "TB") out.totalMemoryUnit = unit;
  const cpu = p.get("cpu");
  if (cpu) {
    const n = Number(cpu);
    if (Number.isInteger(n) && n >= 1) out.cpuNum = n;
  }
  const conn = p.get("conn");
  if (conn) {
    const n = Number(conn);
    if (Number.isInteger(n) && n >= 1) out.connectionNum = n;
  }
  const hd = p.get("hd");
  if (hd === "ssd" || hd === "hdd" || hd === "san" || hd === "nvme") out.hdType = hd;
  const size = p.get("size");
  if (size === "less_ram" || size === "mid_ram" || size === "greater_ram") out.dbSize = size;
  const pgp = Number(p.get("pgp"));
  if (Number.isFinite(pgp)) out.pgRamPercent = clampPgRamPercent(pgp);
  const role = p.get("role");
  if (
    role === "standalone" ||
    role === "primary" ||
    role === "replica" ||
    role === "primary_cdc" ||
    role === "primary_pitr"
  ) {
    out.serverRole = role;
  }
  const peak = Number(p.get("peak"));
  if (Number.isFinite(peak)) out.peakComplexQueries = clampPeakQueries(peak);
  const pool = p.get("pool");
  if (pool === "none" || pool === "transaction" || pool === "session") {
    out.poolerMode = pool;
  }
  const preset = p.get("preset");
  if (preset && findPreset(preset)) {
    state.presetId = preset as InstancePresetId;
  }
  const plat = p.get("plat");
  if (
    plat === "selfhosted" ||
    plat === "rds" ||
    plat === "aurora" ||
    plat === "cloudsql" ||
    plat === "azure" ||
    plat === "yandex"
  ) {
    state.managed = plat;
  }
  const outTab = p.get("out");
  if (
    outTab === "conf" ||
    outTab === "alter" ||
    outTab === "docker" ||
    outTab === "compose" ||
    outTab === "helm" ||
    outTab === "migrate" ||
    outTab === "patroni" ||
    outTab === "ansible"
  ) {
    state.exportTab = outTab;
  }
  return out;
}

function warnLevelTitle(level: TuneWarning["level"]): string {
  if (level === "startup") return t(state.locale, "warnLevelStartup");
  if (level === "memory") return t(state.locale, "warnLevelMemory");
  return t(state.locale, "warnLevelNote");
}

function renderWarningText(w: TuneWarning): string {
  const key = w.id as MessageKey;
  const template = t(state.locale, key);
  return w.params ? format(template, w.params) : template;
}

function currentExportText(): string {
  if (!state.result) return "";
  const bundle = buildExports(state.result.settings, state.result.confText, state.managed);
  if (state.exportTab === "alter") return bundle.alterSystem;
  if (state.exportTab === "docker") return bundle.dockerRunSnippet;
  if (state.exportTab === "compose") return bundle.composeYaml;
  if (state.exportTab === "helm") return bundle.helmYaml;
  if (state.exportTab === "migrate") return bundle.migrateSql;
  if (state.exportTab === "patroni") return bundle.patroniYaml;
  if (state.exportTab === "ansible") return bundle.ansibleYaml;
  return bundle.conf;
}

function exportTitleKey(): MessageKey {
  if (state.exportTab === "alter") return "tabAlter";
  if (state.exportTab === "docker") return "tabDocker";
  if (state.exportTab === "compose") return "tabCompose";
  if (state.exportTab === "helm") return "tabHelm";
  if (state.exportTab === "migrate") return "tabMigrate";
  if (state.exportTab === "patroni") return "tabPatroni";
  if (state.exportTab === "ansible") return "tabAnsible";
  return "confTitle";
}

function renderExportChrome(): void {
  document.querySelectorAll<HTMLButtonElement>(".export-tabs .tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.export === state.exportTab);
  });
  byId("export-title").textContent = t(state.locale, exportTitleKey());
  byId<HTMLSelectElement>("managed-target").value = state.managed;

  if (!state.result) return;
  const bundle = buildExports(state.result.settings, state.result.confText, state.managed);
  byId("conf-out").textContent = currentExportText();
  byId("managed-note").textContent = t(state.locale, bundle.managedNoteId as MessageKey);
  const skipped = byId<HTMLElement>("managed-skipped");
  if (bundle.managedSkipped.length === 0) {
    skipped.hidden = true;
    skipped.textContent = "";
  } else {
    skipped.hidden = false;
    skipped.textContent = format(t(state.locale, "managedSkippedList"), {
      keys: bundle.managedSkipped.map((s) => s.key).join(", "),
    });
  }
}

function renderDiff(): void {
  const block = byId<HTMLElement>("diff-block");
  if (!state.diffRows || !state.result) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  const same = state.diffRows.filter((r) => r.kind === "same").length;
  const changed = state.diffRows.filter((r) => r.kind === "changed").length;
  const missing = state.diffRows.filter((r) => r.kind === "missing").length;
  const extra = state.diffRows.filter((r) => r.kind === "extra").length;
  byId("diff-summary").textContent = format(t(state.locale, "diffSummary"), {
    same,
    changed,
    missing,
    extra,
  });

  const risksEl = byId<HTMLElement>("diff-risks");
  risksEl.replaceChildren();
  for (const risk of state.diffRiskIds ?? []) {
    const p = document.createElement("p");
    p.textContent = format(t(state.locale, risk.id as MessageKey), risk.params ?? {});
    risksEl.append(p);
  }

  const list = byId<HTMLElement>("diff-list");
  list.replaceChildren();
  const interesting = state.diffRows.filter((r) => r.kind !== "same" || false);
  const show = interesting.length > 0 ? interesting : state.diffRows.slice(0, 12);
  for (const row of show) {
    if (row.kind === "same" && interesting.length > 0) continue;
    const item = document.createElement("article");
    item.className = `why-item diff-${row.kind}`;
    const head = document.createElement("div");
    head.className = "why-head";
    const name = document.createElement("code");
    name.textContent = row.key;
    const badge = document.createElement("span");
    badge.className = "restart-badge";
    badge.textContent = t(state.locale, `diffKind_${row.kind}` as MessageKey);
    head.append(name, badge);
    const body = document.createElement("p");
    if (row.kind === "missing") {
      body.textContent = format(t(state.locale, "diffMissingLine"), {
        recommended: row.recommended ?? "",
      });
    } else if (row.kind === "changed") {
      body.textContent = format(t(state.locale, "diffChangedLine"), {
        current: row.current ?? "",
        recommended: row.recommended ?? "",
      });
    } else if (row.kind === "extra") {
      body.textContent = format(t(state.locale, "diffExtraLine"), {
        current: row.current ?? "",
      });
    } else {
      body.textContent = format(t(state.locale, "diffSameLine"), {
        value: row.current ?? "",
      });
    }
    item.append(head, body);
    list.append(item);
  }
}

function renderStatsHints(): void {
  const box = byId<HTMLElement>("stats-hints");
  if (!state.stats) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = t(state.locale, "statsHintsTitle");
  box.append(title);
  for (const hint of state.stats.hints) {
    const p = document.createElement("p");
    p.textContent = format(t(state.locale, hint.id as MessageKey), hint.params ?? {});
    box.append(p);
  }
}

function renderBudget(result: TuneResult): void {
  const block = byId<HTMLElement>("budget-block");
  block.hidden = false;
  const b = result.budget;
  const total = Math.max(b.pgRamKb, 1);
  const pct = (kb: number) => Math.max(0, Math.min(100, (kb / total) * 100));
  byId<HTMLElement>("budget-shared").style.width = `${pct(b.sharedBuffersKb)}%`;
  byId<HTMLElement>("budget-maint").style.width = `${pct(b.maintenanceWorkMemKb)}%`;
  byId<HTMLElement>("budget-conn").style.width = `${pct(b.connectionsWorkMemKb)}%`;
  byId<HTMLElement>("budget-os").style.width = `${pct(b.osCacheKb)}%`;
  byId("budget-lead").textContent = format(t(state.locale, "budgetLead"), {
    host: formatMemoryKb(b.hostRamKb),
    pg: formatMemoryKb(b.pgRamKb),
  });
  const legend = byId<HTMLElement>("budget-legend");
  legend.replaceChildren();
  const rows: Array<[string, string, number]> = [
    ["budgetShared", "budget-shared", b.sharedBuffersKb],
    ["budgetMaint", "budget-maint", b.maintenanceWorkMemKb],
    ["budgetConn", "budget-conn", b.connectionsWorkMemKb],
    ["budgetOs", "budget-os", b.osCacheKb],
  ];
  for (const [key, cls, kb] of rows) {
    const li = document.createElement("li");
    li.className = cls;
    li.textContent = format(t(state.locale, key as MessageKey), {
      value: formatMemoryKb(kb),
      peak: b.peakFactor,
    });
    legend.append(li);
  }
  const hp = byId<HTMLElement>("hugepages-sysctl");
  if (result.hugePagesSysctl) {
    hp.hidden = false;
    hp.textContent = format(t(state.locale, "hugePagesSysctlLead"), {
      line: result.hugePagesSysctl,
    });
  } else {
    hp.hidden = true;
    hp.textContent = "";
  }
}

function renderResult(result: TuneResult, input: TuneInput): void {
  const box = byId<HTMLElement>("result");
  box.hidden = false;

  const assumed = byId<HTMLElement>("assumed");
  if (!input.connectionNum) {
    assumed.textContent = format(t(state.locale, "assumedConnections"), {
      n: result.assumedConnections,
    });
  } else {
    assumed.textContent = "";
  }

  const warningsEl = byId<HTMLElement>("warnings");
  warningsEl.replaceChildren();
  if (result.warnings.length === 0) {
    warningsEl.hidden = true;
  } else {
    warningsEl.hidden = false;
    const title = document.createElement("h3");
    title.textContent = t(state.locale, "warningsTitle");
    warningsEl.append(title);
    for (const w of result.warnings) {
      const card = document.createElement("div");
      card.className = `warn-card warn-${w.level}`;
      const level = document.createElement("div");
      level.className = "warn-level";
      level.textContent = warnLevelTitle(w.level);
      const body = document.createElement("p");
      body.textContent = renderWarningText(w);
      card.append(level, body);
      if (w.code) {
        const code = document.createElement("pre");
        code.textContent = w.code;
        card.append(code);
      }
      warningsEl.append(card);
    }
  }

  renderBudget(result);
  renderExportChrome();
  renderDiff();

  const why = byId<HTMLElement>("why-list");
  why.replaceChildren();
  for (const s of result.settings) {
    const item = document.createElement("article");
    item.className = "why-item";
    const head = document.createElement("div");
    head.className = "why-head";
    const name = document.createElement("code");
    name.textContent = s.key;
    head.append(name);
    if (s.restart) {
      const badge = document.createElement("span");
      badge.className = "restart-badge";
      badge.textContent = t(state.locale, "restartBadge");
      head.append(badge);
    }
    const val = document.createElement("div");
    val.className = "why-value";
    val.textContent = formatConf([s]).split(" = ")[1] ?? String(s.value);
    const expl = document.createElement("p");
    const whyKey = settingExplanationKey(s.key) as MessageKey;
    expl.textContent = t(state.locale, whyKey);
    const docs = document.createElement("a");
    docs.className = "docs-link";
    docs.href = settingDocsUrl(input.dbVersion, s.key);
    docs.target = "_blank";
    docs.rel = "noopener noreferrer";
    docs.textContent = t(state.locale, "docsLink");
    item.append(head, val, expl, docs);
    why.append(item);
  }
}

function generate(): void {
  const input = readForm();
  if (!input) return;
  state.input = input;
  state.result = tune(input);
  syncUrl(input);
  const paste = byId<HTMLTextAreaElement>("current-paste").value.trim();
  if (paste) {
    analyzeCurrent(false);
  } else {
    state.diffRows = null;
    state.diffRiskIds = null;
  }
  renderResult(state.result, input);
  setStatus(t(state.locale, "statusIdle"));
}

function analyzeCurrent(showStatus: boolean): void {
  if (!state.result) {
    const input = readForm();
    if (!input) return;
    state.input = input;
    state.result = tune(input);
  }
  const paste = byId<HTMLTextAreaElement>("current-paste").value.trim();
  if (!paste) {
    if (showStatus) setStatus(t(state.locale, "currentEmpty"), true);
    return;
  }
  const parsed = parsePostgresSettings(paste);
  if (Object.keys(parsed).length === 0) {
    if (showStatus) setStatus(t(state.locale, "currentParseError"), true);
    return;
  }
  const diff = diffAgainstRecommended(parsed, state.result!.settings);
  state.diffRows = diff.rows;
  state.diffRiskIds = diff.risks;
  renderResult(state.result!, state.input);
  if (showStatus) setStatus(t(state.locale, "currentAnalyzed"));
}

function applyStats(): void {
  const paste = byId<HTMLTextAreaElement>("stats-paste").value.trim();
  if (!paste) {
    setStatus(t(state.locale, "statsEmpty"), true);
    return;
  }
  const analysis = analyzeStatsPaste(paste);
  if (!analysis) {
    setStatus(t(state.locale, "statsParseError"), true);
    return;
  }
  state.stats = analysis;
  state.input = { ...state.input, ...analysis.patch };
  writeForm(state.input);
  renderStatsHints();
  generate();
  setStatus(t(state.locale, "statsApplied"));
}

function clearAll(): void {
  state.input = { ...DEFAULT_INPUT };
  state.result = null;
  state.stats = null;
  state.diffRows = null;
  state.diffRiskIds = null;
  state.exportTab = "conf";
  state.managed = "selfhosted";
  state.presetId = "custom";
  writeForm(state.input);
  byId<HTMLTextAreaElement>("stats-paste").value = "";
  byId<HTMLTextAreaElement>("current-paste").value = "";
  byId<HTMLElement>("result").hidden = true;
  byId<HTMLElement>("budget-block").hidden = true;
  renderStatsHints();
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  setStatus("");
}

function fillVersionSelect(): void {
  const sel = byId<HTMLSelectElement>("db-version");
  sel.replaceChildren();
  for (const v of DB_VERSIONS) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = String(v);
    sel.append(opt);
  }
}

function fillPresetSelect(): void {
  const sel = byId<HTMLSelectElement>("instance-preset");
  sel.replaceChildren();
  for (const preset of INSTANCE_PRESETS) {
    const opt = document.createElement("option");
    opt.value = preset.id;
    opt.dataset.i18n = preset.labelKey;
    opt.textContent = t(state.locale, preset.labelKey as MessageKey);
    sel.append(opt);
  }
  sel.value = state.presetId;
}

function applySelectedPreset(): void {
  const id = byId<HTMLSelectElement>("instance-preset").value as InstancePresetId;
  const preset = findPreset(id);
  if (!preset) return;
  state.presetId = id;
  if (id === "custom") {
    generate();
    return;
  }
  state.input = applyPresetToInput(state.input, preset);
  state.managed = preset.managed;
  writeForm(state.input);
  byId<HTMLSelectElement>("managed-target").value = state.managed;
  generate();
}

function applyChrome(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n as MessageKey | undefined;
    if (key) el.textContent = t(state.locale, key);
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder as MessageKey | undefined;
    if (key) el.placeholder = t(state.locale, key);
  });
  fillPresetSelect();
  byId("stats-sql").textContent = STATS_COLLECT_SQL;
  refreshCollectorChrome();
}

function init(): void {
  state.locale = detectLocale();
  fillVersionSelect();
  fillPresetSelect();
  const fromUrl = parseUrl();
  state.input = { ...DEFAULT_INPUT, ...fromUrl };
  if (state.presetId !== "custom") {
    const preset = findPreset(state.presetId);
    if (preset) {
      state.input = applyPresetToInput(state.input, preset);
      if (!fromUrl || !new URLSearchParams(window.location.search).has("plat")) {
        state.managed = preset.managed;
      }
    }
  }
  writeForm(state.input);
  applyChrome();
  bindLangMenu();

  byId("generate").addEventListener("click", generate);
  byId("clear").addEventListener("click", clearAll);
  byId("copy-conf").addEventListener("click", () => {
    void copyText(currentExportText());
  });
  byId("download-brief-human").addEventListener("click", () => downloadBrief("human"));
  byId("download-brief-agent").addEventListener("click", () => downloadBrief("agent"));
  byId("copy-collector-curl").addEventListener("click", () => {
    void copyText(collectorCurl());
  });
  byId("copy-collector-ps").addEventListener("click", () => {
    void copyText(collectorPs());
  });
  byId("copy-stats-sql").addEventListener("click", () => {
    void copyText(STATS_COLLECT_SQL);
  });
  byId("share").addEventListener("click", () => {
    const input = readForm() ?? state.input;
    syncUrl(input);
    void copyText(window.location.href, "shareCopied");
  });
  byId("apply-stats").addEventListener("click", applyStats);
  byId("analyze-current").addEventListener("click", () => analyzeCurrent(true));
  byId("managed-target").addEventListener("change", () => {
    state.managed = byId<HTMLSelectElement>("managed-target").value as ManagedTarget;
    if (state.result) {
      syncUrl(state.input);
      renderExportChrome();
    }
  });
  document.querySelectorAll<HTMLButtonElement>(".export-tabs .tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.export as ExportTab;
      state.exportTab = tab;
      if (state.result) {
        syncUrl(state.input);
        renderExportChrome();
      }
    });
  });

  byId("instance-preset").addEventListener("change", applySelectedPreset);
  for (const id of [
    "db-version",
    "os-type",
    "db-type",
    "ram",
    "ram-unit",
    "cpu",
    "connections",
    "hd-type",
    "db-size",
    "server-role",
    "pooler-mode",
  ]) {
    byId(id).addEventListener("change", () => {
      state.presetId = "custom";
      byId<HTMLSelectElement>("instance-preset").value = "custom";
      generate();
    });
  }
  for (const id of ["pg-ram-percent", "peak-queries"]) {
    byId(id).addEventListener("input", () => {
      syncRangeOutputs();
      generate();
    });
  }

  generate();
  registerServiceWorker();
}

init();
