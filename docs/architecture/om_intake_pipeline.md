# OM Intake Pipeline — Canonical Reference

> Last updated: 2026-04-25 (post data-quality-foundation session).
> Supersedes the older `outlook_intake_team_visibility_workflow.md` which described an earlier batch-mode design.

## What this document is

A single reference for how Offering Memorandum (OM) PDFs flow into the Life Command Center, regardless of which channel they arrive through. Three channels exist today; all three converge on the same shared pipeline (`api/_shared/intake-om-pipeline.js::stageOmIntake`) which produces the same `staged_intake_items` row, fires the same extractor → matcher → promoter chain, and now records field-level provenance.

## The three channels

| Channel | Trigger | Endpoint | Channel id (in code) |
| --- | --- | --- | --- |
| **Email** | Power Automate flagged-email V3 trigger on `Inbox/LCC Intake` | `POST /api/intake?_route=outlook-message` | `email` |
| **Sidebar (CoStar / Chrome extension)** | Browser extension capture | Sidebar pipeline writes directly via `api/_handlers/sidebar-pipeline.js::propagateToDomainDbDirect` (does NOT go through stageOmIntake) | n/a — see note |
| **Copilot Studio agent** | Copilot Studio invokes the connector action | `POST /api/intake/stage-om` (rewritten to `/api/intake?_route=copilot-action&_preset_action=intake.stage.om.v1`) | `copilot_chat`, `outlook`, or `teams` (caller declares) |

> **Sidebar caveat.** The CoStar sidebar's "OM upload" path runs through `sidebar-pipeline.js::propagateToDomainDbDirect`, which writes directly to domain DBs (properties, leases, available_listings, contacts, ownership_history) bypassing `stageOmIntake`. That's why the V2 Hondo OM corruption on 2026-04-25 wasn't caught by the email-path noise filters. The CoStar sidebar has its own writers and its own `isJunkTenant` filter (extended on 2026-04-25 to catch NAICS sector names + OM TOC headers). Long-term, the sidebar OM upload should ideally route through `stageOmIntake` for consistency, but that's not the case today.

## Channel 1: Email (Power Automate flagged-email)

### Trigger
Power Automate flow watching `Inbox/LCC Intake` folder. When a user flags an email there, the trigger fires.

### Flow steps (per the actual deployed flow `LCCFlaggedEmailINtake`)

1. **Apply_to_each over attachments** — for each attachment:
   1. POST to `/api/intake/prepare-upload` with `{file_name, mime_type}`. Returns a Supabase Storage signed URL + `storage_path`.
   2. PUT the attachment's bytes to the signed URL. **The bytes must be `base64ToBinary(contentBytes)`** — passing the raw `contentBytes` string corrupts the upload (Bug E, 2026-04-25, see `outlook_intake_pa_base64_fix.md`).
   3. Append `{file_name, mime_type, storage_path}` to a flow variable `AttachmentRefs`.
2. **POST to `/api/intake?_route=outlook-message`** with `{message_id, internet_message_id, subject, from, body_preview, received_date_time, web_link, has_attachments, attachments: AttachmentRefs}`.
3. **GET `/api/intake?_route=summary&correlation_id=<...>&limit=1`** for Teams notification text.
4. **Flag email (V2)** — set flag to `notFlagged` so the trigger won't re-fire. (Optional: it's idempotent because of the dedup logic below, but it keeps the inbox clean.)
5. **Move email (V2)** to `Inbox/LCC Processed`.
6. **Post adaptive card to Teams** with the summary.

### What `/api/intake?_route=outlook-message` does

`api/intake.js::handleOutlookMessage`:

1. **Authenticate** via `X-LCC-Key` header.
2. Build a deterministic `correlation_id = workspace_id + internet_message_id + received_at_iso` (sha1 first 12 chars + epoch ms).
3. **Dedup check** — query `inbox_items` for matching `metadata.correlation_id`. Power Automate's V3 trigger reliably fires the flow 2-6 times per flag event, so the dedup is essential.
   - If found AND `staging_started_at` claim is recent (< 60s): short-circuit, return `{deduplicated: true}`. (Bug F fix, 2026-04-25.)
   - If found AND `bridged_to_intake_id` is recorded: return that intake id, no re-stage.
   - Otherwise: stage afresh.
4. Insert `inbox_items` row with `source_type='flagged_email'`.
5. **PATCH `staging_started_at` claim** onto the inbox_items metadata BEFORE awaiting `stageOmIntake`. This is what makes the dedup race-safe.
6. Use **`pickPrimaryOmAttachment(attachments)`** to filter out signature graphics and pick the OM PDF. Falls through to body-URL scan when no OM-eligible attachment is found.
7. Call **`stageOmIntake(...)`** from `_shared/intake-om-pipeline.js`. This is the shared entry point all three channels use.
8. PATCH `bridged_to_intake_id` onto the flagged_email row so subsequent dedup hits short-circuit.

## Channel 2: Sidebar (CoStar / Chrome extension)

The Chrome sidebar's CoStar capture writes directly to domain DBs via `api/_handlers/sidebar-pipeline.js`. The OM-upload variant uses the same `prepare-upload` → PUT → `/api/intake?_route=outlook-message` (technically with `intake_channel='copilot_chat'`) when invoked through the connector path.

The sidebar's CoStar property-data capture (different from OM upload) goes through `propagateToDomainDbDirect`, which writes:
- `properties` (upsert)
- `available_listings` (upsert)
- `leases` (filtered by `isJunkTenant` — extended 2026-04-25)
- `contacts`, `brokers`, `recorded_owners`, `true_owners`, `ownership_history`
- `sales_transactions` (which fires `close_listing_on_sale` and `propagate_sale_to_property` triggers)

This path does NOT go through `stageOmIntake`, so it does NOT (yet) record field-level provenance. Phase 2.2 of the data-quality rollout will instrument it.

## Channel 3: Copilot Studio agent

### Action manifest
`copilot/actions/intake.stage.om.v1.yaml` — declares the action contract for Copilot Studio.

### Connector swagger
`copilot/lcc-deal-intelligence.connector.v1.swagger.json` — exposes `/api/intake/stage-om` to Copilot Studio.

### Vercel rewrite
`vercel.json` line 53: `/api/intake/stage-om` → `/api/intake?_route=copilot-action&_preset_action=intake.stage.om.v1`.

### Dispatch
`api/intake.js::handleCopilotAction` → `if (action_id === 'intake.stage.om.v1') handleIntakeStageOm({inputs, authContext, workspaceId})`.

### Handler
`api/_handlers/intake-stage-om.js` validates the Copilot input envelope, applies the signature-image filter, then delegates to `stageOmIntake` with `channel='copilot_chat'` (or whatever channel the caller declares: `copilot_chat | outlook | teams`).

### Limits
- Inline `bytes_base64` only, ≤25MB. The YAML manifest doesn't expose `storage_path` or `data_uri` parameters today, so OMs above 25MB cannot be ingested through Copilot.
- Underlying `stageOmIntake` does support `storage_path` and `data_uri` — to lift the 25MB cap for Copilot, expand the YAML schema to accept those alternative input shapes and update the connector swagger.

### Status
**Ready for testing as of 2026-04-25.** All wiring is in place: YAML manifest → swagger → vercel rewrite → dispatch → handler → shared pipeline. Same `field_provenance` recording as the email path.

## Shared pipeline: `stageOmIntake`

`api/_shared/intake-om-pipeline.js` — the canonical entry point all three channels converge on.

### Behavior

1. Validate the input. Accepts `bytes_base64`, `data_uri`, OR `storage_path`. The `data_uri` form is auto-decoded.
2. **Reject signature-image noise** — checks `mime_type` + filename pattern. Catches `image\d+.png`, `outlook-logo*`, `signature*`, and bare `<uuid>.png`.
3. Resolve / create the caller's `users` row (idempotent).
4. Ensure `workspace_memberships` exists (operator role).
5. Upsert `connector_accounts` row keyed on `workspace + user + connector_type + external_user_id`.
6. Insert `inbox_items` row with `source_type=<channel>_om` (e.g. `email_om`, `copilot_chat_om`).
7. Insert `staged_intake_items` + `staged_intake_artifacts` (the artifact carries either `inline_data` base64 or `storage_path`).
8. Race `processIntakeExtraction` against a 7-second timeout. Caller gets fast response; extraction continues async.
9. Log `activity_events` row for entity-scoped memory.
10. Return `{ok, intake_id, status, extraction_status, entity_match_status, matched_entity_id, message}`.

### Extractor → matcher → promoter

After `stageOmIntake` returns, the extraction race triggers:

- **`processIntakeExtraction`** in `api/_handlers/intake-extractor.js`:
  - Fetches artifact bytes (from `inline_data` base64 OR Supabase Storage via `storage_path`).
  - **`recoverIfBase64Wrapped`** — defensive recovery if a misbehaving uploader stored base64-text instead of binary (Bug G safety net, 2026-04-25).
  - Calls `pdf-parse` to extract text.
  - Sends text to AI provider (`invokeOpenAIResponses` / OpenAI Responses API).
  - Writes `staged_intake_extractions.extraction_snapshot` (32-field structured object: address, tenant, price, cap, lease terms, broker, etc.).
  - Calls `matchIntakeToProperty` (matcher).

- **`matchIntakeToProperty`** in `api/_handlers/intake-matcher.js`:
  - Normalizes address (`normalizeAddress`), strips entity suffixes (`normalizeCanonicalName`).
  - Searches dialysis or government domain DB for property by address/tenant.
  - Records `staged_intake_matches` with `decision`, `reason`, `confidence`, `property_id`, `domain`.
  - When `confidence >= 0.85` and document is OM/flyer/marketing_brochure, calls promoter.

- **`promoteIntakeToDomainListing`** in `api/_handlers/intake-promoter.js`:
  - Runs four parallel domain-DB writes:
    1. `promoteListing` — upsert `available_listings` (sets `intake_artifact_path`, `intake_artifact_type`, `price_per_sf` denormalized).
    2. `promoteBrokerContact` — split combined broker names (Bug H), insert one contact per broker.
    3. `promotePropertyFinancials` — fill blanks on `properties` (calls `promoteDiaPropertyFromOm` for dialysis: year_built, lot_sf, parcel_number, lease_commencement, anchor_rent).
    4. `promoteDiaLeaseFromOm` (dialysis only) — write the OM-derived lease row, deactivate genuinely-expired prior leases.
  - Then `promoteProspectLead` (gov), broker-FK back-link (`brokers` table, dialysis), `promoteLccEntity` (LCC bridge entity), `promoteUnifiedContact`, `resolveOwnerLinks`.
  - Logs `staged_intake_promotions` row with full pipeline_result blob.
  - **Records field-level provenance** via `recordOmFieldsProvenance` for each field written. Source = `om_extraction`, source_run_id = intake_id. (Phase 2.1, 2026-04-25, record-only mode.)

## Display surfaces

| Surface | File | Renders |
| --- | --- | --- |
| Inbox triage | `ops.js::inboxItemHTML` | Email subject, sender, body preview, "Open in Outlook" link, **"⚙ Staged · intake xxxxxxxx… · View match →" pill** when `bridged_to_intake_id` is set (2026-04-25) |
| Sales/Available list | `dialysis.js` (table at line 6480+) | listing rows with **OM PDF icon via `buildCollateralIcons`** reading `intake_artifact_path` + `intake_artifact_type` |
| Property detail Sales tab | `detail.js::_salesRenderListing` | listing card with **OM PDF icon** (added 2026-04-25) |
| Property detail other tabs | `detail.js` (Overview, Rent Roll, Operations, Ownership & CRM, Activity Log) | property + leases + contacts + activity_events |

## Data quality / provenance

The 2026-04-25 session shipped Phase 1 of the field-level provenance system:

- **`field_provenance`** (LCC Opps): every cross-table field write records source/confidence/run_id/decision.
- **`field_source_priority`** registry: ~40 seeded rows per the user's stated rules (county_records > om_extraction for address; OM/lease > CoStar for rent; etc.).
- **`lcc_merge_field()`** SQL function: write/skip/conflict decision, supersedes prior winners, flags same-priority disagreements.

See `docs/architecture/data_quality_self_learning_loop.md` for the full Phase 1-4 rollout plan.

The OM intake promoter is the first writer instrumented (Phase 2.1). All other ingestion paths (CoStar sidebar, CMS sync, county sync, manual edits, Salesforce) need their own Phase 2.x instrumentation before `enforce_mode` can be flipped from `record_only`.

## Active issues / known gaps

- **CoStar sidebar bypass.** The sidebar's CoStar property capture writes directly to domain DBs without going through `stageOmIntake`. So sidebar-driven changes don't yet record field provenance. (Phase 2.2 work.)
- **Copilot OM size cap.** 25MB inline-only via the YAML manifest. Larger OMs need the storage_path path exposed in the manifest.
- **Junk-value filtering is per-source.** The merge function consults source priority, but it doesn't validate the *value*. NAICS sector names, OM TOC headers, etc. need value validators alongside source priority. The `isJunkTenant` filter in `sidebar-pipeline.js::upsertDomainLeases` is the pattern; extend per-field as needed.
- **`buildCollateralIcons` defined globally in app.js** but only used in dialysis.js, gov.js, and now detail.js. If you add new render paths that should expose the OM PDF icon, follow the same pattern (look at `dialysis.js` line 6571 for canonical usage).

## Related docs

- `docs/architecture/data_quality_self_learning_loop.md` — Phase 1-4 rollout plan for field-level provenance.
- `docs/architecture/outlook_intake_pa_base64_fix.md` — the `base64ToBinary` PA upload fix.
- `docs/architecture/copilot_action_registry.md` — Copilot action inventory (note: doesn't currently list `intake.stage.om.v1`, should be added).
- `supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql` — provenance tables + merge function.
- `.github/AI_INSTRUCTIONS.md` — overall LCC architecture rules (12-function Vercel cap, sub-route pattern).
