# 👤 Operator actions — the things only Scott can do

**Created 2026-08-29.** `PLANNED-BACKLOG.md` carries **68 `👤` markers scattered across a dozen
sections**, so there was no single place to see what is blocked on the operator rather than on a
build. **This page is that view.** It is a *lens on the backlog, not a second backlog* — every row
points at its canonical row, and **the backlog row stays authoritative.**

> **Why this matters now:** the build queue has outrun the operator queue. Several of the
> highest-value items in the system are not waiting on Claude Code — they are waiting on a key
> rotation, a log nobody but Scott can reach, or a decision.

---

## 🔒 1. Security — do these first

| # | Action | Why it can't wait |
|---|---|---|
| **SEC2** | **Rotate `LCC_API_KEY`, then untrack `wave0-config-values.txt`.** | It is **tracked in git at the repo root in plaintext**, not gitignored. ⚠️ **Rotation is what neutralises it** — a `git rm --cached` leaves the value in history and in every clone. Order: rotate → update Railway → `git rm --cached` + `.gitignore` → *only then* consider history. **Do not reach for `filter-branch`** (this repo nearly lost a 475 MB mailbox that way). |
| **I1** | **Rotate the `PA_WEBHOOK_SECRET`** (`X-PA-Webhook-Secret`). | Committed **inline in a Power Automate export**; rotation never confirmed. Covers the Google-Alert / RCM / LoopNet shared secret. |
| **SEC3** | **Rotate the Supabase keys in the PA packages.** | **Ten of seventeen** deployed PA packages carry **literal JWT-like values**, and `sync-sf-activities-to-supabase.md` has an unresolved P0 reading *"rotate exposed Supabase keys immediately — Credential rotation completed: **TBD**"*. ⚠️ **I1 covers only the webhook secret; this is separate and larger.** |

## 🔴 2. Blocked builds — an agent cannot finish these without you

| # | Action | What it unblocks |
|---|---|---|
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
| **I19** | **Assign owners for PA flows and edge functions** — the deployment runbook literally says `TBD`. (`FLOW-REGISTRY.yaml` does record you as owner for all 17 baseline flows; **J5**'s three unregistered flows are the gap.) |
| **I3** | **Supavisor pooler move** (txn-mode 6543). ⚠️ Was filed *only* as a pointer into a file being archived — **a pointer into an archive is not a filing.** |
| **J1 (P1c)** | **The multi-owner ownership edge** — one SPE resolving to **N** true owners with roles (JV partner, GP/LP, DST beneficiary). Needs your model of how you think about JV ownership before anyone builds it. |
| **AUTH** | ⚠️ **`CURRENT-STATE.md` and `CLAUDE.md` disagree on whether `/api/*` is auth-enforced.** One command settles it: **`GET /api/diag?kind=auth-ready`**. Until then **neither page should be quoted on auth.** |

---

## How to use this page

- **Do a row → tell the chat → the canonical backlog row gets closed and this page updated.** Both,
  in the same turn (`BUILD-TURN-PROTOCOL.md` step ⑤).
- **This page must not accumulate detail** the backlog does not have. If it starts disagreeing with
  `PLANNED-BACKLOG.md`, **the backlog wins** — and that disagreement is itself the defect
  (`data-coherence-invariants.md` **I1**: two stores, one fact, name which is canonical).
- ⚠️ **A row leaving here should be because it was DONE or DECIDED, never because it got quiet.**
