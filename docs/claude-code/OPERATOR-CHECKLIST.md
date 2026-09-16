# Operator checklist — steps only Scott can do

The one list of manual actions the build is waiting on: deploys that do not ride Railway, edits in
systems the repo cannot reach (Power Automate, Salesforce), payloads only a human can fetch, and
decisions that are Scott's. Cowork adds a row when a round ends on one of these; Scott ticks it; Cowork
verifies and removes it in the next turn. Done rows are struck through and dropped after one turn.

Updated 2026-09-16 (late): all three prompts merged and running; open for Scott: **D3** (merge Dialysis PR #7416), **V1** (where the gov ingest runs), decisions **S1–S5** below. Railway auto-deploys `main` (web app at `ac96fd45`); the standalone MCP
service has no `/version` route — Cowork verifies it by calling a tool.

## Deploys

| # | step | why | how | verify |
|---|---|---|---|---|
| ~~D1~~ | ✅ `daily-briefing` v26 (2026-09-16) | | | behavioural check: next briefing lists The Villages under Dialysis |
| ~~D2~~ | ✅ INVENTORY1 branch merged | | | |
| **D3** | 👤 Merge **Dialysis PR #7416** (removes the ID3d migration + pytest guard from the `Dialysis` repo; the LCC copy landed in #2539) | the doctrine: Dialysis_DB schema is recorded here, not there | GitHub → sbriggssjc/Dialysis → PR #7416 → merge | Cowork checks the file is gone from `Dialysis` main |
| **V1** | 👤 **Where does `public_record_ingest.py` run?** GOVDEED3 (gov PR #406) changed `save_deed_record`'s accept gate; it is merged, but the gov ingestion is a Python process — if it runs on your machine or a scheduled task from a checked-out copy, pull `government-lease` main there; if it runs on a Railway/other service, redeploy it. | tell Cowork where it runs, or pull/redeploy | Cowork checks the next ingest's rejected-row log for `placeholder` reasons and that `deed_records` dateless count stops growing (5,671 on 2026-09-16) |

## Power Automate

Step-by-step guide: `docs/setup/POWER-AUTOMATE-FLOW-FIXES-2026-09-16.md`. F1–F7 **applied and verified
from the exported definitions** (`SB notes/done/*.zip`, 2026-09-16). One addendum:

| # | flow | edit | why |
|---|---|---|---|
| ~~F1c~~ | ✅ **Done and verified from the export 2026-09-16** (`Http-Getfile(LCCGetArtifact)_20260916163609.zip`): metadata first, Size condition, content fetch in the True branch, bytes Response as specified. Test passed. | |

**All seven applied and verified.** Forward the next Saturday digest into `SB notes/`; Cowork closes the counts.

## Runs / data

| # | step | how | verify |
|---|---|---|---|
| ~~H1–H4~~ | ✅ **Done by Cowork 2026-09-16** from `Downloads\Real_acct_owner.zip` + `pdataCodebook.pdf`: file is tab-delimited with the expected headers; F1 = 68,811 / F2 = 2,465; the stage table migration was applied (it had never run) and a **37-row targeted subset** (the accounts on the 50 target streets) loaded. The loader itself cannot read the 889 MB file (`RangeError: Invalid string length`) and `.env.local` has no Dialysis credentials — both in `OWNERGAP2-harris-b`. | | |
| ~~H5~~ | ✅ **Done 2026-09-16 (Cowork, Scott's go).** Second dry run on deployed `ac96fd45` (PR #2531): 19 resolved / 31 refused; applied under batch `ownergap2_harris_tx_20260916` → **wrote 19**; properties with an owner 5,494 → 5,517; TX `true_owner_id` fingerprint unchanged. Spot-check for you: `9001 Kirby` → GILCHRIST WILLIAM E (three HCAD accounts on that address; the matcher saw one F1/F2 owner). | | |
| ~~H6~~ | ✅ **Done 2026-09-16 — by Cowork from the VM after your two runs.** Run 1 had no DIA creds (every chunk 503'd, reported as `undefined`). Run 2 with creds reported `wrote 0` but had landed 53,000 rows; the other 19 chunks died on a duplicate-key error the loader never printed (no `on_conflict` on the POST), and **every row had `owner_name` NULL** (the file has no `name` column). Cowork patched a copy of the loader and re-ran: **71,282 rows staged, all with an owner**. Third dry run: 1 resolvable, 2 need S5, 27 are house numbers HCAD does not carry. Loader fixes → `OWNERGAP2-harris-c` (send it). Your `.env.local` creds are correct — keep them; the 2027 load will work once harris-c is merged. | | |
| ~~H7~~ | ✅ **Applied 2026-09-16** — AMALGAMATED HOUSTON HOLDINGS LLC written for `2626 South Loop West`; the ledger row had to be hand-repaired (id 125) → `OWNERGAP2-ledger-order`. | | |

## Decisions (Scott's)

| # | decision | options | where it lands |
|---|---|---|---|
| **S1** | **PRI2 side-by-side** — is the new Priority list (`priority_tab_v2`) the one you would work first? | Cowork produces `docs/audits/PRI2_SIDE_BY_SIDE_2026-09.md` (top 20 of V1 vs V2 for one real day) next turn; you mark which rows you would actually work; flag ON/OFF follows your read. | backlog `PRI2` |
| **S2** | **Operators tile** — show 21 canonical operators, 45 raw names, or "21 (+878 properties with an unresolved operator name)"? | recommended: the third — it makes ID1's fragmentation visible | backlog `DIA1b-operators` |
| **S4** | **Two flows on one trigger** — *Flagged Email Intake* and *Outlook Intake to Teams* both fire on "email flagged" and race on the same message (the FLOWS1 404s). Keep both with F2/F3 ordering, fold the Teams card into the intake flow, or make one the only trigger? | recommended: (b) one flow owns the message lifecycle — a later Power Automate edit, not urgent now that F2/F3 hold | backlog `FLOWS-consolidate` |
| **S3** | **Geocoding flags** — `GEOCODIO_API_KEY` / `GOOGLE_MAPS_API_KEY` are OFF with no reason recorded | turn one on with a monthly cap, or record "off by decision" | backlog `FLAGS-geocode` |
| **S5** | **HCAD class C2 accounts** — two open Harris clinics sit on accounts HCAD classes **C2** (Texas PTAD "vacant commercial lot"): `380 E Little York Rd` → `380 LITTLE YORK LLC`, `10311 S Post Oak Rd` → `LUEL PARTNERSHIP LTD`. The load and matcher are F1/F2 only by the OWNERGAP2-harris prompt's rule. | (a) allow C2 when the situs matches exactly (the owner LLC is named for the address in one case), or (b) keep F1/F2 and leave them for a parcel-discriminator pass | harris-c built the switch on the loader and matcher; **if (a):** one small prompt wires an `include_classes` parameter on the tick and Cowork re-stages with `--include-classes C2` and runs the dry run; **if (b):** nothing more to build |

## Housekeeping

| # | item |
|---|---|
| H0 | If `git pull` says `cannot lock ref 'ORIG_HEAD'`: `Remove-Item -Force C:\Users\scott\life-command-center\.git\ORIG_HEAD.lock` then retry (the commit scripts clear it first). |
