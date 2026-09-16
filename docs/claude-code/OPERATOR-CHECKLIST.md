# Operator checklist — steps only Scott can do

The one list of manual actions the build is waiting on: deploys that do not ride Railway, edits in
systems the repo cannot reach (Power Automate, Salesforce), payloads only a human can fetch. Cowork
adds a row when a round ends on one of these; Scott ticks it; Cowork verifies and removes it in the
next turn. If a row sits here for more than a week, it goes to the backlog as a blocker.

Updated 2026-09-16 (evening): D1 and D2 done and verified; P1 replaced by a prompt; F1–F7 have a step-by-step guide.

## Deploys

| # | step | why | how | verify |
|---|---|---|---|---|
| ~~D1~~ | ✅ **Done 2026-09-16** — `daily-briefing` deployed, live **v26** (verified via `functions list`); tomorrow's briefing is the behavioural check | | | |
| ~~D2~~ | ✅ **Done 2026-09-16** — INVENTORY1 branch merged | | | |

## Power Automate (the FLOWS1 seven)

Open each flow at `make.powerautomate.com` → environment *NorthMarq Capital, LLC* → the flow → **Edit**. **Step-by-step with exact clicks: `docs/setup/POWER-AUTOMATE-FLOW-FIXES-2026-09-16.md`.** Suggested order: F1 → F2 → F5 → F4 → F3 → F6 → F7.

| # | flow | edit | why |
|---|---|---|---|
| F1 | **Http → Get file (LCC Get Artifact)** (709/wk) | On the `Response` action: **Settings → Content transfer → Allow chunking ON**; if the option is not offered on `Response`, replace the body with a reference to the file's download URL (`body('Get_file_content_using_path')?['$content']` is the chunked field — do not return it inline) and let LCC fetch the bytes from SharePoint directly. | The `Response` cannot relay a large file's body; it fails deterministically for that file. (LCC side: FLOWS1-crons will stop re-asking every 30 min.) |
| F2 | **LCC – Outlook Intake to Teams (Hardened)** (41/wk) | **Move `HTTP GetEmailWebLink` above `HTTP PostIntakeMessage`** (drag it up; it only needs the message id). Optionally also *Configure run after* on it: run after `PostIntakeMessage` **has failed / succeeded / timed out** so a 404 does not fail the run. | LCC's completion triggers the Move flow while this flow is still reading the message; fetching the link first removes the race. (LCC side: FLOWS1-order.) |
| F3 | **LCC Flagged Email Intake** (6/wk) | On `Get email (V2)`: *Settings → Retry policy → Exponential, 3 tries*; and *Configure run after* the following step to continue when it fails. | Same race one step earlier; the message is moved before this flow reads it. |
| F4 | **LCC Processing Complete → Move Message** (7/wk) | **Swap the order: `Flag email (V2)` first, then `Move email (V2)`.** | Move changes the item's change key; Flag after Move fails with `PreconditionFailed`. |
| F5 | **SF Listing Activity → LCC engagement** (35/wk) | On `Get record`, the `id` field is empty. Re-select the dynamic content **`Record Id`** (or `Id`) from the trigger `When a record is modified`; if the trigger's object is not `Listing__c`, change it. Save and test with one listing edit. | The trigger fires without an id in the field `Get record` reads; LCC is never reached. |
| F6 | **Http → Switch, Get Account records, Respond (account), Get Contact re…** (6/wk) | Short term: on the flow's HTTP trigger caller (LCC), nothing to change here; in the flow, on the slow branches (*opportunities by ids*, 5 chained Salesforce actions) add *Settings → Timeout PT60S* per action and reduce the chain (one SOQL with `IN (...)` instead of five gets). Long term: make it async (respond 202 immediately; post results to LCC's callback). | Runs take 31–57 s; the caller gives up at 30 s → 504. |
| F7 | **Outlook Calendar – Life Command Center Sync** (1/wk) | Flow **Settings → Concurrency control ON, degree of parallelism 1**. | Two runs wrote the same OneDrive file at once. |

After F1–F7: wait one week, forward the next "flows have failed" digest into `docs/claude-code/SB notes/`.

## Payloads / data only a human can fetch

| # | item | for |
|---|---|---|
| ~~P1~~ | **Withdrawn 2026-09-16** — HCAD publishes its full roll as free bulk PDATA files (`hcad.org/pdata`), so Harris is a Claude Code prompt (`OWNERGAP2-harris`), not a hand-fetch. Nothing for Scott to gather. | |

## Housekeeping

| # | item |
|---|---|
| H1 | If `git pull` ever says `cannot lock ref 'ORIG_HEAD'`: `Remove-Item -Force C:\Users\scott\life-command-center\.git\ORIG_HEAD.lock` then retry. (Cowork's file bridge cannot delete lock files it leaves behind; the commit scripts now clear it first.) |
