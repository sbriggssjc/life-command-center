// ID3a-d — guard that supabase/migrations/government/ stays retired.
//
// government-lease owns the government database (CLAUDE.md → "ONE REPO OWNS EACH DATABASE'S
// OBJECTS"; data-coherence-invariants.md I16). This directory in life-command-center is
// historical: every file here must carry the retirement header, and a new file added without
// it is a regression of the exact incident that made this rule necessary (ID3a-b's
// canonicalizer fix drifting from the deployed function — see the directory's own README.md).
//
// This is a purely offline, structural check (file contents + git history), never a live DB
// read, so it runs unconditionally in `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GOV_DIR = path.join(ROOT, 'supabase/migrations/government');
const README = path.join(GOV_DIR, 'README.md');

const HISTORICAL_MARKER = 'HISTORICAL — DO NOT RE-APPLY';
const RETIREMENT_CUTOFF = new Date('2026-09-12T00:00:00Z');

function sqlFiles() {
  return readdirSync(GOV_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

// Best-effort git log lookup for the file's first-add date. Falls back to null when git
// history is unavailable (e.g. a shallow clone or the file is new/untracked) — a caller that
// gets null treats it as "cannot determine, do not fail on this signal alone" rather than as
// evidence either way (never guess).
function gitFirstAddDate(relPath) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--follow', '--format=%aI', '--', relPath],
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    if (!out) return null;
    const lines = out.split('\n').filter(Boolean);
    const oldest = lines[lines.length - 1];
    return oldest ? new Date(oldest) : null;
  } catch {
    return null;
  }
}

test('supabase/migrations/government/README.md exists and marks the directory historical', () => {
  assert.ok(existsSync(README), 'README.md must exist in supabase/migrations/government/');
  const body = readFileSync(README, 'utf8');
  assert.match(body, /HISTORICAL/i);
  assert.match(body, /government-lease/);
  assert.match(
    body,
    /never re-appl|do not re-apply|never applied again/i,
    'README must say these migrations are never re-applied'
  );
});

test('README explicitly names both defects re-applying the ID3a-b canonicalizer fix would restore', () => {
  const body = readFileSync(README, 'utf8');
  assert.match(body, /TEXAS DEPARTMENT OF AGRICULTURE/i);
  assert.match(body, /USDA/);
  assert.match(body, /CBP/);
  assert.match(body, /Immigration.{0,10}Customs Enforcement|ICE/i);
});

test('every .sql file in supabase/migrations/government/ carries the historical header', () => {
  const files = sqlFiles();
  assert.ok(files.length > 0, 'expected at least one .sql file to check (population control)');

  const missing = [];
  for (const f of files) {
    const body = readFileSync(path.join(GOV_DIR, f), 'utf8');
    // Header must be at the very top of the file (first ~600 chars), not merely mentioned
    // somewhere in a later comment — a file whose header was stripped but which happens to
    // discuss the incident elsewhere must still fail.
    if (!body.slice(0, 600).includes(HISTORICAL_MARKER)) {
      missing.push(f);
    }
  }
  assert.deepEqual(missing, [], `files missing the historical header: ${missing.join(', ')}`);
});

test('the header names the OWNING repo, not just "historical"', () => {
  const files = sqlFiles();
  for (const f of files.slice(0, 5).concat(files.slice(-5))) {
    // Spot-check a sample (first 5 + last 5) rather than re-reading all 213 files a second
    // time in a second test — the previous test already proved universality of the marker.
    const body = readFileSync(path.join(GOV_DIR, f), 'utf8');
    assert.match(body.slice(0, 600), /government-lease/, `${f} header must name government-lease`);
  }
});

test('a NEW .sql file added after the retirement cutoff must still carry the header (regression guard)', () => {
  const files = sqlFiles();
  const violations = [];
  for (const f of files) {
    const rel = path.join('supabase/migrations/government', f);
    const addedAt = gitFirstAddDate(rel);
    const body = readFileSync(path.join(GOV_DIR, f), 'utf8');
    const hasHeader = body.slice(0, 600).includes(HISTORICAL_MARKER);
    if (hasHeader) continue; // fine regardless of date
    if (addedAt && addedAt > RETIREMENT_CUTOFF) {
      violations.push(`${f} (added ${addedAt.toISOString()}) has no historical header`);
    } else if (!addedAt) {
      // Can't determine git history (e.g. shallow clone / uncommitted new file). Fail closed:
      // an un-headered file with unknown provenance in a retired directory is itself the
      // regression this guard exists to catch.
      violations.push(`${f} has no historical header and no determinable git-add date`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `new/unheadered files found in the retired directory: ${violations.join('; ')}`
  );
});

// Positive control: this suite must be capable of failing. Simulate a file lacking the marker
// and confirm the detection logic used above would flag it (per this repo's own doctrine that
// every guard needs a demonstrated failure mode, not just a passing run).
test('positive control: a body without the historical marker in its first 600 chars is detected as missing', () => {
  const fakeBodyMissing = '-- some ordinary migration\nCREATE OR REPLACE FUNCTION foo() ...';
  const fakeBodyPresent =
    '-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;\n-- rest of header\n\nCREATE OR REPLACE FUNCTION foo() ...';
  assert.equal(fakeBodyMissing.slice(0, 600).includes(HISTORICAL_MARKER), false);
  assert.equal(fakeBodyPresent.slice(0, 600).includes(HISTORICAL_MARKER), true);
});
