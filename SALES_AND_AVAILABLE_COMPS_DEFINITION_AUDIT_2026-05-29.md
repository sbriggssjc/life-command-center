# Sales Comps & Available Comps — Definition / Count / TTM Audit (2026-05-29)

**Scope:** End-to-end review of how "sales comps" and "available (on-market) comps"
are defined, counted, windowed (TTM), and presented across the LCC stack — the
dialysis DB (`zqzrriwuavgrquhisnoa`), the government DB (`scknotsqkcheojiaewwh`),
and the frontend/API surfaces (`dialysis.js`, `gov.js`, `detail.js`,
`api/capital-markets.js`, the CM Excel/PDF exports).

**Trigger:** Different LCC surfaces show different counts and different
trailing-twelve-month (TTM) figures for the same underlying universe, and the
"available / on-market" figures do not reliably drop a deal once it sells or is
withdrawn.

**Method:** Live view-definition extraction + row-level cross-tabs on both
domain databases, cross-referenced against the frontend/API read paths.

> This audit is a **companion** to `OWNERSHIP_AND_SALES_AUDIT_2026-05-23.md` and
> `OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md`. Those docs built the
> *cleanup machinery* (Track A/B/C — `transaction_state`, dedup worker, stub
> reclassifier). **This audit finds that the cleanup machinery and the
> presentation layer are wired to two different "exclude this row" switches that
> are never kept in sync** — which is why duplicates and stubs the cleanup
> already identified are still being counted in comps and TTM.

---

## 1. Executive Summary

### The single unifying root cause

There are **two parallel, unsynchronized "should this row count?" mechanisms**,
and the workers maintain one while the presentation layer reads the other:

| Mechanism | Maintained by | Read by |
|---|---|---|
| **`sales_transactions.transaction_state`** (`live` / `duplicate_superseded` / `ownership_stub` / `needs_review`) | the dedup / stub / needs-review cron workers (Track A/B — marked ✅ DONE) | **almost nothing in the presentation layer** |
| **`sales_transactions.exclude_from_market_metrics`** (boolean) | the cap-rate-quality tick + some manual flags | `v_sales_comps` (gov), `cm_*_market_quarterly` (the PDF/Excel TTM engine) |

The dedup worker tags a duplicate `transaction_state='duplicate_superseded'` but
**does not also set `exclude_from_market_metrics=true`.** The comp/CM views read
only `exclude_from_market_metrics`. So every duplicate the dedup worker catches
*still appears* in comp counts and TTM volume. **"Count each transaction once" is
violated even though the dedup machinery reports DONE.**

A parallel desync exists on the *available* side: the availability crons maintain
`is_active` / `off_market_date` / `sold_date`, but `v_available_listings` keys
only on the free-text `status` string (dia) or on "a sale exists" (gov) — neither
reads the lifecycle dates the crons actually write.

### Headline findings (all quantified against live data, 2026-05-29)

| # | Finding | Impact | Severity |
|---|---|---|---|
| **S1** | At least **5 distinct definitions** of "a sale that counts" are live across the stack (raw table; `transaction_state='live'`; `exclude_from_market_metrics`; `transaction_type IN ('Investment','Resale')`; CM's compound filter). | Every surface can legitimately show a different number. | **HIGH** |
| **S2** | Dia Sales-Comps dashboard reads **raw `sales_transactions` with no state filter** → counts `duplicate_superseded` + `needs_review`. TTM "Transactions" card ≈ **252** vs the correct **192** (+31%); 9 priced duplicates also inflate TTM **volume**. | Dia dashboard over-counts + double-counts sales. | **HIGH** |
| **S3** | Gov `v_sales_comps` excludes on `exclude_from_market_metrics` only, which is **out of sync with `transaction_state`**: 127 `duplicate_superseded` + 807 `needs_review` gov rows are **not** flagged → ~91 leak into the gov TTM comp window (gov "TTM Transactions" ≈ **143** vs ~**61** real live). | Gov dashboard over-counts. | **HIGH** |
| **S4** | The dedup desync reaches even the "clean" CM PDF: **213 dia + 127 gov `duplicate_superseded` rows are priced, Investment/Resale, and NOT excluded**, so they are counted by `cm_*_market_quarterly`. | The executive PDF double-counts sales volume & transaction count. | **HIGH** |
| **S5** | Two different **TTM window definitions**: dashboards use **rolling 12 months from today** (`now()-1yr`, includes the partial current quarter); the CM PDF/Excel uses **trailing 4 *completed* quarters** (`cm_last_completed_quarter_end()`). The two can never agree even on identical, clean data. | Dashboard vs PDF will always disagree. | **MED** |
| **A1** | Dia `v_available_listings` filters on `status IN ('active','Active','Available','For Sale')` **only — it never checks `off_market_date`, `sold_date`, or `is_active`**, which the crons maintain. **45 listings (44 withdrawn + 1 sold) show as "available."** View returns 289; truly-active is 247. | On-market count over-states by ~16%; violates "drop it when sold/withdrawn." | **HIGH** |
| **A2** | Gov `v_available_listings` uses a **third definition entirely**: available = `exclude_from_listing_metrics IS NOT TRUE AND NOT EXISTS(a sale on this property)`. It ignores `listing_status` and `off_market_date`. A withdrawn-but-unsold gov listing stays "available"; a property with *any* historical sale is dropped even if re-listed. | Gov on-market lifecycle is wrong in both directions. | **HIGH** |
| **A3** | Gov surfaces re-filter the view inconsistently: overview counts `listing_status==='active'` (146), the Available tab shows all rows incl. `under_contract` (161). Dia On-Market tab adds a hard **`listing_date >= 2023-01-01`** cutoff that no other surface applies. | Same view → 3 different on-market counts. | **MED** |
| **A4** | Frontend "is this active?" predicates disagree: `gov.js` overview uses case-sensitive `=== 'active'`; `gov.js` listings tab lowercases + accepts `for_sale`/`for sale`; `detail.js` `_salesListingIsActive` ignores `listing_status` and uses `is_active`/`!off_market_date`. | Inconsistent labels/counts per surface. | **MED** |

---

## 2. Sales Comps — the competing definitions (live view defs)

### 2.1 The five gates in play

1. **Dia dashboard — no gate.** `dialysis.js::loadDiaSalesCompsFromTxns`
   (`dialysis.js:247`) queries `sales_transactions` with `properties!inner` and
   **no `transaction_state` / `exclude_from_market_metrics` filter.** The header
   comment still claims "sales_transactions is the deduplicated authoritative
   source" — that was true before Track A, but the dedup worker now parks
   `duplicate_superseded` and `needs_review` rows **in the same table**, so the
   loader re-includes exactly the rows the worker set aside.

2. **`transaction_state='live'`** — the canonical gate the cron workers maintain.
   Read by essentially nothing in the read path.

3. **Gov `v_sales_comps`** — `WHERE s.exclude_from_market_metrics IS NOT TRUE`
   (no `transaction_state`, no price floor, no `transaction_type` filter).

4. **`transaction_type IN ('Investment','Resale')`** — used *only* by the CM
   quarterly engine, to keep stubs/transfers out.

5. **CM compound gate** — `cm_dialysis_market_quarterly` /
   `cm_gov_market_quarterly`:
   `sale_date IS NOT NULL AND sold_price > 0 AND (exclude_from_market_metrics IS
   NULL OR NOT) AND (transaction_type IS NULL OR IN ('Investment','Resale')) AND
   sale_date <= cm_last_completed_quarter_end()`. This is the **most correct**
   gate of the five — but it still misses the dedup desync (S4) because it trusts
   `exclude_from_market_metrics`, which the dedup worker doesn't set.

### 2.2 Live row counts proving the divergence (TTM window = last 12 months)

**Dialysis `sales_transactions` by `transaction_state`, within rolling 12 mo:**

| transaction_state | total rows | in TTM | in TTM & priced |
|---|---|---|---|
| live | 3,506 | **192** | 192 |
| duplicate_superseded | 504 | 9 | **9** (inflate count *and* volume) |
| needs_review | 431 | 51 | 0 (inflate count only) |

→ Dia "TTM Transactions" card = `ttmComps.length` ≈ **252**; correct = **192**.

**Government `sales_transactions`, within rolling 12 mo:**

| transaction_state | total | in TTM | excluded_from_market_metrics (all) | leaks into `v_sales_comps` TTM |
|---|---|---|---|---|
| live | 3,432 | 93 | 1,031 | 61 |
| ownership_stub | 3,313 | 366 | 3,313 (all ✅) | 0 |
| needs_review | 2,866 | 399 | 2,059 | **87** |
| duplicate_superseded | 573 | 28 | 446 | **4** |

→ `v_sales_comps` returns **143** TTM rows (only 65 priced); gov "TTM
Transactions" card ≈ **143** vs ~**61** real live. `ownership_stub` is handled
correctly (100% excluded); `needs_review` and `duplicate_superseded` are the leak.

**The dedup desync, both domains (the S4 proof):**

| domain | `duplicate_superseded` rows | of those, `exclude_from_market_metrics=true` | priced + Investment/Resale + NOT excluded → **counted by CM PDF** |
|---|---|---|---|
| dia | 504 | 291 | **213** |
| gov | 573 | 446 | **127** |

### 2.3 TTM window mismatch (S5)

- **Dashboards** (`dialysis.js:~1651`, `gov.js:~4988`):
  `ttmStart = new Date(now); ttmStart.setFullYear(-1)` → rolling 12 months from
  *today*, includes the in-progress quarter.
- **CM PDF/Excel** (`cm_*_market_quarterly`): `ttm_count`/`ttm_volume` are a window
  sum `ROWS BETWEEN 3 PRECEDING AND CURRENT ROW` over `period_end`, bounded by
  `cm_last_completed_quarter_end()` → trailing **4 completed quarters**, ending at
  the last closed quarter.

Even with identical, perfectly-clean data these produce different numbers because
the windows are different. The two surfaces should not be expected to match until
the window definition is unified (or the difference is explicitly labeled).

---

## 3. Available / On-Market Comps — the competing definitions (live view defs)

### 3.1 Dialysis `v_available_listings` (A1)

```
WHERE al.status = ANY (ARRAY['active','Active','Available','For Sale'])
```
- Keys on the free-text `status` string **only**. Does **not** read
  `off_market_date`, `sold_date`, or the `is_active` boolean — all of which the
  `lcc-availability-checker` / `lcc-auto-scrape-listings` crons maintain
  (per `CLAUDE.md`).
- Live impact: 291 rows match the status set; **44 have `off_market_date` set, 1
  has `sold_date` set** → only **247** are truly active. The view (after its
  per-property "latest listing" lateral) returns **289**.
- This is the direct violation of the stated rule: *"once a transaction has been
  completed or the property is removed from the market, those figures are
  updated."* The crons **do** record the off-market/sold event — the view just
  doesn't look at it.
- Status hygiene is poor: `Active`(164)/`active`(124) are distinct buckets; 29
  `Active` + 15 `active` rows carry an `off_market_date` while `is_active=false`.
  The `is_active` boolean is the **best-maintained** lifecycle flag and is the
  natural thing to filter on.

### 3.2 Government `v_available_listings` (A2)

```
WHERE al.exclude_from_listing_metrics IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM sales_transactions s
                  WHERE s.property_id = al.property_id AND s.sale_date IS NOT NULL)
```
- A **completely different** definition. Ignores `listing_status` and
  `off_market_date`; uses "no sale on this property" as the off-market proxy.
- Failure modes:
  - A listing **withdrawn but not sold** stays "available" forever (no sale to
    trip the `NOT EXISTS`).
  - A property with **any historical sale** (years before a new listing) is
    permanently suppressed even when genuinely re-listed.
- In practice the gov table only retains `active`(146) + `under_contract`(15)
  rows, so the view returns **161** — but the *mechanism* is wrong and will
  mis-handle the withdrawn-but-unsold and re-listed cases as they arise.
- `under_contract` (15) is counted as "available," which is debatable under a
  strict "actively being marketed" rule (a deal under contract is effectively
  spoken for).

### 3.3 Surface-level re-filtering disagreement (A3 / A4)

Same `v_available_listings` data, different counts per surface:

| Surface | File:line (approx) | Predicate | Extra window |
|---|---|---|---|
| Gov overview "Active Listings" | `gov.js:~4912` | `listing_status === 'active'` (case-sensitive) → **146** | none |
| Gov Listings tab | `gov.js:~5408` | lowercased; `active` / `for_sale` / `for sale` | none |
| Gov Sales/Available tab | `gov.js:~8443` | none (shows all **161**, incl. `under_contract`) | none |
| Dia On-Market tab | `dialysis.js:~1774` | view's status set | **`listing_date >= 2023-01-01`** hard cutoff (unique to this surface) |
| Detail panel listing badge | `detail.js:~6750` `_salesListingIsActive` | `is_active===true` else `!off_market_date` — **ignores `listing_status`** | none |

The capital-markets PDF availability donut (`cm_dialysis_available_by_tenant`)
is a separate, *lifecycle-aware* reconstruction: it pins to the latest
`period_end` of `cm_dialysis_active_listings_q`, whose base
(`cm_dialysis_active_listings_m`) correctly requires `off_market_date IS NULL AND
sold_date IS NULL` — but then widens "active" to also include `under contract`,
`superseded`, and `draft-commenced`. So the PDF's availability count is built on
yet another status set than the app's On-Market tab.

---

## 4. Why the existing remediation didn't already fix this

`OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md` marks the duplicate symptom
**"✅ FIXED — 0 live duplicates remain."** That is true *within the `live` lane*:
the dedup worker correctly moves duplicates to `transaction_state =
'duplicate_superseded'`. The gap is purely at the **boundary between the cleanup
lane and the presentation lane**:

- The plan's success metric reads `WHERE transaction_state='live'`.
- The actual comp/CM views read `WHERE exclude_from_market_metrics IS NOT TRUE`.
- Nothing guarantees `transaction_state != 'live' ⇒ exclude_from_market_metrics =
  true`, and the live data shows the two disagree for 213 dia + 127 gov
  duplicates (and hundreds of `needs_review` rows).

So the duplicates are correctly *identified* but still *presented*.

---

## 5. Recommendations (prioritized, minimal, non-breaking)

These are review recommendations — **no application/SQL changes were made by this
audit.** Each is small and can land independently.

### R1 — Make the two exclusion mechanisms one (fixes S2/S3/S4) — **do first**
Pick `transaction_state` as the single source of truth and have everything derive
from it:
- **Backfill + trigger:** `exclude_from_market_metrics := (transaction_state <>
  'live')` whenever `transaction_state` changes (and one-time backfill). This
  immediately removes the 213 dia + 127 gov leaked duplicates and the
  `needs_review` leakage from `v_sales_comps` and the CM PDF with **zero view
  changes**.
- Alternatively (cleaner long-term): add `AND s.transaction_state = 'live'` to
  `v_sales_comps` and the `closed_sales` CTE of `cm_*_market_quarterly`, and
  point the dia loader at a filtered view. Either works; the trigger is the
  lowest-risk first step.

### R2 — Stop the dia dashboard reading raw `sales_transactions` (fixes S2)
`loadDiaSalesCompsFromTxns` must filter `transaction_state='live'` (and only count
`sold_price > 0` rows in the "Transactions" card, matching volume). Update the now
stale "deduplicated authoritative source" comment.

### R3 — One shared `isListingActive()` + lifecycle-aware views (fixes A1/A2/A4)
- Redefine **both** `v_available_listings` views to require the lifecycle flags
  the crons actually maintain: `off_market_date IS NULL AND sold_date IS NULL AND
  COALESCE(is_active, true) = true` (dia), and an equivalent for gov that reads
  `listing_status` + `off_market_date` instead of "a sale exists."
- Decide explicitly whether `under_contract` counts as "available" (recommend:
  **no** — report it as its own "Under Contract" figure).
- Replace the per-surface JS predicates with a single shared helper so overview,
  listings tab, and detail badge agree.

### R4 — Unify (or explicitly label) the TTM window (fixes S5)
Decide whether "TTM" means rolling-12-months or trailing-4-completed-quarters and
apply it everywhere; if the PDF must stay quarter-aligned for sourcing reasons,
label the dashboard cards and PDF differently ("TTM (rolling)" vs "TTM (last 4
quarters)") so the discrepancy is intentional and visible.

### R5 — Normalize `status`/`listing_status` at write time
The `Active`/`active`, `Sold`/`sold`, `closed`/`Off Market`/`Stale` proliferation
(dia) and the absence of a withdrawn-but-unsold transition (gov) should be
normalized in the sidebar/cron writers and reconciled with `is_active`/lifecycle
dates so the string and the booleans can't drift again.

### R6 — Add a backslide check
Extend the Track B backslide alarms (the plan already has the harness) with:
`count(*) WHERE transaction_state <> 'live' AND exclude_from_market_metrics IS NOT
TRUE` should be 0, and `count(*) IN v_available_listings WHERE off_market_date IS
NOT NULL OR sold_date IS NOT NULL` should be 0.

---

## 6. Appendix — exact figures (live, 2026-05-29)

- Dia available: status-active=291; with off_market=44; with sold=1; truly active=247; `v_available_listings`=289.
- Gov available: `v_available_listings`=161 (`active`=146, `under_contract`=15).
- Dia sales TTM: live=192, duplicate_superseded=9 (priced), needs_review=51 (null-price).
- Gov sales TTM: live=93, ownership_stub=366, needs_review=399, duplicate_superseded=28; `v_sales_comps` TTM rows=143 (65 priced).
- Dedup desync: dia 504 superseded / 291 excluded / **213 would count**; gov 573 / 446 / **127 would count**.
- Gov stub handling: `ownership_stub` 3,313 / 3,313 excluded (correct, 0 leak).

*Audit prepared 2026-05-29. View definitions and counts pulled live from
`zqzrriwuavgrquhisnoa` (dia) and `scknotsqkcheojiaewwh` (gov). Companion to
`OWNERSHIP_AND_SALES_AUDIT_2026-05-23.md`.*
