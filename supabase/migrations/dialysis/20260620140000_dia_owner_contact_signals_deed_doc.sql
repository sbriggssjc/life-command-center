-- CONTACT-SELECTION Slice 4 — Phase A routing (dia): has_deed_doc signal
-- ----------------------------------------------------------------------------
-- Appends a `has_deed_doc` boolean to the dia owner-contact-signals anon view so
-- LCC can route owners that HAVE a recorded deed / PSA / master doc to the
-- authority-1 `parse_deed_signatory` enrichment (over SOS / address). NAMES-ONLY
-- PII posture is unchanged (this adds a boolean only). Owner=postgres so anon
-- bypasses RLS like the sibling portfolio views.
--
-- DEPLOY ORDER: apply this dia view FIRST. The LCC sync's `?select=…,has_deed_doc`
-- 400s (→ no upsert, graceful) until this column exists.
-- Addressable: ~14 of the 78 contactless dia owners own a deed/dd/master doc.

CREATE OR REPLACE VIEW public.v_owner_contact_signals_portfolio AS
 WITH cand AS (
         SELECT to2_1.true_owner_id,
            regexp_replace(btrim(to2_1.contact_1_name), '\s+'::text, ' '::text, 'g'::text) AS cand_name,
            'economic_owner_contact'::text AS cand_role, 3 AS authority, 'true_owner_contact_1'::text AS src, NULL::bigint AS property_id
           FROM true_owners to2_1
          WHERE NULLIF(btrim(to2_1.contact_1_name), ''::text) IS NOT NULL
        UNION ALL
         SELECT to2_1.true_owner_id,
            regexp_replace(btrim(to2_1.contact_2_name), '\s+'::text, ' '::text, 'g'::text),
            'economic_owner_contact'::text, 3, 'true_owner_contact_2'::text, NULL::bigint
           FROM true_owners to2_1
          WHERE NULLIF(btrim(to2_1.contact_2_name), ''::text) IS NOT NULL
        UNION ALL
         SELECT p.true_owner_id,
            regexp_replace(btrim(ro.manager_name), '\s+'::text, ' '::text, 'g'::text),
            COALESCE(NULLIF(btrim(ro.manager_role), ''::text), 'manager'::text), 2, 'recorded_owner_manager'::text, p.property_id
           FROM properties p
             JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
          WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.manager_name), ''::text) IS NOT NULL
        UNION ALL
         SELECT p.true_owner_id,
            regexp_replace(btrim(ro.registered_agent_name), '\s+'::text, ' '::text, 'g'::text),
            'registered_agent'::text, 4, 'recorded_owner_agent'::text, p.property_id
           FROM properties p
             JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
          WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.registered_agent_name), ''::text) IS NOT NULL
        ), cand_rolled AS (
         SELECT cand.true_owner_id, cand.cand_name,
            min(cand.cand_role) AS cand_role, min(cand.authority) AS authority, min(cand.src) AS src,
            count(DISTINCT cand.property_id) AS n_props
           FROM cand GROUP BY cand.true_owner_id, cand.cand_name
        ), cand_agg AS (
         SELECT cand_rolled.true_owner_id,
            jsonb_agg(jsonb_build_object('name', cand_rolled.cand_name, 'role', cand_rolled.cand_role, 'authority', cand_rolled.authority, 'source', cand_rolled.src, 'n_props', cand_rolled.n_props) ORDER BY cand_rolled.authority, cand_rolled.n_props DESC, cand_rolled.cand_name) AS candidates
           FROM cand_rolled GROUP BY cand_rolled.true_owner_id
        ), reg_addr AS (
         SELECT true_owners.true_owner_id
           FROM true_owners
          WHERE NULLIF(btrim(true_owners.notice_address_1), ''::text) IS NOT NULL OR NULLIF(btrim(true_owners.notice_address_2), ''::text) IS NOT NULL
        UNION
         SELECT DISTINCT p.true_owner_id
           FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
          WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.registered_agent_address), ''::text) IS NOT NULL
        ), deed_doc AS (
         -- Phase A: owners with a recorded deed / due-diligence / master doc on a property they own.
         SELECT DISTINCT p.true_owner_id
           FROM properties p JOIN property_documents pd ON pd.property_id = p.property_id
          WHERE p.true_owner_id IS NOT NULL AND pd.document_type = ANY (ARRAY['deed'::text, 'dd'::text, 'master'::text])
        ), owners AS (
         SELECT cand_agg.true_owner_id FROM cand_agg
        UNION
         SELECT reg_addr.true_owner_id FROM reg_addr
        UNION
         SELECT deed_doc.true_owner_id FROM deed_doc
        )
 SELECT o.true_owner_id,
    to2.name AS true_owner_name,
    COALESCE(ca.candidates, '[]'::jsonb) AS candidates,
    (EXISTS ( SELECT 1 FROM reg_addr ra WHERE ra.true_owner_id = o.true_owner_id)) AS has_reg_address,
    (EXISTS ( SELECT 1 FROM deed_doc dd WHERE dd.true_owner_id = o.true_owner_id)) AS has_deed_doc
   FROM owners o
     JOIN true_owners to2 ON to2.true_owner_id = o.true_owner_id
     LEFT JOIN cand_agg ca ON ca.true_owner_id = o.true_owner_id;
