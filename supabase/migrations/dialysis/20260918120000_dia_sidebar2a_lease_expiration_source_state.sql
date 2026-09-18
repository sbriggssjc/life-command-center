-- ============================================================================
-- SIDEBAR2-a (2026-09-18) — dia.leases.lease_expiration_source_state
--
-- Bug: the CoStar sidebar lease writer (api/_handlers/sidebar-pipeline.js,
-- upsertDomainLeases) writes `lease_expiration: null` whenever the source
-- payload has no expiration date, indistinguishably from "we never tried to
-- capture this lease's expiration at all" (a NULL column can't tell the two
-- apart). Live evidence, 2026-09-18: four real sidebar sends (Goldsboro,
-- Orlando, Dixon, Scranton) updated/matched lease-bearing property rows but
-- landed no CoStar-sourced expiration anywhere — three of the four had NO
-- expiration date in CoStar's own source at all, per Scott. Per this repo's
-- "never fabricate, never leave a silent null with no trace" doctrine, that
-- needs to be a recorded fact, not an absence.
--
-- This is deliberately additive, nullable, and fill-in-place (not a data
-- correction pass — existing NULL rows stay NULL/unknown; the writer starts
-- stamping this column going forward). No CHECK-enforced full backfill:
-- existing history genuinely cannot be reconstructed (we don't know, for a
-- historical row, whether the source ever had a date), so it stays NULL
-- rather than guessed.
--
-- REVERT: `ALTER TABLE public.leases DROP COLUMN IF EXISTS
-- lease_expiration_source_state;` (additive-only; no other object depends on
-- it, safe at any time).
--
-- Scope note: `leases` also exists on the gov domain DB, which this repo
-- does NOT own (see CLAUDE.md "ONE REPO OWNS EACH DATABASE'S OBJECTS" — gov
-- schema belongs to the government-lease repo). This migration is dia-only
-- on purpose; the equivalent gov-side column is filed as an operator
-- follow-up for that repo (see SIDEBAR2 summary).
-- ============================================================================

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS lease_expiration_source_state text;

ALTER TABLE public.leases
  DROP CONSTRAINT IF EXISTS chk_leases_expiration_source_state;
ALTER TABLE public.leases
  ADD CONSTRAINT chk_leases_expiration_source_state
  CHECK (lease_expiration_source_state IS NULL
         OR lease_expiration_source_state IN ('dated', 'source_no_date'))
  NOT VALID;
ALTER TABLE public.leases
  VALIDATE CONSTRAINT chk_leases_expiration_source_state;

COMMENT ON COLUMN public.leases.lease_expiration_source_state IS
  'SIDEBAR2-a: written by the CoStar sidebar lease writer only. '
  '''dated'' = a lease_expiration was present in the captured source. '
  '''source_no_date'' = the writer captured this lease but the source had '
  'no expiration date at all (an explicit marker, never a silent NULL). '
  'NULL = pre-instrumentation row, or not written by this writer at all — '
  'carries no claim either way.';
