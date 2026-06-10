# Claude Code — Phase 2 Slice 1c: per-tick `max_stage` cap on the folder-feed drain

## Why
The folder-feed list + classify path is verified live (Slice 1b). Before turning a
POST drain loose on an On Market folder with 32–58 OMs, we want a **controlled
first real drain** that stages just 1–2 files so we can watch stage → extract →
match → propagate end-to-end. Add a small per-tick cap. Generally useful as a
safety throttle for every future drain, not just the first.

## The change — `api/_handlers/folder-feed.js` only (no new `api/*.js`, still 12)
- Read `const maxStage = req.query.max_stage != null ? Math.max(0, parseInt(req.query.max_stage, 10) || 0) : Infinity;`
  (absent → `Infinity` = current unbounded behavior; `0` is allowed and means
  "stage nothing this tick" — effectively a dry-run-with-writes-to-`folder_feed_seen`-only,
  see below).
- Maintain a running `stagedThisTick` counter across the whole walk (all folders
  in the tick, not per-folder).
- In the drain branch, **before** calling `stageOmIntake` for a file, check
  `if (stagedThisTick >= maxStage) { … }`. When the cap is hit:
  - Do **not** stage. Record the file in `folder_feed_seen` with
    `status='seen'` (NOT `'staged'`, NOT `'skipped'`) so it's tracked as
    known-but-deferred and a later uncapped tick will pick it up (the
    `(path, hash)` idempotency already makes the re-walk safe — a `'seen'` row is
    eligible to be staged on a subsequent tick; confirm the diff treats `'seen'`
    as "not yet staged" and re-attempts it).
  - Increment a `files_deferred` counter (add to the summary + per-folder rows).
- Only count a file against `stagedThisTick` when it was actually OM/flyer-eligible
  AND staging was attempted (don't let skipped/unknown types consume the cap).
- The cap applies to **POST (drain) only**. GET (dry-run) already writes nothing;
  leave it untouched (it can still report `would-stage` counts as today).

## Summary shape
Add `max_stage` (echo the effective cap; `null`/omit when `Infinity`) and
`files_deferred` to the response JSON (top-level + per-folder), alongside the
existing `files_staged` / `files_skipped` counters.

## House rules / test
`node --check`; ≤12 `api/*.js`; idempotent on `(path, hash)`; never writes domain
tables (still routes through `stageOmIntake`). Add a unit test asserting: with
`max_stage=2` and ≥3 OM-eligible files, exactly 2 stage and the rest record
`status='seen'` + `files_deferred>=1`; with no `max_stage`, behavior is unchanged.
Ships on the Railway redeploy of merged `main`.

## After deploy (Claude/Cowork verifies — not Claude Code)
POST `folder-feed-tick?folders=Gv't Leased Research/On Market&max_stage=2` →
expect exactly 2 staged, the rest deferred; then watch the 2 intake rows extract
and match.
