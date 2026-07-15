-- ============================================================================
-- dia v_owner_source_conflict — hold mortgage/DoT-grantee (lender) rows off the
-- owner-side auto-fix (2026-07-15)
--
-- DOCTRINE (Scott, 2026-07-15): "If it's a grantee in a mortgage or deed of
-- trust, route to the LENDER side. If it's a deed, the grantee is the BUYER →
-- owner side. Grantors enrich ownership history / contacts / signatories."
--
-- The forward capture path already keeps mortgage/DoT grantees OUT of
-- properties.latest_deed_grantee (sidebar-pipeline.js `latestDeedGranteeFromMetadata`
-- filters `MORTGAGE_DEED_TYPES`). But a handful of LEGACY stored values are
-- lender/mortgage parties with NO deed_records / metadata (0 rows), so we have no
-- stored instrument type to route on — grounded live, e.g. property 28051 "SG
-- Mortgage Finance Corp" (SG = the current owner Societe Generale's own finance
-- arm) and 26823 "Sumitomo Mitsui Banking Corporation". With the resolver fix
-- (owner_resolve_failed) deployed, the daily deed-autofix sweep would otherwise
-- repoint these clinics' fee owner to a LENDER.
--
-- FIX: exclude a lender/mortgage-instrument-NAMED grantee from `auto_fixable`
-- (the sweep's source of truth) — a name-anchored fallback ONLY where the sweep
-- has no instrument provenance. The row STAYS a conflict (human can still confirm
-- it via the Decision Center resolve_ownership `update_owner` verdict, which
-- bypasses auto_fixable), so this is a HOLD-for-confirm, not a drop. Safe
-- direction: a false-positive just means "human confirms" — a fee owner is never
-- named "…Mortgage Finance"/"…Banking Corporation".
--   • The shared JS `granteePassesOwnerGuards` is deliberately NOT touched — the
--     R59 deed path has the real deed_type and already filters mortgages; only the
--     sweep (bare latest_deed_grantee, no instrument) needs the name fallback.
--   • The sale-backed `stale_seller` grantees (Sumitomo Leasing, K&T Ranch) and
--     legit REIT SPEs (Realty Income Properties 17) still auto-apply — they are
--     buyer-side deeds per the doctrine.
-- Inline in the auto_fixable boolean → no output-column change → CREATE OR REPLACE
-- is clean/append-safe. Reversible: re-create the broker-parity body without the
-- lender clause. Applies on top of 20260716_dia_owner_conflict_broker_regex_parity.sql.
-- Apply on the Dialysis DB (zqzrriwuavgrquhisnoa).
--
-- FOLLOW-UP (the full doctrine, NOT in this migration): route a mortgage/DoT
-- grantee to the LENDER side (loans/lenders) + the grantor to ownership_history /
-- contacts / signatory enrichment. That is an ORE round touching the deed parser,
-- the capture pipeline, and the debt/contact tables — surfaced, not built here.
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
    ((kinded.conflict_kind = ANY (ARRAY['broker_as_owner'::text, 'stale_seller'::text])) OR kinded.conflict_kind = 'deed_newer_stale'::text AND kinded.latest_deed_date IS NOT NULL AND kinded.latest_deed_date >= (CURRENT_DATE - '2 years'::interval) AND NOT dia_owner_share_significant_token(kinded.recorded_owner_name, kinded.latest_deed_grantee)) AND kinded.grantee_passes_guards AND kinded.conflict_kind <> 'spe_vs_parent'::text AND NOT (kinded.latest_deed_grantee ~* '(\mmortgage\M|deed of trust|mortgage finance|home loans?|savings bank|banking corp(oration)?|\mbancorp\M|financial corp|\mfsb\M)'::text) AS auto_fixable
   FROM kinded;
