-- PDR14b: dia dangling property_id self-heal — durable review queue + flag registration.
-- domain='dia' only. Never touches domain='gov' (see PDR14-GOV, out of scope).
--
-- entities.metadata.domain_property_id is a one-way pointer into dia's `properties`
-- table, set once and never revisited. When dia merges/drops a property row, LCC
-- never finds out, and get_property_context / assemblePropertyPacket silently return
-- empty documents/transactions/ownership for an entity that has real history under a
-- different property_id. Measured live 2026-09-11: 90 dangling entities (89 distinct
-- dead property_ids, one shared by two entities) of 1,246 dia-linked LCC entities.

CREATE TABLE IF NOT EXISTS lcc_dia_property_link_review (
  id bigserial PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES entities(id),
  dangling_property_id text NOT NULL,
  reason text NOT NULL DEFAULT 'no_confident_match',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_property_id text,
  resolved_via text,
  notes text,
  UNIQUE (entity_id, dangling_property_id)
);
COMMENT ON TABLE lcc_dia_property_link_review IS
  'PDR14b: dia-domain LCC entities whose metadata.domain_property_id no longer resolves in the '
  'live dia properties table, and for which no confident resolution (PDR14a redirect table, then '
  'a PDR13-style unambiguous parcel_number match, min length 6) exists. Reviewed here, '
  'never guessed. Populated + kept fresh by GET/POST /api/dia-property-link-tick.';

CREATE INDEX IF NOT EXISTS idx_lcc_dia_property_link_review_open
  ON lcc_dia_property_link_review (entity_id) WHERE resolved_at IS NULL;

REVOKE ALL ON lcc_dia_property_link_review FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON lcc_dia_property_link_review TO service_role;
GRANT USAGE, SELECT ON SEQUENCE lcc_dia_property_link_review_id_seq TO service_role;

-- Single merge owner for the entities.metadata correction (entities.metadata is a
-- shared jsonb column with many writers — the OCR2 "shared jsonb column needs one
-- merge owner" footgun applies identically here; a PostgREST PATCH replaces the whole
-- column). FOR-UPDATE-safe via the row's own natural lock; fill-blanks-only guard: only
-- touches a row whose metadata still names the SAME dead pid being resolved, so a race
-- against another writer degrades to a safe no-op rather than clobbering a newer write.
CREATE OR REPLACE FUNCTION lcc_pdr14b_apply_dia_redirect(
  p_entity_id uuid,
  p_resolved_property_id text,
  p_dead_property_id text,
  p_via text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_via NOT IN ('pdr14b_redirect', 'pdr14b_parcel_match') THEN
    RAISE EXCEPTION 'lcc_pdr14b_apply_dia_redirect: unknown via %', p_via;
  END IF;

  UPDATE entities
  SET metadata = metadata
    || jsonb_build_object(
         'domain_property_id', p_resolved_property_id,
         'domain_property_id_corrected_from', p_dead_property_id,
         'domain_property_id_corrected_at', to_jsonb(now()),
         'domain_property_id_corrected_via', p_via
       )
    || jsonb_build_object(
         'domain_property_ids',
         COALESCE(metadata->'domain_property_ids', '{}'::jsonb)
           || jsonb_build_object('dialysis', p_resolved_property_id)
       )
  WHERE id = p_entity_id
    AND domain = 'dia'
    AND metadata->>'domain_property_id' = p_dead_property_id;

  UPDATE lcc_dia_property_link_review
  SET resolved_at = now(), resolved_property_id = p_resolved_property_id, resolved_via = p_via
  WHERE entity_id = p_entity_id AND dangling_property_id = p_dead_property_id AND resolved_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION lcc_pdr14b_apply_dia_redirect(uuid, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION lcc_pdr14b_apply_dia_redirect(uuid, text, text, text) TO service_role;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'lcc_pdr14b_apply_dia_redirect(uuid,text,text,text)', 'execute'),
    'anon must not execute lcc_pdr14b_apply_dia_redirect';
  ASSERT NOT has_function_privilege('authenticated', 'lcc_pdr14b_apply_dia_redirect(uuid,text,text,text)', 'execute'),
    'authenticated must not execute lcc_pdr14b_apply_dia_redirect';
  ASSERT has_function_privilege('service_role', 'lcc_pdr14b_apply_dia_redirect(uuid,text,text,text)', 'execute'),
    'service_role must execute lcc_pdr14b_apply_dia_redirect';
END $$;

-- Inert-feature-registry doctrine: register the recurring tick's flag.
INSERT INTO feature_flags_registry (flag, purpose, surface, env_var, state, owner, notes)
VALUES (
  'PDR14B_DIA_REDIRECT_SWEEP',
  'Recurring self-heal sweep for dia-domain entity metadata.domain_property_id pointers that '
  'have gone dangling (dia merged/dropped the property row). GET is an ungated dry run; POST '
  'writes and is gated by this flag.',
  'api/dia-property-link-tick',
  'PDR14B_DIA_REDIRECT_SWEEP',
  'on',
  'PDR14b',
  'One-time sweep 2026-09-11: 90 dangling entities (89 distinct dead property_ids, one shared '
  'by two entities) of 1,246 dia-linked LCC entities (7.1%). 31 resolved via PDR14a '
  'dia_resolve_property_id; 13 resolved via an unambiguous parcel_number match (PDR13-style, '
  'min length 6); 46 flagged in lcc_dia_property_link_review, unresolved, never guessed. '
  'Applied live 2026-09-11 (see docs/os/PLANNED-BACKLOG.md PDR14 row).'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, notes = EXCLUDED.notes,
  updated_at = now();
