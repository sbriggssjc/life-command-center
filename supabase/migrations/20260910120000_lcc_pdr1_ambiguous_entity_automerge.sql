-- ============================================================================
-- PDR1 / P13 fork 1 — ambiguous-entity automerge run log + feature flag seed.
-- LCC Opps (xengecqvemvfknjvbvrq). Applied via CI/ops after PR merge — NOT
-- applied live in this build session (no Supabase egress in the sandbox this
-- was written in). Additive, reversible (DROP TABLE / DELETE the seed row).
--
-- Companion code: api/_shared/ambiguous-entity-merge-planner.js (pure scoring),
-- api/_handlers/ambiguous-entity-automerge-tick.js (GET dry-run / POST gated
-- sweep, reuses rpc/reconcile_entity — no second merge writer), the
-- `ambiguous_entity_resolution` Decision Center lane (api/admin.js / dc-lanes.js).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_ambiguous_entity_automerge_run_log (
  run_id          bigserial PRIMARY KEY,
  status          text NOT NULL DEFAULT 'started',
  trigger_source  text,
  batch_tag       text,
  flag_enabled    boolean,
  dry_run         boolean,
  batch_limit     integer,
  ok              boolean,
  scanned         integer,
  planned         integer,
  skipped_needs_human integer,
  merged          integer,
  failed_merges   integer,
  capped          boolean,
  budget_stopped  boolean,
  error_count     integer,
  detail          jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     integer
);

COMMENT ON TABLE public.lcc_ambiguous_entity_automerge_run_log IS
  'PDR1/P13#1 — run ledger for the ambiguous-entity-resolution automerge tick. '
  'Opened before the work (P123 lifecycle), PATCHed on the way out, so a run that '
  'dies mid-flight leaves a stalled row rather than nothing.';

GRANT SELECT, INSERT, UPDATE ON public.lcc_ambiguous_entity_automerge_run_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lcc_ambiguous_entity_automerge_run_log_run_id_seq TO service_role;

-- ----------------------------------------------------------------------------
-- Feature flag seed (Inert-Feature Registry, audit §4.4.3 — CLAUDE.md
-- "Inert-feature registry" section). Default OFF: the auto-merge write path
-- must not fire until the GET dry-run's real auto-mergeable/needs_human split
-- has been read by a human against the live 189-entity population (UNKNOWN at
-- build time — see STATUS.md).
-- ----------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry
  (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES
  ('AMBIGUOUS_ENTITY_AUTOMERGE',
   'PDR1/P13#1 — auto-merge the clear Salesforce-sync opportunity-mint duplicate '
   'placeholders (entities.metadata.ambiguous_resolution) via rpc/reconcile_entity, '
   'gated on a documented address/signal-margin threshold in '
   'ambiguous-entity-merge-planner.js.',
   'api/_handlers/ambiguous-entity-automerge-tick.js', 'AMBIGUOUS_ENTITY_AUTOMERGE',
   'off', CURRENT_DATE, 'Scott Briggs',
   'GET is an ungated dry run — read the real auto-mergeable/needs_human split '
   'against the live 189-entity population before flipping this on. Population is '
   'CLOSED (nothing minted since 2026-08-04) — no recurring cron is wired; this is '
   'a one-shot drain, run manually/via Cowork when ready.')
ON CONFLICT (flag) DO NOTHING;
