// scripts/audit/run-helper.mjs
//
// Shared lifecycle helper for Track A cleanup scripts. Wraps the
// audit_run_begin / audit_run_finish / record_cleanup_provenance functions
// on LCC Opps so each cleanup script reads like the actual remediation
// step, not boilerplate.
//
// Required env (any of OPS_*, DIA_*, GOV_* triplets):
//   OPS_SUPABASE_URL / OPS_SUPABASE_KEY            (audit_run_log lives here)
//   DIA_SUPABASE_URL / DIA_SUPABASE_KEY            (read/write dia tables)
//   GOV_SUPABASE_URL / GOV_SUPABASE_KEY            (read/write gov tables)
//
// Usage:
//   import { runCleanupStep, makeRunId } from './run-helper.mjs';
//   await runCleanupStep({
//     step: 'A1_entity_dedup',
//     targetDatabase: 'dia_db',
//     runId: makeRunId('A1'),
//     dryRun: process.argv.includes('--apply') ? false : true,
//     before: async (ctx) => /* read v_data_health_* */,
//     execute: async (ctx) => /* the actual work */,
//     after:  async (ctx) => /* re-read v_data_health_* */,
//   });

import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../_env-file.mjs';

const envFile = path.resolve(process.cwd(), '.env');
const env = { ...process.env, ...(fs.existsSync(envFile) ? readEnvFile(envFile) : {}) };

function makeClient(urlVar, keyVar) {
  const url = env[urlVar];
  const key = env[keyVar];
  if (!url || !key) {
    throw new Error(`Missing ${urlVar} / ${keyVar}. Set in .env or shell.`);
  }
  return {
    url,
    async rest(method, pathStr, body, extraHeaders = {}) {
      const res = await fetch(`${url}/rest/v1/${pathStr}`, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...extraHeaders,
        },
        body: body == null ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`${method} ${pathStr} -> ${res.status}: ${text}`);
      }
      return text ? JSON.parse(text) : null;
    },
    async rpc(fn, args) {
      return this.rest('POST', `rpc/${fn}`, args);
    },
  };
}

export function getClients({ requireDia = false, requireGov = false } = {}) {
  const ops = makeClient('OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY');
  const dia = requireDia ? makeClient('DIA_SUPABASE_URL', 'DIA_SUPABASE_KEY') : null;
  const gov = requireGov ? makeClient('GOV_SUPABASE_URL', 'GOV_SUPABASE_KEY') : null;
  return { ops, dia, gov };
}

export function makeRunId(stepCode) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Date.now()).slice(-3);
  return `cleanup_${stepCode}_${ymd}_${seq}`;
}

export async function runCleanupStep({
  step,
  targetDatabase,
  runId,
  dryRun = true,
  notes = null,
  metadata = null,
  before,
  execute,
  after,
}) {
  const { ops } = getClients();

  const beginPayload = {
    p_run_id: runId,
    p_step: step,
    p_target_database: targetDatabase,
    p_dry_run: dryRun,
    p_notes: notes,
    p_metadata: metadata,
  };
  const [logRow] = await ops.rpc('audit_run_begin', beginPayload);
  // RPC returning bigint comes back as a scalar in some PostgREST versions;
  // normalize.
  const logId =
    logRow && typeof logRow === 'object'
      ? logRow.log_id || logRow.audit_run_begin
      : logRow;

  console.log(
    `[run-helper] step=${step} run_id=${runId} target=${targetDatabase} dry_run=${dryRun} log_id=${logId}`,
  );

  const ctx = { runId, step, targetDatabase, dryRun, logId, ops };
  let beforeSnap = null;
  let afterSnap = null;
  let rowsAffected = null;
  let status = 'in_progress';
  let error = null;

  try {
    if (typeof before === 'function') {
      beforeSnap = await before(ctx);
      console.log('[run-helper] before:', JSON.stringify(beforeSnap));
    }

    const result = (typeof execute === 'function' ? await execute(ctx) : null) || {};
    rowsAffected = result.rowsAffected ?? null;

    if (typeof after === 'function') {
      afterSnap = await after(ctx);
      console.log('[run-helper] after :', JSON.stringify(afterSnap));
    }

    status = 'succeeded';
  } catch (err) {
    status = 'failed';
    error = err && err.message ? err.message : String(err);
    console.error('[run-helper] FAILED:', error);
  } finally {
    await ops.rpc('audit_run_finish', {
      p_log_id: logId,
      p_status: status,
      p_rows_affected: rowsAffected,
      p_rows_after: null,
      p_error: error,
    });
    // Save snapshots into the log row metadata so /verify reads can correlate.
    if (beforeSnap || afterSnap) {
      await ops.rest(
        'PATCH',
        `audit_run_log?log_id=eq.${logId}`,
        {
          metadata: {
            ...(metadata || {}),
            before: beforeSnap || undefined,
            after: afterSnap || undefined,
          },
        },
      );
    }
  }

  return { status, logId, rowsAffected, beforeSnap, afterSnap, error };
}

// Convenience helper for the standard "read v_data_health_* on a domain" snapshot.
export async function snapshotDataHealth(client, view = 'v_data_health_sales') {
  const rows = await client.rest('GET', `${view}?select=*`);
  return rows && rows.length ? rows[0] : null;
}
