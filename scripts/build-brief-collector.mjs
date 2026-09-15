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

  const repo = collectRepoFindings();
  const db = await collectDbFindings();
  const findings = [...repo.findings, ...db.findings];

  printFindingsTable(findings);

  if (db.skipped) {
    console.log(`\n(DB-side rules skipped: ${db.reason})`);
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
