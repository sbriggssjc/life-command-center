// /api/decisions?summary=1 — the badge-count path.
//
// Measured 2026-08-15 at 16,199ms on a live page load. The cost was NOT the SQL
// (v_lcc_decision_open_counts runs in 85ms) and NOT sequential federation
// (admin.js already wraps the lanes in Promise.all). It was fetchExcludedRefs():
// summary mode called it once per federated lane, and that function PAGES every
// non-open subject_ref for the type in 1000-row sequential pages and
// materialises them into a Set — purely to read `.size`. ~18 sequential
// cross-region round-trips to produce 17 integers.
//
// Summary mode now reads all of them in one query from
// v_lcc_decision_excluded_counts. These tests lock in the two properties that
// make that substitution CORRECT, because both are easy to break by accident.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminSrc = readFileSync(join(root, 'api/admin.js'), 'utf8');

/** The `if (req.query.summary) { ... }` block of handleDecisionsList. */
function summaryBranch() {
  const fn = adminSrc.indexOf('async function handleDecisionsList');
  assert.notEqual(fn, -1, 'handleDecisionsList not found');
  const start = adminSrc.indexOf('if (req.query.summary)', fn);
  assert.notEqual(start, -1, 'summary branch not found');
  const brace = adminSrc.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = brace; i < adminSrc.length; i++) {
    if (adminSrc[i] === '{') depth++;
    else if (adminSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, 'could not balance-brace the summary branch');
  return adminSrc.slice(start, end);
}

/**
 * Strip comments before asserting. The branch carries a deliberate note that
 * NAMES fetchExcludedRefs (explaining why the list path still uses it), and a
 * "does X still appear" assertion must not be satisfiable by the prose
 * documenting X — the same trap that produced two false failures in
 * panel-redesign.test.mjs.
 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

describe('decisions?summary=1 — badge counts must not page the decided history', () => {
  const branch = stripComments(summaryBranch());

  it('reads the excluded counts from the view, in one query', () => {
    assert.match(branch, /v_lcc_decision_excluded_counts/,
      'summary must read the pre-aggregated view');
  });

  it('REGRESSION: does not call fetchExcludedRefs on the happy path', () => {
    // A bare `fetchExcludedRefs(t)` re-introduces ~18 sequential cross-region
    // round-trips. The ONLY permitted use here is the guarded fallback for when
    // the view read itself fails.
    const calls = [...branch.matchAll(/fetchExcludedRefs\(/g)];
    assert.ok(calls.length <= 1,
      `fetchExcludedRefs called ${calls.length}x in summary mode; at most one (the fallback) is allowed`);
    if (calls.length === 1) {
      assert.match(branch, /exclR\.ok\s*\?[^:]*:\s*\(await fetchExcludedRefs\(/,
        'the single fetchExcludedRefs call must be the "view read failed" fallback, not the primary path');
    }
  });

  it('degrades to the old behaviour rather than reporting inflated badges', () => {
    // If the view is missing or ungranted, exclN must NOT silently become 0 —
    // that would subtract nothing and overstate every federated lane.
    assert.match(branch, /exclR\.ok/,
      'the view read must be checked; a failed read must not fall through to 0');
  });

  it('the LIST branch still uses the real Set (it needs the refs, not the size)', () => {
    const listPart = adminSrc.slice(adminSrc.indexOf('const type = req.query.type'),
                                    adminSrc.indexOf('const type = req.query.type') + 4000);
    assert.ok(/listFederatedLane|fetchExcludedRefs/.test(listPart),
      'list mode must still exclude decided subjects by ref');
  });
});

describe('the view must preserve Set semantics (DISTINCT)', () => {
  it('is documented as count(DISTINCT subject_ref), not count(*)', () => {
    // fetchExcludedRefs returns a Set, so its .size is a DISTINCT count.
    // Live 2026-08-15: match_disambiguation had 1,231 decided rows but only
    // 1,044 distinct subject_refs — a plain count(*) would under-report that
    // badge by 187 and every other duplicated lane likewise.
    const mig = readFileSync(
      join(root, 'supabase/migrations/20260910120000_lcc_decision_excluded_counts.sql'), 'utf8');
    assert.match(mig, /count\(distinct subject_ref\)/i,
      'the view must count DISTINCT subject_ref to match Set semantics');
    assert.match(mig, /status <> 'open'/, 'must exclude only non-open decisions');
    assert.match(mig, /subject_ref is not null/, 'must ignore null refs, as the Set build does');
  });
});
