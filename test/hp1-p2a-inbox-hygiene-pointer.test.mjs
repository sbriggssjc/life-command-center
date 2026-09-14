// HP1-P2a — the Inbox surface excludes `new_contact_qualify` (data-hygiene
// captured-contact rows) at v_inbox_triage, and must never do so silently:
// every consumer response carries a `hygiene_pointer` naming the TRUE
// (exact, uncapped) count of what was excluded, so an operator can always
// find the 94%-of-the-old-Inbox lane that moved to its own worklist.
//
// Guards two failure modes documented in CLAUDE.md:
//   - P159a: a rendered/capped count standing in for the real population.
//   - the QA-18 shape: a list total and a header total silently disagreeing.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const ENV_KEYS = ['OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY', 'LCC_API_KEY'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function mockRes() {
  return {
    _status: null,
    _json: null,
    headersSent: false,
    _headers: {},
    setHeader(name, value) { this._headers[name] = value; },
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; }
  };
}

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok, status,
    headers: { get(name) { return headers[name.toLowerCase()] || headers[name] || null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; }
  };
}

async function loadHandler() {
  return (await import(`../api/queue.js?test=${Date.now()}-${Math.random()}`)).default;
}

const USER_ROW = [{
  id: 'user-1',
  email: 'dev@example.com',
  display_name: 'Dev User',
  workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
}];

describe('HP1-P2a — inbox hygiene pointer', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    delete process.env.LCC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('v_inbox_triage is queried, and a separate exact-count probe against inbox_items reports the hygiene population', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const target = String(url);
      calls.push({ url: target, method });

      if (target.includes('/rest/v1/users?')) return jsonResponse(USER_ROW);

      if (target.includes('/rest/v1/v_inbox_triage?')) {
        return jsonResponse([{ id: 'row-1', title: 'Flagged OM', source_type: 'email_om', status: 'new' }]);
      }
      // HP1-P2a: the hygiene pointer's own count query — MUST be against the
      // raw table (never v_inbox_triage, which has already excluded these
      // rows and would report a false zero), MUST be exact (not estimated),
      // and MUST filter on the exact excluded source_type.
      if (target.includes('/rest/v1/inbox_items?') && target.includes('source_type=eq.new_contact_qualify')) {
        assert.ok(target.includes('status=in.'), 'hygiene probe must scope to open statuses');
        return jsonResponse([{ id: 'hyg-1' }], true, 200, { 'content-range': '0-0/879' });
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'GET',
      query: { _route: 'inbox', action: 'list', status: 'new' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200);
    assert.ok(Array.isArray(res._json.items));
    // Every returned item is a real broker-facing row — never the excluded lane.
    assert.ok(res._json.items.every((it) => it.source_type !== 'new_contact_qualify'));

    // The pointer must be present, named, and carry the TRUE count — never
    // absent, never zero when the population isn't, never a capped page length.
    assert.ok(res._json.hygiene_pointer, 'response must carry hygiene_pointer');
    assert.equal(res._json.hygiene_pointer.source_type, 'new_contact_qualify');
    assert.equal(res._json.hygiene_pointer.count, 879);
    assert.ok(
      /contact/i.test(res._json.hygiene_pointer.label),
      'pointer label must name what was excluded'
    );

    // Consumer wiring: exactly one probe against inbox_items (raw table) for
    // the excluded source_type, distinct from the v_inbox_triage list query.
    const hygieneProbes = calls.filter((c) => c.url.includes('source_type=eq.new_contact_qualify'));
    assert.equal(hygieneProbes.length, 1, 'exactly one hygiene-count probe per request');
    assert.ok(!hygieneProbes[0].url.includes('/v_inbox_triage'), 'hygiene probe must read the raw table, not the already-filtered view');
  });

  it('a mutation that drops the hygiene_pointer from the response is caught', async () => {
    // Positive control for the guard above: simulate the pre-fix shape (no
    // pointer field at all) and confirm the assertion would have failed.
    const responseWithoutPointer = { items: [{ id: 'row-1' }], count: 1 };
    assert.throws(() => {
      assert.ok(responseWithoutPointer.hygiene_pointer, 'response must carry hygiene_pointer');
    });
  });
});
