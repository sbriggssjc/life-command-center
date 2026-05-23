-- Topic 16 (audit §11.33): operator-affiliate registry.
--
-- The dialysis vertical has a small number of operators (Davita,
-- Fresenius, US Renal Care, American Renal Associates) that own
-- properties through a fleet of subsidiary names ("Bio-Medical
-- Applications of MA", "Total Renal Care Inc", "USRC Covington LLC",
-- "FMC Tudor", etc.). The §11.31 fuzzy-name merge can't catch these
-- because the subsidiary names share no normalized stem with the
-- parent.
--
-- Implication for the BD doctrine: when an affiliate sells a property
-- — even to a third party — it's effectively an operator-led
-- transaction. A sale-leaseback by "Bio-Medical Applications of MA"
-- is a Fresenius deal regardless of whether the buyer is a REIT, a
-- developer, or another LLC. The priority queue's "developer" /
-- "operator" classification has to account for this.
--
-- This topic ships the lookup infrastructure. Two pieces:
--   1. `lcc_operator_affiliate_patterns` table — rules like
--      (parent_entity='Davita', pattern='total renal care%', type='prefix').
--   2. `v_lcc_operator_affiliates` view — applies the patterns and
--      surfaces every matching entity in the entities table.
--
-- Seeded with the four major dialysis operators' known subsidiary
-- naming conventions. Government doesn't have an operator concept in
-- the same sense (the "operator" is always a federal agency, not a
-- corporate parent), so patterns are dia-focused for now.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_operator_affiliate_patterns (
  pattern_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_entity_id  uuid NOT NULL REFERENCES public.entities(id),
  pattern_name      text NOT NULL,
  pattern_type      text NOT NULL DEFAULT 'prefix'
    CHECK (pattern_type IN ('prefix','contains','regex','exact')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_entity_id, pattern_name, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_lcc_operator_affiliate_patterns_parent
  ON public.lcc_operator_affiliate_patterns(parent_entity_id);

COMMENT ON TABLE public.lcc_operator_affiliate_patterns IS
  'Rules that map subsidiary entity names to their operator parent. '
  'Used by v_lcc_operator_affiliates to identify which entities are '
  'effectively controlled by a known operator even when the names '
  'share no normalized stem (e.g., "Bio-Medical Applications of MA" '
  '→ Fresenius Medical Care). Each pattern is one match condition; '
  'an operator can have many.';

-- ---------------------------------------------------------------------------
-- Seed the four major dialysis operators
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_davita    uuid;
  v_fresenius uuid;
  v_usrc      uuid;
  v_ara       uuid;
BEGIN
  -- Find each operator's canonical entity_id (post-merge winners)
  SELECT id INTO v_davita FROM public.entities
   WHERE entity_type='organization' AND merged_into_entity_id IS NULL
     AND LOWER(name) = 'davita' LIMIT 1;
  SELECT id INTO v_fresenius FROM public.entities
   WHERE entity_type='organization' AND merged_into_entity_id IS NULL
     AND LOWER(name) = 'fresenius medical care' LIMIT 1;
  SELECT id INTO v_usrc FROM public.entities
   WHERE entity_type='organization' AND merged_into_entity_id IS NULL
     AND LOWER(name) IN ('us renal care','us renal care, inc.') LIMIT 1;
  SELECT id INTO v_ara FROM public.entities
   WHERE entity_type='organization' AND merged_into_entity_id IS NULL
     AND LOWER(name) = 'american renal associates' LIMIT 1;

  -- DaVita affiliates
  IF v_davita IS NOT NULL THEN
    INSERT INTO public.lcc_operator_affiliate_patterns
      (parent_entity_id, pattern_name, pattern_type, notes) VALUES
      (v_davita, 'davita%', 'prefix', 'All Davita-prefixed entities (kidney care, healthcare partners, etc.)'),
      (v_davita, 'da vita%', 'prefix', 'Spacing variants'),
      (v_davita, 'total renal care%', 'prefix', 'DaVita legal name for many subsidiaries'),
      (v_davita, 'renal treatment center%', 'prefix', 'DaVita-acquired subsidiary brand'),
      (v_davita, 'dci %', 'prefix', 'Dialysis Clinic Inc — historically DaVita-affiliated'),
      (v_davita, 'davita%', 'contains', 'Catch entities with Davita in the middle of the name')
    ON CONFLICT (parent_entity_id, pattern_name, pattern_type) DO NOTHING;
  END IF;

  -- Fresenius affiliates
  IF v_fresenius IS NOT NULL THEN
    INSERT INTO public.lcc_operator_affiliate_patterns
      (parent_entity_id, pattern_name, pattern_type, notes) VALUES
      (v_fresenius, 'fresenius%', 'prefix', 'All Fresenius-prefixed entities'),
      (v_fresenius, 'bio-medical applications%', 'prefix', 'Fresenius primary state-subsidiary brand'),
      (v_fresenius, 'bma of %', 'prefix', 'Common abbreviation of Bio-Medical Applications'),
      (v_fresenius, 'spectra renal%', 'prefix', 'Fresenius subsidiary'),
      (v_fresenius, 'fmc %', 'prefix', 'FMC = Fresenius Medical Care (real estate subsidiaries)'),
      (v_fresenius, 'fkc %', 'prefix', 'FKC = Fresenius Kidney Care'),
      (v_fresenius, 'fresenius', 'contains', 'Catch-all for Fresenius in entity name')
    ON CONFLICT (parent_entity_id, pattern_name, pattern_type) DO NOTHING;
  END IF;

  -- US Renal Care affiliates
  IF v_usrc IS NOT NULL THEN
    INSERT INTO public.lcc_operator_affiliate_patterns
      (parent_entity_id, pattern_name, pattern_type, notes) VALUES
      (v_usrc, 'usrc %', 'prefix', 'USRC = US Renal Care; state/city LLCs'),
      (v_usrc, 'us renal%', 'prefix', 'Direct variants of US Renal Care'),
      (v_usrc, 'usrc', 'exact', 'Bare USRC name')
    ON CONFLICT (parent_entity_id, pattern_name, pattern_type) DO NOTHING;
  END IF;

  -- American Renal Associates affiliates
  IF v_ara IS NOT NULL THEN
    INSERT INTO public.lcc_operator_affiliate_patterns
      (parent_entity_id, pattern_name, pattern_type, notes) VALUES
      (v_ara, 'american renal%', 'prefix', 'American Renal Associates variants'),
      (v_ara, 'ara %', 'prefix', 'ARA abbreviation for state/city subsidiaries')
    ON CONFLICT (parent_entity_id, pattern_name, pattern_type) DO NOTHING;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- v_lcc_operator_affiliates — applies patterns to entities
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_operator_affiliates
WITH (security_invoker = true) AS
SELECT
  e.id           AS affiliate_entity_id,
  e.name         AS affiliate_name,
  e.canonical_name AS affiliate_canonical_name,
  e.owner_role   AS affiliate_owner_role,
  e.domain       AS affiliate_domain,
  (SELECT COUNT(*) FROM public.lcc_entity_portfolio_facts f
   WHERE f.entity_id = e.id) AS affiliate_portfolio_size,
  p.parent_entity_id,
  parent.name    AS parent_name,
  parent.owner_role AS parent_owner_role,
  p.pattern_id,
  p.pattern_name,
  p.pattern_type
FROM public.entities e
JOIN public.lcc_operator_affiliate_patterns p
  ON CASE p.pattern_type
       WHEN 'exact'    THEN LOWER(e.name) = LOWER(p.pattern_name)
       WHEN 'prefix'   THEN LOWER(e.name) LIKE LOWER(p.pattern_name)
       WHEN 'contains' THEN LOWER(e.name) LIKE '%' || LOWER(p.pattern_name) || '%'
       WHEN 'regex'    THEN e.name ~* p.pattern_name
     END
JOIN public.entities parent
  ON parent.id = p.parent_entity_id
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
  AND e.id <> p.parent_entity_id;

GRANT SELECT ON public.v_lcc_operator_affiliates TO authenticated;

COMMENT ON VIEW public.v_lcc_operator_affiliates IS
  'Surfaces every entity whose name matches an operator-affiliate '
  'pattern. One row per (affiliate, pattern) match — an affiliate '
  'with both a prefix and a contains rule on the same parent will '
  'appear twice; downstream consumers should DISTINCT ON '
  '(affiliate_entity_id, parent_entity_id) when they want unique '
  'pairs. Excludes the parent itself.';

COMMIT;
