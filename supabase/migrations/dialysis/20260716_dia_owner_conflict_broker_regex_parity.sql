-- ============================================================================
-- dia v_owner_source_conflict — align the broker regex with the JS guard (2026-07-15)
--
-- ROOT CAUSE (Topic 1, debugged 2026-07-15): the deed-wins sweep
-- (handleOwnerDeedAutofix) drives off v_owner_source_conflict.auto_fixable, but
-- the view's broker regex was NARROWER than the JS `COMPETITOR_BROKER_RE`
-- (api/_shared/sf-nm-classifier.js) that granteePassesOwnerGuards actually
-- enforces at apply time. The view omitted nai / srs / ipa / mmi / kw / ay /
-- c&w / m&m, so a broker deed grantee like "Nai First Commercial Real Estate &
-- Advisory Services" (property 24325) passed the view's guard (auto_fixable=true)
-- but the JS sweep REFUSED it (grantee_failed_guards) — a perpetual false
-- auto_fixable that never applied. Consumption-Layer "honest count": the view's
-- auto_fixable must match what the sweep will accept.
--
-- FIX: mirror the JS `COMPETITOR_BROKER_RE` in BOTH regexes, with an asymmetric
-- posture matched to the direction of each guard's risk:
--   • grantee_passes_guards (negation) — FULL JS parity incl. the short
--     abbreviations (nai/srs/ipa/mmi/kw/ay/c&w/m&m). A false-reject here only
--     means "not auto-fixable → human confirms" (SAFE direction).
--   • is_broker_owner (flags the CURRENT recorded_owner as a broker → the deed
--     grantee wins → auto-repoint AWAY) — add only the DISTINCTIVE brokerage
--     acronyms (nai/srs/ipa/mmi/c&w/m&m); the bare 2-char ay/kw are omitted
--     because a false-positive here would auto-repoint away from a legit owner
--     (UNSAFE direction).
-- `\mnai\M` etc. are whole-word (Postgres `\m`/`\M`) so "Mount Sinai" is never
-- caught. Column list/order/types unchanged (CREATE OR REPLACE is append-safe).
-- Reversible: re-create the prior body (the 2026-06-20 R51 definition).
-- Apply on the Dialysis DB (zqzrriwuavgrquhisnoa).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_owner_source_conflict AS
 WITH base AS (
         SELECT p.property_id,
            p.recorded_owner_id,
            COALESCE(p.recorded_owner_name, ro.name) AS recorded_owner_name,
            p.latest_deed_grantee,
            p.latest_deed_date,
            COALESCE(p.true_owner_name, to2.name) AS true_owner_name,
            NULL::numeric AS annual_rent,
            p.address,
            p.city,
            p.state,
            lower(regexp_replace(COALESCE(COALESCE(p.recorded_owner_name, ro.name), ''::text), '[^a-z0-9]'::text, ''::text, 'gi'::text)) AS ro_norm,
            lower(regexp_replace(p.latest_deed_grantee, '[^a-z0-9]'::text, ''::text, 'gi'::text)) AS grantee_norm,
            lower(regexp_replace(COALESCE(COALESCE(p.true_owner_name, to2.name), ''::text), '[^a-z0-9]'::text, ''::text, 'gi'::text)) AS to_norm
           FROM properties p
             LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
             LEFT JOIN true_owners to2 ON to2.true_owner_id = p.true_owner_id
          WHERE p.latest_deed_grantee IS NOT NULL AND COALESCE(p.recorded_owner_name, ro.name) IS NOT NULL
        ), flagged AS (
         SELECT b.property_id,
            b.recorded_owner_id,
            b.recorded_owner_name,
            b.latest_deed_grantee,
            b.latest_deed_date,
            b.true_owner_name,
            b.annual_rent,
            b.address,
            b.city,
            b.state,
            b.ro_norm,
            b.grantee_norm,
            b.to_norm,
            b.recorded_owner_name ~* '(cushman|wakefield|c&w|colliers|cbre|newmark|\mjll\M|marcus\s*&?\s*millichap|\mm&m\M|\mmmi\M|institutional property advisors|\mipa\M|\msrs\M|avison young|\mnai\M|matthews|\msvn\M|keller williams|flagship|northmarq)'::text AS is_broker_owner,
            b.latest_deed_grantee !~* '(cushman|wakefield|c&w|colliers|cbre|newmark|\mjll\M|marcus\s*&?\s*millichap|\mm&m\M|\mmmi\M|institutional property advisors|\mipa\M|\msrs\M|avison young|\may\M|\mnai\M|matthews|flagship|\msvn\M|keller williams|\mkw\M)'::text AND b.latest_deed_grantee !~* '^\s*(u\s?\.?\s?s\s?\.?\s?a|united states|gsa|government|federal|n\.?/?a|unknown|none|tbd)\b'::text AND length(regexp_replace(b.latest_deed_grantee, '[^a-z0-9]'::text, ''::text, 'gi'::text)) >= 4 AND b.latest_deed_grantee ~ '[A-Za-z]'::text AS grantee_passes_guards,
            (EXISTS ( SELECT 1
                   FROM sales_transactions st
                  WHERE st.property_id = b.property_id AND lower(regexp_replace(COALESCE(st.seller_name, ''::character varying)::text, '[^a-z0-9]'::text, ''::text, 'gi'::text)) = b.ro_norm AND lower(regexp_replace(COALESCE(st.buyer_name, ''::character varying)::text, '[^a-z0-9]'::text, ''::text, 'gi'::text)) = b.grantee_norm)) AS is_stale_seller
           FROM base b
          WHERE b.ro_norm IS DISTINCT FROM b.grantee_norm
        ), kinded AS (
         SELECT f.property_id,
            f.recorded_owner_id,
            f.recorded_owner_name,
            f.latest_deed_grantee,
            f.latest_deed_date,
            f.true_owner_name,
            f.annual_rent,
            f.address,
            f.city,
            f.state,
            f.is_broker_owner,
            f.grantee_passes_guards,
            f.is_stale_seller,
                CASE
                    WHEN f.is_broker_owner THEN 'broker_as_owner'::text
                    WHEN f.to_norm <> ''::text AND f.ro_norm = f.to_norm THEN 'spe_vs_parent'::text
                    WHEN f.is_stale_seller THEN 'stale_seller'::text
                    ELSE 'deed_newer_stale'::text
                END AS conflict_kind
           FROM flagged f
        )
 SELECT 'dia'::text AS domain,
    kinded.property_id,
    kinded.recorded_owner_id,
    kinded.recorded_owner_name,
    kinded.latest_deed_grantee,
    kinded.latest_deed_date,
    kinded.true_owner_name,
    kinded.annual_rent,
    kinded.address,
    kinded.city,
    kinded.state,
    kinded.is_broker_owner,
    kinded.grantee_passes_guards,
    kinded.conflict_kind,
    ((kinded.conflict_kind = ANY (ARRAY['broker_as_owner'::text, 'stale_seller'::text])) OR kinded.conflict_kind = 'deed_newer_stale'::text AND kinded.latest_deed_date IS NOT NULL AND kinded.latest_deed_date >= (CURRENT_DATE - '2 years'::interval) AND NOT dia_owner_share_significant_token(kinded.recorded_owner_name, kinded.latest_deed_grantee)) AND kinded.grantee_passes_guards AND kinded.conflict_kind <> 'spe_vs_parent'::text AS auto_fixable
   FROM kinded;
