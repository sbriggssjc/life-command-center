-- SALE1 — a review lane for sold_price rows that disagree with independent
-- evidence, in TWO distinct shapes. NOTHING here writes to sold_price.
-- Reset caution: a wrong price and a right-looking price look identical from
-- the outside; every row on this view needs a human read before any reset,
-- same as the "two live rows at one price is a question, not a verdict"
-- doctrine (B6c-dup). No auto-resolve predicate exists for either class.
--
-- Class 'ledger_disagreement' — the CURRENT sold_price disagrees with the
-- EARLIEST price this exact (property, sale_date) was ever recorded at in
-- cap_rate_history (dia's closest thing to a run ledger — sales_transactions
-- itself carries no created_at/audit trail). A later capture silently
-- overwrote an already-recorded price; the earlier value may be right, the
-- later one may be right, or neither may be — read the row.
--
-- Class 'deed_says_undisclosed' — the matching deed_records row (same
-- property, same recording_date) states the sale price as NOT DISCLOSED /
-- CONFIDENTIAL in its own raw_payload, yet sales_transactions carries a
-- non-null sold_price for that date. The price did not come from this deed.

create or replace view v_dia_sale1_price_review as
with earliest_ledger as (
  select distinct on (property_id, event_date)
    property_id, event_date, price_at_event, created_at as ledger_first_seen_at
  from cap_rate_history
  where event_type = 'sale'
  order by property_id, event_date, created_at asc
),
ledger_disagreement as (
  select
    s.sale_id, s.property_id, s.sale_date, s.sold_price as current_price,
    e.price_at_event as earliest_recorded_price,
    e.ledger_first_seen_at,
    'ledger_disagreement'::text as review_class,
    s.transaction_type, s.exclude_from_market_metrics, s.cap_rate_final
  from sales_transactions s
  join earliest_ledger e
    on e.property_id = s.property_id and e.event_date = s.sale_date
  where s.transaction_state = 'live'
    and s.sold_price is not null
    and e.price_at_event is not null
    -- exclude the cap_rate_history data artifact where a ratio (e.g. "1.30")
    -- landed in price_at_event instead of a dollar figure — those aren't a
    -- price disagreement, they're a separate producer defect (not this lane)
    and e.price_at_event > 1000
    and abs(s.sold_price - e.price_at_event) / e.price_at_event > 0.01
),
deed_undisclosed as (
  select
    s.sale_id, s.property_id, s.sale_date, s.sold_price as current_price,
    null::numeric as earliest_recorded_price,
    null::timestamptz as ledger_first_seen_at,
    'deed_says_undisclosed'::text as review_class,
    s.transaction_type, s.exclude_from_market_metrics, s.cap_rate_final
  from sales_transactions s
  join deed_records d
    on d.property_id = s.property_id
    -- recording_date (deed) commonly trails the transaction date (sale) by a
    -- few days to a couple weeks -- the same +-14d tolerance the writer's own
    -- matching window uses (sidebar-pipeline.js upsertDomainSales). An exact
    -- date match missed dia 35612 sale 8090 (transaction 5/15, recorded 5/20).
    and abs(d.recording_date - s.sale_date) <= 14
  where s.transaction_state = 'live'
    and s.sold_price is not null
    and d.consideration is null
    and (
      d.raw_payload->>'sale_price' is null
      or d.raw_payload->>'sale_price' ilike '%not disclosed%'
      or d.raw_payload->>'sale_price' ilike '%confidential%'
    )
)
select * from ledger_disagreement
union all
select * from deed_undisclosed
order by property_id, sale_date;

comment on view v_dia_sale1_price_review is
  'SALE1 review lane, read-only. ledger_disagreement = current sold_price != '
  'earliest cap_rate_history price_at_event for that (property, sale_date). '
  'deed_says_undisclosed = matching deed_records row states no/undisclosed '
  'price. Neither class is auto-resolved -- a human reads the row and, if '
  'warranted, resets sold_price by hand (or nulls it) with a dated note. '
  'Grep code SALE1 for the writer fixes that stop new rows from entering '
  'either class going forward.';
