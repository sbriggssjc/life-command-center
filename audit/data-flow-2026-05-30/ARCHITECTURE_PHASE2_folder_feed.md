# Phase 2 — SharePoint Folder-Feed (the design)

> Builds on Phase 1 (storage adapter + the live SharePoint Save/Get PA flows).
> Goal: turn the **existing** Team Briggs Documents tree into a first-class
> ingestion channel — leases, DD, master sheets, comps, OMs, BOVs — flowing into
> the SAME extract → match → promote → propagate machinery, with the folder path
> itself as a strong match anchor. **Read the tree as-is; do not reorganize it.**

## 1. Ground truth — the actual tree (inspected 2026-06-09)
- `PROPERTIES/<A-Z|1-9|Multi|Portfolio>/<Tenant or Brand>[/<City, ST>]/…files`
  — tenant/brand-centric, then geography. ~27 alpha buckets. Depth varies (some
  property folders have a `City, ST` subfolder, some don't).
- `Storage OM's/` — flat OM store; `Storage OM's/Intake/` is the Phase-1 adapter
  landing zone (created live).
- `Lease Comps/`, `Sales Comps/`, `Memos/`, `Templates/` — deliverable/reference.
- Per-vertical research: `Gv't Leased Research/`, `Dialysis Research/`,
  `Childcare Research/`, `Dental Research/`, `Medical Research/`, … each with
  semi-consistent subfolders (`Business Development`, `Comps`, `Inventory`,
  `Quarterly Report`, master `.xlsx`/`.pbix`, …).

**Design consequence:** the tree is human-organized and inconsistent in depth, so
the feed must be *tolerant* — infer the subject from the path + filename, never
assume a rigid schema. The brand+city/state in the path resolves the LCC entity
far more reliably than parsing a cover page.

## 2. Two doctrines (carried from the main architecture)
1. **One pipeline, many channels.** The folder-feed is an *adapter* that emits the
   same normalized payload the email-OM channel emits, then hands off to
   extract → match → promote → propagate. No parallel pipeline; no direct domain
   writes (the CoStar-sidebar mistake).
2. **Read, don't reorganize.** LCC maps the existing tree to entities and only
   *adds* thin, additive landing zones it writes to. The 27-bucket property tree
   stays exactly as the team keeps it.

## 3. The matching anchor (path → entity)
For each file, build a `subject_hint` from the path before any content parse:
- **Tenant/brand** = the `PROPERTIES/<bucket>/<THIS>` folder name.
- **City, ST** = the `City, ST` subfolder if present (regex `^(.+),\s*([A-Z]{2})$`).
- **Vertical** = inferred from the tenant (dialysis operators → dia; agency/GSA
  cues → gov) OR from a research-folder root (`Dialysis Research` → dia, `Gv't
  Leased Research` → gov). Childcare/dental/medical map to their (future) domains.
Feed `subject_hint` into the **existing** matcher (the 4-tier brand/address/
embedding/name matcher) — the path anchor becomes a high-confidence pre-filter,
so match rates should beat cover-page parsing. Unresolved → the existing
`match_disambiguation` decision lane (R8), not a silent drop.

## 4. Per-file-type extractors (classify by extension + filename)
| Pattern | Type | Extractor |
|---|---|---|
| `*OM*`, `*Offering*`, `*flyer*` .pdf | OM | existing OM extractor (reuse verbatim) |
| `*lease*`, `*abstract*` .pdf | lease abstract | lease-term extractor (firm/term/rent/escalations) |
| `*rent roll*`, `*master*` .xlsx | master/rent sheet | tabular extractor → leases/financials |
| `*comp*` / Lease|Sales Comps export | comp export | the Briggs-comps mapping (already a skill) |
| `*BOV*`, `*valuation*` | BOV | value/assumption extractor (read-back of our own work) |
| `*tax*`, `*CIM*`, `*PSA*`, `*estoppel*` | DD doc | generic doc → notes/provenance |
Unknown types → stored + indexed as a `property_document` reference with the path
anchor (searchable, not parsed). The classifier is filename-first (cheap), with a
content sniff fallback.

## 5. The two read paths (cloud vs local — both Graph-free)
- **Cloud (LCC/Railway):** a new PA flow **"SharePoint → List/Get folder"** (HTTP
  trigger; "List folder" + "Get file content" actions) returns a folder listing +
  bytes. A LCC worker (`?_route=folder-feed-tick`, sub-route of intake.js) walks
  overdue folders, pulls new/changed files (by `Modified` + a content hash), emits
  the normalized payload. Async/queued, time-budgeted — never a synchronous hot
  path (the Phase-1 lesson). Mirrors the email-intake + availability-checker cron
  shape.
- **Local (Cowork/Claude, scripts):** the library is on disk
  (`C:\Users\scott\NorthMarq Capital, LLC\Team Briggs - Documents`), so a local
  pass can bulk-read with zero API for the initial backfill (thousands of legacy
  files) — feeding the same ingest endpoint. Use local for the one-time backfill;
  the PA cron for steady-state new files.

## 6. Structure decisions (Scott, 2026-06-09) — the "structure in place"
**Both choices keep LCC's footprint on the team tree at essentially zero — there
is no new folder scaffold to create; the existing tree IS the structure.**

1. **DB-only tracking (chosen).** The feed records `(server_relative_path,
   content_hash, intake_id, status)` in a LCC `folder_feed_seen` table and
   **never writes anything into the Team Briggs tree** — no sidecar files, no
   `_Processed` moves. The team's folders are read-only to LCC except for the two
   write targets below. Zero footprint, fully reversible (drop the table).
2. **Outputs into existing deliverable folders (chosen).** LCC-generated BOVs /
   memos / comps land in the team's **current** folders (`Memos/`, `Lease Comps/`,
   `Sales Comps/`, the property's own folder) — no `_LCC/Generated` tree. Because
   LCC and human files now co-mingle there, **tag LCC-authored files** so
   re-ingestion knows provenance: a filename marker (e.g. ` [LCC]` suffix or an
   `LCC_` prefix per the team's preference) AND a DB provenance row
   (`source='lcc_generated'`). The re-ingest classifier treats `lcc_generated`
   as our own authoritative work (high trust), not a third-party doc.

The only LCC-owned landing zone remains **`Storage OM's/Intake/<YYYY-MM-DD>/`**
(the Phase-1 adapter target for incoming OM artifacts) — already created and in
use. Nothing else is created.

## 7. Idempotency + change detection
Key each file on `(server_relative_path, content_hash)`. A `folder_feed_seen`
table (LCC Opps) records processed `(path, hash, intake_id, status)`. Re-walking
a folder re-emits only new/changed files. Deletes/renames are detected on the
next full walk (path gone → mark stale, don't delete derived data). Same
"cache-or-live, never lose source" posture as the rest of LCC.

## 8. Safety / caveats
- **Permissions & least privilege.** The PA connection's identity governs what
  the feed can read; scope it to the Team Briggs library, nothing wider. Don't
  let the brain read what a member shouldn't.
- **Volume.** The legacy tree is large — backfill via the LOCAL path (no API
  limits), steady-state via the cron at a gentle cadence (the artifact-offload
  lesson: gentle, not every-5-min).
- **Tolerant matching.** Inconsistent depth means some files won't resolve — route
  to the disambiguation lane, never guess-write.
- **No direct domain writes.** The feed emits payloads to the promoter; it never
  writes dia/gov tables directly.

## 9. Actionable next steps (in order)
1. ✅ **Conventions decided** (§6, Scott 2026-06-09): DB-only tracking; outputs
   to existing deliverable folders with `[LCC]` tagging. Structure is settled.
2. **PA flow "SharePoint → List/Get folder"** (Scott/me in PA — the read inverse
   of the Save flow; reuses the same SharePoint connection). HTTP trigger →
   SharePoint "List folder" + "Get file content using path" → Response.
3. **Claude Code: `folder-feed-tick` worker + `folder_feed_seen` table (DB-only)
   + filename/type classifier + the path→`subject_hint` matcher hook + the
   `[LCC]`/`source='lcc_generated'` provenance tag.** Prompt ready to write on
   request now that the conventions are locked.
4. **Local backfill pass** for the legacy tree (one-time, via the synced folder;
   no API limits) — then the PA cron maintains steady-state on new files.
