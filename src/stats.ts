import type { DbSize, DbType, TuneInput } from "./tune";

export const STATS_COLLECT_SQL = `-- Run as a role that can read stats (often superuser or pg_monitor).
-- Optional: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- Paste the full result back into pgtune. Nothing is uploaded.

SELECT 'cache_hit_ratio' AS metric,
       ROUND(
         CASE WHEN blks_hit + blks_read = 0 THEN NULL
              ELSE blks_hit::numeric / (blks_hit + blks_read)
         END, 4
       )::text AS value
FROM pg_stat_database
WHERE datname = current_database()
UNION ALL
SELECT 'temp_files', temp_files::text FROM pg_stat_database WHERE datname = current_database()
UNION ALL
SELECT 'temp_bytes', temp_bytes::text FROM pg_stat_database WHERE datname = current_database()
UNION ALL
SELECT 'xact_commit', xact_commit::text FROM pg_stat_database WHERE datname = current_database()
UNION ALL
SELECT 'xact_rollback', xact_rollback::text FROM pg_stat_database WHERE datname = current_database()
UNION ALL
SELECT 'tup_returned', tup_returned::text FROM pg_stat_database WHERE datname = current_database()
UNION ALL
SELECT 'tup_fetched', tup_fetched::text FROM pg_stat_database WHERE datname = current_database()
UNION ALL
SELECT 'checkpoints_timed', checkpoints_timed::text FROM pg_stat_bgwriter
UNION ALL
SELECT 'checkpoints_req', checkpoints_req::text FROM pg_stat_bgwriter
UNION ALL
SELECT 'buffers_checkpoint', buffers_checkpoint::text FROM pg_stat_bgwriter
UNION ALL
SELECT 'buffers_clean', buffers_clean::text FROM pg_stat_bgwriter
UNION ALL
SELECT 'maxwritten_clean', maxwritten_clean::text FROM pg_stat_bgwriter
UNION ALL
SELECT 'numbackends', numbackends::text FROM pg_stat_database WHERE datname = current_database()
UNION ALL
SELECT 'max_connections', current_setting('max_connections')
UNION ALL
SELECT 'shared_buffers', current_setting('shared_buffers')
UNION ALL
SELECT 'work_mem', current_setting('work_mem')
UNION ALL
SELECT 'max_wal_size', current_setting('max_wal_size')
UNION ALL
SELECT 'pg_version', split_part(current_setting('server_version_num'), '.', 1)
UNION ALL
SELECT 'statements_mean_ms',
       COALESCE((
         SELECT ROUND(AVG(mean_exec_time)::numeric, 2)::text
         FROM pg_stat_statements
         WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       ), '0')
UNION ALL
SELECT 'statements_temp_blks',
       COALESCE((
         SELECT SUM(temp_blks_written)::text
         FROM pg_stat_statements
         WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       ), '0')
UNION ALL
SELECT 'statements_shared_read',
       COALESCE((
         SELECT SUM(shared_blks_read)::text
         FROM pg_stat_statements
         WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       ), '0')
UNION ALL
SELECT 'io_read_bytes',
       COALESCE((
         SELECT SUM(reads * op_bytes)::text
         FROM pg_stat_io
         WHERE backend_type = 'client backend' AND object = 'relation'
       ), '0');
`;

export type StatsMetrics = Record<string, string>;

export type StatsHint = {
  id: string;
  params?: Record<string, string | number>;
};

export type StatsAnalysis = {
  metrics: StatsMetrics;
  hints: StatsHint[];
  patch: Partial<TuneInput>;
};

function parseMetricMap(text: string): StatsMetrics {
  const out: StatsMetrics = {};
  const lines = text.trim().split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^[-+|]+$/.test(line) || /^metric\b/i.test(line)) continue;
    if (line.includes("|")) {
      const [k, v] = line.split("|").map((p) => p.trim());
      if (k && v !== undefined && v !== "") out[k.toLowerCase()] = v;
      continue;
    }
    const m = line.match(/^([a-z0-9_]+)\s*[:=\t]\s*(.+)$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export function analyzeStatsPaste(text: string): StatsAnalysis | null {
  const metrics = parseMetricMap(text);
  if (Object.keys(metrics).length < 2) return null;

  const hints: StatsHint[] = [];
  const patch: Partial<TuneInput> = {};

  const hit = Number(metrics.cache_hit_ratio);
  if (Number.isFinite(hit)) {
    if (hit >= 0.99) {
      patch.dbSize = "less_ram" satisfies DbSize;
      hints.push({ id: "statsHintHighCache", params: { hit: hit.toFixed(3) } });
    } else if (hit < 0.9) {
      patch.dbSize = "greater_ram" satisfies DbSize;
      hints.push({ id: "statsHintLowCache", params: { hit: hit.toFixed(3) } });
      patch.sharedBuffersScale = 1.15;
    } else {
      hints.push({ id: "statsHintMidCache", params: { hit: hit.toFixed(3) } });
    }
  }

  const tempFiles = Number(metrics.temp_files);
  if (Number.isFinite(tempFiles) && tempFiles > 0) {
    hints.push({
      id: "statsHintTempFiles",
      params: { n: Math.round(tempFiles) },
    });
    if (tempFiles >= 50) {
      patch.workMemScale = 1.5;
      hints.push({
        id: "statsHintTempFilesBoost",
        params: { n: Math.round(tempFiles) },
      });
    } else if (tempFiles >= 10) {
      patch.workMemScale = 1.25;
      hints.push({
        id: "statsHintTempFilesBoost",
        params: { n: Math.round(tempFiles) },
      });
    }
  }

  const returned = Number(metrics.tup_returned);
  const fetched = Number(metrics.tup_fetched);
  if (Number.isFinite(returned) && Number.isFinite(fetched) && fetched > 0) {
    const ratio = returned / fetched;
    if (ratio > 50) {
      patch.dbType = "dw" satisfies DbType;
      hints.push({
        id: "statsHintSeqHeavy",
        params: { ratio: Math.round(ratio) },
      });
    } else if (ratio < 5) {
      if (!patch.dbType) patch.dbType = "oltp";
      hints.push({
        id: "statsHintPointHeavy",
        params: { ratio: Number(ratio.toFixed(1)) },
      });
    }
  }

  const timed = Number(metrics.checkpoints_timed);
  const req = Number(metrics.checkpoints_req);
  if (Number.isFinite(timed) && Number.isFinite(req) && timed + req > 0) {
    const forcedShare = req / (timed + req);
    if (forcedShare > 0.3) {
      hints.push({
        id: "statsHintForcedCheckpoints",
        params: { pct: Math.round(forcedShare * 100) },
      });
      patch.maxWalScale = forcedShare > 0.5 ? 2 : 1.5;
      hints.push({
        id: "statsHintWalBoost",
        params: { pct: Math.round(forcedShare * 100) },
      });
    }
  }

  const maxWritten = Number(metrics.maxwritten_clean);
  const buffersClean = Number(metrics.buffers_clean);
  if (
    Number.isFinite(maxWritten) &&
    Number.isFinite(buffersClean) &&
    buffersClean > 0 &&
    maxWritten / buffersClean > 0.2
  ) {
    hints.push({
      id: "statsHintBgwriterPressure",
      params: { pct: Math.round((maxWritten / buffersClean) * 100) },
    });
    patch.maxWalScale = Math.max(patch.maxWalScale ?? 1, 1.25);
  }

  const meanMs = Number(metrics.statements_mean_ms);
  const tempBlks = Number(metrics.statements_temp_blks);
  if (Number.isFinite(meanMs) && meanMs > 50) {
    hints.push({
      id: "statsHintSlowStatements",
      params: { ms: Number(meanMs.toFixed(1)) },
    });
  }
  if (Number.isFinite(tempBlks) && tempBlks > 1000) {
    hints.push({
      id: "statsHintStatementsTemp",
      params: { n: Math.round(tempBlks) },
    });
    patch.workMemScale = Math.max(patch.workMemScale ?? 1, 1.35);
  }

  const sharedRead = Number(metrics.statements_shared_read);
  if (Number.isFinite(sharedRead) && sharedRead > 1_000_000) {
    hints.push({
      id: "statsHintStatementsRead",
      params: { n: Math.round(sharedRead) },
    });
    if (!patch.dbSize || patch.dbSize === "mid_ram") {
      patch.dbSize = "greater_ram";
    }
    patch.sharedBuffersScale = Math.max(patch.sharedBuffersScale ?? 1, 1.2);
  }

  const ioRead = Number(metrics.io_read_bytes);
  if (Number.isFinite(ioRead) && ioRead > 5_000_000_000) {
    hints.push({
      id: "statsHintIoRead",
      params: { gb: Math.round(ioRead / 1_000_000_000) },
    });
    patch.sharedBuffersScale = Math.max(patch.sharedBuffersScale ?? 1, 1.15);
  }

  const backends = Number(metrics.numbackends);
  const maxConn = Number(metrics.max_connections);
  if (Number.isFinite(backends) && Number.isFinite(maxConn) && maxConn > 0) {
    const fill = backends / maxConn;
    if (fill > 0.7) {
      hints.push({
        id: "statsHintConnPressure",
        params: { backends: Math.round(backends), max: Math.round(maxConn) },
      });
      patch.connectionNum = Math.max(maxConn, Math.ceil(backends * 1.3));
    } else if (backends > 0) {
      hints.push({
        id: "statsHintConnOk",
        params: { backends: Math.round(backends), max: Math.round(maxConn) },
      });
    }
  }

  const ver = Number(metrics.pg_version);
  if (Number.isFinite(ver) && ver >= 140000) {
    const major = Math.floor(ver / 10000);
    if (major >= 14 && major <= 19) {
      patch.dbVersion = major as TuneInput["dbVersion"];
      hints.push({ id: "statsHintVersion", params: { v: major } });
    }
  } else if (Number.isFinite(ver) && ver >= 14 && ver <= 19) {
    patch.dbVersion = ver as TuneInput["dbVersion"];
    hints.push({ id: "statsHintVersion", params: { v: ver } });
  }

  if (hints.length === 0) {
    hints.push({ id: "statsHintParsedNoAction" });
  }

  return { metrics, hints, patch };
}
