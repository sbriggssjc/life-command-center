-- CONNECTIVITY #1b broad-drain gate (gov): final eligibility view — excludes the
-- attribution / amount / date artifact classes (mirror of dia + the SQL guard
-- public.lcc_owner_name_is_junk). NARROW — CMBS-shelf-code/year-series NOT used
-- (real CMBS-REO SPE owners like "JPMBB 2014-C18 THORN RUN ROAD, LLC" bridge
-- normally). Supersedes 20260617130000. Owner-scoped. Idempotent.
CREATE OR REPLACE VIEW public.v_bridge_eligible_owners AS
SELECT
  t.true_owner_id, t.name, t.owner_role, t.owner_role_source, t.owner_role_confidence,
  EXISTS (SELECT 1 FROM public.properties p WHERE p.true_owner_id=t.true_owner_id AND p.status IS DISTINCT FROM 'archived') AS is_current_owner
FROM public.true_owners t
WHERE t.merged_into_true_owner_id IS NULL
  AND t.name IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.properties p WHERE p.true_owner_id=t.true_owner_id)
  AND t.name !~* '^\s*\d{5,}\s*(ira|llc|l\.l\.c|lp|llp|inc|corp|trust)?\s*$'
  AND t.name !~* '^\s*\d{4,}\s+ira\s*$'
  AND t.name !~* ':\s*(yes|no)\s*$'
  AND t.name !~* '^\s*(1031\s+)?exchange\s+buyer\s*$'
  AND t.name !~* '^\s*(buyer|seller|escrow)\s*$'
  AND t.name !~* '^\s*(unknown(\s+owner)?|n/?a|n\.a\.?|none|tbd|not\s+available|undisclosed|various)\s*$'
  AND t.name !~ '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'
  AND t.name !~ '\m\d{3}[-.]\d{3}[-.]\d{4}\M'
  AND t.name !~* '(buyer|seller)\s*contacts?'
  AND t.name !~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  AND t.name !~* '\(\s*[pcmf]\s*\)'
  AND t.name !~* '\([^)]*(\$|approx)[^)]*\)'
  AND t.name !~* '\$[0-9]'
  AND t.name !~* '\mapprox\M'
  AND t.name !~* '\mOBO\M'
  AND t.name !~* '\mby\s+\w'
  AND t.name !~* '^\s*since\s+\w'
  AND t.name !~* '\m(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\M';

GRANT SELECT ON public.v_bridge_eligible_owners TO anon, authenticated;
