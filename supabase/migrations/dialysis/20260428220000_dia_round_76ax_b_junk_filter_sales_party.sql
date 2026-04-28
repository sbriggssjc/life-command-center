-- ============================================================================
-- Round 76ax-B — Dialysis junk buyer/seller filter (defense in depth)
--
-- Mirror of gov 76ax-B trigger. JS-side isJunkTenant catches lease tenants;
-- this catches sales buyers/sellers (Cbre, Marcus & Millichap, brokerage
-- names, "Company 1 X | Company 2 Y", __TEST*__ test fixtures).
-- Also adds a property-level filter for the same junk patterns appearing
-- in recorded_owner_name / latest_deed_grantee / true_owner_name.
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_filter_junk_sales_party()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  junk_pat text := '^(cbre|marcus & millichap|jll|cushman( & wakefield)?|colliers( international)?|nai( [a-z]+)?|stream realty|kw commercial|newmark|capital pacific|northmarq|berkadia|matthews real estate|matthews|company \d+ .+|.* \| company \d+ .+|__test.*__|test_buyer|test_seller|n/a|none|null|tbd|unknown|placeholder)$';
BEGIN
  IF NEW.buyer_name IS NOT NULL AND lower(TRIM(NEW.buyer_name)) ~ junk_pat THEN
    NEW.buyer_name := NULL;
  END IF;
  IF NEW.seller_name IS NOT NULL AND lower(TRIM(NEW.seller_name)) ~ junk_pat THEN
    NEW.seller_name := NULL;
  END IF;
  IF NEW.recorded_owner_name IS NOT NULL AND lower(TRIM(NEW.recorded_owner_name)) ~ junk_pat THEN
    NEW.recorded_owner_name := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dia_filter_junk_sales_party ON public.sales_transactions;
CREATE TRIGGER trg_dia_filter_junk_sales_party
  BEFORE INSERT OR UPDATE OF buyer_name, seller_name, recorded_owner_name
  ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.dia_filter_junk_sales_party();

CREATE OR REPLACE FUNCTION public.dia_filter_junk_property_party()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  junk_pat text := '^(__test.*__|test_buyer|test_seller|n/a|none|null|tbd|unknown|placeholder)$';
BEGIN
  IF NEW.recorded_owner_name IS NOT NULL AND lower(TRIM(NEW.recorded_owner_name)) ~ junk_pat THEN
    NEW.recorded_owner_name := NULL;
  END IF;
  IF NEW.true_owner_name IS NOT NULL AND lower(TRIM(NEW.true_owner_name)) ~ junk_pat THEN
    NEW.true_owner_name := NULL;
  END IF;
  IF NEW.latest_deed_grantee IS NOT NULL AND lower(TRIM(NEW.latest_deed_grantee)) ~ junk_pat THEN
    NEW.latest_deed_grantee := NULL;
    NEW.latest_deed_date := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dia_filter_junk_property_party ON public.properties;
CREATE TRIGGER trg_dia_filter_junk_property_party
  BEFORE INSERT OR UPDATE OF recorded_owner_name, true_owner_name, latest_deed_grantee
  ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.dia_filter_junk_property_party();
