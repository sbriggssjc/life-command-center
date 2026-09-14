// ============================================================================
// Rent Intelligence Engine — Phase 5b listing-cap validation runner + Teams card
// Life Command Center
//
// Runs the dia SQL validator dia_validate_and_fill_listing_caps (validate broker
// -stated on-market caps against the rent timeline; >75 bps divergence -> the
// dia_listing_cap_review lane; fill truly-capless actives via the labeled
// implied-cap tier), then surfaces the newly-open reviews as a single Teams card
// off v_dia_listing_cap_review_open.
//
// STATED caps are never overwritten (the SQL only queues divergence + fills
// capless via a side tier). Every derivation is ancestry-checked in SQL. This
// runner is a drop-in for a cron / admin sub-route (matches the lcc_cron_post
// pattern); it never fails its caller (fire-and-forget safe).
// ============================================================================

import { sendTeamsAlert } from './teams-alert.js';

const DOMAIN = 'dialysis';
const APP_BASE = process.env.LCC_APP_BASE_URL || 'https://app.lifecommandcenter.com';

/**
 * @param {function} domainQuery - _shared/domain-db.js helper (domain, method, path, body)
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {number}  [opts.divergenceBps=75]
 * @param {number}  [opts.cardLimit=8] - top-N divergent reviews to list on the card
 * @param {boolean} [opts.postCard=true]
 * @returns {Promise<{ok:boolean, verdict?:object, cardPosted?:boolean, reason?:string}>}
 */
export async function runListingCapValidation(domainQuery, opts = {}) {
  try {
    if (typeof domainQuery !== 'function') return { ok: false, reason: 'no_domain_query' };
    const dryRun = opts.dryRun === true;
    const divergenceBps = opts.divergenceBps != null ? Number(opts.divergenceBps) : 75;

    const runRes = await domainQuery(DOMAIN, 'POST', 'rpc/dia_validate_and_fill_listing_caps', {
      p_dry_run: dryRun,
      p_batch: null,
      p_divergence_bps: divergenceBps,
      p_limit: null,
    });
    const verdict = runRes && runRes.ok
      ? (Array.isArray(runRes.data) ? runRes.data[0] : runRes.data)
      : null;
    if (!verdict) return { ok: false, reason: 'no_verdict', status: runRes?.status };

    let cardPosted = false;
    if (!dryRun && opts.postCard !== false && Number(verdict.flagged_divergent) > 0) {
      cardPosted = await surfaceListingCapReviewCard(domainQuery, verdict, opts.cardLimit || 8)
        .catch((e) => { console.warn('[listing-cap] teams card failed', e?.message); return false; });
    }
    return { ok: true, verdict, cardPosted };
  } catch (err) {
    console.error('[listing-cap] runner error (non-blocking)', err?.message);
    return { ok: false, reason: 'threw', error: err?.message };
  }
}

async function surfaceListingCapReviewCard(domainQuery, verdict, cardLimit) {
  const res = await domainQuery(DOMAIN, 'GET',
    `v_dia_listing_cap_review_open?select=listing_id,property_id,stated_cap,implied_cap,divergence_bps` +
    `&order=divergence_bps.desc&limit=${encodeURIComponent(cardLimit)}`);
  const rows = res?.ok && Array.isArray(res.data) ? res.data : [];
  if (!rows.length) return false;

  const pct = (v) => (v == null ? 'n/a' : `${(Number(v) * 100).toFixed(2)}%`);
  const facts = rows.map((r) => [
    `Listing ${r.listing_id} (prop ${r.property_id})`,
    `stated ${pct(r.stated_cap)} vs timeline ${pct(r.implied_cap)} — ${Math.round(Number(r.divergence_bps))} bps`,
  ]);

  await sendTeamsAlert({
    title: `Listing cap review — ${verdict.flagged_divergent} on-market caps diverge from the rent timeline`,
    summary:
      `The rent-intelligence timeline implies a materially different cap than the broker-stated cap on ` +
      `${verdict.flagged_divergent} on-market listing(s) (>75 bps). Stated caps are NOT changed — confirm ` +
      `or dismiss each. (${verdict.capless_filled} capless active(s) filled from the timeline; ` +
      `${verdict.skipped_circular} skipped by the Ancestry Rule.)`,
    facts,
    actions: [{ label: 'Open listings', url: `${APP_BASE}/#/dia` }],
    severity: 'warning',
  });
  return true;
}
