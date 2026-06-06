# Claude Code prompt — Round 69: June-5 export review (27 notes, both verticals)

> Sources: Scott's 2026-06-05 chart review + verification-gate diagnosis. FOUR gov
> charts were already fixed live before this prompt (see Task 0). The headline
> task (R69-1) comes from Scott's own diagnosis and unlocks most of the
> remaining dia 10+ listing-cohort notes.

```
TASK 0 — canonical record of the live gate fix (no DB work — already applied)
Scott's gov notes img12-15 (Top/Bottom Quartile, Cap TTM Avg, Cash & Leveraged
Returns, Cost of Capital — "missing data entirely") were ONE bug: the n-gates
on cm_gov_cap_quartile_m / cm_gov_cap_ttm_m / cm_gov_cost_of_capital_m /
cm_gov_returns_indexes_m counted eligible sales with the DIA transaction-type
filter (Investment/Resale), excluding gov's dominant 'brokered' type →
296/303 months nulled. Fixed live (migration cm_gov_round69_gate_cohort_gov_types
— widened the ANY-array to include brokered/direct/Owner-User/Build-to-Suit).
Quartile populated 7→303. Commit the canonical SQL to government-lease.
NOTE: Volume+Cap+Quartile Band (img27 "missing a ton") composes from these
sources — verify it auto-resolved in the next export.

TASK 1 — THE HEADLINE (Scott's diagnosis): listing-side term = sale-side truth
Scott: "We are using the lease term remaining at the closing date to calculate
term, correct?" — for SALES yes (master-locked firm_term_years_at_sale, 2,082
dia + 1,666 gov). For LISTING-side charts NO: asking-cap-by-term, sentiment
cohorts, price-adjustment, DOM/PC classify by an independent leases-table join
at listing date — re-introducing the Venoy-class mis-resolution we eliminated
on the sold side. In the master Excel, each comp row carries ask history AND
term, so every 10+ deal contributes a 10+ asking observation automatically.
FIX (both verticals): in every listing-side view that classifies by term,
prepend to the term COALESCE:
  linked-sale truth: s.firm_term_years_at_sale + (s.sale_date - al.listing_date)/365.0
  (via al.sale_transaction_id; only when firm_term_years_at_sale IS NOT NULL)
ahead of the lease-join derivation. Coverage: dia 1,634 linked listings, gov
3 linked + 1,575 synthetics + 184 master-upgraded (all sale-linked).
ACCEPTANCE: re-run the 10+ asking-cohort coverage tables (dia asking-cap
quartiles, sentiment 10+, price-adj 10+, asking-cap ranges) before/after —
Scott's notes D1/D3/D5/D8 expect material lift. Document any residual gap that
remains genuinely thin AFTER sale-term propagation.

TASK 2 — gov Lease Termination Rate: 27.9s view → REST timeout (img17)
The G6 rebuild is SQL-correct but computes per-month correlated subqueries
(~5,400 seq scans of gsa_leases; EXPLAIN: SubPlans 5/6/8 at 1,812 loops). The
export fetch times out → the fail-loud sentinel fires ("⚠ FETCH FAILED" tab).
REWRITE single-scan: months × gsa_leases joined ONCE with FILTER aggregates
per metric; the TTM average denominator via a window AVG over the per-month
series (not re-computation). Also CLAMP to cm_last_completed_quarter_end()
(currently emits future periods to 2026-06). Target: full select=* under 2s.
Verify identical values to the current view at 3 spot months before replacing.

TASK 3 — gov Cap by Remaining Lease Term chart reads the gappy view (img11)
The data now fans correctly, but the chart fetches cm_gov_cap_by_term_m whose
per-month n>=5 gates null scattered months → disconnected jagged lines
("jumbled"). Repoint the chart template to the smoothed dot view
(cm_gov_sold_cap_by_term_dot, ±3mo window like dia) or add equivalent
smoothing to _m. Check img26 (Closed Sales by Lease Term Remaining /
"very inconsistent") resolves with the same treatment + the master terms.

TASK 4 — valuation index reconciliation vs the master workbooks (D2 img2 + G22 img22)
Both indexes "don't move like the PDF." We now hold BOTH master workbooks with
their own index series ('All Charts' sheet in the gov master at
scripts/gov_master_sold_full.json's source workbook; 'Dialysis Comp Work
MASTER.xlsx' for dia). Extract the masters' index formula/inputs and reconcile:
base anchor, input composition (volume/cap/quartile weights), rebase rules.
Scott's specifics: gov shows values only DECLINING since 2010 (suspect), and
should extend back to ~2000 where data supports (master goes back to 1997).
Deliver: side-by-side master-vs-ours at 8 anchor dates + the formula diff +
the corrected definition, gated dry-run before view change.

TASK 5 — formatting v2
- G19 (img19) Renewal Rent Growth: drop-down bars (deck style) + tighten the
  right-axis range so the CAGR line's movement is visible.
- G23 (img23) gov Avg Price by Firm Term Bucket + D9 (img9) dia equivalent:
  the cap-rate labels still unreadable — the R68 assertion locked dLbls
  presence but the visual remains cramped; widen the secondary axis range or
  move to leader-line callouts.

TASK 6 — per-chart data reviews (verify, fix only with receipts)
- G18 (img18) NM vs Market: still a visible gap chunk — check whether it's the
  n>=3 gate over the thin middle years vs a labeling hole; 7b added +15.
- G20 (img20) Rent by Year Built: 2021+ rows inconsistent vs balance — check
  recent rent capture (CMBS/OM-sourced rents vs lease-table rents).
- G21 (img21) gov sentiment: "much better, missing a few periods" — confirm
  remaining nulls are genuine post-gate (document) or fixable via Task 1.
- G24 (img24) Market Turnover Monthly: 2023+ inconsistency — review the
  monthly added-to-market series against the synthetic/organic mix.
- G25 (img25) TTM turnover: "total available + monthly clearance rate"
  missing — the months_of_supply + active_count series exist in the view;
  check the chart template maps BOTH series (likely a series-wiring gap).
- G26 (img26): see Task 3.
- D4 (img4) dia Available Market Size: recent quarters inconsistent + missing
  cap data — organic ask-coverage thinness; re-test after Task 1.
- D6 (img6) dia new-to-market recent quarters: partially the known capture
  lag (self-healing via page-marker capture); verify trend, document.

DIA HONEST-LIMIT RE-TEST: D1/D3/D5/D7/D8 all re-run after Task 1 — Scott's
challenge stands: the Excel builds these from the same comps, so sale-term
propagation should close most of it. Only after Task 1 may any residual be
classified an honest data limit, with the per-period n receipts shown.

ORDER: 0 (commit) → 1 (headline) → 2, 3 (gov chart unblocks) → 5, 6 → 4.
Standard gates: view changes live with before/after receipts; any bulk write
dry-run → verification gate. Per-task before/after at Dec-2025 + affected
periods in the PR.
```
