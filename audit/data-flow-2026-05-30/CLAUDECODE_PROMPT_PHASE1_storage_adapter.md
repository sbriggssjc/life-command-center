# Claude Code prompt — Phase 1: company-storage adapter (SharePoint, Graph-free)

Context: see `ARCHITECTURE_intelligence_hub.md` (same folder). Phase 1 is the
storage on-ramp: get large intake artifacts OUT of personal Supabase storage
(the auth-DB nearly hit the read-only lockout 2026-06-08) and into the company's
**Microsoft SharePoint** — the **Team Briggs Documents** library the team
already lives in — while keeping the DB lean (references + extracted data only).
Also the foundation for the Phase-2 folder-feed.

## Grounded target (confirmed from the team's "Export to Excel" .iqy)

- **Site:** `https://northmarq.sharepoint.com/sites/TeamBriggs20`
- **Library:** Shared Documents ("Team Briggs - Documents"), list GUID
  `996f9e8b-7d99-457a-a762-afa66303a36d`
- **Synced locally** at `C:\Users\scott\NorthMarq Capital, LLC\Team Briggs - Documents`
  (also under `OneDrive - NorthMarq Capital, LLC\…`). Top level includes
  `PROPERTIES`, `Storage OM's`, `Lease Comps`, `Sales Comps`, `Memos`,
  `Templates`, and per-vertical research folders.

## Access reality — DO NOT depend on Microsoft Graph

Graph app-registration has been troublesome historically — **do not make Graph
the integration path.** Two Graph-free routes, in order of preference:

1. **Power Automate SharePoint connector (primary for cloud LCC).** PA already
   bridges M365 ↔ LCC (the email-intake flows) and handles file bytes
   (`contentBytes`/`base64ToBinary`). A new HTTP-triggered PA flow saves an
   artifact into the SharePoint library and returns its server-relative URL /
   item id — the exact inverse of the email-intake flow. This needs no custom
   Graph app registration. **This is the cloud write/read path.**
2. **Local synced folder (for local agents + bulk reads / Phase 2).** The
   library is on disk via the OneDrive sync client, so anything running on
   Scott's machine (Cowork/Claude, a local script, Power Automate Desktop) reads
   it directly with zero API. Not usable by cloud LCC (Railway/Supabase Edge
   can't see a local path) — reserve it for local processing and the Phase-2
   folder-feed.

## Goal

Add a **pluggable storage backend** so big OM/Excel artifacts are stored in the
SharePoint library via Power Automate instead of the Supabase `lcc-om-uploads`
bucket. The DB keeps only a reference + extracted data — never `inline_data`.

## Design requirements

1. **Interface, not a fork.** Storage-adapter interface
   (`putObject(path,bytes,contentType) -> {backend, ref, url}`,
   `getObject(ref) -> bytes`, `exists(ref)`). Implement `supabase` (current
   behavior, refactored behind the interface) and `sharepoint_pa`. Ingest +
   extractor + download paths call the interface, never a backend directly.
   Reuse `api/_shared/artifact-storage.js` path-builder if present.
2. **`sharepoint_pa.putObject`** POSTs the file (base64) + a deterministic
   relative path to a new PA HTTP flow **"LCC → SharePoint: Save Artifact"**,
   which uses the SharePoint "Create file" action to write under a designated
   intake folder in the Team Briggs library (e.g. `Storage OM's/Intake/<path>`)
   and returns `{server_relative_url, item_id}`. Record that as the artifact's
   `storage_backend` + `storage_ref` (+ url). **This PA flow is a dependency** —
   spec its contract in the prompt (trigger body `{path, content_base64,
   content_type}`; response `{ok, server_relative_url, item_id}`), mirroring the
   email-intake flow. Scott (or the operator) builds it in PA; do not assume it
   exists — feature-flag the backend so it no-ops to `supabase` until the flow
   is live (the `find_contacts_by_account` rollout pattern).
3. **Reference, not blob, in the DB.** Add `storage_backend` + `storage_ref`
   (keep `storage_path` for back-compat); `inline_data` stays null for
   adapter-stored files. Extractor + download resolve bytes via the adapter.
4. **Hot-path rule.** Store the raw file once at ingest, extract once; never
   re-fetch a multi-MB blob synchronously. The PA round-trip is async/queued
   (the edge-offload pattern is the model), off the request critical path. Mind
   PA/SharePoint file-size limits (OMs ~5-20 MB are fine; guard >~45 MB).
5. **Auth + security.** No Graph app registration. PA authenticates to
   SharePoint with the existing M365 connection; the HTTP trigger is secured
   (SAS/key) the same way the email-intake flow is. Least-privilege: the flow
   writes only to the designated intake folder.
6. **Cutover safety.** Config flag `STORAGE_BACKEND = supabase | sharepoint_pa`,
   default `supabase`. New writes go to the selected backend; reads try the
   recorded backend, fall back to Supabase for already-stored files. No bulk
   migration of existing files — the offload cron keeps draining the Supabase
   backlog; new files land in SharePoint once flipped.

## Verify + ship
- With the PA flow live + `STORAGE_BACKEND=sharepoint_pa`: a synthetic large OM
  ingests → lands in the Team Briggs library (visible in `Storage OM's/Intake`)
  → `inline_data` null, `storage_ref`/url set → extractor reads it back →
  extraction succeeds → download/view resolves it.
- With `STORAGE_BACKEND=supabase`: byte-identical to today (no regression).
- House rules: `node --check`; 12 functions; idempotent; effect-first; secrets
  via vault/env; report per-requirement. Ships on the Railway redeploy; the
  config flip + the PA flow are the cutover.

## Out of scope (later phases)
Reading the property folders (Phase 2 folder-feed) · correspondence/notes
enrichment (Phase 3) · the shared context service + standards syndication
(Phases 4-5). This prompt is ONLY the SharePoint storage backend for the ingest
path. (The local synced folder is noted for Phase 2, not used here.)
