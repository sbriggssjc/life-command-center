import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// costar.js is a content-script IIFE that touches window/chrome/document at
// load, so it can't be imported in Node — mirrors the extraction technique
// already used in test/costar-street-regex.test.js. This guards ADDR1: the
// Contacts tab's "Sales Company"/"Sales Contacts"/"Listing Contacts"/
// "Property Manager" section headers must be recognized by
// FOREIGN_PARTY_HEADER_RE (findAddressInLines' guard) or the address-finder
// captures the brokerage/company's own office street as the property's.
const src = readFileSync(
  fileURLToPath(new URL('../extension/content/costar.js', import.meta.url)),
  'utf8',
);

function extractRegex(name, text) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\/(.+?)\\/([a-z]*);`);
  const m = re.exec(text);
  if (!m) throw new Error(`could not find ${name} literal in costar.js`);
  return new RegExp(m[1], m[2]);
}

describe('ADDR1 costar.js FOREIGN_PARTY_HEADER_RE', () => {
  const rx = extractRegex('FOREIGN_PARTY_HEADER_RE', src);

  // The ADDR1 live-defect headers — the redesigned Contacts tab's party
  // designations (SECTION_ROLE_MAP labels), which findAddressInLines must
  // treat as "not the subject property" exactly like the pre-existing
  // True Buyer / True Owner / Listing Broker headers.
  const SHOULD_MATCH = [
    'Sales Company',
    'Sales Companies',
    'Sales Contact',
    'Sales Contacts',
    'Listing Contact',
    'Listing Contacts',
    'Property Manager',
    'Property Management',
    // CoStar concatenates the label with its value in two-column panels
    // ("Sales CompanySRS Capital Markets") — no trailing \b, so this must
    // still match.
    'Sales CompanySRS Capital Markets',
    // Pre-existing coverage must not regress.
    'True Buyer',
    'True Owner',
    'Recorded Owner',
    'Current Owner',
    'Listing Broker',
    'Lender',
  ];

  for (const label of SHOULD_MATCH) {
    it(`matches "${label}"`, () => {
      assert.ok(rx.test(label), `${rx} should match "${label}"`);
    });
  }

  // A genuine subject-property street/city line must never be swallowed by
  // this guard, or the real address would be skipped too.
  const SHOULD_NOT_MATCH = [
    '680 Newport Center Dr, Suite 300',
    'Wisconsin Dells, WI 53965',
    'Sale Notes',
    'Documents',
  ];

  for (const line of SHOULD_NOT_MATCH) {
    it(`does not match "${line}"`, () => {
      assert.ok(!rx.test(line), `${rx} should NOT match "${line}"`);
    });
  }
});
