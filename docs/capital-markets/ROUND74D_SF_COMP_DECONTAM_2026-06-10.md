# Round 74d — finish the dia `is_northmarq` de-contamination (all-comps re-check + held removes)

**Date:** 2026-06-10 · **Status:** ✅ **APPLIED LIVE (Scott-gated, fully approved)** · dia only; **gov untouched** (done in prior rounds).

> ## Gate outcome — APPLIED 2026-06-10
>
> Scott approved the full set and extended the strip to **62** = the 61 dry-run
> strips **+ 13289** (Sam Bretz, the null-price row held separately — Scott
> confirmed Sam Bretz isn't NM, so it strips too despite the null price).
>
> **Receipt (verified live):** `is_northmarq` **428 → 366** (−62); the 101
> all-comps rescues KEPT + comp-confirmed-tagged; the 46 NM-broker rows
> untouched; `is_northmarq_buyside` **22 (unchanged)**; `is_northmarq_source=
> salesforce_comp` = **194**. Curated matched-comp **listing median 6.31 %
> (n 296) — unchanged**; raw flag median **6.41 % (n 337)** ≈ deck ~6.40 %.
> **#20 holds.** This closes the dia de-contamination: from **436 over-flagged
> down to the authoritative 366**, every flip gated.
>
> **5420 stays as-is** (`is_northmarq=false`, `is_northmarq_buyside=true`):
> Peranich & Huffman *listed* it, but its Comp is **Co-Broke (Buyer)** — NM was
> the buyer's broker, so it's correctly NM **buy-side** track record, not a
> listing flag. No change.
>
> **Classifier guard:** the 3 confirmed-outside names (Sam Bretz / Nathan
> Huffman / Peranich & Huffman) are now recorded as **known-non-NM** via
> `KNOWN_NON_NM_BROKER_RE` + `isKnownNonNmBroker()` in
> `api/_shared/sf-nm-classifier.js`; `isNorthmarqListingBroker()` returns false
> for them, so no broker-string heuristic can reintroduce them. (A name there can
> still be a buy-side co-broke on a real NM deal — the buy-side flag rides on the
> Comp's Direct/Co-Broke, not this listing guard.)
>
> Applied SQL of record: `scripts/applied/sf-nm-dia-r74d-applied-2026-06-10.sql`.

---

Closes the dia `is_northmarq` cleanup opened in R74/R74c. R74c v3 left the held set
(`is_northmarq=true` but unmatched in the strict 1:1 comp pass) un-stripped, pending
the safeguard below. This round builds that safeguard, re-checks the held set against
the full Internal-comp universe, and proposes stripping only the genuine R23
broker-string false-positives.

## The safeguard CC flagged — built FIRST

The 1:1 matcher (best-comp-per-sale, one comp per sale) **starved real NM comps** into
the remove bucket: a sale's true comp could be claimed by a higher-ranked sale, leaving
the sale "unmatched" even though it is a genuine NM deal (the named cases: **8327**
Youngstown↔Austintown, **13137** Ripley).

The **all-comps re-check** removes that contention: every flagged sale is tested against
**every** Internal-Sold comp (not just its 1:1 winner) under the established tolerant
gate — `state + sold_date ±120d + sold_price ±6%`, confirm **city OR tenant-first-token
OR ≤25 mi geocoded proximity** (city-centroid gazetteer from geocoded `properties`).
**Any flagged sale that matches ANY comp is KEPT** (not a false positive).

| pass | flagged matched |
|---|---|
| strict 1:1 | 219 |
| **all-comps re-check** | **320** |
| **surfacers rescued** | **101** |

**101 rows surface — not "a few."** The strict 1:1 pass would have wrongly stripped up
to 101 genuine NM comps. 317 of the 320 matches are city/tenant-confirmed (only 3
proximity-only). Critically, **many surfacers carry `null`/`'None'` brokers** (e.g. sale
38 Pearland ↔ Fresenius-Pearland comp; sale 43 Oakland ↔ DaVita-Oakland) — a
broker-only classification would have removed them; the comp match is what proves they
are real NM deals. This is precisely the false-positive-removal the safeguard exists to
prevent. 8327 and 13137 are both back in the matched (kept) set.

## Classifying the held set (208 = 101 + 46 + 61)

The held set (427 flagged − 219 matched-1:1 = 208) partitions cleanly:

| bucket | rule | n | action |
|---|---|---|---|
| **1 — NM listing-broker** | listing/procuring broker carries an NM/SJC/Briggs token | **46** | **KEEP — no write** (the guard) |
| **2 — all-comps surfacer** | matches ANY Internal comp under the tolerant gate | **101** | **KEEP** true + `is_northmarq_source='salesforce_comp'` (comp-confirmed); buy-side reconciliation deferred (no Deal export in container) |
| **3 — strip** | matches **no** comp AND **no** NM token (null / individual-name / garbage / small-firm broker) | **61** | propose **`is_northmarq=false`**, tag `is_northmarq_source='salesforce_comp'` |

Bucket 3 breakdown: 12 null-broker, 49 individual/garbage/small-firm, **0** national
competitor (R74c already removed the lone competitor, 1065). These are the R23
broker-string false-positives — single-letter `"M"` (a Michigan cluster), `"None"`,
`"Crs"`, `"Transmerical"`, and individual names (Peter Bauman, Kevin Fryman, Matthew
Gorman, Sarah Martin, …), none matching any Internal comp.

## Independent verification (on the 61 strip ids)

| check | result |
|---|---|
| still `is_northmarq=true` (idempotency ref) | 61 / 61 |
| carries an NM token (guard breach) | **0** |
| would match a comp under a **looser** gate (city OR tenant, no proximity) | **0** |
| already buy-side | 0 |

The strip set is robust to the exact gate formulation — every one of the 61 is comp-less
even when proximity is dropped.

## Impact (#20 holds)

| metric | before | after strip |
|---|---|---|
| `is_northmarq=true` | 428 | **367** |
| curated matched-comp **listing** median (the deck #20 basis) | 6.31 % (n 296) | **6.31 % (n 296) — unchanged** |
| raw flag-set (non-buyside, capped) median | 6.45 % (n 391) | **6.41 % (n 337)** |

The curated NM-comp median is **mathematically invariant** to the strip: all 61 strips
are comp-**unmatched**, so they were never in the curated basis. The raw flag median
moves 6.45 % → 6.41 %, *toward* the deck's ~6.40 % (R74c reported the curated Internal-comp
median at 6.34–6.40 %). **#20 holds ≈ 6.40 %.**

## Held / surfaced for Scott (not stripped)

- **13289** (Sam Bretz, Arvada CO) — **NULL** `sold_price`, can't be matcher-verified → **HELD**.
- **Borderline strips to confirm-or-pull before the gate** (still in the proposed strip):
  **5429, 988** (`Peranich & Huffman` — R74c marked P&H "object if NM"; 5420 P&H already
  routed buy-side), **7980** (`Nathan Huffman` — possible P&H principal), **8483**
  (`Sam Bretz` — paired with held 13289). Remove any from the apply IN-list to hold.
- **NM individuals correctly KEPT** via comp-match / SJC-token (not stripped):
  **422** (SJC; Butler), **5191** (Will Lightfoot), **8858** (SJC; Scrivner).

## Guardrails honored

Flag-column + `is_northmarq_source` provenance only — **no price/term/cap writes**.
Idempotent on `sale_id`. Never strip an NM-token broker (verified 0/61). Never strip a
row matching any Internal comp (verified 0/61 under the looser gate). gov untouched; rows
already source-tagged this round untouched. Orphan/null-price + borderline rows surfaced,
not bulk-stripped.

## Artifacts

- `docs/capital-markets/ROUND74D_dryrun_plan.json` — full dry-run plan (gate input): per-bucket counts, the 101 surfacer ids + evidence, 30-row remove sample with "matched no comp" proof, post-strip count + #20 median.
- `scripts/applied/sf-nm-dia-r74d-staged.sql` — gated, idempotent apply (strip 61 + tag 101 surfacers). **Not yet applied — awaiting Scott's gate.**

## After this lands (NOT this round)

Final polish round: **Task 4** (import the Internal-Sold comps matching no DB sale — the
genuinely missing NM deals, dia + gov; count + $ volume first) and **Task 6c** (dia
`listing_date` backfill for the ~222 over-stamp rows + stop the future-`off_market`
writer). Then merge → Railway redeploy → fresh-export verification closeout.
