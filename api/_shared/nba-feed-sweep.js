// ============================================================================
// NBA FEED SWEEP — A5a (2026-08-27)
//
// The research-task generator (`handleGenerateResearchTasks`, api/admin.js)
// reads the gov/dia `v_next_best_research` gap feed and auto-closes every open
// task NOT present in that feed as `gap_resolved`. That close is only sound if
// the generator saw the WHOLE feed.
//
// ⚠️ THE BUG THIS MODULE EXISTS TO PREVENT: it did not. The feed was fetched
// with `limit=2000`, but **PostgREST caps any response at 1,000 rows** (the
// invariant already documented in CLAUDE.md — it cost the dia owner-facts sync
// 6,000 rows). The auto-close was guarded by `feed.length < limit`, i.e. it
// compared the number of rows it ASKED FOR against the number it GOT. 1000 <
// 2000 passes, so the guard waved through a truncation and the generator closed
// every open task outside a 1,000-row window as "the gap resolved".
//
// Measured 2026-08-27: 5,763 lifetime `gap_resolved` closures across four
// lanes, ~934 in the last 30 days, and on a 250-row sample of the largest lane
// (gov property_missing_recorded_owner) **239 of 250 subjects were still in the
// feed** — the gap had not resolved at all. Both domains' open-task counts were
// pinned at exactly 1,000, and 69,448 of the 71,448 real gap rows had never had
// a task minted.
//
// THE FOUR RULES ENCODED HERE
//   1. Truncation is detected from the RETURNED row count against the server's
//      page cap — never against a requested limit.
//   2. Reads stride at exactly FEED_PAGE_SIZE. A larger stride silently skips
//      rows (documented footgun); a smaller one just wastes round trips.
//   3. The ranked read carries a TOTAL-ORDER tiebreak. The gap arms are
//      hard-coded priority literals (`20 AS priority` etc.), so tens of
//      thousands of rows tie; without a tiebreak the window is an arbitrary,
//      unstable slice that changes between runs.
//   4. The close decision is settled by ASKING the feed about each open subject
//      (a bounded, chunked membership probe), not by inferring absence from a
//      list that happened to be downloaded. A downloaded list is only ever as
//      complete as the fetch that built it — which is exactly how a 1,000-row
//      truncation came to mean "the gap resolved".
//
// AND THE FAIL-CLOSED RULE: if the generator cannot prove it asked about every
// open subject and got untruncated answers, NOTHING is auto-closed. A task left
// open costs a row on a worklist; a false closure silently asserts that a gap
// was resolved when it was not, and is what manufactured the throughput number
// an entire audit was ranked on.
// ============================================================================

// PostgREST's hard per-response row cap. Not a tunable — asking for more
// returns 1,000 anyway, which is precisely how the original bug hid.
export const FEED_PAGE_SIZE = 1000;

// A TOTAL order over the feed: `(research_type, entity_id)` is unique in both
// the gov (41,805 rows) and dia (29,643 rows) views — verified live 2026-08-27,
// zero duplicate keys and zero null entity_ids — so appending these two columns
// makes the sort deterministic even though `priority` is a hard-coded literal
// on every gap arm.
export const NBA_FEED_ORDER = 'priority.desc,research_type.asc,entity_id.asc';

export function feedKeyOf(row) {
  if (!row) return null;
  const entityId = row.entity_id == null ? null : String(row.entity_id);
  if (!entityId) return null;
  return `${row.research_type}|${entityId}`;
}

export function openTaskKeyOf(task) {
  if (!task) return null;
  return `${task.research_type}|${task.source_record_id}`;
}

/**
 * Did this page prove the feed is exhausted?
 *
 * A page SHORTER than the server's cap is the only proof there is nothing
 * after it. A page exactly at the cap may or may not be the last one, so it is
 * treated as "more may follow" — which is the whole point: the returned count
 * is the signal, never the requested limit.
 */
export function pageProvesExhausted(returnedRowCount, pageSize = FEED_PAGE_SIZE) {
  return Number(returnedRowCount) < Number(pageSize);
}

/**
 * How many open-task subjects to ask about in one membership probe.
 *
 * ⚠️ THIS BOUND EXISTS SO A PROBE CAN NEVER BE SILENTLY TRUNCATED — the very
 * defect A5a fixes, in a new dress. One entity_id can match several arms of the
 * feed's UNION (property ids, owner ids and contact ids share a numeric space),
 * so a chunk of N ids can return up to N × arms rows. At 150 ids over the six
 * live arms the worst case is 900, comfortably under the 1,000-row response cap
 * — and `probeChunkIsTrustworthy` asserts that on every chunk anyway.
 */
export const PROBE_CHUNK_SIZE = 150;

/**
 * A probe chunk is only trustworthy if it came back UNDER the response cap. At
 * or above it, the answer may be a truncation, and a truncated membership
 * answer would under-report presence — i.e. it would close tasks whose gap is
 * still open. Exactly the bug this module exists to prevent.
 */
export function probeChunkIsTrustworthy(returnedRowCount, pageSize = FEED_PAGE_SIZE) {
  return Number(returnedRowCount) < Number(pageSize);
}

/** Distinct subject ids of the open tasks, split into probe-sized chunks. */
export function chunkProbeIds(openTasks = [], size = PROBE_CHUNK_SIZE) {
  const seen = new Set();
  for (const t of openTasks) {
    const id = t?.source_record_id == null ? null : String(t.source_record_id);
    if (id) seen.add(id);
  }
  const ids = [...seen];
  const n = Math.max(1, Number(size) || PROBE_CHUNK_SIZE);
  const out = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

// An id that could break out of a PostgREST `in.(...)` list is never sent; it
// is reported instead, and an unprobed subject can never be closed.
const PROBE_ID_SAFE = /^[A-Za-z0-9_.:-]+$/;
export function probeIdIsSafe(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && PROBE_ID_SAFE.test(id);
}

/**
 * The auto-close plan.
 *
 * ⚠️ FAIL CLOSED. `membershipComplete` is true only when EVERY open subject was
 * asked about and every probe chunk came back untruncated. Absence from
 * `presentKeys` otherwise proves nothing, and NOTHING is closed. This is the
 * single most important rule in the module — reversing it reinstates the exact
 * defect (~934 false closures a month, 5,763 lifetime, 0 real completions).
 *
 * Note the evidence direction: the generator no longer INFERS absence from a
 * list it happened to download, it ASKS the feed about each open subject. A
 * downloaded list is only as complete as the fetch that built it — which is
 * precisely how a 1,000-row truncation became "the gap resolved".
 *
 * Returns { close: task[], skipped: number, reason: string|null }.
 */
export function planAutoClose({ membershipComplete, openTasks = [], presentKeys }) {
  if (!membershipComplete) {
    return {
      close: [],
      skipped: openTasks.length,
      reason: 'membership_incomplete_auto_close_skipped',
    };
  }
  const keys = presentKeys instanceof Set ? presentKeys : new Set(presentKeys || []);
  const close = openTasks.filter(t => !keys.has(openTaskKeyOf(t)));
  return { close, skipped: openTasks.length - close.length, reason: null };
}

/**
 * The MINT head — deliberately a different budget from the close set.
 *
 * The close decision needs COMPLETENESS (see planAutoClose); minting needs
 * PRIORITISATION. Splitting them is what lets the fix land without unleashing
 * the producer: the close is settled by a bounded membership probe over the
 * ~2,000 open tasks, while only the top `mintLimit` feed rows are eligible to
 * become tasks. Open counts therefore converge to min(mintLimit, feed size) per
 * domain and stop — a bounded, stated outcome — instead of flooding the
 * Research surface with tens of thousands of rows nobody value-gated (that gate
 * is A5c, not this change).
 *
 * ⚠️ AND IT IS WHY THE FEED IS NOT PAGED IN FULL. Measured 2026-08-27, the gov
 * `v_next_best_research` materialises and external-sorts all 41,805 rows on
 * EVERY request (1,149 ms, 8 MB spilled to disk) — the documented "an ORDER BY
 * forces the whole view to materialise, so the LIMIT is irrelevant" footgun. A
 * 42-page offset sweep would cost ~48 s of gov DB time per run, 48 runs a day,
 * on the shared PostgREST pool that the 2026-08-12 incident wedged. The same
 * query FILTERED to a list of ids pushes the predicate into every UNION arm and
 * costs 44 ms. Completeness bought by probing, not by downloading.
 */
export function planMintHead(rows = [], mintLimit) {
  const n = Number(mintLimit);
  if (!Number.isFinite(n) || n < 0) return rows.slice();
  return rows.slice(0, n);
}

/** Pages needed to fetch the ranked mint head, given the response cap. */
export function mintHeadPageCount(mintLimit, pageSize = FEED_PAGE_SIZE) {
  const n = Math.max(0, Number(mintLimit) || 0);
  return Math.ceil(n / Number(pageSize));
}
