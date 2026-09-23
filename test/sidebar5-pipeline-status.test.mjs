// SIDEBAR5 (2) — "Pipeline still processing for the latest save…" never cleared.
//
// CoStar #1014478, 2026-09-23: the run finished at 17:47:26.935 UTC, 55 s after
// Save, with _pipeline_status='success'. pollPipelineStatus gave up at 35.5 s and
// returned {status:'processing'}; that went into the 10-minute post-action memo,
// and computeMatchedView preferred the memo over the stored 'success' on every
// re-render. Separately, the poll treated ANY _pipeline_summary as success — on
// an Update that is the PREVIOUS run's summary.
//
// These run the REAL sidepanel.js pollPipelineStatus (lifted by AST) against the
// real shared/capture-state.js in a vm, with a scripted server. Each block carries
// a positive control: a mutation that must turn it red.

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

function topLevel(src, names) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const out = [];
  for (const n of ast.body) {
    const name = n.type === 'FunctionDeclaration' ? n.id.name
      : (n.type === 'VariableDeclaration' && n.declarations.length === 1 ? n.declarations[0].id.name : null);
    if (name && names.includes(name)) out.push(src.slice(n.start, n.end));
  }
  assert.equal(out.length, names.length, `expected ${names.join(', ')} in sidepanel.js`);
  return out.join('\n');
}

const T0 = Date.parse('2026-09-23T17:46:31.900Z'); // the Save click
const iso = (ms) => new Date(ms).toISOString();

// responses: array of metadata objects returned by successive GETs.
function load({ stateSrc = STATE_SRC, sidepanelSrc = SIDEPANEL_SRC, responses = [] } = {}) {
  const clock = { now: T0 };
  const polls = [];
  const ctx = {
    console,
    Date: class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(clock.now); }
      static now() { return clock.now; }
    },
    document: { createElement: () => ({ style: {}, className: '', textContent: '' }) },
    getLCCConfig: async () => ({ LCC_RAILWAY_URL: 'https://lcc.test', LCC_API_KEY: 'k' }),
    toErrorMessage: (x) => (x == null ? null : String(x)),
    formatPipelineSummary: (s) => `→ ${s.domain || 'domain'}`,
    fetch: async () => {
      const meta = responses[Math.min(polls.length, responses.length - 1)] || {};
      polls.push(clock.now);
      return { ok: true, json: async () => ({ entity: { metadata: meta } }) };
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(stateSrc, ctx);
  ctx.LccActionGuard = { lccRequestHeaders: () => ({}) };
  vm.runInContext(topLevel(sidepanelSrc, ['PIPELINE_POLL_WAITS_MS', 'pollPipelineStatus'])
    + '\nthis.__poll = pollPipelineStatus; this.__waits = PIPELINE_POLL_WAITS_MS;', ctx);
  const container = { prepend() {} };
  const sleep = async (ms) => { clock.now += ms; };
  return {
    S: ctx.LccCaptureState, clock, polls, waits: ctx.__waits,
    poll: (opts) => ctx.__poll('ent-1', container, { sleep, ...opts }),
  };
}

const PREVIOUS_RUN = {
  _pipeline_status: 'success',
  _pipeline_processed_at: iso(T0 - 3 * 86400_000),
  _pipeline_summary: { domain: 'government' },
  _pipeline_run_log: [{ finished_at: iso(T0 - 3 * 86400_000) }],
};
const THIS_RUN = {
  _pipeline_status: 'success',
  _pipeline_processed_at: iso(T0 + 55_035),
  _pipeline_summary: { domain: 'government' },
  _pipeline_run_log: [...PREVIOUS_RUN._pipeline_run_log, { finished_at: iso(T0 + 55_035) }],
};

describe('SIDEBAR5 (2a): the poll waits long enough for a normal run', () => {
  it('the backoff reaches ~3 minutes (was 35.5 s)', () => {
    const { waits } = load();
    const total = [...waits].reduce((a, b) => a + b, 0);
    assert.ok(total >= 170_000 && total <= 200_000, `total ${total}`);
  });

  it('a Save whose run finishes at 55 s reports success, not "still processing"', async () => {
    const pending = { _capture_saved_at: iso(T0) }; // no status yet
    const env = load({ responses: [pending, pending, pending, pending, THIS_RUN] });
    const out = await env.poll({ actionAt: T0 });
    assert.equal(out.status, 'success');
    assert.ok(env.polls[4] - T0 > 55_035, 'the fifth poll lands after the 55 s run');
  });

  it('positive control: the old 35.5 s schedule gives up before the 55 s run lands', async () => {
    const mutated = SIDEPANEL_SRC.replace(
      'const PIPELINE_POLL_WAITS_MS = [3500, 6000, 10000, 16000, 20000, 25000, 30000, 35000, 35000];',
      'const PIPELINE_POLL_WAITS_MS = [3500, 6000, 10000, 16000];');
    assert.notEqual(mutated, SIDEPANEL_SRC);
    const pending = {};
    const env = load({ sidepanelSrc: mutated, responses: [pending, pending, pending, pending, THIS_RUN] });
    const out = await env.poll({ actionAt: T0 });
    assert.equal(out.status, 'processing');
  });
});

describe('SIDEBAR5 (2b): an Update never mistakes the previous run for this one', () => {
  it('the previous run\'s summary on the first polls does not end the poll; the new run does', async () => {
    const S = load().S;
    const prior = S.lastRunStamp(PREVIOUS_RUN);
    const env = load({ responses: [PREVIOUS_RUN, PREVIOUS_RUN, PREVIOUS_RUN, PREVIOUS_RUN, THIS_RUN] });
    const out = await env.poll({ actionAt: T0, priorStamp: prior });
    assert.equal(out.status, 'success');
    assert.equal(out.stamp, iso(T0 + 55_035));
    assert.equal(env.polls.length, 5, 'must keep polling past the stale summary');
  });

  it('pipelineOutcomeSince: prior stamp, action time, failure, and not-yet-finished', () => {
    const { S } = load();
    const prior = S.lastRunStamp(PREVIOUS_RUN);
    assert.equal(S.pipelineOutcomeSince(PREVIOUS_RUN, { sinceMs: T0, priorStamp: prior }), null);
    assert.equal(S.pipelineOutcomeSince(PREVIOUS_RUN, { sinceMs: T0 }), null, 'a days-old run is not after the action');
    assert.equal(S.pipelineOutcomeSince(THIS_RUN, { sinceMs: T0, priorStamp: prior }).status, 'success');
    const failed = { _pipeline_status: 'failed', _pipeline_processed_at: PREVIOUS_RUN._pipeline_processed_at,
      _pipeline_run_log: [...PREVIOUS_RUN._pipeline_run_log, { finished_at: iso(T0 + 60_000) }] };
    assert.equal(S.pipelineOutcomeSince(failed, { sinceMs: T0, priorStamp: prior }).status, 'failed');
    assert.equal(S.pipelineOutcomeSince({ _pipeline_summary: { domain: 'x' } }, { sinceMs: T0 }), null,
      'a summary without a terminal status is not an outcome');
    // A server clock a few seconds behind the client still counts (inside the skew allowance).
    const skewed = { _pipeline_status: 'success', _pipeline_run_log: [{ finished_at: iso(T0 - 5_000) }] };
    assert.equal(S.pipelineOutcomeSince(skewed, { sinceMs: T0 }).status, 'success');
  });

  it('positive control: keyed on the summary alone (the old check), the previous run ends the poll at once', async () => {
    const mutatedState = STATE_SRC.replace(
      "    if (o.priorStamp && stamp === o.priorStamp) return null;\n    const t = toMs(stamp);\n    if (o.sinceMs != null && (t == null || t < o.sinceMs - CLOCK_SKEW_MS)) return null;\n",
      '    const t = toMs(stamp);\n');
    assert.notEqual(mutatedState, STATE_SRC);
    const S = load().S;
    const env = load({ stateSrc: mutatedState, responses: [PREVIOUS_RUN, THIS_RUN] });
    const out = await env.poll({ actionAt: T0, priorStamp: S.lastRunStamp(PREVIOUS_RUN) });
    assert.equal(env.polls.length, 1);
    assert.equal(out.stamp, S.lastRunStamp(PREVIOUS_RUN), 'the stale run was taken as this one');
  });
});

describe('SIDEBAR5 (2c): a stored terminal run newer than the action overrides the memo', () => {
  const view = (S, meta, rec, nowMs) => S.computeMatchedView({
    liveHashes: {}, meta, updatedAt: iso(T0), sourceLabel: 'CoStar', recent: rec, nowMs,
  });
  const texts = (v) => v.statusLines.map((l) => l.text);

  it('memo "processing" (poll gave up) + stored success at 55 s → "Pipeline ✓", not "still processing"', () => {
    const { S } = load();
    S.rememberAction('ent-1', { kind: 'saved', actionAt: T0,
      pipeline: { status: 'processing', text: 'Pipeline still processing for the latest save…' } }, T0 + 35_500);
    const rec = S.recentAction('ent-1', T0 + 120_000);
    const v = view(S, THIS_RUN, rec, T0 + 120_000);
    assert.ok(texts(v).some((t) => /^Pipeline ✓/.test(t)), texts(v).join(' | '));
    assert.ok(!texts(v).some((t) => /still processing|still running/.test(t)));
    assert.ok(texts(v).some((t) => /^Saved to LCC/.test(t)), 'the saved line from the memo stays');
  });

  it('a stored failure newer than the action also overrides a "processing" memo', () => {
    const { S } = load();
    S.rememberAction('ent-1', { kind: 'updated', actionAt: T0, pipeline: { status: 'processing', text: 'x' } }, T0 + 180_000);
    const failed = { _pipeline_status: 'failed', _pipeline_last_error: 'no_domain',
      _pipeline_run_log: [{ finished_at: iso(T0 + 200_000) }] };
    const v = view(S, failed, S.recentAction('ent-1', T0 + 240_000), T0 + 240_000);
    assert.ok(texts(v).some((t) => /^Pipeline failed/.test(t)));
    assert.equal(v.rerun.label, 'Retry Pipeline (Failed)');
  });

  it('a stored run OLDER than the action does not override the memo (the run is still going)', () => {
    const { S } = load();
    S.rememberAction('ent-1', { kind: 'updated', actionAt: T0, pipeline: { status: 'processing', text: 'Pipeline still running — check back in a minute' } }, T0 + 180_000);
    const v = view(S, PREVIOUS_RUN, S.recentAction('ent-1', T0 + 190_000), T0 + 190_000);
    assert.ok(texts(v).some((t) => /still running/.test(t)));
  });

  it('positive control: without the override the stale memo wins (the reported defect)', () => {
    const mutatedState = STATE_SRC.replace('const rec = recIn && memoSupersededByStored(recIn, m)', 'const rec = recIn && false');
    assert.notEqual(mutatedState, STATE_SRC);
    const { S } = load({ stateSrc: mutatedState });
    S.rememberAction('ent-1', { kind: 'saved', actionAt: T0,
      pipeline: { status: 'processing', text: 'Pipeline still processing for the latest save…' } }, T0 + 35_500);
    const v = view(S, THIS_RUN, S.recentAction('ent-1', T0 + 120_000), T0 + 120_000);
    assert.ok(texts(v).some((t) => /still processing/.test(t)));
  });
});

describe('SIDEBAR5 (2d): every action passes its action time and prior run stamp', () => {
  it('Save, Update and Re-run all key the poll on the action', () => {
    const body = SIDEPANEL_SRC.replace(/\/\/[^\n]*/g, '');
    assert.match(body, /pollPipelineStatus\(newEntityId, actionStatus\(\), \{ actionAt: saveActionAt \}\)/);
    assert.match(body, /pollPipelineStatus\(lccEntity\.id, actionStatus\(\),\s*\{ actionAt: updateActionAt, priorStamp: updatePriorStamp \}\)/);
    assert.match(body, /pollPipelineStatus\(lccEntity\.id, actionStatus\(\),\s*\{ actionAt: rerunActionAt, priorStamp: rerunPriorStamp \}\)/);
    assert.equal((body.match(/pollPipelineStatus\(/g) || []).length, 4, 'one definition + three call sites');
    // The prior stamp is read BEFORE the update's metadata deletes run.
    const upd = body.indexOf('const updatePriorStamp');
    assert.ok(upd > -1 && upd < body.indexOf('delete metadata._pipeline_processed_at'));
  });
});
