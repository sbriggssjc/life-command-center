-- ============================================================================
-- Round 76ax-B — Government auto-correct triggers (mirror dia)
--
-- 1. auto_supersede_expired_leases — when a new active lease lands on a
--    property, mark older leases whose expiration_date < new commencement
--    as superseded. Mirror of dia 76z trigger adapted for gov's
--    superseded_at + commencement_date / expiration_date columns.
--
-- 2. junk_buyer_seller filter on sales_transactions — BEFORE INSERT
--    rejects rows where buyer/seller looks like a brokerage name
--    (Cbre, Marcus & Millichap, NAI, "Company 1 X | Company 2 Y") or
--    a test fixture (__TEST*__). Defense-in-depth — JS layer should
--    catch first, but trigger is the last line.
--
-- Apply on government project (scknotsqkcheojiaewwh).
-- ============================================================================

-- ── 1. auto_supersede_expired_leases ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_supersede_expired_leases()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expiration_date IS NOT NULL AND NEW.expiration_date < CURRENT_DATE THEN
    RETURN NEW;
  END IF;

  IF NEW.commencement_date IS NOT NULL THEN
    UPDATE public.leases
       SET superseded_at = NOW()
     WHERE property_id = NEW.property_id
       AND lease_id <> NEW.lease_id
       AND superseded_at IS NULL
       AND expiration_date IS NOT NULL
       AND expiration_date < NEW.commencement_date;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_supersede_expired_leases ON public.leases;
CREATE TRIGGER trg_auto_supersede_expired_leases
  AFTER INSERT OR UPDATE OF commencement_date, expiration_date, superseded_at
  ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.auto_supersede_expired_leases();

-- ── 2. Junk buyer/seller filter on sales_transactions ─────────────────────
CREATE OR REPLACE FUNCTION public.gov_filter_junk_sales_party()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  junk_pat text := '^(cbre|marcus & millichap|jll|cushman( & wakefield)?|colliers( international)?|nai( [a-z]+)?|stream realty|kw commercial|newmark|capital pacific|northmarq|berkadia|matthews real estate|matthews|company \d+ .+|.* \| company \d+ .+|__test.*__|test_buyer|test_seller|n/a|none|null|tbd|unknown|placeholder)$';
BEGIN
  IF NEW.buyer IS NOT NULL AND lower(TRIM(NEW.buyer)) ~ junk_pat THEN
    NEW.buyer := NULL;
  END IF;
  IF NEW.seller IS NOT NULL AND lower(TRIM(NEW.seller)) ~ junk_pat THEN
    NEW.seller := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gov_filter_junk_sales_party ON public.sales_transactions;
CREATE TRIGGER trg_gov_filter_junk_sales_party
  BEFORE INSERT OR UPDATE OF buyer, seller
  ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.gov_filter_junk_sales_party();

-- One-shot cleanup of existing junk values
UPDATE public.sales_transactions SET buyer = NULL
  WHERE buyer IS NOT NULL
    AND lower(TRIM(buyer)) ~ '^(cbre|marcus & millichap|jll|cushman( & wakefield)?|colliers( international)?|nai( [a-z]+)?|stream realty|kw commercial|newmark|capital pacific|northmarq|berkadia|matthews real estate|matthews|company \d+ .+|.* \| company \d+ .+|__test.*__|test_buyer|test_seller|n/a|none|null|tbd|unknown|placeholder)$';

UPDATE public.sales_transactions SET seller = NULL
  WHERE seller IS NOT NULL
    AND lower(TRIM(seller)) ~ '^(cbre|marcus & millichap|jll|cushman( & wakefield)?|colliers( international)?|nai( [a-z]+)?|stream realty|kw commercial|newmark|capital pacific|northmarq|berkadia|matthews real estate|matthews|company \d+ .+|.* \| company \d+ .+|__test.*__|test_buyer|test_seller|n/a|none|null|tbd|unknown|placeholder)$';
