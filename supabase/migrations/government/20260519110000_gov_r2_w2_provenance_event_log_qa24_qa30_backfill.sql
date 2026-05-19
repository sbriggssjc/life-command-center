-- ============================================================================
-- Round 76r2-w2 (gov, 2026-05-19): provenance_event_log + QA-24/QA-30 backfill
--
-- Round 2 finding R2-W-2 (CRITICAL): QA-24 and QA-30 backfill UPDATEs
-- silently rewrote ~1,221 gov.properties.agency_canonical rows with no
-- entry in the LCC Opps field_provenance ledger.
--
-- Mirrors the dia migration 20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql.
-- This one is simpler than the dia case because:
--
--   • canonicalize_agency() is a function called from application code +
--     one-shot UPDATEs, NOT a row-level trigger. There is no trigger
--     function to replace.
--
--   • Future application-side writes to agency_canonical should already
--     route through field_provenance via lcc_merge_field (sidebar /
--     intake-promoter paths). The provenance gap is specifically about
--     the historical bulk UPDATEs in QA-24 and QA-30.
--
-- So this migration:
--   1. Creates public.provenance_event_log (same shape as dia version,
--      target_database='gov_db')
--   2. Inserts two historical bulk-UPDATE marker rows — one for QA-24 (~1,217
--      VA singular rows) and one for QA-30 (~4 FBI/FCC rows).
--
-- Future work (R2-W-2b): when canonicalize_agency() is wired into a
-- BEFORE INSERT/UPDATE trigger or a GENERATED column, also write per-row
-- audit rows to provenance_event_log (mirroring the dia QA-22 pattern).
-- ============================================================================

BEGIN;

-- ── 1. provenance_event_log table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provenance_event_log (
  id                      bigserial PRIMARY KEY,
  target_database         text NOT NULL DEFAULT 'gov_db'
                            CHECK (target_database IN ('gov_db')),
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
  'Round 76r2-w2 (2026-05-19): gov-side mirror of dia.provenance_event_log.
   Per-DB local audit log for SQL-trigger / function-driven field writes
   that cannot reach LCC Opps lcc_merge_field() directly from trigger
   context. Drained to LCC Opps field_provenance by the
   lcc-provenance-event-flush cron (R2-W-2b, future). Append-only.';

CREATE INDEX IF NOT EXISTS provenance_event_log_unflushed_idx
  ON public.provenance_event_log (recorded_at)
  WHERE flushed_to_lcc_opps_at IS NULL;

CREATE INDEX IF NOT EXISTS provenance_event_log_target_idx
  ON public.provenance_event_log (target_table, record_pk_value, field_name, recorded_at DESC);

CREATE INDEX IF NOT EXISTS provenance_event_log_source_idx
  ON public.provenance_event_log (source, recorded_at DESC);

-- ── 2. Historical bulk-UPDATE marker — QA-24 (2026-05-18) ───────────────
-- QA-24's UPDATE flipped agency_canonical → 'VA' for 1,217 "veteran affairs"
-- (singular) properties and re-canonicalized some incidental rows. Total
-- impact per QA-24 closeout: 1,875 - 657 = +1,218 net VA bucket gain.
INSERT INTO public.provenance_event_log
  (target_table, record_pk_value, field_name,
   old_value, new_value, source, confidence,
   recorded_at, metadata)
VALUES
  ('gov.properties',
   '<bulk_backfill_QA24>',
   'agency_canonical',
   NULL,
   to_jsonb('VA'::text),
   'qa24_canonicalize_agency',
   1.0,
   '2026-05-18T17:57:00Z'::timestamptz,
   jsonb_build_object(
     'kind', 'historical_bulk_update_marker',
     'migration', '20260518220000_gov_qa24_canonicalize_agency_veteran_singular.sql',
     'rows_affected', 1218,
     'effect', 'Recanonicalized US Department of Veteran Affairs (singular variant) and three related buckets into the canonical VA bucket.',
     'note', 'Single audit marker for the QA-24 one-shot UPDATE. Individual row deltas were not captured (canonicalize_agency expansion ran before provenance instrumentation — this is the Round 76r2-w2 retrospective acknowledgement).'
   ));

-- ── 3. Historical bulk-UPDATE marker — QA-30 (2026-05-18) ───────────────
-- QA-30 extended canonicalize_agency to handle FBI hyphen + FCC. Re-canonicalized
-- 1 FBI hyphen row, 2 raw 'FCC' rows, and 1 'Federal Communications Commission' row.
INSERT INTO public.provenance_event_log
  (target_table, record_pk_value, field_name,
   old_value, new_value, source, confidence,
   recorded_at, metadata)
VALUES
  ('gov.properties',
   '<bulk_backfill_QA30>',
   'agency_canonical',
   NULL,
   NULL,
   'qa30_canonicalize_agency',
   1.0,
   '2026-05-18T20:05:00Z'::timestamptz,
   jsonb_build_object(
     'kind', 'historical_bulk_update_marker',
     'migration', '20260518240000_gov_qa30_canonicalize_agency_fbi_hyphen_fcc.sql',
     'rows_affected', 4,
     'effect', 'Recanonicalized 1 FBI hyphen variant → FBI, 2 raw FCC → FCC, 1 Federal Communications Commission → FCC. Added FCC as a new canonical category.',
     'note', 'Round 76r2-w2 retrospective acknowledgement marker.'
   ));

COMMIT;
