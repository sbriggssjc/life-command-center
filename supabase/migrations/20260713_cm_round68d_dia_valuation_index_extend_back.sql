-- =============================================================================
-- Round 68 batch 3 — Task 5 (D3): extend the dia Capital Markets Valuation Index
-- back to the thin-data gate instead of starting 2014.
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa) | Date: 2026-06-05
--
-- DIAGNOSIS (grounded live 2026-06-05):
--   cm_dialysis_valuation_index_m first non-null = 2014-04-30. Two crops caused it:
--     (a) month_anchors hard-floored at 2010-01-01.
--     (b) the index only renders at/after `base_period` = the first month whose
--         TTM rent+cap count (ttm_n) >= 30; rent_at_sale+cap coverage doesn't
--         reach ~30 until early 2014, so everything before the base was dropped
--         by `WHERE t.period_end >= b.base_period`.
--   The base (=100 reference) is fine where it is — a thin early base would make
--   the whole curve unstable. The fix is purely DISPLAY: keep the base anchored
--   at ttm_n>=30, but render earlier months (index <100) down to a per-row
--   thin-data gate of ttm_n>=12, and lower the anchor floor so those months exist.
--
-- VALIDATION (read-only, live; per-row gate ttm_n>=12, base unchanged at >=30):
--   the index extends 2014-04 -> 2011-09 with no whipsaw and pre-2011 (n<12)
--   honestly gated out:
--     yr   first_anchor  min_n  idx range
--     2011 2011-09-30    12     120.3 .. 123.4
--     2012 2012-01-31    12      96.8 .. 127.9
--     2013 2013-01-31    12      90.5 .. 105.9
--     2014 2014-01-31    26      91.7 .. 115.7   (base month inside this year)
--   This is the dia twin of the gov G13 min-n gate: separation kept, thin years
--   suppressed rather than fabricated.
--
-- The yoy_change_pct column (lag-12 of this index) inherits the longer window
-- automatically. NOTE: the OTHER yoy series, cm_dialysis_yoy_change_m (lag-12 of
-- ttm_volume via master_m), already carries data from 2002 in the view — its
-- "starts 2014" symptom is a CHART/EXPORT crop, not a view clamp, and is handled
-- separately (gate master_m yoy at transaction_count_ttm>=12 + extend the chart
-- x-axis floor). This migration touches ONLY the valuation index.
--
-- Surgical string-replace on the LIVE def (R66x pattern) so the body — the
-- closed_sales filter, the ttm_n>=30 base, smoothing, the yoy lag-12, and the
-- column contract — stays byte-for-byte identical except the two crops. Re-run
-- safe: both target substrings are absent after the first apply (idempotent).
-- =============================================================================
-- ── _m (monthly): extend back + add the per-row thin-data gate ───────────────
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_dialysis_valuation_index_m'::regclass, true);
  -- (a) lower the anchor floor 2010 -> 2008 (sales begin 2008; nothing renders
  --     before the n>=12 gate regardless, so this just makes the months exist).
  v := replace(v, '''2010-01-01''::date::timestamp with time zone', '''2008-01-01''::date::timestamp with time zone');
  -- (b) swap the base-period display crop for a per-row thin-data gate.
  v := replace(v, 'WHERE t.period_end >= b.base_period', 'WHERE t.ttm_n >= 12');
  IF position('''2008-01-01''::date' IN v) = 0 OR position('t.ttm_n >= 12' IN v) = 0 THEN
    RAISE EXCEPTION 'round68d valuation-index_m extend: target substring not found — live def drifted; re-derive the replacements';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_valuation_index_m AS ' || v;
END $$;

-- ── _q (quarterly): same anti-whipsaw gate ──────────────────────────────────
-- _q has no anchor floor and no base-period crop, so it already renders from
-- 2000-09-30 — but with NO thin-data gate (22 quarters at TTM n<12 of pure
-- whipsaw). Add the SAME ttm_n>=12 gate so the pair is consistent and the early
-- years are suppressed rather than fabricated. Base (ttm_n>=30) is untouched.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_dialysis_valuation_index_q'::regclass, true);
  v := replace(v, 'WHERE indexed.valuation_index IS NOT NULL', 'WHERE indexed.valuation_index IS NOT NULL AND indexed.ttm_n >= 12::numeric');
  IF position('indexed.ttm_n >= 12::numeric' IN v) = 0 THEN
    RAISE EXCEPTION 'round68d valuation-index_q gate: target substring not found — live def drifted';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_valuation_index_q AS ' || v;
END $$;
