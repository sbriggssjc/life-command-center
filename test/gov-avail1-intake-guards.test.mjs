// GOV-AVAIL1 (2026-09-22) — the Findlay OM → gov Available chain, one guard per link.
//
// Live trace: `USRenalMOB_Findlay_OH_OM_SB.pdf` (seed_data.source_vertical='dia') was
// extracted as "6120 South Yale Avenue, Suite 300", Tulsa OK (Team Briggs' office block),
// matched an LCC asset entity NAMED "6120 South Yale Ave" but bridged to gov property 11255
// at 5110 South Yale Ave, and promoted an ACTIVE gov listing (c04dc749…). Each describe()
// below pins one link:
//   (a) contact-block address rejected from the document text;
//   (b) known brokerage office rejected (incl. the spelled-out form the old
//       own-firm substring list missed);
//   (c) civic-number mismatch refused by the REAL promoter (the LCC-bridge case end to end);
//   (d) a dia-vertical document refused into gov tables, and the reverse; and the
//       create-property domain pick honours the stated vertical.
// Behavioural where the code is reachable, AST-anchored where it is wiring.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'dia-key';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'gov-key';

const guard = await import('../api/_shared/intake-address-guard.js');
const { promoteIntakeToDomainListing } = await import('../api/_handlers/intake-promoter.js');
const { pickDomainForTenant } = await import('../api/_handlers/intake-create-property.js');
const { isOwnFirmAddress } = await import('../api/_shared/own-firm-addresses.js');

// A synthetic OM laid out like the real one: subject described in the body (far from any
// contact detail), the broker block on the cover and again on the back page.
const BROKER_BLOCK = `
EXCLUSIVELY LISTED BY
Scott Briggs, Managing Director
6120 South Yale Avenue, Suite 300
Tulsa, OK 74136
T 918.555.0142
sbriggs@northmarq.com
`;
const FILLER = ' The property benefits from a long-term net lease with scheduled increases. '.repeat(12);
const FINDLAY_OM_TEXT =
  `US RENAL CARE MEDICAL OFFICE BUILDING | FINDLAY, OHIO\n${BROKER_BLOCK}\n${FILLER}\n` +
  `PROPERTY OVERVIEW\nThe subject is located at 1717 Medical Blvd, Findlay, OH 45840.${FILLER}\n` +
  `Site plan: 1717 Medical Blvd sits on 2.1 acres.${FILLER}\n` +
  `CONFIDENTIALITY AGREEMENT${FILLER}\n${BROKER_BLOCK}`;

describe('(a) broker contact-block address is rejected from the document text', () => {
  it('the Findlay extraction (office block as subject) is rejected, subject fields nulled', () => {
    const snap = {
      address: '6120 South Yale Avenue, Suite 300', city: 'Tulsa', state: 'OK', zip_code: '74136',
      addresses: ['6120 South Yale Avenue, Suite 300'], tenant_name: null,
    };
    // Empty registry: only the text signal can fire, so this proves link (a) on its own.
    const res = guard.applySubjectAddressGuard(snap, { text: FINDLAY_OM_TEXT, registry: [] });
    assert.equal(res.rejected, true);
    assert.equal(res.reason, 'broker_contact_block');
    assert.equal(snap.address, null);
    assert.equal(snap.city, null);
    assert.equal(snap.state, null);
    assert.equal(snap.zip_code, null);
    assert.equal(snap.addresses, null);
    assert.equal(snap._address_guard.rejected_address, '6120 South Yale Avenue, Suite 300');
  });

  it('negative control: the real subject in the same document is NOT rejected', () => {
    const snap = { address: '1717 Medical Blvd', city: 'Findlay', state: 'OH' };
    const res = guard.applySubjectAddressGuard(snap, { text: FINDLAY_OM_TEXT, registry: [] });
    assert.equal(res.rejected, false);
    assert.equal(snap.address, '1717 Medical Blvd');
  });

  it('negative control: a suite-less subject appearing once beside the broker e-mail survives', () => {
    const cover = 'Offered at 450 Main St\nContact: jane@brokerage.com 555-123-4567';
    assert.equal(guard.isBrokerContactBlockAddress('450 Main St', cover), false);
  });

  it('evidence counts every occurrence and every contact-block occurrence', () => {
    const ev = guard.addressContactBlockEvidence('6120 South Yale Avenue, Suite 300', FINDLAY_OM_TEXT);
    assert.equal(ev.occurrences, 2);
    assert.equal(ev.contact_occurrences, 2);
    const subj = guard.addressContactBlockEvidence('1717 Medical Blvd', FINDLAY_OM_TEXT);
    assert.equal(subj.occurrences, 2);
    assert.equal(subj.contact_occurrences, 0);
  });
});

describe('(b) known brokerage office', () => {
  it('matches every spelling of our Tulsa office; the old substring list missed the spelled-out one', () => {
    for (const a of ['6120 South Yale Avenue, Suite 300', '6120 S. Yale Ave, Ste 300',
                     '6120 S Yale Ave #300', '6120 south yale avenue']) {
      assert.ok(guard.matchBrokerageOffice(a, 'OK'), a);
      assert.equal(isOwnFirmAddress(a), true, a);
    }
    // Legacy substring form, kept as documentation of the gap this change closes.
    const legacy = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '').includes('6120syaleavesuite300');
    assert.equal(legacy('6120 South Yale Avenue, Suite 300'), false);
  });

  it('does not match a different civic number, a different street, or another state', () => {
    assert.equal(guard.matchBrokerageOffice('5110 South Yale Ave', 'OK'), null);
    assert.equal(guard.matchBrokerageOffice('6120 S Lewis Ave', 'OK'), null);
    assert.equal(guard.matchBrokerageOffice('6120 S Yale Ave', 'TX'), null);
  });

  it('a DB registry row (CBRE Houston) rejects the Brownsville/Post Oak shape without document text', () => {
    const registry = [...guard.BUILTIN_BROKERAGE_OFFICES,
      { firm_name: 'CBRE (Houston)', address: '2800 Post Oak Blvd, Suite 500', city: 'Houston', state: 'TX' }];
    const snap = { address: '2800 Post Oak Blvd, Suite 500, Houston, TX 77056', city: 'Brownsville', state: 'TX' };
    const res = guard.applySubjectAddressGuard(snap, { registry });
    assert.equal(res.rejected, true);
    assert.equal(res.reason, 'known_brokerage_office');
    assert.equal(snap._address_guard.office_firm, 'CBRE (Houston)');
  });
});

// ── Promoter harness (the folder-feed-enrich-mode pattern) ─────────────────────────────
const originalFetch = global.fetch;
function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, headers: { get() { return null; } },
           async text() { return JSON.stringify(body); }, async json() { return body; } };
}
let calls;
function installFetchMock({ entity = null, govProperty = null, diaProperty = null } = {}) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ method, url: u });
    if (u.startsWith('https://ops.test.local') && u.includes('/rest/v1/entities') && method === 'GET') {
      return jsonResponse(entity ? [entity] : []);
    }
    if (u.startsWith('https://gov.test.local') && u.includes('/rest/v1/properties') && method === 'GET') {
      return jsonResponse(govProperty ? [govProperty] : []);
    }
    if (u.startsWith('https://dia.test.local') && u.includes('/rest/v1/properties') && method === 'GET') {
      return jsonResponse(diaProperty ? [diaProperty] : []);
    }
    if (method === 'POST') return jsonResponse([{ listing_id: 'L1', id: 1 }], true, 201);
    if (method === 'PATCH') return jsonResponse([{}]);
    return jsonResponse([]);
  };
}
const domainWrites = () => calls.filter(c => c.method !== 'GET'
  && (c.url.startsWith('https://gov.test.local') || c.url.startsWith('https://dia.test.local')));
const listingWrites = () => calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/available_listings'));

const OM = { document_type: 'om', address: '6120 South Yale Avenue, Suite 300', city: 'Tulsa', state: 'OK',
             listing_broker: 'Scott Briggs' };

describe('(c) civic-number mismatch is refused by the real promoter', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('the LCC-bridge chain: entity "6120 South Yale Ave" → gov 11255 at 5110 → refused, nothing written', async () => {
    installFetchMock({
      entity: { id: '658c4713-a0f7-4f27-b03f-46d4fcb625db', domain: 'gov', metadata: { domain_property_id: 11255 } },
      govProperty: { property_id: 11255, address: '5110 South Yale Ave' },
    });
    const match = { status: 'matched', confidence: 0.97, domain: 'lcc', reason: 'canonical_address_lcc',
                    property_id: '658c4713-a0f7-4f27-b03f-46d4fcb625db' };
    const res = await promoteIntakeToDomainListing('i-civic-1', { ...OM }, match, {});
    assert.equal(res.ok, false);
    assert.equal(res.skipped, 'civic_number_mismatch');
    assert.equal(res.property_id, 11255);
    assert.equal(res.property_address, '5110 South Yale Ave');
    assert.equal(domainWrites().length, 0, 'no domain write of any kind');
  });

  it('positive control: same chain with an agreeing civic number proceeds to the listing write', async () => {
    installFetchMock({
      entity: { id: 'e1', domain: 'gov', metadata: { domain_property_id: 777 } },
      govProperty: { property_id: 777, address: '1717 Medical Blvd' },
    });
    const match = { status: 'matched', confidence: 0.97, domain: 'lcc', reason: 'canonical_address_lcc', property_id: 'e1' };
    const res = await promoteIntakeToDomainListing('i-civic-2',
      { document_type: 'om', address: '1717 Medical Blvd', city: 'Findlay', state: 'OH' }, match, {});
    assert.notEqual(res.skipped, 'civic_number_mismatch');
    assert.ok(listingWrites().length >= 1, 'listing write reached');
  });

  it('civicNumbersAgree: disjoint false, range containment true, unparseable null', () => {
    assert.equal(guard.civicNumbersAgree('6120 South Yale Ave', '5110 South Yale Ave'), false);
    assert.equal(guard.civicNumbersAgree('5519 W Hillsborough Ave', '5519-5525 W Hillsborough Ave'), true);
    assert.equal(guard.civicNumbersAgree('One Federal Plaza', '5110 South Yale Ave'), null);
  });
});

describe('(d) a stated vertical is never promoted into the other domain', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('dia-vertical document matched to a gov property → refused, nothing written', async () => {
    installFetchMock({ govProperty: { property_id: 11255, address: '6120 South Yale Ave' } });
    const match = { status: 'matched', confidence: 0.97, domain: 'government', property_id: 11255 };
    const res = await promoteIntakeToDomainListing('i-vert-1', { ...OM }, match,
      { seedData: { source_vertical: 'dia', sf_entity_type: 'Listing__c' } });
    assert.equal(res.skipped, 'vertical_domain_mismatch');
    assert.equal(res.vertical_domain, 'dialysis');
    assert.equal(res.match_domain, 'government');
    assert.equal(domainWrites().length, 0);
  });

  it('the reverse: gov-vertical document matched to a dia property → refused', async () => {
    installFetchMock({ diaProperty: { property_id: 5, address: '6120 South Yale Ave' } });
    const match = { status: 'matched', confidence: 0.97, domain: 'dialysis', property_id: 5 };
    const res = await promoteIntakeToDomainListing('i-vert-2', { ...OM }, match,
      { seedData: { source_vertical: 'gov' } });
    assert.equal(res.skipped, 'vertical_domain_mismatch');
    assert.equal(domainWrites().length, 0);
  });

  it('no stated vertical → the guard has no opinion', () => {
    assert.equal(guard.verticalDomainConflict(null, 'government'), null);
    assert.equal(guard.verticalDomainConflict({ source_vertical: 'dia' }, 'dialysis'), null);
  });

  it('create-property: a null tenant no longer defaults a dia OM to government', () => {
    assert.equal(pickDomainForTenant(null, { source_vertical: 'dia' }), 'dialysis');
    assert.equal(pickDomainForTenant('DaVita', { source_vertical: 'gov' }), 'government');
    assert.equal(pickDomainForTenant(null, null), 'government');
    assert.equal(pickDomainForTenant('DaVita Kidney Care', null), 'dialysis');
  });
});

// ── Wiring (AST spans, never character windows) ─────────────────────────────────────────
function fnBody(file, name) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  let found = null;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if ((node.type === 'FunctionDeclaration') && node.id?.name === name) { found = node; return; }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  assert.ok(found, `${name} not found in ${file}`);
  return src.slice(found.body.start, found.body.end)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('wiring', () => {
  it('callAiExtraction applies the guard WITH the document text before returning the parse', () => {
    const body = fnBody('api/_handlers/intake-extractor.js', 'callAiExtraction');
    assert.match(body, /applySubjectAddressGuard\(\s*parsed\s*,\s*\{\s*text:\s*pdfText/);
  });

  it('runDownstreamPipeline applies the registry guard BEFORE the matcher runs', () => {
    const body = fnBody('api/_handlers/intake-extractor.js', 'runDownstreamPipeline');
    const g = body.indexOf('applySubjectAddressGuard(');
    const m = body.indexOf('matchIntakeToProperty(');
    assert.ok(g > -1 && m > -1 && g < m, 'guard precedes the matcher');
    assert.match(body, /registry\s*=\s*await\s+loadBrokerageOfficeRegistry\(\)/);
  });

  it('promoteIntakeToDomainListing runs the identity guards before any artifact lookup or write', () => {
    const body = fnBody('api/_handlers/intake-promoter.js', 'promoteIntakeToDomainListing');
    const g = body.indexOf('checkPromotionIdentityGuards(');
    const a = body.indexOf('staged_intake_artifacts');
    assert.ok(g > -1 && a > -1 && g < a);
  });
});

// The gov Available / Sales Comps / Leases display mapping moved to one shared function in
// GOV-AVAIL2 (2026-09-23); its behavioural guards live in test/gov-avail2-display.test.mjs.
// The old "Comps keep the raw cells" pin was retired on purpose: GOV-AVAIL2 asked for all three
// tables to read one way.
