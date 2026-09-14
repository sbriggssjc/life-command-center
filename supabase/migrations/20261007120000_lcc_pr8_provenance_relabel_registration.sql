-- ============================================================================
-- PR8 — the provenance relabel: registered-for-this-field IS the allowlist.
--
-- lcc_flush_provenance_events() carried a four-name literal and merged EVERY
-- other event under the placeholder name `domain_trigger`. Live on
-- xengecqvemvfknjvbvrq, 2026-09-02, before this migration:
--
--   field_provenance.source = 'domain_trigger'  ..............  17,371 rows
--     of which carrying a ':evt' source_run_id  ..............  17,371 (100%)
--
-- i.e. EVERY row wearing that name is a relabel; nothing has ever actually been
-- `domain_trigger`. Decomposed by split_part(source_run_id, ':evt', 1):
--
--   agency_classifier               17,277   gov.sales_transactions 9,134
--                                            gov.properties         6,564
--                                            gov.leases             1,146
--                                            gov.property_agencies    433
--                                            (government_type; last write 2026-09-02 — LIVE)
--   qa22_davita_brand_canonicalize      94   dia.properties.tenant (one-shot 2026-07-30)
--
-- Three defects, each of a different kind:
--   1. `agency_classifier` writes 17,277 provenance rows under a name that is
--      not its own, at a catch-all rung, and is NOT registered in
--      field_source_priority at all. PR5's write-but-unregistered arm could not
--      see it because it wears domain_trigger's name.
--   2. `qa22_...` IS registered (1 rung @90) and sat in PR5's "39 never
--      written" while 94 of its rows exist under the wrong label.
--   3. PR1's stated verification (field_provenance where source='county_records'
--      going non-zero) could never have observed success.
--
-- WHAT THIS MIGRATION DOES
--   1. Replaces the literal allowlist with the registry. The function already
--      required a field_source_priority row for the (table, field, source); that
--      EXISTS check is kept and is now the whole rule. A registered source keeps
--      its own name; an UNREGISTERED one still lands as `domain_trigger` — that
--      is the correct honest fallback for a writer nobody has ranked, and it is
--      what keeps v_field_provenance_unranked meaningful.
--   2. Registers `agency_classifier` at the four rungs it actually writes, at
--      priority 90 — the SAME rung domain_trigger holds today, so the merge
--      outcome is byte-identical and only the NAME changes. Re-ranking it is a
--      separate, evidenced decision (see the note below).
--   3. Adds v_field_provenance_effective_source — APPEND-ONLY. field_provenance
--      is an append-only ledger; its 17,371 historical rows are NOT rewritten.
--
-- ⚠️ THE ONE SOURCE THAT IS EXPLICITLY DENIED, AND WHY THAT IS NOT OPTIONAL
--   Removing the literal allowlist ARMS every registered source, and one of them
--   must not be armed. `county_records` holds 93 rungs across 18 tables with a
--   best rung of **5** — above salesforce(20), om_extraction(25-50) and every
--   sidebar(45-65) — and PR1 measured its producer
--   (Dialysis/government-lease src/public_record_ingest.py) to contain NO county
--   fetch: it asks gpt-4o to recall parcel/tax facts. Today the relabel is what
--   structurally prevents that from reaching the ladder; nothing else does. So
--   the refusal is made EXPLICIT (v_never_first_class) rather than left as an
--   accident of a four-item literal. Under the old code a county_records event
--   merged as domain_trigger, which has no rung for those fields, so it could at
--   most fill a blank; under the new rule it would merge at @5 and OVERRIDE real
--   evidence. This is a preservation of PR1's decision, not an addition to any
--   allowlist. RETIRE IT only together with a real acquisition path
--   (REGRID_API_KEY -> regrid_client.py; backlog PR1d), never as plumbing.
--
-- ⚠️ MEASURED BEFORE/AFTER (one session, two self-rolling-back transactions over
--    the SAME live state, a 1,521-event stratified replay covering all 15 live
--    (source, table, field) combos, 150/combo):
--
--    PREDICTED: 5 combos change SOURCE; 0 decisions change.
--    ACTUAL:    exactly that. Every decision count byte-identical, including
--               dia.properties|tenant|skip=1 and
--               gov.property_agencies|government_type|superseded=106.
--                 baseline: ...|domain_trigger|write=150  (x4 gov government_type)
--                 new:      ...|agency_classifier|write=150
--                 baseline: dia.properties|tenant|domain_trigger|write=93,skip=1
--                 new:      dia.properties|tenant|qa22_davita_brand_canonicalize|write=93,skip=1
--               splink_v1 / splink_v2 / sf_link_review_human /
--               sf_account_contact_expansion: unchanged on all 9 combos.
--
--    The decisions are identical because lcc_merge_field tests
--    `same_priority_same_value_refresh` BEFORE `same_source_refresh_newest_wins`.
--
-- ⚠️ THE ONE RESIDUAL, STATED AND SIZED RATHER THAN PAPERED OVER
--    During the transition a record's newest `write` row is still labelled
--    domain_trigger. If agency_classifier were to re-classify that record to a
--    DIFFERENT value, the ladder would see two different sources at equal
--    priority 90 and record `conflict` where it previously recorded
--    `same_source_refresh_newest_wins` -> write. Measured over the producer's
--    entire history: 17,277 events, 309 keys re-written (1,352 events), and
--    **0 keys have ever changed value**. The path is real and has never once
--    been exercised. It self-clears as each record's newest row takes the new
--    name. This is the reason to register at 90 rather than at a new rung.
--
-- NOT DONE HERE, DELIBERATELY:
--   * No rung for gov.properties.agency_canonical — agency_classifier has
--     written 0 rows to it (the 2 events there are qa24_/qa30_canonicalize_agency
--     and both were skipped as markers). A rung nobody can exercise is PR7's class.
--   * The domain_trigger rungs are KEPT — they remain the correct fallback.
--   * field_provenance is not rewritten. lcc_merge_field is not touched.
--   * agency_classifier is NOT re-ranked. Its producer was read: gov
--     sql/20260601_gov_type_3tier_classification.sql :: gov_classify_agency() is
--     a pure STABLE plpgsql rule engine over the curated government_agencies
--     lookup and agency_enrichment_rules patterns — it makes NO external call of
--     any kind (no http, no pg_net, no model). It is fill-blanks (its trigger
--     only classifies when no value exists). So it is a defensible source and
--     arguably belongs above 90; note the gov-side field_value_provenance
--     already ranks it authority_rank 30. Two ladders disagreeing about one
--     source is a real question and it is filed, not decided here — a re-rank
--     changes which writes WIN and needs its own before/after.
--
-- REVERSAL
--   1. Re-apply the W9.3 body from
--      supabase/migrations/20260827120000_lcc_w9_3_sf_linkage_drain.sql (section 2b).
--   2. DELETE FROM public.field_source_priority
--       WHERE source='agency_classifier' AND field_name='government_type';
--   3. DROP VIEW IF EXISTS public.v_field_provenance_effective_source;
--   No field_provenance row is created, altered or deleted by this migration.
-- ============================================================================

-- ── 1. Register agency_classifier at the rungs it actually writes ────────────
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('gov.sales_transactions', 'government_type', 'agency_classifier', 90, 0.0, 'record_only',
   'PR8: deterministic gov_classify_agency() rule engine (curated government_agencies + agency_enrichment_rules; no external call). 9,134 rows written 2026-07-30.. under the domain_trigger relabel. Registered at 90 = the rung those rows already merged at, so the outcome is unchanged and only the name is corrected.'),
  ('gov.properties',        'government_type', 'agency_classifier', 90, 0.0, 'record_only',
   'PR8: as above; 6,564 rows.'),
  ('gov.leases',            'government_type', 'agency_classifier', 90, 0.0, 'record_only',
   'PR8: as above; 1,146 rows.'),
  ('gov.property_agencies', 'government_type', 'agency_classifier', 90, 0.0, 'record_only',
   'PR8: as above; 433 rows, still writing 2026-09-02.')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority, min_confidence = EXCLUDED.min_confidence,
      enforce_mode = EXCLUDED.enforce_mode, notes = EXCLUDED.notes, updated_at = now();

-- ── 2. The registry IS the allowlist ─────────────────────────────────────────
-- Byte-identical to the W9.3 body except: the v_first_class literal is GONE and
-- the pass-through gate is the field_source_priority EXISTS check alone, minus
-- the explicit v_never_first_class refusal documented in the header.
CREATE OR REPLACE FUNCTION public.lcc_flush_provenance_events(
  p_domain              text,
  p_events              jsonb,
  p_default_confidence  numeric DEFAULT 0.9
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_db     text;
  v_e             jsonb;
  v_id            bigint;
  v_raw_table     text;
  v_table         text;
  v_pk            text;
  v_field         text;
  v_newval        jsonb;
  v_src           text;
  v_merge_source  text;
  v_conf          numeric;
  v_kind          text;
  v_runid         text;
  v_decision      text;
  v_is_marker     boolean;
  v_merged        bigint[] := ARRAY[]::bigint[];
  v_skipped       bigint[] := ARRAY[]::bigint[];
  v_errors        jsonb    := '[]'::jsonb;
  v_decisions     jsonb    := '{}'::jsonb;
  v_max_id        bigint   := 0;
  -- PR8: sources REFUSED their own identity regardless of registration. See the
  -- migration header. county_records is registered on 93 rungs at a best rung of
  -- 5 and its producer generates its values (PR1) — the relabel is the only
  -- structural thing keeping it off the ladder. Retire this entry only with a
  -- real acquisition path (PR1d), never as plumbing.
  v_never_first_class text[] := ARRAY['county_records'];
BEGIN
  IF p_domain NOT IN ('dia','gov') THEN
    RAISE EXCEPTION 'p_domain must be dia or gov, got %', p_domain;
  END IF;
  v_target_db := CASE p_domain WHEN 'dia' THEN 'dia_db' ELSE 'gov_db' END;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb))
  LOOP
    v_id        := NULLIF(v_e->>'id','')::bigint;
    IF v_id IS NULL THEN CONTINUE; END IF;
    IF v_id > v_max_id THEN v_max_id := v_id; END IF;

    v_raw_table := v_e->>'target_table';
    v_pk        := v_e->>'record_pk_value';
    v_field     := v_e->>'field_name';
    v_newval    := v_e->'new_value';
    v_src       := COALESCE(v_e->>'source','domain_trigger');
    v_conf      := COALESCE(NULLIF(v_e->>'confidence','')::numeric, p_default_confidence);
    v_kind      := v_e->'metadata'->>'kind';

    v_is_marker := (v_pk IS NULL)
                OR (v_pk LIKE '<%>')
                OR (v_kind = 'historical_bulk_update_marker')
                OR (v_newval IS NULL)
                OR (v_newval = 'null'::jsonb);
    IF v_is_marker THEN
      v_skipped := v_skipped || v_id;
      CONTINUE;
    END IF;

    v_table := CASE WHEN position('.' IN COALESCE(v_raw_table,'')) > 0
                    THEN v_raw_table
                    ELSE p_domain || '.' || v_raw_table END;

    -- PR8: registered-for-THIS-(table,field) => keep your own name. Anything
    -- else merges as domain_trigger, which is the honest fallback for an
    -- unranked writer and is what v_field_provenance_unranked exists to surface.
    v_merge_source := 'domain_trigger';
    IF v_src <> 'domain_trigger'
       AND NOT (v_src = ANY(v_never_first_class))
       AND EXISTS (
         SELECT 1 FROM public.field_source_priority fsp
          WHERE fsp.target_table = v_table
            AND fsp.field_name = v_field
            AND fsp.source = v_src
       ) THEN
      v_merge_source := v_src;
    END IF;

    -- The originating name is preserved here whatever the merge source, so the
    -- relabel stays recoverable without touching the append-only ledger.
    v_runid := v_src || ':evt' || v_id;

    BEGIN
      SELECT lmf.decision INTO v_decision
      FROM public.lcc_merge_field(
        NULL, v_target_db, v_table, v_pk, v_field, v_newval,
        v_merge_source, v_runid, v_conf, NULL
      ) lmf;

      v_merged    := v_merged || v_id;
      v_decisions := jsonb_set(
                       v_decisions,
                       ARRAY[COALESCE(v_decision,'unknown')],
                       to_jsonb(COALESCE((v_decisions->>COALESCE(v_decision,'unknown'))::int,0) + 1),
                       true);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('id', v_id, 'error', left(SQLERRM, 400));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'merged_ids',   to_jsonb(v_merged),
    'skipped_ids',  to_jsonb(v_skipped),
    'errors',       v_errors,
    'decisions',    v_decisions,
    'max_event_id', v_max_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) TO service_role;

-- ── 3. Expose the effective source — a VIEW, never a rewrite ────────────────
-- ⚠️ THE GUARD ON THE SHAPE IS LOAD-BEARING, MEASURED, NOT DEFENSIVE POLISH.
--    The obvious expression `coalesce(nullif(split_part(source_run_id,':evt',1),''), source)`
--    is WRONG: split_part returns the WHOLE string when the delimiter is absent,
--    and it is absent on 943,916 of the 1,263,825 rows in this table (ordinary
--    batch tags). Measured live 2026-09-02, that expression INVENTS
--    **9,950 source names that do not exist**, and re-keying PR5's
--    write-but-unregistered arm on it returns **9,951 instead of 22**. Requiring
--    the full `<name>:evt<digits>` shape returns the real answer. Same family as
--    the P157 reloptions and P182 deparse traps: a predicate structurally unable
--    to express the question answers with a plausible number instead of an error.
CREATE OR REPLACE VIEW public.v_field_provenance_effective_source AS
SELECT
  fp.id,
  fp.target_database,
  fp.target_table,
  fp.record_pk_value,
  fp.field_name,
  fp.value,
  fp.source,
  fp.source_run_id,
  fp.confidence,
  fp.decision,
  fp.decision_reason,
  fp.recorded_at,
  CASE
    WHEN fp.source_run_id ~ '^.+:evt[0-9]+$'
      THEN split_part(fp.source_run_id, ':evt', 1)
    ELSE fp.source
  END AS effective_source,
  (fp.source_run_id ~ '^.+:evt[0-9]+$' AND fp.source IS DISTINCT FROM
     split_part(fp.source_run_id, ':evt', 1))          AS was_relabelled
FROM public.field_provenance fp;

COMMENT ON VIEW public.v_field_provenance_effective_source IS
  'PR8: field_provenance with the pre-relabel producer name recovered from '
  'source_run_id (lcc_flush_provenance_events writes <source>:evt<event_id>). '
  'APPEND-ONLY — the ledger itself is never rewritten. Read effective_source, '
  'not source, for any producer census. The `:evt<digits>` shape guard is '
  'required: a bare split_part invents 9,950 fake source names out of ordinary '
  'batch tags (measured 2026-09-02). PR5 detector, both arms: '
  '  registered-never-written: field_source_priority.source NOT IN '
  '(select effective_source from this view); '
  '  write-but-unregistered: the inverse.';

GRANT SELECT ON public.v_field_provenance_effective_source TO service_role;
