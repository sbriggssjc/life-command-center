# R4 verification record + R5 backlog (2026-06-05)

Standalone file (the R4 audit doc kept getting reset by branch merges —
verification records now live separately).

## R4-A/B/C — LIVE VERIFIED (2026-06-05)

- **R4-A:** CHECK constraint applied + VALIDATED on LCC Opps (one straggler
  row from the old build normalized first) — 6th-spelling guard live.
  CORRECTION: the "(Unknown) degraded detail" symptom on prop 44309 was a
  testing artifact (`openUnifiedDetail(db, ids)` takes an ids OBJECT; a bare
  number short-circuits to the search-record fallback). Invoked correctly,
  44309 renders fully first-class (Fresenius Buckeye header, completeness
  rail 22/POOR, Next-Step banner "Pull the recorded owner"). The identity
  fragmentation was real and fixed regardless.
- **R4-B:** honest lease buckets (<6mo 407 = 3.8% · <1yr 793 · expired/
  holdover 4,798 with stale-cohort note, methodology labeled); ALL-TIME COMPS
  11,911/$83.7B; leads 11,537 avg $7.66M; GSA 52,828 of 261k events / $5.8B /
  FRPP 266M SF / 21,947 properties.
- **R4-C:** Inbox "New" 6,827 → **1,426** with verdict cards (⚠ Needs review ·
  Create property → / View extraction → / Promote (OM) ↻) + bulk Dismiss;
  queue heroes show **"Log touch →"** with plain-language reasons ("Onboarding
  touch overdue (developer)"); P0.5 value-sorted ($15.5M rent first);
  "⚡ Open top 20 opportunities" present; Today flagged-emails 3,008 → 899.

## R4-D residue (prompt written: CLAUDECODE_PROMPT_R4D_residue.md)

1. Data-proxy allowlist 403s: dia `deed_records`, gov `sf_activities`.
2. gov `v_sales_comps` 500 statement-timeout (57014), recurring.
3. gov LLC-queue widget fetch returns SPA HTML (unmounted-route class).
4. **Stale JS cache-bust `?v=2026050802`** — deploys don't bust browser
   caches (likely contributor to the 6/03 stale-exports incident).
5. NBA top-10 duplicates (+ "$950M" magnitude-class row resurfaced).
6. Gov page-top action item still on the old expiration predicate (7,589
   "within 6 months" incl. long-expired vs the fixed section's 407).
7. Cap quartiles "0 loaded comps" + NM "0 of 0 TTM" vs TTM tiles 1,172 —
   client-side calcs not yet on the server aggregates.
8. sales-comp xref price-disagreement console spam → belongs in a review lane.
9. Carried: §5 skeleton sweep on remaining lazy sections; reflow debounce
   (deferred by design).

## R4-D — LIVE VERIFIED (2026-06-05, post-redeploy)

- **#4 Cache-busting:** all bundles serve `?v=a35851601cda` (commit SHA) —
  every future deploy now self-busts browser caches.
- **#5 NBA:** top-10 all distinct property ids; the $950M magnitude row is
  suppressed.
- **#6 Gov action item:** "407 leases expiring within 6 months" — exactly
  matches the section bucket (was 7,589).
- **#1/#2/#3/#7:** console CLEAN on fresh gov overview load AND dia detail
  open — zero 403s (deed_records / sf_activities), zero 57014 timeouts, zero
  HTML-parse errors, zero xref spam. LLC-queue widget no longer
  "unavailable". (The 67 xref conflicts now live in dia
  `v_data_quality_issues` as `sales_price_xref_conflict`.)
- **Cron pulse:** last 90 min of pg_net responses on LCC Opps — all JSON
  200/202 (rematch, geocode, merge-log replay, BD owner-sync feeds); no HTML
  responses, no errors. The newly mounted routes are executing.

**Intake-drain epilogue (the crons finished the job overnight):**
`review_required` **2,900 → 457 (−84%)** · matched 321 → **862** (+541 OMs
attached to their properties) · finalized 1,358 · non-deal discarded 2,606.
The remaining 457 ≈ genuinely-new-property residue (create-from-intake
candidates) + cooldown stragglers — exactly the population the F4 button and
the (still dark) INTAKE_AUTOCREATE flag exist for.

## R5 — SPE→parent reconciliation + buyer-vs-prospect doctrine (Scott, 2026-06-05)

Observed on the live Priority Queue: several P0.5 rows are **SPEs controlled
by the same top buyer** (NGP Capital: "NGP VI FALLS CHURCH VA LLC", "NGP VI
PHOENIX AZ LLC"; likewise USGBF entities). Doctrine to encode BEFORE
opportunity-opening happens at scale:

1. **One buyer, one account.** Never several open opportunities across SPEs
   controlled by the same parent. The queue should band/rank the PARENT with
   its SPE portfolio rolled up, not each shell.
2. **Top repeat buyers don't get standard prospect opportunities at all.**
   They're buy-side relationships — prospect them by sending showings for
   our listings and from the buy side. At most a **"Government Buyer"
   opportunity type** on the account — and on the **actual parent account in
   Salesforce, never the subsidiary**.
3. **Reconciliation is a GATE:** SPE→parent resolution must happen BEFORE
   open_opportunity/create_lead opens anything on an entity that looks like
   an SPE of a known buyer. Buyer parents are knowable from
   sales_transactions buyer history + the existing
   `lcc_operator_affiliate_patterns` / `v_lcc_operator_affiliates` machinery
   (extend the pattern table to buyer parents like NGP).
4. **Immediate caution:** "⚡ Open top 20 opportunities" would currently
   mass-create exactly these wrong-anchor opportunities — the SPE gate
   should land before bulk-open gets real use.

Audit scope when taken on: identify repeat-buyer parents from TTM/all-time
buyer history (both domains); map SPE naming patterns → parent accounts (SF
parent-account linkage); de-dupe/void any already-opened SPE-level
opportunities (soft-disposition doctrine); queue-side parent rollup; the
open-time gate; "Government Buyer" opportunity type routed to the SF parent
account.

### R5 — SHIPPED + DB-side LIVE (2026-06-05, branch pensive-curie-bLZt9)

Grounding: gov buyers Boyd Watterson 787/$13.5B · NGP 169/$2.7B · Easterly
215 (×3 spellings) · Elman/Tanenbaum/UIRC/GPT/HC/CoreCivic/Saban; dia buyers
Elliott Bay 80 · Sumitomo/SMBC 186 (×3) · MassMutual/ExchangeRight/Kingsbarn/
AEI/Realty Income/Agree. Zero open opps on SPEs pre-gate (clean ground).

Shipped: `relationship` column on lcc_operator_affiliate_patterns (operator
consumers re-scoped); **24 buyer parents** in new `lcc_buyer_parents` (SF ids
prefilled 7/24); GATE = appended backward-compatible refusal in
`lcc_open_prospect_opportunity` + **BEFORE-INSERT trigger** (deploy-order-
proof, blocks prospect opps on buyer parents/SPEs on ANY path);
`government_buyer` opp type + `lcc_open_government_buyer_opportunity`
(idempotent, parent-only, SF routing held for unmapped via
`v_lcc_government_buyer_sync_health`); **P-BUYER lane** (one row per parent,
portfolio rollup); `v_lcc_buyer_name_canonical` analytics normalizer.

Live-verified: 86/491 P0.5 were buyer SPEs → P0.5 = 402 with 0 SPEs;
P-BUYER = 18 parents; NGP gate test blocked → government_buyer on parent →
already_open on repeat; trigger blocks direct inserts; test artifacts cleaned.

**Open items for Scott:** (1) confirm USGBF's true controlling sponsor
(registered as own parent, `needs_sf_mapping`); (2) optionally rename parent
anchors (Boyd → "Boyd Watterson Global", AEI → "Aei Capital Corp", GPT →
"Government Properties Income Trust LLC"); (3) map remaining 17/24 parents to
SF parent accounts (research tasks auto-created when a buyer opp opens
unmapped). UI verification (P-BUYER lane render, refusal UX, bulk-open
skip-and-report) pends the Railway redeploy of merged main.

## R6 — APPLIED + LIVE VERIFIED end-to-end (2026-06-05)

Migrations applied by me (gov anon view → 4 LCC files in order; patched two
nested-`$$` quoting hazards in the cron DO blocks). Owner-facts sync run
manually: **17,875 gov rows mirrored**. Results, all verified live:

- **Band flip:** P0.5 402 → **16** genuinely-ready · **P0.4 = 348** "Resolve
  Ownership Control" · P-BUYER 18 → **21 parents**. Tier-0 more than doubled
  Boyd's resolved rollup (70 → **147 SPEs / 179 properties** in the hero).
- **Tier-0 per-row truth:** 8/12 FGF shells → Boyd Watterson Global
  (`domain_true_owner`); ARLINGTON VA I FGF correctly P0.4 with
  "true_owner_known_connect: **The Shooshan Company**"; OPI BND → Pine
  Properties. Queue rows render reason + property + "Open property →" into
  the resolution ladder. R5 NGP refusal regression ✓.
- **Chain-to-developer:** completeness view live; first **100 research tasks**
  generated rent-first (`trace_ownership_to_developer`); daily cron at 05:10.
- **Hotfix saga (PR #1062):** queue API 500'd post-apply. My first diagnosis
  (JS reference bug) was WRONG — Claude Code proved the real mechanism: the
  unfiltered enriched view is genuinely ~5-7s; a wasted `Prefer: count=exact`
  pushed it past the 8s AbortController → abort → Promise.all reject → 500.
  (My "queries never arrived in Supabase logs" = aborted mid-flight; my
  "0-50ms post-ANALYZE" = filtered probe.) Fixes: countMode none, 25s
  timeout on the two heavy reads, band-counts soft-fail, ANALYZE baked into
  the sync finalize. Verified live: API 200 in 6.7s, page renders.

**R7 candidate (queued):** materialize the buyer-parent rollup — the ~1M-row
HashAggregate (`lcc_match_buyer_parent_by_name` nested loop) runs on EVERY
queue read and is the 5-7s floor under the 25s band-aid. Pairs with the dia
owner-facts leg + chain phase 3(c) as the natural next round.

## R7 — Decision Center: ALL THREE SLICES SHIPPED + VERIFIED (PR #1063, 2026-06-05/07)

- **Slice 1 (perf):** `lcc_buyer_spe_resolved` + `lcc_priority_queue_resolved`
  cache-or-live tables (empty cache = exact live behavior); band membership
  byte-identical; queue API ~1.8-2.7s end-to-end (was 6.7s), counts 68ms;
  25s band-aid removed; crons */15 + */5 active. Root cause was a 1.05M-row
  planner mis-estimate on the SPE view consumed 3× per read.
- **Slice 2 (shell + lanes):** `lcc_decisions` (soft-disposition, ids+scalars
  context) + open/verdict/refresh RPCs + cron; Decision Center UI (Review
  Console renamed) with "Confirm the true owner" (142 — the
  true_owner_known_connect subset of P0.4, rent-ranked, ARLINGTON/Shooshan on
  top) and "Buyer parents & SF mapping" (18 incl. USGBF sponsor question);
  legacy lanes under "More review work". **Verification caught a silent
  effect failure** (research verdict recorded success without writing the
  task) — fixed effect-first/outcome-truthful; closed-loop re-verified on the
  same reopened decision (real research_tasks row, honest effects, count 141).
- **Slice 3 (gated write-back):** `gov_apply_manual_true_owner()` RPC
  (SECURITY DEFINER, service_role-only, dry_run DEFAULT TRUE, idempotent)
  writing the full gov provenance chain (manual_change_events,
  field_value_provenance rank-90 override, provenance_event_log
  source='manual_decision', ownership_history manual_correction). LCC `stale`
  verdict: record-only until **`DECISION_GOV_WRITEBACK=on`** in Railway env
  AND gov subject; dia falls through to record-only (owner-facts leg
  deferred). Verified on synthetic row 990000001 only; zero residue.

**Scott's activation checklist:** (1) merge + Railway redeploy; (2) work a few
lane cards (USGBF sponsor, an SF mapping, a Shooshan-class stale verdict with
`dry_run` preview); (3) when satisfied, set `DECISION_GOV_WRITEBACK=on` —
accumulated `stale_pending_writeback` verdicts can then be re-applied/flushed.
**Backlog still open:** dia owner-facts leg; chain phase 3(c); Decision Center
Phases 2-3 (convert legacy lanes; gate-predicate sweep; automation→lane
funnel); duplicate sale activity_events (~1s apart).
