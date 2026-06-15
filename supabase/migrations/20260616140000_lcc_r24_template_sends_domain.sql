-- ============================================================================
-- R24 Unit 1 — close the template-learning loop's producer wire (2026-06-16)
-- ----------------------------------------------------------------------------
-- The template_sends producer (recordTemplateSend in api/_shared/templates.js +
-- the template-service edge function) wrote columns that don't exist on the
-- live table (user_id / domain / context_packet_id / rendered_* / final_*),
-- so EVERY send POST failed with PGRST204 and the whole template-learning loop
-- sat at 0 rows (template_sends, the high_performing_templates signal view, and
-- the weekly health-rollup all unfed). The JS/edge fix re-maps to the canonical
-- columns (sent_by / contact_id / entity_type / packet_snapshot_id /
-- subject_line_used).
--
-- The one column the code legitimately wants that the table lacks is `domain`
-- (the ?action=performance analytics select + the per-send signal payload both
-- key on it). Add it ADDITIVELY — additive + cache-or-live safe, so DB/Railway
-- deploy order is irrelevant: the writer simply starts populating it once both
-- land, and the performance read stops 400ing on the unknown select column.
--
-- Auth blast radius: none — template_sends is not in the auth schema, the
-- column is nullable with no default, no rewrite, no long lock.
-- ============================================================================

BEGIN;

ALTER TABLE public.template_sends
  ADD COLUMN IF NOT EXISTS domain text;

CREATE INDEX IF NOT EXISTS idx_template_sends_domain
  ON public.template_sends (domain, sent_at DESC);

COMMENT ON COLUMN public.template_sends.domain IS
  'R24 (2026-06-16): vertical/domain of the send (dia/gov/…). Powers the per-
   domain ?action=performance analytics and the template_sent signal payload.';

COMMIT;
