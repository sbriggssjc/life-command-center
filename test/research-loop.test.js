import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeResearchLoop } from '../api/_shared/research-loop.js';

const originalFetch = global.fetch;

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
    }
  };
}

describe('research-loop helper', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('creates and completes a research task, then creates a follow-up action', async () => {
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        return jsonResponse([{ id: 'entity-1', name: '123 Main St' }]);
      }
      if (u.endsWith('/external_identities') && opts.method === 'POST') {
        return jsonResponse([{ id: 'ext-1', entity_id: 'entity-1' }]);
      }
      if (u.includes('/research_tasks?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/research_tasks') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'research-1', ...body }]);
      }
      if (u.includes('/research_tasks?id=eq.research-1') && opts.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'research-1', ...body }]);
      }
      if (u.endsWith('/action_items') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'action-1', ...body }]);
      }
      if (u.endsWith('/activity_events') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'activity-1', ...body }]);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await closeResearchLoop({
      workspaceId: 'ws-1',
      user: { id: 'user-1' },
      sourceSystem: 'gov_supabase',
      sourceType: 'asset',
      sourceRecordId: 'prop-123',
      externalId: 'prop-123',
      researchType: 'ownership',
      domain: 'government',
      entitySeedFields: {
        name: '123 Main St',
        address: '123 Main St',
        city: 'Tulsa',
        state: 'OK',
        asset_type: 'government_leased'
      },
      notes: 'Resolved owner',
      followupTitle: 'Call owner',
      followupType: 'follow_up'
    });

    assert.equal(result.ok, true);
    assert.equal(result.createdResearchTask, true);
    assert.equal(result.researchTask.id, 'research-1');
    assert.equal(result.followupAction.id, 'action-1');
  });
});
