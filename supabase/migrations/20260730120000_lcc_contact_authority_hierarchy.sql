-- Contact authority hierarchy + org-aware role model + control/directed lane +
-- buyer/seller prospect mode (2026-07-16) — LCC Opps.
-- ============================================================================
-- Aligns CONTACT SELECTION with the ORE ownership-reconciliation doctrine
-- (ORE_REALIGNMENT §9): contact discovery/selection must be authority-weighted
-- and org-structure-aware, with a parallel experience/direction lane, and it
-- must never stall.
--
-- Reuse, not rebuild — this EXTENDS the built CONTACT-SELECTION machinery:
--   * v_owner_contact_candidates / v_owner_active_contact (the bench + active pick)
--   * owner_contact_pivot + lcc_apply_contact_feedback (the pivot + re-ranker)
--   * v_owner_archetype (institutional/local) + R5 buyer parents / SPE
-- All additive / reversible (drop the fn + views + the 5 pivot columns → the
-- pre-round behaviour returns) / guarded / never-fabricate / cache-or-live safe.
--
-- Unit 1 — contact-authority weight: a signer / managing-member / notice
--          individual OUTRANKS a CoStar "ownership contact" on the bench.
-- Unit 2 — v_owner_archetype gains a role_model (individual_led vs role_separated)
--          + the target functional role for buyer/seller work.
-- Unit 3 — owner_contact_pivot gains a DIRECTED contact + control/directed
--          intensity; lcc_apply_contact_feedback gains a `handoff`/`directed`
--          verdict that adds the directed contact + lightens (never drops) the
--          control-contact cadence.
-- Unit 4 — v_owner_prospect_mode: buyer (repeat acquirer → buy-side) vs seller,
--          with a resonant `touch_theme`.
-- Unit 5 — never-stall: the authority lane always yields a best-authoritative
--          control contact (the resolver is deterministic; the pivot always
--          carries an active pick OR a routed enrichment_action, never a block).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Unit 1 — canonical contact-authority weight (lower = MORE authoritative).
-- The person who SIGNED (deed/loan) is better evidence of control than an
-- aggregator listing; a managing member / notice individual outranks a
-- CoStar-captured "ownership contact"; naming/inference is the floor.
--
-- Keyed on the relationship's captured (role, via) metadata. Mirrors the JS
-- `contactAuthorityWeight` in api/_shared/contact-authority.js — keep the two
-- in sync. IMMUTABLE / pure.
--   1  deed / loan SIGNATORY or EXECUTOR (bound the entity)
--   2  controlling SOS role: managing member / general partner / manager / sole member
--   3  named principal / officer / trustee / notice individual / authorized signatory / economic (beneficial) owner
--   4  registered agent
--   6  captured "ownership contact" (CoStar / generic / prospecting)
--   8  naming / inference (no authority signal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_contact_authority_weight(p_source text, p_role text)
RETURNS int AS $fn$
DECLARE r text; s text;
BEGIN
  r := lower(coalesce(p_role, ''));
  s := lower(coalesce(p_source, ''));
  -- 1 signer / executor — the human who SIGNED
  IF r ~ '(signatory|signer|executor)' OR s ~ '(deed|loan)' THEN RETURN 1; END IF;
  -- 2 controlling SOS role — keyed on the controlling ROLE, not a bare `sos`
  -- via: an SOS lookup can return a managing member (2) OR a registered agent
  -- (4); the role decides.
  IF r ~ '(managing[_ ]?member|general[_ ]?partner|\mgp\M|sole[_ ]?member|\mmanager\M|\mmgr\M|\mmbr\M|\mambr\M|controlling)'
     OR s ~ 'managing[_ ]?member' THEN RETURN 2; END IF;
  -- 3 named principal / officer / trustee / notice individual / authorized signatory / economic owner
  IF r ~ '(principal|president|\mceo\M|officer|\mcfo\M|\mcoo\M|secretary|treasurer|trustee|authorized|notice|economic|beneficial|\mvp\M|\map\M)'
     OR s ~ '(address)' THEN RETURN 3; END IF;
  -- 4 registered agent
  IF r ~ '(registered[_ ]?agent|reg_agent|\magent\M)' THEN RETURN 4; END IF;
  -- 8 naming / inference (no authority signal)
  IF s ~ '(cross_reference|naming|web_search|inference)' THEN RETURN 8; END IF;
  -- 6 captured ownership contact (CoStar / generic)
  RETURN 6;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;
REVOKE ALL ON FUNCTION public.lcc_contact_authority_weight(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_contact_authority_weight(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Unit 1 — repoint the candidate bench's NATIVE (attached-person) branch onto
-- the authority weight. Previously every LCC-native related person landed at a
-- flat authority_level=5, so an attached deed-signer / managing member ranked
-- BELOW every domain-mirror signal (and near CoStar-captured). Now the
-- relationship's captured (role, via) metadata drives the weight, so a
-- signer / managing-member / notice individual sits at the TOP of the bench and
-- the active pick + confidence in v_owner_active_contact inherit it (that view
-- already ORDERs by authority_level ASC — no change needed there).
--
-- Byte-identical to Slice 1 EXCEPT the native_cand branch (DISTINCT ON the
-- best-authority edge per (owner, person); role/authority from metadata).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_owner_contact_candidates
WITH (security_invoker = true) AS
WITH bridged AS (
  SELECT DISTINCT ON (x.source_system, x.external_id)
         x.source_system AS source_domain, x.external_id AS source_true_owner_id,
         e.id AS entity_id, e.name AS owner_name, e.workspace_id
  FROM public.external_identities x
  JOIN public.entities e ON e.id = x.entity_id AND e.merged_into_entity_id IS NULL
  WHERE x.source_type = 'true_owner' AND x.source_system IN ('dia','gov')
    AND NOT public.lcc_is_operator_owner_name(e.name)
  ORDER BY x.source_system, x.external_id, e.created_at NULLS LAST, e.id
),
domain_cand AS (
  SELECT b.entity_id, b.owner_name, b.workspace_id, m.source_domain,
         btrim(c->>'name') AS candidate_name, (c->>'role') AS contact_role,
         (c->>'authority')::int AS authority_level, (c->>'source') AS source,
         COALESCE((c->>'n_props')::int, 1) AS n_props, NULL::uuid AS contact_entity_id
  FROM public.lcc_owner_contact_signals m
  JOIN bridged b ON b.source_domain = m.source_domain AND b.source_true_owner_id = m.source_true_owner_id
  CROSS JOIN LATERAL jsonb_array_elements(m.candidates) c
  WHERE NOT public.lcc_is_rejected_contact_name(c->>'name')
),
native_cand AS (
  SELECT DISTINCT ON (o.entity_id, pe.id)
         o.entity_id, o.owner_name, o.workspace_id, NULL::text AS source_domain,
         pe.name AS candidate_name,
         COALESCE(NULLIF(btrim(er.metadata->>'role'), ''), 'captured_person') AS contact_role,
         public.lcc_contact_authority_weight(er.metadata->>'via', er.metadata->>'role') AS authority_level,
         'related_person' AS source, 1 AS n_props, pe.id AS contact_entity_id
  FROM (SELECT DISTINCT entity_id, owner_name, workspace_id FROM bridged) o
  JOIN public.entity_relationships er ON (er.from_entity_id = o.entity_id OR er.to_entity_id = o.entity_id)
  JOIN public.entities pe ON pe.id = CASE WHEN er.from_entity_id = o.entity_id THEN er.to_entity_id ELSE er.from_entity_id END
      AND pe.entity_type = 'person' AND pe.merged_into_entity_id IS NULL
  WHERE NOT public.lcc_is_rejected_contact_name(pe.name)
    AND COALESCE((pe.metadata->>'junk_name_flagged')::boolean, false) = false
  ORDER BY o.entity_id, pe.id,
           public.lcc_contact_authority_weight(er.metadata->>'via', er.metadata->>'role') ASC
)
SELECT entity_id, owner_name, workspace_id, source_domain, candidate_name, contact_role,
       authority_level, source, n_props, contact_entity_id,
       public.lcc_looks_like_person(candidate_name) AS is_named_individual
FROM domain_cand
UNION ALL
SELECT entity_id, owner_name, workspace_id, source_domain, candidate_name, contact_role,
       authority_level, source, n_props, contact_entity_id,
       public.lcc_looks_like_person(candidate_name)
FROM native_cand;

GRANT SELECT ON public.v_owner_contact_candidates TO authenticated;
COMMENT ON VIEW public.v_owner_contact_candidates IS
  'CONTACT-SELECTION bench: one row per candidate human/firm per bridged owner, '
  'ranked by authority_level. Domain-mirror signals keep their authority; '
  'LCC-native attached persons now derive authority from the relationship '
  '(role,via) via lcc_contact_authority_weight (Unit 1) — a deed signatory / '
  'managing member / notice individual OUTRANKS a CoStar-captured contact. '
  'Junk/operator/broker/federal rejected. Read-only.';

-- ---------------------------------------------------------------------------
-- Unit 3 — the control vs directed lane on the pivot (additive, reversible).
-- A handoff ("call my wealth manager / talk to Jane in acquisitions") directs
-- future action but does NOT change who holds CONTROL. So the pivot keeps its
-- CONTROL contact (active_contact_*) and gains a DIRECTED contact + a per-lane
-- intensity: after a handoff the control cadence is lightened (never dropped),
-- the directed contact worked fully.
-- ---------------------------------------------------------------------------
ALTER TABLE public.owner_contact_pivot
  ADD COLUMN IF NOT EXISTS directed_contact_name      text,
  ADD COLUMN IF NOT EXISTS directed_contact_entity_id uuid,
  ADD COLUMN IF NOT EXISTS directed_contact_role      text,
  ADD COLUMN IF NOT EXISTS control_intensity          text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS directed_intensity         text;

DO $ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_contact_pivot_control_intensity_chk') THEN
    ALTER TABLE public.owner_contact_pivot
      ADD CONSTRAINT owner_contact_pivot_control_intensity_chk
      CHECK (control_intensity IN ('full', 'light', 'paused'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_contact_pivot_directed_intensity_chk') THEN
    ALTER TABLE public.owner_contact_pivot
      ADD CONSTRAINT owner_contact_pivot_directed_intensity_chk
      CHECK (directed_intensity IS NULL OR directed_intensity IN ('full', 'light'));
  END IF;
END $ck$;

-- The single feedback re-ranker (extended). Reproduces the Slice-2 body verbatim
-- and ADDS the `handoff`/`directed` lane (Unit 3). kinds:
--   referral           {to_name,[to_entity_id]} -> pivot CONTROL to the named person
--   handoff|directed   {to_name,[to_entity_id],[intensity]} -> add a DIRECTED contact,
--                        lighten (NOT drop) the control cadence; control anchor unchanged
--   clear_direction                              -> drop the directed contact, control full
--   no_response                                  -> move DOWN the bench (next untried)
--   bounce|wrong_person                          -> demote current + pivot to next
--   two_way|positive                             -> LOCK current (engaged; human takes over)
--   recurrence                                   -> set recurrence_locked on current
-- Every change appends pivot_history {at,kind,reason,source,from,to}. Reversible.
CREATE OR REPLACE FUNCTION public.lcc_apply_contact_feedback(
  p_entity_id uuid, p_kind text, p_detail jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT 'manual')
RETURNS jsonb AS $fn$
DECLARE
  v_row     public.owner_contact_pivot;
  v_cur     text;
  v_new     text;
  v_new_eid uuid;
  v_reason  text;
  v_status  text;
  v_reclock boolean;
  v_consumed jsonb;
  v_demoted  jsonb;
  v_bench    jsonb;
  v_cand     jsonb;
  v_meta     jsonb;
  -- Unit 3 directed lane
  v_dir_name text;
  v_dir_eid  uuid;
  v_dir_role text;
  v_ctrl_int text;
  v_dir_int  text;
BEGIN
  v_row := public.lcc_ensure_owner_pivot(p_entity_id);
  IF v_row.entity_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_owner_pivot');
  END IF;
  v_cur := v_row.active_contact_name;
  v_status := v_row.status;
  v_reclock := v_row.recurrence_locked;
  v_consumed := v_row.consumed;
  v_demoted := v_row.demoted;
  v_bench := v_row.bench;
  v_new := v_cur; v_new_eid := v_row.active_contact_entity_id;
  -- directed lane carried unchanged unless a handoff/clear kind touches it
  v_dir_name := v_row.directed_contact_name;
  v_dir_eid  := v_row.directed_contact_entity_id;
  v_dir_role := v_row.directed_contact_role;
  v_ctrl_int := COALESCE(v_row.control_intensity, 'full');
  v_dir_int  := v_row.directed_intensity;

  IF p_kind = 'referral' THEN
    v_new := btrim(p_detail->>'to_name');
    IF v_new IS NULL OR v_new = '' THEN RETURN jsonb_build_object('ok',false,'reason','referral_needs_to_name'); END IF;
    v_new_eid := NULLIF(p_detail->>'to_entity_id','')::uuid;
    -- add to bench front if not present
    IF NOT (v_bench @> jsonb_build_array(jsonb_build_object('name', v_new))) AND
       NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_bench) e WHERE lower(e->>'name')=lower(v_new)) THEN
      v_bench := jsonb_build_array(jsonb_build_object(
        'name', v_new, 'role', 'referred', 'authority', 1, 'source', 'referral',
        'is_named_individual', public.lcc_looks_like_person(v_new), 'n_props', 1,
        'contact_entity_id', v_new_eid)) || v_bench;
    END IF;
    v_reason := 'referral_to_' || v_new; v_status := 'active';

  ELSIF p_kind IN ('handoff', 'directed') THEN
    -- Lane 2 (experience/direction): who to call NEXT, without changing control.
    v_dir_name := btrim(p_detail->>'to_name');
    IF v_dir_name IS NULL OR v_dir_name = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'handoff_needs_to_name');
    END IF;
    v_dir_eid  := NULLIF(p_detail->>'to_entity_id', '')::uuid;
    v_dir_role := COALESCE(NULLIF(btrim(p_detail->>'role'), ''), 'directed');
    v_dir_int  := 'full';
    -- Lighten (do NOT drop) the control cadence — keep prospecting the
    -- decision-maker lighter, focus on the directed person. A locked
    -- (engaged) control contact stays full.
    IF v_status <> 'locked' THEN v_ctrl_int := 'light'; END IF;
    v_reason := 'directed_to_' || v_dir_name;
    -- control anchor (active_contact_*) intentionally unchanged
    v_new := v_cur; v_new_eid := v_row.active_contact_entity_id;

  ELSIF p_kind = 'clear_direction' THEN
    v_dir_name := NULL; v_dir_eid := NULL; v_dir_role := NULL; v_dir_int := NULL;
    v_ctrl_int := 'full';
    v_reason := 'direction_cleared';
    v_new := v_cur; v_new_eid := v_row.active_contact_entity_id;

  ELSIF p_kind IN ('two_way','positive') THEN
    v_status := 'locked'; v_reason := 'engaged_two_way';
    v_ctrl_int := 'full';

  ELSIF p_kind = 'recurrence' THEN
    v_reclock := true; v_reason := 'cross_property_recurrence';

  ELSIF p_kind IN ('no_response','bounce','wrong_person') THEN
    IF v_status = 'locked' THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'reason', 'locked_engaged', 'active', v_cur);
    END IF;
    IF p_kind = 'no_response' THEN
      v_consumed := v_consumed || to_jsonb(coalesce(v_cur,''));
      v_reason := 'no_response_advance';
    ELSE
      v_demoted := v_demoted || to_jsonb(coalesce(v_cur,''));
      v_reason := 'bounce_demote';
    END IF;
    -- next bench candidate not consumed and not demoted (and not current)
    SELECT e INTO v_cand
    FROM jsonb_array_elements(v_bench) WITH ORDINALITY t(e, ord)
    WHERE lower(e->>'name') <> lower(coalesce(v_cur,''))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_consumed) c WHERE lower(c)=lower(e->>'name'))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_demoted) d WHERE lower(d)=lower(e->>'name'))
    ORDER BY ord LIMIT 1;
    IF v_cand IS NULL THEN
      v_new := NULL; v_new_eid := NULL; v_status := 'exhausted';
    ELSE
      v_new := v_cand->>'name'; v_new_eid := NULLIF(v_cand->>'contact_entity_id','')::uuid;
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_kind', 'kind', p_kind);
  END IF;

  v_meta := jsonb_build_object('at', now(), 'kind', p_kind, 'reason', v_reason,
              'source', p_source, 'from', v_cur, 'to',
              CASE WHEN p_kind IN ('handoff','directed') THEN v_dir_name ELSE v_new END);

  UPDATE public.owner_contact_pivot SET
    active_contact_name = v_new,
    active_contact_entity_id = v_new_eid,
    status = v_status,
    recurrence_locked = v_reclock,
    consumed = v_consumed,
    demoted = v_demoted,
    bench = v_bench,
    directed_contact_name = v_dir_name,
    directed_contact_entity_id = v_dir_eid,
    directed_contact_role = v_dir_role,
    control_intensity = v_ctrl_int,
    directed_intensity = v_dir_int,
    enrichment_action = CASE WHEN v_new IS NULL THEN enrichment_action ELSE NULL END,
    pivot_history = pivot_history || v_meta,
    updated_at = now()
  WHERE entity_id = p_entity_id;

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'reason', v_reason,
           'active', v_new, 'status', v_status, 'recurrence_locked', v_reclock,
           'directed', v_dir_name, 'control_intensity', v_ctrl_int);
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_apply_contact_feedback(uuid,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_apply_contact_feedback(uuid,text,jsonb,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Unit 2 — org-archetype role model. Extends v_owner_archetype
-- (institutional/local) into a role-selection policy:
--   individual_led  — a small LLC / founder-led owner: the managing member /
--                     signer / notice individual IS the target (usually one
--                     person across SOS + deed + notice). Prospect directly.
--   role_separated  — a REIT / institution with functional teams: model roles.
--                     SELLER work targets disposition / broker-selection (asset
--                     mgmt / capital markets); BUYER work targets acquisition.
-- Appends role_model + target_role_seller/_buyer (append-only; existing columns
-- + order preserved so downstream consumers are unaffected).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_owner_archetype
WITH (security_invoker = true) AS
WITH base AS (
  SELECT c.entity_id, c.owner_name, c.rank_value, c.primary_domain,
         c.sf_account_id, c.has_person_contact,
         s.true_owner_name AS sponsor, public.lcc_institution_norm(s.true_owner_name) AS sponsor_norm
  FROM public.v_lcc_owner_reconcile_candidates c
  LEFT JOIN LATERAL (
    SELECT pof.true_owner_name
    FROM public.lcc_entity_portfolio_facts pf
    JOIN public.lcc_property_owner_facts pof
      ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
    WHERE pf.entity_id = c.entity_id AND pf.is_current = true AND pof.true_owner_name IS NOT NULL
    LIMIT 1
  ) s ON true
),
classified AS (
  SELECT b.*,
    (CASE WHEN b.sponsor_norm IS NOT NULL
           AND NOT public.lcc_is_operator_owner_name(b.sponsor)
           AND b.sponsor_norm <> public.lcc_institution_norm(b.owner_name)
          THEN 'institutional' ELSE 'local' END) AS owner_archetype_c,
    EXISTS (SELECT 1 FROM public.lcc_institution_contacts ic
             WHERE ic.is_active AND ic.institution_norm = b.sponsor_norm) AS has_registry_contact_c
  FROM base b
)
SELECT
  c.entity_id, c.owner_name, c.rank_value, c.primary_domain,
  c.sponsor AS sponsor_institution, c.sponsor_norm,
  c.owner_archetype_c AS owner_archetype,
  c.has_registry_contact_c AS has_registry_contact,
  -- role_model: role_separated when institutional AND the sponsor looks like a
  -- public REIT / insurer / institutional investor (functional teams); else the
  -- owner is founder/individual-led — the managing member IS the target.
  (CASE WHEN c.owner_archetype_c = 'institutional'
         AND ( public.lcc_is_public_company_name(c.sponsor)
               OR c.sponsor ~* '\m(REIT|real estate investment trust|capital|advisors|advisers|asset management|investment management|investments?|financial|bancorp|bank|insurance|mutual|securities|equities|pension|endowment|sovereign|trust company)\M' )
        THEN 'role_separated' ELSE 'individual_led' END) AS role_model,
  (CASE WHEN c.owner_archetype_c = 'institutional'
         AND ( public.lcc_is_public_company_name(c.sponsor)
               OR c.sponsor ~* '\m(REIT|real estate investment trust|capital|advisors|advisers|asset management|investment management|investments?|financial|bancorp|bank|insurance|mutual|securities|equities|pension|endowment|sovereign|trust company)\M' )
        THEN 'disposition' ELSE 'controlling_individual' END) AS target_role_seller,
  (CASE WHEN c.owner_archetype_c = 'institutional'
         AND ( public.lcc_is_public_company_name(c.sponsor)
               OR c.sponsor ~* '\m(REIT|real estate investment trust|capital|advisors|advisers|asset management|investment management|investments?|financial|bancorp|bank|insurance|mutual|securities|equities|pension|endowment|sovereign|trust company)\M' )
        THEN 'acquisition' ELSE 'controlling_individual' END) AS target_role_buyer
FROM classified c;

GRANT SELECT ON public.v_owner_archetype TO authenticated;
COMMENT ON VIEW public.v_owner_archetype IS
  'Per contactless valued owner: institutional/local + a role_model '
  '(individual_led = the managing member/signer is the target; role_separated = '
  'model functional roles). target_role_seller (disposition / broker-selection) '
  'and target_role_buyer (acquisition) guide which role to target by prospect '
  'mode (Unit 2). Read-only.';

-- ---------------------------------------------------------------------------
-- Unit 4 — buyer vs seller prospect mode + resonant touch theme.
--   buyer  — a registered repeat-buyer parent / SPE (R5): prospected via ongoing
--            listing marketing (buy-side), NOT the seller cadence. touch_theme
--            'value_early_access' (early product access / off-market look).
--   seller — everyone else: the seller cadence. touch_theme 'location_bluesuit'
--            ("you own this, I sell this" — tenant/asset-type + a comparable we
--            closed/listed), always leading with value / non-public info.
-- Read-only, additive. Mirrors the JS `prospectMode`/`touchTheme` in
-- api/_shared/contact-authority.js.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_owner_prospect_mode
WITH (security_invoker = true) AS
SELECT
  e.id AS entity_id, e.name AS owner_name, e.workspace_id,
  (spe.entity_id IS NOT NULL OR bp.parent_entity_id IS NOT NULL) AS is_buyer,
  CASE WHEN spe.entity_id IS NOT NULL OR bp.parent_entity_id IS NOT NULL
       THEN 'buyer' ELSE 'seller' END AS prospect_mode,
  CASE WHEN spe.entity_id IS NOT NULL OR bp.parent_entity_id IS NOT NULL
       THEN 'value_early_access' ELSE 'location_bluesuit' END AS touch_theme
FROM public.entities e
LEFT JOIN public.lcc_buyer_spe_resolved spe ON spe.entity_id = e.id
LEFT JOIN public.lcc_buyer_parents bp ON bp.parent_entity_id = e.id
WHERE e.merged_into_entity_id IS NULL
  AND e.entity_type IN ('organization', 'person')
  AND NOT public.lcc_is_operator_owner_name(e.name)
  AND COALESCE((e.metadata->>'junk_name_flagged')::boolean, false) = false;

GRANT SELECT ON public.v_owner_prospect_mode TO authenticated;
COMMENT ON VIEW public.v_owner_prospect_mode IS
  'Unit 4: buyer (R5 repeat-buyer parent / SPE → buy-side listing marketing) vs '
  'seller (seller cadence). touch_theme drives resonant, value-first content: '
  'buyer=value_early_access, seller=location_bluesuit. Read-only.';

COMMIT;
