-- ============================================================================
-- Round 76bp — Dia state-code normalization + sub-$50K sale cleanup
--
-- Two more sanity issues from audit:
--
-- 1. 5 properties had full state names ("GEORGIA", "ILLINOIS", "CALIFORNIA",
--    "OHIO") instead of 2-letter codes. Round 76bj's BEFORE INSERT/UPDATE
--    trigger applied UPPER(trim(state)) but didn't convert long names.
--    Convert all 50 + DC from full name → 2-letter code. Add CHECK
--    constraint enforcing ^[A-Z]{2}$.
--
-- 2. 16 sales had sold_price < $50,000 — clearly parser errors:
--      sale 6303: sold_price = $1.30 (Pineview Drive)
--      sale 7992: $1.40 same property (different sale_date)
--      sale 7670: $10.00 Dallas TX 78244
--      sale 5000: $356.71 (SMBC Leasing/Platform Ventures)
--      sale 8312: $4.29 (already excluded)
--    These are stored per-SF or rent values that landed in sold_price.
--    Set sold_price=NULL + exclude_from_market_metrics=TRUE. Add CHECK
--    constraint sold_price >= $50K (or NULL).
--
-- 3. 1 sale > $100M ($123M Cousins/Tier REIT 2017) — REIT portfolio
--    acquisition price attributed to one property. Mark exclude.
-- ============================================================================

-- 1. State code normalization
UPDATE public.properties SET state = CASE upper(state)
  WHEN 'ALABAMA' THEN 'AL' WHEN 'ALASKA' THEN 'AK' WHEN 'ARIZONA' THEN 'AZ' WHEN 'ARKANSAS' THEN 'AR'
  WHEN 'CALIFORNIA' THEN 'CA' WHEN 'COLORADO' THEN 'CO' WHEN 'CONNECTICUT' THEN 'CT' WHEN 'DELAWARE' THEN 'DE'
  WHEN 'FLORIDA' THEN 'FL' WHEN 'GEORGIA' THEN 'GA' WHEN 'HAWAII' THEN 'HI' WHEN 'IDAHO' THEN 'ID'
  WHEN 'ILLINOIS' THEN 'IL' WHEN 'INDIANA' THEN 'IN' WHEN 'IOWA' THEN 'IA' WHEN 'KANSAS' THEN 'KS'
  WHEN 'KENTUCKY' THEN 'KY' WHEN 'LOUISIANA' THEN 'LA' WHEN 'MAINE' THEN 'ME' WHEN 'MARYLAND' THEN 'MD'
  WHEN 'MASSACHUSETTS' THEN 'MA' WHEN 'MICHIGAN' THEN 'MI' WHEN 'MINNESOTA' THEN 'MN' WHEN 'MISSISSIPPI' THEN 'MS'
  WHEN 'MISSOURI' THEN 'MO' WHEN 'MONTANA' THEN 'MT' WHEN 'NEBRASKA' THEN 'NE' WHEN 'NEVADA' THEN 'NV'
  WHEN 'NEW HAMPSHIRE' THEN 'NH' WHEN 'NEW JERSEY' THEN 'NJ' WHEN 'NEW MEXICO' THEN 'NM' WHEN 'NEW YORK' THEN 'NY'
  WHEN 'NORTH CAROLINA' THEN 'NC' WHEN 'NORTH DAKOTA' THEN 'ND' WHEN 'OHIO' THEN 'OH' WHEN 'OKLAHOMA' THEN 'OK'
  WHEN 'OREGON' THEN 'OR' WHEN 'PENNSYLVANIA' THEN 'PA' WHEN 'RHODE ISLAND' THEN 'RI' WHEN 'SOUTH CAROLINA' THEN 'SC'
  WHEN 'SOUTH DAKOTA' THEN 'SD' WHEN 'TENNESSEE' THEN 'TN' WHEN 'TEXAS' THEN 'TX' WHEN 'UTAH' THEN 'UT'
  WHEN 'VERMONT' THEN 'VT' WHEN 'VIRGINIA' THEN 'VA' WHEN 'WASHINGTON' THEN 'WA' WHEN 'WEST VIRGINIA' THEN 'WV'
  WHEN 'WISCONSIN' THEN 'WI' WHEN 'WYOMING' THEN 'WY' WHEN 'DISTRICT OF COLUMBIA' THEN 'DC'
  ELSE state
END
WHERE state IS NOT NULL AND length(state) > 2;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_state_two_letter;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_state_two_letter
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$') NOT VALID;
ALTER TABLE public.properties VALIDATE CONSTRAINT properties_state_two_letter;

-- 2. Sub-$50K sales cleanup
UPDATE public.sales_transactions
   SET exclude_from_market_metrics = TRUE,
       sold_price = NULL
 WHERE sold_price > 0 AND sold_price < 50000;

-- 3. >$100M REIT-portfolio sale exclude
UPDATE public.sales_transactions
   SET exclude_from_market_metrics = TRUE
 WHERE sale_id = 6726;

ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_sold_price_realistic;
ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_sold_price_realistic
  CHECK (sold_price IS NULL OR sold_price >= 50000) NOT VALID;
ALTER TABLE public.sales_transactions VALIDATE CONSTRAINT sales_transactions_sold_price_realistic;

REFRESH MATERIALIZED VIEW public.v_sales_comps;
