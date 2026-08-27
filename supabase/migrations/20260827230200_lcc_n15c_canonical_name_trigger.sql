-- =====================================================================
-- N15c Unit 2b — the single writer for entities.canonical_name
-- =====================================================================
-- ⚠️⚠️ APPLY THIS **AFTER** THE JS SHIPS ON RAILWAY, AND ONLY THEN. ⚠️⚠️
--
-- This repo's standing deploy rule is "additive schema before the writer
-- deploy; a constraint that enforces new writer output AFTER it." This is
-- the second kind. The trigger writes the N15c key; a build of
-- `ensureEntityLink` that still looks rows up by the PRE-N15c key would
-- miss every row it touches and mint a duplicate for each.
--
-- The shipped JS is DUAL-READ (`ensureEntityLink` queries the current key
-- AND the legacy key in one request), so once it is live this is safe in
-- either order. Confirm the DEPLOYED sha first, not the merged one:
--     curl -s https://<railway-host>/version
--     git merge-base --is-ancestor <branch-sha> <deployed-sha>
-- and confirm it against the host the traffic actually reaches (P194 - a
-- /version probe answers for the host you asked).
--
-- THEN, in order:
--   select * from lcc_n15c_backfill_canonical_names(true);              -- dry run
--   select * from lcc_n15c_backfill_canonical_names(false, 'n15c_go');  -- apply
--   select drift_class, count(*) from v_lcc_canonical_name_drift group by 1;
--
-- REVERSAL:
--   DROP TRIGGER trg_lcc_entities_canonical_name ON public.entities;
--   UPDATE entities e SET canonical_name = b.old_canonical_name
--     FROM lcc_n15c_canonical_backfill_log b
--    WHERE b.entity_id = e.id AND b.batch_tag = 'n15c_go';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The single writer.
-- ---------------------------------------------------------------------
-- The trigger FUNCTION itself lives in the sibling migration ...230100 — it is
-- inert until a trigger is attached to it, so it ships with the safe half and is
-- already live. THIS FILE IS THE ONE STATEMENT THAT ACTIVATES IT.

-- `UPDATE OF name` — deliberately NOT a bare UPDATE. An UPDATE that does not
-- touch `name` must not recompute, so the 537 rows held back below stay held,
-- and a deliberate manual canonical override is not clobbered by an unrelated
-- write. A writer that changes `name` owns the key, which is the correct rule.
DROP TRIGGER IF EXISTS trg_lcc_entities_canonical_name ON public.entities;
CREATE TRIGGER trg_lcc_entities_canonical_name
  BEFORE INSERT OR UPDATE OF name ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.lcc_entities_canonical_name_biu();

COMMENT ON FUNCTION public.lcc_entities_canonical_name_biu() IS
  'N15c: the ONE writer of entities.canonical_name. Ten code paths wrote this column with four different normalizations; the fix is at the DB because grep demonstrably could not find them all (the N15b census listed seven, the build found ten).';

