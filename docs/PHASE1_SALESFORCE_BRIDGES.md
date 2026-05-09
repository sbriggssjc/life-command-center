# Phase 1 — Salesforce Bridges

Phase 1 wires the first four `connector_bridges` rows (sf.accounts,
sf.contacts, sf.opportunities, sf.activities) and the worker handlers
that turn raw SF records into LCC entities, links, and the
`v_competitive_touches` rollup.

## What ships

| Component | Path | Purpose |
|-----------|------|---------|
| Migration | `supabase/migrations/20260603000000_phase1_salesforce_bridges.sql` | `salesforce_activity_log` table + `v_competitive_touches` view. |
| Seed     | `supabase/seeds/phase1_salesforce_bridges.sql` | Inserts five bridge rows (four inbound + one paused outbound) for a given workspace. |
| Router   | `api/bridges.js` (`_route=ingest&_source=salesforce`) | Receives PA batches, validates allowlist, enqueues jobs. Same function also serves `_route=worker` and `_route=admin`. |
| Handlers | `api/_shared/bridge-handlers-salesforce.js` | Per-`job_type` upsert logic. Reuses the existing `external_identities` + `entities.metadata.salesforce` pattern. |
| Rewrites | `vercel.json` | Maps `/api/salesforce-changes`, `/api/enrichment-worker`, `/api/admin/bridges` to the consolidated router. |

> **Function count:** Phase 0 + Phase 1 add exactly **one** Vercel function
> (`api/bridges.js`). Phase 2+ adds zero — new sources land as additional
> entries in the router's `INGEST_SOURCES` / `HANDLERS` maps.

## Headline payoff: `v_competitive_touches`

Once `sf.activities` is flowing, the entity sidebar can answer:

> "Who else at Northmarq has touched this account in the last 90 days?"

```sql
select sf_owner_name, calls_90d, emails_90d, meetings_90d, last_touch_at
from v_competitive_touches
where account_entity_id = '<entity uuid>'
order by touches_90d desc;
```

A "going hot" alert is then trivial: a Teams notification when another
rep's `touches_90d` for a tracked account jumps over a threshold.

## Deployment steps

1. **Migrations applied** — Phase 0 + Phase 1 are live on the OPS Supabase
   (`xengecqvemvfknjvbvrq`). To re-verify: `select table_name from
   information_schema.tables where table_schema='public' and table_name in
   ('connector_bridges','enrichment_jobs','salesforce_activity_log');`
2. **Seed bridges per workspace** — for each workspace that should receive
   Salesforce data, run:
   ```sh
   psql "$OPS_SUPABASE_DB_URL" \
     -v workspace_id="'<workspace-uuid>'" \
     -f supabase/seeds/phase1_salesforce_bridges.sql
   ```
   The seed is idempotent — re-running updates allowlists in place but
   never resets watermarks.
3. **Set env**: `SF_INSTANCE_URL` (for deep-link generation) — same value
   used by the existing `salesforce-sync.js`.
4. **Wire Vercel Cron** (or PA scheduled flow) to hit
   `POST /api/enrichment-worker?batch=20` every minute with the
   `X-LCC-Key` header. (Internally rewrites to
   `/api/bridges?_route=worker&batch=20`.)
5. **Build the four PA flows below** and point them at
   `POST /api/salesforce-changes?bridge=sf.<name>`. (Internally rewrites
   to `/api/bridges?_route=ingest&_source=salesforce&bridge=sf.<name>`.)

## Power Automate flow specs

All four inbound flows share the same shape:

- **Trigger**: Recurrence, every 5 minutes.
- **Auth to LCC**: `X-LCC-Key: <LCC_API_KEY>`.
- **Auth to Salesforce**: the connection used by the flow's owner (service
  account preferred; falls back to a designated user's connection).
- **Watermark**: read `bridge.watermark.last_modified` via
  `GET /api/admin/bridges` once at flow start, or persist it as a flow
  variable (the `runBridgeIngest` helper advances it after each successful
  batch — query it back next tick).
- **Batching**: SOQL `LIMIT 200` per call; if result count == 200, set the
  next flow run's `runId` query to a continuation token via the SF
  `nextRecordsUrl` and POST another batch.

### Common POST shape

```json
{
  "bridge": "sf.accounts",
  "workspaceId": "<workspace-uuid>",
  "runId":   "@{workflow().run.name}",
  "records": [
    { "Id": "0015...", "Name": "Acme Corp", "Type": "Customer", ... }
  ]
}
```

### sf.accounts

```sql
SELECT Id, Name, Type, Industry,
       BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry,
       Phone, Website, ParentId, OwnerId,
       CreatedDate, LastModifiedDate
FROM Account
WHERE LastModifiedDate > {watermark}
ORDER BY LastModifiedDate ASC
LIMIT 200
```

### sf.contacts

```sql
SELECT Id, AccountId, FirstName, LastName, Name,
       Email, Phone, MobilePhone, Title,
       MailingStreet, MailingCity, MailingState, MailingPostalCode,
       OwnerId, CreatedDate, LastModifiedDate
FROM Contact
WHERE LastModifiedDate > {watermark}
ORDER BY LastModifiedDate ASC
LIMIT 200
```

### sf.opportunities

```sql
SELECT Id, AccountId, Name, StageName, Amount, CloseDate,
       Probability, OwnerId, RecordTypeId, Type,
       CreatedDate, LastModifiedDate
FROM Opportunity
WHERE LastModifiedDate > {watermark}
ORDER BY LastModifiedDate ASC
LIMIT 200
```

If the SF Account isn't ingested yet when the Opportunity arrives, the
handler returns `error: account_not_yet_ingested:<sfId>` and the worker
backs off. Once `sf.accounts` catches up, the retry succeeds.

### sf.activities

Tasks and Events live in two SOQL objects but flow through one bridge.
Run two queries per tick and concatenate the results into one POST:

```sql
SELECT Id, WhoId, WhatId, AccountId, Subject,
       ActivityDate, TaskSubtype, Type, CallType,
       Status, Priority, OwnerId, Description,
       IsTask, CreatedDate, LastModifiedDate,
       Owner.Name AS _OwnerName, Owner.Email AS _OwnerEmail
FROM Task
WHERE LastModifiedDate > {watermark}
ORDER BY LastModifiedDate ASC
LIMIT 200
```

```sql
SELECT Id, WhoId, WhatId, AccountId, Subject,
       ActivityDate, EventSubtype, Type,
       OwnerId, Description,
       CreatedDate, LastModifiedDate,
       Owner.Name AS _OwnerName, Owner.Email AS _OwnerEmail,
       false AS IsTask
FROM Event
WHERE LastModifiedDate > {watermark}
ORDER BY LastModifiedDate ASC
LIMIT 200
```

The handler categorizes each row (call/email/meeting/task/other) from
`TaskSubtype`/`EventSubtype`/`Type`/`CallType`, lands it in
`salesforce_activity_log`, and refreshes `unified_contacts.last_*_date`
+ counters when the WhoId resolves to a known unified contact.

## Verifying the first run

```sql
-- Bridge freshness
select bridge_key, last_run_at, last_success_at, consecutive_failures, watermark
from connector_bridges where workspace_id = '<ws>';

-- Recent ingest activity
select bridge_id, started_at, status, rows_in, rows_accepted, rows_dropped, drop_reasons
from bridge_runs
where workspace_id = '<ws>'
order by started_at desc limit 20;

-- Queue depth
select status, count(*) from enrichment_jobs
where workspace_id = '<ws>' group by status;

-- Competitive intel sample
select * from v_competitive_touches
where workspace_id = '<ws>'
order by touches_90d desc
limit 10;
```

## Outbound (Phase 1.5)

The seed includes one paused outbound bridge: `sf.touchpoint.log`
(write_policy='minimal', write_allowlist on Task with eight fields:
WhoId, WhatId, Subject, Description, ActivityDate, Type, Status,
Priority). It's seeded so the contract is documented, but stays paused
until:

1. A `_route=write` action is added to `api/bridges.js` (uses
   `enforceWriteAllowlist` from `bridges.js`).
2. A PA flow is created that listens for outbound webhook calls and
   inserts the SF Task on behalf of the LCC.
3. `connector_bridges.status` is flipped from 'paused' to 'active' for
   that workspace.

Until then, the existing `PA_COMPLETE_TASK_URL` and
`PA_NEW_LEAD_WEBHOOK_URL` paths continue to handle their narrow
write-back duties. No property-ownership detail flows back at any phase
— marketing handles that surface in Salesforce directly.

## Known limitations to revisit

- **No SF user mapping yet.** `salesforce_activity_log.actor_user_id` is
  always null on first ingest. A Phase 1.5 task is to add a
  `salesforce_user_mappings(sf_user_id, user_id)` table and a backfill
  job that fills `actor_user_id` from `sf_owner_id`.
- **unified_contacts soft-merge is conservative.** The contact handler
  refreshes only first/last name and the SF link fields; it does not
  overwrite `title`, `phone`, or `company_name` even when SF has fresher
  values. The `field_sources` provenance map is the right place to
  decide overwrite-vs-defer per field; that wiring is deferred.
- **Account ↔ entity dedup is canonical-name based.** Two SF Accounts
  with the same canonicalized name will collide on first ingest. The
  fuzzy-match scoring in `salesforce-sync.js` is more careful — adopting
  it here is a small follow-up.
- **No backfill mode.** The 5-minute incremental flow is the only path.
  Initial backfill needs a one-shot PA flow that runs without a watermark
  filter and posts in batches of 200; the bridge accepts these the same way.
