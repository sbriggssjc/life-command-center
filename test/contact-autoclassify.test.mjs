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
import { autoClassify } from '../api/_handlers/contacts-handler.js';

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
