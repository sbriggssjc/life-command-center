# Round 66 — Post-Export Data Workplan (dia + gov)

Status snapshot after the round-66 chart-code + view fixes shipped and the
2026-03-31 exports were reviewed chart-by-chart. This separates (a) a
stale-export artifact, (b) chart fixes already applied this pass, (c) genuine
data-collection gaps that need capture work, and (d) hard data-depth ceilings
that are not fixable and should just be understood.

---

## 0. FIRST: re-export both books fresh

The gov export `(4)` carried **stale data** for at least `cm_gov_nm_vs_market`
(export NM 8.2–8.4% / market 8.0–8.7% vs **live** NM 7.1–7.35% / market
7.0–7.27%). Old ungated numbers plotted against the new 6.0–7.75% axis produce
the clipped, erratic, 8.72%-labelled line the reviewer flagged. The live view
is correct and gated/smoothed.

**Action:** regenerate both workbooks from current live views before any further
chart review. Several gov "erratic / broken / missing" flags are expected to
resolve on a clean re-export. Re-review only what remains.

---

## A. Chart fixes already applied this pass (live; ship on next deploy)

- **R66t** dia DOM & % of Ask — left axis 300 → 450. The DOM climb (297→345
  in-export, 411 live) is real (view is gated n≥10 + smoothed), was clipping.
- **R66u** dia Seller Sentiment — anchor `CURRENT_DATE` → `cm_last_completed_quarter_end()`
  (matches gov convention; stops trailing-edge null/wobble in future exports).
- **R66v** dia Available Market Size — 10+ cap gate n≥3 → **n≥6**. Kills the
  inverted "10+ avg cap above total market" line (it was thin-cohort skew at
  n=4–5; now blanks instead of inverting).

---

## B. Genuine data-collection gaps — need a capture pass (the real backlog)

### B1. dia `listing_date` — complete 2025
Recent dia listings lack a real `listing_date`, so "added"/"available" counts
collapse at the recent edge:
- Market Turnover & Inventory Backlog: `added_month` = **0** in 2025-12 /
  2026-01 / 2026-03.
- Available Market Size: `count_total` falls 146 → 8 into 2026.
2025 has ~14 listings vs ~120 expected. This is the unfinished half of the
earlier listing_date fix. **Needs another capture/repair pass for 2025.**

### B2. dia lease-term **bucketing accuracy** (not just coverage)
Coverage rose 26%→61%, which fixed cohort *density* — but the Sold-Cap-by-Term
*values* still don't match deck p.22:
| cohort | deck (Dec-25) | ours | gap |
|---|---|---|---|
| 12+ yr | 6.89% | 6.86% | ✓ |
| 8–12 yr | 6.84% | 6.61% | −23 bps |
| 6–8 yr | 7.28% | 6.68% | −60 bps |
| ≤5 yr | **8.29%** | **7.39%** | **−90 bps** |
Pattern: the shorter cohorts read progressively too LOW → high-cap short-term
deals are being bucketed into longer cohorts (resolved term too long). **Needs a
term-accuracy pass** verifying short-term deals bucket short (not just that a
term resolves).

### B3. Per-lease CAGR recompute (gov — CPI-vs-CAGR **and** Renewal Growth)
Both gov renewal charts compute CAGR as a **5-yr market-average growth**
(`ttm_rent / ttm_rent_60mo_ago`). Two consequences:
- The CPI-vs-CAGR line can't start before **2018** (renewal data starts Feb-2013;
  5-yr lookback → first value Feb-2018), while the deck's line goes back to 2014.
- It's shaped differently from the deck's flat ~1% line.
The deck uses a **per-lease** CAGR — new rate vs the prior rate at the same
building, annualized — computable from the first renewal. **Recompute the
per-lease way** (self-join on `lease_number` to each lease's prior event, or
parse `gsa_lease_events.changed_fields` for the prior rent). Fixes both the
start-date and the shape, on both charts.

### B4. listing-history / ask-cap coverage (both verticals)
The "10+ year **Last Ask Cap**" / price-change cohorts on Seller Sentiment (dia +
gov), Bid-Ask, and DOM-Price-Change draw from listing ask-cap / price-change
data that covers only ~7–11% of sales, concentrated in NM-brokered/CoStar
captures. Already has a drafted prompt
(`CLAUDE_CODE_PROMPT_gov_listing_history_capture.md`); the dia analog is the same
shape. Best-effort capture; will stay partial.

### B5. gov agency-tier — non-federal thinness
The classifier ran but added no cap-known state/municipal sales (still 19/36).
Cap-by-Credit stays ~95% federal — a genuine portfolio reality, not a bug.
Only more state/municipal deal capture moves it.

---

## C. Hard data-depth ceilings — NOT fixable, just understand

Any trailing-window metric cannot exist before `data_start + lookback`:
- **dia Valuation Index** — index starts Feb-2014 (sale-data depth); YoY bars
  need 12 mo → start Feb-2015. Can't go earlier.
- **gov CPI-vs-CAGR** (current 5-yr method) — see B3; floor is 2018 unless
  recomputed per-lease.
- **dia Market Turnover TTM** — active-listing universe is sparse pre-2015;
  cleanest is to start that chart at 2015.
- Early-period 10+ cohorts (Active Cap Quartile, Available Market Size,
  gov Cap-by-Term "Outside Firm") — term resolution thins out pre-2018; the
  gates correctly blank thin quarters. Coverage, not code.

---

## Recommended order
1. Re-export both books fresh (clears §0 staleness); re-review.
2. Ship the §A chart fixes (next deploy).
3. Run the §B capture work — priority B1 (listing_date 2025) and B2 (term
   bucketing accuracy) unblock the most charts; B3 fixes the two gov CAGR charts.
4. Document §C ceilings in the deck notes so they read as intentional.
