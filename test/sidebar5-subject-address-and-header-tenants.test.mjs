// SIDEBAR5 (2026-09-23) — CoStar capture accuracy.
//
// Scott saved CoStar #1014478 ("2600 Central Fwy N - Wichita Falls Shopping
// Center") from its Contacts tab. The capture recorded the Primary Leasing
// Company's office ("4005 Call Field Rd, Suite 100") as the property and minted
// gov property 41083 there. Two compounding defects in extension/content/costar.js:
//   1. "Fwy" was not a street type, so the real header failed parseAddress in the
//      <h1> AND in document.title;
//   2. the body-wide findAddressInLines walk ran BEFORE document.title and did not
//      know the "Primary Leasing Company" section, so it walked into it.
// Plus the same capture sent "Office/Ret Avail" / "Total Avail" as tenants
// (LEASEJUNK1's extension residue).
//
// These tests run the REAL costar.js functions (lifted by AST, not by a character
// window) against the real extension/content/_subject-address.js, and the real
// server guard. Each block carries a positive control: a mutation that must turn
// it red.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import * as acorn from 'acorn';

import { OM_TABLE_HEADER_TENANTS, normalizeHeaderCandidate, upsertDomainProperty } from '../api/_handlers/sidebar-pipeline.js';
import { captureTitleStreetMismatch, titleStreet } from '../api/_shared/intake-address-guard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const COSTAR_SRC = readFileSync(join(EXT, 'content/costar.js'), 'utf8');
const SA_SRC = readFileSync(join(EXT, 'content/_subject-address.js'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const BACKGROUND_SRC = readFileSync(join(EXT, 'background.js'), 'utf8');

// ── Lift the address functions out of costar.js's IIFE by name ─────────────
const COSTAR_NAMES = [
  'stripListingStatusPrefix', 'DRIVE_TIME_RE', 'parseAddress',
  'FOREIGN_ADDRESS_LABEL_RE', 'FOREIGN_PARTY_HEADER_RE', 'isInsideForeignAddressSection',
  'findAddressInLines',
];
function liftCostar(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
  const found = new Map();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && COSTAR_NAMES.includes(node.id?.name)) {
      found.set(node.id.name, src.slice(node.start, node.end));
      return;
    }
    if (node.type === 'VariableDeclaration' && node.declarations.length === 1
        && COSTAR_NAMES.includes(node.declarations[0].id?.name)) {
      found.set(node.declarations[0].id.name, src.slice(node.start, node.end));
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  for (const n of COSTAR_NAMES) assert.ok(found.has(n), `costar.js must define ${n}`);
  return COSTAR_NAMES.map((n) => found.get(n)).join('\n');
}

function load({ costarSrc = COSTAR_SRC, saSrc = SA_SRC } = {}) {
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(saSrc, ctx);
  vm.runInContext(liftCostar(costarSrc) + '\nthis.__c = { parseAddress, findAddressInLines };', ctx);
  return { SA: ctx.__lccSubjectAddress, parse: ctx.__c.parseAddress, findInLines: ctx.__c.findAddressInLines };
}

// The Contacts tab of CoStar #1014478, as innerText lines (abridged, same shape).
const TITLE = 'Contacts | 2600 Central Fwy N - Wichita Falls Shopping Center';
const HEADER_LINE = '2600 Central Fwy N - Wichita Falls Shopping Center';
const CONTACTS_TAB_LINES = [
  'Properties', 'Search', HEADER_LINE, 'Wichita Falls, TX 76306',
  'Storefront Retail', '22,130 SF GLA', 'Built 2001',
  'Summary', 'Contacts', 'Tenants', 'Sale', 'Public Record',
  'Primary Leasing Company', 'Truity Capital', '4005 Call Field Rd, Suite 100',
  'Wichita Falls, TX 76308', '(940) 555-0100',
  'Recorded Owner', 'Central Fwy Holdings LLC', '1 N Wacker Dr, Suite 4000', 'Chicago, IL 60606',
];

describe('SIDEBAR5 (1a): the subject address comes from the header, never a contact block', () => {
  it('the #1014478 Contacts tab resolves to the header address, not the leasing company office', () => {
    const { SA, parse, findInLines } = load();
    const r = SA.resolveSubjectAddress({ headingTexts: [], title: TITLE, lines: CONTACTS_TAB_LINES, parse, findInLines });
    assert.equal(r.address, '2600 Central Fwy N');
    assert.equal(r.source, 'title');
    assert.doesNotMatch(String(r.address), /4005|Call Field/);
  });

  it('with the header in an <h1>, the heading wins', () => {
    const { SA, parse, findInLines } = load();
    const r = SA.resolveSubjectAddress({ headingTexts: [HEADER_LINE], title: 'CoStar', lines: CONTACTS_TAB_LINES, parse, findInLines });
    assert.deepEqual({ a: r.address, s: r.source }, { a: '2600 Central Fwy N', s: 'heading' });
  });

  it('with no heading and no title street, the header region lines still find it', () => {
    const { SA, parse, findInLines } = load();
    const r = SA.resolveSubjectAddress({ headingTexts: [], title: 'CoStar', lines: CONTACTS_TAB_LINES, parse, findInLines });
    assert.equal(r.address, '2600 Central Fwy N');
    assert.equal(r.source, 'header_lines');
  });

  it('when the header never rendered, the result is header_not_found — never the contact address', () => {
    const { SA, parse, findInLines } = load();
    const noHeader = CONTACTS_TAB_LINES.filter((l) => l !== HEADER_LINE);
    const r = SA.resolveSubjectAddress({ headingTexts: [], title: 'CoStar', lines: noHeader, parse, findInLines });
    assert.equal(r.address, null);
    assert.equal(r.status, 'header_not_found');
  });

  it('positive control: the pre-SIDEBAR5 body-wide walk DOES return the leasing company office', () => {
    // This is the defect: findAddressInLines over every line of the tab.
    const { findInLines } = load();
    const noHeader = CONTACTS_TAB_LINES.filter((l) => l !== HEADER_LINE);
    assert.match(String(findInLines(noHeader)), /^4005 Call Field Rd/);
  });

  it('positive control: without "Fwy" as a street type the header cannot parse at all', () => {
    const mutated = COSTAR_SRC.replace('hwy|highway|fwy|freeway|frwy|', 'hwy|highway|');
    assert.notEqual(mutated, COSTAR_SRC, 'mutation must apply');
    const { parse } = load({ costarSrc: mutated });
    assert.equal(parse(TITLE), null);
    assert.equal(load().parse(TITLE), '2600 Central Fwy N');
  });

  it('positive control: without the contact-section stop, the header region reaches the leasing block', () => {
    const mutatedSa = SA_SRC.replace('if (isContactSectionHeader(line)) break;', '');
    assert.notEqual(mutatedSa, SA_SRC, 'mutation must apply');
    const { SA, parse, findInLines } = load({ saSrc: mutatedSa });
    const noHeader = CONTACTS_TAB_LINES.filter((l) => l !== HEADER_LINE);
    const r = SA.resolveSubjectAddress({ headingTexts: [], title: 'CoStar', lines: noHeader, parse, findInLines });
    assert.match(String(r.address), /^4005 Call Field Rd/);
  });

  it('the contact-section list covers the named blocks and not the header, the tab strip, or bare labels', () => {
    const { SA } = load();
    for (const h of ['Primary Leasing Company', 'Primary Leasing CompanyTruity Capital', 'Leasing Company',
      'Leasing Contacts', 'Recorded Owner', 'True Owner', 'Architect', 'Property Manager', 'Sales Company',
      'Listing Broker', 'Lender', 'About the Architect']) {
      assert.ok(SA.isContactSectionHeader(h), `should stop at "${h}"`);
    }
    for (const l of [HEADER_LINE, 'Wichita Falls, TX 76306', 'Contacts', 'Summary', 'Owner', 'Tenants',
      '4005 Call Field Rd, Suite 100']) {
      assert.ok(!SA.isContactSectionHeader(l), `must not stop at "${l}"`);
    }
  });

  it('costar.js resolves through the guard module and records where the address came from', () => {
    const body = COSTAR_SRC.replace(/\/\/[^\n]*/g, '');
    assert.match(body, /SA\.resolveSubjectAddress\(/);
    assert.match(body, /_subject_address_source:\s*subject\.source/);
    assert.match(body, /_subject_address_status:\s*subject\.status/);
    assert.match(body, /_page_title:\s*document\.title/);
    // The snapshot no longer falls back to parseAddress(document.title) after
    // the resolver said no.
    assert.doesNotMatch(body, /address:\s*address\s*\|\|\s*parseAddress\(document\.title\)/);
  });

  it('the guard module loads before costar.js — in the manifest and in the injection backstop', () => {
    const cs = MANIFEST.content_scripts.find((c) => c.js.includes('content/costar.js'));
    assert.ok(cs.js.indexOf('content/_subject-address.js') > -1);
    assert.ok(cs.js.indexOf('content/_subject-address.js') < cs.js.indexOf('content/costar.js'));
    const inj = BACKGROUND_SRC.match(/files:\s*\[[^\]]*'content\/costar\.js'\]/);
    assert.ok(inj && /'content\/_subject-address\.js',\s*'content\/costar\.js'/.test(inj[0]));
  });

  it('a tab that did not find its header cannot overwrite a header address another tab resolved', () => {
    const body = BACKGROUND_SRC.replace(/\/\/[^\n]*/g, '');
    assert.match(body, /const subjectSide = incoming\.address \? incoming : \(existing\.address \? existing : incoming\);/);
    assert.match(body, /merged\._subject_address_status = subjectSide\._subject_address_status/);
  });
});

describe('SIDEBAR5 (1b): server refuses a capture whose address differs from its page title', () => {
  it('titleStreet reads the street out of CoStar title shapes, and ignores non-streets', () => {
    assert.equal(titleStreet(TITLE), '2600 Central Fwy N');
    assert.equal(titleStreet('Sale Comps | Condo Sold: 326 Del Prado Blvd, 1st Floor - 101'), '326 Del Prado Blvd, 1st Floor');
    assert.equal(titleStreet('1 of 2,000 Records'), null);
    assert.equal(titleStreet('9 min drive'), null);
    assert.equal(titleStreet('Portfolio | 40 Retail Properties Sold'), null);
    assert.equal(titleStreet('CoStar'), null);
  });

  it('the #1014478 capture is a mismatch; the correct capture and legacy captures are not', () => {
    const m = captureTitleStreetMismatch('4005 Call Field Rd, Suite 100, Wichita Falls, TX 76308', TITLE);
    assert.equal(m.reason, 'civic_number_differs');
    assert.equal(m.title_street, '2600 Central Fwy N');
    assert.equal(captureTitleStreetMismatch('2600 Central Fwy N', TITLE), null);
    assert.equal(captureTitleStreetMismatch('2600 Central E Fwy', TITLE), null, 'directional placement is not a different street');
    assert.equal(captureTitleStreetMismatch('215-225 S Allison Ave', 'Properties | 215 S Allison Ave'), null);
    assert.equal(captureTitleStreetMismatch('4005 Call Field Rd', null), null, 'no title = no opinion');
    assert.equal(captureTitleStreetMismatch('2600 Oak St', TITLE).reason, 'street_name_differs');
  });

  it('upsertDomainProperty refuses the mismatch before any lookup or mint, and lets the right address through', async () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => { warns.push(a.join(' ')); };
    try {
      const out = await upsertDomainProperty('government',
        { address: '4005 Call Field Rd, Suite 100', city: 'Wichita Falls', state: 'TX' },
        { _page_title: TITLE });
      assert.equal(out, null);
      assert.ok(warns.some((w) => /Refusing address "4005 Call Field Rd, Suite 100" — page title names "2600 Central Fwy N"/.test(w)));

      warns.length = 0;
      await upsertDomainProperty('government',
        { address: '2600 Central Fwy N', city: 'Wichita Falls', state: 'TX' },
        { _page_title: TITLE }).catch(() => null);
      assert.ok(!warns.some((w) => /page title names/.test(w)), 'the header address must pass the title check');
    } finally {
      console.warn = orig;
    }
  });
});

describe('SIDEBAR5 (3) / LEASEJUNK1 residue: panel headers never leave the extension as tenants', () => {
  it('the extension header list is byte-for-byte the server list (drift guard)', () => {
    const { SA } = load();
    assert.deepEqual([...SA.COSTAR_HEADER_TENANTS], [...OM_TABLE_HEADER_TENANTS]);
  });

  it('the extension normalizer agrees with the server normalizer', () => {
    const { SA } = load();
    for (const s of ['  Office/Ret Avail ', 'TOTAL AVAIL:', 'Avail.  Spaces.', 'GameStop', '', null]) {
      assert.equal(SA.normalizeHeaderCandidate(s), normalizeHeaderCandidate(s), JSON.stringify(s));
    }
  });

  it('the #1014478 tenant list loses exactly its two header rows', () => {
    const { SA } = load();
    const tenants = ['Wichita Falls VA Clinic', 'T-Mobile', 'Office/Ret Avail', 'Total Avail', 'GameStop', 'H&R Block', 'Shopping Center Dialysis LLC']
      .map((name) => ({ name }));
    assert.deepEqual(SA.filterHeaderTenants(tenants).map((t) => t.name),
      ['Wichita Falls VA Clinic', 'T-Mobile', 'GameStop', 'H&R Block', 'Shopping Center Dialysis LLC']);
  });

  it('positive control: a list that drifted from the server fails the drift guard', () => {
    const mutated = SA_SRC.replace("'shopping center', 'strip center', 'total avail',", "'shopping center', 'strip center',");
    assert.notEqual(mutated, SA_SRC);
    const { SA } = load({ saSrc: mutated });
    assert.notDeepEqual([...SA.COSTAR_HEADER_TENANTS], [...OM_TABLE_HEADER_TENANTS]);
    assert.equal(SA.isHeaderTenantName('Total Avail'), false);
  });

  it('costar.js filters the snapshot tenants and background.js filters merged tenants', () => {
    assert.match(COSTAR_SRC, /tenants:\s*SA \? SA\.filterHeaderTenants\(accumulated\.tenants\) : accumulated\.tenants/);
    assert.match(BACKGROUND_SRC, /merged\.tenants = SA\.filterHeaderTenants\(merged\.tenants\)/);
    assert.match(BACKGROUND_SRC, /import '\.\/content\/_subject-address\.js';/);
  });
});
