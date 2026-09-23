// SIDEBAR4-c (2026-09-23) — a second click during an in-flight sidebar Update
// must never reach the Re-run handler, and every extension call that can reach
// /api/entities must carry the X-LCC-Request-Id header.
//
// Evidence (LCC Opps, after the 1.0.55 reload): on every Update the run log
// shows an `entities.patch` followed 0.5–1.0 s later by an
// `action.process_sidebar_extraction` with its OWN side-panel UUID. The only
// extension call site for that action is the Re-run button. The Update label
// shrank on click ("Update LCC with CoStar Data" → "Updating..."), so the
// inline Re-run button slid left under the cursor and the follow-up click
// landed on it.
//
// Each block carries its own positive control (an in-memory mutation that must
// turn the assertion red), so a green run is not a detector that cannot fire.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';
import * as acorn from 'acorn';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const GUARD_SRC = readFileSync(join(EXT, 'shared/action-guard.js'), 'utf8');
const SIDEPANEL_SRC = readFileSync(join(EXT, 'sidepanel.js'), 'utf8');

// ── A minimal DOM: buttons laid out inline, left to right ───────────────────
// offsetWidth follows the label (6px per char + padding) but never goes below
// a frozen style.minWidth — the same rule a browser applies to an inline-block.
class FakeButton {
  constructor(label, container) {
    this.textContent = label;
    this.disabled = false;
    this.style = {};
    this.listeners = [];
    this.container = container;
  }
  get offsetWidth() {
    const natural = 20 + this.textContent.length * 6;
    const min = parseInt(this.style.minWidth || '0', 10) || 0;
    return Math.max(natural, min);
  }
  get offsetLeft() {
    let x = 0;
    for (const b of this.container.buttons) {
      if (b === this) return x;
      x += b.offsetWidth + 6;
    }
    return x;
  }
  addEventListener(type, fn) { if (type === 'click') this.listeners.push(fn); }
  // A browser does not dispatch click on a disabled button; `force` models a
  // click that arrives anyway (the guard must swallow it regardless).
  click({ force = false } = {}) {
    if (this.disabled && !force) return [];
    const ev = { stopped: false, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } };
    const out = [];
    for (const fn of this.listeners) {
      if (ev.stopped) break;
      out.push(fn.call(this, ev));
    }
    return out;
  }
}

class FakeContainer {
  constructor() { this.buttons = []; this.children = []; this.ownerDocument = { createElement: () => ({ className: '', prepend() {}, children: [] }) }; }
  add(label) { const b = new FakeButton(label, this); this.buttons.push(b); return b; }
  querySelectorAll(sel) { return sel === 'button' ? [...this.buttons] : []; }
  querySelector(sel) { return this.children.find((c) => sel === `.${c.className}`) || null; }
  appendChild(el) { this.children.push(el); return el; }
  // Which button is under an x coordinate (the "cursor").
  buttonAt(x) {
    return this.buttons.find((b) => x >= b.offsetLeft && x < b.offsetLeft + b.offsetWidth) || null;
  }
}

function loadGuard(src = GUARD_SRC) {
  const sandbox = { crypto: globalThis.crypto, chrome: { runtime: { getManifest: () => ({ version: '9.9.9' }) } } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.LccActionGuard;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// The side panel's Update + Re-run wiring, reduced to what matters here.
function renderActions(guard) {
  const actions = new FakeContainer();
  const group = guard.resetGroup(actions);
  const update = actions.add('Update LCC with CoStar Data');
  const rerun = actions.add('Re-run Pipeline');
  const patch = deferred();
  const calls = { update: 0, rerun: 0 };
  update.addEventListener('click', group.wrap(update, async () => {
    calls.update += 1;
    update.disabled = true;
    update.textContent = 'Updating...';
    await patch.promise;
    update.textContent = 'Updated!';
  }));
  rerun.addEventListener('click', group.wrap(rerun, async () => {
    calls.rerun += 1;
  }));
  return { actions, group, update, rerun, patch, calls };
}

async function secondClickScenario(guard) {
  const r = renderActions(guard);
  // Cursor on the right-hand part of Update — where a user lands on a wide label.
  const cursorX = r.update.offsetLeft + r.update.offsetWidth - 10;
  const first = r.actions.buttonAt(cursorX);
  assert.equal(first, r.update);
  const pending = first.click()[0];
  // The follow-up click (double-click / "did it take?" click) at the same x.
  const second = r.actions.buttonAt(cursorX);
  const secondResults = second ? second.click({ force: true }) : [];
  await Promise.all(secondResults);
  const duringFlight = { ...r.calls, secondTarget: second, rerunDisabled: r.rerun.disabled };
  r.patch.resolve();
  await pending;
  return { r, duringFlight };
}

describe('SIDEBAR4-c — a second click during an in-flight Update never reaches Re-run', () => {
  it('the premise: without frozen widths the Re-run button slides under the cursor', () => {
    const guard = loadGuard();
    const actions = new FakeContainer();
    const update = actions.add('Update LCC with CoStar Data');
    const rerun = actions.add('Re-run Pipeline');
    const cursorX = update.offsetLeft + update.offsetWidth - 10;
    update.textContent = 'Updating...'; // the old handler, no guard
    assert.equal(actions.buttonAt(cursorX), rerun, 'layout shift reproduces the misclick');
    assert.ok(guard, 'guard loads');
  });

  it('with the guard: widths frozen, Re-run stays put, the second click is swallowed', async () => {
    const { r, duringFlight } = await secondClickScenario(loadGuard());
    assert.equal(duringFlight.update, 1);
    assert.equal(duringFlight.rerun, 0, 'Re-run handler must not run during an in-flight Update');
    assert.equal(duringFlight.secondTarget, r.update, 'no layout shift: the cursor is still on Update');
    assert.equal(duringFlight.rerunDisabled, true, 'siblings are disabled while an action runs');
    assert.equal(r.rerun.disabled, false, 'siblings are restored when the action finishes');
  });

  it('a forced click on the disabled Re-run during flight is swallowed; a later deliberate Re-run runs', async () => {
    const guard = loadGuard();
    const r = renderActions(guard);
    const pending = r.update.click()[0];
    await Promise.all(r.rerun.click({ force: true }));
    assert.equal(r.calls.rerun, 0);
    r.patch.resolve();
    await pending;
    await Promise.all(r.rerun.click());
    assert.equal(r.calls.rerun, 1, 'a real Re-run after the Update finishes still fires');
  });

  it('a sibling that was disabled before the action stays disabled after it', async () => {
    const guard = loadGuard();
    const r = renderActions(guard);
    r.rerun.disabled = true; // e.g. nothing extractable
    const pending = r.update.click()[0];
    r.patch.resolve();
    await pending;
    assert.equal(r.rerun.disabled, true);
  });

  it('positive control: removing the in-flight check lets the second click through', async () => {
    const mutated = GUARD_SRC.replace('if (inFlight) {', 'if (false) {');
    assert.notEqual(mutated, GUARD_SRC);
    const guard = loadGuard(mutated);
    const r = renderActions(guard);
    const pending = r.update.click()[0];
    await Promise.all(r.rerun.click({ force: true }));
    assert.equal(r.calls.rerun, 1, 'the mutation must reach the Re-run handler');
    r.patch.resolve();
    await pending;
  });

  it('positive control: without the width freeze the second click lands on Re-run', async () => {
    const mutated = GUARD_SRC.replace('freezeWidths(container);\n', '\n');
    assert.notEqual(mutated, GUARD_SRC);
    const { r, duringFlight } = await secondClickScenario(loadGuard(mutated));
    assert.equal(duringFlight.secondTarget, r.rerun, 'layout shift is back');
    // The in-flight check still swallows it — the two defences are independent.
    assert.equal(duringFlight.rerun, 0);
  });
});

// ── Wiring: every property action button goes through the shared group ─────
const GUARDED_BUTTONS = ['updateBtn', 'saveBtn', 'rerunBtn', 'verifyBtn', 'offMarketBtn'];
// The property-action surface. Other tabs (e.g. the SOS org panel) reuse
// variable names like `saveBtn` for unrelated buttons.
const PROPERTY_ACTION_FNS = ['loadPropertyTab', 'wirePropertyActions'];

function unguardedClickSites(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const bad = [];
  const seen = new Set();
  (function walk(n, inScope) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration' && PROPERTY_ACTION_FNS.includes(n.id?.name)) inScope = true;
    if (inScope && n.type === 'CallExpression'
      && n.callee.type === 'MemberExpression'
      && n.callee.property.name === 'addEventListener'
      && n.callee.object.type === 'Identifier'
      && GUARDED_BUTTONS.includes(n.callee.object.name)
      && n.arguments[0]?.value === 'click') {
      const btn = n.callee.object.name;
      seen.add(btn);
      const h = n.arguments[1];
      const ok = h && h.type === 'CallExpression'
        && h.callee.type === 'MemberExpression'
        && h.callee.object.name === 'actionGroup'
        && h.callee.property.name === 'wrap'
        && h.arguments[0]?.name === btn;
      if (!ok) bad.push(btn);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, inScope));
      else if (v && typeof v.type === 'string') walk(v, inScope);
    }
  })(ast, false);
  return { bad, seen };
}

describe('SIDEBAR4-c — side-panel wiring', () => {
  it('Update, Save, Re-run, Verify and Mark-off-market are all wrapped by actionGroup.wrap', () => {
    const { bad, seen } = unguardedClickSites(SIDEPANEL_SRC);
    assert.deepEqual([...seen].sort(), [...GUARDED_BUTTONS].sort(), 'population: every guarded button was found');
    assert.deepEqual(bad, []);
  });

  it('positive control: an unwrapped Re-run handler is flagged', () => {
    const mutated = SIDEPANEL_SRC.replace(
      "rerunBtn.addEventListener('click', actionGroup.wrap(rerunBtn, async () => {",
      "rerunBtn.addEventListener('click', (async () => {",
    );
    assert.notEqual(mutated, SIDEPANEL_SRC);
    assert.deepEqual(unguardedClickSites(mutated).bad, ['rerunBtn']);
  });

  it('toasts never go ABOVE the action buttons', () => {
    assert.doesNotMatch(SIDEPANEL_SRC, /actions\.prepend\(toast\)/);
    assert.doesNotMatch(SIDEPANEL_SRC, /\$\('#propertyActions'\)\.prepend\(/);
  });

  it('the guard script loads before sidepanel.js', () => {
    const html = readFileSync(join(EXT, 'sidepanel.html'), 'utf8');
    const g = html.indexOf('src="shared/action-guard.js"');
    const s = html.indexOf('src="sidepanel.js"');
    assert.ok(g > 0 && s > g);
  });
});

// ── Every extension fetch that can reach /api/entities is stamped ───────────
function extensionSources(dir = EXT, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'lib') continue; // vendored pdf.js
      extensionSources(p, acc);
      continue;
    }
    if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function parseAny(src) {
  for (const sourceType of ['module', 'script']) {
    try { return acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true }); } catch { /* try next */ }
  }
  throw new Error('unparseable');
}

// A fetch "can reach /api/entities" when its enclosing function names that
// path, or takes an arbitrary `endpoint` (a generic LCC proxy). Such a
// function must build its headers with LccActionGuard.lccRequestHeaders.
function entitiesFetchSites(src, file) {
  const ast = parseAny(src);
  const sites = [];
  (function walk(n, fnStack) {
    if (!n || typeof n.type !== 'string') return;
    const isFn = /Function/.test(n.type);
    const stack = isFn ? [...fnStack, n] : fnStack;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'fetch') {
      const fn = stack[stack.length - 1];
      const body = fn ? src.slice(fn.start, fn.end) : src;
      const genericProxy = fn && fn.params.some((p) => p.type === 'Identifier' && p.name === 'endpoint');
      if (/\/api\/entities/.test(body) || genericProxy) {
        sites.push({ file, line: src.slice(0, n.start).split('\n').length, stamped: /lccRequestHeaders\(/.test(body) });
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, stack));
      else if (v && typeof v.type === 'string') walk(v, stack);
    }
  })(ast, []);
  return sites;
}

describe('SIDEBAR4-c — every extension call to /api/entities carries X-LCC-Request-Id', () => {
  const sites = extensionSources().flatMap((p) =>
    entitiesFetchSites(readFileSync(p, 'utf8'), relative(ROOT, p)));

  it('population: apiCall, the pipeline poll and the background proxy are all found', () => {
    const files = sites.map((s) => s.file);
    assert.ok(sites.length >= 3, `found ${sites.length}`);
    assert.ok(files.includes('extension/sidepanel.js'));
    assert.ok(files.includes('extension/background.js'));
  });

  it('every such fetch builds its headers through lccRequestHeaders', () => {
    const unstamped = sites.filter((s) => !s.stamped).map((s) => `${s.file}:${s.line}`);
    assert.deepEqual(unstamped, []);
  });

  it('positive control: the pre-SIDEBAR4-c apiCall header shape is flagged', () => {
    const mutated = SIDEPANEL_SRC.replace(
      "const headers = window.LccActionGuard.lccRequestHeaders(apiKey, { 'Content-Type': 'application/json' });",
      "const headers = { 'Content-Type': 'application/json', 'X-LCC-Key': apiKey };",
    );
    assert.notEqual(mutated, SIDEPANEL_SRC);
    assert.ok(entitiesFetchSites(mutated, 'x').some((s) => !s.stamped));
  });

  it('lccRequestHeaders stamps a UUID request id, the build tag and the key', () => {
    const guard = loadGuard();
    const h = guard.lccRequestHeaders('k', { 'Content-Type': 'application/json' });
    assert.match(h['X-LCC-Request-Id'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(h['X-LCC-Client'], 'lcc-extension/9.9.9');
    assert.equal(h['X-LCC-Key'], 'k');
    assert.equal(h['Content-Type'], 'application/json');
    assert.notEqual(guard.lccRequestHeaders()['X-LCC-Request-Id'], h['X-LCC-Request-Id']);
  });

  it('the fallback id (no randomUUID) is still a v4 UUID', () => {
    const guard = loadGuard();
    const sandbox = { crypto: { getRandomValues: (b) => globalThis.crypto.getRandomValues(b) } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(GUARD_SRC, sandbox);
    assert.match(sandbox.LccActionGuard.newRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(guard);
  });

  it('the server accepts and records X-LCC-Client', () => {
    const server = readFileSync(join(ROOT, 'server.js'), 'utf8');
    const auth = readFileSync(join(ROOT, 'api/_shared/auth.js'), 'utf8');
    const handler = readFileSync(join(ROOT, 'api/_handlers/entities-handler.js'), 'utf8');
    const pipeline = readFileSync(join(ROOT, 'api/_handlers/sidebar-pipeline.js'), 'utf8');
    assert.match(server, /'X-LCC-Client'/);
    assert.match(auth, /X-LCC-Request-Id, X-LCC-Client/);
    assert.equal((handler.match(/client: sidebarClient\(req\)/g) || []).length, 4);
    assert.match(pipeline, /client: opts\.client \|\| null/);
  });
});
