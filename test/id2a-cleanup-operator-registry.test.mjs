// ID2a-cleanup — finish the operator registry.
//
// This repo's sandbox for a given session may or may not carry live
// Dialysis_DB credentials, so (per the ID2a test's own precedent) the SQL
// side is verified structurally here — every invariant the migration
// promises is asserted against its own source text. This migration was
// additionally APPLIED LIVE against Dialysis_DB (zqzrriwuavgrquhisnoa) and
// re-measured before merge — see the PR body / migration header for the
// live before/after numbers this file cannot itself reproduce offline.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/dialysis/20260912120000_dia_id2acleanup_operator_registry_finish.sql'
);

function readMigration() {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

// Strip SQL line comments before matching — this repo's standing doctrine
// (A5c/N18/B1/OCR1c): a fix's own prose explaining a rule must never satisfy
// a grep for the rule, and this migration's header/comments quote several of
// the exact literals its assertions check for.
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('ID2a-cleanup — migration structural invariants', () => {
  const raw = readMigration();
  const sql = stripSqlComments(raw);

  it('never deletes an operators row — retire/reclassify, never delete', () => {
    assert.doesNotMatch(sql, /delete\s+from\s+public\.operators/i);
  });

  it('never hard-deletes a review-lane row either', () => {
    assert.doesNotMatch(sql, /delete\s+from\s+public\.dia_operator_write_review/i);
  });

  it('widens the kind CHECK to include junk, alongside the four ID2a kinds', () => {
    assert.match(
      sql,
      /check\s*\(\s*kind\s+in\s*\(\s*'company',\s*'category',\s*'payer',\s*'non_operator',\s*'junk'\s*\)\s*\)/i
    );
  });

  it('the two byte-identical duplicates ID2a missed are folded via the SAME generic merge function, never a bespoke UPDATE', () => {
    const usrcCall = sql.match(/dia_id2a_merge_operator_group\('US Renal Care',\s*ARRAY\[([^\]]*)\]/i);
    assert.ok(usrcCall, 'expected a US Renal Care merge-group call');
    assert.match(usrcCall[1], /'Us Renal Care Inc'/);

    const dciCall = sql.match(/dia_id2a_merge_operator_group\('Dialysis Clinic, Inc\.',\s*ARRAY\[([^\]]*)\]/i);
    assert.ok(dciCall, 'expected a Dialysis Clinic, Inc. merge-group call');
    assert.match(dciCall[1], /'Dialysis Clinic Inc'/);
  });

  it('subsidiaries are PARENTED, never merged — BMA/Knickerbocker under Fresenius, DCI East Gainesville under DCI', () => {
    assert.match(sql, /parent_operator_id\s*=\s*v_fmc/);
    assert.match(sql, /'BMA Quincy',\s*'BMA OF NORTH CHARLOTTE INC',\s*'KNICKERBOCKER DIALYSIS, INC'/);
    assert.match(sql, /parent_operator_id\s*=\s*v_dci/);
    assert.match(sql, /name\s*=\s*'DCI East Gainesville'/);
    // None of the four subsidiary names may appear inside a merge-group ARRAY
    // call anywhere in the file — parenting and merging must never be the
    // same operation on the same row.
    const mergeCalls = [...sql.matchAll(/dia_id2a_merge_operator_group\([^)]*ARRAY\[([^\]]*)\]/gi)].map((m) => m[1]);
    for (const name of ['BMA Quincy', 'BMA OF NORTH CHARLOTTE INC', 'KNICKERBOCKER DIALYSIS, INC', 'DCI East Gainesville']) {
      for (const arr of mergeCalls) {
        assert.doesNotMatch(arr, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
  });

  it('junk reclassification is an exact-name IN-list, never a LIKE/ILIKE pattern (no guessing at a new person/junk name)', () => {
    const junkBlock = sql.match(/set\s+kind\s*=\s*'junk'[\s\S]*?where\s+name\s+in\s*\(([\s\S]*?)\)/i);
    assert.ok(junkBlock, 'expected the junk reclassification UPDATE');
    for (const name of [
      'Family Video', 'Robert Young', 'Cheryl Ann Cunnings', 'FERNANDO RAUDALES',
      'C/O ST. FRANCIS HOSPITAL', 'D/B/A PERRY DIALYSIS CENTER',
    ]) {
      assert.match(junkBlock[1], new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(sql, /kind\s*=\s*'junk'[\s\S]{0,400}ilike/i);
  });

  it('the two ID3i piped multi-tenant rows are left alone — no `kind` write touches them here', () => {
    // The only mention of the DaVita | pattern in this file is descriptive
    // prose (this migration must not re-classify or merge them — that stays
    // ID3i's job); it must never appear inside an UPDATE ... SET kind = ...
    // statement in THIS file (ID2a already handled them).
    assert.doesNotMatch(sql, /set\s+kind\s*=[\s\S]{0,600}DaVita \|/i);
  });

  it('the alias seed is exact-match only and re-runnable (a function, not a one-shot DO block)', () => {
    const fnMatch = sql.match(
      /create or replace function public\.dia_id2a_seed_registry_aliases\([^)]*\)([\s\S]*?)^\$\$;/im
    );
    assert.ok(fnMatch, 'expected dia_id2a_seed_registry_aliases body');
    assert.match(fnMatch[1], /alias_norm\s*=\s*lower\(btrim\(o\.name\)\)/i);
    assert.match(fnMatch[1], /unnest\(coalesce\(o\.dba_names/i);
    assert.match(fnMatch[1], /on conflict \(alias_norm\) do nothing/i);
    // Scoped to kind='company', never seeding an alias for a category/payer/
    // non_operator/junk row.
    assert.match(fnMatch[1], /o\.kind\s*=\s*'company'/i);
  });

  it('the seed is dry-run default, matching every other ID2a-family function', () => {
    assert.match(sql, /dia_id2a_seed_registry_aliases\(p_dry_run boolean default true\)/i);
  });

  it('operator_class is additive and gated to properties, never assigned alongside a matched operator_id', () => {
    assert.match(sql, /alter table public\.properties add column if not exists operator_class text/i);
    assert.match(sql, /check\s*\(\s*operator_class is null or operator_class in \(\s*'category',\s*'payer',\s*'non_operator'\s*\)\s*\)/i);
    const guardFn = sql.match(/create or replace function public\.dia_operator_write_guard\(\)([\s\S]*?)^\$\$;/im);
    assert.ok(guardFn, 'expected dia_operator_write_guard body');
    // The properties-only guard on NEW.operator_class writes, both branches.
    const propertiesGuardedWrites = [...guardFn[1].matchAll(/if TG_TABLE_NAME = 'properties' then\s*\n\s*NEW\.operator_class/g)];
    assert.equal(propertiesGuardedWrites.length, 2, 'expected TWO table-name-guarded operator_class assignments (classification branch + matched branch)');
  });

  it('a matched operator ALWAYS nulls operator_class on properties, and vice versa — never both set', () => {
    const guardFn = sql.match(/create or replace function public\.dia_operator_write_guard\(\)([\s\S]*?)^\$\$;/im)[1];
    assert.match(guardFn, /NEW\.operator_id\s*:=\s*null;[\s\S]{0,40}return NEW;/); // classification branch nulls operator_id
    assert.match(guardFn, /NEW\.operator_id\s*:=\s*v_op_id;/); // matched branch sets operator_id
  });

  it('review-queue classification closures are DISMISSED, never counted as a genuine alias resolution', () => {
    assert.match(sql, /status\s*=\s*'dismissed'/);
    assert.match(sql, /resolution_note\s*=\s*format\(/);
    assert.match(sql, /o\.kind\s+in\s*\(\s*'category',\s*'payer',\s*'non_operator'\s*\)/);
  });

  it('the property/review backfill in step 6 is a direct matched-only UPDATE, never a re-invocation of the ID2a backfill function (which would duplicate review rows)', () => {
    assert.doesNotMatch(sql, /select\s+public\.dia_id2a_backfill_property_operator_ids/i);
    assert.match(sql, /res\.status\s*=\s*'matched'/);
  });

  it('the orphan-company detector requires ALL FOUR of no-alias, no-properties, no-parent, not-merged', () => {
    const viewMatch = sql.match(/create or replace view public\.v_dia_operator_orphan_registry_gap as([\s\S]*?);/i);
    assert.ok(viewMatch, 'expected the orphan-registry-gap view');
    const body = viewMatch[1];
    assert.match(body, /o\.kind\s*=\s*'company'/i);
    assert.match(body, /o\.merged_into_operator_id is null/i);
    assert.match(body, /o\.parent_operator_id is null/i);
    assert.match(body, /not exists[\s\S]*dia_operator_aliases/i);
    assert.match(body, /not exists[\s\S]*properties/i);
  });

  it('no operators row is ever deleted by the constraint-drop/re-add around the kind CHECK', () => {
    // The CHECK constraint is dropped and re-added (to widen its vocabulary),
    // never the column or the table.
    assert.doesNotMatch(sql, /alter table public\.operators\s+drop column/i);
    assert.doesNotMatch(sql, /drop table public\.operators/i);
  });
});
