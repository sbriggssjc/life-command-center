// R24 — close the self-improvement loops (wire the producers)
//
// Unit 1: a recorded email advance writes a template_sends row co-located with
//         the emails_sent bump (and record_send's skip flag avoids a double).
// Unit 2: an inbound reply bumps emails_replied, resets the unopened streak,
//         and moves the cadence into 'converted' (pause/escalate) — never a
//         send (no emails_sent, no template_sends).
// Unit 3: a send with NO open signal must NOT increment consecutive_unopened,
//         and the >=2 phone-recovery branch is gated on open-tracking-active.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { advanceCadence, recommendNextTouch } from '../api/_shared/cadence-engine.js';

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: { get(name) { return headers[name.toLowerCase()] || headers[name] || null; } },
    async text() { return JSON.stringify(body); }
  };
}

// Install a fetch mock that serves a cadence row and records every write.
// Returns { writes } so assertions can inspect what was PATCHed/POSTed.
function installMock(cadenceRow) {
  const writes = { patch: null, template_sends: [], signals: [] };
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/touchpoint_cadence') && method === 'GET') {
      return jsonResponse([cadenceRow], true, 200, { 'content-range': '0-0/1' });
    }
    if (u.includes('/touchpoint_cadence') && method === 'PATCH') {
      writes.patch = JSON.parse(opts.body);
      return jsonResponse([{ ...cadenceRow, ...writes.patch }], true, 200, { 'content-range': '0-0/1' });
    }
    if (u.includes('/template_sends') && method === 'POST') {
      writes.template_sends.push(JSON.parse(opts.body));
      return jsonResponse([{ id: 'ts-1' }], true, 201, { 'content-range': '0-0/1' });
    }
    if (u.includes('/signals') && method === 'POST') {
      writes.signals.push(JSON.parse(opts.body));
      return jsonResponse([{ id: 'sig-1' }], true, 201, { 'content-range': '0-0/1' });
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  return writes;
}

const baseCadence = () => ({
  id: 'cad-1',
  entity_id: 'ent-1',
  contact_id: 'contact-1',
  domain: 'gov',
  phase: 'prospecting',
  priority_tier: 'B',
  unsubscribe_status: 'active',
  current_touch: 0,
  consecutive_unopened: 0,
  emails_sent: 0, emails_opened: 0, emails_replied: 0,
  calls_made: 0, meetings_scheduled: 0,
  last_touch_at: '2026-05-01T00:00:00.000Z',
  next_touch_due: '2026-05-17T00:00:00.000Z',
  next_touch_type: 'email',
  next_touch_template: 'T-001'
});

describe('R24 Unit 1 — template_sends co-located with the email advance', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; delete process.env.CADENCE_OPEN_TRACKING_ACTIVE; });

  it('writes a template_sends row + bumps emails_sent on an email advance', async () => {
    const writes = installMock(baseCadence());
    const r = await advanceCadence('cad-1', { type: 'email', template_id: 'T-001', outcome: 'sent' });
    assert.equal(r.ok, true);
    assert.equal(writes.patch.emails_sent, 1, 'emails_sent incremented');
    assert.equal(writes.template_sends.length, 1, 'one template_sends row written');
    const row = writes.template_sends[0];
    assert.equal(row.template_id, 'T-001');
    assert.equal(row.entity_id, 'ent-1');
    assert.equal(row.contact_id, 'contact-1');
    assert.equal(row.domain, 'gov');
    // canonical columns only — none of the PGRST204 phantoms
    assert.ok(!('user_id' in row) && !('rendered_body' in row), 'no phantom columns');
  });

  it('does NOT double-write template_sends when the caller already recorded it (skip flag)', async () => {
    const writes = installMock(baseCadence());
    const r = await advanceCadence('cad-1', { type: 'email', template_id: 'T-001', outcome: 'sent', skip_template_send: true });
    assert.equal(r.ok, true);
    assert.equal(writes.patch.emails_sent, 1, 'emails_sent still bumped');
    assert.equal(writes.template_sends.length, 0, 'no co-located write — record_send owns it');
  });

  it('falls back to the cadence template when touchData carries none', async () => {
    const writes = installMock(baseCadence());
    await advanceCadence('cad-1', { type: 'email', outcome: 'sent' });
    assert.equal(writes.template_sends.length, 1);
    assert.equal(writes.template_sends[0].template_id, 'T-001', 'used next_touch_template');
  });
});

describe('R24 Unit 2 — inbound reply pauses + counts, never a send', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  it('bumps emails_replied, resets unopened, converts, and writes NO send', async () => {
    const writes = installMock({ ...baseCadence(), consecutive_unopened: 3, emails_replied: 1 });
    const r = await advanceCadence('cad-1', { type: 'reply', direction: 'inbound', outcome: 'replied' });
    assert.equal(r.ok, true);
    assert.equal(r.reply_captured, true);
    assert.equal(writes.patch.emails_replied, 2, 'emails_replied incremented');
    assert.equal(writes.patch.consecutive_unopened, 0, 'unopened streak reset');
    assert.equal(writes.patch.phase, 'converted', 'moved to active-engagement/pause');
    assert.ok(!('emails_sent' in writes.patch), 'reply is not an outbound send');
    assert.ok(!('current_touch' in writes.patch), 'reply does not advance the step');
    assert.equal(writes.template_sends.length, 0, 'reply writes no template_sends');
  });
});

describe('R24 Unit 3 — open-tracking-aware counters', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; delete process.env.CADENCE_OPEN_TRACKING_ACTIVE; });

  it('does NOT increment consecutive_unopened on a no-open-signal send', async () => {
    const writes = installMock({ ...baseCadence(), consecutive_unopened: 1 });
    await advanceCadence('cad-1', { type: 'email', template_id: 'T-001', outcome: 'sent' });
    assert.ok(!('consecutive_unopened' in writes.patch), 'unopened streak untouched without an open signal');
    assert.equal(writes.patch.emails_sent, 1);
  });

  it('DOES move the open counters when an explicit open signal is present', async () => {
    let writes = installMock({ ...baseCadence(), consecutive_unopened: 1 });
    await advanceCadence('cad-1', { type: 'email', template_id: 'T-001', opened: false });
    assert.equal(writes.patch.consecutive_unopened, 2, 'explicit opened:false counts as unopened');

    writes = installMock({ ...baseCadence(), consecutive_unopened: 1 });
    await advanceCadence('cad-1', { type: 'email', template_id: 'T-001', opened: true });
    assert.equal(writes.patch.consecutive_unopened, 0, 'opened:true resets');
    assert.equal(writes.patch.emails_opened, 1);
  });

  it('gates the >=2 phone-recovery branch on open-tracking-active', () => {
    const cad = { ...baseCadence(), consecutive_unopened: 3 };
    // default (flag off) → stays on the standard email sequence, no recovery
    const off = recommendNextTouch(cad, { open_tracking: false });
    assert.notEqual(off.label, 'Phone recovery (2+ consecutive unopened emails)');
    // flag on → phone-recovery fires
    const on = recommendNextTouch(cad, { open_tracking: true });
    assert.equal(on.type, 'phone');
    assert.equal(on.is_recovery, true);
  });
});
