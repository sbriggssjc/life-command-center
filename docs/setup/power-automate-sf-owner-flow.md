# Power Automate — SF owner capture flow (`owners_by_ids`)

Durable, backwards + forwards owner capture for owner-scoped My Day. Adds **one new
operation** to the EXISTING Salesforce lookup flow (the one behind
`SF_LOOKUP_WEBHOOK_URL`), so **no new secret / env var** is introduced.

- **Backwards:** LCC's `POST /api/sf-owner-sync` pulls owners for every linked deal and
  writes `lcc_entity_owner_override`.
- **Forwards:** a weekly pg_cron re-runs that sync so Salesforce reassignments propagate.

The LCC side is already built (`getSalesforceOwnersByIds`, the `/api/sf-owner-sync`
handler, and the `lcc_apply_owner_backfill` / `lcc_deal_sf_ids` RPCs). Once the flow
operation below exists and LCC is redeployed, it's live.

---

## Part A — build the flow operation (you, in Power Automate)

Open **Power Automate → My flows →** the existing "SF Lookup" flow (the one whose HTTP
trigger URL is in `SF_LOOKUP_WEBHOOK_URL`) → **Edit**.

### A1. Let the trigger accept the new fields
Open the **When an HTTP request is received** trigger. In its **Request Body JSON Schema**,
make sure these properties exist (add `sobject` and `ids`):
```json
{
  "type": "object",
  "properties": {
    "operation": { "type": "string" },
    "value":     { "type": "string" },
    "sobject":   { "type": "string" },
    "ids":       { "type": "array", "items": { "type": "string" } }
  }
}
```

### A2. Branch on the operation
If the flow already has a **Switch** on `operation`, add a case. If it uses a single
Salesforce action, add a **Switch** (Control → Switch) `On = triggerBody()?['operation']`
and move the existing logic into its own case, then add a new case:

**Case: `owners_by_ids`**

### A3. Build the quoted Id list
1. **Data Operation → Select** — rename **Select_QuotedIds**
   - **From:** `@{triggerBody()?['ids']}`
   - Switch the map to **text mode** (the little icon on the right) and enter:
     `@{concat('''', item(), '''')}`  → produces `'001…'` per id.
2. **Data Operation → Join** — rename **Join_Ids**
   - **From:** `@{body('Select_QuotedIds')}`
   - **Join with:** `,`  → produces `'001…','001…'`

### A4. Query Salesforce (handle Account and Opportunity)
Add a **Condition**: `triggerBody()?['sobject']` **is equal to** `Opportunity`.

- **If yes → Salesforce → Get records (V3)**
  - **Salesforce Object Type:** `Opportunity`
  - **Filter Query:** `Id IN (@{outputs('Join_Ids')})`
  - **Select Query:** `Id, OwnerId`  *(add `, Owner.Name` if you want the name too — optional; LCC maps OwnerId on its own)*
- **If no → Salesforce → Get records (V3)**
  - **Salesforce Object Type:** `Account`
  - **Filter Query:** `Id IN (@{outputs('Join_Ids')})`
  - **Select Query:** `Id, OwnerId`

> Only `Id` and `OwnerId` are required. LCC maps `OwnerId` (a 005… User Id) to the right
> teammate via each user's `salesforce_owner_id`, which is already populated for all four
> users — so you do **not** need Owner.Name.

### A5. Shape the response
In **each** branch, after Get records:
1. **Data Operation → Select** — **Select_Owners**
   - **From:** the Get records **value** array — `@{outputs('Get_records')?['body/value']}`
     (use the dynamic-content "value" from that branch's Get records action)
   - Map (object mode):
     - `Id`      → `@{item()?['Id']}`
     - `OwnerId` → `@{item()?['OwnerId']}`
     - `OwnerName` → `@{item()?['Owner']?['Name']}`  *(only if you selected Owner.Name)*
2. **Response** action (or **Respond to the HTTP request**)
   - **Status Code:** `200`
   - **Headers:** `Content-Type: application/json`
   - **Body:**
     ```json
     {
       "ok": true,
       "operation": "owners_by_ids",
       "owners": @{body('Select_Owners')}
     }
     ```

### A6. Error path
Match the flow's existing error convention. Simplest: wrap A4–A5 in a **Scope**, add a
second **Response** with **Configure run after → has failed**, returning:
```json
{ "ok": false, "reason": "flow_error", "detail": "owners_by_ids failed" }
```

**Save.** The trigger URL is unchanged, so `SF_LOOKUP_WEBHOOK_URL` stays the same.

---

## Part B — LCC side (already built; ships on next deploy)

- `api/_shared/salesforce.js` → `getSalesforceOwnersByIds(ids, sobject)` — batches ≤150,
  calls the flow, normalizes to `{sf_id, sf_owner_id, owner_name}`.
- `api/_handlers/sf-owner-sync.js` → `handleSfOwnerSync` — gathers deal SF ids
  (`rpc/lcc_deal_sf_ids`), splits Account/Opportunity by key-prefix, pulls owners, applies
  via `rpc/lcc_apply_owner_backfill`. Route `POST /api/sf-owner-sync` (`?dry=1`, `?limit=N`).
- `admin.js` + `server.js` — route mounted as `_route='sf-owner-sync'`.
- DB (live): `lcc_deal_sf_ids`, `lcc_apply_owner_backfill`, `lcc_set_entity_owner_from_sf`,
  `lcc_entity_owner_override` (manual overrides preserved).

Merge, redeploy Railway, then `npm run verify:deploy`.

---

## Part C — first backfill (backwards)

Dry-run first (no writes), then apply:
```
curl -s -X POST "https://<railway-host>/api/sf-owner-sync?dry=1"    # coverage preview
curl -s -X POST "https://<railway-host>/api/sf-owner-sync"          # writes overrides
```
Expect `owners_returned` ≈ the number of linked deals (~63 today: 61 Accounts). Coverage
grows as more deals link to Salesforce accounts.

---

## Part D — weekly refresh (forwards)

After the flow + deploy are verified, enable the recurring re-pull (run on LCC Opps):
```sql
select cron.schedule('lcc-sf-owner-sync-weekly', '30 6 * * 1',
  $$ select lcc_cron_post('/api/sf-owner-sync', '{}'::jsonb) $$);
```
Mondays 06:30 UTC. Owner reassignments in Salesforce then propagate to My Day weekly; manual
LCC overrides are never overwritten.

---

## Notes / limits
- Only deals that carry a Salesforce Account/Opportunity Id in the spine can be owned this
  way (~63 today). Growing SF linkage coverage is a separate, existing sync.
- Opportunity handling is wired but currently 0 deals use `sf_opp_id`; Account path is the
  active one.
- Single-deal live capture on link is available (`lcc_set_entity_owner_from_sf`) but left as
  an optional enhancement in `sf-account-link.js`; the weekly sync already covers forwards.
