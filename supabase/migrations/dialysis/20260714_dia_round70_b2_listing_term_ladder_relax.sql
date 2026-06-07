-- Migration: dia — Round 70 Layer B / B2 (D3/D5/D7): recover wrongly-excluded
-- listing terms (third-tier lease ladder reads best lease evidence, not a laggy
-- is_active flag). Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Applied live.
--
-- Receipts (2025-Q1): of 37 priced listings with NO resolvable firm term, 23
-- HAVE a future-dated lease (lease_expiration >= period) that the active-listing
-- term ladder excluded via its strict (is_active=true AND status NOT IN
-- superseded/…/placeholder/closed) filter; only 13 genuinely lack a future term.
-- So ~62% of the term-missing gap is flag-lag, not stale terms.
--
-- Fix (Scott-approved, R69-Task-1 doctrine: prefer linked-sale truth, then the
-- BEST lease evidence): in the third-tier lease term lookup —
--   * DROP the `is_active = true` requirement (read laggy-flagged leases too);
--   * shrink the status exclusion to ONLY 'superseded'/'superseded_duplicate'/
--     'terminated' (the auto-supersede trigger marks genuine replacements
--     explicitly; the rest is flag-lag). 'placeholder' leases carry NULL dates
--     so the `lease_expiration IS NOT NULL` guard already drops them;
--   * tie-break the pick: is_active=true FIRST, then latest lease_expiration —
--     so a stale shorter lease never beats a live longer one.
-- Applied identically to cm_dialysis_active_listings_q (canonical listing
-- universe; feeds on_market_snapshot_q) and cm_dialysis_available_market_size_q
-- (the D6 core-overlay view — its non-core>=3 gate is preserved).
--
-- The ~23/qtr recovered redistribute across cohorts: SOME land 10+ (lifting the
-- thin core line), MOST land <10 (dialysis listings skew short) — both are the
-- honest answer to D3/D5/D7. The residual 10+ thinness is genuine.
--
-- Idempotent / reproducible in filename order (operates on the live def, which
-- on a fresh build is produced by the base + D6 migrations first). Re-running
-- finds the already-relaxed predicate and replaces it identically.

DO $r70b2$
DECLARE d text;
  old_excl CONSTANT text := '(l.is_active = true) AND (lower(COALESCE(l.status, ''''::text)) <> ALL (ARRAY[''superseded''::text, ''superseded_duplicate''::text, ''expired''::text, ''terminated''::text, ''placeholder''::text, ''closed''::text, ''closed but obligated''::text]))';
  new_excl CONSTANT text := '(lower(COALESCE(l.status, ''''::text)) <> ALL (ARRAY[''superseded''::text, ''superseded_duplicate''::text, ''terminated''::text]))';
  old_ord  CONSTANT text := 'ORDER BY l.lease_expiration DESC';
  new_ord  CONSTANT text := 'ORDER BY (COALESCE(l.is_active, false)) DESC, l.lease_expiration DESC';
BEGIN
  d := pg_get_viewdef('public.cm_dialysis_active_listings_q'::regclass);
  d := replace(d, old_excl, new_excl);
  d := replace(d, old_ord, new_ord);
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_q AS ' || d;

  d := pg_get_viewdef('public.cm_dialysis_available_market_size_q'::regclass);
  d := replace(d, old_excl, new_excl);
  d := replace(d, old_ord, new_ord);
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_available_market_size_q AS ' || d;
END $r70b2$;
