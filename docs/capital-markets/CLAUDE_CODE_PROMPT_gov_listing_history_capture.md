# Claude Code prompt — capture listing price-change / initial-ask history (government)

> Run primarily in the **GovernmentProject** repo (gov sales ingestion), with a
> companion pass in **life-command-center** for the CoStar sidebar pipeline
> (`api/_handlers/sidebar-pipeline.js`), which is the live writer of these
> fields. This is a data-CAPTURE gap, not a view bug: the Capital Markets
> supply-side charts have almost no bars/spread to draw because the underlying
> listing-history columns are only ~7-8% populated. Separate from the gov
> agency-tier classifier and the dia listing_date / lease-term prompts.

```
Improve coverage of listing price-change / initial-ask history on government
sales so the supply-side Capital Markets charts (Seller Sentiment, DOM &
Price-Change, Bid-Ask Spread) have enough data to plot.

## Environment
- Supabase "government", ref scknotsqkcheojiaewwh, schema public. Use the
  Supabase MCP/CLI.
- The live writers of these fields are the CoStar sidebar pipeline
  (life-command-center: api/_handlers/sidebar-pipeline.js) and the gov
  ingestion in this repo. Follow repo git rules (feature branch off
  origin/main, PR, copy/paste merge + test commands). Record provenance via
  the field_provenance / lcc_merge_field machinery; never clobber a manual
  override or a higher-priority source.

## The fields in question (public.sales_transactions)
  initial_price, initial_cap_rate   — original asking price / cap at list
  last_price,    last_cap_rate       — final asking price / cap before sale
  pct_of_initial                     — sold_price / initial_price (capitulation)
  bid_ask_spread                     — initial ask cap vs sold cap (bps)
  had_price_change                   — boolean; TRUE when the ask changed
  days_on_market                     — list-to-sale DOM
  listing_broker                     — listing brokerage (proxy for "we had the listing")

## How the chart fields are derived today (read before changing)
- `had_price_change` is computed correctly from the data present: it is TRUE iff
  initial_price <> last_price. Verified: among 2014+ gov sales, 21 rows have
  initial<>last AND had_price_change=TRUE, and ZERO rows have a price change
  with the flag unset. So the FLAG is fine — the inputs are missing.
- Seller Sentiment bars (cm_gov_seller_sentiment_m): Price Chg % =
  count(had_price_change) / count(sales) over a TTM window.
- DOM & Price-Change and Bid-Ask Spread charts read days_on_market /
  bid_ask_spread / pct_of_initial off the same rows.

## The symptom (measured 2026-06-02)
- Of 2,675 gov market sales since 2014, only ~203 (7.6%) carry initial_price /
  last_price, ~192 carry initial_cap_rate / last_cap_rate, and the same ~7-8%
  carry days_on_market / bid_ask_spread / pct_of_initial.
- had_price_change is TRUE for just 0-5 sales PER YEAR (21 total since 2014),
  because you can only detect a price change on the ~7.6% of rows that have
  both initial and last asking values.
- Coverage is concentrated in the NM-brokered / CoStar-listing-captured subset
  and is essentially absent before ~2018 — so the Seller Sentiment Price Chg %
  bars are empty pre-2018 and thin-denominator-noisy in the low-volume recent
  quarters; the Bid-Ask Spread and DOM charts are sparse for the same reason.

## Tasks
1. QUANTIFY coverage and source. For gov sales (sale_date NOT NULL,
   sold_price>0, not exclude_from_market_metrics): what share carry
   initial_price/last_price, initial_cap_rate/last_cap_rate, days_on_market,
   bid_ask_spread? Break coverage down by data_source / listing_broker present /
   year so the captured-vs-uncaptured subsets are explicit.
2. TRACE the writers. Find every path that writes initial_price / last_price /
   initial_cap_rate / last_cap_rate / days_on_market / bid_ask_spread
   (CoStar sidebar upsertDomainSales + public-records writers, CMBS pipeline,
   OM intake promoter, CSV/CMS import, manual). Determine which actually capture
   the listing's ORIGINAL ask + price-change events vs only the final figures.
3. BACKFILL from the listing's own history where available:
   - CoStar Sale/Listing detail carries the initial ask, current/last ask, days
     on market, and a price-change history — capture initial_price/initial_cap_rate,
     last_price/last_cap_rate, days_on_market onto the sale row.
   - OM / flyer intake frequently states an asking price and sometimes a prior
     ask — capture where present.
   - Prefer a real captured ask; never fabricate one.
4. RECOMPUTE the derived fields consistently once inputs exist:
   - had_price_change := (initial_price IS NOT NULL AND last_price IS NOT NULL
     AND initial_price <> last_price)
   - pct_of_initial   := sold_price / NULLIF(initial_price,0)   (guard 0.5-1.05 sane band)
   - bid_ask_spread   := initial_cap_rate - sold_cap_rate (bps), banded sanely
   Stamp provenance; only fill blanks, never clobber curated/manual values.
5. CONSIDER whether days_on_market should be derived from listing_date ->
   sale_date when an explicit DOM wasn't captured (coordinate with the
   listing_date work so the two don't disagree).

## Validate (the charts that should improve)
- Seller Sentiment (cm_gov_seller_sentiment_m): Price Chg % bars become
  populated across more of the timeline (not just post-2018), and the
  per-period denominators are large enough that the bars stop being
  thin-denominator spikes.
- Bid-Ask Spread (gov) and DOM & Price-Change (gov): materially denser series
  once initial-ask / DOM coverage rises well above ~8%.
- Coverage: share of gov sales with initial_price + last_price rises materially
  above 7.6%.

## Constraints / non-goals
- Don't invent asks or price changes. If a listing's original ask was never
  captured, leave the fields NULL (the sale stays out of the price-change /
  bid-ask metrics) rather than guessing.
- Never clobber a manual override; backfills record provenance and respect
  field_source_priority.
- This is the listing-HISTORY dimension only (initial/last ask, DOM, spread).
  Agency credit-tier classification and the dia listing_date / lease-term work
  are separate prompts.
```
