# LCC Architecture Audit — Refresh & Gap Assessment (2026-08-06)

> **Purpose:** point-in-time refresh of the 2026-07-29 baseline audit
> (`LCC_Data_Architecture_Audit_2026-07-29.md` → plan `LCC_Audit_Rollout_Plan.md`,
> tracked in `ROLLOUT_STATUS.md`). Catalogs what is BUILT + LIVE-VERIFIED, what
> remains, and registers every one-off project as a pick-up-anytime unit for future
> chats (§4). Statuses cross-checked against ROLLOUT_STATUS and live DBs today.

---

## 1. Scorecard by wave (as of 2026-08-06)

| Wave | Theme | Status | Open items |
|---|---|---|---|
| **0** Hygiene & guardrails | repo/schema cleanup, registries, security | **✅ 16/18** | W0.5b (parquet offload decision) ⬜ · W0.6 (dia PG 15.8→17) ⛔ awaiting Supabase support |
| **1** Close the built loops | feedback, template replies, SAM, sidebar, CMS | **✅ 11/13** | W1.4-L1 (superseded → OWNERSHIP_RESEARCH plan doc) 🟨 · W1.5 (CMS ingest cleanup: code complete, dispatch confirm parked) 🟨 |
| **2** Provenance spine | dedup, enums, mirrors, fill-blanks, flush RPC | **✅ 8/8 — CLOSED** | — |
| **3** Ownership engine + queues | county ingest, ORE, comp queues, SF file discovery | **✅ 13/13 — CLOSED** | (drains are ongoing operations, not builds) |
| **4** Entity-resolution modeling | corpus, resolver, 30k backlog, retrain loop | **✅ 4/4 — CLOSED** (2026-07-31) | review pool ~3.3k drains at Scott's pace (operations) |
| **5** Extraction + signal automation | party extraction, signal→task, local LLM | **✅ 2/3** | W5.1 ✅ gov (dia deferred: note pool is bookkeeping) · W5.2 ✅ CLOSED · W5.3 🟨 evaluation pending (data accruing) |
| **6** Structural consolidation | monorepo/CI, SQL templating, dead code, front-end split | **🟨 1/6** | W6.1–W6.5 ⬜ all open · W6.6 monthly audit ✅ live |

**Bottom line:** Waves 0–4 are effectively closed (2 parked decisions + 1 vendor
ticket). Wave 5 closes when W5.3's evaluation is graded. **Wave 6 is the remaining
planned build surface** — five structural units, none started, none blocking.

## 2. What is BUILT, VERIFIED, and RUNNING (the brain as it stands)

**Automated, hands-off (with alarms):**
- Nightly resolver retrain 07:30 UTC (corpus refresh → 3× /train → drift alerts; 21 runs recorded, band floor 0.5 invariant).
- W5.2 signal consumers (3 crons): state-lease distress→tasks, agency-risk high→lane, NPI→tasks/lanes+ledger.
- TX state-lease producer: monthly auto-fetch workflow (gov repo; registry-driven, content-hash gated) → snapshot → diff → events → gov leads + LCC tasks. History back to 2018 (6 snapshots).
- GaryBuilt local LLM carrying production extraction (ollama-primary, cloud fallback; CF-Access tunnel).
- W6.6 monthly standing audit (1st, 14:00 UTC) + weekly SAM pace check (Fri) + retention prunes + provenance flush.
- SF File Discovery PA flow (W3.7c, production-verified) + staging sync.

**Verified engines & ledgers:** provenance spine (fill-blanks + field-priority guard + reversible ledgers everywhere: W4.3 splink batch, W5.1 party_extract_batch, W5.2 research-task ledger); Fellegi-Sunter resolver (trained on 5.4k+145-and-accruing real labels); ORE fail-closed on /match; Decision Center lanes (SF-link review, listing events, agency risk, NPI dedup ×2, suspected sale incl. state lessor-change).

**Data wins landed:** 30,711-row SF-link backlog dispositioned (3,442 auto-linked, 23,817 no-match, ~3.3k human review pool); 106 gov party fills (agreement-only, 100% local LLM); 13 TX prospect leads + 8 distress tasks; 208 June leads; corpus 145 human labels incl. 43 hard negatives.

## 3. Gap assessment (before the next build)

**A. Open alerts needing triage (19 open, several fresh Aug 5):**
`sidebar_promote_pipeline_failed` ×9 (latest 2026-08-05 — ACTIVE, highest count; triage first),
`lcc_health_red` ×3 (Aug 5), `cron_failure` ×1 (Aug 5), `flow_failure` ×1 (Aug 5),
`feed_stale` ×1 (Jul 24), `owner_reconcile_queue_depth` ×1, `resolver_calibration_drift` ×3
(known/by-design — clears as review-lane hard negatives accrue). → **Recommended next
session: alert triage sweep** (may be one root cause across the Aug-5 cluster).

**B. Known data-quality gaps (documented, non-blocking):**
- `v_field_provenance_unranked` 33 rows (costar_sidebar 18, om_extraction 10, rca 3, +2) — registry-coverage gap widening slowly in NON-model sources; W6.6 watches; fix = register priorities for those sources (small unit, §4.9).
- W5.1 disagreement pool 113 rows — future review/training signal, no consumer yet (deliberate; §4.8).
- dia party extraction deferred — dia note pool is bookkeeping strings; needs a richer note source before it yields (§4.7).
- Review pool ~3.3k SF-link candidates — human-paced; each verdict = live link + resolver fuel.

**C. Operational/hygiene:**
- **CF Access service-token rotation** — DEFERRED by Scott to build completion (pair used from Cowork container sessions 35/35c). Rotate + update Railway when declared.
- Monthly state-lease workflow first scheduled fire (2nd @ 09:00 UTC) — confirm gov creds exist as GitHub repo secrets.
- Parked decisions: W0.5b parquet offload; W0.6 Supabase ticket follow-up; W1.5 CMS dispatch confirm; OpenCorporates re-price ~Aug 28.

## 4. PROJECT BACKLOG — one-off builds, pick up ONE per future chat

Each entry is self-contained: grounding doc(s) + next action. Convention: start a
chat with "Pick up backlog item N from AUDIT_REFRESH_2026-08-06".

| # | Project | Size | Grounding docs | Next action |
|---|---|---|---|---|
| 1 | **Alert triage sweep** (Aug-5 cluster: 9× sidebar_promote + health_red/cron/flow) | S–M | lcc_health_alerts live; this doc §3A | Diagnose common root cause; fix or file unit |
| 2 | **LA state-lease onboarding** (U2 — 148 tracked props waiting) | M | `STATE_LEASE_MULTI_STATE_ROLLOUT_PLAN.md` §3–5; gov plan §9 | Cowork recon of LA Div. of Administration lease inventory → registry row → Claude Code parser adapter |
| 3 | **CA → FL → GA state onboarding** (then batch WA/NC/AZ/TN) | M each | same as #2 | After #2 proves the adapter recipe 2nd time |
| 4 | **W5.3 local-LLM evaluation** (closes Wave 5) | S–M | W5.3 row; garybuilt playbook §7; live diagnostics since Aug 1 | Grade ollama-vs-openai on accrued real intakes; verdict in ROLLOUT_STATUS |
| 5 | **W6.5 front-end decomposition** (detail.js 879KB / app.js 643KB) | L | plan §W6.5 | Highest-value W6 unit (de-risks Edit-truncation incidents); Claude Code, staged by tab/route |
| 6 | **W6.2 dia/gov SQL templating** (drift alarm for diverged fn pairs) | M | plan §W6.2 | Start with propagate_sales_recompute / recompute_caps_for_property |
| 7 | **dia note-source enrichment → unlock dia W5.1 apply** | M | W5.1 row grounding; session-35 findings | Identify richer dia narrative source (OM text? CoStar exports?) then re-sample dia |
| 8 | **W5.1 disagreement-pool consumer** (113 rows: a_only/b_only/conflict as review or training signal) | S–M | party_extract_disagreements; W4.1 corpus doctrine | Design gate: human lane or hard-negative proposals (doctrine: needs consumer + gate) |
| 9 | **Provenance registry coverage fix** (unranked 33 → 0) | S | KNOWN_ISSUES entry; §3B | Register priorities for costar_sidebar/om_extraction/rca rows on sales tables |
| 10 | **W6.1 fetcher/extension CI contract** | M–L | plan §W6.1 | Monorepo-or-submodule decision first |
| 11 | **W6.3 unified_contacts home** (migrate to Opps, backlinks 0-populated) | M | plan §W6.3 | |
| 12 | **W6.4 dead-code decisions** (sync.js RCM/LoopNet copy, sos-lookup stub, pipeline/ FastAPI, GOV_EVIDENCE_WORKBENCH deploy-or-retire) | S–M | plan §W6.4; W0.3h note | Decide, don't leave ambiguous |
| 13 | **GaryBuilt expansion — gated ideas** (junk-entity pre-screen, review-lane sort, email triage, briefing narrative, research synthesis) | S each | garybuilt playbook §7 | Each ships only with its own consumer+gate; never auditable gates |
| 14 | **W0.5b parquet offload** (866k gsa_inventory_snapshot_lines rows) | S–M | W0.5b row | Verify analyses read facts tables first |
| 15 | **W0.6 dia PG17 retry** | S (+vendor) | W0.6 row; Supabase ticket | On Supabase support response |
| 16 | **W1.5 CMS dispatch confirm** | S | W1.5 row | Confirm dispatch path; close row |
| 17 | **OpenCorporates re-price decision** | S | parked ~Aug 28 | Calendar-gated |
| 18 | **CF token rotation** (at build completion) | XS | §3C | Zero Trust → Service Auth → rotate → Railway vars |

**Recommended sequencing from here:** #1 (alert triage — health first) → #2 (LA — proven
recipe, biggest unfed footprint) → #4 (W5.3 — closes Wave 5) → #5 (W6.5 — the big
structural de-risk), interleaving #9/#16/#18 as small session-openers.

---
*Refresh convention: re-run this catalog at each wave close or monthly alongside the
W6.6 audit output; update §3 metrics and prune §4 as items complete.*
