# Claude Code — Phase 2 Slice 2d: PROPERTIES cloud crawl engine + all-doc-type attach + async staging

## Why (grounded live 2026-06-11)
PROPERTIES enrich does not actually ingest, for three reasons, and the local
backfill is NOT the answer (the synced tree is mostly OneDrive cloud-only
placeholders — DaVita has 151 city folders but 11 local files). Scott chose the
**cloud crawl engine** (SharePoint-API, no local sync) + **attach all doc types**.

Three structural gaps to fix:
1. **No cross-tick cursor.** `api/_handlers/folder-feed.js` `walkPhase` restarts its
   BFS from the roots each tick (`const queue = rootList.slice()`), so a cron at the
   PROPERTIES root re-lists the top letter-buckets forever and never descends to the
   tenant/city folders where the files live.
2. **OM-only enrich.** The worker only stages `cls.isOm` files; every lease / BOV /
   DD / master sheet / comp is classified and then SKIPPED. A live dry-run of one
   PROPERTIES slice: 31 leases, 19 DD, 14 masters, 11 BOVs, 8 comps — and 2 OMs. The
   value is in those working docs, and none are attached.
3. **Synchronous ~20s staging** caps throughput at ~1 file/tick (also why On Market
   has 71 OMs still deferred).

Build this in units; each is shippable independently.

## Unit 1 — persisted crawl frontier (descend the tree across ticks)
New table **`folder_feed_frontier`** (LCC Opps): `(id, server_relative_path UNIQUE,
mode, status pending|visited, depth, parent_path, discovered_at, visited_at,
revisit_after)`. Seed with the enrich roots.
- New worker mode (`?source=frontier` or driven by a new `crawlPhase`): each tick
  pop **N pending** folders (oldest first = BFS), and for each: list it via the
  SharePoint List flow → **enqueue its subfolders** into the frontier
  (`INSERT … ON CONFLICT (server_relative_path) DO NOTHING`) → process its files
  (Unit 2) → mark the folder `visited` with `visited_at` + a `revisit_after`
  (e.g. +7d) so the tree is periodically re-swept for NEW files. When no `pending`
  rows remain, promote any `visited` rows past `revisit_after` back to `pending`.
- This replaces the per-tick `queue = rootList.slice()` for the crawl: progress
  persists, so successive ticks descend deeper. Bound per-tick by a folder count +
  the time budget. Idempotent + resumable by construction.
- A dedicated cron **`lcc-folder-feed-crawl`** (offset from `lcc-folder-feed`) calls
  the worker in frontier mode for the enrich roots, so PROPERTIES gets its own
  budget independent of On Market.

## Unit 2 — attach ALL recognized doc types (not just OMs)
In the enrich processing, for EVERY classified doc (lease / BOV / DD / master /
comp / OM / flyer — i.e. any non-`unknown`, non-`lcc_generated` type):
- **Resolve the property by the PATH ANCHOR alone** (`subject_hint` tenant_brand +
  City, ST + vertical from `PROPERTIES/<bucket>/<tenant>/<City, ST>`), reusing the
  existing 4-tier matcher's path pre-filter. No extraction needed for the match.
- **On confident match → attach a `property_documents` row** (`file_name`,
  `document_type` = the classified type, `source_url` = server-relative path,
  `source='folder_feed_properties'`) + `field_provenance`. Fill-blanks-only,
  never create. This is a LIGHT path: no AI, just register the doc against the
  property — turning every working doc in the folder into part of the connected
  object + searchable + visible in the context packet.
- **OMs/flyers additionally** go through the existing Slice-2a extraction (fill
  blanks from the snapshot). Other types attach-only (no extraction).
- **Unresolved → the existing `match_disambiguation` lane** (never a guess, never a
  create). `unknown`/`lcc_generated` stay skipped.
- Record on `folder_feed_seen` with the detected_type + a new status `attached`
  (distinct from `staged`) for the attach-only docs, so the audit shows what landed.

## Unit 3 — async OM extraction (decouple the ~20s stall)
So the crawl isn't blocked by extraction:
- `stageOmIntake` (folder-feed path) stages the OM intake and returns FAST
  (status `received`, no synchronous extract) instead of extracting inline.
- A separate drain **`/api/intake-extract-drain`** (sub-route, NO new api/*.js) +
  cron **`lcc-intake-extract-drain`** processes `received` intakes in bounded
  batches (the existing `processIntakeExtraction` per intake). This is the same
  decouple the email channel would benefit from.
- Net: each crawl tick lists many folders + attaches many docs (fast) + stages OMs
  (fast); extraction happens on its own cadence. This also drains the On Market
  backlog (71 deferred) far faster than ~1/tick.
- **Gate carefully:** the extract-drain is bounded (batch size + time budget) and
  runs per-intake, so it never floods LCC Opps (the disk/connection lessons). Keep
  the synchronous path as a fallback flag so nothing breaks if the drain is paused.

## Migrations (LCC Opps, additive)
- `folder_feed_frontier` table + indexes (status, revisit_after).
- `folder_feed_seen.status` CHECK extended with `attached` (if it's CHECK-constrained).
- crons `lcc-folder-feed-crawl` + `lcc-intake-extract-drain` (idempotent
  unschedule-then-schedule; no-op safe until the endpoints ship — apply AFTER the
  Railway deploy, same posture as lcc-folder-feed).

## House rules / tests
≤12 `api/*.js` (sub-routes on intake.js + shared modules; new handlers in
`api/_handlers/`); `node --check`; full suite green. Unit tests: frontier
enqueue/visit/revisit cycle; attach-all-types (a lease resolves by path → attaches,
no extraction, no create; an OM attaches + extracts; unresolved → disambiguation);
async stage returns `received` + the drain extracts it. Ships on the Railway
redeploy; migrations applied after.

## After deploy (Claude/Cowork)
Verify: the frontier descends PROPERTIES over a few ticks (deep tenant/city folders
move from pending→visited); `property_documents source='folder_feed_properties'`
attaches climb across many doc types (lease/BOV/DD/master/comp), not just OMs; the
extract-drain clears `received` OM intakes; the On Market 71-deferred backlog
drains. Then a context packet for an enriched property shows its full document set.

## Sequencing note
Unit 2 (all-doc-type attach) delivers the most value and can ship first (even on the
current cron, it'd attach docs in the folders the cron does reach). Unit 1 (frontier)
makes it reach the WHOLE tree. Unit 3 (async) makes it fast + fixes On Market. Ship
in that order if splitting; all three together is the complete PROPERTIES feed.
