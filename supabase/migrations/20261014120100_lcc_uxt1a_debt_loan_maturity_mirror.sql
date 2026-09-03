-- UX-T1a-debt (LCC half) — mirror the domains' loan maturities.
-- APPLIED LIVE to xengecqvemvfknjvbvrq 2026-09-03.
--
-- NO THIRD LOAN STORE. The domains own the loans; this mirrors a non-PII slice of their
-- `v_loan_maturity_portfolio` views onto the EXISTING W2.3 keyset-tick pattern, so the
-- leg gets the freshness/health surface and the watermark bookkeeping for free rather
-- than growing a second mirror mechanism beside the first.
--
-- ⚠️ THE PART A AUDIT'S PREMISE IS PARTLY REFUTED, AND IT MATTERS FOR WHAT THIS IS FOR.
-- The audit reported `loan_maturity` had "no producer". That is true of
-- `v_lcc_bd_worklist` and FALSE of the handler: `api/operations.js::assembleBdWorklist`
-- has always fanned out to the domains' `v_loan_maturity_watch` views (gov 178 rows /
-- dia 72, both live). So the Today tile was NOT blind to debt.
-- What was genuinely missing -- and what this mirror delivers -- is that the domain
-- fan-out emits `entity_id: null`: it cannot resolve an LCC owner, so the debt signal
-- could not be joined to an owner, a cadence, a role or a reach state, and therefore
-- could not feed an owner-keyed seller queue. That is UX-T1a-queue's blocker, and it is
-- what a SQL-resident mirror fixes; a cross-DB view cannot.
--
-- Result: 568 rows mirrored (gov 413 / dia 155), reproducing both sources exactly.

CREATE TABLE IF NOT EXISTS public.lcc_loan_maturity (
  source_domain     text        NOT NULL,
  loan_ref          text        NOT NULL,
  source_property_id text       NOT NULL,
  maturity_date     date,
  original_amount   numeric,
  current_balance   numeric,
  lender_name       text,
  loan_type         text,
  is_cmbs           boolean,
  loan_status       text,
  data_source       text,
  source_updated_at timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lcc_loan_maturity_pkey PRIMARY KEY (source_domain, loan_ref),
  CONSTRAINT chk_lcc_loan_maturity_domain CHECK (source_domain IN ('dia','gov'))
);

CREATE INDEX IF NOT EXISTS idx_lcc_loan_maturity_property
  ON public.lcc_loan_maturity (source_domain, source_property_id);
CREATE INDEX IF NOT EXISTS idx_lcc_loan_maturity_maturity
  ON public.lcc_loan_maturity (maturity_date) WHERE maturity_date IS NOT NULL;

COMMENT ON TABLE public.lcc_loan_maturity IS
  'UX-T1a-debt: mirror of gov/dia v_loan_maturity_portfolio. NOT a loan system of record '
  '-- the domains own loans; this carries only what the BD worklist needs. Non-PII by '
  'construction (no lender contact columns). loan_status is always NULL for dia (that '
  'domain records is_active, not gov''s active/defaulted).';

CREATE OR REPLACE FUNCTION public.lcc_apply_loan_maturity_page(p_domain text, p_content jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_applied int := 0;
BEGIN
  WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
  up AS (
    INSERT INTO public.lcc_loan_maturity (
      source_domain, loan_ref, source_property_id, maturity_date, original_amount,
      current_balance, lender_name, loan_type, is_cmbs, loan_status, data_source,
      source_updated_at, updated_at)
    SELECT p_domain, row->>'loan_ref', (row->>'property_id')::text,
      NULLIF(row->>'maturity_date','')::date,
      NULLIF(row->>'original_amount','')::numeric,
      NULLIF(row->>'current_balance','')::numeric,
      row->>'lender_name', row->>'loan_type',
      NULLIF(row->>'is_cmbs','')::boolean, row->>'loan_status', row->>'data_source',
      NULLIF(row->>'updated_at','')::timestamptz, now()
    FROM rows
    WHERE row->>'loan_ref' IS NOT NULL AND row->>'property_id' IS NOT NULL
    ON CONFLICT (source_domain, loan_ref) DO UPDATE SET
      source_property_id = COALESCE(EXCLUDED.source_property_id, public.lcc_loan_maturity.source_property_id),
      -- maturity_date and current_balance are the two facts that legitimately MOVE (a
      -- loan is extended, a balance amortises), so the fresher page wins on those rather
      -- than being held by fill-blanks. The source_updated_at gate below is what makes
      -- "fresher" true rather than "last writer".
      maturity_date      = COALESCE(EXCLUDED.maturity_date, public.lcc_loan_maturity.maturity_date),
      current_balance    = COALESCE(EXCLUDED.current_balance, public.lcc_loan_maturity.current_balance),
      original_amount    = COALESCE(EXCLUDED.original_amount, public.lcc_loan_maturity.original_amount),
      lender_name        = COALESCE(EXCLUDED.lender_name, public.lcc_loan_maturity.lender_name),
      loan_type          = COALESCE(EXCLUDED.loan_type, public.lcc_loan_maturity.loan_type),
      is_cmbs            = COALESCE(EXCLUDED.is_cmbs, public.lcc_loan_maturity.is_cmbs),
      loan_status        = COALESCE(EXCLUDED.loan_status, public.lcc_loan_maturity.loan_status),
      data_source        = COALESCE(EXCLUDED.data_source, public.lcc_loan_maturity.data_source),
      source_updated_at  = EXCLUDED.source_updated_at,
      updated_at         = now()
    WHERE public.lcc_loan_maturity.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at >= public.lcc_loan_maturity.source_updated_at
    RETURNING 1)
  SELECT count(*) INTO v_applied FROM up;
  RETURN v_applied;
END $function$;

INSERT INTO public.lcc_mirror_sync_watermark (leg, source_domain, watermark_updated_at)
VALUES ('loan_maturity','gov','1970-01-01'::timestamptz),
       ('loan_maturity','dia','1970-01-01'::timestamptz)
ON CONFLICT (leg, source_domain) DO NOTHING;

-- ── Teach lcc_mirror_tick the new leg (3 of the 5 required edits) ────────────────
-- ⚠️ SEE THE COMPANION MIGRATION 20261014120200: teaching the tick a new leg needs FIVE
-- edits, not three. This one makes the keyset key column, the apply dispatch and the
-- source path/select; the DEFAULT leg array and a hard-coded allowlist `CONTINUE` are in
-- the next file, and WITHOUT THEM THE LEG IS SILENTLY SKIPPED.
DO $outer$
DECLARE
  v_def text;
  v_hit int;
  k_old text := 'v_keycol := CASE WHEN v_leg=''listing_events'' THEN ''sale_id'' ELSE ''property_id'' END;';
  k_new text := 'v_keycol := CASE WHEN v_leg=''listing_events'' THEN ''sale_id'' WHEN v_leg=''loan_maturity'' THEN ''loan_ref'' ELSE ''property_id'' END;';
  a_old text := 'WHEN ''property_owner_facts'' THEN public.lcc_apply_property_owner_facts_page(v_domain, v_arr)';
  a_new text := 'WHEN ''property_owner_facts'' THEN public.lcc_apply_property_owner_facts_page(v_domain, v_arr)
                WHEN ''loan_maturity'' THEN public.lcc_apply_loan_maturity_page(v_domain, v_arr)';
  s_old text := 'ELSIF v_leg = ''property_owner_facts'' THEN
            v_path := ''/rest/v1/v_property_owner_facts_portfolio'';';
  s_new text := 'ELSIF v_leg = ''loan_maturity'' THEN
            v_path := ''/rest/v1/v_loan_maturity_portfolio'';
            v_select := ''loan_ref,property_id,maturity_date,original_amount,current_balance,lender_name,loan_type,is_cmbs,loan_status,data_source,updated_at'';
          ELSIF v_leg = ''property_owner_facts'' THEN
            v_path := ''/rest/v1/v_property_owner_facts_portfolio'';';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='lcc_mirror_tick';
  IF v_def IS NULL THEN RAISE EXCEPTION 'UX-T1a-debt: lcc_mirror_tick not found'; END IF;

  IF position('loan_maturity' IN v_def) > 0 THEN
    RAISE NOTICE 'UX-T1a-debt: lcc_mirror_tick already knows loan_maturity; no change';
    RETURN;
  END IF;

  FOR v_hit IN
    SELECT 1 WHERE position(k_old IN v_def)=0 OR position(a_old IN v_def)=0 OR position(s_old IN v_def)=0
  LOOP
    RAISE EXCEPTION 'UX-T1a-debt: an anchor was not found verbatim in the LIVE '
      'lcc_mirror_tick (keycol=%, dispatch=%, path=%). It has drifted from the repo copy; '
      're-read the live definition and re-target rather than forcing it.',
      position(k_old IN v_def) > 0, position(a_old IN v_def) > 0, position(s_old IN v_def) > 0;
  END LOOP;

  v_def := replace(v_def, k_old, k_new);
  v_def := replace(v_def, a_old, a_new);
  v_def := replace(v_def, s_old, s_new);

  IF position(k_new IN v_def)=0 OR position(a_new IN v_def)=0 OR position(s_new IN v_def)=0 THEN
    RAISE EXCEPTION 'UX-T1a-debt: replacement did not take';
  END IF;
  EXECUTE v_def;
END $outer$;
