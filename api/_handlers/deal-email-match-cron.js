// api/_handlers/deal-email-match-cron.js
// ============================================================================
// W7.1 — recurring deal-email-matcher cron wrapper.
// See docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md (W7.1).
//
// Route: POST /api/pipeline/match-deal-emails-cron  (X-LCC-Key auth, mounted in server.js)
//   Scheduled by pg_cron job `lcc-deal-email-match` (hourly) → lcc_cron_post.
//
// It runs the SAME matcher engine as /api/pipeline/match-deal-emails (no logic
// fork — imports makeDealEmailMatcherRoute), then:
//   • writes ONE lcc_deal_match_run_log row per run (observable stats line);
//   • prints a stats line to the console;
//   • on a run that fails AND whose previous run also failed, opens a DEDUPED
//     lcc_health_alerts row (alert_kind='cron_failure', source='deal_email_matcher')
//     so a repeatedly-broken matcher surfaces loudly like every other cron.
//
// GATE: no-ops unless DEAL_EMAIL_MATCH_ENABLED is set (the feature_flags_registry
// DEAL_EMAIL_MATCH_CRON flag). This is Scott's approval switch — the pg_cron job
// posts hourly from the moment the migration lands, but nothing runs until the
// env flag is flipped in Railway. `?force=1` (or body {force:true}) overrides the
// gate for a one-off manual/approval run. `?dry_run=1` runs the matcher's dry-run
// report and writes nothing but the log row.
//
// Never throws — always returns 200 with a JSON envelope.
// ============================================================================
import { opsQuery } from '../_shared/ops-db.js';
import { makeDealEmailMatcherRoute } from '../../mcp/deal-email-matcher.js';

const enc = (v) => encodeURIComponent(String(v));

// ── opsQuery compat shim for the matcher engine ──────────────────────────────
// makeDealEmailMatcherRoute was written against mcp/server.js's supabaseQuery:
//   opsQuery(method, path, body, prefer)  — 4th arg is a Prefer STRING.
// api/_shared/ops-db.js's opsQuery is:
//   opsQuery(method, path, body, opts)    — 4th arg is an opts OBJECT.
// The shim bridges the contract exactly (so we don't fork the matcher) AND fixes
// the live crash:
//   • Root cause — ops-db's GET default is `Prefer: count=exact`, forcing an
//     exact COUNT over activity_events (22k+ rows) on every per-deal candidate
//     query. That count now hits the statement timeout and PostgREST returns a
//     5xx error OBJECT (non-array) as `.data`. The matcher does
//     `for (const m of (cand.data || []))`, and `for…of` over a truthy non-array
//     throws "object is not iterable" — killing the whole run. The matcher never
//     reads `.count`, so we request `countMode:'none'` and the exact count (and
//     its timeout) disappears.
//   • Defense in depth — if any GET still returns a non-array `.data`, coerce it
//     to [] so one failed read degrades to "no candidates" instead of crashing.
async function engineOpsQuery(method, path, body, prefer) {
  const opts = { countMode: 'none' };
  if (prefer) opts.headers = { Prefer: prefer };
  const r = await opsQuery(method, path, body, opts);
  if (method === 'GET' && r && r.data != null && !Array.isArray(r.data)) {
    console.warn('[deal-email-match-cron] non-array GET data coerced to []', {
      path: String(path).slice(0, 80), status: r.status, ok: r.ok,
    });
    return { ...r, data: [], _nonArrayData: r.data };
  }
  return r;
}
const WORKSPACE_ID =
  process.env.LCC_PRIMARY_WORKSPACE_ID
  || process.env.LCC_DEFAULT_WORKSPACE_ID
  || 'a0000000-0000-0000-0000-000000000001';

// Capture the matcher's res.json() output without an HTTP round-trip.
function captureRes() {
  const out = { status: 200, body: null };
  return {
    res: {
      status(code) { out.status = code; return this; },
      json(payload) { out.body = payload; return this; },
    },
    out,
  };
}

async function writeRunLog(row) {
  try {
    const r = await opsQuery('POST', 'lcc_deal_match_run_log',
      row, { Prefer: 'return=representation' });
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    return rec?.run_id || null;
  } catch (_e) { return null; }
}

// Open a deduped cron_failure alert only on REPEATED failure (this run + the
// prior run both failed), so a single transient blip doesn't page.
async function maybeOpenAlert(summary) {
  try {
    const prev = await opsQuery('GET',
      'lcc_deal_match_run_log?dry_run=eq.false&order=run_id.desc&limit=2&select=ok');
    const rows = prev.data || [];
    // rows[0] is the run we just inserted (ok=false); rows[1] is the prior run.
    const priorFailed = rows.length >= 2 && rows[1]?.ok === false;
    if (!priorFailed) return false;
    // Dedup: skip if an unresolved alert already exists.
    const open = await opsQuery('GET',
      "lcc_health_alerts?alert_kind=eq.cron_failure&source=eq.deal_email_matcher&resolved_at=is.null&select=alert_id&limit=1");
    if (open.data?.[0]?.alert_id) return false;
    await opsQuery('POST', 'lcc_health_alerts', {
      alert_kind: 'cron_failure', source: 'deal_email_matcher', severity: 'warning',
      summary: 'Deal-email matcher failed on two consecutive runs',
      details: { error: summary.error ?? null, errors: (summary.errors || []).slice(0, 10),
                 error_count: (summary.errors || []).length || (summary.error ? 1 : 0) },
    });
    return true;
  } catch (_e) { return false; }
}

export async function handleDealEmailMatchCron(req, res) {
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const force = q.force === '1' || q.force === 'true' || q.force === true;
  const dryRun = q.dry_run === '1' || q.dry_run === 'true' || q.dry_run === true;
  const triggerSource = q.source || (req.query && Object.keys(req.query).length ? 'api' : 'cron');

  const enabled = !!process.env.DEAL_EMAIL_MATCH_ENABLED;
  if (!enabled && !force && !dryRun) {
    return res.status(200).json({
      ok: true, skipped: 'flag_off',
      hint: 'Set DEAL_EMAIL_MATCH_ENABLED in Railway (feature_flags_registry: DEAL_EMAIL_MATCH_CRON) to enable, or call with ?force=1 for a one-off run.',
    });
  }

  try {
    const matcher = makeDealEmailMatcherRoute({ opsQuery: engineOpsQuery, enc, WORKSPACE_ID });
    const { res: mockRes, out } = captureRes();
    await matcher.match({ query: { dry_run: dryRun ? 1 : 0 }, body: {} }, mockRes);
    const s = out.body || {};
    // The matcher's own outer catch returns { ok:false, error } WITHOUT any
    // summary/stats, and a non-200 status is itself a failure. Treat either as
    // not-ok, and always persist the error + HTTP status into detail so a
    // setup-phase crash (no stats yet) is visible in the run log — the exact gap
    // that made the count=exact crash invisible.
    const errorCount = Array.isArray(s.errors) ? s.errors.length : (s.error ? 1 : 0);
    const ok = out.status === 200 && s.ok !== false && errorCount === 0;

    const detail = dryRun
      ? { status: out.status, deals: (s.deals || []).slice(0, 40) }
      : { status: out.status, error: s.error ?? null, errors: (s.errors || []).slice(0, 20) };

    const runId = await writeRunLog({
      trigger_source: triggerSource, dry_run: !!dryRun,
      deals_scanned: s.deals_scanned ?? null, deals_with_matches: s.deals_with_matches ?? null,
      emails_attributed: s.emails_attributed ?? null, already_attributed: s.already_attributed ?? null,
      roster_edges: s.roster_edges ?? null, digest_excluded: s.digest_excluded ?? null,
      skipped_thin: s.skipped_thin_tokens ?? null, error_count: errorCount, ok,
      detail,
    });

    console.log(`[deal-email-match-cron] ok=${ok} dry_run=${!!dryRun} scanned=${s.deals_scanned ?? '-'} ` +
      `with_matches=${s.deals_with_matches ?? '-'} attributed=${s.emails_attributed ?? '-'} ` +
      `already=${s.already_attributed ?? '-'} roster_edges=${s.roster_edges ?? '-'} ` +
      `digest_excluded=${s.digest_excluded ?? '-'} skipped_thin=${s.skipped_thin_tokens ?? '-'} errors=${errorCount}`);

    let alertOpened = false;
    if (!ok && !dryRun) alertOpened = await maybeOpenAlert(s);

    return res.status(200).json({ ok, run_id: runId, dry_run: !!dryRun, alert_opened: alertOpened, ...s });
  } catch (e) {
    await writeRunLog({ trigger_source: triggerSource, dry_run: !!dryRun, error_count: 1, ok: false,
      detail: { error: String(e?.message || e).slice(0, 300) } });
    console.error('[deal-email-match-cron] threw:', e?.message || e);
    return res.status(200).json({ ok: false, reason: 'match_cron_error', detail: String(e?.message || e).slice(0, 300) });
  }
}
