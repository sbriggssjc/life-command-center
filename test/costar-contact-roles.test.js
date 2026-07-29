import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// costar.js is a content-script IIFE that touches window/chrome/document at
// load, so it can't be imported in Node. Instead, read the SECTION_ROLE_MAP
// literal straight out of the source and exercise the header→role mapping.
// This guards the CoStar "Contacts" tab redesign (2026-07-29) that renamed the
// broker/owner section headers ("Sales Company", "True Owner", "Property
// Manager") — without recognizing them the DOM extractor dropped every broker
// and owner contact.
const src = readFileSync(
  fileURLToPath(new URL('../extension/content/costar.js', import.meta.url)),
  'utf8',
);

// Pull the `const SECTION_ROLE_MAP = [ ... ];` array literal and rebuild the
// [regex, role] pairs from `[/re/i, 'role']` entries.
function extractSectionRoleMap(text) {
  const block = text.match(/const\s+SECTION_ROLE_MAP\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, 'SECTION_ROLE_MAP literal not found in costar.js');
  const pairs = [];
  const entryRe = /\[\s*\/(.+?)\/([a-z]*)\s*,\s*'([^']+)'\s*\]/g;
  let m;
  while ((m = entryRe.exec(block[1])) !== null) {
    pairs.push([new RegExp(m[1], m[2]), m[3]]);
  }
  return pairs;
}

function roleFromHeader(pairs, headerText) {
  const t = (headerText || '').trim();
  for (const [re, role] of pairs) {
    if (re.test(t)) return role;
  }
  return null;
}

describe('costar.js SECTION_ROLE_MAP — For Sale Contacts tab headers', () => {
  const pairs = extractSectionRoleMap(src);

  it('parses the SECTION_ROLE_MAP entries', () => {
    assert.ok(pairs.length >= 12, `expected >=12 role entries, got ${pairs.length}`);
  });

  const EXPECT = [
    // New (redesigned For Sale Contacts tab)
    ['Sales Company', 'listing_broker'],
    ['Sales Companies', 'listing_broker'],
    ['Sales Contact', 'listing_broker'],
    ['Sales Contacts', 'listing_broker'],
    ['Listing Contacts', 'listing_broker'],
    ['True Owner', 'owner'],
    ['Property Manager', 'property_manager'],
    ['Property Management', 'property_manager'],
    // Legacy headers still resolve
    ['Listing Broker', 'listing_broker'],
    ['Buyer Broker', 'buyer_broker'],
    ['Recorded Owner', 'owner'],
    ['Current Owner', 'owner'],
    ['True Buyer', 'true_buyer_contact'],
    ['True Seller', 'true_seller_contact'],
  ];
  for (const [header, role] of EXPECT) {
    it(`maps "${header}" → ${role}`, () => {
      assert.equal(roleFromHeader(pairs, header), role);
    });
  }

  const SHOULD_NOT_MATCH = [
    'Sales History',    // a prior-sales section, not a broker firm
    'Sale Notes',
    'Tenant',
    'Sale Highlights',
  ];
  for (const header of SHOULD_NOT_MATCH) {
    it(`does not map "${header}" to a contact role`, () => {
      assert.equal(roleFromHeader(pairs, header), null);
    });
  }
});
