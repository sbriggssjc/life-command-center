import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const ENV_KEYS = [
  'OPS_SUPABASE_URL',
  'OPS_SUPABASE_KEY',
  'LCC_API_KEY',
  'MORNING_BRIEFING_STRUCTURED_URL',
  'MORNING_BRIEFING_HTML_URL',
  'GOV_SUPABASE_URL',
  'GOV_SUPABASE_KEY',
  'DIA_SUPABASE_URL',
  'DIA_SUPABASE_KEY'
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function mockRes() {
  return {
    _status: null,
    _json: null,
    headersSent: false,
    _headers: {},
    setHeader(name, value) {
      this._headers[name] = value;
    },
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._json = data;
      this.headersSent = true;
      return this;
    },
    end() {
      this.headersSent = true;
      return this;
    }
  };
}

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || headers[name] || null;
      }
    },
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    }
  };
}

function textResponse(body, ok = true, status = 200, contentType = 'text/html') {
  return {
    ok,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return contentType;
        return null;
      }
    },
    async text() {
      return body;
    },
    async json() {
      return JSON.parse(body);
    }
  };
}

async function loadHandler() {
  return (await import(`../api/daily-briefing.js?test=${Date.now()}-${Math.random()}`)).default;
}

describe('daily briefing snapshot endpoint', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    process.env.MORNING_BRIEFING_STRUCTURED_URL = 'https://morning.example.com/structured.json';
    process.env.MORNING_BRIEFING_HTML_URL = 'https://morning.example.com/briefing.html';
    delete process.env.LCC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('returns unified snapshot with full completeness when morning structured payload is available', async () => {
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';

      if (target === 'https://morning.example.com/structured.json') {
        return jsonResponse({
          source_system: 'morning_briefing',
          summary: 'Rates stable, cap rates still disciplined.',
          highlights: ['10Y Treasury unchanged', 'Net lease buyer demand steady'],
          sector_signals: ['Dialysis rent coverage focus'],
          watchlist: ['Fed minutes'],
          source_links: ['https://example.com/news']
        });
      }
      if (target === 'https://morning.example.com/briefing.html') {
        return textResponse('<div>Morning market HTML</div>');
      }

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/mv_work_counts?workspace_id=eq.ws-1')) {
        return jsonResponse([{
          open_actions: 14,
          inbox_new: 6,
          inbox_triaged: 5,
          research_active: 3,
          sync_errors: 2,
          overdue_actions: 4,
          due_this_week: 8,
          completed_week: 11,
          open_escalations: 1,
          refreshed_at: '2026-04-03T12:00:00.000Z'
        }]);
      }
      if (target.includes('/rest/v1/mv_user_work_counts?workspace_id=eq.ws-1&user_id=eq.user-1')) {
        return jsonResponse([{
          my_actions: 7,
          my_overdue: 2,
          my_inbox: 3,
          my_research: 1,
          my_completed_week: 5
        }]);
      }
      if (target.includes('/rest/v1/v_my_work?workspace_id=eq.ws-1')) {
        return jsonResponse([
          { id: 'a1', title: 'Call owner re: pricing', status: 'open', priority: 'high', due_date: '2026-04-03', domain: 'government' },
          { id: 'a2', title: 'Prepare follow-up email', status: 'in_progress', priority: 'normal', due_date: '2026-04-06', domain: 'dialysis' }
        ]);
      }
      if (target.includes('/rest/v1/v_inbox_triage?workspace_id=eq.ws-1')) {
        return jsonResponse([
          { id: 'i1', title: 'Flagged email from owner', status: 'new', source_type: 'flagged_email' },
          { id: 'i2', title: 'Attachment review', status: 'triaged', source_type: 'flagged_email' }
        ]);
      }
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&status=eq.new')) {
        return jsonResponse([{ id: 'x1' }], true, 200, { 'content-range': '0-0/6' });
      }
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&status=eq.triaged')) {
        return jsonResponse([{ id: 'x2' }], true, 200, { 'content-range': '0-0/5' });
      }
      if (target.includes('/rest/v1/v_unassigned_work?workspace_id=eq.ws-1')) {
        return jsonResponse([{ id: 'u1', title: 'Unassigned task' }]);
      }
      if (target.includes('/rest/v1/connector_accounts?workspace_id=eq.ws-1')) {
        return jsonResponse([
          { id: 'c1', user_id: 'user-1', connector_type: 'outlook', status: 'healthy', last_sync_at: null, last_error: null, external_user_id: 'ou-1' }
        ]);
      }
      if (target.includes('/rest/v1/sync_jobs?workspace_id=eq.ws-1')) {
        return jsonResponse([
          { id: 'j1', status: 'completed', direction: 'outbound', entity_type: 'complete_sf_task', records_processed: 1, completed_at: '2026-04-03T11:00:00.000Z' },
          { id: 'j2', status: 'completed', direction: 'inbound', entity_type: 'sf_activity', records_processed: 4, completed_at: '2026-04-03T10:00:00.000Z' }
        ]);
      }
      if (target.includes('/rest/v1/sync_errors?workspace_id=eq.ws-1')) {
        return jsonResponse([{ id: 'se1', error_message: 'token expired', is_retryable: true, retry_count: 0 }]);
      }
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&source_type=eq.sf_task')) {
        return jsonResponse([{ id: 'sft1' }], true, 200, { 'content-range': '0-0/9' });
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'GET',
      query: { action: 'snapshot', role_view: 'broker' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.role_view, 'broker');
    assert.equal(res._json.status.completeness, 'full');
    assert.deepEqual(res._json.status.missing_sections, []);
    assert.equal(res._json.global_market_intelligence.summary, 'Rates stable, cap rates still disciplined.');
    assert.equal(res._json.team_level_production_signals.work_counts.open_actions, 14);
    assert.equal(res._json.team_level_production_signals.sync_health.queue_drift.salesforce_open_task_count, 9);
    assert.ok(res._json.domain_specific_alerts_highlights);
    assert.ok(res._json.domain_specific_alerts_highlights.government);
    assert.ok(Array.isArray(res._json.actions));
    assert.ok(res._json.actions.length >= 3);
  });

  it('returns degraded status with html fallback when morning structured payload is unavailable', async () => {
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';

      if (target === 'https://morning.example.com/structured.json') {
        return jsonResponse({ error: 'unavailable' }, false, 503);
      }
      if (target === 'https://morning.example.com/briefing.html') {
        return textResponse('<div>Fallback morning html only</div>');
      }

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-2',
          email: 'ops@example.com',
          display_name: 'Ops User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/mv_work_counts?workspace_id=eq.ws-1')) return jsonResponse([{}]);
      if (target.includes('/rest/v1/mv_user_work_counts?workspace_id=eq.ws-1&user_id=eq.user-2')) return jsonResponse([{}]);
      if (target.includes('/rest/v1/v_my_work?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/v_inbox_triage?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&status=eq.new')) return jsonResponse([], true, 200, { 'content-range': '*/0' });
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&status=eq.triaged')) return jsonResponse([], true, 200, { 'content-range': '*/0' });
      if (target.includes('/rest/v1/v_unassigned_work?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/connector_accounts?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/sync_jobs?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/sync_errors?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&source_type=eq.sf_task')) return jsonResponse([], true, 200, { 'content-range': '*/0' });

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'GET',
      query: { action: 'snapshot', role_view: 'analyst_ops' },
      headers: { 'x-lcc-user-id': 'user-2', 'x-lcc-workspace': 'ws-1' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.role_view, 'analyst_ops');
    assert.equal(res._json.status.completeness, 'degraded');
    assert.ok(res._json.status.missing_sections.includes('global_market_intelligence.structured_payload'));
    assert.equal(res._json.global_market_intelligence.html_fragment, '<div>Fallback morning html only</div>');
    assert.ok(res._json.domain_specific_alerts_highlights);
  });

  it('returns domain fallback market summary when both morning URLs fail', async () => {
    process.env.GOV_SUPABASE_URL = 'https://gov.example.com';
    process.env.GOV_SUPABASE_KEY = 'gov-key';
    process.env.DIA_SUPABASE_URL = 'https://dia.example.com';
    process.env.DIA_SUPABASE_KEY = 'dia-key';
    delete process.env.MORNING_BRIEFING_STRUCTURED_URL;
    delete process.env.MORNING_BRIEFING_HTML_URL;

    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';

      if (target.includes('gov.example.com/rest/v1/sales_transactions')) {
        return jsonResponse([], true, 200, { 'content-range': '0-0/42' });
      }
      if (target.includes('dia.example.com/rest/v1/sales_transactions')) {
        return jsonResponse([], true, 200, { 'content-range': '0-0/17' });
      }

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-3',
          email: 'test@example.com',
          display_name: 'Test User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/mv_work_counts?workspace_id=eq.ws-1')) return jsonResponse([{}]);
      if (target.includes('/rest/v1/mv_user_work_counts?workspace_id=eq.ws-1&user_id=eq.user-3')) return jsonResponse([{}]);
      if (target.includes('/rest/v1/v_my_work?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/v_inbox_triage?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&status=eq.new')) return jsonResponse([], true, 200, { 'content-range': '*/0' });
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&status=eq.triaged')) return jsonResponse([], true, 200, { 'content-range': '*/0' });
      if (target.includes('/rest/v1/v_unassigned_work?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/connector_accounts?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/sync_jobs?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/sync_errors?workspace_id=eq.ws-1')) return jsonResponse([]);
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&source_type=eq.sf_task')) return jsonResponse([], true, 200, { 'content-range': '*/0' });

      // Allow other domain queries to pass through silently
      if (target.includes('gov.example.com') || target.includes('dia.example.com')) return jsonResponse([]);

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'GET',
      query: { action: 'snapshot', role_view: 'broker' },
      headers: { 'x-lcc-user-id': 'user-3', 'x-lcc-workspace': 'ws-1' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.status.completeness, 'degraded');
    assert.ok(res._json.status.missing_sections.includes('global_market_intelligence.structured_payload'));
    assert.ok(res._json.status.missing_sections.includes('global_market_intelligence.html_fragment'));
    const gmi = res._json.global_market_intelligence;
    assert.equal(gmi.source_system, 'domain_fallback');
    assert.ok(gmi.summary.includes('17 dialysis'));
    assert.ok(gmi.summary.includes('42 government'));
    assert.equal(gmi.highlights.length, 2);
    assert.equal(gmi.highlights[0].category, 'dialysis');
    assert.equal(gmi.highlights[1].category, 'government');
  });
});
