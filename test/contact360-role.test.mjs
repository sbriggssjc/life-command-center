// Contact 360 role-awareness (Phase 2) — the panel is role-driven, not
// owner-framed. Anchors: (1) detectEntityRole reads the OUT (from-side) edges in
// priority owner > broker > buyer > contact; (2) buildBrokerDealIntel counts
// deals off the `brokers` edges and splits buyer/seller by metadata.role, with
// target markets from the linked asset entities' state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectEntityRole, buildBrokerDealIntel } from '../api/_handlers/entities-handler.js';

const rel = (relationship_type, to_entity_id, metadata) => ({ relationship_type, to_entity_id, metadata });

describe('detectEntityRole', () => {
  it('owns / developed edges → owner', () => {
    assert.equal(detectEntityRole({ entity_relationships: [rel('owns', 'a1')] }).role, 'owner');
    assert.equal(detectEntityRole({ entity_relationships: [rel('developed', 'a1')] }).role, 'owner');
  });
  it('a Listing Broker (brokers edges) → broker', () => {
    const r = detectEntityRole({ entity_relationships: [rel('brokers', 'a1', { role: 'listing_broker' })] });
    assert.equal(r.role, 'broker');
    assert.equal(r.has_broker_edges, true);
  });
  it('purchases edges → buyer', () => {
    assert.equal(detectEntityRole({ entity_relationships: [rel('purchases', 'a1')] }).role, 'buyer');
  });
  it('no BD edges → plain contact', () => {
    assert.equal(detectEntityRole({ entity_relationships: [rel('associated_with', 'x')] }).role, 'contact');
    assert.equal(detectEntityRole({ entity_relationships: [] }).role, 'contact');
    assert.equal(detectEntityRole({}).role, 'contact');
  });
  it('owner OUTRANKS broker/buyer when an entity carries multiple edge kinds', () => {
    const r = detectEntityRole({ entity_relationships: [
      rel('brokers', 'a1', { role: 'listing_broker' }),
      rel('owns', 'a2'),
      rel('purchases', 'a3'),
    ] });
    assert.equal(r.role, 'owner');
  });
});

describe('buildBrokerDealIntel', () => {
  const assetQuery = async (_m, _path) => ({ ok: true, data: [
    { id: 'a1', name: '100 Main', city: 'Tulsa', state: 'OK' },
    { id: 'a2', name: '200 Oak', city: 'Tulsa', state: 'OK' },
    { id: 'a3', name: '300 Elm', city: 'Dallas', state: 'TX' },
  ] });

  it('counts deals + splits listing (sellers) vs buyer (buyers), with markets', async () => {
    const entity = { entity_relationships: [
      rel('brokers', 'a1', { role: 'listing_broker' }),
      rel('brokers', 'a2', { role: 'listing_broker' }),
      rel('brokers', 'a3', { role: 'buyer_broker' }),
      rel('associated_with', 'zz'), // ignored — not a brokers edge
    ] };
    const bi = await buildBrokerDealIntel(entity, 'brk1', assetQuery);
    assert.equal(bi.total_deals, 3);
    assert.equal(bi.represents_sellers, 2);
    assert.equal(bi.represents_buyers, 1);
    assert.equal(bi.represents_unknown, 0);
    // markets sorted by count desc: OK(2), TX(1)
    assert.deepEqual(bi.markets, [{ state: 'OK', count: 2 }, { state: 'TX', count: 1 }]);
    assert.equal(bi.recent_deals.length, 3);
    // a listing_broker deal is labeled the SELLER side
    assert.ok(bi.recent_deals.some(d => d.role === 'seller'));
    assert.ok(bi.recent_deals.some(d => d.role === 'buyer'));
  });

  it('an edge with no metadata.role counts as unknown side', async () => {
    const entity = { entity_relationships: [rel('brokers', 'a1', {})] };
    const bi = await buildBrokerDealIntel(entity, 'brk1', assetQuery);
    assert.equal(bi.total_deals, 1);
    assert.equal(bi.represents_unknown, 1);
    assert.equal(bi.represents_sellers, 0);
  });

  it('no brokers edges → empty intel, no query', async () => {
    let called = false;
    const q = async () => { called = true; return { ok: true, data: [] }; };
    const bi = await buildBrokerDealIntel({ entity_relationships: [rel('owns', 'a1')] }, 'e1', q);
    assert.equal(bi.total_deals, 0);
    assert.deepEqual(bi.markets, []);
    assert.equal(called, false);
  });
});
