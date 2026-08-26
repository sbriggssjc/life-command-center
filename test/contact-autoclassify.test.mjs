// ============================================================================
// autoClassify — a consumer email domain is NOT evidence that a contact is personal.
//
// The defect (measured live 2026-08-26): classification came from the email DOMAIN
// ALONE for every source reaching the fall-through (outlook/calendar/manual) and
// inside the `iphone` branch. In CRE that is wrong at scale —
//   • 2,468 of 6,553 Salesforce campaign members with an email (38%) are on a consumer domain
//   • 406 resolved OWNERS' active contacts are on a consumer domain
// including principals on Scott's own `GSA Buyer` campaign: Lee Elman <lee.eii@me.com>
// and James Brooke <jamesbrooke.office@icloud.com>.
//
// Same trap as P124, where "exclude consumer-domain recipients" looked obviously right
// and would have deleted the best BD exemplars from the voice corpus.
//
// These tests pin BOTH directions: business evidence must win, AND the domain tiebreak
// must survive for contacts we genuinely know nothing about.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoClassify, pickBestEmail } from '../api/_handlers/contacts-handler.js';

// ============================================================================
// pickBestEmail — the FIRST email is often the WRONG one.
//
// Grounded in Scott's real Outlook contacts (probe run 2026-08-26):
//   Sarah Martin   primary = idigmusic27@gmail.com      (personal), work address 2nd
//   Ken Hedrick    primary = khedrick@stanjohnsonco.com (PRIOR firm), northmarq 3rd
//   Jerry Hopkins  primary = jhopkins@northmarq.com     (correct)
// Email is the Tier-0 identity key, so `emailAddresses[0]` would file people under a
// personal address or a firm they have left, and every later match inherits the error.
// ============================================================================

test('pickBestEmail skips a personal primary for the work address', () => {
  const r = pickBestEmail(
    [{ name: 'idigmusic27@gmail.com', address: 'idigmusic27@gmail.com' },
     { name: 'Sarah Martin', address: 'smartin@NorthMarq.com' }], null);
  assert.equal(r.email, 'smartin@NorthMarq.com');
  assert.equal(r.basis, 'first_business_domain');
  assert.deepEqual(r.aliases, ['idigmusic27@gmail.com'], 'the personal address is KEPT, not dropped');
});

test('pickBestEmail keeps the full employment history as aliases', () => {
  const r = pickBestEmail([{ address: 'khedrick@stanjohnsonco.com' },
                           { address: 'khedrick20200306@stanjohnsonco.com' },
                           { address: 'khedrick@northmarq.com' }], null);
  assert.equal(r.email, 'khedrick@stanjohnsonco.com');
  assert.equal(r.aliases.length, 2, 'both other addresses survive — that IS the job history');
  assert.ok(r.aliases.includes('khedrick@northmarq.com'));
});

test('pickBestEmail falls back to the first when every domain is consumer', () => {
  const r = pickBestEmail([{ address: 'gsb3212015@icloud.com' }], null);
  assert.equal(r.email, 'gsb3212015@icloud.com');
  assert.equal(r.basis, 'all_consumer_domains');
  assert.deepEqual(r.aliases, []);
});

test('pickBestEmail handles the degenerate inputs the connector actually emits', () => {
  assert.equal(pickBestEmail(null, 'x@northmarq.com').email, 'x@northmarq.com');
  assert.equal(pickBestEmail([], 'x@gmail.com').email, 'x@gmail.com');
  assert.equal(pickBestEmail(undefined, undefined).email, null);
  // ⚠️ `name` is frequently a DISPLAY name, not an address — it must not be mistaken for one.
  assert.equal(pickBestEmail([{ name: 'Sarah Martin' }], 's@northmarq.com').email, 's@northmarq.com');
  // De-duplication, case-insensitively.
  const dup = pickBestEmail([{ address: 'a@x.com' }, { address: 'A@X.com' }], null);
  assert.equal(dup.aliases.length, 0);
});

test('business evidence outranks a consumer email domain', () => {
  // The live rows that motivated the fix.
  assert.equal(autoClassify('outlook', 'lee.eii@me.com',
    { company_name: 'Elman Investors Inc' }), 'business',
    'a GSA Buyer principal on me.com is a business contact');
  assert.equal(autoClassify('outlook', 'jamesbrooke.office@icloud.com',
    { title: 'Principal' }), 'business',
    'a title alone is sufficient business evidence');
  assert.equal(autoClassify('outlook', 'thomaspbohlinger@gmail.com',
    { company_name: 'Easterly' }), 'business');
});

test('the domain tiebreak still applies when there is NO evidence', () => {
  // ⚠️ The fix must not make everything business — that would be the opposite defect.
  assert.equal(autoClassify('outlook', 'someone@gmail.com', {}), 'personal');
  assert.equal(autoClassify('outlook', 'someone@gmail.com', undefined), 'personal');
  assert.equal(autoClassify('outlook', 'apulliam@easterlyreit.com', {}), 'business',
    'a corporate domain is still business without evidence');
});

test('empty / whitespace fields are NOT business evidence', () => {
  assert.equal(autoClassify('outlook', 'x@gmail.com', { company_name: '   ' }), 'personal');
  assert.equal(autoClassify('outlook', 'x@gmail.com', { title: '' }), 'personal');
  assert.equal(autoClassify('outlook', 'x@gmail.com', { title: null, company_name: null }), 'personal');
});

test('the iphone branch carries the same defect and the same fix', () => {
  assert.equal(autoClassify('iphone', 'x@me.com', { title: 'Owner' }), 'business');
  assert.equal(autoClassify('iphone', 'x@me.com', {}), 'personal',
    'unchanged when there is no evidence');
});

test('sources with an explicit rule are deliberately unchanged', () => {
  // icloud defaults personal ON PURPOSE — evidence does not override it.
  assert.equal(autoClassify('icloud', 'x@icloud.com', { title: 'CEO' }), 'personal');
  // These already returned business; evidence is irrelevant.
  for (const s of ['salesforce', 'webex', 'teams', 'teams_call', 'iphone_call']) {
    assert.equal(autoClassify(s, 'x@gmail.com', {}), 'business', `${s} stays business`);
  }
});

test('outlook_gal (company directory) is business by definition', () => {
  // ⚠️ A corporate address book is business data — the consumer-domain tiebreak
  // must never apply to it, with or without evidence.
  assert.equal(autoClassify('outlook_gal', 'someone@gmail.com', {}), 'business');
  assert.equal(autoClassify('outlook_gal', 'someone@me.com', undefined), 'business');
  assert.equal(autoClassify('outlook_gal', null, {}), 'business');
  // And it must stay DISTINCT from `outlook` — the two populations carry different
  // trust (Scott's own book vs the firm's directory) and are separated in field_sources.
  assert.notEqual('outlook_gal', 'outlook');
});

test('the legacy 2-arg caller is unaffected', () => {
  // contacts-handler.js:1718 calls autoClassify('calendar', email) with no evidence.
  assert.equal(autoClassify('calendar', 'x@gmail.com'), 'personal');
  assert.equal(autoClassify('calendar', 'x@northmarq.com'), 'business');
});
