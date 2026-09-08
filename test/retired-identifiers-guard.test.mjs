// J13a-guard — converts three manual documentation sweeps (DOCMAP1/2/3, which
// together found the same retired-hostname class four separate times) into a
// CI guard, so a NEW occurrence of a retired identifier is caught the moment
// it lands rather than on the next accidental doc pass.
//
// The retired-identifier list is data, not code — test/fixtures/retired-identifiers.json
// — so adding a newly-retired host/path/symbol is a one-line fixture edit, never
// a change to this file. See CLAUDE.md § "GREP THE HOSTNAME, NOT THE BRAND"
// (DOCMAP2 reconcile) for why this must be case-insensitive and span every
// file type: DOCMAP2's own sweep grepped only `Vercel` (capitalised) inside
// `*.md` and missed 10 of 12 live instances — six docs naming the host only in
// a lowercase URL, and the three root flow-*.json Power Automate definitions +
// the Copilot Studio manifest.json/ai-plugin.json/LCC-Assistant.zip, which no
// `*.md` sweep could ever see.
//
// This test scans TRACKED files only (`git ls-files`), not a directory walk —
// untracked/ignored files are not the repo, and the guard's job is to keep the
// repo itself clean.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'test', 'fixtures', 'retired-identifiers.json');
const RETIRED = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

// Directories that are HISTORY BY CONSTRUCTION — a worklog, an audit, a
// dated response record, or a status file is expected to quote a retired
// identifier verbatim while explaining that it is retired. Excluding a
// legitimate file must be done BY PATH (P182's rule) — never by weakening
// the pattern, which is how a detector starts returning comfortable zeros.
const EXEMPT_DIR_PREFIXES = [
  'docs/history/',
  'docs/archive/',
  'docs/audits/',
  'docs/claude-code/',
  'docs/ops-logs/',
  'outputs/',
  'audit/',
  'docs/capital-markets/',
];

// Files that are the guard's own machinery, or a sibling guard that already
// anchors on the same token deliberately (extension/background.js's comment
// IS the guard there; duplicating enforcement here would just be a second
// copy to keep in sync).
const EXEMPT_FILES = new Set([
  'test/retired-identifiers-guard.test.mjs',
  'test/fixtures/retired-identifiers.json',
  'test/extension-intake-host.test.mjs',
  'extension/background.js',
  'supabase/migrations/20261002090000_lcc_p194_intake_extraction_provenance.sql',
  // Dated investigation/triage reports under docs/architecture/ that document
  // a retirement or migration AS THE FINDING, correctly framed in the past
  // tense (the same "correctly-framed history" class as docs/history/ and
  // docs/audits/, just not filed there). Narrow file-level exemptions rather
  // than widening EXEMPT_DIR_PREFIXES to all of docs/architecture/, which
  // CLAUDE.md holds to a present-tense-accurate standard.
  'docs/architecture/flows/FLOW_CHANGES_LOG.md',
  'docs/architecture/lcc-microsoft-copilot-outlook-audit-2026-05-22.md',
  'docs/architecture/power-automate-api-html-triage-2026-08-11.md',
  'docs/architecture/edge-function-deploy-drift.md',
  // Documents, in the past tense, the DOCMAP1 merge this fixture's own
  // "docs/os/architecture/" entry records ("was merged into ... in the same
  // change that built this index — there is no longer a second directory").
  'docs/os/DOCUMENTATION-MAP.md',
]);

// The places that DOCUMENT a retirement, in prose, at the top level — these
// are exactly where CLAUDE.md and the backlog are supposed to name the old
// identifier while explaining the fix, so a bare grep would flag its own
// documentation. Kept narrow (two specific top-level files), never a whole
// directory, because CLAUDE.md and PLANNED-BACKLOG.md also carry live rules
// that must not be exempted wholesale.
const EXEMPT_TOP_LEVEL_DOC_FILES = new Set([
  'CLAUDE.md',
  'docs/os/PLANNED-BACKLOG.md',
  'docs/os/FLOW-REGISTRY.yaml',
]);

// Pre-existing offenders as of the 2026-09-08 measurement, allowlisted BY
// PATH with a reason and a re-measure date — never by widening a pattern
// (test/sql-definer-privilege-stanza.test.mjs's shape). A stale entry (the
// file no longer contains the identifier) is itself a failure, asserted
// below, so this list cannot rot into a lie.
const ALLOWLIST = [
  {
    path: 'wave0-config-values.txt',
    id: 'life-command-center-nine.vercel.app',
    reason: 'Tracked plaintext env-value dump (SEC2) — a secrets/config decision Scott has ' +
      'deferred; not touched by this guard.',
    reMeasure: '2026-10-08',
  },
  {
    path: 'test/sf-deal-promotion.test.mjs',
    id: 'GOV_STATE_SIGNALS',
    reason: 'The test asserts GOV_STATE_SIGNALS no longer exists on the module ' +
      "(`assert.equal('GOV_STATE_SIGNALS' in mod, false)`) — naming the retired symbol " +
      'IS the regression check (DRIFT1-routing-gap).',
    reMeasure: '2026-10-08',
  },
];
const ALLOWLIST_KEYS = new Set(ALLOWLIST.map((r) => `${r.path} ${r.id}`));

/** A `STALE (DOCMAP…` or `RETIRED` banner in the first 40 lines marks a
 * correctly-framed historical record — the artifact a future reader is meant
 * to trust as "this used to be true, here is why it changed", not a live
 * assertion. */
function hasRetirementBanner(text) {
  const head = text.split('\n').slice(0, 40).join('\n');
  return /STALE \(DOCMAP|RETIRED/i.test(head);
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

/** NUL-byte sniff — binary files (the moved .zip artifacts, images) are
 * covered by the move itself (Unit 2), not by a text scan here. Scanning
 * zip bytes for a literal ASCII hostname is unreliable (compression) and
 * unnecessary once the artifact lives under docs/archive/. */
function looksBinary(buf, sampleLen = 8000) {
  const n = Math.min(buf.length, sampleLen);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// JS/TS-family comment stripper, same shape and same ordering rule as
// test/extension-intake-host.test.mjs: whole-line `//` comments FIRST, then
// `/* */` blocks — a `//` inside a string that contains `/api/*`-style text
// would otherwise open a phantom block comment. Applied only to source
// extensions; a retired identifier named in a `.md`/`.json` "comment" has no
// such thing, so those files are matched on raw text (and exempted by
// path/banner instead).
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
function stripComments(src) {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}
function extOf(relPath) {
  const i = relPath.lastIndexOf('.');
  return i === -1 ? '' : relPath.slice(i);
}

function isExempt(relPath, text) {
  if (EXEMPT_FILES.has(relPath)) return true;
  if (EXEMPT_TOP_LEVEL_DOC_FILES.has(relPath)) return true;
  if (EXEMPT_DIR_PREFIXES.some((p) => relPath.startsWith(p))) return true;
  if (hasRetirementBanner(text)) return true;
  return false;
}

function scan() {
  const files = trackedFiles();
  let scanned = 0;
  let exempt = 0;
  let allowlisted = 0;
  const hits = [];

  for (const relPath of files) {
    const abs = join(ROOT, relPath);
    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      continue; // deleted-but-still-listed edge case (e.g. mid-rebase); skip
    }
    if (looksBinary(buf)) continue;
    scanned++;
    const text = buf.toString('utf8');
    const matchText = SOURCE_EXTENSIONS.has(extOf(relPath)) ? stripComments(text) : text;
    const lower = matchText.toLowerCase();

    for (const entry of RETIRED) {
      if (!lower.includes(entry.id.toLowerCase())) continue;
      if (isExempt(relPath, text)) { exempt++; continue; }
      if (ALLOWLIST_KEYS.has(`${relPath} ${entry.id}`)) { allowlisted++; continue; }
      hits.push({ file: relPath, id: entry.id });
    }
  }
  return { scanned, exempt, allowlisted, hits, files_total: files.length };
}

describe('J13a-guard — retired identifiers stay retired', () => {
  it('the fixture is well-formed and non-empty', () => {
    assert.ok(Array.isArray(RETIRED) && RETIRED.length > 0);
    for (const entry of RETIRED) {
      assert.equal(typeof entry.id, 'string');
      assert.ok(entry.id.length > 0);
      assert.ok(['host', 'path', 'symbol'].includes(entry.kind), `unknown kind for ${entry.id}`);
      assert.equal(typeof entry.replacement, 'string');
    }
  });

  it('no tracked file outside the exempt set names a retired identifier', () => {
    const result = scan();
    // State the count — five numbers, per the prompt's verification contract.
    // eslint-disable-next-line no-console
    console.log(
      `[retired-identifiers-guard] tracked=${result.files_total} scanned=${result.scanned} ` +
      `hits=${result.hits.length} exempt=${result.exempt} allowlisted=${result.allowlisted}`,
    );
    assert.deepEqual(
      result.hits, [],
      'A retired identifier appears in a live (non-exempt) file. Either the ' +
      'reference is stale and must be repointed to its replacement, or the ' +
      'file is a genuine historical record and belongs in an exempt path ' +
      '(docs/history/, docs/archive/, etc.) or under a STALE/RETIRED banner.',
    );
  });

  // ---- Positive controls (P182: a zero from an untested detector is a
  // hypothesis, not a finding) ----

  it('POSITIVE CONTROL: a synthetic live file containing a retired host is flagged', () => {
    const relPath = 'src/does-not-exist-synthetic-probe.js';
    const text = `const url = 'https://${RETIRED[0].id}/api/x';\n`;
    assert.equal(isExempt(relPath, text), false);
    assert.ok(text.toLowerCase().includes(RETIRED[0].id.toLowerCase()));
  });

  it('POSITIVE CONTROL: the same content under docs/history/ is exempt', () => {
    const relPath = 'docs/history/some-old-worklog.md';
    const text = `The old endpoint was https://${RETIRED[0].id}/api/x, retired 2026-07-20.`;
    assert.equal(isExempt(relPath, text), true);
  });

  it('POSITIVE CONTROL: the same content under a STALE (DOCMAP…) banner is exempt', () => {
    const relPath = 'docs/architecture/some-live-doc.md';
    const text = `> STALE (DOCMAP1, 2026-09-08): this section named ${RETIRED[0].id} and has since moved.\n\nBody text.`;
    assert.equal(isExempt(relPath, text), true);
  });

  it('an allowlist entry that no longer matches anything is itself a failure (no stale entries)', () => {
    for (const row of ALLOWLIST) {
      assert.ok(row.reason && row.reMeasure, `${row.path}: allowlist entry must carry reason + reMeasure`);
      const text = readFileSync(join(ROOT, row.path), 'utf8');
      assert.ok(
        text.toLowerCase().includes(row.id.toLowerCase()),
        `Stale allowlist entry: ${row.path} no longer contains ${row.id} — remove the entry.`,
      );
    }
  });
});
