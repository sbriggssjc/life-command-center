# Prompt 101 — ACCELERATOR: backfill Outlook display names from email_bodies → flip the harvest NOW

**Grounding (live, 2026-08-13):** the W9.4 harvest is gated on `activity_events.metadata.from_name`/
`to_names`, which prompt 96 made forward-only. Live check: only **30 of 6,977** outlook
`activity_events` carry `from_name`, and just **7 new rows since the flow fix** — organic accrual
is slow. **BUT prompt-96's own root-cause doc states: "`email_bodies.from_name` was already stored;
the canonical `activity_events` spine was not."** So a historical name source EXISTS — a one-time
backfill unlocks the harvest immediately instead of waiting weeks for mail volume. Scott asked to
accelerate; this is the lever.

## Do

1. **Verify the source (ground live first):** confirm `email_bodies` (or the equivalent inbound/
   sent body store) carries `from_name` + recipient names, and how it joins to `activity_events`
   (by `external_id` / internet message id / a shared key). Report the joinable count — how many of
   the 7,751 name-less correspondence rows can be backfilled.
2. **One-shot backfill (additive, fill-blanks, reversible):** for each joinable `activity_events`
   row lacking `metadata.from_name`/`to_names`, populate them from `email_bodies` via the shared
   `outlook-recipients.js` parser (same shape the forward-path writes — one code path, no fork).
   Batch-tagged, reversible ledger; NEVER overwrite an existing name (fill-blanks). Bounded/cursored
   (the 92-class walk-the-pool guard) — 7,751 rows in resumable batches, not one giant statement.
3. **Provenance honesty:** tag backfilled names with a `backfilled_from:'email_bodies'` marker in
   metadata so they're distinguishable from at-ingest capture (the prompt-93 reconstruction pattern).
4. **Re-check the harvest:** after the backfill, `GET /api/reachability-harvest-tick?score=1&n=10`
   should now show non-zero `comms_counts.header_name_pairs` — report the sample. If it does, the
   W9.2 flag is ready to flip on real historical yield, not just future mail.
5. **Tests:** join-correctness fixture, fill-blanks (existing name untouched), parser reuse,
   cursor resume.

## Acceptance

- Backfill runs on the joinable rows; report before/after `from_name` coverage (30 → N) and the
  harvest dry-run's non-zero header_name_pairs. Reversible via the batch tag. Then Cowork flips
  `W9_2_REACHABILITY_HARVEST` on the accelerated corpus. ROLLOUT_STATUS note; prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
