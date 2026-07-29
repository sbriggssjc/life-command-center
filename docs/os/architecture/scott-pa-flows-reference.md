# Scott Briggs — Power Automate Flow Reference & Action List

_2026-07-29. The specific, build-ready instructions for the PA flows that run on **Scott's own user
account** — the two urgent fixes that gate rollout, the attribution change, and the full set of your
flows documented as the reference copy the team rollout mirrors. Placeholders: `<LCC_HOST>` =
`life-command-center-production.up.railway.app` (engine) or the root proxy host as configured;
`<LCC_API_KEY>` = the `x-lcc-key` value you already use; `<WORKSPACE_ID>` =
`a0000000-0000-0000-0000-000000000001`._

---

## PART 1 — The two failing flows (fix now — these gate rollout)

### 1A. `To Do - Life Command Center Sync` + `Unflag Completed Email Tasks` → **DISABLE them (they're retired)**
**Finding (not a repair):** these two are **retired artifacts** from before the 2026-07-20/21 intake rework
(see `docs/architecture/INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`). That rework **removed** custom To-Do task
creation and **replaced** it with native "Flagged email" list tracking + the Completion Poll. They now fail
daily (`Update file` / `Apply to each` → 404) precisely because they reference the old custom To-Do list/model
that no longer exists. They are not doing any live work — the current loop runs without them.

**Verified live:** the current intake loop is healthy independent of these two — last Outlook event 2026-07-29,
57 staged items in the last 7 days. So disabling them only stops the daily error noise.

**Do this:**
1. In Power Automate, confirm the **replacement** flows are **On** and green:
   - `LCC Processing Complete → Move Message` (HTTP-triggered; `clear_flag` is the completion lever).
   - `LCC To-Do Completion Poll` (recurrence ~30 min; native `linkedResources[0].displayName == subject` match).
2. Once confirmed, **turn Off** `To Do - Life Command Center Sync` and `Unflag Completed Email Tasks`
   (Power Automate → the flow → **Turn off**). Don't delete yet — leave Off for a week as a safety margin, then
   delete. Their JSONs (`flow-email-flag-to-todo.json`, `flow-todo-complete-unflag.json`) are already tagged
   stale in the repo.
3. The two daily `flow_failure` alerts for these will stop appearing in Ops Health.

> If, when you open them, either turns out to be doing something you still rely on that the native model doesn't
> cover, stop and tell me — but per the audit they were fully superseded.

### 1A-fix. `LCC To-Do Completion Poll` failing 404 (`ErrorItemNotFound`) → stop hard-coding the folder id
> **✅ FIXED & VERIFIED 2026-07-29.** Implemented via Option 2. Final working layout (from the saved export):
> `HTTP_GetStagedWorklist → Parse_JSON → Initialize_variable` (array `CompletedIds`, at **top level** — PA forbids
> Initialize-variable inside a Condition) `→ Get_Lists → Filter_FlaggedList` (`from: @body('Get_Lists')`,
> `where: @equals(item()?['wellknownListName'],'flaggedEmails')`) `→ Condition @greater(length(body('Filter_FlaggedList')),0)`
> { **yes:** `List_Flagged_Tasks` (folderId `@first(body('Filter_FlaggedList'))?['id']`) → `Apply_to_each`;
> **no:** `Terminate` Succeeded } `→ HTTP_1`. Confirmed schema: the To-Do **Lists** action returns the array
> directly at `@body('Get_Lists')` (not `body/value`) and exposes `wellknownListName`. A zero-flagged run correctly
> takes the Terminate branch (clean no-op). *Still to do once: flag one email + run to exercise the If-yes path end-to-end.*

**Finding (confirmed 2026-07-29):** the poll's `List to-do's by folder (V2)` action has its **`folderId`
hard-coded** to `AAMkADI4…AAC56pC5AAA=` — which is the *exact reference/probe value* the spec
(`flows/todo-completion-poll.md`) warned **not** to hardcode ("resolve it each run via
`wellknownListName eq 'flaggedEmails'` … it can differ per environment/account"). Outlook deletes and
recreates the native **Flagged email** To-Do list (with a **new** id) whenever your flagged count hits zero, so
the hard-coded id now 404s every run. This is a repoint/rebuild of that one action, not a retirement — the poll
itself is current and needed.

**Exact flow shape (from the 2026-07-29 export, flow `LCC To Do Completion Poll`):**
`HTTP_GetStagedWorklist` → `Parse_JSON` → **`List_Flagged_Tasks`** (`ListToDosByFolderV2`, conn `shared_todo`,
param `folderId` = the hard-coded `AAMk…AAA=`) → `Initialize_variable` → `Apply_to_each`
(`@body('Parse_JSON')?['items']`) → `HTTP_1`. Inside the loop, `Filter_MatchingTasks` reads
`@body('List_Flagged_Tasks')` and matches `status == completed` AND `linkedResources[0].displayName == subject`.
Only `List_Flagged_Tasks` is wrong; everything else stays as-is.

#### Option 1 — 30-second stopgap (gets it green now)
Open **`List_Flagged_Tasks`** → the **Folder / List** field → clear the hard-coded id → re-pick **Flagged email**
from the dropdown → Save → Test. Works immediately, but the id will go stale again the next time your flagged
count hits zero and Outlook recreates the list. Do Option 2 for a permanent fix. (If "Flagged email" isn't in the
dropdown, reconnect the Microsoft To-Do (Business) connection `shared_todo` and reselect.)

#### Option 2 — durable fix: resolve the list id each run (recommended)
Insert two actions between **`Parse_JSON`** and **`List_Flagged_Tasks`**, then repoint the folder:

1. **`Get_Lists`** — add Microsoft To-Do (Business) → **"Lists"** action (no parameters; uses your `shared_todo`
   connection). It returns every To-Do list, each with `id`, `displayName`, `wellknownListName`.
2. **`Filter_FlaggedList`** — add Data Operation → **Filter array**:
   - **From:** `@outputs('Get_Lists')?['body/value']`
   - **Condition (advanced mode):** `@equals(item()?['wellknownListName'], 'flaggedEmails')`
3. **Repoint `List_Flagged_Tasks`:** open it, delete the hard-coded `folderId`, switch the field to **Enter custom
   value / expression**, and set:
   `@first(body('Filter_FlaggedList'))?['id']`
   (Its `runAfter` becomes `Filter_FlaggedList` once you insert the two steps in sequence — the designer wires
   this automatically.)
4. **Guard the empty state (optional but kills the last 404 risk):** add a **Condition** right after
   `Filter_FlaggedList`: `@greater(length(body('Filter_FlaggedList')), 0)`. Move `List_Flagged_Tasks` +
   `Initialize_variable` + `Apply_to_each` + `HTTP_1` into **If yes**; put a single **Terminate (Succeeded)** in
   **If no** (no flagged emails right now = nothing to poll, a clean no-op, not a failure). If moving four actions
   into a branch is more surgery than you want, skip this — with staged emails always kept flagged, the list
   effectively always exists when there's work, so steps 1–3 alone fix the observed failure.
5. Save + **Test**.

**JSON-edit equivalent** (if you patch the export directly — same connection `shared_todo`, apiId
`shared_todo`): add a `Get_Lists` action (`operationId` **Lists** — confirm the exact id from the action picker,
some tenants surface it as `GetLists`) running after `Parse_JSON`; add a `Filter_FlaggedList` (`Query`) with
`from: "@outputs('Get_Lists')?['body/value']"`, `where: "@equals(item()?['wellknownListName'],'flaggedEmails')"`;
change `List_Flagged_Tasks.inputs.parameters.folderId` to `"@first(body('Filter_FlaggedList'))?['id']"` and its
`runAfter` to `{ "Filter_FlaggedList": ["Succeeded"] }`. Re-importing an edited export re-binds connections, so the
designer route is usually less fuss.

### 1B. `SF -> LCC: Daily Bulk File Backfill` → fix the manifest `HTTP` body (invalid JSON from `@json(concat(...))`)
**Updated finding (from the 2026-07-29 export — the flow is already restructured):** this flow was **already
rebuilt** to the correct per-link inner-loop shape (`Get_records_2` Comp__c → `Apply_to_each_1` →
`Get_records` ContentDocumentLink → `Apply_to_each` → `Get_records_1` ContentVersion → `HTTP` manifest →
`Condition` → Send/Upload/PUT/POST). The old "Map-to-Manifest gap" is gone. So the failure is **not** structural.

**Why the daily "failed at Apply_to_each" alert fires:** the flow has a **dead-letter pattern** — `Filter_array`
(`runAfter` = `TimedOut/Skipped/Failed`) collects failed iterations from `@result('Apply_to_each_1')`,
`PostDeadLetter` records them to `lcc_record_flow_failure`, and **`Terminate` is set to `runStatus: Failed`** to
surface it in Ops Health. That's *by design* — the alert is the safety net, not the bug. The bug is a single inner
iteration erroring. Once it's fixed, no iteration fails → `Filter_array`/`Terminate` are skipped → the run ends
**Succeeded**. (Leave the dead-letter/Terminate as-is.)

**Root cause (the actual bug):** the manifest `HTTP` action builds its body with `@json(concat('{…', <values>, '…}'))`
— hand-concatenated JSON. That produces **invalid JSON** (so `@json()` throws and the iteration fails) in two cases,
which is exactly why *some* comps fail and others succeed:
1. **Unescaped file metadata** — `title` (`Title`) and `file_name` (`PathOnClient`) are interpolated raw. Any file
   whose name/title contains a `"`, `\`, apostrophe, or newline breaks the string. (Common in real OM filenames.)
2. **Null numbers** — `"version_number":',string(…VersionNumber),',"size_bytes":'` yields `"version_number":,`
   (a syntax error) whenever `Get_records_1` returns no version, so `string(null)` is empty.

The receiving edge function (`intake-salesforce-files?action=manifest`) stores `title/file_name/version_number/
size_bytes` **as-is and tolerates null**, and filters out empty `content_version_id` — so it imposes no type
requirement. The *only* thing failing is JSON validity inside Power Automate.

**The fix — replace the manifest `HTTP` action's Body with a native JSON object** (PA JSON-escapes dynamic content
placed inside a real JSON body; and `coalesce` removes the null-number syntax error). Paste this in place of the
`@json(concat(...))` body, keeping the action's headers/URI unchanged:

```json
{
  "payload_version": "sf-files-2026-05-v4",
  "batch_id": "@{variables('BatchId')}",
  "files": [
    {
      "vertical": "auto",
      "linked_entity_type": "Comp__c",
      "linked_entity_sf_id": "@{items('Apply_to_each_1')?['Id']}",
      "linked_entity_tenant": "@{coalesce(items('Apply_to_each_1')?['Tenant_Name2__c'],'')}",
      "linked_entity_property_type": "@{coalesce(items('Apply_to_each_1')?['Property_Type__c'],'')}",
      "linked_entity_name": "@{coalesce(items('Apply_to_each_1')?['Name'],'')}",
      "content_version_id": "@{coalesce(first(outputs('Get_records_1')?['body/value'])?['Id'],'')}",
      "content_document_id": "@{items('Apply_to_each')?['ContentDocumentId']}",
      "title": "@{coalesce(first(outputs('Get_records_1')?['body/value'])?['Title'],'')}",
      "file_name": "@{coalesce(first(outputs('Get_records_1')?['body/value'])?['PathOnClient'],'')}",
      "extension": "@{coalesce(first(outputs('Get_records_1')?['body/value'])?['FileExtension'],'')}",
      "version_number": "@{string(coalesce(first(outputs('Get_records_1')?['body/value'])?['VersionNumber'],0))}",
      "size_bytes": "@{string(coalesce(first(outputs('Get_records_1')?['body/value'])?['ContentSize'],0))}",
      "sf_download_url": "@{concat('/services/data/v59.0/sobjects/ContentVersion/',coalesce(first(outputs('Get_records_1')?['body/value'])?['Id'],''),'/VersionData')}"
    }
  ]
}
```

Everything downstream (`Condition` on `length(body('HTTP')?['to_fetch'])`, Send/Upload/PUT/POST) then works
unchanged, because a valid manifest always returns `to_fetch`.

**Confirm it's this bug:** open the latest failed run → `Apply_to_each_1` (red comp) → `Apply_to_each` (red link) →
the red action should be **`HTTP`**, with an error like *"InvalidTemplate … 'json' … cannot be parsed"* or
*"unexpected character"*. If instead a *different* action is red (e.g. `Send_an_HTTP_request` or `PUT_bytes`), send
me its error and I'll adjust — but the `@json(concat)` body is the overwhelming likely cause.

**Two non-blocking notes (separate from the fix):**
- **Scale/efficiency:** `Get_records_2` pulls up to **5,000** comps every day and re-walks every file; the manifest
  dedup means already-ingested files are cheap, but it's a lot of Salesforce API calls. Worth narrowing later
  (e.g. `LastModifiedDate` window, or only comps whose files aren't all ingested). Not causing the failure.
- **Security:** the exported flow embeds the `X-PA-Webhook-Secret` and Supabase keys in cleartext — normal for a
  live flow, but don't commit raw flow exports to a shared/public repo. (These reference docs never contain the
  secret values.)

---

## PART 2 — Attribution: add `mailbox_owner` to your intake flow (the team template)

This is the one-line PA change that makes per-broker attribution real (DB foundation already done —
`lcc_actor_for_mailbox`, see `actor-attribution-phase1.md`). Your copy resolves to the system identity (no
visible change for you), but it establishes the exact template each teammate copies with **their** address.

**Flow:** `Outlook Intake to Teams (Hardened)` (`flow-outlook-intake-to-teams-hardened.json`).
**Action:** the HTTP `POST` to `https://<LCC_HOST>/api/intake-outlook-message` (step `HTTP_step_1`).
Its JSON body today is:

```json
{
  "message_id": "@{triggerOutputs()?['body/id']}",
  "internet_message_id": "@{triggerOutputs()?['body/internetMessageId']}",
  "subject": "@{triggerOutputs()?['body/subject']}",
  "from": "@{triggerOutputs()?['body/from']}",
  "body_preview": "@{triggerOutputs()?['body/bodyPreview']}",
  "received_date_time": "@{triggerOutputs()?['body/receivedDateTime']}",
  "web_link": "@{triggerOutputs()?['body/webLink']}",
  "has_attachments": "@{triggerOutputs()?['body/hasAttachments']}",
  "attachments": "@{triggerOutputs()?['body/attachments']}"
}
```

**Add one property:**

```json
  "mailbox_owner": "sabriggs@northmarq.com"
```

That's the whole flow-side change. (Kelly's copy uses `klargent@northmarq.com`, Sarah's `smartin@northmarq.com`,
Nate's `nberwaldt@northmarq.com`.) Header stays `x-lcc-key: <LCC_API_KEY>`, `x-lcc-workspace: <WORKSPACE_ID>`.

> **Paired engine change (Scott deploys — not live yet):** `api/intake.js` (the `/api/intake-outlook-message`
> handler, `payload = req.body`) must carry `mailbox_owner` onto the staged item, and the intake promoter must
> set `activity_events.actor_id = lcc_actor_for_mailbox(mailbox_owner)` instead of the caller/SYSTEM_ACTOR.
> Full spec in `actor-attribution-phase1.md`. Until that ships, adding the field is harmless (ignored).

---

## PART 3 — Your broker-core bundle (the reference copy the team mirrors)

These are the per-person flows that read/write **your** mailbox, calendar, tasks, and deal folders. They already
exist on your account (you're the origin); teammates replicate them with their own connections (see
`TEAM-ROLLOUT.md`). Documented here so the reference is precise.

| # | Flow (your copy) | Trigger | Connection(s) | What it does / config notes |
|---|---|---|---|---|
| 1 | **Outlook Intake to Teams (Hardened)** `flow-outlook-intake-to-teams-hardened.json` | New email (V3) | Outlook + Teams | The key one. Mailbox → `POST /api/intake-outlook-message` → staging → matcher → `activity_events`. **Add `mailbox_owner` (Part 2).** Header `x-lcc-key`/`x-lcc-workspace`. |
| 2 | **LCC Processing Complete → Move Message** | HTTP request | Outlook | `POST /api/webhooks/processing-complete`; `clear_flag` is the sole completion lever (native Flagged-email model). Keep **On**. |
| 3 | **LCC To-Do Completion Poll** | Recurrence ~30 min | Outlook | Scans the native Flagged-email list; matches `linkedResources[0].displayName == subject`. No Graph token. Keep **On**. Replaces the retired To-Do sync flows (Part 1A). |
| 4 | **LCC Outlook Calendar Sync** `flow-outlook-calendar-sync.json` + **Personal Calendar Sync** `flow-personal-calendar-sync.json` | Recurrence | Outlook | Calendar events → `activity_events` (category `meeting`). Work + personal calendars. |
| 5 | **LCC Create Outlook Draft** `flow-lcc-create-outlook-draft.json` | HTTP request | Outlook | LCC drafts a reply in your mailbox on demand (draft only — never auto-sends). |
| 6 | **Email Flag → staging** (native) / **Inbox Janitor** / **Flagged Email Cleanup Sweep** | Recurrence / on-flag | Outlook | Mailbox hygiene + flag-to-staging. (The **custom-task** flag→to-do variants are retired — Part 1A.) |
| 7 | **LCC Daily Briefing to Teams** `flow-daily-briefing-to-teams.json` | Recurrence (daily) | Teams | Posts your morning briefing to Teams (`operations.js` briefing generator). |
| 8 | **LCC – Phase 1 Deal Dossier Folder Watch** | Recurrence / SharePoint trigger | SharePoint/OneDrive | Watches your deal folders → OM/document ingestion → dossier. |

**Also on your account (adjacent):** `Outlook Intake — Button` (`flow-outlook-intake-button-to-teams.json`,
manual "share this email" button), `flow-a-lcc-stage-om-http.json` (HTTP OM stager), `LCC Teams Chat`
(`flow-lcc-teams-chat.json`, keyword-triggered Teams Q&A).

**Connections to keep authorized (yours):** Office 365 Outlook, Microsoft Teams, SharePoint/OneDrive, Salesforce
(for the SF-touching flows). Microsoft To Do is **no longer required** for the current model (native list only).

---

## PART 4 — Shared / org-level flows you own (documented, NOT replicated per teammate)

These run once for the whole team on shared data (the SF pipeline, the property DB, the LCC engine). A new member
needs **none** of these rebuilt — they already benefit. Keep them On; they're yours to own/monitor.

| Flow | Trigger | What it does |
|---|---|---|
| **SF Deal → LCC Opportunity Sync** | Recurrence (~30 min) | Pulls all Team Briggs SF opportunities → `bd_opportunities` (the deal spine). |
| **SF Deal Team → LCC Roster** / **SF Deal Contacts → LCC Roster** | Recurrence | Populate `sf_opp_team` + contact roster edges. |
| **SF → LCC sync family** (Object / Event / Activity / Record / **Daily Bulk File Backfill**) | Recurrence | SF activity/records → `activity_events`. *(Bulk File Backfill needs the Part 1B fix.)* |
| **LCC → SF Queue Drainer** | Recurrence | Drains the LCC→SF write-back queue (`sf-writeback`). |
| **SF Listing Activity → LCC engagement** | Recurrence | Listing views/engagement → LCC. |
| **Google News Alert → LCC Lead Ingest** `flow-google-news-alert.json` | On email (alert) | News alerts → lead ingest. |
| **LoopNet Feeder / Backfill** `flow-loopnet-backfill.json` · **RCM Feeder / Backfill** `flow-rcm-backfill.json` | Recurrence | Market-listing feeders. ⚠️ Check these two for **stale `*.vercel.app` host** strings — production is Railway (`<LCC_HOST>`); the audit flagged `flow-loopnet-backfill.json:63` / `flow-rcm-backfill.json:63`. |
| **Team Briggs Weekly Pipeline** | Recurrence (weekly) | The team weekly digest (owner-scoping already built engine-side). |
| **Http → Put/Get/List/Create file** | HTTP | Artifact/file plumbing used by the dossier + OM pipelines. |

---

## Priority order for you
1. **Part 1A** — turn off the two retired To-Do flows (after confirming the two replacements are On). ~5 min, clears 2 daily errors.
2. **Part 1B** — add the `length > 0` Condition stopgap to `Daily Bulk File Backfill` now (~2 min, clears the 3rd daily error); schedule the per-link restructure when you have a longer sitting.
3. **Part 2** — add `mailbox_owner` to your intake flow (harmless now; live once the paired engine change deploys).
4. Parts 3–4 are reference — no action unless a flow shows a problem or you're prepping a teammate's copy.

Clearing 1A + 1B removes the last **error**-level Ops Health items that gate lifting the rollout hold.
