# Copilot Studio — OM Intake Topic Rebuild
_2026-04-21 — paired with `docs/LCC_Copilot_Bidirectional_Plan_2026-04-21.md`_

This document is a drop-in guide for the LCC Deal Agent changes in Copilot
Studio. It replaces the GPT-prompt-driven OM ingestion with a dedicated
topic + the new custom connector operations.

## 1. Refresh the LCC Deal Intelligence custom connector

**Canonical spec (single source of truth):**
`copilot/lcc-deal-intelligence.connector.v1.swagger.json`

> Every prior openapi/swagger file in the repo has been archived to
> `docs/archive/openapi-legacy/`. Do NOT edit or import those — they are
> kept only for historical diff.

The canonical spec is **Swagger 2.0**, not OpenAPI 3.0, because the
existing LCC Deal Intelligence custom connector was originally registered
in Power Platform as 2.0 and **Power Platform will not allow an in-place
upgrade to 3.0**. Staying in 2.0 preserves the connector id and every
bot action that already references it.

It combines the original 38 operations (GetDailyBriefing, GetHotContacts,
SearchEntities, DraftOutreachEmail, etc.) with the 4 v1.1.0 additions
(`intakeStageOm`, `intakeFinalizeOm`, `contextRetrieveEntity`,
`memoryLogTurn`) for 42 operations total. 82 definition schemas. All
schema errors that Power Platform's validator was flagging (3 `const`
usages, 14 `type: array` missing `items`) are pre-fixed in this file.

To refresh the connector:

1. Regenerate if needed:
   ```
   python3 scripts/build_canonical_connector.py
   ```
   (Script reads the merged 3.0 archive and rebuilds the Swagger 2.0
   canonical file. Run any time the API spec changes.)
2. Open Power Platform → Custom Connectors → _LCC Deal Intelligence_.
3. Edit → **Swagger Editor**.
4. Paste the contents of
   `copilot/lcc-deal-intelligence.connector.v1.swagger.json` in full.
5. Click _Update connector_. Expect no validation errors.
6. Verify both the existing operations AND the 4 new ones appear under
   _Definition_:
   - `intakeStageOm` (POST `/api/intake/stage-om`)
   - `intakeFinalizeOm` (POST `/api/intake/finalize-om`)
   - `contextRetrieveEntity` (POST `/api/context/retrieve-entity`)
   - `memoryLogTurn` (POST `/api/memory/log-turn`)
7. Test with a known intake_id to confirm 200s.

If Power Platform ever reports a validation error again, run the build
script and re-paste. The script's final step validates the output for
`const` usages and `type: array` without `items` — the two error classes
that have bitten us before.

## 2. Replace the GPT instructions block

In Copilot Studio → LCC Deal Agent → _Settings → Instructions_, delete the
old "When provided with an Offering Memorandum…" paragraph (lines ~197-208
in the export). Replace the tail of the instructions with:

```
When a PDF, Offering Memorandum, or similar document is attached to a
message, the "Receive OM" topic handles ingestion automatically — you do
NOT need to call any intake action yourself. After the topic finishes,
continue the conversation using the returned intake_id and matched_entity_id
if present.

Before responding to any question that names a specific contact, property,
or company, call the "Retrieve Entity Context" action with entity_name
set to the name. Use the returned recent_interactions array as your memory
of prior conversations. If resolve_notes.ambiguous is true, ask Scott to
disambiguate before proceeding.

When Scott shares a preference, objection, insight, or commitment you want
to remember for the future ("pitch dialysis before government", "Greg at
Davita only buys in Texas"), call the "Log Conversational Memory" action
with a one-line summary, the relevant channel, and the most specific
entity_id you can resolve.
```

## 3. Add the "Receive OM" topic

In Copilot Studio → _Topics → + Create_:

- **Name:** `Receive OM`
- **Trigger:** `On message received` with condition
  `System.Activity.Attachments is not empty`
  AND `System.Activity.Attachments[0].ContentType starts with "application/"`

Topic body (Power Fx / node graph):

### 3.1 Variable initialization
```
Set bytesUri = System.Activity.Attachments[0].ContentUrl
Set fileName = Coalesce(System.Activity.Attachments[0].Name, "upload.pdf")
Set channel  = "copilot_chat"
```

### 3.2 Extract base64 bytes
If `bytesUri` starts with `data:`, strip the prefix:
```
Set bytesBase64 = If(
  StartsWith(bytesUri, "data:"),
  Last(Split(bytesUri, ","), 1),
  ""
)
```

If `bytesUri` does NOT start with `data:` (i.e., real Graph URL in production
M365 Copilot Chat), call the OneDrive for Business action
**Get file content from URL**, Content type = `application/octet-stream`,
URL = `bytesUri`. Then:
```
Set bytesBase64 = Base64(outputs of 'Get file content from URL')
```

### 3.3 Call Stage OM Intake
Invoke custom connector operation **intakeStageOm** with body:
```
{
  "intake_source": "copilot",
  "intake_channel": channel,
  "intent": Topic.UserMessageText,
  "artifacts": {
    "primary_document": {
      "bytes_base64": bytesBase64,
      "file_name":    fileName,
      "mime_type":    System.Activity.Attachments[0].ContentType
    }
  },
  "copilot_metadata": {
    "conversation_id": System.Conversation.Id,
    "message_id":      System.Activity.Id
  }
}
```

Store the response in `stageResult`.

### 3.4 Send status back to user
Conditional on `stageResult.ok`:

**If ok AND extraction_status == "review_required":**
```
Got it — "{stageResult.message}". Intake id: {stageResult.intake_id}.
{If(IsBlank(stageResult.matched_entity_id),
  "No property match yet — I'll ask about it in a moment.",
  "Matched to an existing property in LCC.")}
```

**If ok AND extraction_status == "processing":**
```
Received "{fileName}". Extraction is running — I'll have classification
and a property match in a moment. Intake id: {stageResult.intake_id}.
```

**If ok AND extraction_status == "failed":**
```
Captured "{fileName}" but couldn't extract deal data. Flagged for manual
review in the LCC intake queue. Intake id: {stageResult.intake_id}.
```

**Else (API error):**
```
I couldn't stage "{fileName}". Error: {stageResult.error ?? "unknown"}.
Hint: {stageResult.hint ?? ""}.
```

### 3.5 Optional — matched-entity memory log
If `stageResult.matched_entity_id` is present, invoke **memoryLogTurn**:
```
{
  "summary":  "Received OM for the matched property via Copilot Chat.",
  "entity_id": stageResult.matched_entity_id,
  "channel":  "copilot_chat",
  "kind":     "note"
}
```
(The stage action already logs an interaction; this is redundant and
optional. Skip if you prefer cleaner timelines.)

### 3.6 End topic
Return control to the main dialog. Subsequent turns can call
`contextRetrieveEntity` against `stageResult.matched_entity_id` if the
user asks about the property.

## 4. Register new actions in the agent's tool list

Under _LCC Deal Agent → Actions_, click **+ Add an action → From custom
connector**, and add:

- `contextRetrieveEntity` — display name "Retrieve Entity Context".
  Description: _"Pulls the full working memory for a contact, property, or
  org. Call at the start of any conversation that mentions a specific
  person, property, or company."_
- `memoryLogTurn` — display name "Log Conversational Memory". Description:
  _"Record a preference, objection, insight, or commitment to remember
  across future conversations."_

Keep `intakeStageOm` and `intakeFinalizeOm` registered but set their
_Enabled_ toggle to off in the GPT's Orchestrator settings — the topic
(§3) handles staging, and the GPT does not need to call them directly.

## 5. Test plan

1. **Baseline test:** upload a known Northmarq OM PDF in the PVA test pane.
   Expect the "Receive OM" topic to fire, `intakeStageOm` to return 200,
   and a status message with `intake_id` to appear in the conversation.
2. **Memory test:** upload the OM, then type "What do we know about this
   property?". The GPT should call `contextRetrieveEntity` with the
   property name (or entity_id if the stage response included one) and
   return the just-logged OM interaction in `recent_interactions`.
3. **Entity log test:** say "Scott prefers to see dialysis comps before
   government comps." The GPT should call `memoryLogTurn` with
   `kind=preference`, `channel=copilot_chat`, `entity_name` or no entity.
   Verify a new row appears in `activity_events` with
   `metadata.kind='preference'`.
4. **Regression:** email-path intake must continue to work unchanged.
   Flag an Outlook email with an OM attachment, confirm the email-intake
   bridge still produces an `inbox_items` row.

## 6. Rollback

If the new topic misfires, toggle it to _Disabled_ in Copilot Studio and
re-enable the old GPT-prompt ingestion block. The API rewrite is
forward-compatible — old calls will fail-fast with
`missing_primary_document_bytes` until the connector is updated.
