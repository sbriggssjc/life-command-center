// ============================================================================
// A5c — THE RESEARCH-TASK PRODUCER'S VALUE GATE
//
// A5a made the auto-close correct. That exposed what a correct producer emits:
// `would_insert` 2,586 on one run, cron 35 firing every 30 minutes, into a pool
// of 71,448 gap rows — 84% of whose dia owners hold ZERO properties, with
// operators and literal placeholders carrying 81% of the apparent value.
//
// A5c gates the producer's SELECTION on `gate_pass`, a column the domain views
// compute from each arm's own recorded facts.
//
// ⚠️ THE ONE RULE THIS FILE EXISTS FOR — THE MINT/PROBE ASYMMETRY.
// The generator makes two reads of the same view:
//   * the MINT head asks "what is worth working"  → gated
//   * the membership PROBE asks "does the gap still exist" → UNGATED
// Sharing the filter would make every gated-out subject look ABSENT from the
// feed, and `planAutoClose` would close it as `gap_resolved` — a second false
// claim of exactly the kind A5a removed, and worse, because it would look like
// the gate tidying up. Deciding not to work something is not the gap resolving.
//
// Every assertion below was mutation-verified RED.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  NBA_MINT_GATE_FILTER, feedReadUsesValueGate, nbaFeedGateFilter,
} from '../api/_shared/nba-feed-sweep.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminSrc = readFileSync(join(ROOT, 'api/admin.js'), 'utf8');
// ⚠️ Several assertions below must see CODE, not the prose around it. This file
// documents the mint/probe asymmetry in comments, and a check that matches the
// explanation instead of the implementation passes over a deleted line — the
// A1 prose-detector defect wearing a test's clothes. Mutation-verified: two
// assertions were GREEN on a deleted assignment until they read this instead.
const adminCode = adminSrc
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const sweepSrc = readFileSync(join(ROOT, 'api/_shared/nba-feed-sweep.js'), 'utf8');

// ── The asymmetry, as behaviour ─────────────────────────────────────────────

test('the mint read is value-gated', () => {
  assert.equal(feedReadUsesValueGate('mint'), true);
  assert.equal(nbaFeedGateFilter('mint'), NBA_MINT_GATE_FILTER);
});

test('the membership probe is NEVER value-gated', () => {
  // Reversing this closes every gated-out open task as `gap_resolved`.
  assert.equal(feedReadUsesValueGate('probe'), false);
  assert.equal(nbaFeedGateFilter('probe'), null);
});

test('an unknown read purpose defaults to UNGATED, not gated', () => {
  // Fail-open on the FILTER is fail-closed on the CLOSE: an unrecognised
  // caller must never silently acquire the gate and start closing live gaps.
  for (const purpose of ['', null, undefined, 'close', 'anything']) {
    assert.equal(feedReadUsesValueGate(purpose), false, String(purpose));
    assert.equal(nbaFeedGateFilter(purpose), null, String(purpose));
  }
});

test('the gate filter is a PostgREST boolean predicate on gate_pass', () => {
  // The data-query edge function forwards `filter` as `<col>=<op>.<val>`, so
  // the column name has to be exactly what the domain views expose.
  assert.equal(NBA_MINT_GATE_FILTER, 'gate_pass=is.true');
});

// ── The wiring, asserted on stable identity tokens ──────────────────────────
// Per the block-slice footgun this file never slices a region or pins a line —
// it asserts over the whole source on tokens that are the thing itself.

test('the mint-head fetcher applies the gate; the probe builds its own URL and does not', () => {
  // fetchNbaFeed is the mint path. It must ask for the gate.
  assert.ok(/nbaFeedGateFilter\(\s*'mint'\s*\)/.test(adminCode),
    'fetchNbaFeed must resolve the gate filter for the mint read');
  // The probe must not — no call site may request a gated probe.
  assert.ok(!/nbaFeedGateFilter\(\s*'probe'\s*\)/.test(adminCode),
    'nothing should be asking for a gated probe');
  // And no feed read may hand PostgREST a hand-rolled gate predicate: the
  // filter has ONE owner, so a second copy cannot drift onto the probe.
  assert.ok(!/searchParams\.set\('filter',\s*[`'"][^`'"]*gate_pass/.test(adminCode),
    'the gate filter literal belongs in nba-feed-sweep.js, not inline in a feed URL');
});

test('probeNbaFeedMembership never sets a filter beyond the entity_id list', () => {
  // The probe assembles its own URL. Isolate it by its unique identity token —
  // the `entity_id=in.(` predicate only it builds — and assert the only
  // searchParams `filter` it sets is that one.
  const i = adminCode.indexOf('async function probeNbaFeedMembership');
  assert.ok(i > 0, 'probeNbaFeedMembership must exist');
  const j = adminCode.indexOf('\nasync function handleGenerateResearchTasks', i);
  assert.ok(j > i, 'probe function must be followed by the handler');
  const probe = adminCode.slice(i, j);
  const filters = probe.match(/searchParams\.set\('filter',[^\n]*/g) || [];
  assert.equal(filters.length, 1, 'the probe sets exactly one filter');
  assert.ok(/entity_id=in\.\(/.test(filters[0]),
    'the probe\'s only filter is its entity_id membership list');
  assert.ok(!/gate_pass/.test(probe),
    'the probe must not mention gate_pass in any form');
});

test('the mint select carries the gate columns the honest counts read', () => {
  // `gate_reason` is the leak check (every minted row must read "admitted").
  // Dropping it from the select turns that check into a silent 'unknown'.
  assert.ok(/gate_reason,gate_value/.test(adminCode),
    'the feed select must request gate_reason (and gate_value) for the honest counts');
  assert.ok(/summary\.gate_reasons_seen\s*=/.test(adminCode),
    'the run summary must report which gate reasons reached the mint set');
});

// ── The reason the asymmetry exists must stay written down ──────────────────

test('the shared module states why the probe is exempt', () => {
  assert.ok(/probe/i.test(sweepSrc) && /gap_resolved/.test(sweepSrc),
    'nba-feed-sweep.js must explain that gating the probe manufactures gap_resolved');
});

// ── Honest counts ───────────────────────────────────────────────────────────

test('the mint head reports whether it saw the WHOLE admitted population', () => {
  // `feed` short of `limit` means it is the entire admitted set; `feed` at
  // `limit` means it is only a floor. Reporting one as the other is the badge
  // that lies.
  assert.ok(/summary\.admitted_head_exhausted\s*=\s*head\.exhausted/.test(adminCode),
    'the run summary must distinguish an exhausted head from a capped one');
});

test('the dia research badge counts gated rows, not raw feed output', () => {
  // Ungated this badge read 29,643 — the whole pool. Doctrine rule 5: every
  // badge is actionable work.
  assert.ok(/domCount\('dia',\s*'v_next_best_research\?gate_pass=is\.true'/.test(adminCode),
    'the dia_research lane badge must count value-gated rows');
});
