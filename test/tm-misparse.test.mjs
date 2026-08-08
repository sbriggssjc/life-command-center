// Prompt 89 — TrafficMetrix misparse detector + sidebar guard. Unit tests for the
// PURE detector (streets/labels caught, real "First Last" names NOT), the one-email
// fan-out cap, the U3 pool-exclusion predicate, and seeder subject_ref idempotency.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMisparseName, tmMisparseReason, planContactMinting,
  EMAIL_FANOUT_SUSPECT_THRESHOLD, TM_MISPARSE_HEURISTIC,
} from '../api/_shared/tm-misparse.js';
import { junkSubjectRef } from '../api/_shared/junk-prescreen.js';

// The verbatim rehmer@ehmergroup.com cluster from live forensics (2026-08-08).
// Junk = street labels + TrafficMetrix column vocab; REAL = the two brokers.
const JUNK_MEMBERS = [
  'Battery St W', 'Belden Pl E', 'Bush St', 'Clay St N', 'Collection Street',
  'Columbus Ave', 'Cross Street', 'Halleck St N', 'Halleck St S', 'Hinckle Walk',
  'Jack Kerouac Aly SE', 'Jackson St N', 'Kearny St', 'Kearny St W', 'Last Measured',
  'Leidesdorff St', 'Made with TrafficMetrix® Products', 'Pine St N', 'Sansome St',
  'Stevens Aly N', 'Stockton St', 'Traffic Vol',
];
const REAL_MEMBERS = ['Richard Ehmer', 'James Devincenti'];

describe('tmMisparseReason — class detector', () => {
  it('catches every junk street/label member of the TrafficMetrix cluster', () => {
    for (const name of JUNK_MEMBERS) {
      assert.ok(isMisparseName(name), `expected misparse: "${name}"`);
      assert.equal(tmMisparseReason(name).heuristic, TM_MISPARSE_HEURISTIC);
    }
  });
  it('does NOT catch the real broker names (First Last, no street token)', () => {
    for (const name of REAL_MEMBERS) {
      assert.equal(isMisparseName(name), false, `should NOT be misparse: "${name}"`);
      assert.equal(tmMisparseReason(name), null);
    }
  });
  it('flags TrafficMetrix vocab via the tm_vocab arm', () => {
    assert.equal(tmMisparseReason('Traffic Vol').signal, 'tm_vocab');
    assert.equal(tmMisparseReason('Last Measured').signal, 'tm_vocab');
    assert.equal(tmMisparseReason('Made with TrafficMetrix® Products').signal, 'tm_vocab');
    assert.equal(tmMisparseReason('Cross Street').signal, 'tm_vocab');
  });
  it('flags street suffixes (incl. trailing directionals) via the street_suffix arm', () => {
    assert.equal(tmMisparseReason('Bush St').signal, 'street_suffix');
    assert.equal(tmMisparseReason('Halleck St N').signal, 'street_suffix');
    assert.equal(tmMisparseReason('Jack Kerouac Aly SE').signal, 'street_suffix');
    assert.equal(tmMisparseReason('Columbus Ave').signal, 'street_suffix');
    assert.equal(tmMisparseReason('Hinckle Walk').signal, 'street_suffix');
  });
  it('carries the verbatim name as evidence', () => {
    assert.equal(tmMisparseReason('Collection Street').evidence, 'Collection Street');
  });
  it('ignores blank / null names', () => {
    assert.equal(tmMisparseReason(''), null);
    assert.equal(tmMisparseReason(null), null);
    assert.equal(tmMisparseReason('   '), null);
  });
  it('does not flag ordinary company / person names without a street token', () => {
    for (const ok of ['Marcus & Millichap', 'Fresenius Medical Care', 'John Smith', 'Cohen Cos']) {
      assert.equal(isMisparseName(ok), false, `should be clean: "${ok}"`);
    }
  });
});

describe('planContactMinting — sidebar guard (misparse + fan-out cap)', () => {
  it('routes the verbatim 16+ TrafficMetrix roster to review, mints none', () => {
    const contacts = [...JUNK_MEMBERS, ...REAL_MEMBERS].map((name) => ({
      name, email: 'rehmer@ehmergroup.com', role: 'listing_broker',
    }));
    const plan = planContactMinting(contacts);
    // Every junk name trips the misparse detector.
    for (const name of JUNK_MEMBERS) {
      const r = plan.review.find((x) => x.contact.name === name);
      assert.ok(r, `junk member not reviewed: "${name}"`);
      assert.equal(r.reason, 'misparse_name');
    }
    // The real brokers do not trip the detector, but the shared email fans out to
    // >4 parsed contacts, so they are caught by the fan-out cap (recoverable review),
    // never silently minted.
    for (const name of REAL_MEMBERS) {
      const r = plan.review.find((x) => x.contact.name === name);
      assert.ok(r, `real member not reviewed: "${name}"`);
      assert.equal(r.reason, 'email_fanout');
    }
    assert.equal(plan.mint.length, 0, 'no phantom should be minted from the misparse roster');
    assert.ok(plan.suspectEmails.includes('rehmer@ehmergroup.com'));
  });

  it('mints a normal small roster untouched (no false positives)', () => {
    const contacts = [
      { name: 'John Smith', email: 'john@acme.com' },
      { name: 'Jane Doe', email: 'jane@acme.com' },
      { name: 'Bob Lee', email: 'bob@other.com' },
    ];
    const plan = planContactMinting(contacts);
    assert.equal(plan.mint.length, 3);
    assert.equal(plan.review.length, 0);
    assert.equal(plan.suspectEmails.length, 0);
  });

  it('fan-out cap fires only ABOVE the threshold', () => {
    const atThreshold = Array.from({ length: EMAIL_FANOUT_SUSPECT_THRESHOLD }, (_, i) => ({
      name: `Person ${i} A`, email: 'shared@firm.com',
    }));
    // Exactly at the threshold => still minted (not "> threshold").
    assert.equal(planContactMinting(atThreshold).mint.length, EMAIL_FANOUT_SUSPECT_THRESHOLD);
    // One over the threshold => all routed to review.
    const overThreshold = atThreshold.concat([{ name: 'Person X A', email: 'shared@firm.com' }]);
    const plan = planContactMinting(overThreshold);
    assert.equal(plan.mint.length, 0);
    assert.equal(plan.review.length, EMAIL_FANOUT_SUSPECT_THRESHOLD + 1);
  });

  it('a misparse name is reviewed even when its email does not fan out', () => {
    const plan = planContactMinting([
      { name: 'Traffic Vol', email: 'lonely@firm.com' },
      { name: 'Real Person', email: 'real@firm.com' },
    ]);
    assert.equal(plan.mint.length, 1);
    assert.equal(plan.mint[0].name, 'Real Person');
    assert.equal(plan.review[0].reason, 'misparse_name');
  });
});

describe('U3 pool-exclusion predicate', () => {
  const clusterTrips = (winner, losers) =>
    [winner, ...losers].some((n) => isMisparseName(n));

  it('excludes a cluster whose loser names include a misparse member', () => {
    assert.equal(clusterTrips('Richard Ehmer', ['Collection Street', 'James Devincenti']), true);
  });
  it('keeps a clean cluster of real people', () => {
    assert.equal(clusterTrips('Richard Ehmer', ['James Devincenti']), false);
  });
});

describe('seeder subject_ref idempotency', () => {
  it('yields a stable subject_ref for the same entity (re-run adds nothing)', () => {
    const id = '6fedfbc1-b80e-4484-bb0a-d14ca66aa34e';
    const a = junkSubjectRef('lcc', 'entities', id);
    const b = junkSubjectRef('lcc', 'entities', id);
    assert.equal(a, b);
    assert.equal(a, 'junk:lcc:entities:' + id);
  });
});
