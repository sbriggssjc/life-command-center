<!-- Converted 2026-09-16 by Cowork from the root file `LCC-Unified-Property-Detail-Spec-v1.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**Life Command Center**

Unified Property Detail Page

Architecture & Implementation Specification

Version 1.0 | March 14, 2026

Prepared for Scott Briggs | NorthMarq Net Lease

**CONFIDENTIAL**

**1. Executive Summary**

This document defines the architecture for a unified Property Detail Page within the Life Command Center (LCC). Today, clicking a property record in different tabs (Government Overview, Pipeline, Ownership, Dialysis Inventory, Search) opens different detail layouts with inconsistent data, labels, and sections. This spec standardizes every property click into a single, consistent experience.

The unified page will be titled with the pattern Tenant – City, State (e.g., “SSA – Fort Worth, TX” or “Davita – Plano, TX”) and will present five consistent sections regardless of whether the property originates from the Government or Dialysis database.

**Key Principles**

  - Database-level normalization: Clean data once in Supabase views, display clean everywhere

  - Consistent layout: Same five sections for every property, regardless of source database

  - CRM integration: Salesforce call history, open activities, and call logging via Power Automate (SSO workaround)

  - Full ownership chain: Every owner back to original developer, with listing and loan history

  - Operational intelligence: Patient/revenue metrics with county, state, and national rankings

**2. Current State Assessment**

**2.1 What Exists Today**

The LCC has two Supabase projects with rich but underutilized schemas:

**Government DB (scknotsqkcheojiaewwh)**

|                |                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tables**     | 82 tables and views                                                                                                                                                    |
| **Key Tables** | properties, leases, lease\_escalations, loans, sales\_transactions, ownership\_history, contacts, recorded\_owners, true\_owners, prospect\_leads, available\_listings |
| **Salesforce** | sf\_sync\_log (sync tracking only – no task/activity tables)                                                                                                           |
| **Rich Data**  | NOI, expenses, investment scores, deal grades, flood zones, workforce trends, agency risk signals                                                                      |

**Dialysis DB (zqzrriwuavgrquhisnoa)**

|                |                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Tables**     | 160+ tables and views                                                                                                                   |
| **Key Tables** | properties, medicare\_clinics, leases, lease\_escalations, loans, sales\_transactions, ownership\_history, operators, guarantors        |
| **Salesforce** | salesforce\_tasks, salesforce\_contacts, salesforce\_accounts, salesforce\_activities (full CRM data via Power Automate)                |
| **CRM Tables** | call\_outcomes, touchpoint\_schedule, outbound\_activities, contacts (with SF sync fields)                                              |
| **Rich Data**  | Patient counts, TTM revenue/costs/profit, payer mix, QIP scores, star ratings, capacity utilization, treatment counts, operator rollups |

**2.2 Current Problems**

  - Inconsistent detail views: Clicking a property in Ownership shows different fields than Pipeline or Search

  - Raw DB labels: Values like “gsa\_new\_award”, “missing\_inventory\_npi” displayed directly to user

  - Client-side normalization only: norm()/cleanLabel() applied per-function, easy to miss spots

  - Shallow data: Detail panels show \~8 fields when the DB has 50+ per property

  - No CRM integration: Salesforce data exists in Dia DB but isn’t surfaced in detail views

  - No loan/ownership chain: Only shows current ownership transfer, not full history

**3. Unified Property Detail Page**

**3.1 Page Title Format**

Every property detail page will use a consistent title:

**{Tenant} – {City}, {State}**

**Government example:** “SSA – Fort Worth, TX”

**Dialysis example:** “Davita – Plano, TX”

If no tenant is known, fall back to address: “1234 Main St – Dallas, TX”

**3.2 Section Tabs**

Five tabs, always in this order, always present (sections show “No data available” rather than being hidden):

|                 |                                                    |                                                                                                         |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Tab**         | **Purpose**                                        | **Primary Data Sources**                                                                                |
| Property        | Physical asset details                             | properties, medicare\_clinics, frpp\_records                                                            |
| Lease           | Tenant, term, rent, escalations                    | leases, lease\_escalations, gsa\_snapshots                                                              |
| Operations      | Performance metrics + rankings                     | medicare\_clinics, facility\_patient\_counts, clinic\_financial\_estimates, operators                   |
| Ownership + CRM | Current owner, contacts, SF activity, call logging | true\_owners, contacts, salesforce\_tasks, salesforce\_activities, call\_outcomes, touchpoint\_schedule |
| History         | Full ownership chain, sales, listings, loans       | ownership\_history, sales\_transactions, available\_listings, listing\_price\_history, loans            |

**3.3 Tab 1: Property**

Physical characteristics of the asset. Data comes from the properties table joined with medicare\_clinics (for dialysis) or frpp\_records (for government).

|                     |                                                   |                                      |                     |
| ------------------- | ------------------------------------------------- | ------------------------------------ | ------------------- |
| **Field**           | **Gov Source**                                    | **Dia Source**                       | **Notes**           |
| Address             | properties.address                                | properties.address                   | norm() applied      |
| City, State, Zip    | properties.city/state/zip\_code                   | properties.city/state/zip\_code      | norm(city)          |
| County              | properties.county                                 | medicare\_clinics.county             |                     |
| Building Size (SF)  | properties.rba or sf\_leased                      | properties.building\_size            | fmtN()              |
| Land Size (Acres)   | properties.land\_acres                            | properties.land\_area                |                     |
| Single/Multi-Tenant | properties.gov\_occupancy\_pct (100% = single)    | properties.is\_single\_tenant        | Bool or calculated  |
| Year Built          | properties.year\_built                            | properties.year\_built               |                     |
| Year Renovated      | properties.year\_renovated (from prospect\_leads) | properties.year\_renovated           | If available        |
| Building Type       | properties.building\_type                         | properties.property\_type            | cleanLabel()        |
| No. of Chairs       | N/A                                               | medicare\_clinics.number\_of\_chairs | Dialysis-specific   |
| No. of Stations     | N/A                                               | medicare\_clinics.stations           | Dialysis-specific   |
| Parking Spaces      | N/A                                               | properties.parking\_space\_count     | If available        |
| Parking Ratio       | N/A                                               | properties.parking\_ratio            | Per 1,000 SF        |
| Lat/Long            | properties.latitude/longitude                     | medicare\_clinics.latitude/longitude | For map integration |
| Flood Zone          | properties.flood\_zone\_desc                      | N/A                                  | Gov-specific        |
| Condition           | properties.building\_condition                    | properties.property\_condition       |                     |

**3.4 Tab 2: Lease**

Active lease details plus escalation history. For government, the leases table has rich GSA data. For dialysis, lease data may be partially populated from ingestion or manual entry.

|                         |                                                     |                                    |                                      |
| ----------------------- | --------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| **Field**               | **Gov Source**                                      | **Dia Source**                     | **Notes**                            |
| Tenant                  | leases.tenant\_agency\_full                         | leases.tenant                      | norm()                               |
| Guarantor               | leases.representing\_agency / government\_type      | guarantors.guarantor\_name         | Gov = agency; Dia = guarantors table |
| Guarantor Credit        | N/A (Gov = full faith & credit)                     | guarantors.credit\_rating          |                                      |
| Original Commencement   | leases.commencement\_date                           | leases.lease\_start                |                                      |
| Original Occupancy      | leases.original\_occupancy                          | N/A                                | First move-in date                   |
| Last Extension          | Derived from lease\_escalations                     | Derived from lease\_escalations    | Most recent escalation               |
| No. of Extensions       | leases.num\_renewals                                | Count from lease\_escalations      |                                      |
| Current Expiration      | leases.expiration\_date                             | leases.lease\_expiration           |                                      |
| Initial Lease Term      | leases.firm\_term\_years                            | Calculated from start/expiration   | Years                                |
| Total Term (w/ Options) | leases.total\_term\_years                           | leases.renewal\_options            |                                      |
| Term Remaining          | properties.term\_remaining                          | Calculated from expiration – today | Auto-calculated                      |
| Current Annual Rent     | leases.annual\_rent                                 | leases.rent                        | fmt()                                |
| Rent / SF               | leases.rent\_psf                                    | leases.rent\_per\_sf               |                                      |
| Escalations / Bumps     | leases.rent\_escalations + lease\_escalations table | lease\_escalations table           | Show schedule                        |
| Expense Structure       | leases.expense\_structure / properties.expenses     | leases.expense\_structure          | NNN, Gross, Modified Gross           |
| Renewal Options         | leases.renewal\_options                             | leases.renewal\_option\_text       |                                      |
| Lease Structure         | properties.lease\_structure                         | N/A                                |                                      |

**Escalation Sub-Table**

Below the lease summary, render a sub-table from lease\_escalations showing the rent step schedule:

|                    |              |             |          |                |
| ------------------ | ------------ | ----------- | -------- | -------------- |
| **Effective Date** | **New Rent** | **Rent/SF** | **Type** | **% Increase** |
| 2020-01-01         | $245,000     | $18.50      | Annual   | 2.5%           |
| 2021-01-01         | $251,125     | $18.96      | Annual   | 2.5%           |
| 2022-01-01         | $257,403     | $19.43      | Annual   | 2.5%           |

**3.5 Tab 3: Operations**

Operational performance metrics. This section is richest for dialysis properties (patient volumes, revenue, payer mix) and thinner for government (workforce signals, hiring, agency risk). For both, we include rankings.

**Dialysis Operations Fields**

|                          |                                                     |                           |
| ------------------------ | --------------------------------------------------- | ------------------------- |
| **Field**                | **Source**                                          | **Notes**                 |
| Operator                 | operators.name (via medicare\_clinics.operator\_id) | norm()                    |
| Chain Organization       | medicare\_clinics.chain\_organization               | Parent company            |
| Total Patients (Current) | medicare\_clinics.latest\_estimated\_patients       | fmtN()                    |
| Patients Last Year       | medicare\_clinics.patients\_last\_year              |                           |
| Patients 2 Years Ago     | medicare\_clinics.patients\_two\_years\_ago         |                           |
| 3-Year Patient Trend     | medicare\_clinics.patient\_trend\_3yr               | pct()                     |
| Max Capacity             | medicare\_clinics.max\_patient\_capacity            |                           |
| Capacity Utilization     | medicare\_clinics.capacity\_utilization\_pct        | pct()                     |
| TTM Revenue              | medicare\_clinics.ttm\_revenue                      | fmt()                     |
| TTM Operating Costs      | medicare\_clinics.ttm\_operating\_costs             | fmt()                     |
| TTM Operating Profit     | medicare\_clinics.ttm\_operating\_profit            | fmt()                     |
| TTM Operating Margin     | medicare\_clinics.ttm\_operating\_margin            | pct()                     |
| TTM Total Treatments     | medicare\_clinics.ttm\_total\_treatments            | fmtN()                    |
| Medicare Treatments      | medicare\_clinics.ttm\_medicare\_treatments         |                           |
| Commercial Treatments    | medicare\_clinics.ttm\_commercial\_treatments       |                           |
| Payer Mix: Medicare %    | medicare\_clinics.payer\_mix\_medicare\_pct         | pct()                     |
| Payer Mix: Medicaid %    | medicare\_clinics.payer\_mix\_medicaid\_pct         | pct()                     |
| Payer Mix: Private %     | medicare\_clinics.payer\_mix\_private\_pct          | pct()                     |
| Star Rating              | medicare\_clinics.star\_rating                      | 1-5 stars                 |
| QIP Score                | qip\_scores (joined)                                | Quality Incentive Program |
| Deficiency Count         | medicare\_clinics.deficiency\_count                 |                           |
| Profit/Nonprofit         | medicare\_clinics.profit\_nonprofit                 |                           |

**Rankings Sub-Section**

For each property, show comparative rankings calculated from the full dataset:

|                      |                                       |                             |
| -------------------- | ------------------------------------- | --------------------------- |
| **Ranking**          | **Calculation**                       | **Display**                 |
| County Rank          | Rank by patients within same county   | \#3 of 12 in Dallas County  |
| State Rank           | Rank by patients within same state    | \#45 of 340 in Texas        |
| National Rank        | Rank by patients across all clinics   | \#234 of 7,800              |
| Operator Rank        | Rank within same operator’s portfolio | \#12 of 89 DaVita locations |
| Revenue Rank (State) | Rank by TTM revenue within state      | \#18 of 340 in Texas        |

Rankings should be computed as Supabase SQL views (window functions) for performance.

**Government Operations Fields**

|                          |                                       |                          |
| ------------------------ | ------------------------------------- | ------------------------ |
| **Field**                | **Source**                            | **Notes**                |
| Agency                   | properties.agency\_full\_name         | Full name                |
| Government Type          | properties.government\_type           | Federal, State, Local    |
| Federal Employee Count   | properties.federal\_employee\_count   | OPM data                 |
| OPM Headcount            | properties.opm\_headcount             |                          |
| Workforce Trend          | properties.workforce\_trend           | Growing/Stable/Declining |
| Hiring Signal Count      | properties.hiring\_signal\_count      | USAJobs data             |
| Agency Risk Level        | properties.agency\_risk\_level        |                          |
| Utilization Status       | properties.utilization\_status        |                          |
| Investment Score         | properties.investment\_score          | 0-100                    |
| Deal Grade               | properties.deal\_grade                | A/B/C/D                  |
| Total Federal Investment | properties.total\_federal\_investment | fmt()                    |
| Location Tier            | properties.location\_tier             | 1-4                      |

**3.6 Tab 4: Ownership + CRM**

This is the CRM hub for each property. It combines current ownership data with Salesforce activity history and enables new outreach directly from the LCC.

**Current Ownership**

|                 |                                             |                                                 |
| --------------- | ------------------------------------------- | ----------------------------------------------- |
| **Field**       | **Gov Source**                              | **Dia Source**                                  |
| Recorded Owner  | recorded\_owners.name                       | recorded\_owners.name                           |
| True Owner      | true\_owners.name                           | true\_owners.name                               |
| Owner Type      | true\_owners.entity\_type                   | true\_owners.owner\_type                        |
| Entity State    | true\_owners.state / recorded\_owners.state | true\_owners.state                              |
| Principal Names | ownership\_history.principal\_names         | true\_owners.contact\_1\_name, contact\_2\_name |
| Address         | ownership\_history.recorded\_owner\_address | true\_owners.notice\_address\_1                 |
| City, State     | Parsed from address                         | true\_owners.city, state                        |
| Phone           | ownership\_history.recorded\_owner\_phone   | contacts.contact\_phone                         |
| Email           | prospect\_leads.contact\_email              | contacts.contact\_email                         |
| Salesforce ID   | prospect\_leads.sf\_contact\_id             | true\_owners.salesforce\_id / sf\_company\_id   |

**Salesforce Activity Feed**

Pull from salesforce\_activities (Dia DB) matched by sf\_contact\_id or sf\_company\_id. For Gov, match via prospect\_leads.sf\_contact\_id cross-referenced to Dia DB salesforce tables. Display as a reverse-chronological activity feed:

|               |                                       |                             |
| ------------- | ------------------------------------- | --------------------------- |
| **Field**     | **Source Table**                      | **Notes**                   |
| Activity Type | salesforce\_activities.nm\_type       | Call, Email, Meeting, Task  |
| Subject       | salesforce\_activities.subject        | Activity title              |
| Date          | salesforce\_activities.activity\_date | Formatted date              |
| Assigned To   | salesforce\_activities.assigned\_to   | NorthMarq team member       |
| Notes         | salesforce\_activities.nm\_notes      | Truncated with expand       |
| Status        | salesforce\_activities.status         | Open/Completed              |
| Contact Name  | Joined: first\_name + last\_name      | From salesforce\_activities |
| Company       | salesforce\_activities.company\_name  |                             |

**Salesforce Open Tasks**

Pull from salesforce\_tasks where status \!= ‘Completed’ and who\_id or what\_id matches the contact/account:

|            |                                  |                     |
| ---------- | -------------------------------- | ------------------- |
| **Field**  | **Source**                       | **Notes**           |
| Subject    | salesforce\_tasks.subject        | Task title          |
| Priority   | salesforce\_tasks.priority       | High/Normal/Low     |
| Due Date   | salesforce\_tasks.activity\_date |                     |
| Status     | salesforce\_tasks.status         |                     |
| Related To | salesforce\_tasks.what\_name     | Account/Opportunity |
| Contact    | salesforce\_tasks.who\_name      |                     |

**Call Logging**

In-app form that writes to the call\_outcomes table (Dia DB). Fields:

|             |                             |                                                                                |
| ----------- | --------------------------- | ------------------------------------------------------------------------------ |
| **Field**   | **Maps To**                 | **Input Type**                                                                 |
| Call Date   | call\_outcomes.call\_date   | Date picker (default: today)                                                   |
| Outcome     | call\_outcomes.outcome      | Dropdown: Connected, Left VM, No Answer, Wrong Number, Email Sent, Meeting Set |
| Notes       | call\_outcomes.notes        | Textarea                                                                       |
| Next Step   | call\_outcomes.next\_step   | Text field                                                                     |
| Team Member | call\_outcomes.team\_member | Auto: Scott Briggs                                                             |

**Email Touchpoint Templates**

A “Draft Email” button that opens a template selector. Templates will be stored in a new email\_templates table (or the existing bd\_email\_templates in Dia DB). Template types to be defined later by Scott:

  - Initial outreach / introduction

  - Listing presentation follow-up

  - Market update / comp share

  - Lease expiration reminder

  - Ownership change congratulations

  - Custom / free-form

Each template will auto-populate: owner name, property address, tenant, key metrics from the property record.

**3.7 Tab 5: History**

Complete property transaction history from original development to present day. Three sub-sections displayed vertically.

**Ownership Chain**

Full reverse-chronological list from ownership\_history, linked by property\_id:

|                      |                                   |                                      |
| -------------------- | --------------------------------- | ------------------------------------ |
| **Field**            | **Gov Source**                    | **Dia Source**                       |
| Transfer Date        | ownership\_history.transfer\_date | ownership\_history.ownership\_start  |
| From (Seller)        | ownership\_history.prior\_owner   | Derived from previous record         |
| To (Buyer)           | ownership\_history.new\_owner     | Derived from owner\_id join          |
| Sale Price           | ownership\_history.sale\_price    | ownership\_history.sold\_price       |
| Cap Rate             | ownership\_history.cap\_rate      | ownership\_history.cap\_rate         |
| Developer (Original) | sales\_transactions.developer     | properties.developer                 |
| Data Source          | ownership\_history.data\_source   | ownership\_history.ownership\_source |

**Listing History**

From available\_listings + listing\_price\_history (Gov) or listing\_snapshots + listing\_price\_history (Dia):

|                |                                         |                         |
| -------------- | --------------------------------------- | ----------------------- |
| **Field**      | **Source**                              | **Notes**               |
| Listed Date    | on\_market\_date / listing\_date        |                         |
| Initial Ask    | initial\_price / asking\_price          | fmt()                   |
| Initial Cap    | initial\_cap\_rate / asking\_cap\_rate  | pct()                   |
| Final Ask      | last\_price                             | If price changed        |
| Days on Market | days\_on\_market                        |                         |
| Listing Broker | listing\_broker / listing\_broker\_name |                         |
| Status         | listing\_status                         | cleanLabel()            |
| Price Changes  | listing\_price\_history table           | Timeline of adjustments |

**Loan History**

From loans table, joined by property\_id:

|                  |                                   |                            |
| ---------------- | --------------------------------- | -------------------------- |
| **Field**        | **Gov Source**                    | **Dia Source**             |
| Lender           | loans.lender\_id → lenders.name   | loans.lender\_name         |
| Loan Amount      | loans.loan\_amount                | loans.loan\_amount         |
| Current Balance  | loans.loan\_balance               | loans.current\_balance     |
| Interest Rate    | loans.interest\_rate + rate\_type | loans.interest\_rate\_text |
| Origination Date | loans.origination\_date           | loans.origination\_date    |
| Maturity Date    | loans.maturity\_date              | loans.maturity\_date       |
| LTV              | loans.ltv                         | loans.loan\_to\_value      |
| DSCR             | loans.dscr                        | N/A                        |
| Loan Type        | loans.loan\_type                  | loans.loan\_type           |
| Status           | loans.status                      | loans.alert\_flag          |
| Prepayment       | loans.prepayment\_type + details  | N/A                        |
| Assumable        | loans.assumption\_allowed         | N/A                        |

**4. Database-Level Normalization**

**4.1 Strategy: Supabase Views**

Instead of normalizing in JavaScript (the current norm()/cleanLabel() approach), we create unified Supabase views that handle all text normalization, field mapping, and cross-table joins. The frontend simply reads from these views.

**4.2 Proposed Unified Views**

**v\_property\_detail**

Master view joining properties + leases + medicare\_clinics. One row per property with all Property tab fields pre-normalized. Created in both databases.

**v\_lease\_detail**

Joins leases + lease\_escalations. Includes computed fields: term\_remaining, num\_extensions (count of escalations), last\_extension\_date.

**v\_ownership\_current**

Joins the most recent ownership\_history record with true\_owners and recorded\_owners. Pre-joins contact info.

**v\_ownership\_chain**

Full ownership history with developer, buyer, seller joined. Ordered by transfer\_date DESC.

**v\_sf\_activity\_feed**

Union of salesforce\_activities + salesforce\_tasks + call\_outcomes, ordered by date DESC. Provides a single chronological feed for the CRM tab. Requires cross-database bridge (see section 5).

**v\_property\_rankings**

Window-function view computing county, state, national, and operator rank for each clinic by patient count and revenue.

**4.3 Normalization Functions (Postgres)**

Create a norm\_text() Postgres function that mirrors the JavaScript norm():

CREATE OR REPLACE FUNCTION norm\_text(s TEXT) RETURNS TEXT AS $$

SELECT initcap(trim(s))

$$ LANGUAGE sql IMMUTABLE;

Use norm\_text() in all views on address, city, owner names, facility names, etc.

**5. Salesforce Integration Architecture**

**5.1 Current Setup**

The organization uses SSO (single sign-on) for Salesforce, which prevents direct API authentication from the LCC. The established workaround is Power Automate flows that authenticate via the enterprise SSO and push data to Supabase.

**5.2 Existing Power Automate Flows**

  - Salesforce Tasks → salesforce\_tasks (Dia DB): Syncs open/recent tasks with subject, priority, due date, contact, account

  - Salesforce Activities → salesforce\_activities (Dia DB): Syncs call/email/meeting history with type, date, notes, assigned\_to

  - Salesforce Contacts → salesforce\_contacts (Dia DB): Syncs contact records with SF IDs for linking

  - Salesforce Accounts → salesforce\_accounts (Dia DB): Syncs account/company records

  - Flagged Emails → flagged\_emails (Dia DB): Office 365 flagged emails with sender matching

  - Calendar Events → calendar\_events (Dia DB): Multi-source calendar aggregation

**5.3 Cross-Database Bridge**

Salesforce data lives in the Dia DB, but Government properties need it too. Two approaches:

**Option A: Cross-DB API call.** The Gov detail page makes a second API call to dia-query to fetch SF activity for a matched contact\_id/sf\_company\_id. Requires a linking field (sf\_contact\_id exists on prospect\_leads in Gov DB).

**Option B: Replicate SF tables to Gov DB.** Power Automate pushes the same SF data to both Supabase projects. Simpler frontend but requires duplicate flows.

Recommended: Option A (cross-DB API call). The Gov prospect\_leads table already has sf\_contact\_id, sf\_opportunity\_id, and sf\_sync\_status fields. The LCC frontend can use these IDs to query the Dia DB’s salesforce\_activities and salesforce\_tasks tables.

**5.4 New Call Logging Flow**

When a user logs a call from the LCC:

1.  LCC frontend POSTs to /api/dia-query (table: call\_outcomes) with the call data

2.  The call\_outcomes record is created in Dia DB with contact\_id and true\_owner\_id

3.  A Power Automate trigger (on new call\_outcomes row) pushes the call log back to Salesforce as a Task/Activity

4.  This bidirectional sync keeps both systems in sync without requiring direct SF API access from LCC

**6. Implementation Roadmap**

**Phase 1: Database Views + Normalization (Sessions 1-2)**

  - Create norm\_text() function in both Supabase projects

  - Create v\_property\_detail view in both DBs

  - Create v\_lease\_detail view in both DBs

  - Create v\_ownership\_current and v\_ownership\_chain views

  - Create v\_property\_rankings view (Dia DB)

  - Deploy pending visual/normalization changes to LCC (current PR)

**Phase 2: Unified Detail Page Frontend (Sessions 3-4)**

  - Build new renderUnifiedDetail() function replacing all source-specific detail renderers

  - Implement 5-tab layout with consistent field rendering

  - Wire Property and Lease tabs to new views

  - Wire Operations tab with rankings display

  - Wire History tab with ownership chain, listing history, loan history

**Phase 3: CRM Integration (Sessions 5-6)**

  - Wire Ownership + CRM tab to salesforce\_activities and salesforce\_tasks

  - Implement cross-DB bridge for Gov properties accessing Dia SF data

  - Build call logging form that writes to call\_outcomes

  - Build email template selector and draft system

  - Test Power Automate bidirectional sync (call\_outcomes → Salesforce)

**Phase 4: Polish + Deploy (Session 7)**

  - Email touchpoint templates (content provided by Scott)

  - Responsive design refinements

  - Service worker cache versioning

  - Full browser audit and QA

  - Production deploy and verify

*End of Specification*
