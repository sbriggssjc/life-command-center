# 👤 Operator actions — the things only Scott can do

**Created 2026-08-29.** `PLANNED-BACKLOG.md` carries **68 `👤` markers scattered across a dozen
sections**, so there was no single place to see what is blocked on the operator rather than on a
build. **This page is that view.** It is a *lens on the backlog, not a second backlog* — every row
points at its canonical row, and **the backlog row stays authoritative.**

> **Why this matters now:** the build queue has outrun the operator queue. Several of the
> highest-value items in the system are not waiting on Claude Code — they are waiting on a key
> rotation, a log nobody but Scott can reach, or a decision.

---

## ⏸️ 1. Security — ROTATION DEFERRED BY DECISION (Scott, 2026-08-29)

> **Decision: all credential rotation is deferred until a second user is added to LCC.**
> Rationale: single-user, still building, private repo — the exposure has no second party to reach.
> **This is a recorded risk acceptance with a trigger, not an oversight.** The rows stay open below
> so the decision cannot go quiet.

### 🔔 The trigger is broader than "another user" — these all mean *rotate first*

**The private repo is what is carrying this risk**, so anything that widens who can read it fires
the same trigger:

- **adding a second LCC user** (the stated trigger), **or**
- **making the repo public**, **or**
- **sharing the repo / granting access to a contractor, vendor, or Northmarq IT**, **or**
- **a lost or compromised laptop**, **or**
- **taking LCC out of "still building" into anything a client touches.**

**Any one of those → rotate before it happens, not after.**

### ✅ Still worth doing NOW, because it stops the problem growing

**SEC4 is not a rotation and should stay active** — a pre-commit / CI check for JWT-shaped,
`sb_secret_`, and long-hex strings in `*.json` flow exports and `*.txt` config files. **Deferring
rotation is a decision about the keys that are already exposed; SEC4 is what stops the next export
adding more.** Without it, the rotation you eventually do is against a moving target.

| # | Action | Status |
|---|---|---|
| **SEC2** | Rotate `LCC_API_KEY`, then untrack `wave0-config-values.txt`. ⚠️ Rotation is what neutralises it — `git rm --cached` leaves the value in history and in every clone. Order when you do it: **rotate → update Railway → `git rm --cached` + `.gitignore` → only then consider history.** **Do not reach for `filter-branch`** (this repo nearly lost a 475 MB mailbox that way). | ⏸️ **DEFERRED** — trigger above |
| **I1** | Rotate the `PA_WEBHOOK_SECRET` (`X-PA-Webhook-Secret`), committed inline in a PA export. Covers the Google-Alert / RCM / LoopNet shared secret. | ⏸️ **DEFERRED** |
| **SEC3** | Rotate the Supabase keys in the PA packages — **ten of seventeen** carry literal JWT-like values; `sync-sf-activities-to-supabase.md` still reads *"Credential rotation completed: **TBD**"*. | ⏸️ **DEFERRED** |
| **SEC4** | **The guard** — pre-commit / CI check for secret-shaped strings in flow exports and config files. | 🟢 **KEEP ACTIVE** — it stops new exposure while rotation waits |

## 🔴 2. Blocked builds — an agent cannot finish these without you

| # | Action | What it unblocks |
|---|---|---|
| **OCR1** | ⚠️ **The box run (19:00 UTC) graded NO GPU engine — two install steps missed.** (1) `run_check()` said *"1 CPU"*: install the GPU wheel for the CUDA `nvidia-smi` shows (`pip uninstall paddlepaddle` first; then `pip install paddlepaddle-gpu` from the index for that CUDA — see paddlepaddle.org.cn/en/install) and re-run `run_check()` until it names the GPU. (2) surya: `python -c "from surya.settings import settings; print(settings.SURYA_INFERENCE_BACKEND, type(settings).model_fields['SURYA_INFERENCE_BACKEND'])"` — if a non-vllm value (llama.cpp) is allowed, `$env:SURYA_INFERENCE_BACKEND='<that value>'` and run without Docker; otherwise Docker Desktop with GPU. Then: `node scripts/ocr-bakeoff.mjs --run --model real --engines surya,paddleocr,tesseract --control self`. ✅ EXT2 floor re-run DONE 2026-09-03 (7/8 source agreement; 299 resolved; 255 fired the named schedule-blend risk → EXT2a + 👤 the Chesterbrook spot-check below). | Whether a GPU engine reaches the DocAI floor (OCR1b / DOC14 decision), and whether EXT1 moved the floor. |
| **UX0-paste** | **Canon 1.7.0 is rendered; push it to the external surfaces** per `docs/os/SURFACE-SYNC-PROTOCOL.md`: (1) Copilot Studio — paste `docs/copilot/agent-instructions.md` below `---`, re-upload `docs/os/surfaces/copilot.canon.md` as Knowledge `LCC-CANON.md`, Publish; (2) ChatGPT — replace Knowledge file with `docs/os/surfaces/chatgpt.canon.md`; (3) Northmarq Claude Project — `surfaces/northmarq.canon.md` into the project instructions per `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md`; (4) personal/Cowork skills pick up `claude-personal.canon.md` / `claude-cowork.canon.md`. | Every surface stops recommending buyer-contact SF linking and other plumbing as human work (Global invariant 8). Until pasted, only the repo and the in-app Copilot carry 1.7.0. |
| **B6e-ci-required-check** | **Three steps, in order:** (1) merge Dialysis **#7397** (docs-only, ready — it is the live proof the docs-only path reports); (2) delete branches `claude/tmp-red-gate-proof` and `claude/tmp-docs-only-proof` in the GitHub UI; (3) **Dialysis → Settings → Branches → `main` → Require status checks → add `Run Tests`** (exact name; `Build Check` optional — it is skipped on docs-only PRs, so requiring it would re-create the deadlock). | **The whole B6 CI arc.** Prep is done (#7395): `paths-ignore` removed, Scope job, `Run Tests` always reports, gate seen RED, docs-only path proven. Without the toggle a red suite fails a job and blocks nothing — #7395 itself merged 3 m 30 s in with the suite still running. |
| ~~**PR5c-deploy**~~ | ✅ **DEPLOYED 2026-09-03 (Cowork, via MCP): `availability-checker` v20 → v21.** Health probe green (dia/gov/ops all configured); a live 3-listing run returned a clean 200 apply envelope. `availability_scraper` provenance now lands when the cron hits a listing WITH a URL and a definitive verdict — note `PR5c-avail-field` (dia rung `status` vs writer `is_active`) still gates dia expectations. |
| ~~**UX13a**~~ | ✅ **DECIDED 2026-09-02: deferred — configure the body-sweep flow for each new user at onboarding** (with their `public.users` id, P116). Until then Team Pulse / voice corpus / attribution are single-mailbox by design. | — |
| **PR5d-a** | ✅ **Subscription access CONFIRMED — Scott has the Loan tab and opens it on every capture.** Refined 2026-09-03: **3 `loans` rows were written today and all carry `costar_loan_id` NULL, `is_cmbs=false`** (still 0 of 662 dia / 0 of 2,219 fleetwide) — so the property-page scanner captures the loan SUMMARY while `parseCmbsLoanDetail` never fires. **The open question is now WHICH section, not access.** 👤 **Cheapest next input: a screenshot of the Loan tab on a CMBS-financed property** (one showing servicer / watchlist / DSCR), so the scanner can be pointed at the right block. |
| **PR5d-b** | **Turn on `properties.track_cmbs_snapshots` for dia?** It is `false` on **11,803 of 11,803** and gates snapshots/tenants/financials — so even a successful dia capture writes nothing to those. Your call whether dia CMBS depth is worth the ingest. |
| **B6d-cms-restart** | **Pull the Railway deploy logs for `cms-ingestion`.** | ⚠️ **A live two-month outage on dia's clinical spine.** Every CMS run is being **abandoned** (killed mid-flight); B6d-cms removed the crashed-run latch — the *consequence* — but **nothing explains what is killing them.** Claude Code cannot reach those logs. **If the next 06:00 UTC run also abandons, the latch was never the cause.** |
| **B6d-sam** | **Re-issue `SAM_API_KEY`.** | Every `ingest_sam_opportunities.py` run since 2026-08-24 fails **401**. ⚠️ **Check whether one credential rotation also took out CMS** before treating the two as unrelated. |
| **AI4** | **Two manual paste-ins**: the Copilot Studio `LCC Deal Agent` BOV action (`property_lookup` + `cre_property_id`, previously-required fields optional), and `~/.claude/skills/bov-underwriting/SKILL.md` (record-first line + deliverable-naming block). | **The code shipped; the doors did not.** Until both land, **the two highest-traffic BOV entry points are not at parity** — the entire point of that layer. Nothing in the repo can catch this. |
| **I4** | **Turn off the `SF → LCC: Daily Bulk File Backfill` PA flow.** | It has failed daily at ~11:26 UTC since June. "Turn it off" was recorded **2026-06-01** and never confirmed. |
| **M8** | **Build LoopNet PA Flow 3** (spec: `.github/PA_FLOWS.md` §Flow 3). | **0 LoopNet leads have ever landed.** The code half is shipped and mounted. |

## 🤔 3. Decisions — nobody should build past these

| # | Decision |
|---|---|
| **R1** | **Supabase 3 → 1 consolidation.** A complete 7-phase plan with rollback, **never executed, never refuted**, still cited as live by a July audit. ⚠️ Its Phase 0 inventory is stale in ways that matter (edge-function split; the **retired-but-answering Vercel deployment**; `/api/*` auth). |
| **I8** | **R1's two blocking Phase-0 steps:** the **PG15 → PG17 restore test** and the **audit of PA flows for direct Supabase URLs**. |
| **I16** | **Render migration — keep as a triggered contingency, or formally retire it.** Four named triggers, none fired; the team never grew, which is *why*. ⚠️ **An undecided contingency is why four root files named four different hosting targets.** |
| **I19** | **Assign owners for PA flows and edge functions** — the deployment runbook literally says `TBD`. (`FLOW-REGISTRY.yaml` does record you as owner for all 17 baseline flows; **PA5**'s three unregistered flows are the gap.) |
| **I3** | **Supavisor pooler move** (txn-mode 6543). ⚠️ Was filed *only* as a pointer into a file being archived — **a pointer into an archive is not a filing.** |
| **J1 (P1c)** | **The multi-owner ownership edge** — one SPE resolving to **N** true owners with roles (JV partner, GP/LP, DST beneficiary). Needs your model of how you think about JV ownership before anyone builds it. |
| ~~**EXT2**~~ | ✅ **DECIDED 2026-09-03: the lease defines base rent, year 1 (at Rent Commencement) and the tenant (the counterparty legal entity = the credit; a parent without an express guaranty is not liable).** Prompt drafted; CC builds. Spot-check doc 255 = `PROPERTIES\C\Chesterbrook Academy\Champaign, IL\Rec'd\Chesterbrook - Champaign, IL (Lease).pdf`. |
| ~~**UX39 · UX41**~~ | ✅ **DECIDED 2026-09-02: keep both; move them off the headline tab row to a back-end/admin screen** (backlog UX39b/UX41b, done with UX-T2). |
| ~~**ENTC-confirm**~~ | ✅ **DONE 2026-09-03 — Scott approved all 15; merged server-side via `lcc_merge_entity`.** 14 external identities moved, 0 portfolio edges (contact-only, as predicted). `metadata.goes_by` stamped on all 15 survivors at Scott's request (→ backlog **ENTC-goes-by**: nothing reads it yet). Reverse any one with `lcc_unmerge_entity('<loser_id>')`. |
| ~~**junk80-apply**~~ | ✅ **SEEDED 2026-09-03 (Cowork, server-side): 80 proposals in `junk_entity_review` — 41 `dismiss` / 39 holds, batch `junk80_sql_20260903`.** Seeded by direct SQL because the HTTP handler 500s (filed **ENTC-seed-500**; the doc's `?action=` was also wrong — the admin dispatcher keys on `?_route=`). **What remains yours: work the cards in the Decision Center junk lane.** Do not bulk-confirm — the 39 holds are `uncertain` on purpose (6 rows ARE their own mailbox's person; 27 carry an SF identity). Reversible via `junk_review_batch`. |
| **N15e** | **Make `entities (workspace_id, canonical_name)` an enforced UNIQUE key?** 6,608 groups violate it today on the N15c key (was 3,930 on the old keys — collapsing keys is what surfaced them, and read on named rows they are real duplicates: `Realty Income` ×5, `Office Properties Income` ×8). It is the only thing that closes the last two 0.14 s duplicate-mint races (PR5c-entities-c-race); until then ~0.6% residual. Options: merge-down first then constrain; or constrain with a suffix strategy for genuine same-name different parties (`David Siegel` ×2 person/org). Evidence: `entity-identity-and-dedup.md` §2. |
| ~~**EXT2-spotcheck**~~ | ✅ **DONE 2026-09-03 — Scott uploaded the lease and it was read.** Exhibit B: *"Base rent of $7,445 per month plus $1,019 per month for equipment. Total payment each month $8,464"* — escalations apply to the $7,445 and months 121-180 explicitly exclude the equipment payment. **The lease defines base = $7,445 → `year1_rent` 89,340, equipment as `additional_rent`, total 101,568.** Encoded as ground truth in `prompts/EXT2a-schedule-line-carries-its-own-definition.md`. |
| **PR9** | **Should a human-confirmed clinic↔property link outrank the `auto_link_*` family?** `manual_verify`@20 governs **673 rows, all one field** — a human confirming the link — and today sits at parity with automation rather than above it. Options: raise to @1 alongside `manual_edit` (a human confirmation wins), or keep it recorded-only @20 (verify ≠ assert). Nobody decided it on purpose; it governs 673 real writes. Evidence: `PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md` §6. |
| ~~**PR2-gov**~~ | ✅ **DONE 2026-09-03 — run server-side from Cowork** (Scott's shell had no `*_SUPABASE_*` vars). gov `costar_sidebar` parcels: `building_sf` 0 → **1,192**, `land_area_sf`/`acres` 0 → **1,109**, `year_built` 0 → **1,153**, `zoning` 0 → **291**; 1,230 rows, 0 unit errors, all pre-states blank. Reversible: `update parcel_records p set building_sf=b.building_sf, land_area_sf=b.land_area_sf, land_area_acres=b.land_area_acres, year_built=b.year_built, zoning=b.zoning from _pr2_parcel_stats_backup_pr2govcowork20260903 b where b.parcel_id=p.parcel_id;`. ⚠️ One row (APN `0403`) excluded — CoStar states a 52,903-acre lot. **Still yours: one dia CoStar capture** (PR2 producer proof — last was 08-31; the Hillsboro capture wrote a sale, not a parcel row, because that page had no Public Record panel). |
| ~~**AUTH**~~ | ✅ **SETTLED 2026-08-29 — not a decision any more.** `GET /api/diag?kind=auth-ready` returned `lcc_env: production`, `enforcing: true`; `/api/*` IS auth-enforced and `CURRENT-STATE.md` §1 was corrected. *(Row closed 2026-09-02; it had outlived the answer by four days.)* |

---

## How to use this page

- **Do a row → tell the chat → the canonical backlog row gets closed and this page updated.** Both,
  in the same turn (`BUILD-TURN-PROTOCOL.md` step ⑤).
- **This page must not accumulate detail** the backlog does not have. If it starts disagreeing with
  `PLANNED-BACKLOG.md`, **the backlog wins** — and that disagreement is itself the defect
  (`data-coherence-invariants.md` **I1**: two stores, one fact, name which is canonical).
- ⚠️ **A row leaving here should be because it was DONE or DECIDED, never because it got quiet.**
