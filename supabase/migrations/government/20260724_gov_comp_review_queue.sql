-- Comps cap/rent reconciliation review queue (GOVERNMENT)
-- =============================================================================
-- Parity with dia_comp_review_queue (see the dialysis migration for the full
-- rationale). Government sales carry a separate NOI column, so the reconciliation
-- uses NOI (not RENT) as the displayed basis and `sold_cap_rate` as the reliable
-- cap-of-record -- but the shape + upsert contract are identical, so the shared
-- comps engine (mcp/comps-tools.js runComps -> enqueueReviewQueue) writes both
-- queues with one code path. Lower volume than dialysis; built for parity.
--
-- Upsert key: (sale_id, flags_hash). sale_id is TEXT (the gov PK is a uuid; TEXT
-- keeps the writer's single shape valid across both DBs). `status` is preserved on
-- upsert so a human disposition survives a re-pull.
--
-- Reversible: DROP TABLE public.gov_comp_review_queue CASCADE;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gov_comp_review_queue (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id          text NOT NULL,               -- gov sales_transactions.sale_id (uuid, as text)
  property_id      text,
  comp_id          text,
  flags            text[] NOT NULL DEFAULT '{}', -- cap_mismatch / rent_disagreement / price_over_ask / no_reliable_cap
  flags_hash       text NOT NULL,
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
  CONSTRAINT uq_gov_comp_review_sale_flags UNIQUE (sale_id, flags_hash)
);

COMMENT ON TABLE public.gov_comp_review_queue IS
  'Government comps cap/rent reconciliation worklist (parity with dia). Rows are upserted by the shared comps engine when a sold comp fails to reconcile (implied cap from NOI vs sold_cap_rate, disagreeing rent sources, or sold-vs-ask). Drain to correct NOI/cap at the source.';

CREATE INDEX IF NOT EXISTS ix_gov_comp_review_open
  ON public.gov_comp_review_queue (status, last_flagged_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_gov_comp_review_property
  ON public.gov_comp_review_queue (property_id);

CREATE OR REPLACE FUNCTION public.gov_comp_review_touch()
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

DROP TRIGGER IF EXISTS trg_gov_comp_review_touch ON public.gov_comp_review_queue;
CREATE TRIGGER trg_gov_comp_review_touch
  BEFORE UPDATE ON public.gov_comp_review_queue
  FOR EACH ROW EXECUTE FUNCTION public.gov_comp_review_touch();

GRANT SELECT ON public.gov_comp_review_queue TO anon, authenticated;
GRANT ALL    ON public.gov_comp_review_queue TO service_role;
