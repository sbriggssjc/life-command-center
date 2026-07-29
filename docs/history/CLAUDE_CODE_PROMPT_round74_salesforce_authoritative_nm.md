# Round 74 — Salesforce-authoritative Northmarq identity (+ curated-comp cap basis)

**Status:** spec / next round. Authored 2026-06-08 out of Round 73 Layer B #20.
**Branch convention:** `claude/<desc>-<sessionId>` off the designated dev branch.
**Blast-radius note:** `is_northmarq` drives the value-proposition chart
(`cm_gov_nm_vs_market_m`, `cm_dialysis_nm_vs_market_m`) in the Capital Markets
deck. Flag-column + view work only — no price/term/cap mutation without a gate.

---

## Why this round exists (the R73 #20 finding)

R73 Layer B re-derived `is_northmarq` from the master Sold/Sales-Comps **L.
BROKER** column (NM iff listing broker is `^(SJC|Stan Johnson|Northmarq)`):

- **Gov worked and was committed.** 169 → 66; clean NM 2024-Q2 = **6.79%** ≈ deck
  **6.78%** (down from the contaminated 7.92%); NM now sits below market on the
  1yr basis (6.79 vs 6.87). The master covers gov NM well.
- **Dia failed and was NOT committed.** Master re-derivation → clean NM **7.29%**
  — *above* market and *worse* than the contaminated 6.59%. Root cause (Salesforce
  spot-check): **the master under-covers dia NM** — ~50 real NM listing deals were
  never in it. Dia NM identity cannot be derived from the master alone.
- **The spread is a cap-BASIS issue, not the flag.** Even with a correct flag, our
  broad-DB transaction caps (`sold_cap_rate` / `cap_rate_final`) don't reproduce
  the deck's spread: our non-NM "market" = 6.87% vs the deck's ~7.35–7.50%. The
  deck is built on **master-curated / broker-confirmed comp caps**; our broad-DB
  caps run lower on the non-NM side. That's the documented curated-vs-market
  universe difference, now surfacing on the market line.

**Conclusion (Scott):** Salesforce is the authoritative source for *which deals
are NM*, and the value-prop chart must be computed on the *curated-comp cap
basis* the deck is built from.

---

## Task 1–4 — Salesforce as the live, authoritative `is_northmarq` source (both verticals)

Make Salesforce drive `is_northmarq` on gov + dia `sales_transactions`, replacing
the master/broker-string derivation as the source of truth.

### HARD CONSTRAINT (Scott — bake this in, do not shortcut)
Salesforce data is **entered by many hands**, so **single fields cannot be
trusted**. The "Is Government" checkbox and the "Dialysis" subtype are **often
unset**, especially on **multi-tenant** deals. Therefore the NM classifier MUST
combine **multiple OR'd signals**, never a single subtype/checkbox filter:

- tenant / operator dictionaries (dialysis: DaVita, Fresenius, US Renal, American
  Renal, Satellite, …; gov: GSA agency tenants — SSA, DHS, FBI, VA, …),
- agency name/abbreviation patterns,
- lease-ID / lease-number format (gov GSA lease-number shape),
- property linkage (the deal's property already classified to a vertical),
- the NM listing-broker / Team-Briggs signal (the master rule, as ONE signal).

A deal is NM when the **listing side is Northmarq/SJC** per SF (primary signal),
OR'd with the corroborating signals above for vertical assignment. Classify
vertical by the union of signals, not the subtype field.

### Build on existing plumbing (do not fork)
- `supabase/functions/intake-salesforce` (+ `-files`) — the SF intake edge fn.
- `api/_shared/salesforce.js`, `salesforce-sync.js`, `bridge-handlers-salesforce.js`.
- Persist SF → `sales_transactions.is_northmarq` (and a provenance/`*_source`
  marker so the derivation is auditable; keep it flag-column-only).
- Idempotent; re-runnable; record the contributing signals per flagged deal.

### Acceptance
- Dia NM cohort recovers the ~50 master-missing deals; dia clean NM lands at/below
  market on the curated-comp basis (target ~6.38% vs ~6.92%, deck 54bps).
- Gov NM stays ≈ the R73 committed set (6.78–6.79%), now sourced from SF.
- No reliance on a single SF field; multi-tenant deals classify correctly.

## Task 5 — value-prop chart on the curated-comp cap basis (Scott's call: recommended)

Recompute `cm_gov_nm_vs_market_m` / `cm_dialysis_nm_vs_market_m` on the
**curated-comp cap basis** (the basis the deck is built from), not broad-DB
transaction caps:
- **Gov:** curated caps held post-7d.
- **Dia:** via the master comp set.

This is what reproduces the deck's full NM-below-market spread (gov ~6.78/7.35;
dia ~6.38/6.92). Finalize the **TTM window** here too (R73 left gov on a 2yr
presentation window with an ±2mo smooth as a continuity stopgap; on the
curated-comp basis re-evaluate 1yr vs 2yr so the NM line is both continuous AND
below market). Gate the recompute; document the window in the view header.

## Task 6 — backfill real listing_date + stop the over-stamp wall (from R73 #9)

R73 #9 tightened the dia Market Turnover active count to require a real
`listing_date` (the 196d synthetic start is for the added-to-market series
only). That correctly drops **~222 dia listings** with a NULL `listing_date` +
a **future off_market_date** (the availability-checker over-stamp wall), but it
also pushes the recent active count below the ~130 it should be — because those
222 are real listings missing only their start date. Two halves:

### 6a — backfill the real `listing_date` (dry-run → gate → commit)
For the ~222 dia rows (NULL `listing_date` AND `off_market_date` in the future
relative to capture) — and **audit gov for the same pattern** — recover a real
listing_date via this **evidence ladder** (highest-confidence first), tagging
the chosen source in a new **`listing_date_source`** column:
1. **availability-checker page markers** — `last_checked` / the raw capture
   (`listing_verification_history` / response snapshot) for an on-page listed/
   posted date.
2. **CoStar capture date** — the date the sidebar/CoStar pipeline first captured
   the listing.
3. **sale-anchor fallback** — `sale_date − median DOM` (use the domain's
   measured median: dia ~196d) when nothing better exists; tag it as estimated.
Flag-/date-column work only (never touch price/cap). Dry-run the recovered set,
bring the counts to the gate (expected: recent dia active rises toward ~130 on
real dates), then commit. After backfill, re-verify `cm_dialysis_market_turnover_m`.

### 6b — fix the writer that stamps a FUTURE off_market_date on undated rows
Root cause of the artifact: a writer sets `off_market_date` to a future date on
listings that have **no `listing_date`** (likely the availability-checker /
auto-scrape off-market path, or an over-stamp sweep). Find the path and fix it so
it (a) does not write an off_market_date that post-dates the run, and (b) does
not leave a row with an off_market_date but no listing_date. **This stops the
over-stamp wall from regenerating** — without 6b, 6a's backfill re-accumulates.
Cross-check the Round 76ej.g/h availability-checker + `lcc-auto-scrape-listings`
writers and the `lcc_record_listing_check` path.

**Expected combined effect:** the recent dia active count rises toward ~130 on
recovered real dates, and the over-stamp wall clears at the source. Receipts:
`reports/CM_ROUND73_LAYER_B_RECEIPTS.md` (#9 follow-up section).

---

## R73 #20 carry-over state (already live)
- **Gov flag committed** (`government/20260715_cm_round73_b_gov_is_northmarq_rederive.sql`,
  169→66) and **gov view on 2yr/±2mo** (`…_gov_nm_vs_market_2yr_window.sql`) —
  both live. Task 5 supersedes the window once the cap basis lands.
- **Dia flag NOT committed** — dia waits for the SF-authoritative source (Task 1–4).
- Receipts: `reports/CM_ROUND73_LAYER_B_RECEIPTS.md` (#20 section).
