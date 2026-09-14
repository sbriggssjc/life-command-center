# EB1 — Executive Briefs foundation: measure the machinery, lay the fact/issue/note tables (no rendering)

**Repo: `life-command-center`.** Schema + contracts + measurement. Everything new ships **flag-gated OFF**.
No email, UI, or model calls change in this prompt.

**Read first:** `docs/architecture/EXEC-BRIEFS-SPEC.md` (v0.2 — Scott's decisions §0, architecture §1–6, build
order §7) · `docs/os/PLANNED-BACKLOG.md` §P18 · exemplars `docs/briefs/exemplars/2026-09-11-*.md` ·
`CLAUDE.md` "Core doctrines" + "Known footguns" · `.github/AI_INSTRUCTIONS.md` (required before `/api/`) ·
`docs/architecture/briefing-analyst-take-onprem.md` · `docs/architecture/daily_briefing_payload_contract.md`.

## Why this, why now

Scott wants the swimlane market briefs, his CTO/CDO build brief and a zero-friction operator-note funnel
**built into the LCC — not a Cowork task that goes stale.** The spec's answer is a *living brief*: the unit of
storage is a sourced, dated **fact** with a staleness TTL; briefs are renders over live facts; issues freeze
the fact set. This prompt lays that substrate and proves the existing machinery it plugs into actually works
today, so every later step (OC-a funnel next) builds on measured ground.

## 1. Measure first (read-only) — report numbers, don't assume

1. `briefing-intel-snapshot` edge fn: which RSS feeds return items today, per stream (healthcare / government /
   net_lease / tax_policy); items/day over the last 7 `briefing_intel_snapshot` rows; failing feeds.
2. Analyst's Take on-box path: flag state, last 7 days' `analyst_take_meta.source` + length (is Ollama still live?).
3. `ANTHROPIC_API_KEY` presence per runtime (Railway services, Supabase edge secrets) and whether the last call
   succeeded — **do not print the key**. Is the web-search tool enabled for the account? If unknown, say so.
4. Scheduler: how LCC ticks are registered and health-checked today (the pattern the new producers must follow).
5. Tagged Outlook intake (`intake-tagged-comm.js`): flag state, rows in the last 30 days — viable for the
   reply-to-note channel?
6. MCP `log_memory` write path — the template for `log_operator_note`.
7. Existing tables that overlap (`cm_report_snapshots`, `cortex_market_intel`, `staged_intake_feedback`,
   Decision Center lanes) — reuse vs new, with reasons.

## 2. Migrations (LCC Opps), per spec §1/§5/§6

`market_brief_facts`, `market_brief_issues`, `build_brief_snapshots`, `operator_notes`, and `producer_runs`
(producer, lane, started/finished, status incl. `skipped` with reason, facts written/superseded, cost if any).
Columns per the spec; `lane` constrained to `dialysis | government | net_lease | broad_net_lease`. RLS consistent
with neighbouring tables. Views: `v_market_brief_live` (live, non-expired facts per lane/section) and
`v_market_brief_staleness` (per lane/section: live / stale / missing counts, last producer run) — the latter is
what XB will audit. If §1.7 shows an existing table already fits, extend it instead and say why.

## 3. Contracts (docs only)

`docs/architecture/market_brief_payload_contract.md` (daily short block + weekly long form + MCP
`get_market_brief` response shape) and `docs/architecture/operator_note_contract.md` (intake payload for every
channel, triage output, routing-table shape, disposition values). Mirror `daily_briefing_payload_contract.md`.

## 4. Seed

Load the dialysis exemplar's facts into `market_brief_facts` (origin `web_research`, `source_date` from the
brief, `fact_kind` per its fact/opinion labels, TTLs per spec §3) via a script under `scripts/` — idempotent,
dry-run by default. Its "unverified" items are **not** loaded as facts.

## 5. What NOT to do

No rendering changes to `briefing-email-handler.js`; no new cloud-model calls; no producer ticks yet; nothing
sends email; no flag flips; no repo content or private DB rows in any prompt to a cloud model (standing doctrine).

## Guard + ship

Tests for the views (staleness math, supersede chain) and the seed script (idempotency). Run the full suite.
Branch `feat/eb1-exec-briefs-foundation`; PR; apply migrations only after review. Engine code touched → redeploy
BOTH Railway services if anything under `api/` changed.

## Ship + record

Update `docs/os/PLANNED-BACKLOG.md` §P18 (EB1 row + any measurement that changes MB/XB/OC rows),
`docs/claude-code/STATUS.md` (newest first), and `CURRENT-STATE.md` if anything is live. Reply with: §1
measurements as a table, migrations applied (y/n), seed counts, and anything that contradicts the spec.
