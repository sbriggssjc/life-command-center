#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #10 Phase B: client_errors telemetry loop.
//
// Phase A (shipped earlier) added:
//   • lccReportError(label, err, options) helper
//   • Global window.error + unhandledrejection handlers
//   • Toast tier styles (.toast.ok, .toast.warn) + tag chip
//
// Phase B completes the telemetry loop:
//   • New table public.client_errors on LCC Opps (already applied via MCP).
//   • New admin sub-route POST /api/admin?_route=client-error that accepts
//     a batch of error records and inserts them.
//   • lccReportError now buffers errors and flushes them to the endpoint
//     in batches of up to 10, every 30s OR on beforeunload (whichever
//     first). Fire-and-forget — telemetry never breaks control flow.
//
// Design choices:
//   • Batched + interval-flushed so a runaway error loop doesn't translate
//     into 1 HTTP POST per error.
//   • Drops the batch silently on POST failure (matches the rate-limited
//     toast philosophy from Phase A — telemetry is observation, not
//     control flow).
//   • Skips POST when LCC_USER.workspace_id is missing (pre-auth boot
//     phase) so we don't write orphan rows.
//   • Stack truncated to 4000 chars to keep payloads small.
//   • Only POSTs tier 'error' and 'warn' by default; 'info' / 'ok' stay
//     local-only (configurable via _LCC_ERR_REPORTED_TIERS).
//
// Branch: audit/10B-client-errors-telemetry
// ============================================================================

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf   = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
async function replaceUnique(path, oldStr, newStr, report, label) {
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}
async function writeFileEnsuringDir(path, content, report, label) {
  if (DRY) { report.push([label, content.length, 'dry-run']); return; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  report.push([label, content.length, 'written']);
}

// ─── Migration: client_errors table on LCC Opps (already applied via MCP,
//     committed here for repo provenance) ───
async function writeMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', '20260517260000_lcc_client_errors_table.sql');
  const SQL = `-- ============================================================================
-- Item #10 Phase B (2026-05-17): client_errors table for browser-side
-- error telemetry. Companion to ingest_write_failures (server-side).
--
-- Powered by lccReportError in app.js. Fire-and-forget POSTs from the
-- browser flow into /api/admin?_route=client-error, which buffers them
-- here for historical analysis.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_errors (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID,
  user_email    TEXT,
  user_agent    TEXT,
  url           TEXT,
  label         TEXT NOT NULL,
  tier          TEXT NOT NULL CHECK (tier IN ('error','warn','info','ok')),
  code          TEXT,
  message       TEXT,
  stack         TEXT,
  detail        JSONB,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_errors_label_time
  ON public.client_errors (label, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_errors_workspace_time
  ON public.client_errors (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_errors_tier_time
  ON public.client_errors (tier, occurred_at DESC);

COMMENT ON TABLE public.client_errors IS
  'Item #10 Phase B (2026-05-17): browser-side error telemetry. '
  'Companion to ingest_write_failures. Fire-and-forget writes from '
  'lccReportError in app.js via /api/admin?_route=client-error.';

-- Convenience view: rolling 24h error volume by label.
CREATE OR REPLACE VIEW public.v_client_error_rollup AS
SELECT
  label,
  tier,
  count(*)                            AS total,
  count(DISTINCT user_email)          AS distinct_users,
  count(DISTINCT workspace_id)        AS distinct_workspaces,
  min(occurred_at)                    AS first_seen,
  max(occurred_at)                    AS last_seen,
  array_agg(DISTINCT code ORDER BY code) FILTER (WHERE code IS NOT NULL) AS sample_codes
FROM public.client_errors
WHERE occurred_at > now() - interval '24 hours'
GROUP BY label, tier
ORDER BY total DESC;
`;
  await writeFileEnsuringDir(path, SQL, report,
    'supabase/migrations/20260517260000_lcc_client_errors_table.sql');
}

// ─── api/admin.js: add 'client-error' route to dispatcher + handler ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  // 1. Add route case to the dispatcher (right next to next-best-action).
  await replaceUnique(path,
    `    case 'next-best-action':        return handleNextBestAction(req, res);
    default:`,
    `    case 'next-best-action':        return handleNextBestAction(req, res);
    case 'client-error':            return handleClientErrorReport(req, res);
    default:`,
    report, 'api/admin.js (client-error dispatch case)');

  // 2. Add the handler function. Anchor on the end of handleNextBestAction
  //    so the new handler sits next to its conceptual neighbor.
  await replaceUnique(path,
    `// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    `// ============================================================================
// CLIENT ERROR REPORT — Item #10 Phase B (2026-05-17)
//
// POST /api/admin?_route=client-error
//   Body: { batch: [<errorRecord>, ...] }
//
//   errorRecord: { label, tier, code?, message?, stack?, detail?,
//                  url?, user_agent?, occurred_at? }
//
// Fire-and-forget telemetry endpoint. Buffers browser-side errors
// captured by lccReportError into public.client_errors on LCC Opps.
// Never blocks the caller; returns 200 even on partial-insert errors
// so the client's flush loop doesn't churn on retries.
// ============================================================================
async function handleClientErrorReport(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const batch = Array.isArray(body.batch) ? body.batch : [];
  if (batch.length === 0) {
    return res.status(200).json({ ok: true, inserted: 0, reason: 'empty_batch' });
  }
  // Cap batch size so a runaway client can't blast us.
  const capped = batch.slice(0, 50);

  const workspaceId = (req.headers['x-lcc-workspace'] || '').trim()
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;

  // Normalize records — clamp string lengths, validate tier, drop garbage.
  const ALLOWED_TIERS = new Set(['error', 'warn', 'info', 'ok']);
  const rows = capped.map(r => {
    if (!r || typeof r !== 'object') return null;
    const tier = typeof r.tier === 'string' && ALLOWED_TIERS.has(r.tier.toLowerCase())
      ? r.tier.toLowerCase()
      : 'error';
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 200) : null;
    if (!label) return null;
    return {
      workspace_id: workspaceId,
      user_email:   (user.email || r.user_email || null) ? String(user.email || r.user_email).slice(0, 200) : null,
      user_agent:   r.user_agent ? String(r.user_agent).slice(0, 500) : null,
      url:          r.url ? String(r.url).slice(0, 500) : null,
      label,
      tier,
      code:         r.code ? String(r.code).slice(0, 32) : null,
      message:      r.message ? String(r.message).slice(0, 2000) : null,
      stack:        r.stack ? String(r.stack).slice(0, 4000) : null,
      detail:       (r.detail && typeof r.detail === 'object') ? r.detail : null,
      occurred_at:  r.occurred_at && /^[0-9]{4}-/.test(String(r.occurred_at)) ? r.occurred_at : new Date().toISOString(),
    };
  }).filter(Boolean);

  if (rows.length === 0) {
    return res.status(200).json({ ok: true, inserted: 0, reason: 'no_valid_rows' });
  }

  try {
    const { opsQuery } = await import('./_shared/ops-db.js');
    const r = await opsQuery('POST', 'client_errors', rows, { 'Prefer': 'return=minimal' });
    if (!r.ok) {
      console.warn('[client-error] insert failed:', r.status, r.data);
      return res.status(200).json({ ok: false, inserted: 0, status: r.status });
    }
    return res.status(200).json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.warn('[client-error] handler threw:', err?.message || err);
    return res.status(200).json({ ok: false, inserted: 0, error: 'exception' });
  }
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    report, 'api/admin.js (handleClientErrorReport)');
}

// ─── app.js: wire lccReportError to buffer + flush ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  // Insert the buffer/flush logic + lccReportError hook right after the
  // existing lccErrorStats accessor (end of Phase A block).
  await replaceUnique(path,
    `// Diagnostic accessor — call from devtools to see what's been rate-limited.
window.lccErrorStats = function () {
  const out = {};
  _lccErrRateState.forEach((v, k) => { out[k] = { count: v.count, lastShownAt: new Date(v.lastShown).toISOString() }; });
  return out;
};`,
    `// Diagnostic accessor — call from devtools to see what's been rate-limited.
window.lccErrorStats = function () {
  const out = {};
  _lccErrRateState.forEach((v, k) => { out[k] = { count: v.count, lastShownAt: new Date(v.lastShown).toISOString() }; });
  return out;
};

// ============================================================================
// CLIENT-ERROR TELEMETRY — Item #10 Phase B (2026-05-17)
//
// Buffer browser-side errors captured by lccReportError, flush to
// /api/admin?_route=client-error in batches every 30s or on
// beforeunload (whichever first). Fire-and-forget: telemetry never
// breaks control flow.
// ============================================================================
const _LCC_ERR_FLUSH_INTERVAL_MS = 30000;
const _LCC_ERR_BATCH_MAX = 10;
const _LCC_ERR_REPORTED_TIERS = new Set(['error', 'warn']); // 'info' / 'ok' stay local
const _lccErrBuffer = [];

function _lccQueueClientError(record) {
  if (!record || !record.tier || !_LCC_ERR_REPORTED_TIERS.has(record.tier)) return;
  _lccErrBuffer.push(record);
  if (_lccErrBuffer.length >= _LCC_ERR_BATCH_MAX) {
    // Drain immediately on a full batch so a fast error storm doesn't
    // wait for the timer.
    _lccFlushClientErrors();
  }
}

async function _lccFlushClientErrors() {
  if (_lccErrBuffer.length === 0) return;
  // Pre-auth boot: no workspace_id yet means our POST would be orphaned.
  // Hold the buffer for the next flush — but cap it so a long pre-auth
  // session doesn't OOM us.
  if (!LCC_USER || !LCC_USER.workspace_id) {
    if (_lccErrBuffer.length > 100) _lccErrBuffer.splice(0, _lccErrBuffer.length - 100);
    return;
  }
  const batch = _lccErrBuffer.splice(0, _lccErrBuffer.length);
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    await fetch('/api/admin?_route=client-error', {
      method:    'POST',
      headers,
      body:      JSON.stringify({ batch }),
      keepalive: true, // survives page unload
    });
  } catch (e) {
    // Swallow — telemetry never breaks control flow. Buffer is already
    // drained so we don't loop on a dead endpoint.
    console.debug('[lccReportError] flush failed (suppressed):', e && e.message);
  }
}

// Periodic flush + on-unload safety net.
setInterval(_lccFlushClientErrors, _LCC_ERR_FLUSH_INTERVAL_MS);
window.addEventListener('beforeunload', _lccFlushClientErrors);
// Also flush when tab regains focus, so errors that piled up during
// background time don't sit indefinitely.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _lccFlushClientErrors();
});
// Expose for devtools-driven manual flush + buffer inspection.
window.lccFlushErrors = _lccFlushClientErrors;
window.lccErrorBuffer = () => _lccErrBuffer.slice();`,
    report, 'app.js (client-error buffer + flush)');

  // Hook lccReportError to also queue the record. Anchor on the user-facing
  // toast block at the end of the function, just before the closing return.
  await replaceUnique(path,
    `  if (typeof showToast === 'function') {
    try { showToast(userMessage, tier); } catch (e) { console.warn('[LCC] showToast failed', e); }
  }
  return code;
}
window.lccReportError = lccReportError;`,
    `  if (typeof showToast === 'function') {
    try { showToast(userMessage, tier); } catch (e) { console.warn('[LCC] showToast failed', e); }
  }

  // Item #10 Phase B: queue for telemetry POST (fire-and-forget).
  // Buffered + batched in _lccFlushClientErrors so error storms don't
  // translate into one POST per error.
  try {
    if (typeof _lccQueueClientError === 'function') {
      _lccQueueClientError({
        label:       lbl,
        tier,
        code,
        message:     detail ? String(detail).slice(0, 2000) : null,
        stack:       (err && err.stack) ? String(err.stack).slice(0, 4000) : null,
        url:         typeof location !== 'undefined' ? location.pathname + location.search : null,
        user_agent:  typeof navigator !== 'undefined' ? navigator.userAgent : null,
        occurred_at: new Date().toISOString(),
      });
    }
  } catch (_) { /* never break the reporter itself */ }

  return code;
}
window.lccReportError = lccReportError;`,
    report, 'app.js (lccReportError telemetry hook)');
}

// ─── AUDIT_PROGRESS.md: append closeout entry ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 10 Phase B — client_errors telemetry loop
- **Status:** ✅ DONE
- **Branch:** \`audit/10B-client-errors-telemetry\`
- **Patch:** \`audit/patches/10B-client-errors-telemetry/apply.mjs\`
- **Closes:** Item #10 telemetry half — completes the loop started in Phase A.

### What this adds

**1. New table** \`public.client_errors\` on LCC Opps (applied via MCP). Companion to \`ingest_write_failures\` (server-side). Columns:
\`\`\`
id, workspace_id, user_email, user_agent, url, label, tier,
code, message, stack, detail, occurred_at, reported_at
\`\`\`
Plus 3 indexes (label/time, workspace/time, tier/time) and a convenience view \`v_client_error_rollup\` for 24h volume-by-label aggregation.

**2. New admin sub-route** \`POST /api/admin?_route=client-error\`:
- Accepts \`{ batch: [...] }\` of up to 50 error records.
- Normalizes + clamps each row (label ≤ 200 chars, stack ≤ 4000, message ≤ 2000, etc.).
- Validates \`tier\` against the CHECK list.
- Returns 200 even on partial-insert failure so the client doesn't retry-loop.

**3. Browser-side buffer + flush** in \`app.js\`:
- \`lccReportError\` now queues each error into a buffer.
- Drain happens automatically every 30s, on \`beforeunload\`, on \`visibilitychange → visible\`, or immediately when the buffer hits 10 entries.
- Only tiers \`'error'\` and \`'warn'\` are reported (info/ok stay local).
- Uses \`fetch(..., { keepalive: true })\` so errors survive page unload.
- Skips POST when no \`workspace_id\` is set (pre-auth boot) and holds the buffer for the next flush, capped at 100 to prevent OOM.

**4. Diagnostic accessors** added to \`window\`:
- \`window.lccFlushErrors()\` — force an immediate flush from devtools.
- \`window.lccErrorBuffer()\` — snapshot of the pending queue.
- \`window.lccErrorStats()\` — Phase A's rate-limit stats accessor (unchanged).

### Files changed
- \`supabase/migrations/20260517260000_lcc_client_errors_table.sql\` — new migration (already applied via MCP, committed for repo provenance)
- \`api/admin.js\` — dispatcher case + handler \`handleClientErrorReport\`
- \`app.js\` — buffer + flush + lccReportError telemetry hook
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "_lccQueueClientError" app.js\` → 2 or more
2. \`grep -c "handleClientErrorReport" api/admin.js\` → 2 or more
3. \`grep -c "case 'client-error'" api/admin.js\` → 1
4. Smoke (in devtools after deploy):
   \`\`\`js
   setTimeout(() => { throw new Error('telemetry smoke'); }, 0);
   await new Promise(r => setTimeout(r, 200));
   lccFlushErrors();
   \`\`\`
5. On LCC Opps via Studio:
   \`\`\`sql
   SELECT * FROM public.client_errors ORDER BY id DESC LIMIT 5;
   -- Should show a row with label='JS error', message containing 'telemetry smoke',
   -- tier='error', and user_email/workspace_id populated.
   \`\`\`
6. Volume rollup:
   \`\`\`sql
   SELECT * FROM public.v_client_error_rollup LIMIT 10;
   \`\`\`

### Phase C follow-ups
- Sweep the ~50 ad-hoc \`console.warn + showToast\` sites and migrate them to \`lccReportError\` so they also feed the new telemetry table.
- Add a Settings page widget that surfaces the user's recent error volume and links to clear / report.
- Build a "top errors this week" admin dashboard reading from \`v_client_error_rollup\`.
- Optional: server-side alerting when a label's volume exceeds a threshold within a window (cron + Slack webhook).

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) { report.push(['AUDIT_PROGRESS.md', 0, 'no changes']); return; }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #10 Phase B (client_errors telemetry) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeMigration(report);
  await patchAdminJs(report);
  await patchAppJs(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(75) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
