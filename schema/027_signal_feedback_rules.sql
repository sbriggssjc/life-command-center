-- ============================================================================
-- Migration 027: Signal Feedback Rules — Self-Improvement Loop Foundation
-- Life Command Center
--
-- Activates two learning loops using simple SQL rules (no ML):
--   1. Signal consumption → recommendation priority tuning
--   2. Template voice diff capture → learn from broker edits
--
-- Objects created:
--   VIEW  ignored_recommendation_contacts  — contacts consistently ignored
--   VIEW  high_performing_templates        — templates with high response rates
--   VIEW  slow_action_report               — slowest actions (automation candidates)
--   FUNC  get_contact_recommendation_weight — per-contact priority adjustment
--   TABLE template_refinements             — stores original vs sent text diffs
-- ============================================================================


-- =============================================================================
-- VIEW: Contacts where recommendations have been consistently ignored
-- =============================================================================

CREATE OR REPLACE VIEW ignored_recommendation_contacts AS
SELECT
  entity_id,
  COUNT(*) FILTER (WHERE signal_type = 'recommendation_ignored') AS ignored_count,
  COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on') AS acted_count,
  MAX(created_at) AS last_signal_at
FROM signals
WHERE entity_type = 'contact'
  AND signal_type IN ('recommendation_acted_on', 'recommendation_ignored')
  AND created_at > now() - interval '90 days'
GROUP BY entity_id
HAVING COUNT(*) FILTER (WHERE signal_type = 'recommendation_ignored') >= 3
   AND COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on') = 0;


-- =============================================================================
-- VIEW: Templates with high response rates (worth promoting)
-- =============================================================================

CREATE OR REPLACE VIEW high_performing_templates AS
SELECT
  payload->>'template_id' AS template_id,
  payload->>'template_name' AS template_name,
  COUNT(*) FILTER (WHERE signal_type = 'template_response') AS response_count,
  COUNT(*) FILTER (WHERE signal_type = 'template_sent') AS sent_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE signal_type = 'template_response') /
    NULLIF(COUNT(*) FILTER (WHERE signal_type = 'template_sent'), 0), 1
  ) AS response_rate_pct
FROM signals
WHERE signal_type IN ('template_sent', 'template_response')
  AND created_at > now() - interval '60 days'
  AND payload->>'template_id' IS NOT NULL
GROUP BY payload->>'template_id', payload->>'template_name'
HAVING COUNT(*) FILTER (WHERE signal_type = 'template_sent') >= 3
ORDER BY response_rate_pct DESC;


-- =============================================================================
-- VIEW: Action timing — slowest actions (candidates for automation)
-- =============================================================================

CREATE OR REPLACE VIEW slow_action_report AS
SELECT
  signal_type,
  COUNT(*) AS occurrence_count,
  ROUND(AVG((payload->>'duration_ms')::int), 0) AS avg_duration_ms,
  MAX((payload->>'duration_ms')::int) AS max_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY (payload->>'duration_ms')::int
  ) AS p95_duration_ms
FROM signals
WHERE payload->>'duration_ms' IS NOT NULL
  AND created_at > now() - interval '30 days'
GROUP BY signal_type
HAVING COUNT(*) >= 5
ORDER BY avg_duration_ms DESC
LIMIT 20;


-- =============================================================================
-- FUNCTION: Get recommendation adjustment factor for a contact
-- Returns 0.5 (deprioritize) if consistently ignored,
--         1.5 (boost) if high engagement,
--         1.0 (neutral) otherwise
-- =============================================================================

CREATE OR REPLACE FUNCTION get_contact_recommendation_weight(p_entity_id uuid)
RETURNS numeric AS $$
DECLARE
  v_ignored int;
  v_acted int;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE signal_type = 'recommendation_ignored'),
    COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on')
  INTO v_ignored, v_acted
  FROM signals
  WHERE entity_id = p_entity_id
    AND entity_type = 'contact'
    AND created_at > now() - interval '90 days';

  IF v_ignored >= 3 AND v_acted = 0 THEN RETURN 0.5; END IF;
  IF v_acted >= 3 AND v_ignored = 0 THEN RETURN 1.5; END IF;
  RETURN 1.0;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- TABLE: Template refinements — captures original vs sent text diffs
-- Used by the template voice diff capture loop in operations.js
-- =============================================================================

CREATE TABLE IF NOT EXISTS template_refinements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  template_id     text NOT NULL,
  original_draft  text,
  sent_text       text,
  was_edited      boolean DEFAULT false,
  edit_summary    jsonb,
  entity_id       uuid,
  domain          text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_refinements_template
  ON template_refinements(template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_refinements_workspace
  ON template_refinements(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_refinements_edited
  ON template_refinements(was_edited) WHERE was_edited = true;

ALTER TABLE template_refinements ENABLE ROW LEVEL SECURITY;
