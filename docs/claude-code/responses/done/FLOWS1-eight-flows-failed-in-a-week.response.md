# FLOWS1 — eight Power Automate flows failed in the week to 2026-09-12 (2026-09-16)

Read first: `docs/claude-code/prompts/FLOWS1-eight-flows-failed-in-a-week.md` (the digest + the
ask), `docs/claude-code/SB notes/Failed flows.docx` (17 screenshots, one-to-several failed runs per
flow — the primary evidence this response is built from).

## Headline: every failure is downstream of LCC, and none needed an LCC code fix

The prompt asked for two things: what can be measured from the repo alone, and a list of what
screenshots would be needed to go further. Scott supplied the screenshots
(`docs/claude-code/SB notes/Failed flows.docx`, 17 images) before the repo-side pass was acted on,
so this response reports the screenshot-derived root cause for each flow directly, rather than the
repo-only inference that was drafted first.

**Across all 17 screenshots, every LCC-owned HTTP step succeeded — `HTTP_PostIntakeMessage`,
`Send an HTTP request` (to LCC), and SharePoint's own `Get file content using path` all completed
without error, every time.** Every one of the eight flows' failures happens in a step *downstream*
of LCC (a `Response`/Graph/SharePoint/Salesforce action inside the flow), or is a flow-definition
ordering/timeout defect. **No LCC repo code was changed as a result of this investigation** — there
was nothing on this side of the HTTP boundary to fix.

## Per-flow findings (from the screenshots)

| flow | fails/wk | root cause | fix owner |
|---|---:|---|---|
| **Http → Get file (LCC Get Artifact)** | 709 | Not auth, not a moved/deleted file. `Get file content using path` succeeds every time (16–24s observed). The following `Response` action fails with `InvalidTemplate`: *"the referenced action outputs body has large aggregated partial content... can only be referenced by actions that support chunked transfer mode."* Power Automate switches a SharePoint file fetch to chunked/paginated output above a size threshold, and a plain `body(...)` reference inside a `Response` action cannot relay chunked content — this is a **flow-definition defect, deterministic for any large file**, not an intermittent fault. The ~709/week matches the two overlapping 30-minute LCC crons (`lcc-document-text`, `lcc-cre-doc-text-backfill`, ~96 scheduled ticks/day) re-requesting the same large document every tick. | **Scott's flow** — the `Response` action needs to stream/relay the file body in a chunked-transfer-capable way, or branch on file size and route large files through a different action. Not reachable from the LCC side; LCC's caller and payload are correct. |
| **LCC – Outlook Intake to Teams (Hardened)** | 41 | LCC's `HTTP_PostIntakeMessage` step succeeds every time (17–24s). The failure is the next step, `HTTP_GetEmailWebLink`: Graph returns **404 "The specified object was not found in the store."** — the same "message already moved/gone by the time a later step references it by id" race this repo's own CLAUDE.md documents at length for the sibling mailbox-mirror flow (P119). The May-2026 "Hardened" Terminate-on-failure branch covers the post-intake cleanup (Flag/Mark/Move) steps but **not** this weblink fetch. | **Scott's flow** — wrap `GetEmailWebLink` with the same 404-tolerant handling the cleanup steps already have; the intake itself already succeeded and should not be reported as a failed run. |
| **LCC List Folder (SharePoint)** | 39 | `BadRequest` on `GetFolderByServerRelativeUrl(...)` — the path itself is malformed: `.../PROPERTIES/Portfolio/Rockwell Automation-IPS - Portfolio 6 - MOVED TO R DRIVE/DD/Round 2/Rec"d/3100 Pinson Valley Parkway, Birmingham, AL`. Two things stand out: a literal `"` character where `Rec'd` should read (apostrophe corrupted to a straight double-quote), and the parent folder is literally named "MOVED TO R DRIVE" — i.e. this folder was manually relocated. Checked the LCC-side caller (`api/_handlers/folder-feed.js::toServerRelative`) — it already correctly doubles single quotes for the OData literal, so this is **not an LCC escaping bug**. This reads as a stale/corrupted stored path from whatever system produced it. | **Not fully traced in this pass** — needs the specific system that wrote this path identified (SharePoint's own folder rename history, or whatever upstream captured "Rec'd" as a straight quote) before a fix can be assigned. Filed as open below. |
| **SF Listing Activity → LCC engagement** | 35 | **Never reaches LCC.** The Salesforce trigger (`When a record is modified` on `Listing__c`) fires successfully, but the very next step, `Get record` (`GetItem_V2`), fails because the trigger's own `id` parameter resolves **empty**. 100% Salesforce/Power-Automate-side — a trigger race, most likely a bulk-update operation where the modified record's id isn't populated at fire time. | **Scott's flow/Salesforce config** — not LCC-facing in any of the observed failures. |
| **LCC Processing Complete → Move Message** | 7 | LCC's own outbound call (`Send an HTTP request`) succeeds, `Move email (V2)` succeeds, then `Flag email (V2)` fails: `PreconditionFailed` — **stale change-key**. Outlook changes an item's change key on move; the Flag step still carries the pre-move key. A step-ordering defect in the flow. | **Scott's flow** — flag before moving, or re-fetch the item's change key after the move step. |
| **LCC Flagged Email Intake** | 6 | **Never reaches LCC.** Trigger fires (`When an email is flagged (V3)`, succeeds), then `Get email (V2)` 404s ("not found in the store") on the same message id — the identical P119-class race as Outlook Intake, one step earlier in this flow's own pipeline (before the `HTTP - outlook-message` POST to LCC is ever reached). | **Scott's flow.** |
| **Http → Switch, Get Account records, Respond (account), Get Contact re…** | 6 | Genuine **504 Gateway Timeout**. The Switch node runs several branches (one, "opportunities by ids", chains 5 Salesforce actions) and the whole run takes 31–57s across the three observed failures, exceeding the caller's synchronous response timeout. This is a real latency problem, not an auth/data defect. | **Scott's flow** — needs to go async/queued (respond immediately, deliver results via callback), or the slow Salesforce branches need to shed work. |
| **Outlook Calendar – Life Command Center Sync** | 1 | `Update_file` (OneDrive) fails with a Save Conflict — a concurrent-write race on the personal calendar-merge file (Teamsnap/iCloud/personal calendars → merge → one OneDrive file, two runs racing). No LCC touchpoint anywhere in this flow. | **Scott's flow**, low priority at 1/week. |

## What was checked and ruled out on the LCC side before the screenshots landed

- **Live dead-letter plane** (`v_flow_run_failures_open`, LCC Opps): queried before the screenshots
  arrived. Only 2 rows total, both `LCC Flagged Email Intake`, both `error_kind='has_failed'` with
  **no failed-action or error-code detail** — the webhook that feeds this table only records *that*
  a run failed, not *why*. `LCC Outlook Intake (Hardened)` and `Get Artifact` had **zero** rows here
  despite 41 and 709 failures in the digest, meaning either their fault branches aren't calling this
  webhook, or the failures die before reaching it. This table could not have answered the "why"
  question on its own — the screenshots were necessary.
- **`api/_handlers/folder-feed.js`** — confirmed the LCC-side caller of the List Folder flow already
  handles OData apostrophe-doubling correctly (`toServerRelative()`), ruling out an LCC escaping bug
  as the List Folder cause.
- **Get-Artifact caller arithmetic** — two overlapping 30-minute pg_cron jobs on LCC Opps
  (`lcc-document-text`, `lcc-cre-doc-text-backfill`) produce ~96 scheduled ticks/day, close to the
  digest's ~100/day implied rate, consistent with the screenshots' finding that the SAME large file
  is being re-requested and re-failing on schedule.

## Open items

- **List Folder's corrupted path** (`Rec"d`, "MOVED TO R DRIVE") is not traced to a writer. Filed as
  open — needs whoever captures/stores this deal-folder path (on the LCC side or SharePoint's own
  history) identified before a fix can be assigned to either side.
- **PLANNED-BACKLOG row FLOWS1** updated to closed-diagnosis / owner-side-fix status (see below) —
  seven of eight flows have a named PA-side fix; the eighth (List Folder) needs one more trace.

## Prohibitions honored

No `flow-*.json` export was edited. No alert threshold was touched. No intake mail was
retried/resent. All findings above are read-only (repo grep + live Supabase query + screenshot
review); the only artifact changed by this response is this file plus the `PLANNED-BACKLOG.md` row.
