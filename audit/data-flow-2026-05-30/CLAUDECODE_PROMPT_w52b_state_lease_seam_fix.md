# Claude Code Prompt — W5.2b: state-lease consumer seam fix (stop sharing gov lead-gen's `processed_at`)

**Repo: life-command-center.** Small, surgical: `api/admin.js` (`handleStateLeaseConsume`)
+ tests. Do NOT touch the GovernmentProject repo or the gov lead-gen.

## The collision (measured live, 2026-08-06 — run #554 aftermath)

The TX producer is FIXED and ran green (gov PR #364): 40 new `state_lease_events`
created 2026-08-05 14:53 UTC (new_lease 5, removed 6, lessor_change 9, renewed 17,
relocated 1, agency_change 2). **But ALL 40 already carry `processed_at`** — stamped by
the gov-side `state_events_to_leads` processor, which runs INSIDE pipeline step 44
immediately after the diff and marks every event it dispositions (including
`no_lead_event_type:removed/renewed/agency_change` — consumed, NO lead created).

`handleStateLeaseConsume` filters `state_lease_events?processed_at=is.null` — so it
scans 0 forever. The no-lead distress events (**6 removed + 2 agency_change right now**)
die silently between the two consumers. `processed_at` is gov lead-gen's seam and was
never ours to share (the 2026-06-23 backfill stamp was the clue; W5.2's grounding
misread it as a burned one-shot).

## Fix

1. **Stop reading `processed_at` as the LCC seam.** The tick selects candidate events
   by event_type + recency and tracks ITS OWN consumption ops-side. Follow whichever
   is cleanest per existing repo precedent:
   - a watermark (last-consumed event created_at/id) stored in an existing ops
     key-value/state surface if one exists, PLUS the per-event don't-re-ask that is
     already there (`lcc_decisions` subject_ref `slease:<id>`, and research_tasks
     `source_record_id` dedupe) as the idempotency guarantee; or
   - pure per-event ledgering (query events where id not already tasked/decided) if
     that's simpler — the volume is tiny (single-digit distress events per month).
   Re-running the tick must create ZERO duplicates (existing dedupe tests extend).
2. **Stop WRITING `processed_at` from the LCC tick** (the apply path currently marks
   it). That column belongs to gov lead-gen now; LCC touching it can hide events from
   lead-gen or double-stamp. LCC consumption state lives ops-side only.
3. **Partition the event types with gov lead-gen (no double-surfacing):**
   - LCC distress/task set becomes: `removed`, `footprint_reduction`, `agency_change`
     — the types lead-gen explicitly dispositions as `no_lead_event_type`.
   - DROP `relocated` from the LCC task set: lead-gen already creates a prospect_lead
     for it (`lead_event:relocated`); it moves to the digest counts instead.
   - Digest counts (`renewed`, `new_lease`, `lessor_change`, now + `relocated`)
     become simple recent-window counts (they can no longer key on processed_at
     either — e.g. created_at within the window since the last tick/30d; keep them
     informational and cheap).
4. **Recover the stranded events:** the fix must pick up the 8 no-lead distress
   events created 2026-08-05 (they are `processed_at`-stamped but never LCC-consumed).
   A created_at-based initial watermark of 2026-08-01 (or ledger-absence logic)
   covers this naturally — verify in the live check below.
5. **Producer-staleness alarm: unchanged** (it keys on max(created_at) — correct).

## Unchanged / Do NOT
- Payload shape (structured, ids + deep_link, instructions NULL), research_tasks
  routing, thresholds elsewhere, agency-risk + NPI ticks (their seams are their own —
  agency_risk.processed_at was ADDED by W5.2 with no other writer; the NPI ledger is
  ops-side already), crons, Decision Center lanes.
- Do not modify gov-side tables or the gov repo. No gov migration.
- Keep the 2026-06-23 backfill events excluded (any watermark/ledger logic must not
  resurrect them — they were dispositioned in the June session).

## Tests
Update `test/w5-2-signal-task-automation.test.mjs`: distress set without `relocated`;
consumption independent of processed_at (fixture events WITH processed_at set must
still task); idempotent re-run; no write to gov processed_at from the tick.

## Verify (live, after merge + Railway redeploy)
GET `/api/state-lease-consume` (X-LCC-Key) must show scanned=8 (6 removed +
2 agency_change) with sample payloads; POST (or next cron) creates exactly 8
research_tasks; second run creates 0. Record in ROLLOUT_STATUS (session log +
W5.2 row: seam-contention fix, type partition documented).
