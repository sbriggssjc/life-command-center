-- SALE1a — hand-read the 45 "listing-matched" ledger_disagreement rows (dia
-- current sold_price matches a value on that property's own available_listings
-- history AND disagrees with the earliest cap_rate_history observation for
-- that sale). Of 45: 1 confirmed to the earliest value by a matching deed
-- (exact), 1 has a deed stating a THIRD figure (the deed's own consideration
-- wins over either recorded number), 1 (dia master-import property 35612,
-- already investigated in SALE1) is corroborated by an independent import
-- source distinct from CoStar. THE OTHER 42 GET NO WRITE — neither number is
-- independently corroborated, and resetting on a bare disagreement would
-- just be trading one unverified figure for another. See
-- v_dia_sale1_price_review for the full 45-row read, bucketed.
--
-- Reset caution, honored: every write below is backed by a SPECIFIC piece of
-- independent evidence named in cap_rate_notes, not by "the earlier number
-- looked more plausible."
--
--   sale_id  property  action                     evidence
--   288      23425     SUPERSEDE (not reprice)     property 23425 ALREADY
--                                                   carries a second live row
--                                                   (sale_id 14591, same
--                                                   date, $3,367,292,
--                                                   data_source=
--                                                   master_xlsx_backfill_r2)
--                                                   at the exact
--                                                   deed-confirmed price --
--                                                   288 is a genuine
--                                                   duplicate, not a wrong
--                                                   price to correct.
--                                                   Discovered because the
--                                                   UPDATE attempt hit
--                                                   sales_property_date_price_uidx.
--   8312     26411     SUPERSEDE (not reprice)     same discovery as 288:
--                                                   property 26411 already
--                                                   carries a live row
--                                                   (sale_id 8313, one day
--                                                   earlier, $4,285,000,
--                                                   costar_sidebar) at the
--                                                   deed-confirmed price --
--                                                   PLUS two already-
--                                                   superseded siblings at
--                                                   $4,354,000 and $4,285,000.
--                                                   8312 ($4,300,000) is a
--                                                   fourth observation of one
--                                                   conveyance, not a price to
--                                                   correct.
--   8091     35612     reset to $1,233,000         cap_rate_history
--                                                   source_file=
--                                                   'dia_master_sales' (an
--                                                   independent curated
--                                                   import, not a CoStar
--                                                   re-derivation) -- same row
--                                                   investigated in
--                                                   SALE1/Hillsboro; current
--                                                   $1,593,750 is proven bled
--                                                   from the property's own
--                                                   current listing price.
--
-- NOT reset, named: property 2051617 (sale 5169) is ALSO dia_master_sales-
-- sourced at $19,179,930 vs current $2,729,582 (7x) -- but the source's own
-- notes read "master_import sale: Fresenius Medical Care (Portfolio)". A
-- portfolio label on the corroborating source is the QA1 aggregate-bleed
-- signature this repo already treats as untrustworthy at the single-property
-- grain. Both numbers here are suspect; neither is written.

begin;

-- 288 is a duplicate of 14591 (same property, same date, deed-confirmed
-- price already lives on the survivor) -- supersede, do not reprice. Was
-- already exclude_from_market_metrics=true, so this has no comps impact;
-- it dedupes the live-row count.
update sales_transactions
set transaction_state = 'duplicate_superseded',
    dedup_group_id = 14591,
    cap_rate_notes = trim(both ' | ' from
      coalesce(cap_rate_notes || ' | ', '')
      || '[sale1a-dedup-20261009] superseded by sale_id 14591 (same property/date, deed-confirmed $3,367,292) -- 288''s $3,175,000 was the unverified duplicate'
    )
where sale_id = 288 and sold_price = 3175000.00 and transaction_state = 'live';

-- 8312 is a duplicate of 8313 (deed-confirmed $4,285,000, already live) --
-- supersede, do not reprice. Already exclude_from_market_metrics=true.
update sales_transactions
set transaction_state = 'duplicate_superseded',
    dedup_group_id = 8313,
    cap_rate_notes = trim(both ' | ' from
      coalesce(cap_rate_notes || ' | ', '')
      || '[sale1a-dedup-20261009] superseded by sale_id 8313 (deed-confirmed $4,285,000, one day earlier) -- 8312''s $4,300,000 was a fourth observation of the same conveyance'
    )
where sale_id = 8312 and sold_price = 4300000.00 and transaction_state = 'live';

update sales_transactions
set sold_price = 1233000.00,
    cap_rate_notes = trim(both ' | ' from
      coalesce(cap_rate_notes || ' | ', '')
      || '[sale1a-reset-20261009] sold_price reset $1,593,750 -> $1,233,000: dia_master_sales import (independent of costar_sidebar); current value was bled from this property''s own current listing price (see SALE1)'
    )
where sale_id = 8091 and sold_price = 1593750.00;

commit;

-- REVERSAL:
--   update sales_transactions set transaction_state = 'live', dedup_group_id = null,
--     cap_rate_notes = regexp_replace(cap_rate_notes, '\[sale1a-dedup-20261009\][^|]*', '', 'g')
--   where sale_id in (288, 8312);
--   update sales_transactions set sold_price = 1593750.00,
--     cap_rate_notes = regexp_replace(cap_rate_notes, '\[sale1a-reset-20261009\][^|]*', '', 'g')
--   where sale_id = 8091;
