-- ============================================================================
-- Item #10 Phase B (2026-05-17): client_errors table for browser-side
-- error telemetry. Companion to ingest_write_failures (server-side).
--
-- Powered by lccReportError in app.js. Fire-and-forget POSTs from the
-- browser flow into /api/admin?_route=client-error, which buffers them
-- here for historical analysis.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_errors (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID,
  user_email    TEXT,
  user_agent    TEXT,
  url           TEXT,
  label         TEXT NOT NULL,
  tier          TEXT NOT NULL CHECK (tier IN ('error','warn','info','ok')),
  code          TEXT,
  message       TEXT,
  stack         TEXT,
  detail        JSONB,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_errors_label_time
  ON public.client_errors (label, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_errors_workspace_time
  ON public.client_errors (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_errors_tier_time
  ON public.client_errors (tier, occurred_at DESC);

COMMENT ON TABLE public.client_errors IS
  'Item #10 Phase B (2026-05-17): browser-side error telemetry. '
  'Companion to ingest_write_failures. Fire-and-forget writes from '
  'lccReportError in app.js via /api/admin?_route=client-error.';

-- Convenience view: rolling 24h error volume by label.
CREATE OR REPLACE VIEW public.v_client_error_rollup AS
SELECT
  label,
  tier,
  count(*)                            AS total,
  count(DISTINCT user_email)          AS distinct_users,
  count(DISTINCT workspace_id)        AS distinct_workspaces,
  min(occurred_at)                    AS first_seen,
  max(occurred_at)                    AS last_seen,
  array_agg(DISTINCT code ORDER BY code) FILTER (WHERE code IS NOT NULL) AS sample_codes
FROM public.client_errors
WHERE occurred_at > now() - interval '24 hours'
GROUP BY label, tier
ORDER BY total DESC;
