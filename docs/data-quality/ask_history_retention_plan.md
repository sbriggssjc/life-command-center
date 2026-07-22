# Ask-History Retention Plan — LCC shared capture layer (dia + gov)

The LCC CoStar sidebar + OM promoter are the **highest-volume live writers** into both
`available_listings` tables (Dialysis_DB `zqzrriwuavgrquhisnoa`, Government_DB
`scknotsqkcheojiaewwh`). They are the shared root cause of the missing
`INITIAL ASK / INITIAL CAP / % ASK ACHIEVED / BID-ASK SPREAD / PRICE CHG` on
`rpc_query_comps`. Per-vertical detail + the DB baselines/backfill ceilings live in:

- `government-lease/docs/data-quality/ask_history_retention_plan.md`
- `Dialysis/docs/data-quality/ask_history_retention_plan.md`

Grounded live 2026-07-23.

---

## 1. What the LCC writers do today (opening ask discarded)

| Writer | File:line | Opening-ask behavior |
|---|---|---|
| CoStar sidebar → dia | `api/_handlers/sidebar-pipeline.js::upsertDialysisListings` (:10160, row :10343) | `initial_price = last_price = asking_price` (**identical**); no `price_change_history`, no `last_price_change`. |
| CoStar sidebar → gov | `…::upsertGovListings` (:10639, row :10709) | writes only `asking_price` — does not even populate `original_price`. |
| OM promoter → dia | `api/_handlers/intake-promoter.js::buildDiaListingRow` (:302, :361) | `initial_price = last_price = snapshot.asking_price` (identical). |
| OM promoter → gov | `…::buildGovListingRow` (:195, :260) | writes only `asking_price`. |
| Sale-close history (gov only) | `sidebar-pipeline.js::upsertDomainSales` govListingHistory (:5395) | the **only** place `initial_price`/`last_price`/`had_price_change`/`pct_of_initial` are computed — but for the most-recent *closed* sale only, and only when `metadata.list_price ≠ asking_price`. |

**The payload has no opening ask.** `extension/sidepanel.js:1570` aliases
`asking_price: ['asking_price','list_price']` — `list_price` is a synonym of the
current ask, not a distinct launch price. `extension/content/costar.js` (:1201)
captures a single `asking_price` and **never scrapes CoStar's "Listing Price
History" panel**. On-market date + DOM are captured; a price-change series is not.
So `initial_price ≠ last_price` almost never holds and the sale-history block
(:5409) almost always records no change.

The on-market ≤ capture/sale guard already exists: `api/_shared/listing-date.js`
`deriveOnMarketDate` (:118, guard :124) never returns a future/post-sale date;
the gov sale-history writer guards `on_market ≤ sale_date` (`sidebar-pipeline.js:5404`).

---

## 2. The retention change (scoped — cannot ship cleanly this pass)

Three parts, capture-first. The true root fix is browser-extension code that
**cannot be exercised in this environment**, and the importer diff is a no-op
until the extension supplies a distinct opening ask — so this is scoped, with the
exact edit sites, for a dedicated capture-layer PR.

**2.1 Extension (root fix, untestable here).**
`extension/content/costar.js` — scrape the "Listing Price History" panel and emit
`original_price` (launch ask), `price_change_history` (`[{date, price, cap_rate}]`),
`last_price_change`. `extension/sidepanel.js:1570` — stop collapsing `list_price`
into `asking_price`; carry it as the distinct opening ask when present. Mirror for
CREXi/LoopNet price-reduction badges.

**2.2 LCC importer retention (ships once 2.1 lands).**
- `upsertDialysisListings` / `buildDiaListingRow`: set `initial_price` from the
  payload's opening ask (`metadata.original_price` / distinct `list_price`),
  falling back to `asking_price` only when absent; set `last_price` to the current
  ask; **on the active-PATCH / re-ingest branch, never overwrite a non-NULL
  `initial_price`** (write-once), and append a `price_change_history` entry +
  `last_price_change` when the ask moves.
- `upsertGovListings` / `buildGovListingRow`: populate `original_price` (opening,
  write-once) distinct from `asking_price` (current); when the extension supplies
  `price_change_history`, thread it through.
- Extend the sale-history block (`upsertDomainSales`) beyond the most-recent
  closed sale so a listing that transacted always propagates its opening ask into
  `sales_transactions.initial_price` (gov sold arm reads that column directly).

**2.3 Sold-arm propagation guard (already correct where it exists).** Keep the
`on_market_date ≤ sale_date`, sale-linked-listing-preferred rule (the same logic
shipped as the gov `sql/20260723_gov_ask_history_backfill.sql` Part B) whenever a
listing's opening ask is copied onto a sale.

---

## 3. What shipped this pass vs. what is scoped

- **Shipped:** the gov low-risk fill-NULL backfill (`government-lease/sql/20260723_gov_ask_history_backfill.sql`): sold INITIAL ASK 16.3% → 16.9% (+29, plausibility-guarded), on-market 0 → 9.8% (+51, closing a column mismatch). No dia data write (backfill ceiling verified ~0).
- **Scoped (this doc + the two vertical docs):** §2 extension + importer retention — the only lever that raises the ~80% missing ask history, because no raw opening ask was ever retained to backfill from.

---

## 4. Guardrails

Never overwrite a verified ask (write-once `initial_price`/`original_price`);
on-market ≤ sale-date on every sale-linked ask; keep raw alongside parsed;
reversible + logged + dry-run first (see the per-vertical migration headers).
