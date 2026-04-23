# Power Automate Flow — SF Sync Queue Worker

**Purpose:** Consume `lcc_opps.sf_sync_queue` rows that the LCC UI has enqueued
(Create SF Account, Create SF Opportunity, etc.) and execute the Salesforce
writes on Scott's behalf. The LCC server can't authenticate to SF directly
(SSO + no Connected App privileges), so every SF write is brokered by this
flow using the SSO-backed Salesforce connector.

## Architecture

```
 LCC UI ──POST /api/sf-sync-queue──▶ admin.js handleSfSyncQueue
                                      │
                                      ▼
                   lcc_opps.sf_sync_queue  (status='pending')
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │  Power Automate: SF Sync Worker     │
                    │  1. Poll pending rows (every 1min)  │
                    │  2. Switch on `kind`                 │
                    │  3. Call Salesforce connector        │
                    │  4. PATCH row: status, result        │
                    └─────────────────────────────────────┘
                                      │
                                      ▼
                            Salesforce (Accounts, Opportunities)
```

## Trigger

**Option A (preferred): Recurrence every 1 minute.** Polls the queue on a
schedule. Predictable, easy to debug, handles bursts without overloading SF.

**Option B: Supabase Database Webhook.** Fires on `INSERT INTO sf_sync_queue`
where `status='pending'`. Lower latency but requires configuring webhook
secrets and handling retries on flow failure.

Start with Option A. Migrate to B once stable.

## Flow Steps

### 1. Trigger — Recurrence

- Frequency: `1 minute`

### 2. List queued rows — HTTP to Supabase REST

- Method: `GET`
- URI: `{{ OPS_SUPABASE_URL }}/rest/v1/sf_sync_queue?status=eq.pending&order=requested_at.asc&limit=10`
- Headers:
  - `apikey`: `{{ OPS_SUPABASE_SERVICE_ROLE_KEY }}`
  - `Authorization`: `Bearer {{ OPS_SUPABASE_SERVICE_ROLE_KEY }}`
  - `Prefer`: `count=exact`
- Response schema: the JSON below (use "Generate from sample" with this).

```json
[
  {
    "id": "uuid",
    "workspace_id": "uuid",
    "kind": "create_account",
    "payload": { "name": "string", "owner_id": "string" },
    "status": "pending",
    "result": null,
    "requested_by": "string",
    "requested_at": "2026-04-23T14:00:00Z",
    "processed_at": null
  }
]
```

### 3. Apply to each — loop over rows

Inside the Apply-to-each, nest a `Switch` on `items('Apply_to_each')?['kind']`.

### 4. Mark row processing (idempotency)

Immediately PATCH the row to `status='processing'` so a second Recurrence
doesn't double-process:

- Method: `PATCH`
- URI: `{{ OPS_SUPABASE_URL }}/rest/v1/sf_sync_queue?id=eq.{{ items('Apply_to_each')?['id'] }}`
- Headers: same as step 2, plus `Content-Type: application/json`
- Body:

```json
{ "status": "processing" }
```

### 5. Switch on `kind`

#### Case: `create_account`

1. **Salesforce — Create record (V3)**
   - Object type: `Account`
   - Name: `{{ items('Apply_to_each')?['payload']?['name'] }}`
   - Optional fields the LCC payload can carry (set if non-null): `Type`,
     `Industry`, `BillingStreet`, `BillingCity`, `BillingState`,
     `BillingPostalCode`, `Phone`, `Website`, `Description`.
   - On success, the connector returns an output whose body contains the SF
     record `id`.

2. **PATCH queue row — done**
   - URI: `{{ OPS_SUPABASE_URL }}/rest/v1/sf_sync_queue?id=eq.{{ items('Apply_to_each')?['id'] }}`
   - Body:

   ```json
   {
     "status": "done",
     "result": {
       "sf_account_id": "@{outputs('Create_record')?['body']?['id']}",
       "created_at":    "@{utcNow()}"
     },
     "processed_at": "@{utcNow()}"
   }
   ```

3. **Mirror the SF id back onto the LCC owner row (gov.true_owners)**
   - Only when `payload.owner_id` is not empty.
   - Method: `PATCH`
   - URI: `{{ GOV_SUPABASE_URL }}/rest/v1/true_owners?true_owner_id=eq.{{ items('Apply_to_each')?['payload']?['owner_id'] }}`
   - Headers: gov service-role key, `Content-Type: application/json`
   - Body:

   ```json
   {
     "sf_account_id":   "@{outputs('Create_record')?['body']?['id']}",
     "sf_last_synced":  "@{utcNow()}"
   }
   ```

4. **(Optional) Post Teams notification** using the existing Teams webhook.

#### Case: `create_opportunity`

1. **Salesforce — Create record (V3)**
   - Object type: `Opportunity`
   - Name: `{{ items('Apply_to_each')?['payload']?['name'] }}` (fallback:
     `Address + " — " + utcNow('yyyy-MM-dd')`)
   - StageName: `{{ items('Apply_to_each')?['payload']?['stage_name'] }}` (default `Prospecting`)
   - CloseDate: 90 days from now — `@{formatDateTime(addDays(utcNow(), 90), 'yyyy-MM-dd')}`
   - AccountId: `{{ items('Apply_to_each')?['payload']?['sf_account_id'] }}`

2. **PATCH queue row — done** (same pattern, set `result.sf_opportunity_id`)

3. **(Optional) Mirror to gov.properties.sf_opportunity_id** if the schema
   has that column (it doesn't today — add a migration later).

#### Case: `find_account`

1. **Salesforce — Execute a SOQL query**
   ```
   SELECT Id, Name, Type, Industry
   FROM Account
   WHERE Name LIKE '%[value from payload.name]%'
   ORDER BY Name
   LIMIT 50
   ```
2. **PATCH queue row — done** with `result.candidates = <records array>`.
   (This mirrors the existing SF lookup flow Scott already has — could
   potentially be consolidated, but keeping it in the queue provides a
   durable audit trail.)

### 6. Error handling — scope + catch

Wrap each case in a "Scope" with "Configure run after" set so a sibling
catch-scope fires on failure. The catch scope PATCHes the queue row:

```json
{
  "status": "failed",
  "result": {
    "error": "@{body('Create_record')?['message']}",
    "failed_at": "@{utcNow()}"
  },
  "processed_at": "@{utcNow()}"
}
```

## Secrets

Store as PA environment variables (Admin → Environments → Variables):

- `OPS_SUPABASE_URL` — `https://xengecqvemvfknjvbvrq.supabase.co`
- `OPS_SUPABASE_SERVICE_ROLE_KEY` — service-role JWT (don't put in flow JSON)
- `GOV_SUPABASE_URL` — `https://scknotsqkcheojiaewwh.supabase.co`
- `GOV_SUPABASE_SERVICE_ROLE_KEY` — gov service-role JWT

The SF connection uses the SSO-backed Salesforce connector already on Scott's
account (same auth the existing `sf_lookup` flow uses).

## Testing

1. **Dry run**: insert a queue row via SQL:

   ```sql
   INSERT INTO sf_sync_queue (workspace_id, kind, payload, requested_by)
   VALUES ('a0000000-0000-0000-0000-000000000001',
           'create_account',
           '{"name":"LCC TEST ACCOUNT — delete me","owner_id":null}',
           'test');
   ```

2. Wait 60 seconds, refresh the row:

   ```sql
   SELECT id, status, result, processed_at FROM sf_sync_queue
   WHERE requested_by = 'test'
   ORDER BY requested_at DESC LIMIT 1;
   ```

3. Expect `status='done'`, `result.sf_account_id` populated. Verify the
   record exists in Salesforce, then delete the test row and the SF
   account.

4. End-to-end test from the UI: open Plano detail pane → Data Resolution
   Status → click **Create SF Account**. Within ~60s the chip should flip
   to green ("Salesforce Account Matched").

## Monitoring

- Add a weekly Teams alert: "SF sync queue: 3 rows stuck in processing for
  > 1hr." SQL:

  ```sql
  SELECT count(*) FROM sf_sync_queue
  WHERE status = 'processing' AND processed_at IS NULL
    AND requested_at < now() - INTERVAL '1 hour';
  ```

- Weekly Teams alert: "SF sync queue: N rows failed this week" with the
  top error messages.

## Future

- Migrate trigger to Supabase database webhook for lower latency.
- Add `kind='link_contact'` for brokers: look up a contact on an Account by
  email, create if missing, PATCH the unified_contact row.
- Add `kind='update_account'` for propagating owner-record-merge changes
  back to SF (when LCC merges two true_owner rows, SF should learn).

## Owner

- Flow: Scott Briggs
- Documented: 2026-04-23
- Schema source of truth: `supabase/migrations/20260423240000_sf_sync_queue.sql`
