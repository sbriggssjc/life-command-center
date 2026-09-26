-- DUP-RECORDS1 / SALE-PROMOTER1-sidebar-feed (2026-09-26): the CoStar sidebar's sales_history rows reach
-- the domain promoters on a schedule.
--
-- The domain DBs cannot read LCC Opps, so SALE-PROMOTER1 loaded <dom>_sidebar_sale_candidate once, in a
-- session (audit docs/audits/SALE_PROMOTER1_2026-09-25.md §5). This makes that loader a function, and
-- api/_handlers/sidebar-sale-feed.js (POST /api/sidebar-sale-feed, cron below) pushes its rows with the
-- Railway service key. The promoters (gov 05:50, dia 05:52 UTC) then decide, through the shared
-- lcc_sale_candidate_verdict, whether each row is a sale they may record.
--
-- lcc_sidebar_sale_feed_rows(p_domain 'dia'|'gov', p_since date, p_limit)
--   One row per (asset entity, sales_history element) where the element carries a price, a party or a
--   recording fact and a date on/after p_since (default: 730 days, the promoter's own window).
--   row_key = ord || ':' || md5(element::text) — byte-identical to the in-session loader, so rows it
--   already staged are the same keys and the staging UNIQUE (entity_id, row_key) keeps a re-run at 0.
--   Dates: 'Mon D, YYYY', 'M/D/YYYY', ISO. Price: digits of a value that has any ("Not Disclosed" -> NULL).
--   sale_type is "<sale_type> / <transaction_type>", as the loader wrote it.
--   An entity with two asset ids on one domain (a duplicate property row not yet merged) yields its rows
--   once, on the lowest id; the promoter's civic-twin check does the rest.

CREATE OR REPLACE FUNCTION public.lcc_sidebar_parse_sale_date(p text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE s text := btrim(coalesce(p, ''));
BEGIN
  IF s ~ '^\d{4}-\d{2}-\d{2}' THEN RETURN left(s, 10)::date; END IF;
  IF s ~ '^[A-Za-z]{3,9}\.? \d{1,2}, \d{4}$' THEN RETURN to_date(replace(s, '.', ''), 'Mon DD, YYYY'); END IF;
  IF s ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN RETURN to_date(s, 'MM/DD/YYYY'); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.lcc_sidebar_parse_price(p text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN coalesce(p, '') ~ '\d'
              THEN nullif(regexp_replace(p, '[^0-9.]', '', 'g'), '')::numeric END
$fn$;

CREATE OR REPLACE FUNCTION public.lcc_sidebar_sale_feed_rows(
  p_domain text, p_since date DEFAULT (current_date - 730), p_limit integer DEFAULT 2000)
RETURNS TABLE(entity_id uuid, row_key text, property_id bigint, sale_date date, sale_price numeric,
              buyer text, seller text, sale_type text, deed_type text, document_number text,
              recordation_date date, comp_status text, price_status text, raw jsonb)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH ids AS (
    SELECT DISTINCT ON (ei.entity_id) ei.entity_id, ei.external_id::bigint AS property_id
      FROM public.external_identities ei
      JOIN public.entities e ON e.id = ei.entity_id AND e.merged_into_entity_id IS NULL
     WHERE ei.source_system = p_domain AND ei.source_type = 'asset' AND ei.external_id ~ '^\d+$'
       AND p_domain IN ('dia', 'gov')
       AND jsonb_typeof(e.metadata->'sales_history') = 'array'
     ORDER BY ei.entity_id, ei.external_id::bigint
  ), rows AS (
    SELECT i.entity_id, t.ord, t.x, i.property_id,
           public.lcc_sidebar_parse_sale_date(t.x->>'sale_date') AS sale_date,
           public.lcc_sidebar_parse_price(t.x->>'sale_price') AS sale_price
      FROM ids i
      JOIN public.entities e ON e.id = i.entity_id
      CROSS JOIN LATERAL jsonb_array_elements(e.metadata->'sales_history') WITH ORDINALITY t(x, ord)
     WHERE jsonb_typeof(t.x) = 'object'
  )
  SELECT r.entity_id, r.ord || ':' || md5(r.x::text), r.property_id, r.sale_date, r.sale_price,
         nullif(btrim(r.x->>'buyer'), ''), nullif(btrim(r.x->>'seller'), ''),
         nullif(concat_ws(' / ', nullif(btrim(r.x->>'sale_type'), ''), nullif(btrim(r.x->>'transaction_type'), '')), ''),
         nullif(btrim(r.x->>'deed_type'), ''), nullif(btrim(r.x->>'document_number'), ''),
         public.lcc_sidebar_parse_sale_date(r.x->>'recordation_date'),
         nullif(btrim(r.x->>'comp_status'), ''), nullif(btrim(r.x->>'price_status'), ''),
         jsonb_build_object('source', 'lcc_entities.metadata.sales_history', 'loaded_by', 'sidebar-sale-feed',
                            'sale_condition', r.x->>'sale_condition', 'transaction_type', r.x->>'transaction_type')
    FROM rows r
   WHERE r.sale_date IS NOT NULL AND r.sale_date >= p_since
     AND (r.sale_price IS NOT NULL
          OR nullif(btrim(r.x->>'buyer'), '') IS NOT NULL OR nullif(btrim(r.x->>'seller'), '') IS NOT NULL
          OR nullif(btrim(r.x->>'document_number'), '') IS NOT NULL
          OR public.lcc_sidebar_parse_sale_date(r.x->>'recordation_date') IS NOT NULL)
   ORDER BY r.sale_date DESC, r.entity_id, r.ord
   LIMIT greatest(coalesce(p_limit, 2000), 0)
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.lcc_sidebar_sale_feed_rows(text,date,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'DUP-RECORDS1: % still client-executable', f;
    END IF;
  END LOOP;
END $$;
