// B5 — the drafter must RE-DRAFT a task whose source got deeper after the draft
// was built.
//
// WHAT THIS PINS, AND WHY.
//
// `prepareTasks` runs over `fresh` = open AND UNDRAFTED. That is correct while
// the source is static and silently wrong the moment a producer lands
// transitions the standing draft could not have seen. Measured live 2026-08-28,
// the day the B5 gov sales feeder wrote 2,776 transitions into
// gov.ownership_history: 527 of 579 open gov tasks already carried a draft. With
// no re-draft pass B5 converts on 52 tasks and the other 527 keep a shallower
// chain forever.
//
// This is the THIRD arrival of one failure mode — A4b (a stale guard verdict),
// A2b (a stale repeat-pair collapse) and now B5 (a stale link count) — so the
// pass is keyed on STATE ("the planner now yields more links than this draft
// used"), never on B5. That is what makes it self-clearing and what makes it
// catch the NEXT source (a county deed drop, an OCR batch) without knowing
// anything about it.
//
// The two silent failures guarded here:
//   * supersede on a NON-strict comparison, or on an empty gov fetch, and a good
//     draft is churned into a worse one — "the fetch failed" reading as "the
//     chain got shorter";
//   * run the pass AFTER fetchExistingDrafts() and it supersedes drafts that
//     this run can no longer rebuild, leaving the task with no draft at all.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING. The pass's own header discusses
// `fresh`, the 527/579 split and "the chain got shorter" at length, so a naive
// grep would match the prose that documents the guard and pass straight over its
// deletion — the A5c/N18 defect (a source detector reporting the bug it just
// removed) inside a test.
//
// Assertions anchor on FUNCTION NAMES and a body bounded by its own `async
// function` declaration, never on a line number or a banner-delimited region
// (the block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const TICK = 'api/_handlers/ownership-chain-draft-tick.js';
const RAW = readFileSync(TICK, 'utf8');

// Executable JS only — strip line comments and block comments.
const SRC = RAW
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The pass body, bounded by its own declaration and the next top-level
// `async function` — a STABLE structural boundary, not a banner.
function bodyOf(fnName) {
  const start = SRC.indexOf(`async function ${fnName}(`);
  assert.notEqual(start, -1, `${fnName} is not defined in ${TICK}`);
  const rest = SRC.slice(start + 1);
  const nextIdx = rest.indexOf('\nasync function ');
  return nextIdx === -1 ? SRC.slice(start) : SRC.slice(start, start + 1 + nextIdx);
}

test('the comment stripper is doing its job (positive control)', () => {
  // The header DOES discuss the failure in prose; the stripped source must not
  // inherit it, or every assertion below is matching documentation.
  assert.match(RAW, /the chain got shorter/,
    'pass rationale missing — this test would be pinning the wrong thing');
  assert.ok(!SRC.includes('the chain got shorter'),
    'comment stripper failed: prose survived into the matched source');
});

test('runB5RedraftPass exists and is invoked by the tick', () => {
  assert.ok(SRC.includes('async function runB5RedraftPass('),
    'the B5 re-draft pass is gone — 527 of 579 open tasks keep a stale draft');
  assert.match(SRC, /const\s+b5Redraft\s*=\s*await\s+runB5RedraftPass\(/,
    'runB5RedraftPass is defined but never called');
});

test('the pass runs BEFORE the existing-draft read', () => {
  const call = SRC.indexOf('await runB5RedraftPass(');
  const read = SRC.indexOf('await fetchExistingDrafts(');
  assert.notEqual(call, -1);
  assert.notEqual(read, -1);
  assert.ok(call < read,
    'B5 must supersede before fetchExistingDrafts(), or this run cannot rebuild '
    + 'what it just superseded and the task is left with no draft at all');
});

test('it supersedes only on a STRICT increase in link count', () => {
  const body = bodyOf('runB5RedraftPass');
  assert.match(body, /if\s*\(\s*now\s*>\s*was\s*\)/,
    'the strict-increase comparison is gone: a non-strict or reversed test '
    + 'churns good drafts, or supersedes on no change at all');
  assert.ok(!/now\s*>=\s*was/.test(body),
    'a >= comparison re-drafts every task every night for no gain');
  assert.ok(!/was\s*>\s*now/.test(body),
    'reversed comparison — this would supersede exactly the drafts that are '
    + 'still the deepest available');
});

test('an empty gov fetch supersedes nothing', () => {
  const body = bodyOf('runB5RedraftPass');
  assert.match(body, /if\s*\(\s*!ts\.length\s*\)\s*continue;/,
    '"the fetch returned nothing" must never read as "the chain got shorter"');
  assert.match(body, /if\s*\(\s*!d\.draftable\s*\)\s*continue;/,
    'a draftable standing draft must never be superseded by an undraftable one');
});

test('it re-runs the REAL planner rather than trusting stored state', () => {
  const body = bodyOf('runB5RedraftPass');
  assert.match(body, /OCD\.buildChainDraft\(/,
    'the pass must re-run the planner — a shortcut off a stored reason is how '
    + 'a failed fetch turns into a supersede (the A2b lesson)');
});

test('the standing link count comes from the VIEW, not a JS re-derivation', () => {
  const body = bodyOf('fetchOpenDraftedTasks');
  assert.match(body, /v_lcc_ownership_chain_draft_open_link_counts/,
    'the SQL view is the single owner of the comparison; a JS copy that walks '
    + "proposed_link->'links' is the normaliser drift this repo keeps paying for");
  assert.ok(!/jsonb_array_length/.test(bodyOf('runB5RedraftPass')),
    'link counting belongs in the view, not in the pass');
});

test('the pass is bounded and says so when it caps', () => {
  const body = bodyOf('runB5RedraftPass');
  assert.match(body, /B5_REDRAFT_SCAN_CAP/, 'the pass must be bounded');
  assert.match(body, /scan_capped/,
    'a capped scan reports a FLOOR, not a total — say so rather than implying '
    + 'the whole population was seen');
});

test('b5_redraft is reported in the tick response', () => {
  assert.match(SRC, /b5_redraft:\s*b5Redraft/,
    'an unreported pass is indistinguishable from one that never ran');
});

test('the LCC view migration ships with the pass', () => {
  const files = readdirSync('supabase/migrations')
    .filter((f) => f.includes('b5_chain_draft_open_link_counts'));
  assert.ok(files.length > 0, 'B5 view migration missing from supabase/migrations');
  const sql = readFileSync(`supabase/migrations/${files[0]}`, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(sql, /create or replace view public\.v_lcc_ownership_chain_draft_open_link_counts/);
  // OPEN tasks only: re-drafting a completed task would re-open settled work.
  assert.match(sql, /t\.status\s+in\s*\(\s*'queued',\s*'in_progress'\s*\)/,
    'the view must scope to OPEN tasks');
  assert.match(sql, /jsonb_array_length\(p\.proposed_link -> 'links'\)/,
    'the view is the single owner of the standing link count');
});
