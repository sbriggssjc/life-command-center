-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- RO1 (UX-T1c §10) — the resolve_ownership lane surfaced 836 of 1,597 rows whose PROPOSED owner
-- is the owner ALREADY RECORDED (the GSA/state lessor of record changed *to* the party we hold;
-- `pending_updates` re-proposing the current value). Those are confirmations presented as
-- questions (A1's `agrees` shape) and the lane has 0 human verdicts ever.
-- APPLIED LIVE to scknotsqkcheojiaewwh 2026-09-08.
--
-- WHAT: append ONE column, `proposal_is_recorded boolean`, to v_ownership_resolution. The column
-- is a name-key equality (lower() BEFORE the [^a-z0-9] strip — the documented footgun) between
-- proposed_owner_name and current_recorded_owner_name. It is a GROUPING aid the handler filters
-- on; it never decides a write. The whole view body is restated (P194: a migration that changes
-- a view carries the WHOLE view) and the new column goes LAST (CREATE OR REPLACE VIEW is
-- append-only for columns — 42P16 otherwise).
--
-- Measured before applying (2026-09-08): 836 true / 761 false. By arm: gsa_lessor_change 734/70,
-- state_lessor_change 95/1, discrepancy 7/92, deed_grantee 0/598.
-- VERIFY: select proposal_is_recorded, count(*) from v_ownership_resolution group by 1;
--         → true 836, false 761 (moves as signals land; the split, not the totals, is the check).
-- REVERSE: re-run the previous definition (identical body without the last column) — no data moves.
--
-- NOT changed: the three arms, the ordering, recommended_action, RLS/grants (the view stays
-- security_invoker=on; it returns 0 rows to anon by that setting — P157 class, inert because the
-- Decision Center reads it via the service key; noted in the audit, not fixed here).

CREATE OR REPLACE VIEW public.v_ownership_resolution AS
 WITH deed AS (
         SELECT DISTINCT ON (v_owner_source_conflict.property_id) v_owner_source_conflict.property_id,
            v_owner_source_conflict.recorded_owner_name,
            v_owner_source_conflict.latest_deed_grantee,
            v_owner_source_conflict.latest_deed_date,
            v_owner_source_conflict.grantee_passes_guards,
            v_owner_source_conflict.conflict_kind,
            v_owner_source_conflict.auto_fixable,
            v_owner_source_conflict.is_broker_owner
           FROM v_owner_source_conflict
          WHERE (v_owner_source_conflict.conflict_kind <> 'spe_vs_parent'::text)
          ORDER BY v_owner_source_conflict.property_id, v_owner_source_conflict.latest_deed_date DESC NULLS LAST
        ), lessor AS (
         SELECT DISTINCT ON (v_suspected_sale.property_id) v_suspected_sale.property_id,
            v_suspected_sale.suspected_grantor,
            v_suspected_sale.suspected_grantee,
            v_suspected_sale.suspected_sale_date,
            v_suspected_sale.signal_source
           FROM v_suspected_sale
          WHERE (v_suspected_sale.signal_source = ANY (ARRAY['gsa_lessor_change'::text, 'state_lessor_change'::text]))
          ORDER BY v_suspected_sale.property_id, v_suspected_sale.suspected_sale_date DESC NULLS LAST
        ), disc AS (
         SELECT DISTINCT ON (pending_updates.property_id) pending_updates.property_id,
            pending_updates.old_value AS recorded_from,
            pending_updates.new_value AS discrepancy_proposed,
            (COALESCE(pending_updates.updated_at, pending_updates.created_at))::date AS sig_date,
            (pending_updates.source_context ->> 'discrepancy_source'::text) AS discrepancy_source
           FROM pending_updates
          WHERE ((pending_updates.field_name = 'recorded_owner_id'::text) AND (pending_updates.status = ANY (ARRAY['pending'::text, 'pending_review'::text])) AND (pending_updates.property_id IS NOT NULL))
          ORDER BY pending_updates.property_id, COALESCE(pending_updates.updated_at, pending_updates.created_at) DESC
        ), cand AS (
         SELECT deed.property_id
           FROM deed
        UNION
         SELECT lessor.property_id
           FROM lessor
        UNION
         SELECT disc.property_id
           FROM disc
        ), base AS (
         SELECT c.property_id,
            p.address,
            p.city,
            p.state,
            p.agency,
            p.gross_rent AS annual_rent,
            p.recorded_owner_id,
            ro.name AS recorded_owner_name,
            to2.name AS true_owner_name
           FROM (((cand c
             JOIN properties p ON (((p.property_id = c.property_id) AND (p.status IS DISTINCT FROM 'archived'::text))))
             LEFT JOIN recorded_owners ro ON ((ro.recorded_owner_id = p.recorded_owner_id)))
             LEFT JOIN true_owners to2 ON ((to2.true_owner_id = p.true_owner_id)))
        ), recon AS (
         SELECT b.property_id,
            b.address,
            b.city,
            b.state,
            b.agency,
            b.annual_rent,
            b.recorded_owner_name AS current_recorded_owner_name,
            b.true_owner_name,
            COALESCE(d.latest_deed_grantee, l.suspected_grantee, ds.discrepancy_proposed) AS proposed_owner_name,
                CASE
                    WHEN (d.property_id IS NOT NULL) THEN 'deed_grantee'::text
                    WHEN (l.property_id IS NOT NULL) THEN l.signal_source
                    ELSE 'discrepancy'::text
                END AS primary_signal,
            ((
                CASE
                    WHEN (d.property_id IS NOT NULL) THEN jsonb_build_array(jsonb_build_object('signal', 'deed_grantee', 'to', d.latest_deed_grantee, 'date', d.latest_deed_date, 'guards_pass', d.grantee_passes_guards, 'conflict_kind', d.conflict_kind, 'auto_fixable', d.auto_fixable))
                    ELSE '[]'::jsonb
                END ||
                CASE
                    WHEN (l.property_id IS NOT NULL) THEN jsonb_build_array(jsonb_build_object('signal', l.signal_source, 'from', l.suspected_grantor, 'to', l.suspected_grantee, 'date', l.suspected_sale_date))
                    ELSE '[]'::jsonb
                END) ||
                CASE
                    WHEN (ds.property_id IS NOT NULL) THEN jsonb_build_array(jsonb_build_object('signal', 'discrepancy', 'sub', ds.discrepancy_source, 'from', ds.recorded_from, 'to', ds.discrepancy_proposed, 'date', ds.sig_date))
                    ELSE '[]'::jsonb
                END) AS evidence,
            GREATEST(d.latest_deed_date, l.suspected_sale_date, ds.sig_date) AS most_recent_signal_date,
            d.grantee_passes_guards,
            d.conflict_kind AS deed_conflict_kind,
            d.auto_fixable AS deed_auto_fixable,
            d.latest_deed_grantee,
            d.latest_deed_date,
            l.suspected_grantor,
            l.suspected_grantee,
            l.suspected_sale_date,
            l.signal_source AS lessor_signal_source,
            ds.discrepancy_source,
            ds.discrepancy_proposed,
            (d.property_id IS NOT NULL) AS has_deed_signal,
            (l.property_id IS NOT NULL) AS has_lessor_signal,
            (ds.property_id IS NOT NULL) AS has_discrepancy_signal,
            b.recorded_owner_name AS _ro_name
           FROM (((base b
             LEFT JOIN deed d ON ((d.property_id = b.property_id)))
             LEFT JOIN lessor l ON ((l.property_id = b.property_id)))
             LEFT JOIN disc ds ON ((ds.property_id = b.property_id)))
        )
 SELECT 'gov'::text AS domain,
    property_id,
    address,
    city,
    state,
    agency,
    annual_rent,
    current_recorded_owner_name,
    proposed_owner_name,
    true_owner_name,
    primary_signal,
    evidence,
    most_recent_signal_date,
        CASE
            WHEN (most_recent_signal_date >= (CURRENT_DATE - '3 years'::interval)) THEN 'fresh'::text
            WHEN (most_recent_signal_date IS NULL) THEN 'undated'::text
            ELSE 'stale'::text
        END AS recency_band,
        CASE
            WHEN (most_recent_signal_date >= (CURRENT_DATE - '3 years'::interval)) THEN 0
            WHEN (most_recent_signal_date IS NULL) THEN 1
            ELSE 2
        END AS recency_rank,
        CASE
            WHEN (_ro_name IS NULL) THEN 'enrich'::text
            WHEN (deed_auto_fixable IS TRUE) THEN 'auto_update'::text
            ELSE 'confirm'::text
        END AS recommended_action,
    COALESCE(grantee_passes_guards, false) AS owner_guards_pass,
    (latest_deed_date IS NOT NULL) AS is_newer_than_recorded,
    latest_deed_grantee,
    latest_deed_date,
    deed_conflict_kind,
    deed_auto_fixable,
    suspected_grantor,
    suspected_grantee,
    suspected_sale_date,
    lessor_signal_source,
    discrepancy_source,
    discrepancy_proposed,
    has_deed_signal,
    has_lessor_signal,
    has_discrepancy_signal,
    -- RO1 (appended, 2026-09-08): the proposal names the owner we already record.
    -- NULL when either side is NULL (unknown is not "same" — P180).
    (regexp_replace(lower(proposed_owner_name), '[^a-z0-9]'::text, ''::text, 'g'::text)
       = regexp_replace(lower(current_recorded_owner_name), '[^a-z0-9]'::text, ''::text, 'g'::text)) AS proposal_is_recorded
   FROM recon;
