// XB1/XB2 — build-brief collector pure-function tests, with a positive control (firing case) and
// a negative control (silent case) for every rule, per the repo's standing "a monitor nobody
// trusts is worse than none" doctrine (FEED2/MB2e).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  extractLeadingIds,
  findOrphanPrompts,
  orphanPromptFindings,
  docSizeFinding,
  remoteBranchDebtFinding,
  branchDebtFinding,
  generatedFileChangeFindings,
} from '../scripts/build-brief-collector.mjs';

// ---------------------------------------------------------------------------
// extractLeadingIds
// ---------------------------------------------------------------------------

test('extractLeadingIds pulls the leading ID-shaped token run', () => {
  assert.deepEqual(extractLeadingIds('XB1-XB2-build-brief-collector-and-audit-rules.md'), ['XB1', 'XB2']);
  assert.deepEqual(extractLeadingIds('BR1-firm-registry-repair.md'), ['BR1']);
  assert.deepEqual(extractLeadingIds('ID3b-owner-duplicate-merge.md'), ['ID3b']);
  assert.deepEqual(extractLeadingIds('PDR14a-something.md'), ['PDR14a']);
});

test('extractLeadingIds returns [] for a filename with no leading id token', () => {
  assert.deepEqual(extractLeadingIds('readme.md'), []);
  assert.deepEqual(extractLeadingIds('notes-from-scott.md'), []);
});

// ---------------------------------------------------------------------------
// findOrphanPrompts / orphanPromptFindings
// ---------------------------------------------------------------------------

test('findOrphanPrompts: a prompt with a matching response filename is NOT an orphan (negative control)', () => {
  const prompts = ['XB1-XB2-build-brief-collector-and-audit-rules.md'];
  const responses = ['XB1-XB2-build-brief.response.md'];
  assert.deepEqual(findOrphanPrompts(prompts, responses), []);
});

test('findOrphanPrompts: the id can match a response filed under a subdirectory with an unrelated filename shape (the MB2b false-positive case, fixed)', () => {
  const prompts = ['MB2b-two-feeds-green.md'];
  const responses = ['done/MB2b desktop response.docx'];
  // "MB2b desktop response.docx" is not named after its prompt, but it contains the shared id
  // "MB2b" as a substring, recursively across responses/ — that is the fix XB2's finding asked
  // for (never match on a filename prefix alone).
  assert.deepEqual(findOrphanPrompts(prompts, responses), []);
});

test('findOrphanPrompts: an id whose token is not ID-shaped (two trailing lowercase letters, e.g. a hypothetical "MB2bc") is skipped, never reported as either match or orphan', () => {
  // extractLeadingIds only recognises ONE trailing lowercase letter after the digits (XB1, PDR14a);
  // a token like "MB2bc" falls through to the descriptive-slug branch and yields no id at all, so
  // findOrphanPrompts correctly has nothing to match on and skips it rather than guessing.
  assert.deepEqual(extractLeadingIds('MB2bc-something.md'), []);
  assert.deepEqual(findOrphanPrompts(['MB2bc-something.md'], []), []);
});

test('findOrphanPrompts: a genuinely orphaned prompt (positive control)', () => {
  const prompts = ['ID3b-owner-duplicate-merge.md'];
  const responses = ['XB1-XB2-build-brief.response.md'];
  const orphans = findOrphanPrompts(prompts, responses);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].file, 'ID3b-owner-duplicate-merge.md');
});

test('findOrphanPrompts: a prompt with no extractable id is skipped, never reported', () => {
  assert.deepEqual(findOrphanPrompts(['random-notes.md'], []), []);
});

test('orphanPromptFindings wraps orphans in the shared finding shape at info severity', () => {
  const findings = orphanPromptFindings(['ID3b-owner-duplicate-merge.md'], []);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'prompt_without_matching_response');
  assert.equal(findings[0].severity, 'info');
  assert.equal(findings[0].subject, 'ID3b-owner-duplicate-merge.md');
});

// ---------------------------------------------------------------------------
// docSizeFinding
// ---------------------------------------------------------------------------

test('docSizeFinding: under the warn ratio is silent (negative control)', () => {
  assert.equal(docSizeFinding('STATUS.md', 100, 3000, 0.8), null);
});

test('docSizeFinding: at/above warn ratio but under budget is warn', () => {
  const f = docSizeFinding('STATUS.md', 2500, 3000, 0.8); // warnAt = 2400
  assert.ok(f);
  assert.equal(f.severity, 'warn');
  assert.equal(f.rule, 'doc_size_approaching_budget');
});

test('docSizeFinding: at/above budget is critical (positive control)', () => {
  const f = docSizeFinding('STATUS.md', 3050, 3000, 0.8);
  assert.ok(f);
  assert.equal(f.severity, 'critical');
});

// ---------------------------------------------------------------------------
// remoteBranchDebtFinding
// ---------------------------------------------------------------------------

test('remoteBranchDebtFinding: zero unmerged branches is silent (negative control)', () => {
  assert.equal(remoteBranchDebtFinding(['main', 'feature-a'], []), null);
});

test('remoteBranchDebtFinding: unmerged branches fire, severity scales with count', () => {
  const small = remoteBranchDebtFinding(new Array(20).fill('x'), new Array(3).fill('y'));
  assert.equal(small.severity, 'info');
  const big = remoteBranchDebtFinding(new Array(20).fill('x'), new Array(14).fill('y'));
  assert.equal(big.severity, 'warn');
  assert.equal(big.measured.unmerged_count, 14);
  assert.equal(big.measured.total_remote_branches, 20);
});

// ---------------------------------------------------------------------------
// branchDebtFinding (XB2-precision)
// ---------------------------------------------------------------------------

test('branchDebtFinding: below the warn threshold is silent (negative control)', () => {
  assert.equal(branchDebtFinding(50, { warnAt: 200 }), null);
});

test('branchDebtFinding: at/above the threshold fires warn, with no trend when no prior given', () => {
  const f = branchDebtFinding(1722, { warnAt: 200 });
  assert.ok(f);
  assert.equal(f.rule, 'branch_debt');
  assert.equal(f.severity, 'warn');
  assert.equal(f.measured.total_remote_branches, 1722);
  assert.equal(f.measured.delta_since_prior, undefined);
});

test('branchDebtFinding: carries a trend when a prior total is supplied', () => {
  const f = branchDebtFinding(1722, { warnAt: 200, priorTotal: 1718, priorAt: '2026-09-14' });
  assert.ok(f);
  assert.equal(f.measured.prior_total_remote_branches, 1718);
  assert.equal(f.measured.delta_since_prior, 4);
  assert.match(f.detail, /\+4 since the prior snapshot on 2026-09-14/);
});

// ---------------------------------------------------------------------------
// generatedFileChangeFindings
// ---------------------------------------------------------------------------

test('generatedFileChangeFindings: a GENERATED-header file in the changed list fires (positive control)', () => {
  const findings = generatedFileChangeFindings(['docs/os/OPERATOR-INBOX.md'], () =>
    '<!-- GENERATED by scripts/render-operator-inbox.mjs — do not hand-edit. -->\n# Operator Inbox\n',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'generated_file_changed');
  assert.equal(findings[0].subject, 'docs/os/OPERATOR-INBOX.md');
});

test('generatedFileChangeFindings: an ordinary changed file is silent (negative control)', () => {
  const findings = generatedFileChangeFindings(['api/admin.js'], () => '// just a normal file\n');
  assert.deepEqual(findings, []);
});

test('generatedFileChangeFindings: a deleted file (unreadable) is skipped, not a crash', () => {
  const findings = generatedFileChangeFindings(['some/deleted-file.md'], () => {
    throw new Error('ENOENT');
  });
  assert.deepEqual(findings, []);
});

// ---------------------------------------------------------------------------
// Structural check on the shipped migration: every SQL-side rule name must be one the collector
// script itself documents in its header comment, so the two halves cannot silently drift apart on
// vocabulary (both emit into the same audit_flags array and must share one rule taxonomy).
// ---------------------------------------------------------------------------

test('the DB-side migration only emits rule names the collector script header already describes', () => {
  const migrationPath = fileURLToPath(
    new URL('../supabase/migrations/20260915120000_lcc_xb1xb2_build_brief_db_audit.sql', import.meta.url),
  );
  const sql = readFileSync(migrationPath, 'utf8');
  const ruleNames = [...sql.matchAll(/'rule',\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    new Set(ruleNames),
    new Set(['flag_long_dark', 'producer_stall_not_flag_gated', 'market_brief_lane_stale_or_missing']),
  );
});

test('the DB-side migration drops the old 3-arg signature before creating the 4-arg one (N15d/B1 overload lesson)', () => {
  const migrationPath = fileURLToPath(
    new URL('../supabase/migrations/20260915120000_lcc_xb1xb2_build_brief_db_audit.sql', import.meta.url),
  );
  const sql = readFileSync(migrationPath, 'utf8');
  const dropIdx = sql.indexOf('DROP FUNCTION IF EXISTS public.lcc_build_brief_db_audit(integer, integer, integer);');
  const createIdx = sql.indexOf('CREATE OR REPLACE FUNCTION public.lcc_build_brief_db_audit(');
  assert.ok(dropIdx >= 0, 'expected the 3-arg DROP FUNCTION guard');
  assert.ok(dropIdx < createIdx, 'DROP must precede CREATE');
});

test('the DB-side migration is not anon/authenticated executable', () => {
  const migrationPath = fileURLToPath(
    new URL('../supabase/migrations/20260915120000_lcc_xb1xb2_build_brief_db_audit.sql', import.meta.url),
  );
  const sql = readFileSync(migrationPath, 'utf8');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.lcc_build_brief_db_audit.*FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /has_function_privilege\('anon', 'public\.lcc_build_brief_db_audit/);
  assert.match(sql, /has_function_privilege\('authenticated', 'public\.lcc_build_brief_db_audit/);
});
