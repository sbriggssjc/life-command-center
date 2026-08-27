/**
 * Guard: no committed merge-conflict markers in tracked text files.
 *
 * WHY THIS EXISTS (A0, 2026-08-27)
 * `docs/architecture/panel-redesign-verification.md` carried an unresolved merge that was
 * COMMITTED AS FILE CONTENT — 148 lines of `<<<<<<< HEAD` / `=======` / `>>>>>>> f59679a2`
 * introduced by `5bbe8c0f` and unnoticed for 75 days. Git does not flag it: there is no `UU`,
 * because as far as git is concerned the conflict WAS resolved — by committing the markers.
 * Prose has no parser, so nothing else caught it either. Third instance of the keep-both-sides
 * class in one evening (`docs/os/GITHUB-WORKFLOW.md` §4b); in YAML the same mistake made a
 * workflow unrunnable, in prose it silently voided half a verification document.
 *
 * ⚠️ IT IS A PATTERN, NOT ONE FILE — this guard's FIRST CI run caught a second, live instance
 * in `docs/claude-code/STATUS.md`, merged to `main` an hour earlier by PR #1801. That one came
 * from a **`git stash pop`** (`<<<<<<< Updated upstream` / `>>>>>>> Stashed changes`), not a
 * merge — so match on the marker CHARACTERS, never on the label text after them.
 *
 * ⚠️ A bare `=======` is NOT a marker on its own — it is a valid Markdown setext H1 underline.
 * It is reported ONLY when it sits inside an open `<<<<<<<` … `>>>>>>>` span. Same for the
 * diff3 base marker `|||||||`. Weakening the START/END patterns to compensate for a
 * false positive is how a detector starts returning comfortable zeros (CLAUDE.md P182) —
 * if a file legitimately needs to contain a start-of-line marker, exclude it BY PATH below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Exclude by PATH, never by weakening the pattern. Repo-relative, POSIX separators.
// Currently EMPTY by design: every file in this repo that discusses conflict markers
// (this test, `docs/claude-code/prompts/A0-*.md`) keeps them off column 0, so none needs
// an exemption. Add a path here only when a file's job is to *show* a marker literally.
export const ALLOWLIST = new Set([]);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next']);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svgz',
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.7z', '.rar',
  '.xlsx', '.xls', '.xlsm', '.docx', '.doc', '.pptx', '.ppt',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.wav', '.pkl', '.pickle', '.pst', '.ost',
]);

const MAX_BYTES = 8 * 1024 * 1024; // a text file bigger than this is not prose we wrote

// Anchored at column 0. A marker line is 7 chars followed by end-of-line or whitespace.
const START = /^<{7}(?:[ \t].*)?$/;
const END = /^>{7}(?:[ \t].*)?$/;
const BASE = /^\|{7}(?:[ \t].*)?$/;   // diff3 style
const SEP = /^={7}$/;

/**
 * Scan one file's text for conflict markers.
 * @returns {{line: number, marker: string}[]} 1-indexed hits, empty when clean.
 */
export function scanTextForConflictMarkers(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  let openLine = 0; // 0 = no open span

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (START.test(line)) {
      // A second `<<<<<<<` before a close is still a start; report it and re-anchor.
      hits.push({ line: lineNo, marker: line.slice(0, 7) });
      openLine = lineNo;
    } else if (END.test(line)) {
      // An END with no open span is still a marker — nothing else writes `>>>>>>> <sha>`
      // at column 0 — so report it either way.
      hits.push({ line: lineNo, marker: line.slice(0, 7) });
      openLine = 0;
    } else if (openLine && (SEP.test(line) || BASE.test(line))) {
      hits.push({ line: lineNo, marker: line.slice(0, 7) });
    }
  }
  return hits;
}

function listTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = out.split('\0').filter(Boolean);
    if (files.length) return files;
  } catch {
    // no git (or not a checkout) — fall through to a filesystem walk
  }
  const files = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  };
  walk(REPO_ROOT, '');
  return files;
}

function isScannable(relPath) {
  if (ALLOWLIST.has(relPath)) return false;
  const first = relPath.split('/')[0];
  if (SKIP_DIRS.has(first)) return false;
  if (relPath.split('/').some((seg) => SKIP_DIRS.has(seg))) return false;
  return !BINARY_EXT.has(path.extname(relPath).toLowerCase());
}

function readTextOrNull(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null; // tracked but absent (sparse checkout / mid-rebase)
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  const buf = fs.readFileSync(absPath);
  if (buf.includes(0)) return null; // binary despite its extension
  return buf.toString('utf8');
}

/** Scan the whole repo. @returns {{file: string, line: number, marker: string}[]} */
export function scanRepoForConflictMarkers() {
  const findings = [];
  for (const relPath of listTrackedFiles()) {
    if (!isScannable(relPath)) continue;
    const text = readTextOrNull(path.join(REPO_ROOT, relPath));
    if (text === null) continue;
    for (const hit of scanTextForConflictMarkers(text)) {
      findings.push({ file: relPath, ...hit });
    }
  }
  return findings;
}

// --- The detector, pointed at known positives (CLAUDE.md P182: never trust a zero
// --- from a text matcher you have not seen say "yes").

const M_START = '<'.repeat(7);
const M_SEP = '='.repeat(7);
const M_BASE = '|'.repeat(7);
const M_END = '>'.repeat(7);

test('conflict-marker detector: catches the real 3-marker shape', () => {
  const sample = [
    'before',
    `${M_START} HEAD`,
    'ours',
    M_SEP,
    'theirs',
    `${M_END} f59679a2f9f3948223f894218dec8309f15402c9`,
    'after',
  ].join('\n');
  const hits = scanTextForConflictMarkers(sample);
  assert.deepEqual(
    hits.map((h) => [h.line, h.marker]),
    [[2, M_START], [4, M_SEP], [6, M_END]],
  );
});

test('conflict-marker detector: catches a `git stash pop` conflict, not just a merge', () => {
  // The live second instance — docs/claude-code/STATUS.md, PR #1801. The label after the
  // marker characters is NOT `HEAD`/`<sha>`, so nothing may key on the label text.
  const sample = [
    `${M_START} Updated upstream`,
    'upstream entry',
    M_SEP,
    'stashed entry',
    `${M_END} Stashed changes`,
  ].join('\n');
  assert.deepEqual(
    scanTextForConflictMarkers(sample).map((h) => h.line),
    [1, 3, 5],
  );
});

test('conflict-marker detector: catches the diff3 base marker inside a span', () => {
  const sample = [`${M_START} ours`, 'a', `${M_BASE} base`, 'b', M_SEP, 'c', `${M_END} theirs`].join('\n');
  assert.deepEqual(
    scanTextForConflictMarkers(sample).map((h) => h.line),
    [1, 3, 5, 7],
  );
});

test('conflict-marker detector: a bare ======= outside a span is NOT a marker', () => {
  // A setext H1 underline. Weakening this is how the guard would start lying.
  const sample = ['A Markdown Title', M_SEP, '', 'body text', M_SEP].join('\n');
  assert.deepEqual(scanTextForConflictMarkers(sample), []);
});

test('conflict-marker detector: markers must sit at column 0', () => {
  // How this repo legitimately shows them — `docs/claude-code/prompts/A0-*.md` line 15.
  const sample = [`line 424  ${M_START} HEAD`, '  ' + M_SEP, `> ${M_END} sha`].join('\n');
  assert.deepEqual(scanTextForConflictMarkers(sample), []);
});

test('conflict-marker detector: an unterminated span still reports its start', () => {
  assert.deepEqual(
    scanTextForConflictMarkers([`${M_START} HEAD`, 'ours'].join('\n')).map((h) => h.line),
    [1],
  );
});

test('conflict-marker detector: goes RED on the pre-fix panel-redesign-verification.md', () => {
  // The known positive, reconstructed from the artifact this guard exists because of
  // (5bbe8c0f, docs/architecture/panel-redesign-verification.md lines 424 / 471 / 571).
  const damaged = [
    ...Array(423).fill('prose'),
    `${M_START} HEAD`,
    ...Array(46).fill('### 4.2f BROWSER VERIFICATION'),
    M_SEP,
    ...Array(99).fill('### 4.2e PROMPT 115'),
    `${M_END} f59679a2f9f3948223f894218dec8309f15402c9`,
  ].join('\n');
  assert.deepEqual(
    scanTextForConflictMarkers(damaged).map((h) => h.line),
    [424, 471, 571],
  );
});

test('no committed conflict markers in any tracked text file', () => {
  const findings = scanRepoForConflictMarkers();
  const report = findings.map((f) => `  ${f.file}:${f.line}  ${f.marker}`).join('\n');
  assert.equal(
    findings.length,
    0,
    `Committed merge-conflict marker(s) found — a merge or \`git stash pop\` was "resolved" by keeping both sides:\n${report}\n` +
      'Resolve the merge properly and re-run. If a file legitimately needs a start-of-line marker, ' +
      'add its path to ALLOWLIST in test/no-conflict-markers.test.mjs — never weaken the pattern.',
  );
});

test('the guard actually scanned this repository', () => {
  // A zero from a scanner that found no files is not a pass (CLAUDE.md P182).
  const files = listTrackedFiles().filter(isScannable);
  assert.ok(files.length > 500, `expected to scan the repo, only found ${files.length} files`);
  assert.ok(files.includes('docs/architecture/panel-redesign-verification.md'));
});
