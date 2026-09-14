// ID3a — government agency identity wiring.
// Guards the invariants of supabase/migrations/government/20261012120000_gov_id3a_agency_identity_wiring.sql
//
// ⚠️ COMMENT-STRIPPING IS LOAD-BEARING, NOT HYGIENE. The migration's header explains every decision by
// NAMING the thing it refuses to do — it says `agency_canonical`, `RICHMOND FIELD OFFICE (VA)`, `NAVY`
// and `Handel's` repeatedly while justifying their exclusion. A raw-source grep therefore finds all of
// them present and passes over a complete revert (the A5c / N18 / B1 lesson).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(
  ROOT,
  'supabase/migrations/government/20261012120000_gov_id3a_agency_identity_wiring.sql',
);

const RAW = readFileSync(MIGRATION, 'utf8');

/** Strip `--` line comments and block comments, preserving string literals. */
function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  let inSingle = false;
  let inDollar = null;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (!inSingle && !inDollar && two === '--') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (!inSingle && !inDollar && two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (!inDollar && sql[i] === "'") {
      // '' is an escaped quote inside a literal, not a close-then-open.
      if (inSingle && sql[i + 1] === "'") { out += "''"; i += 2; continue; }
      inSingle = !inSingle;
    }
    if (!inSingle) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (dollar) {
        if (inDollar === null) inDollar = dollar[0];
        else if (inDollar === dollar[0]) inDollar = null;
        out += dollar[0];
        i += dollar[0].length;
        continue;
      }
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

const SQL = stripSqlComments(RAW);

test('the migration file exists and survives comment-stripping', () => {
  assert.ok(RAW.length > 5000, 'migration is unexpectedly small');
  assert.ok(SQL.includes('create table if not exists gov_agency_aliases'));
  // Positive control for the stripper itself: the header prose must be GONE from SQL...
  assert.ok(RAW.includes('DECISION 1'), 'header marker missing from raw source');
  assert.ok(!SQL.includes('DECISION 1'), 'comment stripper did not strip the header');
  // ...while a string literal the migration genuinely ships must SURVIVE.
  assert.ok(SQL.includes('id3a_curated'), 'stripper ate a live string literal');
});

test('the alias table is NEVER seeded from agency_canonical', () => {
  // The whole safety argument: agency_canonical conflates federal agencies with same-named state
  // bodies (Arkansas Dept of Veterans Affairs -> VA) and commercial lookalikes (Navy Federal Credit
  // Union -> NAVY). Seeding from it writes a wrong FK at scale.
  assert.ok(
    !/insert\s+into\s+gov_agency_aliases[\s\S]{0,2000}?agency_canonical/i.test(SQL),
    'an alias seed reads agency_canonical — that column conflates federal/state/commercial',
  );
  assert.ok(!/\bagency_canonical\b/.test(SQL.split('create or replace view v_gov_agency_wiring_parity')[0]),
    'agency_canonical is referenced before the parity view, where it is the only legitimate use');
});

test('the resolver fails closed: exact alias match only, no fuzzy arm', () => {
  const fn = sliceFunction(SQL, 'gov_resolve_agency');
  assert.ok(fn.includes("'unresolved'"), 'resolver must be able to return unresolved');
  assert.ok(fn.includes('a.alias_key = v_key'), 'resolver must match the alias key exactly');
  // Banned: any fuzzy / partial comparator inside the resolver.
  for (const banned of ['ilike', 'like', 'similarity', 'levenshtein', '~*', '%']) {
    assert.ok(
      !fn.toLowerCase().includes(banned),
      `resolver contains a fuzzy comparator (${banned}) — identity is exact-match only`,
    );
  }
});

test('the resolver honours the registry active flag and is service_role only', () => {
  const fn = sliceFunction(SQL, 'gov_resolve_agency');
  assert.ok(/coalesce\(g\.active,\s*true\)/.test(fn), 'resolver must not return a retired agency');
  assert.ok(
    /revoke all on function gov_resolve_agency\(text\) from public, anon, authenticated/i.test(SQL),
    'revoke must name public AND anon AND authenticated (the two-grant rule)',
  );
  assert.ok(
    /has_function_privilege\(\s*'anon'/.test(SQL),
    'a revoke is not evidence — assert with has_function_privilege()',
  );
});

test('the backfill is fill-blanks only and dry-run by default', () => {
  const fn = sliceFunction(SQL, 'gov_id3a_backfill_agency_ids');
  assert.ok(/p_dry_run\s+boolean\s+default\s+true/i.test(SQL), 'backfill must default to dry run');
  // Both update arms must carry the fill-blanks predicate.
  const updates = fn.match(/update\s+(properties|property_agencies)[\s\S]*?;/g) || [];
  assert.equal(updates.length, 2, 'expected exactly two update arms');
  for (const u of updates) {
    assert.ok(/agency_id is null/.test(u), `an update arm is missing the fill-blanks guard:\n${u}`);
    assert.ok(/status = 'matched'/.test(u), 'an update arm applies a non-matched status');
  }
});

test('only status=matched is auto-applied — unresolved goes to the review lane', () => {
  const fn = sliceFunction(SQL, 'gov_id3a_backfill_agency_ids');
  const reviewInserts = fn.match(/insert into gov_agency_resolution_review[\s\S]*?;/g) || [];
  assert.equal(reviewInserts.length, 2, 'both source tables must route unresolved rows to review');
  for (const r of reviewInserts) {
    assert.ok(/status = 'unresolved'/.test(r), 'review insert does not select unresolved rows');
    assert.ok(/t\.raw/.test(r), 'review lane must keep the RAW text intact, never a normalized key only');
  }
});

test('every write is recorded in the reversible batch ledger', () => {
  const fn = sliceFunction(SQL, 'gov_id3a_backfill_agency_ids');
  const logs = fn.match(/insert into gov_agency_id_backfill_log[\s\S]*?;/g) || [];
  assert.equal(logs.length, 2, 'both update arms must write a reversal ledger row');
});

test('the write guard is a hard refusal on BOTH agency_id columns', () => {
  assert.ok(/raise exception/i.test(sliceFunction(SQL, 'gov_agency_id_write_guard')),
    'the guard must RAISE, not warn');
  for (const tbl of ['properties', 'property_agencies']) {
    const re = new RegExp(
      `create trigger trg_gov_${tbl === 'properties' ? 'properties' : 'property_agencies'}_agency_id_guard[\\s\\S]*?before insert or update of agency_id on ${tbl}`,
      'i',
    );
    assert.ok(re.test(SQL), `no BEFORE INSERT OR UPDATE OF agency_id guard on ${tbl}`);
  }
});

test('the review-reason classifier names the two documented ambiguities', () => {
  const fn = sliceFunction(SQL, 'gov_id3a_review_reason');
  assert.ok(fn.includes("'state_suffix_ambiguous'"),
    '(VA) must be routed as a state suffix, never resolved to Veterans Affairs');
  assert.ok(fn.includes("'gsa_compound_occupant'"),
    'GSA - <occupant> compounds must be routed, never auto-applied');
  assert.ok(/\\\(\[A-Z\]\{2\}\\\)/.test(fn), 'the (ST) suffix pattern is missing');
});

test('the two named traps are absent from the curated alias list', () => {
  const seeds = SQL.match(/insert into gov_agency_aliases[\s\S]*?on conflict \(alias_key\) do nothing;/g) || [];
  const curated = seeds.join('\n');
  // RICHMOND FIELD OFFICE (VA) is Virginia the state; Navy Federal Credit Union is a bank;
  // Handel's is an ice-cream shop. None may ever be an alias.
  for (const trap of ['RICHMOND FIELD OFFICE', 'Navy Federal', "Handel's", 'ARKANSAS DEPARTMENT OF VETERANS']) {
    assert.ok(!curated.includes(trap), `"${trap}" is aliased — it is not that federal agency`);
  }
});

test('the ACE -> USACE alias carries its evidence, not an assertion', () => {
  const seeds = SQL.match(/\('ACE','USACE',[^)]*\)/);
  assert.ok(seeds, 'ACE alias missing');
  assert.ok(/Huntsville/i.test(seeds[0]),
    'the ACE alias must record the named-row evidence that justified it');
});

test('the detector reports the honest gap, not just what resolved', () => {
  // ⚠️ Slice to the `comment on view`, NOT to end-of-file. The view's own COMMENT is a SQL string
  // literal — it survives comment-stripping by design — and it says "rows_orphan_unresolved is the
  // honest gap" in prose. A whole-file (or to-EOF) search therefore matches the SENTENCE EXPLAINING
  // the column and passes over the column being deleted. Found by the mutation pass, not by reading
  // this test. (OCR1c: strip comments, then blank literals, PER ASSERTION.)
  const body = SQL.slice(SQL.indexOf('create or replace view v_gov_agency_identity_detector'));
  const view = body.slice(0, body.indexOf('comment on view v_gov_agency_identity_detector'));
  assert.ok(view.length > 200 && view.length < body.length, 'detector view slice is not bounded by its comment');
  assert.ok(view.includes('rows_orphan_unresolved'),
    'the detector must report orphans — a resolved count alone reads as success');
  assert.ok(view.includes('rows_no_raw_text'),
    'a blank source string and an unresolvable one are different facts (P180)');
  assert.ok(view.includes('raw_strings_collapsed'), 'the detector must report collapse');
});

/** Slice a SQL function body by name, anchored on its own CREATE ... $$ ... $$ span. */
function sliceFunction(sql, name) {
  const start = sql.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  const open = sql.indexOf('$$', start);
  assert.notEqual(open, -1, `function ${name} has no dollar-quoted body`);
  const close = sql.indexOf('$$', open + 2);
  assert.notEqual(close, -1, `function ${name} body is unterminated`);
  return sql.slice(start, close + 2);
}
