-- Prompt 17 - dia Northmarq broker-role integrity
--
-- Fixes two surfaced defects:
--   1. Keep sale_brokers able to retain third-party broker evidence as
--      role='as_reported_listing' without overwriting the canonical
--      sales_transactions.listing_broker field.
--   2. Ensure the sale_brokers -> is_northmarq maintenance trigger only treats
--      canonical Northmarq listing/procuring/co-broker evidence as flag-worthy,
--      not third-party as-reported rows.
--   3. Persist Scott-confirmed property 35724 / sale 14832 corrections:
--      Northmarq sell-side flag + Team Briggs broker, with CBRE retained as
--      as-reported listing evidence.

ALTER TABLE public.sale_brokers
  DROP CONSTRAINT IF EXISTS sale_brokers_role_check;

ALTER TABLE public.sale_brokers
  ADD CONSTRAINT sale_brokers_role_check
  CHECK (role IN ('listing', 'procuring', 'co_broker', 'as_reported_listing'));

CREATE OR REPLACE FUNCTION public.sale_brokers_set_is_northmarq()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_name text;
BEGIN
  IF NEW.role NOT IN ('listing', 'procuring', 'co_broker') THEN
    RETURN NEW;
  END IF;

  SELECT broker_name INTO v_name FROM public.brokers WHERE broker_id = NEW.broker_id;
  IF public.lcc_is_nm_broker(v_name) THEN
    UPDATE public.sales_transactions
       SET is_northmarq = true,
           is_northmarq_source = COALESCE(is_northmarq_source, 'sale_brokers_roster')
     WHERE sale_id = NEW.sale_id
       AND is_northmarq IS NOT TRUE;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sale_brokers_set_is_northmarq ON public.sale_brokers;
CREATE TRIGGER trg_sale_brokers_set_is_northmarq
  AFTER INSERT OR UPDATE OF broker_id, role ON public.sale_brokers
  FOR EACH ROW EXECUTE FUNCTION public.sale_brokers_set_is_northmarq();

CREATE TABLE IF NOT EXISTS public.prompt17_northmarq_flag_audit_20260802 (
  sale_id integer PRIMARY KEY,
  property_id integer,
  prior_is_northmarq boolean,
  prior_is_northmarq_source text,
  prior_listing_broker text,
  prior_updated_at timestamptz DEFAULT now(),
  audit_reason text NOT NULL
);

INSERT INTO public.prompt17_northmarq_flag_audit_20260802 (
  sale_id, property_id, prior_is_northmarq, prior_is_northmarq_source, prior_listing_broker, audit_reason
)
SELECT sale_id, property_id, is_northmarq, is_northmarq_source, listing_broker,
       'Scott-confirmed Team Briggs / Northmarq sell-side sale; Prompt 17'
  FROM public.sales_transactions
 WHERE sale_id = 14832
ON CONFLICT (sale_id) DO NOTHING;

UPDATE public.sales_transactions
   SET is_northmarq = true,
       is_northmarq_buyside = false,
       is_northmarq_source = 'salesforce_internal_comp',
       listing_broker = 'Team Briggs / Northmarq'
 WHERE sale_id = 14832
   AND (
     is_northmarq IS NOT TRUE
     OR is_northmarq_buyside IS DISTINCT FROM false
     OR is_northmarq_source IS DISTINCT FROM 'salesforce_internal_comp'
     OR listing_broker IS DISTINCT FROM 'Team Briggs / Northmarq'
   );

WITH existing_nm_broker AS (
  SELECT broker_id
    FROM public.brokers
   WHERE normalized_name = 'team briggs northmarq'
   LIMIT 1
),
inserted_nm_broker AS (
  INSERT INTO public.brokers (broker_name, company, normalized_name)
  SELECT 'Team Briggs / Northmarq', 'Northmarq', 'team briggs northmarq'
  WHERE NOT EXISTS (SELECT 1 FROM existing_nm_broker)
  RETURNING broker_id
),
nm_broker AS (
  SELECT broker_id FROM existing_nm_broker
  UNION ALL
  SELECT broker_id FROM inserted_nm_broker
)
INSERT INTO public.sale_brokers (sale_id, broker_id, role)
SELECT 14832, broker_id, 'listing' FROM nm_broker
WHERE NOT EXISTS (
  SELECT 1 FROM public.sale_brokers sb
   WHERE sb.sale_id = 14832
     AND sb.broker_id = nm_broker.broker_id
     AND sb.role = 'listing'
);

WITH existing_cbre_broker AS (
  SELECT broker_id
    FROM public.brokers
   WHERE normalized_name = 'chris bodnar cbre'
   LIMIT 1
),
inserted_cbre_broker AS (
  INSERT INTO public.brokers (broker_name, company, normalized_name)
  SELECT 'Chris Bodnar / CBRE Inc.', 'CBRE Inc.', 'chris bodnar cbre'
  WHERE NOT EXISTS (SELECT 1 FROM existing_cbre_broker)
  RETURNING broker_id
),
cbre_broker AS (
  SELECT broker_id FROM existing_cbre_broker
  UNION ALL
  SELECT broker_id FROM inserted_cbre_broker
)
INSERT INTO public.sale_brokers (sale_id, broker_id, role)
SELECT 14832, broker_id, 'as_reported_listing' FROM cbre_broker
WHERE NOT EXISTS (
  SELECT 1 FROM public.sale_brokers sb
   WHERE sb.sale_id = 14832
     AND sb.broker_id = cbre_broker.broker_id
     AND sb.role = 'as_reported_listing'
);
