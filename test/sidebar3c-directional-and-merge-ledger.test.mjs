// SIDEBAR3-c (2026-09-22) — two defects in the SIDEBAR2-b range-address guard,
// both found by Scott's post-SIDEBAR3 re-send of the Orlando + Scranton captures:
//
// 1. Spelled-out directionals. The DB row 28547 reads "920 South Washington Ave";
//    CoStar sends "920-1000 S Washington Ave". The normalizer stripped only the
//    abbreviated directional, so the two never matched, the guard stayed silent,
//    and the re-send minted twin 51252 (merged back live, backup_id 598). The
//    candidate-fetch hint had the same gap ("S Washington" cannot ilike-match
//    "South Washington"), so both halves are pinned here.
// 2. No attach path after a real merge. Orlando's capture "4550-4666 S Kirkman Rd"
//    is refused against 22887 forever, even though dia_property_merge_backup
//    backup_id 596 records a human merge of exactly that address INTO 22887.
//    findMergeLedgerConfirmation reads that decision; with no matching ledger row
//    it returns null and the pipeline refuses exactly as before.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  detectRangeAddressCollision,
  streetNameHint,
  findMergeLedgerConfirmation,
} from '../api/_handlers/sidebar-pipeline.js';

describe('SIDEBAR3-c — spelled-out directionals', () => {
  it('Scranton: "S" and "South" collide (the live miss)', () => {
    const hit = detectRangeAddressCollision('920-1000 S Washington Ave', '920 South Washington Ave');
    assert.equal(hit?.kind, 'range_containment');
  });

  for (const [abbr, full] of [['N', 'North'], ['S', 'South'], ['E', 'East'], ['W', 'West'],
    ['NE', 'Northeast'], ['NW', 'Northwest'], ['SE', 'Southeast'], ['SW', 'Southwest']]) {
    it(`${abbr} ≡ ${full}`, () => {
      assert.ok(detectRangeAddressCollision(`100-200 ${abbr} Main St`, `150 ${full} Main St`));
      assert.ok(detectRangeAddressCollision(`150 ${full} Main St`, `100-200 ${abbr}. Main St`));
    });
  }

  it('"northeast" is not read as "north" + "east…"', () => {
    assert.equal(detectRangeAddressCollision('100-200 Northeast Main St', '150 North Eastmain St'), null);
  });

  it('a street NAMED like a directional is not stripped without a following word', () => {
    // "West" alone is the street — nothing after it — so it must not normalize to "".
    assert.equal(detectRangeAddressCollision('100 West', '105 Main St'), null);
  });

  it('streetNameHint drops the directional in either spelling', () => {
    assert.equal(streetNameHint('920-1000 S Washington Ave'), 'washington');
    assert.equal(streetNameHint('920 South Washington Ave'), 'washington');
    assert.equal(streetNameHint('4550-4666 S. Kirkman Rd'), 'kirkman');
    assert.equal(streetNameHint('2609 Hospital Rd'), 'hospital');
    assert.equal(streetNameHint(''), '');
  });

  it('the hint used by the guard is a substring of BOTH spellings (fetch half of the fix)', () => {
    const hint = streetNameHint('920-1000 S Washington Ave');
    assert.ok('920 South Washington Ave'.toLowerCase().includes(hint));
    assert.ok('920-1000 S Washington Ave'.toLowerCase().includes(hint));
  });
});

describe('SIDEBAR3-c — merge-ledger confirmation', () => {
  const kirkman = { backup_id: 596, batch_tag: 'sidebar3_kirkman_20260922', kept_property_id: 22887,
    dropped_property_id: 37640, dropped_address: '4550-4666 S Kirkman Rd', dropped_state: 'FL', unmerged_at: null };

  it('Orlando: the recorded merge confirms the re-send', () => {
    const row = findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'FL', 22887, [kirkman]);
    assert.equal(row?.backup_id, 596);
  });

  it('confirms across the directional spelling too', () => {
    const row = findMergeLedgerConfirmation('4550-4666 South Kirkman Rd', 'FL', 22887, [kirkman]);
    assert.equal(row?.backup_id, 596);
  });

  it('no ledger row ⇒ null (refuse as before)', () => {
    assert.equal(findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'FL', 22887, []), null);
    assert.equal(findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'FL', 22887, null), null);
  });

  it('a reversed merge does not confirm', () => {
    const row = findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'FL', 22887,
      [{ ...kirkman, unmerged_at: '2026-09-23T00:00:00Z' }]);
    assert.equal(row, null);
  });

  it('a merge kept on a DIFFERENT property does not confirm this candidate', () => {
    assert.equal(findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'FL', 99999, [kirkman]), null);
  });

  it('a merge whose dropped address is a different street does not confirm', () => {
    const other = { ...kirkman, dropped_address: '4550-4666 N Orange Ave' };
    assert.equal(findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'FL', 22887, [other]), null);
  });

  it('a merge whose dropped address is out of range does not confirm', () => {
    const other = { ...kirkman, dropped_address: '5000-5100 S Kirkman Rd' };
    assert.equal(findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'FL', 22887, [other]), null);
  });

  it('a state mismatch does not confirm', () => {
    assert.equal(findMergeLedgerConfirmation('4550-4666 S Kirkman Rd', 'GA', 22887, [kirkman]), null);
  });
});

describe('SIDEBAR3-c — pipeline wiring (source shape)', () => {
  const src = readFileSync(new URL('../api/_handlers/sidebar-pipeline.js', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '');

  it('the candidate fetch uses streetNameHint, not the raw two-word hint', () => {
    assert.match(src, /const streetHint = streetNameHint\(address\);/);
  });

  it('the refusal is skipped only when the ledger attach fired', () => {
    assert.match(src, /if \(collision && !attachedViaMergeLedger\) \{/);
  });

  it('attach requires exactly one confirmed and exactly one colliding candidate', () => {
    assert.match(src, /confirmedIds\.size === 1 && allIds\.size === 1/);
  });

  it('a ledger attach never PATCHes the kept property\'s address back to the range', () => {
    assert.match(src, /if \(attachedViaMergeLedger\) \{\s*delete propertyData\.address;\s*delete propertyData\.normalized_address;/);
  });
});
