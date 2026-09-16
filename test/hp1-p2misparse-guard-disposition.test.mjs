// HP1-P2misparse — the contact guard disposes its blocks instead of notifying
// the broker about every one of them.
//
// The load-bearing invariant every test here defends: a DISPOSITION change is
// never a GUARD change. Nothing in misparse-disposition.js may cause a
// previously-blocked candidate to mint, except the single, strictly-matched
// fan-out owner in §2 — and that one is proven to refuse ties, organizations
// and page chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isNonContactChrome,
  nonContactChromeNames,
  normalizeChromeKey,
  reviewDedupeKey,
  partitionReviewForNotification,
  localPartMatchRule,
  recoverFanoutOwner,
  recoverTeamRosterBatch,
  isGenericMailboxLocalPart,
} from '../api/_shared/misparse-disposition.js';
import { planContactMinting, tmMisparseReason } from '../api/_shared/tm-misparse.js';

const item = (name, reason, email) => ({ reason, email, contact: { name, email } });
const ORG_RE = /\b(LLC|Inc\.?|Properties|Partners|Consulting|Investments?|Services|REIT|Group|Company|Companies|NAI|DESCO)\b/i;
const isOrganization = (c) => ORG_RE.test(c.name) || c.name.split(/\s+/).length > 5;

// ── Class A: the suppression list ──────────────────────────────────────────

test('class A: every live-observed CoStar chrome name is suppressed', () => {
  // Verbatim from the live population, 2026-09-12 (LCC Opps).
  for (const n of ['View Less', 'view less', '  View   Less ', 'Demographics',
    'Public REIT', 'Equity Funds', 'CoStar Property Contact']) {
    assert.equal(isNonContactChrome(n), true, n);
  }
});

test('class A is EXACT, never a substring — real names and firms survive', () => {
  // P158a: a `contains` rule swallows real parties. Each of these CONTAINS a
  // chrome token and must not be suppressed.
  for (const n of ['Demographics Research Group LLC', 'Per SFerrara',
    'Equity Funds Advisors LP', 'James D. Collins', 'Marcus & Millichap',
    'Brian Lane', 'Jim Street', '']) {
    assert.equal(isNonContactChrome(n), false, n);
  }
});

test('class A list is non-empty and mirrors the migration verbatim', () => {
  const names = nonContactChromeNames();
  assert.ok(names.length >= 10);
  // The migration's chrome VALUES list is the SQL half of the same rule; a
  // change to one without the other is the normaliser drift this repo pays for.
  const sql = readFileSync(
    new URL('../supabase/migrations/20261102120000_lcc_hp1p2misparse_dispose_guard_notifications.sql', import.meta.url),
    'utf8',
  );
  for (const n of names) assert.ok(sql.includes(`('${n}')`), `migration is missing chrome entry: ${n}`);
});

test('normalizeChromeKey collapses whitespace and case', () => {
  assert.equal(normalizeChromeKey('  View\n Less '), 'view less');
});

// ── Dedupe: once per (property, name, reason) ──────────────────────────────

test('dedupe key is (property, name, reason) and is case/space insensitive', () => {
  assert.equal(reviewDedupeKey('p1', 'Marcus & Millichap', 'person_junk_name'),
    reviewDedupeKey('p1', ' marcus &  millichap ', 'person_junk_name'));
  assert.notEqual(reviewDedupeKey('p1', 'X', 'person_junk_name'),
    reviewDedupeKey('p2', 'X', 'person_junk_name'));
  assert.notEqual(reviewDedupeKey('p1', 'X', 'person_junk_name'),
    reviewDedupeKey('p1', 'X', 'email_fanout'));
});

test('the same block is notified once, then only counted', () => {
  const batch = [item('Marcus & Millichap', 'person_junk_name'), item('View Less', 'person_junk_name')];
  const first = partitionReviewForNotification(batch, { propertyEntityId: 'p1' });
  assert.deepEqual(first.notify.map((r) => r.contact.name), ['Marcus & Millichap']);
  assert.deepEqual(first.silentChrome.map((r) => r.contact.name), ['View Less']);

  const second = partitionReviewForNotification(batch, {
    propertyEntityId: 'p1',
    alreadyNotified: new Set(first.keys),
  });
  assert.equal(second.notify.length, 0, 're-capture must not re-notify');
  assert.equal(second.duplicate.length, 1);
});

test('the same name on a DIFFERENT property is still notified', () => {
  const batch = [item('Marcus & Millichap', 'person_junk_name')];
  const p1 = partitionReviewForNotification(batch, { propertyEntityId: 'p1' });
  const p2 = partitionReviewForNotification(batch, {
    propertyEntityId: 'p2', alreadyNotified: new Set(p1.keys),
  });
  assert.equal(p2.notify.length, 1);
});

test('the three buckets partition the input exactly — nothing is dropped', () => {
  const batch = [
    item('View Less', 'person_junk_name'),
    item('Colliers', 'person_junk_name'),
    item('Colliers', 'person_junk_name'),
    item('Executive Vice Chairman', 'person_junk_name'),
  ];
  const p = partitionReviewForNotification(batch, { propertyEntityId: 'p1' });
  assert.equal(p.notify.length + p.silentChrome.length + p.duplicate.length, batch.length);
});

// ── Class D: the fan-out owner recovery, and its refusals ──────────────────

test('local-part rules match the live pairings and nothing else', () => {
  assert.equal(localPartMatchRule('jcollins@southpace.com', 'James D. Collins'), 'initial_last');
  assert.equal(localPartMatchRule('william.collins@cushwake.com', 'William M. Collins'), 'first_last');
  assert.equal(localPartMatchRule('dlongaker@trinity-partners.com', 'Dail Longaker'), 'initial_last');
  assert.equal(localPartMatchRule('jfahner@hanleyinvestment.com', 'Jacob Fahner'), 'initial_last');
  // The collateral in the same batches must NOT match.
  assert.equal(localPartMatchRule('jcollins@southpace.com', 'Clifford L. Lamar'), null);
  assert.equal(localPartMatchRule('jcollins@southpace.com', 'Conrad Buhler'), null);
  assert.equal(localPartMatchRule('william.collins@cushwake.com', 'Paul J. Collins'), null);
  assert.equal(localPartMatchRule('william.collins@cushwake.com', 'Drew A. Flood'), null);
  assert.equal(localPartMatchRule('dlongaker@trinity-partners.com', 'Edward C. Mann'), null);
});

test('local-part matcher refuses degenerate input', () => {
  assert.equal(localPartMatchRule('', 'James D. Collins'), null);
  assert.equal(localPartMatchRule('no-at-sign', 'James D. Collins'), null);
  assert.equal(localPartMatchRule('jcollins@x.com', 'Collins'), null, 'single-token name is not a person shape');
  assert.equal(localPartMatchRule('a@x.com', 'A B'), null, 'a 1-char local part proves nothing');
});

test('recovery returns exactly the four live owners, with no false positives', () => {
  const live = [
    ['dlongaker@trinity-partners.com', 'Dail Longaker'],
    ['dlongaker@trinity-partners.com', 'Edward C. Mann'],
    ['dlongaker@trinity-partners.com', 'NAI Columbia'],
    ['dlongaker@trinity-partners.com', 'View Less'],
    ['jcollins@southpace.com', 'Clifford L. Lamar'],
    ['jcollins@southpace.com', 'Conrad Buhler'],
    ['jcollins@southpace.com', 'James D. Collins'],
    ['jcollins@southpace.com', 'Southpace Properties, Inc.'],
    ['jcollins@southpace.com', 'Special Projects & Consulting'],
    ['jfahner@hanleyinvestment.com', 'Absolute NNN leased, Corporate guaranteed Davita Dialysis'],
    ['jfahner@hanleyinvestment.com', 'Jacob Fahner'],
    ['jfahner@hanleyinvestment.com', 'NAI DESCO'],
    ['william.collins@cushwake.com', 'Drew A. Flood'],
    ['william.collins@cushwake.com', 'Paul J. Collins'],
    ['william.collins@cushwake.com', 'William M. Collins'],
  ].map(([e, n]) => item(n, 'email_fanout', e));

  const { recovered, refusals } = recoverFanoutOwner(live, { isOrganization });
  assert.deepEqual(recovered.map((h) => h.contact.name).sort(), [
    'Dail Longaker', 'Jacob Fahner', 'James D. Collins', 'William M. Collins',
  ]);
  assert.equal(refusals.length, 0);
});

test('a TIE mints nothing — two matching names refuse the whole batch', () => {
  const batch = [
    item('James Collins', 'email_fanout', 'jcollins@x.com'),
    item('Jane Collins', 'email_fanout', 'jcollins@x.com'),
    item('Someone Else', 'email_fanout', 'jcollins@x.com'),
  ];
  const { recovered, refusals } = recoverFanoutOwner(batch, { isOrganization });
  assert.equal(recovered.length, 0, 'a tie must never mint — guessing writes a person onto a stranger\'s mailbox');
  assert.equal(refusals[0].reason, 'ambiguous_local_part');
  assert.deepEqual(refusals[0].candidates.sort(), ['James Collins', 'Jane Collins']);
});

test('a FIRM whose name resembles its email is refused', () => {
  const batch = [
    item('Southpace Properties, Inc.', 'email_fanout', 'southpace@southpace.com'),
    item('Conrad Buhler', 'email_fanout', 'southpace@southpace.com'),
  ];
  const { recovered, refusals } = recoverFanoutOwner(batch, { isOrganization });
  assert.equal(recovered.length, 0);
  assert.equal(refusals[0].reason, 'no_local_part_match');
});

test('page chrome is never recovered, even on a local-part match', () => {
  const batch = [item('View Less', 'email_fanout', 'vless@x.com'),
    item('Somebody Real', 'email_fanout', 'vless@x.com')];
  const { recovered } = recoverFanoutOwner(batch, { isOrganization });
  assert.equal(recovered.length, 0);
});

test('recovery only ever touches email_fanout — other reasons are untouched', () => {
  const batch = [item('Brian Lane', 'person_junk_name', 'blane@northmarq.com')];
  const { recovered, refusals } = recoverFanoutOwner(batch, { isOrganization });
  assert.equal(recovered.length, 0, 'person_junk_name is not this module\'s to reverse');
  assert.equal(refusals.length, 0);
});

// ── The guard itself must be unchanged ─────────────────────────────────────

test('GUARD INVARIANT: a previously-blocked name still blocks', () => {
  // planContactMinting is the sole authority on mint-vs-block. If any of these
  // start minting, the guard was weakened — which this whole unit forbids.
  const contacts = [
    { name: 'View Less', email: 'a@x.com' },
    { name: 'Marcus & Millichap', email: 'b@x.com' },
    { name: 'Executive Vice Chairman', email: 'c@x.com' },
    { name: 'Collection Street', email: 'd@x.com' },
    { name: 'Richard Ehmer', email: 'rehmer@ehmergroup.com' },
  ];
  const plan = planContactMinting(contacts, {
    personJunkName: (c) => (/^(view less|marcus & millichap)$/i.test(c.name) ? 'junk_contact_name' : null),
  });
  const blocked = plan.review.map((r) => r.contact.name);
  for (const n of ['View Less', 'Marcus & Millichap', 'Executive Vice Chairman', 'Collection Street']) {
    assert.ok(blocked.includes(n), `${n} must still be blocked`);
  }
  assert.deepEqual(plan.mint.map((c) => c.name), ['Richard Ehmer'],
    'the real broker must still mint');
});

// ── Class D2: generic-inbox vs team-roster split (MISPARSE1, 2026-09-16) ───

test('isGenericMailboxLocalPart distinguishes role inboxes from personal ones', () => {
  for (const em of ['info@x.com', 'Leasing@x.com', 'admin@x.com', 'contactus@x.com',
    'inquiries@x.com', 'PM@x.com', 'no-reply@x.com', 'not-an-email']) {
    assert.equal(isGenericMailboxLocalPart(em), true, em);
  }
  for (const em of ['jcollins@southpace.com', 'dlongaker@trinity-partners.com',
    'william.collins@cushwake.com', 'jfahner@hanleyinvestment.com']) {
    assert.equal(isGenericMailboxLocalPart(em), false, em);
  }
});

test('financial line items and franchise brands now resolve as junk, not just email_fanout collateral', () => {
  // MISPARSE1: these leaked into the email_fanout review bucket because no
  // junk-name arm named them. They must now be caught before ever reaching
  // the fan-out check.
  for (const n of ['Gross Income', 'Other Income', 'Net Income', 'Revenue',
    'Vacancy', 'Occupancy', 'Trust', 'PO Box 61381',
    'Absolute NNN leased, Corporate guaranteed Davita Dialysis']) {
    assert.ok(tmMisparseReason(n), `${n} must resolve as a misparse`);
  }
  // Franchise brand with no suffix word at all.
  assert.equal(isNonContactChrome('NAI Columbia'), false); // not chrome — it's a firm, caught elsewhere
});

test('MISPARSE1 dataset: the same 15 rows from §2, re-measured with the roster recovery', () => {
  // Identical fixture to "recovery returns exactly the four live owners" above —
  // this is the measured 26-block population's email_fanout slice. Before this
  // fix, only the four single-owner matches recovered; the remaining real
  // brokers (Edward C. Mann, Clifford L. Lamar, Conrad Buhler, Drew A. Flood,
  // Paul J. Collins) stayed blocked forever behind `no_local_part_match`.
  const live = [
    ['dlongaker@trinity-partners.com', 'Dail Longaker'],
    ['dlongaker@trinity-partners.com', 'Edward C. Mann'],
    ['dlongaker@trinity-partners.com', 'NAI Columbia'],
    ['dlongaker@trinity-partners.com', 'View Less'],
    ['jcollins@southpace.com', 'Clifford L. Lamar'],
    ['jcollins@southpace.com', 'Conrad Buhler'],
    ['jcollins@southpace.com', 'James D. Collins'],
    ['jcollins@southpace.com', 'Southpace Properties, Inc.'],
    ['jcollins@southpace.com', 'Special Projects & Consulting'],
    ['jfahner@hanleyinvestment.com', 'Absolute NNN leased, Corporate guaranteed Davita Dialysis'],
    ['jfahner@hanleyinvestment.com', 'Jacob Fahner'],
    ['jfahner@hanleyinvestment.com', 'NAI DESCO'],
    ['william.collins@cushwake.com', 'Drew A. Flood'],
    ['william.collins@cushwake.com', 'Paul J. Collins'],
    ['william.collins@cushwake.com', 'William M. Collins'],
  ].map(([e, n]) => item(n, 'email_fanout', e));

  // Pass 1: the strict single-owner match (unchanged).
  const strict = recoverFanoutOwner(live, { isOrganization });
  const strictItems = new Set(strict.recovered.map((h) => h.item));
  const remaining = live.filter((r) => !strictItems.has(r));

  // Pass 2: the new team-roster widening, on whatever pass 1 left blocked.
  const roster = recoverTeamRosterBatch(remaining, { isOrganization });

  const admitted = [...strict.recovered, ...roster.recovered].map((h) => h.contact.name).sort();
  assert.deepEqual(admitted, [
    'Clifford L. Lamar', 'Conrad Buhler', 'Dail Longaker', 'Drew A. Flood',
    'Edward C. Mann', 'Jacob Fahner', 'James D. Collins', 'Paul J. Collins',
    'William M. Collins',
  ], 'BEFORE: 4 admitted (strict only). AFTER: 9 of the 12 named real brokers admitted.');

  // Junk and firms must still be blocked — the widening never touches them.
  const stillBlocked = remaining
    .filter((r) => !roster.recovered.some((h) => h.item === r))
    .map((r) => r.contact.name)
    .sort();
  assert.deepEqual(stillBlocked, [
    'Absolute NNN leased, Corporate guaranteed Davita Dialysis',
    'NAI Columbia', 'NAI DESCO', 'Southpace Properties, Inc.',
    'Special Projects & Consulting', 'View Less',
  ]);
});

test('a GENERIC mailbox is never widened, even with real-looking names', () => {
  const batch = [
    item('Someone Real', 'email_fanout', 'leasing@bigfirm.com'),
    item('Another Real Person', 'email_fanout', 'leasing@bigfirm.com'),
  ];
  const { recovered, refusals } = recoverTeamRosterBatch(batch, { isOrganization });
  assert.equal(recovered.length, 0, 'a role inbox stays untrusted no matter who is attached to it');
  assert.equal(refusals[0].reason, 'generic_mailbox');
});

test('the roster widening never admits an organization or page chrome', () => {
  const batch = [
    item('Southpace Properties, Inc.', 'email_fanout', 'jcollins@southpace.com'),
    item('View Less', 'email_fanout', 'jcollins@southpace.com'),
  ];
  const { recovered } = recoverTeamRosterBatch(batch, { isOrganization });
  assert.equal(recovered.length, 0);
});

test('the roster widening never admits a name that fails the person shape', () => {
  const batch = [
    item('Absolute NNN leased, Corporate guaranteed Davita Dialysis', 'email_fanout', 'jfahner@hanleyinvestment.com'),
  ];
  const { recovered } = recoverTeamRosterBatch(batch, { isOrganization });
  assert.equal(recovered.length, 0);
});

test('suppression is a NOTIFICATION change: no disposition helper can mint', () => {
  // partitionReviewForNotification returns only partitions of its INPUT — it
  // has no mint channel at all. Structural, so the property cannot rot.
  const src = readFileSync(new URL('../api/_shared/misparse-disposition.js', import.meta.url), 'utf8');
  const body = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/mintPlan|ensureEntityLink|opsQuery|POST/.test(body),
    'the disposition module must never reach a write path');
});
