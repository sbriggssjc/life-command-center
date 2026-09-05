-- GOVDUP1 — gov property duplicates: three classes, one import, one review lane.
--
-- ============================================================================
-- UNIT 1 — retire the class-A empty-husk fan-out (154 rows, one address)
-- ============================================================================
--
-- Producer: NOT this repo's code. `pending_updates.reason` on every one of the
-- 154 husks reads, verbatim, "Salesforce auto-created property — verify
-- accuracy and check for duplicates" (field_name='_new_property',
-- new_value carries sf_property_id='a068W00000FbBqwQAF', sf_state=null,
-- sf_zip='5701', a FRESH sf_property_staging.staging_id every hour from
-- 2026-07-31 05:37 to 2026-08-06 14:38, then never again). This is the
-- Salesforce Property__c staging→auto-create path the Dialysis repo's
-- `clean_pending_updates.py` comments call "the property-creation path" —
-- but its SOURCE WAS NOT FOUND in any of the three repos this session can
-- read (life-command-center, Dialysis, government-lease). Ruled out:
--   - gov DB: no SQL function's body contains '_new_property',
--     'Salesforce auto-created', or an INSERT INTO properties keyed off
--     sf_property_staging (censused via pg_get_functiondef over every
--     public function, prokind='f').
--   - LCC repo: supabase/functions/intake-salesforce/index.ts (linkProbe)
--     and supabase/functions/sf-promotion-worker/index.ts both read/PATCH
--     sf_property_staging but never INSERT INTO properties nor write
--     '_new_property' anywhere in either file.
--   - Dialysis repo: src/clean_pending_updates.py references the
--     '_new_property' PSEUDO-FIELD by name in comments (as a CONSUMER
--     deciding the field is unreconcilable) but is not itself a writer.
-- The mechanism is legible even though the code is not: `sf_state=null`
-- and `sf_zip='5701'` (leading zero stripped — an int-cast) defeat every
-- address/city/state match against the REAL property for this location
-- (gov property_id 15100, "1085 Us Route 4 E", Rutland, VT, 05701-8815,
-- already linked to GSA lease LVT04811), so each hourly re-staging of the
-- same Salesforce record could never find its own prior create and minted
-- a fresh one. The loop stopped when the staging row's process_status
-- finally reached a terminal state (2026-08-06); no husk has been created
-- since, and no cron in this database (`cron.job`) runs the SF property
-- crawl on an hourly cadence today.
--
-- NOT unreferenced (checked every table/view column named *property_id*
-- in the schema, not just the FK-declared ones — the P177/P182 lesson):
-- every one of the 154 carries exactly one `investment_scores` row (the
-- scoring pipeline runs on every INSERT) and exactly one `pending_updates`
-- row (the '_new_property' advisory itself). Both are downstream
-- consequences of the create, never inputs to it, and neither blocks a
-- disposal — `investment_scores.property_id` and `pending_updates.property_id`
-- both carry ON DELETE behavior via the FK census above; this migration
-- does not delete anything, so neither is disturbed.
--
-- Disposition: RETIRE, not merge. None of the 154 is the real property —
-- the real one (15100) is a separate, already-correct row outside this
-- group — so there is no survivor to keep. Reversible: status flips to
-- 'archived' (the existing gov convention; archived rows are already
-- excluded from every per-property portfolio view since R17), tagged so
-- the batch can be found and undone. `pending_updates` rows are left
-- alone — R-auto-apply already treats `_new_property` as out-of-scope for
-- any automated action (CLAUDE.md §15), and archiving the property does
-- not resolve or invalidate the advisory; a human still owns that call.

CREATE TABLE IF NOT EXISTS public.gov_property_dup_retire_log (
  id            bigserial PRIMARY KEY,
  batch_tag     text NOT NULL,
  property_id   bigint NOT NULL,
  prior_status  text,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_batch text := 'govdup1_classA_husk_retire_20260905';
BEGIN
  INSERT INTO public.gov_property_dup_retire_log (batch_tag, property_id, prior_status, reason)
  SELECT v_batch, property_id, status, 'govdup1_class_a_empty_husk_fanout'
  FROM public.properties
  WHERE data_source = 'unknown_writer'
    AND address = '1085 Route 4 E'
    AND city = 'Rutland'
    AND status <> 'archived';

  UPDATE public.properties
  SET status = 'archived',
      notes = COALESCE(notes || E'\n', '') || 'govdup1: retired class-A empty-husk (batch govdup1_classA_husk_retire_20260905, 2026-09-05)'
  WHERE data_source = 'unknown_writer'
    AND address = '1085 Route 4 E'
    AND city = 'Rutland'
    AND status <> 'archived';
END $$;

-- REVERSAL: UPDATE public.properties p SET status = l.prior_status
--   FROM public.gov_property_dup_retire_log l
--   WHERE l.batch_tag = 'govdup1_classA_husk_retire_20260905' AND p.property_id = l.property_id;

-- ============================================================================
-- UNIT 2 — the review lane for classes B (punctuation-only) and C (city-variant)
-- ============================================================================
--
-- Key = regexp_replace(lower(address),'[^a-z0-9]','','g') + state. This is
-- the WIDER key (399 groups / 953 properties vs 132 / 419 on an exact-string
-- key) — the 267-group difference is punctuation-only, same-city duplicates
-- the exact key cannot see (GOVDUP1 §1/§2a). Class A (the one group of 154,
-- retired above) is excluded by construction: it requires >1 DISTINCT
-- created_at day per group member OR simply excludes any group whose
-- members are all `unknown_writer` + now-archived.

CREATE OR REPLACE VIEW public.v_gov_property_duplicate_group_key AS
SELECT
  property_id,
  address,
  city,
  state,
  zip_code,
  data_source,
  created_at,
  agency,
  status,
  recorded_owner_id,
  regexp_replace(lower(address), '[^a-z0-9]', '', 'g') AS norm_addr,
  lower(trim(address)) AS exact_addr
FROM public.properties
WHERE coalesce(status, '') <> 'archived'
  AND length(address) >= 8;

-- Reject a group whose address is a non-specific placeholder (e.g. an
-- airport-only string with no street component) — §1/Unit 2 of the prompt:
-- "international airport" collapsed two DIFFERENT airports in different
-- cities/states into one "duplicate" group. A narrow, anchored exclusion
-- list, never a general fuzzy filter.
CREATE OR REPLACE FUNCTION public.gov_dup_review_address_is_placeholder(p_address text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_address IS NULL
    OR trim(p_address) = ''
    OR lower(trim(p_address)) IN ('international airport', 'airport', 'n/a', 'unknown', 'tbd');
$$;

-- Zip agreement: a zip must carry >= 4 digits before it is padded to 5 —
-- lpad('',5,'0') = '00000', which is a PRESENT, DISAGREEING zip, not a
-- missing one (the §2b trap this prompt names explicitly). Keep MISSING a
-- third state, never folded into DIFFERS (P180).
CREATE OR REPLACE FUNCTION public.gov_dup_review_normalize_zip5(p_zip text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_zip IS NULL THEN NULL
    WHEN length(regexp_replace(p_zip, '[^0-9]', '', 'g')) < 4 THEN NULL
    ELSE left(lpad(regexp_replace(p_zip, '[^0-9]', '', 'g'), 5, '0'), 5)
  END;
$$;

DROP VIEW IF EXISTS public.v_gov_property_duplicate_review;
CREATE OR REPLACE VIEW public.v_gov_property_duplicate_review AS
WITH norm AS (
  SELECT * FROM public.v_gov_property_duplicate_group_key
  WHERE NOT public.gov_dup_review_address_is_placeholder(address)
),
groups AS (
  SELECT
    norm_addr,
    state,
    count(*) AS member_count,
    count(DISTINCT exact_addr) AS distinct_exact_strings,
    array_agg(property_id ORDER BY property_id) AS member_property_ids
  FROM norm
  GROUP BY norm_addr, state
  HAVING count(*) > 1
),
members AS (
  SELECT
    g.norm_addr, g.state, g.member_count, g.distinct_exact_strings, g.member_property_ids,
    n.property_id, n.address, n.city, n.zip_code, n.data_source, n.created_at, n.agency,
    public.gov_dup_review_normalize_zip5(n.zip_code) AS zip5,
    exists (SELECT 1 FROM public.leases l WHERE l.property_id = n.property_id)
      OR exists (SELECT 1 FROM public.sales_transactions st WHERE st.property_id = n.property_id)
      OR exists (SELECT 1 FROM public.available_listings al WHERE al.property_id = n.property_id)
      OR exists (SELECT 1 FROM public.property_documents pd WHERE pd.property_id = n.property_id)
      OR n.recorded_owner_id IS NOT NULL
    AS has_attachment
  FROM groups g
  JOIN norm n ON n.norm_addr = g.norm_addr AND n.state IS NOT DISTINCT FROM g.state
),
member_agg AS (
  SELECT
    m.norm_addr, m.state, m.member_count, m.distinct_exact_strings, m.member_property_ids,
    jsonb_agg(jsonb_build_object(
      'property_id', m.property_id,
      'address', m.address,
      'city', m.city,
      'zip_code', m.zip_code,
      'zip5', m.zip5,
      'data_source', m.data_source,
      'created_at', m.created_at,
      'agency', m.agency,
      'has_attachment', m.has_attachment
    ) ORDER BY m.property_id) AS members_json,
    count(DISTINCT nullif(m.zip5, NULL)) FILTER (WHERE m.zip5 IS NOT NULL) AS distinct_zip5,
    count(*) FILTER (WHERE m.zip5 IS NOT NULL) AS n_zip_present,
    count(*) FILTER (WHERE m.zip5 IS NULL) AS n_zip_missing,
    count(DISTINCT nullif(m.agency, '')) FILTER (WHERE m.agency IS NOT NULL AND m.agency <> '') AS distinct_agency,
    count(*) FILTER (WHERE m.agency IS NOT NULL AND m.agency <> '') AS n_agency_present,
    count(*) FILTER (WHERE m.agency IS NULL OR m.agency = '') AS n_agency_missing,
    bool_or(m.has_attachment) AS any_has_attachment,
    count(*) FILTER (WHERE m.has_attachment) AS n_with_attachment
  FROM members m
  GROUP BY m.norm_addr, m.state, m.member_count, m.distinct_exact_strings, m.member_property_ids
)
SELECT
  norm_addr,
  state,
  member_count,
  -- distinct_exact_strings = 1 -> every member's raw address string is
  -- BYTE-IDENTICAL (class A/C: same string, different property row).
  -- distinct_exact_strings > 1 -> the strings differ only by punctuation
  -- (class B: '1000 Terminal Dr' vs '1000 Terminal Dr.'), the highest-
  -- precision subset measured in GOVDUP1 (267 groups, all same city+state).
  CASE WHEN distinct_exact_strings = 1 THEN 'exact' ELSE 'punctuation_only' END AS address_match,
  member_property_ids,
  members_json,
  -- Zip corroboration — three states, never two.
  CASE
    WHEN n_zip_present < 2 THEN 'zip_not_comparable'
    WHEN distinct_zip5 = 1 THEN 'zip_agrees'
    ELSE 'zip_differs'
  END AS zip_signal,
  n_zip_present,
  n_zip_missing,
  -- Agency corroboration — same three-state shape.
  CASE
    WHEN n_agency_present < 2 THEN 'agency_not_comparable'
    WHEN distinct_agency = 1 THEN 'agency_agrees'
    ELSE 'agency_differs'
  END AS agency_signal,
  n_agency_present,
  n_agency_missing,
  any_has_attachment,
  n_with_attachment,
  -- verdict_hint is guidance only — the prompt is explicit that EVERY group
  -- still needs a human verdict; gov's merge is a hard delete with only
  -- partial-restore reversibility, a strictly higher bar than dia's.
  CASE
    WHEN distinct_exact_strings > 1 THEN 'merge'   -- class B: punctuation-only, highest measured precision
    WHEN n_zip_present >= 2 AND distinct_zip5 > 1 THEN 'review'  -- disagreeing zip: could be real dupes OR two places
    ELSE 'review'
  END AS verdict_hint
FROM member_agg;

COMMENT ON VIEW public.v_gov_property_duplicate_review IS
  'GOVDUP1 Unit 2 — human review lane for gov property-address duplicate '
  'groups (classes B + C). Key: regexp_replace(lower(address),''[^a-z0-9]'','''',''g'') '
  '+ state. Every row needs a human verdict; nothing here merges. Class A '
  '(the empty-husk fan-out) is excluded because it is retired (status=''archived'') '
  'by the companion Unit 1 migration in this file.';
