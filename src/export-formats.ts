import { formatSettingValue, type TuneSetting } from "./tune";

export type ManagedTarget =
  | "selfhosted"
  | "rds"
  | "aurora"
  | "cloudsql"
  | "azure"
  | "yandex";

export type ExportTab =
  | "conf"
  | "alter"
  | "docker"
  | "compose"
  | "helm"
  | "migrate"
  | "patroni"
  | "ansible";

export type ExportBundle = {
  conf: string;
  alterSystem: string;
  dockerArgs: string;
  dockerRunSnippet: string;
  composeYaml: string;
  helmYaml: string;
  migrateSql: string;
  patroniYaml: string;
  ansibleYaml: string;
  managedNoteId: string;
  managedSkipped: Array<{ key: string; reasonId: string }>;
  managedSettings: TuneSetting[];
};

const MANAGED_BLOCKED: Record<
  Exclude<ManagedTarget, "selfhosted">,
  Set<string>
> = {
  rds: new Set([
    "shared_buffers",
    "wal_buffers",
    "max_wal_size",
    "min_wal_size",
    "listen_addresses",
    "port",
    "data_directory",
    "huge_pages",
    "io_method",
  ]),
  aurora: new Set([
    "shared_buffers",
    "wal_buffers",
    "max_wal_size",
    "min_wal_size",
    "listen_addresses",
    "port",
    "data_directory",
    "huge_pages",
    "io_method",
    "max_wal_senders",
    "wal_level",
  ]),
  cloudsql: new Set([
    "shared_buffers",
    "listen_addresses",
    "port",
    "data_directory",
    "huge_pages",
    "io_method",
  ]),
  azure: new Set([
    "shared_buffers",
    "listen_addresses",
    "port",
    "data_directory",
    "huge_pages",
    "io_method",
  ]),
  yandex: new Set([
    "listen_addresses",
    "port",
    "data_directory",
    "huge_pages",
    "io_method",
  ]),
};

function alterLine(s: TuneSetting): string {
  const value = formatSettingValue(s).replace(/'/g, "''");
  return `ALTER SYSTEM SET ${s.key} = '${value}';`;
}

function yamlQuote(value: string): string {
  if (/^[\w.+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function formatAlterSystem(settings: TuneSetting[]): string {
  return settings.map(alterLine).concat(["SELECT pg_reload_conf();"]).join("\n");
}

export function formatMigrationSql(settings: TuneSetting[]): string {
  const reload = settings.filter((s) => !s.restart);
  const restart = settings.filter((s) => s.restart);
  const parts: string[] = [
    "-- pgtune migration: apply reload-safe settings first,",
    "-- then schedule a restart for the remaining GUCs.",
    "",
  ];
  if (reload.length) {
    parts.push("-- === Reload-safe (no restart) ===");
    for (const s of reload) parts.push(alterLine(s));
    parts.push("SELECT pg_reload_conf();");
    parts.push("");
  } else {
    parts.push("-- (no reload-safe settings in this set)");
    parts.push("");
  }
  if (restart.length) {
    parts.push("-- === Requires service restart ===");
    parts.push("-- WARNING: these take effect only after restarting PostgreSQL.");
    parts.push("-- Apply during a maintenance window, then restart the service.");
    for (const s of restart) parts.push(alterLine(s));
    parts.push("-- systemctl restart postgresql   # or your orchestrator restart");
  } else {
    parts.push("-- (no restart-required settings in this set)");
  }
  return parts.join("\n");
}

export function formatPatroniYaml(settings: TuneSetting[]): string {
  const lines = [
    "# Patroni / DCS fragment — merge under postgresql.parameters",
    "postgresql:",
    "  parameters:",
  ];
  for (const s of settings) {
    lines.push(`    ${s.key}: ${yamlQuote(formatSettingValue(s))}`);
  }
  return lines.join("\n");
}

export function formatAnsibleYaml(settings: TuneSetting[]): string {
  const lines = [
    "# Ansible — community.postgresql.postgresql_set (loop)",
    "- name: Apply pgtune PostgreSQL settings",
    "  community.postgresql.postgresql_set:",
    "    name: \"{{ item.name }}\"",
    "    value: \"{{ item.value }}\"",
    "  loop:",
  ];
  for (const s of settings) {
    lines.push(`    - { name: ${s.key}, value: ${yamlQuote(formatSettingValue(s))} }`);
  }
  lines.push("  become: true");
  lines.push("  become_user: postgres");
  return lines.join("\n");
}

export function formatDockerArgs(settings: TuneSetting[]): string {
  return settings
    .map((s) => `-c ${s.key}=${formatSettingValue(s)}`)
    .join(" \\\n  ");
}

export function formatDockerRunSnippet(settings: TuneSetting[]): string {
  const args = formatDockerArgs(settings);
  return `docker run -d --name pg \\
  -e POSTGRES_PASSWORD=secret \\
  postgres:18 \\
  ${args}`;
}

export function formatComposeYaml(settings: TuneSetting[]): string {
  const cmd = ["postgres", ...settings.flatMap((s) => ["-c", `${s.key}=${formatSettingValue(s)}`])];
  const cmdYaml = cmd.map((c) => `      - ${yamlQuote(c)}`).join("\n");
  return `# docker compose — postgres with pgtune -c flags
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    command:
${cmdYaml}
`;
}

export function formatHelmYaml(settings: TuneSetting[]): string {
  const lines = [
    "# CloudNativePG Cluster fragment — merge under spec.postgresql.parameters",
    "# (also usable as values for charts that accept a parameters map)",
    "apiVersion: postgresql.cnpg.io/v1",
    "kind: Cluster",
    "metadata:",
    "  name: pg-pgtune",
    "spec:",
    "  instances: 1",
    "  postgresql:",
    "    parameters:",
  ];
  for (const s of settings) {
    lines.push(`      ${s.key}: ${yamlQuote(formatSettingValue(s))}`);
  }
  return lines.join("\n");
}

export function filterManaged(
  settings: TuneSetting[],
  target: ManagedTarget,
): {
  settings: TuneSetting[];
  skipped: Array<{ key: string; reasonId: string }>;
  noteId: string;
} {
  if (target === "selfhosted") {
    return {
      settings,
      skipped: [],
      noteId: "managedNoteSelf",
    };
  }
  const blocked = MANAGED_BLOCKED[target];
  const kept: TuneSetting[] = [];
  const skipped: Array<{ key: string; reasonId: string }> = [];
  for (const s of settings) {
    if (blocked.has(s.key)) {
      skipped.push({ key: s.key, reasonId: "managedSkipPlatform" });
    } else {
      kept.push(s);
    }
  }
  return {
    settings: kept,
    skipped,
    noteId: `managedNote_${target}`,
  };
}

export function buildExports(
  settings: TuneSetting[],
  confText: string,
  target: ManagedTarget,
): ExportBundle {
  const managed = filterManaged(settings, target);
  return {
    conf: confText,
    alterSystem: formatAlterSystem(managed.settings),
    dockerArgs: formatDockerArgs(managed.settings),
    dockerRunSnippet: formatDockerRunSnippet(managed.settings),
    composeYaml: formatComposeYaml(managed.settings),
    helmYaml: formatHelmYaml(managed.settings),
    migrateSql: formatMigrationSql(managed.settings),
    patroniYaml: formatPatroniYaml(managed.settings),
    ansibleYaml: formatAnsibleYaml(managed.settings),
    managedNoteId: managed.noteId,
    managedSkipped: managed.skipped,
    managedSettings: managed.settings,
  };
}
