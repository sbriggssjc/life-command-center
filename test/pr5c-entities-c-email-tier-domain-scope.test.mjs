// PR5c-entities-c — the EMAIL tier's `&domain=eq.` filter is DELIBERATE. Keep it.
//
// PR5c-entities-b-dupes removed a hard `&domain=eq.<domain>` filter from
// ensureEntityLink()'s canonical_name tier: `entities.domain` is a PROVENANCE
// TAG, not part of identity. It fixed ONE tier. The sibling — R39 Unit 1's EMAIL
// tier, the fallback that exists precisely to catch what the canonical tier
// misses — carries the IDENTICAL filter, and that round's own guard scoped it
// out ("the email tier is a separate query ... unchanged by this fix"). That is
// "the hazard travels with the TECHNIQUE, not the name" (P189), one round later,
// inside the same function.
//
// The obvious follow-up is to delete it "for consistency". It was measured on
// named rows and REFUSED. 55 live cross-domain person pairs share a non-generic
// email AND carry different canonical names (so the canonical tier cannot catch
// them either) — v_lcc_entity_email_tier_blind_pairs. Of those, 15 are the same
// person under a name variant (Andy/Andrew Nathan, Nicholas/Nick Borrelli,
// Vince/Vincent Curran, Ravi/Ravindra G. Gangavaram, ...). 40 are NOT: two
// different real brokers on one mailbox (Phillip Kelly / Toby Scrivner
// @northmarq.com; Jack Minter / Creighton Stark; David Gellner / Matthew
// Dodson), firms filed as persons ("Marcus & Millichap", "Kidder Mathews",
// "Global Net Lease"), and P131 document row labels ("Income & Expenses",
// "Per SF", "Condo Size", "First Vice President").
//
// PRECISION 27% (15/55) — the band this codebase has twice measured and
// rejected (P189 domain-keyed merge grouping 25%; P198 co-proposal 7%). Dropping
// the filter auto-ATTACHES 40 wrong parties at the identity choke point.
//
// And there is no safe corroboration to add instead: the canonical tier matches
// on NAME so it can require EMAIL to agree; the email tier matches on EMAIL, so
// the symmetric corroboration would be a NAME test — banned for identity here.
//
// If you are here because you want to remove the filter: raise the precision
// first (a structural person-shape gate on the RESOLVED row would help, but was
// measured NOT to fix the core case — Jack Minter and Creighton Stark are both
// plausible real people on one mailbox), or take it to a human review lane.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureEntityLink } from '../api/_shared/entity-link.js';

const SRC_PATH = new URL('../api/_shared/entity-link.js', import.meta.url);
const MIG_PATH = new URL(
  '../supabase/migrations/20261012120000_lcc_pr5c_email_tier_blind_pairs.sql',
  import.meta.url
);
const originalFetch = global.fetch;

// Strip JS comments WITHOUT touching string/template literals. Load-bearing:
// this file's subject quotes `&domain=eq.` and `email=ilike.` in its own prose
// several times, so a raw-source grep finds them present over a complete revert
// (the A5c / N18 trap). String literals are KEPT because the thing being
// asserted lives inside a template literal.
function stripJsComments(src) {
  let out = '';
  let i = 0;
  let quote = null; // "'", '"', '`'
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i += 1; continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2; continue;
    }
    out += c; i += 1;
  }
  return out;
}

function jsonResponse(body) {
  return {
    ok: true, status: 200,
    headers: { get: (n) => (n.toLowerCase() === 'content-range' ? '0-0/0' : null) },
    async text() { return JSON.stringify(body); }
  };
}

// Drive the real ensureEntityLink. The canonical tier is fed NOTHING so the
// EMAIL tier is the one under test. The stub HONOURS `domain=eq.` exactly as
// PostgREST would — without that, these tests pass whether or not the filter is
// in the URL and the suite would only detect a change through the source
// assertion, i.e. a guard passing for the wrong reason.
async function run({ existing, domain, seedFields }) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method });
    if (u.includes('/external_identities?') && opts.method === 'GET') return jsonResponse([]);
    if (u.includes('/entities?') && opts.method === 'GET') {
      if (u.includes('canonical_name=in.')) return jsonResponse([]);   // canonical tier: no hit
      if (!u.includes('email=ilike.')) return jsonResponse([]);
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
  return {
    result, calls,
    minted: calls.some(c => c.url.endsWith('/entities') && c.method === 'POST'),
    emailTierCalls: calls.filter(c => c.url.includes('email=ilike.')),
  };
}

const person = (over) => ({ id: 'OLD', entity_type: 'person', workspace_id: 'ws-1', ...over });

describe('PR5c-entities-c: the email tier is domain-scoped ON PURPOSE', () => {
  beforeEach(() => {
    // Without these every opsQuery 503s on cold start and BOTH the attach and
    // the mint silently fail — which would make the mint assertions pass for
    // the wrong reason.
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('the email tier still carries &domain=eq. (comment-stripped source)', () => {
    const src = stripJsComments(readFileSync(SRC_PATH, 'utf8'));
    // population control: the prose above and in entity-link.js mentions this
    // token repeatedly, so prove the stripper actually removed those mentions.
    assert.ok(
      !stripJsComments('// domain=eq.SHOULD_BE_STRIPPED\n').includes('SHOULD_BE_STRIPPED'),
      'comment stripper is inert — every assertion below would be meaningless'
    );
    const emailTier = src.slice(src.indexOf('email=ilike.'));
    assert.ok(emailTier.length > 0, 'email tier not found in source');
    assert.match(
      emailTier.slice(0, 600), /domain=eq\./,
      'The email tier\'s `&domain=eq.` filter was removed. This is DELIBERATE — see this ' +
      'file\'s header: dropping it auto-attaches 40 wrong parties for 15 real ones (27% ' +
      'precision, the band P189/P198 rejected). Raise precision first.'
    );
  });

  it('does NOT attach a cross-domain same-email person (the 40 wrong pairs stay apart)', async () => {
    // Phillip Kelly and Toby Scrivner are two REAL, different Northmarq people
    // on one mailbox. Attaching them is the failure this filter prevents.
    const { minted, result } = await run({
      existing: [person({ canonical_name: 'phillip kelly', name: 'Phillip Kelly',
                          email: 'tscrivner@northmarq.com', domain: 'dia' })],
      domain: 'gov',
      seedFields: { name: 'Toby Scrivner', email: 'tscrivner@northmarq.com' }
    });
    assert.equal(minted, true, 'a shared mailbox across domains must NOT auto-attach two people');
    assert.notEqual(result.entityId, 'OLD');
  });

  it('DOES attach a same-domain same-email person (R39 Unit 1 still works)', async () => {
    const { minted, result } = await run({
      existing: [person({ canonical_name: 'andrew nathan', name: 'Andrew Nathan',
                          email: 'anathan@meritageprop.com', domain: 'gov' })],
      domain: 'gov',
      seedFields: { name: 'Andy Nathan', email: 'anathan@meritageprop.com' }
    });
    assert.equal(minted, false, 'same-domain email resolution must be unchanged');
    assert.equal(result.entityId, 'OLD');
  });

  it('a generic/role inbox never auto-attaches, even same-domain', async () => {
    const { minted } = await run({
      existing: [person({ canonical_name: 'jane doe', name: 'Jane Doe',
                          email: 'info@example.com', domain: 'gov' })],
      domain: 'gov',
      seedFields: { name: 'John Roe', email: 'info@example.com' }
    });
    assert.equal(minted, true, 'info@ identifies a firm inbox, not a person');
  });

  it('introduces no name-similarity test in the email tier (fuzzy names are banned for identity)', () => {
    const src = stripJsComments(readFileSync(SRC_PATH, 'utf8'));
    const tier = src.slice(src.indexOf('email=ilike.'), src.indexOf('email=ilike.') + 900);
    for (const banned of ['nameSimilarity', 'ownerCore', 'levenshtein', 'similarity(']) {
      assert.ok(!tier.includes(banned), `email tier must not use ${banned} for identity`);
    }
  });

  it('the SQL generic-inbox mirror matches the JS Set token-for-token', () => {
    const js = readFileSync(SRC_PATH, 'utf8');
    const sql = readFileSync(MIG_PATH, 'utf8');

    const jsBlock = /GENERIC_INBOX_LOCALPARTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(js);
    assert.ok(jsBlock, 'GENERIC_INBOX_LOCALPARTS not found in entity-link.js');

    // Exactly one array literal in the migration — a second copy is drift.
    const sqlBlocks = [...sql.matchAll(/=\s*any\s*\(array\[([\s\S]*?)\]\)/g)];
    assert.equal(sqlBlocks.length, 1, 'expected exactly one stoplist array in the migration');

    const toks = (s) => [...s.matchAll(/'([^']*)'/g)].map(m => m[1]).sort();
    const jsToks = toks(jsBlock[1]);
    const sqlToks = toks(sqlBlocks[0][1]);
    assert.ok(jsToks.length >= 20, 'stoplist parse looks empty — the assertion would be vacuous');
    assert.deepEqual(
      sqlToks, jsToks,
      'lcc_is_generic_inbox_localpart() has drifted from GENERIC_INBOX_LOCALPARTS. ' +
      'Two copies of one list is the normaliser drift this repo warns about — update both.'
    );
  });
});
