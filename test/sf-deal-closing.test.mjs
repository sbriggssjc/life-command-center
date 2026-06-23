// Deal Closing Announcement handler — stageClosingDeal core. domainQuery is
// injected (records calls); classifyVertical uses the REAL canonical classifier
// (US Renal → dia, GSA → gov) so the routing wiring is proven, with a null stub
// for the unresolved case.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { stageClosingDeal } from '../api/_handlers/sf-deal-closing.js';

function parsedBase(over = {}) {
  return {
    ok: true,
    deal_name: 'US Renal - Covington, GA',
    deal_type: 'Sale Deal - Commercial',
    city: 'Covington', state: 'GA',
    sale_price: 2410000, cap_rate: 7.61, close_date: '2026-06-23',
    property_type: 'Healthcare', property_subtype: 'Dialysis',
    seller_company: 'Alliance Consolidated Group of Companies LLC',
    seller_account_id: '0018W00002X0hiMQAR',
    buyer_company: 'Srinivas Kothakonda and Naveen Budda',
    buyer_account_id: '001Vs00000zPFVbIAO',
    sf_opportunity_id: '006Vs00000IPJGQIA5',
    deal_team: 'Team Harf', broker: 'Isaiah Harf',
    ...over,
  };
}

// records every (domain, method, path, body) call
function recorder(result = { ok: true, status: 201 }) {
  const calls = [];
  const fn = async (domain, method, path, body) => {
    calls.push({ domain, method, path, body });
    return typeof result === 'function' ? result(path) : result;
  };
  return { fn, calls };
}

describe('stageClosingDeal', () => {
  beforeEach(() => { delete process.env.DEAL_CLOSING_PROMOTE; });
  afterEach(() => { delete process.env.DEAL_CLOSING_PROMOTE; });

  it('routes US Renal → dia, stages the correct sf_deal_staging row, triggers the promote', async () => {
    const dq = recorder();
    const r = await stageClosingDeal(parsedBase(), { runPromote: true }, { domainQuery: dq.fn });
    assert.equal(r.ok, true);
    assert.equal(r.domain, 'dia');
    assert.equal(r.sf_deal_id, '006Vs00000IPJGQIA5');
    assert.equal(r.price_missing, false);

    const stage = dq.calls.find(c => c.path.startsWith('sf_deal_staging'));
    assert.ok(stage, 'staged a row');
    assert.equal(stage.domain, 'dia');
    assert.match(stage.path, /on_conflict=sf_deal_id,source_system,import_batch/);
    assert.equal(stage.body.stage, 'Closed IS');
    assert.equal(stage.body.source_system, 'salesforce');
    assert.equal(stage.body.import_batch, 'email_deal_closing');
    // PRICE GATE: the promote reads raw_row->>'Deal_Price__c' (numeric string > 0)
    assert.equal(stage.body.raw_row.Deal_Price__c, '2410000');
    assert.equal(stage.body.raw_row.CloseDate, '2026-06-23');
    assert.equal(stage.body.raw_row.StageName, 'Closed IS');
    // NM side is unknown on a firm-wide announcement → null (promote tags unsided)
    assert.equal(stage.body.raw_row.Direct_Co_Broke_sjc__c, null);

    const promote = dq.calls.find(c => c.path === 'rpc/dia_promote_nm_comps');
    assert.ok(promote, 'triggered the dia promote');
    assert.equal(promote.body.p_dry_run, false);
    assert.equal(r.promote.triggered, true);
  });

  it('routes a GSA agency deal → gov + gov promote', async () => {
    const dq = recorder();
    const r = await stageClosingDeal(
      parsedBase({ deal_name: 'GSA - Federal Building - Dallas, TX', property_subtype: null, sf_opportunity_id: '0061I00000abcdeAAA' }),
      { runPromote: true }, { domainQuery: dq.fn },
    );
    assert.equal(r.domain, 'gov');
    assert.ok(dq.calls.find(c => c.path === 'rpc/gov_promote_nm_comps'));
  });

  it('stages a price-missing deal but does NOT trigger the promote', async () => {
    const dq = recorder();
    const r = await stageClosingDeal(parsedBase({ sale_price: null }), { runPromote: true }, { domainQuery: dq.fn });
    assert.equal(r.ok, true);
    assert.equal(r.price_missing, true);
    assert.ok(dq.calls.find(c => c.path.startsWith('sf_deal_staging')));
    assert.equal(dq.calls.some(c => c.path.includes('promote_nm_comps')), false);
    assert.equal(r.promote.triggered, false);
  });

  it('refuses to stage when the vertical is unresolved (no guess)', async () => {
    const dq = recorder();
    const r = await stageClosingDeal(parsedBase(), { runPromote: true }, {
      domainQuery: dq.fn,
      classifyVertical: () => ({ vertical: null }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'vertical_unresolved');
    assert.equal(dq.calls.length, 0);
  });

  it('returns unparseable for a non-ok parse (no DB calls)', async () => {
    const dq = recorder();
    const r = await stageClosingDeal({ ok: false }, { runPromote: true }, { domainQuery: dq.fn });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unparseable');
    assert.equal(dq.calls.length, 0);
  });

  it('synthesizes a STABLE sf_deal_id when no Opportunity id is present', async () => {
    const dq = recorder();
    const p = parsedBase({ sf_opportunity_id: null });
    const r1 = await stageClosingDeal(p, {}, { domainQuery: dq.fn });
    const r2 = await stageClosingDeal(p, {}, { domainQuery: dq.fn });
    assert.match(r1.sf_deal_id, /^EMAILCLOSE-[0-9a-f]{16}$/);
    assert.equal(r1.sf_deal_id, r2.sf_deal_id); // idempotent key
  });

  it('reports staging_write_failed on a non-ok upsert', async () => {
    const dq = recorder({ ok: false, status: 400, data: { message: 'boom' } });
    const r = await stageClosingDeal(parsedBase(), { runPromote: true }, { domainQuery: dq.fn });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'staging_write_failed');
    // never reaches the promote
    assert.equal(dq.calls.some(c => c.path.includes('promote_nm_comps')), false);
  });

  it('DEAL_CLOSING_PROMOTE=false stages but skips the real-time promote', async () => {
    process.env.DEAL_CLOSING_PROMOTE = 'false';
    const dq = recorder();
    const r = await stageClosingDeal(parsedBase(), { runPromote: true }, { domainQuery: dq.fn });
    assert.equal(r.ok, true);
    assert.equal(dq.calls.some(c => c.path.includes('promote_nm_comps')), false);
  });
});
