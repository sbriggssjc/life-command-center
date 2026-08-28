# On-Market Lifecycle & Categorization Review (2026-05-29)

**Purpose:** Before any cleanup of "available / on-market" data (per
`SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md`), verify that the
differing status values and lifecycle flags are *correctly categorized* and not
simply "bad data." Review the full ingestion → web-crawl verification →
off-market/sold propagation pipeline against the live row-level evidence.

**Verdict up front:** **The lifecycle model is largely intentional and well
designed — do NOT blindly clean it.** The defects are *not* in how the pipeline
categorizes a listing's lifecycle; they are (1) a **`status`-string vs
`is_active` desync** caused by two different writer sets, (2) **presentation
views keying on the wrong field**, and (3) a population of **synthetic/imported
placeholder rows** that were never real broker listings. One recommendation from
the first audit (filter `off_market_date IS NULL`) is **withdrawn here** — it
would have wrongly dropped genuinely-active re-listings.

---

## 1. The pipeline is a deliberate two-layer model (evidence vs decision)

From full code inspection of the ingest writers, the `availability-checker` edge
function, the `lcc_record_listing_check` RPC, the auto-scrape + promotion-sweep
crons, and the sale→listing triggers:

| Layer | Columns | Maintained by | Meaning |
|---|---|---|---|
| **Decision / gate** | `is_active` (dia) | the RPC + sale triggers + cleanup crons | "Is this on the market right now?" — the authoritative flag. |
| **Evidence** | `off_market_date`, `off_market_reason`, `sold_date`, `sale_transaction_id`, `consecutive_check_failures`, `last_verified_at` | the RPC (`lcc_record_listing_check`) + crawler | the proof trail behind the decision. **Write-once / sticky** by design. |
| **Human label** | `status` / `listing_status` text | **only** the sale triggers + cleanup crons (Stale/Superseded) — **NOT the RPC** | dashboard-facing string. |

This separation is correct and intentional. Confirmed deliberate behaviors:

- **Threshold confirmation before declaring off-market.** A single `unreachable`
  (4xx/5xx/bot-block) only increments `consecutive_check_failures`; status/
  is_active are left untouched until the counter crosses **3**. We don't drop a
  listing on one flaky fetch.
- **`off_market_reason='unverified_assumed_off'` is a deliberate provisional
  lane.** A page that *reads* "Sold" is never auto-marked sold — it's parked as
  `unverified_assumed_off` until the promotion sweep finds a real
  `sales_transactions` deed match (then upgrades to `sold`). This is the right
  conservatism.
- **`inferred_active` only advances the verification timer** — it does not claim
  "still available" because the auto-scrape cron didn't actually probe the URL.
- **`Stale` ≠ `Off Market` ≠ `Superseded` are distinct, meaningful categories:**
  `Stale` = never re-confirmed in 2+ yrs (hidden, not asserted gone);
  `Off Market`/`withdrawn` = confirmed removed; `Sold` = deed-linked; `Superseded`
  = a dedup *loser* row (the keeper carries the data). These should stay distinct.
- **`off_market_date` is write-once** (the RPC only sets it when currently NULL).
  So once a listing has *ever* been off-market, the date persists even after it
  comes back — meaning `off_market_date` is **evidence, not current state.**

**Conclusion:** the categories carry real meaning. Cleanup must *preserve* this
model, not flatten it.

---

## 2. The 45 "active-but-off-market" dia rows are THREE different situations

Pulling the actual rows shows my first audit lumped together three distinct
cases. Only two are genuinely off-market; the third is genuinely **active**:

| Case | Rows | Signature | Correct verdict |
|---|---|---|---|
| **(a) Crawler/cron marked off, status text stale** | ~31 | `is_active=false`, `off_market_reason='sold'`/`withdrawn`, recent `last_verified_at`, **`status` still `'Active'`** | **Genuinely off-market.** Only the `status` *string* is stale (the RPC doesn't write `status`; no sale-event trigger fired to flip it). |
| **(b) Real deed-linked sale** | 1 | `is_active=false`, `sale_transaction_id=8309`, `sold_date=2013-12-31` | **Genuinely sold.** |
| **(c) Re-listing / re-activation** | ~11 | **`is_active=true`**, recent `listing_date` (2026-05) **later than** a stale `off_market_date` (2026-04-28, or even 2024); `last_seen` recent | **Genuinely ACTIVE.** The property came back on market; `is_active` was correctly re-flipped; the old `off_market_date` was never cleared (it's write-once). |

**This is exactly why "correctly categorize before cleaning" was the right call.**
Had we filtered `off_market_date IS NULL` (first-audit R3), we would have **wrongly
excluded the 11 case-(c) re-listings** that are genuinely on the market.

Live confirmation that `is_active` is the clean gate (whole dia table):

- `is_active=true` (406 rows): **0** carry an off-market status, **0** carry a
  sale. The only quirk is the 11 case-(c) rows with a sticky `off_market_date`.
- `is_active=false` (2,886 rows): only 33 still wear a stale active *status* text.

→ **`is_active` is the authoritative "actively marketed" signal on dia.**
`status` text and `off_market_date` are both unreliable as standalone filters.

---

## 3. But `is_active=true` alone over-counts: 148 synthetic placeholder rows

`is_active=true` returns 406, yet the status-keyed `v_available_listings` returns
289 and your own 2026-05-22 inventory calibration expects **~120**. The gap is a
population of **non-broker placeholder rows**:

- **148 rows** are `is_active=true` with **`status` = NULL (139) or
  `'Draft-Commenced'` (9)**.
- **All 148 have no `listing_url`**, **141 have no broker and no seller**, and
  **141 were bulk-created on 2026-04-28/29** (a single import batch).
- `'Draft-Commenced'` is **not written anywhere in the live pipeline** — it only
  appears as a *filter value* in the capital-markets `cm_round65` view. It came
  in via a data import, not the ingest/crawl lifecycle.
- **All 148 are counted by the capital-markets active-listings view**
  (`cm_dialysis_active_listings_m`, which gates on `is_active=true OR status-in-set`)
  but **excluded by the app's On-Market tab** (which gates on the `status` string).

So the two surfaces disagree in **opposite** directions, and **neither is right**:
the app excludes legit re-listings, the CM PDF includes synthetic placeholders.

**Open categorization decision (needs your call):** are these 148 bulk rows real
on-market inventory (e.g., a one-time market-scan import worth keeping as
"available"), or placeholders that should be excluded from the "actively marketed"
count? They are the single biggest driver of the count sitting well above your
~120 expectation.

---

## 4. Your own 2026-05-22 definition is already encoded — in the CM views, not the app

Migration `20260690_cm_round65_best_guess.sql` records your note verbatim:

> *"active listings should be a count of that snapshot in time that are in the
> market during that month, not a trailing twelve month total. It should be like
> 120 listings…"*

and documents the resolution: the **tight, lifecycle-aware** definition
(`is_active=true OR status-in-set, AND off_market_date IS NULL AND sold_date IS
NULL`, snapshot at a point in time) returned **95**, vs **514** for the broad
"ever listed and not sold." **The capital-markets `cm_dialysis_active_listings_*`
views already implement your endorsed definition.** The defect is that **the
app's On-Market tab (`v_available_listings`) does not use it** — it still keys on
the free-text `status` string.

The same migration notes, deliberately: **"Gov has no 'actively marketed for
sale' concept; sales are opportunistic on long-tenured GSA leases."** So the
gov/dia divergence in the available definition is **intentional**, not an
accident to be normalized away.

---

## 5. Government has a separate (and separately leaky) model

Gov `available_listings` has **no `is_active` column**. Its `v_available_listings`
gates on `exclude_from_listing_metrics IS NOT TRUE AND NOT EXISTS(a sale on the
property)`. Live evidence (409 raw → 161 in view):

- **17 withdrawn-but-unsold** listings (`off_market_date` set, no sale, not
  excluded) **remain "available"** — the view ignores `off_market_date`, so a gov
  listing pulled from market but never sold stays on the books. **Over-count.**
- **31 active-status listings are suppressed** because *some* sale exists on the
  property. Correct when that sale is the listing's own close; **wrong** when it's
  an old, unrelated historical sale and the property was genuinely re-listed.
- **15 `under_contract`** rows count as "available" in the view (and on the
  Available tab) but are filtered out by the overview's `=== 'active'` predicate
  — so gov shows **146 vs 161** depending on surface. Whether `under_contract` is
  "actively marketed" is a definitional choice (recommend reporting it separately).

Gov needs its own lifecycle gate (read `listing_status` + `off_market_date`
instead of "a sale exists"), not a copy of the dia `is_active` logic.

---

## 6. The real root causes (corrected)

1. **Writer split on `status`.** `lcc_record_listing_check` (the RPC behind the
   crawler + auto-scrape) maintains `is_active`/`off_market_date`/`off_market_reason`
   and the `listing_status_history` trail, but **never writes the `status`
   column**. Only the sale-event triggers and the Stale/Superseded crons write
   `status`. So whenever a listing goes off via the RPC path (URL probe, or
   auto-scrape matching a `sales_transactions` row that did *not* arrive through
   `property_sale_events`), `is_active` flips to false but `status` stays
   `'Active'`. → the 33 stale-status dia rows.
2. **Presentation reads the wrong field.** Dia `v_available_listings` keys on the
   drifting `status` string; gov keys on sale-existence. **Neither reads the
   authoritative gate** (`is_active` on dia; a real lifecycle predicate on gov).
3. **`off_market_date` is sticky evidence, not current state** — unsafe as a
   standalone "is it off now" filter (drops re-listings).
4. **Synthetic/imported placeholder rows** (148 dia) pollute `is_active`-based
   counts.
5. **Intentional cross-domain difference** (dia = marketed-for-sale; gov =
   lease-based) must be preserved, not normalized.

**None of this is "bad data to delete."** The lifecycle rows are correctly
categorized; the bugs are in the *plumbing between the gate field and the
presentation layer*, plus one import-hygiene question.

---

## 7. Recommended safe path (revised — supersedes first-audit R3)

No row deletions or status rewrites are required to fix the counts. In order:

1. **Repoint the dia available views/loaders to the authoritative gate.** Define
   "actively marketed" on dia as **`is_active = true AND sold_date IS NULL AND
   sale_transaction_id IS NULL`** — *not* `off_market_date IS NULL` (that drops
   re-listings) and *not* the `status` string (stale on both ends). This is the
   same gate the CM views already use.
2. **Resolve the 148 synthetic rows (your decision — §3).** If they are not real
   broker listings, give them their own state (e.g., `status='imported_estimate'`
   / `is_active=false`, or an `is_marketed=false` flag) so they drop out of *both*
   the app and the CM active count, reconciling the two surfaces toward ~120.
3. **Close the `status`-string desync** so the human label can't drift: either
   have `lcc_record_listing_check` also set `status` (cosmetic, low-risk), or — and —
   stop any view from *depending* on the free-text `status`. The latter alone
   fixes the counts; the former keeps the UI label honest.
4. **Give gov a real lifecycle gate.** Add `off_market_date`/`listing_status`
   awareness to gov `v_available_listings` (drop the 17 withdrawn-unsold), and
   constrain the "a sale exists" suppression to a sale **within the listing's
   window** so old unrelated sales don't suppress genuine re-listings.
5. **Decide `under_contract` treatment** (recommend: report as its own bucket,
   not folded into "available").
6. **Backslide check:** alert if any row is `is_active=true` while a terminal
   `status`/sale exists, or `is_active=false` while still in an available view.

---

## 8. Decisions needed before implementation

1. **Canonical dia "available" gate** — confirm `is_active=true AND no sale`
   (snapshot-in-time), matching your 2026-05-22 note and the CM views.
2. **The 148 synthetic/`Draft-Commenced` rows** — real inventory, or exclude as
   non-marketed placeholders?
3. **`under_contract`** — counts as available, or reported separately?
4. **Gov "available"** — confirm it stays lease/sale-based (no `is_active`), with
   the two leaks (17 withdrawn-unsold; old-sale suppression) fixed in place.

---

*Companion to `SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md`. Built
from full code inspection (ingest writers, `availability-checker/index.ts`,
`lcc_record_listing_check`, auto-scrape + promotion-sweep, sale→listing triggers)
cross-checked against live row-level data on dia (`zqzrriwuavgrquhisnoa`) and gov
(`scknotsqkcheojiaewwh`). No data or code was modified.*
