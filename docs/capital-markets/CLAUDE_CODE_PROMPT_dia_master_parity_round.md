# Claude Code prompt — master-workbook parity round (dialysis): flag fix + reconciliation completion

> Run in **DialysisProject**. Execution round — the exploration is done and twice-
> corroborated: (1) your R72-tagged reconciliation found 24 of the master's 80
> <=5 deals suppressed by the implausible/exclude flags (20 in-band, avg 8.75%);
> (2) an independent Dec-2025 TTM diff of the deck's exact 32 <=5 deals against
> sales_transactions decomposed the -84 bps into the SAME mechanism plus three
> residual categories listed below. The master comp workbook ("Dialysis Comp Work
> MASTER.xlsx", Sales Comps sheet) is the deck's literal input — simple TTM
> averages of its SOLD CAP by TERM bucket reproduce deck p.22 exactly
> (<=5 = 8.29% n=32, 8-12 = 6.84%). It is the receipt for every change below.

```
GOAL: deck parity on cap-by-term, achieved as named per-deal corrections with
master lineage — no ladder re-rank, no R66x re-fork, single cap-of-record
preserved throughout.

## Step 1 — THE LEVER: fix the over-flagging (authorized)
dia_flag_suspect_cap_rate (cap >10% -> exclude_from_market_metrics) plus the
implausible_unverified quality flag are nulling legitimate high-going-in-yield
deals that the firm's own curated workbook includes.
- UN-SUPPRESS where the master corroborates: any sale whose cap is in-band
  (4-12%) AND matches a master Sales Comps row (R72-tagged or matchable by
  address/state/date/price) gets the flag cleared and cap_rate_final restored,
  with provenance source='master_curated' (treat as top-trust: broker-curated,
  deck-published). ANCHOR ON CORROBORATION, NOT TERM — do not write a <=5-only
  quality rule; short deals benefit most simply because that's where high caps
  live.
- FIX THE TRIGGER FORWARD: >10% as an auto-exclude is wrong; move the heuristic
  to >12% (the existing band edge) and/or make it corroboration-aware so future
  master/OM/CoStar-stated high caps aren't re-suppressed. One-time unflag without
  the trigger fix will silently regress.
- KEEP >12% excluded (e.g. the master's 23.93% Midwest City OK deal) but
  DOCUMENT the divergence: the deck includes it and it alone adds ~50 bps to the
  Dec-2025 TTM <=5. Surface that as a deliberate methodology note for Scott to
  accept or override — do not silently include or silently ignore.

## Step 2 — finish the per-deal reconciliation (from the independent 32-deal diff)
The Dec-2025 TTM <=5 acceptance set (deck's exact 32 deals) found, beyond the
flag mechanism:
a. TERM MIS-ASSIGNMENTS — deal in our DB with the right cap but the wrong
   firm_term_years_at_sale, exiting the cohort:
     5715 N Venoy Rd, Westland MI  — master 4.2 yr, ours 10.0
     2494 2nd St, Macon GA         — master 2.5 yr, ours 7.7
     4510 O'Hara Blvd, Brentwood CA — master 4.1 yr, ours NULL
     1350 Montreal Rd, Tucker GA    — master 2.8 yr, ours NULL
   Correct from the master TERM (it computes from the actual lease EXP at sale);
   investigate whether the resolver picked a renewal/extension lease.
b. MISSING SALES (3): 1020 N 14th St Beaumont TX (7.85%), 2660 S Broadway
   Rochester MN (8.50%), 4120 W Loomis Rd Greenfield WI (7.65%) — likely among
   R72's 419 unimported (no property match). Create the property stubs and
   import with master lineage.
c. CAP DISAGREEMENTS where both exist (investigate, master wins only with
   receipts): 22807 US-17 Hampstead NC (master 7.85 vs ours 9.57), 4816 E Chase
   Baytown TX (5.29 vs 6.77), 5819 US-90 Milton FL (8.30 vs 9.13), 1 Chabot St
   Westbrook ME (9.72 vs 11.12). Determine which source is right per deal;
   record the decision.

## Step 3 — the 419 unimported master deals (broader pass)
Import where a property can be created/attached (master has full address/tenant
fields); tag data_source='master_xlsx_backfill_r2' + provenance. These feed ALL
cohorts/dates, not just <=5 — including the deck's 2019 <=5 = 9.46% peak, which
should be re-tested after import instead of left "unreachable".

## Acceptance (run after each step; report movement attributably)
- The 32-deal Dec-2025 table: count entering the <=5 cohort with master-
  consistent caps (baseline: 14 of 32 fully consistent).
- R66x harness at the labelled dates vs deck (baseline 6.80/6.60/6.88/7.45 vs
  6.89/6.84/7.28/8.29). All four consumer views must stay identical (no re-fork).
- Residual decomposition documented: recency weighting + the >12% band
  divergence (with the 23.93% deal note) = the explained remainder.

## Constraints
- Single cap-of-record preserved; corrections are flag/term/import-level with
  master_curated provenance — never a per-view or per-cohort ladder fork.
- Steps 1+2 of the OM plumbing PR ship AFTER this lands (still authorized,
  re-billed as go-forward wiring).
```
