// W1.2 — Close the template loop (audit finding 3.4.4).
//
// recordTemplateResponse attributes a two-way reply to the template send that
// prompted it: it flips the LATEST not-yet-replied template_sends row in the
// 45-day window to replied=true (+replied_at) and emits a `template_response`
// signal in the shape high_performing_templates reads. The change from a
// hardcoded replied=false to null="not yet observed" (recordTemplateSend) plus
// this reply loop makes the weekly template-health report render a non-zero
// reply rate once one reply row exists.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordTemplateResponse, recordTemplateSend } from '../api/_shared/templates.js';
import { evaluateTemplateHealth } from '../api/_shared/template-refinement.js';

const originalFetch = global.fetch;

function jsonResponse(body) {
  return {
    ok: true, status: 200,
    headers: { get(n) { return n.toLowerCase() === 'content-range' ? '0-0/1' : null; } },
    async text() { return JSON.stringify(body); }
  };
}

describe('recordTemplateSend — open outcomes are NULL, not false (W1.2)', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  it('writes opened/replied/deal_advanced as null (not yet observed)', async () => {
    let posted = null;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('template_sends') && opts?.method === 'POST') {
        posted = JSON.parse(opts.body);
        return jsonResponse([{ id: 'send-1', ...posted }]);
      }
      if (u.includes('signals')) return jsonResponse([{ id: 'sig-1' }]);
      throw new Error('unexpected fetch ' + u);
    };

    const out = await recordTemplateSend({ template_id: 'T-001', entity_id: 'c1', contact_id: 'c1' });
    assert.equal(out.ok, true);
    assert.strictEqual(posted.opened, null, 'opened starts unobserved (null), never false');
    assert.strictEqual(posted.replied, null, 'replied starts unobserved (null), never false');
    assert.strictEqual(posted.deal_advanced, null, 'deal_advanced starts unobserved (null), never false');
  });
});

describe('recordTemplateResponse (W1.2)', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  it('flips the latest unreplied send and emits a template_response signal', async () => {
    let patchBody = null; let patchTarget = null; let signalBody = null;
    global.fetch = async (url, opts) => {
      const u = String(url); const method = opts?.method || 'GET';
      if (u.includes('template_sends') && method === 'GET') {
        // The GET must scope to the contact, recency, and unreplied rows.
        assert.ok(u.includes('contact_id.eq.c-1') || u.includes('entity_id.eq.c-1'));
        assert.ok(u.includes('replied=not.is.true'), 'only not-yet-replied sends');
        assert.ok(u.includes('sent_at=gte.'), 'recency floor applied');
        return jsonResponse([{ id: 'send-9', template_id: 'T-007', template_version: 2, domain: 'government' }]);
      }
      if (u.includes('template_sends') && method === 'PATCH') {
        patchTarget = u; patchBody = JSON.parse(opts.body);
        return jsonResponse([{ id: 'send-9' }]);
      }
      if (u.includes('signals') && method === 'POST') {
        signalBody = JSON.parse(opts.body);
        return jsonResponse([{ id: 'sig-1' }]);
      }
      throw new Error('unexpected fetch ' + method + ' ' + u);
    };

    const out = await recordTemplateResponse({ contact_id: 'c-1', entity_id: 'owner-1', replied_at: '2026-07-20T00:00:00Z' });
    assert.equal(out.ok, true);
    assert.equal(out.send_id, 'send-9');
    assert.equal(out.template_id, 'T-007');

    // PATCH flips the right row to replied=true + the reply timestamp.
    assert.ok(patchTarget.includes('id=eq.send-9'));
    assert.strictEqual(patchBody.replied, true);
    assert.equal(patchBody.replied_at, '2026-07-20T00:00:00Z');

    // Signal payload matches high_performing_templates' shape (template_id key,
    // no template_name so it groups with the template_sent signal bucket).
    assert.equal(signalBody.signal_type, 'template_response');
    assert.equal(signalBody.payload.template_id, 'T-007');
    assert.equal(signalBody.payload.template_version, 2);
    assert.equal(signalBody.payload.send_id, 'send-9');
    assert.ok(!('template_name' in signalBody.payload), 'no template_name → same group as template_sent');
  });

  it('is a clean no-op when there is no recent unreplied send', async () => {
    let patched = false; let signalled = false;
    global.fetch = async (url, opts) => {
      const u = String(url); const method = opts?.method || 'GET';
      if (u.includes('template_sends') && method === 'GET') return jsonResponse([]);
      if (u.includes('template_sends') && method === 'PATCH') { patched = true; return jsonResponse([]); }
      if (u.includes('signals')) { signalled = true; return jsonResponse([]); }
      throw new Error('unexpected fetch ' + method + ' ' + u);
    };
    const out = await recordTemplateResponse({ contact_id: 'c-2' });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no_recent_send');
    assert.equal(patched, false, 'no send flipped');
    assert.equal(signalled, false, 'no signal emitted');
  });

  it('returns no_contact when neither contact_id nor entity_id is provided', async () => {
    const out = await recordTemplateResponse({});
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no_contact');
  });
});

describe('evaluateTemplateHealth renders a non-zero reply rate once a reply lands (W1.2)', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  function installHealthMock(sends) {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('template_sends')) return jsonResponse(sends);
      if (u.includes('template_definitions')) {
        return jsonResponse([{ template_id: 'T-007', template_version: 2, name: 'Intro', category: 'intro', domain: 'government', performance_targets: null, tone_notes: null }]);
      }
      throw new Error('unexpected fetch ' + u);
    };
  }

  it('reports reply_rate_pct = 0 while every send is still unobserved (null)', async () => {
    installHealthMock([
      { template_id: 'T-007', template_version: 2, opened: null, replied: null, deal_advanced: null, sent_at: '2026-07-10T00:00:00Z' },
      { template_id: 'T-007', template_version: 2, opened: null, replied: null, deal_advanced: null, sent_at: '2026-07-11T00:00:00Z' },
    ]);
    const rep = await evaluateTemplateHealth();
    const t = rep.evaluations.find(e => e.template_id === 'T-007');
    assert.equal(t.metrics.reply_rate_pct, 0, 'null replied is not counted as a positive');
  });

  it('renders a non-zero reply rate after one send is flipped replied=true', async () => {
    installHealthMock([
      { template_id: 'T-007', template_version: 2, opened: null, replied: true, deal_advanced: null, sent_at: '2026-07-20T00:00:00Z' },
      { template_id: 'T-007', template_version: 2, opened: null, replied: null, deal_advanced: null, sent_at: '2026-07-11T00:00:00Z' },
    ]);
    const rep = await evaluateTemplateHealth();
    const t = rep.evaluations.find(e => e.template_id === 'T-007');
    assert.equal(t.metrics.total_sends, 2);
    assert.ok(t.metrics.reply_rate_pct > 0, 'one replied=true row lifts the reply rate off zero');
    assert.equal(t.metrics.reply_rate_pct, 50, '1 of 2 sends replied → 50%');
  });
});
