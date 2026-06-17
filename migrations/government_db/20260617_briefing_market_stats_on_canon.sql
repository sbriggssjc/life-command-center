-- R36 Phase 2: repoint lcc_briefing_market_stats onto the canonical layer (GOV).
-- Thin adapter over lcc_market_metrics (R36 Phase 1). Preserves every jsonb key
-- the briefing email reads (ttm_volume, ttm_count, avg_cap, median_cap, q1_cap,
-- q3_cap, on_market_count, on_market_volume, window_days) so the email handler is
-- unchanged; ADDS NM sub-cut keys (NM is now INCLUDED in totals per the
-- dictionary, exposed + labeled). Same body on the dia twin.
create or replace function public.lcc_briefing_market_stats(p_days int default 365)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'window_days',      m.window_days,
    'ttm_volume',       m.sold_ttm_volume,
    'ttm_count',        m.sold_ttm_count,
    'ttm_nm_count',     m.sold_ttm_nm_count,
    'ttm_nm_volume',    m.sold_ttm_nm_volume,
    'avg_cap',          m.avg_cap_rate,
    'median_cap',       m.median_cap_rate,
    'q1_cap',           m.q1_cap_rate,
    'q3_cap',           m.q3_cap_rate,
    'on_market_count',  m.on_market_total,
    'on_market_volume', m.on_market_volume,
    'on_market_nm',     m.on_market_nm
  )
  from public.lcc_market_metrics(p_days) m;
$$;

comment on function public.lcc_briefing_market_stats(int) is
  'R36: thin adapter over lcc_market_metrics (the canonical market-metric layer). NM included in totals + exposed as sub-cut.';
