# LCC ⇄ Copilot Bidirectional Unification Plan
_Draft — 2026-04-21_

## 1. What actually broke in the 04-20 test

The transcript (`botContent (4).zip/dialog.json`) shows the PDF arrived inline as a `data:application/octet-stream;base64,...` URL on `Activity.Attachments[0].contentUrl`, followed by a bot response of `Sorry, something went wrong. Error code: SystemError.`

Three independent failures compounded:

### 1.1 The Copilot handler writes to a non-existent table
`api/_handlers/intake-stage-om.js:177` issues `POST inbox_item_artifacts` on LCC Opps. There is no `inbox_item_artifacts` table in `schema/` — the email intake path writes artifacts to `staged_intake_artifacts` on `dialysis_db`. So the second insert always 500s, the rollback at line 189 deletes the inbox_item, and the whole call fails.

### 1.2 The handler hard-requires a `domain` that Copilot cannot know
`intake-stage-om.js:114-128` returns `400 missing_or_invalid_domain` unless `inputs.seed_data.domain` is one of `dialysis | government | netlease`. The GPT prompt in `botContent.yml:197-208` forbids extraction ("Do NOT summarize, extract, parse, or match"), and the OpenAPI schema never exposed a `seed_data.domain` field, so the domain is structurally unsatisfiable. The existing `intake-extractor.js → om-parser.js → intake-matcher.js` pipeline already classifies the OM from its text content — the gate should never have existed.

### 1.3 The GPT prompt asks the model to invent identifiers
The prompt instructs the model to extract a "file id (a GUID like c9631355-…)" and to synthesize `storage_path: "m365-chat://" + file_id + "/" + file_name`. The PVA test harness ships the attachment inline as a base64 data URI — there is no GUID and no storage locus. Even in real M365 Copilot Chat with a custom agent, the attachment is either a Graph drive-item URL or a SharePoint path, not a bare GUID. The model hallucinates, either bombs at validation time or the handler rejects the unresolvable path — the user sees `SystemError`.

## 2. What's already in place that we should reuse

| Need | Existing asset | Location |
|---|---|---|
| OM PDF intake pipeline | `staged_intake_items` + `staged_intake_artifacts` with `inline_data` (base64) | dialysis_db, wired in `api/intake.js:319-413` for email intake |
| OM text extraction | `intake-extractor.js` → `om-parser.js` | classifies domain from content, produces `staged_intake_extractions` |
| Property matching | `intake-matcher.js` | runs automatically after extraction succeeds |
| Canonical timeline | `activity_events` table | `schema/004_operations.sql:129` — immutable, entity-keyed, category enum already includes `note/email/call/meeting/status_change/sync/system` |
| Inbox/triage | `inbox_items` | `schema/004_operations.sql:26` — already keyed to `entities.id`, has `metadata` jsonb, supports `domain` nullable |
| Context packet cache | `context_packets` + `context-broker` edge fn | `schema/020_context_packets.sql`, `supabase/functions/context-broker/index.ts:768 lines` — assembles contact/property/deal packets with TTL |
| Signal stream | `signals`, `contact_engagement`, `outreach_effectiveness` | `schema/019_signal_tables.sql` |
| Entity resolution | `entities` + `entity_aliases` + `external_identities` | `schema/003_canonical_entities.sql` |

**Key insight:** the "entity-scoped memory" you asked for doesn't need a new schema. `activity_events` is already the canonical timeline and every write action should be logging to it. What's missing is (a) consistent write-back from Copilot actions, and (b) a first-class retrieval action that surfaces the timeline to the agent.

## 3. File-by-file change list

### Stage A — Fix OM intake (blocks everything else)

| # | File | Change |
|---|---|---|
| A-1 | `copilot/actions/intake.stage.om.v1.yaml` | Remove implicit `domain` need. Add required `artifacts.primary_document.bytes_base64: string`. Drop `storage_path` from required fields (keep optional). Remove `seed_data.domain` assumption. |
| A-2 | `copilot/openapi.yaml` | Mirror A-1. Add `bytes_base64` to `IntakeStageOmInputs.artifacts.primary_document`. Remove `upload_url`/`upload_method`/`upload_expires_at` from `IntakeStageOmResponse` (single-shot ingestion — no presigned URL dance). Add `intake_id`, `domain`, `entity_match_status` to the response so the bot can report back. |
| A-3 | `api/_handlers/intake-stage-om.js` | Rewrite end-to-end. (a) Drop the `VALID_DOMAINS` gate. (b) After creating `inbox_items`, bridge to `staged_intake_items` + `staged_intake_artifacts` on dialysis_db the same way `api/intake.js:319-413` does for email, passing `inline_data` = `bytes_base64`. (c) Kick off `processIntakeExtraction(intake_id)` with a race timeout so Copilot gets a response inside 8s. (d) Remove the `inbox_item_artifacts` write entirely. (e) Append an `activity_events` row with `category='system'`, `source_type='copilot_om'`, linked to the inbox_item. |
| A-4 | `api/_handlers/intake-finalize-om.js` | Make idempotent — if inline bytes were supplied in stage, finalize is a no-op that just reports the current extractor status. Remove the `inbox_item_artifacts` query at line 31. |
| A-5 | `api/intake.js` (copilot-action gateway, line 1263-1323) | Surface a richer error envelope (`error`, `detail`, `hint`) so a 400/500 doesn't become `SystemError` in the Copilot UI. Stop returning `detail: err?.message` in prod — return a user-safe string and log the real one. |

### Stage B — Rebuild the Copilot Studio OM topic

| # | File | Change |
|---|---|---|
| B-1 | `botContent.yml` (GPT instructions) | Strip the "Extract the chat attachment's file id..." and "storage_path: m365-chat://..." block at lines 197-208. Replace with: _"When a PDF or OM is attached, the 'Receive OM' topic will handle ingestion deterministically — you do not need to call any intake action yourself."_ |
| B-2 | `botContent.yml` (new topic) | Add a `DialogComponent` with `kind: OnAttachmentReceived` (or the PVA equivalent trigger) named `Receive OM`. Steps: (i) read `System.Activity.Attachments[0]`, (ii) if `contentUrl` is a `data:` URI, strip prefix and pass through as `bytes_base64`; if it's an https URL, call the OneDrive connector "Get file content from URL" to get bytes, then base64-encode; (iii) call `intake.stage.om.v1` with `intake_source=copilot`, `intake_channel=copilot_chat`, `artifacts.primary_document.{file_name, bytes_base64}`, plus `copilot_metadata.conversation_id/run_id`; (iv) SendActivity reporting `staged_intake_item_id`, extractor status, and whether a property match was found. |
| B-3 | `botContent.yml` (connector reference) | Confirm `shared_onedriveforbusiness` is available (already at line 2173). No new connection needed. |

### Stage C — Entity-scoped memory (uses existing `activity_events`)

| # | File | Change |
|---|---|---|
| C-1 | `supabase/migrations/20260421_copilot_interaction_activity.sql` | Add enum values to `activity_category`: `copilot_turn`, `copilot_action`. (Postgres `ALTER TYPE ... ADD VALUE`.) Add index `idx_activities_copilot on activity_events(workspace_id, entity_id, occurred_at desc) where category in ('copilot_turn','copilot_action')`. |
| C-2 | `api/_shared/memory.js` (new) | Helper `logCopilotInteraction({workspaceId, actorId, entityId, actionId, summary, turnText, channel, metadata})` → writes an `activity_events` row with `category='copilot_action'`, `source_type='copilot'`, `metadata={channel, action_id, ...}`. Return the row id. |
| C-3 | All write-action handlers (see §4) | After success, call `logCopilotInteraction` keyed to whichever `entity_id` the action touched. Degrade silently if no entity. |
| C-4 | `supabase/functions/context-broker/index.ts` | Extend the `contact` and `property` packet assembly paths to include `recent_interactions: activity_events[]` — top 20 rows for the entity within the last 180 days, ordered `occurred_at desc`. TTL already 24h for contact, 4h for property. |
| C-5 | `api/operations.js` (or new `api/_handlers/retrieve-context.js`) | New endpoint `POST /api/copilot/action` with `action_id=context.retrieve.entity.v1`. Inputs: `entity_id` OR `entity_name` + optional `entity_type`. Output: context packet (using context-broker) plus `recent_interactions`, `open_action_items`, `last_touchpoint_at`, `active_listings`, `pipeline_stage`. |
| C-6 | `copilot/actions/context.retrieve.entity.v1.yaml` (new) | Action manifest matching C-5. |
| C-7 | `copilot/openapi.yaml` | Add the new operation. |
| C-8 | `botContent.yml` | Add a DialogComponent `RetrieveEntityContext` wired to the new operation, with a `modelDescription` that tells the GPT: _"Call this at the start of any conversation that mentions a specific contact, property, or deal so you have full memory of prior interactions. Always call before drafting emails or making recommendations."_ |

### Stage D — Write-action audit (bidirectional correctness)

For each of these, verify: (a) connector input schema matches handler body, (b) authContext flows through, (c) response includes `entity_id_touched` so C-3 can log memory, (d) errors return structured `{error, detail, hint}` not bare strings.

| Action | Handler | Main concern |
|---|---|---|
| DraftOutreachEmail | `ops.js` (search `draft_outreach`) | Confirm response carries `entity_id` so memory logging knows the contact. |
| DraftSellerUpdateEmail | `ops.js` | Same. |
| GenerateDocument | `api/_handlers/cap-rate-recalc-handler.js` + templates | Verify action log includes property/entity id. |
| CreateTodoTask | `operations.js` | Link to entity when possible; write `action_items` row with `entity_id` set. |
| TriageInboxItem | `api/_handlers/intake-matcher.js` or `operations.js` | Confirm item + entity both captured in activity log. |
| UpdateExecutionTaskStatus | `operations.js` | Log status transitions as `activity_events` with category `status_change`. |
| IntakeStageOm | A-3 above | Log with `category='copilot_action'`, `source_type='copilot_om'`. |

### Stage E — New high-leverage actions (propose, don't build all at once)

| Action | Why | Scope |
|---|---|---|
| `context.retrieve.entity.v1` | See C-5. Most valuable of the set — this is the "memory" action. | Implement in Stage C. |
| `memory.log.turn.v1` | Explicit write: agent can log a conversational turn it deems important ("Scott said he prefers to see dialysis first"). | Small. ~40 LOC. |
| `document.attach.to_entity.v1` | Link an uploaded file to a property/contact (separate from OM intake). | Medium — needs storage + metadata row. |
| `bov.generate.from_intake.v1` | Once an OM is extracted + matched, trigger the BOV workbook pipeline directly. | Leverage existing `briefing-email-handler` + `template-service`. |
| `entity.resolve.ambiguous.v1` | "Who is Greg at Davita?" → fuzzy match on `entity_aliases`, return top-k with disambiguation prompts. | Small — reuses existing entity resolution. |
| `salesforce.sync.contact.v1` | Bidirectional push so Copilot edits land back in SF. | Large — defer. |

## 4. Implementation sequence

1. **Stage A** (OM intake handler rewrite + response shape). Deployable as a standalone PR. Unblocks the actual test case.
2. **Stage B** (bot topic rebuild). Depends on A's response schema. Publish via Copilot Studio after API deploy.
3. **Stage C-1 → C-2** (enum migration + memory helper). Required before C-3.
4. **Stage C-3** (write-back in handlers). Ship incrementally — one action at a time.
5. **Stage C-4 → C-8** (retrieve context + packet extension + bot wiring). This is where "every interaction empowered by collective knowledge" becomes real.
6. **Stage D** (write-action audit). Surface-level fixes only; big behavior changes get their own rounds.
7. **Stage E** — pick one or two based on actual friction.

## 5. Test plan

- **A-end-to-end:** upload a known Northmarq OM PDF in PVA test. Expect `200 {ok:true, intake_id, domain:'<classified>', extraction_status:'review_required'}` within 10s. Confirm rows in `inbox_items`, `staged_intake_items`, `staged_intake_artifacts`, `staged_intake_extractions`, and an `activity_events` row.
- **B-end-to-end:** same test but via the agent UI. Confirm the topic fires, no `SystemError`, bot response includes staged_intake_item_id.
- **C-end-to-end:** upload OM → ask "Remind me what we know about [that property]" → agent calls `context.retrieve.entity.v1`, response includes the just-logged OM interaction plus prior emails/tasks/templates.
- **Regression:** existing email-intake path (api/intake.js line 319-413) must continue to work unchanged.

## 6. Open questions for Scott

1. Max acceptable inline OM size — Power Virtual Agents capped at 25MB attachments today; our current handler has `max_bytes: 50 MB`. OK to cap at 25MB for the inline path and add presigned-URL fallback in a future round?
2. For `context.retrieve.entity.v1`, what's the preferred default window — last 90 days of interactions, or last 20 interactions regardless of date?
3. Which new action from Stage E has the highest leverage right now — `bov.generate.from_intake.v1`, `memory.log.turn.v1`, or `entity.resolve.ambiguous.v1`?

## 7. What Scott has to do that Claude cannot

- Publish the Copilot Studio agent after `botContent.yml` is regenerated (requires logging into make.powerapps.com).
- Refresh the custom connector "LCC Deal Intelligence" in Power Platform with the updated OpenAPI spec.
- Run the Supabase migration(s) via Supabase Studio or the CLI.
- Verify the Vercel deploy picks up the new `api/_handlers/*` and `api/intake.js` edits (no new `.js` at `/api/` root — respects the 12-function cap per CLAUDE.md).
