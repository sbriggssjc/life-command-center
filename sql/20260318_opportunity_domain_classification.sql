-- Domain classification for Salesforce Opportunity prospects
-- Classifies open Opportunities into government, dialysis, or all_other
-- Supports manual override via prospect_domain column

ALTER TABLE salesforce_activities ADD COLUMN IF NOT EXISTS prospect_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_sf_activities_prospect_domain ON salesforce_activities (prospect_domain) WHERE prospect_domain IS NOT NULL;

CREATE OR REPLACE VIEW v_opportunity_domain_classified AS
WITH classified AS (
  SELECT DISTINCT ON (subject, sf_contact_id)
    activity_id, subject AS deal_name, first_name, last_name,
    (first_name || ' ' || last_name) AS contact_name,
    company_name, email, phone, sf_contact_id, sf_company_id,
    activity_date, nm_notes, nm_type, task_subtype,
    status, assigned_to, created_at, prospect_domain,
    CASE
      WHEN prospect_domain IS NOT NULL THEN prospect_domain
      WHEN subject ~* '(^VA |veterans affairs|^GSA[ -]|USDA|^FBI[ -]|^CBP[ -]|^IRS[ -]|^SSA[ -]|^DOJ[ -]|^DEA[ -]|^USPS[ -]|^HHS[ -]|^HUD[ -]|^DOL[ -]|^EPA[ -]|^FAA[ -]|^FEMA[ -]|^FWS[ -]|Army|Navy|Air Force|Coast Guard|^DHS[ -]|Homeland Security|^ACOE[ -]|Bureau of|Census|Customs|Federal |USCIS|^ICE[ -]|Secret Service|Marshal|Corps of Eng|Reclamation|^BLM[ -]|Fish.*Wildlife|Forest Service|National Guard|National Preserve|^NPS[ -])' THEN 'government'
      WHEN subject ~* '(Dept\. of|Department of|County |City of |State of |Municipal|Probation|Corrections|^DMV[ -]|Motor Vehicles|State Police|^DOT[ -]|Dept of Health|^DCFS[ -]|Public Safety|Sheriff|District Attorney)' THEN 'government'
      WHEN subject ~* '^[A-Z]{2} Dept' THEN 'government'
      WHEN subject ~* '(dialysis|DaVita|Fresenius|^FMC[ -]|kidney|renal|nephrology|Innovative Renal|^DCI[ -]|Satellite Dial|U\.S\. Renal|American Renal|Greenfield Renal)' THEN 'dialysis'
      ELSE 'all_other'
    END AS domain,
    CASE
      WHEN subject ~ '^\*{0,5}\d+\s*-' THEN regexp_replace(subject, '^\*{0,5}(\d+)\s*-.*', '\1')::integer
      ELSE NULL
    END AS deal_priority,
    CASE
      WHEN subject ~ '^\*{0,5}\d+\s*-\s*' THEN trim(regexp_replace(subject, '^\*{0,5}\d+\s*-\s*', ''))
      ELSE subject
    END AS deal_display_name
  FROM salesforce_activities
  WHERE nm_type = 'Opportunity' AND status = 'Open'
  ORDER BY subject, sf_contact_id, activity_date DESC
)
SELECT * FROM classified;
