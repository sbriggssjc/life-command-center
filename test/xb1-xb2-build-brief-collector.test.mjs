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
  stripSqlComments,
  parseDeclaredObjects,
  classifyMigrationApplication,
  migrationApplicationFinding,
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
// DEPLOY2-unapplied — migration-merged-but-not-applied detector
// ---------------------------------------------------------------------------

test('stripSqlComments removes line and block comments without touching real SQL', () => {
  const sql = `-- header narrating a DIFFERENT migration's CREATE FUNCTION history\ncreate table real_thing (id int); /* block\ncomment */ create view real_view as select 1;`;
  const clean = stripSqlComments(sql);
  assert.doesNotMatch(clean, /header narrating/);
  assert.doesNotMatch(clean, /block\ncomment/);
  assert.match(clean, /create table real_thing/);
  assert.match(clean, /create view real_view/);
});

test('parseDeclaredObjects: plain CREATE OR REPLACE FUNCTION with a schema-qualified name', () => {
  const sql = `create or replace function public.lcc_do_thing(p_x int) returns int as $$ begin return p_x; end; $$ language plpgsql;`;
  assert.deepEqual(parseDeclaredObjects(sql), [{ kind: 'function', name: 'lcc_do_thing' }]);
});

test('parseDeclaredObjects: CREATE TABLE IF NOT EXISTS, schema-qualified, does not capture the schema name', () => {
  const sql = `create table if not exists public.lcc_thing_log (id bigserial primary key);`;
  assert.deepEqual(parseDeclaredObjects(sql), [{ kind: 'table', name: 'lcc_thing_log' }]);
});

test('parseDeclaredObjects: CREATE UNIQUE INDEX CONCURRENTLY names the index, not the table', () => {
  const sql = `create unique index concurrently if not exists idx_thing_key on public.lcc_thing (key);`;
  assert.deepEqual(parseDeclaredObjects(sql), [{ kind: 'index', name: 'idx_thing_key' }]);
});

test('parseDeclaredObjects: CREATE TRIGGER names the trigger, not the table it fires on', () => {
  const sql = `create trigger trg_lcc_thing_guard before insert on public.lcc_thing for each row execute function lcc_thing_guard();`;
  const objs = parseDeclaredObjects(sql);
  assert.deepEqual(objs.find((o) => o.kind === 'trigger'), { kind: 'trigger', name: 'trg_lcc_thing_guard' });
});

test('parseDeclaredObjects: a header comment narrating a CREATE FUNCTION is not picked up (comments stripped first)', () => {
  const sql = `-- This migration follows the pattern of an earlier CREATE FUNCTION public.some_other_fn\nalter table public.lcc_thing add column x int;`;
  assert.deepEqual(parseDeclaredObjects(sql), []);
});

test('parseDeclaredObjects: a pure ALTER/UPDATE/INSERT migration declares nothing (real repo example, P138 onprem migration)', () => {
  const sql = `alter table public.briefing_intel_snapshot add column analyst_take_meta jsonb;\ninsert into public.feature_flags_registry (flag) values ('x');`;
  assert.deepEqual(parseDeclaredObjects(sql), []);
});

test('parseDeclaredObjects: dedupes a CREATE ... then CREATE OR REPLACE of the same object within one file', () => {
  const sql = `create table if not exists public.lcc_thing (id int);\ncreate or replace function public.lcc_thing_fn() returns void as $$ begin end; $$ language plpgsql;\ncreate or replace function public.lcc_thing_fn() returns void as $$ begin end; $$ language plpgsql;`;
  const objs = parseDeclaredObjects(sql);
  assert.equal(objs.filter((o) => o.name === 'lcc_thing_fn').length, 1);
});

// classifyMigrationApplication

test('classifyMigrationApplication: no declared objects is UNVERIFIABLE, never silently APPLIED', () => {
  const r = classifyMigrationApplication([], {});
  assert.equal(r.verdict, 'unverifiable');
  assert.deepEqual(r.missing, []);
});

test('classifyMigrationApplication: every declared object present is APPLIED', () => {
  const declared = [{ kind: 'function', name: 'lcc_x' }, { kind: 'table', name: 'lcc_y' }];
  const existsByKey = { 'function:lcc_x': true, 'table:lcc_y': true };
  const r = classifyMigrationApplication(declared, existsByKey);
  assert.equal(r.verdict, 'applied');
  assert.deepEqual(r.missing, []);
});

test('classifyMigrationApplication: any declared object absent is UNAPPLIED (positive control, Class 11 doctrine)', () => {
  const declared = [{ kind: 'function', name: 'lcc_x' }, { kind: 'table', name: 'lcc_y' }];
  const existsByKey = { 'function:lcc_x': true, 'table:lcc_y': false };
  const r = classifyMigrationApplication(declared, existsByKey);
  assert.equal(r.verdict, 'unapplied');
  assert.deepEqual(r.missing, [{ kind: 'table', name: 'lcc_y' }]);
});

test('classifyMigrationApplication: an unknown-kind probe result (null) is never treated as absent', () => {
  const declared = [{ kind: 'policy', name: 'lcc_pol' }];
  const existsByKey = { 'policy:lcc_pol': null };
  const r = classifyMigrationApplication(declared, existsByKey);
  assert.equal(r.verdict, 'applied');
});

// migrationApplicationFinding

test('migrationApplicationFinding: APPLIED produces no finding at all (silent, per noise doctrine)', () => {
  const declared = [{ kind: 'function', name: 'lcc_x' }];
  const f = migrationApplicationFinding('20260101_x.sql', declared, { 'function:lcc_x': true });
  assert.equal(f, null);
});

test('migrationApplicationFinding: UNAPPLIED fires critical with the missing object named (POSITIVE CONTROL — a fabricated nonexistent function, the HP1-P1a-fix shape)', () => {
  const declared = [{ kind: 'function', name: 'lcc_totally_made_up_fn_deploy2_test' }];
  const f = migrationApplicationFinding('20260101_fake.sql', declared, {
    'function:lcc_totally_made_up_fn_deploy2_test': false,
  });
  assert.ok(f, 'expected a finding for a declared-but-absent object');
  assert.equal(f.rule, 'migration_unapplied');
  assert.equal(f.severity, 'critical');
  assert.equal(f.subject, '20260101_fake.sql');
  assert.equal(f.measured.verdict, 'unapplied');
  assert.match(f.detail, /lcc_totally_made_up_fn_deploy2_test/);
  assert.match(f.detail, /never applied/);
});

test('migrationApplicationFinding: UNVERIFIABLE fires warn (lower severity than unapplied) and never says "applied"', () => {
  const f = migrationApplicationFinding('20260101_alter_only.sql', [], {});
  assert.ok(f);
  assert.equal(f.rule, 'migration_unapplied');
  assert.equal(f.severity, 'warn');
  assert.equal(f.measured.verdict, 'unverifiable');
  assert.match(f.detail, /UNKNOWN/);
  assert.doesNotMatch(f.detail, /is applied/i);
});

test('migrationApplicationFinding: NEGATIVE CONTROL — the real, live N15 migration objects (verified present on LCC Opps 2026-09-16) produce no finding', () => {
  // N15 (supabase/migrations/20261102170000_lcc_n15_sf_campaign_hub_mint.sql) is documented in
  // docs/os/PLANNED-BACKLOG.md as the ONE recent migration confirmed to have actually applied,
  // unlike HP1-P1a-fix/OWNERGAP1/XB2-precision. Its declared objects, probed live via
  // lcc_probe_schema_objects on 2026-09-16, all read exists:true -- reproduced here as a fixed
  // existsByKey map so the negative control does not depend on live DB access to run in CI.
  const declared = [
    { kind: 'table', name: 'lcc_n15_sf_campaign_hub_mint_log' },
    { kind: 'function', name: 'lcc_n15_mint_sf_campaign_hub_rows' },
    { kind: 'function', name: 'lcc_n15_unmint_sf_campaign_hub_rows' },
  ];
  const existsByKey = {
    'table:lcc_n15_sf_campaign_hub_mint_log': true,
    'function:lcc_n15_mint_sf_campaign_hub_rows': true,
    'function:lcc_n15_unmint_sf_campaign_hub_rows': true,
  };
  const f = migrationApplicationFinding(
    '20261102170000_lcc_n15_sf_campaign_hub_mint.sql',
    declared,
    existsByKey,
  );
  assert.equal(f, null, 'N15 is applied and must produce no finding (false-positive-free)');
});

test('the DEPLOY2 probe RPC migration exists and grants only service_role', () => {
  const migrationPath = fileURLToPath(
    new URL('../supabase/migrations/20260916120100_lcc_deploy2_migration_probe_rpc.sql', import.meta.url),
  );
  const sql = readFileSync(migrationPath, 'utf8');
  assert.match(sql, /create or replace function public\.lcc_probe_schema_objects/i);
  assert.match(sql, /revoke all on function public\.lcc_probe_schema_objects\(jsonb\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.lcc_probe_schema_objects\(jsonb\) to service_role/i);
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
