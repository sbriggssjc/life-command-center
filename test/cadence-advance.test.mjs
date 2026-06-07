// R10 Unit 1 regression — advanceCadence MUST reschedule next_touch_due into
// the future after a touch, even when the next recommended touch is a phone/vm
// step with a null template. The pre-R10 guard keyed on nextRec.template and
// left next_touch_due frozen on phone steps, so the card never left its band.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { advanceCadence } from '../api/_shared/cadence-engine.js';

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) { return headers[name.toLowerCase()] || headers[name] || null; }
    },
    async text() { return JSON.stringify(body); }
  };
}

describe('advanceCadence reschedules after a touch (R10 Unit 1)', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('sets next_touch_due into the future when the next step is a null-template phone touch', async () => {
    const cadenceId = '11111111-1111-1111-1111-111111111111';
    // current_touch 0 → after advance becomes 1 → next recommended touch is #2
    // (phone, template null). Old due is well in the past.
    const cadenceRow = {
      id: cadenceId,
      entity_id: '22222222-2222-2222-2222-222222222222',
      phase: 'prospecting',
      priority_tier: 'B',
      unsubscribe_status: 'active',
      current_touch: 0,
      consecutive_unopened: 0,
      emails_sent: 0, emails_opened: 0, calls_made: 0, meetings_scheduled: 0,
      last_touch_at: '2026-05-01T00:00:00.000Z',
      next_touch_due: '2026-05-17T00:00:00.000Z',
      next_touch_type: 'email',
      next_touch_template: 'T-001'
    };

    let patchBody = null;
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      const method = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && method === 'GET') {
        return jsonResponse([cadenceRow], true, 200, { 'content-range': '0-0/1' });
      }
      if (u.includes('/touchpoint_cadence') && method === 'PATCH') {
        patchBody = JSON.parse(opts.body);
        return jsonResponse([{ ...cadenceRow, ...patchBody }], true, 200, { 'content-range': '0-0/1' });
      }
      throw new Error(`unexpected fetch: ${method} ${u}`);
    };

    const result = await advanceCadence(cadenceId, { type: 'touch', outcome: 'logged_from_priority_queue' });

    assert.equal(result.ok, true, 'advance should succeed');
    assert.ok(patchBody, 'a PATCH should have been issued');
    // The core regression: next_touch_due is present AND in the future.
    assert.ok(patchBody.next_touch_due, 'next_touch_due must be set on the update');
    assert.ok(
      new Date(patchBody.next_touch_due).getTime() > Date.now(),
      `next_touch_due must be in the future, got ${patchBody.next_touch_due}`
    );
    // It rescheduled to the phone step (touch #2) — template legitimately null.
    assert.equal(patchBody.next_touch_type, 'phone');
    assert.equal(patchBody.current_touch, 1, 'touch counter advanced');
    assert.ok(patchBody.last_touch_at, 'last_touch_at stamped');
  });
});
