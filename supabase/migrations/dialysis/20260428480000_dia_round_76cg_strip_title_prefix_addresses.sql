-- ============================================================================
-- Round 76cg — strip CoStar tab-title prefix from polluted addresses
--
-- Background: extension/content/costar.js had two related bugs that let
-- the browser tab title leak into the property address field:
--
-- 1. parseAddress() only checked the FIRST segment after splitting on
--    ' | ' — for CoStar titles like 'Properties | 215-225 S Allison Ave'
--    that's the section name, not the address.
-- 2. parseAddress() rejected number-range street addresses (e.g.
--    '215-225 S Allison Ave') because the regex required digit + space.
-- 3. The CONTEXT_DETECTED emit had `address: address || document.title`
--    — when parseAddress returned null, the raw title leaked through.
--
-- Forward fix in extension/content/costar.js (this round). This migration
-- backfills the 2 dia properties that picked up the prefix.
--
-- No clean siblings found, so just strip the prefix. Future captures from
-- those CoStar pages will refresh address with the clean form.
-- ============================================================================

UPDATE public.properties
   SET address = REGEXP_REPLACE(address, '^[A-Z][a-z]+ \| ', '')
 WHERE address ~ '^[A-Z][a-z]+ \| ';
