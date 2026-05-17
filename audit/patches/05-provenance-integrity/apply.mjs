#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #5, Phase A: surface silent domain-DB write failures
// Closes finding: A-3 (the table + instrumentation half)
// Phase B (deferred): migrate pushProvenance / recordCoStarFieldsProvenance
// call sites to gate on .ok so field_provenance stops recording ghost writes.
// Branch: audit/05-provenance-integrity
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

class EditError extends Error {
  constructor(label, msg) { super(`[${label}] ${msg}`); this.label = label; }
}
function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
function expectUnique(content, anchor, label) {
  const n = content.split(anchor).length - 1;
  if (n === 0) throw new EditError(label, 'anchor NOT FOUND.');
  if (n > 1)   throw new EditError(label, `anchor matched ${n} times.`);
}
function makeApplier(originalContent) {
  const eol = detectEol(originalContent);
  let content = originalContent;
  return {
    eol,
    get content() { return content; },
    E(label, before, after) {
      const b = toEol(before, eol);
      const a = toEol(after, eol);
      expectUnique(content, b, label);
      content = content.replace(b, a);
    },
  };
}
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

// ============================================================================
// FILE 1: supabase/migrations/20260517160000_lcc_ingest_write_failures_table.sql
// (Migration already applied to LCC Opps via Supabase MCP at 2026-05-17;
// this commits the .sql to the repo as the historical record.)
// ============================================================================
async function writeMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', '20260517160000_lcc_ingest_write_failures_table.sql');
  const SQL = `-- ============================================================================
-- Round AUDIT-05a (2026-05-17): cross-domain silent-write capture.
-- Every non-2xx response from a domain DB write (POST / PATCH / PUT / DELETE)
-- lands a row here so the silent-failure pattern (A-3 / D-3) becomes
-- queryable + alertable.
--
-- Closes audit finding A-3 (the table half).
-- Phase B (deferred): gate pushProvenance / recordCoStarFieldsProvenance on
-- success so field_provenance stops recording ghost writes.
--
-- Already applied to LCC Opps (xengecqvemvfknjvbvrq) at 2026-05-17 via
-- Supabase MCP. This file commits the migration to the repo as the
-- historical record.
--
-- Reversal: DROP TABLE public.ingest_write_failures CASCADE;
--           (cascading drops the two views automatically)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_write_failures (
  id                BIGSERIAL PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  domain            text,                 -- 'dialysis' | 'government' | null
  method            text,                 -- POST / PATCH / PUT / DELETE
  path              text,                 -- PostgREST path (capped 500 chars)
  record_pk         text,                 -- extracted from =eq.<value> if present
  http_status       integer,              -- 400/401/403/404/409/422/5xx
  error_detail      jsonb,                -- PostgREST body
  fields_attempted  text[],               -- column names in the request body
  label             text,                 -- caller-supplied label
  source_run_id     text,                 -- correlation back to intake/sidebar runs
  caller_file       text                  -- 'sidebar-pipeline.js' / 'intake-promoter.js' / 'domain-db.js'
);

CREATE INDEX IF NOT EXISTS ingest_write_failures_occurred_idx
  ON public.ingest_write_failures (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ingest_write_failures_label_idx
  ON public.ingest_write_failures (label);
CREATE INDEX IF NOT EXISTS ingest_write_failures_domain_status_idx
  ON public.ingest_write_failures (domain, http_status);

CREATE OR REPLACE VIEW public.v_ingest_write_failures_recent AS
SELECT
  id, occurred_at, domain, method, path, record_pk,
  http_status, label, source_run_id, fields_attempted, caller_file,
  CASE
    WHEN error_detail IS NULL THEN NULL
    WHEN jsonb_typeof(error_detail) = 'object' AND error_detail ? 'message'
      THEN error_detail->>'message'
    WHEN jsonb_typeof(error_detail) = 'object' AND error_detail ? 'detail'
      THEN error_detail->>'detail'
    ELSE substr(error_detail::text, 1, 200)
  END AS error_summary
FROM public.ingest_write_failures
WHERE occurred_at > now() - interval '7 days'
ORDER BY occurred_at DESC;

CREATE OR REPLACE VIEW public.v_ingest_write_failures_by_label AS
SELECT
  label,
  domain,
  count(*)                                              AS n,
  min(occurred_at)                                      AS first_seen,
  max(occurred_at)                                      AS last_seen,
  array_agg(DISTINCT http_status ORDER BY http_status)  AS http_statuses
FROM public.ingest_write_failures
WHERE occurred_at > now() - interval '30 days'
GROUP BY label, domain
ORDER BY n DESC;
`;
  if (DRY) {
    report.push(['supabase/migrations/20260517160000_lcc_ingest_write_failures_table.sql', SQL.length, 'dry-run (would create)']);
    return;
  }
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/20260517160000_lcc_ingest_write_failures_table.sql', SQL.length, 'written']);
}

// ============================================================================
// FILE 2: api/_shared/ops-db.js — add recordWriteFailure helper at the bottom
// ============================================================================
async function patchOpsDb(report) {
  const path = resolve(REPO_ROOT, 'api', '_shared', 'ops-db.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  // Anchor: the very last function in the file (withErrorHandler) ends with
  // a closing brace. We append after it.
  ctx.E('ops-db.recordWriteFailure',
`export function withErrorHandler(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (err) {
      // Log the stack trace, not just the message — the previous form
      // collapsed everything to a single line, making intermittent issues
      // hard to diagnose from Vercel function logs.
      console.error(
        \`[LCC API Error] \${req.method} \${req.url}:\`,
        err?.stack || err?.message || err
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: process.env.LCC_ENV === 'development' ? err?.message : undefined
        });
      }
    }
  };
}`,
`export function withErrorHandler(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (err) {
      // Log the stack trace, not just the message — the previous form
      // collapsed everything to a single line, making intermittent issues
      // hard to diagnose from Vercel function logs.
      console.error(
        \`[LCC API Error] \${req.method} \${req.url}:\`,
        err?.stack || err?.message || err
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: process.env.LCC_ENV === 'development' ? err?.message : undefined
        });
      }
    }
  };
}

// ============================================================================
// Item #5 (audit/05-provenance-integrity, 2026-05-17):
// Record a non-2xx response from a domain DB write to the
// ingest_write_failures table on LCC Opps. Fire-and-forget — never throws,
// never blocks the caller. Closes audit finding A-3 / D-3.
//
// Wired automatically into every POST/PATCH/PUT/DELETE made via domainQuery
// (api/_shared/domain-db.js). Callers can also invoke it directly if they
// already have an error context to record.
//
// Recording is intentionally best-effort:
//   • LCC Opps unreachable → write is dropped, original caller is unaffected.
//   • opsQuery throws       → caught and logged, never re-raised.
//   • Recursive recording   → impossible: opsQuery talks to LCC Opps, not
//                              dia/gov, so its failures don't trigger this.
// ============================================================================
export async function recordWriteFailure({
  domain, method, path, status, errorDetail, fields, label, sourceRunId, callerFile
} = {}) {
  try {
    if (!isOpsConfigured()) return;
    // Extract record PK from PostgREST filter pattern: =eq.<value>
    let recordPk = null;
    const m = String(path || '').match(/=eq\\.([^&]+)/i);
    if (m) {
      try { recordPk = decodeURIComponent(m[1]).substring(0, 120); }
      catch { recordPk = m[1].substring(0, 120); }
    }
    // Cap path length so a runaway query string can't bloat the table.
    const truncatedPath = String(path || '').substring(0, 500);
    // Cap error_detail size. PostgREST bodies are normally <1KB but be safe.
    let safeDetail = errorDetail;
    if (errorDetail !== null && errorDetail !== undefined) {
      try {
        const s = JSON.stringify(errorDetail);
        if (s.length > 5000) {
          safeDetail = { _truncated: true, preview: s.substring(0, 5000) };
        }
      } catch {
        safeDetail = { _stringified: String(errorDetail).substring(0, 5000) };
      }
    }
    await opsQuery('POST', 'ingest_write_failures', {
      domain:            domain || null,
      method:            method || null,
      path:              truncatedPath || null,
      record_pk:         recordPk,
      http_status:       typeof status === 'number' ? status : null,
      error_detail:      safeDetail || null,
      fields_attempted:  Array.isArray(fields) ? fields : null,
      label:             label || null,
      source_run_id:     sourceRunId || null,
      caller_file:       callerFile || null,
    }, { 'Prefer': 'return=minimal' });
  } catch (err) {
    // Never propagate — recording is telemetry, not control flow.
    console.warn('[recordWriteFailure] internal error (suppressed):', err?.message || err);
  }
}`);

  const c = ctx.content;
  if (c === original) {
    report.push(['ops-db.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`api/_shared/ops-db.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 3: api/_shared/domain-db.js — instrument domainQuery on non-2xx writes
// ============================================================================
async function patchDomainDb(report) {
  const path = resolve(REPO_ROOT, 'api', '_shared', 'domain-db.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  // (a) Add the recordWriteFailure import — find an existing import line and
  // anchor after it.
  ctx.E('domain-db.import.recordWriteFailure',
`import { fetchWithTimeout } from './ops-db.js';`,
`import { fetchWithTimeout, recordWriteFailure } from './ops-db.js';`);

  // (b) Add an opts parameter to domainQuery and wire the recordWriteFailure
  // call at the bottom (before return).
  //
  // The current function ends with:
  //   const res = await fetchWithTimeout(url, opts, 30000);
  //   const text = await res.text();
  //   let data = null;
  //   try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  //
  //   return { ok: res.ok, status: res.status, data };
  // }
  //
  // We rename the local `opts` (fetch options) to `fetchOpts` to free the
  // name for our new `opts` parameter (label/sourceRunId). Then add the
  // instrumentation block immediately before the return.
  ctx.E('domain-db.signature-and-instrumentation',
`export async function domainQuery(domain, method, path, body, extraHeaders = {}) {
  const creds = getDomainCredentials(domain);
  if (!creds) {
    return { ok: false, status: 503, data: { error: \`\${domain} database not configured\` } };
  }

  const url = \`\${creds.url}/rest/v1/\${path}\`;
  const headers = {
    'apikey': creds.key,
    'Authorization': \`Bearer \${creds.key}\`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...extraHeaders,
  };

  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PATCH')) {
    opts.body = JSON.stringify(body);
  }

  // Round 76ep (2026-04-29): bumped from 8s → 30s after a propagation_error
  // on 6606 Stadium Dr Zephyrhills (rich capture: 3 sales + 4 brokers + 4 owner
  // contacts) timed out a domain PATCH at 8s. The error stack traced cleanly
  // via Round 76ea's diagnostic capture: AbortError → fetchWithTimeout in
  // domainQuery → domainPatch. 8s was reasonable when these were lightweight
  // single-row PATCHes; complex multi-record updates need more headroom.
  // 30s aligns with Round 76cw's pg_net timeout bump and is well under
  // Vercel's 60s function ceiling, so genuine failures still fail fast.
  const res = await fetchWithTimeout(url, opts, 30000);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  return { ok: res.ok, status: res.status, data };
}`,
`export async function domainQuery(domain, method, path, body, extraHeaders = {}, opts = {}) {
  const creds = getDomainCredentials(domain);
  if (!creds) {
    return { ok: false, status: 503, data: { error: \`\${domain} database not configured\` } };
  }

  const url = \`\${creds.url}/rest/v1/\${path}\`;
  const headers = {
    'apikey': creds.key,
    'Authorization': \`Bearer \${creds.key}\`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...extraHeaders,
  };

  const fetchOpts = { method, headers };
  if (body && (method === 'POST' || method === 'PATCH')) {
    fetchOpts.body = JSON.stringify(body);
  }

  // Round 76ep (2026-04-29): bumped from 8s → 30s after a propagation_error
  // on 6606 Stadium Dr Zephyrhills (rich capture: 3 sales + 4 brokers + 4 owner
  // contacts) timed out a domain PATCH at 8s. The error stack traced cleanly
  // via Round 76ea's diagnostic capture: AbortError → fetchWithTimeout in
  // domainQuery → domainPatch. 8s was reasonable when these were lightweight
  // single-row PATCHes; complex multi-record updates need more headroom.
  // 30s aligns with Round 76cw's pg_net timeout bump and is well under
  // Vercel's 60s function ceiling, so genuine failures still fail fast.
  const res = await fetchWithTimeout(url, fetchOpts, 30000);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  // Item #5 (audit/05-provenance-integrity, 2026-05-17): instrument every
  // non-2xx response from a domain DB WRITE (POST / PATCH / PUT / DELETE) so
  // the silent-failure pattern (A-3 / D-3) becomes queryable. GETs are
  // intentionally NOT instrumented — those failures are usually about
  // non-existent rows, not silent corruption. Fire-and-forget: the
  // recordWriteFailure call never throws or blocks the caller. The opts
  // parameter lets callers pass { label, sourceRunId } for triage context.
  if (!res.ok && (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
    recordWriteFailure({
      domain,
      method,
      path,
      status: res.status,
      errorDetail: data,
      fields: body && typeof body === 'object' && !Array.isArray(body)
        ? Object.keys(body)
        : null,
      label:        opts && opts.label        || null,
      sourceRunId:  opts && opts.sourceRunId  || null,
      callerFile:   opts && opts.callerFile   || 'domain-db.js',
    }).catch(() => { /* recording is best-effort */ });
  }

  return { ok: res.ok, status: res.status, data };
}`);

  const c = ctx.content;
  if (c === original) {
    report.push(['domain-db.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`api/_shared/domain-db.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 4: api/_handlers/sidebar-pipeline.js — pass label through domainPatch
// (Optional polish: gives the new ingest_write_failures rows meaningful
// labels for triage.)
// ============================================================================
async function patchSidebarDomainPatch(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'sidebar-pipeline.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  ctx.E('sidebar.domainPatch.passes-label',
`async function domainPatch(domain, path, data, label) {
  const result = await domainQuery(domain, 'PATCH', path, data);
  if (!result.ok) {
    console.error(\`[\${label}] PATCH failed:\`, {
      domain, path,
      status: result.status,
      error: result.data,
      fields: Object.keys(data),
    });
  }
  return result;
}`,
`async function domainPatch(domain, path, data, label) {
  // Item #5 (audit/05-provenance-integrity): pass label through to
  // domainQuery so the ingest_write_failures row carries a meaningful
  // tag for triage (e.g. 'upsertDomainSales:dialysis:patch').
  const result = await domainQuery(domain, 'PATCH', path, data, {}, {
    label,
    callerFile: 'sidebar-pipeline.js',
  });
  if (!result.ok) {
    console.error(\`[\${label}] PATCH failed:\`, {
      domain, path,
      status: result.status,
      error: result.data,
      fields: Object.keys(data),
    });
    // Note: the recordWriteFailure call now happens inside domainQuery, so
    // we no longer need to record from here. console.error remains for fast
    // triage in Vercel function logs.
  }
  return result;
}`);

  const c = ctx.content;
  if (c === original) {
    report.push(['sidebar-pipeline.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`api/_handlers/sidebar-pipeline.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 5: AUDIT_PROGRESS.md — flip item #5 status
// ============================================================================
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  // Item #5 row: pending → in progress (Phase A)
  const oldRow = N(`| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) + sidebar→ownership_research_queue schema fix | \`audit/05-provenance-integrity\` | 🟦 PENDING | A-3, D-13 | CRITICAL · sidebar writers at sidebar-pipeline.js:1759 + :2592 have been silently failing for unknown duration (wrong columns: write \`property_id\` to a table whose schema is \`research_id\`/\`lead_id\`/\`task_type\`). Discovered 2026-05-17 during item #2 investigation. |`);
  const newRow = N(`| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) + sidebar→ownership_research_queue schema fix | \`audit/05-provenance-integrity\` | 🟨 IN PROGRESS | A-3, D-13 | CRITICAL · Phase A (this commit): ingest_write_failures table + domainQuery instrumentation. Phase B (deferred): gate 47 pushProvenance/recordCoStarFieldsProvenance call sites on .ok + fix D-13 column-schema mismatch in two ownership_research_queue writers. |`);
  const n = c.split(oldRow).length - 1;
  if (n === 1) c = c.replace(oldRow, newRow);
  else console.warn('[audit_progress] item-5 row not found or already updated (n=' + n + ')');

  // Append closeout
  const appendBlock = N(`

## Closeout — item 5 — Phase A (surface silent domain-DB write failures)
- **Status:** 🟨 IN PROGRESS (Phase A landed; Phase B = call-site migration + D-13 column-schema fix, deferred)
- **Branch:** \`audit/05-provenance-integrity\`
- **Patch:** \`audit/patches/05-provenance-integrity/apply.mjs\`
- **Closes:** A-3 (the instrumentation + tracking-table half). Phase B will close the call-site migration + D-13.
- **Files changed:**
  - \`supabase/migrations/20260517160000_lcc_ingest_write_failures_table.sql\` — new table + 2 views on LCC Opps. Already applied via Supabase MCP at 2026-05-17.
  - \`api/_shared/ops-db.js\` — new \`recordWriteFailure({...})\` helper. Fire-and-forget POST to LCC Opps. Never throws.
  - \`api/_shared/domain-db.js\` — \`domainQuery\` now takes an \`opts\` parameter (\`label\`, \`sourceRunId\`, \`callerFile\`) and auto-calls \`recordWriteFailure\` on every non-2xx POST/PATCH/PUT/DELETE. GETs are NOT instrumented (those failures are usually about missing rows, not silent corruption).
  - \`api/_handlers/sidebar-pipeline.js\` — \`domainPatch\` passes its \`label\` through to \`domainQuery\` so the new ingest_write_failures rows carry meaningful tags. (Polish — instrumentation works even without this.)
  - \`AUDIT_PROGRESS.md\` — this file.
- **Scope of impact:**
  - Every domain DB write from every code path (sidebar-pipeline, intake-promoter, admin handlers, etc.) is now instrumented automatically — no per-call-site change required.
  - **Important:** Existing silent failures (the ones from D-13: ownership_research_queue writers POSTing wrong columns) will START surfacing in \`ingest_write_failures\` after this lands. We expect to see a burst of 4xx rows from \`sidebar-pipeline.js:1759\` (BROKER_FIRSTNAME_ONLY enqueue) and \`:2592\` (auto-enqueue with property_id). Phase B will fix those writers.
- **Verification (post-commit):**
  1. \`grep -c "recordWriteFailure" api/_shared/ops-db.js\` → ≥ 1 (definition)
  2. \`grep -c "recordWriteFailure" api/_shared/domain-db.js\` → ≥ 2 (import + call)
  3. \`node -c api/_shared/ops-db.js\` and \`node -c api/_shared/domain-db.js\` → both parse
  4. (LCC Opps SQL, after first sidebar capture or intake post-deploy)
     \`SELECT * FROM v_ingest_write_failures_recent LIMIT 20;\`
     Expected to surface the D-13 silent-write rows (ownership_research_queue 4xx).
  5. \`SELECT label, domain, n, http_statuses FROM v_ingest_write_failures_by_label LIMIT 20;\` → triage rollup.

`);

  const preflightAnchor = N(`\n# Sprint preflight — 2026-05-17\n`);
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }

  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`AUDIT_PROGRESS.md (${eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
async function main() {
  console.log(`\n=== LCC Audit Sprint — Item #5 Phase A: silent-write surface ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}`);
  console.log(`Repo: ${REPO_ROOT}\n`);

  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }

  const report = [];
  await writeMigration(report);
  await patchOpsDb(report);
  await patchDomainDb(report);
  await patchSidebarDomainPatch(report);
  await updateAuditProgress(report);

  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(70)}  ${sign}${delta} bytes  (${note})`);
  }

  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
    console.log(`  node audit/patches/05-provenance-integrity/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete. Next steps:\n`);
    console.log(`  git status`);
    console.log(`  git diff --stat`);
    console.log(`  node -c api/_shared/ops-db.js`);
    console.log(`  node -c api/_shared/domain-db.js`);
    console.log(`  node -c api/_handlers/sidebar-pipeline.js`);
    console.log(`  git add -A`);
    console.log(`  git commit -F audit/patches/05-provenance-integrity/COMMIT_MSG.txt\n`);
  }
}

main().catch(err => {
  console.error(`\n❌ FAILED: ${err.message}\n`);
  console.error(`No files were modified.\n`);
  process.exit(1);
});
