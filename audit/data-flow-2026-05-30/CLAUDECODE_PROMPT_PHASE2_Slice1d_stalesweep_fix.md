# Claude Code — Phase 2 Slice 1d: stale-sweep correctness + DEFAULT_ROOTS hardening

## Context / why (grounded live 2026-06-10)
A capped drain on `Gv't Leased Research/On Market` wrongly marked **54 still-
existing files `stale`** (11 OMs + 43 unknowns) in `folder_feed_seen`. A fresh
listing confirms all 54 files are still in SharePoint — they were NOT deleted.
`stale` is terminal (the diff treats only `'seen'` as re-attemptable), so those
11 OMs would be lost to ingestion forever. The cron is paused
(`cron.alter_job(114, active:=false)`) until this ships.

## Root cause (api/_handlers/folder-feed.js, the walk)
`livePaths` is built INCREMENTALLY inside the per-file loop
(`livePaths.add(item.path)` at ~line 267), but that loop **breaks on the 22s
time budget** (`if (Date.now() - startedAt > TIME_BUDGET_MS) break;` ~line 266).
When a large folder (OLD has 125 files) is cut short after staging ~2, `livePaths`
holds only the ~2 processed files. The stale sweep (~line 398) then runs because
`listing.items.length > 0` (the LISTING fully succeeded — 125 items), and marks
every previously-seen direct child NOT in the partial `livePaths` as stale. A
listed-but-not-yet-processed file is still **live**; the bug is conflating
"processed this tick" with "present in the listing."

## Unit 1 (REQUIRED) — build `livePaths` from the full listing, up front
In the walk, replace the incremental construction with a complete set built from
ALL listed files BEFORE the processing loop:

- Remove `const livePaths = new Set();` (~line 263) and the in-loop
  `livePaths.add(item.path);` (~line 267).
- Right after `fileItems` is computed (~line 251), add:
  ```js
  // Every file in the listing is "live" — independent of whether the per-file
  // loop reaches it this tick. The loop may break early on the time budget, so
  // building livePaths from the full listing (not incrementally) is what keeps
  // the stale sweep from mass-staling the un-processed tail.
  const livePaths = new Set(fileItems.map(it => it.path));
  ```
With this, the stale sweep compares against the COMPLETE listing, so a
time-budget-truncated tick can never stale a still-listed file. (The existing
`if (!dryRun && listing.items.length > 0)` guard + the `if (!listing.ok) continue`
above it already protect against empty/failed listings; this fixes the
partial-processing case those guards miss.)

## Unit 2 (RECOMMENDED hardening) — require 2 consecutive misses before staling
Even with Unit 1, a single transient List-flow quirk that returns a *partial but
ok* listing could stale a real file. Mirror the availability-checker's
`consecutive_check_failures` pattern: add a `miss_streak int NOT NULL DEFAULT 0`
column to `folder_feed_seen` (migration). In the sweep, instead of staling on the
first miss, increment `miss_streak`; only set `status='stale'` when
`miss_streak >= 2`. Reset `miss_streak=0` whenever a file is re-seen (in the
already-seen PATCH at ~line 291 and in `upsertSeen`). This makes staling robust to
any single bad tick. (If you judge Unit 1 alone sufficient and want to keep scope
minimal, implement Unit 2 as a follow-up — but note it in the PR.)

## Unit 3 — DEFAULT_ROOTS hardening (defense-in-depth)
`DEFAULT_ROOTS` (~line 41) is currently the whole tree (PROPERTIES + Storage OM's
+ both full research roots). With read-back now working, a cleared/missing
`FOLDER_FEED_ROOTS` env would silently re-expose the entire tree to the cron and
auto-promote from PROPERTIES (no enrich-mode yet). Change `DEFAULT_ROOTS` to the
two On Market ingest folders only:
```js
const DEFAULT_ROOTS = [
  "/sites/TeamBriggs20/Shared Documents/Gv't Leased Research/On Market",
  '/sites/TeamBriggs20/Shared Documents/Dialysis Research/Comps/On Market',
];
```
(`FOLDER_FEED_ROOTS` env still overrides; this just makes the *fallback* safe.
PROPERTIES re-enters only via the deliberate Slice-2 enrich path.)

## Tests
- Regression for Unit 1: drive the handler with a mocked listing of N=5 files and
  a TIME_BUDGET that trips after processing 1; assert the other 4 are NOT staled
  (the existing 4 previously-seen rows keep their status), and `files_stale=0`.
- A genuine deletion still staled: listing of 3 files where a previously-seen 4th
  child is absent → that 4th is staled (Unit 1 preserves real staling).
- If Unit 2 done: first miss → `miss_streak=1`, status unchanged; second
  consecutive miss → `stale`.

## House rules
`node --check`; ≤12 `api/*.js` (handler-only for Unit 1/3; Unit 2 adds one
migration); idempotent; routes through `stageOmIntake` only. Ships on the Railway
redeploy of merged `main`.

## After deploy (Claude/Cowork — recovery, not Claude Code)
I'll reset the 54 wrongly-staled gov rows so they re-ingest, then re-enable the
cron and verify a full-folder tick stales nothing:
```sql
-- recovery: stale → seen so the next walk re-evaluates (OMs stage, unknowns re-skip)
UPDATE public.folder_feed_seen
   SET status='seen', last_seen_at=now()
 WHERE status='stale'
   AND server_relative_path LIKE '%Gv''t Leased Research/On Market%';
```
