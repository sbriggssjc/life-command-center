# Flow Detail: LCCSFFlow1 Queue Worker

Last updated: 2026-05-11
Flow export: `LCCSFFlow1_20260511211808.zip`
Definition path: `Microsoft.Flow/flows/c53bc3cf-22a8-41cf-bb57-02705aa6f2c5/definition.json`

## Intent
Poll pending Salesforce sync requests from `sf_sync_queue`, process each request by `kind`, and write outcomes back to queue/domain records.

## Trigger
- Type: `Recurrence`
- Frequency: `Minute`
- Interval: `1`
- Start time observed: `2026-04-23T19:15:00Z`

## High-Level Action Topology
1. `ListPending` HTTP GET from Supabase queue:
   - filter `status=pending`
   - filter `kind in (find_account, find_contact, link_account, link_contact)`
   - ordered by `requested_at asc`
   - limit `10`
2. Parse queue rows (`Parse_JSON`).
3. `Apply_to_each` queue row:
   - mark row `processing`,
   - switch by `kind`,
   - run specific branch actions,
   - patch queue row completion/error state.
4. Branches in switch:
   - `find_account`: Salesforce account query + queue patch.
   - `find_contact`: Salesforce contact query + queue patch.
   - `link_account`: patch domain owner row + queue patch.
   - `link_contact`: patch domain contact row + queue patch.

## Contract and Data Dependencies
- Queue table: `sf_sync_queue` (LCC Opps Supabase project).
- Domain table updates observed:
  - `true_owners` (link account path),
  - `contacts` (link contact path).
- Connector: `shared_salesforce`.
- Multiple direct HTTP PATCH calls to Supabase REST endpoints.

## Key Risks
1. 1-minute polling can amplify duplicate processing and transient errors.
2. Write surface complexity from multiple direct PATCH endpoints.
3. P0 security issue: embedded bearer/service-role credentials observed in flow export definition.
4. No documented dead-letter/max-retry policy per `kind`.

## P0 Security Remediation (Immediate)
1. Rotate any credential material exposed in exported definitions.
2. Replace embedded secrets with secure runtime references/managed secret patterns.
3. Re-export and verify no credentials are present in definition payload.
4. Record rotation timestamp and owner in `FLOW_CHANGES_LOG.md`.

## Recommended Reliability Controls
1. Add idempotency guard per queue row before each branch write.
2. Add max retry count and dead-letter status per queue row.
3. Emit correlation fields for run tracing:
   - flow run id,
   - queue row id,
   - target record id,
   - final status.
4. Increase observability for per-kind success/failure rates and queue lag.

## Evidence Snapshot
- Trigger: `Recurrence` every 1 minute.
- Top actions: `ListPending`, `Parse_JSON`, `Apply_to_each`.
- Switch expression: `@items('Apply_to_each')['kind']`
- Kinds observed: `find_account`, `find_contact`, `link_account`, `link_contact`.
- Connector map: `shared_salesforce`.
- API map: `shared_salesforce`.

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`
- Last credential rotation date: `TBD`

