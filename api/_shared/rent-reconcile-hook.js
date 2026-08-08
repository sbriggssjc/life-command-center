// ============================================================================
// Rent Intelligence Engine — post-ingest reconciliation hook (Phase 3)
// Life Command Center
//
// Single entry point the intake paths call AFTER they write evidence (sale
// ingest, OM intake, listing refresh, lease load). Delegates the actual
// unit-normalize -> sanity-gate -> diff -> classify/fork/corroborate logic to
// the dia SQL function dia_reconcile_rent_evidence (the single writer of the
// timeline + rent_reconcile_queue).
//
// NON-BLOCKING CONTRACT: a reconciliation failure must NEVER fail the parent
// ingest. Every path is wrapped; errors are logged and swallowed. Queue/fork
// outcomes surface a Teams card via the existing teams-alert pipeline.
//
// Only the dialysis domain is wired today (the timeline lives in dia). The gov
// reuse follows the same shape once gov_reconcile_rent_evidence lands.
// ============================================================================

import { sendTeamsAlert } from './teams-alert.js';

const RECONCILE_DOMAIN = 'dialysis';
const APP_BASE = process.env.LCC_APP_BASE_URL || 'https://app.lifecommandcenter.com';

/**
 * Fire the rent reconciliation for one evidence event. Fire-and-forget safe.
 *
 * @param {object} p
 * @param {string} [p.domain='dialysis'] - only 'dialysis'/'dia' reconciles today
 * @param {number|string} p.propertyId
 * @param {number} p.rentAnnual - stated rent (annual total OR PSF; normalized in SQL)
 * @param {string} p.evidenceDate - ISO date of the evidence
 * @param {string} p.source - 'sales_ingest' | 'om_intake' | 'listing_refresh' | 'lease_load'
 * @param {object} [p.sourceRef] - ids for the deep link / provenance
 * @param {string} [p.sourceConfidence] - 'documented'|'high'|'inferred'|'low'
 * @param {number} [p.newRba] - expansion signal (rba_change classification)
 * @param {string} [p.newExpiry] - early-extension signal
 * @param {function} domainQuery - _shared/domain-db.js helper
 * @returns {Promise<{ok:boolean, verdict?:string, forked?:boolean, queued?:boolean, reason?:string}>}
 */
export async function reconcileRentEvidence(p, domainQuery) {
  try {
    const domain = p.domain || RECONCILE_DOMAIN;
    if (domain !== 'dialysis' && domain !== 'dia') {
      return { ok: false, reason: 'domain_not_wired' };
    }
    if (p.propertyId == null || p.rentAnnual == null || !p.evidenceDate) {
      return { ok: false, reason: 'insufficient_input' };
    }
    if (typeof domainQuery !== 'function') {
      return { ok: false, reason: 'no_domain_query' };
    }

    const res = await domainQuery(RECONCILE_DOMAIN, 'POST', 'rpc/dia_reconcile_rent_evidence', {
      p_property_id: Number(p.propertyId),
      p_rent: Number(p.rentAnnual),
      p_evidence_date: p.evidenceDate,
      p_source: p.source || 'unknown',
      p_source_ref: p.sourceRef || {},
      p_source_confidence: p.sourceConfidence || null,
      p_new_rba: p.newRba != null ? Number(p.newRba) : null,
      p_new_expiry: p.newExpiry || null,
    });

    const out = res && res.ok ? (Array.isArray(res.data) ? res.data[0] : res.data) : null;
    if (!out) {
      console.warn('[rent-reconcile] no verdict', { property: p.propertyId, status: res?.status });
      return { ok: false, reason: 'no_verdict' };
    }

    // Surface actionable outcomes to Teams (never corroborations — not actionable).
    if (out.queued === true || out.forked === true) {
      await surfaceReconcileCard(p, out).catch((e) =>
        console.warn('[rent-reconcile] teams card failed', e?.message));
    }
    return { ok: true, ...out };
  } catch (err) {
    // NON-BLOCKING: swallow so the parent ingest is never failed by reconciliation.
    console.error('[rent-reconcile] hook error (non-blocking)', err?.message);
    return { ok: false, reason: 'hook_threw', error: err?.message };
  }
}

/**
 * Convenience for the consolidated ingest paths (sidebar CoStar capture): read
 * the property's freshest rent evidence and reconcile it. Picks the newest dated
 * point among the confirmed anchor rent and the latest sale rent_at_sale, so a
 * single call covers the sale/OM/lease-load that the capture just wrote.
 * Fire-and-forget safe.
 */
export async function reconcileLatestEvidence(domain, propertyId, domainQuery, opts = {}) {
  try {
    if ((domain !== 'dialysis' && domain !== 'dia') || propertyId == null) {
      return { ok: false, reason: 'domain_not_wired' };
    }
    const propRes = await domainQuery(RECONCILE_DOMAIN, 'GET',
      `properties?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&select=anchor_rent,anchor_rent_date,anchor_rent_source,tenant,operator&limit=1`);
    const prop = propRes?.ok && Array.isArray(propRes.data) ? propRes.data[0] : null;

    const saleRes = await domainQuery(RECONCILE_DOMAIN, 'GET',
      `sales_transactions?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&rent_at_sale=not.is.null&rent_source=not.like.projected*` +
      `&order=sale_date.desc&limit=1&select=sale_id,rent_at_sale,rent_source,sale_date`);
    const sale = saleRes?.ok && Array.isArray(saleRes.data) ? saleRes.data[0] : null;

    // candidate evidence points (newest dated wins)
    const cands = [];
    if (prop?.anchor_rent != null && prop.anchor_rent_date) {
      cands.push({
        rentAnnual: prop.anchor_rent, evidenceDate: prop.anchor_rent_date,
        source: opts.source || (prop.anchor_rent_source === 'lease_confirmed' ? 'lease_load' : 'om_intake'),
        sourceRef: { anchor_rent_source: prop.anchor_rent_source },
        sourceConfidence: prop.anchor_rent_source === 'lease_confirmed' ? 'documented' : 'high',
      });
    }
    if (sale?.rent_at_sale != null && sale.sale_date) {
      cands.push({
        rentAnnual: sale.rent_at_sale, evidenceDate: sale.sale_date, source: 'sales_ingest',
        sourceRef: { sale_id: sale.sale_id, rent_source: sale.rent_source },
        sourceConfidence: 'high',
      });
    }
    if (!cands.length) return { ok: false, reason: 'no_evidence' };
    cands.sort((a, b) => String(b.evidenceDate).localeCompare(String(a.evidenceDate)));
    const pick = cands[0];
    return await reconcileRentEvidence({ domain: RECONCILE_DOMAIN, propertyId, ...pick }, domainQuery);
  } catch (err) {
    console.error('[rent-reconcile] reconcileLatestEvidence error (non-blocking)', err?.message);
    return { ok: false, reason: 'threw', error: err?.message };
  }
}

async function surfaceReconcileCard(p, out) {
  const verdict = out.verdict || (out.forked ? 'forked' : 'queued');
  const isQueue = out.queued === true;
  const propUrl = `${APP_BASE}/#/dia?d=prop:dia:${p.propertyId}:Rent`;
  const facts = [
    ['Property', String(p.propertyId)],
    ['Source', p.source || 'unknown'],
    ['Verdict', verdict],
    ['Diff', out.diff != null ? `${(Number(out.diff) * 100).toFixed(1)}%` : 'n/a'],
  ];
  if (out.forked && out.new_version != null) facts.push(['New version', String(out.new_version)]);
  if (isQueue && out.issue) facts.push(['Issue', out.issue]);

  await sendTeamsAlert({
    title: isQueue
      ? `Rent conflict needs review — property ${p.propertyId}`
      : `Rent timeline forked (${verdict}) — property ${p.propertyId}`,
    summary: isQueue
      ? `New ${p.source || ''} evidence disagrees with the modeled rent curve and could not be auto-classified. Review the evidence pair and classify.`
      : `New ${p.source || ''} evidence classified as ${verdict}; a new timeline version was forked (prior version preserved).`,
    facts,
    actions: [{ label: isQueue ? 'Review conflict' : 'Open rent timeline', url: propUrl }],
    severity: isQueue ? 'high' : 'info',
  });
}
