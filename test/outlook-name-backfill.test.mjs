// Prompt 101 — Outlook display-name BACKFILL accelerator. Tests the pure patch
// builder: join correctness, fill-blanks (existing name untouched), parser reuse,
// external/generic gating, to_names reconstruction, reversal, and idempotence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNameBackfillPatch, reverseNameBackfillPatch,
  senderEmailFromMetadata, recipientEmailsFromMetadata, isHarvestableParty,
} from '../api/_shared/outlook-name-backfill.js';

const names = new Map([
  ['jfahner@hanleyinvestment.com', 'John Fahner'],
  ['dan@jswestern.com', 'Dan Western'],
  ['philip.sharrow@scopecre.com', 'Philip Sharrow'],
]);
const STAMP = { batch: 'nb_test', at: '2026-08-13T00:00:00Z' };

test('senderEmailFromMetadata: from_email and from-string shapes', () => {
  assert.equal(senderEmailFromMetadata({ from_email: 'JFahner@Hanleyinvestment.com' }), 'jfahner@hanleyinvestment.com');
  assert.equal(senderEmailFromMetadata({ from: 'John Fahner <jfahner@hanleyinvestment.com>' }), 'jfahner@hanleyinvestment.com');
  assert.equal(senderEmailFromMetadata({ from: 'dan@jswestern.com' }), 'dan@jswestern.com');
  assert.equal(senderEmailFromMetadata({}), null);
});

test('recipientEmailsFromMetadata: dedups to/cc, real-address-only', () => {
  assert.deepEqual(
    recipientEmailsFromMetadata({ to_emails: ['Dan@jswestern.com', 'not-an-email'], cc_emails: ['dan@jswestern.com', 'philip.sharrow@scopecre.com'] }),
    ['dan@jswestern.com', 'philip.sharrow@scopecre.com']);
});

test('isHarvestableParty: external ok, internal/generic dropped', () => {
  assert.equal(isHarvestableParty('jfahner@hanleyinvestment.com'), true);
  assert.equal(isHarvestableParty('scott@northmarq.com'), false); // internal
  assert.equal(isHarvestableParty('info@scopecre.com'), false);   // generic inbox
  assert.equal(isHarvestableParty('not-an-email'), false);
});

test('buildNameBackfillPatch: fills from_name from unified_contacts, one code path', () => {
  const out = buildNameBackfillPatch({ from_email: 'jfahner@hanleyinvestment.com' }, names, STAMP);
  assert.equal(out.filled_from_name, true);
  assert.equal(out.metadata.from_name, 'John Fahner');
  assert.deepEqual(out.metadata.name_backfill, { source: 'unified_contacts', batch: 'nb_test', at: STAMP.at, from: true, to: 0 });
});

test('buildNameBackfillPatch: FILL-BLANKS — existing from_name is never overwritten', () => {
  const out = buildNameBackfillPatch({ from_email: 'jfahner@hanleyinvestment.com', from_name: 'Preexisting Name' }, names, STAMP);
  assert.equal(out, null); // nothing to do → skip the write entirely
});

test('buildNameBackfillPatch: reconstructs to_names[] from to/cc emails', () => {
  const out = buildNameBackfillPatch(
    { from_email: 'scott@northmarq.com', to_emails: ['dan@jswestern.com'], cc_emails: ['philip.sharrow@scopecre.com', 'unknown@nowhere.com'] },
    names, STAMP);
  assert.equal(out.filled_from_name, false); // internal sender skipped
  assert.equal(out.filled_to_names, 2);
  assert.deepEqual(out.metadata.to_names, [
    { name: 'Dan Western', email: 'dan@jswestern.com' },
    { name: 'Philip Sharrow', email: 'philip.sharrow@scopecre.com' },
  ]);
});

test('buildNameBackfillPatch: existing to_names present → not clobbered', () => {
  const out = buildNameBackfillPatch(
    { to_emails: ['dan@jswestern.com'], to_names: [{ name: 'Curated', email: 'dan@jswestern.com' }] },
    names, STAMP);
  assert.equal(out, null);
});

test('buildNameBackfillPatch: no name known → null (never fabricate)', () => {
  assert.equal(buildNameBackfillPatch({ from_email: 'stranger@elsewhere.com' }, names, STAMP), null);
});

test('buildNameBackfillPatch: generic/internal sender yields no from fill', () => {
  assert.equal(buildNameBackfillPatch({ from_email: 'scott@northmarq.com' }, new Map([['scott@northmarq.com', 'Scott']]), STAMP), null);
});

test('function-form lookup works (store-agnostic)', () => {
  const out = buildNameBackfillPatch({ from_email: 'dan@jswestern.com' }, (e) => (e === 'dan@jswestern.com' ? 'Dan Western' : null), STAMP);
  assert.equal(out.metadata.from_name, 'Dan Western');
});

test('reverseNameBackfillPatch: strips only what the batch filled', () => {
  const built = buildNameBackfillPatch(
    { from_email: 'jfahner@hanleyinvestment.com', to_emails: ['dan@jswestern.com'], subject: 'keep me' },
    names, STAMP).metadata;
  const rev = reverseNameBackfillPatch(built, 'nb_test');
  assert.equal(rev.metadata.from_name, undefined);
  assert.equal(rev.metadata.to_names, undefined);
  assert.equal(rev.metadata.name_backfill, undefined);
  assert.equal(rev.metadata.subject, 'keep me');
});

test('reverseNameBackfillPatch: wrong/absent batch is a no-op', () => {
  const built = buildNameBackfillPatch({ from_email: 'dan@jswestern.com' }, names, STAMP).metadata;
  assert.equal(reverseNameBackfillPatch(built, 'other_batch'), null);
  assert.equal(reverseNameBackfillPatch({ from_name: 'organic' }, 'nb_test'), null);
});

test('idempotence: re-running over a backfilled row is a no-op', () => {
  const built = buildNameBackfillPatch({ from_email: 'dan@jswestern.com' }, names, STAMP).metadata;
  assert.equal(buildNameBackfillPatch(built, names, STAMP), null);
});
