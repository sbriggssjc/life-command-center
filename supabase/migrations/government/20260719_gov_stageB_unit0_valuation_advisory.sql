-- ============================================================================
-- Stage B Unit 0 — promotable client-pricing advisory store (GOVERNMENT)
-- 2026-06-11 · written, NOT applied (Scott's independent gate applies it)
--
-- THE TWO-DESTINY SPLIT (Scott, 2026-06-11):
--   • Client PRICING advisories (ask / trade_low / trade_high / recommended_value
--     / recommended_cap) are recommendations to a client. They write ONLY here,
--     NEVER to a reported listing/asking/sale field. A CONFIRMED listing may
--     later PROMOTE `ask`/`recommended_cap` into reported asking_price/asking_cap
--     via the gated promotion path (Unit 2); `promoted_*` records that event.
--   • Internal valuation ANALYTICS (stabilized NOI, discount rate, economic/
--     implied cap) do NOT live here — they go to cap_rate_history /
--     property_financials (the #64 ledgers), permanently quarantined with NO
--     promotion path (the reported market cap is always the OBSERVED sale cap).
--
-- Additive, idempotent. BOV/Master price/cap is Unit 2; this is the destination
-- the extractor's write-path guard routes those values to.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.property_valuation_advisory (
  id                   bigserial PRIMARY KEY,
  property_id          bigint NOT NULL,
  source_doc_id        bigint,                 -- → property_documents.document_id
  doc_source           text NOT NULL CHECK (doc_source IN ('bov','master')),
  value_type           text NOT NULL CHECK (value_type IN
                         ('ask','trade_low','trade_high','recommended_value','recommended_cap')),
  amount               numeric,
  basis                text,
  as_of                date,
  confidence           numeric,
  source               text NOT NULL DEFAULT 'folder_feed_bov',
  -- Promotion (Unit 2) — set ONLY by the confirmation-gated promotion path.
  promoted_at          timestamptz,
  promoted_listing_ref text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pva_property ON public.property_valuation_advisory(property_id);
-- One open advisory per (property, doc, value_type) — re-extraction updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pva_property_doc_type
  ON public.property_valuation_advisory(property_id, COALESCE(source_doc_id, 0), value_type);

COMMENT ON TABLE public.property_valuation_advisory IS
  'Stage B Unit 0 — promotable client-pricing advisories (ask/trade/recommended) extracted from BOV/Master docs. INTERNAL/advisory: never feeds reported listing/asking/sale fields. Promotion to reported requires a confirmed listing (Unit 2 gate); promoted_* records it. Internal valuation analytics live in cap_rate_history/property_financials, never here.';
