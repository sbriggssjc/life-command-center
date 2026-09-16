# FLOWS1 — eight Power Automate flows failed last week, one of them 709 times; trace the LCC side of each

**Filed:** 2026-09-16 (Cowork) from `docs/claude-code/SB notes/8 of your flow(s) have failed.eml`
(Microsoft digest, week ending 2026-09-12). Triage row **SBN-1**.
**Owner:** LCC for everything on this side of the HTTP boundary; the flows themselves are Scott's
(Power Automate, tenant `fccf69d3…`). **Read first:** `docs/os/POWER-AUTOMATE-DEPLOYED-CATALOG.md`,
`docs/architecture/power-automate-flow-audit.md`, `docs/INFRA_ALERT_CLASSIFICATION.md`,
`docs/architecture/flows/*.md` for each flow named below.

## The digest

| flow (digest name) | failures / week | catalog id |
|---|---:|---|
| Http → Get file (**LCC Get Artifact**) | **709** | `c63003a0-…` |
| LCC – Outlook Intake to Teams (Hardened) | 41 | `45faffcc-…` (`outlook-intake-hardened`) |
| LCC List Folder (SharePoint) | 39 | — |
| SF Listing Activity → LCC engagement | 35 | `a81b5708-…` |
| LCC Processing Complete → Move Message | 7 | — |
| LCC Flagged Email Intake | 6 | `44227dbb-…` |
| Http → Switch, Get Account records, Respond (account), Get Contact re… | 6 | — |
| Outlook Calendar – Life Command Center Sync | 1 | — |

A digest carries counts, not causes. The run-level error text lives only in the Power Automate run
history, which nothing in this repo can read. So this round is split:

- **Scott** drops **one screenshot of one failed run per flow** (the red step + its error body) into
  `docs/claude-code/SB notes/` — that is the only way the failure reason enters the repo.
- **This prompt** does everything that can be done from the LCC side *without* those screenshots,
  so the screenshots land on a diagnosis, not a blank page.

## What to do from the LCC side (measure, don't guess)

1. **Get Artifact, 709/week ≈ 100/day.** Find every LCC caller of that flow's HTTP trigger (grep the
   flow id, `Get Artifact`, and the SharePoint path it fetches, in `api/`, `scripts/`, `supabase/`,
   pg_cron on all three projects). For each caller: how often does it run, and what does it pass? A
   709 count with a ~100/day cadence usually means a **scheduled caller retrying against a moved or
   deleted file** — find the schedule that matches the arithmetic before reading anything else.
   Check `infra_alerts` / the alert classification table for the same period: is this failure
   already classified, and as what?
2. **Outlook Intake (41) and Flagged Email Intake (6)** share the intake path (`docs/architecture/
   flows/flagged-email-to-todo*.md`, `outlook_intake_team_visibility_workflow.md`). Read LCC's
   intake endpoint logs for the week (Railway; `/api/intake*`): were the failures **LCC 5xx/4xx
   responses** (ours) or **flow-side** (theirs — connector auth, Teams card, SharePoint)? Split the
   41 by that line if the logs allow; if they don't, say so and say what logging is missing.
3. **SF Listing Activity → LCC engagement (35).** This flow POSTs to an LCC route. Same question:
   did LCC refuse it (schema drift on the payload, 413, auth), and does the `sf_activity` /
   engagement table show a gap for the week that matches?
4. **List Folder (39), Processing Complete → Move (7), Switch/Get Account (6), Calendar (1)**:
   catalog each (trigger, what LCC endpoint if any, last known-good), one paragraph apiece, and
   mark which are LCC-facing at all. A flow that never touches LCC is Scott's to fix; say so plainly.
5. Produce a **per-flow table**: LCC-facing? · suspected side · evidence · what the screenshot must
   show to confirm · the fix if it is ours. Where a fix is ours and obvious (a route that 500s on a
   payload it should accept), fix it in this round with a test; otherwise stop at the diagnosis.

## Addendum 2026-09-16 — the run screenshots arrived (SBN-9, `SB notes/done/Failed flows.docx`, 17 shots, read by Cowork)

The failure reason for every one of the eight is now known. Most are flow-side; **four have an LCC
cause or an LCC fix**. Read this before step 1; it replaces the guessing.

| flow | failing step | error, verbatim shape | side | what it means |
|---|---|---|---|---|
| **Get file (LCC Get Artifact)** 709 | `Response` (after `Get file content using path` succeeds in 16–24 s) | `InvalidTemplate … The template language function 'body' cannot be used when the referenced action outputs body has large aggregated partial content … only … actions that support chunked transfer mode` | **both** | The file is too large for a `Response` built from `body(...)`. Flow: return the content via an action that supports chunking, or return a SharePoint download URL/`$content` reference instead of the bytes. LCC: find the caller that asks ~100×/day for files this large (document capture? OM ingest?) — that arithmetic is step 1 — and either request a URL or cap the size it asks for. |
| **Outlook Intake to Teams (Hardened)** 41 | `HTTP GetEmailWebLink` (Graph `GET /me/messages/{id}`) right after `HTTP PostIntakeMessage` (LCC, 17–24 s) succeeds | `NotFound — The specified object was not found in the store` | **LCC-caused race** | LCC's intake completes and the **Processing Complete → Move Message** flow moves the mail before this flow fetches its web link; a moved message has a new id. Fix on our side: the completion callback must not fire the move until intake-to-Teams has finished, or the web link is fetched *before* `PostIntakeMessage`. |
| **List Folder (SharePoint)** 39 | `Send an HTTP request to SharePoint` | `BadRequest … GetFolderByServerRelativeUrl('/sites/TeamBriggs20/Shared Documents/PROPERTIES/Portfolio/Rockwell Automation-IPS - Portfolio 6 - MOVED TO R DRIVE/DD/Round 2/Rec''d/3100 Pinson Valley Parkway, Brimingham, AL') is not valid` | **LCC** | A path with an apostrophe (`Rec'd`). The OData literal needs the quote doubled exactly once; the screenshot shows `Rec''d` already, so either LCC pre-escapes and the flow escapes again, or the folder itself was renamed ("MOVED TO R DRIVE") and no longer exists. Step: log what LCC sends, compare to the flow's expression, and check the folder exists. |
| **SF Listing Activity → LCC engagement** 35 | `Get record` (Salesforce `GetItem_V2`, table `Listing__c`) | `parameters … may not be null or empty: 'id'` | flow | The trigger `When a record is modified` fires without an id in the field the `Get record` step reads. Scott's flow: map the trigger's record id (or the trigger is on the wrong object). LCC is never reached. |
| **Processing Complete → Move Message** 7 | `Flag email (V2)` after `Move email (V2)` succeeds | `PreconditionFailed — the change key passed … does not match the current change key` | flow | Move then Flag on the same `messageId`: after the move the item has a new id/change key. Reorder (flag first, then move) or flag by the moved message's new id. LCC's HTTP step succeeded. |
| **Flagged Email Intake** 6 | `Get email (V2)` right after the `When an email is flagged (V3)` trigger | `NotFound — not found in the store` | **LCC-adjacent race** | Same family as Outlook Intake: the message is moved (by the Move flow) between trigger and read. Fix with the Outlook-Intake sequencing. |
| **Http → Switch / Get Account / Respond (account)** 6 | `Respond (account)` / `Response` inside `Switch` (31–57 s) | `504 Gateway Timeout — the client application timed out waiting for a response` | **both** | The Salesforce lookups inside the Switch take 30–60 s and the HTTP caller (LCC) times out first. LCC: which route calls this, with what timeout; consider async (call, then poll) for account/contact lookups. Flow: fewer chained lookups per case. |
| **Outlook Calendar – LCC Sync** 1 | `Update file` (OneDrive) | `Save Conflict — changes conflict with those made concurrently` | flow, benign | Two runs overlapped on one file. Concurrency control = 1 on the flow. |

**So for step 5's table:** LCC-facing and ours to fix = Get Artifact (caller + size), Outlook Intake +
Flagged Intake (the move-before-read race — one fix), List Folder (path escaping / existence), Switch
(timeout/async). Scott's to fix in Power Automate = SF Listing Activity (trigger id), Move Message (order),
Calendar (concurrency). Do the LCC four in this round with tests; write the three flow fixes as a
checklist for Scott in the response (step, what to change, why), since flow exports are not edited here.

## Prohibitions

- ⛔ Do not touch a flow definition (`flow-*.json` at the repo root are exports, not sources — see
  `docs/flows/README.md`); do not "fix" a flow by hand-editing its export.
- ⛔ Do not silence an alert or lower a threshold to make the digest quieter
  (`CLAUDE.md` → "A monitor's threshold is part of the monitor").
- ⛔ No retries or resends of intake mail.

## Reporting

The per-flow table, the Get-Artifact caller arithmetic, the intake log split, what was fixed and
tested, and the exact list of screenshots still needed from Scott (flow name → which run step). If
any step was skipped, say so.
