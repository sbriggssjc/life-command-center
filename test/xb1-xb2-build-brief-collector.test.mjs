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
  migrationTargetDatabase,
  sortMigrationsByAddDate,
  MIGRATION_SCAN_DIRS,
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

// ---------------------------------------------------------------------------
// DEPLOY2-coverage — the window was blind to one of its own three incidents, sorted by a
// synthetic timestamp, and routed every root file to LCC Opps. Three acceptance controls plus
// the routing invariants.
// ---------------------------------------------------------------------------

const MIG = 'supabase/migrations';
const OWNERGAP1 = `${MIG}/dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql`;

// (1) REGRESSION CONTROL ON THE REAL INCIDENT.

test('DEPLOY2-coverage (1): the OWNERGAP1 file is IN SCOPE — dialysis/ is live, not retired', () => {
  // The file exists, is under `dialysis/`, and routes to Dialysis_DB rather than being skipped as
  // a "historical copy of a database owned by another repo" (which is true of government/ only).
  const abs = fileURLToPath(new URL(`../${OWNERGAP1}`, import.meta.url));
  const sql = readFileSync(abs, 'utf8');
  assert.equal(migrationTargetDatabase(OWNERGAP1), 'dia_db');

  // Its VERDICT, stated rather than massaged: OWNERGAP1 is a trigger-and-function containment
  // migration, so it DOES declare probeable objects. Whatever the live probe says, the point of
  // this control is that it is now asked at all — and that it is asked of the RIGHT database.
  const declared = parseDeclaredObjects(sql);
  assert.ok(declared.length > 0, 'OWNERGAP1 declares probeable objects (it creates a function + trigger)');

  // Absent dia credentials the honest answer is UNVERIFIABLE-with-a-reason, never APPLIED.
  const skipped = migrationApplicationFinding(OWNERGAP1, declared, {}, {
    target: 'dia_db',
    unverifiableReason: 'probe skipped for dia_db: no_dia_credentials',
  });
  assert.equal(skipped.measured.verdict, 'unverifiable');
  assert.equal(skipped.severity, 'warn');
  assert.match(skipped.detail, /NOT a clean bill of health/);

  // And with a live dia probe answering, it classifies normally against Dialysis_DB.
  const present = Object.fromEntries(declared.map((o) => [`${o.kind}:${o.name.toLowerCase()}`, true]));
  assert.equal(migrationApplicationFinding(OWNERGAP1, declared, present, { target: 'dia_db' }), null);
  const absent = Object.fromEntries(declared.map((o) => [`${o.kind}:${o.name.toLowerCase()}`, false]));
  const bad = migrationApplicationFinding(OWNERGAP1, declared, absent, { target: 'dia_db' });
  assert.equal(bad.severity, 'critical');
  assert.equal(bad.measured.target_database, 'dia_db');
});

test('DEPLOY2-coverage (1a): dialysis/ IS one of the scanned directories (the enumeration, not just the routing)', () => {
  // The routing test above proves a dia file would be sent to the right project; this proves the
  // file is ENUMERATED at all. Asserted on the exported SET, never by grepping source for a
  // directory name — the collector's own comments name every directory while explaining the
  // in/out decision, so a grep would pass over a revert (A5c/N18).
  assert.ok(MIGRATION_SCAN_DIRS.includes('supabase/migrations/dialysis'), 'dialysis/ must be scanned');
  assert.ok(MIGRATION_SCAN_DIRS.includes('supabase/migrations'), 'the root must still be scanned');
});

test('DEPLOY2-coverage (1b): government/ stays OUT of scope — it is genuinely retired', () => {
  assert.ok(
    !MIGRATION_SCAN_DIRS.includes('supabase/migrations/government'),
    'government/ must never be enumerated: its files are stale and would report the live, correct DB as wrong',
  );
  // Routing still NAMES the government project (a `gov_`-prefixed root file targets it), but the
  // government/ directory is never enumerated: re-reading its stale files would report the LIVE,
  // CORRECT government database as wrong (see that directory's README).
  assert.equal(
    migrationTargetDatabase(`${MIG}/government/20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql`),
    'gov_db',
  );
  const collector = readFileSync(
    fileURLToPath(new URL('../scripts/build-brief-collector.mjs', import.meta.url)),
    'utf8',
  );
  // Comments stripped first: this file's own header discusses `government/` at length while
  // explaining WHY it is excluded, so a raw-source grep would find it "enumerated" (A5c/N18).
  const code = collector.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  assert.doesNotMatch(
    code,
    /MIGRATION_GOV_DIR|migrations\/government['"`]\s*\]/,
    'government/ must never be added to the scanned directory list',
  );
});

// (2) WINDOW CONTROL — a low synthetic timestamp with a recent git add-date is IN the window,
//     and the old filename sort would have excluded it.

test('DEPLOY2-coverage (2): a LOW-timestamp, RECENTLY-ADDED file is in the git-date window and was out of the filename window', () => {
  // Real file, real measurement (2026-09-16): the filename-sorted window floor was
  // `20260930121500`, and `20260915120000_lcc_xb1xb2_build_brief_db_audit.sql` — the DEPLOY2
  // rule's OWN sibling migration — was added to git on 2026-09-14 while its synthetic filename
  // timestamp sorts 15 days BELOW that floor. It is one of the measured 24 root migrations newer
  // than files the old window did scan.
  const LATE_ADD = `${MIG}/20260915120000_lcc_xb1xb2_build_brief_db_audit.sql`;
  const HIGH_NAME_OLD_ADD = `${MIG}/20260930121600_lcc_p160_merge_entity_owner_backrefs_and_cycle_guard.sql`;
  assert.ok(
    readFileSync(fileURLToPath(new URL(`../${LATE_ADD}`, import.meta.url)), 'utf8').length > 0,
    'the named control file must actually exist in the repo',
  );

  const files = [HIGH_NAME_OLD_ADD, LATE_ADD];
  const addDates = new Map([
    [HIGH_NAME_OLD_ADD, '2026-08-20T10:00:00+00:00'],
    [LATE_ADD, '2026-09-14T22:23:38+00:00'],
  ]);

  // git-add-date order (ascending; `.slice(-N)` takes the newest N) puts the late-added file LAST.
  assert.deepEqual(sortMigrationsByAddDate(files, addDates), [HIGH_NAME_OLD_ADD, LATE_ADD]);
  assert.deepEqual(sortMigrationsByAddDate(files, addDates).slice(-1), [LATE_ADD]);

  // The OLD behaviour — plain filename sort — puts it FIRST, i.e. outside a 1-file window.
  assert.deepEqual([...files].sort().slice(-1), [HIGH_NAME_OLD_ADD]);
});

// (3) NO-DATE CONTROL — unknown is not zero (P180).

test('DEPLOY2-coverage (3): a file with NO git add-date sorts NEWEST, never dropped', () => {
  const dated = `${MIG}/20260101120000_lcc_old.sql`;
  const undated = `${MIG}/20261231120000_lcc_brand_new_untracked.sql`;
  const addDates = new Map([[dated, '2026-09-15T00:00:00+00:00']]);

  const ordered = sortMigrationsByAddDate([dated, undated], addDates);
  assert.deepEqual(ordered, [dated, undated], 'the undated file sorts last = newest = inside the window');
  assert.deepEqual(ordered.slice(-1), [undated], 'a 1-file window keeps the undated file, not the dated one');
  assert.equal(ordered.length, 2, 'nothing is dropped for lacking a date');

  // Positive control on the inverse: a date that IS present still beats an older one.
  const older = `${MIG}/20260101120000_lcc_a.sql`;
  const newer = `${MIG}/20260101120000_lcc_b.sql`;
  assert.deepEqual(
    sortMigrationsByAddDate([newer, older], new Map([
      [older, '2026-01-01T00:00:00+00:00'],
      [newer, '2026-09-01T00:00:00+00:00'],
    ])).slice(-1),
    [newer],
  );
});

// (2b) ROUTE BY TARGET DATABASE — "root → LCC Opps" is false and produces a FALSE CRITICAL.

test('DEPLOY2-coverage (2b): a root-level `_gov_`-prefixed file is NOT probed against LCC Opps (named real file)', () => {
  // `20260812120000_gov_credit_classifier_expand_state_federal.sql` is one of the 31 root-level
  // cross-target migrations. It declares `public.gov_credit_buckets_from_text`, which is ABSENT
  // from LCC Opps — so routing it to LCC Opps emits a FALSE `unapplied` at `critical`, the
  // loudest severity on the most trusted rule, about a migration that is correctly applied to the
  // government project.
  const GOV_AT_ROOT = `${MIG}/20260812120000_gov_credit_classifier_expand_state_federal.sql`;
  assert.ok(
    readFileSync(fileURLToPath(new URL(`../${GOV_AT_ROOT}`, import.meta.url)), 'utf8').length > 0,
    'the named real file must exist in the repo',
  );
  assert.equal(migrationTargetDatabase(GOV_AT_ROOT), 'gov_db', 'must route to gov, never to LCC Opps');
  assert.notEqual(migrationTargetDatabase(GOV_AT_ROOT), 'lcc_opps');

  // And a root `dia_`-prefixed file likewise.
  assert.equal(migrationTargetDatabase(`${MIG}/20260808120000_dia_prompt78_property_documents_source.sql`), 'dia_db');
});

test('DEPLOY2-coverage (2b): an UNDETERMINED target is UNVERIFIABLE, never defaulted to LCC Opps', () => {
  // `cm_`/`field_`/`property_`-prefixed root files name no database. Fail closed.
  assert.equal(migrationTargetDatabase(`${MIG}/20260818120000_cm_dia_something.sql`), null);
  assert.equal(migrationTargetDatabase(`${MIG}/20260101120000_property_cms_link.sql`), null);
  assert.equal(migrationTargetDatabase(`${MIG}/nested/weird/20260101120000_lcc_x.sql`), null);

  // The finding short-circuits BEFORE any probe result is consulted: even a probe map saying every
  // object is absent must not produce a `critical` when the target is unknown.
  const declared = [{ kind: 'function', name: 'something' }];
  const f = migrationApplicationFinding(`${MIG}/20260818120000_cm_dia_something.sql`, declared, {
    'function:something': false,
  }, { target: null, unverifiableReason: 'target database undetermined' });
  assert.equal(f.severity, 'warn');
  assert.equal(f.measured.verdict, 'unverifiable');
  assert.equal(f.measured.target_database, null);
  assert.match(f.detail, /target database undetermined/);
  assert.match(f.detail, /deliberately NOT probed against LCC Opps/);
});

test('DEPLOY2-coverage: routing maps the three projects by directory AND by filename prefix', () => {
  assert.equal(migrationTargetDatabase(`${MIG}/20261102170000_lcc_n15_sf_campaign_hub_mint.sql`), 'lcc_opps');
  assert.equal(migrationTargetDatabase(`${MIG}/dialysis/20260101120000_anything_at_all.sql`), 'dia_db');
  assert.equal(migrationTargetDatabase(`${MIG}/government/20260101120000_anything_at_all.sql`), 'gov_db');
  // Directory wins over filename for the subdirectories.
  assert.equal(migrationTargetDatabase(`${MIG}/dialysis/20260101120000_gov_named_but_in_dia_dir.sql`), 'dia_db');
});

// The dia probe RPC + the README that stops the two directories looking alike.

test('DEPLOY2-coverage: the dia probe RPC exists, is SECURITY INVOKER, and asserts BOTH grants', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/dialysis/20260916130000_dia_deploy2_migration_probe_rpc.sql', import.meta.url)),
    'utf8',
  );
  assert.match(sql, /create or replace function public\.lcc_probe_schema_objects/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function public\.lcc_probe_schema_objects\(jsonb\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.lcc_probe_schema_objects\(jsonb\) to service_role/i);
  // The anon grant is DELIBERATE and time-bounded — the CI key is the anon JWT today (#720).
  assert.match(sql, /grant execute on function public\.lcc_probe_schema_objects\(jsonb\) to anon/i);
  assert.match(sql, /has_function_privilege\('service_role'/);
  assert.match(sql, /has_function_privilege\('anon'/);
  // `authenticated` is never granted, on either project.
  assert.match(sql, /if has_function_privilege\('authenticated'[\s\S]{0,200}raise exception/);
  // The removal condition must be named in the file, not left to memory.
  assert.match(sql, /#720/);
});

test('DEPLOY2-coverage: dialysis/ has a README stating it is LIVE, and carries no retirement marker', () => {
  const readme = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/dialysis/README.md', import.meta.url)),
    'utf8',
  );
  assert.match(readme, /LIVE/);
  assert.match(readme, /OWNERGAP1/);
  // It must NOT read like government/README.md — the whole point is that they stop looking alike.
  assert.doesNotMatch(readme.split('\n')[0], /HISTORICAL/i);

  const govReadme = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/government/README.md', import.meta.url)),
    'utf8',
  );
  assert.match(govReadme.split('\n')[0], /HISTORICAL/i, 'positive control: the gov README still says historical');
});

test('DEPLOY2-coverage: the collector header no longer claims dialysis/ is a historical copy', () => {
  const collector = readFileSync(
    fileURLToPath(new URL('../scripts/build-brief-collector.mjs', import.meta.url)),
    'utf8',
  );
  // ⚠️ This assertion deliberately does NOT strip comments — the defect WAS a comment, and the
  // correction quotes the false sentence on purpose while explaining it (the B6c-dup guard's
  // problem). So it is resolved by PROXIMITY: the false claim may appear only within 12 lines of
  // a `DEPLOY2-coverage` marker, and a separate assertion pins that the markers exist so the rule
  // cannot go vacuously true.
  const lines = collector.split('\n');
  const markerLines = lines
    .map((l, i) => (/DEPLOY2-coverage/.test(l) ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(markerLines.length >= 3, 'the DEPLOY2-coverage markers must exist');
  lines.forEach((line, i) => {
    if (!/`?dialysis\/`? and `?government\/`? are historical/i.test(line)) return;
    assert.ok(
      markerLines.some((m) => Math.abs(m - i) <= 12),
      `the retracted "dialysis/ is historical" claim at line ${i + 1} must sit inside a DEPLOY2-coverage correction`,
    );
  });
});

test('DEPLOY2-coverage: MIGRATION-COVERAGE-MAP names all three projects and their detector owner', () => {
  const map = readFileSync(
    fileURLToPath(new URL('../docs/architecture/MIGRATION-COVERAGE-MAP.md', import.meta.url)),
    'utf8',
  );
  for (const ref of ['xengecqvemvfknjvbvrq', 'zqzrriwuavgrquhisnoa', 'scknotsqkcheojiaewwh']) {
    assert.match(map, new RegExp(ref), `the coverage map must name project ${ref}`);
  }
  assert.match(map, /GOVDEPLOY1/, 'the uncovered project must be attributed, not quietly absent');
  assert.match(map, /government-lease/);
});
