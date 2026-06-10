# Claude Code — Phase 2 Slice 2a: PROPERTIES enrich-read channel

## Goal
Make the **PROPERTIES** tree a SECOND folder-feed channel with **enrich-only**
semantics: extract → match to an EXISTING property via the path anchor → enhance
that record (fill blanks, attach the doc, write provenance). It must **never**
create a new property and **never** silently overwrite curated data; anything it
can't resolve goes to the existing `match_disambiguation` decision lane (R8). This
is the safety reconciliation that lets us "ingest + enrich PROPERTIES now"
(Scott, 2026-06-10, ARCH §10.2) without minting duplicates from our own
portfolio files.

Background: the On Market channel (Slice 1) is the INGEST path (may create/update
— full promoter). PROPERTIES is the ENRICH path. Same extract→match machinery,
different write policy. The folder-feed is DB-only tracking; it never writes into
the SharePoint tree (unchanged).

## Unit 1 — per-channel mode on the worker (`api/_handlers/folder-feed.js`)
- Add a second roots config **`FOLDER_FEED_ENRICH_ROOTS`** (env, comma-separated,
  full server-relative paths with single apostrophes) for enrich-mode roots.
  Default: `/sites/TeamBriggs20/Shared Documents/PROPERTIES`. Keep
  `FOLDER_FEED_ROOTS`/`DEFAULT_ROOTS` as the INGEST roots (On Market) — Slice 1d.
- The walk processes both sets in one tick but tags each file with its
  **`mode`** (`'ingest'` | `'enrich'`) based on which root it descended from
  (carry the mode down the BFS queue alongside the path). A `?folders=` override
  keeps the caller's explicit mode via a new optional `&mode=enrich|ingest`
  (default `ingest`) so dry-runs/manual drains can target either.
- Pass `mode` into the stage payload `seed_data.mode` (alongside `subject_hint`,
  `source_path`). Record it on `folder_feed_seen` too (add a `mode text` column,
  additive migration, default `'ingest'`).
- **Bound PROPERTIES hard.** It's a deep, ~27-bucket tree. The per-tick
  `limit_folders` + 22s budget already bound it, but enrich roots should get
  their own small `enrich_limit_folders` (default 4) so an enrich pass never
  starves the ingest channel in a shared tick. Walk ingest roots FIRST, then
  enrich roots with the remaining budget.

## Unit 2 — enrich-only promotion (`api/_shared/intake-om-pipeline.js` +
##         `api/_handlers/intake-promoter.js`, locate the create-vs-match branch)
When `seed_data.mode === 'enrich'`, the promoter path must:
1. **Require an existing match.** Use the path `subject_hint` (tenant_brand +
   city/state from `PROPERTIES/<bucket>/<tenant>/<City, ST>`) as a high-confidence
   pre-filter into the existing 4-tier matcher. Resolve to an existing
   `properties` row only.
2. **On confident match → ENRICH, fill-blanks only.** Patch only NULL/empty
   fields on the matched property from the extraction snapshot (never clobber a
   populated curated value — same conservative rule as the OM promoter's
   tenant back-write). Attach the doc as a `property_documents` row
   (`source='folder_feed_enrich'`, the server-relative path, doc_type from the
   classifier). Write `field_provenance` for every field touched
   (`source='folder_feed_properties'`, confidence ~0.7). Record the enrich
   outcome on the intake (`extraction_result.enrich_ok`, fields_filled count).
3. **On no/low-confidence match → DISAMBIGUATION, never create.** Emit a
   `match_disambiguation` decision (the R8 producer pattern — idempotent on the
   intake) instead of creating a property. The enrich channel has **no
   create path at all**; creating from PROPERTIES is out of scope by design.
4. **Never write to `sales_transactions` / listings from the enrich channel** —
   PROPERTIES files describe properties we already hold, not new market events.
   Enrichment is limited to the property record + document attachment + provenance.

Implement the mode as an explicit option threaded from `stageOmIntake` →
extractor → promoter (e.g. `promoteMode: 'ingest'|'enrich'`), defaulting to
`'ingest'` so every existing channel (email, On Market, sidebar) is unchanged.

## Unit 3 — folder_feed_seen status for enrich
Reuse the existing lifecycle, but an enrich file that resolved + enriched records
`status='staged'` with the intake_id (the intake carries `enrich_ok`); an
unresolved one still records `status='staged'` (it produced a disambiguation
decision — that IS its handled outcome), NOT `error`. Keep `skipped` for non-OM
types as today.

## Safety / rollout (matches how Slice 1 was rolled out)
- Ships behind the env: with `FOLDER_FEED_ENRICH_ROOTS` unset, the enrich channel
  is inert — zero behavior change (the find_contacts/Slice-1 pattern).
- The cron stays pointed at ingest roots only until Scott + Claude/Cowork run a
  **capped dry-run then a capped real drain** on ONE PROPERTIES property folder
  (e.g. a single `PROPERTIES/<letter>/<tenant>/<City, ST>`) and confirm it
  ENRICHED an existing record (no new property, fill-blanks only, provenance
  written) — same first-drain discipline as On Market. Only then do we add the
  enrich roots to the cron.

## Tests / house rules
- Unit test the mode threading: a `mode='enrich'` stage with a snapshot that
  matches an existing property fills only blank fields + attaches the doc + writes
  provenance, and creates NO new property; a non-matching `mode='enrich'` stage
  emits a disambiguation decision and creates NO property. An `mode='ingest'`
  stage is byte-identical to today.
- `node --check`; ≤12 `api/*.js` (handler + shared modules only); 2 additive
  migrations (folder_feed_seen `mode`; any provenance source-priority row needed
  for `folder_feed_properties`). Ships on Railway redeploy.

## OUT OF SCOPE (later slices — design in ARCH §10.2)
- **Slice 2b — write-back:** LCC-generated master sheets / BOVs / OMs / memos
  written INTO the property's folder, `[LCC]`-tagged + `property_documents`
  (`source='lcc_generated'`). Needs a SharePoint "upload file" PA flow + the
  re-ingest provenance rule. Separate prompt.
- **Slice 3 — context layer:** link property + docs to email / SF notes /
  conversation notes / LLC research (the shared-context service). Separate prompt.
