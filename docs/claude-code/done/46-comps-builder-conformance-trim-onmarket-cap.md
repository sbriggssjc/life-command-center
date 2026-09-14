# Prompt 46 — Comps builder: fix conformance failures (every generate_comps 500s)

## Why (live connector acceptance test, 2026-08-05)
With the connector live, EVERY `generate_comps` build fails HTTP 500 on the prompt-37 conformance validator — the
validator now rejects the very output the prompt-43 renderer produces. Observed errors:
- one-shot: **"[On Market] grid not trimmed to the AVG bar — blank ADDRESS at data row 58 above the bar (row 106)"**
- two-step dialysis: **"shared column widths differ between On Market and Sold: PATIENTS 10.0 vs 13.0"**
- two-step standard: **"EXPENSES narrower than content"** + width mismatches on BUMPS, EXPENSES, and **RENT/SF**
  (a formula-protected column never written on the input side).
Root cause: the auto-fit/trim (43) and the validator (37) don't share one contract, so builds that should pass are
rejected. Also on-market returned **174 rows** into a 100-row template — it overflows and the trim can't seat the bar.

## Task
1. **Reconcile auto-fit ↔ validator (one width contract).** Make `_autofit_no_wrap` and `validate_comps_output`
   compute widths the SAME way: recalc-then-measure (or a shared min-width table) so (a) every column fits its
   *rendered* content incl. formula columns (RENT/SF, $/SF, CAP, TERM, DOM), and (b) shared columns get an
   identical width on On Market and Sold. The validator must not fail a formula column the renderer can't pre-size —
   size it post-recalc or exempt it consistently on both sides. Net: a correctly-built workbook PASSES.
2. **Trim on every path + both sheets.** Ensure `_trim_to_totals` runs for On Market and Sold in BOTH one-shot and
   two-step builds so there are never blank data rows above the AVG bar.
3. **Truncate appraisal on-market to a curated, template-fitting count.** Cap on-market to ~20–25 most-aligned
   listings (same similarity ranking as sold), never 174 — so it fits the template and reads as a curated set.
4. Keep the conformance gate (37) — but it should now pass on a good build and only fail on a genuinely malformed one.

## Verify
- `generate_comps` (one-shot AND two-step, dialysis + standard) returns a workbook with **no 500** — trimmed grids,
  fitting + shared-matched widths, ~25 sold + ~20 on-market. RENT/SF and other formula columns display fully.
