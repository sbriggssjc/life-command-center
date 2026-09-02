// ============================================================================
// PR8 — the provenance relabel: the REGISTRY is the allowlist.
//
// lcc_flush_provenance_events() used to carry a four-name literal
// (`v_first_class`) and merge every other event under the placeholder name
// `domain_trigger`. Measured live 2026-09-02: all 17,371 rows in
// field_provenance wearing that name are relabels -- 17,277 `agency_classifier`
// (gov government_type, still writing) and 94 `qa22_davita_brand_canonicalize`.
// The literal hid a live, unregistered producer from PR5's write-but-
// unregistered arm and parked a registered one in PR5's "never written" set.
//
// These guards pin the three properties the fix rests on:
//   1. the literal is gone from the SHIPPED body,
//   2. the pass-through gate is the field_source_priority EXISTS check,
//   3. the effective-source expression requires the `:evt<digits>` SHAPE.
//
// (3) is not defensive polish. `split_part(x, ':evt', 1)` returns the WHOLE
// string when the delimiter is absent, and it is absent on 943,916 of the
// 1,263,825 rows in field_provenance. Measured, the unguarded expression
// INVENTS 9,950 source names that do not exist, and re-keying PR5's
// write-but-unregistered arm on it returns 9,951 instead of 21. Same family as
// the P157 reloptions and P182 deparse traps.
//
// Comments are stripped before matching. The shipped migration's own header
// quotes `v_first_class`, the removed predicate and the naive split_part
// repeatedly while explaining why they are gone -- a raw grep would match the
// explanation and pass straight over a regression (A5c / N18).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url).pathname;
const DEFINES = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.lcc_flush_provenance_events/i;

/** Strip SQL `--` line comments and /* *\/ block comments. */
function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}

/** Every migration that defines the flush function, oldest first by filename. */
function definingMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, src: readFileSync(join(MIGRATIONS, f), 'utf8') }))
    .filter((m) => DEFINES.test(stripSqlComments(m.src)));
}

/** The body that actually ships: the newest definition wins. */
function shippedDefinition() {
  const all = definingMigrations();
  return all[all.length - 1];
}

test('positive control: the comment stripper removes prose naming the removed literal', () => {
  const sample = "-- the v_first_class literal is GONE\nSELECT 1; /* v_first_class */\n";
  const out = stripSqlComments(sample);
  assert.ok(!out.includes('v_first_class'),
    'the stripper does not remove the prose these guards must see past');
  assert.ok(out.includes('SELECT 1'), 'the stripper ate real SQL');
});

test('population control: at least one migration defines lcc_flush_provenance_events', () => {
  // Without this, a rename would make every assertion below vacuously green --
  // the failure mode the pipefail guard's own population control exists for.
  assert.ok(definingMigrations().length > 0,
    'no migration defines lcc_flush_provenance_events -- it may have been renamed; ' +
    're-verify the relabel behaviour before touching these guards');
});

test('the shipped flush body carries no literal source allowlist', () => {
  const { name, src } = shippedDefinition();
  const code = stripSqlComments(src);
  assert.ok(!/v_first_class/.test(code),
    `${name} still declares v_first_class. The registry is the allowlist: a ` +
    'literal list of blessed names is what hid agency_classifier (17,277 rows) ' +
    'from PR5 and parked qa22_davita_brand_canonicalize in its "never written" set.');
  // The deny set (`NOT (v_src = ANY(v_never_first_class))`) is a different
  // thing and is REQUIRED -- see the PR1 guard. What is banned is a POSITIVE
  // membership test, i.e. an allowlist. Blank the negated form first, then
  // assert nothing un-negated survives.
  const withoutDeny = code.replace(/NOT\s*\(\s*v_src\s*=\s*ANY\s*\([^)]*\)\s*\)/g, ' ');
  assert.ok(!/v_src\s*=\s*ANY\s*\(/.test(withoutDeny),
    `${name} still gates the merge source on a positive literal allowlist array`);
});

test('the shipped pass-through gate reads field_source_priority', () => {
  const { name, src } = shippedDefinition();
  const code = stripSqlComments(src);
  // Anchor on the assignment that decides the merge source, not on a line or a
  // character window: the gate is the EXISTS over the registry.
  const gate = code.match(/v_merge_source\s*:=\s*'domain_trigger'\s*;[\s\S]{0,900}?v_merge_source\s*:=\s*v_src\s*;/);
  assert.ok(gate, `${name}: could not locate the merge-source gate`);
  assert.ok(/field_source_priority/.test(gate[0]),
    `${name}: the merge-source gate no longer consults field_source_priority -- ` +
    'without it every source keeps its own name regardless of registration, and ' +
    'v_field_provenance_unranked stops meaning anything');
  assert.ok(/fsp\.target_table\s*=\s*v_table/.test(gate[0]) &&
            /fsp\.field_name\s*=\s*v_field/.test(gate[0]) &&
            /fsp\.source\s*=\s*v_src/.test(gate[0]),
    `${name}: the registry check must be per (table, field, source) -- a rung on ` +
    'some other field is not authority for this one');
});

test('every :evt recovery site is guarded on the shape, and effective_source uses it', () => {
  const { name, src } = shippedDefinition();
  const code = stripSqlComments(src);
  const SHAPE = /~\s*'\^\.\+:evt\[0-9\]\+\$'/;

  // The effective_source column must actually RECOVER the name, not alias the
  // stored one. Anchor on the column, not on the file: a file-wide presence
  // check passes while the column returns fp.source (mutation-verified).
  const col = code.match(/CASE[\s\S]{0,400}?END\s+AS\s+effective_source/);
  assert.ok(col, `${name}: no effective_source column found -- the relabel is ` +
    'only recoverable through source_run_id, so dropping it makes the ledger lossy');
  assert.ok(/split_part\s*\([^)]*:evt[^)]*\)/.test(col[0]),
    `${name}: effective_source no longer derives the pre-relabel name from ` +
    'source_run_id -- it is aliasing the stored (relabelled) source instead');
  assert.ok(SHAPE.test(col[0]),
    `${name}: effective_source is not guarded on the '^.+:evt[0-9]+$' shape`);

  // was_relabelled is the second recovery site and needs its OWN guard.
  // Bounded LOOKBACK by index, not a regex class: the expression itself
  // contains commas (inside split_part), so a [^,] lookback stops short and
  // reports a guarded column as unguarded.
  const flagAt = code.search(/AS\s+was_relabelled/);
  assert.ok(flagAt > 0, `${name}: no was_relabelled column found`);
  const flag = [code.slice(Math.max(0, flagAt - 400), flagAt)];
  assert.ok(SHAPE.test(flag[0]),
    `${name}: was_relabelled is not shape-guarded -- without it every row whose ` +
    'source_run_id is an ordinary batch tag (943,916 of 1,263,825) reports as relabelled');

  // And EVERY recovery site carries its OWN guard. split_part returns the WHOLE
  // string when ':evt' is absent; unguarded it invents 9,950 source names and
  // returns 9,951 for PR5's write-but-unregistered arm instead of 21 (measured
  // 2026-09-02). Counted, not proximity-matched: the two sites here are
  // adjacent, so a +/-300-char window reads the NEIGHBOUR's guard and a dropped
  // one survives (mutation-verified). A file-wide presence check is not a guard
  // for a predicate that legitimately appears more than once (the B6c-dup lesson).
  const sites = (code.match(/split_part\s*\([^)]*:evt[^)]*\)/g) || []).length;
  const guards = (code.match(new RegExp(SHAPE.source, 'g')) || []).length;
  assert.ok(sites > 0, `${name}: no :evt recovery site found at all`);
  assert.ok(guards >= sites,
    `${name}: ${sites} :evt recovery sites but only ${guards} shape guards -- ` +
    'at least one recovery is unguarded');
});

test('the run_id preserves the ORIGINATING source, not the merge source', () => {
  const { name, src } = shippedDefinition();
  const code = stripSqlComments(src);
  // This single assignment is what makes the relabel recoverable at all. Write
  // v_merge_source here instead and every future relabel is lost silently --
  // the ledger keeps reading fine and the producer census quietly becomes a
  // census of merge outcomes (mutation-verified: this survived a presence-only
  // check on the effective-source expression).
  const m = code.match(/v_runid\s*:=\s*([^;]+);/);
  assert.ok(m, `${name}: no v_runid assignment found`);
  assert.match(m[1], /\bv_src\b/,
    `${name}: v_runid no longer carries the originating source name (${m[1].trim()}). ` +
    'That is the ONLY channel by which a relabelled row stays attributable.');
  assert.ok(!/\bv_merge_source\b/.test(m[1]),
    `${name}: v_runid is built from the MERGE source -- a relabelled row would ` +
    'then record the placeholder twice and the original name is gone for good');
});

test('agency_classifier is registered for exactly the rungs it writes', () => {
  const { name, src } = shippedDefinition();
  const code = stripSqlComments(src);
  const rungs = [...code.matchAll(/\(\s*'([\w.]+)'\s*,\s*'(\w+)'\s*,\s*'agency_classifier'\s*,\s*(\d+)/g)]
    .map((m) => `${m[1]}.${m[2]}@${m[3]}`)
    .sort();
  assert.deepEqual(rungs, [
    'gov.leases.government_type@90',
    'gov.properties.government_type@90',
    'gov.property_agencies.government_type@90',
    'gov.sales_transactions.government_type@90',
  ], `${name}: agency_classifier's registered rungs no longer match the four ` +
     '(table, field) pairs it was measured writing, at the priority 90 its rows ' +
     'already merged at. A rung it cannot exercise is PR7\'s class; a DIFFERENT ' +
     'priority changes which writes win and needs its own before/after measurement.');
});
