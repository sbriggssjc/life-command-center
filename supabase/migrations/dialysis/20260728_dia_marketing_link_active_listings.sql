-- ============================================================================
-- Dia — link the active Marketing-tab listings to their property records
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL / zqzrriwuavgrquhisnoa)
--
-- WHY: the Marketing tab's BD sections (B1 Area Ownership / B2 Regional / B3
-- Owners-in-Market) + property_geo anchor on the listing's linked property
-- (v_sjc_deal_book.linked_property_id -> getMarketingBd property_id).
--
-- WRITE TARGET (grounded live 2026-07-28): v_sjc_deal_book is DEAL-object-primary
-- (v_sjc_deal_ingest_current: sf_deal_staging UNION sjc_deal_ingest) with the
-- LISTING arm (sf_listing_staging) APPENDED only where a sf_deal_id/dedup_key is
-- not already covered by a deal row. So a listing's linked_property_id must be set
-- on whichever arm surfaces it:
--   * '0068W…' deals live in sf_deal_staging  -> deal arm  -> set sf_deal_staging.
--   * '006Vs…' deals are NOT in sf_deal_staging (listing-only) -> listing arm
--                                              -> set sf_listing_staging.
-- We set BOTH staging tables for the 9 mapped deals (belt-and-suspenders — the
-- link follows whichever arm the view uses; setting the non-surfacing arm is a
-- harmless no-op that keeps them consistent).
--
-- Durable: linked_property_id is NOT a Salesforce field, so the daily crawl does
-- not map it; sf-promotion-worker.resolvePropertyId() returns an existing
-- linked_property_id FIRST ('prelinked') and preserves it. (Confirmed by the
-- pre-existing Springfield/Queens links persisting across daily crawls.)
--
-- Mapping (deal -> property_id):
--   006Vs000009iQmPIAU  DaVita - Banning, CA          -> 35786 (geocoded)
--   006Vs000005IlYfIAK  DCi - Lafayette, LA           -> 35766 (geocoded)
--   006Vs00000IKRhfIAH  Innovative Renal - Milwaukee  -> 37744 (geocoded)
--   006Vs00000LCEcbIAH  DaVita - Succasunna, NJ       -> 27266 (geocoded)
--   0068W00000jee5VQAQ  DaVita - Tucson, AZ           -> 34043 (geocoded)
--   0068W00000jedsnQAA  DaVita - The Villages, FL     -> 31964 (geocoded)
--   0068W00000jeglKQAQ  DaVita - Omaha, NE            -> 31115 (needs geocode*)
--   0068W00000jeeRMQAY  DaVita - Queens, NY           -> 37224 (RE-LINK; was 40037,
--                                                       dangling / absent from
--                                                       properties. 37224 =
--                                                       "79-21 Queens Blvd",
--                                                       Elmhurst, DaVita, geocoded)
--   0068W00000jeeOKQAY  DaVita-Anchored - Springfield IL -> 40041 (keep; needs geocode*)
--   006Vs00000XqL8cIAF  Fresenius Portfolio 2 - Rome/Summerville GA -> DEFERRED
--                                                       (portfolio, no single address)
--
-- * Coords for 40041 (2936 S 6th St, Springfield IL) + 31115 (11425 W Dodge Rd,
--   Omaha NE): both properties.latitude IS NULL and there is NO geocoded clinic
--   record to copy from (medicare_clinics carries 0 geocoded rows — R50), so
--   coords are NOT set here (no fabrication). The active LCC-Opps cron
--   `lcc-geocode-backfill` (/api/geocode-tick, `4-59/10 * * * *`, Census + Google
--   fallback) geocodes any dia.properties WHERE latitude IS NULL and will fill
--   40041 + 31115 with real coords; B1/B3 light up for them once coords land.
--   The 7 already-geocoded deals are B1-ready immediately.
--
-- ADDITIVE + REVERSIBLE. Reverse:
--   UPDATE public.sf_deal_staging    SET linked_property_id = NULL WHERE sf_deal_id IN (<0068W set>) ;  -- (Queens back to 40037)
--   UPDATE public.sf_listing_staging SET linked_property_id = NULL WHERE sf_deal_id IN (<all 9>) ;
-- ============================================================================

-- Deal arm (sf_deal_staging) — the '0068W…' deals surface here.
UPDATE public.sf_deal_staging s
SET linked_property_id = m.pid,
    updated_at = now()
FROM (VALUES
  ('006Vs000009iQmPIAU', 35786),
  ('006Vs000005IlYfIAK', 35766),
  ('006Vs00000IKRhfIAH', 37744),
  ('006Vs00000LCEcbIAH', 27266),
  ('0068W00000jee5VQAQ', 34043),
  ('0068W00000jedsnQAA', 31964),
  ('0068W00000jeglKQAQ', 31115),
  ('0068W00000jeeRMQAY', 37224),
  ('0068W00000jeeOKQAY', 40041)
) AS m(sf_deal_id, pid)
WHERE s.sf_deal_id = m.sf_deal_id
  AND s.linked_property_id IS DISTINCT FROM m.pid
  AND EXISTS (SELECT 1 FROM public.properties p WHERE p.property_id = m.pid);

-- Listing arm (sf_listing_staging) — the '006Vs…' deals surface here (+ keeps the
-- '0068W…' listing rows consistent). Same mapping.
UPDATE public.sf_listing_staging s
SET linked_property_id = m.pid,
    updated_at = now()
FROM (VALUES
  ('006Vs000009iQmPIAU', 35786),
  ('006Vs000005IlYfIAK', 35766),
  ('006Vs00000IKRhfIAH', 37744),
  ('006Vs00000LCEcbIAH', 27266),
  ('0068W00000jee5VQAQ', 34043),
  ('0068W00000jedsnQAA', 31964),
  ('0068W00000jeglKQAQ', 31115),
  ('0068W00000jeeRMQAY', 37224),
  ('0068W00000jeeOKQAY', 40041)
) AS m(sf_deal_id, pid)
WHERE s.sf_deal_id = m.sf_deal_id
  AND s.linked_property_id IS DISTINCT FROM m.pid
  AND EXISTS (SELECT 1 FROM public.properties p WHERE p.property_id = m.pid);
