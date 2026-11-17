import { normalizeSettingDisplay } from "./tune";

export type ParsedConf = Record<string, string>;

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

function parseConfLine(line: string): { key: string; value: string } | null {
  const cleaned = stripComment(line);
  if (!cleaned || cleaned.startsWith("[")) return null;
  const eq = cleaned.indexOf("=");
  if (eq <= 0) return null;
  const key = cleaned.slice(0, eq).trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(key)) return null;
  const value = normalizeSettingDisplay(cleaned.slice(eq + 1).trim());
  if (!value) return null;
  return { key, value };
}

function parseShowAllTable(text: string): ParsedConf {
  const out: ParsedConf = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || /^[-+|]+$/.test(line.trim()) || /^\s*name\s+/i.test(line)) continue;
    // psql aligned: name | setting | description
    if (line.includes("|")) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 2) {
        const key = parts[0].toLowerCase();
        if (/^[a-z_][a-z0-9_]*$/.test(key) && parts[1] !== "") {
          out[key] = normalizeSettingDisplay(parts[1]);
        }
      }
      continue;
    }
    // SHOW name; → name
    //                --------
    //                value
    const conf = parseConfLine(line);
    if (conf) out[conf.key] = conf.value;
  }
  return out;
}

export function parsePostgresSettings(text: string): ParsedConf {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.includes("|") || /^\s*name\s+/im.test(trimmed)) {
    const table = parseShowAllTable(trimmed);
    if (Object.keys(table).length > 0) return table;
  }
  const out: ParsedConf = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const conf = parseConfLine(line);
    if (conf) out[conf.key] = conf.value;
  }
  return out;
}

export function memoryToKb(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(v)) return Math.round(Number(v));
  const m = v.match(/^(-?\d+(?:\.\d+)?)\s*(kb|k|mb|m|gb|g|tb|t|b)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || "kb").toLowerCase();
  if (unit === "b") return Math.round(n / 1024);
  if (unit === "kb" || unit === "k") return Math.round(n);
  if (unit === "mb" || unit === "m") return Math.round(n * 1024);
  if (unit === "gb" || unit === "g") return Math.round(n * 1024 * 1024);
  if (unit === "tb" || unit === "t") return Math.round(n * 1024 * 1024 * 1024);
  return null;
}

export function valuesEqual(
  a: string,
  b: string,
  opts?: { isMemory?: boolean },
): boolean {
  const na = normalizeSettingDisplay(a).toLowerCase();
  const nb = normalizeSettingDisplay(b).toLowerCase();
  if (na === nb) return true;
  if (opts?.isMemory) {
    const ka = memoryToKb(na);
    const kb = memoryToKb(nb);
    if (ka !== null && kb !== null) return ka === kb;
  }
  const fa = Number(na);
  const fb = Number(nb);
  if (Number.isFinite(fa) && Number.isFinite(fb)) return Math.abs(fa - fb) < 1e-9;
  return false;
}
