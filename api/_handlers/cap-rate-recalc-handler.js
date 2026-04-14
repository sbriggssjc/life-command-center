// ============================================================================
// Cap-Rate Recalculation Handler — one-time backfill / on-demand recompute
// Life Command Center
//
// Exposed via:
//   POST /api/recalculate-cap-rates                   (all dialysis properties
//                                                      with anchor_rent set)
//   POST /api/recalculate-cap-rates?property_id=XXXX  (single property)
//
// Rewrites to /api/entity-hub?_domain=cap-rate-recalc and dispatches here.
//
// For each property, invokes _shared/rent-projection.recalculateSaleCapRates()
// which recomputes calculated_cap_rate on sales_transactions against the
// confirmed rent anchor on the dialysis properties row. Safe to run at any
// time — a property with no anchor_rent is a no-op.
//
// Auth: Uses the standard authenticate() middleware (Supabase JWT → API key →
// dev fallback). Same surface as other entity-hub sub-routes.
// ============================================================================

import { authenticate, handleCors } from '../_shared/auth.js';
import { domainQuery, getDomainCredentials } from '../_shared/domain-db.js';
import { recalculateSaleCapRates } from '../_shared/rent-projection.js';

const DOMAIN = 'dialysis';

export async function capRateRecalcHandler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const user = await authenticate(req, res);
  if (!user) return;

  if (!getDomainCredentials(DOMAIN)) {
    res.status(503).json({ error: 'Dialysis database not configured' });
    return;
  }

  const { property_id } = req.query;

  // ── Single property mode ──────────────────────────────────────────────────
  if (property_id) {
    const result = await runOne(property_id);
    console.log(
      `[cap-rate-recalc] backfill property=${property_id} ` +
      `updated=${result.updated} skipped=${result.skipped} ` +
      `error=${result.error || 'none'} reason=${result.reason || 'n/a'}`
    );
    return res.status(200).json({
      scope: 'single',
      property_id,
      ...result,
    });
  }

  // ── Batch mode: all dialysis properties where anchor_rent IS NOT NULL ─────
  const listRes = await domainQuery(DOMAIN, 'GET',
    `properties?anchor_rent=not.is.null&select=property_id&limit=10000`
  );
  if (!listRes.ok) {
    console.error('[cap-rate-recalc] batch property lookup failed:',
      listRes.status, listRes.data);
    return res.status(502).json({ error: 'property_lookup_failed', detail: listRes.data });
  }

  const rows = Array.isArray(listRes.data) ? listRes.data : [];
  console.log(`[cap-rate-recalc] batch start — ${rows.length} properties with anchor_rent`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  const errors = [];
  const perProperty = [];

  for (const row of rows) {
    const pid = row.property_id;
    const result = await runOne(pid);
    totalUpdated += result.updated || 0;
    totalSkipped += result.skipped || 0;
    if (result.error) {
      errors.push({ property_id: pid, error: result.error });
    }
    perProperty.push({
      property_id: pid,
      updated: result.updated || 0,
      skipped: result.skipped || 0,
      reason: result.reason || null,
      error: result.error || null,
    });
    console.log(
      `[cap-rate-recalc] property=${pid} ` +
      `updated=${result.updated || 0} skipped=${result.skipped || 0} ` +
      `reason=${result.reason || 'n/a'} error=${result.error || 'none'}`
    );
  }

  console.log(
    `[cap-rate-recalc] batch complete — properties=${rows.length} ` +
    `updated=${totalUpdated} skipped=${totalSkipped} errors=${errors.length}`
  );

  return res.status(200).json({
    scope: 'all',
    property_count: rows.length,
    updated: totalUpdated,
    skipped: totalSkipped,
    errors,
    per_property: perProperty,
  });
}

/**
 * Run recalculateSaleCapRates for a single property, catching any throw so
 * a batch run isn't aborted by a single bad row.
 */
async function runOne(propertyId) {
  try {
    const out = await recalculateSaleCapRates(propertyId, domainQuery);
    return {
      updated: out.updated || 0,
      skipped: out.skipped || 0,
      reason: out.reason || null,
      error: null,
    };
  } catch (err) {
    return {
      updated: 0,
      skipped: 0,
      reason: null,
      error: err?.message || String(err),
    };
  }
}
