# Claude Code — Phase 2: SharePoint folder-feed worker (Slice 1)

Design + decisions: `ARCHITECTURE_PHASE2_folder_feed.md` (same folder). This is
the first build slice. Goal: turn the existing **Team Briggs Documents** tree
into an ingestion channel that flows through the SAME extract → match → promote
pipeline — **read the tree as-is, never reorganize it.** Start with the file
types that already have extractors (OMs/flyers); leave hooks for lease/master/
comp extractors as later units.

## Key efficiency — reuse Phase 1, don't re-upload
Folder-feed files **already live in SharePoint**, so there is nothing to save.
The artifact just points at the existing path and extraction reads it back via
the Phase-1 **Flow 2 "Get file content"** (`SHAREPOINT_FETCH_URL`). So the only
NEW Power Automate dependency is a **"List folder"** flow; the Get flow already
exists.

## Locked conventions (Scott, 2026-06-09)
- **DB-only tracking** — never write into the team tree (no sidecar, no moves).
- **LCC outputs → existing deliverable folders** (`Memos/`, `Lease Comps/`,
  `Sales Comps/`) tagged `[LCC]` + `source='lcc_generated'` (later units; not
  this slice).
- One pipeline, many channels: emit a normalized payload to the EXISTING
  promoter (`stageOmIntake` / the `/api/intake/stage-om` path); **never write
  domain tables directly.**

## Dependency — PA flow "SharePoint → List folder" (Scott builds, spec it)
HTTP-triggered. Request `{ folder_path }` → SharePoint **"List folder"** (or
"Get files (properties only)" with a path filter) → Response
`{ ok:true, items:[ { path, name, size, modified, etag } ... ] }`. Secure +
scope the connection to the Team Briggs library only (least privilege). URL →
`SHAREPOINT_LIST_URL`. Feature-flag the worker to no-op cleanly until it's set
(the `find_contacts_by_account` rollout pattern).

## Unit 1 — `folder_feed_seen` table (LCC Opps, DB-only tracking)
`folder_feed_seen( id, server_relative_path text, content_hash text,
size_bytes bigint, modified_at timestamptz, intake_id uuid null, status text
(seen|staged|promoted|skipped|error|stale), vertical text, subject_hint jsonb,
first_seen_at, last_seen_at, UNIQUE(server_relative_path, content_hash) )`.
This is the entire footprint on the team's files — a DB record, nothing written
to SharePoint. Migration is additive/cache-or-live-safe.

## Unit 2 — the worker `?_route=folder-feed-tick` (sub-route of intake.js — mind the 12-function ceiling)
Per tick (gentle, time-budgeted, bounded N folders — the artifact-offload cadence
lesson):
1. Pull a batch of "due" folders (a configurable root list: `PROPERTIES/*`,
   `Storage OM's/`, and the per-vertical research folders). Call the List flow.
2. Diff each listing against `folder_feed_seen` by `(path, etag/size/modified)`;
   compute `content_hash` only for new/changed files.
3. **Filename-first classifier** (cheap): this slice handles **OM/flyer PDFs**
   (`*OM*`,`*offering*`,`*flyer*`,`*marketing*` .pdf) → the existing OM
   extractor. Everything else → record `status='skipped'` with the detected
   `type` (lease/master/comp/BOV/DD/unknown) so later units can light them up —
   do NOT parse them yet.
4. For an OM file: build `subject_hint` from the path (§ below), record the
   artifact with `storage_backend='sharepoint_pa'`, `storage_ref=<the existing
   server_relative_path>`, `inline_data=NULL` (the bytes are already in
   SharePoint), and hand to `stageOmIntake`. Extraction reads the bytes via the
   Phase-1 Get flow. Stamp `folder_feed_seen.intake_id` + `status`.
5. Idempotent: re-walking re-emits only new/changed files; a vanished path →
   `status='stale'` (never delete derived data).

## Path → subject_hint (the match anchor)
From `PROPERTIES/<bucket>/<TENANT/BRAND>[/<City, ST>]/…`:
- `tenant_brand` = the folder under the A-Z bucket.
- `city`,`state` = the `City, ST` subfolder if present (`^(.+),\s*([A-Z]{2})$`).
- `vertical` = inferred from the tenant (dialysis operators → dia; agency/GSA
  cues → gov) OR the research-folder root (`Dialysis Research`→dia, `Gv't Leased
  Research`→gov). Feed `subject_hint` into the EXISTING matcher as a
  high-confidence pre-filter (path beats cover-page parse). Unresolved →
  the existing `match_disambiguation` decision lane, never a guess-write.

## Unit 3 — local backfill (one-time, no API limits)
A node script (run from Scott's machine where the library is synced at
`C:\Users\scott\NorthMarq Capital, LLC\Team Briggs - Documents`) walks the
legacy tree on disk, hashes each OM, and POSTs to the same stage path (bytes are
local, so it can upload directly OR record the SharePoint ref). Use local for the
big legacy sweep; the cron + List flow for steady-state new files. Gentle
concurrency on the 60-connection tier.

## Cron
`lcc-folder-feed` (gentle, e.g. `*/30`), `lcc_cron_post('/api/folder-feed-tick',
…)`. Bounded folders/tick. Goes live with the worker; no-ops until
`SHAREPOINT_LIST_URL` is set.

## House rules
`node --check`; **no new api/*.js** (sub-route on intake.js — keep ≤12);
effect-first + outcome-truthful; idempotent on `(path, hash)`; emit to the
promoter, never write domain tables; least-privilege PA connection; DB-only
footprint (nothing written to the team tree). Migration cache-or-live-safe.

## Test / verify
- With `SHAREPOINT_LIST_URL` set: a folder containing a known OM → `folder-feed-tick`
  lists it, stages it (`folder_feed_seen.status='staged'`, `intake_id` set),
  extraction reads it back via the Get flow, and it lands in the normal intake
  funnel (the existing inbox/promoter), matched via the path anchor.
- Re-run = no duplicate (idempotent on path+hash).
- Non-OM files recorded `skipped` with a detected type, not parsed.
- Report: folders walked, files seen/new/staged/skipped, match rate via the path
  anchor vs unresolved → disambiguation.

## Out of scope (later units)
Lease-abstract / master-sheet / comp-export extractors · LCC-output write-back to
Memos/Comps with `[LCC]` tagging · correspondence/notes (Phase 3) · the shared
context MCP service (Phase 4).
