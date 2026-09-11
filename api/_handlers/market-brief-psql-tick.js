// ============================================================================
// MB1 — the P-SQL market-brief producer (on-box structured facts, dialysis
// lane first).
//
//   GET  -> dry run. Reads the same sources, builds the same candidate facts,
//           and reports what WOULD be written/superseded/conflicted — no
//           writes, no producer_runs row (unless ?apply-shaped via force, see
//           below), following the OC2/P138 GET=report convention.
//   POST -> apply (flag-gated MARKET_BRIEF_PSQL). Logs to producer_runs on
//           the P123 lifecycle (opened before the work, closed on the way
//           out) and writes/supersedes/conflict-marks market_brief_facts.
//
// SOURCES (dialysis lane; MB-a2 fixed all four against the LIVE schema —
// MB-a's column names were guessed from docs and never checked live):
//   - The dia comps engine's OWN RPC — `rpc/rpc_query_comps` (the same RPC
//     `query_comps` / the comps-engine skill / mcp/comps-tools.js call), via
//     domainQuery('dialysis','POST','rpc/rpc_query_comps', …). This is the
//     shared, de-duplicated, cap-normalized source of truth — calling the RPC
//     directly (not the JS runComps() pipeline, which adds scoring/appraisal
//     machinery this producer doesn't need) guarantees the cap-rate band
//     agrees with every other comps surface, by construction: same
//     `cap_rate_final`-coalesced column, same `exclude_from_market_metrics`
//     filter, same `transaction_state='live'` gate. No runtime dependency on
//     mcp/server.js (the RPC is a plain Postgres function reached over
//     PostgREST, exactly like every other domainQuery call this file makes).
//   - Dialysis_DB.v_dia_on_market for on-market count + median ask cap. The
//     view's cap-rate column is `current_cap_rate` (verified live 2026-09-11
//     — MB-a assumed a bare `cap_rate`, which the view does not carry, and
//     the request 400'd).
//   - Dialysis_DB.v_market_brief_cms_operator_counts (migration
//     20260911190000_dia_mba2_cms_operator_counts_view.sql) for CMS clinic
//     counts by operator. MB-a counted client-side over a raw
//     `medicare_clinics` select capped at `&limit=1000` against 6,695
//     eligible rows (verified live) — a SILENT truncation to ~15% of the
//     population that would have produced plausible-looking, wrong operator
//     counts with no error. The view aggregates server-side over the WHOLE
//     table (32 distinct operators, verified live — well under any
//     PostgREST page cap), so the client-side read can never truncate again.
//
// TRUNCATION TRIPWIRE: every paged source read below checks whether the
// returned row count equals the requested limit and, if so, records a named
// gap (`source_truncated`) instead of silently under-counting (the A5/A5a
// "an open count equal to a query window is a reading of the instrument"
// lesson, applied at the SOURCE-READ layer of this producer specifically).
//
// EVERY WRITE GOES THROUGH decideFactWrite() (market-brief-facts.js) — the
// supersede / skip-duplicate / conflict decision is pure and unit-tested
// against fixtures; this handler only executes whatever it decides.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import { displayedCompCap } from '../../mcp/comps-tools.js';
import {
  buildCapRateBandFact,
  buildOnMarketFacts,
  buildTradesSinceLastRunFact,
  buildTradesZeroFact,
  buildCmsOperatorFacts,
  decideFactWrite,
  sectionTtlDays,
  staleAfterIso,
} from '../_shared/market-brief-facts.js';

const FLAG = 'MARKET_BRIEF_PSQL';
const PRODUCER = 'p_sql';
const TOP_OPERATOR_LIMIT = 8;

// Generous ceilings, well above any expected live population, so a source
// hitting its own requested limit is itself the truncation signal — never
// PostgREST's separate hard 1000-row response cap (kept comfortably below it
// so our own limit is what trips, and the tripwire is unambiguous).
const COMPS_RPC_LIMIT = 900;
const TRADES_LIMIT = 500;
const CMS_OPERATOR_LIMIT = 500; // 32 distinct operators measured live 2026-09-11

/** Reliable cap-rate reader for a rpc_query_comps row: prefer the engine's
 * own displayed (rent÷price) basis — the SAME value query_comps' summary
 * quotes (Prompt 52 doctrine: rank/report on the displayed cap, not the
 * stored cap_rate field) — and fall back to the RPC's own
 * coalesce(cap_rate_final, cap_rate) when no rent+price pair is available. */
export function reliableCompCap(row) {
  const displayed = displayedCompCap(row);
  if (Number.isFinite(displayed) && displayed > 0) return displayed;
  const stored = Number(row?.cap_rate);
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

/** Pure truncation tripwire: a source read that comes back AT its own requested
 * limit cannot tell you whether the true population is larger — read the RETURNED
 * count, never the number asked for (the A5/A5a lesson, one layer earlier: this is
 * a source-read guard, not a consumer-side auto-close guard). */
export function truncationGap(rowCount, limit, label) {
  if (!Number.isFinite(rowCount) || !Number.isFinite(limit)) return null;
  return rowCount >= limit
    ? `source_truncated (${label} returned ${rowCount} >= requested limit ${limit})`
    : null;
}

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

// ---------------------------------------------------------------------------
// Producer-run lifecycle (P123 pattern — open before the work, close on exit)
// ---------------------------------------------------------------------------

async function openRun(lane, triggerSource) {
  const r = await opsQuery('POST', 'producer_runs', {
    producer: PRODUCER, lane, status: 'started', trigger_source: triggerSource,
  }, { headers: { Prefer: 'return=representation' } });
  const row = Array.isArray(r?.data) ? r.data[0] : r?.data;
  return row?.run_id || null;
}

async function closeRun(runId, patch) {
  if (!runId) return;
  await opsQuery('PATCH', `producer_runs?run_id=eq.${runId}`, {
    finished_at: new Date().toISOString(),
    ...patch,
  }).catch(() => null);
}

/** The lane's last COMPLETED run, used as the cursor for "trades since last run". */
async function fetchLastCompletedRun(lane) {
  const r = await opsQuery('GET',
    `producer_runs?producer=eq.${PRODUCER}&lane=eq.${encodeURIComponent(lane)}`
    + '&status=eq.completed&order=started_at.desc&limit=1&select=run_id,started_at',
    undefined, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

// ---------------------------------------------------------------------------
// Source reads — each fails soft (empty result + a named gap), never throws,
// so one unreachable source doesn't take the whole tick down.
// ---------------------------------------------------------------------------

/**
 * Call the comps engine's own RPC (`rpc_query_comps`) with an explicit
 * `p_tenant: null`. Passing p_tenant is not optional here — the function has
 * TWO live overloads (12-arg without p_tenant, 13-arg with it), and Postgres
 * requires an unambiguous match; every call in mcp/comps-tools.js always
 * sends p_tenant (verified live 2026-09-11), which is what resolves to the
 * 13-arg signature. Omitting the key would leave the call ambiguous between
 * the two overloads (42725 "function is not unique") on any project where
 * both still exist.
 */
async function fetchCompsRpc({ dateFrom, dateTo, limit = COMPS_RPC_LIMIT } = {}) {
  const body = {
    p_comp_type: 'sale',
    p_property_types: null,
    p_states: null,
    p_metros: null,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_sf_min: null,
    p_sf_max: null,
    p_government_only: false,
    p_include_sf: true,
    p_include_onmkt: false,
    p_limit: limit,
    p_tenant: null,
  };
  const r = await domainQuery('dialysis', 'POST', 'rpc/rpc_query_comps', body, {});
  if (!r.ok || !Array.isArray(r.data)) return { rows: [], gap: r?.data?.error || `status ${r?.status}` };
  const gap = truncationGap(r.data.length, limit, 'rpc_query_comps');
  return { rows: r.data, gap };
}

async function fetchDialysisCapRates() {
  // TTM sold comps, sourced from the SAME rpc_query_comps() the comps engine
  // (query_comps / mcp/comps-tools.js) uses for every other comps surface —
  // so this brief's band agrees with what brokers get everywhere else. The
  // RPC already applies `transaction_state='live'`, `sold_price > 0`,
  // `exclude_from_market_metrics IS NOT TRUE`, and computes
  // `cap_rate = coalesce(cap_rate_final, cap_rate)` server-side (verified
  // live 2026-09-11 against pg_get_functiondef). `p_include_sf: true`
  // matches query_comps' own default, so a live Salesforce-staged sold comp
  // is included exactly as it would be for a broker's own query_comps call.
  const since = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return fetchCompsRpc({ dateFrom: since, dateTo: today });
}

async function fetchOnMarket() {
  // v_dia_on_market is the canonical on-market definition (CLAUDE.md §17 —
  // government-lease's equivalent; the dia twin is documented in the T9d /
  // on-market-currency work). Reading the view directly means this producer
  // inherits whatever "currently on market" means today with no local copy
  // of that filter. The view's cap-rate column is `current_cap_rate`, NOT a
  // bare `cap_rate` (verified live 2026-09-11 — MB-a's original select 400'd
  // on this).
  const limit = 900;
  const r = await domainQuery('dialysis', 'GET',
    `v_dia_on_market?select=property_id,current_cap_rate,asking_price&limit=${limit}`, undefined, {});
  if (!r.ok || !Array.isArray(r.data)) return { rows: [], gap: r?.data?.error || `status ${r?.status}` };
  const gap = truncationGap(r.data.length, limit, 'v_dia_on_market');
  return { rows: r.data, gap };
}

async function fetchTradesSince(sinceIso) {
  if (!sinceIso) return { rows: [], gap: null };
  // Same shared RPC as the cap-rate band, filtered to trades since the
  // producer's own last completed run — so a "trade since last run" is
  // exactly the same comp population every other surface would show for
  // that window, address/city/state included via the RPC's own
  // properties join (MB-a's raw sales_transactions select 400'd: that
  // table carries neither address, city nor state — those live on
  // `properties`, which only the RPC — or an explicit join — resolves).
  return fetchCompsRpc({ dateFrom: sinceIso.slice(0, 10), limit: TRADES_LIMIT });
}

async function fetchCmsOperatorCounts() {
  // Server-side aggregation (migration
  // 20260911190000_dia_mba2_cms_operator_counts_view.sql) — the count is
  // computed over the FULL medicare_clinics table (dedup_status <>
  // demoted_duplicate AND chain_organization not null), not a client-side
  // tally over a `&limit=1000` page against 6,695 eligible rows (MB-a's
  // original select, verified live 2026-09-11 to silently truncate to
  // ~15% of the population — the exact "failure mode that matters looks
  // exactly like success" this file's doctrine section warns about: no
  // error, plausible-looking counts, just wrong).
  const limit = CMS_OPERATOR_LIMIT;
  const r = await domainQuery('dialysis', 'GET',
    `v_market_brief_cms_operator_counts?select=operator,clinic_count&order=clinic_count.desc&limit=${limit}`,
    undefined, {});
  if (!r.ok || !Array.isArray(r.data)) return { rows: [], gap: r?.data?.error || `status ${r?.status}` };
  const gap = truncationGap(r.data.length, limit, 'v_market_brief_cms_operator_counts');
  const sorted = r.data
    .map((row) => ({ operator: String(row.operator || '').trim(), count: Number(row.clinic_count) }))
    .filter((row) => row.operator && Number.isFinite(row.count))
    .slice(0, TOP_OPERATOR_LIMIT);
  return { rows: sorted, gap };
}

/** Prior counts, resolved from the currently-live cms_clinic_count:* facts for the lane. */
async function fetchPriorCmsCounts(lane) {
  const r = await opsQuery('GET',
    `market_brief_facts?lane=eq.${encodeURIComponent(lane)}&section=eq.operators`
    + '&status=eq.live&fact_key=like.cms_clinic_count:*'
    + '&select=fact_key,value', undefined, { countMode: 'none' });
  const map = new Map();
  if (r.ok && Array.isArray(r.data)) {
    for (const row of r.data) {
      const opKey = String(row.fact_key || '').replace(/^cms_clinic_count:/, '');
      // The map is keyed on the same normalized token buildCmsOperatorFacts
      // uses internally for fact_key, so we look it up by re-deriving that
      // token from the raw operator name at call time (see the tick body).
      map.set(opKey, Number(row.value));
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Write path — one fact at a time, through decideFactWrite().
// ---------------------------------------------------------------------------

async function fetchLiveFact(lane, section, factKey) {
  const r = await opsQuery('GET',
    `market_brief_facts?lane=eq.${encodeURIComponent(lane)}&section=eq.${encodeURIComponent(section)}`
    + `&fact_key=eq.${encodeURIComponent(factKey)}&status=eq.live&limit=1`,
    undefined, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

async function writeFact(candidate, fetchedAtIso, apply) {
  const ttlDays = sectionTtlDays({ origin: candidate.origin, subtype: candidate._subtype });
  const row = {
    lane: candidate.lane,
    section: candidate.section,
    claim_text: candidate.claim_text,
    value: candidate.value,
    unit: candidate.unit,
    source_url: candidate.source_url,
    source_title: candidate.source_title,
    source_date: candidate.source_date,
    fetched_at: fetchedAtIso,
    origin: candidate.origin,
    fact_kind: candidate.fact_kind,
    stale_after: staleAfterIso(fetchedAtIso, ttlDays),
    fact_key: candidate.fact_key,
    confidence: candidate.confidence,
  };

  const existing = await fetchLiveFact(candidate.lane, candidate.section, candidate.fact_key);
  const decision = decideFactWrite({ existingLive: existing, candidate });

  if (decision.action === 'skip_duplicate') {
    return { ...decision, fact_key: candidate.fact_key };
  }

  if (decision.action === 'conflict') {
    if (apply) {
      // Mark the existing (seeded/web) fact conflicted, then insert the new
      // one ALSO as conflict — neither wins (spec: "don't pick").
      await opsQuery('PATCH', `market_brief_facts?id=eq.${existing.id}`, { status: 'conflict' }).catch(() => null);
      await opsQuery('POST', 'market_brief_facts', { ...row, status: 'conflict' }).catch(() => null);
    }
    return { ...decision, fact_key: candidate.fact_key, conflicts_with_id: existing?.id || null };
  }

  if (decision.action === 'supersede') {
    if (apply) {
      const ins = await opsQuery('POST', 'market_brief_facts',
        { ...row, supersedes_id: existing.id, status: 'live' },
        { headers: { Prefer: 'return=representation' } });
      if (ins.ok) {
        await opsQuery('PATCH', `market_brief_facts?id=eq.${existing.id}`, { status: 'superseded' }).catch(() => null);
      }
    }
    return { ...decision, fact_key: candidate.fact_key, superseded_id: existing?.id || null };
  }

  // insert_new
  if (apply) {
    await opsQuery('POST', 'market_brief_facts', { ...row, status: 'live' }).catch(() => null);
  }
  return { ...decision, fact_key: candidate.fact_key };
}

// ---------------------------------------------------------------------------
// Lane builder — dialysis only today; structured so a future lane is one
// more entry in this map, not a rewrite of the handler (spec §4/§7: gov/NL
// come later but the fact builders are already per-lane/config).
// ---------------------------------------------------------------------------

const LANE_BUILDERS = {
  dialysis: async ({ asOfIso, sinceIso, lane }) => {
    const facts = [];
    const gaps = [];

    const [capRateSrc, onMarketSrc, tradesSrc, cmsSrc] = await Promise.all([
      fetchDialysisCapRates(), fetchOnMarket(), fetchTradesSince(sinceIso), fetchCmsOperatorCounts(),
    ]);
    for (const [label, src] of [
      ['rpc_query_comps_ttm', capRateSrc], ['v_dia_on_market', onMarketSrc],
      ['rpc_query_comps_trades', tradesSrc], ['v_market_brief_cms_operator_counts', cmsSrc],
    ]) {
      if (src.gap) gaps.push({ source: label, error: src.gap });
    }

    // 1. Whole-market TTM cap-rate band + by-operator (small-n suppressed).
    //    reliableCompCap() reads the engine's DISPLAYED cap (rent÷price) when
    //    available, falling back to the RPC's own coalesce(cap_rate_final,
    //    cap_rate) — the same basis query_comps' own summary quotes.
    const capRates = capRateSrc.rows.map(reliableCompCap).filter(Number.isFinite);
    const wholeMarket = buildCapRateBandFact({
      lane, capRates, sourceLabel: 'rpc_query_comps (TTM, dialysis sales)', asOfIso,
    });
    if (wholeMarket) facts.push(wholeMarket); else if (capRates.length) gaps.push({ source: 'cap_rate_band', error: `n=${capRates.length} below small-n floor` });

    const byOperator = new Map();
    for (const r of capRateSrc.rows) {
      // `tenant` is the RPC's own resolved operator field
      // (comp_tenant(chain_canonical, operator, tenant) for dialysis_db rows,
      // st.tenant for salesforce-staged rows) — MB-a read a nonexistent
      // `operator_name` column on the raw sales table.
      const op = String(r.tenant || '').trim();
      const cap = reliableCompCap(r);
      if (!op || !Number.isFinite(cap)) continue;
      if (!byOperator.has(op)) byOperator.set(op, []);
      byOperator.get(op).push(cap);
    }
    for (const [operator, rates] of byOperator) {
      const opFact = buildCapRateBandFact({
        lane, capRates: rates, operator, sourceLabel: 'rpc_query_comps (TTM, dialysis sales)', asOfIso,
      });
      if (opFact) facts.push(opFact);
    }

    // 2. On-market count + median ask cap.
    //    v_dia_on_market's cap-rate column is `current_cap_rate`, not a bare
    //    `cap_rate` (verified live 2026-09-11).
    const onMarketCaps = onMarketSrc.rows.map((r) => Number(r.current_cap_rate)).filter(Number.isFinite);
    const onMarketFacts = buildOnMarketFacts({
      lane,
      count: onMarketSrc.rows.length,
      medianAskCap: onMarketCaps.length
        ? onMarketCaps.slice().sort((a, b) => a - b)[Math.floor(onMarketCaps.length / 2)]
        : null,
      sourceLabel: 'dia.v_dia_on_market', asOfIso,
    });
    facts.push(...onMarketFacts);

    // 3. Trades since last run. buildTradesSinceLastRunFact (pure, unit-
    //    tested against fixtures) expects {sold_price, cap_rate} keys; map
    //    the RPC's {sale_price, cap_rate} rows onto that shape rather than
    //    changing the tested builder's contract.
    const tradeRows = tradesSrc.rows.map((r) => ({
      address: r.address, city: r.city, state: r.state, sale_date: r.sale_date,
      sold_price: r.sale_price, cap_rate: reliableCompCap(r),
    }));
    const tradesFact = tradeRows.length
      ? buildTradesSinceLastRunFact({ lane, trades: tradeRows, sinceIso, sourceLabel: 'rpc_query_comps (dialysis sales)', asOfIso })
      : buildTradesZeroFact({ lane, sinceIso, sourceLabel: 'rpc_query_comps (dialysis sales)', asOfIso });
    if (tradesFact) facts.push(tradesFact);

    // 4. CMS clinic counts by top operator + net change vs. the prior run.
    const priorMap = await fetchPriorCmsCounts(lane);
    // priorMap is keyed on the same normalized token buildCmsOperatorFacts
    // derives internally from the operator label; re-key it here by operator
    // name so buildCmsOperatorFacts (which takes a plain operator->count map)
    // can look it up directly.
    const priorByName = new Map();
    for (const row of cmsSrc.rows) {
      const key = String(row.operator).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (priorMap.has(key)) priorByName.set(row.operator, priorMap.get(key));
    }
    const cmsFacts = buildCmsOperatorFacts({
      lane, counts: cmsSrc.rows, priorCounts: priorByName, sourceLabel: 'dia.v_market_brief_cms_operator_counts', asOfIso,
    });
    facts.push(...cmsFacts);

    return { facts, gaps };
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleMarketBriefPsqlTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET/POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const q = { ...(req.query || {}), ...(req.body || {}) };
  const lane = String(q.lane || 'dialysis').toLowerCase();
  const isApply = req.method === 'POST' && !truthy(q.dry_run);
  const force = truthy(q.force);
  const asOfIso = new Date().toISOString();

  if (!LANE_BUILDERS[lane]) {
    return res.status(400).json({ ok: false, error: `no P-SQL builder registered for lane '${lane}'`, available_lanes: Object.keys(LANE_BUILDERS) });
  }

  const flagRow = await fetchFeatureFlag(FLAG);
  const enabled = flagEnabled(FLAG, flagRow);

  if (isApply && !enabled && !force) {
    const runId = await openRun(lane, 'api');
    await closeRun(runId, { status: 'skipped', skip_reason: `flag ${FLAG} is off` });
    return res.status(200).json({
      ok: true, mode: 'apply', skipped: 'flag_off', lane,
      flag: { name: FLAG, enabled, registry_state: flagRow?.state || null },
      hint: `Set ${FLAG}=true (env or feature_flags_registry) to enable, or call with ?force=1.`,
    });
  }

  const runId = isApply ? await openRun(lane, req.body?.trigger_source || 'api') : null;

  try {
    const lastRun = await fetchLastCompletedRun(lane);
    const sinceIso = lastRun?.started_at || null;

    const { facts, gaps } = await LANE_BUILDERS[lane]({ asOfIso, sinceIso, lane });

    const results = [];
    for (const candidate of facts) {
      const outcome = await writeFact(candidate, asOfIso, isApply);
      results.push({ ...outcome, claim_text: candidate.claim_text, section: candidate.section });
    }

    const written = results.filter((r) => r.action === 'insert_new').length;
    const superseded = results.filter((r) => r.action === 'supersede').length;
    const skipped = results.filter((r) => r.action === 'skip_duplicate').length;
    const conflicted = results.filter((r) => r.action === 'conflict').length;

    if (isApply) {
      await closeRun(runId, {
        status: 'completed',
        facts_written: written + superseded, // superseding writes a new live row too
        facts_superseded: superseded,
        detail: { gaps, conflicted, skipped_duplicate: skipped, since: sinceIso, lane },
      });
    }

    return res.status(200).json({
      ok: true,
      mode: isApply ? 'apply' : 'dry_run',
      lane,
      as_of: asOfIso,
      since: sinceIso,
      flag: { name: FLAG, enabled, registry_state: flagRow?.state || null },
      candidates: facts.length,
      written, superseded, skipped_duplicate: skipped, conflicted,
      gaps,
      results,
    });
  } catch (err) {
    if (isApply) {
      await closeRun(runId, { status: 'failed', error_count: 1, detail: { error: err?.message || String(err) } });
    }
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}

export const __internal = { LANE_BUILDERS, writeFact, fetchDialysisCapRates, fetchOnMarket, fetchTradesSince, fetchCmsOperatorCounts };
