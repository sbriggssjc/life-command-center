-- ============================================================================
-- Stage B Unit 0 — promotable client-pricing advisory store (DIALYSIS)
-- 2026-06-11 · written, NOT applied (Scott's independent gate applies it)
--
-- Mirror of the gov advisory store. Same two-destiny doctrine: client PRICING
-- advisories (ask/trade/recommended) write ONLY here and never to a reported
-- listing/asking/sale field; a confirmed listing may promote ask/recommended_cap
-- to reported via the Unit 2 gate. dia caps are NNN net-rent based (not NOI), so
-- the internal economic-cap analytics leg is gov-only (#64) — dia uses this store
-- for the client recommendation only. Additive, idempotent.
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
  promoted_at          timestamptz,
  promoted_listing_ref text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pva_property ON public.property_valuation_advisory(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pva_property_doc_type
  ON public.property_valuation_advisory(property_id, COALESCE(source_doc_id, 0), value_type);

COMMENT ON TABLE public.property_valuation_advisory IS
  'Stage B Unit 0 — promotable client-pricing advisories (ask/trade/recommended) from BOV/Master docs. Never feeds reported listing/asking/sale fields; promotion requires a confirmed listing (Unit 2 gate).';
