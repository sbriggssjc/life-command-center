// Phase 2 Slice 3a — the property context packet (Layer 4 keystone).
//
// Unit 1: assemblePropertyPacket now pulls documents (the Phase-2 doc
//         connections), ownership, transactions, and prefers the REAL
//         investment score; a missing section is recorded in fields_missing
//         (never a throw).
// Unit 2: get_property_context assemble-on-miss (resolveContextPacket) —
//         a cache miss assembles + returns a non-null packet; a hit short-
//         circuits without assembling.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const { assemblePropertyPacket } = await import('../api/operations.js');
const { resolveContextPacket } = await import('../api/_handlers/property-handler.js');

const ENTITY_ID = '9782c412-e9b7-4061-ac73-edc670b9273c';

// A mock LCC opsQuery that answers by table prefix.
function makeOps(rows) {
  return async (_method, path) => {
    if (path.startsWith('entities?id=eq.' + ENTITY_ID)) return { ok: true, data: [rows.entity] };
    if (path.startsWith('external_identities?')) return { ok: true, data: rows.identities };
    if (path.startsWith('activity_events?')) return { ok: true, data: rows.activity || [] };
    if (path.startsWith('action_items?')) return { ok: true, data: rows.research || [] };
    if (path.startsWith('entity_relationships?')) return { ok: true, data: rows.relationships || [] };
    if (path.startsWith('entities?id=in.')) return { ok: true, data: rows.relatedEntities || [] };
    return { ok: true, data: [] };
  };
}

// A mock domain reader keyed by table prefix in the PostgREST path.
function makeDomainGet(tables) {
  return async (_domain, path) => {
    const table = path.split('?')[0];
    if (table in tables) return { ok: true, data: tables[table] };
    return { ok: false, data: null, status: 404 };
  };
}

describe('assemblePropertyPacket — enriched sections', () => {
  it('includes documents, ownership, transactions and prefers the real investment score', async () => {
    const ops = makeOps({
      entity: { id: ENTITY_ID, name: 'DaVita Chilton', entity_type: 'asset', workspace_id: 'ws-1' },
      identities: [{ source_system: 'dia', source_type: 'asset', external_id: '29841' }],
      activity: [{ id: 'a1', category: 'note', occurred_at: '2026-06-01T00:00:00Z' }],
      relationships: [{ relationship_type: 'owns', from_entity_id: 'owner-1', to_entity_id: ENTITY_ID }],
      relatedEntities: [{ id: 'owner-1', name: 'Acme Holdings', entity_type: 'organization' }],
    });
    const domainGet = makeDomainGet({
      properties: [{ property_id: 29841, recorded_owner_id: 7, true_owner_id: 9, tenant: 'DaVita' }],
      property_documents: [
        { document_id: 100, file_name: 'DaVita Chilton OM.pdf', document_type: 'om', source_url: 'https://x/om.pdf', source: 'folder_feed_enrich', created_at: '2026-06-02T00:00:00Z' },
        { document_id: 101, file_name: 'DaVita Chilton BOV [LCC].pdf', document_type: 'bov', source: 'lcc_generated', created_at: '2026-06-05T00:00:00Z' },
      ],
      sales_transactions: [
        { sale_id: 555, sale_date: '2025-01-15', sold_price: 5200000, sold_cap_rate: 0.0625, buyer: 'AEI Capital', seller: 'Acme Holdings' },
      ],
      investment_scores: [{ property_id: 29841, investment_score: 27, deal_grade: 'A' }],
      recorded_owners: [{ recorded_owner_id: 7, name: 'Acme Property LLC' }],
      true_owners: [{ true_owner_id: 9, name: 'Acme Holdings' }],
    });

    const { payload, fieldsMissing } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: ops, domainGet });

    // documents — the keystone
    assert.equal(payload.documents.length, 2);
    assert.equal(payload.documents[0].file_name, 'DaVita Chilton OM.pdf');
    assert.equal(payload.documents[0].source, 'folder_feed_enrich');
    assert.equal(payload.documents[1].source, 'lcc_generated');

    // transactions
    assert.equal(payload.transactions.length, 1);
    assert.equal(payload.transactions[0].price, 5200000);
    assert.equal(payload.transactions[0].cap_rate, 0.0625);
    assert.equal(payload.transactions[0].buyer, 'AEI Capital');

    // ownership — domain owner names + LCC related entity
    assert.equal(payload.ownership.recorded_owner_name, 'Acme Property LLC');
    assert.equal(payload.ownership.true_owner_name, 'Acme Holdings');
    assert.equal(payload.ownership.related_entities.length, 1);
    assert.equal(payload.ownership.related_entities[0].name, 'Acme Holdings');
    assert.equal(payload.ownership.related_entities[0].relationship, 'owns');

    // investment — prefers the real investment_scores row over the naive recompute
    assert.equal(payload.investment.source, 'investment_scores');
    assert.equal(payload.investment.score, 27);
    assert.equal(payload.investment.grade, 'A');
    assert.equal(payload.investment_score, 27); // backward-compat field

    // lease_data still present
    assert.equal(payload.lease_data.property_id, 29841);

    // comps is a deferred placeholder recorded in fields_missing (not a throw)
    assert.deepEqual(payload.comps, []);
    assert.ok(fieldsMissing.includes('comps'));
  });

  it('records fields_missing (no throw) when a section source is unavailable', async () => {
    const ops = makeOps({
      entity: { id: ENTITY_ID, name: 'Gov Office', entity_type: 'asset', workspace_id: 'ws-1' },
      identities: [{ source_system: 'gov', source_type: 'asset', external_id: '11136' }],
    });
    // Domain reader fails for documents + transactions; properties ok, no owners.
    const domainGet = async (_domain, path) => {
      const table = path.split('?')[0];
      if (table === 'properties') return { ok: true, data: [{ property_id: 11136 }] };
      if (table === 'investment_scores') return { ok: false, data: null, status: 500 };
      return { ok: false, data: null, status: 500 };
    };

    const { payload, fieldsMissing } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: ops, domainGet });

    assert.equal(payload.documents.length, 0);
    assert.equal(payload.transactions.length, 0);
    assert.ok(fieldsMissing.includes('documents'));
    assert.ok(fieldsMissing.includes('transactions'));
    // lease_data resolved, so it is NOT missing; investment falls back to naive compute
    assert.equal(payload.lease_data.property_id, 11136);
    assert.equal(payload.investment.source, 'computed');
  });

  it('marks all domain sections missing when the entity has no domain linkage', async () => {
    const ops = makeOps({
      entity: { id: ENTITY_ID, name: 'Unlinked', entity_type: 'asset', workspace_id: 'ws-1' },
      identities: [],
    });
    const { payload, fieldsMissing } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', {
      opsQuery: ops,
      domainGet: async () => ({ ok: false }),
    });
    for (const f of ['lease_data', 'documents', 'transactions', 'ownership', 'investment']) {
      assert.ok(fieldsMissing.includes(f), `expected ${f} in fields_missing`);
    }
    assert.equal(payload.lease_data, null);
  });
});

// R50 — the comps section is filled from the domain <dom>_nearby_sales fn
// (injectable as deps.domainRpc), closing the long-standing context-packet
// comps gap. When the fn returns no rows / is unavailable, comps stays the
// honest [] + fields_missing entry (the ungeocoded-tail answer).
describe('assemblePropertyPacket — R50 nearby-sales comps fill', () => {
  const baseOps = () => makeOps({
    entity: { id: ENTITY_ID, name: 'Gov Office', entity_type: 'asset', workspace_id: 'ws-1' },
    identities: [{ source_system: 'gov', source_type: 'asset', external_id: '14348' }],
  });
  const domainGet = makeDomainGet({
    properties: [{ property_id: 14348, recorded_owner_id: 1, true_owner_id: 2 }],
    recorded_owners: [{ recorded_owner_id: 1, name: 'Rec LLC' }],
    true_owners: [{ true_owner_id: 2, name: 'True Holdings' }],
  });

  it('maps nearby sales into comps and does NOT record comps as missing', async () => {
    const domainRpc = async (domain, externalId) => {
      assert.equal(domain, 'gov');
      assert.equal(externalId, '14348');
      return { ok: true, data: [
        { property_id: 3734, sale_id: 'uuid-1', address: '100 Main', city: 'Arlington', state: 'VA',
          distance_miles: 7.41, sale_date: '2026-03-01', sold_price: 12000000, sold_price_psf: 450,
          cap_rate: 0.0817, cap_rate_source: 'cap_rate_history:high', buyer: 'NGP', seller: 'Boyd' },
      ] };
    };
    const { payload, fieldsMissing } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', {
      opsQuery: baseOps(), domainGet, domainRpc,
    });
    assert.equal(payload.comps.length, 1);
    assert.equal(payload.comps[0].cap_rate, 0.0817);
    assert.equal(payload.comps[0].cap_rate_source, 'cap_rate_history:high');
    assert.equal(payload.comps[0].price, 12000000);
    assert.equal(payload.comps[0].distance_miles, 7.41);
    assert.ok(!fieldsMissing.includes('comps'));
  });

  it('records comps missing when the nearby-sales fn returns no rows (ungeocoded tail)', async () => {
    const domainRpc = async () => ({ ok: true, data: [] });
    const { payload, fieldsMissing } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', {
      opsQuery: baseOps(), domainGet, domainRpc,
    });
    assert.deepEqual(payload.comps, []);
    assert.ok(fieldsMissing.includes('comps'));
  });

  it('records comps missing (no throw) when the nearby-sales fn errors', async () => {
    const domainRpc = async () => ({ ok: false, data: [] });
    const { payload, fieldsMissing } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', {
      opsQuery: baseOps(), domainGet, domainRpc,
    });
    assert.deepEqual(payload.comps, []);
    assert.ok(fieldsMissing.includes('comps'));
  });
});

// R54 — the packet surfaces a loan_maturity BD signal when the property's
// current debt is maturing within 24mo / matured (v_loan_maturity_watch returns
// a row); otherwise it is null (no row), never a throw.
describe('assemblePropertyPacket — R54 loan-maturity signal', () => {
  const baseOps = () => makeOps({
    entity: { id: ENTITY_ID, name: 'Gov Office', entity_type: 'asset', workspace_id: 'ws-1' },
    identities: [{ source_system: 'gov', source_type: 'asset', external_id: '14239' }],
  });

  it('surfaces loan_maturity when the watch view returns a row', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 14239, recorded_owner_id: 1, true_owner_id: 2 }],
      recorded_owners: [{ recorded_owner_id: 1, name: 'Affinius Capital' }],
      true_owners: [{ true_owner_id: 2, name: 'USGBF NSF LLC' }],
      v_loan_maturity_watch: [{
        maturity_date: '2027-12-01', months_to_maturity: 17, maturity_band: '<=24mo',
        loan_balance: 123000000, is_distressed: false, distress_reason: null, servicer: 'KeyBank',
      }],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.ok(payload.loan_maturity);
    assert.equal(payload.loan_maturity.maturity_band, '<=24mo');
    assert.equal(payload.loan_maturity.loan_balance, 123000000);
    assert.equal(payload.loan_maturity.months_to_maturity, 17);
  });

  it('loan_maturity is null when the property is not on the watch (no row)', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 14239, recorded_owner_id: 1 }],
      recorded_owners: [{ recorded_owner_id: 1, name: 'Affinius Capital' }],
      // v_loan_maturity_watch absent -> 404 -> null, no throw
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.equal(payload.loan_maturity, null);
  });
});

describe('resolveContextPacket — assemble-on-miss (Unit 2)', () => {
  const entity = { id: ENTITY_ID, workspace_id: 'ws-1' };

  it('returns the cached row on a hit WITHOUT assembling', async () => {
    let called = false;
    const assembleFn = async () => { called = true; return { payload: {} }; };
    const cachedRow = { packet_type: 'property', entity_id: ENTITY_ID, payload: { entity } };
    const { context_packet, assembled_on_miss } = await resolveContextPacket({ cachedRow, entity, assembleFn });
    assert.equal(called, false);
    assert.equal(assembled_on_miss, false);
    assert.equal(context_packet, cachedRow);
  });

  it('assembles + returns a non-null packet on a cache miss', async () => {
    let called = false;
    const assembleFn = async (args) => {
      called = true;
      assert.equal(args.packet_type, 'property');
      assert.equal(args.entity_id, ENTITY_ID);
      return { payload: { entity, documents: [] }, token_count: 42, assembled_at: 'now', expires_at: 'later' };
    };
    const { context_packet, assembled_on_miss } = await resolveContextPacket({ cachedRow: null, entity, assembleFn });
    assert.equal(called, true);
    assert.equal(assembled_on_miss, true);
    assert.ok(context_packet);
    assert.equal(context_packet.packet_type, 'property');
    assert.equal(context_packet.assembled_on_miss, true);
    assert.equal(context_packet.token_count, 42);
    assert.ok(context_packet.payload.documents);
  });

  it('returns null (no throw) when assembly fails', async () => {
    const assembleFn = async () => { throw new Error('boom'); };
    const { context_packet } = await resolveContextPacket({ cachedRow: null, entity, assembleFn });
    assert.equal(context_packet, null);
  });
});
