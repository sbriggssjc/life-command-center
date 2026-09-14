// Prompt 54 — comps engine: enforce the cap-discipline band + reliability filter on the
// DISPLAYED (workbook) set, and join the real on-market date onto sold comps.
//   1. Every SHIPPED Sold/On-Market row obeys displayed cap <= subject cap + 35 bps.
//   2. No shipped row has RENT/SF <12 or >60 (dialysis) or a displayed cap <4.5% — those
//      reliability failures are dropped and routed to the review lane.
//   3. The Sold set average holds below the subject cap.
//   4. The live rpc emits the market-entry date as `list_date`; it flows to the Sold ON MARKET.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDisplayedCapDiscipline, displayedCompCap, runGenerateCompsFromRequest,
} from '../mcp/comps-tools.js';

const DAY = 86400000;
const daysAgoISO = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

// A dialysis sold/on-market universe for The Villages (subject cap 6.75%). Caps are the
// DISPLAYED rent÷price. Rows include clean in-band comps plus the exact failure modes the
// live export leaked: an above-ceiling sold, above-ceiling on-market, and two bad-data outliers.
function universe() {
  const rows = [];
  // clean in-band sold comps (within the ±35 bps band, ~$30/SF rent)
  const clean = [[0.0645, 60], [0.0660, 75], [0.0680, 90], [0.0700, 105], [0.0655, 120], [0.0670, 135]];
  clean.forEach(([cap, ageDays], i) => {
    const price = 5_000_000, rent = Math.round(price * cap), rba = Math.round(rent / 30);
    rows.push({ comp_id: `sold${i}`, source: 'dialysis_db', vertical: 'dialysis', is_government: false,
      comp_type: 'sale', on_market: false, tenant: 'DaVita', address: `${i} Clean St`, city: 'The Villages',
      state: 'FL', sale_date: daysAgoISO(60 + ageDays), sale_price: price, annual_rent: rent,
      list_date: daysAgoISO(60 + ageDays + 46), building_sf: rba, cap_rate: cap, confidence: 0.85,
      property_id: 500 + i, raw: { sale_id: 500 + i, property_id: 500 + i } });
  });
  // above-ceiling sold — classification cap (noi) sits in-band at 6.8% so it passes synthesis,
  // but the DISPLAYED rent÷price is 7.15% (> 7.10% ceiling): the exact JS-vs-sheet divergence the
  // live export leaked. Valid data, must be excluded from the sheet (context, not review).
  rows.push({ comp_id: 'soldHigh', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: false, tenant: 'Fresenius Medical Care', address: '1625 Unity Way NW',
    city: 'Ocala', state: 'FL', sale_date: daysAgoISO(90), sale_price: 5_000_000, noi: 340_000, annual_rent: 357_500,
    building_sf: Math.round(357_500 / 30), cap_rate: 0.0680, confidence: 0.85,
    property_id: 600, raw: { sale_id: 600, property_id: 600 } });
  // bad-data sold — classification cap (noi) is a normal 6.5% (passes synthesis), but the DISPLAYED
  // rent÷price is 0.54% at ~$3/SF: a rent/SF/price error. Drop + route to review.
  rows.push({ comp_id: 'soldBad', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: false, tenant: 'DaVita', address: '9 Error Rd', city: 'Leesburg',
    state: 'FL', sale_date: daysAgoISO(120), sale_price: 5_000_000, noi: 325_000, annual_rent: 27_000,
    building_sf: 9000, cap_rate: 0.0650, confidence: 0.85, property_id: 601, raw: { sale_id: 601, property_id: 601 } });
  // above-ceiling on-market (displayed 7.77%) — must NOT ship
  rows.push({ comp_id: 'mktHigh', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: true, tenant: 'DaVita', address: '6450 Seminole Blvd', city: 'Seminole',
    state: 'FL', last_price: 5_000_000, annual_rent: 388_500, building_sf: Math.round(388_500 / 30),
    current_cap_rate: 0.0777, confidence: 0.75, property_id: 700, raw: { listing_id: 700, property_id: 700 } });
  // bad-data on-market — a normal 6.5% classification cap passes synthesis, but the DISPLAYED
  // rent÷price is 0.67% at ~$8/SF: drop + route to review.
  rows.push({ comp_id: 'mktBad', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: true, tenant: 'DaVita', address: '8 Junk Ave', city: 'Tampa',
    state: 'FL', last_price: 5_000_000, annual_rent: 33_500, building_sf: 4200,
    current_cap_rate: 0.0650, confidence: 0.75, property_id: 701, raw: { listing_id: 701, property_id: 701 } });
  // Prompt 57 — every comp carries a real long-dated lease so the lease-term discipline
  // (≥3 yr remaining, expiration present) is a no-op here and the cap-band/status/bumps
  // behavior these suites verify stays exactly as before.
  const FAR_EXP = new Date(Date.now() + 11 * 365 * DAY).toISOString().slice(0, 10);
  for (const r of rows) if (r.lease_expiration == null) r.lease_expiration = FAR_EXP;
  return rows;
}

function depsFrom(rows) {
  const enqueued = [];
  const diaQuery = async (method, path, body) => {
    if (path === 'rpc/rpc_query_comps') {
      const wantOnMkt = !!body.p_include_onmkt;
      const out = rows.filter(r => {
        if (!wantOnMkt && r.on_market === true) return false;
        if (body.p_date_from && !r.on_market && r.sale_date < body.p_date_from) return false;
        return true;
      }).map(r => ({ ...r }));
      return { ok: true, status: 200, data: out };
    }
    if (path.startsWith('dia_comp_review_queue')) { enqueued.push(...(body || [])); return { ok: true, status: 201, data: null }; }
    if (path === 'rpc/dia_engine_rent_batch') return { ok: true, status: 200, data: [] };
    return { ok: false, status: 500, data: null };
  };
  const govQuery = async () => ({ ok: true, status: 200, data: [] });
  return { diaQuery, govQuery, _enqueued: enqueued };
}

const SUBJECT = { name: 'The Villages DaVita', state: 'FL', cap_rate: 0.0675 };
const CEILING = 0.0675 + 0.0035; // 7.10%

describe('Prompt 54 — applyDisplayedCapDiscipline (unit)', () => {
  it('drops above-ceiling comps (kept for context) and bad-data comps (to review)', () => {
    const rows = universe().map(c => ({ ...c }));
    const disc = applyDisplayedCapDiscipline(rows, { subjectCap: 0.0675, upperBps: 35, isDialysis: true });
    // every kept comp is at or below the ceiling
    for (const c of disc.kept) {
      const cap = displayedCompCap(c);
      if (cap != null) assert.ok(cap <= CEILING + 1e-9, `${c.comp_id} kept at ${cap} > ceiling`);
      assert.ok(cap == null || cap >= 0.045, `${c.comp_id} kept below reliable floor`);
    }
    // the two bad-data rows are reliability exclusions
    const badIds = disc.excludedBadData.map(x => x.comp.comp_id).sort();
    assert.deepEqual(badIds, ['mktBad', 'soldBad']);
    // the above-ceiling rows are context exclusions (not review)
    const ctxIds = disc.excludedContext.map(x => x.comp.comp_id);
    assert.ok(ctxIds.includes('soldHigh'), 'above-ceiling sold should be context-excluded');
    assert.ok(ctxIds.includes('mktHigh'), 'above-ceiling on-market should be context-excluded');
  });

  it('is a no-op ceiling when no subject cap is known (reliability still applies)', () => {
    const rows = universe().map(c => ({ ...c }));
    const disc = applyDisplayedCapDiscipline(rows, { subjectCap: null, isDialysis: true });
    // no ceiling: the 7.15%/7.77% comps stay, but the bad-data ones are still dropped
    assert.equal(disc.excludedBadData.length, 2);
    assert.ok(disc.kept.some(c => c.comp_id === 'soldHigh'));
  });
});

describe('Prompt 54 — generate_comps ships an appraiser-clean displayed set', () => {
  it('every shipped Sold/On-Market row obeys the ceiling + reliability floor; bad data routed to review', async () => {
    const deps = depsFrom(universe());
    let payload = null;
    const generateWorkbook = async p => { payload = p; return { status: 'ok', filename: 'x.xlsx', download_url: 'u', expires_in_seconds: 60 }; };
    const res = await runGenerateCompsFromRequest({
      request: 'Build an appraisal comp set for our The Villages DaVita — 1050 Old Camp Rd deal at a 6.75% cap',
      subject: SUBJECT, appraisal_mode: true,
    }, deps, generateWorkbook);
    assert.ok(payload, 'workbook payload built');
    const shipped = [...(payload.sold || []), ...(payload.on_market || [])];
    assert.ok(shipped.length >= 4, `expected a real shipped set, got ${shipped.length}`);
    for (const r of shipped) {
      const rent = Number(r.annual_rent ?? r.annual_noi);
      const price = Number(r.sale_price ?? r.last_price ?? r.cur_price);
      if (rent > 0 && price > 0) {
        const cap = rent / price;
        assert.ok(cap <= CEILING + 1e-9, `shipped cap ${cap} exceeds ceiling`);
        assert.ok(cap >= 0.045 - 1e-9, `shipped cap ${cap} below reliable floor`);
        const rba = Number(r.rba ?? r.rba_sf);
        if (rba > 0) { const rpsf = rent / rba; assert.ok(rpsf >= 12 && rpsf <= 60, `shipped RENT/SF ${rpsf} out of range`); }
      }
    }
    // the two bad-data comps were routed to the review lane, not shipped
    const shippedAddrs = shipped.map(r => r.address);
    assert.ok(!shippedAddrs.includes('9 Error Rd'));
    assert.ok(!shippedAddrs.includes('8 Junk Ave'));
    assert.ok(deps._enqueued.length >= 2, `expected >=2 review rows, got ${deps._enqueued.length}`);
  });

  it('sold average cap holds below the subject, and list_date flows to ON MARKET', async () => {
    const deps = depsFrom(universe());
    let payload = null;
    const generateWorkbook = async p => { payload = p; return { status: 'ok', filename: 'x.xlsx', download_url: 'u', expires_in_seconds: 60 }; };
    await runGenerateCompsFromRequest({
      request: 'Appraisal comps for our The Villages DaVita deal at a 6.75% cap',
      subject: SUBJECT, appraisal_mode: true,
    }, deps, generateWorkbook);
    const sold = payload.sold || [];
    const caps = sold.map(r => Number(r.annual_rent) / Number(r.sale_price)).filter(Number.isFinite);
    const avg = caps.reduce((a, b) => a + b, 0) / caps.length;
    assert.ok(avg < 0.0675, `sold average ${avg} should be below the 6.75% subject`);
    // at least one sold row carries the joined market-entry date (never synthetic)
    assert.ok(sold.some(r => r.on_market), 'expected list_date to flow onto a sold ON MARKET cell');
  });
});

describe('Prompt 56 — STATUS never blank, BUMPS normalized to Flat, summary matches the sheet', () => {
  it('every On Market row has a non-blank STATUS and Sold/On Market bumps default to Flat', async () => {
    // Give some rows a raw status + messy bumps; leave others blank to prove the defaults.
    const rows = universe().map((c, i) => ({
      ...c,
      bumps: i === 0 ? '10% every 5' : i === 1 ? '1.75' : i === 2 ? 'Fixed' : undefined,
      status: c.on_market ? (c.comp_id === 'mktHigh' ? 'Under Contract' : 'Active') : undefined,
    }));
    const deps = depsFrom(rows);
    let payload = null;
    const generateWorkbook = async p => { payload = p; return { status: 'ok', filename: 'x.xlsx', download_url: 'u', expires_in_seconds: 60 }; };
    await runGenerateCompsFromRequest({
      request: 'Appraisal comps for our The Villages DaVita deal at a 6.75% cap',
      subject: SUBJECT, appraisal_mode: true,
    }, deps, generateWorkbook);
    // On Market STATUS: never blank; Active/blank → Available; a real status is preserved.
    for (const r of (payload.on_market || [])) {
      assert.ok(r.status && String(r.status).trim(), `on-market row ${r.address} has blank STATUS`);
    }
    // Every shipped row (both tabs) carries a non-blank BUMPS (empty → Flat).
    for (const r of [...(payload.sold || []), ...(payload.on_market || [])]) {
      assert.ok(r.bumps && String(r.bumps).trim(), `row ${r.address} has blank BUMPS`);
      assert.ok(!/^-?\d+(?:\.\d+)?$/.test(String(r.bumps)), `row ${r.address} bumps still a bare number`);
      assert.ok(!/every\s+\d/i.test(String(r.bumps)), `row ${r.address} bumps still "X every N"`);
    }
  });

  it('summary cap range matches the min-max of the displayed sold rows', async () => {
    const deps = depsFrom(universe());
    let payload = null;
    const generateWorkbook = async p => { payload = p; return { status: 'ok', filename: 'x.xlsx', download_url: 'u', expires_in_seconds: 60 }; };
    const res = await runGenerateCompsFromRequest({
      request: 'Appraisal comps for our The Villages DaVita deal at a 6.75% cap',
      subject: SUBJECT, appraisal_mode: true,
    }, deps, generateWorkbook);
    const soldCaps = (payload.sold || [])
      .map(r => Number(r.annual_rent ?? r.annual_noi) / Number(r.sale_price))
      .filter(Number.isFinite);
    const lo = Math.min(...soldCaps) * 100, hi = Math.max(...soldCaps) * 100;
    const m = res.summary.match(/(\d+\.\d+)%-(\d+\.\d+)% cap range/);
    assert.ok(m, `summary has no cap range: ${res.summary}`);
    assert.ok(Math.abs(Number(m[1]) - lo) < 0.02, `summary min ${m[1]} != sheet min ${lo.toFixed(2)}`);
    assert.ok(Math.abs(Number(m[2]) - hi) < 0.02, `summary max ${m[2]} != sheet max ${hi.toFixed(2)}`);
  });
});
