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
// SOURCES (dialysis lane, MB-a §1 measurement — see the PR description /
// PLANNED-BACKLOG §P18 for the full source census):
//   - dia comps engine (rpc_query_comps / the same domain views the CM export
//     reads) for a TTM cap-rate band, sourced here directly from
//     Dialysis_DB.sales_transactions (a "sold in the last 12 months" filter
//     over the same cap-rate framework CLAUDE.md §12 describes) rather than
//     re-deriving through the MCP comps tool, so this producer has no runtime
//     dependency on mcp/server.js.
//   - Dialysis_DB.available_listings (v_dia_on_market view is the canonical
//     "currently on market" definition per CLAUDE.md; this producer reads the
//     view directly via domainQuery so it inherits the canonical filter for
//     free instead of re-deriving it).
//   - Dialysis_DB.medicare_clinics, grouped by chain_organization, excluding
//     dedup_status='demoted_duplicate' (the P113/census-writer discipline —
//     never count an operator's clinics off a duplicate row).
//
// EVERY WRITE GOES THROUGH decideFactWrite() (market-brief-facts.js) — the
// supersede / skip-duplicate / conflict decision is pure and unit-tested
// against fixtures; this handler only executes whatever it decides.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
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

async function fetchDialysisCapRates() {
  // TTM sold comps with a usable cap rate. CLAUDE.md §12-equivalent for dia:
  // cap rate = net rent (NNN) / price, already computed at ingest on
  // sales_transactions in most cases; we read the stored value rather than
  // re-deriving it here (that derivation belongs to the domain DB, not to a
  // brief producer).
  const since = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const r = await domainQuery('dialysis', 'GET',
    `sales_transactions?sale_date=gte.${since}&cap_rate=not.is.null`
    + '&select=cap_rate,operator_name,sold_price,sale_date,address,city,state'
    + '&limit=1000', undefined, {});
  if (!r.ok || !Array.isArray(r.data)) return { rows: [], gap: r?.data?.error || `status ${r?.status}` };
  return { rows: r.data, gap: null };
}

async function fetchOnMarket() {
  // v_dia_on_market is the canonical on-market definition (CLAUDE.md §17 —
  // government-lease's equivalent; the dia twin is documented in the T9d /
  // on-market-currency work). Reading the view directly means this producer
  // inherits whatever "currently on market" means today with no local copy
  // of that filter.
  const r = await domainQuery('dialysis', 'GET',
    'v_dia_on_market?select=property_id,cap_rate,asking_price&limit=1000', undefined, {});
  if (!r.ok || !Array.isArray(r.data)) return { rows: [], gap: r?.data?.error || `status ${r?.status}` };
  return { rows: r.data, gap: null };
}

async function fetchTradesSince(sinceIso) {
  if (!sinceIso) return { rows: [], gap: null };
  const r = await domainQuery('dialysis', 'GET',
    `sales_transactions?sale_date=gte.${sinceIso.slice(0, 10)}`
    + '&select=address,city,state,sale_date,sold_price,cap_rate&order=sale_date.desc&limit=500',
    undefined, {});
  if (!r.ok || !Array.isArray(r.data)) return { rows: [], gap: r?.data?.error || `status ${r?.status}` };
  return { rows: r.data, gap: null };
}

async function fetchCmsOperatorCounts() {
  const r = await domainQuery('dialysis', 'GET',
    'medicare_clinics?dedup_status=neq.demoted_duplicate&chain_organization=not.is.null'
    + '&select=chain_organization&limit=1000', undefined, {});
  if (!r.ok || !Array.isArray(r.data)) return { rows: [], gap: r?.data?.error || `status ${r?.status}` };
  const counts = new Map();
  for (const row of r.data) {
    const op = String(row.chain_organization || '').trim();
    if (!op) continue;
    counts.set(op, (counts.get(op) || 0) + 1);
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_OPERATOR_LIMIT)
    .map(([operator, count]) => ({ operator, count }));
  return { rows: sorted, gap: null };
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
      ['dia_sales_transactions', capRateSrc], ['v_dia_on_market', onMarketSrc],
      ['dia_sales_transactions_trades', tradesSrc], ['dia_medicare_clinics', cmsSrc],
    ]) {
      if (src.gap) gaps.push({ source: label, error: src.gap });
    }

    // 1. Whole-market TTM cap-rate band + by-operator (small-n suppressed).
    const capRates = capRateSrc.rows.map((r) => Number(r.cap_rate)).filter(Number.isFinite);
    const wholeMarket = buildCapRateBandFact({
      lane, capRates, sourceLabel: 'dia.sales_transactions (TTM)', asOfIso,
    });
    if (wholeMarket) facts.push(wholeMarket); else if (capRates.length) gaps.push({ source: 'cap_rate_band', error: `n=${capRates.length} below small-n floor` });

    const byOperator = new Map();
    for (const r of capRateSrc.rows) {
      const op = String(r.operator_name || '').trim();
      const cap = Number(r.cap_rate);
      if (!op || !Number.isFinite(cap)) continue;
      if (!byOperator.has(op)) byOperator.set(op, []);
      byOperator.get(op).push(cap);
    }
    for (const [operator, rates] of byOperator) {
      const opFact = buildCapRateBandFact({
        lane, capRates: rates, operator, sourceLabel: 'dia.sales_transactions (TTM)', asOfIso,
      });
      if (opFact) facts.push(opFact);
    }

    // 2. On-market count + median ask cap.
    const onMarketCaps = onMarketSrc.rows.map((r) => Number(r.cap_rate)).filter(Number.isFinite);
    const onMarketFacts = buildOnMarketFacts({
      lane,
      count: onMarketSrc.rows.length,
      medianAskCap: onMarketCaps.length
        ? onMarketCaps.slice().sort((a, b) => a - b)[Math.floor(onMarketCaps.length / 2)]
        : null,
      sourceLabel: 'dia.v_dia_on_market', asOfIso,
    });
    facts.push(...onMarketFacts);

    // 3. Trades since last run.
    const tradesFact = tradesSrc.rows.length
      ? buildTradesSinceLastRunFact({ lane, trades: tradesSrc.rows, sinceIso, sourceLabel: 'dia.sales_transactions', asOfIso })
      : buildTradesZeroFact({ lane, sinceIso, sourceLabel: 'dia.sales_transactions', asOfIso });
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
      lane, counts: cmsSrc.rows, priorCounts: priorByName, sourceLabel: 'dia.medicare_clinics', asOfIso,
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
