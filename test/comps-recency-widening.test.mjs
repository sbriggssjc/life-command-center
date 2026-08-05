// Prompt 41 — recency default (last 18 months) + widening order in runSynthesize.
// A no-window sold pull defaults to the last 18 months; when too few qualify the
// engine widens by ADDING OPERATORS first (DaVita → +others), logging every step
// to meta.widened, rather than silently keeping stale comps.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSynthesize } from '../mcp/comps-tools.js';

const DAY = 86400000;
function daysAgoISO(n) { return new Date(Date.now() - n * DAY).toISOString().slice(0, 10); }

// A dialysis sold universe: 1 DaVita inside 18 months, several Fresenius / US
// Renal inside 18 months, and an old DaVita outside 18 months.
const UNIVERSE = [
  { comp_id: 'd1', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'DaVita Dialysis', address: '1 A St', city: 'Tampa', state: 'FL', sale_date: daysAgoISO(60),  sale_price: 5000000, cap_rate: 0.065, building_sf: 8000 },
  { comp_id: 'd_old', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'DaVita', address: '9 Old St', city: 'Tampa', state: 'FL', sale_date: daysAgoISO(900), sale_price: 4000000, cap_rate: 0.07, building_sf: 7000 },
  { comp_id: 'f1', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'FMC', address: '2 B St', city: 'Miami', state: 'FL', sale_date: daysAgoISO(90),  sale_price: 6000000, cap_rate: 0.066, building_sf: 9000 },
  { comp_id: 'f2', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'Bio-Medical Applications', address: '3 C St', city: 'Orlando', state: 'FL', sale_date: daysAgoISO(120), sale_price: 5500000, cap_rate: 0.067, building_sf: 8500 },
  { comp_id: 'u1', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'U.S. Renal Care', address: '4 D St', city: 'Dallas', state: 'TX', sale_date: daysAgoISO(150), sale_price: 5200000, cap_rate: 0.068, building_sf: 8200 },
  { comp_id: 'u2', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'USRC', address: '5 E St', city: 'Houston', state: 'TX', sale_date: daysAgoISO(200), sale_price: 5300000, cap_rate: 0.069, building_sf: 8300 },
];

function makeDeps() {
  const calls = [];
  const diaQuery = async (method, path, body) => {
    if (path === 'rpc/rpc_query_comps') {
      calls.push({ p_tenant: body.p_tenant, p_date_from: body.p_date_from });
      const rows = UNIVERSE.filter(r => {
        if (body.p_date_from && r.sale_date < body.p_date_from) return false;
        if (body.p_tenant) {
          const t = String(body.p_tenant).toLowerCase();
          const hay = r.tenant.toLowerCase();
          // crude: only DaVita rows match a "DaVita" tenant filter
          if (t.includes('davita') && !hay.includes('davita')) return false;
        }
        return true;
      }).map(r => ({ ...r }));
      return { ok: true, status: 200, data: rows };
    }
    return { ok: false, status: 500, data: null };   // engine-income / review-queue best-effort no-ops
  };
  const govQuery = async () => ({ ok: true, status: 200, data: [] });
  return { deps: { diaQuery, govQuery }, calls };
}

describe('runSynthesize recency default + widening (prompt 41)', () => {
  it('defaults to an 18-month window and records it', async () => {
    const { deps } = makeDeps();
    const res = await runSynthesize({ property_types: ['dialysis'], comp_type: 'sale', limit: 3 }, deps);
    assert.ok(res.meta.recency_window_default, 'recency_window_default set');
    // ~18 months ≈ 540 days ago (allow drift)
    const days = (Date.now() - Date.parse(res.meta.recency_window_default)) / DAY;
    assert.ok(days > 520 && days < 560, `window ~18mo, got ${days.toFixed(0)}d`);
  });

  it('widens by adding operators when a single-operator window is short, and logs it', async () => {
    const { deps, calls } = makeDeps();
    const res = await runSynthesize({ property_types: ['dialysis'], comp_type: 'sale', tenant: 'DaVita', limit: 4 }, deps);
    // First pull was DaVita-scoped inside 18 months (only 1 qualifies) → widened.
    assert.ok(Array.isArray(res.meta.widened) && res.meta.widened.length >= 1, 'widened logged');
    assert.equal(res.meta.widened[0].step, 'operators');
    // Result now spans multiple operators (DaVita + Fresenius brands present).
    const brands = new Set(res.comps.map(c => c.tenant));
    assert.ok([...brands].some(b => /DaVita/.test(b)), 'has DaVita');
    assert.ok([...brands].some(b => /Fresenius/.test(b)), 'has Fresenius (standardized from FMC/BMA)');
    // No stale (>18mo) comp silently kept: the old DaVita sale is excluded.
    assert.ok(!res.comps.some(c => c.comp_id === 'd_old'), 'stale comp not kept');
    // The initial pull carried the DaVita tenant filter; a later pull dropped it.
    assert.ok(calls.some(c => c.p_tenant && /davita/i.test(c.p_tenant)), 'initial DaVita-scoped pull');
    assert.ok(calls.some(c => !c.p_tenant), 'widened pull dropped the operator filter');
  });

  it('standardizes operator brand on the TENANT column', async () => {
    const { deps } = makeDeps();
    const res = await runSynthesize({ property_types: ['dialysis'], comp_type: 'sale', limit: 10 }, deps);
    const fmc = res.comps.find(c => c.comp_id === 'f1');
    assert.equal(fmc.tenant, 'Fresenius Medical Care');
    const usrc = res.comps.find(c => c.comp_id === 'u2');
    assert.equal(usrc.tenant, 'US Renal Care');
  });
});
