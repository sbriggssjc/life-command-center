-- ============================================================================
-- Rent Intelligence Engine — Phase 2 SPINE (dia)
-- DB: Dialysis_DB zqzrriwuavgrquhisnoa
--
-- Creates the versioned, provenance-tracked rent timeline + the data-driven
-- convention & confidence tables + the reconciliation queue. Idempotent /
-- additive. No hardcoded projection defaults live in code after Phase 2 —
-- tenant_lease_conventions is the single source of the escalation shape and
-- rent_confidence_ladder is the single source of per-basis confidence.
--
-- Decisions (Phase 2 GO):
--  1. Universe = all properties; rows materialize ONLY where a basis exists.
--  2. Conventions: DaVita 15/3x5/10%-per-5, USRC 10/2x5/2.5%-annual (approved);
--     FMC empirical modal (n=324 -> 1.7%/1yr) flagged low-confidence; ARA/DCI
--     fall back to standard-terms structures (n<20). effective_from vintages.
--  3. Convention shells materialize only with a derivable rent intercept.
--  4. Sanity bounds: rent PSF in [5,200]; bad_data -> rent_reconcile_queue.
-- ============================================================================

-- ── 1. property_rent_timeline (versioned, range-backed, annual grain) ────────
CREATE TABLE IF NOT EXISTS public.property_rent_timeline (
  timeline_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   integer NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  year          integer NOT NULL,
  period        daterange NOT NULL,
  rent_annual   numeric,
  rent_psf      numeric,
  rba_sf        numeric,
  lease_phase   text,                          -- initial | option_1..n | month_to_month | vacant
  basis         text NOT NULL
                  CHECK (basis IN ('contract','stated','projected','convention')),
  confidence    numeric NOT NULL DEFAULT 0.4,
  provenance    jsonb   NOT NULL DEFAULT '{}'::jsonb,
  assumptions   jsonb   NOT NULL DEFAULT '{}'::jsonb,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  build_batch   text,
  CONSTRAINT uq_prt_prop_year_version UNIQUE (property_id, year, version)
);
CREATE INDEX IF NOT EXISTS ix_prt_prop_current
  ON public.property_rent_timeline (property_id, year) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_prt_basis ON public.property_rent_timeline (basis);
CREATE INDEX IF NOT EXISTS ix_prt_year  ON public.property_rent_timeline (year);
COMMENT ON TABLE public.property_rent_timeline IS
  'Rent Intelligence Engine: versioned rent-by-year timeline. Evidence never loses to model; projection fills gaps only. superseded_at NULL = current version.';

-- ── 2. tenant_lease_conventions (the escalation shape, as DATA) ──────────────
CREATE TABLE IF NOT EXISTS public.tenant_lease_conventions (
  convention_id       serial PRIMARY KEY,
  tenant_canonical    text NOT NULL,            -- matches dia_normalize_operator() output
  effective_from      date NOT NULL DEFAULT '1990-01-01',
  initial_term_years  numeric,
  option_count        integer,
  option_term_years   numeric,
  bump_pct            numeric NOT NULL,         -- decimal (0.10 = 10%)
  bump_interval_years numeric NOT NULL,
  expense_structure   text DEFAULT 'NNN',
  base_confidence     numeric NOT NULL DEFAULT 0.4,
  source              text NOT NULL,            -- 'approved_standard'|'empirical_modal'|'fallback_standard'|'generic_fallback'
  n_sample            integer,
  flagged_low_conf    boolean NOT NULL DEFAULT false,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  CONSTRAINT uq_tlc_tenant_vintage UNIQUE (tenant_canonical, effective_from)
);
COMMENT ON TABLE public.tenant_lease_conventions IS
  'Rent Intelligence Engine: per-tenant escalation conventions (bump %/interval, term shape) keyed on dia_normalize_operator(tenant) + effective_from vintage. Single source of the projection shape; NO hardcoded default lives in code.';

-- ── 3. rent_confidence_ladder (per-basis/source confidence, as DATA) ────────
CREATE TABLE IF NOT EXISTS public.rent_confidence_ladder (
  ladder_id     serial PRIMARY KEY,
  basis         text NOT NULL,
  source_key    text NOT NULL,     -- evidence source classifier
  confidence    numeric NOT NULL,
  decay_per_option numeric NOT NULL DEFAULT 0.0,  -- confidence lost per option period beyond initial term
  notes         text,
  CONSTRAINT uq_rcl UNIQUE (basis, source_key)
);
COMMENT ON TABLE public.rent_confidence_ladder IS
  'Rent Intelligence Engine confidence hierarchy as data: executed lease 1.0 > OM schedule 0.9 > rent_at_sale confirmed 0.85 > listing/brochure 0.7 > convention 0.4 (decaying) > convention shell 0.35.';

-- ── 4. rent_reconcile_queue (log-don't-drop; conflicts + bad_data) ──────────
CREATE TABLE IF NOT EXISTS public.rent_reconcile_queue (
  queue_id      bigserial PRIMARY KEY,
  property_id   integer NOT NULL,
  year          integer,
  issue_kind    text NOT NULL,     -- unit_error | bad_data | conflict_unclassified | rba_change | extension | renegotiation
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz DEFAULT now(),
  build_batch   text
);
CREATE INDEX IF NOT EXISTS ix_rrq_open ON public.rent_reconcile_queue (status) WHERE status='open';
CREATE INDEX IF NOT EXISTS ix_rrq_prop ON public.rent_reconcile_queue (property_id);
COMMENT ON TABLE public.rent_reconcile_queue IS
  'Rent Intelligence Engine: unit-scale/bad-data/unclassified-conflict review lane. Finding #1: unit-scale errors ARE the conflict population; each is fixable data, so log-don''t-drop.';

-- ── 5. v_property_rent_current (latest unsuperseded version per prop-year) ───
CREATE OR REPLACE VIEW public.v_property_rent_current AS
SELECT DISTINCT ON (property_id, year)
  property_id, year, version, period, rent_annual, rent_psf, rba_sf,
  lease_phase, basis, confidence, provenance, assumptions, valid_from, build_batch
FROM public.property_rent_timeline
WHERE superseded_at IS NULL
ORDER BY property_id, year, version DESC;
COMMENT ON VIEW public.v_property_rent_current IS
  'Current rent timeline: highest unsuperseded version per (property_id, year).';

-- ── 6. SEED rent_confidence_ladder ──────────────────────────────────────────
INSERT INTO public.rent_confidence_ladder (basis, source_key, confidence, decay_per_option, notes) VALUES
  ('contract','executed_lease_documented', 1.00, 0.00, 'signed lease/abstract, source_confidence=documented'),
  ('contract','executed_lease_escalation', 1.00, 0.00, 'lease_escalations step, documented'),
  ('contract','om_rent_schedule',          0.90, 0.00, 'OM-provided rent schedule'),
  ('stated',  'rent_at_sale_confirmed',    0.85, 0.00, 'sales_transactions.rent_at_sale, non-projected source'),
  ('stated',  'master_curated',            0.85, 0.00, 'curated master workbook rent'),
  ('stated',  'listing_brochure',          0.70, 0.00, 'listing/brochure/derived_from_cap_rate'),
  ('projected','projected_from_evidence',  0.70, 0.05, 'documented structure, computed year; decays per option period'),
  ('convention','tenant_standard_anchored',0.40, 0.05, 'tenant-standard model on a real rent anchor; decays beyond initial term'),
  ('convention','cohort_median_shell',     0.35, 0.05, 'convention shape on a cohort-median PSF intercept')
ON CONFLICT (basis, source_key) DO UPDATE
  SET confidence=EXCLUDED.confidence, decay_per_option=EXCLUDED.decay_per_option, notes=EXCLUDED.notes;

-- ── 7. SEED tenant_lease_conventions ────────────────────────────────────────
-- Approved standards, empirical FMC, fallback ARA/DCI, and the generic fallback
-- that reproduces the retired hardcoded 2%/12mo default for unmatched tenants.
INSERT INTO public.tenant_lease_conventions
  (tenant_canonical, effective_from, initial_term_years, option_count, option_term_years,
   bump_pct, bump_interval_years, expense_structure, base_confidence, source, n_sample, flagged_low_conf, notes) VALUES
  -- DaVita: approved standard (empirical annualized 2%/yr, n=339, confirms 10%/5yr ~= 1.92%/yr)
  ('davita',   '1990-01-01', 15, 3, 5, 0.10, 5, 'NNN', 0.40, 'approved_standard', 339, false,
    'DaVita BTS standard 15yr/3x5/10%-per-5. Empirical annualized modal 2%/1yr (n=339) confirms.'),
  -- USRC: approved standard
  ('usrc',     '1990-01-01', 10, 2, 5, 0.025, 1, 'NNN', 0.40, 'approved_standard', 49, false,
    'USRC standard 10yr/2x5/2.5%-annual. Empirical modal 2%/1yr (n=49) close.'),
  -- Fresenius: empirical modal (n=324), flagged low-confidence until empirical fit reviewed
  ('fresenius','1990-01-01', 15, 2, 5, 0.017, 1, 'NNN', 0.40, 'empirical_modal', 324, true,
    'FMC empirical annualized modal 1.7%/1yr (n=324). Term shape from standard 15yr/2x5. Flagged low-confidence.'),
  -- American Renal (ARA): n=4 < 20 -> fallback standard
  ('american', '1990-01-01', 15, 2, 5, 0.02, 1, 'NNN', 0.40, 'fallback_standard', 4, true,
    'ARA n=4 < 20: fallback to generic net-lease 2%/1yr + standard 15yr/2x5. Empirical fit pending.'),
  -- Dialysis Clinic Inc (DCI, normalizes to ''dialysis''): n=13 < 20 -> fallback standard
  ('dialysis', '1990-01-01', 15, 2, 5, 0.02, 1, 'NNN', 0.40, 'fallback_standard', 13, true,
    'DCI n=13 < 20: fallback to generic net-lease 2%/1yr + standard 15yr/2x5. Empirical fit pending.'),
  -- GENERIC fallback: reproduces the retired hardcoded 2%/12mo default for any unmatched tenant.
  ('*',        '1990-01-01', 15, 2, 5, 0.02, 1, 'NNN', 0.30, 'generic_fallback', NULL, true,
    'Generic net-lease fallback (2%/1yr) for tenants without a specific convention. Replaces the retired hardcoded projection default.')
ON CONFLICT (tenant_canonical, effective_from) DO UPDATE
  SET initial_term_years=EXCLUDED.initial_term_years, option_count=EXCLUDED.option_count,
      option_term_years=EXCLUDED.option_term_years, bump_pct=EXCLUDED.bump_pct,
      bump_interval_years=EXCLUDED.bump_interval_years, base_confidence=EXCLUDED.base_confidence,
      source=EXCLUDED.source, n_sample=EXCLUDED.n_sample, flagged_low_conf=EXCLUDED.flagged_low_conf,
      notes=EXCLUDED.notes;

-- grants (mirror domain read pattern; anon/auth read, service_role all)
GRANT SELECT ON public.property_rent_timeline, public.tenant_lease_conventions,
  public.rent_confidence_ladder, public.rent_reconcile_queue, public.v_property_rent_current
  TO anon, authenticated;
GRANT ALL ON public.property_rent_timeline, public.tenant_lease_conventions,
  public.rent_confidence_ladder, public.rent_reconcile_queue TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.rent_reconcile_queue_queue_id_seq,
  public.tenant_lease_conventions_convention_id_seq, public.rent_confidence_ladder_ladder_id_seq
  TO service_role;
