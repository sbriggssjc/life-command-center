-- CM final closeout T9 (2026-06-28) — gov cap-by-term buckets -> contiguous
-- 10+ / 6-10 / <6. The dedicated gov term views were already contiguous
-- ((5,10]+<=5 / [5,10)+(0,5)) so [5,6)yr sales were NOT in a data gap, but the
-- legend labels "6-10"/"<5" falsely implied one. Shift the lower-bucket boundary
-- 5 -> 6 so the legend "<6" is literally true and [5,6)yr sales land in the <6
-- bucket (verified: bucket counts reconcile exactly, no gap, no double-count).
-- The chart legend labels ("< 6 Year") are changed in cm-chart-image-renderer.js
-- + cm-excel-export.js (native-chart header text). Applied live to gov
-- (scknotsqkcheojiaewwh). Reversible: swap 6 back to 5 in these predicates.
DO $$
DECLARE d text; v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['cm_gov_cap_by_term_m','cm_gov_cap_by_term_q'] LOOP
    d := pg_get_viewdef(('public.'||v)::regclass, true);
    d := replace(d, 'c.firm_rem > 5::numeric AND c.firm_rem <= 10::numeric',
                    'c.firm_rem > 6::numeric AND c.firm_rem <= 10::numeric');
    d := replace(d, 'c.firm_rem IS NOT NULL AND c.firm_rem <= 5::numeric',
                    'c.firm_rem IS NOT NULL AND c.firm_rem <= 6::numeric');
    EXECUTE 'CREATE OR REPLACE VIEW public.'||v||' AS '||d;
  END LOOP;

  d := pg_get_viewdef('public.cm_gov_sold_cap_by_term_dot'::regclass, true);
  d := replace(d, 'c.firm_rem >= 5::numeric AND c.firm_rem < 10::numeric',
                  'c.firm_rem >= 6::numeric AND c.firm_rem < 10::numeric');
  d := replace(d, 'c.firm_rem > 0::numeric AND c.firm_rem < 5::numeric',
                  'c.firm_rem > 0::numeric AND c.firm_rem < 6::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_sold_cap_by_term_dot AS '||d;
END $$;
