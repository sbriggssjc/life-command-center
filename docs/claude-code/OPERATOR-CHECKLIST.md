# Operator checklist — steps only Scott can do

The one list of manual actions the build is waiting on: deploys that do not ride Railway, edits in
systems the repo cannot reach (Power Automate, Salesforce), payloads only a human can fetch, and
decisions that are Scott's. Cowork adds a row when a round ends on one of these; Scott ticks it; Cowork
verifies and removes it in the next turn. Done rows are struck through and dropped after one turn.

Updated 2026-09-16 (late): S1–S5 answered (`responses/done/S1-S5 Decisions…docx`) and turned into F8, D4, three prompts and the PRI2 read; V1 answered (gov deed ingest = GitHub Actions weekly/daily, verify Mon 09-21); D3 reported done. All three prompts merged and running (`0304aa8b`); D4 done. H8 applied, R1 delegated. Open for Scott: **F8** (the flow consolidation — `docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md`) and sending `PRI2-on`. Railway auto-deploys `main` (web app at `ac96fd45`); the standalone MCP
service has no `/version` route — Cowork verifies it by calling a tool.

## Deploys

| # | step | why | how | verify |
|---|---|---|---|---|
| ~~D1~~ | ✅ `daily-briefing` v26 (2026-09-16) | | | behavioural check: next briefing lists The Villages under Dialysis |
| ~~D2~~ | ✅ INVENTORY1 branch merged | | | |
| ~~D3~~ | ✅ Dialysis PR #7416 merged (Scott, 2026-09-16) | | | |
| ~~D4~~ | ✅ `GEOCODIO_API_KEY` set on `tranquil-delight` (Scott, 2026-09-17); cap ledger migration applied by Cowork; first tick 120/120 by Geocodio. | | | |
| ~~H8~~ | ✅ Applied 2026-09-17 — LUEL PARTNERSHIP LTD 2-03 for `10311 S Post Oak`, ledgered (`state_class=C2`). Harris 21 of 50. | | |
| ~~V1~~ | ✅ **Answered 2026-09-16.** The Railway `public-record-ingest` service is the *Dialysis* repo's module; the gov deed writer runs from GitHub Actions (`ci.yml` daily 08:00 / weekly Mon 06:00 UTC) and checks out `main` each run — GOVDEED3 is live from the next run. Cowork verifies Mon 2026-09-21 (dateless `deed_records` inserts that day = 0). | | |

## Power Automate

Step-by-step guide: `docs/setup/POWER-AUTOMATE-FLOW-FIXES-2026-09-16.md`. F1–F7 **applied and verified
from the exported definitions** (`SB notes/done/*.zip`, 2026-09-16). One addendum:

| # | flow | edit | why |
|---|---|---|---|
| ~~F1c~~ | ✅ **Done and verified from the export 2026-09-16** (`Http-Getfile(LCCGetArtifact)_20260916163609.zip`): metadata first, Size condition, content fetch in the True branch, bytes Response as specified. Test passed. | |
| **F8** | **FLOWS-consolidate (S4 = one flow owns the lifecycle)** — click-path in `docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md`: pre-check for a *Move Queue Executor* flow, copy four actions from the Hardened flow into *LCC Flagged Email Intake*'s success branch, delete its own `Move email (V2)`, re-point three expressions, test with one flagged email, turn the Hardened flow off, export into `SB notes/`. | the message is moved by two movers today (the Flagged flow and the Move Message flow) — the FLOWS1 404/PreconditionFailed class |

**All seven applied and verified.** Forward the next Saturday digest into `SB notes/`; Cowork closes the counts.

## Runs / data

| # | step | how | verify |
|---|---|---|---|
| ~~H1–H4~~ | ✅ **Done by Cowork 2026-09-16** from `Downloads\Real_acct_owner.zip` + `pdataCodebook.pdf`: file is tab-delimited with the expected headers; F1 = 68,811 / F2 = 2,465; the stage table migration was applied (it had never run) and a **37-row targeted subset** (the accounts on the 50 target streets) loaded. The loader itself cannot read the 889 MB file (`RangeError: Invalid string length`) and `.env.local` has no Dialysis credentials — both in `OWNERGAP2-harris-b`. | | |
| ~~H5~~ | ✅ **Done 2026-09-16 (Cowork, Scott's go).** Second dry run on deployed `ac96fd45` (PR #2531): 19 resolved / 31 refused; applied under batch `ownergap2_harris_tx_20260916` → **wrote 19**; properties with an owner 5,494 → 5,517; TX `true_owner_id` fingerprint unchanged. Spot-check for you: `9001 Kirby` → GILCHRIST WILLIAM E (three HCAD accounts on that address; the matcher saw one F1/F2 owner). | | |
| ~~H6~~ | ✅ **Done 2026-09-16 — by Cowork from the VM after your two runs.** Run 1 had no DIA creds (every chunk 503'd, reported as `undefined`). Run 2 with creds reported `wrote 0` but had landed 53,000 rows; the other 19 chunks died on a duplicate-key error the loader never printed (no `on_conflict` on the POST), and **every row had `owner_name` NULL** (the file has no `name` column). Cowork patched a copy of the loader and re-ran: **71,282 rows staged, all with an owner**. Third dry run: 1 resolvable, 2 need S5, 27 are house numbers HCAD does not carry. Loader fixes → `OWNERGAP2-harris-c` (send it). Your `.env.local` creds are correct — keep them; the 2027 load will work once harris-c is merged. | | |
| ~~H7~~ | ✅ **Applied 2026-09-16** — AMALGAMATED HOUSTON HOLDINGS LLC written for `2626 South Loop West`; the ledger row had to be hand-repaired (id 125) → `OWNERGAP2-ledger-order`. | | |

## Decisions (Scott's)

**S1–S5 answered 2026-09-16** (`responses/done/S1-S5 Decisions desktop response.docx`); each row now says what it became. One read is still open (R1).

| # | decision | options | where it lands |
|---|---|---|---|
| ~~S1~~ ~~R1~~ | ✅ Delegated to Cowork 2026-09-17 → recommendation ON with reason-first order + one card per property → `prompts/PRI2-on-…md` (**send it**). | | backlog `PRI2-on` |
| ~~S2~~ | ✅ **One operator identity everywhere**; canonical count is the only number; the 878 unresolved are the work | → `prompts/DIA1c-…md` (send) | backlog `DIA1c` |
| ~~S4~~ | ✅ **(b) one flow owns the lifecycle** | → **F8** above (your edit, step by step) | backlog `FLOWS-consolidate` |
| ~~S3~~ | ✅ **Free tier on** (Geocodio 2,500/day, capped in code; Google stays off) | → **D4** above + `prompts/FLAGS-geocode-on-…md` (send) | backlog `FLAGS-geocode-on` |
| ~~S5~~ | ✅ **(a) with an exact-situs rule** — C2 accounts staged (98,804 rows now) | → `prompts/OWNERGAP2-harris-d-…md` (send); Cowork runs the C2 dry run after merge | backlog `OWNERGAP2-harris-d` |

## Housekeeping

| # | item |
|---|---|
| H0 | If `git pull` says `cannot lock ref 'ORIG_HEAD'`: `Remove-Item -Force C:\Users\scott\life-command-center\.git\ORIG_HEAD.lock` then retry (the commit scripts clear it first). |
