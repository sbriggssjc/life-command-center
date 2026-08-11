# Government Seller Sentiment Worklog

## 2026-08-11

Objective:
- Fix Life Command Center Capital Markets export binding so Government seller sentiment uses the populated gov 6+ firm-term fields, not dialysis-only `_8q` columns.
- Keep listing-history capture for `initial_price`, `last_price`, ask caps, DOM, and `had_price_change` as a separate investigation/backfill track.

Context:
- `CLAUDE.md` and `.github/AI_INSTRUCTIONS.md` confirm Railway/API routing rules and domain DB boundaries.
- `docs/capital-markets/CLAUDE_CODE_PROMPT_gov_listing_history_capture.md` documents that listing-history coverage is a source capture gap, not the same issue as chart binding.
- Gov `cm_gov_seller_sentiment_m` emits populated `pct_price_change_long_term` and `last_ask_cap_long_term` for the 6+ firm-term core.
- Dialysis added `_8q` trailing-core fields later; the shared export column list caused gov sheets/charts to create blank `_8q` columns and bind the core series there first.

Plan:
- Patch `api/_shared/cm-excel-export.js` so gov seller sentiment removes `_8q` columns and relabels remaining long-term columns as `6+ yr`.
- Add regression coverage for the gov workbook schema and native chart binding.
- Separately investigate gov listing-history writers/backfill coverage after the binding fix is verified.

Changes:
- `api/_shared/cm-excel-export.js`
  - Added `selectSellerSentimentColumns()`.
  - For gov `seller_sentiment`, removes dialysis-only `_8q` columns before sheet writing, drift checks, and chart column-letter assignment.
  - Relabels all remaining `_long_term` headers from `10+ yr` to `6+ yr`.
- `test/cm-export-audit-fixes.test.mjs`
  - Added a gov workbook regression asserting `Data_Sentiment` uses populated 6+ headers and emits no trailing-8q headers or drift warning.
- `test/cm-native-chart-injector.test.mjs`
  - Added a native chart binding regression proving `_8q` is preferred only when the sheet contains those columns, and otherwise falls back to the base long-term fields.

Verification:
- `node --test test\cm-export-audit-fixes.test.mjs` — pass, 23/23.
- `node --test test\cm-native-chart-injector.test.mjs` — pass, 213 passed / 1 existing skipped.

Listing-History Investigation:
- Live DB coverage query was not run against Government because the local Supabase CLI/project context is linked to Dialysis (`zqzrriwuavgrquhisnoa`), and the current shell does not expose gov Supabase credentials. A read-only query against the linked project failed as expected because that schema did not have gov `sales_transactions.initial_price`.
- Existing GovernmentProject receipt `docs/data-quality/ask_history_retention_plan.md` is directly on point:
  - Root cause: live importers retain only the current/last ask; opening ask and vendor price-change timeline are discarded at capture.
  - Sold arm coverage after the July backfill was still only `809 / 4,799 = 16.9%` for `sales_transactions.initial_price`.
  - On-market `available_listings.initial_price` improved to `51 / 518 = 9.8%` after column harmonization.
  - Backfill ceiling is low because raw opening ask history was generally not retained.
- LCC writer trace:
  - `api/_handlers/sidebar-pipeline.js::upsertDomainSales` now maps `metadata.list_price` / `metadata.asking_price` to gov sale `initial_price` / `last_price` for the most-recent sale only, and derives `had_price_change` only when both asks are present.
  - `api/_handlers/sidebar-pipeline.js::upsertGovListings` still writes current listing `asking_price` / `asking_cap_rate` but not a distinct `original_price` or price-change history.
  - `api/_handlers/intake-promoter.js::buildGovListingRow` writes only one ask into gov listings; the dia branch sets `initial_price` and `last_price` equal to `snapshot.asking_price`, which is useful as a placeholder but cannot produce real price-change history.
  - `extension/content/costar.js` captures the stat-card asking price, but no `Listing Price History` panel or `price_change_history` payload was found.
  - `extension/sidepanel.js` still treats `list_price` as an alias for `asking_price` in normalization paths, so a distinct opening ask can be collapsed before reaching the server.

Next Capture Fix Track:
- Extend the browser extension capture to emit a distinct opening ask plus price-change timeline when CoStar/CREXi/LoopNet exposes it.
- Preserve `list_price` / `original_price` separately from current `asking_price` through sidepanel normalization.
- Update `upsertGovListings` and OM/listing importers to write `original_price`/`original_cap_rate` write-once, `last_price`/current ask separately, and upsert dated price history entries when supplied.
- Promote listing history to sold gov rows fill-blank only, guarded by sale-linked listing preference and `on_market_date <= sale_date`.

Implementation Pass:
- `extension/content/costar.js`
  - Added conservative parsing for CoStar `Listing Price History` rows.
  - Emits `price_change_history`, `original_price` / `list_price`, `original_cap_rate`, and `last_price_change` when the panel is present.
- `extension/sidepanel.js`
  - Preserves `list_price` and `original_price` separately instead of aliasing `list_price` into `asking_price`.
  - Threads original ask fields and `price_change_history` into extension metadata and OM staging seed data.
  - Upgraded asking-price sanitation to understand abbreviated CoStar values such as `$10.13M`.
- `api/_handlers/sidebar-pipeline.js`
  - Added `deriveListingAskHistory()` to normalize original/current ask, original/current ask cap, last price-change date, and vendor history rows.
  - Gov sale propagation now fills `initial_price`, `last_price`, `initial_cap_rate`, `last_cap_rate`, `had_price_change`, `pct_of_initial`, and `bid_ask_spread` from real captured ask history when available.
  - Gov active listing writer now stores original/current ask fields, protects existing original ask fields on PATCH, and inserts non-duplicate rows into `listing_price_history`.
  - Server currency parsing now handles K/M/B suffixes.
- `api/_handlers/intake-promoter.js`
  - Gov OM listings now write distinct original/current ask fields when extraction/seed data provides an original/list ask.
- `test/gov-listing-ask-history.test.mjs`
  - Added focused coverage for ask-history normalization, dedupe, cap rates, and no-fabrication behavior.

Implementation Verification:
- `node --test test\gov-listing-ask-history.test.mjs` — pass, 3/3.
- `node --test test\gov-sale-notes-ingestion.test.mjs` — pass, 10/10.
- `node --test test\pgrst204-schema-drift.test.mjs` — pass, 16/16.
- `node --test test\w3-7-om-comp-resolver.test.mjs` — pass, 24/24.
- `node --test test\sidebar-sales-writer.test.mjs` — pass, 9/9.
- `node --check extension\content\costar.js` — pass.
- `node --check extension\sidepanel.js` — pass.
