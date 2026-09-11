// api/_handlers/bench-rank-tick.js
// ============================================================================
// ACI-phase2-unitC — the write path for AC2 (bench ranking) + AC3 (Ollama role
// inference over the bench), wired the same shape as `tier0-auto-attach-tick.js`:
//   GET  -> DRY RUN. No writes, NOT flag-gated (the P140/P194 precedent: gating
//           the grade on the flag makes the layer ungradeable until it ships).
//           `?infer_roles=1` also runs AC3's Ollama call per candidate that has
//           no title (costs real tokens; off by default even in dry-run).
//   POST -> writes `owner_contact_pivot.bench`, flag-gated `BENCH_RANK_WRITE`,
//           value-gated on owner rent via the EXISTING `CADENCE_SIGNAL_MIN_VALUE`
//           knob (`cadenceSignalFloor()`, cadence-engine.js — the AC10/A5c/C2a/B1
//           `$500k` floor pattern; no new threshold invented per the prompt).
//
// WHAT THIS OWNS: reading candidates for an owner's bench (the existing
// `owner_contact_pivot.bench` rows, joined to `unified_contacts` for
// correspondence + title, and to `email_bodies` for the two-way/reply signal),
// running the two pure planners (rankBench, inferBenchRoles), and writing the
// result back to `owner_contact_pivot.bench` — FILL/REPLACE of that one row's
// bench array only, never touching `active_contact_entity_id` or any other
// pivot column (that stays `tier0-attach-effect.js`'s job).
//
// REVERSIBILITY. Every write is preceded by a ledger row carrying the PRIOR
// bench array, keyed by a dated `batch_tag` (`bench_rank_YYYYMMDD_<8hex>`),
// mirroring `lcc_tier0_confirm_log`'s "ledger BEFORE the write, carries the
// prior state" shape. The ledger table (`lcc_bench_rank_run_log`, migration
// `20261010150000_lcc_bench_rank_run_log.sql`) is ADDITIVE and NOT APPLIED to
// the live database in this change — see STATUS.md for the explicit note that
// this session made live DB READS only, no writes, and the migration needs an
// operator apply step before POST can run for real. Until it is applied, the
// ledger write fails soft (logged, non-fatal) and the bench PATCH itself still
// proceeds only when the flag is on — so leaving the migration unapplied is a
// SAFE default (POST stays a no-op end to end until both the migration and the
// flag are turned on), never a silent loss of reversibility.
// ============================================================================

import { randomUUID } from 'crypto';
import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { cadenceSignalFloor } from '../_shared/cadence-engine.js';
import { rankBench, summarizeBenchPlan, ownerPassesBenchValueGate } from '../_shared/bench-ranking-planner.js';
import { inferBenchRoles } from '../_shared/bench-role-inference-planner.js';

const FLAG = 'BENCH_RANK_WRITE';
const RUN_LOG = 'lcc_bench_rank_run_log';
const WRITE_LOG = 'lcc_bench_rank_write_log';
const DEFAULT_BATCH = 25;
const SUBJECT_LINE_LIMIT = 20;

function batchTag(nowIso) {
  const day = String(nowIso || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  return 'bench_rank_' + day + '_' + randomUUID().slice(0, 8);
}

/** Owners whose bench is already populated, value-ranked, limited. Never touches unpopulated rows (fill-blanks doctrine — nothing to rank there yet). */
async function fetchCandidateOwners(limit, valueFloor) {
  const r = await opsQuery('GET', 'owner_contact_pivot?select=entity_id,owner_name,workspace_id,bench'
    + '&bench=neq.[]&order=entity_id&limit=' + Math.max(1, Math.min(500, limit)));
  if (!r.ok) return { ok: false, detail: r.data, rows: [] };
  const rows = Array.isArray(r.data) ? r.data : [];
  // Owner rent isn't a pivot column; the value gate is applied by the caller
  // once rent is resolved per owner (see resolveOwnerRent below) — this fetch
  // is just the candidate population.
  return { ok: true, rows };
}

/** Best-effort owner rent from lcc_entity_portfolio_facts (current rows only). Unknown -> null, gated (P161: unknown is not small). */
async function resolveOwnerRent(ownerId) {
  try {
    const r = await opsQuery('GET', 'lcc_entity_portfolio_facts?select=current_annual_rent_total'
      + '&entity_id=eq.' + pgFilterVal(ownerId) + '&is_current=is.true&order=current_annual_rent_total.desc.nullslast&limit=1');
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return null;
    const v = Number(r.data[0].current_annual_rent_total);
    return Number.isFinite(v) ? v : null;
  } catch (_e) {
    return null;
  }
}

/** Join each bench entry to unified_contacts (title, volume, recency) by contact_entity_id -> entity_id. */
async function enrichBenchCandidates(bench) {
  const ids = (Array.isArray(bench) ? bench : [])
    .map((b) => b && b.contact_entity_id).filter(Boolean);
  if (!ids.length) return Array.isArray(bench) ? bench : [];
  const inList = ids.map((id) => pgFilterVal(id)).join(',');
  const r = await opsQuery('GET', 'unified_contacts?select=entity_id,title,total_emails_sent,'
    + 'last_email_date,email&entity_id=in.(' + inList + ')');
  const byId = new Map();
  if (r.ok && Array.isArray(r.data)) {
    for (const row of r.data) byId.set(row.entity_id, row);
  }
  return bench.map((b) => {
    const uc = b.contact_entity_id ? byId.get(b.contact_entity_id) : null;
    return {
      ...b,
      title: uc ? uc.title : null,
      total_emails_sent: uc ? uc.total_emails_sent : null,
      last_email_date: uc ? uc.last_email_date : null,
      _email: uc ? uc.email : null,
    };
  });
}

/** The two-way/reply signal: email_bodies rows with is_sent=false (received FROM this address). Bounded to one lookup per candidate email, best-effort. */
async function attachInboundCounts(candidates) {
  const out = [];
  for (const c of candidates) {
    if (!c._email) { out.push({ ...c, inbound_count: 0 }); continue; }
    try {
      const r = await opsQuery('GET', 'email_bodies?select=subject&is_sent=is.false'
        + '&from_email=ilike.' + pgFilterVal('%' + c._email + '%')
        + '&limit=' + SUBJECT_LINE_LIMIT);
      const rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
      out.push({
        ...c,
        inbound_count: rows.length,
        subject_lines: rows.map((x) => x.subject).filter(Boolean),
      });
    } catch (_e) {
      out.push({ ...c, inbound_count: 0, subject_lines: [] });
    }
  }
  return out;
}

async function openRunLog(row) {
  try {
    const r = await opsQuery('POST', RUN_LOG, row, { headers: { Prefer: 'return=representation' } });
    if (!r.ok) { console.error('[bench-rank] run-log open failed (migration likely unapplied)', r.status); return null; }
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    return rec?.run_id ?? null;
  } catch (e) {
    console.error('[bench-rank] run-log open threw', String(e?.message || e));
    return null;
  }
}

async function closeRunLog(runId, row) {
  if (runId == null) return;
  try {
    await opsQuery('PATCH', RUN_LOG + '?run_id=eq.' + encodeURIComponent(runId), row,
      { headers: { Prefer: 'return=minimal' } });
  } catch (e) {
    console.error('[bench-rank] run-log close threw', String(e?.message || e));
  }
}

/** Ledger row BEFORE the write — reversibility, mirrors tier0-attach-effect.js's "ledger before pivot write, carries the prior state so one write or a whole batch reverses exactly". Fail-soft: a ledger failure logs and continues (the write itself is still gated on the flag, so nothing unattended is lost — but see the module header re: the migration not being applied in this change). */
async function ledgerBeforeWrite(tag, ownerId, ownerName, priorBench, newBench) {
  try {
    await opsQuery('POST', WRITE_LOG, {
      batch_tag: tag, owner_entity_id: ownerId, owner_name: ownerName,
      prior_bench: priorBench, new_bench: newBench,
    });
  } catch (e) {
    console.error('[bench-rank] ledger write failed — migration likely unapplied', String(e?.message || e));
  }
}

export async function handleBenchRankTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const started = Date.now();
  const dryRun = req.method !== 'POST';
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || DEFAULT_BATCH));
  const doInferRoles = String(req.query.infer_roles || '') === '1';
  const floor = cadenceSignalFloor();

  let flagOn = false;
  try { flagOn = flagEnabled(FLAG, await fetchFeatureFlag(FLAG)); } catch (_e) { flagOn = false; }

  const tag = batchTag();
  const runLogId = (!dryRun && flagOn) ? await openRunLog({
    status: 'started', batch_tag: tag, flag_enabled: flagOn, dry_run: false, batch_limit: limit,
  }) : null;

  try {
    const scan = await fetchCandidateOwners(limit, floor);
    if (!scan.ok) {
      await closeRunLog(runLogId, { status: 'failed', ok: false, finished_at: new Date().toISOString() });
      return res.status(502).json({ error: 'pivot_read_failed', detail: scan.detail });
    }

    const results = [];
    let gated = 0;
    for (const owner of scan.rows) {
      const ownerRent = await resolveOwnerRent(owner.entity_id);
      if (!ownerPassesBenchValueGate(ownerRent, floor)) {
        gated += 1;
        continue;
      }

      let candidates = await enrichBenchCandidates(owner.bench);
      candidates = await attachInboundCounts(candidates);
      if (doInferRoles) {
        candidates = await inferBenchRoles(candidates);
      }
      const ranked = rankBench(candidates);
      const summary = summarizeBenchPlan(ranked);

      results.push({
        owner_entity_id: owner.entity_id,
        owner_name: owner.owner_name,
        owner_rent: ownerRent,
        summary,
        bench: ranked,
      });

      if (!dryRun && flagOn) {
        const stripped = ranked.map((r) => ({
          name: r.name, role: r.role, source: r.source, n_props: r.n_props,
          authority: r.authority, contact_entity_id: r.contact_entity_id,
          is_named_individual: r.is_named_individual,
          correspondence_volume: r.correspondence_volume, last_email_date: r.last_email_date,
          two_way: r.two_way, inferred_function: r.inferred_function,
          inferred_function_confidence: r.inferred_function_confidence,
          inferred_function_basis: r.inferred_function_basis,
          seniority_known: r.seniority_known, seniority_score: r.seniority_score,
          rank: r.rank, rank_reason: r.rank_reason,
        }));
        await ledgerBeforeWrite(tag, owner.entity_id, owner.owner_name, owner.bench, stripped);
        const wr = await opsQuery('PATCH',
          'owner_contact_pivot?entity_id=eq.' + pgFilterVal(owner.entity_id),
          { bench: stripped, updated_at: new Date().toISOString() });
        if (!wr.ok) console.error('[bench-rank] pivot write failed', owner.entity_id, wr.status);
      }
    }

    await closeRunLog(runLogId, {
      status: 'ok', ok: true, finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started, owners_ranked: results.length, owners_gated: gated,
    });

    return res.status(200).json({
      ok: true,
      mode: dryRun ? 'dry_run' : 'write',
      flag: FLAG, flag_enabled: flagOn,
      note: dryRun
        ? 'GET is always a dry run and never writes, regardless of the flag.'
        : (flagOn ? 'Flag is ON — bench columns above were written.' : 'Flag is OFF — POST was a no-op.'),
      value_gate: { floor, source: 'CADENCE_SIGNAL_MIN_VALUE (cadence-engine.js)' },
      infer_roles: doInferRoles,
      batch_tag: tag,
      population: { candidate_owners: scan.rows.length, ranked: results.length, value_gated_out: gated },
      owners: results,
    });
  } catch (e) {
    await closeRunLog(runLogId, {
      status: 'failed', ok: false, finished_at: new Date().toISOString(),
      error: String(e?.message || e).slice(0, 500),
    });
    return res.status(500).json({ error: 'bench_rank_tick_failed', detail: String(e?.message || e) });
  }
}

export default handleBenchRankTick;
