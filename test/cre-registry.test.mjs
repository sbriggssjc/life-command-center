// R15 — generic CRE property registry (Phase 1). Pure helpers + the
// performCreRegister core (deps injected). Covers the test contract:
//   • out-of-domain doc WITH an extractable owner → CRE property + owner entity + doc
//   • out-of-domain doc WITHOUT an owner → registers property, owner pending, never invents
//   • a junk/implausible owner → owner stays pending, never minted
//   • too-weak anchor → registered:false (caller PARKS)
//   • dia/gov subjects never route to CRE (isOutOfDomainSubject gate)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const {
  performCreRegister,
  isOutOfDomainSubject,
  normalizeCreAddress,
  deriveAssetClass,
  extractOwnerName,
  buildCreNaturalKey,
} = await import('../api/_shared/cre-registry.js');

// ---- Pure helpers ----------------------------------------------------------

describe('isOutOfDomainSubject (the dia/gov gate)', () => {
  it('is false for dia/gov subjects — they never route to CRE', () => {
    assert.equal(isOutOfDomainSubject({ vertical: 'dia' }), false);
    assert.equal(isOutOfDomainSubject({ vertical: 'gov' }), false);
  });
  it('is true for out-of-domain / no-cue subjects', () => {
    assert.equal(isOutOfDomainSubject({ vertical: null }), true);
    assert.equal(isOutOfDomainSubject({ tenant_brand: 'Vervent' }), true);
    assert.equal(isOutOfDomainSubject(null), true);
  });
});

describe('normalizeCreAddress', () => {
  it('lower-cases, strips punctuation, collapses whitespace', () => {
    assert.equal(normalizeCreAddress('123 Main St., Suite #4'), '123 main st suite 4');
  });
  it('returns null for empty/blank', () => {
    assert.equal(normalizeCreAddress(''), null);
    assert.equal(normalizeCreAddress(null), null);
  });
});

describe('deriveAssetClass', () => {
  it('maps specific classes ahead of generic ones', () => {
    assert.equal(deriveAssetClass({ tenant_brand: 'Santander Bank' }, null), 'bank');
    assert.equal(deriveAssetClass({ tenant_brand: 'Top Golf' }, null), 'entertainment');
    assert.equal(deriveAssetClass(null, { property_type: 'Medical Office Building' }), 'mob');
    assert.equal(deriveAssetClass(null, { property_type: 'Class A Office' }), 'office');
    assert.equal(deriveAssetClass({ tenant_brand: 'Strip Mall' }, null), 'retail');
  });
  it('defaults to unknown', () => {
    assert.equal(deriveAssetClass({ tenant_brand: 'Vistra' }, null), 'unknown');
  });
});

describe('extractOwnerName (never invents)', () => {
  it('pulls the owner from a snapshot, preferring owner over seller', () => {
    assert.equal(extractOwnerName({ owner_name: 'Acme Holdings LLC', seller_name: 'X' }), 'Acme Holdings LLC');
    assert.equal(extractOwnerName({ seller_name: 'Beta Capital LP' }), 'Beta Capital LP');
  });
  it('returns null when there is no snapshot or no owner', () => {
    assert.equal(extractOwnerName(null), null);
    assert.equal(extractOwnerName({ address: '1 Main' }), null);
  });
});

describe('buildCreNaturalKey', () => {
  it('prefers the snapshot address; folds state to 2-letter upper', () => {
    const k = buildCreNaturalKey({
      subjectHint: { tenant_brand: 'Vervent', city: 'San Diego', state: 'ca' },
      snapshot: { address: '10 Market St' },
    });
    assert.equal(k.normalized_address, '10 market st');
    assert.equal(k.state, 'CA');
    assert.equal(k.tenant_brand, 'Vervent');
  });
});

// ---- performCreRegister core (deps injected) -------------------------------

function deps(overrides = {}) {
  const calls = { ensureOwner: 0, insert: 0, update: 0, attach: 0, prov: 0 };
  const base = {
    _calls: calls,
    findProperty:     async () => null,                                  // not yet registered
    insertProperty:   async (row) => { calls.insert++; return { id: 7001, ...row }; },
    updateProperty:   async () => { calls.update++; return { ok: true }; },
    attachDoc:        async () => { calls.attach++; return { ok: true, document_id: 9001 }; },
    ensureOwnerEntity: async () => { calls.ensureOwner++; return { ok: true, entityId: 'ent-uuid-1' }; },
    recordProvenance: async () => { calls.prov++; return true; },
  };
  return { ...base, ...overrides, _calls: calls };
}

const OFFICE_HINT = { tenant_brand: 'Vervent', city: 'San Diego', state: 'CA', vertical: null };

describe('performCreRegister', () => {
  it('out-of-domain doc WITH an owner → CRE property + owner entity + doc attach', async () => {
    const d = deps();
    const r = await performCreRegister({
      subjectHint: OFFICE_HINT,
      snapshot: { address: '10 Market St', owner_name: 'Vervent Holdings LLC', property_type: 'Class A Office' },
      fileName: 'Vervent OM.pdf', sourceUrl: '/PROPERTIES/V/Vervent/San Diego, CA/Vervent OM.pdf',
      docType: 'om', workspaceId: 'ws1', actorId: 'u1',
    }, d);

    assert.equal(r.registered, true);
    assert.equal(r.created, true);
    assert.equal(r.cre_property_id, 7001);
    assert.equal(r.owner_entity_id, 'ent-uuid-1');
    assert.equal(r.owner_pending, false);
    assert.equal(r.asset_class, 'office');
    assert.equal(r.document_id, 9001);
    assert.equal(r.attached, true);
    assert.equal(d._calls.ensureOwner, 1);
    assert.equal(d._calls.insert, 1);
    assert.equal(d._calls.attach, 1);
  });

  it('out-of-domain doc WITHOUT an owner → registers property, owner pending, never invents', async () => {
    const d = deps();
    const r = await performCreRegister({
      subjectHint: OFFICE_HINT,
      snapshot: null,                               // light-attach path: no extraction
      fileName: 'Vervent Lease.pdf', sourceUrl: '/PROPERTIES/V/Vervent/San Diego, CA/Vervent Lease.pdf',
      docType: 'lease', workspaceId: 'ws1', actorId: 'u1',
    }, d);

    assert.equal(r.registered, true);
    assert.equal(r.owner_entity_id, null);
    assert.equal(r.owner_pending, true);
    assert.equal(d._calls.ensureOwner, 0, 'never resolves an owner when none is present');
    assert.equal(r.attached, true);
  });

  it('junk/implausible owner → owner stays pending, never minted', async () => {
    const d = deps({ ensureOwnerEntity: async () => ({ ok: false, skipped: 'implausible_person_name' }) });
    const r = await performCreRegister({
      subjectHint: OFFICE_HINT,
      snapshot: { owner_name: 'Sold to ABC by NAI Capital' },
      fileName: 'OM.pdf', sourceUrl: '/x/OM.pdf', docType: 'om', workspaceId: 'ws1', actorId: 'u1',
    }, d);
    assert.equal(r.registered, true);
    assert.equal(r.owner_entity_id, null);
    assert.equal(r.owner_pending, true);
  });

  it('too-weak anchor (no tenant, no address, no state) → registered:false → PARK', async () => {
    const d = deps();
    const r = await performCreRegister({
      subjectHint: { vertical: null }, snapshot: null,
      fileName: 'mystery.pdf', sourceUrl: '/x/mystery.pdf', workspaceId: 'ws1', actorId: 'u1',
    }, d);
    assert.equal(r.registered, false);
    assert.equal(r.reason, 'insufficient_anchor');
    assert.equal(d._calls.insert, 0, 'never inserts a guessed property');
  });

  it('existing CRE property → fill-blanks only (no duplicate insert)', async () => {
    const d = deps({
      findProperty: async () => ({ id: 7002, address: null, city: 'San Diego', state: 'CA',
        tenant_brand: 'Vervent', asset_class: 'unknown', owner_entity_id: null, source_path: '/old' }),
    });
    const r = await performCreRegister({
      subjectHint: OFFICE_HINT,
      snapshot: { address: '10 Market St', owner_name: 'Vervent Holdings LLC', property_type: 'Office' },
      fileName: 'Vervent BOV.pdf', sourceUrl: '/new', docType: 'bov', workspaceId: 'ws1', actorId: 'u1',
    }, d);
    assert.equal(r.registered, true);
    assert.equal(r.created, false);
    assert.equal(r.cre_property_id, 7002);
    assert.equal(d._calls.insert, 0, 'matched the existing row — no duplicate');
    assert.equal(d._calls.update, 1, 'fills blanks (address/asset_class/owner)');
    assert.equal(r.owner_entity_id, 'ent-uuid-1');
  });
});
