-- Comps cap/rent reconciliation review queue (DIALYSIS)
-- =============================================================================
-- Team Briggs policy is "deliver the most accurate information we have." A sold
-- comp whose DISPLAYED rent doesn't reconcile to its reliable cap (e.g. Pearland
-- dia sale_id 7980: template SOLD CAP = RENT/PRICE = 4.40% but cap_rate_final =
-- 7.00% and rent_at_sale disagrees with the in-place rent) is an OUTLIER that
-- must be flagged at comps-generation time and routed HERE for SOURCE correction
-- -- not silently shipped, and not silently "fixed" by swapping the rent basis.
--
-- The shared comps engine (mcp/comps-tools.js runComps -> enqueueReviewQueue)
-- upserts a row here whenever a sold comp trips a reconciliation flag. This is
-- the worklist the dialysis workflow drains to correct rent/cap at the source so
-- future pulls come out clean. Non-destructive: the comp still ships (annotated
-- with review_flags/review_detail); this table only records the divergence.
--
-- Upsert key: (sale_id, flags_hash) so re-pulls don't duplicate. sale_id/property_id
-- are TEXT (portable across the int dia PK and the uuid gov PK; the writer sends
-- one shape for both queues). `status` is preserved on upsert, so a human's
-- resolved/dismissed disposition survives a re-pull; the refreshed numbers update.
--
-- Reversible: DROP TABLE public.dia_comp_review_queue CASCADE;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.dia_comp_review_queue (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id          text NOT NULL,               -- dia sales_transactions.sale_id (as text)
  property_id      text,
  comp_id          text,                         -- e.g. 'dia_db:7980'
  flags            text[] NOT NULL DEFAULT '{}', -- cap_mismatch / rent_disagreement / price_over_ask / no_reliable_cap
  flags_hash       text NOT NULL,                -- sorted flags joined by ',' (upsert key)
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {implied_cap, reliable_cap, rents{...}, ask, sold}
  implied_cap      numeric,
  reliable_cap     numeric,
  address          text,
  city             text,
  state            text,
  tenant           text,
  sale_date        date,
  sale_price       numeric,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','resolved','dismissed')),
  first_flagged_at timestamptz NOT NULL DEFAULT now(),
  last_flagged_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution_note  text,
  CONSTRAINT uq_dia_comp_review_sale_flags UNIQUE (sale_id, flags_hash)
);

COMMENT ON TABLE public.dia_comp_review_queue IS
  'Dialysis comps cap/rent reconciliation worklist. Rows are upserted by the shared comps engine when a sold comp fails to reconcile (implied cap vs reliable cap_rate_final, disagreeing rent sources, or sold-vs-ask). Drain to correct rent/cap at the source.';

CREATE INDEX IF NOT EXISTS ix_dia_comp_review_open
  ON public.dia_comp_review_queue (status, last_flagged_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_dia_comp_review_property
  ON public.dia_comp_review_queue (property_id);

-- Bump last_flagged_at on every re-flag (upsert), and stamp resolved_at when a
-- human moves the row off 'open'. first_flagged_at is preserved (never in the
-- writer payload).
CREATE OR REPLACE FUNCTION public.dia_comp_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.last_flagged_at := now();
  IF NEW.status = 'open' THEN
    NEW.resolved_at := NULL;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dia_comp_review_touch ON public.dia_comp_review_queue;
CREATE TRIGGER trg_dia_comp_review_touch
  BEFORE UPDATE ON public.dia_comp_review_queue
  FOR EACH ROW EXECUTE FUNCTION public.dia_comp_review_touch();

-- Read access for the app worklist; writes come from the MCP comps engine via
-- the service role (which bypasses RLS). No PII in this table.
GRANT SELECT ON public.dia_comp_review_queue TO anon, authenticated;
GRANT ALL    ON public.dia_comp_review_queue TO service_role;
