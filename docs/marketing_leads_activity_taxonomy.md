# `marketing_leads.activity_type` taxonomy

`marketing_leads` (project `zqzrriwuavgrquhisnoa`, the dia/CRM backend) is
written by the `lead-ingest` edge function from three channels. Every row carries
an `activity_type`. This is the single reference for the allowed vocabulary and
the Salesforce `Listing_Activity__c.Action` → `activity_type` mapping.

The authoritative source of truth in code is
`supabase/functions/lead-ingest/index.ts` — `ENGAGEMENT_ACTION_MAP`,
`ALLOWED_ACTIVITY_TYPES`, and `mapEngagementAction()`. Keep this doc in sync with
those constants.

## Channels → activity_type

| Channel | Route | Source (`marketing_leads.source`) | activity_type |
| --- | --- | --- | --- |
| RCM / CREXi inquiry email | `POST ?action=rcm` | `rcm` | parsed inquiry type, else **`rcm_inquiry`** |
| LoopNet inquiry email | `POST ?action=loopnet` | `loopnet` | parsed inquiry type, else **`loopnet_inquiry`** |
| SF `Listing_Activity__c` engagement | `POST ?action=engagement` | `rcm_engagement` | mapped from `action` (table below) |
| (legacy default) | — | — | **`website_hit`** |

## Engagement Action → activity_type map

The `?action=engagement` route maps the SF `Listing_Activity__c.Action` string
to a canonical `activity_type`. The lookup is **case-insensitive**.

| SF `Action` | `activity_type` |
| --- | --- |
| `Viewed Agreement` | `om_download` |
| `Viewed Summary` | `html_view` |
| `Viewed Executive Summary` | `exec_summary_view` |
| `Viewed Email` | `email_view` |
| `Executed Agreement` | `agreement_executed` |
| `Entered VDR` | `vdr_entry` |
| `Downloaded Docs` | `doc_download` |
| `Approved User` | `vdr_approved` |
| `Sent Email` | `email_sent` |

**Unmapped `Action`** falls back to a **slug** of the raw string
(lowercased, non-alphanumerics → `_`, trimmed), e.g. `"Requested Tour"` →
`requested_tour`. An absent `Action` → `engagement`. So the map is the *known*
taxonomy, not a hard allow-list — the slug is the open-ended escape hatch, which
keeps a new SF action from being dropped while still yielding a stable value.

## Known vocabulary (`ALLOWED_ACTIVITY_TYPES`)

```
om_download, html_view, exec_summary_view, email_view, agreement_executed,
vdr_entry, doc_download, vdr_approved, email_sent,   # engagement enum
rcm_inquiry, loopnet_inquiry, website_hit            # inquiry / website
```

## Engagement contract (`?action=engagement`)

A Power Automate flow maps SF fields into this JSON body:

```json
{
  "sf_activity_id": "<Listing_Activity__c.Id>",   // required — stored in source_ref (idempotency key)
  "action": "Viewed Agreement",                   // → activity_type via the map above
  "activity_date": "2026-06-29T08:12:00Z",         // → lead_date
  "sf_listing_id": "a0jVs00000Ft56TIAR",           // → listing_id
  "sf_opportunity_id": "006Vs00000b7nDCIAY",       // → sf_opportunity_id
  "listing_name": "DaVita, Inc.",                  // → deal_name
  "property_address": "2155 Main St E",            // → property_address
  "property_city": "Snellville", "property_state": "GA",
  "sf_contact_id": "003...",                       // present → sf_match_status='matched'
  "sf_company_id": "001...",
  "lead_first_name": "...", "lead_last_name": "...",
  "lead_email": "...", "lead_phone": "...",
  "lead_company": "...", "lead_title": "..."
}
```

- `sf_match_status` = `matched` when `sf_contact_id` is present, else `unmatched`.
- Idempotent on `sf_activity_id` (stored in `source_ref`): re-POSTing the same
  activity **updates** the row (via the partial unique index
  `marketing_leads_engagement_uidx`), it never duplicates.
- `lead_date` = `activity_date` (validated ISO), else `now()`.
