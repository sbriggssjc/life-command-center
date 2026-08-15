-- ============================================================================
-- BREAK-1 / Prompt 111 — owner-contact propagation: ledger, review lane,
-- provenance ladder, and a re-runnable reachability measurement view.
--
-- WHY (grounded live 2026-08-15, LCC Opps xengecqvemvfknjvbvrq):
--   690 owner entities are reachable from a dia/gov asset via lcc_property_owner.
--   Only 104 have any contact route, and only 56 have the route the owner
--   panel's hero actually reads (entities.email/phone or a unified_contacts row
--   ON the entity). 586 are unreachable; 585 of those have NO person known at
--   all — so this is DECISION-MAKER DISCOVERY, not contact-detail enrichment.
--   The dia/gov `contacts` tables already carry OWNER-BOUND rows (bound by
--   recorded_owner_id / true_owner_id) whose name is, in the dominant case, the
--   owner's OWN name with a switchboard phone/email. This migration is the
--   durable, reversible substrate for propagating those into the entity graph.
--
-- DISCIPLINE: additive · fill-blanks-only · conservative/unambiguous (ambiguity
-- → the review lane, never guessed) · provenance-tagged · reversible via a
-- batch tag · idempotent · dry-run-default (enforced in the worker).
--
-- REVERSAL RUNBOOK (undo one batch, exactly):
--   -- 1. restore every field this batch filled back to its pre-write value
--   UPDATE public.entities e
--      SET email = CASE WHEN l.field_name = 'email' THEN l.old_value ELSE e.email END,
--          phone = CASE WHEN l.field_name = 'phone' THEN l.old_value ELSE e.phone END
--     FROM public.lcc_owner_contact_propagate_log l
--    WHERE e.id = l.owner_entity_id
--      AND l.batch_tag = '<TAG>'
--      AND l.reverted_at IS NULL
--      -- only revert what we actually wrote (a later curated edit wins)
--      AND ( (l.field_name = 'email' AND e.email IS NOT DISTINCT FROM l.new_value)
--         OR (l.field_name = 'phone' AND e.phone IS NOT DISTINCT FROM l.new_value) );
--   UPDATE public.lcc_owner_contact_propagate_log
--      SET reverted_at = now() WHERE batch_tag = '<TAG>' AND reverted_at IS NULL;
--   -- 2. withdraw that batch's open review proposals
--   UPDATE public.lcc_owner_contact_propagate_review
--      SET status = 'withdrawn', updated_at = now()
--    WHERE batch_tag = '<TAG>' AND status = 'pending';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ledger — one row per FIELD written. old_value is what makes it reversible.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_owner_contact_propagate_log (
  log_id            bigserial PRIMARY KEY,
  batch_tag         text        NOT NULL,
  owner_entity_id   uuid        NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  owner_name        text,
  field_name        text        NOT NULL CHECK (field_name IN ('email', 'phone')),
  old_value         text,                  -- always NULL/blank (fill-blanks only)
  new_value         text        NOT NULL,
  source_domain     text        NOT NULL CHECK (source_domain IN ('dia', 'gov')),
  source_table      text        NOT NULL DEFAULT 'contacts',
  source_contact_id text,
  source_bound_by   text,                  -- recorded_owner | true_owner
  contact_name      text,
  match_how         text,                  -- core_exact | similarity
  match_score       numeric,
  rank_value        numeric,               -- owner portfolio value at emission
  reverted_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_owner_contact_propagate_log IS
  'BREAK-1: append-only ledger of owner-entity contact fields filled from an owner-bound domain contact. old_value makes each write individually reversible; batch_tag reverses a run.';

-- Idempotence: the same (owner, field, batch) is never written twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_contact_propagate_log_owner_field_batch
  ON public.lcc_owner_contact_propagate_log (owner_entity_id, field_name, batch_tag);
CREATE INDEX IF NOT EXISTS idx_owner_contact_propagate_log_batch
  ON public.lcc_owner_contact_propagate_log (batch_tag) WHERE reverted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Review lane — every candidate we refused to auto-attribute, with its
--    reason and VERBATIM evidence. Nothing is dropped silently.
--    `name_mismatch` is the interesting class: a real named party (manager,
--    signatory, SF contact) that must NOT be stamped onto the owner ORG record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_owner_contact_propagate_review (
  review_id         bigserial PRIMARY KEY,
  subject_ref       text        NOT NULL,   -- ocp:<owner_entity_id>:<domain>:<contact_id>
  batch_tag         text        NOT NULL,
  owner_entity_id   uuid        NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  owner_name        text,
  source_domain     text        NOT NULL CHECK (source_domain IN ('dia', 'gov')),
  source_contact_id text,
  source_bound_by   text,
  contact_name      text,
  contact_email     text,
  contact_phone     text,
  contact_type      text,
  data_source       text,
  reason            text        NOT NULL,   -- name_mismatch | misparse_name | contact_fanout
  evidence          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  rank_value        numeric,
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'rejected', 'withdrawn')),
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_owner_contact_propagate_review IS
  'BREAK-1: candidates the propagation worker refused to auto-apply. reason=name_mismatch is a differently-named real party (likely the decision-maker) that needs the person+edge model, not a write onto the owner org record.';

-- Idempotent re-seed: one open proposal per (owner, contact) pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_contact_propagate_review_subject
  ON public.lcc_owner_contact_propagate_review (subject_ref);
CREATE INDEX IF NOT EXISTS idx_owner_contact_propagate_review_pending
  ON public.lcc_owner_contact_propagate_review (status, rank_value DESC NULLS LAST)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_owner_contact_propagate_review_touch
  ON public.lcc_owner_contact_propagate_review;
CREATE OR REPLACE FUNCTION public.lcc_owner_contact_propagate_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_owner_contact_propagate_review_touch
  BEFORE UPDATE ON public.lcc_owner_contact_propagate_review
  FOR EACH ROW EXECUTE FUNCTION public.lcc_owner_contact_propagate_review_touch();

-- ---------------------------------------------------------------------------
-- 3. Provenance ladder for entities.email / entities.phone.
--    These fields had NO field_source_priority rows at all, so ANY writer to
--    them was already invisible to v_field_provenance_unranked. Registering the
--    ladder is required by the CLAUDE.md provenance doctrine before adding a
--    new writer, and retro-covers the writers that were already there.
--    Lower priority = higher trust. domain_owner_contact sits below Salesforce
--    (a CRM-curated contact outranks a captured one) and above the raw
--    aggregator captures it is ultimately derived from — it is better than a
--    bare sidebar row because it is OWNER-BOUND and NAME-MATCHED.
-- ---------------------------------------------------------------------------
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  ('entities', 'email', 'manual_edit',           1,  'record_only', 'Operator edit — always wins.'),
  ('entities', 'email', 'manual_resolution',     1,  'record_only', 'Operator verdict in a review lane.'),
  ('entities', 'email', 'salesforce',            20, 'record_only', 'CRM-curated contact detail.'),
  ('entities', 'email', 'domain_owner_contact',  55, 'record_only', 'BREAK-1: owner-bound, name-matched dia/gov contacts row.'),
  ('entities', 'email', 'costar_sidebar',        60, 'record_only', 'Aggregator capture.'),
  ('entities', 'phone', 'manual_edit',           1,  'record_only', 'Operator edit — always wins.'),
  ('entities', 'phone', 'manual_resolution',     1,  'record_only', 'Operator verdict in a review lane.'),
  ('entities', 'phone', 'salesforce',            20, 'record_only', 'CRM-curated contact detail.'),
  ('entities', 'phone', 'domain_owner_contact',  55, 'record_only', 'BREAK-1: owner-bound, name-matched dia/gov contacts row.'),
  ('entities', 'phone', 'costar_sidebar',        60, 'record_only', 'Aggregator capture.')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The measurement view. panel-redesign-verification.md §3.2 carried this as
--    loose SQL, so every re-measure retyped it and the "reachable" definition
--    drifted from what the UI actually reads. One view, three honest columns:
--
--      reachable_hero  — what the owner panel hero reads TODAY
--                        (entities.email/phone, or a unified_contacts row whose
--                        entity_id IS this owner). This is the number that
--                        decides "Find a contact" vs an actionable next step.
--      reachable_graph — hero routes PLUS a linked person entity carrying
--                        email/phone. Strictly wider; the gap between the two
--                        is owners we CAN reach but the hero cannot see.
--
--    Keeping both stops the classic overstatement of quoting the graph number
--    while the operator experiences the hero number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_owner_reachability AS
WITH assets AS (
  SELECT id FROM public.entities WHERE domain IN ('dia', 'gov') AND entity_type = 'asset'
),
owners AS (
  SELECT DISTINCT po.owner_entity_id AS owner_entity_id
    FROM public.lcc_property_owner po
    JOIN assets a ON a.id = po.entity_id
   WHERE po.owner_entity_id IS NOT NULL
),
via_org AS (
  SELECT o.owner_entity_id FROM owners o
    JOIN public.entities e ON e.id = o.owner_entity_id
   WHERE COALESCE(NULLIF(btrim(e.email), ''), NULLIF(btrim(e.phone), '')) IS NOT NULL
),
via_uc AS (
  SELECT DISTINCT o.owner_entity_id FROM owners o
    JOIN public.unified_contacts uc ON uc.entity_id = o.owner_entity_id
   WHERE NULLIF(btrim(uc.email), '') IS NOT NULL
),
via_person AS (
  SELECT DISTINCT o.owner_entity_id FROM owners o
    JOIN public.entity_relationships r
      ON (r.to_entity_id = o.owner_entity_id OR r.from_entity_id = o.owner_entity_id)
    JOIN public.entities p
      ON p.id = CASE WHEN r.to_entity_id = o.owner_entity_id THEN r.from_entity_id ELSE r.to_entity_id END
   WHERE p.entity_type = 'person'
     AND COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(p.phone), '')) IS NOT NULL
)
SELECT
  (SELECT count(*) FROM assets)                                             AS assets,
  (SELECT count(*) FROM public.lcc_property_owner po JOIN assets a ON a.id = po.entity_id
    WHERE po.owner_entity_id IS NOT NULL)                                   AS assets_with_owner,
  (SELECT count(*) FROM owners)                                             AS owner_entities,
  (SELECT count(*) FROM via_org)                                            AS via_org,
  (SELECT count(*) FROM via_uc)                                             AS via_unified_contact,
  (SELECT count(*) FROM via_person)                                         AS via_linked_person,
  (SELECT count(*) FROM (SELECT owner_entity_id FROM via_org
                         UNION SELECT owner_entity_id FROM via_uc) x)       AS reachable_hero,
  (SELECT count(*) FROM (SELECT owner_entity_id FROM via_org
                         UNION SELECT owner_entity_id FROM via_uc
                         UNION SELECT owner_entity_id FROM via_person) x)   AS reachable_graph;

COMMENT ON VIEW public.v_lcc_owner_reachability IS
  'BREAK-1 measurement. reachable_hero = what the owner panel hero reads (entities.email/phone or a unified_contacts row on the entity). reachable_graph additionally counts a linked person carrying contact detail. Quote reachable_hero when describing operator experience.';

-- The unreachable worklist, value-ranked — the population the worker drains and
-- the surface any future feeder should be measured against.
CREATE OR REPLACE VIEW public.v_lcc_owner_unreachable_worklist AS
WITH assets AS (
  SELECT id FROM public.entities WHERE domain IN ('dia', 'gov') AND entity_type = 'asset'
),
owners AS (
  SELECT DISTINCT po.owner_entity_id AS owner_entity_id
    FROM public.lcc_property_owner po
    JOIN assets a ON a.id = po.entity_id
   WHERE po.owner_entity_id IS NOT NULL
),
reachable AS (
  SELECT o.owner_entity_id FROM owners o
    JOIN public.entities e ON e.id = o.owner_entity_id
   WHERE COALESCE(NULLIF(btrim(e.email), ''), NULLIF(btrim(e.phone), '')) IS NOT NULL
  UNION
  SELECT DISTINCT o.owner_entity_id FROM owners o
    JOIN public.unified_contacts uc ON uc.entity_id = o.owner_entity_id
   WHERE NULLIF(btrim(uc.email), '') IS NOT NULL
)
-- rank_value = the SAME portfolio figure the R63 BD value floor reads
-- (v_entity_portfolio_all.current_annual_rent_total), so the worker's ranking
-- and entityHasBdSignal's gate cannot drift apart.
SELECT e.id                                          AS owner_entity_id,
       e.name                                        AS owner_name,
       e.domain                                      AS owner_domain,
       COALESCE(pf.current_annual_rent_total, 0)::numeric AS rank_value,
       COALESCE(pf.current_property_count, 0)        AS asset_count
  FROM owners o
  JOIN public.entities e ON e.id = o.owner_entity_id
  LEFT JOIN public.v_entity_portfolio_all pf ON pf.entity_id = o.owner_entity_id
 WHERE o.owner_entity_id NOT IN (SELECT owner_entity_id FROM reachable);

COMMENT ON VIEW public.v_lcc_owner_unreachable_worklist IS
  'BREAK-1: property-resolved owner entities the panel hero cannot reach, value-ranked. The propagation worker''s population and the yardstick for any owner-contact feeder.';

GRANT SELECT ON public.v_lcc_owner_reachability          TO anon, authenticated, service_role;
GRANT SELECT ON public.v_lcc_owner_unreachable_worklist  TO anon, authenticated, service_role;
