-- UX-T1a-mirror-dia-lease (dia half) — expose lease dates on the mirror's source view.
--
-- WHY: `lcc_property_attributes` held NO lease dates for dia at ALL — 0 of 17,225 rows
-- carried lease_commencement / lease_expiration / firm_term_remaining / term_remaining,
-- so the doctrine's "newer lease" gate (operator-doctrine 1.8.0 §0b.1) was structurally
-- uncomputable for the whole dia swimlane. gov's copy of THIS view carries all four
-- columns; dia's never had them. The break is HERE, at the source view -- not in
-- `lcc_mirror_tick`'s select list and not in the apply function (both are fixed in the
-- LCC-side companion migration 20261007120000).
--
-- The data was never missing: dia `leases` holds 12,832 rows, 3,823 future-dated.
-- `dia.properties.wavg_lease_expiration` / `wavg_firm_term_expiration` are NULL on all
-- 11,802 and `properties.lease_commencement` is populated on 710 (6%) -- which is why
-- this derives from `leases` rather than from the `properties` columns named for it.
--
-- APPEND-ONLY: `CREATE OR REPLACE VIEW` cannot insert a column mid-list (42P16), so the
-- six new columns go at the END. Column 1..18 are byte-identical to the prior body.
--
-- ⚠️ THE EXISTING RENT LATERAL IS NOT TOUCHED. `l` selects by
-- (is_active, leased_area, lease_start) and does NOT filter `superseded_at` -- that is the
-- value basis the queue already consumes, and re-pointing it is out of scope. The lease
-- DATES get their own lateral (`lz`) with the correct in-effect selection, so there is one
-- owner per column set rather than two questions answered by one ORDER BY.
--
-- ⚠️ SUPERSEDED LEASES ARE EXCLUDED, and that is what makes the honest ceiling 1,747
-- properties rather than the 1,940 the Part A audit reported. That 1,940 counts 1,986
-- SUPERSEDED rows -- a lease that has been replaced is not the lease in effect. Measured
-- 2026-09-03: 1,940 properties have a future-dated lease of any kind; 1,776 have a
-- NON-superseded one; 1,747 of those resolve to a row in `properties`.
--
-- ⚠️ `firm_term_remaining` IS A HONEST NULL FOR dia, NOT A ZERO. dia `leases` carries no
-- firm-term column at all (that is gov-only), so there is no recorded fact to mirror.
-- Writing 0 would read as "no firm term remaining" -- a false measurement (PR1a/PR1b).
-- The LCC apply function COALESCEs, so a NULL here can never clobber a value.
--
-- Reverse: re-create this view from 20260812140000_dia_w2_3_portfolio_updated_at.sql
-- (its 18-column body). Nothing is written; this is a view only.

CREATE OR REPLACE VIEW public.v_property_attributes_portfolio AS
SELECT p.property_id,
    p.address,
    p.city,
    p.state,
    p.zip_code,
    p.county,
    p.latitude,
    p.longitude,
    p.building_size,
    p.year_built,
    p.year_renovated,
    p.building_type,
    p.property_type,
    p.tenant,
    p.operator,
    proj.rent_now AS annual_rent,
    NULL::numeric AS noi,
    p.updated_at,
    -- ── UX-T1a-mirror-dia-lease: appended lease-date columns ──────────────────
    lz.lease_start                                      AS lease_commencement,
    lz.lease_expiration                                 AS lease_expiration,
    -- dia has no firm-term fact; see the header. NULL = not measured, never 0.
    NULL::numeric                                       AS firm_term_remaining,
    CASE WHEN lz.lease_expiration IS NOT NULL
         THEN round(((lz.lease_expiration - CURRENT_DATE) / 365.25)::numeric, 2)
    END                                                 AS term_remaining,
    -- Names WHICH lease answered, so a consumer can tell "in effect" from
    -- "expiry known, start unknown" instead of reading both as one fact.
    lz.lease_state                                      AS lease_source,
    it.initial_term_years                               AS initial_term_years
   FROM properties p
     LEFT JOIN LATERAL ( SELECT l_1.lease_start,
            l_1.annual_rent,
            l_1.rent
           FROM leases l_1
          WHERE l_1.property_id = p.property_id
          ORDER BY l_1.is_active DESC NULLS LAST, l_1.leased_area DESC NULLS LAST, l_1.lease_start DESC NULLS LAST
         LIMIT 1) l ON true
     LEFT JOIN LATERAL ( SELECT dia_project_rent_at_date(COALESCE(
                CASE
                    WHEN p.anchor_rent_source = ANY (ARRAY['lease_confirmed'::text, 'om_confirmed'::text]) THEN p.anchor_rent
                    ELSE NULL::numeric
                END, l.annual_rent, l.rent), l.lease_start, CURRENT_DATE, COALESCE(p.lease_bump_pct, 0.02), COALESCE(p.lease_bump_interval_mo, 12)) AS rent_now) proj ON true
     -- The lease in effect today: non-superseded, expiry in the future. Prefer one that
     -- has actually commenced, then the longest remaining, then the newest row so the
     -- pick is deterministic (no unique constraint on (property_id, term)).
     LEFT JOIN LATERAL ( SELECT ll.lease_start,
            ll.lease_expiration,
            CASE WHEN ll.lease_start IS NULL              THEN 'dia_leases:start_unknown'
                 WHEN ll.lease_start <= CURRENT_DATE      THEN 'dia_leases:in_effect'
                 ELSE                                          'dia_leases:not_yet_commenced'
            END AS lease_state
           FROM leases ll
          WHERE ll.property_id = p.property_id
            AND ll.superseded_at IS NULL
            AND ll.lease_expiration IS NOT NULL
            AND ll.lease_expiration > CURRENT_DATE
          ORDER BY (ll.lease_start IS NOT NULL AND ll.lease_start <= CURRENT_DATE) DESC,
                   ll.lease_expiration DESC,
                   ll.lease_id DESC
         LIMIT 1) lz ON true
     -- The INITIAL term length, from the property's first term (term_number = 1). Only
     -- 15 of 1,634 in-effect leases are extensions, so reading the initial term off the
     -- selected lease would be wrong for those; this reads the term that IS the initial.
     LEFT JOIN LATERAL ( SELECT round(((li.lease_expiration - li.lease_start) / 365.25)::numeric, 1) AS initial_term_years
           FROM leases li
          WHERE li.property_id = p.property_id
            AND li.superseded_at IS NULL
            AND li.lease_start IS NOT NULL
            AND li.lease_expiration IS NOT NULL
            AND COALESCE(li.term_number, 1) = 1
          ORDER BY li.lease_start ASC
         LIMIT 1) it ON true;

-- security_invoker=off is LOAD-BEARING: the LCC mirror reads this view as `anon` over
-- PostgREST, and with security_invoker=on the caller's RLS applies to `properties`/
-- `leases` and PostgREST answers HTTP 200 with `[]` -- indistinguishable from "no new
-- data" (P157). Already off on this view; re-asserted so a rebuild cannot lose it.
ALTER VIEW public.v_property_attributes_portfolio SET (security_invoker = off);

GRANT SELECT ON public.v_property_attributes_portfolio TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_property_attributes_portfolio IS
  'Anon-readable non-PII property attributes for the LCC cross-DB mirror. '
  'UX-T1a-mirror-dia-lease (2026-09-03) appended lease_commencement / lease_expiration / '
  'firm_term_remaining / term_remaining / lease_source / initial_term_years, derived from '
  '`leases` (non-superseded, future expiry). firm_term_remaining is always NULL for dia -- '
  'there is no firm-term fact in this domain. Measured ceiling: 1,747 properties.';
