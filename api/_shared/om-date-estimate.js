// ============================================================================
// OM date estimation — infer when an OM was created from its lease metadata
// Life Command Center — Round 76u (2026-04-27)
//
// Many OMs don't include their own creation date in the body, but they do
// include lease metadata that lets us back-into a reasonable estimate.
// Examples:
//
//   1. lease_expiration + lease_term_remaining_years  →
//        om_created ≈ lease_expiration - lease_term_remaining_years
//   2. lease_commencement + lease_term_years          →
//        lease_expiration  ≈ lease_commencement + lease_term_years
//        om_created ≈ now() if lease is still active, else not estimable
//
// This is used to validate close_listing_on_sale: when CoStar reports a
// sale_date that postdates the inferred om_created date, the OM-derived
// listing should be marked as Sold/off-market.
//
// Output is a confidence-tagged object so consumers can decide how much
// to trust it. Confidence is one of:
//   - 'derived'      — both inputs present, math is direct
//   - 'estimated'    — one input + one fallback (e.g. assumed standard term)
//   - 'unknown'      — no signal, returns null
// ============================================================================

/**
 * Estimate the OM's creation date from extraction snapshot lease metadata.
 *
 * @param {object} snapshot — extraction_snapshot fields. Recognized keys:
 *   - lease_expiration           (ISO date string, e.g. "2034-04-30")
 *   - lease_commencement         (ISO date string, e.g. "2019-05-01")
 *   - lease_term_years           (number, total original lease term)
 *   - lease_term_remaining_years (number, years remaining at OM time)
 *   - remaining_term             (string, free-form like "8 years remaining")
 * @returns {{ om_created_estimate: string|null, confidence: string, source: string }}
 *   - om_created_estimate: ISO date string (YYYY-MM-DD) or null
 *   - confidence: 'derived' | 'estimated' | 'unknown'
 *   - source: short tag describing which inputs were used
 */
export function estimateOmCreatedDate(snapshot) {
  if (!snapshot) {
    return { om_created_estimate: null, confidence: 'unknown', source: 'no_snapshot' };
  }

  const expiration  = parseLooseDate(snapshot.lease_expiration);
  const commencement = parseLooseDate(snapshot.lease_commencement);
  const termYears  = parseNumberLoose(snapshot.lease_term_years);
  let   remainingYears = parseNumberLoose(snapshot.lease_term_remaining_years);

  // Best path: lease_expiration + lease_term_remaining_years.
  // om_created ≈ lease_expiration - remaining_years.
  if (expiration && remainingYears != null && remainingYears >= 0) {
    const est = subtractYears(expiration, remainingYears);
    return {
      om_created_estimate: toIsoDate(est),
      confidence: 'derived',
      source: 'expiration_minus_remaining',
    };
  }

  // Try parsing the free-form 'remaining_term' field: "8 years remaining",
  // "10.5 yrs", etc. — when the structured field wasn't extracted but the
  // OM body had it as text.
  if (expiration && snapshot.remaining_term && remainingYears == null) {
    const parsed = parseRemainingTermString(snapshot.remaining_term);
    if (parsed != null) {
      const est = subtractYears(expiration, parsed);
      return {
        om_created_estimate: toIsoDate(est),
        confidence: 'derived',
        source: 'expiration_minus_remaining_term_str',
      };
    }
  }

  // Second-best: lease_commencement + half-life heuristic.
  // For a typical 15-year NNN lease, OMs are most often shopped in the
  // 5-9 year range from commencement (mid-life trade or before-rollover
  // refinance). Use commencement + 7 as a midpoint estimate.
  if (commencement && termYears && termYears > 0) {
    const halfLife = Math.min(termYears * 0.5, 8);
    const est = addYears(commencement, halfLife);
    return {
      om_created_estimate: toIsoDate(est),
      confidence: 'estimated',
      source: 'commencement_plus_halflife',
    };
  }

  // Fallback: no signal.
  return { om_created_estimate: null, confidence: 'unknown', source: 'no_signal' };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseLooseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseNumberLoose(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseRemainingTermString(s) {
  if (!s) return null;
  // Common formats: "8 years remaining", "10 yrs", "12.5 years", "~9 yrs"
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*(?:yr|yrs|year|years)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

function subtractYears(date, years) {
  const out = new Date(date.getTime());
  const wholeYears = Math.floor(years);
  const fracDays   = Math.round((years - wholeYears) * 365.25);
  out.setUTCFullYear(out.getUTCFullYear() - wholeYears);
  out.setUTCDate(out.getUTCDate() - fracDays);
  return out;
}

function addYears(date, years) {
  return subtractYears(date, -years);
}

function toIsoDate(d) {
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}
