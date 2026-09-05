// ============================================================================
// MERGE1 — a "reversible" property merge that destroyed a child row on collision,
// on BOTH domains (dia: 205 of 585 merges already hit a CASCADE table; gov: 0
// merges run, but 397/397 review-lane groups would collide on investment_scores
// alone). The generic properties-FK loop caught the unique_violation and either
// left the row pointing at drop_id (dia, then destroyed by ON DELETE CASCADE) or
// ran an explicit DELETE (gov) -- both silent, both content loss the backup's
// snapshotted child id cannot recover.
//
// Fix: a per-table POLICY (re_derivable / fold_fill_blanks / resolve_status)
// consulted on collision, dia_merge_fold_table()/gov_merge_fold_table(), so the
// drop-side row is never blind-deleted -- it is discarded only when genuinely
// re-derivable, folded (fill-blanks) when substantive, or status-flipped out of
// a partial-unique predicate's scope when that preserves it whole.
//
// This guard reads the migration SOURCE (not the live DB -- no DB in CI) and
// pins the SHAPE of the fix: every table this arc measured as colliding is
// classified, the old destructive branches are gone from both merge functions,
// and both now dispatch a unique_violation through the fold table instead.
//
// Comments are stripped before matching (A5c/N18/B1 convention) because the
// migration headers quote the old destructive SQL verbatim while explaining
// what changed -- a raw-source grep would find the old shape "present" in prose.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DIA_PATH = 'supabase/migrations/dialysis/20260905120000_dia_merge1_fold_on_collision.sql';
const GOV_PATH = 'supabase/migrations/government/20260905120000_gov_merge1_fold_on_collision.sql';

function stripSqlComments(src) {
  // Strip `-- ...` line comments only (these migrations carry no /* */ blocks);
  // never touches string literals, which these files quote deliberately in prose.
  return src
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const diaRaw = readFileSync(join(ROOT, DIA_PATH), 'utf8');
const govRaw = readFileSync(join(ROOT, GOV_PATH), 'utf8');
const dia = stripSqlComments(diaRaw);
const gov = stripSqlComments(govRaw);

function fnBody(src, name) {
  const start = src.indexOf(`FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `expected to find FUNCTION public.${name}(`);
  const end = src.indexOf('\n$function$;', start);
  assert.notEqual(end, -1, `expected a closing $function$; after ${name}`);
  return src.slice(start, end);
}

test('dia: every table measured colliding (2026-09-05) has a policy row', () => {
  const policyBlock = dia.slice(
    dia.indexOf('INSERT INTO public.dia_merge_child_policy'),
    dia.indexOf('CREATE OR REPLACE FUNCTION public._dia_merge_fold_one_row')
  );
  for (const table of [
    'property_embeddings',
    'cap_rate_history',
    'property_metadata_backfill_queue',
    'pending_updates',
  ]) {
    assert.match(policyBlock, new RegExp(`'${table}'`), `${table} must have a dia_merge_child_policy row`);
  }
});

test('gov: every table measured colliding (2026-09-05) has a policy row', () => {
  const policyBlock = gov.slice(
    gov.indexOf('INSERT INTO public.gov_merge_child_policy'),
    gov.indexOf('CREATE OR REPLACE FUNCTION public._gov_merge_fold_one_row')
  );
  for (const table of ['investment_scores', 'property_embeddings', 'property_financials']) {
    assert.match(policyBlock, new RegExp(`'${table}'`), `${table} must have a gov_merge_child_policy row`);
  }
});

test('dia_merge_property: the properties-FK loop dispatches unique_violation through dia_merge_fold_table', () => {
  const body = fnBody(dia, 'dia_merge_property');
  // The loop over confrelid='public.properties' FKs must catch unique_violation and call the
  // fold dispatcher -- never leave the row silently pointing at drop_id (the CASCADE-loss shape).
  const loopStart = body.indexOf("confrelid='public.properties'::regclass");
  assert.notEqual(loopStart, -1);
  const loopRegion = body.slice(loopStart);
  assert.match(loopRegion, /WHEN unique_violation THEN\s*\n\s*v_fold_detail\s*:=\s*public\.dia_merge_fold_table/);
});

test('gov_merge_property_apply: the properties-FK loop no longer runs a bare DELETE on collision', () => {
  const body = fnBody(gov, 'gov_merge_property_apply');
  const loopStart = body.indexOf("confrelid='public.properties'::regclass");
  assert.notEqual(loopStart, -1);
  const loopRegion = body.slice(loopStart);
  // The old defect: `WHEN unique_violation THEN ... DELETE FROM %s WHERE %I = $1` right after the
  // violation, tagging the loss `_deleted_on_collision`. That branch must be gone.
  assert.doesNotMatch(loopRegion, /_deleted_on_collision/);
  assert.match(loopRegion, /WHEN unique_violation THEN\s*\n[\s\S]*?public\.gov_merge_fold_table/);
});

test('the fold engine fills blanks (COALESCE keep,drop) and never overwrites an existing keep-side value', () => {
  for (const [src, fnName] of [
    [dia, '_dia_merge_fold_one_row'],
    [gov, '_gov_merge_fold_one_row'],
  ]) {
    const body = fnBody(src, fnName);
    assert.match(body, /COALESCE\(k\.%I,\s*d\.%I\)/, `${fnName} must COALESCE(keep, drop), never the reverse`);
  }
});

test('the fold engine deletes the drop-side row only after resolving/folding it, and identifies the keep row by the FK column, not its own PK', () => {
  for (const [src, fnName] of [
    [dia, '_dia_merge_fold_one_row'],
    [gov, '_gov_merge_fold_one_row'],
  ]) {
    const body = fnBody(src, fnName);
    assert.match(body, /format\('k\.%I = \$1', p_fk_col\)/, `${fnName} must match the keep row on the FK column`);
    const deleteIdx = body.indexOf("EXECUTE format('DELETE FROM public.%I WHERE %I::text = $1', p_table, p_pk_col)");
    const updateIdx = body.indexOf('UPDATE public.%I k SET');
    assert.ok(deleteIdx > -1, `${fnName} must delete the drop row`);
    // when there are columns to fold, the UPDATE must run before the DELETE
    if (updateIdx > -1) assert.ok(deleteIdx > updateIdx, `${fnName} must fold before deleting`);
  }
});

test('an unclassified table defaults to fold_fill_blanks off its own PK, never a blind delete', () => {
  for (const [src, fnName] of [
    [dia, 'dia_merge_fold_table'],
    [gov, 'gov_merge_fold_table'],
  ]) {
    const body = fnBody(src, fnName);
    const noPolicyBranch = body.slice(body.indexOf('IF v_policy IS NULL THEN'), body.indexOf('END IF;\n\n  FOR v_row'));
    assert.doesNotMatch(noPolicyBranch, /DELETE FROM/i, `${fnName}'s unclassified branch must never delete`);
    assert.match(noPolicyBranch, /fold_fill_blanks/);
  }
});

test('re_derivable deletes the drop row directly; fold_fill_blanks and the resolve_status fallback both route through the one-row folder', () => {
  for (const [src, fnName] of [
    [dia, 'dia_merge_fold_table'],
    [gov, 'gov_merge_fold_table'],
  ]) {
    const body = fnBody(src, fnName);
    assert.match(body, /ELSIF v_policy = 're_derivable' THEN\s*\n\s*EXECUTE format\('DELETE FROM/);
    // both the plain fold_fill_blanks branch (ELSE) and the resolve_status double-collision
    // fallback call the SAME one-row folder -- one implementation, not two.
    const folderCalls = (body.match(/_merge_fold_one_row\(/g) || []).length;
    assert.equal(folderCalls, 2, `${fnName} should call the one-row folder from exactly 2 sites (resolve_status fallback + fold_fill_blanks)`);
  }
});
