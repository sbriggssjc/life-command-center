# Prompt 44 — Comps exporter: 25 best/most-like, similarity-over-operator rescore, bumps 0.1, TERM width

## Why (Scott's notes, 2026-08-05)
Four exporter fixes so every request returns the best 25 comps for the subject, formatted cleanly.

## Task
1. **Return the 25 best/most-like comps every request.** Set the appraisal target to **25** primary sold ranked by
   subject similarity (plus the aligned on-market set). Raise `DEFAULT_APPRAISAL_LIMIT` to 25; keep the widening
   ladder (prompt 41) to reach 25 when needed. Truncate to the 25 most similar, not the newest 25.
2. **Rescore: similarity OVER operator identity** (`scoreComp`). Scott's doctrine, verbatim intent: *a Fresenius in
   a similar SE-US market of similar size, same lease term remaining and cap rate is a BETTER comp than a DaVita in
   a slightly different market with ~4 years different lease term at close.* So:
   - Increase weights on **market proximity** (metro>region), **lease term remaining at close** proximity,
     **cap-rate alignment**, and **size/chairs** proximity.
   - **Demote operator** to a minor tiebreaker (small bonus), NOT a dominant term. Same-operator must not outrank a
     clearly-more-similar different-operator comp. Keep the cap-support rule (don't reward caps far above subject).
   - Net: a term-at-close gap of ~4 yrs or a market mismatch should cost more than an operator switch.
3. **Bumps: normalize bare decimals.** Per Scott, `0.1` was meant as **"10% every 5 years"**. In `normalizeBumps`,
   map a bare decimal `d` with 0<d≤1 → `"{d*100:g}% / 5 yrs"` (dialysis 5-yr step convention); `0.1`→`10% / 5 yrs`.
   Values >1 with no `%` stay flagged to the review lane (ambiguous). Apply on sold + on-market, all surfaces.
4. **Column width — TERM is hidden.** The lease-term-remaining (TERM) column clips its content on the Sold tab.
   In `comps_generator` auto-fit, formula/date columns are sized to the header only (values are computed post-write),
   so TERM/DOM/caps/$-SF come out too narrow. Fix: give computed columns a sensible **min display width**
   (e.g. TERM≥7, DOM≥6, %/cap≥7, $ cols≥11, dates≥11) OR recalc-then-fit. Also close the shared-width residual so
   PATIENTS/EXP/TERM/LAST PRICE widths match across On Market and Sold.

## Verify
- An appraisal pull returns 25 most-similar comps; a similar-market/size/term/cap Fresenius outranks a
  different-market/+4yr-term DaVita. Bumps show `10% / 5 yrs` (no bare `0.1`). TERM fully visible; shared widths match.
