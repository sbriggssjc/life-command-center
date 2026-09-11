// api/_handlers/ownt0j-sponsor-classify-tick.js
// ============================================================================
// OWN-T0j — classify the OWN-T0a gov ownership-transition-vs-true_owner
// disagreement population against LCC Opps' confirmed sponsor/SPE families
// (OWN-T0e's lcc_ownership_sponsor_family).
//
//   GET  -> dry-run (NO writes). Reads both sides, classifies in memory,
//           returns honest counts (both buckets, never just the residual)
//           and does not touch the cache table.
//   POST -> writes the classification into lcc_ownt0j_sponsor_disagreement_cache
//           (truncate-and-fill inside one pass, mirroring OWN-T0e's
//           lcc_ownt0e_refresh_proposals()). Idempotent — a re-run with an
//           unchanged source population writes the same rows.
//
// THIS IS A REPORTING SURFACE, NOT A WRITE PATH. It never touches gov's
// properties/ownership_history/true_owners, never writes to
// lcc_ownership_sponsor_family, and does not build a second confirm
// mechanism — a genuinely unclassified pair is routed to OWN-T0e's existing
// `sponsor_family_confirm` Decision Center lane (subject_refs are surfaced
// as `t0e_hint` so an operator can jump straight there when the sponsor name
// is legible; the lane itself decides membership independently via its own
// A3-gated view).
//
// PAGING. gov's comparable population is ~5,100 rows; PostgREST caps any
// single response at 1000 regardless of `limit=` (documented repo-wide
// footgun — "a larger stride silently SKIPS rows"), so this reads gov in
// 1000-row strides via `offset=`/`limit=` and asserts each page returned
// count < requested only on the LAST page (a full page on every stride is
// the truncation signal, not the total).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import {
  OWNT0J_CACHE_TABLE, classifyDisagreementBatch,
} from '../_shared/ownt0j-sponsor-classifier.js';

const PAGE = 1000;
const GOV_SELECT = 'property_id,new_owner_cleaned,data_source,change_type,is_latest_for_property';

async function fetchGovComparablePopulation() {
  // Step 1 of the two-step read below joins to true_owners for the name;
  // v_ownership_transitions_portfolio itself carries no true_owner name/id,
  // so pull the latest-transition rows first, then the property/true_owner
  // side, keyed on property_id (both under the 1000-row PostgREST cap per
  // page, paged independently).
  const transitions = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await domainQuery('government', 'GET',
      'v_ownership_transitions_portfolio?select=' + GOV_SELECT
      + '&is_latest_for_property=is.true&order=property_id.asc'
      + '&limit=' + PAGE + '&offset=' + offset);
    if (!r.ok || !Array.isArray(r.data)) {
      return { ok: false, error: 'gov transitions fetch failed at offset ' + offset, status: r.status };
    }
    transitions.push(...r.data);
    if (r.data.length < PAGE) break;
  }

  const propIds = Array.from(new Set(transitions.map((t) => t.property_id).filter((x) => x != null)));
  const propMap = new Map();
  for (let i = 0; i < propIds.length; i += PAGE) {
    const chunk = propIds.slice(i, i + PAGE);
    const r = await domainQuery('government', 'GET',
      'properties?select=property_id,true_owner_id&property_id=in.(' + chunk.join(',') + ')&limit=' + PAGE);
    if (!r.ok || !Array.isArray(r.data)) {
      return { ok: false, error: 'gov properties fetch failed at chunk ' + i, status: r.status };
    }
    for (const p of r.data) propMap.set(p.property_id, p.true_owner_id);
  }

  // BUGFIX 2026-09-11 (Cowork, live 502 found in production): the previous
  // version batched true_owner_id UUIDs into a single `in.(...)` PostgREST
  // filter at PAGE (1000) per request -- 1000 quoted UUIDs is ~39KB of query
  // string, which Railway's edge/proxy rejects outright (measured live:
  // POST/GET both returned 502 `{"error":"gov true_owners fetch failed at
  // chunk 0"}` on the very first chunk). The `properties` fetch above uses
  // the same `in.()` shape but with short numeric ids (~8KB for 1000 ids),
  // which is why only this fetch broke. Fix: scan `true_owners` unfiltered,
  // paged by limit/offset like the transitions fetch above, and keep only
  // the ids this run actually needs -- no `in.()` filter, no URL-length
  // ceiling regardless of how large `ownerIds` grows.
  const ownerIdSet = new Set(Array.from(propMap.values()).filter((x) => x != null));
  const ownerNameMap = new Map();
  for (let offset = 0; ; offset += PAGE) {
    const r = await domainQuery('government', 'GET',
      'true_owners?select=true_owner_id,name&order=true_owner_id.asc&limit=' + PAGE + '&offset=' + offset);
    if (!r.ok || !Array.isArray(r.data)) {
      return { ok: false, error: 'gov true_owners fetch failed at offset ' + offset, status: r.status };
    }
    for (const o of r.data) {
      if (ownerIdSet.has(o.true_owner_id)) ownerNameMap.set(o.true_owner_id, o.name);
    }
    if (r.data.length < PAGE) break;
  }

  const comparable = [];
  for (const t of transitions) {
    const trueOwnerId = propMap.get(t.property_id);
    if (trueOwnerId == null) continue; // matches "where p.true_owner_id is not null"
    comparable.push({
      property_id: t.property_id,
      transition_grantee_cleaned: t.new_owner_cleaned,
      data_source: t.data_source,
      change_type: t.change_type,
      true_owner_id: trueOwnerId,
      true_owner_name: ownerNameMap.get(trueOwnerId) || null,
    });
  }
  return { ok: true, rows: comparable };
}

async function fetchConfirmedSponsorFamilies() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await opsQuery('GET',
      'lcc_ownership_sponsor_family?select=sponsor_entity_id,sponsor_token,confirmed_at'
      + '&confirmed_at=not.is.null&order=sponsor_token.asc&limit=' + PAGE + '&offset=' + offset);
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, error: 'sponsor family fetch failed', status: r.status };
    rows.push(...r.data);
    if (r.data.length < PAGE) break;
  }
  return { ok: true, rows };
}

export async function handleOwnT0jSponsorClassifyTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET/POST only' });
  const isApply = req.method === 'POST';
  if (isApply) {
    // BUGFIX 2026-09-11 (Cowork, live 401 found in production, second bug in
    // this handler): authenticate(req, res) is an ASYNC function that returns
    // a user object (or null, having already sent its own 401 response) --
    // see api/_shared/auth.js's own header comment for the real contract:
    //   const user = await authenticate(req, res); if (!user) return;
    // The previous code called `authenticate(req)` with one argument, no
    // `await`, and treated the (unawaited Promise) result as an
    // {ok, status, error} shape that authenticate() never returns -- so
    // `auth.ok` was always undefined and every POST 401'd unconditionally,
    // even with a correct X-LCC-Key. Reproduced live: `lcc_cron_post`'s own
    // POST (the real key, from Vault, the same call the cron makes) came
    // back 401 `{"error":"unauthorized"}`.
    const user = await authenticate(req, res);
    if (!user) return; // authenticate() already sent the 401 response
  }

  const [govR, famR] = await Promise.all([fetchGovComparablePopulation(), fetchConfirmedSponsorFamilies()]);
  if (!govR.ok) return res.status(502).json({ ok: false, error: govR.error, stage: 'gov_fetch' });
  if (!famR.ok) return res.status(502).json({ ok: false, error: famR.error, stage: 'sponsor_family_fetch' });

  const { rows, counts } = classifyDisagreementBatch(govR.rows, famR.rows);
  const confirmedTokenCount = new Set(famR.rows.map((r) => String(r.sponsor_token).toLowerCase())).size;

  const summary = {
    ok: true,
    apply: isApply,
    comparable_population: govR.rows.length,
    confirmed_sponsor_tokens: confirmedTokenCount,
    counts,
    // OWN-T0i (hedge-phrase owner names) and the tombstone class are OUT OF
    // SCOPE for this tick — not sized or fixed here, per the OWN-T0j brief.
    generated_at: new Date().toISOString(),
  };

  if (!isApply) {
    summary.sample_confirmed = rows.filter((r) => r.classification === 'sponsor_family_confirmed').slice(0, 10);
    summary.sample_unclassified = rows.filter((r) => r.classification === 'unclassified_rival').slice(0, 10);
    return res.status(200).json(summary);
  }

  // Truncate-and-fill in bounded chunks. A reader mid-refresh may see a partial
  // table for the few seconds this takes (~5k rows); the cache is a reporting
  // surface, not a write-gating one, so that is an acceptable window (same
  // trade OWN-T0e's own cache documents).
  const del = await opsQuery('DELETE', OWNT0J_CACHE_TABLE + '?group_key_id=not.is.null');
  if (!del.ok) return res.status(502).json({ ok: false, error: 'cache truncate failed', detail: del.data });

  const nowIso = summary.generated_at;
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      group_key_id: r.property_id + ':' + r.true_owner_id,
      property_id: r.property_id,
      true_owner_id: r.true_owner_id,
      true_owner_name: r.true_owner_name,
      transition_grantee_cleaned: r.transition_grantee_cleaned,
      data_source: r.data_source,
      change_type: r.change_type,
      classification: r.classification,
      sponsor_match_token: r.sponsor_match_token,
      refreshed_at: nowIso,
    }));
    const ins = await opsQuery('POST', OWNT0J_CACHE_TABLE, chunk, { Prefer: 'return=minimal' });
    if (!ins.ok) return res.status(502).json({ ok: false, error: 'cache insert failed at chunk ' + i, detail: ins.data, written });
    written += chunk.length;
  }
  summary.written = written;
  return res.status(200).json(summary);
}
