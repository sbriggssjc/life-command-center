-- ============================================================================
-- QA-11 (2026-05-18, dia): Filter public REITs + dedupe llc_research_queue.
--
-- Symptom (from 2026-05-18 in-browser QA pass): Brandywine Realty Trust
-- (NYSE: BDN) appeared as NBA rank #9 + #10 on the live dashboard, also as
-- "Brandywine Realty Trust JV MSD Partners". Public REITs are not in
-- Secretary-of-State portals (they file with SEC), so the queue's primary
-- action ("Open SoS →") is a dead end for them. Same-entity rows with
-- different suffix permutations pollute the queue.
--
-- Three structural fixes:
--   1. New status values: 'skipped_public_reit' and 'skipped_dupe'. Status
--      CHECK constraint expanded.
--   2. New columns: is_public_reit BOOLEAN, normalized_name TEXT GENERATED
--      ALWAYS AS (llc_normalize_name(search_name)) STORED.
--   3. BEFORE INSERT/UPDATE trigger applies skip logic to new rows.
--
-- v_next_best_action filters status='queued' already, so skipped rows are
-- naturally excluded from the NBA rail without view changes.
--
-- Backfill effect on dia (queued before → after):
--   queued: 1,267 → 1,215  (-52 dead-end rows)
--   skipped_public_reit:  +10
--   skipped_dupe:         +42
--
-- Already applied live to dia (zqzrriwuavgrquhisnoa) on 2026-05-18 via
-- Supabase MCP. This file commits the migration to the repo as the
-- historical record.
-- ============================================================================

-- ─── 1. Expand status CHECK constraint ─────────────────────────────────────
ALTER TABLE public.llc_research_queue
  DROP CONSTRAINT IF EXISTS llc_research_queue_status_check;
ALTER TABLE public.llc_research_queue
  ADD CONSTRAINT llc_research_queue_status_check
  CHECK (status = ANY (ARRAY[
    'queued', 'in_progress', 'done', 'failed',
    'unsupported_state', 'no_match',
    -- QA-11 (2026-05-18):
    'skipped_public_reit', 'skipped_dupe'
  ]));

-- ─── 2. Normalize-name function ────────────────────────────────────────────
-- Collapses case, strips entity suffixes + punctuation, leaving a stem we
-- can dedupe on. IMMUTABLE so it can back a generated column.
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

COMMENT ON FUNCTION public.llc_normalize_name(text) IS
  'QA-11: collapse case + entity suffixes + punctuation so duplicate LLC search names match. Used by llc_research_queue.normalized_name generated column.';

-- ─── 3. Public-REIT detection ──────────────────────────────────────────────
-- NOT exhaustive — captures the high-frequency offenders observed in NBA
-- rail. Extend by adding rows to the VALUES list.
CREATE OR REPLACE FUNCTION public.llc_is_public_reit(name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    SELECT 1 FROM (VALUES
      ('realty income'),                    -- NYSE: O
      ('brandywine realty trust'),          -- NYSE: BDN
      ('welltower'),                        -- NYSE: WELL
      ('ventas'),                           -- NYSE: VTR
      ('healthpeak'),                       -- NYSE: PEAK
      ('simon property'),                   -- NYSE: SPG
      ('vornado'),                          -- NYSE: VNO
      ('boston properties'),                -- NYSE: BXP
      ('prologis'),                         -- NYSE: PLD
      ('public storage'),                   -- NYSE: PSA
      ('kilroy realty'),                    -- NYSE: KRC
      ('mack-cali'),                        -- NYSE: CLI
      ('highwoods properties'),             -- NYSE: HIW
      ('cousins properties'),               -- NYSE: CUZ
      ('piedmont office'),                  -- NYSE: PDM
      ('hudson pacific'),                   -- NYSE: HPP
      ('paramount group'),                  -- NYSE: PGRE
      ('empire state realty'),              -- NYSE: ESRT
      ('sl green realty'),                  -- NYSE: SLG
      ('equinix'),                          -- NASDAQ: EQIX
      ('digital realty'),                   -- NYSE: DLR
      ('iron mountain'),                    -- NYSE: IRM
      ('office properties income'),         -- NASDAQ: OPI
      ('diversified healthcare'),           -- NASDAQ: DHC
      ('senior housing properties trust'),  -- predecessor of DHC
      ('medical properties trust'),         -- NYSE: MPW
      ('sabra health care'),                -- NASDAQ: SBRA
      ('omega healthcare'),                 -- NYSE: OHI
      ('ltc properties'),                   -- NYSE: LTC
      ('national health investors'),        -- NYSE: NHI
      ('caretrust reit'),                   -- NASDAQ: CTRE
      ('global medical reit'),              -- NYSE: GMRE
      ('physicians realty'),                -- NYSE: DOC
      ('universal health realty'),          -- NYSE: UHT
      ('community healthcare trust'),       -- NYSE: CHCT
      ('davita inc'),                       -- NYSE: DVA (dialysis operator)
      ('fresenius medical care')            -- NYSE: FMS (dialysis operator)
    ) AS t(public_name)
    WHERE lower(coalesce(name, '')) LIKE '%' || t.public_name || '%'
  );
$$;

COMMENT ON FUNCTION public.llc_is_public_reit(text) IS
  'QA-11: returns true when the name matches a known publicly-traded REIT or major dialysis operator. Those file with the SEC, not Secretary of State portals, so the queue''s SoS lookup is a dead end. NOT exhaustive — captures the high-frequency offenders observed in NBA rail.';

-- ─── 4. Schema additions ──────────────────────────────────────────────────
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

-- ─── 5. Backfill: mark publics ────────────────────────────────────────────
UPDATE public.llc_research_queue
SET status = 'skipped_public_reit', is_public_reit = TRUE
WHERE status = 'queued' AND public.llc_is_public_reit(search_name);

-- ─── 6. Backfill: dedupe by normalized_name (keep oldest) ──────────────────
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

-- ─── 7. Index for the dedupe pattern ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS llc_research_queue_normalized_idx
  ON public.llc_research_queue(normalized_name)
  WHERE normalized_name IS NOT NULL;

-- ─── 8. Trigger: auto-skip future inserts ──────────────────────────────────
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
