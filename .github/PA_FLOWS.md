# Power Automate Flow Configurations — Life Command Center

This document describes the Power Automate flows that connect Salesforce, Outlook,
and other systems to the LCC API. Each flow is a webhook-based integration that
fires when a specific event occurs in the source system.

---

## Flow 1: Listing Webhook (ELA Executed → Listing-as-BD Pipeline)

### Trigger
Salesforce → Deal record updated to **Status = "ELA Executed"** with a related **Listing** record.

### Purpose
When the team secures a new listing (evidenced by an Executed Exclusive Listing Agreement),
this flow automatically:
1. Creates or updates a listing entity in LCC
2. Links the Salesforce Deal ID and Listing ID as external identities
3. Fires a `listing_created` signal for the activity feed
4. Runs the listing-as-BD pipeline (T-011 same asset type/state + T-012 geographic proximity matching)
5. Queues matched contacts as inbox items for broker review

### Endpoint
```
POST https://life-command-center.vercel.app/api/listing-webhook
```
Rewrites to: `api/sync?_route=listing-webhook`

### Authentication
Header-based webhook secret:
```
x-pa-webhook-secret: <PA_WEBHOOK_SECRET from Vercel env vars>
```
The flow must include this header on every request. The secret is validated using
constant-time comparison in `authenticateWebhook()`.

### Request Payload
```json
{
  "deal_id": "006XXXXXXXXXXXXXXX",
  "deal_name": "1234 Main St - GSA",
  "deal_status": "ELA Executed",
  "deal_owner": "Scott Briggs",
  "listing": {
    "sf_listing_id": "a0XXXXXXXXXXXXXXXXX",
    "name": "1234 Main St, Springfield, IL",
    "address": "1234 Main St",
    "city": "Springfield",
    "state": "IL",
    "zip": "62701",
    "asset_type": "government",
    "domain": "government",
    "list_price": 4500000,
    "cap_rate": 6.25,
    "noi": 281250,
    "building_sf": 15000,
    "land_sf": 43560,
    "year_built": 2005,
    "tenant": "GSA / FBI",
    "lease_expiration": "2035-06-30",
    "remaining_term_years": 9.2,
    "om_url": null,
    "website_url": null
  },
  "seller_entity_id": null
}
```

### Field Mapping (Salesforce → Payload)

| Payload Field | Salesforce Source |
|---|---|
| `deal_id` | Deal.Id |
| `deal_name` | Deal.Name |
| `deal_status` | Deal.Status__c |
| `deal_owner` | Deal.Owner.Name |
| `listing.sf_listing_id` | Listing.Id |
| `listing.name` | Listing.Name |
| `listing.address` | Listing.Property_Address__c |
| `listing.city` | Listing.Property_City__c |
| `listing.state` | Listing.Property_State__c |
| `listing.zip` | Listing.Property_Zip__c |
| `listing.asset_type` | Listing.Asset_Type__c (lowercase: "government" or "dialysis") |
| `listing.domain` | Same as asset_type |
| `listing.list_price` | Listing.List_Price__c |
| `listing.cap_rate` | Listing.Cap_Rate__c |
| `listing.noi` | Listing.NOI__c |
| `listing.building_sf` | Listing.Building_SF__c |
| `listing.land_sf` | Listing.Land_SF__c |
| `listing.year_built` | Listing.Year_Built__c |
| `listing.tenant` | Listing.Tenant_Name__c |
| `listing.lease_expiration` | Listing.Lease_Expiration__c (YYYY-MM-DD) |
| `listing.remaining_term_years` | Listing.Remaining_Term__c |
| `listing.om_url` | Listing.OM_URL__c (null initially, updated later) |
| `listing.website_url` | Listing.Website_URL__c (null initially, updated later) |
| `seller_entity_id` | (Optional) LCC entity UUID if the seller is already in the system |

### Power Automate Flow Steps

1. **Trigger**: Salesforce — "When a record is modified"
   - Object: Deal (Opportunity)
   - Filter: `Status__c eq 'ELA Executed'` AND `Team__c eq 'Team Briggs'`

2. **Condition**: Check that `Status__c` changed to "ELA Executed" (not already that value)
   - Use the `triggerBody()?['Status__c']` vs prior value

3. **Get Related Listing**: Salesforce — "Get record"
   - Object: Listing__c
   - Filter: `Deal__c eq triggerBody()?['Id']`

4. **Compose Payload**: Build the JSON payload per the schema above
   - Map each Salesforce field to the corresponding payload field
   - Set `asset_type` and `domain` to lowercase (use `toLower()` expression)
   - Set `deal_owner` from the Owner lookup

5. **HTTP Action**: POST to LCC
   ```
   Method: POST
   URI: https://life-command-center.vercel.app/api/listing-webhook
   Headers:
     Content-Type: application/json
     x-pa-webhook-secret: @{variables('PA_WEBHOOK_SECRET')}
   Body: @{outputs('Compose_Payload')}
   ```

6. **Error Handling**: Configure "Run after" on a parallel branch
   - On failure: Send notification email to Scott with the error details
   - Log to a SharePoint list or Teams channel for monitoring

### Response
```json
{
  "ok": true,
  "entity_id": "uuid-of-created-or-updated-entity",
  "action": "created",
  "listing_bd_pipeline": {
    "total_queued": 12,
    "t011_same_asset": { "matched": 8, "queued": 8 },
    "t012_geographic": { "matched": 6, "queued": 4 }
  }
}
```

### Deduplication
The webhook uses `sf_listing_id` and `sf_deal_id` stored in the entity's
`external_identities` JSONB field. If a listing with the same SF ID already exists,
it updates instead of creating a duplicate. This makes the flow safe to retry.

### OM/Website Update (Supported)
When the OM is uploaded or the property website goes live, a second PA flow calls
the same endpoint with the updated `om_url` and `website_url` fields. The webhook:
- Matches the existing entity via `sf_listing_id` deduplication
- Updates the entity metadata with the new URLs
- Fires a `listing_collateral_updated` signal
- Logs an activity event noting what changed
- Does NOT re-run the BD pipeline (that only runs on initial creation)

**Second PA Flow Trigger**: Salesforce — Listing record modified
- Filter: `OM_URL__c ne null` OR `Website_URL__c ne null`
- Payload: same schema, just include the updated `om_url` and/or `website_url`

---

## Flow 2: Outlook Flagged Email Intake

### Trigger
Outlook → Email flagged by user in the "LCC Intake" folder.

### Endpoint
```
POST https://life-command-center.vercel.app/api/intake-outlook-message
```
Rewrites to: `api/intake?_route=outlook-message`

### Authentication
```
Authorization: Bearer <LCC_API_KEY>
```

### Payload
Standard Outlook message properties (subject, body, from, to, receivedDateTime, etc.)
as provided by the Power Automate Outlook connector's "When a new email arrives" trigger.

---

## Flow 3: LoopNet Inquiry Email Ingest (marketing_leads)

### Trigger
Outlook — new email arrives in `Inbox/Property marketing/LoopNet` matching a
LoopNet inquiry / lead notification (sender like `donotreply@loopnet.com`,
subject containing "Inquiry" / "Lead" / "Contact"). Best built as an Outlook
"When a new email arrives in a shared mailbox" trigger with a folder filter.

### Purpose
Parse the inquiry email body to extract lead name / email / phone / company /
property reference / inquiry type, then INSERT a row into `dia.marketing_leads`
with `source='loopnet'` and create a matching `salesforce_activities` Task
(SF-matched on email when possible).

### Endpoint
```
POST https://life-command-center.vercel.app/api/loopnet-ingest
```
Vercel rewrites this to `/api/sync?_route=loopnet-ingest`. The handler
proxies to the `lead-ingest` Edge Function on the Dialysis_DB project
(`zqzrriwuavgrquhisnoa`) at action `loopnet`.

### Authentication
```
x-pa-webhook-secret: <PA_WEBHOOK_SECRET from Vercel env vars>
```
Constant-time compared in `authenticateWebhook()`. If `PA_WEBHOOK_SECRET`
is unset (transitional mode), the endpoint accepts requests without a
secret — but production should always send it.

### Request Payload
```json
{
  "source_ref": "<unique-per-email — e.g. Outlook InternetMessageId>",
  "deal_name":  "<email subject, e.g. 'LoopNet Inquiry — 123 Main St'>",
  "raw_body":   "<plain-text email body>",
  "status":     "new"
}
```

Only `raw_body` is strictly required — the parser extracts everything from
it. `source_ref` is used for dedup; reusing the same value 409s as a
duplicate (which the handler turns into `{ok:true, duplicate:true}`).

### Parser fields extracted from `raw_body`
The parser (`parseLoopNetEmail` in
`supabase/functions/lead-ingest/index.ts:154`) looks for these labels
case-insensitively:

| Output field | Label patterns recognized |
|---|---|
| `lead_name` | Name:, Full Name:, Contact Name:, From:, Sender:, Inquirer:, Prospect Name:, Buyer Name: |
| `lead_company` | Company:, Firm:, Organization:, Brokerage:, Company Name:, Buyer Company:, Investor Group: |
| `activity_type` | Inquiry Type:, Request Type:, Type:, Action:, Interest:, Lead Type:, Inquiry About: |
| `property_ref` (→ `deal_name`) | Property:, Listing:, Property Name:, Property Address:, Listing Name:, Asset:, Subject Property: |
| `activity_detail` | Message:, Comments:, Notes:, Additional Info:, Inquiry Message: |
| `lead_email` | First `\w+@\w+\.\w+` match anywhere in the body |
| `lead_phone` | First `(NNN) NNN-NNNN` style match |
| `listing_id` | `Listing ID:`, `Listing #:`, `Listing Number:` followed by digits |

LoopNet's actual email format may not match all of these. If your captured
emails use different label words, extend the regex lists in
`parseLoopNetEmail` (NOT a frequent change — LoopNet's template is stable).

### Power Automate build steps (one-time setup)

1. New automated cloud flow, trigger: "When a new email arrives in a shared
   mailbox (V3)" or "When a new email arrives (V3)". Folder filter:
   `Inbox/Property marketing/LoopNet`.
2. Optional: add a "Condition" step that requires the sender to be
   `donotreply@loopnet.com` (or whatever LoopNet sends from) to avoid
   triggering on forwards.
3. Action: "HTTP" — Method `POST`, URI
   `https://life-command-center.vercel.app/api/loopnet-ingest`, headers:
   ```
   Content-Type: application/json
   x-pa-webhook-secret: @{variables('PA_WEBHOOK_SECRET')}
   ```
   Body:
   ```json
   {
     "source_ref": "@{triggerOutputs()?['body/internetMessageId']}",
     "deal_name":  "@{triggerOutputs()?['body/subject']}",
     "raw_body":   "@{triggerOutputs()?['body/body/content']}",
     "status":     "new"
   }
   ```
4. (Optional) Parse JSON on the response and write `lead_id` to a tracking
   table or Teams channel so missed parses are visible.

### Verify the flow

After enabling the flow, send yourself a synthetic LoopNet-shaped email,
or use this PowerShell probe (no PA needed):

```powershell
$secret = "<PA_WEBHOOK_SECRET>"
Invoke-RestMethod `
  -Method Post `
  -Uri "https://life-command-center.vercel.app/api/loopnet-ingest" `
  -Headers @{ "Content-Type" = "application/json"; "x-pa-webhook-secret" = $secret } `
  -Body (@{
    source_ref = "test-$(Get-Date -Format yyyyMMddHHmmss)"
    deal_name  = "Test LoopNet Inquiry — 123 Main St"
    raw_body   = "Name: Jane Tester`r`nCompany: Test LLC`r`nPhone: (555) 555-1234`r`nEmail: jane@example.com`r`nProperty: 123 Main St`r`nInquiry Type: Buyer Interest"
    status     = "new"
  } | ConvertTo-Json)
```

Expected response: `{ok: true, lead_id: "<uuid>", sf_activity_id: "<uuid>", parsed: {...}, sf_match: null}`. Then check
`select * from dia.marketing_leads where source='loopnet' order by ingested_at desc limit 5;`
in the Supabase dashboard.

---

## Flow 4: RCM Inquiry Email Ingest (marketing_leads)

### Trigger
Outlook — new email arrives in `Inbox/Property marketing/RCM` from RCM
LightBox (typically `notifications@rcm1.com` / `noreply@rcmcapitalmarkets.com`).

### Purpose
Same pattern as Flow 3 but for RCM-sourced inquiries. Currently active:
~3 leads per week land via this path.

### Endpoint
```
POST https://life-command-center.vercel.app/api/rcm-ingest
```
Vercel rewrites to `/api/sync?_route=rcm-ingest` → proxies to `lead-ingest`
Edge Function with action `rcm`.

### Authentication
Same `x-pa-webhook-secret` header pattern as Flow 3.

### Request Payload
Identical envelope to Flow 3 — `{source_ref, deal_name, raw_body, status}`.
RCM's parser (`parseRcmEmail`, same file) understands an additional inline
format common to RCM emails:

```
Name:James DurandCompany:Mapleton InvestmentsFrom Phone:(310) 209-7243
```

(All on one line because of `Html_to_text` collapsing.) The parser
handles that via the `inlinePattern` regex; the standard label-based
parser is the fallback.

### Verify the flow

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "https://life-command-center.vercel.app/api/rcm-ingest" `
  -Headers @{ "Content-Type" = "application/json"; "x-pa-webhook-secret" = $secret } `
  -Body (@{
    source_ref = "test-rcm-$(Get-Date -Format yyyyMMddHHmmss)"
    deal_name  = "Test RCM Inquiry"
    raw_body   = "Name:Test PersonCompany:Test LLCFrom Phone:(555) 555-1234"
    status     = "new"
  } | ConvertTo-Json)
```

---

## Flow 5: Live Listing Ingest (LoopNet/CoStar saved searches)

### Trigger
Scheduled — runs daily at 6:00 AM CT.

### Endpoint
```
POST https://life-command-center.vercel.app/api/live-ingest
```
Rewrites to: `api/sync?_route=live-ingest`

### Authentication
```
x-pa-webhook-secret: <PA_WEBHOOK_SECRET>
```

### Purpose
Ingests new LoopNet/CoStar listings matching saved search criteria into
`dia.available_listings` as potential acquisition targets or market
intelligence. NOT the same as Flow 3 (which is for inbound inquiry emails);
this is the outbound discovery side.

---

## Environment Variables Required

| Variable | Location | Purpose |
|---|---|---|
| `PA_WEBHOOK_SECRET` | Vercel env vars | Webhook authentication for PA flows |
| `LCC_API_KEY` | Vercel env vars | Bearer token auth for PA flows using standard auth |
| `SUPABASE_URL` | Vercel env vars | LCC Opps Supabase endpoint |
| `SUPABASE_SERVICE_KEY` | Vercel env vars | LCC Opps service role key |

---

## Testing Webhooks Locally

Use curl to simulate a PA webhook call:
```bash
curl -X POST https://life-command-center.vercel.app/api/listing-webhook \
  -H "Content-Type: application/json" \
  -H "x-pa-webhook-secret: YOUR_SECRET_HERE" \
  -d '{
    "deal_id": "006TEST",
    "deal_name": "Test Listing",
    "deal_status": "ELA Executed",
    "deal_owner": "Scott Briggs",
    "listing": {
      "sf_listing_id": "a0TEST",
      "name": "Test Property",
      "address": "123 Test St",
      "city": "San Jose",
      "state": "CA",
      "asset_type": "government",
      "domain": "government",
      "list_price": 5000000,
      "tenant": "GSA / IRS"
    }
  }'
```
