// GOVDUP1 — guard for the gov property-duplicate review lane migration.
//
// Source-only (offline, no DB, no secrets — the suite's standing rule): it
// reads supabase/migrations/government/20260905120000_gov_govdup1_property_duplicate_review.sql
// and asserts the SUBSTANCE of the classifier survives, never a line number
// or a token that legitimately appears elsewhere (the documented "a guard
// that matches a shape is defeated by a name that legitimately appears
// elsewhere" footgun — this file's own comments repeat every hazard by name
// while explaining the fix, so a raw-source detector would find them all
// present and pass over a regression; comments are stripped before every
// substance assertion below, per the standing "strip comments first" rule).
//
// What this guards, and why each one is here:
//   1. Unit 1 never DELETEs a property — retirement is an UPDATE to
//      status='archived', reversible via gov_property_dup_retire_log.
//   2. The Unit 2 view key is the WIDER normalized-address+state key
//      (regexp_replace + lower, non-alphanumeric strip), never the
//      exact-string key that misses the punctuation-only duplicates
//      (GOVDUP1 §1/§2a: 399 vs 132 groups on the same population).
//   3. lower() runs BEFORE the character-class strip (the documented
//      "`lower()` BEFORE a character-class strip, never after" footgun —
//      applying strip-then-lower on an ALL-CAPS address collapses it to
//      the empty string and false-matches every other empty string).
//   4. The zip-normalizer requires >=4 digits before padding to 5 — the
//      documented `lpad('',5,'0') = '00000'` trap (a present, DISAGREEING
//      zip, not a missing one). zip_signal must keep three states
//      (agrees / differs / not_comparable), never fold missing into differs.
//   5. A placeholder address (e.g. a bare "international airport" string)
//      is excluded by an ANCHORED equality list, never a `contains`/`ilike`
//      pattern that could swallow a real street name (P158a: a `contains`
//      rule swallows real firms — the same hazard on an address string).
//   6. The view never merges anything itself — no DELETE, no
//      gov_merge_property_reversible call inside the view/migration; every
//      row requires a human verdict elsewhere.
//   7. address_match is keyed off distinct_exact_strings, and 1 means
//      EXACT (byte-identical strings), not punctuation_only — this is the
//      inversion this migration's own history records catching once.
//
// Mutation-verified: every assertion below was checked to go RED against a
// hand-mutated copy of the migration text before being accepted (see the
// inline notes at each assertion for what mutation it catches).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  'government',
  '20260905120000_gov_govdup1_property_duplicate_review.sql',
);

const raw = readFileSync(MIGRATION_PATH, 'utf8');

// Strip SQL line comments (`-- ...`) before any substance assertion — the
// migration's own header discusses every hazard by name while explaining
// the fix (A5c/N18/B1 rule: a source detector must strip comments or it
// reports the bug it just removed).
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      // Naive but sufficient here: this file has no `--` inside a string
      // literal (the one embedded string literal, the placeholder list,
      // uses only alnum/space/slash characters).
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const body = stripSqlComments(raw);

test('migration file exists and is non-trivial', () => {
  assert.ok(raw.length > 2000, 'expected a substantial migration body');
});

test('Unit 1 retires by UPDATE, never DELETE, and is reversible via a log table', () => {
  // Mutation this catches: replacing the UPDATE ... SET status='archived'
  // block with a DELETE FROM properties would still "retire" the husks but
  // destroy the P196/ENTC-class reversibility this migration promises.
  assert.match(body, /CREATE TABLE IF NOT EXISTS public\.gov_property_dup_retire_log/);
  assert.match(body, /UPDATE public\.properties\s+SET status = 'archived'/);
  assert.doesNotMatch(
    body,
    /DELETE\s+FROM\s+public\.properties/i,
    'Unit 1 must never DELETE a properties row — retirement is reversible status flip only',
  );
});

test('the duplicate key is regexp_replace + lower over non-alphanumerics, not an exact string', () => {
  // Mutation this catches: swapping the group-key view's norm_addr
  // expression for `lower(trim(address))` (the narrower key) would silently
  // exclude the 267 punctuation-only duplicates (class B) this lane exists
  // to surface.
  assert.match(
    body,
    /regexp_replace\(lower\(address\), '\[\^a-z0-9\]', '', 'g'\) AS norm_addr/,
  );
});

test("lower() runs BEFORE the character-class strip, not after", () => {
  // Mutation this catches: `regexp_replace(address, '[^a-z0-9]', '', 'g')`
  // then lower() outside — on an ALL-CAPS address this deletes every
  // uppercase letter first, collapsing distinct addresses to the empty
  // string (the documented CLAUDE.md footgun, verbatim).
  const m = body.match(/regexp_replace\(([^)]*lower\([^)]*\)[^)]*|[^)]*)'?\[\^a-z0-9\]/);
  assert.match(
    body,
    /regexp_replace\(lower\(address\),\s*'\[\^a-z0-9\]'/,
    'lower(address) must be the FIRST argument to regexp_replace, not applied after the strip',
  );
});

test('zip normalization requires >=4 digits before padding, keeping missing distinct from differs', () => {
  // Mutation this catches: dropping the `length(...) < 4` guard so an empty
  // zip pads to '00000' and reads as a PRESENT, DISAGREEING zip (the exact
  // §2b trap the prompt names: 46 agree/82 differ/0 missing vs the corrected
  // 42/15/71).
  assert.match(body, /length\(regexp_replace\(p_zip, '\[\^0-9\]', '', 'g'\)\) < 4 THEN NULL/);
  assert.match(body, /WHEN n_zip_present < 2 THEN 'zip_not_comparable'/);
  assert.match(body, /WHEN distinct_zip5 = 1 THEN 'zip_agrees'/);
  assert.match(body, /ELSE 'zip_differs'/);
});

test('a placeholder address is excluded by an anchored equality list, never a fuzzy contains', () => {
  // Mutation this catches: rewriting the placeholder guard as
  // `address ILIKE '%airport%'` would exclude every genuine airport-area
  // street address in the population, not just the bare placeholder string.
  assert.match(
    body,
    /lower\(trim\(p_address\)\) IN \('international airport', 'airport', 'n\/a', 'unknown', 'tbd'\)/,
  );
  assert.doesNotMatch(body, /p_address\s+ILIKE/i);
});

test('the view never merges — no DELETE and no reversible-merge call inside this migration\'s view body', () => {
  // Mutation this catches: adding an auto-merge call (e.g.
  // gov_merge_property_reversible) inside the view or a trigger on it would
  // violate "nothing here merges — every group needs a human verdict",
  // which is load-bearing given gov's hard-delete-with-partial-restore
  // merge (measured in Unit 3: a real round trip on this population lost
  // rows in investment_scores/property_embeddings/property_financials).
  const viewSection = body.slice(body.indexOf('CREATE OR REPLACE VIEW public.v_gov_property_duplicate_review'));
  assert.doesNotMatch(viewSection, /gov_merge_property_reversible/);
  assert.doesNotMatch(viewSection, /DELETE\s+FROM/i);
});

test('address_match: distinct_exact_strings = 1 means "exact" (byte-identical), not "punctuation_only"', () => {
  // Mutation this catches: the inversion this migration's own commit
  // history records — distinct_exact_strings=1 means every member's raw
  // string is IDENTICAL (class A/C), and >1 means the strings differ only
  // by punctuation (class B, the highest-precision subset). Swapping the
  // two labels was caught live by re-measuring the group/property counts
  // against the prompt's own §1 figures (267/534 for punctuation-only).
  assert.match(
    body,
    /CASE WHEN distinct_exact_strings = 1 THEN 'exact' ELSE 'punctuation_only' END AS address_match/,
  );
  assert.doesNotMatch(
    body,
    /CASE WHEN distinct_exact_strings = 1 THEN 'punctuation_only'/,
  );
});

test('verdict_hint never decides on its own — it is guidance, and every row still needs a human verdict', () => {
  // The migration's own comment states this; assert the CASE never emits an
  // 'auto_merge' or similar unattended-write value.
  const verdictSection = body.slice(body.lastIndexOf('CASE'));
  assert.doesNotMatch(verdictSection, /auto[_-]?merge/i);
});
