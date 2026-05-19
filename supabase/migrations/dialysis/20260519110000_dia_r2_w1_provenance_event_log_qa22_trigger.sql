-- ============================================================================
-- Round 76r2-w1 (dia, 2026-05-19): provenance_event_log + QA-22 trigger upgrade
--
-- Round 2 finding R2-W-1 (CRITICAL): QA-22's BEFORE INSERT/UPDATE trigger
-- on public.properties.tenant silently rewrites davita/DAVITA/Davita → DaVita
-- with no entry in the LCC Opps field_provenance ledger.
--
-- LCC Opps' lcc_merge_field() is on a different Postgres instance — we
-- can't call it cross-DB from inside a row-level trigger. So we:
--
-- 1. Add a per-DB append-only audit table (public.provenance_event_log)
--    that mirrors the field_provenance shape and is safe to write to from
--    trigger context.
--
-- 2. Replace the QA-22 trigger function with a version that:
--      a) does the same canonicalize_davita_brand() rewrite
--      b) when the value actually changed, inserts a provenance_event_log
--         row tagged source='qa22_davita_brand_canonicalize'
--
-- 3. Backfill a single "historical bulk UPDATE" marker for the 2,646 rows
--    QA-22's UPDATE touched on 2026-05-18 (so the audit trail is complete
--    from the moment the canonicalizer started running).
--
-- 4. Index the log by (target_database, target_table, recorded_at) so the
--    future lcc-provenance-event-flush cron can drain it efficiently.
--
-- Future work (R2-W-1b): build the cron that reads provenance_event_log
-- rows where flushed_to_lcc_opps_at IS NULL, POSTs each via /api/admin
-- to lcc_merge_field on LCC Opps, and PATCHes flushed_to_lcc_opps_at.
-- ============================================================================

BEGIN;

-- ── 1. provenance_event_log table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provenance_event_log (
  id                      bigserial PRIMARY KEY,
  target_database         text NOT NULL DEFAULT 'dia_db'
                            CHECK (target_database IN ('dia_db')),
  target_table            text NOT NULL,
  record_pk_value         text NOT NULL,
  field_name              text NOT NULL,
  old_value               jsonb,
  new_value               jsonb,
  source                  text NOT NULL,
  source_run_id           text,
  confidence              numeric(4,3)
                            CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  flushed_to_lcc_opps_at  timestamptz,
  flush_attempt_count     integer NOT NULL DEFAULT 0,
  flush_last_error        text,
  metadata                jsonb
);

COMMENT ON TABLE public.provenance_event_log IS
  'Round 76r2-w1 (2026-05-19): per-DB local audit log for SQL-trigger /
   function-driven field writes that cannot reach LCC Opps lcc_merge_field()
   directly from trigger context. Drained to LCC Opps field_provenance by
   the lcc-provenance-event-flush cron (R2-W-1b, future). Append-only.';

CREATE INDEX IF NOT EXISTS provenance_event_log_unflushed_idx
  ON public.provenance_event_log (recorded_at)
  WHERE flushed_to_lcc_opps_at IS NULL;

CREATE INDEX IF NOT EXISTS provenance_event_log_target_idx
  ON public.provenance_event_log (target_table, record_pk_value, field_name, recorded_at DESC);

CREATE INDEX IF NOT EXISTS provenance_event_log_source_idx
  ON public.provenance_event_log (source, recorded_at DESC);

-- ── 2. QA-22 trigger upgrade ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.properties_tenant_brand_canonicalize_trg()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_old_tenant text := OLD.tenant;
  v_new_canon  text;
BEGIN
  -- INSERT has no OLD record; coalesce to NULL.
  IF TG_OP = 'INSERT' THEN
    v_old_tenant := NULL;
  END IF;

  IF NEW.tenant IS NOT NULL THEN
    v_new_canon := public.canonicalize_davita_brand(NEW.tenant);

    IF v_new_canon IS DISTINCT FROM NEW.tenant THEN
      -- Canonicalizer actually rewrote the value. Log it and apply.
      INSERT INTO public.provenance_event_log
        (target_table, record_pk_value, field_name,
         old_value, new_value, source, confidence, metadata)
      VALUES
        ('dia.properties',
         COALESCE(NEW.property_id::text, '<unknown>'),
         'tenant',
         CASE WHEN v_old_tenant IS NULL THEN NULL ELSE to_jsonb(v_old_tenant) END,
         to_jsonb(v_new_canon),
         'qa22_davita_brand_canonicalize',
         1.0,
         jsonb_build_object(
           'trigger_op', TG_OP,
           'pre_canonical_input', NEW.tenant,
           'note', 'Round 76r2-w1 trigger; written from BEFORE INSERT/UPDATE of dia.properties.tenant'
         ));

      NEW.tenant := v_new_canon;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.properties_tenant_brand_canonicalize_trg() IS
  'Round 76r2-w1 (2026-05-19): same davita brand canonicalization as the
   QA-22 trigger but also writes an audit row to public.provenance_event_log
   whenever the canonicalizer actually rewrites the value. Drained to LCC
   Opps field_provenance by the lcc-provenance-event-flush cron.';

-- Trigger definition unchanged (we replaced the underlying function only).
DROP TRIGGER IF EXISTS properties_tenant_brand_canonicalize_trg ON public.properties;
CREATE TRIGGER properties_tenant_brand_canonicalize_trg
  BEFORE INSERT OR UPDATE OF tenant ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.properties_tenant_brand_canonicalize_trg();

-- ── 3. Historical bulk-UPDATE marker for QA-22's 2026-05-18 backfill ────
-- The QA-22 migration ran:
--   UPDATE public.properties
--     SET tenant = canonicalize_davita_brand(tenant)
--     WHERE tenant ~ '\m(davita|DAVITA|Davita)\M' AND tenant IS DISTINCT FROM canonicalize_davita_brand(tenant);
-- Touched 2,646 rows (2,531 "Davita" + 115 "DAVITA" per the QA-22 closeout).
-- Insert a single summary marker row so the audit ledger acknowledges the event.
INSERT INTO public.provenance_event_log
  (target_table, record_pk_value, field_name,
   old_value, new_value, source, confidence,
   recorded_at, metadata)
VALUES
  ('dia.properties',
   '<bulk_backfill_QA22>',
   'tenant',
   NULL,
   NULL,
   'qa22_davita_brand_canonicalize',
   1.0,
   '2026-05-18T20:00:00Z'::timestamptz,
   jsonb_build_object(
     'kind', 'historical_bulk_update_marker',
     'migration', '20260518200000_dia_qa22_davita_brand_casing.sql',
     'rows_affected', 2646,
     'breakdown', jsonb_build_object('Davita_prefix', 2531, 'DAVITA_all_caps', 115),
     'note', 'Single audit marker for the QA-22 one-shot UPDATE. Individual row deltas were not captured (the canonicalizer was added without provenance — this is the Round 76r2-w1 retrospective acknowledgement).'
   ));

COMMIT;
