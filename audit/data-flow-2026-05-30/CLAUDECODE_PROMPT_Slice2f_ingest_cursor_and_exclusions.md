# Claude Code — Phase 2 Slice 2f: bring On Market ingest onto the frontier cursor + exclude archive/working subfolders

## Why (grounded live 2026-06-11)
71 On Market OMs are stuck in `folder_feed_seen.status='seen'` (deferred), last
touched 2026-06-10 19:27 and never re-reached since — even though all three
folder-feed crons are active. Root cause is the same no-cursor bug Slice 2d fixed
for ENRICH, but the **INGEST path was never migrated onto the frontier**:

- The ingest cron is `/api/folder-feed-tick?limit_folders=8` (mode=ingest), which
  runs the legacy `walkPhase` — `const queue = rootList.slice()` restarts the BFS
  from the roots every tick and is bounded to 8 folders. So it only ever re-walks
  the top few On Market folders and never descends to the deep subfolders where
  the deferred OMs live.
- The 71 deferred sit in exactly two deep subfolders:
  - `Gv't Leased Research/On Market/OLD` — **56** (an ARCHIVE of deprecated
    listings)
  - `Dialysis Research/Comps/On Market/_added or updated in comps spreadsheet` —
    **15** (a working/staging subfolder)

So two distinct problems: (1) the ingest path can't reach deep On Market
subfolders across ticks, and (2) some of those subfolders are archive/working
folders we do NOT want ingested as live deals.

## Unit 1 — put ingest on the frontier cursor (the structural fix)
Reuse the existing `folder_feed_frontier` machinery (it already carries a `mode`
column) for the On Market ingest roots, exactly as the enrich crawl uses it:
- Seed the ingest roots into `folder_feed_frontier` with `mode='ingest'`.
- The frontier crawl worker (`?source=frontier`) already pops pending folders BFS,
  enqueues subfolders, processes files per the row's `mode`, and marks
  `visited` + `revisit_after` so the tree is periodically re-swept for NEW files.
  Confirm the worker processes ingest-mode frontier rows through the ingest file
  path (stageOmIntake), not the enrich attach path — branch on the frontier row's
  `mode`.
- Point the ingest cron at the frontier:
  `/api/folder-feed-tick?source=frontier&mode=ingest` (or run a single frontier
  tick that drains BOTH modes — your call, but keep the ingest and enrich
  per-tick budgets separate so a deep PROPERTIES pass can't starve On Market, the
  Slice-2a.1 lesson). Retire the legacy cursorless `limit_folders=8` ingest tick
  once the frontier covers it.
- The deferred 'seen' rows re-stage automatically once the frontier reaches their
  folder (the worker already falls through 'seen' → re-attempt — verified).

If you'd rather not migrate ingest onto the frontier this slice, the minimum
viable alternative is to raise the ingest walk's reach so it descends fully — but
the frontier is the durable, consistent fix and the table already exists.

## Unit 2 — exclude archive + working subfolders from ingestion
Some On Market subfolders are not live-deal sources and must never be ingested or
re-surface as deferred:
- `**/On Market/OLD/**` (and any `/OLD/` / `/Archive/` / `/Archived/` segment) —
  deprecated listings.
- `**/_added or updated in comps spreadsheet/**` and other leading-`_` working/
  staging subfolders — scratch folders, not deal docs.
Add a path-exclusion check in the worker (shared helper, applied in BOTH the
frontier enqueue step AND the per-file processing so excluded folders are neither
descended into nor staged). For the **existing** 71 deferred rows under these
excluded paths, record `status='skipped'` with a reason
(`excluded_archive_or_working`) so they stop showing as deferred backlog and the
stale-sweep leaves them alone. Make the exclusion list a small named constant
(easy to extend); keep patterns anchored to a path SEGMENT so a tenant legitimately
named "OLD Dominion …" isn't caught.

## Don't break
- Enrich crawl is unchanged (already on the frontier).
- The PROPERTIES vs On Market budget separation (Slice 2a.1) stays — ingest gets
  its own per-tick folder/time budget.
- Live On Market subfolders that are NOT archive/working still ingest normally —
  the exclusion is narrow (OLD/Archive + leading-underscore working folders).
- Stale-sweep: excluded rows marked `skipped` are terminal; don't let the sweep
  flip them back.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Unit tests: the exclusion helper
(`.../On Market/OLD/x.pdf` and `.../_added or updated.../y.xlsx` → excluded;
`.../On Market/Live Deal/z.pdf` and a tenant "Old Dominion" path → NOT excluded);
ingest frontier-mode routing (a seeded ingest root enqueues subfolders and stages
an OM via the ingest path, not the enrich attach path). No migration required if
`folder_feed_frontier` already allows `mode='ingest'` and `status='skipped'` is a
legal `folder_feed_seen` value (both true today).

## After deploy (Claude/Cowork verifies live)
- The ingest frontier descends On Market across ticks; the live (non-excluded)
  deferred OMs flip `seen`→`staged`→ extracted by the drain; the On Market backlog
  count falls.
- The 56 `OLD` + 15 working-folder rows move to `status='skipped'`
  (`excluded_archive_or_working`) and stop re-surfacing.
- No new deferred backlog accumulates in steady state.

Ships on the Railway redeploy.
