// ============================================================================
// Rent Projection + Sale Cap-Rate Recalc — dialysis DB
// Life Command Center
//
// JavaScript port of pipeline/cap_rate_recalc.py (see that file + the
// 20260414192825_cap_rate_rent_anchor.sql migration for background).
//
// When a confirmed rent anchor (from an OM or a signed lease) arrives on a
// property, every historical sale on that property needs its cap rate
// recomputed against the rent that would have been in place at the sale date.
// The CoStar-ingest path sets stated_cap_rate + cap_rate_confidence='low'
// and leaves the calculated fields null; this module fills them in once a
// confirmed anchor is known.
//
// Exports:
//   projectRentAtDate({...})               — pure escalation helper
//   recalculateSaleCapRates(propId, domainQuery) — end-to-end recalc
// ============================================================================

const DOMAIN = 'dialysis';

// ── Date helpers ────────────────────────────────────────────────────────────

function coerceDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    // Accept YYYY-MM-DD or a full ISO timestamp.
    const s = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00Z' : value;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  throw new TypeError(`Cannot coerce ${String(value)} to date`);
}

function monthsBetween(earlier, later) {
  let months = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12
             + (later.getUTCMonth()    - earlier.getUTCMonth());
  if (later.getUTCDate() < earlier.getUTCDate()) months -= 1;
  return months;
}

// ── Rent projection ─────────────────────────────────────────────────────────

/**
 * Project ``anchorRent`` forward (or backward) to ``targetDate`` using a
 * straight-line step-escalation schedule anchored on ``leaseCommencement``
 * when supplied (so bumps fall on true lease anniversaries); otherwise the
 * anchor date is used.
 *
 * @returns {{ projected_rent:number, bumps_applied:number }}
 */
export function projectRentAtDate({
  anchorRent,
  anchorDate,
  targetDate,
  bumpPct,
  bumpIntervalMonths,
  leaseCommencement,
}) {
  if (anchorRent == null) throw new Error('anchorRent is required');
  if (!bumpIntervalMonths || bumpIntervalMonths <= 0) {
    throw new Error('bumpIntervalMonths must be positive');
  }
  const anchorD = coerceDate(anchorDate);
  const targetD = coerceDate(targetDate);
  if (!anchorD || !targetD) throw new Error('anchorDate and targetDate are required');

  const baseD = coerceDate(leaseCommencement) || anchorD;
  const pct = Number(bumpPct || 0);

  const bumpsSinceBase = (d) => {
    const m = monthsBetween(baseD, d);
    if (m <= 0) return 0;
    return Math.floor(m / bumpIntervalMonths);
  };

  const delta = bumpsSinceBase(targetD) - bumpsSinceBase(anchorD);

  let projected;
  if (pct === 0 || delta === 0) projected = Number(anchorRent);
  else if (delta > 0)            projected = Number(anchorRent) * Math.pow(1 + pct, delta);
  else                           projected = Number(anchorRent) / Math.pow(1 + pct, -delta);

  return {
    projected_rent: Math.round(projected * 100) / 100,
    bumps_applied:  delta,
  };
}

// ── Recalc entry point ──────────────────────────────────────────────────────

/**
 * Recompute calculated_cap_rate for every sale on ``propertyId`` in the
 * dialysis DB. No-op if the property has no confirmed anchor rent yet, so
 * it is safe to call on every save.
 *
 * @param {string|number} propertyId
 * @param {(domain:string, method:string, path:string, body?:object)
 *          => Promise<{ok:boolean, status:number, data:any}>} domainQuery
 *        — pass the domainQuery helper from _shared/domain-db.js
 * @returns {Promise<{updated:number, skipped:number, reason?:string}>}
 */
export async function recalculateSaleCapRates(propertyId, domainQuery) {
  if (propertyId == null || propertyId === '') {
    return { updated: 0, skipped: 0, reason: 'no_property_id' };
  }
  if (typeof domainQuery !== 'function') {
    throw new Error('domainQuery function is required');
  }

  const propRes = await domainQuery(DOMAIN, 'GET',
    `properties?property_id=eq.${encodeURIComponent(propertyId)}` +
    `&select=anchor_rent,anchor_rent_date,anchor_rent_source,` +
    `lease_commencement,lease_bump_pct,lease_bump_interval_mo&limit=1`
  );
  if (!propRes.ok) {
    return { updated: 0, skipped: 0, reason: 'property_lookup_failed' };
  }

  const prop = Array.isArray(propRes.data) ? propRes.data[0] : null;
  if (!prop || prop.anchor_rent == null || !prop.anchor_rent_date) {
    return { updated: 0, skipped: 0, reason: 'no_anchor' };
  }

  const confidence = prop.anchor_rent_source === 'lease_confirmed' ? 'high' : 'medium';
  const rentSource = `projected_from_${prop.anchor_rent_source || 'om_confirmed'}`;

  // Filter out incomplete sale rows at the DB level so we never PATCH
  // cap_rate_confidence / rent_source on a row that is missing the inputs
  // required to compute calculated_cap_rate. A client-side guard below
  // retains the same invariant for defense-in-depth.
  const SALE_PRICE_COLUMN = 'sold_price';
  const salesRes = await domainQuery(DOMAIN, 'GET',
    `sales_transactions?property_id=eq.${encodeURIComponent(propertyId)}` +
    `&sale_date=not.is.null&${SALE_PRICE_COLUMN}=not.is.null` +
    `&select=sale_id,sale_date,${SALE_PRICE_COLUMN}`
  );
  if (!salesRes.ok) {
    return { updated: 0, skipped: 0, reason: 'sales_lookup_failed' };
  }
  const sales = Array.isArray(salesRes.data) ? salesRes.data : [];
  console.log(
    `[cap-rate-recalc] property=${propertyId} ` +
    `sale_price_column=${SALE_PRICE_COLUMN} sales_found=${sales.length}`
  );

  let updated = 0;
  let skipped = 0;

  for (const sale of sales) {
    // Defensive: skip rows missing sale_date or sold_price without writing
    // cap_rate_confidence or rent_source. The DB-level filter above should
    // already exclude these, but belt-and-suspenders.
    if (sale.sold_price == null || !sale.sale_date) {
      skipped++;
      continue;
    }

    let projection;
    try {
      projection = projectRentAtDate({
        anchorRent:         Number(prop.anchor_rent),
        anchorDate:         prop.anchor_rent_date,
        targetDate:         sale.sale_date,
        bumpPct:            prop.lease_bump_pct != null ? Number(prop.lease_bump_pct) : 0.10,
        bumpIntervalMonths: prop.lease_bump_interval_mo || 60,
        leaseCommencement:  prop.lease_commencement,
      });
    } catch (err) {
      console.warn('[recalculateSaleCapRates] projectRentAtDate failed:',
        { sale_id: sale.sale_id, error: err?.message });
      skipped++;
      continue;
    }

    const soldPrice = Number(sale.sold_price);
    if (!soldPrice) { skipped++; continue; }
    const calculatedCap = projection.projected_rent / soldPrice;

    const patch = {
      rent_at_sale:        projection.projected_rent,
      calculated_cap_rate: Math.round(calculatedCap * 10000) / 10000,
      rent_source:         rentSource,
      cap_rate_confidence: confidence,
    };

    // Explicit table guard: calculated_cap_rate is a *transaction* cap rate
    // and must NEVER be PATCHed into available_listings (whose cap_rate is
    // the listing's asking cap rate, sourced only from CoStar). Refuse to
    // issue the PATCH if the path is not targeted at sales_transactions.
    const TARGET_TABLE = 'sales_transactions';
    const patchPath = `${TARGET_TABLE}?sale_id=eq.${encodeURIComponent(sale.sale_id)}`;
    if (!patchPath.startsWith(`${TARGET_TABLE}?`)) {
      throw new Error(
        `[cap-rate-recalc] refusing to PATCH non-${TARGET_TABLE} table: ${patchPath}`
      );
    }

    const res = await domainQuery(DOMAIN, 'PATCH', patchPath, patch);
    if (res.ok) updated++;
    else        skipped++;
  }

  return { updated, skipped };
}
