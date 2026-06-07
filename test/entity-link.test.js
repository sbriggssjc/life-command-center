import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureEntityLink, normalizeCanonicalName, normalizeAddress, stripListingStatusPrefix,
  isStreetFragmentName, isJunkEntityName, splitCompositeOwnerName } from '../api/_shared/entity-link.js';

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
