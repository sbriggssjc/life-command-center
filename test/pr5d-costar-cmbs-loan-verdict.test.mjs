// ============================================================================
// PR5d — costar_cmbs_loan: 121 rungs for a capture arm that has never fired.
//
// PR5 filed this source `build_pending` on one measurement ("no costar_cmbs_loan
// rows in loans on either domain"). PR5d asked the three-way question that left
// open -- no scanner / keys dropped / scanner unreachable -- and the answer is
// the third. Measured live 2026-09-03:
//
//   * The scanner and the writer are BOTH live and wired end to end, and the
//     manifest matches the sub-page's host, so the content script does run there.
//   * costar_loan_id and source_url are 0 of 2,219 loans rows across both
//     domains. Those two columns are written ONLY by upsertLoanRecords, which is
//     why a zero on both is PROOF the loan sub-page has never been captured
//     rather than evidence of a relabelled writer.
//   * dia additionally gates snapshots / top-tenants / financials on
//     properties.track_cmbs_snapshots, false on 11,803 of 11,803 -- so 27 of the
//     121 rungs could not be exercised even by a captured page.
//
// These guards pin the properties the verdict RESTS on. Each one, if it
// regressed silently, would make the recorded verdict false without any error:
//
//   1. The detector is single-writer. If a second code path starts writing
//      loans.source_url / loans.costar_loan_id, the "0 of 2,219" measurement
//      stops proving anything and the next person re-derives a wrong answer.
//   2. The scanner must stay URL-gated on the loan sub-page. If the gate were
//      dropped, `page_never_captured` would become the wrong diagnosis.
//   3. The dia flag gates snapshots/top-tenants/financials and NOT commentary
//      or the loans row itself -- the 94/27 split is exactly that boundary.
//   4. The migration stamps all 121 rungs, splits them 94/27, deletes nothing,
//      and appends its view column at the END (CREATE OR REPLACE VIEW is
//      append-only; a mid-list insert raises 42P16).
//
// Comments are stripped before matching, and that is load-bearing here rather
// than hygiene: the migration header and the handler's own comments quote
// `costar_loan_id`, `source_url`, `track_cmbs_snapshots` and the counts many
// times while EXPLAINING them, so a raw grep finds every token present and
// passes straight over a complete revert (A5c / N18 / PR8 / OCR1c).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const url = (p) => new URL(p, import.meta.url).pathname;

const MIGRATION = url('../supabase/migrations/20261010120000_lcc_pr5d_costar_cmbs_loan_verdict.sql');
const PIPELINE  = url('../api/_handlers/sidebar-pipeline.js');
const SCANNER   = url('../extension/content/costar.js');
const MANIFEST  = url('../extension/manifest.json');

const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
// Block comments first, then line comments -- never the reverse, and never a
// literal-blanker here: an apostrophe in ordinary prose would open a string the
// scanner never closes and swallow real code behind it (OCR1c).
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

const MIG_RAW  = readFileSync(MIGRATION, 'utf8');
const MIG      = stripSql(MIG_RAW);
const PIPE     = stripJs(readFileSync(PIPELINE, 'utf8'));
const SCAN     = stripJs(readFileSync(SCANNER, 'utf8'));

// --- 0. the strippers work (positive control) -------------------------------

test('PR5d: comment stripping removes prose that would satisfy these greps', () => {
  // SQL: the header explains the finding; only the header must be stripped.
  // (The verdict EVIDENCE strings are data, not comments, and survive by design.)
  assert.ok(/MEASURED 2026-09-03/.test(MIG_RAW),
    'the migration header must still carry its measurement date');
  assert.equal(/MEASURED 2026-09-03/.test(MIG), false,
    'the header must NOT survive stripping');

  // JS: the handler's own comments name every token these greps look for.
  const pipeRaw = readFileSync(PIPELINE, 'utf8');
  assert.ok(/costar_loan_id, source_url, data_source: 'costar_cmbs_loan'/.test(pipeRaw),
    'sidebar-pipeline.js documents the payload shape in a comment');
  assert.equal(/costar_loan_id, source_url, data_source: 'costar_cmbs_loan'/.test(PIPE), false,
    'that comment must NOT survive stripping, or the greps below are satisfied ' +
    'by the explanation instead of by the code');
});

// --- 1. the detector is single-writer ---------------------------------------
//
// This is the guard that matters most. The PR5d verdict is an argument from a
// zero, and a zero is only evidence while exactly one writer could have made it
// non-zero.

test('PR5d: loans.costar_loan_id is written ONLY by the CMBS loan-detail arm', () => {
  const i = PIPE.indexOf('async function upsertLoanRecords');
  const j = PIPE.indexOf('async function upsertPropertyFinancials', i);
  assert.ok(i > 0 && j > i, 'both loan writers must still exist');

  const sites = [...PIPE.matchAll(/costar_loan_id\s*:/g)].map((m) => m.index);
  assert.ok(sites.length >= 1, 'the column must still be written somewhere');
  for (const at of sites) {
    assert.ok(at > i && at < j,
      `costar_loan_id is assigned at offset ${at}, outside upsertLoanRecords. ` +
      `PR5d's "0 of 2,219 rows" proves the loan sub-page was never captured ONLY ` +
      `while upsertLoanRecords is the sole writer of this column. A second writer ` +
      `does not break the code -- it destroys the detector, silently.`);
  }
  // Three sites is CORRECT and is not three writers: the gov and dia branches
  // of ONE payload ternary, plus a console.warn diagnostic. Pin the count so a
  // genuine fourth site is still caught, and pin that only two of them are
  // payload assignments.
  assert.equal(sites.length, 3,
    'expected the gov + dia payload branches and one diagnostic log');
  const inPayload = sites.filter(
    (at) => !/console\.(warn|log|error)\([^]{0,200}$/.test(PIPE.slice(Math.max(0, at - 200), at)));
  assert.equal(inPayload.length, 2,
    'exactly two of the three are payload assignments (gov + dia); the third is a log');
});

test('PR5d: the costar_sidebar loans writers never touch the detector columns', () => {
  // source_url legitimately appears elsewhere in this file (property_documents),
  // so scope by the loans WRITE rather than by the token.
  const i = PIPE.indexOf('async function upsertLoanRecords');
  const j = PIPE.indexOf('async function upsertPropertyFinancials', i);

  const posts = [...PIPE.matchAll(/'POST',\s*'loans'/g)].map((m) => m.index);
  assert.ok(posts.length >= 2, 'there must still be more than one loans writer');

  const others = posts.filter((at) => at < i || at > j);
  assert.ok(others.length >= 1, 'the costar_sidebar loans writers must still exist');
  for (const at of others) {
    const payload = PIPE.slice(Math.max(0, at - 4000), at);
    const stmt = payload.slice(payload.lastIndexOf('const loanData'));
    assert.equal(/costar_loan_id\s*:/.test(stmt), false,
      'a non-CMBS loans writer must never set costar_loan_id');
    assert.equal(/source_url\s*:/.test(stmt), false,
      'a non-CMBS loans writer must never set loans.source_url -- both columns ' +
      'are the evidence that the CMBS sub-page has never been captured');
  }
});

test('PR5d: that single writer is the CMBS loan-detail arm', () => {
  const i = PIPE.indexOf('async function upsertLoanRecords');
  assert.ok(i > 0, 'upsertLoanRecords must still exist');
  const j = PIPE.indexOf('async function upsertPropertyFinancials', i);
  assert.ok(j > i, 'upsertPropertyFinancials must follow it');
  const body = PIPE.slice(i, j);
  assert.match(body, /costar_loan_id:/,
    'costar_loan_id must be written inside upsertLoanRecords, not elsewhere');
  assert.match(body, /source_url:/,
    'source_url must be written inside upsertLoanRecords, not elsewhere');
  assert.match(body, /data_source:\s*'costar_cmbs_loan'/,
    'the arm must still stamp costar_cmbs_loan -- the ladder source under test');
});

// --- 2. the scanner stays gated on the sub-page it is named for -------------

test('PR5d: the CMBS scanners fire only on their own CoStar sub-pages', () => {
  assert.match(SCAN, /LOAN_DETAIL_URL_RE\s*=\s*\/[^\n]*detail\\\/lookup/,
    'parseCmbsLoanDetail must stay gated on /detail/lookup/{N}/loan; without ' +
    'that gate "the page is never captured" is the wrong diagnosis');
  assert.match(SCAN, /CMBS_FINANCIALS_URL_RE\s*=\s*\/[^\n]*cmbs-financials/,
    'parseCmbsFinancials must stay gated on the cmbs-financials tab');
  assert.match(SCAN, /if\s*\(\s*LOAN_DETAIL_URL_RE\.test\([^)]*\)\s*\)\s*\{\s*[^]*?loan_records\s*=/,
    'the loan_records payload must remain behind the URL gate');
});

test('PR5d: the extension can still reach the sub-page (host match is not the block)', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const costar = (manifest.content_scripts || []).find(
    (cs) => (cs.matches || []).some((m) => /costar\.com/.test(m)));
  assert.ok(costar, 'a content script must still match costar.com');
  assert.ok((costar.matches || []).includes('https://*.costar.com/*'),
    'the match must stay path-wildcarded (https://*.costar.com/*). A narrower ' +
    'pattern would make the sub-page structurally unreachable, which is a ' +
    'DIFFERENT verdict from "reachable but never visited"');
  assert.ok((costar.js || []).some((f) => /content\/costar\.js$/.test(f)),
    'content/costar.js must still be injected there');
  assert.ok((manifest.host_permissions || []).includes('https://*.costar.com/*'),
    'host_permissions must keep the same wildcard -- the sidebar reads bytes ' +
    'and posts from the authenticated tab, so narrowing it would also make the ' +
    'sub-page unreachable, by a second mechanism');
});

// --- 3. the dia gate boundary IS the 94/27 split ----------------------------

test('PR5d: dia track_cmbs_snapshots gates snapshots/top-tenants/financials', () => {
  const i = PIPE.indexOf('async function upsertLoanRecords');
  const j = PIPE.indexOf('async function upsertPropertyFinancials', i);
  const loanBody = PIPE.slice(i, j);
  const finBody  = PIPE.slice(j);

  assert.match(loanBody, /track_cmbs_snapshots/,
    'upsertLoanRecords must still read the dia opt-in flag');
  assert.match(loanBody, /if\s*\(\s*lr\.snapshot\s*&&\s*tracksSnapshots\s*\)/,
    'the snapshot (and its top-tenants) write must stay behind tracksSnapshots ' +
    '-- this is the boundary that puts 27 dia rungs in page_never_captured_flag_off');
  assert.match(finBody, /track_cmbs_snapshots/,
    'upsertPropertyFinancials must still return 0 for dia when the flag is false');
});

test('PR5d: the dia loans row and loan_commentary are NOT behind that flag', () => {
  const i = PIPE.indexOf('async function upsertLoanRecords');
  const j = PIPE.indexOf('async function upsertPropertyFinancials', i);
  const body = PIPE.slice(i, j);

  // The loans POST must not be inside a tracksSnapshots branch.
  const loanPost = body.indexOf("'POST', 'loans'");
  assert.ok(loanPost > 0, 'upsertLoanRecords must still POST to loans');
  const before = body.slice(0, loanPost);
  assert.equal(/if\s*\(\s*!?\s*tracksSnapshots\s*\)\s*(return|continue)/.test(before), false,
    'the dia loans write is ungated -- if that changes, dia.loans moves from ' +
    'page_never_captured to page_never_captured_flag_off and the 94/27 split is wrong');

  const decl = body.search(/const\s+commentary\s*=/);
  assert.ok(decl > 0, 'the commentary loop must still exist');
  const commentaryBlock = body.slice(decl, decl + 1200);
  assert.equal(/tracksSnapshots/.test(commentaryBlock), false,
    'commentary writes are ungated on BOTH domains; the verdict for ' +
    'dia.loan_commentary says so explicitly');
});

// --- 4. the migration's own shape -------------------------------------------

test('PR5d migration deletes nothing and re-ranks nothing', () => {
  assert.equal(/DELETE\s+FROM\s+public\.field_source_priority/i.test(MIG), false,
    'a rung is soft-retired in notes, never deleted: "unregistered" is a ' +
    'different BRANCH of lcc_merge_field, so removing a rung moves merge ' +
    'outcomes in both directions (PR5)');
  const u = MIG.indexOf('UPDATE public.field_source_priority');
  assert.ok(u > 0, 'the stamp UPDATE must exist');
  const stmt = MIG.slice(u, MIG.indexOf(';', u));
  assert.equal(/\bpriority\b/i.test(stmt), false,
    'PR5d records a verdict; the stamp UPDATE must not mention priority at all. ' +
    '(Asserting on /SET priority/ is not enough: a second SET clause on its own ' +
    'line never spells that pair -- found by this guard\'s own mutation pass.)');
  assert.equal(/\benforce_mode\b/i.test(stmt), false,
    'nor enforce_mode -- PR5d must not arm a gate on an arm that never fired');
  assert.equal(/enforce_mode\s*=\s*'strict'/i.test(MIG), false,
    'PR5d must not arm a gate on an arm that has never produced a row');
});

test('PR5d migration stamps every rung and pins the 94/27 split', () => {
  assert.match(MIG, /n_all\s*<>\s*121/,
    'the positive control must assert all 121 rungs are stamped');
  assert.match(MIG, /n_plain\s*<>\s*94/, 'and that 94 carry the plain verdict');
  assert.match(MIG, /n_flag\s*<>\s*27/, 'and that 27 carry the flag_off verdict');
  assert.match(MIG, /RAISE\s+EXCEPTION\s+'PR5d stamp mismatch/,
    'a partial stamp must abort the migration, not pass quietly');

  // Both verdicts must actually be inserted, or the control could only ever
  // fail. (A control that can never be satisfied is not a control.)
  for (const v of ['page_never_captured', 'page_never_captured_flag_off']) {
    assert.ok(MIG.includes(`'${v}'`), `verdict ${v} must be inserted`);
  }
  // Exactly the three flag-gated dia targets, no more.
  const flagged = [...MIG.matchAll(/\('(dia\.[a-z_]+)','page_never_captured_flag_off'/g)]
    .map((m) => m[1]).sort();
  assert.deepEqual(flagged,
    ['dia.loan_snapshots', 'dia.loan_top_tenants', 'dia.property_financials'],
    'only the three dia targets behind track_cmbs_snapshots carry the flag_off ' +
    'verdict -- dia.loans and dia.loan_commentary are ungated');
});

test('PR5d migration appends its view column at the END and keeps the PR5/PR5c ones', () => {
  const i = MIG.indexOf('CREATE OR REPLACE VIEW public.v_field_source_priority_triage');
  assert.ok(i > 0, 'the triage view must be re-created');
  const def = MIG.slice(i);
  for (const col of ['pr5_verdict', 'is_orphan_column', 'is_retired', 'pr5c_verdict']) {
    assert.ok(def.includes(col),
      `${col} must survive -- CREATE OR REPLACE VIEW matches by POSITION, so a ` +
      `dropped or reordered column silently renames the ones after it`);
  }
  const last = def.lastIndexOf('pr5d_verdict');
  const pr5c = def.lastIndexOf('pr5c_verdict');
  assert.ok(last > pr5c,
    'pr5d_verdict must be APPENDED after pr5c_verdict; a mid-list insert ' +
    'raises 42P16 ("cannot change name of view column")');
});

test('PR5d verdict prefix cannot shadow the PR5 / PR5c verdicts it prepends to', () => {
  // The view parses 'PR5:' and 'PR5c:' by regex. 'PR5d:' must not match either,
  // or stamping PR5d would blank 121 rungs' existing verdicts on a surface
  // nobody re-reads.
  const note = "PR5d:page_never_captured (2026-09-03) - x || PR5:build_pending (2026-09-02) - y";
  assert.equal(/PR5:([a-z_]+)/.exec(note)[1], 'build_pending',
    'PR5d: must not be read as PR5:');
  assert.equal(/PR5c:([a-z_]+)/.test(note), false, 'PR5d: must not be read as PR5c:');
  assert.equal(/PR5d:([a-z_]+)/.exec(note)[1], 'page_never_captured');
});
