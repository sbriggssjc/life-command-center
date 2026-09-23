-- ============================================================================
-- GOV-UX1-D5-gate (2026-09-23) — the tightened seller-lead gate, its review
-- lane's decision ledger, the precision meter, and the auto-create switch.
--
-- Scott, Q48 (2026-09-23): "automate as much as possible but the overall
-- objective is getting to accuracy and action." Hybrid: a TIGHT gate feeds a
-- one-click review lane; every Create / Not-a-lead decision is recorded; auto-
-- create unlocks only when those decisions prove the gate (>= 90% over the last
-- 25) AND the SELLER_LEAD_AUTOCREATE flag is on (default OFF).
--
-- ONE DEFINITION. This view carries every gate condition as its own column and
-- does NOT decide; `api/_shared/seller-lead-gate.js::evaluateSellerLeadGate` is
-- the single place the conditions are combined (it adds the JS owner-name guards
-- isJunkEntityName / isStreetFragmentName and the P164 isOwnerNameRestated
-- check, which have no SQL twin). The lane and the auto-create tick both call it.
--
-- Measured live before building (LCC Opps, 2026-09-23):
--   queue reason_measured ∧ has_linked_person ∧ no open opp = 54 owners;
--   linked-person roles: works_at only 28, parent_of only 1 → out.
--   With a decision-maker role (this file's lcc_is_seller_lead_decision_role):
--   26 owners; − 1 open opp (NGP Capital) − 5 repeat buyers (Elliott Bay,
--   UIRC, Exchangeright, Realty Income, Capital Square) = 20; − FD Stonewater
--   (its only DM person "Fd Stonewater" is the owner's own name, P164) = 19.
--
-- Does NOT touch v_lcc_seller_prospect_queue, bd_opportunity_auto_seed_cadence,
-- or any gov object. Writes nothing to leads: bridgeCreateLead stays the only
-- lead writer (test/gov-ux1-d5-gate.test.mjs asserts it).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The decision-maker role rule (P161, stricter): a person link counts only
--    when its role is NOT a weak association (lcc_is_weak_association_role —
--    works_at / associated_with / contact / absent), NOT a structural edge
--    (parent_of / child_of / subsidiary_of — org-to-org shapes, never a human's
--    authority), and NOT a non-reachable role. The non-reachable list MIRRORS
--    NON_REACHABLE_ROLES in api/_shared/owner-reachable-via.js; the test suite
--    compares the two lists so they cannot drift.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_is_seller_lead_decision_role(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NOT public.lcc_is_weak_association_role(p_role)
     AND lower(btrim(coalesce(p_role, ''))) NOT IN (
           -- structural org edges
           'parent_of', 'child_of', 'subsidiary_of',
           -- NON_REACHABLE_ROLES (owner-reachable-via.js)
           'broker', 'broker_of_record', 'listing_broker', 'purchasing_broker',
           'l_broker', 'p_broker', 'agent', 'tenant', 'operator')
$function$;

-- ----------------------------------------------------------------------------
-- 2. The decision ledger. One row per Create / Not-a-lead verdict (lane) and
--    per automated create (auto). Reversible: reversed_at, never a delete.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_seller_lead_gate_decision (
  id                  bigserial PRIMARY KEY,
  workspace_id        uuid,
  entity_id           uuid NOT NULL,
  owner_name          text,
  source_domain       text,
  source_property_id  text,
  decision            text NOT NULL CHECK (decision IN ('create', 'reject')),
  reason              text,
  decided_via         text NOT NULL CHECK (decided_via IN ('lane', 'auto')),
  decided_by          uuid,
  lead_id             text,
  bd_opportunity_id   uuid,
  batch_tag           text,
  gate_snapshot       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  reversed_at         timestamptz,
  reversed_by         uuid,
  reversed_note       text,
  -- The reject picklist. MIRRORS SELLER_LEAD_REJECT_REASONS in
  -- api/_shared/seller-lead-gate.js (the test compares the two).
  CONSTRAINT chk_seller_lead_reject_reason CHECK (
    decision <> 'reject' OR reason IN (
      'not_a_seller', 'bank_or_lender', 'tenant_or_operator', 'repeat_buyer_or_reit',
      'wrong_or_weak_contact', 'address_or_junk_name', 'already_working_it', 'other'))
);

-- Idempotency: at most ONE live (unreversed) decision per owner per workspace.
-- A double click / re-run tick hits this index and is a no-op, never a second
-- decision (or a second counted "create" in the precision meter).
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_lead_gate_decision_live
  ON public.lcc_seller_lead_gate_decision (workspace_id, entity_id)
  WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_seller_lead_gate_decision_recent
  ON public.lcc_seller_lead_gate_decision (decided_via, created_at DESC);

ALTER TABLE public.lcc_seller_lead_gate_decision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lcc_seller_lead_gate_decision FROM public, anon, authenticated;
REVOKE ALL ON SEQUENCE public.lcc_seller_lead_gate_decision_id_seq FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. The gate candidates, owner grain (a lead is created per OWNER, written at
--    that owner's highest-value property — the grain bridgeCreateLead writes
--    at). Every condition is a column; nothing is filtered here except the
--    queue's own reason_measured, so the funnel is reportable.
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_lcc_seller_lead_gate_candidates;
CREATE VIEW public.v_lcc_seller_lead_gate_candidates
WITH (security_invoker = on) AS
WITH q AS (
  SELECT * FROM public.v_lcc_seller_prospect_queue WHERE reason_measured
),
top_prop AS (
  SELECT DISTINCT ON (q.entity_id)
         q.entity_id, q.workspace_id, q.owner_name, q.source_domain, q.source_property_id,
         q.address, q.city, q.state, q.reason_to_sell, q.reason_measured
    FROM q
   ORDER BY q.entity_id, q.rank_value DESC NULLS LAST, q.source_property_id
),
agg AS (
  SELECT q.entity_id, count(*) AS property_count, max(q.rank_value) AS rank_value
    FROM q GROUP BY q.entity_id
),
people AS (
  SELECT o.entity_id,
         pe.id   AS person_id,
         pe.name AS person_name,
         lower(btrim(coalesce(r.metadata->>'role', ''))) AS role
    FROM top_prop o
    JOIN public.entity_relationships r
      ON (r.from_entity_id = o.entity_id OR r.to_entity_id = o.entity_id)
    JOIN public.entities pe
      ON pe.id = CASE WHEN r.from_entity_id = o.entity_id THEN r.to_entity_id ELSE r.from_entity_id END
     AND pe.entity_type = 'person'
     AND pe.merged_into_entity_id IS NULL
),
dm AS (
  SELECT entity_id,
         jsonb_agg(DISTINCT jsonb_build_object('person_id', person_id, 'name', person_name, 'role', role)) AS dm_people
    FROM people
   WHERE public.lcc_is_seller_lead_decision_role(role)
     AND NOT public.lcc_owner_name_is_junk(person_name)
   GROUP BY entity_id
),
roles AS (
  SELECT entity_id, string_agg(DISTINCT nullif(role, ''), ',' ORDER BY nullif(role, '')) AS linked_roles
    FROM people GROUP BY entity_id
),
dec AS (
  SELECT DISTINCT ON (d.entity_id) d.entity_id, d.decision, d.decided_via, d.reason
    FROM public.lcc_seller_lead_gate_decision d
   WHERE d.reversed_at IS NULL
      -- a REVERSED auto-create is itself a "no": the operator undid it.
      OR (d.decided_via = 'auto' AND d.decision = 'create')
   ORDER BY d.entity_id, d.created_at DESC
)
SELECT t.entity_id,
       t.workspace_id,
       t.owner_name,
       t.source_domain,
       t.source_property_id,
       t.address,
       t.city,
       t.state,
       a.property_count,
       a.rank_value,
       t.reason_to_sell,
       t.reason_measured,
       coalesce(dm.dm_people, '[]'::jsonb)                               AS dm_people,
       ro.linked_roles,
       public.lcc_owner_name_is_junk(t.owner_name)                       AS owner_name_sql_junk,
       bp.parent_name                                                    AS repeat_buyer_parent,
       EXISTS (SELECT 1 FROM public.bd_opportunities b
                WHERE b.entity_id = t.entity_id AND b.is_open)            AS has_open_opportunity,
       public.lcc_cadence_point_person(t.entity_id)                      AS point_person_user_id,
       dec.decision                                                      AS prior_decision,
       dec.decided_via                                                   AS prior_decided_via,
       dec.reason                                                        AS prior_reason
  FROM top_prop t
  JOIN agg a USING (entity_id)
  LEFT JOIN dm USING (entity_id)
  LEFT JOIN roles ro USING (entity_id)
  LEFT JOIN dec USING (entity_id)
  LEFT JOIN LATERAL (SELECT parent_name FROM public.lcc_resolve_buyer_parent(t.entity_id) LIMIT 1) bp ON true;

REVOKE ALL ON public.v_lcc_seller_lead_gate_candidates FROM public, anon, authenticated;
GRANT SELECT ON public.v_lcc_seller_lead_gate_candidates TO service_role;

-- ----------------------------------------------------------------------------
-- 4. The precision meter. LANE decisions only — an automated create cannot
--    grade the gate that made it. Window and threshold live HERE, once.
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_lcc_seller_lead_gate_precision;
CREATE VIEW public.v_lcc_seller_lead_gate_precision
WITH (security_invoker = on) AS
WITH w AS (
  SELECT decision
    FROM public.lcc_seller_lead_gate_decision
   WHERE decided_via = 'lane' AND reversed_at IS NULL
   ORDER BY created_at DESC
   LIMIT 25
)
SELECT 25::int                                          AS window_size,
       0.90::numeric                                    AS precision_threshold,
       count(*)::int                                    AS decided,
       count(*) FILTER (WHERE decision = 'create')::int AS creates,
       count(*) FILTER (WHERE decision = 'reject')::int AS rejects,
       CASE WHEN count(*) = 0 THEN NULL
            ELSE round(count(*) FILTER (WHERE decision = 'create')::numeric / count(*), 4) END AS precision,
       (SELECT count(*)::int FROM public.lcc_seller_lead_gate_decision
         WHERE decided_via = 'auto' AND decision = 'create')                       AS auto_created,
       (SELECT count(*)::int FROM public.lcc_seller_lead_gate_decision
         WHERE decided_via = 'auto' AND decision = 'create' AND reversed_at IS NOT NULL) AS auto_reversed
  FROM w;

REVOKE ALL ON public.v_lcc_seller_lead_gate_precision FROM public, anon, authenticated;
GRANT SELECT ON public.v_lcc_seller_lead_gate_precision TO service_role;

-- ----------------------------------------------------------------------------
-- 5. The switch — default OFF.
-- ----------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES ('SELLER_LEAD_AUTOCREATE',
        'GOV-UX1-D5-gate: auto-create prospect leads for owners passing the tightened seller-lead gate.',
        '/api/seller-lead-autocreate-tick (cron lcc-seller-lead-autocreate)',
        'SELLER_LEAD_AUTOCREATE', 'off', now(), 'Scott',
        'Also requires v_lcc_seller_lead_gate_precision >= 0.90 over 25 lane decisions; flag ON alone does nothing. '
        || 'Auto leads are tagged metadata/source seller_lead_autocreate + a batch_tag and reversible via ?action=reverse.')
ON CONFLICT (flag) DO UPDATE SET purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, notes = EXCLUDED.notes;

-- ----------------------------------------------------------------------------
-- 6. The tick's schedule. It no-ops (a named skip in producer_runs) while the
--    flag is off or precision is unproven, so flipping the flag is the ONLY
--    step needed — a flag with no scheduled consumer reads "on" and does
--    nothing, which is the trap this avoids. Weekdays 13:10 UTC.
-- ----------------------------------------------------------------------------
DO $cronblock$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-seller-lead-autocreate') THEN
    PERFORM cron.unschedule('lcc-seller-lead-autocreate');
  END IF;
  PERFORM cron.schedule(
    'lcc-seller-lead-autocreate',
    '10 13 * * 1-5',
    $$SELECT public.lcc_cron_post('/api/seller-lead-autocreate-tick', '{"trigger_source":"cron"}'::jsonb, 'railway');$$
  );
END
$cronblock$;
