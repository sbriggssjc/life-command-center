// PR5c-entities-b-dupes — `domain` must not scope the canonical_name identity key.
//
// MECHANISM (measured live on LCC Opps, 30 days to 2026-09-02): the canonical_name
// resolution tier in ensureEntityLink() carried a hard `&domain=eq.<domain>` filter.
// canonical_name + workspace IS the identity key (N15c gave it a single writer), but
// `entities.domain` is a PROVENANCE TAG that legitimately carries lcc / cre beside
// dia / gov. So a party already held under `gov` — or with a NULL domain — was
// structurally INVISIBLE when the same party arrived tagged `lcc`, and this tier
// minted a duplicate on the very key that exists to prevent one.
//
// 5 of the 7 same-email duplicate mints in that window had new.domain <> old.domain
// (Adam Gallistel lcc/gov, Nick Taylor lcc/NULL, John Rooney lcc/NULL, Frank Johnson
// lcc/dia, Blaze Katz dia/NULL). The other 2 (W. Aaron Poling, Ransome Foose) were
// 0.14-second intra-request races, which this change does NOT address.
//
// WHY THE FIX IS NARROW: a shared canonical_name alone is NOT identity for a common
// person name. Measured over live shared-email person groups, 44 of 75 carry
// DIFFERENT names (colt.neal@nmrk.com holds two different real brokers; two distinct
// "Frank Johnson"s exist here under different domains). So a CROSS-domain hit
// additionally requires an exact, non-generic email match. Same-domain behaviour is
// unchanged. There is no name-similarity test anywhere here — fuzzy name matching is
// banned for identity throughout this codebase.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureEntityLink } from '../api/_shared/entity-link.js';

const SRC_PATH = new URL('../api/_shared/entity-link.js', import.meta.url);
const originalFetch = global.fetch;

function jsonResponse(body) {
  return {
    ok: true, status: 200,
    headers: { get: (n) => (n.toLowerCase() === 'content-range' ? '0-0/0' : null) },
    async text() { return JSON.stringify(body); }
  };
}

// Drive the real ensureEntityLink. `existing` is what the entities GET returns.
async function run({ existing, domain, seedFields }) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method });
    if (u.includes('/external_identities?') && opts.method === 'GET') return jsonResponse([]);
    if (u.includes('/entities?') && opts.method === 'GET') {
      // Only the canonical_name tier is under test; the email tier is a separate
      // query and must not be fed the candidate row (it is unchanged by this fix).
      if (!u.includes('canonical_name=in.')) return jsonResponse([]);
      // The stub HONOURS `domain=eq.` exactly as PostgREST would. Without this the
      // behavioural tests pass whether or not the filter is in the URL, and the
      // whole suite would detect a revert only through the source assertion —
      // a guard passing for the wrong reason. Verified: restoring the filter now
      // turns all five attach cases RED.
      const m = /[?&]domain=eq\.([^&]*)/.exec(u);
      if (!m) return jsonResponse(existing);
      const want = decodeURIComponent(m[1]);
      return jsonResponse(existing.filter((e) => (e.domain ?? null) === want));
    }
    if (u.endsWith('/entities') && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      return jsonResponse([{ id: 'MINTED', ...body }]);
    }
    if (/\/external_identities(\?|$)/.test(u) && opts.method === 'POST') return jsonResponse([{ id: 'ext-1' }]);
    if (opts.method === 'PATCH') return jsonResponse([{}]);
    throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
  };
  const result = await ensureEntityLink({
    workspaceId: 'ws-1', userId: 'user-1',
    sourceSystem: 'salesforce', sourceType: 'Contact',
    externalId: 'sf-new-1', domain, seedFields
  });
  return { result, calls, minted: calls.some(c => c.url.endsWith('/entities') && c.method === 'POST') };
}

const person = (over) => ({
  id: 'OLD', entity_type: 'person', workspace_id: 'ws-1', ...over
});

describe('PR5c-entities-b-dupes: domain must not scope the canonical identity key', () => {
  beforeEach(() => {
    // Without these, every opsQuery 503s on cold start and BOTH the attach and
    // the mint silently fail — which would make the mint-side assertions pass
    // for the wrong reason.
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
  });
  afterEach(() => { global.fetch = originalFetch; });

  // The 5 measured duplicates, replayed with their real names/emails/domains.
  const CASES = [
    { who: 'Adam Gallistel', email: 'adam.gallistel@cbreim.com', oldDomain: 'gov',  newDomain: 'lcc' },
    { who: 'Nick Taylor',    email: 'ntaylor@torreyfinancial.com', oldDomain: null,  newDomain: 'lcc' },
    { who: 'John Rooney',    email: 'jrooney@torreyfinancial.com', oldDomain: null,  newDomain: 'lcc' },
    { who: 'Frank Johnson',  email: 'fdj6665@gmail.com',           oldDomain: 'dia', newDomain: 'lcc' },
    { who: 'Blaze Katz',     email: 'bkatz@logiccre.com',          oldDomain: null,  newDomain: 'dia' },
  ];

  for (const c of CASES) {
    it(`attaches cross-domain instead of minting: ${c.who} (${c.oldDomain ?? 'NULL'} -> ${c.newDomain})`, async () => {
      const { result, minted } = await run({
        existing: [person({ canonical_name: c.who.toLowerCase(), name: c.who, email: c.email, domain: c.oldDomain })],
        domain: c.newDomain,
        seedFields: { name: c.who, email: c.email }
      });
      assert.equal(minted, false, 'must NOT mint a duplicate');
      assert.equal(result.entityId, 'OLD', 'must attach to the existing entity');
    });
  }

  it('still mints when the cross-domain candidate has a DIFFERENT email (two real people, one name)', async () => {
    const { minted } = await run({
      existing: [person({ canonical_name: 'frank johnson', name: 'Frank Johnson',
                          email: 'someone.else@example.com', domain: 'dia' })],
      domain: 'lcc',
      seedFields: { name: 'Frank Johnson', email: 'fdj6665@gmail.com' }
    });
    assert.equal(minted, true, 'a shared common name across domains is NOT identity without email corroboration');
  });

  it('does not attach cross-domain on a GENERIC shared inbox', async () => {
    const { minted } = await run({
      existing: [person({ canonical_name: 'jane doe', name: 'Jane Doe', email: 'info@acme.com', domain: 'gov' })],
      domain: 'lcc',
      seedFields: { name: 'Jane Doe', email: 'info@acme.com' }
    });
    assert.equal(minted, true, 'info@ is a shared mailbox, never an identity key');
  });

  it('SAME-domain behaviour is unchanged: attaches with no email at all', async () => {
    const { result, minted } = await run({
      existing: [person({ canonical_name: 'acme holdings', name: 'Acme Holdings', entity_type: 'organization',
                          email: null, domain: 'gov' })],
      domain: 'gov',
      seedFields: { name: 'Acme Holdings, LLC' }
    });
    assert.equal(minted, false);
    assert.equal(result.entityId, 'OLD');
  });

  it('prefers the SAME-domain candidate when both exist', async () => {
    const { result } = await run({
      existing: [
        person({ id: 'CROSS', canonical_name: 'nick taylor', name: 'Nick Taylor',
                 email: 'ntaylor@torreyfinancial.com', domain: 'gov' }),
        person({ id: 'SAME',  canonical_name: 'nick taylor', name: 'Nick Taylor',
                 email: 'ntaylor@torreyfinancial.com', domain: 'lcc' }),
      ],
      domain: 'lcc',
      seedFields: { name: 'Nick Taylor', email: 'ntaylor@torreyfinancial.com' }
    });
    assert.equal(result.entityId, 'SAME');
  });

  // ---- source assertion -------------------------------------------------
  // Comments are stripped FIRST: this fix's own comments quote `&domain=eq.` and
  // `domain=eq.${...}` repeatedly while explaining the defect, so a raw-source
  // grep finds the removed predicate present and passes over a complete revert.
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  it('the canonical_name tier carries no domain filter (comments stripped)', () => {
    const code = stripComments(readFileSync(SRC_PATH, 'utf8'));
    const i = code.indexOf('canonical_name=in.(');
    assert.ok(i > 0, 'canonical_name tier not found');
    const region = code.slice(i, code.indexOf('await opsQuery', i));
    assert.ok(!/domain=eq\./.test(region),
      'the canonical_name identity lookup must not be scoped by domain');
  });

  it('positive control: the detector fires on the pre-fix shape', () => {
    const prefix = "let path = `entities?workspace_id=eq.${workspaceId}`\n"
      + "  + `&canonical_name=in.(${encodeURIComponent(inList)})&select=*&limit=10`;\n"
      + "if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;\n"
      + "const match = await opsQuery('GET', path);";
    const code = stripComments(prefix);
    const i = code.indexOf('canonical_name=in.(');
    const region = code.slice(i, code.indexOf('await opsQuery', i));
    assert.ok(/domain=eq\./.test(region), 'detector must go red on the original code');
  });
});
