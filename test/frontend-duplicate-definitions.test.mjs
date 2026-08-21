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
  // ⚠️ RECLASSIFIED 2026-08-20 — NOT dead code, and NOT confirmed broken either.
  //    Both implementations open the SAME elements (#detailPanel / #detailOverlay
  //    / #detailHeader / #detailTabs / #detailBody) — two builds of one contact
  //    slide-over. contacts-ui.js loads last and wins; detail.js (10784, 10849,
  //    13956) and detail-openers.js (152, 157, 321, 329) all reach the winner.
  //    Whether that is harmful depends on ID-SPACE COMPATIBILITY: the winner
  //    fetches via contactsApi('GET','get',{id}) (unified-contact ids), while
  //    detail.js passes ct.unified_id || ct.sf_contact_id and detail-openers
  //    passes contacts[0].id. That cannot be settled by reading definitions —
  //    it needs a live check on a property whose contact came from Salesforce.
  //    LEFT AS A KNOWN DUPLICATE DELIBERATELY: unlike the three fixed today,
  //    there is no signature or render-target mismatch proving harm, and
  //    renaming on suspicion could break the working path. OPEN QUESTION, not
  //    dead code — do not re-label it dead without checking the call sites.
  'openContactDetail|detail-openers.js|contacts-ui.js',

  // ── (D) was: loadMergeQueue|app.js|contacts-ui.js — ALSO MISCLASSIFIED as
  //    dead (C). app.js's 2,403-byte version was not dead, it was SHADOWED:
  //    contacts-ui.js loads later and its 303-byte version won. Because that one
  //    renders into #contactsContent (a different PAGE), the Marketing → Unified
  //    Contacts "Merge Queue / Click to review" card was a DEAD BUTTON, and the
  //    whole ucMerge/ucDismissMerge UI beneath it was unreachable. Fixed by
  //    renaming app.js's to ucLoadMergeQueue. Entry removed — duplicate is gone.
  // ── (D) was: buildResearchAssistantPrompt|detail.js|ops.js — MISCLASSIFIED
  //    AS DEAD CODE (C) and it was actually a SECOND LIVE BUG, found 2026-08-20
  //    while extracting the ops research block. detail.js:10541 called it with a
  //    provider STRING; ops.js loads later and its (item) version won, defaulting
  //    every field and returning a NON-EMPTY generic prompt — so the `if (!prompt)`
  //    guard never fired and all three property-panel export buttons silently
  //    copied a property-less brief. Fixed by renaming detail.js's to
  //    _udBuildResearchAssistantPrompt. Entry removed because the duplicate is gone.
  //    LESSON: "both definitions exist" does not tell you whether the loser is
  //    dead — only the CALL SITES do. Two of the three (C) entries have now turned
  //    out to be live bugs on inspection. Re-check the remaining ones the same way.
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
})

// ─────────────────────────────────────────────────────────────────────────────
// FULL AUDIT OF THE ALLOWLIST — 2026-08-20
//
// Every one of the 33 catalogued duplicates was checked by CALL SITE, not by
// reading definitions. Result:
//   • 26  genuine stub -> real   (app.js ships an inert placeholder; gov.js /
//                                 dialysis.js / ops.js override with the real one)
//   •  2  dead but harmless      renderGovTab / renderDiaTab — app.js ships a
//                                 COMPLETE simpler dispatcher, not a stub; the
//                                 winner is a strict SUPERSET of its cases
//                                 (guarded below).
//   •  1  equivalent in practice _py (gov.js vs dialysis.js). Genuinely
//                                 different code: gov's accepts a raw scalar,
//                                 dialysis's returns null for one. dialysis.js
//                                 loads last and wins, so gov's 6 call sites run
//                                 dialysis's version. NOT a bug, because every
//                                 value reaching it comes from
//                                 `window._govFormDraft[id] = el.value` and
//                                 el.value is ALWAYS a string, which both handle
//                                 identically. The scalar branch never fires.
//   •  1  OPEN QUESTION          openContactDetail (see its note above)
//   •  3  WERE LIVE BUGS, all fixed 2026-08-20:
//         _opsSparkline                — dialysis Ops census chart read "no trend"
//         buildResearchAssistantPrompt — property export copied a property-less brief
//         loadMergeQueue               — Marketing merge-queue card was a dead button
//
// Three of the four entries I had personally labelled "dead code" were wrong,
// and all three were user-visible. The label was never evidence.
// ─────────────────────────────────────────────────────────────────────────────

describe('dead-but-harmless duplicates stay harmless', () => {
  // renderGovTab / renderDiaTab: app.js's version is a COMPLETE dispatcher that
  // gov.js / dialysis.js override. That is safe only while the winner handles
  // every tab the loser does. If someone adds a case to app.js's dead version
  // (thinking it is live) or drops one from the winner, a tab silently renders
  // nothing — so assert the superset rather than trusting the comment.
  function sliceFn(src, name) {
    const m = new RegExp(`^function\\s+${name}\\s*\\(`, 'm').exec(src);
    assert.ok(m, `${name} not found`);
    const b = src.indexOf('{', m.index + m[0].length);
    let d = 0;
    for (let i = b; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (!d) return src.slice(m.index, i + 1); }
    }
    throw new Error(`could not balance ${name}`);
  }
  const cases = (src) => new Set([...src.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]));

  for (const [fn, winnerFile] of [['renderGovTab', 'gov.js'], ['renderDiaTab', 'dialysis.js']]) {
    it(`${winnerFile}'s ${fn} handles every tab app.js's dead version does`, () => {
      const loser = cases(sliceFn(readFileSync(join(root, 'app.js'), 'utf8'), fn));
      const winner = cases(sliceFn(readFileSync(join(root, winnerFile), 'utf8'), fn));
      const orphaned = [...loser].filter((c) => !winner.has(c));
      assert.deepEqual(orphaned, [],
        `${winnerFile} overrides app.js's ${fn} but does NOT handle: ${orphaned.join(', ')} — `
        + 'those tabs would render nothing');
    });
  }
});
