// api/_handlers/ownergap2-owner-resolve-tick.js
// ============================================================================
// OWNERGAP2 — resolve owner-unknown dia properties from FREE public sources.
//
//   GET  → DRY RUN. Fetches, matches, and reports the full plan by cause.
//          Writes nothing, anywhere. This is the default.
//   POST → apply, bounded by `limit` and a wall-clock budget, every outcome
//          ledgered (resolved AND refused), fully reversible by batch tag.
//
// ⚠️ NO CRON IS REGISTERED FOR THIS, DELIBERATELY. CLAUDE.md's standing
//    sequence for a new producer is strict and the schedule is LAST:
//    **marker → verdict → producer → cron**. "Scheduling first is how the FRED,
//    CMS and public-record producers each became silent." This lane has a
//    marker (the ledger) and a verdict path; whether it earns a schedule is a
//    decision to take after a real run, not before one.
//
// Scope: two jurisdictions (§2). `?jurisdiction=` must name one — there is no
// "all" mode, because a national sweep is exactly what this task is not.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { domainQuery } from '../_shared/domain-db.js';
import { PHILADELPHIA, HARRIS, resolveOwnerForProperty } from '../_shared/ownergap2-sources.js';
import {
  planOwnerWrite, applyOwnerResolution, loadOperatorKeys,
} from '../_shared/ownergap2-owner-writeback.js';

const WALL_CLOCK_MS = 45000;

// ⚠️ COUNTY IS MATCHED EXACTLY, NEVER AS A SUBSTRING — MEASURED.
// `county ILIKE '%harris%'` returns **52** dia owner-unknown properties; exactly
// **2 of them are in HARRISON County (Marshall, TX)**, ~200 miles away and a
// different appraisal district entirely. Harris County proper is **50**, which
// is the figure OWNERGAP1 §9 reports. A substring county filter would have sent
// two East Texas properties to HCAD and, on a bad day, matched a street name
// there. The population is defined by equality (case-insensitively), plus — for
// Philadelphia only — a city arm, because one real Philadelphia property
// (28367, `150 South Independence West`) carries a NULL county.
export const JURISDICTIONS = {
  [PHILADELPHIA]: {
    label: 'Philadelphia, PA',
    state: 'PA',
    // PostgREST `or=` — county equality, or a null county with the city named.
    populationFilter: 'state=eq.PA&or=(county.ilike.philadelphia,and(county.is.null,city.ilike.philadelphia))',
    fetches: true,
  },
  [HARRIS]: {
    label: 'Harris County, TX',
    state: 'TX',
    populationFilter: 'state=eq.TX&county=ilike.harris',
    // ⚠️ NO AUTONOMOUS FETCH. Measured live 2026-09-16 from Dialysis_DB via
    // pg_net: `search.hcad.org` answers **403 with the Cloudflare managed
    // challenge** ("Just a moment..."), `hcad.org` answers **521**, and the
    // legacy `public.hcad.org/records/quicksearch.asp` answers **404**. The
    // task's §6 is explicit — do not automate a bot-protected portal and do not
    // work around one — and this repo has already paid for that lesson once
    // (the SOS-direct fetcher, government-lease §25, needed a residential
    // egress and that is an OPERATOR decision). So Harris resolves from an
    // operator-supplied HCAD payload posted to this route, through the same
    // parser + Personal/Commercial discriminator, or it does not resolve.
    fetches: false,
  },
};

const PROPERTY_COLS = 'property_id,address,city,state,county,parcel_number,operator,recorded_owner_id,true_owner_id';

/**
 * The owner-unknown population, exactly as OWNERGAP1 defines it: an
 * operator-flagged `true_owner` AND no `recorded_owner_id`.
 *
 * ⚠️ The operator-flag half is resolved with a real join rather than assumed —
 * `recorded_owner_id IS NULL` alone is a DIFFERENT and larger population, and
 * quoting one for the other is how a gap gets mis-sized.
 */
async function loadPopulation(jurisdiction, limit, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const cfg = JURISDICTIONS[jurisdiction];
  const flagged = await q('dialysis', 'GET',
    'true_owners?is_operator_not_owner=is.true&select=true_owner_id&limit=1000');
  if (!flagged.ok) return { ok: false, reason: `operator_flag_load_failed:${flagged.status}`, rows: [] };
  const ids = (flagged.data || []).map((r) => r.true_owner_id).filter(Boolean);
  if (!ids.length) return { ok: true, rows: [] };

  const path = `properties?select=${PROPERTY_COLS}&recorded_owner_id=is.null`
    + `&true_owner_id=in.(${ids.join(',')})&${cfg.populationFilter}`
    + `&order=property_id.asc&limit=${limit}`;
  const r = await q('dialysis', 'GET', path);
  if (!r.ok) return { ok: false, reason: `population_load_failed:${r.status}`, rows: [], detail: r.data };
  return { ok: true, rows: Array.isArray(r.data) ? r.data : [] };
}

export async function handleOwnerGap2ResolveTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const jurisdiction = String(req.query.jurisdiction || '').trim();
  if (!JURISDICTIONS[jurisdiction]) {
    return res.status(400).json({
      error: 'jurisdiction required',
      supported: Object.keys(JURISDICTIONS),
      note: 'OWNERGAP2 is two adapters by design — there is no all-jurisdictions mode.',
    });
  }
  const cfg = JURISDICTIONS[jurisdiction];
  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
  const batchTag = String(req.query.batch_tag || `ownergap2_${jurisdiction}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);

  // Harris arrives as an operator-supplied payload keyed by address.
  const harrisPayloads = new Map();
  if (jurisdiction === HARRIS) {
    const supplied = Array.isArray(req.body?.payloads) ? req.body.payloads : [];
    for (const p of supplied) {
      if (p?.property_id != null) harrisPayloads.set(String(p.property_id), p);
    }
  }

  const pop = await loadPopulation(jurisdiction, limit, {});
  if (!pop.ok) return res.status(500).json({ error: pop.reason, detail: pop.detail });

  const opKeys = await loadOperatorKeys({});
  // ⚠️ FAIL CLOSED. If the recorded operator list could not be loaded we cannot
  // apply §4's operator refusal, so we must not write. An empty set would let
  // every operator name through while the run still read "ok" — the exact
  // silent-success shape this arc exists to remove.
  if (!opKeys.ok) {
    return res.status(503).json({ error: 'operator_flag_unavailable', note: 'refusing to write without the operator guard' });
  }

  const started = Date.now();
  const summary = {
    ok: true, dry_run: dryRun, jurisdiction, label: cfg.label, batch_tag: batchTag,
    population: pop.rows.length, attempted: 0, resolved: 0, refused: 0,
    by_cause: {}, wrote: 0, budget_stopped: false,
    fetches_from_source: cfg.fetches,
    operator_keys_loaded: opKeys.count,
  };
  const sample = [];

  for (const property of pop.rows) {
    if (Date.now() - started > WALL_CLOCK_MS) { summary.budget_stopped = true; break; }
    summary.attempted += 1;

    let verdict;
    if (jurisdiction === PHILADELPHIA) {
      verdict = await resolveOwnerForProperty(PHILADELPHIA, { address: property.address },
        { fetchImpl: (...a) => fetch(...a) });
    } else {
      const payload = harrisPayloads.get(String(property.property_id));
      if (!payload) {
        verdict = {
          status: 'unresolved', reason: 'no_operator_payload_supplied',
          owner: null, citation: null, sourceRecordIds: [],
        };
      } else {
        verdict = await resolveOwnerForProperty(HARRIS,
          { ...payload, address: payload.address || property.address }, {});
      }
    }

    const plan = planOwnerWrite(property, verdict, {
      operatorKeys: opKeys.keys, propertyOperator: property.operator,
    });
    const applied = await applyOwnerResolution(property, plan, batchTag,
      { dryRun, jurisdiction }, {});

    if (plan.action === 'write') { summary.resolved += 1; if (applied.wrote) summary.wrote += 1; }
    else {
      summary.refused += 1;
      const cause = plan.reason || 'unknown';
      summary.by_cause[cause] = (summary.by_cause[cause] || 0) + 1;
    }

    if (sample.length < 40) {
      sample.push({
        property_id: property.property_id,
        address: property.address,
        outcome: plan.action === 'write' ? 'resolved' : 'unresolved',
        owner: plan.action === 'write' ? plan.ownerName : null,
        reason: plan.reason,
        match_arm: verdict.matchArm || null,
        source_record_ids: verdict.sourceRecordIds || [],
        source_truncated: !!verdict.truncated,
        excluded_personal_accounts: (verdict.excludedPersonalAccounts || []).length || undefined,
      });
    }
  }

  // ⚠️ Report `resolved` BESIDE `by_cause`, never `attempted` — a rows-scanned
  // tally reads exactly like throughput while nothing moves (P159a).
  return res.status(200).json({ ...summary, sample });
}
