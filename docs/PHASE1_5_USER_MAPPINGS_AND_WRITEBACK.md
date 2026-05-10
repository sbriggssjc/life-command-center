# Phase 1.5 — External User Mappings + SF Write-Back

Phase 1.5 closes two loops that Phase 1 left open:

1. **SF OwnerId → LCC user resolution.** Phase 1 stored the SF OwnerId
   as text in `salesforce_activity_log.sf_owner_id`, with
   `actor_user_id` always `null`. Now the SF activity handler resolves
   the OwnerId via a generic `external_user_mappings` table at write
   time, and a backfill action re-resolves the historical rows.
2. **Outbound `sf.touchpoint.log` write surface.** A new
   `_route=write` action validates payloads against the bridge's
   `write_allowlist` (still `write_policy='minimal'` by default) and
   forwards to a PA webhook. Lets LCC log a touchpoint as a SF Task
   without giving every LCC component write credentials.

Both adds keep the function count at 12 (everything plugs into
`api/bridges.js`).

## What ships

| Component | Path | Purpose |
|-----------|------|---------|
| Migration | `supabase/migrations/20260606000000_phase1_5_user_mappings.sql` | `external_user_mappings` table + `v_unmapped_sf_owners` view. |
| Helper   | `api/_shared/external-user-mappings.js` | `resolveExternalUser()` + `backfillSalesforceActorMappings()`. |
| Handler  | `api/_shared/bridge-handlers-salesforce.js` (updated) | SF activity handler now resolves `actor_user_id` inline at every ingest. |
| Router   | `api/bridges.js` (updated) | New `_route=write` for outbound; new `_route=admin&action=backfill_mappings` for the historical sweep. |
| Rewrite  | `vercel.json` | `/api/sf-write` → `/api/bridges?_route=write&bridge=sf.touchpoint.log`. |

## external_user_mappings — the universal lookup

One table covers SF OwnerIds, SharePoint `lastModifiedBy.user.id`,
Outlook mailbox owners, calendar organizers, Teams users — anything
that needs a "this external identity is one of our LCC users" mapping.

```
external_user_mappings (
  workspace_id,                        -- scoped per workspace
  source_system,                       -- 'salesforce','sharepoint',...
  external_id,                         -- SF user 18-char id, Graph user id
  external_email,                      -- preserved for re-resolution
  external_name,
  user_id,                             -- nullable; null + match_method='unmatched'
                                       -- means we tried and couldn't find anyone
  match_method,                        -- 'auto' | 'manual' | 'unmatched'
  confidence
)
unique (workspace_id, source_system, external_id)
```

### resolveExternalUser() behavior

```
First call for an unknown OwnerId
  → look up in users by email (case-insensitive, is_active=true)
  → match found    → insert mapping (match_method='auto'),       return user_id
  → no match found → insert mapping (match_method='unmatched'),  return null

Subsequent calls
  → hit unique-index lookup, return user_id (or null) without re-querying users
```

Cheap by design — every call is one indexed read, plus one upsert on
first sight per identity.

## SF activity handler change

Before:
```js
sf_owner_id:    p.OwnerId || 'unknown',
sf_owner_email: p.OwnerEmail || ...,
// actor_user_id defaults to NULL — no resolution
```

After:
```js
const actorUserId = sfOwnerId
  ? await resolveExternalUser({
      workspaceId, sourceSystem: 'salesforce',
      externalId: sfOwnerId, externalEmail, externalName
    })
  : null;
// ...
actor_user_id: actorUserId,
```

Net cost: one PostgREST read per SF activity row on first ingest of
each owner; ~zero on subsequent rows (mapping cached). For a 200-row
batch with ~20 distinct owners, that's 20 reads + 20 writes the first
time, then 200 reads on subsequent batches (still cheap).

## Backfill the historical rows

Phase 1 already shipped `salesforce_activity_log` rows with
`actor_user_id = null`. After Phase 1.5 deploys, run the backfill once
per workspace:

```sh
curl -X POST 'https://<host>/api/admin/bridges?action=backfill_mappings&source=salesforce&limit=500' \
  -H 'X-LCC-Key: <key>' \
  -H 'X-LCC-Workspace: <workspace-uuid>' \
  -H 'X-LCC-User-Email: <manager@northmarq.com>'
```

Response:
```json
{
  "ok": true,
  "action": "backfill_mappings",
  "source": "salesforce",
  "owners_seen":     17,
  "owners_mapped":   12,
  "owners_unmapped": 5,
  "rows_updated":    8423
}
```

The backfill is gated to **manager+ role**. It's idempotent (keyed on
the unique index in `external_user_mappings`), so running it more than
once is safe — additional runs are no-ops once the mappings settle.

For unmapped owners, you have two recovery paths:

1. **Add the missing user** to `users` (with the right email) and
   re-run the backfill — it'll auto-match on the next sweep.
2. **Manual override**: insert a row directly into
   `external_user_mappings` with `match_method='manual'` and a chosen
   `user_id`, then re-run the backfill which respects existing rows.

## Outbound write surface — sf.touchpoint.log

The `sf.touchpoint.log` bridge has been seeded since Phase 1 with
`status='paused'`, `write_policy='minimal'`, and `write_allowlist`
constraining writes to eight Task fields:

```
WhoId, WhatId, Subject, Description, ActivityDate, Type, Status, Priority
```

To activate it:

1. **Create a PA flow** that listens for HTTP POST and creates a SF
   Task using the body's payload. The flow's HTTP trigger URL goes in
   `PA_SF_TOUCHPOINT_URL` env var.
2. **Set `PA_SF_TOUCHPOINT_URL`** in the Vercel project env.
3. **Flip the bridge active**:
   ```sql
   update connector_bridges
   set status='active'
   where workspace_id='<ws>' and bridge_key='sf.touchpoint.log';
   ```

### Calling the write surface

```
POST /api/sf-write?bridge=sf.touchpoint.log
  Headers:
    X-LCC-Key:        <key>
    X-LCC-Workspace:  <workspace-uuid>
    Content-Type:     application/json
  Body:
    {
      "bridge":  "sf.touchpoint.log",
      "object":  "Task",
      "payload": {
        "WhoId":        "0035g00000XYZ",
        "WhatId":       "0015g00000ABC",
        "Subject":      "LCC Touchpoint #12345",
        "Description":  "Auto-logged by LCC. See https://lcc/.../touchpoint/12345",
        "ActivityDate": "2026-05-10",
        "Type":         "Call",
        "Status":       "Completed",
        "Priority":     "Normal"
      },
      "runId":   "<optional>"
    }
```

The receiver:
- Requires **operator+ role** in the workspace.
- Validates every field in `payload` against
  `bridge.write_allowlist["Task"]`. Sending a field not on the list
  rejects the entire request with `400 field_not_allowed:<name>`.
- Calls the configured PA webhook with the validated payload + caller
  identity. PA's flow performs the actual SF write.
- Records the call as a `bridge_runs` row (status `success`/`error`)
  alongside inbound runs, so the freshness page surfaces outbound
  health in the same view.

### Why route through PA instead of writing to SF directly

Same reason all the inbound flows do: the corporate Connected App for
Salesforce is owned by IT, not the LCC project. PA's SF connector
inherits the user's OAuth grant, so each write happens with the
authority of the flow's owner (typically a service account or a
designated LCC user). The bridge layer means LCC code never holds SF
credentials and never touches the SF write surface beyond the eight
allowlisted fields.

## What's deferred

- **Manual override UI.** Today, manual mapping requires a SQL
  `UPDATE external_user_mappings`. A small admin UI that lists
  `v_unmapped_sf_owners` and lets a manager click-to-assign would be
  easy.
- **Resolving SharePoint `lastModifiedBy.user.id`.** The SP handler
  doesn't yet call `resolveExternalUser`. Same one-line addition;
  hold for Phase 2.5 alongside the body extractor.
- **Outlook source-user verification.** The `_source_user_id` PA
  flows inject is trusted at face value (the X-LCC-Source-User-Id
  header isn't cross-checked against the X-LCC-User-Email header).
  Tightening this needs a JWT path; defer to Phase 3.5.
- **Two more outbound bridges.** `sf.task.close` and `sf.lead.notify`
  have legacy direct-webhook paths (`PA_COMPLETE_TASK_URL`,
  `PA_NEW_LEAD_WEBHOOK_URL`). Migrating those onto `_route=write`
  would unify outbound auditing — easy follow-up once we've watched
  `sf.touchpoint.log` work in production for a week.
