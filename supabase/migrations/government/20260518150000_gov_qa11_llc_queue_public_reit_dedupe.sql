-- ============================================================================
-- QA-11 (2026-05-18, gov): mirror of the dia migration. Same schema additions,
-- helper functions, backfills, and trigger so the gov llc_research_queue
-- stops surfacing public REITs and same-entity duplicates.
--
-- Backfill effect on gov (queued before → after):
--   queued: 254 → 249  (-5 dead-end rows)
--   skipped_public_reit: +5
--   skipped_dupe:        0  (no duplicates on gov today)
--
-- See supabase/migrations/dialysis/20260518150000_dia_qa11_llc_queue_public_reit_dedupe.sql
-- for the full discovery writeup, root cause, and verification notes.
--
-- Already applied live to gov (scknotsqkcheojiaewwh) on 2026-05-18 via
-- Supabase MCP. This file commits the migration as the historical record.
-- ============================================================================

ALTER TABLE public.llc_research_queue
  DROP CONSTRAINT IF EXISTS llc_research_queue_status_check;
ALTER TABLE public.llc_research_queue
  ADD CONSTRAINT llc_research_queue_status_check
  CHECK (status = ANY (ARRAY[
    'queued', 'in_progress', 'done', 'failed',
    'unsupported_state', 'no_match',
    'skipped_public_reit', 'skipped_dupe'
  ]));

CREATE OR REPLACE FUNCTION public.llc_normalize_name(name text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH stripped AS (
    SELECT regexp_replace(
      regexp_replace(
        lower(coalesce(name, '')),
        '\m(jv|joint\s+venture|the|llc|inc|corp|corporation|llp|l\.?p\.?|ltd|limited|trust|partners?|properties|holdings?|enterprises?|company|co|associates|management|realty|real\s+estate|reit)\M\.?',
        ' ',
        'gi'
      ),
      '[^a-z0-9\s]+',
      ' ',
      'g'
    ) AS s
  )
  SELECT NULLIF(regexp_replace(trim(s), '\s+', ' ', 'g'), '')
  FROM stripped;
$$;

CREATE OR REPLACE FUNCTION public.llc_is_public_reit(name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    SELECT 1 FROM (VALUES
      ('realty income'), ('brandywine realty trust'), ('welltower'),
      ('ventas'), ('healthpeak'), ('simon property'), ('vornado'),
      ('boston properties'), ('prologis'), ('public storage'),
      ('kilroy realty'), ('mack-cali'), ('highwoods properties'),
      ('cousins properties'), ('piedmont office'), ('hudson pacific'),
      ('paramount group'), ('empire state realty'), ('sl green realty'),
      ('equinix'), ('digital realty'), ('iron mountain'),
      ('office properties income'), ('diversified healthcare'),
      ('senior housing properties trust'), ('medical properties trust'),
      ('sabra health care'), ('omega healthcare'), ('ltc properties'),
      ('national health investors'), ('caretrust reit'),
      ('global medical reit'), ('physicians realty'),
      ('universal health realty'), ('community healthcare trust'),
      ('davita inc'), ('fresenius medical care')
    ) AS t(public_name)
    WHERE lower(coalesce(name, '')) LIKE '%' || t.public_name || '%'
  );
$$;

ALTER TABLE public.llc_research_queue
  ADD COLUMN IF NOT EXISTS is_public_reit BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='llc_research_queue' AND column_name='normalized_name'
  ) THEN
    EXECUTE 'ALTER TABLE public.llc_research_queue ADD COLUMN normalized_name TEXT GENERATED ALWAYS AS (public.llc_normalize_name(search_name)) STORED';
  END IF;
END $$;

UPDATE public.llc_research_queue
SET status = 'skipped_public_reit', is_public_reit = TRUE
WHERE status = 'queued' AND public.llc_is_public_reit(search_name);

WITH ranked AS (
  SELECT queue_id,
         row_number() OVER (PARTITION BY normalized_name ORDER BY created_at, queue_id) AS rn
  FROM public.llc_research_queue
  WHERE status = 'queued' AND normalized_name IS NOT NULL
)
UPDATE public.llc_research_queue q
SET status = 'skipped_dupe'
FROM ranked r
WHERE q.queue_id = r.queue_id AND r.rn > 1;

CREATE INDEX IF NOT EXISTS llc_research_queue_normalized_idx
  ON public.llc_research_queue(normalized_name)
  WHERE normalized_name IS NOT NULL;

CREATE OR REPLACE FUNCTION public.llc_research_queue_auto_skip()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_norm TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'queued' THEN
    RETURN NEW;
  END IF;
  v_norm := public.llc_normalize_name(NEW.search_name);
  IF public.llc_is_public_reit(NEW.search_name) THEN
    NEW.status := 'skipped_public_reit';
    NEW.is_public_reit := TRUE;
    RETURN NEW;
  END IF;
  IF v_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.llc_research_queue
    WHERE normalized_name = v_norm
      AND status = 'queued'
      AND queue_id IS DISTINCT FROM NEW.queue_id
  ) THEN
    NEW.status := 'skipped_dupe';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS llc_research_queue_auto_skip_trg ON public.llc_research_queue;
CREATE TRIGGER llc_research_queue_auto_skip_trg
  BEFORE INSERT OR UPDATE OF search_name, status ON public.llc_research_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.llc_research_queue_auto_skip();
