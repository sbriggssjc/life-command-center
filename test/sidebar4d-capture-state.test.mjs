// SIDEBAR4-d (2026-09-23) — after Save, the side panel must render an honest
// "in LCC, up to date" state instead of the same Update + Re-run buttons a
// months-stale record shows. Scott, 2026-09-23: "it looks like its all fresh
// data or hasn't been saved. So I usually click both of those buttons after
// the reload." Every Update runs the pipeline server-side, so each of those
// clicks was a redundant pipeline run.
//
// These tests run the REAL sidepanel.js functions (extracted by AST, not by a
// character window) against the real shared/capture-state.js, in a vm. Every
// block carries its own positive control: an in-memory mutation that must turn
// the assertion red, so a green run is not a detector that cannot fire.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import * as acorn from 'acorn';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const STATE_SRC = readFileSync(join(EXT, 'shared/capture-state.js'), 'utf8');
const SIDEPANEL_SRC = readFileSync(join(EXT, 'sidepanel.js'), 'utf8');
const SIDEPANEL_HTML = readFileSync(join(EXT, 'sidepanel.html'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));

const SIDEPANEL_NAMES = [
  'escapeHtml', 'PROPERTY_FIELDS', 'ASSESSOR_FIELDS', 'extractSourceFields', 'buildMetadata',
  'liveCaptureHashes', 'computeMatchedCaptureView', 'stampCaptureFingerprint', 'matchedActionsHtml',
];

function topLevelSources(src, names) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const out = [];
  for (const n of ast.body) {
    const name = n.type === 'FunctionDeclaration' ? n.id.name
      : (n.type === 'VariableDeclaration' && n.declarations.length === 1 ? n.declarations[0].id.name : null);
    if (name && names.includes(name)) out.push(src.slice(n.start, n.end));
  }
  return out;
}

// Fake clock: `new Date()` inside buildMetadata reads it, so a Save and a later
// render really do produce different `extracted_at` values.
function load({ stateSrc = STATE_SRC, sidepanelSrc = SIDEPANEL_SRC } = {}) {
  const clock = { now: Date.parse('2026-09-23T14:00:00Z') };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const ctx = {
    Date: FakeDate,
    document: {
      createElement: () => ({
        set textContent(v) { this._t = String(v); },
        get innerHTML() { return this._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      }),
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(stateSrc, ctx);
  const pieces = topLevelSources(sidepanelSrc, SIDEPANEL_NAMES);
  vm.runInContext(pieces.join('\n') + '\nthis.__sp = { extractSourceFields, buildMetadata, liveCaptureHashes, computeMatchedCaptureView, stampCaptureFingerprint, matchedActionsHtml };', ctx);
  return { sp: ctx.__sp, S: ctx.LccCaptureState, clock };
}

const PAGE = {
  domain: 'costar',
  address: '20931 Burbank Blvd',
  city: 'Woodland Hills',
  state: 'CA',
  page_url: 'https://product.costar.com/detail/lookup/12345?x=1',
  asking_price: '$15,729,896',
  cap_rate: '6.00%',
  noi: '$943,794',
  year_built: '2008',
  tenant_name: 'Fresenius Medical Care',
  tenants: [{ name: 'Fresenius Medical Care', sf: 12000 }],
};

// Simulates the Save handler (what it SENDS) and the server storing it, then
// the pipeline run that follows. Returns the entity a re-render would look up.
function saveThenStore(env, page, { pipeline = 'success', rememberAs = 'saved' } = {}) {
  const { sp, S, clock } = env;
  const fields = sp.extractSourceFields(page);
  const metadata = sp.buildMetadata(page, page.domain);
  sp.stampCaptureFingerprint(metadata, fields, metadata);
  const id = 'ent-1';
  if (rememberAs) S.rememberAction(id, { kind: rememberAs, pipeline: { status: 'success', text: 'Pipeline ✓ Dialysis: property 24703' } }, clock.now);
  const stored = { ...metadata };
  if (pipeline === 'success') {
    stored._pipeline_status = 'success';
    stored._pipeline_processed_at = new Date(clock.now + 5000).toISOString();
    stored._pipeline_run_log = [{ finished_at: stored._pipeline_processed_at }];
  } else if (pipeline === 'failed') {
    stored._pipeline_status = 'failed';
    stored._pipeline_last_error = 'no_domain';
    stored._pipeline_run_log = [{ finished_at: new Date(clock.now + 5000).toISOString() }];
  }
  return { id, entity_type: 'asset', updated_at: new Date(clock.now).toISOString(), metadata: stored };
}

function reRender(env, page, entity, advanceMs = 1500) {
  env.clock.now += advanceMs;
  const view = env.sp.computeMatchedCaptureView(page, entity, 'CoStar');
  // capture-state.js runs in this vm, so its Date.now() is the fake clock too.
  return { view, html: env.sp.matchedActionsHtml(view) };
}

function updateButton(html) {
  const m = html.match(/<button[^>]*id="updateLccBtn"[^>]*>([^<]*)<\/button>/);
  assert.ok(m, 'the matched render must carry the Update button');
  return { tag: m[0], label: m[1], disabled: /\sdisabled[\s>]/.test(m[0]) };
}

describe('SIDEBAR4-d: Save → re-render shows "in LCC, up to date"', () => {
  it('an unchanged page renders Update disabled as "Up to date in LCC ✓", with the saved + pipeline lines', () => {
    const env = load();
    const entity = saveThenStore(env, PAGE);
    const { view, html } = reRender(env, PAGE, entity);
    const btn = updateButton(html);
    assert.equal(btn.label, 'Up to date in LCC ✓');
    assert.equal(btn.disabled, true, 'Update must be disabled when the page matches the stored capture');
    assert.deepEqual([...view.changedKeys], []);
    assert.match(html, /Saved to LCC just now ✓/);
    assert.match(html, /Pipeline ✓/);
    assert.match(html, /Nothing new on this page/);
    assert.equal(view.rerun.prominent, false, 'Re-run is secondary after a successful save');
  });

  it('the post-save state survives a pageContext re-render (same page, different extracted_at)', () => {
    const env = load();
    const entity = saveThenStore(env, PAGE);
    reRender(env, PAGE, entity, 1500);
    const second = reRender(env, PAGE, entity, 45_000); // a later storage-driven re-render
    assert.equal(updateButton(second.html).disabled, true);
    assert.match(second.html, /Saved to LCC/);
  });

  it('positive control: hashing the volatile extracted_at makes every re-render read "changed"', () => {
    const mutated = STATE_SRC.replace("if (k.startsWith('_') || VOLATILE_KEYS.has(k)) continue;", 'if (false) continue;');
    assert.notEqual(mutated, STATE_SRC);
    const env = load({ stateSrc: mutated });
    const entity = saveThenStore(env, PAGE);
    const { html } = reRender(env, PAGE, entity);
    assert.equal(updateButton(html).disabled, false, 'the mutation must reach the render');
  });

  it('positive control: an up-to-date view that is not disabled is caught', () => {
    const mutated = STATE_SRC.replace("label: 'Up to date in LCC ✓',\n        disabled: true,", "label: 'Up to date in LCC ✓',\n        disabled: false,");
    assert.notEqual(mutated, STATE_SRC);
    const env = load({ stateSrc: mutated });
    const { html } = reRender(env, PAGE, saveThenStore(env, PAGE));
    assert.equal(updateButton(html).disabled, false);
  });
});

describe('SIDEBAR4-d: a changed field enables Update with the count', () => {
  it('one changed page field → "Update LCC (1 field changed)", enabled, and named in the title', () => {
    const env = load();
    const entity = saveThenStore(env, PAGE);
    const changed = { ...PAGE, asking_price: '$14,900,000' };
    const { view, html } = reRender(env, changed, entity);
    const btn = updateButton(html);
    assert.equal(btn.label, 'Update LCC (1 field changed)');
    assert.equal(btn.disabled, false);
    assert.deepEqual([...view.changedKeys], ['asking_price'], 'the column and metadata copies of one field count once');
    assert.match(btn.tag, /title="Changed on this page: asking_price"/);
  });

  it('two changed fields → plural count; a value the page no longer shows is not counted', () => {
    const env = load();
    const entity = saveThenStore(env, PAGE);
    const changed = { ...PAGE, asking_price: '$14,900,000', year_built: '2009' };
    delete changed.tenant_name; // dropped from a partly-loaded page
    const { html } = reRender(env, changed, entity);
    assert.equal(updateButton(html).label, 'Update LCC (2 fields changed)');
  });

  it('a record saved before 1.0.57 (no fingerprint) keeps Update enabled and says why', () => {
    const env = load();
    const entity = saveThenStore(env, PAGE, { rememberAs: null });
    delete entity.metadata._capture_field_hashes;
    const { view, html } = reRender(env, PAGE, entity);
    const btn = updateButton(html);
    assert.equal(btn.label, 'Update LCC with CoStar Data');
    assert.equal(btn.disabled, false);
    assert.equal(view.fingerprinted, false);
    assert.match(btn.tag, /No capture fingerprint on file/);
  });

  it('positive control: a diff that never reports a change leaves Update disabled on a changed page', () => {
    const mutated = STATE_SRC.replace('if (!stored || stored[k] !== live[k]) changed.push(k);', '');
    assert.notEqual(mutated, STATE_SRC);
    const env = load({ stateSrc: mutated });
    const entity = saveThenStore(env, PAGE);
    const { html } = reRender(env, { ...PAGE, asking_price: '$14,900,000' }, entity);
    assert.equal(updateButton(html).disabled, true, 'the mutation must reach the render');
  });
});

describe('SIDEBAR4-d: Re-run is secondary unless the last run failed', () => {
  const cases = [
    { name: 'last run succeeded', pipeline: 'success', rememberAs: null, prominent: false, label: 'Re-run Pipeline' },
    { name: 'last run failed', pipeline: 'failed', rememberAs: null, prominent: true, label: 'Retry Pipeline (Failed)' },
    { name: 'never ran, nothing in flight', pipeline: 'none', rememberAs: null, prominent: true, label: 'Run Pipeline' },
    { name: 'just saved, pipeline still running', pipeline: 'none', rememberAs: 'saved-pending', prominent: false, label: 'Run Pipeline' },
  ];
  for (const c of cases) {
    it(`${c.name} → prominent=${c.prominent}`, () => {
      const env = load();
      const entity = saveThenStore(env, PAGE, { pipeline: c.pipeline, rememberAs: null });
      if (c.rememberAs === 'saved-pending') env.S.rememberAction(entity.id, { kind: 'saved' }, env.clock.now);
      const { view, html } = reRender(env, PAGE, entity);
      assert.equal(view.rerun.prominent, c.prominent);
      assert.equal(view.rerun.label, c.label);
      if (c.rememberAs === 'saved-pending') assert.match(html, /Pipeline running for the latest save/);
      if (c.pipeline === 'failed') assert.match(html, /Pipeline failed.*no_domain/);
    });
  }

  it('positive control: an always-prominent Re-run is caught', () => {
    const mutated = STATE_SRC.replace(
      "const rerunProminent = status === 'failed' || (!hasRunHistory && !recentPending);",
      'const rerunProminent = true;');
    assert.notEqual(mutated, STATE_SRC);
    const env = load({ stateSrc: mutated });
    const { view } = reRender(env, PAGE, saveThenStore(env, PAGE));
    assert.equal(view.rerun.prominent, true);
  });

  it('the side panel hides a non-prominent Re-run behind the ⋯ overflow', () => {
    // The render reads view.rerun.prominent — never a hard-coded status check.
    assert.match(SIDEPANEL_SRC, /if \(!view\.rerun\.prominent\) \{\s*rerunBtn\.style\.display = 'none';/);
    assert.match(SIDEPANEL_SRC, /moreBtn\.id = 'moreActionsBtn';/);
    assert.doesNotMatch(SIDEPANEL_SRC, /meta\._pipeline_status === 'success'\) \{\s*pipelineLabel/);
  });
});

describe('SIDEBAR4-d: the memo and the wiring', () => {
  it('the post-action memo expires after its TTL', () => {
    const env = load();
    env.S.rememberAction('e', { kind: 'saved' }, 1_000);
    assert.ok(env.S.recentAction('e', 1_000 + env.S.RECENT_TTL_MS - 1));
    assert.equal(env.S.recentAction('e', 1_000 + env.S.RECENT_TTL_MS + 1), null);
  });

  function handlerBody(btnVar) {
    const re = new RegExp(`${btnVar}\\.addEventListener\\('click', actionGroup\\.wrap\\(${btnVar}, async \\(\\) => \\{`);
    const m = SIDEPANEL_SRC.match(re);
    assert.ok(m, `${btnVar} handler must exist`);
    const start = m.index;
    const ast = acorn.parseExpressionAt(SIDEPANEL_SRC, start, { ecmaVersion: 'latest' });
    return SIDEPANEL_SRC.slice(ast.start, ast.end);
  }

  for (const btn of ['saveBtn', 'updateBtn']) {
    it(`${btn} stamps the capture fingerprint, remembers the action and re-renders`, () => {
      const body = handlerBody(btn);
      assert.match(body, /stampCaptureFingerprint\(metadata, fields, /);
      assert.match(body, /window\.LccCaptureState\.rememberAction\(/);
      assert.match(body, /setTimeout\(\(\) => loadPropertyTab\(\{ prefetchEntityId:/);
    });
  }

  it('the Update handler fingerprints the FRESH capture, not the merge with stored metadata', () => {
    assert.match(handlerBody('updateBtn'), /stampCaptureFingerprint\(metadata, fields, freshMeta\)/);
  });

  it('capture-state.js loads before sidepanel.js, and the manifest is bumped past 1.0.56', () => {
    const iState = SIDEPANEL_HTML.indexOf('src="shared/capture-state.js"');
    const iPanel = SIDEPANEL_HTML.indexOf('src="sidepanel.js"');
    assert.ok(iState > 0 && iState < iPanel);
    const [maj, min, patch] = MANIFEST.version.split('.').map(Number);
    assert.ok(maj > 1 || min > 0 || patch > 56, `manifest ${MANIFEST.version} must be > 1.0.56`);
  });
});
