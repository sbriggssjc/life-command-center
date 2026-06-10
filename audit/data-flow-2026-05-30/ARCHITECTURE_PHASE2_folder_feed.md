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
2. **PA list flow — ✅ SOLVED via REST (verified live 2026-06-10).** The "List
   folder" connector action was a dead end for dynamic paths; the working flow uses
   "Send an HTTP request to SharePoint" and returns real folder data. Full
   confirmed shape + remaining steps in the CORRECTED APPROACH block below.
   _History:_ Built "Http -> List folder (LCC
   List Folder)", id `ca110bdc-41b0-4caf-854e-16ed6efa8706` (HTTP trigger
   `{folder_path}` → SharePoint **List folder** → **Response** = single expr
   `addProperty(json('{"ok":true}'),'value',body('List_folder'))`). The Response
   trick is correct (the field statically validates JSON, so a single `addProperty`
   expression is the only way to wrap a dynamic array). BUT the **List folder**
   action's "File Identifier" is an **opaque picker-encoded id, not a usable plain
   path** — passing the dynamic `folder_path` returns **NotFound** for every format
   tried (`/Shared Documents/Ad-Hoc Analyst Requests`, `/sites/TeamBriggs20/Shared
   Documents/…`, apostrophe-free folders included). The picker *displays* a friendly
   path but stores an encoded token, so it can't be driven by an arbitrary runtime
   path. (The remote new-designer also froze on the action-swap — Scott's native
   browser is more reliable for the rebuild.)

   **CORRECTED APPROACH — use "Send an HTTP request to SharePoint" (REST):** it
   takes a plain server-relative path and is the standard dynamic-folder-listing
   pattern.
   - Action: SharePoint **Send an HTTP request to SharePoint**, Site = Team Briggs,
     Method **GET**, Uri (inline `@{}` ok in this text field — no fx-token dance):
     `_api/web/GetFolderByServerRelativeUrl('@{triggerBody()?['folder_path']}')?$expand=Folders,Files`
   - **Response** body (single expression, same wrap trick — MUST be committed via
     the fx editor as a token, not typed as text; typed-as-text returns the literal
     expression string at runtime, confirmed 2026-06-10):
     `addProperty(json('{"ok":true}'),'sp',body('Send_an_HTTP_request_to_SharePoint'))`
   - **✅ BUILT + VERIFIED LIVE 2026-06-10.** A real run against `Ad-Hoc Analyst
     Requests` returned the folder's files+subfolders. **Confirmed response shape**
     (OData *verbose* — note the `d` envelope and `.results` arrays):
     `{ok:true, sp:{ d:{ Name, ServerRelativeUrl, ItemCount,
        Files:{results:[{Name, ServerRelativeUrl, Length(string!), TimeCreated,
        TimeLastModified, UniqueId, ETag, …}]},
        Folders:{results:[{Name, ServerRelativeUrl, ItemCount, UniqueId,
        TimeLastModified, …}]} }}}`. Arrays are at **`sp.d.Files.results` /
     `sp.d.Folders.results`** (not `sp.Files`); **`Length` is a string** → parseInt.
   - `folder_path` the worker sends = the **full server-relative path**
     `/sites/TeamBriggs20/Shared Documents/<path>`; **apostrophes doubled** (`''`)
     for the OData string literal (`Storage OM's` → `Storage OM''s`).
   - **Worker change (Claude Code, paired — Slice 1b prompt ready):** `callListFolder`
     reads `json.sp.d.Files.results` + `json.sp.d.Folders.results` (tolerant of a
     future nometadata switch) mapping `ServerRelativeUrl→path`, `Name→name`,
     `Length(parseInt)→size`, `TimeLastModified→modified`, `UniqueId/ETag→etag`;
     `FOLDER_FEED_ROOTS` = `/sites/TeamBriggs20/Shared Documents/<root>` with
     `''`-doubled apostrophes. See `CLAUDECODE_PROMPT_PHASE2_Slice1b_list_rest.md`.
   - **Remaining:** copy the flow's trigger URL → `SHAREPOINT_LIST_URL` env (Railway);
     ship the Slice-1b worker map; GET dry-run the `folder-feed-tick` endpoint to
     confirm the cron goes live.
3. **Claude Code: `folder-feed-tick` worker + `folder_feed_seen` table (DB-only)
   + filename/type classifier + the path→`subject_hint` matcher hook + the
   `[LCC]`/`source='lcc_generated'` provenance tag.** Prompt ready to write on
   request now that the conventions are locked.
4. **Local backfill pass** for the legacy tree (one-time, via the synced folder;
   no API limits) — then the PA cron maintains steady-state on new files.

## 10. Channel doctrine + roots (grounded live 2026-06-10) — Scott's design
The tree splits into **two channels with different downstream semantics**. The
"don't move files" rule holds for BOTH — the feed is DB-only tracking and never
writes into the team tree (§6); the difference is what the *database* does with
each file.

### 10.1 Channel A — INGEST (on-market / external)
The **`On Market`** folders are the active intake channel: extract → match →
promote → **propagate** (may create/update property records). Grounded roots:
- `Gv't Leased Research/On Market` (gov) — 32 OMs + 5 leases (mostly under `OLD/`).
- `Dialysis Research/Comps/On Market` (dia) — 58 OMs + 2 leases (under
  `_added or updated in comps spreadsheet/`). **Asymmetry kept, not reorganized:**
  gov's is top-level, dia's nests under `Comps/`. Point at both as-is.
- `Storage OM's` (flat legacy dump) — **one-time local backfill source, NOT a
  steady-state root.** Drain once via the local script, then leave it out of
  `FOLDER_FEED_ROOTS`.
- `Single-Tenant Market`, the other `*/Comps/On Market` — candidates for later.

`FOLDER_FEED_ROOTS` (steady-state, the `*/30` cron) = the two On Market folders.

### 10.2 Channel B — PROPERTIES as a bidirectionally-connected workspace
Scott (2026-06-10): *"Ingest and enrich our database now. Also … how to structure
our future master sheet, BOVs, OMs, client memos and other documents we will
create and work on in these folders. We will want these places completely
connected to our database as well as enriching the data we have on conversations
and interactions with clients along with what's in our email, Salesforce notes,
conversation notes, LLC, etc."*

So PROPERTIES is **not** read-only — it is a living, two-way surface:

**(a) Read path — ingest+enrich, dup-safe.** PROPERTIES files
(`PROPERTIES/<bucket>/<tenant>/<city, st>/…`) extract → match. **The path is the
match key**: bucket+tenant+city/state resolves to an *existing* property at very
high confidence, so the default outcome is **enrich the existing record** (fill
blanks, attach the doc, write provenance), not create. The promoter runs in an
**enrich-bias mode** for this channel: a confident path-anchored match enriches;
anything unresolved routes to the **`match_disambiguation` decision lane (R8)**
for Scott's judgment — **never a silent new record.** (This is the safety
reconciliation for "ingest now" — the path anchor makes enrichment, not
creation, the norm.)

**(b) Write-back path — our generated work lands here, fully linked.** Master
sheets, BOVs, OMs, client memos that LCC generates for a property are written
**into that property's own folder** (the §6 "outputs to existing deliverable
folders" convention), tagged `[LCC]` + a `property_documents` row
(`source='lcc_generated'`, high trust) linking the file ↔ the property record.
Re-ingestion recognizes them as our own authoritative work, not a third-party
doc. This makes the folder and the DB a single connected object: open the folder
→ see the live work product; query the property → see every doc, with provenance.

**(c) Context links — the enrichment that isn't in the documents.** Each property
+ its docs link into the broader **context layer** (intelligence-hub Layer 3/4):
client conversations & interactions, email threads, Salesforce notes, conversation
notes, LLC/ownership research. The property folder becomes the physical anchor;
the DB holds the relationships so any tool (LCC, Copilot, Claude, ChatGPT) sees
the same connected picture. This is where folder-feed meets the shared-context
service — sequence it as **Slice 3** (after the PROPERTIES read/write paths in
Slice 2).

### 10.3 Sequencing
- **Slice 1c (now):** `max_stage` cap → controlled first real drain of 1–2 OMs
  on gov On Market. (`CLAUDECODE_PROMPT_PHASE2_Slice1c_max_stage.md`.)
- **Slice 1 steady-state:** `FOLDER_FEED_ROOTS` = the two On Market folders; cron
  drains Channel A.
- **Slice 2:** PROPERTIES read path (enrich-bias promoter mode + path-anchor
  match + disambiguation routing) **and** the write-back/`property_documents`
  linkage for generated docs.
- **Slice 3:** context-layer links (email / SF notes / conversation notes / LLC)
  — the shared-context service.
- **Backfill:** one-time local pass over `Storage OM's` + the legacy On Market
  subfolders (`OLD/`, `_added or updated …/`) via the synced disk, no API limits.
