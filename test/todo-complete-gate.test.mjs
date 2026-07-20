// Closing the Loop — the To Do auto-completion category gate (Flow 1, Option A).
// AUTO-COMPLETE: news · reference · fyi · duplicate. LEAVE OPEN: deals · leads ·
// general · infra · unknown. needs_review NEVER completes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldAutoCompleteTodo,
  normalizeOutcome,
  normalizeCategory,
  AUTO_COMPLETE_CATEGORIES,
  NEVER_AUTO_COMPLETE_CATEGORIES,
} from '../api/_shared/todo-complete-gate.js';

describe('shouldAutoCompleteTodo — the confirmed category gate', () => {
  it('auto-completes the confirmed terminal categories on a filed outcome', () => {
    for (const cat of ['news', 'reference', 'fyi']) {
      assert.equal(shouldAutoCompleteTodo('filed', cat), true, `${cat} should auto-complete`);
      assert.equal(shouldAutoCompleteTodo('auto_filed', cat), true, `${cat} (auto_filed) should auto-complete`);
    }
  });

  it('leaves the human-deliverable categories OPEN', () => {
    for (const cat of ['deals', 'leads', 'general', 'infra']) {
      assert.equal(shouldAutoCompleteTodo('filed', cat), false, `${cat} should leave open`);
      assert.equal(shouldAutoCompleteTodo('auto_filed', cat), false, `${cat} (auto_filed) should leave open`);
    }
  });

  it('NEVER auto-completes needs_review — even on a filed outcome', () => {
    assert.equal(shouldAutoCompleteTodo('filed', 'needs_review'), false);
    assert.equal(shouldAutoCompleteTodo('auto_filed', 'needs_review'), false);
    // Hard guard: even if needs_review somehow landed in the allow-list.
    assert.ok(!AUTO_COMPLETE_CATEGORIES.includes('needs_review'));
    assert.ok(NEVER_AUTO_COMPLETE_CATEGORIES.includes('needs_review'));
  });

  it('completes a duplicate disposition on its own (dedup = nothing to work)', () => {
    assert.equal(shouldAutoCompleteTodo('duplicate', null), true, 'duplicate outcome, no category');
    assert.equal(shouldAutoCompleteTodo('duplicate', undefined), true);
    assert.equal(shouldAutoCompleteTodo('filed', 'duplicate'), true, 'duplicate category on filed');
    // ...but a duplicate that is somehow tagged needs_review still never completes.
    assert.equal(shouldAutoCompleteTodo('duplicate', 'needs_review'), false);
  });

  it('leaves a flagged disposition OPEN (flagged = human attention)', () => {
    assert.equal(shouldAutoCompleteTodo('flagged', 'news'), false);
    assert.equal(shouldAutoCompleteTodo('flagged', null), false);
  });

  it('leaves an unknown / absent category OPEN (allow-list default)', () => {
    assert.equal(shouldAutoCompleteTodo('filed', null), false, 'no category → leave open');
    assert.equal(shouldAutoCompleteTodo('filed', undefined), false);
    assert.equal(shouldAutoCompleteTodo('filed', ''), false);
    assert.equal(shouldAutoCompleteTodo('filed', 'brand_new_future_category'), false);
  });

  it('never completes on a non-terminal outcome regardless of category', () => {
    assert.equal(shouldAutoCompleteTodo('', 'news'), false);
    assert.equal(shouldAutoCompleteTodo(null, 'news'), false);
    assert.equal(shouldAutoCompleteTodo('queued', 'news'), false);
  });

  it('is case- and whitespace-insensitive on both args', () => {
    assert.equal(shouldAutoCompleteTodo('FILED', '  News '), true);
    assert.equal(shouldAutoCompleteTodo(' Auto_Filed ', 'REFERENCE'), true);
    assert.equal(shouldAutoCompleteTodo('filed', ' Deals '), false);
    assert.equal(shouldAutoCompleteTodo('filed', 'NEEDS_REVIEW'), false);
  });

  it('the tunable knob is exactly the Scott-confirmed list', () => {
    assert.deepEqual(AUTO_COMPLETE_CATEGORIES, ['news', 'reference', 'fyi', 'duplicate']);
  });
});

describe('normalizers', () => {
  it('normalizeOutcome collapses filed / auto_filed', () => {
    assert.equal(normalizeOutcome('filed'), 'filed');
    assert.equal(normalizeOutcome('auto_filed'), 'filed');
    assert.equal(normalizeOutcome(' AUTO_FILED '), 'filed');
    assert.equal(normalizeOutcome('duplicate'), 'duplicate');
    assert.equal(normalizeOutcome(null), '');
  });

  it('normalizeCategory lowercases + trims, empty when absent', () => {
    assert.equal(normalizeCategory('  News '), 'news');
    assert.equal(normalizeCategory(null), '');
    assert.equal(normalizeCategory(undefined), '');
  });
});
