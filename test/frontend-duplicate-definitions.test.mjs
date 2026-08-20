// W6.5 — cross-file DUPLICATE top-level function definitions.
//
// The SPA has no bundler: index.html loads classic <script> tags into ONE shared
// global scope. So two files defining `function foo()` is not a conflict the
// loader reports — the LATER file silently wins, and the earlier definition
// becomes unreachable code that still looks alive in the editor.
//
// Found 2026-08-20 while mapping Stage 3: 36 such duplicates exist, and every
// pair is genuinely DIFFERENT code, not copies. Most are benign — 28 are
// deliberate app.js placeholder stubs that gov.js / dialysis.js override with
// the real implementations, which is the intended progressive-load pattern.
//
// But the class is dangerous, and one of them is a LIVE BUG:
//
//   _opsSparkline  detail.js  ->overridden by->  ops.js
//     detail.js builds an OBJECT series ({total_patients, snapshot_date}) and
//     defines _opsSparkline(history) to read it. ops.js loads later and defines
//     _opsSparkline(series, opts) expecting NUMBERS. Number({...}) is NaN, every
//     point is filtered, and the dialysis Ops tab's "Patient Census & Trends"
//     sparkline renders the literal string "no trend" on every property.
//     Nothing errors. It reads like missing data.
//
// This guard does NOT try to eliminate the duplicates — several are intentional
// and removing them is a behaviour change. It pins the CURRENT set so a NEW one
// cannot appear silently, which is the failure mode that costs debugging hours.
// When you legitimately add or remove one, update KNOWN below and say why.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/** Local classic scripts, in index.html LOAD ORDER (CDN scripts excluded). */
function loadOrder() {
  return [...html.matchAll(/<script\s+src="([^"?]+\.js)(\?[^"]*)?"/g)]
    .map((m) => m[1])
    .filter((s) => !/^https?:\/\//i.test(s));
}

/** Top-level `function name(` / `async function name(` declarations. */
function topLevelFns(file) {
  const src = readFileSync(join(root, file), 'utf8');
  return [...src.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)].map((m) => m[1]);
}

/** Every duplicate, as `fn|shadowedFile|winningFile`. */
function findDuplicates() {
  const seen = new Map();
  const dupes = [];
  for (const file of loadOrder()) {
    for (const fn of new Set(topLevelFns(file))) {
      if (seen.has(fn)) dupes.push(`${fn}|${seen.get(fn)}|${file}`);
      else seen.set(fn, file);
    }
  }
  return dupes.sort();
}

// The 36 duplicates present on 2026-08-20, each as fn|shadowed|wins.
// Grouped by WHY they exist, because the reason determines whether a future
// change to one is fine or alarming.
const KNOWN = [
  // ── (A) INTENTIONAL: app.js ships inert placeholder stubs so the shell can
  // boot if a domain bundle is missing; gov.js / dialysis.js load later and
  // install the real implementations. 28 of these.
  'diaQuery|app.js|dialysis.js',
  'govQuery|app.js|gov.js',
  'loadDiaData|app.js|dialysis.js',
  'loadGovData|app.js|gov.js',
  'metricHTML|app.js|gov.js',
  'renderDiaChanges|app.js|dialysis.js',
  'renderDiaDetailBody|app.js|dialysis.js',
  'renderDiaLeases|app.js|dialysis.js',
  'renderDiaLoans|app.js|dialysis.js',
  'renderDiaNpi|app.js|dialysis.js',
  'renderDiaOverview|app.js|dialysis.js',
  'renderDiaPlayers|app.js|dialysis.js',
  'renderDiaResearch|app.js|dialysis.js',
  'renderDiaSales|app.js|dialysis.js',
  'renderDiaSearch|app.js|dialysis.js',
  'renderDiaTab|app.js|dialysis.js',
  'renderGovDetailBody|app.js|gov.js',
  'renderGovLeases|app.js|gov.js',
  'renderGovListings|app.js|gov.js',
  'renderGovLoans|app.js|gov.js',
  'renderGovOverview|app.js|gov.js',
  'renderGovOwnership|app.js|gov.js',
  'renderGovPipeline|app.js|gov.js',
  'renderGovPlayers|app.js|gov.js',
  'renderGovResearch|app.js|gov.js',
  'renderGovSales|app.js|gov.js',
  'renderGovSearch|app.js|gov.js',
  'renderGovTab|app.js|gov.js',

  // ── (B) HARMLESS: functionally equivalent re-definitions of tiny shared
  // helpers. Verified identical behaviour (esc: same 5 HTML escapes).
  'esc|app.js|ops.js',
  'jsStringArg|app.js|ops.js',
  '_pf|gov.js|dialysis.js',
  '_py|gov.js|dialysis.js',

  // ── (C) DEAD CODE — the shadowed version never runs. Not a crash, but the
  // editor shows live-looking code that cannot execute. Worth cleaning when
  // someone touches these files; left alone here because deleting them is a
  // behaviour change, not a refactor.
  'buildResearchAssistantPrompt|detail.js|ops.js',
  'loadMergeQueue|app.js|contacts-ui.js',   // app.js 2,403b dead under 303b
  'openContactDetail|detail-openers.js|contacts-ui.js', // dead before Unit 7 too

  // ── (D) was: _opsSparkline|detail.js|ops.js — the LIVE BUG. FIXED 2026-08-20:
  // the dead detail.js definition was removed and the two call sites now pass
  // numbers to ops.js's surviving implementation. The duplicate is gone, so it
  // is gone from this list too — the stale-entry check enforces that.
];

describe('W6.5 — no NEW cross-file duplicate function definitions', () => {
  it('every local <script> in index.html is readable and ordered', () => {
    const order = loadOrder();
    assert.ok(order.length >= 10, `expected the SPA script set, got ${order.length}`);
    assert.ok(order.includes('app.js') && order.includes('detail.js'));
  });

  it('the duplicate set has not grown (a new one would be a SILENT override)', () => {
    const found = findDuplicates();
    const known = new Set(KNOWN);
    const added = found.filter((d) => !known.has(d));
    assert.deepEqual(added, [],
      'NEW duplicate top-level definition(s). In the shared global scope the LATER '
      + 'file silently wins and the earlier one becomes unreachable — no error, no '
      + 'warning. Either rename one, or add it to KNOWN with a reason:\n'
      + added.map((d) => { const [fn, s, w] = d.split('|'); return `  ${fn}: ${s} is shadowed by ${w}`; }).join('\n'));
  });

  it('KNOWN has no stale entries (a resolved duplicate must be removed from it)', () => {
    const found = new Set(findDuplicates());
    const stale = KNOWN.filter((d) => !found.has(d));
    assert.deepEqual(stale, [],
      'KNOWN lists duplicate(s) that no longer exist — delete them so the list keeps '
      + 'meaning what it says:\n' + stale.map((d) => '  ' + d).join('\n'));
  });

  it('an extracted detail-*.js sibling never re-defines a detail.js function', () => {
    // Stage 2 invariant, checked independently of the allowlist: a split must
    // MOVE, not COPY. Two definitions in one scope means the later file wins
    // silently; two top-level `let`s of one name is a runtime SyntaxError.
    const siblings = loadOrder().filter((f) => /^detail-[a-z0-9-]+\.js$/i.test(f));
    const detailFns = new Set(topLevelFns('detail.js'));
    const offenders = [];
    for (const sib of siblings) {
      for (const fn of topLevelFns(sib)) if (detailFns.has(fn)) offenders.push(`${fn} (${sib})`);
    }
    assert.deepEqual(offenders, [],
      `detail.js and a sibling both define: ${offenders.join(', ')} — an extraction copied instead of moving`);
  });
});
