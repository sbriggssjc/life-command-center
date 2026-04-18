# GovLease CRM Workbench — LCC App Build Plan

## Overview

Build a unified CRM research and prospecting workbench for government-leased commercial real estate investment sales. The workbench will be housed in the LCC app and serve three pipelines: **government-leased**, **dialysis**, and **general net lease**. This document covers the government-leased pipeline design; dialysis and general will follow the same architecture.

## Current State (Built)

### Database: Supabase (scknotsqkcheojiaewwh.supabase.co)
- **53K+ GSA lease records** across 146 monthly snapshots (2013-2026)
- **235K lifecycle events** (new awards, expirations, renewals, modifications)
- **4,577 ownership changes** detected (1,242 with confirmed sale prices)
- **2,637 sales transactions** (CoStar + manual)
- **1,853 prospect leads** (GSA new awards, email OMs, CoStar/CREXi)
- **115 active listings** (CREXi + email intake)
- **4,831 contacts** (buyers, sellers, cross-referenced)
- **16,052 properties** with investment scores
- **20,410 FRPP records** (federal real property portfolio)
- **~3,100 county authority records** (assessor/recorder/GIS URLs from Netronline)
- **901 county authority records** with direct links

### Existing Dashboard (HTML + Supabase REST API)
- 5 tabs: Overview, Ownership, Pipeline, Listings, Research
- Research workbench with dual queue (ownership changes + new lease leads)
- Auto-populated forms, SPE detection, loan/financing fields
- County assessor/recorder/GIS direct links
- Secretary of State business entity search links (all 50 states)
- Typeahead contact search for deduplication
- Prior lease history display (new vs renewal, prior rent/lessor)
- Auto-launcher from .env (no manual key entry)

### Backend Pipeline (Python)
- Monthly/weekly/daily automated pipelines (Task Scheduler)
- GSA monthly diff → lead pipeline → AI research → SF push
- CoStar/CREXi export ingestion
- Email/OM forwarding ingestion
- Cross-propagation engine (links records across all tables)
- URL availability checker (dead listing = sale signal)
- GovBot natural language SQL interface

### GitHub: sbriggssjc/government-lease

---

## Build Plan — CRM Workbench Features

### Phase A: Activity Logging & Call Tracking

**Database additions:**
```
activity_log:
  activity_id (UUID PK)
  record_type ('lead', 'ownership', 'listing', 'contact')
  record_id (UUID — links to prospect_leads.lead_id, ownership_history.ownership_id, etc.)
  contact_id (FK to contacts)
  activity_type ('call', 'email', 'meeting', 'note', 'task', 'sf_sync')
  direction ('outbound', 'inbound')
  subject (TEXT)
  body (TEXT — full email/call content stored in Supabase)
  touchpoint_number (INT — auto-incremented per contact)
  outcome ('connected', 'voicemail', 'no_answer', 'email_sent', 'meeting_set')
  sf_activity_id (TEXT — Salesforce Task/Event ID)
  sf_sync_status ('pending', 'synced', 'failed')
  created_by (TEXT — 'scott')
  created_at (TIMESTAMPTZ)
```

**Dashboard UI:**
- "Log Call" button on every research card → inline form:
  - Outcome dropdown (Connected, Voicemail, No Answer, Email Sent)
  - Notes textarea (full content stored in Supabase)
  - Auto-increments touchpoint_number for that contact
  - Creates a completed SF activity: "Touchpoint N — [outcome]" with link to Supabase record
- Call history panel: shows prior touchpoints with dates, outcomes, notes
- Visual timeline of all interactions with a contact/account

### Phase B: Salesforce Integration (Bidirectional)

**Outbound (Supabase → Salesforce via Power Automate):**
- "Create Opportunity" button → creates open SF Task:
  - Assigned to Scott's SF profile
  - NM Type = "Opportunity"
  - Subject = "[Lease#] [City, ST] — [Agency] — [Owner]"
  - Task remains open until prospecting stops
- "Log Call" → creates completed SF Activity:
  - Subject = "Touchpoint N — [Owner/Contact]"
  - Description = "See full notes: [link to Supabase record]"
  - Linked to Account and Contact in SF
- Contact/Account creation from research form
- Lead → Contact conversion when contact info is verified

**Inbound (Salesforce → Supabase):**
- Pull existing SF activity history for an account
- Show open tasks and opportunities in the research card
- Display last contact date, total touchpoints, pipeline stage
- Match SF Account/Contact IDs to Supabase contacts

**SF Data Model Mapping:**
| Supabase | Salesforce |
|----------|-----------|
| contacts.name | Account.Name |
| contact_name | Contact.Name |
| sf_lead_id | Lead.Id |
| sf_contact_id | Contact.Id |
| sf_opportunity_id | Opportunity.Id |
| prospect_leads.pipeline_status | Opportunity.Stage |
| activity_log entries | Task/Event records |

### Phase C: Area Ownership Research Section

**Purpose:** When you have a listing (e.g., SSA in Tulsa, OK), show all same-agency deals in the area to identify prospecting targets for introductory outreach.

**Dashboard UI — new section on each research card:**
- "Area Ownership" panel showing:
  - All [same agency] properties in [same state] from gsa_snapshots
  - Ownership info from ownership_history (who bought what, when, price)
  - Contact info from contacts table
  - Estimated values, lease terms, proximity
- Sortable by: estimated value, distance, lease expiration, last contact date
- "Add to Outreach" button → queues for email template

**Data queries:**
```sql
-- For an SSA listing in Tulsa, OK:
SELECT gs.lease_number, gs.address, gs.city, gs.annual_rent, gs.lessor_name,
       oh.new_owner, oh.sale_price, oh.transfer_date
FROM gsa_snapshots gs
LEFT JOIN ownership_history oh ON oh.lease_number = gs.lease_number
WHERE gs.field_office_name LIKE '%Social Security%'
  AND gs.state = 'OK'
  AND gs.snapshot_date = (SELECT MAX(snapshot_date) FROM gsa_snapshots)
ORDER BY gs.annual_rent DESC
```

### Phase D: On-Market Ownership Research Section

**Purpose:** Cross-reference available_listings with ownership data to identify which listed properties have known vs unknown owners.

**Dashboard UI:**
- "On Market" panel showing:
  - All active listings from available_listings
  - Matched ownership from ownership_history
  - Owner contact info, prior sale prices
  - Listing broker info (potential co-brokerage)
- Highlight: "Owner Known" (green) vs "Needs Research" (amber) vs "Unknown" (red)

### Phase E: Email Template Engine

**Template system:**
- Base templates provided by Scott (OM introductions, follow-ups, cold outreach)
- Merge fields: `{{owner_name}}`, `{{property_address}}`, `{{agency}}`, `{{annual_rent}}`, `{{lease_term}}`, `{{asking_price}}`, `{{cap_rate}}`, etc.
- Template variants by engagement type:
  - New listing introduction (OM blast)
  - Area ownership outreach ("We represent a similar property nearby...")
  - Follow-up after call
  - Proposal follow-up
  - Market update

**Dashboard UI:**
- "Draft Email" button on every research card and area ownership row
- Opens Outlook via `mailto:` link with pre-filled To, Subject, Body
- Body populated from template + merged property/contact data
- Template selector dropdown
- Preview before sending

**Storage:**
```
email_templates:
  template_id (UUID PK)
  template_name (TEXT)
  template_type ('om_intro', 'area_outreach', 'follow_up', 'proposal', 'market_update')
  subject_template (TEXT with merge fields)
  body_template (TEXT with merge fields)
  created_at, updated_at
```

### Phase F: Deduplication & Data Quality

**Automated dedup on save:**
- Fuzzy name matching against contacts table (90%+ similarity)
- Phone number normalization and matching
- Address standardization and matching
- Merge UI: "This looks like an existing record — merge or create new?"

**Batch dedup job:**
- Nightly scan for duplicate contacts, leads, ownership records
- Confidence scoring: exact match, high similarity, possible match
- Admin review queue for manual merge decisions

**Data quality dashboard:**
- Missing field coverage by table
- Duplicate candidates count
- Stale records (no activity in N days)
- Unlinked records (no cross-references)

---

## Architecture Notes

### Hosting in LCC App
The workbench should be built as a module within the LCC app framework, sharing:
- Authentication (SSO with Salesforce or standalone)
- Database connection (Supabase client)
- UI component library
- Template engine

### Multi-Pipeline Support
The same workbench architecture serves three pipelines:
1. **Government-Leased** — GSA data, FRPP agencies, federal credit
2. **Dialysis** — DaVita/Fresenius tenant data, healthcare REIT buyers
3. **General Net Lease** — Any single-tenant net lease

Each pipeline uses the same tables with `pipeline_type` column for filtering.

### Key Integration Points
- **Supabase** — All data storage, REST API for dashboard
- **Salesforce** — CRM sync via Power Automate webhooks
- **Outlook** — Email drafting via mailto: links
- **CoStar/CREXi** — Sale comp and listing ingestion
- **GSA IOLP** — Monthly inventory snapshots
- **Netronline** — County authority URLs
- **OpenAI/Claude** — AI research engine, entity resolution, document parsing

---

## Known Issues to Address

1. **Tenant agency mismatch**: GSA `field_office_name` is the PBS regional office, not the tenant. FRPP has `using_agency` but only covers ~20K of 53K+ leases. Need additional cross-reference strategy (possibly matching by address against FRPP, or using the GSA IOLP `cen_bus_unit_ind` field).

2. **Duplicate prospect leads**: Some lease_numbers appear multiple times (e.g., 3120 Ashley Phosphate Rd, North Charleston, SC has 4 duplicate leads). Need dedup pass.

3. **County authority matching**: City-to-county lookup misses when city name ≠ county name (common). Need a zip-to-county or lat/lon-to-county mapping.

4. **FRPP data is FY2021**: The FRPP dataset is from fiscal year 2021 and hasn't been updated. Need to source newer FRPP data or build alternative tenant identification.

---

## File References

| Component | Location |
|-----------|----------|
| Database schema | `sql/20260304_initial_schema.sql` + migrations |
| Lead pipeline | `src/lead_pipeline.py` |
| AI research | `src/ai_research.py` |
| SF push | `src/sf_push.py` |
| Cross-propagation | `src/cross_propagate.py` |
| Ownership detection | `src/ownership_changes.py` |
| Dashboard HTML | `dashboards/govlease-dashboard.html` |
| Dashboard launcher | `src/launch_dashboard.py` |
| County scraper | `src/county_scraper.py` |
| GovBot | `src/govbot.py` |
| Pipeline runner | `src/pipeline_runner.py` |
| GitHub | github.com/sbriggssjc/government-lease |
