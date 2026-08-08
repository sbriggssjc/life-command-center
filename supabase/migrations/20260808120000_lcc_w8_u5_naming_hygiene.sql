-- W8 U5 (Prompt 79, 2026-08-08): naming-hygiene campaign.
--
-- The rename/normalize unit of the Ollama hygiene campaign. U1 (junk pre-screen)
-- already CLASSIFIES + COUNTS the naming-hygiene backlog (lcc 5,091 = 1,113
-- known_abbreviation + 3,978 address_as_name; gov 973; dia 395) but deliberately
-- never enqueues it. This unit turns that backlog into two proposal types,
-- DETERMINISTIC-FIRST:
--   * known_abbreviation -> RENAME proposal (unambiguous dictionary expansion:
--     Prtnrs->Partners, Mgmt->Management … — NO LLM; ambiguous tokens only get
--     the model, judge-don't-parrot).
--   * address_as_name    -> LINK-DON'T-RENAME (attach the entity to the property
--     at that address; fill the display name from the property owner, fill-blanks).
--
-- Reuses the U1/U2/U3 shapes wholesale (pure planner module, GET dry-run / POST
-- flag-gated apply tick, nightly cron, in-migration flag, bounded+resumable
-- scoring, reversible ledger). Additive + idempotent on LCC Opps
-- (xengecqvemvfknjvbvrq). It creates:
--   * naming_hygiene_batch       — per-run + per-apply reversible ledger
--   * naming_hygiene_review      — the proposal rows (one per scored candidate)
--   * naming_hygiene_scored      — the resume cursor (domain,table,pk,name_hash)
--   * v_naming_hygiene_review_open   — the Decision Center federated-lane source
--   * v_lcc_naming_hygiene_health    — Health-surface tile
--   * field_source_priority rows for the rename writer (source w8_u5_naming_hygiene)
--     so v_field_provenance_unranked stays at its baseline (no new drift)
--   * feature flag W8_U5_NAMING_HYGIENE (default OFF, registered here per 36y)
--   * nightly off-hours pg_cron POST to the Railway tick (04:25, no-ops while OFF)
--
-- DOCTRINE: Ollama PROPOSES; a deterministic rule or a human lane DECIDES. Every
-- proposal is evidence-grounded (verbatim abbreviated token / address string).
-- Proposal-only — no write without a human verdict. All reversible. NEVER
-- fabricate. Deterministic dictionary renames are bulk-confirmable (mechanical).
--
-- REVERSAL RUNBOOK
--   -- undo a single applied rename (the ledger apply row carries the old name):
--   SELECT * FROM public.naming_hygiene_batch WHERE batch_kind='apply' AND status='applied';
--   -- each apply row's `reversal` jsonb carries { domain, table, pk_col, pk,
--   --   field, old_value } — re-PATCH old_value onto the row (cross-DB via the
--   --   app), then:
--   UPDATE public.naming_hygiene_review SET status='proposed', applied_batch_id=NULL,
--          decided_at=NULL, decided_by=NULL WHERE review_id=<id>;
--   UPDATE public.naming_hygiene_batch SET status='reversed' WHERE batch_id=<id>;
--   -- a property-link apply (address_as_name) records the external_identities id
--   --   it created in reversal.link_identity_id — DELETE that row to reverse.
--   -- to retire the whole feature: flip the flag off (already default) — the
--   --   cron POST no-ops, and the tick GET stays a dry-run.

BEGIN;

-- Ledger — one row per tick run (batch_kind='scan') and one per applied verdict
-- (batch_kind='apply'). The apply rows carry the reversal payload.
CREATE TABLE IF NOT EXISTS public.naming_hygiene_batch (
  batch_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_kind    text NOT NULL DEFAULT 'scan'
                  CHECK (batch_kind IN ('scan', 'apply')),
  source_run_id text NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'applied', 'conflict', 'reversed', 'dismissed')),
  domain        text,
  table_name    text,
  pk_value      text,
  review_id     bigint,
  actor         uuid,
  reversal      jsonb NOT NULL DEFAULT '{}'::jsonb,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_naming_hygiene_batch_run
  ON public.naming_hygiene_batch (source_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_naming_hygiene_batch_apply
  ON public.naming_hygiene_batch (batch_kind, status, created_at DESC);

COMMENT ON TABLE public.naming_hygiene_batch IS
  'W8 U5: reversible ledger for the naming-hygiene campaign. scan rows = a tick run; apply rows = a human-confirmed rename/link (reversal jsonb carries old name / created link id).';

-- Proposal rows. One per scored candidate, keyed by the federated subject_ref so
-- a re-scan is idempotent (merge-duplicates) and a decided subject is excluded.
CREATE TABLE IF NOT EXISTS public.naming_hygiene_review (
  review_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref       text NOT NULL UNIQUE,
  domain            text NOT NULL,
  table_name        text NOT NULL,
  pk_value          text NOT NULL,
  entity_name       text,
  hygiene_class     text NOT NULL
                      CHECK (hygiene_class IN ('known_abbreviation', 'address_as_name')),
  proposed_action   text NOT NULL DEFAULT 'keep'
                      CHECK (proposed_action IN ('rename', 'link_property', 'keep', 'uncertain')),
  proposed_name     text,                -- for rename (expanded name) / link fill
  proposed_property jsonb,               -- for link_property: {domain,property_id,address}
  deterministic     boolean NOT NULL DEFAULT false,  -- true = no-LLM dictionary rename (bulk-confirmable)
  confidence        numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_quote    text,                -- verbatim abbreviated token / address string
  reason            text,
  model_provider    text,
  model_name        text,
  source_run_id     text NOT NULL,
  scan_batch_id     bigint REFERENCES public.naming_hygiene_batch(batch_id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('proposed', 'dismissed', 'applied', 'conflict', 'superseded')),
  applied_batch_id  bigint REFERENCES public.naming_hygiene_batch(batch_id) ON DELETE SET NULL,
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_naming_hygiene_review_open
  ON public.naming_hygiene_review (status, deterministic DESC, confidence DESC, created_at DESC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_naming_hygiene_review_domain
  ON public.naming_hygiene_review (domain, table_name, status);
CREATE INDEX IF NOT EXISTS idx_naming_hygiene_review_class
  ON public.naming_hygiene_review (hygiene_class, status);

COMMENT ON TABLE public.naming_hygiene_review IS
  'W8 U5: naming-hygiene proposals. Proposal-only; the verdict is human (naming_hygiene_review Decision Center lane). confirm+rename => name write via the house normalizer (reversible); confirm+link_property => ensureEntityLink asset link; keep/uncertain => close. Deterministic dictionary renames are bulk-confirmable.';

CREATE OR REPLACE FUNCTION public.naming_hygiene_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_naming_hygiene_review_touch ON public.naming_hygiene_review;
CREATE TRIGGER trg_naming_hygiene_review_touch
  BEFORE UPDATE ON public.naming_hygiene_review
  FOR EACH ROW EXECUTE FUNCTION public.naming_hygiene_review_touch();

-- Resume cursor (Prompt 66 pattern): every scored candidate — enqueued proposals
-- AND keeps — is recorded here keyed (domain,table_name,pk_value,name_hash) so an
-- unchanged name is never re-scored, while a rename (new name_hash) re-scores.
CREATE TABLE IF NOT EXISTS public.naming_hygiene_scored (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref   text NOT NULL,
  domain        text NOT NULL,
  table_name    text NOT NULL,
  pk_value      text NOT NULL,
  name_hash     text NOT NULL,
  entity_name   text,
  hygiene_class text,
  action        text,
  enqueued      boolean NOT NULL DEFAULT false,
  source_run_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, table_name, pk_value, name_hash)
);

CREATE INDEX IF NOT EXISTS idx_naming_hygiene_scored_ref
  ON public.naming_hygiene_scored (subject_ref);

COMMENT ON TABLE public.naming_hygiene_scored IS
  'W8 U5: resume cursor. One row per (domain,table,pk,name_hash) scored — a name change yields a new hash and is re-scored. CMS_DISABLE-style kill via the tick.';

GRANT SELECT ON public.naming_hygiene_batch  TO anon, authenticated, service_role;
GRANT SELECT ON public.naming_hygiene_review TO anon, authenticated, service_role;
GRANT SELECT ON public.naming_hygiene_scored TO anon, authenticated, service_role;

-- Federated-lane source: open proposals. Deterministic dictionary renames first
-- (they're mechanical / bulk-confirmable), then by confidence. The verdict-not-
-- yet-cast set.
CREATE OR REPLACE VIEW public.v_naming_hygiene_review_open AS
SELECT review_id, subject_ref, domain, table_name, pk_value, entity_name,
       hygiene_class, proposed_action, proposed_name, proposed_property,
       deterministic, confidence, evidence_quote, reason,
       model_provider, model_name, source_run_id, created_at
  FROM public.naming_hygiene_review
 WHERE status = 'proposed'
 ORDER BY deterministic DESC, confidence DESC, created_at DESC;

GRANT SELECT ON public.v_naming_hygiene_review_open TO anon, authenticated, service_role;

-- Health tile — flag state + open/applied counts + a deterministic-vs-LLM split.
-- amber while the flag is off (a flag-gated no-op must be visible).
CREATE OR REPLACE VIEW public.v_lcc_naming_hygiene_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed')::int AS open_proposals,
         count(*) FILTER (WHERE status = 'proposed' AND deterministic)::int AS open_deterministic,
         count(*) FILTER (WHERE status = 'proposed' AND hygiene_class = 'address_as_name')::int AS open_address_links,
         count(*) FILTER (WHERE status = 'applied')::int  AS applied_total,
         count(*) FILTER (WHERE status = 'conflict')::int AS conflict_total,
         max(created_at) AS latest_proposal_at
    FROM public.naming_hygiene_review
),
f AS (
  SELECT state FROM public.feature_flags_registry
   WHERE flag = 'W8_U5_NAMING_HYGIENE' LIMIT 1
)
SELECT 'naming_hygiene'::text AS subsystem,
       'ollama_naming_hygiene'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W8_U5_NAMING_HYGIENE feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'open_deterministic', coalesce((SELECT open_deterministic FROM p), 0),
         'open_address_links', coalesce((SELECT open_address_links FROM p), 0),
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'conflict_total', coalesce((SELECT conflict_total FROM p), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_naming_hygiene_health TO anon, authenticated, service_role;

-- field_source_priority registration (unranked-view hygiene). The rename writer
-- records a field_provenance row (source='w8_u5_naming_hygiene') for the display
-- name it writes; register a matching fsp row for every (target_table, field)
-- combo the writer touches so v_field_provenance_unranked stays at its baseline
-- (no new drift). Rank 40 = derived/normalization band: ABOVE the aggregator
-- sidebars (50-70) since a human-confirmed expansion is more trustworthy than a
-- raw scrape, but BELOW manual(1)/deed(3)/county(5)/om(45). record_only (the
-- provenance is an audit log; the write is human-gated).
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('entities',            'name',           'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: human-confirmed abbreviation expansion of the entity display name.'),
  ('entities',            'canonical_name', 'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: recomputed canonical_name after a confirmed rename (lcc_normalize_entity_name).'),
  ('dia.recorded_owners', 'name',           'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: human-confirmed abbreviation expansion.'),
  ('dia.true_owners',     'name',           'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: human-confirmed abbreviation expansion.'),
  ('dia.contacts',        'contact_name',   'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: human-confirmed abbreviation expansion.'),
  ('gov.recorded_owners', 'name',           'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: human-confirmed abbreviation expansion.'),
  ('gov.true_owners',     'name',           'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: human-confirmed abbreviation expansion.'),
  ('gov.contacts',        'name',           'w8_u5_naming_hygiene', 40, NULL, 'record_only', 'W8 U5 naming-hygiene: human-confirmed abbreviation expansion.')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority, notes = EXCLUDED.notes, updated_at = now();

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W8_U5_NAMING_HYGIENE',
  'W8 U5 hygiene: expand unambiguous abbreviated entity names (Prtnrs->Partners) and link address-as-name entities to their property. Deterministic dictionary renames need no LLM; ambiguous tokens are model-judged. Proposals land in the naming_hygiene_review Decision Center lane for a human verdict (deterministic renames are bulk-confirmable).',
  'api/admin.js?_route=naming-hygiene-tick + naming_hygiene_review + Decision Center (naming_hygiene_review lane)',
  'W8_U5_NAMING_HYGIENE',
  'off',
  DATE '2026-08-08',
  'Scott Briggs',
  'Proposal-only. rename+human-confirm => name write via the house normalizer + reversible ledger + provenance; address_as_name+confirm => ensureEntityLink asset link + fill-blanks display name; NEVER fabricate. Flip on after the dry-run sample is reviewed. Uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI for AMBIGUOUS tokens only.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Nightly off-hours cron (04:25 — staggered after U1 03:40 / U2 03:50 / U3 04:10,
-- per Prompt 79). POSTs the Railway tick; the tick no-ops while the flag is off,
-- so this is inert until the flag flips. limit=50 favors the cheap deterministic
-- renames; the tick internally caps LLM-assisted scoring to a smaller budget.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('naming-hygiene-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'naming-hygiene-tick',
      '25 4 * * *',
      $cron$SELECT public.lcc_cron_post('/api/naming-hygiene-tick', '{"apply":true,"limit":50}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
