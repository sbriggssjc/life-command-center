// ============================================================================
// Rent Intelligence Engine — Phase 5g BOV / diligence evidence hook
// Life Command Center
//
// When a BOV / underwriting workbook is BUILT from diligence docs (rent roll,
// lease abstract), or a comps-engine run surfaces a VERIFIED rent correction,
// the confirmed rent/commencement/term/bumps feed the dia rent timeline as
// DOCUMENTED evidence (provenance = bov_id + doc ref) through the SQL entry
// point dia_ingest_bov_rent_evidence (which rebuilds the property's timeline so
// the confirmed rent lands immediately). Every workflow that LEARNS a rent
// teaches the system.
//
// Ancestry-checked in SQL (a BOV cannot confirm a rent that already descends
// from itself). NON-BLOCKING: a failure here must never fail the BOV/comps run.
//
// Call sites:
//   - the bov-underwriting output step, once the workbook's confirmed rent roll
//     / lease abstract is finalized (one call per property-year confirmed).
//   - the comps-engine, when a run corrects a rent to a verified value.
// ============================================================================

const DOMAIN = 'dialysis';

/**
 * @param {function} domainQuery - _shared/domain-db.js helper (domain, method, path, body)
 * @param {object} p
 * @param {number|string} p.propertyId
 * @param {string} p.evidenceDate      - ISO date the confirmed rent is effective
 * @param {number} p.confirmedRent      - annual total (or PSF; normalized in SQL)
 * @param {string} p.bovId              - stable BOV / run id (provenance key)
 * @param {object} [p.docRef]           - {doc, page, sharefile_id, ...}
 * @param {string} [p.channel='bov_rent_roll'] - bov_rent_roll | lease_abstract | comps_verified_correction
 * @param {string} [p.commencement] [p.expiration]
 * @param {number} [p.bumpPct] [p.bumpIntervalYears]
 * @param {number} [p.confidence=0.95]
 * @param {boolean} [p.rebuild=true]
 * @param {boolean} [p.dryRun=false]
 * @returns {Promise<{ok:boolean, verdict?:object, reason?:string}>}
 */
export async function ingestBovRentEvidence(domainQuery, p = {}) {
  try {
    if (typeof domainQuery !== 'function') return { ok: false, reason: 'no_domain_query' };
    if (p.propertyId == null || !p.evidenceDate || p.confirmedRent == null || !p.bovId) {
      return { ok: false, reason: 'insufficient_input' };
    }
    const res = await domainQuery(DOMAIN, 'POST', 'rpc/dia_ingest_bov_rent_evidence', {
      p_property_id: Number(p.propertyId),
      p_evidence_date: p.evidenceDate,
      p_confirmed_rent: Number(p.confirmedRent),
      p_bov_id: String(p.bovId),
      p_doc_ref: p.docRef || {},
      p_channel: p.channel || 'bov_rent_roll',
      p_commencement: p.commencement || null,
      p_expiration: p.expiration || null,
      p_bump_pct: p.bumpPct != null ? Number(p.bumpPct) : null,
      p_bump_interval_years: p.bumpIntervalYears != null ? Number(p.bumpIntervalYears) : null,
      p_confidence: p.confidence != null ? Number(p.confidence) : 0.95,
      p_rebuild: p.rebuild !== false,
      p_batch: null,
      p_dry_run: p.dryRun === true,
    });
    const verdict = res && res.ok ? (Array.isArray(res.data) ? res.data[0] : res.data) : null;
    if (!verdict) return { ok: false, reason: 'no_verdict', status: res?.status };
    return { ok: verdict.ok !== false, verdict };
  } catch (err) {
    console.error('[bov-evidence] hook error (non-blocking)', err?.message);
    return { ok: false, reason: 'threw', error: err?.message };
  }
}
