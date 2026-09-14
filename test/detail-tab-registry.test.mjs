// W6.5 Stage 2 — detail.js tab-registry guard.
//
// detail.js is ~1.04 MB / 18.5k lines and is about to be split BY TAB into
// classic sibling scripts (detail-rent.js, detail-tab-documents.js,
// detail-entity.js, …). The failure mode that split invites is silent: a tab
// button survives in the strip while the renderer it dispatches to moves out,
// gets renamed, or is dropped — and the tab simply renders "Unknown tab" (or
// nothing) at runtime. No test fails, no build breaks; a user finds it.
//
// This guard pins the registry contract:
//   every label in a tab strip must dispatch to a renderer that EXISTS.
//
// It deliberately reads the CONCATENATION of detail.js and every detail-*.js
// sibling, so it keeps passing as regions are extracted — that is the whole
// point. Mirror of the W8 federated-lane wiring guard and the Stage-1
// load-order smoke test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every file the detail slide-over is made of, now and after any extraction.
const detailFiles = ['detail.js', ...readdirSync(root)
  .filter(f => /^detail-[a-z0-9-]+\.js$/i.test(f))
  .sort()];
const SRC = detailFiles.map(f => readFileSync(join(root, f), 'utf8')).join('\n');

/** Is `name` defined as a function anywhere in the detail sources? */
function isDefined(name) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(function\\s+${n}\\s*\\(|` +                    // function foo(
    `(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s*)?(?:function|\\()|` + // const foo = (…)=>
    `window\\.${n}\\s*=)`                            // window.foo =
  ).test(SRC);
}

/** Body of a top-level `function name(...) { … }`, brace-matched. */
function functionBody(name) {
  const start = SRC.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (start < 0) return '';
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(open, i + 1);
  }
  return '';
}

describe('W6.5 Stage 2 — detail.js tab registry (every tab has a reachable renderer)', () => {
  it('all detail sources parse (node --check)', () => {
    for (const f of detailFiles) {
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, f)]),
        `${f} must be syntactically valid`);
    }
  });

  // ─── property slide-over ────────────────────────────────────────────────
  const propTabsMatch = SRC.match(/const\s+tabs\s*=\s*\[([^\]]*'Rent Roll'[^\]]*)\]/);

  it('the property tab strip is still discoverable', () => {
    assert.ok(propTabsMatch, 'could not find the property tab-strip array (the one containing "Rent Roll")');
  });

  const propTabs = propTabsMatch
    ? [...propTabsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1])
    : [];

  it('the property strip has the expected labels', () => {
    assert.deepEqual(propTabs,
      ['Overview', 'Rent Roll', 'Operations', 'Deal History', 'Ownership', 'Documents', 'Activity Log'],
      'property tab strip changed — update this guard deliberately, do not silently widen it');
  });

  it('every property tab dispatches to a renderer that EXISTS', () => {
    const switchBody = functionBody('switchUnifiedTab');
    assert.ok(switchBody, 'switchUnifiedTab must be defined in the detail sources');

    const renderTabBody = functionBody('_udRenderTab');
    assert.ok(renderTabBody, '_udRenderTab must be defined in the detail sources');

    // async branches: `tabName === 'X'` … `_udRenderXAsync(bodyEl)`
    const asyncFor = new Map();
    for (const m of switchBody.matchAll(/tabName\s*===\s*'([^']+)'[\s\S]{0,220}?(_ud\w*Async)\s*\(/g)) {
      asyncFor.set(m[1], m[2]);
    }
    // sync branches: `case 'X': return _udTabX();`
    const syncFor = new Map();
    for (const m of renderTabBody.matchAll(/case\s+'([^']+)'\s*:\s*return\s+(\w+)\s*\(/g)) {
      syncFor.set(m[1], m[2]);
    }

    const unreachable = [];
    const missing = [];
    for (const tab of propTabs) {
      const fn = asyncFor.get(tab) || syncFor.get(tab);
      if (!fn) { unreachable.push(tab); continue; }
      if (!isDefined(fn)) missing.push(`${tab} → ${fn}()`);
    }

    assert.deepEqual(unreachable, [],
      `tab(s) in the strip with NO dispatch branch — they would render "Unknown tab": ${unreachable.join(', ')}`);
    assert.deepEqual(missing, [],
      `tab(s) dispatching to a renderer that is not defined in any detail source: ${missing.join(', ')}`);
  });

  it('every legacy tab alias maps onto a real tab', () => {
    const body = functionBody('_udMapLegacyTab');
    assert.ok(body, '_udMapLegacyTab must be defined');
    const targets = [...body.matchAll(/return\s+'([^']+)'/g)].map(m => m[1]);
    assert.ok(targets.length, 'expected _udMapLegacyTab to return literal tab names');
    const known = new Set([...propTabs, 'Ownership & CRM']); // documented legacy alias
    const dead = targets.filter(t => !known.has(t));
    assert.deepEqual(dead, [],
      `legacy alias maps to a tab that no longer exists (deep-links would break): ${dead.join(', ')}`);
  });

  // ─── entity slide-over ──────────────────────────────────────────────────
  it('every entity tab dispatches to a renderer that EXISTS', () => {
    const m = SRC.match(/const\s+ENTITY_DETAIL_TABS\s*=\s*\[([^\]]*)\]/);
    assert.ok(m, 'ENTITY_DETAIL_TABS must be defined in the detail sources');
    const entityTabs = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    assert.ok(entityTabs.length >= 5, 'expected the entity tab set to be non-trivial');

    const body = functionBody('_renderEntityTab');
    assert.ok(body, '_renderEntityTab must be defined in the detail sources');

    const caseFor = new Map();
    for (const c of body.matchAll(/case\s+'([^']+)'\s*:\s*body\s*=\s*([\s\S]{0,200}?);\s*break/g)) {
      const fn = (c[2].match(/(_\w+)\s*\(/) || [])[1];
      if (fn) caseFor.set(c[1], fn);
    }

    const unreachable = entityTabs.filter(t => !caseFor.has(t));
    const missing = entityTabs
      .filter(t => caseFor.has(t) && !isDefined(caseFor.get(t)))
      .map(t => `${t} → ${caseFor.get(t)}()`);

    assert.deepEqual(unreachable, [],
      `entity tab(s) with no case in _renderEntityTab: ${unreachable.join(', ')}`);
    assert.deepEqual(missing, [],
      `entity tab(s) dispatching to an undefined renderer: ${missing.join(', ')}`);
  });

  // ─── extraction invariant ───────────────────────────────────────────────
  it('the slide-over SHELL stays in detail.js (only tab bodies may be extracted)', () => {
    const shell = readFileSync(join(root, 'detail.js'), 'utf8');
    for (const fn of ['openUnifiedDetail', 'switchUnifiedTab', '_udMapLegacyTab']) {
      assert.match(shell, new RegExp(`function\\s+${fn}\\s*\\(`),
        `${fn} is the slide-over shell and must remain in detail.js`);
    }
  });

  it('no renderer is defined twice across the detail sources (a split must MOVE, not copy)', () => {
    const counts = new Map();
    for (const f of detailFiles) {
      const src = readFileSync(join(root, f), 'utf8');
      for (const m of src.matchAll(/^function\s+(_?\w+)\s*\(/gm)) {
        counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      }
    }
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n);
    assert.deepEqual(dupes, [],
      `function(s) defined more than once across detail sources — an extraction copied instead of moving: ${dupes.join(', ')}`);
  });
});
