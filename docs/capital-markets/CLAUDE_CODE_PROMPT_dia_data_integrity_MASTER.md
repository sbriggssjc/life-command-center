# Claude Code master prompt — Dialysis cap/rent/price data integrity (ordered, single session)

> Run in ONE Claude Code session in the **DialysisProject** repo. This supersedes and
> consolidates four earlier prompts (`rent_at_sale`, `bid_ask_spread_data`,
> `cap_rate_of_record`, and the `initial_price` notes) into a single dependency-ordered
> pass. Do the phases IN ORDER — later phases depend on earlier ones
> (cap-of-record can't trust a derived cap until rent reconciles; the chart views can't be
> repointed until the field of record exists).

```
You are fixing the dialysis sales/listing data so that cap rate, NOI (rent), and asking
price are each captured once, correctly, with provenance — and every Capital Markets chart
and comp reads a single authoritative value instead of choosing among several stored fields.

The guiding rule the business gave us: "We either KNOW the value or we DON'T." One trusted
value per fact (with a source tag), null when genuinely unknown — never several competing
columns that different views COALESCE differently.

## Environment
- Supabase "Dialysis_DB", ref zqzrriwuavgrquhisnoa, schema public. Use the Supabase MCP/CLI.
- Migrations + ingestion code live in this repo. Follow repo git rules (feature branch off
  origin/main, PR, copy/paste merge + test commands at the end). Never commit secrets.
- Backfills MUST record provenance and MUST NEVER clobber a manual override.
- Work phase by phase; open a short findings note per phase before changing data.

================================================================================
PHASE 1 — rent_at_sale (NOI) must reconcile with cap rate   [do first]
================================================================================
Symptom (measured 2026-06-01): across NM dialysis sales with a usable cap (4-12%),
SUM(rent_at_sale)/SUM(sold_price) = 3.6% while the average cap_rate for the same deals is
6.8%. If rent_at_sale were the annual NOI behind the cap, rent/price would equal the cap. It's
~half — so rent_at_sale is NOT the NOI the cap implies (looks like base/partial rent, monthly,
per-SF, or a mixed/garbage field). The master comp workbook's RENT column DOES reconcile
(its SOLD CAP = RENT / PRICE), so the firm's intended definition is annual NOI.

Why first: calculated_cap_rate is literally rent_at_sale/sold_price on ~1,104 rows, so a wrong
rent corrupts the derived cap. Phase 3's cap-of-record ladder can only trust a derived
("noi_derived") cap AFTER rent is correct.

Tasks:
1. QUANTIFY. For sold rows with rent_at_sale>0, sold_price>0, usable calculated_cap_rate,
   compute r = (rent_at_sale/sold_price)/calculated_cap_rate. Report the distribution
   (median, IQR, share near 1.0 vs 0.5 vs 0.083[=monthly] vs other) to tell uniform-factor
   from mixed-garbage.
2. TRACE every writer of rent_at_sale (OM-intake extractor, CoStar sidebar pipeline,
   manual/CSV import) and what each stores: annual NOI? gross? base excl. reimbursements?
   monthly? per-SF? Read the actual extraction/mapping code.
3. CHECK whether calculated_cap_rate is itself derived from rent_at_sale for some rows
   (r ~= 1, self-consistent but wrong-scaled); separate self-derived from independently-sourced.
4. DIAGNOSE the dominant cause + fix: monthly -> annualize (x12); per-SF -> x building size;
   base-excl-reimbursements -> reconcile to NOI or relabel; mixed across sources ->
   standardize writers to store ANNUAL NOI and backfill, recording provenance. Do NOT change
   an independently-correct cap.
5. VALIDATE: post-fix SUM(rent_at_sale)/SUM(sold_price) ~= avg cap (~6.8%), with a
   per-rent_source reconciliation table.

================================================================================
PHASE 2 — available_listings price/cap capture (last_cap_rate + initial_price)
================================================================================
Two fields in available_listings are copy-corrupted: each was set equal to the sold value
instead of captured independently. Both can be fixed together (same table, same writers).

2A. last_cap_rate (drives the Bid-Ask Spread chart).
   Symptom: cm_dialysis_bid_ask_spread_m computes spread = sold cap - last_ask cap. Of 712
   sold listings with both caps in 4-12%, 503 (71%) have last_cap_rate EXACTLY equal to the
   sold cap_rate -> spread ~0, vs the deck's clean +44-69 bps (Dialysis Market Filter p.34).
   Tasks: trace every writer of available_listings.last_cap_rate; fix capture so it is the
   listing's true LAST ASKING cap (last asking price / same NOI used for the sold cap),
   independent of the achieved cap. Where the true last ask is unknown, leave NULL (don't
   copy the sold cap). Backfill from last_price/initial_price where present. Also relax the
   view's achieved_last_ask_cap gate (currently n_with_last_cap>=5 AND n_with_spread>=5) so
   it populates wherever avg_last_ask_cap + avg_bid_ask_spread both exist.

2B. initial_price (drives the % of Ask chart AND the Seller Sentiment price-change line).
   Symptom: % of ask = sold_price/initial_price. Of 828 sold listings with both prices,
   278 (33.6%) have initial_price EXACTLY equal to sold_price (copied, not the true first
   broadly-marketed ask) and another 174 (21%) show sold>initial (implausible); median ratio
   = 100%. That inflated the line to ~98-100% (sale >= ask, impossible); the deck shows a
   realistic 88-95% band, avg ~93.7% (p.33). The SAME corruption also inflates Seller
   Sentiment's price-change rate, since had_price_change = (initial_price <> last_price):
   we show 43-68% in recent thin months vs the deck's ~18-25% (p.35).
   Tasks: trace every writer of initial_price (and last_price); fix capture so initial_price
   is the FIRST broadly-marketed asking price, independent of the sale. Where unknown, leave
   NULL rather than copying sold_price. Backfill from listing-history/price-change records.
   VALIDATE: avg(sold_price/initial_price) over genuine deals ~ 88-95%; share of
   initial_price=sold_price drops toward 0; had_price_change reflects real list reductions
   and the sentiment % lands near the deck's band.

Interim chart-side patches already shipped (so you know what's already mitigated, not data):
   - % of ask view now trims sold/initial to strict <1.0 (R66n).
   - Seller Sentiment view gates thin months + uses 10+yr cohort + smoothing (R66p).
   - Bid-Ask chart is rebuilt to the master's floating-bar design (renders correctly once the
     spread data is real). These are display stopgaps; this phase is the durable fix.

================================================================================
PHASE 3 — single cap-rate-of-record (kill the 3-field divergence)   [depends on 1]
================================================================================
Symptom (3,853 investment/resale sales): cap rate lives in three columns —
calculated_cap_rate (2,480 rows), stated_cap_rate (1,251), raw cap_rate (1,696); 943 (24%)
have NONE. The two reported fields agree (stated vs raw disagree >25bps on only 148 rows);
calculated_cap_rate is the outlier (disagrees with stated on 523, with raw on 778) BECAUSE
1,104 of its values are exactly rent_at_sale/sold_price — a derived field on top of the
(Phase 1) broken rent. On NM deals calculated averages 7.36% vs broker-stated 6.77% / raw
6.67%; the deck's NM figure is 6.70%, matching the REPORTED caps, not calculated.

Tasks:
1. DECIDE the canonical model: a single cap_rate of record (reuse cap_rate, OR add
   cap_rate_final) + cap_rate_source text ('broker_stated'|'source_reported'|'noi_derived'|
   'manual'|null) + keep cap_rate_quality for the implausibility flag. Document in the
   migration + a repo doc.
2. SOURCE PRIORITY (highest trust first), at write time AND in a backfill:
     a. manual override (never clobbered)
     b. broker_stated  (stated_cap_rate)
     c. source_reported (raw cap_rate as ingested from CoStar/CMS, when distinct from the calc)
     d. noi_derived (rent_at_sale/sold_price) ONLY after Phase 1 reconciles
     e. else NULL + source=null  (genuinely unknown is allowed and correct)
   Band-check 4-12%; respect cap_rate_quality='implausible_unverified' (null it).
3. STOP trusting calculated_cap_rate as primary. Don't delete it (audit history); it must
   never outrank a reported cap. After Phase 1 it can be recomputed as a clean noi_derived
   candidate used only at priority (d).
4. TRACE + FIX writers. Route every setter of any cap field (OM-intake, CoStar sidebar,
   CMS/CSV, manual) through one helper that writes the canonical field + source + provenance.
5. BACKFILL by the ladder, writing provenance. Before/after table: rows with a trusted cap,
   rows still null, and source-mix (% broker_stated / source_reported / noi_derived).

================================================================================
PHASE 4 — repoint the views + end-to-end validation   [depends on 1-3]
================================================================================
1. Point every cap-consuming view at the ONE canonical field; drop inline COALESCEs. Grep
   the repo + DB for calculated_cap_rate, stated_cap_rate, and coalesce(... cap_rate ...).
   At minimum: cm_dialysis_cap_ttm_m, cm_dialysis_cap_quartile_m, cm_dialysis_valuation_index_m,
   cm_dialysis_nm_vs_market_m, cm_dialysis_market_quarterly_master_m (+ _m), 
   cm_dialysis_sold_cap_by_term_m, the Core Cap dot plot, NM Notable Transactions, and any
   v_sales_comps consumer.
2. VALIDATE end to end:
   - Every view returns the SAME cap for the same sale.
   - NM-vs-Market: NM ~6.6-6.8% and the NM-below-market gap ~45-63 bps (deck p.38).
   - % of Ask: ~88-95% band, no sale above ask (deck p.33).
   - Bid-Ask: per-deal spread a coherent positive band ~30-70 bps (deck p.34).
   - Seller Sentiment: all-deals price-change near the deck's ~18-25%; 10+yr cap <= all (p.35).
   - Valuation Index numerator (avg rent_at_sale) is sane; NM cap line can move from
     price-weighting to true NOI-weighting (SUM rent / SUM price) to match the master.
   - The 24% "no cap" cohort is genuinely unknown, not a pipeline miss.

## Government parity (note, lower priority — separate repo/session)
The gov DB already uses a single sold_cap_rate column, so it lacks the 3-field problem; just
confirm it carries a cap_rate_source provenance tag and the same band/quality handling. The
gov Federal/State/Municipal agency-tier work is a DIFFERENT effort (GovernmentProject repo) —
keep it in its own session; do not fold it in here.

## Constraints / non-goals
- Don't invent values. No trusted source -> NULL. "We don't know" beats a derived-from-bad-data
  number.
- Never clobber a manual override.
- Respect the phase order: noi_derived caps are only trustworthy AFTER Phase 1.
```
