-- BD-flow confirm->act loop (2026-06-03): carry a representative property
-- reference through the owner-link review lane so the Review Console can route
-- the user back to the property after confirming a link. One owner -> at most
-- one gov property today (verified), so LATERAL LIMIT 1 is exact, not lossy.
CREATE OR REPLACE VIEW public.v_recorded_owner_link_review AS
SELECT l.link_id,
    l.recorded_owner_id,
    l.unified_id,
    l.sf_account_id,
    l.match_signals,
    l.signal_count,
    l.match_strength,
    l.evidence,
    l.created_at,
    ro.name AS recorded_owner_name,
    ro.state AS owner_state,
    ro.filing_state AS owner_filing_state,
    ro.registered_agent_name,
    ro.manager_name,
    uc.full_name AS contact_name,
    uc.company_name AS contact_company,
    p.property_id AS source_property_id,
    NULLIF(TRIM(BOTH ', ' FROM
      concat_ws(', ', p.address, p.city, p.state)), '') AS source_property_address
   FROM recorded_owner_contact_links l
     JOIN recorded_owners ro ON ro.recorded_owner_id = l.recorded_owner_id
     LEFT JOIN unified_contacts uc ON uc.unified_id = l.unified_id
     LEFT JOIN LATERAL (
       SELECT pp.property_id, pp.address, pp.city, pp.state
       FROM properties pp
       WHERE pp.recorded_owner_id = l.recorded_owner_id
       ORDER BY pp.property_id
       LIMIT 1
     ) p ON true
  WHERE l.link_status = 'proposed'::text AND l.match_strength = 'weak'::text;
