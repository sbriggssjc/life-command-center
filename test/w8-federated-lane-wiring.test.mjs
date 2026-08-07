// Prompt 75 (W8 DC frontend wiring) — pin the exact gap class that shipped the
// w8_u3_link_review lane half-wired: it was a member of _DC_FEDERATED but had NO
// lane-list (SUBLANES) entry, NO _DC_FED_META entry, and NO card-render branch,
// so its cards were invisible in the Decision Center. Every _DC_FEDERATED member
// MUST have all three touches, else a future lane can ship the same way.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8');
const adminSrc = readFileSync(join(root, 'api/admin.js'), 'utf8');

function federatedMembers() {
  const m = opsSrc.match(/_DC_FEDERATED\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'could not find _DC_FEDERATED in ops.js');
  return [...new Set((m[1].match(/'([a-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, '')))];
}

// The SUBLANES lane list (renderReviewConsolePage) — every dt with an open handler.
function sublaneTypes() {
  const dts = new Set();
  const re = /\{\s*dt:\s*'([a-z0-9_]+)'/g;
  let mm;
  while ((mm = re.exec(opsSrc))) dts.add(mm[1]);
  return dts;
}

// The _DC_FED_META keys.
function metaKeys() {
  const m = opsSrc.match(/_DC_FED_META\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(m, 'could not find _DC_FED_META in ops.js');
  const keys = new Set();
  const re = /^\s{2}([a-z0-9_]+):\s*\{/gm;
  let mm;
  while ((mm = re.exec(m[1]))) keys.add(mm[1]);
  return keys;
}

// The card-render branches: `_dcFedType === 'X'`.
function renderBranches() {
  const set = new Set();
  const re = /_dcFedType === '([a-z0-9_]+)'/g;
  let mm;
  while ((mm = re.exec(opsSrc))) set.add(mm[1]);
  return set;
}

describe('W8 Decision Center federated-lane wiring completeness', () => {
  const members = federatedMembers();
  const sublanes = sublaneTypes();
  const meta = metaKeys();
  const branches = renderBranches();

  it('every _DC_FEDERATED member has a SUBLANES lane-list entry', () => {
    for (const dt of members) {
      assert.ok(sublanes.has(dt), `${dt} is federated but has no SUBLANES lane-list entry (it will never render)`);
    }
  });

  it('every _DC_FEDERATED member has a _DC_FED_META entry', () => {
    for (const dt of members) {
      assert.ok(meta.has(dt), `${dt} is federated but has no _DC_FED_META entry`);
    }
  });

  it('every _DC_FEDERATED member has a card-render branch', () => {
    for (const dt of members) {
      assert.ok(branches.has(dt), `${dt} is federated but has no _dcFedType === '${dt}' render branch`);
    }
  });

  it('w8_u3_link_review specifically is fully wired (regression guard)', () => {
    assert.ok(members.includes('w8_u3_link_review'), 'w8_u3_link_review must be federated');
    assert.ok(sublanes.has('w8_u3_link_review'), 'w8_u3_link_review needs a lane-list entry');
    assert.ok(meta.has('w8_u3_link_review'), 'w8_u3_link_review needs a meta entry');
    assert.ok(branches.has('w8_u3_link_review'), 'w8_u3_link_review needs a render branch');
  });
});

describe('W8 badge add-on counts in /api/review-counts', () => {
  it('exposes an owner_reconcile lane that folds in the W8 U2 dup-pair count', () => {
    assert.match(adminSrc, /key:\s*'owner_reconcile'/, 'review-counts must expose an owner_reconcile lane');
    assert.match(adminSrc, /w8_u2_dup_pair\?status=eq\.proposed/,
      'owner_reconcile lane must add the W8 U2 dup-pair proposed count');
    // The lane count must SUM the U2 add-on, not drop it.
    assert.match(adminSrc, /count:\s*sum\(orLcc,\s*orGovUnif,\s*orGovEmc,\s*orDiaEmc,\s*orU2\)/,
      'owner_reconcile count must include orU2 (the folded W8 U2 pairs)');
  });

  it('exposes a w8_u3_link_review lane reading v_w8_u3_link_review_open depth', () => {
    assert.match(adminSrc, /key:\s*'w8_u3_link_review'/, 'review-counts must expose a w8_u3_link_review lane');
    assert.match(adminSrc, /w8_u3_link_review\?status=eq\.proposed&proposed_verdict=in\.\(link_proposal,different_people\)/,
      'w8_u3_link_review lane must count the open proposals');
  });

  it('the DC page overrides both W8 badges from the live review-counts lanes', () => {
    assert.match(opsSrc, /orLane\s*=\s*res\.data\.lanes\.find[\s\S]*?'owner_reconcile'/,
      'ops.js must read the owner_reconcile review-counts lane');
    assert.match(opsSrc, /dc\['owner_reconcile'\]\s*=\s*orLane\.count/,
      'ops.js must override dc.owner_reconcile with the live lane count');
    assert.match(opsSrc, /dc\['w8_u3_link_review'\]\s*=\s*u3Lane\.count/,
      'ops.js must override dc.w8_u3_link_review with the live lane count');
  });
});
