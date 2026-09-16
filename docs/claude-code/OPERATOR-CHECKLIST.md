# Operator checklist — steps only Scott can do

The one list of manual actions the build is waiting on: deploys that do not ride Railway, edits in
systems the repo cannot reach (Power Automate, Salesforce), payloads only a human can fetch, and
decisions that are Scott's. Cowork adds a row when a round ends on one of these; Scott ticks it; Cowork
verifies and removes it in the next turn. Done rows are struck through and dropped after one turn.

Updated 2026-09-16 (late). Railway auto-deploys `main` (web app at `8ab35ec9`); the standalone MCP
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
| **F1c** | **Http → Get file (LCC Get Artifact)** | You applied option B (metadata + link), which is right for large files but removed the bytes for *all* files. Add a **Condition** after `Get file metadata using path`: `Size` **is less than** `20000000`. **If yes** → a `Response` with the *old* body: `{ "ok": true, "content_base64": "@{base64(body('Get_file_content_using_path'))}", "content_type": "@{body('Get_file_metadata_using_path')?['MediaType']}" }` (Status 200). **If no** → the metadata `Response` you already built, with `"ok": false, "reason": "too_large"` added to its JSON. Save; test with one small file and one large. | LCC's `fetchSharepointBytes()` still expects `content_base64`; since option B, every artifact fetch fails softly. LCC's half (both shapes + dead-letter) is prompt `FLOWS1-artifact`; run F1c first or together. |

After F1c and the LCC round: forward the next Saturday digest into `SB notes/`.

## Runs / data

| # | step | how | verify |
|---|---|---|---|
| **H1** | Download HCAD's bulk roll | `https://hcad.org/pdata/pdata-property-downloads.html` → **Real_acct_owner.zip** (no login). Save anywhere, e.g. `C:\Users\scott\Downloads\Real_acct_owner.zip`. | file size tens of MB |
| **H2** | Check the commercial class codes | open `https://hcad.org/assets/uploads/pdf/pdataCodebook.pdf`, find `state_class`; confirm **F1/F2** are commercial real and **L1/L2** business-personal. If different, tell Cowork (one-line edit in `api/_shared/hcad-pdata-parse.js`). | |
| **H3** | Dry-run the loader (repo root) | `node scripts/hcad-pdata-load.mjs --file C:\Users\scott\Downloads\Real_acct_owner.zip --file-year 2026` | printed counts: total rows, commercial rows, one sample row — paste them to Cowork |
| **H4** | Apply | same command + `--apply` | `select count(*) from hcad_real_acct_stage` on Dialysis_DB (Cowork checks) |
| **H5** | Tell Cowork "H4 done" | Cowork runs the tick dry run (`jurisdiction=harris_tx`), you approve the 20-row read, Cowork applies and re-measures, same as Philadelphia. | |

## Decisions (Scott's)

| # | decision | options | where it lands |
|---|---|---|---|
| **S1** | **PRI2 side-by-side** — is the new Priority list (`priority_tab_v2`) the one you would work first? | Cowork produces `docs/audits/PRI2_SIDE_BY_SIDE_2026-09.md` (top 20 of V1 vs V2 for one real day) next turn; you mark which rows you would actually work; flag ON/OFF follows your read. | backlog `PRI2` |
| **S2** | **Operators tile** — show 21 canonical operators, 45 raw names, or "21 (+878 properties with an unresolved operator name)"? | recommended: the third — it makes ID1's fragmentation visible | backlog `DIA1b-operators` |
| **S3** | **Geocoding flags** — `GEOCODIO_API_KEY` / `GOOGLE_MAPS_API_KEY` are OFF with no reason recorded | turn one on with a monthly cap, or record "off by decision" | backlog `FLAGS-geocode` |

## Housekeeping

| # | item |
|---|---|
| H0 | If `git pull` says `cannot lock ref 'ORIG_HEAD'`: `Remove-Item -Force C:\Users\scott\life-command-center\.git\ORIG_HEAD.lock` then retry (the commit scripts clear it first). |
