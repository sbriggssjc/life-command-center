// R24 Unit 4 — performance-aware template selection (cold-start safe).
// chooseBestTemplate swaps only WITHIN the recommended template's category,
// only for candidates that cleared the min-sends floor, and falls back to the
// default whenever there isn't enough performance data.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chooseBestTemplate } from '../api/_shared/templates.js';

const originalFetch = global.fetch;

function jsonResponse(body) {
  return {
    ok: true, status: 200,
    headers: { get(n) { return n.toLowerCase() === 'content-range' ? '0-0/1' : null; } },
    async text() { return JSON.stringify(body); }
  };
}

// templateDef = the default's category; actives = [{template_id,category}];
// perf = high_performing_templates rows.
function installMock({ defCategory, actives, perf }) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('high_performing_templates')) return jsonResponse(perf);
    if (u.includes('template_definitions') && u.includes('template_id=eq.')) {
      // loadTemplate(defaultTemplateId)
      return jsonResponse([{ template_id: 'T-001', template_version: 1, category: defCategory }]);
    }
    if (u.includes('template_definitions')) {
      // listActiveTemplates
      return jsonResponse(actives);
    }
    throw new Error('unexpected fetch ' + u);
  };
}

describe('chooseBestTemplate (R24 Unit 4)', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  it('returns the default when there is no performance data (cold start)', async () => {
    installMock({ defCategory: 'intro', actives: [{ template_id: 'T-001', category: 'intro' }], perf: [] });
    assert.equal(await chooseBestTemplate('T-001'), 'T-001');
  });

  it('prefers a higher-response same-category template that cleared min sends', async () => {
    installMock({
      defCategory: 'intro',
      actives: [
        { template_id: 'T-001', category: 'intro' },
        { template_id: 'T-009', category: 'intro' },
      ],
      perf: [
        { template_id: 'T-009', sent_count: 5, response_rate_pct: 40 },
        { template_id: 'T-001', sent_count: 4, response_rate_pct: 10 },
      ],
    });
    assert.equal(await chooseBestTemplate('T-001'), 'T-009');
  });

  it('ignores a higher-response template in a DIFFERENT category', async () => {
    installMock({
      defCategory: 'intro',
      actives: [
        { template_id: 'T-001', category: 'intro' },
        { template_id: 'T-002', category: 'ask' },
      ],
      perf: [{ template_id: 'T-002', sent_count: 50, response_rate_pct: 90 }],
    });
    assert.equal(await chooseBestTemplate('T-001'), 'T-001', 'never crosses category');
  });

  it('ignores candidates below the min-sends floor', async () => {
    installMock({
      defCategory: 'intro',
      actives: [
        { template_id: 'T-001', category: 'intro' },
        { template_id: 'T-009', category: 'intro' },
      ],
      perf: [{ template_id: 'T-009', sent_count: 2, response_rate_pct: 99 }],
    });
    assert.equal(await chooseBestTemplate('T-001', { min_sends: 3 }), 'T-001');
  });
});
