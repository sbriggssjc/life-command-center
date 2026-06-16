-- R31 — priority-queue domain attribution (2026-06-16)
--
-- The priority queue is well-represented for dia when measured by the ENTITY's
-- own domain (~545 rows) — on par with gov (~738). But the queue's domain
-- filter keyed on `source_domain`, which is NULL on every owner-entity row
-- (P0.4/P0.5/P-CONTACT/P-BUYER/most P7 — keyed by entity, not a domain
-- property). So the operator console "Dialysis" tab showed ~37 of the true
-- ~545 dia rows (and gov hid ~448 of ~738), and the MCP get_queue_summary
-- domain filter inherited the same blind spot.
--
-- Fix: attribute each queue row to the entity's domain when the property
-- domain is null. ADD `effective_domain = COALESCE(source_domain, entities.domain)`
-- — keep `source_domain` as-is (don't break existing readers). entities.domain
-- carries dia/gov/cre/lcc; `lcc` (LCC-internal entities) maps to NULL so they
-- don't mis-tag. Long-form spellings normalize to the canonical short form.
--
-- A row has exactly one effective_domain; the all-domains view is unchanged.
-- This is an additive column + a LEFT JOIN to entities (by PK, can't drop or
-- multiply rows), so band membership is byte-identical. Per the R7 rule,
-- CREATE OR REPLACE VIEW appends new columns at the END.
--
-- Consumers (api/admin.js handlePriorityQueueList + the MCP get_queue_summary)
-- repoint their domain filter from source_domain to effective_domain.

CREATE OR REPLACE VIEW public.v_priority_queue_enriched AS
 SELECT q.entity_id,
    q.name,
    q.workspace_id,
        CASE q.vertical
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.vertical
        END AS vertical,
    q.owner_user_id,
    q.contact_id,
    q.bd_opportunity_id,
    q.priority_band,
    q.reason,
    q.next_touch_due,
    q.days_overdue,
    q.last_touch_at,
    q.last_touch_type,
    q.effective_owner_role,
    q.owner_role_confidence,
    COALESCE(p.total_property_count, 0::bigint) AS total_property_count,
    COALESCE(p.current_property_count, 0::bigint) AS current_property_count,
    COALESCE(p.dia_property_count, 0::bigint) AS dia_property_count,
    COALESCE(p.gov_property_count, 0::bigint) AS gov_property_count,
    COALESCE(p.is_cross_vertical, false) AS is_cross_vertical,
    p.earliest_acquisition_date,
    p.latest_acquisition_date,
    p.latest_disposition_date,
    COALESCE(p.current_annual_rent_total, 0::numeric) AS current_annual_rent_total,
    p.avg_cap_rate,
        CASE q.source_domain
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.source_domain
        END AS source_domain,
    q.source_property_id,
    pa.address AS source_property_address,
    pa.city AS source_property_city,
    pa.state AS source_property_state,
    pa.lease_expiration AS source_property_lease_expiration,
    pa.firm_term_remaining AS source_property_firm_term_remaining,
    pa.term_remaining AS source_property_term_remaining,
    br.spe_count AS buyer_spe_count,
    br.rollup_property_count AS buyer_rollup_property_count,
    br.rollup_annual_rent AS buyer_rollup_annual_rent,
    br.last_acquisition_date AS buyer_last_acquisition_date,
    br.sf_account_id AS buyer_sf_account_id,
    br.needs_sf_mapping AS buyer_needs_sf_mapping,
    rs.resolve_reason,
    rs.true_owner_name AS resolve_true_owner_name,
    rs.is_connected AS resolve_is_connected,
    pa.annual_rent AS source_property_rent,
    pa.noi AS source_property_noi,
    COALESCE(NULLIF(tr.trigger_rollup_annual_rent, 0::numeric), NULLIF(COALESCE(p.current_annual_rent_total, 0::numeric), 0::numeric), NULLIF(pa.annual_rent, 0::numeric), NULLIF(cv.connected_property_value, 0::numeric), NULLIF(br.rollup_annual_rent, 0::numeric)) AS rank_annual_rent,
    tr.trigger_property_count,
    tr.trigger_rollup_annual_rent,
        CASE q.priority_band
            WHEN 'P1'::text THEN
            CASE
                WHEN pa.lease_expiration IS NOT NULL THEN to_char(pa.lease_expiration::timestamp without time zone, 'Mon YYYY'::text)
                ELSE NULL::text
            END
            WHEN 'P3'::text THEN
            CASE
                WHEN pa.term_remaining IS NOT NULL THEN round(pa.term_remaining, 1)::text || ' yr term left'::text
                ELSE NULL::text
            END
            WHEN 'P5'::text THEN
            CASE
                WHEN pa.year_built IS NOT NULL THEN 'built '::text || pa.year_built::text
                ELSE NULL::text
            END
            WHEN 'P8'::text THEN
            CASE
                WHEN pa.sam_active_opportunities IS NOT NULL THEN (pa.sam_active_opportunities::text || ' active solicitation'::text) ||
                CASE
                    WHEN pa.sam_active_opportunities = 1 THEN ''::text
                    ELSE 's'::text
                END
                ELSE NULL::text
            END
            ELSE NULL::text
        END AS trigger_top_fact,
    cv.connected_property_value,
    cv.connected_property_count,
    -- R31: attribute the row to the entity's domain when the property domain
    -- is null. Normalize long-form spellings; map LCC-internal -> NULL.
    COALESCE(
        CASE q.source_domain
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.source_domain
        END,
        CASE e.domain
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            WHEN 'lcc'::text THEN NULL::text
            ELSE e.domain
        END
    ) AS effective_domain
   FROM v_priority_queue q
     LEFT JOIN v_entity_portfolio_all p ON p.entity_id = q.entity_id
     LEFT JOIN lcc_property_attributes pa ON pa.source_domain = q.source_domain AND pa.source_property_id = q.source_property_id
     LEFT JOIN v_lcc_buyer_parent_rollup br ON q.priority_band = 'P-BUYER'::text AND br.parent_entity_id = q.entity_id
     LEFT JOIN v_lcc_trigger_band_rollup tr ON (q.priority_band = ANY (ARRAY['P1'::text, 'P3'::text, 'P5'::text, 'P8'::text])) AND tr.entity_id = q.entity_id AND tr.priority_band = q.priority_band AND tr.source_domain = q.source_domain
     LEFT JOIN lcc_entity_connected_value cv ON (q.priority_band = ANY (ARRAY['P0.4'::text, 'P-CONTACT'::text])) AND cv.entity_id = q.entity_id
     LEFT JOIN entities e ON e.id = q.entity_id
     LEFT JOIN LATERAL ( SELECT tof.true_owner_name,
            conn.is_connected,
                CASE
                    WHEN conn.is_connected THEN 'connected'::text
                    WHEN tof.true_owner_name IS NOT NULL AND lower(tof.true_owner_name) <> lower(q.name) THEN 'true_owner_known_connect'::text
                    WHEN lcc_is_spe_shell_name(q.name) THEN 'recorded_owner_shell_true_owner_unresolved'::text
                    ELSE 'owner_known_connect'::text
                END AS resolve_reason
           FROM ( SELECT (EXISTS ( SELECT 1
                           FROM external_identities ei
                          WHERE ei.entity_id = q.entity_id AND ei.source_system = 'salesforce'::text)) OR (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.from_entity_id = q.entity_id)) OR (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.to_entity_id = q.entity_id)) AS is_connected) conn
             LEFT JOIN LATERAL ( SELECT pof.true_owner_name
                   FROM lcc_entity_portfolio_facts pf
                     JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
                  WHERE pf.entity_id = q.entity_id AND pf.is_current = true
                  ORDER BY pf.ownership_start_date DESC NULLS LAST
                 LIMIT 1) tof ON true) rs ON true
  WHERE q.entity_id IS NOT NULL AND
        CASE q.vertical
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.vertical
        END IS NOT NULL;
