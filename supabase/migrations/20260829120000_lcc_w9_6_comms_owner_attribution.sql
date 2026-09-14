-- W9.6 (Prompt 102, 2026-08-13): correspondence → owner-LLC attribution.
--
-- Wave 9 (data connectedness) — the last major INTERNAL linkage gap. It connects
-- the INBOX to the OWNER GRAPH (the reverse direction of the Outlook↔LCC bridge).
-- Reuses the W9.2/W9.4 house shapes (pure planner module, GET dry-run /
-- ?score=1&n= inline sample / POST flag-gated tick, reversible batch ledger,
-- in-migration flag registration, nightly no-op-while-off cron, per-path counts,
-- loud scan_errors, budget floors) — it does NOT fork a new pattern. Additive +
-- idempotent on LCC Opps (xengecqvemvfknjvbvrq).
--
-- THE GAP (grounded live via W9.5, 2026-08-12): correspondence→owner-LLC = 2.5%
-- (6/241 distinct attributed entities map to a true_owner). `activity_events`
-- correspondence is stamped with the deal / party / property entity the resolver
-- found — brokers, buyers, seller contacts. Those are PARTIES, not the owning
-- LLC, so an email about a property never surfaces against the owner we want to
-- reach. Preserving names (W9.4) did NOT fix this — it is a distinct LINKAGE
-- problem (the prompt-96 second finding). This unit closes it.
--
-- TWO attribution PATHS (deterministic-first, per the house pattern):
--   PATH A — property_bridge (deterministic): a correspondence entity that
--     resolves to an ASSET (or a deal carrying the asset) → attribute the thread
--     to that property's true_owner via the ops graph owns-edge. Arithmetic where
--     the link exists (confidence 1.0). Value-gated by owner portfolio rank.
--     (bd_opportunity_id is the durable seam — 0 correspondence rows carry one
--     TODAY, so the live feedstock is the asset-attributed sub-case; both are the
--     SAME owns-edge resolver.)
--   PATH B — person_match (verbatim, thinner): a correspondence entity that is a
--     PERSON already tied to a true_owner (owner_contact_pivot active contact, or
--     an UNAMBIGUOUS person→owner relationship edge) → attribute the thread to
--     that owner. U3-pattern verbatim evidence (the correspondent's OWN header
--     name/email). A shared-token-only name bridge is REJECTED in the planner
--     (never guess — the W9.1 naming-core false-bridge lesson).
--
--   A HUMAN confirm lane decides; a DETERMINISTIC writer (admin.js verdict
--   dispatch) applies by APPENDING the owner ops entity to the correspondence
--   rows' metadata.linked_entity_ids (the SINGLE anchor both consumers read),
--   stamping field_provenance source 'comms_owner_bridge', logged reversibly.
--   NEVER an auto-write; NEVER fabricated.
--
-- The attribution feeds TWO things (the arms COMPOUND):
--   (a) the owner now has correspondence history when you open their record
--       (linked_entity_ids is an owner anchor); and
--   (b) the W9.2/W9.4 reachability harvest CREATE-CONTACT arm gains owner-linked
--       threads it could not see before (harvestBuildCommsIndex reads
--       linked_entity_ids via commsRowEntityAnchors → resolves owners-without-
--       contacts). One anchor, both consumers.
--
-- Metric: correspondence→owner-LLC % (the W9.5 link this raises from 2.5%). The
-- W9.5 view's `correspondence_entity_owner_llc` is EXTENDED below to count owner
-- attribution via linked_entity_ids too (the very edge this unit writes), so the
-- headline pct rises honestly as attributions are confirmed. → U4.
--
-- This migration creates:
--   * comms_owner_attribution_batch      — per-run reversible scan ledger
--   * comms_owner_attribution_review     — the proposed owner attributions (one per
--                                          (path, corr entity, owner))
--   * comms_owner_attribution_apply_log  — the deterministic-writer reversal ledger
--   * v_comms_owner_attribution_review_open — the Decision Center lane source
--   * v_lcc_comms_owner_attribution_health  — Health-surface tile
--   * lcc_w9_6_path_a_candidates(p_limit)   — Path-A owns-edge join (SECURITY INVOKER)
--   * lcc_w9_6_path_b_candidates(p_limit)   — Path-B person→owner join
--   * field_source_priority row for 'comms_owner_bridge'(45) on
--     public.activity_events / linked_entity_ids (drift view stays 0)
--   * feature flag W9_6_COMMS_OWNER_ATTRIBUTION (default OFF, 36y rule)
--   * a nightly off-hours pg_cron POST to /api/comms-owner-attribution-tick
--     (05:05 UTC, staggered after the W9.2 chain — no-ops while OFF)
--   * EXTENDS v_lcc_w9_5_link_coverage.correspondence_entity_owner_llc
--
-- REVERSAL RUNBOOK
--   -- This unit writes NO attribution until a HUMAN accepts a proposal. On accept
--   --   the deterministic writer appends the owner ops entity to the correspondence
--   --   rows' metadata.linked_entity_ids + stamps field_provenance; every write is
--   --   logged to comms_owner_attribution_apply_log (reversal={owner_entity_id,
--   --   activity_event_ids[], provenance_ids[]}).
--   -- To retire a scan batch's un-worked proposals:
--   SELECT * FROM public.comms_owner_attribution_batch WHERE status='open' ORDER BY created_at DESC;
--   DELETE FROM public.comms_owner_attribution_review WHERE scan_batch_id=<id> AND status='proposed';
--   -- To reverse an APPLIED attribution: for each apply_log row (status='applied'),
--   --   remove reversal.owner_entity_id from metadata.linked_entity_ids of every
--   --   reversal.activity_event_ids[] row, then flip the log row status='reversed'.
--   -- To retire the feature: flip W9_6_COMMS_OWNER_ATTRIBUTION off (default) — the
--   --   cron POST no-ops and the tick GET stays a dry-run.

BEGIN;

-- Reversible scan ledger — one row per tick run (batch_kind='scan').
CREATE TABLE IF NOT EXISTS public.comms_owner_attribution_batch (
  batch_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_kind    text NOT NULL DEFAULT 'scan' CHECK (batch_kind IN ('scan')),
  source_run_id text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reversed')),
  actor         uuid,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comms_owner_attribution_batch_run
  ON public.comms_owner_attribution_batch (source_run_id, created_at DESC);
COMMENT ON TABLE public.comms_owner_attribution_batch IS
  'W9.6: reversible ledger for the correspondence→owner-LLC attribution tick. scan rows = a run (details carry per-path candidate/proposed/skipped counts + a cursor + loud scan_errors).';

-- Proposed owner attributions. One per (path, corr entity, owner), keyed by
-- subject_ref (coa:<path>:<domain>:<corrEntityId>:<ownerEntityId>) so a re-scan is
-- idempotent (merge-duplicates) and a decided row is excluded from re-proposal.
CREATE TABLE IF NOT EXISTS public.comms_owner_attribution_review (
  review_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref       text NOT NULL UNIQUE,
  path              text NOT NULL CHECK (path IN ('property_bridge', 'person_match')),
  domain            text NOT NULL CHECK (domain IN ('dia', 'gov')),
  corr_entity_id    uuid NOT NULL,      -- the ops entity the correspondence attributes to (asset/party/person)
  owner_entity_id   uuid NOT NULL,      -- the ops OWNER entity (has an external_identities true_owner row)
  target_owner_id   text NOT NULL,      -- the domain true_owner id (external_identities.external_id)
  owner_name        text,
  corr_entity_name  text,
  tie_kind          text,               -- owns_edge | active_contact | relationship
  correspondent_name  text,             -- Path B: the correspondent's header display name (verbatim)
  correspondent_email text,             -- Path B: the correspondent's header email (verbatim)
  thread_count      int,                -- how many correspondence rows this attribution covers
  sample_activity_id uuid,              -- a representative activity_events.id (evidence pointer)
  evidence_quote    text,               -- the join text (A) / the `Name <email>` header span (B)
  evidence_source   text,               -- comms:<activity_id> pointer
  confidence        numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  reason            text,
  rank_value        numeric,            -- owner portfolio rank (value gate)
  seeder            text NOT NULL DEFAULT 'w9_6_comms_owner_attribution',
  provenance_source text NOT NULL DEFAULT 'comms_owner_bridge'
                      CHECK (provenance_source IN ('comms_owner_bridge')),
  source_run_id     text NOT NULL,
  scan_batch_id     bigint REFERENCES public.comms_owner_attribution_batch(batch_id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('proposed', 'applied', 'rejected', 'conflict', 'superseded')),
  applied_log_id    bigint,
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comms_owner_attribution_review_open
  ON public.comms_owner_attribution_review (status, path, rank_value DESC NULLS LAST, confidence DESC, created_at DESC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_comms_owner_attribution_review_owner
  ON public.comms_owner_attribution_review (domain, owner_entity_id, status);
COMMENT ON TABLE public.comms_owner_attribution_review IS
  'W9.6: correspondence→owner-LLC attribution PROPOSALS (seeder w9_6_comms_owner_attribution). Proposal-only — Path A (property_bridge) is arithmetic (owns-edge join, confidence 1.0); Path B (person_match) carries the correspondent''s VERBATIM header name/email and rejects a shared-token-only name bridge. A HUMAN verdict (Decision Center comms_owner_attribution_review lane) applies via the deterministic writer, which appends the owner ops entity to the correspondence rows'' metadata.linked_entity_ids + stamps field_provenance (comms_owner_bridge). NEVER an auto-write; NEVER fabricated.';

CREATE OR REPLACE FUNCTION public.comms_owner_attribution_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_comms_owner_attribution_review_touch ON public.comms_owner_attribution_review;
CREATE TRIGGER trg_comms_owner_attribution_review_touch
  BEFORE UPDATE ON public.comms_owner_attribution_review
  FOR EACH ROW EXECUTE FUNCTION public.comms_owner_attribution_review_touch();

-- The deterministic-writer reversal ledger — one row per APPLIED attribution.
CREATE TABLE IF NOT EXISTS public.comms_owner_attribution_apply_log (
  apply_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id      bigint REFERENCES public.comms_owner_attribution_review(review_id) ON DELETE SET NULL,
  subject_ref    text NOT NULL,
  source_run_id  text NOT NULL DEFAULT 'verdict',
  status         text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reversed', 'conflict')),
  actor          uuid,
  reversal       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {owner_entity_id, activity_event_ids[], provenance_ids[]}
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comms_owner_attribution_apply_log_review
  ON public.comms_owner_attribution_apply_log (review_id, created_at DESC);
COMMENT ON TABLE public.comms_owner_attribution_apply_log IS
  'W9.6: reversible ledger for accepted owner attributions. reversal={owner_entity_id, activity_event_ids[] (the rows whose metadata.linked_entity_ids gained the owner), provenance_ids[]} — recorded BEFORE the mutation so an accept is always undoable.';

GRANT SELECT ON public.comms_owner_attribution_batch     TO anon, authenticated, service_role;
GRANT SELECT ON public.comms_owner_attribution_review    TO anon, authenticated, service_role;
GRANT SELECT ON public.comms_owner_attribution_apply_log TO anon, authenticated, service_role;

-- Decision Center lane source: open attribution proposals. Path A (arithmetic,
-- confidence 1.0) ranks FIRST (bulk-confirmable), then by owner $ value.
CREATE OR REPLACE VIEW public.v_comms_owner_attribution_review_open AS
SELECT review_id, subject_ref, path, domain, corr_entity_id, owner_entity_id, target_owner_id,
       owner_name, corr_entity_name, tie_kind, correspondent_name, correspondent_email,
       thread_count, sample_activity_id, evidence_quote, evidence_source, confidence, reason,
       rank_value, provenance_source, source_run_id, created_at
  FROM public.comms_owner_attribution_review
 WHERE status = 'proposed'
 ORDER BY (path = 'property_bridge') DESC, rank_value DESC NULLS LAST, confidence DESC, created_at DESC;
GRANT SELECT ON public.v_comms_owner_attribution_review_open TO anon, authenticated, service_role;

-- Health tile — flag state + open/applied counts. amber while the flag is off.
CREATE OR REPLACE VIEW public.v_lcc_comms_owner_attribution_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed')::int AS open_proposals,
         count(*) FILTER (WHERE status = 'proposed' AND path = 'property_bridge')::int AS open_property_bridge,
         count(*) FILTER (WHERE status = 'proposed' AND path = 'person_match')::int AS open_person_match,
         count(*) FILTER (WHERE status = 'applied')::int AS applied_total,
         count(*) FILTER (WHERE status = 'rejected')::int AS rejected_total,
         max(created_at) AS latest_proposal_at
    FROM public.comms_owner_attribution_review
),
f AS (
  SELECT state FROM public.feature_flags_registry WHERE flag = 'W9_6_COMMS_OWNER_ATTRIBUTION' LIMIT 1
)
SELECT 'comms_owner_attribution'::text AS subsystem,
       'correspondence_owner_attribution'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W9_6_COMMS_OWNER_ATTRIBUTION feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'open_property_bridge', coalesce((SELECT open_property_bridge FROM p), 0),
         'open_person_match', coalesce((SELECT open_person_match FROM p), 0),
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'rejected_total', coalesce((SELECT rejected_total FROM p), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;
GRANT SELECT ON public.v_lcc_comms_owner_attribution_health TO anon, authenticated, service_role;

-- ── Path A join (deterministic): correspondence entity that IS an asset → the
--    property's true_owner via the owns edge (owner --owns--> asset). Unambiguous
--    (exactly one CURRENT owner) only. Excludes already-attributed threads. Ranked
--    by owner portfolio size (count of currently-owned assets). SECURITY INVOKER. ──
CREATE OR REPLACE FUNCTION public.lcc_w9_6_path_a_candidates(p_limit int DEFAULT 200)
RETURNS TABLE (
  corr_entity_id uuid, corr_entity_name text, owner_entity_id uuid,
  owner_true_owner_id text, owner_domain text, owner_name text,
  property_label text, corr_row_count bigint, sample_activity_id uuid, rank_value numeric
) LANGUAGE sql STABLE AS $$
WITH corr AS (
  SELECT entity_id, count(*) AS n, min(id::text) AS sample
  FROM public.activity_events
  WHERE (source_type ILIKE 'outlook%' OR source_type = 'email_intake') AND entity_id IS NOT NULL
  GROUP BY entity_id
),
asset_corr AS (
  SELECT c.entity_id AS asset_entity, c.n, c.sample
  FROM corr c
  WHERE EXISTS (SELECT 1 FROM public.external_identities e
                 WHERE e.entity_id = c.entity_id AND e.source_type = 'asset'
                   AND e.source_system IN ('dia', 'gov'))
),
owner_edges AS (
  SELECT ac.asset_entity, ac.n, ac.sample, r.from_entity_id AS owner_entity
  FROM asset_corr ac
  JOIN public.entity_relationships r
    ON r.to_entity_id = ac.asset_entity AND r.relationship_type = 'owns' AND r.effective_to IS NULL
  WHERE EXISTS (SELECT 1 FROM public.external_identities oe
                 WHERE oe.entity_id = r.from_entity_id AND oe.source_type = 'true_owner'
                   AND oe.source_system IN ('dia', 'gov'))
),
unambiguous AS (
  SELECT asset_entity, n, sample, min(owner_entity::text)::uuid AS owner_entity
  FROM owner_edges
  GROUP BY asset_entity, n, sample
  HAVING count(DISTINCT owner_entity) = 1
)
SELECT
  u.asset_entity AS corr_entity_id,
  ae.name AS corr_entity_name,
  u.owner_entity AS owner_entity_id,
  oe.external_id AS owner_true_owner_id,
  oe.source_system AS owner_domain,
  oo.name AS owner_name,
  ae.name AS property_label,
  u.n AS corr_row_count,
  u.sample::uuid AS sample_activity_id,
  (SELECT count(*) FROM public.entity_relationships r2
     WHERE r2.from_entity_id = u.owner_entity AND r2.relationship_type = 'owns' AND r2.effective_to IS NULL)::numeric AS rank_value
FROM unambiguous u
JOIN public.entities ae ON ae.id = u.asset_entity
JOIN public.entities oo ON oo.id = u.owner_entity
JOIN LATERAL (
  SELECT external_id, source_system FROM public.external_identities
  WHERE entity_id = u.owner_entity AND source_type = 'true_owner' AND source_system IN ('dia', 'gov')
  ORDER BY last_synced_at DESC NULLS LAST LIMIT 1
) oe ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.activity_events a2
  WHERE a2.entity_id = u.asset_entity
    AND jsonb_typeof(a2.metadata->'linked_entity_ids') = 'array'
    AND a2.metadata->'linked_entity_ids' ? u.owner_entity::text
)
ORDER BY rank_value DESC NULLS LAST, corr_row_count DESC
LIMIT GREATEST(1, p_limit);
$$;
GRANT EXECUTE ON FUNCTION public.lcc_w9_6_path_a_candidates(int) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.lcc_w9_6_path_a_candidates(int) IS
  'W9.6 Path A (property_bridge): correspondence-attributed ASSET entity → its CURRENT true_owner via the unambiguous owns edge. Deterministic. Ranked by owner portfolio size. Excludes already-attributed threads.';

-- ── Path B join (person_match): correspondence entity that is a PERSON (not asset,
--    not owner) tied to a true_owner via the owner_contact_pivot active contact
--    (tier 1, curated) or an UNAMBIGUOUS person↔owner relationship edge (tier 2).
--    Single owner across both tiers only (prefer active_contact). The correspondent
--    name/email rides for the planner's verbatim/false-bridge guard. ──
CREATE OR REPLACE FUNCTION public.lcc_w9_6_path_b_candidates(p_limit int DEFAULT 200)
RETURNS TABLE (
  corr_entity_id uuid, corr_entity_name text, owner_entity_id uuid,
  owner_true_owner_id text, owner_domain text, owner_name text,
  tie_kind text, correspondent_name text, correspondent_email text,
  corr_row_count bigint, sample_activity_id uuid, rank_value numeric
) LANGUAGE sql STABLE AS $$
WITH corr AS (
  SELECT entity_id, count(*) AS n, min(id::text) AS sample
  FROM public.activity_events
  WHERE (source_type ILIKE 'outlook%' OR source_type = 'email_intake') AND entity_id IS NOT NULL
  GROUP BY entity_id
),
person_corr AS (
  SELECT c.entity_id AS person_entity, c.n, c.sample
  FROM corr c
  WHERE NOT EXISTS (SELECT 1 FROM public.external_identities e
                     WHERE e.entity_id = c.entity_id AND e.source_type IN ('asset', 'true_owner'))
),
pivot_tie AS (
  SELECT pc.person_entity, pc.n, pc.sample, ocp.entity_id AS owner_entity, 'active_contact'::text AS tie_kind
  FROM person_corr pc
  JOIN public.owner_contact_pivot ocp ON ocp.active_contact_entity_id = pc.person_entity
  WHERE EXISTS (SELECT 1 FROM public.external_identities oe
                 WHERE oe.entity_id = ocp.entity_id AND oe.source_type = 'true_owner' AND oe.source_system IN ('dia', 'gov'))
),
rel_tie AS (
  SELECT pc.person_entity, pc.n, pc.sample, r.from_entity_id AS owner_entity, 'relationship'::text AS tie_kind
  FROM person_corr pc
  JOIN public.entity_relationships r ON r.to_entity_id = pc.person_entity
   AND r.relationship_type IN ('associated_with', 'contact_at', 'works_at')
  WHERE EXISTS (SELECT 1 FROM public.external_identities oe
                 WHERE oe.entity_id = r.from_entity_id AND oe.source_type = 'true_owner' AND oe.source_system IN ('dia', 'gov'))
  UNION ALL
  SELECT pc.person_entity, pc.n, pc.sample, r.to_entity_id AS owner_entity, 'relationship'::text AS tie_kind
  FROM person_corr pc
  JOIN public.entity_relationships r ON r.from_entity_id = pc.person_entity
   AND r.relationship_type IN ('associated_with', 'contact_at', 'works_at')
  WHERE EXISTS (SELECT 1 FROM public.external_identities oe
                 WHERE oe.entity_id = r.to_entity_id AND oe.source_type = 'true_owner' AND oe.source_system IN ('dia', 'gov'))
),
all_ties AS (
  SELECT * FROM pivot_tie
  UNION ALL
  SELECT * FROM rel_tie
),
owner_counts AS (
  SELECT person_entity, count(DISTINCT owner_entity) AS owner_ct FROM all_ties GROUP BY person_entity
),
ranked_ties AS (
  SELECT person_entity, n, sample, owner_entity, tie_kind,
    row_number() OVER (PARTITION BY person_entity ORDER BY (tie_kind = 'active_contact') DESC, owner_entity) AS rn
  FROM all_ties
),
chosen AS (
  SELECT rt.person_entity, rt.n, rt.sample, rt.owner_entity, rt.tie_kind
  FROM ranked_ties rt JOIN owner_counts oc ON oc.person_entity = rt.person_entity
  WHERE rt.rn = 1 AND oc.owner_ct = 1
)
SELECT
  ch.person_entity AS corr_entity_id,
  pe.name AS corr_entity_name,
  ch.owner_entity AS owner_entity_id,
  oe.external_id AS owner_true_owner_id,
  oe.source_system AS owner_domain,
  oo.name AS owner_name,
  ch.tie_kind,
  pe.name AS correspondent_name,
  pe.email AS correspondent_email,
  ch.n AS corr_row_count,
  ch.sample::uuid AS sample_activity_id,
  (SELECT count(*) FROM public.entity_relationships r2
     WHERE r2.from_entity_id = ch.owner_entity AND r2.relationship_type = 'owns' AND r2.effective_to IS NULL)::numeric AS rank_value
FROM chosen ch
JOIN public.entities pe ON pe.id = ch.person_entity
JOIN public.entities oo ON oo.id = ch.owner_entity
JOIN LATERAL (
  SELECT external_id, source_system FROM public.external_identities
  WHERE entity_id = ch.owner_entity AND source_type = 'true_owner' AND source_system IN ('dia', 'gov')
  ORDER BY last_synced_at DESC NULLS LAST LIMIT 1
) oe ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.activity_events a2
  WHERE a2.entity_id = ch.person_entity
    AND jsonb_typeof(a2.metadata->'linked_entity_ids') = 'array'
    AND a2.metadata->'linked_entity_ids' ? ch.owner_entity::text
)
ORDER BY (ch.tie_kind = 'active_contact') DESC, rank_value DESC NULLS LAST, corr_row_count DESC
LIMIT GREATEST(1, p_limit);
$$;
GRANT EXECUTE ON FUNCTION public.lcc_w9_6_path_b_candidates(int) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.lcc_w9_6_path_b_candidates(int) IS
  'W9.6 Path B (person_match): correspondence-attributed PERSON entity tied to a single true_owner (owner_contact_pivot active contact, or an unambiguous person↔owner relationship edge). Carries the correspondent name/email for the planner''s verbatim + shared-token false-bridge guard.';

-- field_source_priority: register the attribution writer's provenance source so
-- v_field_provenance_unranked stays 0. The writer stamps field_provenance on the
-- correspondence anchor (target public.activity_events / linked_entity_ids). One
-- source: comms_owner_bridge (45) — a deterministic property-bridge attribution or
-- a verbatim-confirmed person-match; sits mid-ladder (below manual/deed/county,
-- above the raw aggregators) — an attribution edge, not a curated owner fact.
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
SELECT v.target_table, v.field_name, v.source, v.priority, v.min_confidence, 'record_only', v.notes
FROM (VALUES
  ('public.activity_events', 'linked_entity_ids', 'comms_owner_bridge', 45, 0.00,
   'W9.6: correspondence→owner-LLC attribution edge (owner ops entity appended to linked_entity_ids on human confirm).')
) AS v(target_table, field_name, source, priority, min_confidence, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority f
  WHERE f.target_table = v.target_table AND f.field_name = v.field_name AND f.source = v.source
);

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W9_6_COMMS_OWNER_ATTRIBUTION',
  'W9.6 data-connectedness: correspondence → owner-LLC attribution (closes the 2.5% comms-to-owner gap, W9.5 baseline 6/241). Connects the INBOX to the OWNER GRAPH. PATH A (property_bridge, deterministic): a correspondence entity that resolves to an ASSET → the property''s true_owner via the ops owns edge (confidence 1.0, value-ranked). PATH B (person_match, verbatim): a correspondence entity that is a PERSON tied to a single true_owner (owner_contact_pivot active contact, or an unambiguous person↔owner edge) → attribute the thread; the correspondent''s header name/email is the verbatim evidence and a shared-token-only bridge is rejected. Human confirm lane → deterministic writer appends the owner ops entity to the correspondence rows'' metadata.linked_entity_ids + field_provenance (comms_owner_bridge, reversible). Feeds (a) owner-record correspondence history and (b) the W9.2/W9.4 reachability create-contact arm (the arms compound). NEVER auto-writes, never fabricates.',
  'api/comms-owner-attribution-tick + comms_owner_attribution_review + Decision Center (comms_owner_attribution_review lane)',
  'W9_6_COMMS_OWNER_ATTRIBUTION',
  'off',
  DATE '2026-08-13',
  'Scott Briggs',
  'Proposal-only — ZERO auto-writes. Path A is arithmetic (owns-edge join, bulk-confirmable); Path B carries a verbatim correspondent header + rejects a shared-token-only name bridge. A human verdict applies via the deterministic writer (append owner to activity_events.metadata.linked_entity_ids + field_provenance source comms_owner_bridge@45, reversible comms_owner_attribution_apply_log). Flip on after the ?score=1 dry-run sample is reviewed. Raises the W9.5 correspondence→owner-LLC pct measurably next run.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- ── EXTEND the W9.5 correspondence→owner-LLC metric ─────────────────────────
-- Same view, same output columns. `correspondence_entity_owner_llc` now counts
-- the entities correspondence attributes to via EITHER the primary entity_id OR a
-- CONFIRMED owner bridge (metadata.linked_entity_ids — the edge W9.6 writes), so
-- the headline pct rises honestly as attributions are confirmed. The other four
-- links are byte-identical to 20260828120000.
CREATE OR REPLACE VIEW public.v_lcc_w9_5_link_coverage AS
WITH corr AS (
  SELECT id, entity_id
  FROM public.activity_events
  WHERE source_type ILIKE 'outlook%' OR source_type = 'email_intake'
),
-- Every ops entity a correspondence row attributes to: the primary entity_id PLUS
-- any OWNER ops entity appended by a confirmed W9.6 bridge (linked_entity_ids).
-- The bridge branch is restricted to true_owner entities so pre-existing (non-
-- owner) linked_entity_ids can NOT dilute the denominator — only a confirmed owner
-- attribution moves the metric (it enters both numerator and denominator → pct up).
corr_attr AS (
  SELECT DISTINCT entity_id FROM corr WHERE entity_id IS NOT NULL
  UNION
  SELECT DISTINCT le.val::uuid
  FROM public.activity_events ae
  CROSS JOIN LATERAL jsonb_array_elements_text(ae.metadata->'linked_entity_ids') AS le(val)
  WHERE (ae.source_type ILIKE 'outlook%' OR ae.source_type = 'email_intake')
    AND jsonb_typeof(ae.metadata->'linked_entity_ids') = 'array'
    AND le.val ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND EXISTS (SELECT 1 FROM public.external_identities ei
                 WHERE ei.entity_id = le.val::uuid AND ei.source_type = 'true_owner')
),
rows AS (
  SELECT 'domain_owner_identity_entity_bound'::text AS link_name, 'mirror'::text AS group_name, 1 AS ord,
         (SELECT count(*) FROM public.external_identities
           WHERE source_type = 'true_owner' AND source_system IN ('dia','gov'))                AS total,
         (SELECT count(*) FROM public.external_identities
           WHERE source_type = 'true_owner' AND source_system IN ('dia','gov')
             AND entity_id IS NOT NULL)                                                        AS linked
  UNION ALL
  SELECT 'external_identity_canonical_conformance', 'mirror', 2,
         (SELECT count(*) FROM public.external_identities),
         (SELECT count(*) FROM public.external_identities
           WHERE source_system NOT IN
             ('dia_db','dia_supabase','dialysis','gov_db','gov_supabase','government'))
  UNION ALL
  SELECT 'cross_domain_contacts_resolved', 'mirror', 3,
         (SELECT count(*) FROM public.cross_domain_contacts),
         (SELECT count(*) FROM public.cross_domain_contacts
           WHERE gov_contact_id IS NOT NULL AND dia_contact_id IS NOT NULL)
  UNION ALL
  SELECT 'correspondence_to_entity', 'correspondence', 4,
         (SELECT count(*) FROM corr),
         (SELECT count(*) FROM corr WHERE entity_id IS NOT NULL)
  UNION ALL
  -- W9.6: attributed entity (primary OR confirmed owner bridge) → true_owner. As
  -- W9.6 attributions land, owner entities enter corr_attr and this pct rises.
  SELECT 'correspondence_entity_owner_llc', 'correspondence', 5,
         (SELECT count(*) FROM corr_attr),
         (SELECT count(*) FROM corr_attr ce
           WHERE EXISTS (SELECT 1 FROM public.external_identities ei
                          WHERE ei.entity_id = ce.entity_id AND ei.source_type = 'true_owner'))
)
SELECT link_name, 'lcc'::text AS domain, group_name, total, linked,
       CASE WHEN total > 0 THEN round((linked::numeric / total::numeric) * 100, 1) ELSE NULL END AS pct
FROM rows
ORDER BY ord;
GRANT SELECT ON public.v_lcc_w9_5_link_coverage TO anon, authenticated, service_role;
COMMENT ON VIEW public.v_lcc_w9_5_link_coverage IS
  'W9.5 propagation-integrity (W9.6-extended): the LCC-Opps-measurable links (mirror consistency + correspondence attribution + canonical conformance), one row per link (total,linked,pct). correspondence_entity_owner_llc counts entities correspondence attributes to via entity_id OR a confirmed W9.6 owner bridge (linked_entity_ids). Counts only, no PII.';

-- Nightly off-hours cron (05:05 UTC — staggered AFTER the W9.2 reachability tick
-- (04:40) and the W8 chain; the tick no-ops while the flag is off).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('comms-owner-attribution-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'comms-owner-attribution-tick',
      '5 5 * * *',
      $cron$SELECT public.lcc_cron_post('/api/comms-owner-attribution-tick', '{"apply":true,"limit":20}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
