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

## Flow 3: Live Listing Ingest (LoopNet/CoStar)

### Trigger
Scheduled — runs daily at 6:00 AM CT.

### Endpoint
```
POST https://life-command-center.vercel.app/api/loopnet-ingest
```
Rewrites to: `api/sync?_route=loopnet-ingest`

### Authentication
```
x-pa-webhook-secret: <PA_WEBHOOK_SECRET>
```

### Purpose
Ingests new LoopNet/CoStar listings matching saved search criteria into the
LCC pipeline as potential acquisition targets or market intelligence.

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
