# Operator checklist — steps only Scott can do

The one list of manual actions the build is waiting on: deploys that do not ride Railway, edits in
systems the repo cannot reach (Power Automate, Salesforce), payloads only a human can fetch, and
decisions that are Scott's. Cowork adds a row when a round ends on one of these; Scott ticks it; Cowork
verifies and removes it in the next turn. Done rows are struck through and dropped after one turn.

Updated 2026-09-16 (late): S1–S5 answered (`responses/done/S1-S5 Decisions…docx`) and turned into F8, D4, three prompts and the PRI2 read; V1 answered (gov deed ingest = GitHub Actions weekly/daily, verify Mon 09-21); D3 reported done. All three prompts merged and running (`0304aa8b`); D4 done. F8 done; PRI2-on live. EDGE-GATES1 merged and verified live (`f4acfdd9`); Q1 fixed (second calendar flow), enforce clock runs to 09-20; PR #2563 had reverted STATUS + backlog to a week-old snapshot — restored in round 26. Open for Scott: **send `RECON1`** (the Banning clinic note — one clinic as three properties, the post-ingest reconciler) and **`GUARD-CLOBBER1`** (the CI guard so no round can do that again), **Q29**, confirming the DEPLOY2 CI job ran green, and **HOME2-on** — Cowork turned `home_three_lanes` ON for the workspace 2026-09-17 (there is no Settings panel for flags: `SETTINGS-FLAGS1`); reload Home and say what you see — plus the **Scott's queue** below (Q1–Q28 — the 67 backlog rows that were waiting on you, tiered). Saturday: forward the flow digest into `SB notes/`. Monday: Cowork checks GOVDEED3. Railway auto-deploys `main` (web app at `ac96fd45`); the standalone MCP
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
| ~~F8~~ | ✅ **Done and verified from the export 2026-09-17** (`LCCFlaggedEmailIntake_20260917152101.zip`): three actions pasted, own Move/Flag/Terminate removed, expression re-pointed, retry set; Hardened + Processing Complete → Move Message off. | |
| ~~F8-b~~ | ✅ Done 2026-09-17 (Scott). | |

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

## Scott's queue — everything the backlog is waiting on you for (swept 2026-09-17)

> **Why this exists.** Reviewing the INVENTORY1/1b work against the to-do lists (2026-09-17) found the
> real gap was not in the inventory: **67 backlog rows carry a 👤 state, and this checklist held five of
> them.** The rest were scattered across nineteen sections, some since August. Every one is here now,
> tiered by what it costs you and what it unblocks; the source row has the full evidence. Nine rows
> were already done and only their state was stale — fixed in the backlog, not listed here. When you
> clear a line, tell Cowork; the row and this line close together.
>
> **Tiers:** **A** exposure or breakage, do soon · **B** ten-minute admin steps · **C** decisions that
> unblock building (reply in chat) · **D** rollout chores in your tenant, batch when convenient ·
> **E** waiting on a real run or a re-run, not on a decision · **F** design-only, parked on purpose.

| # | tier | what you do | why / unblocks | row |
|---|---|---|---|---|
| Q1 | **A** | ~~Re-check the calendar flow~~ **Done 2026-09-17** — the hourly caller was a second flow ("Outlook Calendar - Life Command Center Sync"); header added. Log: last `DENY-WOULD … /sync/calendar-events` 18:26 UTC, clean since. **Round 28 re-read (20:30 UTC): `/sync/calendar-events` still clean (19:27 slot silent), but `/sync/activities` fired `DENY-WOULD` at 20:01 UTC — that flow does not send the header yet, and the same is expected of `/sync/sf-tasks` (next 21:00 UTC) and `/sync/flagged-emails`. ☐ Add the same header to those three Power Automate flows. The 3-day clock restarts from the last `DENY-WOULD` on ANY route, so the earliest enforce is now ≥ 2026-09-20 20:01 UTC and moves with each miss. ☐ PL-14: open the Vercel dashboard — is project `life-command-center` still deployed? If yes, check its function log at 2026-09-17 19:19:39 UTC (a `POST …/ai-copilot/chat` from AWS Ashburn, UA `node`, got a 400) and say what called it; if it is dead weight, delete the project.** Previously: nothing to do until the 3-day clock runs: **earliest `COPILOT_AUTH_MODE=enforce` = 2026-09-20 evening**, Cowork re-reads the log each turn and confirms the three rarer routes (`/sync/activities`, `/sync/sf-tasks`, `/sync/flagged-emails`) as they fire. One blocker surfaced: an unnamed `POST /chat node other` caller (PL-14) — if you know of anything besides the browser and Railway that calls the copilot chat route, say so. **Round 32 (09-18 12:00 UTC): three of four flows are clean. `Sync SF Activities to Supabase` is NOT — `DENY-WOULD` at 00:01 / 04:01 / 08:01 / 12:01 UTC, workflow id `5706ffc6bd394b5b8bc9117121aebb8b`.** ☐ Open it (`https://make.powerautomate.com/environments/Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f/flows/5706ffc6bd394b5b8bc9117121aebb8b/details` — if that id does not resolve, open it by name), find the HTTP action whose URI ends `/ai-copilot/sync/activities` (it may not be the only HTTP action), confirm the header `X-PA-Webhook-Secret` is on **that** action with the same value as the calendar flow, and **Save**. Next run 16:01 UTC tells us. **Round 33 — found it in your export:** the header key on the Sync SF Activities HTTP action is `X-PA-Webhook-Secret` **followed by a line break** (the export shows `X-PA-Webhook-Secret\n`, on the `/sync/activities` action and on `PostDeadLetter`). A header with a newline in its name is not the header the gate checks. ☐ Open the HTTP action, delete the header row, add it again typing the key by hand (no paste), Save, re-export to `SB notes/`. The 16:01 UTC run then decides. | ☐ retype the header key (newline) | waiting on the clock + Q30 | COPILOT-OPEN |
| Q2 | **A** | `salesforce-enrichment`: v27 (log-only gate) has been live since 09-09; no caller has hit it in the last 24 h. **Nothing to do until ≈2026-10-09** (one monthly cycle) — then Cowork reads the log and you flip `SFENRICH_AUTH_MODE=enforce`; or name the monthly caller now and skip the wait. | unauthenticated public writer, one known monthly caller | DRIFT1-sfenrich, PL-3 |
| Q3 | **A** | Execute `docs/os/RUNBOOK_vercel_teardown.md` in order (repoint the daily-briefing caller, the mobile Shortcut, the extension/Copilot connector hosts, then tear down). The browser extension is **still writing through the retired Vercel build** from at least one profile. | two hosts writing the same tables | J13-teardown, EXT-HOST, J13 |
| Q4 | **A** | Set `PA_WEBHOOK_SECRET` on `tranquil-delight` and walk the RAILWAY-PA-SECRET steps (register caller IPs, watch `none` lines 3 days, flip `PA_WEBHOOK_AUTH_MODE=enforce`). | every Power Automate → LCC call is currently unauthenticated | RAILWAY-PA-SECRET |
| Q5 | **B** | Dialysis CI: (1) merge #7397, (2) delete `claude/tmp-red-gate-proof` + `claude/tmp-docs-only-proof` in GitHub, (3) Settings → Branches → `main` → require status check **`Run Tests`**. | until (3), a red Dialysis suite cannot block a merge — three merges have landed mid-run | B6e-ci-required-check |
| Q6 | **B** | LCC Opps → Auth → enable **leaked password protection** (one toggle). | advisor finding | SEC6 |
| Q7 | **B** | Dialysis_DB → Postgres upgrade (advisor: vulnerable version). Off-hours; Cowork verifies after. | security advisor | SEC12 |
| Q8 | **B** | Fund the Anthropic API key with a **hard monthly cap**, or say "no" — the briefing snapshot fn has failed its call daily since July. | MB5 / the cloud fallback; a wasted call a day | EB1b |
| Q9 | **B** | Hand `GOVDEPLOY1` to the `government-lease` repo (a prompt there; Cowork drafts it on your word) — the gov project has no unapplied-migration detector. | three merged-not-applied migrations in two days here; gov has no detector at all | GOVDEPLOY1 |
| Q10 | **C** | Confirm in one line: **Dialysis_DB schema is owned by `life-command-center`** (the doctrine table already says so; two rounds went to the wrong repo this week). Then ID3a-d-dia becomes "reconcile the two migration sets", never "retire one". | CANON-OWNERSHIP1, ID3a-d-dia | CANON-OWNERSHIP1 |
| Q11 | **C** | `docs/audits/FLAG_LONG_DARK_TRIAGE_2026-09-15.md` — five decisions on the 15 long-dark flags (each is "turn on with a cap / record off by decision"). Same shape as S3, which took you one line. | closes 15 registry questions | FLAGDARK1 |
| Q12 | **C** | Six lanes with zero lifetime completions (`milestone_confirm` 56 open, `confirm_tenant_mismatch` 26, `npi_new_registration` 17, …) and `match_disambiguation` (1 decision in 81 days): per lane, **surface it, or retire it**. | stops ranking queues nobody works | A5-dead, A7 |
| Q13 | **C** | ~2,044 subjects falsely closed `gap_resolved` by the truncated-feed bug: approve the **re-label first** sequence (Cowork + CC recommend it) or say leave them. | A5b-repair |  A5b-repair |
| Q14 | **C** | Rule for **banks/trustees as owner-of-record** (Truist, Wells Fargo NA, JPM CMBS trusts): prospect, or exclude as lender/trustee? One rule, measured first, not 15 name picks. | the seller queue's reach lane | N3c |
| Q15 | **C** | Sponsor confirmations: **FGF ↔ Boyd Watterson** (90 SPEs ride on it — settle the relationship before confirming either), Commonwealth (recommend NO), Carrington/Sequoia, fcp→fcpdc.com, tmg→tmgdc.com. | C2k widened only attested rows; these are the held ones | V8a, V8b, AC1c |
| Q16 | **C** | `v_lcc_entities_c_review_merge_plan`: 15 person merges, per-row confirm (winner/loser/basis shown; swap before confirming where `ownership_tiers_all_zero`). | 55 blind pairs stay blind until then | PR5c-entities-c-review |
| Q17 | **C** | dia CMBS arm: flip `track_cmbs_snapshots` on (11,803 rows, snapshot + tenant rows per capture) or leave dia's CMBS lane at zero. | 27 of 121 rungs cannot fire | PR5d-b |
| Q18 | **C** | dia owner lane: fix two over-capturing `owner_canonical_patterns` (one wrong link already written — `HealthCare Realty Solutions` → `Healthcare Realty Trust`), and decide the **tenant-in-the-owner-slot** rule (395 of 500 lane properties). | the lever that moves dia owner coverage | OWN1, OWN4 |
| Q19 | **C** | Close DOC14 (the GCS OCR build) — DOC17 proved the cheap route (~$3.30 for nine calls). Say "close". | a stale decision | DOC14 |
| Q20 | **C** | Grade `OWNERSHIP_CHAIN_ROLE_LABELS` (the endpoint exists; read `summary.providers`, `chains_altered_by_layer2` = 0, then the labels) or leave the flag off. | N2 |  N2 |
| Q21 | **C** | HP1-P1a-orphan: two demonstrably abandoned Salesforce opps in your open queue — confirm they can be closed; then the rule for the rest. | "My Work is well behind" | HP1-P1a-orphan |
| Q22 | **C** | Team mailboxes: Kelly, Nate and Sarah have no `email_bodies`; adding their mailboxes is a Power Automate step — do you want them synced? | four-person team, one mailbox | UX13a |
| Q23 | **D** | External pastes owed from UX0 (operator doctrine into the ChatGPT persona / Northmarq project), plus the P8 rollout chores: S1 persona, S2 surface bundles, S3 the two Copilot specialists, S4 Work IQ config, S5 Office Script + flow, S6 the four `_WORKFLOW` docs, S8 blank BOV templates, S9 Northmarq admin connector, S10 D-drive triage. Batch on a quiet afternoon; Cowork can turn any one into a click-path like F1–F8. | your tenant, not the repo | UX0, S1–S10 |
| Q24 | **D** | Probe B (2 minutes: `flow-lcc-probe-outlook-contact-write.json`); write the Salesforce allowlist with per-entry sign-off; close WebEx/Teams as "not used for external contacts". | contact reconciliation outbound | CR2, CR5, CR6 |
| Q25 | **D** | ASC50 human reviews: 50 primary scorecards in `/asc-review.html`, then 22 second-reviewer rows. | the ASC lane's publication gate | ASC50-R1, ASC50-R2 |
| Q26 | **D** | W3 draft/file/log wiring for the offer-submission flow — needs your Drafts/deal-folder conventions confirmed once. | work products | W3 |
| Q27 | **E** | Waiting on real runs, nothing for you: CQM1 full-table run; PRI5 fresh run; CFE-RUNAWAY (confirm #7398 merged + service not paused); HCRIS-TIMEOUT (the other session's); V4 (edge fn source), V5 (`PA_OUTLOOK_DRAFT_FLOW` registry vs reality); EXT1/EXT2 floor re-runs on your workstation; OCR1 GPU box. | verification, not decision | CQM1, PRI5, CFE-RUNAWAY, HCRIS-TIMEOUT, V4, V5, EXT1, EXT2, OCR1 |
| Q28 | **F** | Design-only, parked on purpose: J1 multi-owner edge, N17 fractional ownership, PI6 alias ledger, N13 test-suite prune (measure first), C4a/C4b role questions, SF-DIRECT (no IT ask until there is a product to show), A5g/A5h (egress gates). Nothing to do until a lane needs them. | | J1, N17, PI6, N13, C4a, C4b, SF-DIRECT, A5g, A5h |
| Q29 | **D** | ~~Your own name appears three times in `brokers`~~ **Answered 2026-09-17:** all three are Scott (1373 Northmarq, 2076 bare duplicate, 2437 Stan Johnson); keep firm attribution by date via `broker_company_history`, not a flat merge; firm 126 (`scott briggs`) → Northmarq. Recorded on `BR4-b`. | done | BR4-b |
| Q30 | **A** | **The LCC window you use is the old Vercel site, running old code.** ☐ Open `https://tranquil-delight-production-633f.up.railway.app` in Chrome, sign in, and look at Home — that is where the three-lane Home (and everything since early September) lives. Tell Cowork what Home looks like. ☐ If it works: uninstall the current LCC desktop app (⋯ menu → Uninstall) and install it again from the Railway URL. ☐ Do **not** delete the Vercel project yet — Cowork needs its env-var list compared with Railway's first (Vercel → Project → Settings → Environment Variables: names only, no values). **Round 31: steps 1–2 done ✅ (Railway Home seen in Chrome and the reinstalled desktop app; the three lanes did not show because the build has no markup for them — HOME2-fix, not you).** Still yours: ☐ Vercel → Settings → Environment Variables, send the **names**; ☐ stop opening the `vercel.app` address anywhere (bookmarks, phone). **Round 32:** the lanes are live but two show wrong data (HOME2-b) — no need to look again until HOME2-b ships. ☐ Vercel env-var names still needed. **Round 33:** env-var names audited → `docs/architecture/vercel-teardown-env-audit.md`. ☐ On Railway (both services) confirm every column-A name exists (names, not values). ☐ Scroll the Vercel list between `FOLDER_FEED_…` (Jun 11) and `INTAKE_EXTRACTION_ENABLED` (Apr 20) — the screenshots skipped it — and open the two `RE…EY` rows to read their full names. ☐ Then delete the Vercel project. | ☐ Railway check → delete | VERCEL-LIVE1, HOME2 |
| Q31 | **A** | ☐ `responses/RECON2-b desktop response.docx` saved as **0 bytes** (Word lock file beside it) — re-save it so the round's own summary is on file. ☐ Read the **7 leases** RECON2-b now calls confirmed-expired (2 CMS closed/relocated with no operating clinic, 4 `status=Terminated`, 1 successor lease — listed by `select * from dia_recon2_classify_expired_leases(null) where proposed_state='expired_confirmed'`) and say confirm / hold; nothing is written until you do. **Round 33:** response re-saved ✅. The 7 leases are laid out in `docs/audits/RECON2-b-confirmed-expired-leases-review-2026-09-18.md` with Cowork's read per row — mark confirm / hold / wrong and say so in chat; a CC round runs the confirmations. | ☐ read the 7 | RECON2-b |
| Q32 | **B** | **Where should the three-lane Home sit?** Today is ~1,800 px tall, so "right after Today" is still off-screen. (a) lanes above Today; (b) lanes replace Today's SIGNIFICANT block (same seller queue) so Today keeps IMPORTANT + URGENT; (c) leave it. One letter in chat → `HOME2-c` becomes a prompt. | ☐ | HOME2-c |
| — | note | **SEC9 / SEC10 (rotate `LCC_API_KEY`, rotate `service_role`)** are governed by the standing P0s decision — rotation deferred until a second user is added — and are listed there, not here. If that decision changes, they move to tier A. | | SEC9, SEC10, P0s |

## Housekeeping

| # | item |
|---|---|
| H0 | If `git pull` says `cannot lock ref 'ORIG_HEAD'`: `Remove-Item -Force C:\Users\scott\life-command-center\.git\ORIG_HEAD.lock` then retry (the commit scripts clear it first). |
