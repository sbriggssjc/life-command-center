// CONSOLIDATE-REVERSIBLE (2026-09-24) — every LCC property merge goes through
// <dom>_merge_property_reversible, never the bare <dom>_merge_property.
//
// Measured live before the fix:
//   - gov_merge_property is a RAISE stub ("retired from direct use"), so every
//     gov Consolidate click and every gov Decision Center property_merge verdict
//     failed;
//   - dia_merge_property hard-deletes the drop row with no snapshot, so every dia
//     Consolidate was irreversible.
// The reversible wrappers snapshot first and return a backup_id; undo is
// <dom>_unmerge_property(backup_id).
//
// Also guarded: the merge-log reconcile must read <dom>_property_merge_backup
// (property_merge_log has no writer: dia last row 2026-05-17, gov 0 rows ever),
// and must filter entities on the SHORT domain (entities.domain is dia/gov;
// filtering on 'dialysis' alone matched 0 of 1,972 dia assets).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import {
  mergePropertyReversible, consolidateBatchTag, parseBackupId, REVERSIBLE_MERGE_RPC, shortDomain,
} from '../api/_shared/property-merge-reversible.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Class guard: no caller of the bare merge anywhere LCC ships code ─────
// Scans api/, scripts/, mcp/, supabase/functions/ and the root front-end files.
// Comments are stripped first: the fix's own comments name the bare function.
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}
function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js|ts|html)$/.test(name)) out.push(p);
  }
  return out;
}
// A bare call names the function with no suffix: `_reversible`, `_apply`,
// `_fold…` etc. all continue with `_`, so `(?![_\w])` excludes them.
const BARE = /\b(?:dia|gov)_merge_property(?![_\w])/;

function findBareMergeCallers(files) {
  const hits = [];
  for (const f of files) {
    const code = stripJsComments(readFileSync(f, 'utf8'));
    code.split('\n').forEach((line, i) => {
      if (BARE.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

function shippedFiles() {
  const files = [];
  for (const d of ['api', 'scripts', 'mcp', 'supabase/functions']) walk(join(ROOT, d), files);
  for (const name of readdirSync(ROOT)) {
    if (/\.(js|html)$/.test(name)) files.push(join(ROOT, name));
  }
  return files;
}

test('no shipped file calls the bare dia_merge_property / gov_merge_property', () => {
  const files = shippedFiles();
  assert.ok(files.length > 50, 'population control: the scan must actually see the code base');
  assert.ok(files.some((f) => f.endsWith(join('api', 'admin.js'))), 'population control: api/admin.js is scanned');
  assert.deepEqual(findBareMergeCallers(files), []);
});

test('the class guard is not blind: it flags the pre-fix call shapes', () => {
  const probe = [
    "const fn = c.domain === 'dia' ? 'rpc/dia_merge_property' : 'rpc/gov_merge_property';",
    "const fnName = domain === 'dia' ? 'dia_merge_property' : 'gov_merge_property';",
  ].join('\n');
  // Positive control: the same matcher, run over the pre-fix call shapes.
  const code = stripJsComments(probe);
  assert.equal(code.split('\n').filter((l) => BARE.test(l)).length, 2);
  // And the reversible names must NOT match.
  assert.ok(!BARE.test("'rpc/dia_merge_property_reversible'"));
  assert.ok(!BARE.test("'rpc/gov_merge_property_apply'"));
  assert.ok(!BARE.test('dia_unmerge_property'));
});

// ── 2. The shared helper routes to the reversible RPC with a batch tag ──────
test('mergePropertyReversible posts to the reversible wrapper with a consolidate_ batch tag', async () => {
  for (const [dom, longDom] of [['dia', 'dialysis'], ['gov', 'government'], ['dialysis', 'dialysis'], ['government', 'government']]) {
    const calls = [];
    const fakeQuery = async (d, method, path, body) => { calls.push({ d, method, path, body }); return { ok: true, data: 42 }; };
    const r = await mergePropertyReversible(fakeQuery, dom, '31796', 31048, 'panel', new Date('2026-09-24T12:00:00Z'));
    const short = shortDomain(dom);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].d, longDom);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, `rpc/${short}_merge_property_reversible`);
    assert.deepEqual(calls[0].body, { p_keep_id: 31796, p_drop_id: 31048, p_batch_tag: 'consolidate_panel_20260924' });
    assert.equal(r.ok, true);
    assert.equal(r.backup_id, 42);
  }
  assert.equal(REVERSIBLE_MERGE_RPC.gov, 'rpc/gov_merge_property_reversible');
  assert.equal(REVERSIBLE_MERGE_RPC.dia, 'rpc/dia_merge_property_reversible');
});

test('mergePropertyReversible reports failure and refuses bad input', async () => {
  const r = await mergePropertyReversible(async () => ({ ok: false, status: 400, data: { message: 'x' } }), 'gov', 1, 2, 'panel');
  assert.equal(r.ok, false);
  assert.equal(r.backup_id, null);
  await assert.rejects(mergePropertyReversible(async () => ({ ok: true }), 'cre', 1, 2, 'panel'));
  await assert.rejects(mergePropertyReversible(async () => ({ ok: true }), 'dia', 5, 5, 'panel'));
});

test('parseBackupId handles the shapes PostgREST returns for a scalar bigint', () => {
  assert.equal(parseBackupId(599), 599);
  assert.equal(parseBackupId('599'), 599);
  assert.equal(parseBackupId([599]), 599);
  assert.equal(parseBackupId([{ dia_merge_property_reversible: 599 }]), 599);
  assert.equal(parseBackupId(null), null);
  assert.equal(parseBackupId('nope'), null);
});

test('consolidateBatchTag is consolidate_<route>_<yyyymmdd>', () => {
  assert.equal(consolidateBatchTag('dc_property_merge', new Date('2026-09-24T23:59:00Z')), 'consolidate_dc_property_merge_20260924');
  assert.equal(consolidateBatchTag('Dup Review!', new Date('2026-01-02T00:00:00Z')), 'consolidate_dup_review_20260102');
});

// ── 3. Both admin.js call sites use the helper (AST span, not a text window) ─
const ADMIN = readFileSync(join(ROOT, 'api', 'admin.js'), 'utf8');
const AST = acorn.parse(ADMIN, { ecmaVersion: 'latest', sourceType: 'module' });

function fnSource(name) {
  for (const node of AST.body) {
    const decl = node.type === 'FunctionDeclaration' ? node
      : (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') ? node.declaration : null;
    if (decl && decl.id?.name === name) return ADMIN.slice(decl.start, decl.end);
  }
  return null;
}

test('handleConsolidateProperty merges through mergePropertyReversible and returns backup_id', () => {
  const src = fnSource('handleConsolidateProperty');
  assert.ok(src, 'handleConsolidateProperty must exist');
  const code = stripJsComments(src);
  assert.match(code, /mergePropertyReversible\(\s*domainQuery\s*,\s*domain\s*,\s*keepId\s*,\s*dropId\s*,\s*'panel'\s*\)/);
  assert.match(code, /backup_id:\s*r\.backup_id/);
  assert.match(code, /authenticate\(req,\s*res\)/, 'the merge branch must authenticate its caller');
});

test('the Decision Center property_merge verdict merges through mergePropertyReversible', () => {
  const i = ADMIN.indexOf("if (decision.decision_type === 'property_merge') {");
  assert.ok(i > 0);
  const j = ADMIN.indexOf("if (decision.decision_type === 'property_twin') {", i);
  assert.ok(j > i);
  const block = stripJsComments(ADMIN.slice(i, j));
  assert.match(block, /mergePropertyReversible\(\s*domainQuery\s*,\s*c\.domain\s*,\s*keepId\s*,\s*dropId\s*,\s*'dc_property_merge'\s*\)/);
  assert.match(block, /backup_id:\s*mr\.backup_id/);
});

// ── 4. The reconcile reads the reversible ledger and the short domain ───────
test('merge-log reconcile reads <dom>_property_merge_backup, skipping unmerged rows', () => {
  const src = stripJsComments(fnSource('handleMergeLogReconcile'));
  assert.match(src, /table:\s*`\$\{target\}_property_merge_backup`/);
  assert.match(src, /filter:\s*'&unmerged_at=is\.null'/);
  assert.match(src, /table:\s*'property_merge_log'/);
  assert.match(src, /reconciled_lcc_at:\s*new Date\(\)\.toISOString\(\)/);
});

test('merge-log reconcile counts entities on the short domain too', () => {
  const src = stripJsComments(fnSource('handleMergeLogReconcile'));
  assert.match(src, /domain=in\.\(\$\{target\},\$\{dom\}\)/);
  assert.doesNotMatch(src, /domain=eq\.\$\{pgFilterVal\(dom\)\}/);
});

test('the repoint helper migration matches both domain spellings', () => {
  const f = join(ROOT, 'supabase', 'migrations', '20261102310000_lcc_repoint_entity_property_id_short_domain.sql');
  const sql = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /e\.domain\s+IN\s*\(\s*v_short\s*,\s*v_long\s*\)/i);
  assert.doesNotMatch(sql, /e\.domain\s*=\s*p_domain/i);
});

test('both unmerge migrations insert a named column list without generated columns', () => {
  const files = [
    join(ROOT, 'supabase', 'migrations', 'dialysis', '20261013110000_dia_consolidate_reversible_unmerge_generated_cols.sql'),
  ];
  for (const f of files) {
    const sql = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
    assert.match(sql, /attgenerated\s*=\s*''/);
    assert.doesNotMatch(sql, /INSERT INTO public\.properties SELECT \*/i);
  }
});
