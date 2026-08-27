// A5a — the research-task generator auto-closed over a TRUNCATED feed.
//
// `handleGenerateResearchTasks` (api/admin.js) reads the gov/dia
// `v_next_best_research` gap feed and auto-closes every open task NOT in that
// feed as `gap_resolved`. PostgREST caps any response at 1,000 rows regardless
// of `limit` — a footgun already documented in CLAUDE.md — and the guard read
//
//     if (feed.length < limit)          // 1000 < 2000  → passes
//
// i.e. it compared the number of rows it ASKED FOR against the number it GOT.
// Its own comment said the guard existed so this could "never [fire] on a
// capped slice"; it fired on one every night.
//
// Measured live 2026-08-27 (LCC Opps / dia / gov):
//   * feeds are 41,805 (gov) + 29,643 (dia) = 71,448 rows; the app saw 1,000
//     per domain, so BOTH domains' open counts were pinned at exactly 1,000;
//   * 5,763 lifetime `gap_resolved` closures, ~934 in the last 30 days;
//   * of 250 sampled gov `property_missing_recorded_owner` subjects, 239 were
//     STILL IN THE FEED — the gap had not resolved;
//   * 69,448 real gap rows had never had a task minted at all, including two
//     entire lanes (`owner_needs_sos`, `property_missing_county_record`).
//
// GUARD DESIGN: the behavioural rules are exercised against the exported pure
// functions of `_shared/nba-feed-sweep.js`, which is the single owner of them.
// The two source assertions grep for STABLE IDENTITY TOKENS (the defect's own
// comparison; the order string) over the whole file — never a line number and
// never a sliced source region (CLAUDE.md block-slice footgun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FEED_PAGE_SIZE, NBA_FEED_ORDER, PROBE_CHUNK_SIZE,
  pageProvesExhausted, probeChunkIsTrustworthy, chunkProbeIds, probeIdIsSafe,
  planAutoClose, planMintHead, mintHeadPageCount,
  feedKeyOf, openTaskKeyOf,
} from '../api/_shared/nba-feed-sweep.js';

const ADMIN_SRC = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');

// ── 1. Truncation is decided by the RETURNED count, against the server cap ──
test('a full page is NOT proof the feed ended; a short page is', () => {
  // The exact shape of the bug: the real feed returned 1000 and the code
  // concluded "that is the whole feed" because it had asked for 2000.
  assert.equal(pageProvesExhausted(1000, FEED_PAGE_SIZE), false);
  assert.equal(pageProvesExhausted(999, FEED_PAGE_SIZE), true);
  assert.equal(pageProvesExhausted(0, FEED_PAGE_SIZE), true);
});

test('the stride equals the PostgREST cap — a larger stride silently skips rows', () => {
  assert.equal(FEED_PAGE_SIZE, 1000);
});

// ── 2. FAIL CLOSED — the single most important rule in the module ──────────
test('an incomplete membership answer closes NOTHING and names the reason', () => {
  const openTasks = [
    { id: 1, research_type: 'true_owner_needs_salesforce', source_record_id: 'a' },
    { id: 2, research_type: 'true_owner_needs_salesforce', source_record_id: 'b' },
  ];
  const plan = planAutoClose({ membershipComplete: false, openTasks, presentKeys: new Set() });
  assert.equal(plan.close.length, 0, 'an unproven membership answer must never close a task');
  assert.equal(plan.skipped, 2);
  assert.match(plan.reason, /membership_incomplete/);
});

test('a probe chunk at or over the response cap is NOT trustworthy', () => {
  // The A5a defect in its new dress: a truncated membership answer under-reports
  // presence, i.e. it closes gaps that are still open.
  assert.equal(probeChunkIsTrustworthy(1000, FEED_PAGE_SIZE), false);
  assert.equal(probeChunkIsTrustworthy(999, FEED_PAGE_SIZE), true);
  // ...and the chunk size makes that unreachable in the first place: one id can
  // match several UNION arms, so the bound must leave real headroom.
  assert.ok(PROBE_CHUNK_SIZE * 6 < FEED_PAGE_SIZE,
    'a chunk must not be able to fill the response cap even if every id matches every arm');
});

test('a complete membership answer closes exactly the subjects the feed no longer holds', () => {
  const openTasks = [
    { id: 1, research_type: 'lane_a', source_record_id: '10' },  // still a gap
    { id: 2, research_type: 'lane_a', source_record_id: '11' },  // genuinely resolved
    { id: 3, research_type: 'lane_b', source_record_id: '10' },  // different lane, same id
  ];
  const presentKeys = new Set(['lane_a|10', 'lane_b|10']);
  const plan = planAutoClose({ membershipComplete: true, openTasks, presentKeys });
  assert.deepEqual(plan.close.map(t => t.id), [2]);
  assert.equal(plan.reason, null);
});

test('every open subject is probed exactly once, deduped, in bounded chunks', () => {
  const openTasks = [];
  for (let i = 0; i < 1000; i += 1) {
    openTasks.push({ id: i, research_type: 'lane_a', source_record_id: String(i) });
    openTasks.push({ id: 10000 + i, research_type: 'lane_b', source_record_id: String(i) });
  }
  const chunks = chunkProbeIds(openTasks, PROBE_CHUNK_SIZE);
  const flat = chunks.flat();
  assert.equal(new Set(flat).size, 1000, 'one subject id shared by two lanes is probed once');
  assert.equal(flat.length, 1000, 'no id is probed twice');
  for (const c of chunks) assert.ok(c.length <= PROBE_CHUNK_SIZE);
});

test('an id that could break out of an in.() list is never sent', () => {
  assert.equal(probeIdIsSafe('44521'), true);
  assert.equal(probeIdIsSafe('001fc6e5-e2a7-43f6-850c-f97aeef99fa4'), true);
  for (const bad of ['a,b', 'a)', '"x"', 'a&b', '', 'a b', 'x'.repeat(200)]) {
    assert.equal(probeIdIsSafe(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
});

test('the close key is (research_type, entity_id) — one id in two lanes is two subjects', () => {
  assert.equal(feedKeyOf({ research_type: 'lane_a', entity_id: 10 }), 'lane_a|10');
  assert.notEqual(
    feedKeyOf({ research_type: 'lane_a', entity_id: 10 }),
    feedKeyOf({ research_type: 'lane_b', entity_id: 10 }),
  );
  assert.equal(
    feedKeyOf({ research_type: 'lane_a', entity_id: 10 }),
    openTaskKeyOf({ research_type: 'lane_a', source_record_id: '10' }),
  );
});

// ── 3. A TOTAL order, or paging is not deterministic ───────────────────────
test('the feed sort carries a tiebreak beyond the hard-coded priority literal', () => {
  const cols = NBA_FEED_ORDER.split(',').map(s => s.trim()).filter(Boolean);
  assert.ok(cols.length >= 2,
    'priority alone ties across tens of thousands of rows (`20 AS priority` is a literal), ' +
    'so an untied sort makes the window and the paging non-deterministic');
  assert.ok(cols[0].startsWith('priority.'), 'priority must still rank first');
  const rest = cols.slice(1).join(',');
  assert.ok(/research_type/.test(rest) && /entity_id/.test(rest),
    '(research_type, entity_id) is unique in both feeds — that is what makes the order total');
});

// ── 4. Reading the whole feed must not unleash the producer ────────────────
test('the mint set stays bounded even when the swept feed is enormous', () => {
  const feed = Array.from({ length: 71448 }, (_, i) => ({ research_type: 'lane_a', entity_id: i }));
  assert.equal(planMintHead(feed, 2000).length, 2000);
  assert.equal(planMintHead(feed, 500).length, 500);
  // ...and the head is the priority-ranked TOP of the feed, not an arbitrary slice
  assert.equal(planMintHead(feed, 3)[0].entity_id, 0);
});

// ── 5. Regression simulation of the exact live defect ──────────────────────
test('the live 2026-08-27 truncation no longer closes anything', () => {
  const REAL_FEED_ROWS = 41805;         // gov v_next_best_research
  const REQUESTED_LIMIT = 2000;         // what cron 34 asks for
  const returned = Math.min(REAL_FEED_ROWS, FEED_PAGE_SIZE);   // what PostgREST gives back
  // The original guard, verbatim in spirit:
  assert.equal(returned < REQUESTED_LIMIT, true,
    'the old guard passed on a truncation — this is the bug, asserted so it cannot be argued away');
  // The fixed guard reads the RETURNED count against the server cap:
  assert.equal(pageProvesExhausted(returned, FEED_PAGE_SIZE), false);
  const openTasks = Array.from({ length: 1000 }, (_, i) => ({ id: i, research_type: 'property_missing_recorded_owner', source_record_id: String(i) }));
  // ...and an unproven membership answer over those same 1,000 tasks closes none.
  assert.equal(planAutoClose({ membershipComplete: false, openTasks, presentKeys: new Set() }).close.length, 0);
});

// ── 6. Source guards: stable identity tokens, whole-file, no line anchors ──
test('api/admin.js no longer compares a returned feed length against a requested limit', () => {
  assert.ok(!/feed(?:\.rows)?\s*\.\s*length\s*<\s*limit/.test(ADMIN_SRC),
    'the defect was `if (feed.length < limit)` — a returned count judged against a request');
  assert.ok(!/\bfeed capped at limit\b/.test(ADMIN_SRC),
    'the stale note that described the bug as the design must be gone too');
});

test('the gap_resolved write is planned by planAutoClose, not by an ad-hoc condition', () => {
  assert.ok(/gap_resolved/.test(ADMIN_SRC), 'the auto-close still exists');
  assert.ok(/planAutoClose\(/.test(ADMIN_SRC),
    'every gap_resolved close must go through the fail-closed planner');
  assert.ok(/NBA_FEED_ORDER/.test(ADMIN_SRC) && !/'order',\s*'priority\.desc'\s*\)/.test(ADMIN_SRC),
    'the feed fetch must use the total order, not a bare priority.desc');
  assert.ok(/probeChunkIsTrustworthy\(/.test(ADMIN_SRC),
    'every membership chunk must be checked against the response cap before it is believed');
  assert.ok(/probeIdIsSafe/.test(ADMIN_SRC),
    'subject ids must be validated before they are interpolated into an in.() list');
});

test('the ranked head is read at the cap, so a 2000-row mint needs two pages', () => {
  assert.equal(mintHeadPageCount(2000, FEED_PAGE_SIZE), 2);
  assert.equal(mintHeadPageCount(500, FEED_PAGE_SIZE), 1);
  assert.equal(mintHeadPageCount(1000, FEED_PAGE_SIZE), 1);
});
