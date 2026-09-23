// SF-BRIDGE1 (2026-09-23) — our own Salesforce deals carry a type and an
// address, and an OM carrying a Salesforce seed can follow its deal to the
// property. See supabase/migrations/20261102260000_lcc_sf_bridge1_*.sql.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deriveDealType, SF_DEAL_TYPES, makeOpportunitySyncRoute, lookupStagedDealsVia,
} from '../mcp/opportunity-sync.js';
import {
  reconcileSeedWithAddressMatch, resolveSfSeed, parseSfSeed, subjectAddressesAgree,
} from '../api/_shared/sf-seed-match.js';
import { resolveOpenSfDeal } from '../api/admin.js';
import { isOwnSfListingMatch } from '../api/_handlers/intake-promoter.js';

const WS = 'a0000000-0000-0000-0000-000000000001';

// ── 1. type mapping ──────────────────────────────────────────────────────────
describe('deriveDealType', () => {
  it('maps the stated stage / record type, most specific first', () => {
    assert.equal(deriveDealType({ stage: 'bov' }), 'bov');
    assert.equal(deriveDealType({ stage: 'listing_signed' }), 'listing');
    assert.equal(deriveDealType({ stage: 'off_market_listing' }), 'listing');
    assert.equal(deriveDealType({ stage: 'ela' }), 'listing');
    assert.equal(deriveDealType({ stage: 'Buy Side', recordType: 'Buy Side' }), 'buy_side');
    assert.equal(deriveDealType({ stage: 'bov', recordType: 'IS CM - Buy-Side' }), 'buy_side');
  });
  it('a contractual stage is a listing only when a Salesforce Listing__c exists', () => {
    assert.equal(deriveDealType({ stage: 'in_escrow', hasListing: true }), 'listing');
    assert.equal(deriveDealType({ stage: 'in_escrow', hasListing: false }), 'sf_deal');
    assert.equal(deriveDealType({ stage: 'in_escrow' }), 'sf_deal');
  });
  it('an unstated side is sf_deal, never an LCC-owned lane type', () => {
    assert.equal(deriveDealType({ stage: 'qualified_lead', recordType: 'IS CM' }), 'sf_deal');
    for (const s of ['closed', 'terminated', 'loi_executed', 'unknown', undefined]) {
      const t = deriveDealType({ stage: s });
      assert.ok(SF_DEAL_TYPES.includes(t));
      assert.notEqual(t, 'prospect');
    }
  });
  it('the SQL mirror in the migration agrees on the stage-only mapping', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261102260000_lcc_sf_bridge1_opportunity_type_and_address.sql', import.meta.url), 'utf8');
    const fn = sql.slice(sql.indexOf('FUNCTION public.lcc_sf_deal_type_from_stage'));
    assert.match(fn, /WHEN p_stage = 'bov' THEN 'bov'/);
    assert.match(fn, /WHEN p_stage IN \('listing_signed','off_market_listing','ela'\) THEN 'listing'/);
    assert.match(fn, /ELSE 'sf_deal'/);
  });
});

// ── 2. the sync writes type + address ────────────────────────────────────────
function syncHarness(staged) {
  const rpcRows = [];
  const opsQuery = async (method, path, body) => {
    if (path.startsWith('rpc/lcc_upsert_bd_opportunities')) {
      rpcRows.push(body.p_deals[0]);
      return { ok: true, data: [{ outcome: 'updated', bd_opportunity_id: 'b1' }] };
    }
    if (path.startsWith('bd_opportunities?')) return { ok: true, data: [{ entity_id: 'e1' }] };
    if (path.startsWith('entities?id=')) return { ok: true, data: [{ domain: 'dia' }] };
    if (path === 'producer_runs') return { ok: true, data: null };
    return { ok: true, data: [] };
  };
  const route = makeOpportunitySyncRoute({
    opsQuery, enc: encodeURIComponent, WORKSPACE_ID: WS,
    lookupStagedDeals: staged === undefined ? null : async () => staged,
  });
  const run = async (deals) => {
    let out = null;
    const res = { status() { return this; }, json(b) { out = b; return this; } };
    await route.ingestBatch({ body: { deals } }, res);
    return out;
  };
  return { run, rpcRows };
}

describe('opportunity sync — type and address', () => {
  const findlay = { Id: '006Vs00000hhYfCIAU', Name: 'US Renal-Anchored MOB - Findlay - OH', StageName: 'Listing Signed' };

  it('stamps a type on every deal (was NULL on all 610)', async () => {
    const h = syncHarness(new Map());
    await h.run([findlay, { Id: '006A', Name: 'X - Y - TX', StageName: 'BOV' }, { Id: '006B', Name: 'Z - Q - GA', StageName: 'In Escrow' }]);
    assert.deepEqual(h.rpcRows.map((r) => r.type), ['listing', 'bov', 'sf_deal']);
  });

  it('fills the address from Salesforce staging when the payload has none, and says so', async () => {
    const h = syncHarness(new Map([[findlay.Id, { property_address: '1717 Medical Blvd, Findlay, OH 45840', deal_type: 'IS CM', has_listing: true, source: 'dia.sf_deal_staging' }]]));
    const out = await h.run([findlay]);
    assert.equal(h.rpcRows[0].property_address, '1717 Medical Blvd, Findlay, OH 45840');
    assert.equal(h.rpcRows[0].metadata.address_source, 'dia.sf_deal_staging');
    assert.equal(out.address_filled, 1);
  });

  it('vertical falls back to the staging domain when nothing else states it', async () => {
    const rows = [];
    const opsQuery = async (m, path, body) => {
      if (path.startsWith('rpc/')) { rows.push(body.p_deals[0]); return { ok: true, data: [{ outcome: 'updated', bd_opportunity_id: 'b' }] }; }
      if (path.startsWith('bd_opportunities?')) return { ok: true, data: [{ entity_id: 'e1' }] };
      if (path.startsWith('entities?id=')) return { ok: true, data: [{ domain: null }] };
      return { ok: true, data: [] };
    };
    const route = makeOpportunitySyncRoute({ opsQuery, enc: encodeURIComponent, WORKSPACE_ID: WS,
      lookupStagedDeals: async () => new Map([[findlay.Id, { property_address: null, has_listing: true, source: 'dia.sf_deal_staging' }]]) });
    const res = { status() { return this; }, json() { return this; } };
    await route.ingestBatch({ body: { deals: [findlay] } }, res);
    assert.equal(rows[0].vertical, 'dia');
  });

  it('a staged Listing__c makes an escrow deal a listing', async () => {
    const h = syncHarness(new Map([['006B', { property_address: null, deal_type: 'IS CM', has_listing: true, source: null }]]));
    await h.run([{ Id: '006B', Name: 'Z - Q - GA', StageName: 'In Escrow' }]);
    assert.equal(h.rpcRows[0].type, 'listing');
  });

  it('the payload address wins over staging', async () => {
    const h = syncHarness(new Map([[findlay.Id, { property_address: 'STAGED', has_listing: true, source: 'dia.sf_deal_staging' }]]));
    await h.run([{ ...findlay, Property2__r: { Street__c: '1717 Medical Blvd', City__c: 'Findlay', State_Province__c: 'OH' } }]);
    assert.equal(h.rpcRows[0].property_address, '1717 Medical Blvd, Findlay, OH');
    assert.equal(h.rpcRows[0].metadata.address_source, 'sf_payload');
  });

  it('no Salesforce address anywhere → NULL, never invented from the deal name', async () => {
    const h = syncHarness(new Map());
    await h.run([findlay]);
    assert.equal(h.rpcRows[0].property_address, null);
    assert.equal(h.rpcRows[0].metadata.address_source, undefined);
  });

  it('a staging lookup that throws never fails the sync', async () => {
    const opsRows = [];
    const route = makeOpportunitySyncRoute({
      opsQuery: async (m, p, b) => {
        if (p.startsWith('rpc/')) { opsRows.push(b.p_deals[0]); return { ok: true, data: [{ outcome: 'updated', bd_opportunity_id: 'b' }] }; }
        return { ok: true, data: [] };
      },
      enc: encodeURIComponent, WORKSPACE_ID: WS,
      lookupStagedDeals: async () => { throw new Error('dia down'); },
    });
    let out; const res = { status() { return this; }, json(b) { out = b; return this; } };
    await route.ingestBatch({ body: { deals: [findlay] } }, res);
    assert.equal(out.ok, true);
    assert.equal(opsRows[0].type, 'listing');
  });

  it('lookupStagedDealsVia reads both domains, keeps an address, flags a Listing__c', async () => {
    const calls = [];
    const q = async (domain, path) => {
      calls.push(domain + ':' + path.split('?')[0]);
      if (domain === 'dialysis' && path.startsWith('sf_deal_staging')) {
        return { ok: true, data: [{ sf_deal_id: '006F', deal_type: 'IS CM', property_address: '1717 Medical Blvd, Findlay, OH 45840' }] };
      }
      if (domain === 'dialysis' && path.startsWith('sf_listing_staging')) return { ok: true, data: [{ sf_deal_id: '006F' }] };
      if (domain === 'government' && path.startsWith('sf_listing_staging')) return { ok: true, data: [{ sf_deal_id: '006G' }] };
      return { ok: true, data: [] };
    };
    const m = await lookupStagedDealsVia(q, ['006F', '006G', '006H']);
    assert.equal(m.get('006F').property_address, '1717 Medical Blvd, Findlay, OH 45840');
    assert.equal(m.get('006F').has_listing, true);
    assert.equal(m.get('006G').has_listing, true);
    assert.equal(m.get('006G').property_address, null);
    assert.equal(m.has('006H'), false);
    assert.ok(calls.some((c) => c.startsWith('government:')));
  });
});

// ── 3. the RPC + backfill contract (text; the live proof is in the migration header) ──
describe('upsert RPC + backfill', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261102260000_lcc_sf_bridge1_opportunity_type_and_address.sql', import.meta.url), 'utf8')
    .replace(/--[^\n]*/g, '');
  it('fill-forward: a payload with no address keeps the stored one', () => {
    assert.match(sql, /property_address\s*=\s*COALESCE\(EXCLUDED\.property_address,\s*t\.property_address\)/);
  });
  it('an LCC-owned lane type is never overwritten; NULL never erases', () => {
    assert.match(sql, /WHEN t\.type IN \('prospect','buyer','other','government_buyer'\) THEN t\.type\s+ELSE COALESCE\(EXCLUDED\.type, t\.type\)/);
  });
  it('the backfill touches only NULL-type Salesforce deals (idempotent: a re-run finds 0)', () => {
    const upd = sql.slice(sql.indexOf('UPDATE public.bd_opportunities o'));
    assert.match(upd.slice(0, 300), /WHERE o\.type IS NULL AND o\.sf_opp_id LIKE '006%'/);
  });
  it('the backfill is logged and the reverse keeps a later refinement', () => {
    assert.match(sql, /INSERT INTO public\.lcc_sf_bridge1_type_backfill_log/);
    assert.match(sql, /AND o\.type = l\.new_type/);
  });
});

// ── 4. seeded OM matching ────────────────────────────────────────────────────
const SEED_RESOLVED = {
  status: 'resolved', reason: 'sf_seed_listing', sf_opp_id: '006Vs00000hhYfCIAU', entity_id: 'ent',
  domain: 'dialysis', property_id: '51194', property_address: '1717 Medical Blvd', own_listing: true,
};

describe('reconcileSeedWithAddressMatch', () => {
  it('seed + no extracted address → the seed is the match', () => {
    const m = reconcileSeedWithAddressMatch({ seed: SEED_RESOLVED, addressMatch: { status: 'unmatched', property_id: null }, extractedAddress: null });
    assert.equal(m.status, 'matched');
    assert.equal(m.domain, 'dialysis');
    assert.equal(m.property_id, '51194');
    assert.ok(m.confidence >= 0.85, 'clears the auto-promote floor');
    assert.equal(m.sf_seed.own_listing, true);
  });
  it('seed + a conflicting address match → review with both candidates, never a silent pick', () => {
    const m = reconcileSeedWithAddressMatch({
      seed: SEED_RESOLVED,
      addressMatch: { status: 'matched', domain: 'dialysis', property_id: '28037', confidence: 0.95, reason: 'exact' },
      extractedAddress: '1717 Medical Blvd Suite C',
    });
    assert.equal(m.status, 'review_required');
    assert.equal(m.reason, 'sf_seed_address_conflict');
    assert.equal(m.property_id, null);
    assert.deepEqual(m.candidates.map((c) => c.property_id).sort(), ['28037', '51194']);
  });
  it('seed + agreeing address match → matched, corroborated', () => {
    const m = reconcileSeedWithAddressMatch({
      seed: SEED_RESOLVED,
      addressMatch: { status: 'matched', domain: 'dialysis', property_id: '51194', confidence: 0.9, reason: 'exact' },
      extractedAddress: '1717 Medical Blvd',
    });
    assert.equal(m.status, 'matched');
    assert.match(m.reason, /sf_seed_agrees/);
  });
  it('seed + unmatched extracted address that agrees → matched; that disagrees → review', () => {
    const ok = reconcileSeedWithAddressMatch({ seed: SEED_RESOLVED, addressMatch: { status: 'unmatched' }, extractedAddress: '1717 Medical Boulevard, Findlay OH' });
    assert.equal(ok.status, 'matched');
    const bad = reconcileSeedWithAddressMatch({ seed: SEED_RESOLVED, addressMatch: { status: 'unmatched' }, extractedAddress: '6120 S Yale Ave' });
    assert.equal(bad.status, 'review_required');
    const sameNumberOtherStreet = reconcileSeedWithAddressMatch({ seed: SEED_RESOLVED, addressMatch: { status: 'unmatched' }, extractedAddress: '1717 Main St' });
    assert.equal(sameNumberOtherStreet.status, 'review_required');
  });
  it('a refused (cross-vertical) or unresolved seed leaves the address verdict unchanged', () => {
    const am = { status: 'unmatched', confidence: 0, property_id: null, domain: null };
    const r = reconcileSeedWithAddressMatch({ seed: { status: 'refused', reason: 'seed_cross_vertical' }, addressMatch: am, extractedAddress: null });
    assert.equal(r.status, 'unmatched');
    assert.equal(r.property_id, null);
    assert.equal(r.sf_seed.reason, 'seed_cross_vertical');
    const u = reconcileSeedWithAddressMatch({ seed: { status: 'unresolved', reason: 'no_sf_seed' }, addressMatch: am, extractedAddress: null });
    assert.deepEqual(u, am);
  });
  it('subjectAddressesAgree needs number AND street name', () => {
    assert.equal(subjectAddressesAgree('1717 Medical Blvd', '1717 Medical Boulevard, Findlay, OH'), true);
    assert.equal(subjectAddressesAgree('1717 Main St', '1717 Medical Blvd'), false);
    assert.equal(subjectAddressesAgree('Medical Blvd', '1717 Medical Blvd'), null);
  });
});

function seedDeps({ vertical = 'dia', assets = [{ source_system: 'dia', external_id: '51194' }], opp = { id: 'b1', entity_id: 'ent', stage: 'listing_signed', type: 'listing' } } = {}) {
  const domainCalls = [];
  return {
    domainCalls,
    deps: {
      opsQuery: async (m, path) => {
        if (path.startsWith('bd_opportunities?')) return { ok: true, data: opp ? [opp] : [] };
        if (path.startsWith('external_identities?')) return { ok: true, data: assets };
        return { ok: true, data: [] };
      },
      domainQuery: async (domain, m, path) => {
        domainCalls.push(domain + ':' + path.split('?')[0]);
        if (path.startsWith('sf_listing_staging')) {
          return (vertical == null || domain === (vertical === 'dia' ? 'dialysis' : 'government'))
            ? { ok: true, data: [{ sf_deal_id: '006Vs00000hhYfCIAU' }] } : { ok: true, data: [] };
        }
        if (path.startsWith('properties?')) return { ok: true, data: [{ property_id: 51194, address: '1717 Medical Blvd' }] };
        return { ok: true, data: [] };
      },
    },
  };
}

describe('resolveSfSeed', () => {
  const findlaySeed = { sf_entity_type: 'Listing__c', sf_entity_id: 'a0jVs00000GuTfdIAF', source_vertical: 'dia' };

  it('Listing__c → Opportunity → asset entity → dia 51194 (Findlay), by ID at every hop', async () => {
    const { deps } = seedDeps();
    const r = await resolveSfSeed(findlaySeed, deps);
    assert.equal(r.status, 'resolved');
    assert.equal(r.domain, 'dialysis');
    assert.equal(r.property_id, '51194');
    assert.equal(r.own_listing, true);
  });
  it('a seed pointing at the other vertical is refused', async () => {
    const { deps } = seedDeps({ vertical: 'gov', assets: [{ source_system: 'dia', external_id: '51194' }] });
    const r = await resolveSfSeed({ ...findlaySeed, source_vertical: 'gov' }, deps);
    assert.equal(r.status, 'refused');
    assert.equal(r.reason, 'seed_cross_vertical');
  });
  it('a deal linked to two properties is not guessed between', async () => {
    const { deps } = seedDeps({ assets: [{ source_system: 'dia', external_id: '51194' }, { source_system: 'dia', external_id: '28037' }] });
    const r = await resolveSfSeed(findlaySeed, deps);
    assert.equal(r.status, 'unresolved');
    assert.equal(r.reason, 'deal_linked_to_multiple_properties');
  });
  it('a Comp__c seed is not our deal', () => {
    assert.equal(parseSfSeed({ sf_entity_type: 'Comp__c', sf_entity_id: 'a01X' }), null);
  });
});

// ── 5. the panel + the promoter ──────────────────────────────────────────────
describe('property panel: our open deal', () => {
  it('finds the open Salesforce deal on the property\'s asset entity (by ID)', async () => {
    const paths = [];
    const q = async (m, path) => {
      paths.push(path);
      if (path.startsWith('external_identities?')) return { ok: true, data: [{ entity_id: '084897cc-da76-4408-ae3f-318e937b407d' }] };
      if (path.startsWith('bd_opportunities?')) return { ok: true, data: [{ id: 'b1', sf_opp_id: '006Vs00000hhYfCIAU', deal_name: 'US Renal-Anchored MOB - Findlay - OH', stage: 'listing_signed', type: 'listing' }] };
      return { ok: true, data: [] };
    };
    const d = await resolveOpenSfDeal({ domain: 'dia', propertyId: '51194', entityId: null }, q);
    assert.equal(d.type, 'listing');
    assert.match(paths[0], /source_type=eq\.asset&source_system=eq\.dia&external_id=eq\.51194/);
    assert.match(paths[1], /type=in\.\(listing,bov,buy_side,sf_deal\)/);
    assert.match(paths[1], /is_open=is\.true/);
  });
  it('no asset entity and no entity → null (banner falls back to today)', async () => {
    const d = await resolveOpenSfDeal({ domain: 'dia', propertyId: '1', entityId: null }, async () => ({ ok: true, data: [] }));
    assert.equal(d, null);
  });
  it('the banner shows our deal instead of "Create the lead"', () => {
    const src = readFileSync(new URL('../detail.js', import.meta.url), 'utf8');
    const i = src.indexOf('function _udRenderNextStep');
    const body = src.slice(i, src.indexOf('\nfunction ', i + 10));
    const deal = body.indexOf('} else if (ourDeal) {');
    const lead = body.indexOf("label: 'Create the lead'");
    assert.ok(deal > -1 && lead > -1 && deal < lead, 'our-deal branch precedes the create-lead branch');
  });
});

describe('promoter: is_northmarq from the Salesforce seed', () => {
  it('only a resolved seed on one of our listings asserts it', () => {
    assert.equal(isOwnSfListingMatch({ sf_seed: { status: 'resolved', own_listing: true } }), true);
    assert.equal(isOwnSfListingMatch({ sf_seed: { status: 'resolved', own_listing: false } }), false);
    assert.equal(isOwnSfListingMatch({ sf_seed: { status: 'refused', own_listing: true } }), false);
    assert.equal(isOwnSfListingMatch({}), false);
  });
});
