// test/briefing-analyst-take-tick-e2e.test.mjs
// ============================================================================
// P138 / R8 Stage 1 — BEHAVIOURAL guard for /api/briefing-analyst-take-tick.
//
// The sibling test (briefing-analyst-take.test.mjs) covers the planner's logic and
// the wiring. This one runs the REAL handler end to end with globalThis.fetch
// stubbed, because everything that actually matters on this surface is about what
// the handler DOES over the wire, and no source grep can see any of it:
//
//   * the private payload reaches OLLAMA_URL and never api.anthropic.com
//   * a dry run makes no model call and no write
//   * a take carrying a figure the signals do not contain is REJECTED and nothing
//     is written — the "$42.5M pipeline" case, i.e. the exact fabrication this
//     section would otherwise ship into Scott's inbox as fact
//   * a down model / flag-off / failed write all return 200, write nothing, and
//     open a health alert (an empty take must never look like a quiet news day)
//   * the write is a PATCH scoped to the global row, so it can neither touch
//     market_data / sector_news / capital_markets nor mint a duplicate row
//
// Node's test runner gives each FILE its own process, so the env vars and the
// fetch stub set up here cannot leak into another suite.
// ============================================================================

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test';
process.env.OPS_SUPABASE_KEY = 'ops-key';
process.env.DIA_SUPABASE_URL = 'https://dia.test';
process.env.DIA_SUPABASE_SERVICE_KEY = 'dia-key';
process.env.GOV_SUPABASE_URL = 'https://gov.test';
process.env.GOV_SUPABASE_SERVICE_KEY = 'gov-key';
process.env.LCC_API_KEY = 'test-key';
process.env.LCC_DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
process.env.LCC_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000002';
process.env.OLLAMA_URL = 'https://ollama.test';
process.env.OLLAMA_MODEL = 'qwen2.5:14b';
process.env.CONTACTS_HUB = 'ops';
process.env.BRIEFING_ANALYST_TAKE_ONPREM = 'on';

const CT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  .toISOString().slice(0, 10);

const GROUNDED_TAKE =
  "## Analyst's Take\n\n"
  + '7 items are overdue and 3 are due today. Woodland Hills closing docs is the one that has to move.\n\n'
  + 'Fresenius Banning took 4 new correspondence items overnight and the summary refreshed. '
  + 'Andrew Pulliam at Easterly is 31 days cold - worth a call.';
const FABRICATED_TAKE = 'Your pipeline is worth $42.5M and cap rates moved to 7.85% overnight.';

let calls = [];
let MODEL_TEXT = GROUNDED_TAKE;
let LAST_PROMPT = '';
let SNAPSHOT_TAKE = null;   // what the stubbed GET reports as already stored
let MODEL_DOWN = false;

const J = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

function installFetchStub() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const m = opts.method || 'GET';
    calls.push(`${m} ${u.replace(/https:\/\/[a-z.]+/, '')}`.slice(0, 160));

    if (u.startsWith('https://ollama.test')) {
      if (MODEL_DOWN) return new Response('unavailable', { status: 503 });
      LAST_PROMPT = JSON.parse(opts.body).messages[0].content;
      calls.push('OLLAMA_CALL');
      return J({ choices: [{ message: { content: MODEL_TEXT } }] });
    }
    // Any cloud-model host reaching this stub is itself the failure.
    if (/anthropic|openai/.test(u)) { calls.push('CLOUD_MODEL_CALL'); return J({}); }

    if (u.includes('/feature_flags_registry')) return J([{ flag: 'BRIEFING_ANALYST_TAKE_ONPREM', state: 'off' }]);
    if (u.includes('/lcc_health_alerts')) return J(m === 'GET' ? [] : [{ alert_id: 9 }]);
    if (u.includes('/briefing_intel_snapshot')) {
      if (m === 'PATCH') return J([{ id: 'row-1' }]);
      if (m === 'POST') return J([{ id: 'new' }]);
      return J([{
        as_of_date: CT, variant: 'daily',
        analyst_take: SNAPSHOT_TAKE, capital_markets: null,
        warnings: ['Anthropic API 400: {"type":"error","error":{"message":"Your credit balance is too low"}}'],
        market_data: { yields: [{ label: '10Y Treasury', value: '4.21%', delta: '+3 bps' }], reits: [] },
      }]);
    }
    if (u.includes('mv_user_work_counts')) return J([{ my_actions: 12, my_overdue: 2 }], 200, { 'content-range': '0-0/1' });
    if (u.includes('mv_work_counts') || u.includes('v_work_counts')) {
      return J([{ open_actions: 41, overdue_actions: 7, inbox_new: 5, research_active: 316, open_escalations: 1, sync_errors: 0 }],
        200, { 'content-range': '0-0/1' });
    }
    if (u.includes('/action_items')) return J([], 200, { 'content-range': '*/3' });
    if (u.includes('/v_my_work')) {
      return J([{ id: 'w1', title: 'Woodland Hills closing docs', due_date: CT, priority: 'high', type: 'action' }]);
    }
    if (u.includes('/inbox_items')) return J([], 200, { 'content-range': '*/0' });
    if (u.includes('/activity_events')) return J([]);
    if (u.includes('/unified_contacts')) {
      return J([{
        unified_id: 'c1', full_name: 'Andrew Pulliam', company_name: 'Easterly Government Properties',
        engagement_score: 88, email: 'a@easterly.test',
        last_email_date: new Date(Date.now() - 31 * 86400000).toISOString(),
      }]);
    }
    if (u.includes('salesforce_activities')) return J([]);
    if (u.includes('lcc_deal_comm_propagated')) {
      const now = new Date().toISOString();
      return J([
        { entity_id: 'd1', propagated_at: now, actions: { milestones: [{ key: 'loi_received', outcome: 'inserted' }] } },
        { entity_id: 'd1', propagated_at: now, actions: {} },
        { entity_id: 'd1', propagated_at: now, actions: {} },
        { entity_id: 'd1', propagated_at: now, actions: {} },
      ]);
    }
    if (u.includes('/entities?')) return J([{ id: 'd1', name: 'Fresenius Banning' }]);
    if (u.includes('lcc_deal_correspondence_summary')) return J([{ entity_id: 'd1' }]);
    if (u.includes('/lcc_dossiers')) return J([]);
    if (u.includes('v_lcc_health_surface')) return J([{ subsystem: 's', check_name: 'c', status: 'amber', count: 2 }]);
    return J([]);
  };
}

let handleBriefingAnalystTakeTick;

async function run(method, query = {}) {
  calls = [];
  const req = { method, query, body: {}, headers: { 'x-lcc-key': 'test-key' } };
  const res = {
    _status: 0, _body: null,
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
  };
  await handleBriefingAnalystTakeTick(req, res);
  return { res, calls: calls.slice() };
}

const wroteSnapshot = (c) => c.some((x) => /^(PATCH|POST) \/rest\/v1\/briefing_intel_snapshot/.test(x));
const calledModel = (c) => c.includes('OLLAMA_CALL');

// Every phase runs once here; the it() blocks assert on the captured results.
const P = {};

before(async () => {
  installFetchStub();
  ({ handleBriefingAnalystTakeTick } = await import('../api/_handlers/briefing-analyst-take-tick.js'));

  MODEL_TEXT = GROUNDED_TAKE; SNAPSHOT_TAKE = null; MODEL_DOWN = false;
  P.dry = await run('GET');
  P.apply = await run('POST');
  P.applyPrompt = LAST_PROMPT;

  MODEL_TEXT = FABRICATED_TAKE;
  P.fabricated = await run('POST', { force: '1' });

  MODEL_TEXT = GROUNDED_TAKE; MODEL_DOWN = true;
  P.modelDown = await run('POST', { force: '1' });
  MODEL_DOWN = false;

  SNAPSHOT_TAKE = 'a take is already stored for today';
  P.idempotent = await run('POST');
  SNAPSHOT_TAKE = null;

  delete process.env.BRIEFING_ANALYST_TAKE_ONPREM;
  P.flagOff = await run('POST', { force: '1' });
  process.env.BRIEFING_ANALYST_TAKE_ONPREM = 'on';
});

describe('P138 tick — dry run', () => {
  it('returns 200 and neither calls the model nor writes', () => {
    assert.equal(P.dry.res._status, 200);
    assert.equal(calledModel(P.dry.calls), false);
    assert.equal(wroteSnapshot(P.dry.calls), false);
  });

  it('renders a labelled signal block the operator can grade before enabling anything', () => {
    const b = P.dry.res._body;
    assert.ok(b.signal_block_chars > 400, `signal block too thin: ${b.signal_block_chars}`);
    assert.match(b.signal_block, /mv_work_counts/);
    assert.equal(b.density.level, 'normal');
    assert.equal(b.voice_profile.basis, 'sections');
  });

  it('surfaces the edge function’s own billing warning rather than inheriting it silently', () => {
    assert.match(JSON.stringify(P.dry.res._body.snapshot.edge_warnings), /credit balance/);
  });
});

describe('P138 tick — apply', () => {
  it('writes a non-empty take', () => {
    const b = P.apply.res._body;
    assert.equal(b.written, true, JSON.stringify(b.generation || b.skipped));
    assert.ok(b.analyst_take_chars > 80, `take too short: ${b.analyst_take_chars}`);
  });

  it('strips the local model’s markdown scaffolding before storing', () => {
    assert.ok(!/^#/.test(P.apply.res._body.analyst_take));
  });

  it('writes with a PATCH scoped to the global row, and does not upsert when the row exists', () => {
    const patch = P.apply.calls.find((c) => c.startsWith('PATCH /rest/v1/briefing_intel_snapshot'));
    assert.ok(patch, 'no PATCH issued');
    assert.match(patch, /workspace_id=is\.null/);
    assert.ok(!P.apply.calls.some((c) => c.startsWith('POST /rest/v1/briefing_intel_snapshot')));
  });

  it('sends the private payload to the local model and to no cloud model', () => {
    assert.ok(calledModel(P.apply.calls));
    assert.ok(!P.apply.calls.includes('CLOUD_MODEL_CALL'));
    assert.ok(P.apply.calls.some((c) => c.includes('/v1/chat/completions')));
    assert.match(P.applyPrompt, /mv_work_counts/);
    assert.match(P.applyPrompt, /Andrew Pulliam/);
  });

  it('auto-retires the empty-take health alert once a take lands', () => {
    assert.equal(P.apply.res._body.health_alert, 'resolved');
  });
});

describe('P138 tick — a fabricated figure never ships', () => {
  it('rejects the take and writes nothing', () => {
    const b = P.fabricated.res._body;
    assert.equal(b.written, false);
    assert.equal(b.generation.reason, 'fabrication_rejected');
    assert.equal(wroteSnapshot(P.fabricated.calls), false);
  });

  it('names the fabricated tokens and retries once before giving up', () => {
    const g = P.fabricated.res._body.generation;
    assert.ok(g.ungrounded_numbers.length > 0, JSON.stringify(g));
    assert.equal(g.attempts.length, 2);
    assert.equal(P.fabricated.res._body.health_alert, 'opened');
  });
});

describe('P138 tick — fail-soft in every direction', () => {
  it('a down model returns 200, names the reason, and writes nothing', () => {
    const b = P.modelDown.res._body;
    assert.equal(P.modelDown.res._status, 200);
    assert.equal(b.written, false);
    assert.equal(b.generation.reason, 'model_unavailable');
    assert.equal(wroteSnapshot(P.modelDown.calls), false);
  });

  it('an existing take is never overwritten without force, and costs no model call', () => {
    assert.equal(P.idempotent.res._body.skipped, 'already_written');
    assert.equal(calledModel(P.idempotent.calls), false);
  });

  it('flag off skips before the model call, writes nothing, and raises no alert', () => {
    assert.equal(P.flagOff.res._body.skipped, 'flag_off');
    assert.equal(calledModel(P.flagOff.calls), false);
    assert.equal(wroteSnapshot(P.flagOff.calls), false);
    // An off flag is a CHOSEN state, already surfaced by feature_flags_registry and
    // the brief's Dormant Capabilities section. Opening an alert for it would leave a
    // permanently-open row describing a decision.
    assert.ok(!P.flagOff.calls.some((c) => c.startsWith('POST /rest/v1/lcc_health_alerts')), P.flagOff.calls.join(' | '));
  });
});
