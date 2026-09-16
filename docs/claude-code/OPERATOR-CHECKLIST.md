# Operator checklist — steps only Scott can do

The one list of manual actions the build is waiting on: deploys that do not ride Railway, edits in
systems the repo cannot reach (Power Automate, Salesforce), payloads only a human can fetch. Cowork
adds a row when a round ends on one of these; Scott ticks it; Cowork verifies and removes it in the
next turn. If a row sits here for more than a week, it goes to the backlog as a blocker.

Updated 2026-09-16.

## Deploys

| # | step | why | how | verify |
|---|---|---|---|---|
| D1 | **Deploy the `daily-briefing` edge function** to LCC Opps | HOME1 §C fixed the DaVita-under-Government routing in `supabase/functions/daily-briefing/`; live is **v25 (2026-05-12)**, so every briefing still has the bug | from the repo root: `supabase functions deploy daily-briefing --project-ref xengecqvemvfknjvbvrq` (also deploy `_shared/domain-routing.ts` — it ships with the function) | `supabase functions list --project-ref xengecqvemvfknjvbvrq` shows a version > 25 and today's date; tomorrow's briefing lists The Villages under **Dialysis** |
| D2 | Open the PR for INVENTORY1's branch | passes 1–2 are on `claude/inventory1-audit`, unmerged; INVENTORY1b needs them on `main` | `gh pr create --base main --head claude/inventory1-audit --fill` (in `C:\Users\scott\life-command-center`), merge when CI is green | the two audit files + CSV appear under `docs/audits/` on `main` |

## Power Automate (the FLOWS1 seven)

Open each flow at `make.powerautomate.com` → environment *NorthMarq Capital, LLC* → the flow → **Edit**.

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
| P1 | **Harris County (HCAD) owner payload** — for each of the 50 Harris dia properties, the HCAD record (account type Commercial vs Personal, owner name, account no.) exported by hand from the portal; drop as a CSV/JSON into `SB notes/` | OWNERGAP2 Harris adapter (payload-only by design; the portal is bot-walled) |

## Housekeeping

| # | item |
|---|---|
| H1 | If `git pull` ever says `cannot lock ref 'ORIG_HEAD'`: `Remove-Item -Force C:\Users\scott\life-command-center\.git\ORIG_HEAD.lock` then retry. (Cowork's file bridge cannot delete lock files it leaves behind; the commit scripts now clear it first.) |
