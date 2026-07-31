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

Confirmed from the flow export: the flow is an HTTP trigger → **Switch on
`@triggerBody()?['operation']`**, and each case runs the Salesforce **Execute a SOQL query**
action (`ExecuteSoqlQuery`). The `find_account_by_name` case already selects
`OwnerId, Owner.Name`, so we just add one more SOQL case. Open the flow → **Edit**.

> **Owner source = the Task assignee.** In this org the Account owner is a generic
> integration user, so we don't read Account.OwnerId. The real deal owner is whoever
> the Salesforce **Task** on that account is assigned to. The query below reads Task by
> `WhatId` (the account/opportunity the task is on), filtered to the team's user ids,
> most-recent first; LCC takes the most recent task's owner as the deal owner.

### A1. Trigger schema — add `ids` and `owner_in`
Open **When an HTTP request is received** → **Request Body JSON Schema**, replace with:
```json
{"type":"object","properties":{"operation":{"type":"string"},"value":{"type":"string"},"sobject":{"type":"string"},"ids":{"type":"array","items":{"type":"string"}},"owner_in":{"type":"string"}}}
```

### A2. Add a Switch case `owners_by_ids`
On the existing **Switch**, **+ Add case**. Set the case value to exactly:
```
owners_by_ids
```
Add these three actions inside it, in order:

1. **Data Operation → Select** — rename **Select_QuotedIds**
   - **From:** `@triggerBody()?['ids']`
   - Toggle map to **text mode** (icon top-right of the Map box), value:
     `@{concat('''', item(), '''')}`   *(four single-quotes = one literal quote → `'001…'`)*
2. **Data Operation → Join** — rename **Join_Ids**
   - **From:** `@body('Select_QuotedIds')`
   - **Join with:** `,`
3. **Salesforce → Execute a SOQL query** — **SoqlOwners** (the Task signal)
   - **Query:** query by **`Task.AccountId`** (auto-populated from the account OR the contact
     on the task — catches contact-logged activity that `WhatId` alone misses):
     ```
     SELECT AccountId, OwnerId, Owner.Name, LastModifiedDate FROM Task WHERE AccountId IN (@{body('Join_Ids')}) AND OwnerId IN (@{triggerBody()?['owner_in']}) ORDER BY LastModifiedDate DESC
     ```
4. **Salesforce → Execute a SOQL query** — add **SoqlOpps** (the Opportunity signal —
   the explicit deal owner, highest weight):
   ```
   SELECT AccountId, OwnerId, Owner.Name, LastModifiedDate FROM Opportunity WHERE AccountId IN (@{body('Join_Ids')}) AND OwnerId IN (@{triggerBody()?['owner_in']}) AND IsClosed = false ORDER BY LastModifiedDate DESC
   ```

### A3. Response (multi-signal)
Set **Respond_owners** Body to return each signal array keyed by source:
- **Status Code:** `200`, Header `Content-Type: application/json`, Body:
  ```json
  {"ok": true, "operation": "owners_by_ids", "signals": {"sf_task": "@outputs('SoqlOwners')?['body']?['records']", "sf_opportunity": "@outputs('SoqlOpps')?['body']?['records']"}}
  ```
  LCC reads `AccountId` per row, maps `OwnerId`→teammate, records each source as weighted
  evidence (Opportunity 1.0, Task 0.8), and reconciles. Empty arrays are fine.

### A4. Error path (match the flow's PostDeadLetter/Terminate convention)
Optional: on the SOQL actions, **Configure run after** → add a **Response** with run-after
**has failed / timed out**, Status `200`, body
`{"ok": false, "reason": "flow_error", "operation": "owners_by_ids"}`.

**Save.** The trigger URL is unchanged, so `SF_LOOKUP_WEBHOOK_URL` stays the same — no env change.

> Only `AccountId` and `OwnerId` are strictly needed; LCC maps the 005… OwnerId to the right
> teammate via each user's `salesforce_owner_id`. `Owner.Name` is a convenience fallback.
> Back-compat: if you only do the `AccountId` change and keep the old flat `owners` response,
> LCC still reads it (as the Task signal) — the multi-signal `signals` object just adds the
> Opportunity source.

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
