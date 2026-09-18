#!/usr/bin/env node
/**
 * XB1 — the CTO/CDO build-brief COLLECTOR (deterministic).
 *
 * Scope: docs/architecture/EXEC-BRIEFS-SPEC.md §5,
 * prompts/XB1-XB2-build-brief-collector-and-audit-rules.md. This is the repo-side half — branch
 * debt, orphaned prompts, doc sizes, GENERATED-file edits — because git/filesystem state is not
 * queryable from Postgres. The DB-side half (flag-long-dark, producer-stall-not-flag-gated,
 * market-brief lane staleness) lives in `public.lcc_build_brief_db_audit()`
 * (supabase/migrations/20260915120000_lcc_xb1xb2_build_brief_db_audit.sql). Both write into ONE
 * row of `build_brief_snapshots.audit_flags` — the shape is shared
 * ({rule, severity, subject, measured, detail}) so nothing needs a translation layer.
 *
 * NO dashboard, no Ollama narrative — those are XB3/XB4. This script reports; it never fixes.
 *
 * DEPLOY2-unapplied — merged-but-never-applied MIGRATION detector (added 2026-09-16). Parses the
 * most recent `supabase/migrations/*.sql` window for declared CREATE objects and probes them
 * against the live DB via `lcc_probe_schema_objects` (migration 20260916120100). See the rule's
 * own header comment further down for the full design + the rejected version-number design.
 * DEPLOY2-coverage (2026-09-16) corrected its WINDOW on three axes — git add-date instead of
 * filename sort, `dialysis/` in scope (it is live and owned by THIS repo; only `government/` is
 * retired), and routing by TARGET DATABASE instead of by directory. Which project is covered by
 * which repo's detector: **docs/architecture/MIGRATION-COVERAGE-MAP.md**.
 *
 * ⚠️ BRANCH DEBT IS SCOPED TO WHAT A GITHUB ACTIONS CHECKOUT CAN SEE. Scott's "618 local
 * branches" (docs/os/PLANNED-BACKLOG.md XB2) describes HIS machine's clutter, which a fresh
 * CI clone cannot observe at all — it only has `origin/*` refs. `remote_branch_debt` below
 * therefore reports a DIFFERENT, real population (stale remote branches), never a proxy for the
 * local one. Do not conflate the two numbers when reading a snapshot.
 *
 * ⚠️ ORPHANED-PROMPT MATCHING IS A HEURISTIC, NOT AN ENFORCED CONVENTION (XB2's own finding).
 * The prompt↔response naming link is informal, so this rule matches on the LEADING ID TOKEN(S)
 * of the prompt filename (e.g. "XB1-XB2" from "XB1-XB2-build-brief-....md", "BR1" from
 * "BR1-firm-registry-repair.md") against every response filename, case-insensitively, as a
 * SUBSTRING -- recursively across docs/claude-code/responses/ (not just the top level), so a
 * response filed under responses/done/ or with an unrelated prefix ("MB2b desktop response.docx"
 * for prompt "MB2bc-...") still matches on the shared ID. This is deliberately loose to avoid the
 * exact false positive XB2 already found; it still reports a MISS honestly (severity 'info', not
 * 'warn') because a loose matcher can itself be wrong.
 *
 * Usage:
 *   node scripts/build-brief-collector.mjs                 # dry run, prints findings, no write
 *   node scripts/build-brief-collector.mjs --write          # also POSTs a build_brief_snapshots row
 *
 * Required env for --write: LCC_SUPABASE_URL (or SUPABASE_URL), LCC_SERVICE_ROLE_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diaSupabaseKey } from '../api/_shared/supabase-keys.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Pure functions (exported for the test file -- no fs/git side effects here).
// ---------------------------------------------------------------------------

/**
 * Leading run of ID-shaped hyphen-separated tokens at the start of a filename stem, e.g.
 * "XB1-XB2-build-brief-collector.md" -> ["XB1","XB2"], "BR1-firm-registry-repair.md" -> ["BR1"],
 * "ID3b-owner-duplicate-merge.md" -> ["ID3b"]. An ID-shaped token is 1-6 uppercase letters,
 * optional digits, optional one trailing lowercase letter (XB1, PDR14a, MB2bc). Stops at the
 * first token that doesn't match (the descriptive slug).
 */
export function extractLeadingIds(filename) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const parts = stem.split('-');
  const idTokenRe = /^[A-Z]{1,6}[0-9]*[a-z]?$/;
  const ids = [];
  for (const part of parts) {
    if (idTokenRe.test(part)) {
      ids.push(part);
    } else {
      break;
    }
  }
  return ids;
}

/**
 * For each prompt filename, check whether ANY of its leading ID tokens appears as a
 * case-insensitive substring of ANY response filename. Returns the prompts with NO match.
 * A prompt with no extractable ID is skipped (nothing to match on, not a finding).
 */
export function findOrphanPrompts(promptFilenames, responseFilenames) {
  const lowerResponses = responseFilenames.map((f) => f.toLowerCase());
  const orphans = [];
  for (const promptFile of promptFilenames) {
    const ids = extractLeadingIds(promptFile);
    if (ids.length === 0) continue;
    const matched = ids.some((id) =>
      lowerResponses.some((r) => r.includes(id.toLowerCase())),
    );
    if (!matched) orphans.push({ file: promptFile, ids });
  }
  return orphans;
}

/**
 * A doc-size finding, or null when under the warn ratio. Mirrors test/status-line-budget.test.mjs
 * (LINE_BUDGET=3000, WARN_RATIO=0.8) rather than re-picking a threshold -- the collector reports
 * against the SAME budget the merge gate enforces, never a second number that can drift from it.
 */
export function docSizeFinding(name, lineCount, budget, warnRatio) {
  const warnAt = Math.round(budget * warnRatio);
  if (lineCount < warnAt) return null;
  return {
    rule: 'doc_size_approaching_budget',
    severity: lineCount >= budget ? 'critical' : 'warn',
    subject: name,
    measured: { line_count: lineCount, budget, warn_at: warnAt },
    detail: `${name} is ${lineCount} lines against a ${budget}-line budget (warn at ${warnAt})`,
  };
}

/**
 * Remote branch debt: total origin/* branches vs those unmerged into the default branch.
 * `remoteBranches`/`unmergedBranches` are arrays of branch names (already stripped of
 * 'origin/' and the HEAD pointer). Returns a finding only when there is unmerged debt.
 */
export function remoteBranchDebtFinding(remoteBranches, unmergedBranches) {
  if (unmergedBranches.length === 0) return null;
  return {
    rule: 'remote_branch_debt',
    severity: unmergedBranches.length >= 10 ? 'warn' : 'info',
    subject: 'origin',
    measured: { total_remote_branches: remoteBranches.length, unmerged_count: unmergedBranches.length },
    detail: `${unmergedBranches.length} of ${remoteBranches.length} remote branches are unmerged into the default branch (CI-visible population only -- see file header)`,
  };
}

/**
 * XB2-precision -- `remoteBranchDebtFinding` only fires on UNMERGED count, and that count is
 * frequently 0 or unavailable from a shallow/limited CI checkout (see the file header on
 * `unmergedBranches`) even while the raw branch total is large and growing. The largest single
 * piece of debt this collector can see -- `total_remote` -- was therefore recorded in the raw
 * payload and never surfaced as a finding. This rule reads the total alone, with a growth-rate
 * trend line when a PRIOR snapshot's total is supplied (the trend matters more than the level --
 * see docs/os/PLANNED-BACKLOG.md XB2-precision). `priorTotal`/`priorAt` are optional; when either
 * is absent only the level is reported. Threshold is a documented, not arbitrary, choice: it is
 * scoped to warn-only (never critical) because a branch count alone cannot indicate urgency the
 * way an unmerged count can -- it is a debt LEVEL, not a blocker.
 */
export function branchDebtFinding(totalRemote, { priorTotal = null, priorAt = null, warnAt = 200 } = {}) {
  if (totalRemote < warnAt) return null;
  const measured = { total_remote_branches: totalRemote, warn_at: warnAt };
  let trendDetail = '';
  if (typeof priorTotal === 'number' && Number.isFinite(priorTotal)) {
    const delta = totalRemote - priorTotal;
    measured.prior_total_remote_branches = priorTotal;
    measured.delta_since_prior = delta;
    if (priorAt) measured.prior_at = priorAt;
    trendDetail = ` (${delta >= 0 ? '+' : ''}${delta} since the prior snapshot${priorAt ? ` on ${priorAt}` : ''})`;
  }
  return {
    rule: 'branch_debt',
    severity: 'warn',
    subject: 'origin',
    measured,
    detail: `${totalRemote} remote branches exist on origin${trendDetail} -- see docs/os/PLANNED-BACKLOG.md BRANCH2 for cleanup scope`,
  };
}

/**
 * A GENERATED-header file that changed in this collector's diff window. Informational only --
 * it does not prove a hand-edit, only that the file changed; see the file header for why a
 * stronger claim (re-running the generator and diffing) was deliberately not attempted here.
 */
export function generatedFileChangeFindings(changedFiles, readFile) {
  const findings = [];
  for (const file of changedFiles) {
    let head;
    try {
      head = readFile(file);
    } catch (_e) {
      continue; // deleted file -- nothing to inspect
    }
    if (/^\s*<!--\s*GENERATED\b/m.test(head.slice(0, 200))) {
      findings.push({
        rule: 'generated_file_changed',
        severity: 'info',
        subject: file,
        measured: { changed: true },
        detail: `${file} carries a GENERATED header and changed in this diff -- confirm it was produced by its generator, not hand-edited`,
      });
    }
  }
  return findings;
}

/** Orphan-prompt findings, wrapped in the shared {rule, severity, subject, measured, detail} shape. */
export function orphanPromptFindings(promptFilenames, responseFilenames) {
  return findOrphanPrompts(promptFilenames, responseFilenames).map((o) => ({
    rule: 'prompt_without_matching_response',
    severity: 'info',
    subject: o.file,
    measured: { ids: o.ids },
    detail: `${o.file} (id ${o.ids.join('/')}) has no responses/ filename matching its leading id — heuristic match, see file header`,
  }));
}

// ---------------------------------------------------------------------------
// DEPLOY2-unapplied — migration-merged-but-not-applied detector.
//
// WHY THIS EXISTS: three migrations (HP1-P1a-fix, OWNERGAP1, XB2-precision) merged to `main` and
// were never actually applied to the live database, and nothing said so -- the "merged is not
// running" class this repo has been bitten by repeatedly for CODE (checked via `/version` +
// `git merge-base`), with no equivalent check for MIGRATIONS. This rule is that check's migration
// half. It needs BOTH the migration FILES (filesystem/git state) and the LIVE DATABASE (via the
// `lcc_probe_schema_objects` RPC, migration 20260916120100) -- the exact split this repo's own
// 20260915120000 migration documents ("filesystem state is not queryable from Postgres"), which is
// why this rule lives here and not in the `lcc_build_brief_db_audit()` SQL RPC.
//
// ⚠️ REJECTED DESIGN, DO NOT REVIVE: comparing migration-FILENAME version numbers against
// `supabase_migrations.schema_migrations.version` (the live-applied-migrations table). This
// repo's migration timestamps are SYNTHETIC SEQUENCE NUMBERS, not real clock times -- 885 files,
// only 742 unique version prefixes (98 collisions), and 87 file versions are dated in the FUTURE
// relative to any calendar date they were written on. `schema_migrations` stamps its own
// real-apply-time version, unrelated to the file's number. A version-string-membership check would
// therefore flag nearly every recently-merged migration as "unapplied" -- wrong on its entire
// visible output, exactly the "a detector aimed at the wrong population returns a comfortable
// answer" failure this repo's Class 11 doctrine warns about. The check MUST be content-anchored
// (does the migration's own declared object exist?), never version-anchored.
//
// THE RULE: for each migration file in a bounded recent WINDOW, parse every
// `CREATE [OR REPLACE] FUNCTION|VIEW|TABLE|TRIGGER|INDEX|TYPE|POLICY` statement to find its
// declared "creatable objects" (kind + name), probe each against the live DB, and classify:
//   - APPLIED     -- every declared object is present.
//   - UNAPPLIED   -- at least one declared object is absent. This IS a finding (higher severity).
//   - UNVERIFIABLE -- the migration declares NO creatable object at all (a pure UPDATE/INSERT/
//     ALTER/DROP migration -- exactly OWNERGAP1's and B1's shape). This is ALSO a finding, at
//     LOWER severity, and must NEVER be silently folded into APPLIED -- a data-only backfill that
//     never ran leaves no trace for an existence check to find, which is precisely the failure
//     class this rule exists to catch. Collapsing it into "clean" would defeat the whole point.
//
// ⚠️ KNOWN, DOCUMENTED WEAKNESS -- STATED HERE, NOT HIDDEN: existence is a WEAKER verdict than
// absence. A `CREATE OR REPLACE FUNCTION` of an object that ALREADY EXISTED (from an earlier
// migration) probes as "present" even if THIS migration's redefinition never ran -- this is
// exactly the XB2-precision failure (the function existed, just with the pre-fix body missing a
// GROUP BY). APPLIED here means "this migration's declared objects are not absent", not "this
// migration's current body is live". A stronger body-diff check (normalized
// `pg_get_functiondef()` comparison) was evaluated and NOT shipped -- see STALE_CHECK_NOT_SHIPPED
// below for the measured false-positive rate that disqualified it.
//
// WINDOW (corrected by DEPLOY2-coverage, 2026-09-16): the most recently ADDED-TO-GIT
// MIGRATION_WINDOW_SIZE files across `supabase/migrations/` ROOT **and** `supabase/migrations/
// dialysis/`. A window (not all files) because a migration merged a year ago and never separately
// verified is a different, colder problem than one merged last week and silently unapplied.
//
// ⚠️ THE PREVIOUS HEADER HERE WAS HALF FALSE AND THAT IS WHY IT SURVIVED. It said "`dialysis/`
// and `government/` are historical copies of a database owned by another repo per this repo's own
// ONE REPO OWNS EACH DATABASE'S OBJECTS doctrine". That is TRUE of `government/` -- it carries a
// README, the `HISTORICAL — DO NOT RE-APPLY` marker on every file, and a dedicated guard
// (test/gov-migrations-directory-retired.test.mjs); `government-lease` owns that database. It is
// FALSE of `dialysis/`: 0 of its 282 files carry any retirement marker, it had no README at all
// until DEPLOY2-coverage added one, and CLAUDE.md's own ownership table names THIS repo as the
// owner of Dialysis_DB. The gov retirement was generalized to dia without checking, and the cost
// was exact: `dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql` is
// **OWNERGAP1**, one of the three incidents this rule was built to catch, and the rule could not
// see it.
//
// ⚠️ AND THE WINDOW WAS SORTED BY FILENAME, WHICH IS NOT A CLOCK. This repo's migration timestamps
// are SYNTHETIC SEQUENCE NUMBERS (the REJECTED DESIGN note above measures 98 filename collisions
// and 87 future-dated files) -- so files arrive out of filename order. Measured 2026-09-16: the
// filename-sorted floor was `20260930121500` while 107 migrations had been added in the previous
// 14 days, 64 of them outside that window and 24 of those root-level. Sorting the window by the
// same synthetic timestamp the rule already refused to trust for the APPLIED check is the same
// mistake in a second place. The window is ordered by **git add-date** now
// (`git log --diff-filter=A`), in ONE pass -- never one `git log` per file.
//
// MIGRATION_WINDOW_SIZE is UNCHANGED at 60. The measured add-rate is ~107 migrations per 14 days
// (~7.6/day), so 60 is roughly a one-week horizon -- which is the population this rule targets
// (recent merges), and the same number the rule shipped with, so the before/after delta is
// attributable to the window ORDER and the dia directory rather than to a resized window.
const MIGRATION_WINDOW_SIZE = 60;

/** Repo-relative migration roots this rule scans, and the database each targets by DEFAULT. */
const MIGRATION_ROOT_DIR = 'supabase/migrations';
const MIGRATION_DIA_DIR = 'supabase/migrations/dialysis';
// `supabase/migrations/government/` is deliberately NOT scanned -- it is retired (see that
// directory's README) and re-reading its stale files would report the LIVE, CORRECT government
// database as wrong. See docs/architecture/MIGRATION-COVERAGE-MAP.md for who covers that project.
//
// Exported so the guard can assert the SCANNED SET directly rather than grepping for a directory
// name in source (a grep would match this very comment, which names government/ while explaining
// why it is excluded -- A5c/N18).
export const MIGRATION_SCAN_DIRS = Object.freeze([MIGRATION_ROOT_DIR, MIGRATION_DIA_DIR]);

/**
 * Which database a migration file targets. DEPLOY2-coverage §2b: "root → LCC Opps" is NOT true --
 * 31 root-level migrations carry a `gov_`/`dia_` prefix and target the other two projects
 * (`20260812120000_gov_credit_classifier_expand_state_federal.sql` declares
 * `public.gov_credit_buckets_from_text`, which is ABSENT from LCC Opps). Probing one of those
 * against LCC Opps emits a FALSE `unapplied` at `critical` severity -- the loudest finding on the
 * most trusted rule, about a migration that is perfectly applied to the database it was written
 * for. Today 0 of 60 are in the filename-sorted window; that is luck, and the git-add-date window
 * destroys it.
 *
 * Returns 'lcc_opps' | 'dia_db' | 'gov_db', or **null when the target cannot be determined with
 * confidence**. Null is NOT defaulted to LCC Opps: defaulting is precisely what manufactures the
 * false critical, and a rule that guesses wrong loudly is worse than one that says it does not
 * know (the caller emits UNVERIFIABLE / `target database undetermined`).
 *
 * Directory decides first (a file under `dialysis/` targets Dialysis_DB whatever it is named);
 * otherwise the FIRST token after the numeric timestamp prefix decides, because that is the
 * convention the 31 cross-target root files actually follow.
 */
export function migrationTargetDatabase(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  const base = norm.split('/').pop() || '';
  const dir = norm.slice(0, Math.max(0, norm.length - base.length)).replace(/\/$/, '');

  if (dir === MIGRATION_DIA_DIR) return 'dia_db';
  if (dir === 'supabase/migrations/government') return 'gov_db';
  if (dir !== MIGRATION_ROOT_DIR && dir !== '') return null; // an unknown subdirectory: fail closed

  const m = /^[0-9]+_([a-z0-9]+)/i.exec(base);
  if (!m) return null;
  const token = m[1].toLowerCase();
  if (token === 'lcc') return 'lcc_opps';
  if (token === 'gov' || token === 'government') return 'gov_db';
  if (token === 'dia' || token === 'dialysis') return 'dia_db';
  return null; // e.g. `cm_`, `field_`, `property_` -- genuinely ambiguous, so say so
}

/**
 * Order migration paths newest-first-last (ascending, so `.slice(-N)` takes the newest N) by the
 * date the file was ADDED TO GIT, not by its synthetic filename timestamp.
 *
 * ⚠️ A FILE WITH NO ADD-DATE IS THE NEWEST THING IN THE REPO, NEVER DROPPED. An untracked or
 * brand-new file returns nothing from `git log`; treating that as "no date, skip it" would
 * silently exclude the freshest migration -- P180 (unknown is not zero) on the exact population
 * this rule exists to watch. Undated files sort to the END (i.e. into the window).
 *
 * Ties (two files added in one commit, which is the common case) break on filename for
 * determinism, so two runs over one checkout produce the same window.
 */
export function sortMigrationsByAddDate(files, addDates) {
  const dateOf = (f) => (addDates instanceof Map ? addDates.get(f) : addDates?.[f]) || null;
  return [...files].sort((a, b) => {
    const da = dateOf(a);
    const db = dateOf(b);
    if (da && db) return da === db ? a.localeCompare(b) : da.localeCompare(db);
    if (!da && !db) return a.localeCompare(b);
    return da ? -1 : 1; // the UNDATED one sorts later (newest)
  });
}

// Handles: OR REPLACE (function/view only, harmless elsewhere) · UNIQUE INDEX · CONCURRENTLY ·
// IF NOT EXISTS · an optional schema qualifier (public.foo) that must NOT be captured as the name.
const OBJECT_KIND_RE =
  /create\s+(?:or\s+replace\s+)?(?:unique\s+)?(function|view|table|trigger|index|type|policy)\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;

/**
 * Strip SQL comments (line `--` and block `/* ... *​/`) before scanning, per this repo's standing
 * "strip comments before grepping source" doctrine (A5c/N18/B1) -- a migration's own header prose
 * routinely narrates `CREATE FUNCTION ...` while explaining a DIFFERENT migration's history, which
 * would otherwise be misread as a declared object of THIS file.
 */
export function stripSqlComments(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Parse a migration file's SQL text for declared "creatable objects" -- {kind, name} pairs for
 * every `CREATE [OR REPLACE] FUNCTION|VIEW|TABLE|TRIGGER|INDEX|TYPE|POLICY` statement. `TRIGGER`
 * and `INDEX` never take `OR REPLACE` in Postgres, `CREATE INDEX ... ON <table>` names the index
 * (first identifier after the kind keyword, which the shared regex already captures), and
 * `CREATE TRIGGER <name> ... ON <table>` likewise names the trigger first. Comments are stripped
 * first (see stripSqlComments). Deliberately regex-based, not a full SQL parser -- this repo's own
 * migrations are hand-written and consistent enough that a full parser would be overkill for a
 * detector whose job is "did this file declare an object", not "is this file valid SQL".
 */
export function parseDeclaredObjects(sqlText) {
  const clean = stripSqlComments(sqlText);
  const out = [];
  const seen = new Set();
  let m;
  OBJECT_KIND_RE.lastIndex = 0;
  while ((m = OBJECT_KIND_RE.exec(clean))) {
    const kind = m[1].toLowerCase();
    const name = m[2];
    const key = `${kind}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, name });
  }
  return out;
}

// Mirrors OBJECT_KIND_RE for `DROP FUNCTION|TRIGGER|VIEW|TABLE|INDEX|TYPE|POLICY [IF EXISTS] <name>`.
// `DROP TRIGGER <name> ON <table>` and `DROP INDEX` never take a schema-qualified name ambiguity
// beyond the same optional `schema.` prefix the CREATE regex already strips.
const DROPPED_KIND_RE =
  /drop\s+(function|view|table|trigger|index|type|policy)\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;

/**
 * Parse a migration file's SQL text for `DROP FUNCTION|VIEW|TABLE|TRIGGER|INDEX|TYPE|POLICY`
 * statements -- the retirement counterpart to parseDeclaredObjects. Comments stripped first, same
 * as parseDeclaredObjects. Deliberately permissive about function argument lists (`DROP FUNCTION
 * foo(uuid)` still captures `foo`) since OBJECT_KIND_RE does the same for CREATE.
 */
export function parseDroppedObjects(sqlText) {
  const clean = stripSqlComments(sqlText);
  const out = [];
  const seen = new Set();
  let m;
  DROPPED_KIND_RE.lastIndex = 0;
  while ((m = DROPPED_KIND_RE.exec(clean))) {
    const kind = m[1].toLowerCase();
    const name = m[2];
    const key = `${kind}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, name });
  }
  return out;
}

/**
 * DEPLOY2-drop-aware: build a `"kind:name"` -> retiring-filename map for every object whose
 * LATEST in-window statement (by FILENAME order, never git-add-date -- a migration's own declared
 * intent about a later migration's timestamp is the only ordering that survives synthetic/
 * out-of-order add dates) is a DROP rather than a CREATE. An object retired this way is
 * deliberately superseded (e.g. RECON2 dropping RECON1's guard because the rule it enforced was
 * refined) and must be reported as `retired_by <file>` at info severity, never probed as
 * "unapplied" -- the DEPLOY2-unapplied check would otherwise flag RECON1 critical forever, on
 * every run, for correctly-applied code that a later migration correctly tore down.
 *
 * `fileSqlPairs` is `[filename, sqlText][]` in ANY order -- this function does its own filename
 * sort so caller ordering (e.g. the git-add-date window order) cannot affect the verdict. A CREATE
 * in a later-filenamed file after an earlier DROP re-arms the object (removes it from the map),
 * which is exactly the "DROP precedes CREATE" control this rule must not misclassify.
 */
export function buildRetirementMap(fileSqlPairs) {
  const sorted = [...fileSqlPairs].sort((a, b) => a[0].localeCompare(b[0]));
  const timeline = new Map(); // "kind:name" -> {file, action}[]
  const push = (key, file, action) => {
    if (!timeline.has(key)) timeline.set(key, []);
    timeline.get(key).push({ file, action });
  };
  for (const [file, sql] of sorted) {
    for (const o of parseDeclaredObjects(sql)) push(`${o.kind}:${o.name.toLowerCase()}`, file, 'create');
    for (const o of parseDroppedObjects(sql)) push(`${o.kind}:${o.name.toLowerCase()}`, file, 'drop');
  }
  const retiredBy = new Map();
  for (const [key, events] of timeline) {
    const last = events[events.length - 1];
    if (last.action === 'drop') retiredBy.set(key, last.file);
  }
  return retiredBy;
}

/**
 * The {rule, severity, subject, measured, detail} finding for a declared object this rule is
 * SKIPPING because a later migration retires it (see buildRetirementMap). `info` severity -- this
 * is not a defect, it is the drop-aware check working; it exists so a reader can see WHY an object
 * that looks declared here was never probed, rather than the object silently vanishing from every
 * report.
 */
export function retiredObjectFinding(fileName, kind, name, retiredByFile) {
  return {
    rule: 'migration_object_retired',
    severity: 'info',
    subject: fileName,
    measured: { kind, name, retired_by: retiredByFile },
    detail:
      `${fileName} declares ${kind} ${name}, but a later migration (${retiredByFile}) DROPs it -- ` +
      `treated as deliberately retired, not an unapplied migration (DEPLOY2-drop-aware).`,
  };
}

/**
 * Classify one migration's application state from its declared objects + a map of
 * `"kind:name"` -> boolean|null (probe result; null = unknown kind, never treated as absent).
 *
 * Returns { verdict: 'applied'|'unapplied'|'unverifiable', missing: [{kind,name}] }.
 *
 * UNVERIFIABLE (no declared objects at all) is a DISTINCT verdict from APPLIED -- see the file
 * header. It must never be produced by folding an empty `declared` array into "nothing missing,
 * therefore applied"; that is exactly the silent-success shape this rule exists to prevent.
 */
export function classifyMigrationApplication(declared, existsByKey) {
  if (!declared || declared.length === 0) {
    return { verdict: 'unverifiable', missing: [] };
  }
  const missing = declared.filter((o) => existsByKey[`${o.kind}:${o.name.toLowerCase()}`] === false);
  return { verdict: missing.length > 0 ? 'unapplied' : 'applied', missing };
}

/**
 * Build the {rule, severity, subject, measured, detail} finding for one migration, or null when
 * the migration is APPLIED (no finding -- a clean migration is silent, per this repo's
 * noise-discipline doctrine). UNAPPLIED is 'critical' (a declared object the migration exists to
 * create/redefine is provably absent from the live DB -- HP1-P1a-fix's shape, where deployed code
 * called a non-existent RPC). UNVERIFIABLE is 'warn', explicitly lower, because it is a KNOWN GAP
 * in what this detector can see, not a proven defect -- conflating the two severities would make
 * every ordinary data-only migration in the window read as urgent.
 *
 * DEPLOY2-coverage adds `opts.target` (which database the file targets, per
 * migrationTargetDatabase) and `opts.unverifiableReason`. An UNDETERMINED target short-circuits to
 * UNVERIFIABLE **before any probe result is consulted** -- never defaulted to LCC Opps, because
 * that default is what emits a false `critical` on a `gov_`-prefixed root migration that is
 * correctly applied to the government project.
 */
export function migrationApplicationFinding(fileName, declared, existsByKey, opts = {}) {
  const target = opts.target ?? null;
  const forcedReason = opts.unverifiableReason || null;
  if (forcedReason) {
    return {
      rule: 'migration_unapplied',
      severity: 'warn',
      subject: fileName,
      measured: {
        verdict: 'unverifiable',
        target_database: target,
        unverifiable_reason: forcedReason,
        declared_object_count: Array.isArray(declared) ? declared.length : 0,
      },
      detail:
        `${fileName} could not be checked: ${forcedReason}. Its application state is UNKNOWN from ` +
        `this rule -- NOT a clean bill of health; a check that looks like it ran is the defect this ` +
        `arc exists to close (B6a).` +
        (forcedReason.startsWith('target database undetermined')
          ? ` It is deliberately NOT probed against LCC Opps: defaulting an undetermined target there ` +
            `emits a false "unapplied" at critical severity for a migration that is correctly applied ` +
            `to the database it was written for (DEPLOY2-coverage §2b).`
          : ''),
    };
  }
  const { verdict, missing } = classifyMigrationApplication(declared, existsByKey);
  if (verdict === 'applied') return null;
  if (verdict === 'unverifiable') {
    return {
      rule: 'migration_unapplied',
      severity: 'warn',
      subject: fileName,
      measured: { verdict, target_database: target, declared_object_count: 0 },
      detail:
        `${fileName} declares no probeable object (CREATE FUNCTION/VIEW/TABLE/TRIGGER/INDEX/TYPE/POLICY) -- ` +
        `it is a data-only UPDATE/INSERT/ALTER/DROP migration whose application state is UNKNOWN from this ` +
        `check. This is a known instrument gap, not a clean bill of health -- a backfill migration that never ` +
        `ran leaves no trace an existence probe can find (OWNERGAP1's shape).`,
    };
  }
  return {
    rule: 'migration_unapplied',
    severity: 'critical',
    subject: fileName,
    measured: {
      verdict,
      target_database: target,
      declared_object_count: declared.length,
      missing: missing.map((o) => `${o.kind}:${o.name}`),
    },
    detail:
      `${fileName} declares ${missing.length} of ${declared.length} object(s) that are ABSENT from the live ` +
      `database (${missing.map((o) => `${o.kind} ${o.name}`).join(', ')}) -- this migration is merged to ` +
      `main but was never applied (or was rolled back). Note the mirror-image weakness: an "applied" ` +
      `verdict here means the objects are not absent, never that this migration's CURRENT body is live -- a ` +
      `CREATE OR REPLACE of an already-existing object cannot be distinguished from a stale pre-fix body by ` +
      `existence alone (the XB2-precision shape).`,
  };
}

// STALE_CHECK_NOT_SHIPPED (2026-09-16): a stronger check -- for CREATE OR REPLACE FUNCTION
// migrations, normalize (lowercase + whitespace-collapse) both the file's CREATE FUNCTION body and
// live `pg_get_functiondef()`, and flag a mismatch as a candidate STALE verdict -- was evaluated
// against every CREATE OR REPLACE FUNCTION in the live MIGRATION_WINDOW_SIZE window before
// deciding whether to ship it. It was NOT shipped that day, because the measured false-positive
// cause was Postgres's own canonical type rendering (`timestamptz` -> `timestamp with time zone`)
// producing an unambiguous false STALE on a function that was demonstrably current. Reasoning +
// the extraction failure rate are recorded in docs/os/PLANNED-BACKLOG.md under DEPLOY2-unapplied.
//
// DEPLOY2-live (2026-09-17): the ONE identified false-positive cause -- type-alias rendering --
// is closed below with a small canonicalization table, so the comparator is offered as an
// OPT-IN capability rather than shipped wired into the live probe. It is opt-in on purpose:
// `lcc_probe_schema_objects` (both the LCC Opps and Dialysis_DB deployments) returns only
// `{kind, name, exists}` -- it does not return `pg_get_functiondef()`/`pg_get_viewdef()`, so
// wiring this into the live migration_unapplied rule needs a NEW migration on both projects to
// extend that RPC, which this change does not apply (per the DEPLOY2-live prompt's "do not apply
// anything" constraint). Until that RPC extension ships and is applied, `classifyObjectStaleness`
// is exercised only by its own tests, which is the honest state of "attempted, not wired live" --
// see `docs/os/PLANNED-BACKLOG.md` DEPLOY2-stale for the extension this unblocks.

/**
 * A small, closed table of Postgres canonical type renderings that `pg_get_functiondef()` /
 * `pg_get_viewdef()` use regardless of what the migration file spelled -- e.g. a file that says
 * `RETURNS TABLE(x timestamptz)` is rendered back as `timestamp with time zone`. This is the
 * EXACT, sole cause measured in the 2026-09-16 evaluation (`compute_feed_freshness`); it is not a
 * general fuzzy-matching pass, deliberately -- widening it risks hiding a genuine body change
 * behind a "just another alias" excuse, which is precisely the noise this check must not add.
 */
const SQL_TYPE_ALIASES = Object.freeze([
  [/\btimestamptz\b/g, 'timestamp with time zone'],
  [/\btimestamp\s+with\s+time\s+zone\b/g, 'timestamp with time zone'],
  [/\btimetz\b/g, 'time with time zone'],
  [/\bint4\b/g, 'integer'],
  [/\bint8\b/g, 'bigint'],
  [/\bint2\b/g, 'smallint'],
  [/\bint\b/g, 'integer'],
  [/\bbool\b/g, 'boolean'],
  [/\bvarchar\b/g, 'character varying'],
  [/\bdecimal\b/g, 'numeric'],
  [/\bfloat8\b/g, 'double precision'],
  [/\bfloat4\b/g, 'real'],
  [/\bserial4\b/g, 'integer'],
  [/\bserial8\b/g, 'bigint'],
]);

/**
 * Normalize a SQL function/view body for a STALE-body comparison: strip comments, lowercase,
 * canonicalize the closed type-alias set above, collapse whitespace. NOT a general SQL
 * normalizer -- it exists to make the ONE measured false-positive class comparable, nothing more.
 */
export function normalizeSqlBodyForStaleness(sql) {
  let out = stripSqlComments(String(sql || '')).toLowerCase();
  for (const [pattern, replacement] of SQL_TYPE_ALIASES) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Compare a migration file's declared body for one object against the LIVE definition
 * (`pg_get_functiondef()` / `pg_get_viewdef()` output, supplied by the caller -- this function has
 * no DB access of its own). Returns `'matches'` when the normalized bodies are byte-equal,
 * `'stale-body'` when they differ, or `null` when there is nothing to compare (no live definition
 * supplied, e.g. because the probe RPC does not return one yet -- see the header above). `null` is
 * NEVER folded into `'matches'`: an object this function cannot compare is unproven, not clean,
 * the same P131/P180 discipline the rest of this rule uses everywhere else.
 */
export function classifyObjectStaleness(fileBody, liveDefinition) {
  if (liveDefinition == null) return null;
  const a = normalizeSqlBodyForStaleness(fileBody);
  const b = normalizeSqlBodyForStaleness(liveDefinition);
  if (!a || !b) return null;
  return a === b ? 'matches' : 'stale-body';
}

// ---------------------------------------------------------------------------
// Repo-side collection (fs + git). Only called from main(), never imported by tests.
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function listFilesShallow(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && exts.some((e) => d.name.toLowerCase().endsWith(e)))
    .map((d) => d.name);
}

function listFilesRecursive(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, exts).map((f) => path.join(entry.name, f)));
    } else if (exts.some((e) => entry.name.toLowerCase().endsWith(e))) {
      out.push(entry.name);
    }
  }
  return out;
}

function collectRepoFindings() {
  const findings = [];
  const raw = {};

  // -- git sha / commit context --
  let commitSha = null;
  try {
    commitSha = git(['rev-parse', 'HEAD']);
  } catch (_e) {
    /* not a git checkout (shouldn't happen in CI); leave null */
  }

  // -- branch debt (origin/* only -- see file header) --
  try {
    const remoteRaw = git(['branch', '-r']).split('\n').map((l) => l.trim()).filter(Boolean);
    const remoteBranches = remoteRaw
      .filter((l) => !l.includes('->'))
      .map((l) => l.replace(/^origin\//, ''));
    let unmergedBranches = [];
    try {
      const base = git(['symbolic-ref', 'refs/remotes/origin/HEAD']).replace('refs/remotes/', '');
      unmergedBranches = git(['branch', '-r', '--no-merged', base])
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.includes('->'))
        .map((l) => l.replace(/^origin\//, ''));
    } catch (_e) {
      /* default branch ref unavailable in this checkout depth -- skip unmerged count */
    }
    raw.branches = { total_remote: remoteBranches.length, unmerged: unmergedBranches.length };
    const f = remoteBranchDebtFinding(remoteBranches, unmergedBranches);
    if (f) findings.push(f);
  } catch (e) {
    raw.branches_error = String(e.message || e);
  }

  // -- orphaned prompts --
  const promptDir = path.join(REPO_ROOT, 'docs', 'claude-code', 'prompts');
  const responseDir = path.join(REPO_ROOT, 'docs', 'claude-code', 'responses');
  const promptFiles = listFilesShallow(promptDir, ['.md']);
  const responseFiles = listFilesRecursive(responseDir, ['.md', '.docx']).filter(
    (f) => path.basename(f).toLowerCase() !== 'readme.md',
  );
  raw.prompts = { open: promptFiles.length, responses_indexed: responseFiles.length };
  findings.push(...orphanPromptFindings(promptFiles, responseFiles));

  // -- doc sizes --
  const statusPath = path.join(REPO_ROOT, 'docs', 'claude-code', 'STATUS.md');
  const backlogPath = path.join(REPO_ROOT, 'docs', 'os', 'PLANNED-BACKLOG.md');
  for (const [name, p] of [['STATUS.md', statusPath], ['PLANNED-BACKLOG.md', backlogPath]]) {
    if (!fs.existsSync(p)) continue;
    const lineCount = fs.readFileSync(p, 'utf8').split('\n').length;
    raw[`doc_size_${name}`] = lineCount;
    const f = docSizeFinding(name, lineCount, 3000, 0.8);
    if (f) findings.push(f);
  }

  // -- GENERATED-file edits in the last commit (push trigger) or working diff (manual run) --
  try {
    let changed = [];
    try {
      changed = git(['diff', '--name-only', 'HEAD~1', 'HEAD']).split('\n').filter(Boolean);
    } catch (_e) {
      changed = git(['diff', '--name-only']).split('\n').filter(Boolean);
    }
    raw.changed_files_in_window = changed.length;
    findings.push(
      ...generatedFileChangeFindings(changed, (f) =>
        fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'),
      ),
    );
  } catch (e) {
    raw.generated_file_check_error = String(e.message || e);
  }

  return { commitSha, findings, raw };
}

/**
 * ONE `git log` pass over `supabase/migrations` producing relPath -> ISO add-date. Never one
 * `git log` per file -- 1,100+ files x one subprocess each is a different kind of defect.
 *
 * Returns {dates, degraded, reason}. ⚠️ `degraded` is NOT silent: if git history is unavailable
 * (no `.git`, a shallow clone with no history for these paths, git not on PATH) the caller FALLS
 * BACK to filename sort **and says so on the snapshot** (B6a: a skipped step must EMIT, not
 * vanish). A degraded window that looks identical to a healthy one is exactly how this defect
 * survived its own review.
 *
 * ⚠️ A SHALLOW CLONE REPORTS THE GRAFT BOUNDARY AS THE "ADD" for every file older than the
 * boundary (CLAUDE.md, entity-identity section). CI checks out with `fetch-depth: 0` so this is
 * accurate there; a shallow checkout is reported as `shallow_clone` in the degraded reason so a
 * reader never mistakes graft-boundary dates for real ones.
 */
function buildMigrationAddDates() {
  let shallow = false;
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
  } catch (_e) {
    /* not fatal -- fall through and let the log attempt decide */
  }
  let raw;
  try {
    raw = git([
      'log',
      '--diff-filter=A',
      '--name-only',
      '--format=%H%x09%aI',
      '--',
      MIGRATION_ROOT_DIR,
    ]);
  } catch (e) {
    return { dates: new Map(), degraded: true, reason: `git_log_unavailable:${String(e.message || e).slice(0, 120)}` };
  }
  const dates = new Map();
  let current = null;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const header = /^[0-9a-f]{7,40}\t(.+)$/i.exec(t);
    if (header) {
      current = header[1];
      continue;
    }
    if (t.startsWith(`${MIGRATION_ROOT_DIR}/`) && !dates.has(t)) dates.set(t, current);
  }
  if (dates.size === 0) {
    return { dates, degraded: true, reason: 'git_log_returned_no_adds' };
  }
  return {
    dates,
    degraded: shallow,
    reason: shallow ? 'shallow_clone_add_dates_are_graft_boundary' : null,
  };
}

/**
 * The most recently ADDED-TO-GIT MIGRATION_WINDOW_SIZE files across the root and `dialysis/`
 * directories (see the corrected DEPLOY2-unapplied header above for why both, and why add-date
 * rather than filename). `government/` is excluded on purpose -- it is retired and re-reading its
 * stale files would report the live, correct government database as wrong.
 *
 * Returns {files, windowDegraded, windowDegradedReason, scanned} -- `files` are repo-relative
 * paths, so every downstream consumer routes on the same string `migrationTargetDatabase` reads.
 */
function listRecentMigrationFiles() {
  const dirs = MIGRATION_SCAN_DIRS;
  const all = [];
  for (const rel of dirs) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (d.isFile() && d.name.toLowerCase().endsWith('.sql')) all.push(`${rel}/${d.name}`);
    }
  }
  const { dates, degraded, reason } = buildMigrationAddDates();
  const ordered = degraded && dates.size === 0 ? [...all].sort() : sortMigrationsByAddDate(all, dates);
  return {
    files: ordered.slice(-MIGRATION_WINDOW_SIZE),
    windowDegraded: Boolean(degraded),
    windowDegradedReason: reason,
    scanned: all.length,
  };
}

// ---------------------------------------------------------------------------
// DB-side collection.
// ---------------------------------------------------------------------------

async function collectDbFindings() {
  const url = process.env.LCC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.LCC_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { findings: [], skipped: true, reason: 'no_lcc_credentials' };
  }
  const res = await fetch(`${url}/rest/v1/rpc/lcc_build_brief_db_audit`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    return { findings: [], skipped: true, reason: `rpc_http_${res.status}` };
  }
  const findings = await res.json();
  return { findings: Array.isArray(findings) ? findings : [], skipped: false };
}

/**
 * DEPLOY2-unapplied. Parses the recent migration WINDOW's declared objects, probes them in ONE
 * batch against `lcc_probe_schema_objects` (migration 20260916120100), and returns
 * {findings, migrations_checked, unapplied_count, unverifiable_count}. Fails soft on any DB error
 * (no creds, RPC unreachable) -- returns skipped:true with a reason, same contract as
 * collectDbFindings, because this collector must never crash the whole build brief over one rule.
 */
async function probeProject(url, key, objects) {
  if (objects.length === 0) return { ok: true, existsByKey: {} };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/lcc_probe_schema_objects`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_objects: objects }),
    });
    if (!res.ok) {
      // ⚠️ NEVER read an authorization failure as "no objects missing". The dia key resolved by
      // diaSupabaseKey() may be the anon JWT (#720 -- the names lie), so a 401/403 is a live
      // possibility and must surface as a SKIP carrying the status, not as a clean probe.
      return { ok: false, reason: `probe_rpc_http_${res.status}` };
    }
    const rows = await res.json();
    const existsByKey = {};
    for (const r of rows) existsByKey[`${r.kind}:${String(r.name).toLowerCase()}`] = r.exists;
    return { ok: true, existsByKey };
  } catch (e) {
    return { ok: false, reason: `probe_rpc_error:${String(e.message || e).slice(0, 160)}` };
  }
}

async function collectMigrationApplicationFindings(projects) {
  const { files, windowDegraded, windowDegradedReason, scanned } = listRecentMigrationFiles();

  // Read every file's SQL once, up front -- needed both for declared-object parsing below and for
  // the drop-aware retirement timeline (DEPLOY2-drop-aware), which must see every file in the
  // window regardless of which file a given object happens to be declared in.
  const fileSqlPairs = [];
  for (const file of files) {
    try {
      fileSqlPairs.push([file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')]);
    } catch (_e) {
      // unreadable file -- skip rather than crash the whole rule
    }
  }
  const retiredBy = buildRetirementMap(fileSqlPairs);
  const retiredFindings = [];

  // Group the window by TARGET DATABASE before probing anything (DEPLOY2-coverage §2b).
  const perFile = new Map(); // relPath -> {declared, target}
  const byTarget = new Map(); // target -> {objects, seen}
  for (const [file, sql] of fileSqlPairs) {
    const allDeclared = parseDeclaredObjects(sql);
    const target = migrationTargetDatabase(file);
    // Split out any object whose latest in-window statement (by filename order, anywhere in the
    // window) is a DROP -- it is deliberately retired, not unapplied, and must never be probed as
    // "unapplied" nor silently disappear (DEPLOY2-drop-aware).
    const declared = [];
    for (const o of allDeclared) {
      const key = `${o.kind}:${o.name.toLowerCase()}`;
      const retiringFile = retiredBy.get(key);
      if (retiringFile && retiringFile !== file) {
        retiredFindings.push(retiredObjectFinding(file, o.kind, o.name, retiringFile));
      } else {
        declared.push(o);
      }
    }
    perFile.set(file, { declared, target });
    if (!target) continue; // undetermined: never probed anywhere
    if (!byTarget.has(target)) byTarget.set(target, { objects: [], seen: new Set() });
    const bucket = byTarget.get(target);
    for (const o of declared) {
      const k = `${o.kind}:${o.name.toLowerCase()}`;
      if (bucket.seen.has(k)) continue;
      bucket.seen.add(k);
      bucket.objects.push(o);
    }
  }

  // Probe each project independently. A project that cannot be reached SKIPS ITS OWN FILES with a
  // named reason -- it never silently reduces to "root only, all clean" (B6a).
  const existsByTarget = {};
  const projectStatus = {};
  for (const [target, bucket] of byTarget) {
    const proj = projects[target];
    if (!proj || !proj.url || !proj.key) {
      projectStatus[target] = { skipped: true, reason: proj?.absentReason || `no_${target}_credentials` };
      continue;
    }
    const r = await probeProject(proj.url, proj.key, bucket.objects);
    if (!r.ok) {
      projectStatus[target] = { skipped: true, reason: r.reason };
      continue;
    }
    existsByTarget[target] = r.existsByKey;
    projectStatus[target] = { skipped: false, objects_probed: bucket.objects.length };
  }

  const findings = [];
  const counts = { unapplied: 0, unverifiable: 0, applied: 0 };
  const byTargetCounts = {};
  for (const [file, { declared, target }] of perFile) {
    const bump = (k) => {
      byTargetCounts[target || 'undetermined'] = byTargetCounts[target || 'undetermined'] || {
        checked: 0,
        unapplied: 0,
        unverifiable: 0,
        applied: 0,
      };
      byTargetCounts[target || 'undetermined'].checked += 1;
      if (k) byTargetCounts[target || 'undetermined'][k] += 1;
    };
    let reason = null;
    if (!target) {
      reason = 'target database undetermined';
    } else if (target === 'gov_db') {
      // The government project is owned by `government-lease` and has no detector here by
      // decision (GOVDEPLOY1). Saying so is the point -- see MIGRATION-COVERAGE-MAP.md.
      reason = 'target database is the government project, which this repo does not audit (GOVDEPLOY1)';
    } else if (projectStatus[target]?.skipped) {
      reason = `probe skipped for ${target}: ${projectStatus[target].reason}`;
    }
    const f = migrationApplicationFinding(file, declared, existsByTarget[target] || {}, {
      target,
      unverifiableReason: reason,
    });
    if (!f) {
      counts.applied += 1;
      bump('applied');
      continue;
    }
    findings.push(f);
    if (f.measured.verdict === 'unapplied') counts.unapplied += 1;
    else counts.unverifiable += 1;
    bump(f.measured.verdict);
  }

  return {
    findings: [...findings, ...retiredFindings],
    skipped: false,
    migrations_checked: perFile.size,
    migrations_available: scanned,
    unapplied_count: counts.unapplied,
    unverifiable_count: counts.unverifiable,
    applied_count: counts.applied,
    retired_count: retiredFindings.length,
    by_target: byTargetCounts,
    project_status: projectStatus,
    window_degraded: windowDegraded,
    window_degraded_reason: windowDegradedReason,
  };
}

/**
 * Best-effort lookup of the prior snapshot's `payload.branches.total_remote`, for the
 * branch_debt trend line. Returns { total, at } or null -- silently, on any failure (no creds,
 * network, missing prior row, malformed payload) -- because the LEVEL finding must still fire
 * without a trend; this is a nice-to-have, never a blocker.
 */
async function fetchPriorBranchTotal(url, key) {
  try {
    const res = await fetch(
      `${url}/rest/v1/build_brief_snapshots?select=payload,created_at&order=created_at.desc&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const total = rows?.[0]?.payload?.branches?.total_remote;
    if (typeof total !== 'number' || !Number.isFinite(total)) return null;
    return { total, at: rows[0].created_at };
  } catch (_e) {
    return null;
  }
}

async function writeSnapshot(url, key, payload) {
  const res = await fetch(`${url}/rest/v1/build_brief_snapshots`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`build_brief_snapshots insert failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function printFindingsTable(findings) {
  const bySeverity = { critical: 0, warn: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  console.log(
    `\n${findings.length} findings — critical:${bySeverity.critical || 0} warn:${bySeverity.warn || 0} info:${bySeverity.info || 0}\n`,
  );
  const order = { critical: 0, warn: 1, info: 2 };
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  for (const f of sorted) {
    console.log(`[${f.severity.toUpperCase().padEnd(8)}] ${f.rule.padEnd(34)} ${f.subject}`);
    console.log(`           ${f.detail}`);
  }
}

async function main() {
  const write = process.argv.includes('--write');
  // DEPLOY2-live: a dedicated CI job (`.github/workflows/deploy2-unapplied-check.yml`) runs the
  // collector with this flag on every push to `main` and fails the JOB (never the merge -- this
  // runs after the fact) when the migration_unapplied rule finds a real UNAPPLIED verdict. It is
  // additive: `--write` and the default dry-run path are both unaffected, and this never changes
  // `process.exitCode` unless the caller explicitly asked for it.
  const failOnUnapplied = process.argv.includes('--fail-on-unapplied');

  const repo = collectRepoFindings();
  const db = await collectDbFindings();
  // DEPLOY2-coverage: one project descriptor per target database. The dia key goes through the
  // SHARED resolver `diaSupabaseKey()` (api/_shared/supabase-keys.js, GitHub issue #720) rather
  // than reading an env var directly -- `DIA_SUPABASE_KEY` historically holds the ANON JWT and is
  // scheduled for a Phase 4 mass-revoke, while `DIA_SUPABASE_SERVICE_KEY` does not exist yet, so
  // hardcoding either name is wrong in one direction or the other. The resolver prefers the
  // service key and falls back to the anon one, which makes this rule upgrade itself the day
  // Scott sets the service key, with no second change here.
  const migrationProjects = {
    lcc_opps: {
      url: process.env.LCC_SUPABASE_URL || process.env.SUPABASE_URL,
      key: process.env.LCC_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      absentReason: 'no_lcc_credentials',
    },
    dia_db: {
      url: process.env.DIA_SUPABASE_URL,
      key: diaSupabaseKey(),
      absentReason: 'no_dia_credentials (DIA_SUPABASE_URL / DIA_SUPABASE_SERVICE_KEY|DIA_SUPABASE_KEY)',
    },
    // gov_db intentionally absent -- GOVDEPLOY1 / docs/architecture/MIGRATION-COVERAGE-MAP.md.
  };
  const migrationAudit = await collectMigrationApplicationFindings(migrationProjects);
  const findings = [...repo.findings, ...db.findings, ...migrationAudit.findings];
  repo.raw.migration_audit = {
    migrations_checked: migrationAudit.migrations_checked,
    migrations_available: migrationAudit.migrations_available,
    unapplied_count: migrationAudit.unapplied_count,
    unverifiable_count: migrationAudit.unverifiable_count,
    applied_count: migrationAudit.applied_count,
    by_target: migrationAudit.by_target,
    project_status: migrationAudit.project_status,
    window_degraded: migrationAudit.window_degraded,
    window_degraded_reason: migrationAudit.window_degraded_reason,
  };

  // branch_debt (XB2-precision) reads the raw total collectRepoFindings already gathered; the
  // trend needs a DB round trip repo collection cannot make, so it is added here with the same
  // best-effort creds collectDbFindings already resolved.
  const url = process.env.LCC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.LCC_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const totalRemote = repo.raw?.branches?.total_remote;
  if (typeof totalRemote === 'number') {
    const prior = url && key ? await fetchPriorBranchTotal(url, key) : null;
    const f = branchDebtFinding(totalRemote, { priorTotal: prior?.total ?? null, priorAt: prior?.at ?? null });
    if (f) findings.push(f);
  }

  printFindingsTable(findings);

  if (db.skipped) {
    console.log(`\n(DB-side rules skipped: ${db.reason})`);
  }
  console.log(
    `(migration_unapplied: checked ${migrationAudit.migrations_checked} of ` +
      `${migrationAudit.migrations_available} migrations -- ${migrationAudit.unapplied_count} unapplied, ` +
      `${migrationAudit.unverifiable_count} unverifiable, ${migrationAudit.applied_count} applied)`,
  );
  for (const [target, c] of Object.entries(migrationAudit.by_target || {})) {
    console.log(
      `   ${target.padEnd(14)} checked:${c.checked} applied:${c.applied} unapplied:${c.unapplied} unverifiable:${c.unverifiable}`,
    );
  }
  for (const [target, s] of Object.entries(migrationAudit.project_status || {})) {
    if (s.skipped) console.log(`   ⚠️ ${target} probe SKIPPED: ${s.reason}`);
  }
  if (migrationAudit.window_degraded) {
    console.log(`   ⚠️ migration window DEGRADED: ${migrationAudit.window_degraded_reason}`);
  }

  if (write) {
    const url = process.env.LCC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.LCC_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('--write requires LCC_SUPABASE_URL/LCC_SERVICE_ROLE_KEY (or SUPABASE_* equivalents)');
      process.exitCode = 1;
      return;
    }
    const payload = {
      commit_sha: repo.commitSha,
      payload: repo.raw,
      audit_flags: findings,
    };
    const row = await writeSnapshot(url, key, payload);
    console.log(`\nWrote build_brief_snapshots row id=${row?.[0]?.id ?? '?'}`);
  }

  // DEPLOY2-live: fail the JOB (not the merge -- this always runs after the merge already
  // happened) on a genuine UNAPPLIED verdict. UNVERIFIABLE never fails the job -- it is a known
  // instrument gap (a data-only migration this rule cannot probe), not a proven defect, and
  // failing on it would make the job noisy on every ordinary backfill migration, exactly the
  // "a monitor nobody trusts is worse than none" trap this file's own header warns about
  // elsewhere. A skipped project probe (no credentials, RPC unreachable) also never fails the
  // job on its own -- it already surfaces as an UNVERIFIABLE finding above, which is loud enough.
  if (failOnUnapplied && migrationAudit.unapplied_count > 0) {
    console.error(
      `\n❌ DEPLOY2: ${migrationAudit.unapplied_count} migration(s) merged to main are UNAPPLIED ` +
        `on their target database. See the table above. Apply the missing objects from the repo ` +
        `file with a fingerprint, then re-run.`,
    );
    process.exitCode = 1;
  }
}

// Windows-safe main-guard (OCR1 doctrine) -- compare resolved file:// URLs, never a
// string-built 'file://' + argv[1], which never matches on Windows.
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
