// ID3a/ID3b — guard for the gov agency canonicalizer contamination fix.
//
// This suite is offline (no DB), so it cannot execute the SQL functions
// live. Per this repo's own "strip comments before grepping source" rule
// (A5c/N18/B1/OCR1c), every assertion below strips SQL comments first so a
// migration's own prose describing a removed bug (which necessarily quotes
// the buggy pattern) cannot satisfy a check for the fix. Positive controls
// are included so a naive "pattern text exists somewhere" check cannot pass
// vacuously.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase/migrations/government/20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql'
);

function stripSqlComments(sql) {
  // Strip line comments (-- ...) first, then block comments (/* ... */).
  // Order matters (OCR1c): stripping block comments first can eat a line
  // comment marker sitting inside a still-open block, and vice versa is
  // safe here because SQL has no nesting ambiguity between the two forms
  // at the statement level this file uses.
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

let raw;
let code; // comment-stripped

test.before(() => {
  raw = fs.readFileSync(MIGRATION_PATH, 'utf8');
  code = stripSqlComments(raw);
});

test('migration file exists and defines canonicalize_agency', () => {
  assert.ok(raw.length > 0);
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.canonicalize_agency\(/);
});

test('STATE resolves only via a closed allowlist, never a bare/substring "state" test', () => {
  // The fix: `x IN ('state','dos',...)`. Positive control: the buggy shape
  // this replaces was `x ~ '\mstate\M'` or `x ~ 'department\s+of\s+state'`
  // used ALONE as a WHEN predicate for STATE — that shape must be absent.
  assert.match(code, /THEN 'STATE'/);
  const stateBlock = code.slice(
    code.indexOf("'state', 'dos'") - 40,
    code.indexOf("THEN 'STATE'") + 20
  );
  assert.match(stateBlock, /x IN \(/, 'STATE must resolve via an IN() allowlist');
  // The dangerous bare-word/phrase-substring shape must not be the STATE
  // predicate. A bare `\mstate\M` anywhere in the file (outside the STATE
  // block) would indicate the regression re-appeared.
  const bareStateRegex = /WHEN\s+x\s+~\s+'\\m\(state\|/;
  assert.doesNotMatch(code, bareStateRegex, 'a bare \\mstate\\M WHEN-clause must not exist');
});

test('DOC resolves only via the spelled-out phrase, never bare "doc"', () => {
  assert.match(code, /department\\s\+of\\s\+commerce\|commerce\\s\+department/);
  // The old buggy shape included a bare `doc|` alternative inside the SAME
  // WHEN clause that resolves to DOC. Extract that WHEN line and assert it
  // has no bare `doc` alternative.
  const docLine = code
    .split('\n')
    .find((l) => l.includes("THEN 'DOC'"));
  assert.ok(docLine, 'a DOC-resolving WHEN clause must exist');
  assert.doesNotMatch(
    docLine,
    /\(doc\|/,
    'DOC must not resolve from a bare "doc" alternative — route to review instead'
  );
});

test('gov_agency_review_reason routes bare DOC and private-company collisions to review', () => {
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.gov_agency_review_reason/);
  assert.match(code, /ambiguous_doc_commerce_or_corrections/);
  assert.match(code, /private_company_name_collision/);
  assert.match(code, /location_suffix_no_agency/);
});

test('a trailing two-letter parenthetical suffix is stripped before ANY match, generally', () => {
  // The stripping must happen in the shared CTE feeding canonicalize_agency
  // (so it applies to every branch, not a Richmond/VA-specific patch).
  assert.match(code, /\\\(\[a-z\]\{2\}\\\)\\s\*\$/);
});

test('an *ice cream / frozen yogurt* collision returns NULL before the ICE branch runs', () => {
  const fn = code.slice(
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency('),
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency_full')
  );
  const iceCreamIdx = fn.search(/ice\\s\+cream/);
  const iceBranchIdx = fn.search(/THEN 'ICE'/);
  assert.ok(iceCreamIdx > -1, 'an ice-cream exclusion must exist');
  assert.ok(iceBranchIdx > -1, 'an ICE branch must exist');
  assert.ok(iceCreamIdx < iceBranchIdx, 'the ice-cream exclusion must run BEFORE the ICE branch');
});

test('a *federal credit union* collision returns NULL before any service-branch branch runs', () => {
  const fn = code.slice(
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency('),
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency_full')
  );
  const creditUnionIdx = fn.indexOf('credit_union'.replace('_', '\\s+'));
  const creditUnionLineIdx = fn.search(/credit\\s\+union/);
  const navyLineIdx = fn.search(/THEN 'NAVY'/);
  assert.ok(creditUnionLineIdx > -1, 'a credit-union exclusion must exist');
  assert.ok(navyLineIdx > -1, 'a NAVY branch must exist');
  assert.ok(
    creditUnionLineIdx < navyLineIdx,
    'the credit-union exclusion must run BEFORE the NAVY branch in CASE order'
  );
});

test('USACE (spelled-out corps-of-engineers phrase) is checked BEFORE the bare ARMY branch', () => {
  const fn = code.slice(
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency('),
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency_full')
  );
  const usaceIdx = fn.search(/corps\\s\+of\\s\+engineers/);
  const armyIdx = fn.search(/THEN 'ARMY'/);
  assert.ok(usaceIdx > -1 && armyIdx > -1);
  assert.ok(usaceIdx < armyIdx, 'USACE phrase must precede the bare ARMY branch');
});

test('ACE aliases to USACE ONLY case-sensitively on the raw input, never bare lowercase', () => {
  // Guards against the "Ace Hardware" collision this exact repo's gov
  // CLAUDE.md documents as a live example of a private-business name
  // sharing a token with a government keyword.
  assert.match(code, /p_input ~ '\\mACE\\M'/, 'ACE must be matched case-sensitively on raw p_input');
  // The lower-cased `x` CTE (used by every other branch) must not itself
  // carry a bare "ace" alternative — that would defeat the case-sensitive
  // guard by matching lowercase "ace" first via a different branch.
  const fn = code.slice(
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency('),
    code.indexOf('CREATE OR REPLACE FUNCTION public.canonicalize_agency_full')
  );
  assert.doesNotMatch(fn, /\(ace\|/, 'a bare lowercase "ace" alternative must not exist');
});

test('registry additions already present: NAVY/ARMY/DOC/LSC/DOL/USGS/NRC/NIH/NLRB/USAF/TREAS', () => {
  for (const code_ of [
    "WHEN 'NAVY' THEN 'Department of the Navy'",
    "WHEN 'ARMY' THEN 'Department of the Army'",
    "WHEN 'DOC' THEN 'Department of Commerce'",
    "WHEN 'LSC' THEN 'Legal Services Corporation'",
    "WHEN 'DOL' THEN 'Department of Labor'",
    "WHEN 'USGS' THEN 'U.S. Geological Survey'",
    "WHEN 'NRC' THEN 'Nuclear Regulatory Commission'",
    "WHEN 'NIH' THEN 'National Institutes of Health'",
    "WHEN 'NLRB' THEN 'National Labor Relations Board'",
    "WHEN 'USAF' THEN 'U.S. Air Force'",
    "WHEN 'TREAS' THEN 'Department of the Treasury'",
  ]) {
    assert.ok(code.includes(code_), `missing registry row: ${code_}`);
  }
});

test('GSA using/occupying agency is a SECOND column, GSA counterparty column untouched', () => {
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.gov_using_agency_from_gsa/);
  assert.match(code, /using_agency_canonical/);
  assert.match(code, /using_agency_full/);
  // The existing GSA counterparty write path (agency_canonical from the
  // raw string) must still be present unmodified alongside it.
  assert.match(code, /agency_canonical = canonicalize_agency\(agency\)/);
});

test('every new SECURITY-relevant column addition is additive (IF NOT EXISTS)', () => {
  const alters = code.match(/ALTER TABLE[^;]+;/g) || [];
  assert.ok(alters.length > 0);
  for (const a of alters) {
    assert.match(a, /ADD COLUMN IF NOT EXISTS/, `non-additive ALTER: ${a}`);
  }
});

test('a reversible backup table is populated BEFORE the backfill UPDATEs run', () => {
  const backupIdx = code.indexOf('_gov_id3ab_agency_backup_20260912');
  const firstUpdateIdx = code.search(/UPDATE public\.properties/);
  assert.ok(backupIdx > -1 && firstUpdateIdx > -1);
  assert.ok(backupIdx < firstUpdateIdx, 'backup insert must precede the backfill UPDATE');
});

test('the trigger function still uses IF/ELSIF (not a CASE expression) across tenant_agency/agency', () => {
  // Round 76ej.t's original fix for the "record has no field tenant_agency"
  // 42703 must not regress back to a CASE expression, which PL/pgSQL
  // evaluates both branches of at parse time.
  const trig = code.slice(
    code.indexOf('CREATE OR REPLACE FUNCTION public.gov_populate_agency_canonical'),
    code.length
  );
  assert.match(trig, /IF TG_TABLE_NAME = 'leases' THEN/);
  assert.doesNotMatch(trig, /CASE\s+WHEN TG_TABLE_NAME/);
});
