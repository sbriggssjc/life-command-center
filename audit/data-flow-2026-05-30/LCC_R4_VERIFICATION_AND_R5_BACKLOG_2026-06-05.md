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
