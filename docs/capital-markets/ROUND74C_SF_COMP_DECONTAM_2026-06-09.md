# Round 74c — de-contaminate `is_northmarq` against the SF Internal Comp export

**Date:** 2026-06-09 · **Status:** dry-run complete, **awaiting Scott's gate** (no production flags flipped) · dia first, gov report-only.

> ## v2 update — side reconciliation + proximity (the binding fix)
>
> The Comp object alone is **not** sufficient: Internal = "NM touched the deal" but not
> *which side*. v2 reconciles every Comp match against the **SF Deal object's
> `Direct_Co_Broke`** (loaded from the `data.xlsx` Deal export → `sf_deal_export`,
> 271 rows; 229 listing-side / 41 buyer). Rule: `is_northmarq=true` **only** for
> `Direct (Both)` / `Co-Broke (Seller)`; `Co-Broke (Buyer)` → **`is_northmarq_buyside`**;
> **side absent → HOLD** (no flip). The city test is loosened to **≤25 mi geocoded
> proximity** (city-centroid gazetteer from 10,556 geocoded properties); the Deal→sale
> side is identified at a **tight ±1.5 %** price so dense metros (Houston/San Antonio)
> don't cross-attribute a neighbor's side.
>
> **dia v2 result:** 243 Comp-matched sales → **listing 199** (6 new adds, 193 no-op),
> **buyer 25** (15 flip OFF + set buyside, 10 new buyside), **19 held** (no Deal side).
> Confident competitor removes unchanged: `1065, 5004, 8327, 13137`.
> Net `is_northmarq` true **436 → 423**; `is_northmarq_buyside` true **25**.
>
> **Key correction over v1:** v1 (Comp-only) wanted to RE-ADD `5359, 5489, 6375, 8347`
> (R74 removes). The Deal side **refutes** them — `5359`+`5489` exact-price-match a
> **Co-Broke (Buyer)** deal → buy-side; `6375`+`8347` have **no Deal side** → held.
> R74 was right to remove them from the listing set. Only the Deal layer surfaces this.
>
> **#20 holds:** side-reconciled NM **listing** median **6.40 %** (n=190) ≈ deck 6.38 %;
> buy-side runs tighter (6.10 %) and is correctly excluded.
>
> **Apply (gated):** `scripts/applied/sf-nm-dia-r74c-staged.sql` (v2, explicit IDs +
> `is_northmarq_buyside` column). gov stays report-only — no gov Deal export exists yet,
> so it cannot be side-reconciled (reinforces HOLD).
>
> The original Comp-only analysis below is retained for the audit trail.

---

> ## v3 — NM-broker GUARD + Scott-gated APPLY (live 2026-06-09)
>
> Scott caught the same error class in the other direction: the Deal-export side
> lookup was **demoting genuine NM-listed deals**. Doctrine added (the binding
> guard): **the Deal side may only PROMOTE or resolve ambiguity — never override an
> explicit NM listing-broker string.** Never demote-to-buyside or remove a sale
> whose own `listing_broker` matches the NM/SJC/Stan Johnson/Briggs token; a
> conflicting Deal "buyer" tag on such a row is a ±1.5 % cross-attribution to a
> same-metro neighbor, not ground truth.
>
> **Applied live (Scott-gated):**
> - **6 listing adds → true:** 163, 635, 6435, 6864, 9341, 10085.
> - **1065 → false** (Encore competitor, not in Comp set, old R23 guess).
> - **12 buyside flips** (currently-flagged, Deal=Buyer, **non-NM broker**) → `is_northmarq=false` + `is_northmarq_buyside=true`: 17,53,83,162,698,5387,5420,5527,5761,5933,8850,8864.
> - **10 new buyside tags** (matched Comp, Deal=Buyer, not flagged, non-NM broker): 4977,5359,5364,5489,5523,9147,12896,13915,14456,14482.
> - **8327 / 13137 protected** — confirmed NM comps (Austintown 0.15 %/5d; Ripley **city-confirmed** 0.05 %/13d) + R74 Deal Co-Broke(Seller). Kept `true`, retagged. **Not removed.** Both had been starved by the strict 1:1 resolution (their comp was claimed by a higher-ranked sale) → wrongly bucketed as removes in v2.
>
> **Result:** `is_northmarq` **436 → 429**; `is_northmarq_buyside` **22**; 31 rows tagged `salesforce_comp`. #20 listing median **6.40 %** (n=190) ≈ deck 6.38 %.
>
> **Held (NM-broker guard / pending):**
> - **422 (SJC; Butler), 8858 (SJC; Scrivner), 5191 (Will Lightfoot)** — NM-listed, kept `true`. 8858 was surfaced by the guard (not in Scott's named list). 5191 is a named NM individual the token can't encode.
> - **5004 (Colliers)** — verified a genuine non-match (only candidate = a Round Rock Satellite Healthcare deal ~80 mi away, different tenant). Removal **recommended, held for Scott's explicit nod**.
> - **5420 (Peranich & Huffman)** — flipped to buyside as a non-NM firm; flagged for objection.
> - ~211 flagged-comp-unmatched non-competitor — not stripped.
>
> **gov:** `is_northmarq_source` + `is_northmarq_buyside` columns **added** (no flips).
> Needs a gov Deal/Opportunity export to do the same listing-vs-buyside split.
>
> Applied SQL of record: `scripts/applied/sf-nm-dia-r74c-applied-2026-06-09.sql`.

---


## Source

Scott's freshly-exported SF **Comp object** (not the Deal/Opportunity object), staged
per-project as `public.sf_internal_comp_export`:

| vertical | project | total | Internal-Sold | with price |
|---|---|---|---|---|
| dia | Dialysis_DB (`zqzrriwuavgrquhisnoa`) | 280 | **262** | 253 |
| gov | government (`scknotsqkcheojiaewwh`) | 127 | **113** | 108 |

Every row is **Comp Type = Internal = a Northmarq/SJC-brokered sale** (Scott-confirmed:
*"Comp type internal means a Northmarq or SJC sale"*). So this is the authoritative NM
curated-comp universe; the closed set is `status='Sold'`. No broker / Direct-Co-Broke
columns on the Comp object → buy-side can't be split from listing-side (minor caveat).

> Note: the gitignored xlsx files are absent from the remote container; the data was
> repointed to `sf_internal_comp_export` (per Scott). The `sf_comp_staging` table is a
> *different, smaller* PA-crawl universe (32 dia / 20 gov Internal) — NOT used here.

## Match rule (the established tolerant gate)

state + `sold_date` ±120d + `sold_price` ±6%; confirm with **city OR tenant** (gov
tenant := agency). Best candidate per comp, then dedup to **one comp per sale** (1:1).
dia resolves state/city/tenant via `properties`; gov carries them on `sales_transactions`.

## dia — the flagship #20 lever

- **Match:** 244 confirmed comps → **242 distinct matched sales** (2 collisions resolved:
  a duplicate SF record on Great Bend KS sale 7203; a Burgettstown comp loosely caught on
  Washington sale 14512 — the exact match kept). 95.7% of priced Internal-Sold matched.
  Confirmation mix: 184 city+tenant, 18 tenant-only, 35 city-only.
- **Re-derive `is_northmarq`** (tag `is_northmarq_source='salesforce_comp'`):
  - current flagged **436** = 220 matched-and-flagged (no-op) + **216 flagged-unmatched**.
  - **22 new adds** (confident, city/tenant-confirmed exact matches).
  - **4 confident removes** (competitor broker + outside Internal set):
    `1065` (Encore), `5004` (Colliers), `8327` & `13137` (M&M; Glass).
  - **212 staged removes — HELD for the gate** (not stripped; Comp DB may be incomplete):
    75 with NM/SJC/Briggs broker evidence → **KEEP**; 66 null-broker → **HOLD**;
    71 other-named/garbage strings (`None`, `M`, individual names, small firms) → **HOLD**.
  - Post-apply (adds + 4 removes): **436 → 454**, with 212 removes pending judgment.
- **R74 reversals:** `5359, 5489, 6375, 8347` were *removed* by R74 (Deal-object export)
  but the more-authoritative Comp object confirms them NM (exact price+date, city+tenant;
  co-broked with C&W / Flagship / Matthews). **R74c re-adds them.**
- **M&M contradictions (`8327`, `13137`):** the Comp object **excludes** both from the
  Internal set, and the DB broker is Marcus & Millichap → resolves to **REMOVE** (was
  left flagged in R74 as SF-authoritative; the Comp object is the stronger signal).
- **Held R74 buckets:** the ~84 null-broker removes → now 66, **held**. The 144
  non-city-confirmed adds → **superseded** by the authoritative match (only 22 net new
  adds remain). The 4 Task-4 no-matches → subsumed into the import candidates.
- **Import candidates (report-only):** 18 Internal-Sold comps match nothing
  (9 priced, **$116.2 MM**, avg cap 7.59%; 9 carry no price). Do **not** import here.

### #20 value-prop (Task 5) — REPRODUCES

| basis | n | avg | median |
|---|---|---|---|
| NM Internal export (all-time) | 252 | 6.64% | **6.34%** |
| NM matched-sale DB cap (all-time) | 230 | 6.64% | **6.40%** |
| NM Internal export (2yr TTM) | 20 | 6.80% | 6.78% |
| Market non-NM (all-time) | 2,924 | 6.91% | 6.63% |
| Market non-NM (2yr TTM) | 292 | 7.29% | 7.15% |

The deck's dia NM **6.38%** is the **curated Internal-comp median over the long
(all-time) window** (export 6.34% / matched-DB 6.40%), **not** the 2yr set (6.78%). NM
trades ~25 bps tighter than market all-time, ~37 bps tighter on the 2yr.

## gov — report-only (do NOT switch basis this round)

- **Match:** 113 Internal-Sold → **103 matched sales** → 80 would-be new adds, 23 already
  flagged. Current flagged 66, of which **43 are outside the Internal set**. Gov flags are
  badly incomplete AND partly mis-set.
- **Import candidates:** 10 comps (5 priced, **$155.6 MM**, avg cap 5.83%).
- **Cap-discrepancy investigation — no Internal-vs-DB contradiction:**

  | cut | n | avg | median |
  |---|---|---|---|
  | export Internal-Sold (all-time) | 104 | 8.22% | 8.00% |
  | matched sales' own DB `sold_cap_rate` | 100 | 8.20% | 8.00% |
  | current flagged set DB `sold_cap_rate` | 66 | 8.14% | 7.90% |

  The export, the matched sales' own DB cap, **and** the current flag set all agree at
  **~8%**. So the deck's ~6.78% gov NM figure is **not** the raw `sold_cap_rate` of the
  flag set — it's a different cohort/aggregation (likely NOI-derived `cap_rate_history`, a
  federal/term sub-cut, or the `capital_markets_quarterly` rollup). Re-flagging gov to the
  Internal set would correct the under-flagging **without moving the raw ~8% NM cap** — but
  the deck's 6.78% must be reconciled first. **Hold gov for a separate gated step** (and
  add `is_northmarq_source` to gov at that time — the column doesn't exist there yet).

## Artifacts

- `scripts/sf-nm-decontam-dryrun.mjs` — Comp-schema dry-run tool, repointed to
  `sf_internal_comp_export` (DB-sourced; runs on a credentialed machine).
- `docs/capital-markets/ROUND74C_dryrun_plan.json` — the full dry-run plan (gate input).
- `scripts/applied/sf-nm-dia-r74c-staged.sql` — gated, idempotent dia apply
  (adds + 4 confident removes; 212 removes held). **Not yet applied.**

## Guardrails honored

Flag-column + `is_northmarq_source` only — no price/term/cap writes. Idempotent on SF Comp
Id / sale_id. Removes staged with the competitor-broker spot-check; not bulk-stripped. dia
first; gov report-only pending the deck-basis reconciliation.
