import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureEntityLink, normalizeCanonicalName, normalizeAddress, stripListingStatusPrefix,
  isStreetFragmentName, isJunkEntityName, splitCompositeOwnerName,
  isFieldLabelName, isImplausibleOwnerName, isJunkProspectName,
  normalizeEmail, isGenericInboxEmail } from '../api/_shared/entity-link.js';

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || headers[name] || null;
      }
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

describe('entity-link helper', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes canonical names', () => {
    assert.equal(normalizeCanonicalName('Acme Holdings, LLC'), 'acme holdings');
  });

  it('strips CoStar/LoopNet listing-status prefixes from addresses', () => {
    assert.equal(stripListingStatusPrefix('For Sale | 1164 Route 130 North'), '1164 Route 130 North');
    assert.equal(stripListingStatusPrefix('For Lease — 802 N John Young Pky'), '802 N John Young Pky');
    assert.equal(stripListingStatusPrefix('Reduced: 99 Main St'), '99 Main St');
    assert.equal(stripListingStatusPrefix('For Sale | New Listing | 99 Main St'), '99 Main St');
    assert.equal(stripListingStatusPrefix('1164 Route 130 North'), '1164 Route 130 North');
    assert.equal(stripListingStatusPrefix(null), null);
    assert.equal(stripListingStatusPrefix(''), '');
    // Round 76ei: CoStar Sale Comp / Lease Comp page headings
    assert.equal(
      stripListingStatusPrefix('Condo Sold: 326 Del Prado Blvd, 1st Floor - 101'),
      '326 Del Prado Blvd, 1st Floor - 101'
    );
    assert.equal(stripListingStatusPrefix('Office Sold: 1234 Foo St'), '1234 Foo St');
    assert.equal(stripListingStatusPrefix('Medical Office Sold - 555 Health Way'), '555 Health Way');
    assert.equal(stripListingStatusPrefix('Industrial Leased | 99 Warehouse Dr'), '99 Warehouse Dr');
    assert.equal(stripListingStatusPrefix('Retail For Sale: 12 Market Pl'), '12 Market Pl');
  });

  it('normalizeAddress collapses prefixed and bare forms to the same key', () => {
    assert.equal(
      normalizeAddress('For Sale | 1164 Route 130 North, Burlington, NJ'),
      normalizeAddress('1164 Route 130 North')
    );
    assert.equal(
      normalizeAddress('Reduced - 175 Righter Road'),
      normalizeAddress('175 Righter Rd')
    );
  });

  it('creates a canonical entity and external identity when none exists', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method });
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'entity-1', ...body }]);
      }
      if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'ext-1', ...body }]);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceSystem: 'gov_supabase',
      sourceType: 'asset',
      externalId: 'prop-123',
      domain: 'government',
      seedFields: {
        name: '123 Main St',
        address: '123 Main St',
        city: 'Tulsa',
        state: 'OK',
        asset_type: 'government_leased'
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.entityId, 'entity-1');
    assert.equal(result.createdEntity, true);
    assert.equal(result.createdIdentity, true);
    assert.ok(calls.some(call => call.url.includes('/entities') && call.method === 'POST'));
    assert.ok(calls.some(call => call.url.includes('/external_identities') && call.method === 'POST'));
  });

  it('retypes a firm-suffixed inferred-person to organization (junk-lane rescope Unit 2)', async () => {
    const created = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (u.includes('/entities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (u.endsWith('/entities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body); created.push(body);
        return jsonResponse([{ id: 'entity-org', ...body }]);
      }
      if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') return jsonResponse([{ id: 'ext-1', ...JSON.parse(opts.body) }]);
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };
    const result = await ensureEntityLink({
      workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'costar', sourceType: 'person',
      externalId: 'buyer-1', domain: 'government', seedFields: { name: 'Acadia Realty' },
    });
    assert.equal(result.ok, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].entity_type, 'organization');  // mistyped firm recovered
  });

  it('still rejects a deal/attribution string even with a firm token', async () => {
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (u.includes('/entities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (u.endsWith('/entities') && opts.method === 'POST') throw new Error('must not create an entity for a deal string');
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };
    const result = await ensureEntityLink({
      workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'costar', sourceType: 'person',
      externalId: 'buyer-2', domain: 'government', seedFields: { name: 'Townsend Capital by NAI ($5.0m approx)' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, 'implausible_person_name');
  });

  // Junk-lane rescope follow-up (Unit B, 2026-06-17): the via/aka/c-o/sentence
  // attribution classes are now in DEAL_STRING_RE too, so a firm-suffixed
  // inferred-person carrying one stays `person` → rejected, never minted as a
  // dirty-named org (matches the Unit-A bulk correction).
  for (const dirty of [
    'Prime Property Fund via Morgan Stanley Prime Property Fund',
    'American Realty Capital AKA AR Global Investments',
    '150 Spear Street Associates c/o Alex Freemon Greg Freemon',
    'The property is currently 100% occupied by DaVita Dialysis',
  ]) {
    it(`rejects deal/attribution artifact (not retyped to org): ${dirty.slice(0, 32)}…`, async () => {
      global.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (u.includes('/external_identities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
        if (u.includes('/entities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
        if (u.endsWith('/entities') && opts.method === 'POST') throw new Error('must not create an entity for a deal/attribution artifact');
        throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
      };
      const result = await ensureEntityLink({
        workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'costar', sourceType: 'person',
        externalId: 'buyer-x', domain: 'government', seedFields: { name: dirty },
      });
      assert.equal(result.ok, false);
      assert.equal(result.skipped, 'implausible_person_name');
    });
  }

  it('does NOT false-reject a legit leading-"Via"/"Aka" firm name (mid-string anchor)', async () => {
    const created = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (u.includes('/entities?') && opts.method === 'GET') return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (u.endsWith('/entities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body); created.push(body);
        return jsonResponse([{ id: 'entity-org', ...body }]);
      }
      if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') return jsonResponse([{ id: 'ext-1', ...JSON.parse(opts.body) }]);
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };
    const result = await ensureEntityLink({
      workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'costar', sourceType: 'person',
      externalId: 'buyer-via', domain: 'government', seedFields: { name: 'Via Verde Capital' },
    });
    assert.equal(result.ok, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].entity_type, 'organization');  // leading "Via" is not attribution
  });

  it('flags bare street-address fragments (R9 follow-up)', () => {
    // The chain-connect drain minted these as organizations — must be rejected.
    assert.equal(isStreetFragmentName('West Mall Dr'), true);
    assert.equal(isStreetFragmentName('Foo Ave N'), true);
    assert.equal(isStreetFragmentName('Bar St SW'), true);
    assert.equal(isStreetFragmentName('123 Main St'), true);
    // Real firms / surnames / no-signal names must survive.
    assert.equal(isStreetFragmentName('Parkway Properties LLC'), false);
    assert.equal(isStreetFragmentName('Parkway Properties'), false);
    assert.equal(isStreetFragmentName('Boulevard Capital LLC'), false);
    assert.equal(isStreetFragmentName('Broadway'), false);
    assert.equal(isStreetFragmentName('Gateway'), false);
    assert.equal(isStreetFragmentName('John Way'), false);
    assert.equal(isStreetFragmentName('Green Rock USA'), false);
  });

  it('keeps isJunkEntityName address-safe (asset names are addresses)', () => {
    // The street-fragment check is type-gated in ensureEntityLink, NOT folded
    // into isJunkEntityName, so asset/property minting is never blocked.
    assert.equal(isJunkEntityName('123 Main St'), false);
    assert.equal(isJunkEntityName('West Mall Dr'), false);
    // Existing structural junk still caught.
    assert.equal(isJunkEntityName('Seller ContactsCraig Burrows(916) 768-5544 (p)'), true);
  });

  it('flags prospect-junk capture artifacts (R25 Unit 2)', () => {
    // The live P-CONTACT junk set — all must be caught.
    for (const junk of [
      'Realtor', 'Investment Specialist', 'Description:', 'Mill Levy: 92.281',
      'CPA:16', "GSA (US Gov't)", "GSA (US Gov't) JV US Fed Props Trust Inc",
      'Mexico', 'France', 'Canada', 'Paris, PAR 75009', 'Pedregal 24 oficina 423',
    ]) {
      assert.equal(isJunkProspectName(junk), true, `should flag: ${junk}`);
      assert.equal(isJunkEntityName(junk), true, `boundary should reject: ${junk}`);
    }
    // Must NOT false-positive legit names (address-safe + exact-locale anchored).
    for (const ok of [
      'State of New Mexico', '123 Mexico St', 'Paris Capital LLC',
      'First Realtor Group', 'Northwestern Mutual', 'Foulger Pratt',
      'Jamestown', 'Boyd Watterson Global', 'NGP Capital',
    ]) {
      assert.equal(isJunkProspectName(ok), false, `should NOT flag: ${ok}`);
    }
    assert.equal(isJunkProspectName(''), false);
    assert.equal(isJunkProspectName(null), false);
  });

  it('splits pipe-delimited composite owner names (R9 follow-up)', () => {
    const clean = splitCompositeOwnerName('Vincent Curran | Palestra Real Estate Partners, Inc');
    assert.equal(clean.ambiguous, false);
    assert.equal(clean.firm, 'Palestra Real Estate Partners, Inc');
    assert.equal(clean.person, 'Vincent Curran');

    // No firm suffix on either side -> ambiguous, firm trails by convention.
    const amb = splitCompositeOwnerName('Chad Middendorf | Green Rock USA');
    assert.equal(amb.ambiguous, true);
    assert.equal(amb.firm, 'Green Rock USA');
    assert.equal(amb.person, null);

    // Both firms -> ambiguous, first firm-suffixed segment wins.
    const both = splitCompositeOwnerName('Acme LLC | Beta Holdings LLC');
    assert.equal(both.ambiguous, true);
    assert.equal(both.firm, 'Acme LLC');

    assert.equal(splitCompositeOwnerName('No pipe here'), null);
  });

  it('mints the firm (not the composite) and attaches the person for "<person> | <firm>"', async () => {
    const posts = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      const method = opts.method || 'GET';
      if (method === 'GET' && u.includes('/external_identities?')) {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (method === 'GET' && u.includes('/entities?')) {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (method === 'GET' && u.includes('/entity_relationships?')) {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (method === 'POST' && u.endsWith('/entities')) {
        const body = JSON.parse(opts.body);
        posts.push({ kind: 'entity', name: body.name, type: body.entity_type, metadata: body.metadata });
        return jsonResponse([{ id: `entity-${posts.filter(p => p.kind === 'entity').length}`, ...body }]);
      }
      if (method === 'POST' && /\/entity_relationships(\?|$)/.test(u)) {
        const body = JSON.parse(opts.body);
        posts.push({ kind: 'relationship', type: body.relationship_type, metadata: body.metadata });
        return jsonResponse([{ id: 'rel-1', ...body }]);
      }
      if (method === 'POST' && /\/external_identities(\?|$)/.test(u)) {
        return jsonResponse([{ id: 'ext-1' }]);
      }
      // SF sync + any other path: benign empty.
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1',
      userId: 'user-1',
      domain: 'dia',
      seedFields: { name: 'Vincent Curran | Palestra Real Estate Partners, Inc', domain: 'dia' },
    });

    assert.equal(result.ok, true);
    const entityPosts = posts.filter(p => p.kind === 'entity');
    // Firm entity minted with the firm name (NOT the composite), original stashed.
    const firm = entityPosts[0];
    assert.equal(firm.name, 'Palestra Real Estate Partners, Inc');
    assert.equal(firm.type, 'organization');
    assert.equal(firm.metadata.composite_source_name, 'Vincent Curran | Palestra Real Estate Partners, Inc');
    // Person entity minted + associated_with relationship created.
    assert.ok(entityPosts.some(p => p.name === 'Vincent Curran' && p.type === 'person'));
    assert.ok(posts.some(p => p.kind === 'relationship' && p.type === 'associated_with'
      && p.metadata && p.metadata.via === 'composite_owner_split'));
    assert.ok(result.compositeContactId);
  });

  // R39 Unit 1 — email as a write-time resolution key.
  it('normalizeEmail / isGenericInboxEmail', () => {
    assert.equal(normalizeEmail('  John.Doe@Example.COM '), 'john.doe@example.com');
    assert.equal(normalizeEmail('not-an-email'), '');
    assert.equal(normalizeEmail('a@b'), '');           // no TLD
    assert.equal(normalizeEmail(null), '');
    assert.equal(isGenericInboxEmail('info@acme.com'), true);
    assert.equal(isGenericInboxEmail('sales+nyc@acme.com'), true);   // plus-addressing
    assert.equal(isGenericInboxEmail('Leasing@acme.com'), true);
    assert.equal(isGenericInboxEmail('jane.smith@acme.com'), false);
    assert.equal(isGenericInboxEmail('not-an-email'), false);
  });

  it('attaches a re-captured person to the existing entity by email (no new entity)', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const method = opts.method || 'GET';
      calls.push({ u, method });
      if (method === 'GET' && u.includes('/external_identities?')) return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      // canonical_name lookup misses; the email lookup hits.
      if (method === 'GET' && u.includes('/entities?') && u.includes('email=ilike.')) {
        return jsonResponse([{ id: 'person-existing', entity_type: 'person', name: 'Jane Q. Smith', email: 'jane.smith@acme.com' }]);
      }
      if (method === 'GET' && u.includes('/entities?')) return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (method === 'POST' && u.endsWith('/entities')) throw new Error('must NOT create a new entity when email resolves');
      if (method === 'POST' && /\/external_identities(\?|$)/.test(u)) return jsonResponse([{ id: 'ext-1', ...JSON.parse(opts.body) }]);
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    };
    const result = await ensureEntityLink({
      workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'costar', sourceType: 'person',
      externalId: 'contact-9', domain: 'dia',
      seedFields: { name: 'Jane Smith', email: 'JANE.SMITH@acme.com' },  // different name, same email
    });
    assert.equal(result.ok, true);
    assert.equal(result.entityId, 'person-existing');
    assert.equal(result.createdEntity, false);
    assert.equal(result.resolvedByEmail, true);
    assert.ok(calls.some((c) => c.method === 'POST' && /\/external_identities/.test(c.u)));
  });

  it('does NOT email-attach on a generic/shared inbox (mints a new person)', async () => {
    let created = 0;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const method = opts.method || 'GET';
      if (method === 'GET' && u.includes('/external_identities?')) return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      // An email lookup must never even be issued for a generic inbox.
      if (method === 'GET' && u.includes('email=ilike.')) throw new Error('must not look up a generic inbox by email');
      if (method === 'GET' && u.includes('/entities?')) return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      if (method === 'POST' && u.endsWith('/entities')) { created += 1; return jsonResponse([{ id: 'person-new', ...JSON.parse(opts.body) }]); }
      if (method === 'POST' && /\/external_identities(\?|$)/.test(u)) return jsonResponse([{ id: 'ext-1' }]);
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    };
    const result = await ensureEntityLink({
      workspaceId: 'ws-1', userId: 'user-1', sourceSystem: 'costar', sourceType: 'person',
      externalId: 'contact-10', domain: 'dia',
      seedFields: { name: 'Front Desk', email: 'info@acme.com' },
    });
    assert.equal(result.ok, true);
    assert.equal(created, 1);
    assert.equal(result.resolvedByEmail, false);
  });

  it('returns an error when external identity creation fails after entity creation', async () => {
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        return jsonResponse([{ id: 'entity-1', name: '123 Main St' }]);
      }
      if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') {
        return jsonResponse({ error: 'duplicate conflict' }, false, 409);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceSystem: 'gov_supabase',
      sourceType: 'asset',
      externalId: 'prop-123',
      domain: 'government',
      seedFields: {
        name: '123 Main St',
        address: '123 Main St',
        city: 'Tulsa',
        state: 'OK',
        asset_type: 'government_leased'
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'Failed to create external identity link');
    assert.equal(result.entity.id, 'entity-1');
  });
});

// R15 Phase 2c — owner-name guard: reject bare field labels + the tenant brand,
// accept real owner firms (the owner-specific complement to isJunkEntityName).
describe('isFieldLabelName', () => {
  it('rejects bare field labels (header grabbed instead of the value)', () => {
    for (const label of ['Ownership', 'Owner', 'Seller', 'Buyer', 'Recorded Owner',
      'True Owner', 'Landlord', 'Developer', 'L. BROKER', 'P. BROKER', 'Broker',
      'Tenant', 'Lessee', 'Seller:', 'Owner :']) {
      assert.equal(isFieldLabelName(label), true, `${label} is a label`);
    }
  });
  it('accepts a real firm name that merely contains a label word as a token', () => {
    assert.equal(isFieldLabelName('Seller Properties LLC'), false);
    assert.equal(isFieldLabelName('Wallace Properties, Inc.'), false);
    assert.equal(isFieldLabelName('Agarita Management Company'), false);
    assert.equal(isFieldLabelName(''), false);
    assert.equal(isFieldLabelName(null), false);
  });
});

describe('isImplausibleOwnerName', () => {
  it('rejects bare labels regardless of tenant', () => {
    assert.equal(isImplausibleOwnerName('Ownership'), true);
    assert.equal(isImplausibleOwnerName('Seller'), true);
    assert.equal(isImplausibleOwnerName('L. BROKER'), true);
  });
  it('rejects the folder tenant brand (equality / substring / token overlap)', () => {
    assert.equal(isImplausibleOwnerName('HUB Group Trucking', { tenantBrand: 'HUB Group Trucking' }), true);
    assert.equal(isImplausibleOwnerName('Mavis', { tenantBrand: 'Mavis Tire' }), true);
    assert.equal(isImplausibleOwnerName('Mavis Discount Tire', { tenantBrand: 'Mavis Tire' }), true);
  });
  it('accepts a real owner that is NOT the tenant', () => {
    assert.equal(isImplausibleOwnerName('Agarita Management Company', { tenantBrand: 'HUB Group' }), false);
    assert.equal(isImplausibleOwnerName('Wallace Properties, Inc.', { tenantBrand: 'Mavis Tire' }), false);
    assert.equal(isImplausibleOwnerName('Vervent Holdings LLC', { tenantBrand: 'Vistra' }), false);
  });
  it('does not false-reject when tenant shares a single common token', () => {
    assert.equal(isImplausibleOwnerName('First National Bank Trust', { tenantBrand: 'Bank' }), false);
  });
});
