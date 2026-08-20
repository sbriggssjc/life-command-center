// ─────────────────────────────────────────────────────────────────────────────
// detail-rent.js — W6.5 Stage 2, Unit 1 (extracted from detail.js 2026-08-20).
//
// Rent source-tier policy + escalation parsing for the property slide-over.
// Moved VERBATIM from detail.js lines 3549-3826; not one character changed.
//
// This is a CLASSIC script (not a module) loaded BEFORE detail.js in index.html,
// so it shares the one global scope every other front-end file shares. That is
// the whole reason the extraction is behavior-identical: nothing needed
// rewiring. _udCoerceDate and the renderers (_udRenderRentChart /
// _udRenderRentRoll / _udRentPsfTagHtml) deliberately STAYED in detail.js —
// they are referenced at CALL time, which resolves fine across files.
//
//   _udProjectRent          step-escalation projection (1:1 port of
//                           api/_shared/rent-projection.js::projectRentAtDate)
//   _udPickCurrentRent      the SOURCE-TIER POLICY — which rent figure wins
//   _udParseRentEscalation  free-text bumps -> {pct, intervalMonths}
//   _udBuildRentSchedule    per-lease-year schedule rows
//
// Guarded by test/detail-tab-registry.test.mjs (reads detail.js + every
// detail-*.js as one source) and test/frontend-module-load-order.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** Project anchorRent from anchorDate to targetDate using step escalation
 *  anchored on leaseCommencement (so bumps fall on lease anniversaries).
 *  1:1 port of projectRentAtDate in api/_shared/rent-projection.js. */
function _udProjectRent({ anchorRent, anchorDate, targetDate, bumpPct, bumpIntervalMonths, leaseCommencement }) {
  const anchorD = _udCoerceDate(anchorDate);
  const targetD = _udCoerceDate(targetDate);
  if (anchorRent == null || !anchorD || !targetD || !bumpIntervalMonths) return null;
  const baseD = _udCoerceDate(leaseCommencement) || anchorD;
  const pct = Number(bumpPct || 0);
  const bumps = (d) => {
    const m = _udMonthsBetween(baseD, d);
    return m <= 0 ? 0 : Math.floor(m / bumpIntervalMonths);
  };
  const delta = bumps(targetD) - bumps(anchorD);
  let projected;
  if (pct === 0 || delta === 0)  projected = Number(anchorRent);
  else if (delta > 0)            projected = Number(anchorRent) * Math.pow(1 + pct, delta);
  else                           projected = Number(anchorRent) / Math.pow(1 + pct, -delta);
  return { projected_rent: Math.round(projected * 100) / 100, bumps_applied: delta };
}

/** Pick the rent-of-record for `property`+`lease` at `targetDate` (default: today)
 *  and project it. Returns { rent, rent_psf, tier, source, anchor_date, bumps_applied }
 *  or null if nothing is available. Never reads last_known_rent. */
function _udPickCurrentRent(property, lease, em, targetDate) {
  const p = property || {};
  const l = lease || {};
  const e = em || {};
  const today = targetDate || new Date().toISOString().slice(0, 10);

  const bumpPct      = p.lease_bump_pct != null ? Number(p.lease_bump_pct) : null;
  const bumpInterval = p.lease_bump_interval_mo != null ? Number(p.lease_bump_interval_mo) : null;
  const leaseStart   = l.lease_start || e.lease_commencement || p.lease_commencement || null;
  const leasedSF     = l.leased_area != null ? Number(l.leased_area)
                     : (e.sf_leased != null ? Number(e.sf_leased)
                     : (p.rba != null ? Number(p.rba)
                     : (p.building_size != null ? Number(p.building_size)
                     : (p.building_sf != null ? Number(p.building_sf) : null))));

  // Tier 1/2/5/6: property.anchor_rent triplet — canonical cross-sale anchor.
  if (p.anchor_rent != null && p.anchor_rent_date && bumpPct != null && bumpInterval) {
    const src = String(p.anchor_rent_source || '').toLowerCase();
    const tier = src === 'lease_confirmed' ? 1
               : src === 'om_confirmed'    ? 2
               : src === 'manual_entry'    ? 5
               : src === 'costar_stated'   ? 6
               : 3;
    const proj = _udProjectRent({
      anchorRent: Number(p.anchor_rent),
      anchorDate: p.anchor_rent_date,
      targetDate: today,
      bumpPct, bumpIntervalMonths: bumpInterval,
      leaseCommencement: leaseStart || p.anchor_rent_date,
    });
    if (proj && proj.projected_rent != null) {
      return {
        rent:           proj.projected_rent,
        rent_psf:       leasedSF ? Math.round((proj.projected_rent / leasedSF) * 100) / 100 : null,
        tier,
        source:         `anchor:${src || 'unknown'}`,
        anchor_rent:    Number(p.anchor_rent),
        anchor_date:    p.anchor_rent_date,
        bumps_applied:  proj.bumps_applied,
      };
    }
  }

  // Tier 3/4/5: lease-row annual_rent projected from lease_start → today.
  const baseRent = l.annual_rent != null ? Number(l.annual_rent)
                 : (e.annual_rent != null ? Number(e.annual_rent) : null);
  if (baseRent != null && leaseStart) {
    const conf = String(l.source_confidence || '').toLowerCase();
    const tier = conf === 'documented' ? 3
               : conf === 'estimated'  ? 4
               : 5;
    if (bumpPct != null && bumpInterval) {
      const proj = _udProjectRent({
        anchorRent: baseRent,
        anchorDate: leaseStart,
        targetDate: today,
        bumpPct, bumpIntervalMonths: bumpInterval,
        leaseCommencement: leaseStart,
      });
      if (proj && proj.projected_rent != null) {
        return {
          rent:           proj.projected_rent,
          rent_psf:       leasedSF ? Math.round((proj.projected_rent / leasedSF) * 100) / 100 : null,
          tier,
          source:         `lease:${conf || 'unknown'}`,
          anchor_rent:    baseRent,
          anchor_date:    leaseStart,
          bumps_applied:  proj.bumps_applied,
        };
      }
    }
    // No escalation metadata — return the base rent unprojected.
    return {
      rent:           baseRent,
      rent_psf:       leasedSF ? Math.round((baseRent / leasedSF) * 100) / 100 : null,
      tier,
      source:         `lease:${conf || 'unknown'}:unprojected`,
      anchor_rent:    baseRent,
      anchor_date:    leaseStart,
      bumps_applied:  0,
    };
  }

  return null;
}

window._udPickCurrentRent = _udPickCurrentRent;
window._udProjectRent     = _udProjectRent;

// ── Rent escalation parser ────────────────────────────────────────────────
//
// Parses freeform rent-escalation strings into a structured schedule.
// Supported phrasings (case-insensitive):
//   "2% annually"            → { stepPct: 0.02, intervalYears: 1 }
//   "2% per year"            → same
//   "3.5% yearly"            → { stepPct: 0.035, intervalYears: 1 }
//   "10% every 5 years"      → { stepPct: 0.10, intervalYears: 5 }
//   "$0.50/sf per year"      → { stepPsf: 0.50, intervalYears: 1 }
//   "CPI" / "FMV" / unparsed → null (caller falls back to flat rent)
function _udParseRentEscalation(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/\bcpi\b/.test(s) || /\bfmv\b/.test(s) || /\bmarket\b/.test(s)) {
    // Index-linked or FMV reset — not a deterministic step, skip.
    return null;
  }
  // "Fixed" rent — explicitly 0% bump.
  if (/\bfixed\b/.test(s) || /\bflat\b/.test(s)) {
    return { stepPct: 0, intervalYears: 1 };
  }

  // "X% every N years"
  let m = s.match(/(\d+(?:\.\d+)?)\s*%\s*every\s*(\d+)\s*year/);
  if (m) return { stepPct: parseFloat(m[1]) / 100, intervalYears: parseInt(m[2], 10) };

  // "X% annually" / "X% per year" / "X% yearly" / "X% / year"
  m = s.match(/(\d+(?:\.\d+)?)\s*%\s*(?:annually|per\s*year|yearly|\/\s*year|a\s*year|p\.?a\.?)/);
  if (m) return { stepPct: parseFloat(m[1]) / 100, intervalYears: 1 };

  // "$X/sf per year" (rent/psf bump in dollars, e.g. "$0.50/SF annually")
  m = s.match(/\$?(\d+(?:\.\d+)?)\s*\/\s*sf\s*(?:annually|per\s*year|yearly)/);
  if (m) return { stepPsf: parseFloat(m[1]), intervalYears: 1 };

  // Bare "X%" with no interval — assume annual (safe default for triple-net).
  m = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (m) return { stepPct: parseFloat(m[1]) / 100, intervalYears: 1 };

  return null;
}

/**
 * Build a structured rent schedule for a lease. Prefers rows from
 * lease_rent_schedule when present; otherwise synthesizes one from the
 * parsed escalation string + base rent + term.
 * Returns an array of { year, period_start, period_end, base_rent, rent_psf,
 * bump_pct, cumulative_rent, is_option_window }.
 */
function _udBuildRentSchedule(lease, storedRows, em) {
  // Resolve leased SF once — needed in both branches to backfill rent_psf when
  // upstream rows carry a base_rent but no rent_psf.
  const prop = _udCache?.property || {};
  let leasedSF = lease?.leased_area != null ? Number(lease.leased_area)
                 : (em?.sf_leased != null ? Number(em.sf_leased) : null);
  if (!leasedSF && prop.rba)           leasedSF = Number(prop.rba);
  if (!leasedSF && prop.building_sf)   leasedSF = Number(prop.building_sf);
  if (!leasedSF && prop.building_size) leasedSF = Number(prop.building_size);
  if (!(leasedSF > 0)) leasedSF = null;

  // Case 1: DB-sourced rows — use as-is (authoritative), but compute rent_psf
  // from base_rent / leasedSF when the stored row has a null rent_psf.
  if (Array.isArray(storedRows) && storedRows.length > 0) {
    let cum = 0;
    return storedRows
      .slice()
      .sort((a, b) => (a.lease_year || 0) - (b.lease_year || 0))
      .map(r => {
        const base = r.base_rent != null ? Number(r.base_rent) : null;
        cum += base || 0;
        let rentPsf = r.rent_psf != null ? Number(r.rent_psf) : null;
        if (rentPsf == null && base != null && leasedSF) {
          rentPsf = Math.round((base / leasedSF) * 100) / 100;
        }
        return {
          year: r.lease_year,
          period_start: r.period_start,
          period_end: r.period_end,
          base_rent: base,
          rent_psf: rentPsf,
          bump_pct: r.bump_pct != null ? Number(r.bump_pct) : null,
          cumulative_rent: r.cumulative_rent != null ? Number(r.cumulative_rent) : cum,
          is_option_window: !!r.is_option_window,
          source: r.source || 'db',
        };
      });
  }

  // Case 2: synthesize from base rent + escalation info.
  const baseRent =
    (lease?.annual_rent != null ? Number(lease.annual_rent) : null) ??
    (em?.annual_rent != null ? Number(em.annual_rent) : null);
  if (!baseRent || baseRent <= 0) return [];

  const start = lease?.lease_start || em?.lease_commencement || prop.lease_commencement;
  const end   = lease?.lease_expiration || em?.lease_expiration;
  if (!start) return [];
  const startD = new Date(start);
  const endD   = end ? new Date(end) : null;
  if (isNaN(startD)) return [];
  let termYears;
  if (endD && !isNaN(endD)) {
    termYears = Math.max(1, Math.round((endD - startD) / (365.25 * 24 * 3600 * 1000)));
  } else if (lease?.initial_term_years) {
    termYears = Math.round(Number(lease.initial_term_years));
  } else {
    termYears = 10; // reasonable default for NNN single-tenant
  }
  termYears = Math.min(termYears, 40); // cap runaway synthesis

  // Escalation source priority: verified lease.rent_cagr → parsed escalation
  // text → property-level lease_bump_pct / lease_bump_interval_mo → 0%.
  let stepPct = 0;
  let intervalYears = 1;
  let stepPsf = 0;
  if (lease?.rent_cagr != null) {
    stepPct = Number(lease.rent_cagr);
    intervalYears = 1;
  } else {
    const parsed =
      _udParseRentEscalation(lease?.renewal_options) ||
      _udParseRentEscalation(em?.rent_escalations);
    if (parsed) {
      stepPct = parsed.stepPct || 0;
      stepPsf = parsed.stepPsf || 0;
      intervalYears = parsed.intervalYears || 1;
    } else if (prop.lease_bump_pct != null) {
      // properties.lease_bump_pct is stored as a decimal (0.02 = 2%);
      // lease_bump_interval_mo is months (60 = every 5 years).
      stepPct = Number(prop.lease_bump_pct);
      const mo = Number(prop.lease_bump_interval_mo);
      intervalYears = Number.isFinite(mo) && mo >= 12 ? Math.max(1, Math.round(mo / 12)) : 1;
    }
  }

  const rows = [];
  let rent = baseRent;
  let cum = 0;
  for (let y = 1; y <= termYears; y++) {
    // Apply step at each interval boundary (y > 1 and (y-1) % interval === 0)
    const bumpThisYear = (y > 1 && (y - 1) % intervalYears === 0);
    if (bumpThisYear) {
      if (stepPct) rent = rent * (1 + stepPct);
      else if (stepPsf && leasedSF) rent = rent + (stepPsf * leasedSF);
    }
    const yearStart = new Date(startD);
    yearStart.setFullYear(startD.getFullYear() + (y - 1));
    const yearEnd = new Date(startD);
    yearEnd.setFullYear(startD.getFullYear() + y);
    yearEnd.setDate(yearEnd.getDate() - 1);
    cum += rent;
    rows.push({
      year: y,
      period_start: yearStart.toISOString().slice(0, 10),
      period_end:   yearEnd.toISOString().slice(0, 10),
      base_rent: Math.round(rent * 100) / 100,
      rent_psf:  leasedSF ? Math.round((rent / leasedSF) * 100) / 100 : null,
      bump_pct:  bumpThisYear ? stepPct : 0,
      cumulative_rent: Math.round(cum * 100) / 100,
      is_option_window: false,
      source: 'parsed_estimate',
    });
  }
  return rows;
}
