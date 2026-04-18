-- Add sold_price to dialysis available_listings so listing outcomes can be
-- audited and displayed without a JOIN into sales_transactions.
ALTER TABLE available_listings
  ADD COLUMN IF NOT EXISTS sold_price NUMERIC(15,2);

-- Backfill sold_price for already-closed listings by matching on
-- property_id + sold_date. Only rows with a confirmed sold_date and a
-- matching sales_transactions row get populated.
UPDATE available_listings al
SET sold_price = st.sold_price
FROM sales_transactions st
WHERE st.property_id = al.property_id
  AND al.sold_date IS NOT NULL
  AND st.sale_date = al.sold_date
  AND st.sold_price IS NOT NULL
  AND al.sold_price IS NULL;
