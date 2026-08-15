-- ============================================================================
-- Prompt 114 / BREAK-1 Units 1+3 — drain the owner-contact review lane.
--
-- WHY: Prompt 111 shipped the safe auto-fill slice (+36 owners) and routed 101
-- candidates to `lcc_owner_contact_propagate_review` — CORRECTLY, because
-- stamping a person's email onto an owner ORG record is the conflation
-- `sf-account-link.js` guards against. But it shipped that lane with NO CONSUMER
-- SURFACE, which the Consumption-Layer doctrine forbids ("no new producer ships
-- without a named consumer"). This migration is the durable substrate for the
-- consumer: a reversible apply ledger, an actionable-only value-ranked view, and
-- an auto-retire sweep.
--
-- ⚠ GROUNDING CORRECTION carried into the schema. The lane was described as 101
--   candidate decision-makers. Live classification of every pending row
--   (2026-08-15, api/_shared/owner-contact-verdict-planner.js) says:
--       22 person-shaped · 77 organization-shaped · 2 blocked
--   and the organizations split into (a) TRANSACTION COUNTERPARTIES — the buyer
--   or seller of a sale on the owner's property, captured by the CoStar sidebar
--   ("NGP Capital" ← "CoreCivic, Inc.") — which are REJECTS, and (b) SAME-PARTY
--   NAME VARIANTS the strict-core matcher could not see through because the
--   difference is an abbreviation or acronym ("Easterly Gov Properties (REIT)" ↔
--   "Easterly Government Properties, Inc."), which want the ORG fill, not a
--   person edge. A single "confirm" button would therefore write the WRONG SHAPE
--   for the majority of this backlog. Hence three verdicts, and a server-side
--   shape gate that refuses a verdict the candidate cannot legally receive.
--
--     attach_person — mint/resolve a `person` entity, carry the contact detail
--                     onto THAT person, link it to the owner via
--                     entity_relationships. Person-shaped candidates only.
--     same_party    — fill-blanks entities.email/phone on the OWNER itself (the
--                     `fill_org` write Prompt 111 refused to automate, now
--                     human-asserted). Organization-shaped candidates only.
--     reject        — first-class and RECORDED, so the row is never re-proposed.
--
-- DISCIPLINE: additive · fill-blanks-only · reversible by batch tag · idempotent
-- · never hard-deletes · auto-retire when the premise clears.
--
-- REVERSAL RUNBOOK (undo one verdict batch, exactly):
--   -- 1. org fills (verdict=same_party) — restore only what we wrote
--   UPDATE public.entities e
--      SET email = CASE WHEN l.field_name = 'email' THEN l.old_value ELSE e.email END,
--          phone = CASE WHEN l.field_name = 'phone' THEN l.old_value ELSE e.phone END
--     FROM public.lcc_owner_contact_attach_log l
--    WHERE l.batch_tag = '<TAG>' AND l.reverted_at IS NULL
--      AND l.verdict = 'same_party' AND e.id = l.owner_entity_id
--      AND ( (l.field_name = 'email' AND e.email IS NOT DISTINCT FROM l.new_value)
--         OR (l.field_name = 'phone' AND e.phone IS NOT DISTINCT FROM l.new_value) );
--   -- 2. person edges (verdict=attach_person) — drop the edge this batch created.
--   --    The minted person entity is NOT deleted (never hard-delete); it simply
--   --    stops being linked, exactly like the W9.1 contact-acquisition reversal.
--   DELETE FROM public.entity_relationships r
--    USING public.lcc_owner_contact_attach_log l
--    WHERE l.batch_tag = '<TAG>' AND l.reverted_at IS NULL
--      AND l.relationship_created AND r.id = l.relationship_id;
--   -- 3. close the ledger + reopen the proposals
--   UPDATE public.lcc_owner_contact_attach_log SET reverted_at = now()
--    WHERE batch_tag = '<TAG>' AND reverted_at IS NULL;
--   UPDATE public.lcc_owner_contact_propagate_review
--      SET status = 'pending', applied_verdict = NULL, applied_log_id = NULL,
--          decided_by = NULL, decided_at = NULL
--    WHERE review_id IN (SELECT review_id FROM public.lcc_owner_contact_attach_log
--                         WHERE batch_tag = '<TAG>');
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Verdict bookkeeping on the existing review table (additive).
--    `applied_verdict` is what makes a drained lane auditable: "confirmed" alone
--    would not say WHICH shape was written.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_owner_contact_propagate_review
  ADD COLUMN IF NOT EXISTS applied_verdict text,
  ADD COLUMN IF NOT EXISTS applied_log_id   bigint,
  ADD COLUMN IF NOT EXISTS retire_reason    text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.lcc_owner_contact_propagate_review'::regclass
       AND conname  = 'chk_ocp_review_applied_verdict'
  ) THEN
    ALTER TABLE public.lcc_owner_contact_propagate_review
      ADD CONSTRAINT chk_ocp_review_applied_verdict
      CHECK (applied_verdict IS NULL
             OR applied_verdict IN ('attach_person', 'same_party', 'reject'));
  END IF;
END $$;

COMMENT ON COLUMN public.lcc_owner_contact_propagate_review.applied_verdict IS
  'Prompt 114: which SHAPE the human verdict wrote — attach_person (person entity + edge), same_party (fill the owner org contact detail), or reject. A bare status=confirmed cannot express this.';
COMMENT ON COLUMN public.lcc_owner_contact_propagate_review.retire_reason IS
  'Prompt 114: why an auto-retire sweep withdrew this row (its premise cleared), e.g. owner_now_reachable.';

-- ---------------------------------------------------------------------------
-- 2. The apply ledger. One row per EFFECT (a filled field, or a created edge),
--    so every verdict is individually reversible.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_owner_contact_attach_log (
  log_id               bigserial PRIMARY KEY,
  batch_tag            text        NOT NULL,
  review_id            bigint      NOT NULL,
  subject_ref          text        NOT NULL,
  verdict              text        NOT NULL
                       CHECK (verdict IN ('attach_person', 'same_party', 'reject')),
  owner_entity_id      uuid        NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  owner_name           text,
  -- attach_person effects
  person_entity_id     uuid        REFERENCES public.entities(id) ON DELETE SET NULL,
  person_minted        boolean     NOT NULL DEFAULT false,
  relationship_id      uuid,
  relationship_created boolean     NOT NULL DEFAULT false,
  relationship_role    text,
  -- same_party effects (mirrors lcc_owner_contact_propagate_log's shape so the
  -- two ledgers read identically)
  field_name           text        CHECK (field_name IS NULL OR field_name IN ('email', 'phone')),
  old_value            text,
  new_value            text,
  -- provenance
  source_domain        text        CHECK (source_domain IS NULL OR source_domain IN ('dia', 'gov')),
  source_contact_id    text,
  contact_name         text,
  shape                text,
  actor                uuid,
  reverted_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_owner_contact_attach_log IS
  'Prompt 114: append-only ledger of owner-contact review VERDICT effects. One row per effect (field filled / edge created) so a single verdict or a whole batch can be reversed. Reversal runbook in the migration header.';

CREATE INDEX IF NOT EXISTS idx_owner_contact_attach_log_batch
  ON public.lcc_owner_contact_attach_log (batch_tag) WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_owner_contact_attach_log_review
  ON public.lcc_owner_contact_attach_log (review_id);
-- Idempotence: replaying the same verdict for the same review + effect is a
-- no-op rather than a duplicate ledger row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_contact_attach_log_effect
  ON public.lcc_owner_contact_attach_log
     (review_id, verdict, COALESCE(field_name, 'edge'), batch_tag);

-- ---------------------------------------------------------------------------
-- 3. AUTO-RETIRE (Consumption-Layer requirement #2).
--    A proposal whose premise has cleared is closed by a sweep, not left to rot
--    in the operator's count. Two premises can clear:
--      owner_now_reachable  — the owner gained contact detail by ANY other route
--                             (another verdict, a curated edit, the propagation
--                             worker). 7 of the 101 were already in this state
--                             when this shipped.
--      owner_gone           — the owner entity no longer resolves to an asset,
--                             so the panel never routes to it.
--    Reversible: a withdrawn row keeps its evidence and can be set back to
--    pending. NEVER hard-deleted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_owner_contact_review_autoretire(p_dry_run boolean DEFAULT true)
RETURNS TABLE (retire_reason text, n bigint)
LANGUAGE plpgsql AS $$
BEGIN
  CREATE TEMP TABLE _ocp_retire ON COMMIT DROP AS
  WITH assets AS (
    SELECT id FROM public.entities WHERE domain IN ('dia', 'gov') AND entity_type = 'asset'
  ),
  owners AS (
    SELECT DISTINCT po.owner_entity_id AS oid
      FROM public.lcc_property_owner po
      JOIN assets a ON a.id = po.entity_id
     WHERE po.owner_entity_id IS NOT NULL
  ),
  hero AS (
    SELECT o.oid FROM owners o
      JOIN public.entities e ON e.id = o.oid
     WHERE COALESCE(NULLIF(btrim(e.email), ''), NULLIF(btrim(e.phone), '')) IS NOT NULL
    UNION
    SELECT DISTINCT o.oid FROM owners o
      JOIN public.unified_contacts uc ON uc.entity_id = o.oid
     WHERE NULLIF(btrim(uc.email), '') IS NOT NULL
  )
  SELECT r.review_id,
         CASE WHEN r.owner_entity_id NOT IN (SELECT oid FROM owners) THEN 'owner_gone'
              ELSE 'owner_now_reachable' END AS reason
    FROM public.lcc_owner_contact_propagate_review r
   WHERE r.status = 'pending'
     AND (r.owner_entity_id NOT IN (SELECT oid FROM owners)
          OR r.owner_entity_id IN (SELECT oid FROM hero));

  IF NOT p_dry_run THEN
    UPDATE public.lcc_owner_contact_propagate_review r
       SET status = 'withdrawn', retire_reason = t.reason, updated_at = now()
      FROM _ocp_retire t
     WHERE r.review_id = t.review_id AND r.status = 'pending';
  END IF;

  RETURN QUERY SELECT t.reason, count(*)::bigint FROM _ocp_retire t GROUP BY t.reason;
END $$;

COMMENT ON FUNCTION public.lcc_owner_contact_review_autoretire(boolean) IS
  'Prompt 114: closes owner-contact review proposals whose premise cleared (owner became reachable by any other route, or no longer resolves to an asset). Dry-run by default; reversible (status back to pending). Never hard-deletes.';

-- Scheduled sweep. 05:45 UTC — AFTER the owner-contact signal chain
-- (05:00 sync / 05:05 finalize / 05:20 pivot / 05:25 enrich), so a proposal is
-- retired in the same cycle the other pipe makes its owner reachable rather
-- than sitting in the operator's count for a day.
-- Applied live as jobid 224 (2026-08-15). Idempotent: cron.schedule on an
-- existing jobname replaces it.
SELECT cron.schedule('lcc-owner-contact-review-autoretire', '45 5 * * *',
  $cron$SELECT public.lcc_owner_contact_review_autoretire(false)$cron$);

-- ---------------------------------------------------------------------------
-- 4. The actionable-only, value-ranked lane view (Consumption-Layer #3 + #5).
--    Excludes already-retired-eligible rows INLINE so the badge is honest even
--    between sweeps — a count that includes owners you can already reach is
--    exactly the noise-badge failure the doctrine names.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_owner_contact_attach_review_open AS
WITH assets AS (
  SELECT id FROM public.entities WHERE domain IN ('dia', 'gov') AND entity_type = 'asset'
),
owners AS (
  SELECT DISTINCT po.owner_entity_id AS oid
    FROM public.lcc_property_owner po
    JOIN assets a ON a.id = po.entity_id
   WHERE po.owner_entity_id IS NOT NULL
),
hero AS (
  SELECT o.oid FROM owners o
    JOIN public.entities e ON e.id = o.oid
   WHERE COALESCE(NULLIF(btrim(e.email), ''), NULLIF(btrim(e.phone), '')) IS NOT NULL
  UNION
  SELECT DISTINCT o.oid FROM owners o
    JOIN public.unified_contacts uc ON uc.entity_id = o.oid
   WHERE NULLIF(btrim(uc.email), '') IS NOT NULL
)
SELECT r.review_id,
       r.subject_ref,
       r.batch_tag,
       r.owner_entity_id,
       r.owner_name,
       r.source_domain,
       r.source_contact_id,
       r.source_bound_by,
       r.contact_name,
       r.contact_email,
       r.contact_phone,
       r.contact_type,
       r.data_source,
       r.reason,
       r.evidence,
       COALESCE(r.rank_value, 0)::numeric AS rank_value,
       COALESCE(pf.current_property_count, 0) AS asset_count,
       r.created_at
  FROM public.lcc_owner_contact_propagate_review r
  LEFT JOIN public.v_entity_portfolio_all pf ON pf.entity_id = r.owner_entity_id
 WHERE r.status = 'pending'
   AND r.owner_entity_id IN (SELECT oid FROM owners)
   AND r.owner_entity_id NOT IN (SELECT oid FROM hero);

COMMENT ON VIEW public.v_lcc_owner_contact_attach_review_open IS
  'Prompt 114: ACTIONABLE owner-contact review proposals — pending, on an owner that still resolves to a dia/gov asset, and still unreachable by the hero. Owners already reachable are excluded inline so the Decision Center badge counts real work only. Shape classification + verdict eligibility are computed in api/_shared/owner-contact-verdict-planner.js, not here.';

-- ---------------------------------------------------------------------------
-- 5. Reachability measurement — extended, APPEND-ONLY.
--
--    `reachable_hero` keeps its ORIGINAL pre-Prompt-114 definition on purpose:
--    it is the before/after yardstick, and redefining it mid-flight would erase
--    the very comparison this work is measured by. Three columns are APPENDED
--    (CREATE OR REPLACE VIEW is append-only for columns — 42P16 otherwise):
--
--      via_linked_person_selectable — linked people that SURVIVE the resolver's
--        guards. `via_linked_person` counts any linked person with contact
--        detail, including brokers; `pickReachableVia` excludes broker-ish roles
--        outright, so quoting the raw count would overstate what the panel can
--        actually show. This column mirrors the JS exclusion in SQL.
--      reachable_hero_effective — what the hero reads AFTER the Unit-2 fold-in
--        (org routes ∪ selectable linked person). This is the number to quote
--        for operator experience from now on.
--      hero_gap — reachable_hero_effective − reachable_hero. The pure UI defect,
--        and it should trend to the point where the fold-in has fully landed.
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
person_edges AS (
  SELECT o.owner_entity_id,
         lower(btrim(COALESCE(r.metadata->>'role', ''))) AS role
    FROM owners o
    JOIN public.entity_relationships r
      ON (r.to_entity_id = o.owner_entity_id OR r.from_entity_id = o.owner_entity_id)
    JOIN public.entities p
      ON p.id = CASE WHEN r.to_entity_id = o.owner_entity_id THEN r.from_entity_id ELSE r.to_entity_id END
   WHERE p.entity_type = 'person'
     AND COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(p.phone), '')) IS NOT NULL
),
via_person AS (
  SELECT DISTINCT owner_entity_id FROM person_edges
),
-- Mirrors NON_REACHABLE_ROLES in api/_shared/owner-reachable-via.js. Keep the
-- two lists in step: if a role is added there, add it here or the measurement
-- and the panel drift apart (the exact failure Prompt 111 fixed for hero/graph).
via_person_selectable AS (
  SELECT DISTINCT owner_entity_id FROM person_edges
   WHERE role NOT IN ('broker', 'broker_of_record', 'listing_broker', 'purchasing_broker',
                      'l_broker', 'p_broker', 'agent', 'tenant', 'operator')
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
                         UNION SELECT owner_entity_id FROM via_person) x)   AS reachable_graph,
  -- ---- appended by Prompt 114 (append-only; never insert mid-list) ----
  (SELECT count(*) FROM via_person_selectable)                              AS via_linked_person_selectable,
  (SELECT count(*) FROM (SELECT owner_entity_id FROM via_org
                         UNION SELECT owner_entity_id FROM via_uc
                         UNION SELECT owner_entity_id FROM via_person_selectable) x)
                                                                            AS reachable_hero_effective,
  (SELECT count(*) FROM (SELECT owner_entity_id FROM via_org
                         UNION SELECT owner_entity_id FROM via_uc
                         UNION SELECT owner_entity_id FROM via_person_selectable) x)
  - (SELECT count(*) FROM (SELECT owner_entity_id FROM via_org
                           UNION SELECT owner_entity_id FROM via_uc) x)      AS hero_gap;

COMMENT ON VIEW public.v_lcc_owner_reachability IS
  'BREAK-1 measurement. reachable_hero = the PRE-Prompt-114 hero definition (entities.email/phone or a unified_contacts row ON the entity), retained as the before/after yardstick. reachable_hero_effective = what the hero reads AFTER the Prompt 114 fold-in (adds a linked person that survives the reachable-via guards) — quote THIS for operator experience. hero_gap is the difference. reachable_graph counts any linked person including brokers and therefore OVERSTATES what the panel can show.';

GRANT SELECT ON public.v_lcc_owner_reachability                 TO anon, authenticated, service_role;
GRANT SELECT ON public.v_lcc_owner_contact_attach_review_open   TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Provenance.
--
--    NO new field_source_priority rows are needed, and that is deliberate — the
--    doctrine's rule is "register a row when you add a new writer/source", and
--    both writers this lane introduces are HUMAN VERDICTS in a review lane,
--    which migration 20260903120000 already registered as `manual_resolution`
--    at priority 1 for entities.email and entities.phone:
--      · same_party    fills entities.email/phone on the OWNER  → manual_resolution
--      · attach_person fills entities.email/phone on the PERSON → manual_resolution
--    Both paths stamp source='manual_resolution', so `v_field_provenance_unranked`
--    cannot gain a row from this work. Verified against the live ladder before
--    shipping; see the Prompt 114 notes in CLAUDE.md for the standing 35-row
--    pre-existing drift, which is unrelated to entities.* and untouched here.
-- ---------------------------------------------------------------------------
