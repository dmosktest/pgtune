export type DbVersion = 14 | 15 | 16 | 17 | 18 | 19;
export type OsType = "linux" | "windows" | "mac";
export type DbType = "web" | "oltp" | "dw" | "desktop" | "mixed";
export type HdType = "ssd" | "hdd" | "san" | "nvme";
export type DbSize = "less_ram" | "mid_ram" | "greater_ram";
export type MemoryUnit = "MB" | "GB" | "TB";
export type ServerRole =
  | "standalone"
  | "primary"
  | "replica"
  | "primary_cdc"
  | "primary_pitr";

export type PoolerMode = "none" | "transaction" | "session";

export type TuneInput = {
  dbVersion: DbVersion;
  osType: OsType;
  dbType: DbType;
  totalMemory: number;
  totalMemoryUnit: MemoryUnit;
  /** Share of host RAM reserved for PostgreSQL (50–100). */
  pgRamPercent: number;
  serverRole: ServerRole;
  /** Peak concurrent complex queries that may each allocate work_mem. */
  peakComplexQueries: number;
  /** Connection pooler in front of PostgreSQL. */
  poolerMode: PoolerMode;
  cpuNum: number | null;
  connectionNum: number | null;
  hdType: HdType;
  dbSize: DbSize;
  /** Optional scales from stats ingest (1 = unchanged). */
  workMemScale?: number;
  maxWalScale?: number;
  sharedBuffersScale?: number;
};

export type MemoryBudget = {
  hostRamKb: number;
  pgRamKb: number;
  sharedBuffersKb: number;
  maintenanceWorkMemKb: number;
  connectionsWorkMemKb: number;
  osCacheKb: number;
  peakRisk: boolean;
  peakFactor: number;
};

export type SettingValue = string | number;

export type TuneSetting = {
  key: string;
  value: SettingValue;
  isMemory?: boolean;
  restart?: boolean;
};

export type WarningLevel = "startup" | "memory" | "note";

export type TuneWarning = {
  level: WarningLevel;
  id: string;
  params?: Record<string, string | number>;
  code?: string;
};

export type TuneResult = {
  settings: TuneSetting[];
  warnings: TuneWarning[];
  assumedConnections: number;
  confText: string;
  budget: MemoryBudget;
  hugePagesSysctl: string | null;
};

const KB = 1024;
const MB = 1048576;
const GB = 1073741824;
const TB = 1099511627776;

const UNIT_BYTES: Record<MemoryUnit, number> = { MB, GB, TB };

const MIN_WORK_MEM_KB = (4 * MB) / KB;
const MAX_PARALLEL_WORKERS = 1024;

const RESTART_KEYS = new Set([
  "max_connections",
  "shared_buffers",
  "wal_buffers",
  "max_worker_processes",
  "wal_level",
  "max_wal_senders",
  "io_method",
  "autovacuum_max_workers",
]);

const GUC_DOC_ANCHOR: Record<string, string> = {
  max_connections: "runtime-config-connection.html#GUC-MAX-CONNECTIONS",
  shared_buffers: "runtime-config-resource.html#GUC-SHARED-BUFFERS",
  effective_cache_size: "runtime-config-query.html#GUC-EFFECTIVE-CACHE-SIZE",
  maintenance_work_mem: "runtime-config-resource.html#GUC-MAINTENANCE-WORK-MEM",
  checkpoint_completion_target:
    "runtime-config-wal.html#GUC-CHECKPOINT-COMPLETION-TARGET",
  wal_buffers: "runtime-config-wal.html#GUC-WAL-BUFFERS",
  default_statistics_target:
    "runtime-config-query.html#GUC-DEFAULT-STATISTICS-TARGET",
  random_page_cost: "runtime-config-query.html#GUC-RANDOM-PAGE-COST",
  effective_io_concurrency:
    "runtime-config-resource.html#GUC-EFFECTIVE-IO-CONCURRENCY",
  maintenance_io_concurrency:
    "runtime-config-resource.html#GUC-MAINTENANCE-IO-CONCURRENCY",
  work_mem: "runtime-config-resource.html#GUC-WORK-MEM",
  jit: "runtime-config-query.html#GUC-JIT",
  wal_compression: "runtime-config-wal.html#GUC-WAL-COMPRESSION",
  autovacuum_max_workers:
    "runtime-config-autovacuum.html#GUC-AUTOVACUUM-MAX-WORKERS",
  autovacuum_work_mem: "runtime-config-autovacuum.html#GUC-AUTOVACUUM-WORK-MEM",
  autovacuum_vacuum_cost_limit:
    "runtime-config-autovacuum.html#GUC-AUTOVACUUM-VACUUM-COST-LIMIT",
  autovacuum_vacuum_cost_delay:
    "runtime-config-autovacuum.html#GUC-AUTOVACUUM-VACUUM-COST-DELAY",
  vacuum_cost_page_miss: "runtime-config-resource.html#GUC-VACUUM-COST-PAGE-MISS",
  vacuum_buffer_usage_limit:
    "runtime-config-resource.html#GUC-VACUUM-BUFFER-USAGE-LIMIT",
  io_method: "runtime-config-resource.html#GUC-IO-METHOD",
  io_workers: "runtime-config-resource.html#GUC-IO-WORKERS",
  io_max_workers: "runtime-config-resource.html#GUC-IO-MAX-WORKERS",
  min_wal_size: "runtime-config-wal.html#GUC-MIN-WAL-SIZE",
  max_wal_size: "runtime-config-wal.html#GUC-MAX-WAL-SIZE",
  max_worker_processes:
    "runtime-config-resource.html#GUC-MAX-WORKER-PROCESSES",
  max_parallel_workers_per_gather:
    "runtime-config-resource.html#GUC-MAX-PARALLEL-WORKERS-PER-GATHER",
  max_parallel_workers:
    "runtime-config-resource.html#GUC-MAX-PARALLEL-WORKERS",
  max_parallel_maintenance_workers:
    "runtime-config-resource.html#GUC-MAX-PARALLEL-MAINTENANCE-WORKERS",
  wal_level: "runtime-config-wal.html#GUC-WAL-LEVEL",
  max_wal_senders: "runtime-config-replication.html#GUC-MAX-WAL-SENDERS",
  wal_keep_size: "runtime-config-replication.html#GUC-WAL-KEEP-SIZE",
  hot_standby: "runtime-config-replication.html#GUC-HOT-STANDBY",
};

const DEFAULT_DB = {
  max_connections: 100,
  max_worker_processes: 8,
  max_parallel_workers_per_gather: 2,
  max_parallel_workers: 8,
};

export const DB_VERSIONS: DbVersion[] = [19, 18, 17, 16, 15, 14];
export const DEFAULT_INPUT: TuneInput = {
  dbVersion: 18,
  osType: "linux",
  dbType: "web",
  totalMemory: 16,
  totalMemoryUnit: "GB",
  pgRamPercent: 100,
  serverRole: "standalone",
  peakComplexQueries: 2,
  poolerMode: "none",
  cpuNum: 8,
  connectionNum: null,
  hdType: "ssd",
  dbSize: "mid_ram",
};

export function settingDocsUrl(dbVersion: DbVersion, key: string): string {
  const path =
    GUC_DOC_ANCHOR[key] ??
    `runtime-config.html#GUC-${key.toUpperCase().replace(/_/g, "-")}`;
  return `https://www.postgresql.org/docs/${dbVersion}/${path}`;
}

export function clampPgRamPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(50, Math.round(value)));
}

export function clampPeakQueries(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(16, Math.max(1, Math.round(value)));
}

function roundDownToMb(valueKb: number): number {
  const mbInKb = MB / KB;
  return Math.floor(valueKb / mbInKb) * mbInKb;
}

export function formatMemoryKb(valueKb: number): string {
  if (valueKb >= (GB / KB) && valueKb % (GB / KB) === 0) {
    return `${valueKb / (GB / KB)}GB`;
  }
  if (valueKb >= (MB / KB) && valueKb % (MB / KB) === 0) {
    return `${valueKb / (MB / KB)}MB`;
  }
  return `${Math.round(valueKb)}kB`;
}

export function formatSettingValue(setting: TuneSetting): string {
  if (setting.isMemory && typeof setting.value === "number") {
    return formatMemoryKb(setting.value);
  }
  return String(setting.value);
}

export function normalizeSettingDisplay(value: string | number): string {
  return String(value).trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
}

export function formatConf(settings: TuneSetting[]): string {
  return settings
    .map((s) => {
      const restart = s.restart ? " # restart required" : "";
      const disk =
        s.key === "max_wal_size" ? " # needs free disk space" : "";
      return `${s.key} = ${formatSettingValue(s)}${restart}${disk}`;
    })
    .join("\n");
}

export function tune(input: TuneInput): TuneResult {
  const hostMemoryBytes = input.totalMemory * UNIT_BYTES[input.totalMemoryUnit];
  const hostMemoryKb = hostMemoryBytes / KB;
  const pgRamPercent = clampPgRamPercent(input.pgRamPercent);
  const peakComplexQueries = clampPeakQueries(input.peakComplexQueries);
  const totalMemoryKb = Math.floor((hostMemoryKb * pgRamPercent) / 100);
  const totalMemoryBytes = totalMemoryKb * KB;
  const dbDefaults = DEFAULT_DB;

  let sharedBuffers = roundDownToMb(
    {
      web: Math.floor(totalMemoryKb / 4),
      oltp: Math.floor(totalMemoryKb / 4),
      dw: Math.floor(totalMemoryKb / 4),
      desktop: Math.floor(totalMemoryKb / 16),
      mixed: Math.floor(totalMemoryKb / 4),
    }[input.dbType],
  );
  const sharedBuffersScale =
    input.sharedBuffersScale && input.sharedBuffersScale > 0
      ? input.sharedBuffersScale
      : 1;
  if (sharedBuffersScale !== 1) {
    sharedBuffers = roundDownToMb(Math.floor(sharedBuffers * sharedBuffersScale));
  }

  const effectiveCacheSize = roundDownToMb(
    {
      web: Math.floor((totalMemoryKb * 3) / 4),
      oltp: Math.floor((totalMemoryKb * 3) / 4),
      dw: Math.floor((totalMemoryKb * 3) / 4),
      desktop: Math.floor(totalMemoryKb / 4),
      mixed: Math.floor((totalMemoryKb * 3) / 4),
    }[input.dbType],
  );

  let maintenanceWorkMem = roundDownToMb(
    {
      web: Math.floor(totalMemoryKb / 16),
      oltp: Math.floor(totalMemoryKb / 16),
      dw: Math.floor(totalMemoryKb / 8),
      desktop: Math.floor(totalMemoryKb / 16),
      mixed: Math.floor(totalMemoryKb / 16),
    }[input.dbType],
  );
  let mwmLimit = (8 * GB) / KB;
  if (input.osType === "windows" && input.dbVersion <= 17) {
    mwmLimit = (2 * GB) / KB;
  }
  if (maintenanceWorkMem >= mwmLimit) {
    maintenanceWorkMem =
      input.osType === "windows" && input.dbVersion <= 17
        ? mwmLimit - MB / KB
        : mwmLimit;
  }

  let minWalSize = {
    web: (1024 * MB) / KB,
    oltp: (2048 * MB) / KB,
    dw: (4096 * MB) / KB,
    desktop: (100 * MB) / KB,
    mixed: (1024 * MB) / KB,
  }[input.dbType];
  let maxWalSize = {
    web: (4096 * MB) / KB,
    oltp: (8192 * MB) / KB,
    dw: (16384 * MB) / KB,
    desktop: (2048 * MB) / KB,
    mixed: (4096 * MB) / KB,
  }[input.dbType];
  if (input.serverRole === "primary_pitr" || input.serverRole === "primary_cdc") {
    minWalSize = Math.max(minWalSize, (2048 * MB) / KB);
    maxWalSize = Math.max(maxWalSize, (16384 * MB) / KB);
  } else if (input.serverRole === "primary") {
    maxWalSize = Math.max(maxWalSize, (8192 * MB) / KB);
  }
  const maxWalScale =
    input.maxWalScale && input.maxWalScale > 0 ? input.maxWalScale : 1;
  if (maxWalScale !== 1) {
    maxWalSize = roundDownToMb(Math.floor(maxWalSize * maxWalScale));
    minWalSize = roundDownToMb(
      Math.min(minWalSize, Math.floor(maxWalSize / 2)),
    );
  }

  const checkpointCompletionTarget = input.dbVersion < 14 ? 0.9 : null;

  let walBuffers = Math.floor(sharedBuffers / 8 / 32) * 8;
  walBuffers = Math.min(Math.max(walBuffers, 64), (16 * MB) / KB);

  const defaultStatisticsTarget = input.dbType === "dw" ? 500 : null;

  let randomPageCost = 1.1;
  if (input.dbSize === "less_ram") randomPageCost = 1.1;
  else if (input.hdType === "hdd") randomPageCost = 4;
  else if (input.dbType === "dw") randomPageCost = 4;
  else randomPageCost = 1.1;

  let effectiveIoConcurrency: number | null = {
    hdd: 2,
    ssd: 200,
    san: 300,
    nvme: 1000,
  }[input.hdType];
  if (input.osType !== "linux" && input.dbVersion < 18) {
    effectiveIoConcurrency = null;
  }

  const maintenanceIoConcurrency =
    input.dbVersion >= 13 && effectiveIoConcurrency
      ? effectiveIoConcurrency
      : null;

  const parallelSettings: TuneSetting[] = [];
  let parallelWorkersForWorkMem = dbDefaults.max_parallel_workers;
  if (input.cpuNum && input.cpuNum >= 4) {
    const parallelWorkers = Math.min(input.cpuNum, MAX_PARALLEL_WORKERS);
    parallelWorkersForWorkMem = parallelWorkers;
    let workersPerGather = Math.ceil(parallelWorkers / 2);
    if (input.dbType === "dw") {
      workersPerGather = Math.min(
        workersPerGather,
        Math.max(4, Math.floor(parallelWorkers / 4)),
      );
    } else if (workersPerGather > 4) {
      workersPerGather = 4;
    }
    parallelSettings.push({
      key: "max_worker_processes",
      value: Math.max(parallelWorkers, dbDefaults.max_worker_processes),
      restart: true,
    });
    parallelSettings.push({
      key: "max_parallel_workers_per_gather",
      value: workersPerGather,
    });
    if (input.dbVersion >= 10) {
      parallelSettings.push({
        key: "max_parallel_workers",
        value: parallelWorkers,
      });
    }
    if (input.dbVersion >= 11) {
      let parallelMaintenanceWorkers = Math.ceil(parallelWorkers / 2);
      if (parallelMaintenanceWorkers > 4) parallelMaintenanceWorkers = 4;
      parallelSettings.push({
        key: "max_parallel_maintenance_workers",
        value: parallelMaintenanceWorkers,
      });
    }
  }

  const poolerMode = input.poolerMode ?? "none";
  let maxConnections: number;
  if (input.connectionNum) {
    maxConnections = input.connectionNum;
  } else if (poolerMode === "transaction") {
    const cores = input.cpuNum && input.cpuNum > 0 ? input.cpuNum : 4;
    maxConnections = Math.min(Math.max(cores * 4, 20), 100);
  } else if (poolerMode === "session") {
    const cores = input.cpuNum && input.cpuNum > 0 ? input.cpuNum : 4;
    const sessionCap = Math.min(Math.max(cores * 8, 40), 200);
    const dbTypeConnections = {
      web: 150,
      oltp: 200,
      dw: 80,
      desktop: 80,
      mixed: 100,
    }[input.dbType];
    maxConnections = Math.min(sessionCap, dbTypeConnections);
  } else {
    const dbTypeConnections = {
      web: 200,
      oltp: 300,
      dw: 100,
      desktop: 100,
      mixed: 100,
    }[input.dbType];
    const connectionsFitInMemory =
      Math.floor((totalMemoryKb - sharedBuffers) / (MIN_WORK_MEM_KB * 3)) -
      parallelWorkersForWorkMem;
    maxConnections = Math.max(
      dbDefaults.max_connections,
      Math.min(dbTypeConnections, connectionsFitInMemory),
    );
  }

  const workMemBudget =
    (totalMemoryKb - sharedBuffers) /
    ((maxConnections + parallelWorkersForWorkMem) * 3);

  let workMem: number;
  if (workMemBudget < MIN_WORK_MEM_KB) {
    workMem = MIN_WORK_MEM_KB;
  } else {
    workMem = {
      web: Math.floor(workMemBudget),
      oltp: Math.floor(workMemBudget),
      dw: Math.floor(workMemBudget / 2),
      desktop: Math.floor(workMemBudget / 6),
      mixed: Math.floor(workMemBudget / 2),
    }[input.dbType];
    if (input.dbSize === "less_ram") workMem = Math.floor(workMem * 1.3);
    else if (input.dbSize === "greater_ram") workMem = Math.floor(workMem * 0.9);
    if (poolerMode === "transaction") workMem = Math.floor(workMem * 1.25);
    const workMemScale =
      input.workMemScale && input.workMemScale > 0 ? input.workMemScale : 1;
    workMem = Math.floor(workMem * workMemScale);
    workMem = roundDownToMb(workMem);
    if (workMem < MIN_WORK_MEM_KB) workMem = MIN_WORK_MEM_KB;
    if (input.osType === "windows" && input.dbVersion <= 17) {
      const winLimit = (2 * GB) / KB - MB / KB;
      if (workMem > winLimit) workMem = winLimit;
    }
  }

  const walLevel: TuneSetting[] = [];
  if (input.serverRole === "standalone" && input.dbType === "desktop") {
    walLevel.push({ key: "wal_level", value: "minimal", restart: true });
    walLevel.push({ key: "max_wal_senders", value: 0, restart: true });
  } else if (input.serverRole === "primary_cdc") {
    walLevel.push({ key: "wal_level", value: "logical", restart: true });
    walLevel.push({ key: "max_wal_senders", value: 20, restart: true });
    walLevel.push({
      key: "wal_keep_size",
      value: Math.max(maxWalSize, (4096 * MB) / KB),
      isMemory: true,
      restart: true,
    });
  } else if (
    input.serverRole === "primary" ||
    input.serverRole === "primary_pitr"
  ) {
    walLevel.push({ key: "wal_level", value: "replica", restart: true });
    walLevel.push({
      key: "max_wal_senders",
      value: input.serverRole === "primary_pitr" ? 16 : 10,
      restart: true,
    });
    walLevel.push({
      key: "wal_keep_size",
      value:
        input.serverRole === "primary_pitr"
          ? Math.max(maxWalSize, (8192 * MB) / KB)
          : Math.max(maxWalSize / 2, (2048 * MB) / KB),
      isMemory: true,
      restart: true,
    });
  } else if (input.serverRole === "replica") {
    walLevel.push({ key: "hot_standby", value: "on" });
    walLevel.push({ key: "wal_level", value: "replica", restart: true });
    walLevel.push({ key: "max_wal_senders", value: 10, restart: true });
  }

  let jit: string | null = null;
  if (
    input.dbVersion >= 12 &&
    input.dbVersion < 19 &&
    (input.dbType === "web" ||
      input.dbType === "oltp" ||
      input.dbType === "mixed")
  ) {
    jit = "off";
  }

  let walCompression: string | null = null;
  if (input.dbVersion >= 19) walCompression = "on";
  else if (input.dbVersion >= 15) walCompression = "lz4";
  else if (input.dbVersion >= 10) walCompression = "on";

  let autovacuumMaxWorkers: number | null = null;
  if (input.cpuNum && input.cpuNum >= 32) autovacuumMaxWorkers = 5;
  else if (input.cpuNum && input.cpuNum >= 16) autovacuumMaxWorkers = 4;

  const avThreshold = GB / KB;
  const autovacuumWorkMem =
    maintenanceWorkMem > avThreshold ? avThreshold : null;
  const autovacuumVacuumCostLimit = autovacuumMaxWorkers
    ? Math.round((200 * autovacuumMaxWorkers) / 3)
    : null;
  const autovacuumVacuumCostDelay = input.dbVersion < 12 ? "2ms" : null;
  const vacuumCostPageMiss = input.dbVersion < 14 ? 2 : null;
  const vacuumBufferUsageLimit =
    input.dbVersion === 16 ? (2 * MB) / KB : null;

  let ioMethod: string | null = null;
  if (input.dbVersion >= 18 && input.osType === "linux") {
    ioMethod = "io_uring";
  }

  const ioWorkers: TuneSetting[] = [];
  if (input.dbVersion >= 18 && input.cpuNum && ioMethod !== "io_uring") {
    const ioWorkersValue = Math.min(32, Math.floor(input.cpuNum / 4));
    const setting =
      input.dbVersion >= 19
        ? { key: "io_max_workers", default: 8 }
        : { key: "io_workers", default: 3 };
    if (ioWorkersValue > setting.default) {
      ioWorkers.push({ key: setting.key, value: ioWorkersValue });
    }
  }

  const isHugePagesRecommended =
    input.osType !== "mac" && sharedBuffers >= (2 * GB) / KB;

  const connectionsWorkMemKb =
    maxConnections * workMem * peakComplexQueries;
  const reservedKb = sharedBuffers + maintenanceWorkMem + connectionsWorkMemKb;
  const osCacheKb = Math.max(0, totalMemoryKb - reservedKb);
  const peakRisk = reservedKb > totalMemoryKb * 0.9;
  const budget: MemoryBudget = {
    hostRamKb: hostMemoryKb,
    pgRamKb: totalMemoryKb,
    sharedBuffersKb: sharedBuffers,
    maintenanceWorkMemKb: maintenanceWorkMem,
    connectionsWorkMemKb,
    osCacheKb,
    peakRisk,
    peakFactor: peakComplexQueries,
  };

  let hugePagesSysctl: string | null = null;
  if (isHugePagesRecommended && input.osType === "linux") {
    const hugepageKb = 2048;
    const pages = Math.ceil((sharedBuffers * 1.15) / hugepageKb);
    hugePagesSysctl = `vm.nr_hugepages = ${pages}`;
  }

  const warnings: TuneWarning[] = [];
  if (totalMemoryBytes < GB) {
    warnings.push({ level: "note", id: "warnLowMemory" });
  } else if (hostMemoryBytes > 100 * GB) {
    warnings.push({ level: "note", id: "warnHighMemory" });
  }
  if (pgRamPercent < 100) {
    warnings.push({
      level: "note",
      id: "warnPgRamHeadroom",
      params: { pct: pgRamPercent },
    });
  }
  if (workMemBudget < MIN_WORK_MEM_KB) {
    warnings.push({
      level: "memory",
      id:
        parallelWorkersForWorkMem > dbDefaults.max_parallel_workers
          ? "warnOomParallel"
          : "warnOomConnections",
      params: {
        connections: maxConnections,
        workers: parallelWorkersForWorkMem,
      },
    });
  }
  if (peakRisk) {
    warnings.push({
      level: "memory",
      id: "warnPeakOom",
      params: {
        peak: peakComplexQueries,
        connections: maxConnections,
      },
    });
  }
  if (isHugePagesRecommended) {
    if (input.osType === "windows") {
      warnings.push({ level: "note", id: "warnHugePagesWindows" });
    } else if (input.dbVersion >= 15) {
      warnings.push({
        level: "note",
        id: "warnHugePagesLinux",
        code: [
          "postgres -D $PGDATA -C shared_memory_size_in_huge_pages",
          hugePagesSysctl ? `# /etc/sysctl.conf\n${hugePagesSysctl}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } else {
      warnings.push({
        level: "note",
        id: "warnHugePagesLinuxOld",
        code: hugePagesSysctl ?? undefined,
      });
    }
  }
  if (input.serverRole === "standalone" && input.dbType === "desktop") {
    warnings.push({ level: "startup", id: "warnWalMinimal" });
  }
  if (input.serverRole === "primary_cdc") {
    warnings.push({ level: "note", id: "warnRoleCdc" });
  }
  if (input.serverRole === "primary_pitr") {
    warnings.push({ level: "note", id: "warnRolePitr" });
  }
  if (input.serverRole === "replica") {
    warnings.push({ level: "note", id: "warnRoleReplica" });
  }
  if (poolerMode === "transaction") {
    warnings.push({
      level: "note",
      id: "warnPoolerTransaction",
      params: { connections: maxConnections },
    });
  } else if (poolerMode === "session") {
    warnings.push({
      level: "note",
      id: "warnPoolerSession",
      params: { connections: maxConnections },
    });
  }
  if (walCompression === "lz4") {
    warnings.push({
      level: "startup",
      id: "warnWalLz4",
      code: "SELECT enumvals FROM pg_settings WHERE name = 'wal_compression';",
    });
  }
  if (ioMethod === "io_uring") {
    warnings.push({
      level: "startup",
      id: "warnIoUring",
      code: "SELECT enumvals FROM pg_settings WHERE name = 'io_method';",
    });
  }
  if (
    input.dbType === "dw" &&
    input.hdType !== "hdd" &&
    input.dbSize !== "less_ram"
  ) {
    warnings.push({
      level: "note",
      id: "warnDwCost",
      params: { drive: input.hdType },
    });
  }

  const raw: Array<{
    key: string;
    value: SettingValue | null;
    isMemory?: boolean;
  }> = [
    { key: "max_connections", value: maxConnections },
    { key: "shared_buffers", value: sharedBuffers, isMemory: true },
    { key: "effective_cache_size", value: effectiveCacheSize, isMemory: true },
    { key: "maintenance_work_mem", value: maintenanceWorkMem, isMemory: true },
    { key: "checkpoint_completion_target", value: checkpointCompletionTarget },
    { key: "wal_buffers", value: walBuffers, isMemory: true },
    { key: "default_statistics_target", value: defaultStatisticsTarget },
    { key: "random_page_cost", value: randomPageCost },
    { key: "effective_io_concurrency", value: effectiveIoConcurrency },
    { key: "maintenance_io_concurrency", value: maintenanceIoConcurrency },
    { key: "work_mem", value: workMem, isMemory: true },
    { key: "jit", value: jit },
    { key: "wal_compression", value: walCompression },
    { key: "autovacuum_max_workers", value: autovacuumMaxWorkers },
    { key: "autovacuum_work_mem", value: autovacuumWorkMem, isMemory: true },
    { key: "autovacuum_vacuum_cost_limit", value: autovacuumVacuumCostLimit },
    { key: "autovacuum_vacuum_cost_delay", value: autovacuumVacuumCostDelay },
    { key: "vacuum_cost_page_miss", value: vacuumCostPageMiss },
    {
      key: "vacuum_buffer_usage_limit",
      value: vacuumBufferUsageLimit,
      isMemory: true,
    },
    { key: "io_method", value: ioMethod },
    ...ioWorkers,
    { key: "min_wal_size", value: minWalSize, isMemory: true },
    { key: "max_wal_size", value: maxWalSize, isMemory: true },
    ...parallelSettings,
    ...walLevel,
  ];

  const settings: TuneSetting[] = raw
    .filter((s) => s.value !== null && s.value !== undefined)
    .map((s) => ({
      key: s.key,
      value: s.value as SettingValue,
      isMemory: s.isMemory,
      restart:
        RESTART_KEYS.has(s.key) &&
        !(s.key === "autovacuum_max_workers" && input.dbVersion >= 18),
    }));

  return {
    settings,
    warnings,
    assumedConnections: maxConnections,
    confText: formatConf(settings),
    budget,
    hugePagesSysctl,
  };
}

export function settingExplanationKey(key: string): string {
  return `why_${key}`;
}
