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

---

## R73 #20 carry-over state (already live)
- **Gov flag committed** (`government/20260715_cm_round73_b_gov_is_northmarq_rederive.sql`,
  169→66) and **gov view on 2yr/±2mo** (`…_gov_nm_vs_market_2yr_window.sql`) —
  both live. Task 5 supersedes the window once the cap basis lands.
- **Dia flag NOT committed** — dia waits for the SF-authoritative source (Task 1–4).
- Receipts: `reports/CM_ROUND73_LAYER_B_RECEIPTS.md` (#20 section).
