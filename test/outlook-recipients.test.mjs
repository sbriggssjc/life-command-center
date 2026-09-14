// Prompt 96 — Outlook display-name capture. Tests that the recipient/sender
// parser preserves display names from Graph-shaped payloads and RFC strings, and
// that the harvest reader binds a name↔email pair from the new metadata fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, parseAddressList, firstNameFor } from '../api/_shared/outlook-recipients.js';
import {
  parseHeaderAddress, normalizeForMatch, isInternalEmail, isGenericInbox,
  looksLikeEmail, normalizeEmail,
} from '../api/_shared/reachability-harvest-planner.js';

test('parseAddress: Graph { emailAddress:{name,address} } shape preserves name', () => {
  assert.deepEqual(
    parseAddress({ emailAddress: { name: 'Jane Roe', address: 'Jane.Roe@Example.com' } }),
    { name: 'Jane Roe', email: 'jane.roe@example.com' });
});

test('parseAddress: plain {name,email} and {name,address} objects', () => {
  assert.deepEqual(parseAddress({ name: 'John Doe', email: 'J@x.com' }), { name: 'John Doe', email: 'j@x.com' });
  assert.deepEqual(parseAddress({ name: 'John Doe', address: 'J@x.com' }), { name: 'John Doe', email: 'j@x.com' });
});

test('parseAddress: RFC strings, bare email, name-only, empty', () => {
  assert.deepEqual(parseAddress('John Doe <j@x.com>'), { name: 'John Doe', email: 'j@x.com' });
  assert.deepEqual(parseAddress('"Doe, John" <J@X.com>'), { name: 'Doe, John', email: 'j@x.com' });
  assert.deepEqual(parseAddress('j@x.com'), { name: null, email: 'j@x.com' });
  assert.deepEqual(parseAddress('Jane Roe'), { name: 'Jane Roe', email: null });
  assert.deepEqual(parseAddress(''), { name: null, email: null });
  assert.deepEqual(parseAddress(null), { name: null, email: null });
});

test('parseAddress: an email masquerading as a name is not a name', () => {
  assert.deepEqual(parseAddress('j@x.com <j@x.com>'), { name: null, email: 'j@x.com' });
});

test('parseAddressList: Graph object array (the mailbox-mirror shape)', () => {
  const graph = [
    { emailAddress: { name: 'Jane Roe', address: 'jane@acme.com' } },
    { emailAddress: { name: 'Bob Smith', address: 'bob@acme.com' } },
  ];
  assert.deepEqual(parseAddressList(graph), [
    { name: 'Jane Roe', email: 'jane@acme.com' },
    { name: 'Bob Smith', email: 'bob@acme.com' },
  ]);
});

test('parseAddressList: semicolon-delimited "Name <email>" string', () => {
  assert.deepEqual(
    parseAddressList('Jane Roe <jane@acme.com>; Bob Smith <bob@acme.com>'),
    [{ name: 'Jane Roe', email: 'jane@acme.com' }, { name: 'Bob Smith', email: 'bob@acme.com' }]);
});

test('parseAddressList: comma-separated bare emails (no display forms)', () => {
  assert.deepEqual(parseAddressList('a@x.com, b@y.com'),
    [{ name: null, email: 'a@x.com' }, { name: null, email: 'b@y.com' }]);
});

test('parseAddressList: a quoted display name with an internal comma is not split', () => {
  assert.deepEqual(parseAddressList('"Doe, John" <john@acme.com>'),
    [{ name: 'Doe, John', email: 'john@acme.com' }]);
});

test('parseAddressList: dedups by email, drops entries with no address', () => {
  assert.deepEqual(
    parseAddressList(['Jane <jane@x.com>', 'jane@x.com', 'No Address Person']),
    [{ name: 'Jane', email: 'jane@x.com' }]);
});

test('parseAddressList: bare-email-only payload yields no names (behavior unchanged)', () => {
  const pairs = parseAddressList('scott@northmarq.com; buyer@fund.com');
  assert.deepEqual(pairs.filter((p) => p.name), []);
});

test('firstNameFor: resolves the display name for a given address', () => {
  const pairs = [{ name: 'Jane Roe', email: 'jane@x.com' }, { name: null, email: 'b@x.com' }];
  assert.equal(firstNameFor(pairs, 'JANE@x.com'), 'Jane Roe');
  assert.equal(firstNameFor(pairs, 'b@x.com'), null);
});

// ---- Reader-side: the harvest index binds a name↔email from the new fields ----
// Mirror the exact structuredPairs logic in admin.js::harvestBuildCommsIndex so a
// regression in either side is caught. A Graph-ingested inbound row now carries
// metadata.from_name + to_names[]; the reader must extract a bindable pair.
function structuredPairsFromMetadata(md) {
  const out = [];
  const fromEmailForName = (typeof md.from === 'string' && md.from) || (typeof md.from_email === 'string' && md.from_email) || null;
  if (typeof md.from_name === 'string' && md.from_name.trim() && fromEmailForName) {
    out.push({ name: md.from_name.trim(), email: fromEmailForName });
  }
  if (Array.isArray(md.to_names)) {
    for (const p of md.to_names) {
      if (p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim() && typeof p.email === 'string' && p.email) {
        out.push({ name: p.name.trim(), email: p.email });
      }
    }
  }
  return out.filter((p) => !isInternalEmail(p.email) && !isGenericInbox(p.email));
}

test('reader: inbound metadata with from_name/to_names yields bindable name pairs', () => {
  const md = {
    direction: 'inbound',
    from: 'broker@brokerage.com',
    from_name: 'Pat Broker',
    to: ['scott@northmarq.com'],
    to_names: [{ name: 'Scott Briggs', email: 'scott@northmarq.com' }, { name: 'Owner Ollie', email: 'ollie@ownerllc.com' }],
  };
  const pairs = structuredPairsFromMetadata(md);
  // Internal (northmarq) recipient dropped; external sender + owner kept.
  assert.deepEqual(pairs, [
    { name: 'Pat Broker', email: 'broker@brokerage.com' },
    { name: 'Owner Ollie', email: 'ollie@ownerllc.com' },
  ]);
  // Each binds a normalized name key the harvest fill arm uses.
  for (const p of pairs) {
    assert.ok(normalizeForMatch(p.name).length >= 4);
    assert.ok(looksLikeEmail(p.email));
    assert.equal(normalizeEmail(p.email), p.email);
  }
});

test('reader: bare-email metadata (no names) yields zero structured pairs', () => {
  const md = { from: 'broker@brokerage.com', to: ['owner@ownerllc.com'] };
  assert.deepEqual(structuredPairsFromMetadata(md), []);
});

test('reader: mailbox-mirror shape (from_name + to_names) also binds', () => {
  const md = {
    from_email: 'seller@sellerco.com',
    from_name: 'Sam Seller',
    to_emails: ['scott@northmarq.com'],
    to_names: [{ name: 'Buyer Barb', email: 'barb@buyer.com' }],
  };
  const pairs = structuredPairsFromMetadata(md);
  assert.deepEqual(pairs, [
    { name: 'Sam Seller', email: 'seller@sellerco.com' },
    { name: 'Buyer Barb', email: 'barb@buyer.com' },
  ]);
});

// Cross-check: the new parser agrees with the harvest planner's parseHeaderAddress
// on the shared string forms (so the two sides can't drift on header parsing).
test('parseAddress agrees with planner parseHeaderAddress on string forms', () => {
  for (const s of ['John Doe <j@x.com>', '"Doe, John" <J@X.com>', 'j@x.com', 'Jane Roe', '']) {
    assert.deepEqual(parseAddress(s), parseHeaderAddress(s), `mismatch on: ${s}`);
  }
});
