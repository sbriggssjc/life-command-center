// Deals > Ownership rendered "No canonical clusters yet — run
// dia_unify_canonical_true_owners on the DB to seed" while PostgREST was
// actually answering HTTP 500 (the cluster view exceeded the 8 s
// statement_timeout). Two client defects turned a loud server error into a
// confident, wrong statement about the data:
//
//   1. diaQuery() returns [] on EVERY non-OK response, so the loader's catch
//      never fired and no toast was shown.
//   2. the empty state assumed the only reason for 0 rows was "not seeded yet",
//      and recommended a real owner-merge write on the strength of an error.
//
// These tests make both regressions loud. They exercise the real sliced
// function rather than a copy, and anchor source assertions on stable identity
// tokens (function names, variable names) — never on a line number or a text
// region that can drift.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const diaSrc = readFileSync(join(root, 'dialysis.js'), 'utf8');


function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

function sliceFn(src, name, isAsync = true) {
  const start = src.indexOf((isAsync ? 'async function ' : 'function ') + name + '(');
  assert.notEqual(start, -1, `${name} not found`);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, end = -1;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${name}`);
  return src.slice(start, end);
}

function buildDiaQuery(fetchImpl) {
  const factory = new Function('fetchImpl', `
    const fetch = fetchImpl;
    const window = { location: { origin: 'https://example.test' } };
    const console = { error() {}, warn() {} };
    ${sliceFn(diaSrc, 'diaQuery')}
    return diaQuery;
  `);
  return factory(fetchImpl);
}

const okEmpty = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
const http500 = async () => ({
  ok: false, status: 500,
  text: async () => '{"code":"57014","message":"canceling statement due to statement timeout"}',
});

describe('diaQuery error surfacing', () => {
  it('still returns [] on a failure by default — the ~70 existing callers are unchanged', async () => {
    const diaQuery = buildDiaQuery(http500);
    assert.deepEqual(await diaQuery('v_recorded_owner_canonical_clusters', '*', {}), []);
  });

  it('throws on a non-OK response when the caller opts in', async () => {
    const diaQuery = buildDiaQuery(http500);
    await assert.rejects(
      () => diaQuery('v_recorded_owner_canonical_clusters', '*', { throwOnError: true }),
      /HTTP 500/,
      'a 500 must reach the caller, not be laundered into an empty result'
    );
  });

  it('surfaces the DB message, so the operator learns it was a statement timeout', async () => {
    const diaQuery = buildDiaQuery(http500);
    const err = await diaQuery('x', '*', { throwOnError: true }).catch(e => e);
    assert.match(err.message, /statement timeout/);
  });

  it('throws on an abort (30 s client timeout) when the caller opts in', async () => {
    const diaQuery = buildDiaQuery(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    await assert.rejects(() => diaQuery('x', '*', { throwOnError: true }), /timed out/);
  });

  it('a genuinely empty 200 is still an empty result, not an error', async () => {
    const diaQuery = buildDiaQuery(okEmpty);
    assert.deepEqual(await diaQuery('x', '*', { throwOnError: true }), []);
  });
});

describe('the ownership loader and its empty state', () => {
  const loader = sliceFn(diaSrc, 'loadDiaOwnershipBacklog');

  it('opts into throwOnError, or a 500 is invisible again', () => {
    assert.match(loader, /v_recorded_owner_canonical_clusters/);
    assert.match(loader, /throwOnError:\s*true/,
      'loadDiaOwnershipBacklog must opt in — without it the catch below can never fire');
  });

  it('records the failure so the renderer can tell failed from empty', () => {
    // Both halves matter and each has to be asserted on its own: clearing the
    // flag on success, AND setting it on failure. Asserting only that the name
    // is assigned somewhere passes when the catch-branch write is deleted,
    // because the success-path reset still matches.
    assert.match(loader, /diaOwnershipBacklogError\s*=\s*null/,
      'a successful load must clear the previous failure');
    assert.match(loader, /diaOwnershipBacklogError\s*=\s*e\b/,
      'the catch must record the error, or the renderer cannot tell failed from empty');
  });

  it('never recommends the seeder on the strength of a failed read', () => {
    // dia_unify_canonical_true_owners is a real owner-merge write. The string
    // may appear, but only inside the branch where the query SUCCEEDED and
    // genuinely returned 0 rows.
    //
    // ⚠️ Scoped to the RENDERER function, not to the whole file. A first version
    // anchored on the bare literal `rows.length === 0`, which occurs first in an
    // unrelated NPI renderer ~200k characters earlier, so the slice spanned half
    // the file and the guard passed over a deliberately broken empty state.
    // Anchor block slices on a stable structural boundary — here the function
    // name — never on a literal that repeats.
    const render = stripComments(sliceFn(diaSrc, 'renderDiaOwnershipResearch', false));
    const zeroRows = render.indexOf('rows.length === 0');
    const seeder   = render.indexOf('dia_unify_canonical_true_owners');
    assert.notEqual(zeroRows, -1, 'empty-state branch not found in the renderer');
    assert.notEqual(seeder, -1, 'empty-state copy not found in the renderer');
    assert.ok(zeroRows < seeder, 'the seeder copy must sit inside the 0-rows branch');
    assert.match(render.slice(zeroRows, seeder), /diaOwnershipBacklogError/,
      'the seeder recommendation must sit behind the "did the query fail?" check');
  });

  it('the empty state says a failed read is not the same as no data', () => {
    const render = stripComments(sliceFn(diaSrc, 'renderDiaOwnershipResearch', false));
    const zeroRows  = render.indexOf('rows.length === 0');
    const filterMsg = render.indexOf('No clusters match your filter');
    assert.ok(zeroRows !== -1 && filterMsg > zeroRows);
    assert.match(render.slice(zeroRows, filterMsg), /failed/i,
      'an operator must be told the query failed, not that there is nothing to show');
  });
});
