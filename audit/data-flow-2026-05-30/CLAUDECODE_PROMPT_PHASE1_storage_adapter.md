# Claude Code prompt — Phase 1: company-storage adapter for OM ingestion

Context: see `ARCHITECTURE_intelligence_hub.md` (same folder) for the full
vision. This is Phase 1 — the storage on-ramp. It solves the recurring Supabase
disk-pressure problem (the auth-DB nearly hit the read-only lockout on
2026-06-08) by moving large intake artifacts OUT of personal Supabase storage
and into the company's paid file platform, while keeping the DB lean (references
+ extracted data only). It is also the foundation for the Phase-2 folder-feed.

## Goal

Add a **pluggable storage backend** to the OM/large-artifact ingest path so big
files (PDFs, Excel) are written to **company storage** instead of the Supabase
`lcc-om-uploads` bucket. The DB keeps only a `storage_path`/reference + the
extracted text/structured data — never `inline_data`.

## Platform decision (Scott to confirm before build)

Two candidate backends — pick ONE canonical store:
- **OneDrive / SharePoint via Microsoft Graph** — *recommended default*. You're
  already deep in Microsoft 365 + Power Automate (the email-intake channel runs
  through it), so Graph auth + file ops are the lower-friction path, and it sets
  up the Phase-2 folder-feed against the same store your team already uses.
- **Citrix ShareFile API** — if ShareFile is where the *authoritative* team
  files live and OneDrive isn't.

Build the adapter behind an interface so the backend is config-selectable
(`STORAGE_BACKEND = supabase | graph | sharefile`), defaulting to `supabase`
until the new backend is verified — so this ships dark and cuts over by config.

## Design requirements

1. **Interface, not a fork.** Define a small storage-adapter interface
   (`putObject(path, bytes, contentType) -> {storage_ref}`,
   `getObject(storage_ref) -> bytes`, `exists(storage_ref)`). Implement
   `supabase` (the current behavior, refactored behind the interface) and the
   chosen company backend. The ingest + extractor + download paths call the
   interface, never a specific backend. Mirror the existing
   `api/_shared/artifact-storage.js` shape if present.
2. **Reference, not blob, in the DB.** `staged_intake_artifacts.storage_path`
   (or a new `storage_backend` + `storage_ref` pair) records WHERE the file
   lives; `inline_data` stays null for adapter-stored files. The extractor and
   the download handler resolve bytes via the adapter from the ref.
3. **Hot-path rule.** Store the raw file once at ingest, extract once, and never
   make the extraction hot path re-fetch a multi-MB blob synchronously. If the
   backend is slow/rate-limited (external SaaS), the upload is async/queued
   (the existing edge-offload pattern is the model), not on the request's
   critical path.
4. **Auth + security.** OAuth app registration with token refresh (Graph: an
   app registration with `Files.ReadWrite.All` or a scoped site/drive;
   ShareFile: an OAuth client). Least-privilege: a dedicated service identity
   scoped to the ingestion area only — the brain must not read what a given
   team member shouldn't. Store secrets in the existing vault/env pattern, never
   in code.
5. **Deterministic paths.** Keep a deterministic object path per artifact (the
   existing `artifact-storage.js` path builder) so re-ingest/re-tick is
   idempotent and a file is findable by convention.
6. **Cutover safety.** Keep Supabase as fallback during cutover: new writes go
   to the company backend; reads try the recorded backend first, fall back to
   the Supabase bucket for already-stored files. No big-bang migration of
   existing files required — the existing offload cron continues draining the
   Supabase backlog; new files just land in the company store.

## Verify + ship

- Dry-run: a synthetic large OM ingests → lands in the company store →
  `inline_data` null, `storage_path` set → the extractor reads it back via the
  adapter → extraction succeeds.
- The download/view path resolves a company-stored artifact.
- Backend is config-flippable; with `STORAGE_BACKEND=supabase` behavior is
  byte-identical to today (no regression).
- Secrets via vault/env; least-privilege identity confirmed.
- House rules: `node --check`; 12 functions; idempotent; effect-first; report
  per-requirement status. Ships on the Railway redeploy; the config flip is the
  cutover.

## Out of scope (later phases)
- Reading existing property folders (Phase 2 folder-feed).
- Correspondence/notes enrichment (Phase 3).
- The shared context service + standards syndication (Phases 4–5).
This prompt is ONLY the storage backend swap for the ingest path.
