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

### 1B. `SF -> LCC: Daily Bulk File Backfill` → fix the `Apply_to_each` (Map-to-Manifest gap)
**Finding:** this is the scheduled sibling of Flow 6 (`SF -> LCC: On-demand File Backfill`,
id `aaa452c0-7eb5-4c98-bfe2-f6d872d80639`). It fails at `Apply_to_each` because of a **known architectural gap**
documented in `docs/architecture/sf_file_backfill_flow6_next_steps.md`: the `Map Files to Manifest` step maps
`ContentDocumentLink` rows straight into a manifest, but `ContentDocumentLink` carries no `VersionData` / `Title` /
`FileExtension` / `ContentSize`, so the manifest items are null and the downstream loop iterates over malformed
data and red-errors. (The observed run had one empty `foreachItems:[]` iteration and one with a real
`ContentDocumentId` that then failed — exactly this shape.)

**Two options (same as the Flow 6 notes):**

- **Immediate stopgap (stops the daily alert in ~2 min):** add a **Condition** right before `Apply_to_each`:
  `length(<the to_fetch / manifest array>)` **is greater than** `0`. Put the loop on the **If yes** branch.
  This makes an empty/short-circuit run end cleanly instead of red-erroring. It does **not** make backfill
  actually work — it just stops the false failure while you do the real fix.
- **Real fix (recommended) — restructure to a per-link inner loop:** replace `Map Files to Manifest` +
  `POST File Manifest` + the outer `Apply_to_each` with a single `Apply_to_each` over
  `body('Get_records')?['value']` (the `ContentDocumentLink` array), and **inside** the loop:
  1. `Get records` on **`ContentVersion`**, Filter `ContentDocumentId eq '@{items('Apply_to_each')?['ContentDocumentId']}' and IsLatest eq true`, Top 1.
  2. `POST File Manifest (single item)` to `intake-salesforce-files?action=manifest` — now with the real
     `VersionData`, `Title`, `FileExtension`, `ContentSize`.
  3. `Get File Bytes` (Salesforce Send-HTTP `GET .../ContentVersion/<Id>/VersionData`).
  4. `Get Upload URL` (`intake-salesforce-files?action=upload-url`) → `PUT bytes` → `POST File Bytes` (`action=bytes`).

  Remember NorthMarq's convention: **OMs live on the `Comp__c` record, not `Property__c`** — query
  `ContentDocumentLink` by `LinkedEntityId`, and the PA Salesforce **Get records** Filter Query is **OData**
  (`eq`, not `=`). The `intake-salesforce-files` edge function (v5) is deployed and proven, no change needed.

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
