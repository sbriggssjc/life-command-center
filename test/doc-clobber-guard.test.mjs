/**
 * Guard: docs/claude-code/STATUS.md and docs/os/PLANNED-BACKLOG.md must never be silently
 * reverted to an older snapshot by a PR.
 *
 * WHY THIS EXISTS (GUARD-CLOBBER1, 2026-09-17)
 * PR #2563 (a Claude Code session, `docs/hcris-timeout-7-verify`) had `main` as its parent but
 * committed whole-file contents of STATUS.md and PLANNED-BACKLOG.md taken from SEVEN Cowork
 * rounds earlier, plus its own two real edits on top. Because the branch's own copy of both
 * files was already stale when the session started editing them, git saw no conflict — the merge
 * was clean and CI was green. Net effect on `main`: 7 STATUS.md `## ` entries deleted, 11
 * PLANNED-BACKLOG.md rows deleted outright, and 84 more rows silently reverted to week-old text
 * (every pointer and ✅ added since was gone). This is the SECOND time this exact shape has
 * happened (the first, PR #2537 round 8, came from a Cowork script and was fixed on that side —
 * see PROCESS-MERGE-CLOBBER) and no guard existed to catch either direction. The existing guards
 * (status-header-integrity, status-line-budget, backlog-id-uniqueness) check the file's shape,
 * not whether content present at the merge base survived to HEAD.
 *
 * WHAT THIS GUARD DOES: compares the PR head against the merge base with the target branch and
 * fails if either file lost a STATUS.md `## ` heading, an Open-threads table row, a
 * PLANNED-BACKLOG.md row id, or had a backlog row's Item text truncated (a strict prefix of what
 * it was at the base — the append-only loop never shortens a row, so a shorter Item is the
 * signature of an older snapshot landing on top of a newer one).
 *
 * THE FIX WHEN THIS GOES RED:
 *   A CC round must edit STATUS.md / PLANNED-BACKLOG.md only by inserting its own entry and
 *   editing its own rows in the file AS IT IS on `origin/main` at commit time — never from a copy
 *   read earlier in the session. If the branch is behind, rebase/merge `origin/main` in first,
 *   re-apply your edit on top of the current file, and re-run this guard before pushing. See
 *   `docs/os/BUILD-TURN-PROTOCOL.md` ⑤-CC and `docs/claude-code/README.md`.
 *
 * THE FIX IF A ROW GENUINELY NEEDS TO GO:
 *   - SHIPPED (✅, nothing owed): move the row VERBATIM (byte-identical line) into a
 *     `docs/history/PLANNED-BACKLOG_shipped_<date>.md` archive in the SAME commit that removes it,
 *     and make sure CURRENT-STATE.md describes it or carries a one-line pointer (DOCMAP3,
 *     2026-09-24; DOCUMENTATION-MAP.md §3/§4). That is the one form of "row id disappeared" this
 *     guard allows (see BACKLOG_ARCHIVE_PREFIX). A reworded or truncated archive copy does NOT
 *     count — the exemption compares the whole table line.
 *   - Anything else (retired, refuted, duplicate): strike it (`~~text~~`) with a one-line reason
 *     instead of deleting it — see backlog-id-uniqueness.test.mjs's own repair procedure for the
 *     collision vs. restatement distinction. A genuinely archived STATUS span moves verbatim into
 * `docs/history/STATUS_claude-code_*.md` in the SAME commit that removes it from STATUS.md —
 * that is the one form of "heading disappeared" this guard allows (see ARCHIVE_HEADING_EXEMPT).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_PATH = 'docs/claude-code/STATUS.md';
const BACKLOG_PATH = 'docs/os/PLANNED-BACKLOG.md';
const ARCHIVE_DIR_PREFIX = 'docs/history/STATUS_claude-code_';
// DOCMAP3 (2026-09-24): the one legitimate way a backlog row id disappears — moved verbatim here.
const BACKLOG_ARCHIVE_PREFIX = 'PLANNED-BACKLOG_shipped_';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// Resolve the commit to diff against. In CI, GUARD_CLOBBER_BASE_SHA is set to the PR's real
// base sha (github.event.pull_request.base.sha) — the merge-base with the branch this PR will
// land on, which is what a silently-reverted snapshot must be compared against. Locally, or on
// `main` itself, fall back to merge-base with origin/main, then HEAD~1.
function resolveBaseSha() {
  const fromEnv = process.env.GUARD_CLOBBER_BASE_SHA;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  tryGit(['fetch', '--no-tags', '--depth=200', 'origin', 'main']);
  const mergeBase = tryGit(['merge-base', 'HEAD', 'origin/main']);
  if (mergeBase) return mergeBase.trim();

  const parent = tryGit(['rev-parse', 'HEAD~1']);
  if (parent) return parent.trim();

  return null;
}

function readAtCommit(sha, path) {
  const out = tryGit(['show', `${sha}:${path}`]);
  return out; // null if the file/commit doesn't exist there
}

function parseStatusHeadings(text) {
  return text.split('\n').filter((l) => l.startsWith('## '));
}

// Mirrors STATUS.md's Open-threads table shape: a row's first cell is a bold thread label,
// e.g. `| **Identity / operator canonicalization (ID-series)** | ... |`.
function parseOpenThreadRows(text) {
  const ids = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 3) continue;
    const first = cells[1].trim();
    const m = /^\*\*(.+)\*\*$/.exec(first);
    if (m) ids.push(m[1]);
  }
  return ids;
}

// Mirrors backlog-id-uniqueness.test.mjs's row-id parser, plus captures the second cell (Item)
// for the truncation check.
const ID_CELL_RE = /^[^\w*]*(\*{0,2})([A-Za-z][A-Za-z0-9_-]{0,60})\1(\s*\([^)]*\))?[^\w]*$/u;
const HEADER_CELL_NAMES = new Set(['item', 'state', 'source', 'notes', 'number', '#']);

function parseBacklogRows(text) {
  const rows = new Map(); // id -> item text (first occurrence)
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 3) continue;
    const firstCell = cells[1].trim();
    const m = ID_CELL_RE.exec(firstCell);
    if (!m) continue;
    const idText = m[2] + (m[3] ? m[3].trim() : '');
    if (HEADER_CELL_NAMES.has(idText.toLowerCase())) continue;
    if (/^:?-{2,}:?$/.test(firstCell.replace(/\*/g, ''))) continue;
    if (!rows.has(idText)) rows.set(idText, (cells[2] || '').trim());
  }
  return rows;
}

// id -> the full table line of its first occurrence (for the verbatim-archive exemption).
function parseBacklogRowLines(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 3) continue;
    const firstCell = cells[1].trim();
    const m = ID_CELL_RE.exec(firstCell);
    if (!m) continue;
    const idText = m[2] + (m[3] ? m[3].trim() : '');
    if (HEADER_CELL_NAMES.has(idText.toLowerCase())) continue;
    if (!rows.has(idText)) rows.set(idText, line);
  }
  return rows;
}

export function listBacklogArchiveFiles(root = ROOT) {
  const dir = join(root, 'docs', 'history');
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(BACKLOG_ARCHIVE_PREFIX) && f.endsWith('.md'))
      .map((f) => `docs/history/${f}`);
  } catch {
    return [];
  }
}

// Returns the ids from `missing` that are NOT archived verbatim (whole base line present as a
// line of some archive text). Exported for the positive control below.
export function unarchivedBacklogIds(missing, baseLines, archiveTexts) {
  const archivedLines = new Set();
  for (const t of archiveTexts) for (const l of t.split('\n')) archivedLines.add(l);
  return missing.filter((id) => !archivedLines.has(baseLines.get(id)));
}

function listArchiveFiles() {
  const dir = join(ROOT, 'docs', 'history');
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith('STATUS_claude-code_'))
      .map((f) => `docs/history/${f}`);
  } catch {
    return [];
  }
}

describe('STATUS.md / PLANNED-BACKLOG.md cannot be silently reverted (GUARD-CLOBBER1)', () => {
  const baseSha = resolveBaseSha();

  it('resolved a base commit to diff against (setup sanity check)', () => {
    // If this fails, every other assertion below would vacuously pass by finding no baseline —
    // fail loudly instead so the guard's absence is visible, not silent.
    assert.ok(
      baseSha,
      'doc-clobber-guard could not resolve a base commit (no GUARD_CLOBBER_BASE_SHA env, no ' +
      'origin/main, no HEAD~1). This guard cannot run without a baseline to diff against.',
    );
  });

  if (!baseSha) return;

  const baseStatus = readAtCommit(baseSha, STATUS_PATH);
  const headStatus = readAtCommit('HEAD', STATUS_PATH);
  const baseBacklog = readAtCommit(baseSha, BACKLOG_PATH);
  const headBacklog = readAtCommit('HEAD', BACKLOG_PATH);

  it('STATUS.md and PLANNED-BACKLOG.md exist at both the base and HEAD commits (setup sanity check)', () => {
    assert.ok(baseStatus !== null, `${STATUS_PATH} not found at base commit ${baseSha}`);
    assert.ok(headStatus !== null, `${STATUS_PATH} not found at HEAD`);
    assert.ok(baseBacklog !== null, `${BACKLOG_PATH} not found at base commit ${baseSha}`);
    assert.ok(headBacklog !== null, `${BACKLOG_PATH} not found at HEAD`);
  });

  if (baseStatus === null || headStatus === null || baseBacklog === null || headBacklog === null) return;

  it('every STATUS.md "## " entry present at the base is still present at HEAD (or was archived verbatim)', () => {
    const baseHeadings = new Set(parseStatusHeadings(baseStatus));
    const headHeadings = new Set(parseStatusHeadings(headStatus));
    const missing = [...baseHeadings].filter((h) => !headHeadings.has(h));
    if (missing.length === 0) return;

    // The one legitimate way a heading disappears: this commit both removes it from STATUS.md
    // AND adds/extends a docs/history/STATUS_claude-code_*.md archive file carrying it verbatim.
    const archiveFiles = listArchiveFiles();
    const stillMissing = missing.filter((heading) => {
      for (const path of archiveFiles) {
        const archived = readAtCommit('HEAD', path);
        if (archived && archived.includes(heading)) return false;
      }
      return true;
    });

    assert.deepEqual(
      stillMissing,
      [],
      `${STATUS_PATH} lost ${stillMissing.length} entry heading(s) between the base commit ` +
      `(${baseSha}) and HEAD, and none was found verbatim in a docs/history/STATUS_claude-code_*.md ` +
      `archive file:\n${stillMissing.map((h) => `  ${h}`).join('\n')}\n\n` +
      `This is the GUARD-CLOBBER1 shape: a branch edited a stale local copy of STATUS.md instead ` +
      `of the current file on origin/main. Rebase onto origin/main, re-apply your entry on top of ` +
      `the CURRENT file, and re-run this guard. If an entry is genuinely being archived, move its ` +
      `text verbatim into docs/history/STATUS_claude-code_*.md in this same commit.`,
    );
  });

  it('every Open-threads table row present at the base is still present at HEAD', () => {
    const baseRows = new Set(parseOpenThreadRows(baseStatus));
    const headRows = new Set(parseOpenThreadRows(headStatus));
    const missing = [...baseRows].filter((r) => !headRows.has(r));
    assert.deepEqual(
      missing,
      [],
      `${STATUS_PATH}'s Open-threads table lost ${missing.length} row(s) between the base commit ` +
      `(${baseSha}) and HEAD:\n${missing.map((r) => `  ${r}`).join('\n')}\n\n` +
      `A thread row's text may change; it must not disappear. See this file's header for the fix.`,
    );
  });

  it('every PLANNED-BACKLOG.md row id present at the base is still present at HEAD (or was archived verbatim)', () => {
    const baseRows = parseBacklogRows(baseBacklog);
    const headRows = parseBacklogRows(headBacklog);
    const missing = [...baseRows.keys()].filter((id) => !headRows.has(id));
    const archiveTexts = listBacklogArchiveFiles()
      .map((p) => readAtCommit('HEAD', p))
      .filter((t) => t !== null);
    const stillMissing = unarchivedBacklogIds(missing, parseBacklogRowLines(baseBacklog), archiveTexts);
    assert.deepEqual(
      stillMissing,
      [],
      `${BACKLOG_PATH} lost ${stillMissing.length} row id(s) between the base commit (${baseSha}) and ` +
      `HEAD, and none was found VERBATIM in a docs/history/${BACKLOG_ARCHIVE_PREFIX}*.md archive:\n` +
      `${stillMissing.map((id) => `  ${id}`).join('\n')}\n\n` +
      `A shipped row moves byte-identically into docs/history/${BACKLOG_ARCHIVE_PREFIX}<date>.md in the ` +
      `same commit (DOCUMENTATION-MAP.md §3). Any other row must never be deleted outright — strike it ` +
      `(~~text~~) with a one-line reason instead. If you did neither, this is GUARD-CLOBBER1: rebase ` +
      `onto origin/main and re-apply your edit on the CURRENT file.`,
    );
  });

  it('the verbatim-archive exemption accepts an exact copy and rejects an edited one (positive control)', () => {
    const line = '| X1 | **Shipped thing** — long enough text | ✅ live | src |';
    const base = new Map([['X1', line], ['X2', '| X2 | other | ✅ | s |']]);
    assert.deepEqual(unarchivedBacklogIds(['X1'], base, [`# a\n${line}\n`]), []);
    assert.deepEqual(unarchivedBacklogIds(['X1'], base, [line.replace('long', 'short')]), ['X1']);
    assert.deepEqual(unarchivedBacklogIds(['X2'], base, []), ['X2']);
  });

  it('no PLANNED-BACKLOG.md row\'s Item text was truncated back to an older snapshot', () => {
    const baseRows = parseBacklogRows(baseBacklog);
    const headRows = parseBacklogRows(headBacklog);
    const reverted = [];
    for (const [id, baseItem] of baseRows) {
      if (baseItem.length < 80) continue; // too short to distinguish a genuine trim from noise
      const headItem = headRows.get(id);
      if (headItem === undefined) continue; // caught by the previous assertion
      if (headItem !== baseItem && baseItem.startsWith(headItem)) {
        reverted.push(id);
      }
    }
    assert.deepEqual(
      reverted,
      [],
      `${BACKLOG_PATH} row(s) whose Item text at HEAD is a strict PREFIX of what it was at the ` +
      `base commit (${baseSha}) — the append-only loop only ever adds to a row, so a shorter Item ` +
      `is the signature of an older snapshot overwriting a newer one:\n` +
      `${reverted.map((id) => `  ${id}`).join('\n')}\n\n` +
      `See this file's header for the GUARD-CLOBBER1 fix.`,
    );
  });
});
