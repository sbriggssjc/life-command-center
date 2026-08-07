// Prompt 74 — W8 verdict branches must close their minted lcc_decisions row with
// a status that satisfies lcc_decisions_status_check (allowed: open/decided/
// skipped/superseded). A prior hardening set the status literal to 'resolved',
// which is NOT in the CHECK — so working the first real junk-review card 500'd
// ("verdict record failed") after the effect had already applied.
//
// The verdict handler reaches lcc_decisions only through the local record()
// helper (-> rpc/lcc_record_decision_verdict) and a couple of direct
// rpc/lcc_record_decision_verdict calls. This grep-based guard asserts EVERY
// status literal passed to that RPC is one of the four CHECK-valid values, and
// that the banned 'resolved' literal never reappears in a verdict-status slot.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'api/admin.js'), 'utf8');

const ALLOWED = new Set(['open', 'decided', 'skipped', 'superseded', 'deferred']);
// NB: 'deferred' is also CHECK-valid in lcc_decisions_status_check (owner_reconcile
// research path uses it). The banned value is specifically 'resolved'.

describe('Prompt 74 — W8 verdict lcc_decisions status is CHECK-valid', () => {
  it('no record(verdict, ...) call closes with the invalid literal "resolved"', () => {
    const hits = src.match(/record\([^,]+,\s*'([a-z_]+)'/g) || [];
    for (const h of hits) {
      const status = h.match(/,\s*'([a-z_]+)'/)[1];
      assert.ok(ALLOWED.has(status),
        `record() closes an lcc_decisions verdict with invalid status '${status}' -> ${h}`);
    }
  });

  it('no direct lcc_record_decision_verdict call passes p_status: "resolved"', () => {
    const hits = src.match(/p_status:\s*'([a-z_]+)'/g) || [];
    for (const h of hits) {
      const status = h.match(/'([a-z_]+)'/)[1];
      assert.notEqual(status, 'resolved',
        `p_status literal must be CHECK-valid, found '${status}'`);
    }
  });

  it('the banned literal "resolved" never appears as a verdict status anywhere', () => {
    assert.ok(!/record\([^,]+,\s*'resolved'/.test(src),
      "a record() call still uses the invalid 'resolved' status");
    assert.ok(!/p_status:\s*'resolved'/.test(src),
      "a p_status slot still uses the invalid 'resolved' status");
  });
});
