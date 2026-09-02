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
| **OCR1** | ✅ **First run done 2026-09-02 (tesseract only).** Next, after OCR1c merges: `pip install paddlepaddle` → `node scripts/ocr-bakeoff.mjs --run --model real --engines tesseract,paddleocr --control self` (the 15 PDFs are still staged; baselines fetched). **Surya goes to the GaryBuilt box** — it runs its VLM in a Docker container and needs the GPU. | Whether local OCR is at DocAI parity. ⚠️ The page-cap half is already answered YES (141 pages read in one pass); what is open is quality, and it is unreadable until the self-agreement control exists. |
| **B6e-ci-required-check** | **Three steps, in order:** (1) merge Dialysis **#7397** (docs-only, ready — it is the live proof the docs-only path reports); (2) delete branches `claude/tmp-red-gate-proof` and `claude/tmp-docs-only-proof` in the GitHub UI; (3) **Dialysis → Settings → Branches → `main` → Require status checks → add `Run Tests`** (exact name; `Build Check` optional — it is skipped on docs-only PRs, so requiring it would re-create the deadlock). | **The whole B6 CI arc.** Prep is done (#7395): `paths-ignore` removed, Scope job, `Run Tests` always reports, gate seen RED, docs-only path proven. Without the toggle a red suite fails a job and blocks nothing — #7395 itself merged 3 m 30 s in with the suite still running. |
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
| **PR2-gov** | **Run the gov parcel-stat backfill?** `node scripts/pr2-backfill-sidebar-parcel-stats.mjs --domain government --apply` — 1,527 `costar_sidebar` parcel rows with 0 stats, ceiling 1,230 SF / 1,192 year built / 1,155 lot / 310 zoning. Same fixed parser, reversible by batch tag. Left un-run on 2026-09-02 rather than widen a dia-scoped change; nothing blocks it. **Also confirm the Railway redeploy carries `98248e18`** (`/version`) — until it does, new sidebar captures still drop the stats. |
| ~~**AUTH**~~ | ✅ **SETTLED 2026-08-29 — not a decision any more.** `GET /api/diag?kind=auth-ready` returned `lcc_env: production`, `enforcing: true`; `/api/*` IS auth-enforced and `CURRENT-STATE.md` §1 was corrected. *(Row closed 2026-09-02; it had outlived the answer by four days.)* |

---

## How to use this page

- **Do a row → tell the chat → the canonical backlog row gets closed and this page updated.** Both,
  in the same turn (`BUILD-TURN-PROTOCOL.md` step ⑤).
- **This page must not accumulate detail** the backlog does not have. If it starts disagreeing with
  `PLANNED-BACKLOG.md`, **the backlog wins** — and that disagreement is itself the defect
  (`data-coherence-invariants.md` **I1**: two stores, one fact, name which is canonical).
- ⚠️ **A row leaving here should be because it was DONE or DECIDED, never because it got quiet.**
