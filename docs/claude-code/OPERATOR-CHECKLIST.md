# Operator checklist — steps only Scott can do

The one list of manual actions the build is waiting on: deploys that do not ride Railway, edits in
systems the repo cannot reach (Power Automate, Salesforce), payloads only a human can fetch, and
decisions that are Scott's. Cowork adds a row when a round ends on one of these; Scott ticks it; Cowork
verifies and removes it in the next turn. Done rows are struck through and dropped after one turn.

Updated 2026-09-16 (late): H5 done — 19 Harris owners applied; **H6 (full HCAD roll load) is the one open run step**; decisions S1–S4 still Scott's. Railway auto-deploys `main` (web app at `ac96fd45`); the standalone MCP
service has no `/version` route — Cowork verifies it by calling a tool.

## Deploys

| # | step | why | how | verify |
|---|---|---|---|---|
| ~~D1~~ | ✅ `daily-briefing` v26 (2026-09-16) | | | behavioural check: next briefing lists The Villages under Dialysis |
| ~~D2~~ | ✅ INVENTORY1 branch merged | | | |

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
| **H6** | 🔴 **Full-roll HCAD load — the 41 still-open Harris targets need streets the 37-row subset does not cover.** From the repo root, with `DIA_SUPABASE_URL` and `DIA_SUPABASE_SERVICE_KEY` added to `.env.local` (Supabase dashboard → Dialysis_DB `zqzrriwuavgrquhisnoa` → Project Settings → API: URL + `service_role` key), run `node --env-file=.env.local scripts/hcad-pdata-load.mjs --file "C:\Users\scott\Downloads\Real_acct_owner.zip" --file-year 2026` (dry run: prints total / F1+F2 counts and a sample row), then the same with `--apply`. Alternative to the env vars: `--dsn "<Dialysis_DB postgres connection string>"`. It streams the 889 MB file and upserts in 1,000-row batches on `(acct, file_year)`; the existing 37 rows are overwritten with identical values (same `owner_name` = `owners.txt`, `mailto` → `owner_name_2`). ~71k rows; expect a few minutes. Paste the dry-run and apply output into the chat. | `node --env-file=.env.local scripts/hcad-pdata-load.mjs …` | Cowork re-runs the Harris dry run (population 50), you approve the read, Cowork applies; then the "how many of the 4,014 have an owner" number is re-measured. |

## Decisions (Scott's)

| # | decision | options | where it lands |
|---|---|---|---|
| **S1** | **PRI2 side-by-side** — is the new Priority list (`priority_tab_v2`) the one you would work first? | Cowork produces `docs/audits/PRI2_SIDE_BY_SIDE_2026-09.md` (top 20 of V1 vs V2 for one real day) next turn; you mark which rows you would actually work; flag ON/OFF follows your read. | backlog `PRI2` |
| **S2** | **Operators tile** — show 21 canonical operators, 45 raw names, or "21 (+878 properties with an unresolved operator name)"? | recommended: the third — it makes ID1's fragmentation visible | backlog `DIA1b-operators` |
| **S4** | **Two flows on one trigger** — *Flagged Email Intake* and *Outlook Intake to Teams* both fire on "email flagged" and race on the same message (the FLOWS1 404s). Keep both with F2/F3 ordering, fold the Teams card into the intake flow, or make one the only trigger? | recommended: (b) one flow owns the message lifecycle — a later Power Automate edit, not urgent now that F2/F3 hold | backlog `FLOWS-consolidate` |
| **S3** | **Geocoding flags** — `GEOCODIO_API_KEY` / `GOOGLE_MAPS_API_KEY` are OFF with no reason recorded | turn one on with a monthly cap, or record "off by decision" | backlog `FLAGS-geocode` |

## Housekeeping

| # | item |
|---|---|
| H0 | If `git pull` says `cannot lock ref 'ORIG_HEAD'`: `Remove-Item -Force C:\Users\scott\life-command-center\.git\ORIG_HEAD.lock` then retry (the commit scripts clear it first). |
