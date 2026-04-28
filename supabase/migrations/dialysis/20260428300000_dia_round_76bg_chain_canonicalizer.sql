-- ============================================================================
-- Round 76bg (dia) — Operator/chain canonicalizer
--
-- Same problem as gov agencies for dia tenants:
--   "Fresenius" / "Fresenius Medical Care" / "FMC" / "FMCNA" / "FKC" — Fresenius
--   "DaVita" / "DaVita Inc" / "Total Renal Care" — DaVita
--   "DCI" / "Dialysis Clinic Inc" — DCI
--   "USRC" / "US Renal Care" — USRC
--
-- Coverage from initial backfill:
--   DaVita: 2,899   Fresenius: 2,422 (incl FMC/FMCNA/FKC)
--   USRC: 281       DCI: 211
--   Satellite: 77   Liberty: 51   ARA: 49
--   Total: 5,996 / 11,015 properties (54%)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_dia_chain(p_input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s AS (SELECT lower(trim(coalesce(p_input, ''))) AS x)
  SELECT CASE
    WHEN x ~ '\mfresenius|\mfmc\M|\mfmcna\M|\mfkc\M|\mfresenius kidney|fresenius medical' THEN 'Fresenius'
    WHEN x ~ '\mdavita|\mtotal renal care|\mtrc\M' THEN 'DaVita'
    WHEN x ~ '\mdci\M|dialysis clinic[, ]+inc|^dci ' THEN 'DCI'
    WHEN x ~ '\musrc\M|us renal care|^usrc ' THEN 'USRC'
    WHEN x ~ '\mara\M|american renal' THEN 'ARA'
    WHEN x ~ '\msatellite\M' THEN 'Satellite'
    WHEN x ~ '\matlantic dialysis' THEN 'Atlantic Dialysis'
    WHEN x ~ '\minnovative renal care|\mirc\M' THEN 'IRC'
    WHEN x ~ '\mrenal advantage|\mradv\M' THEN 'RenalAdv'
    WHEN x ~ '\mhdc\M|home dialyzors' THEN 'HDC'
    WHEN x ~ '\mrenal ventures' THEN 'RenalVentures'
    WHEN x ~ '\mliberty dialysis' THEN 'Liberty'
    WHEN x ~ '\bnephrocare|nephrology center' THEN 'Nephrocare'
    WHEN x ~ '\mnorthstar' THEN 'NorthStar'
    WHEN x ~ '\mpdi\M|pdi healthcare' THEN 'PDI'
    WHEN x ~ '\bdialysis center\b|\bdialysis unit\b' AND x !~ 'davita|fresenius|fmc|usrc|dci|ara'
      THEN 'Independent'
    ELSE NULL
  END FROM s;
$$;

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS chain_canonical text;

UPDATE public.properties
   SET chain_canonical = canonicalize_dia_chain(tenant)
 WHERE tenant IS NOT NULL AND chain_canonical IS NULL;
