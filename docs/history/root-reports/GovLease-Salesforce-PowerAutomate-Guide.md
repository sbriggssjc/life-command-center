<!-- Converted 2026-09-16 by Cowork from the root file `GovLease-Salesforce-PowerAutomate-Guide.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**GovLease → Salesforce**

Power Automate Integration Guide

March 2026 | Version 1.0

**Architecture**

The integration pushes prospect leads from the GovLease pipeline into Salesforce via Power Automate, creating and maintaining Leads, Campaign Members, Tasks, and Notes.

**Data Flow:**

> GovLease (sf\_push.py) → HTTP POST → Power Automate → Salesforce

**Salesforce objects created/updated per lead:**

  - Lead — core prospect record with property details and custom fields

  - Campaign — grouped by campaign\_name; created if not found

  - Campaign Member — links Lead to Campaign

  - Task — follow-up action linked to the Lead

  - Note (ContentNote) — research context linked to the Lead

**Volume:** \~3,300 leads for initial push, then 10–50/week from new GSA events and ownership changes.

**Prerequisites**

Complete these before building the flow:

**1. Salesforce Custom Fields**

Create these custom fields on the Lead object in Salesforce Setup → Object Manager → Lead → Fields & Relationships → New:

|                         |          |            |                             |
| ----------------------- | -------- | ---------- | --------------------------- |
| **API Name**            | **Type** | **Length** | **Description**             |
| GSA\_Lease\_Number\_\_c | Text     | 20         | GSA lease tracking number   |
| Annual\_Rent\_\_c       | Currency |            | Annual rent amount          |
| Square\_Feet\_\_c       | Number   |            | Building square footage     |
| Estimated\_Value\_\_c   | Currency |            | Estimated property value    |
| Lease\_Expiration\_\_c  | Date     |            | Lease expiration date       |
| Government\_Agency\_\_c | Text     | 100        | Federal/state tenant agency |
| Priority\_Score\_\_c    | Number   |            | Lead priority score (0–100) |
| Deal\_Size\_Tier\_\_c   | Picklist |            | micro, small, medium, large |

> **⚠** *Deal\_Size\_Tier\_\_c picklist values: micro, small, medium, large. Set field-level security to visible for the integration user profile.*

**2. Salesforce Connected App (for Power Automate)**

  - In Salesforce Setup, create a Connected App for Power Automate

  - Grant the integration user API access and permission to create/edit Leads, Campaigns, Campaign Members, Tasks, and ContentNotes

  - In Power Automate, add the Salesforce connector using these credentials

**Flow Build Steps**

**Step 1: Create the Flow**

1.  Go to Power Automate → My Flows → + New flow → Instant cloud flow

2.  Name it "GovLease Lead Sync"

3.  Select trigger: "When an HTTP request is received"

4.  Paste the JSON schema below into the Request Body JSON Schema field:

> {
> 
> "type": "object",
> 
> "properties": {
> 
> "action": { "type": "string" },
> 
> "first\_name": { "type": "string" },
> 
> "last\_name": { "type": "string" },
> 
> "company": { "type": "string" },
> 
> "title": { "type": "string" },
> 
> "email": { "type": "string" },
> 
> "phone": { "type": "string" },
> 
> "mailing\_address": { "type": "string" },
> 
> "city": { "type": "string" },
> 
> "state": { "type": "string" },
> 
> "lead\_source": { "type": "string" },
> 
> "lead\_source\_detail": { "type": "string" },
> 
> "rating": { "type": "string" },
> 
> "description": { "type": "string" },
> 
> "lease\_number": { "type": "string" },
> 
> "annual\_rent": { "type": "number" },
> 
> "square\_feet": { "type": "integer" },
> 
> "estimated\_value": { "type": "number" },
> 
> "lease\_expiration": { "type": "string" },
> 
> "agency": { "type": "string" },
> 
> "deal\_size\_tier": { "type": "string" },
> 
> "priority\_score": { "type": "integer" },
> 
> "campaign\_name": { "type": "string" },
> 
> "task\_subject": { "type": "string" },
> 
> "task\_priority": { "type": "string" },
> 
> "note\_title": { "type": "string" },
> 
> "note\_body": { "type": "string" },
> 
> "govlease\_lead\_id": { "type": "string" }
> 
> }
> 
> }

**Step 2: Flow Actions**

Add these actions in order after the HTTP trigger:

**Action 1: Search for Existing Lead**

  - Action: Salesforce → "Get records"

  - Object type: Leads

  - Filter query: Email eq '@{triggerBody()?\['email'\]}' or (Company eq '@{triggerBody()?\['company'\]}' and LastName eq '@{triggerBody()?\['last\_name'\]}')

  - Top count: 1

**Action 2: Condition — Lead Exists?**

  - Condition: length(body('Get\_records')?\['value'\]) is greater than 0

If Yes (update existing):

  - Action: Salesforce → "Update record" (Lead)

  - Record ID: first(body('Get\_records')?\['value'\])?\['Id'\]

  - Map all payload fields using the field mapping table below

If No (create new):

  - Action: Salesforce → "Create record" (Lead)

  - Map all payload fields per the table below

**Field Mapping Reference**

|                   |                           |                   |
| ----------------- | ------------------------- | ----------------- |
| **Payload Field** | **Salesforce Lead Field** | **Type**          |
| first\_name       | FirstName                 | Standard          |
| last\_name        | LastName                  | Standard          |
| company           | Company                   | Standard          |
| title             | Title                     | Standard          |
| email             | Email                     | Standard          |
| phone             | Phone                     | Standard          |
| city              | City                      | Standard          |
| state             | State                     | Standard          |
| lead\_source      | LeadSource                | Standard          |
| rating            | Rating                    | Standard          |
| description       | Description               | Standard          |
| lease\_number     | GSA\_Lease\_Number\_\_c   | Custom (Text 20)  |
| annual\_rent      | Annual\_Rent\_\_c         | Custom (Currency) |
| square\_feet      | Square\_Feet\_\_c         | Custom (Number)   |
| estimated\_value  | Estimated\_Value\_\_c     | Custom (Currency) |
| lease\_expiration | Lease\_Expiration\_\_c    | Custom (Date)     |
| agency            | Government\_Agency\_\_c   | Custom (Text 100) |
| priority\_score   | Priority\_Score\_\_c      | Custom (Number)   |
| deal\_size\_tier  | Deal\_Size\_Tier\_\_c     | Custom (Picklist) |

**Action 3: Get or Create Campaign**

  - Action: Salesforce → "Get records"

  - Object type: Campaigns

  - Filter query: Name eq '@{triggerBody()?\['campaign\_name'\]}'

  - Top count: 1

Condition: Campaign not found?

  - If Yes: Create new Campaign with Name = campaign\_name

**Action 4: Add Campaign Member**

  - Action: Salesforce → "Create record" (CampaignMember)

  - LeadId: the Lead ID from Action 2 (use Compose to capture from either branch)

  - CampaignId: the Campaign ID from Action 3

> **⚠** *If the Lead is already a Campaign Member, Salesforce returns a DUPLICATE\_VALUE error. Wrap this in a "Configure run after → has failed" scope to handle gracefully.*

**Action 5: Create Task**

  - Action: Salesforce → "Create record" (Task)

  - Subject: @{triggerBody()?\['task\_subject'\]}

  - Priority: @{triggerBody()?\['task\_priority'\]}

  - WhoId: the Lead ID

  - Status: "Not Started"

  - ActivityDate: utcNow() + 3 days (use addDays(utcNow(), 3))

**Action 6: Create Note**

  - Action: Salesforce → "Create record" (ContentNote)

  - Title: @{triggerBody()?\['note\_title'\]}

  - Content: base64(triggerBody()?\['note\_body'\]) — ContentNote body must be base64

Then link it:

  - Action: Salesforce → "Create record" (ContentDocumentLink)

  - ContentDocumentId: ContentNote ID from above

  - LinkedEntityId: the Lead ID

  - ShareType: "V" (viewer)

**Action 7: HTTP Response**

  - Action: "Response"

  - Status code: 200

  - Body:

> { "status": "ok", "sf\_lead\_id": "\<Lead ID from Action 2\>" }

**Step 3: Configure Webhook URL**

1.  Save and test the flow once in Power Automate

2.  Copy the HTTP POST URL from the trigger (it appears after the first save)

3.  Add to your .env file:

> POWER\_AUTOMATE\_WEBHOOK\_URL=https://prod-XX.westus.logic.azure.com:443/workflows/...
> 
> **⚠** *This URL contains a SAS token for authentication. Keep it secret — treat it like an API key.*

**Step 4: Test the Pipeline**

4.  Verify connectivity:

> python -m src.sf\_push --test

5.  Dry run (validates payloads, does not POST):

> python -m src.sf\_push --dry-run

6.  Push leads:

> python -m src.sf\_push --push
> 
> **⚠** *For the initial batch of \~3,300 leads, Power Automate has a default concurrency limit of 50 parallel runs. The sf\_push script should throttle to 5–10 requests/second to stay within limits. Monitor the flow run history for failures.*

**Troubleshooting**

**DUPLICATE\_VALUE on Campaign Member**

The Lead is already a member of the Campaign. Wrap the CampaignMember creation in a Scope with "Configure run after → has failed" set to continue. This is expected for re-pushed leads.

**REQUIRED\_FIELD\_MISSING on Lead**

Salesforce requires Company and LastName on Leads. Ensure sf\_push.py always sends these fields. The flow should also set defaults: Company = agency or "Unknown", LastName = "Unknown" if empty.

**HTTP 429 (Too Many Requests)**

Power Automate or Salesforce rate limit exceeded. Reduce the concurrency in sf\_push.py. For the initial batch, consider adding a 200ms delay between requests.

**ContentNote body shows garbled text**

ContentNote.Content must be base64-encoded. Use the base64() expression in Power Automate on the note\_body field.
