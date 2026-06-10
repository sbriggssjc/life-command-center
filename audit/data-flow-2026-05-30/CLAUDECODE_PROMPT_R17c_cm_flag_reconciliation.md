# Claude Code — R17c: reconcile the gov CM `exclude_from_market_metrics` inconsistency

Surfaced by R17b's dual gate. The gov Capital Markets report is **internally
inconsistent today**: `exclude_from_market_metrics` is true on **~9,601** gov
`sales_transactions` (only 341 are R17b's off-universe comps). The **16**
flag-respecting `cm_gov_*` views exclude all 9,601 (~7.9% all-time cap); the
**13** R17b-scoped views exclude only the 341 off-universe (~8.6%). So the same
published report reports a **66 bps different all-time cap rate depending on
which section you read.** Nobody chose that split — it's drift. **This is a
published-number change, so it's investigation-first and fully gated — nothing
applies without Scott's sign-off on the exact before/after.**

> Unlike R17b, R17c **will move TTM/current numbers** — the 9,601 flagged sales
> include ~1,173 in the TTM window. That's expected (it's the point of
> reconciling), so the gate is NOT "TTM byte-identical"; it's "show the full
> all-time AND TTM impact per view and get explicit sign-off before applying."

## Unit 1 — investigate: what ARE the 9,601 flagged sales?
This is the crux — we can't reconcile until we know what the flag means. Break
the ~9,601 down and report:
- by `data_source`, by any tag/reason column, by `comp_scope`, by created/round
  markers (e.g. `orphan_round_*`, dupe markers), by `property_id IS NULL` vs not.
- **Why is each subset flagged?** Identify the mechanism(s) that set
  `exclude_from_market_metrics=true` (grep the importers / migrations / triggers
  / prior rounds). Likely a mix: R17b off-universe (341), prior dedup/quality
  exclusions, `orphan_round_76eo`, CoStar/RCA market comps, etc.
- Classify each subset as **genuinely should-be-excluded** (true dupes, off-
  universe, non-gov, bad data) vs **possibly-legit gov sales wrongly flagged**.
  The reconciliation target depends entirely on this split.

## Unit 2 — determine the canonical rule
From Unit 1, propose the **single** correct treatment, e.g.:
- If all/most 9,601 are genuinely non-gov/dupe/bad → **all 29 CM views honor the
  flag** (reconcile the 13 R17b-scoped views up to the full flag) → ~7.9% becomes
  the one all-time number.
- If the flag is over-broad (catches legit gov sales) → first **correct the flag**
  (un-flag the wrongly-excluded), THEN make all views honor the corrected flag.
Pick the rule the data supports; don't assume. State which number (~7.9 / ~8.6 /
something corrected) becomes canonical and why.

## Unit 3 — propose + show full impact (GATED, nothing applied)
Produce, for Scott's sign-off, the complete before/after **per CM view**:
- all-time cap / count / volume, **and the TTM/current** values (these WILL move).
- the headline single number the whole report will converge to.
- the `master_m` / `_mat` / cap-ladder impact (the rolling cap ladder moves here,
  unlike R17b — show it).
Use the same generic subquery-wrap technique R17b used (no 17k-char body
reconstruction). Snapshot the pre-change view outputs. **Wait for Scott's
explicit OK on the exact numbers before applying anything.**

## Unit 4 — apply (only after sign-off) + guard
- Reconcile all CM gov sales/listing views to the canonical rule.
- Refresh `cm_gov_market_quarterly_master_m_mat`; confirm every view + the
  cap-ladder renders and lands the signed-off numbers.
- Add a **consistency guard**: a test/CI check (or a `v_cm_view_flag_audit` view)
  that asserts every CM gov sales/listing view applies the same exclusion
  predicate, so a future view can't silently reintroduce the split.

## House rules
Investigation → propose → show full impact → **gated sign-off** → apply →
verify; snapshots for reversal; `CREATE OR REPLACE` (errors not breaks);
generic subquery-wrap, not body reconstruction; no published number moves
without Scott's explicit OK on the exact figure. Commit to the gov PR. This is a
correctness/consistency round on a published deliverable — accuracy over speed.
