# Claude Code — Phase 2 Slice 2c: enrich-mode for the local PROPERTIES backfill

## Why (grounded live 2026-06-11)
PROPERTIES enrich is NOT actually ingesting via the cron, for two structural
reasons:
1. **No cross-tick cursor.** `api/_handlers/folder-feed.js` `walkPhase` restarts
   its BFS from the roots every tick (`const queue = rootList.slice()`,
   `walkedFolders = new Set()` per tick). With `limit_folders=8`, a cron at the
   PROPERTIES root re-lists the top ~8 letter-buckets each tick and NEVER descends
   to the tenant/city folders where the OMs/BOVs live. Confirmed live: a
   cron-equivalent tick walked 3 ingest folders + 0 enrich; the only PROPERTIES
   enrich rows are from a manual `?folders=PROPERTIES/D/DaVita` test.
2. **Synchronous ~20s staging** caps throughput at ~1 file/tick even where reached.

PROPERTIES is a LARGE, mostly-STATIC tree — the right tool is the one-time LOCAL
backfill (off the synced disk, no SharePoint API / time-budget limits, recurses the
whole tree). The existing script `scripts/folder-feed-backfill.mjs` runs in INGEST
mode (create-capable). This slice adds an **enrich mode** so it matches-existing and
fills blanks (never creates a duplicate), matching the Slice-2a folder-feed enrich
channel.

## The change — `scripts/folder-feed-backfill.mjs`
- Add a CLI flag `--mode=enrich` (default stays `ingest` — no behavior change for
  existing On Market / Storage OM's backfills).
- In enrich mode, for each OM/flyer file:
  - Build the SAME `subject_hint` the folder-feed enrich path uses
    (`api/_shared/folder-feed-classify.js parseSubjectHintFromPath` on the
    PROPERTIES-relative path: tenant_brand + City, ST + vertical) so the promoter's
    path anchor resolves the EXISTING property.
  - Stage through the SAME enrich entrypoint as the cron: set
    `seed_data.mode = 'enrich'` (+ `tags:['folder_feed']`, `subject_hint`,
    `source_path`) on the stage-om payload. The promoter's `promoteMode='enrich'`
    (Slice 2a) then does fill-blanks + `property_documents` attach + provenance and
    routes unresolved files to the `match_disambiguation` lane — NEVER creates a
    property.
  - The backfill still reads LOCAL bytes (it has the file on disk) and POSTs via the
    existing `/api/intake/stage-om` path (bytes are local — sanctioned for the
    one-time backfill, per the existing script's contract); just carry the
    `seed_data.mode='enrich'` + `subject_hint` so the promoter takes the enrich
    branch.
- Default root for enrich mode: the local PROPERTIES tree
  (`C:\Users\scott\NorthMarq Capital, LLC\Team Briggs - Documents\PROPERTIES`);
  keep it overridable via the existing root arg. Resumable via the existing local
  manifest; gentle concurrency (existing default).
- Classify with the existing `[LCC]`-tag skip guard so the script never re-ingests
  our own write-back deliverables.

## House rules / test
`node --check` on the script; no `api/*.js` changed (handler/promoter enrich path
already exists from Slice 2a/2b). Add a small unit test for the enrich-mode payload
shaping (mode + subject_hint present; ingest mode byte-identical). Document the run
command in the script header.

## After (Scott runs it)
Scott runs `node scripts/folder-feed-backfill.mjs --mode=enrich` with DIA/GOV/LCC
service keys in env, pointed at the synced PROPERTIES tree. It crawls the whole tree
once (minutes, not weeks), enriching every matched property (docs attached, blanks
filled, provenance) — bypassing the cron's no-cursor + synchronous-stage limits.
Claude/Cowork then verifies `folder_feed_seen mode='enrich'` rows climb and
property_documents `source='folder_feed_properties'` attaches grow across the tree.

## Follow-up (separate, the steady-state piece — NOT this slice)
For NEW PROPERTIES files going forward, the cron needs (a) a persisted crawl cursor
/ folder work-queue so successive ticks descend the tree, and (b) async staging
(stage a pointer fast; a separate extraction-drain cron does the ~20s extract) so a
tick covers many folders. That's the proper scale fix for both PROPERTIES descent
AND the slow On Market drain (~1/tick, 71 deferred). Spec on request — the local
backfill above is what gets PROPERTIES ingested NOW.
