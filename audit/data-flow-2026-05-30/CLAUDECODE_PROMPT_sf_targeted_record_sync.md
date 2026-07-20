# Claude Code (LCC) — targeted SF record sync: fetch only the records LCC is missing

## Why (grounded live 2026-07-20)

The bulk "SF Get Accounts" pull is the wrong shape and the live numbers prove it:

```
accounts imported by the bulk pull ....... 7,335   (entities 45,797 → 53,079)
of the 4,667 accounts LCC actually needs ...  40 covered
still missing ............................ 4,627
```

**A 0.5% hit rate.** The connector returns accounts in Id order, so a sweep yields
Northmarq's own office records (`Northmarq HQ`, `Denver`, `Agency - Freddie Mac`) and
2019-era rows, while the accounts our list members reference sit scattered through a
100,000+ row table. Covering the needed set by sweeping means processing the whole table
— and it re-runs from scratch every time new members reference new accounts.

It also nearly repeated a production incident. On 2026-07-19 `v_priority_queue_live`
degraded to >60s and saturated LCC Opps (the auth DB, forcing a reset) **because the SF
campaign seed added 6,545 entities**. The bulk pull just added 7,282 more. The queue
refresh is currently holding at 1.7–3.8s, so PR #1422's fix absorbed it — but that is
headroom, not immunity, and a full 100k sweep would be ~15× the increment that broke it.

**Invert it: ask Salesforce only for the records LCC knows it's missing.**

## The mechanism already exists — extend it, do NOT fork it

`api/_shared/sf-record-lookup.js` was built for the T4c comp recovery and its header
states the intent explicitly:

> `REUSABILITY: object_type + fields are parameters so the SAME worker + flow can` …

It already provides everything this needs:

- `lookupSfRecordsByIds({ objectType, fields, ids, batchSize = 20, requestIdSeed, fetchImpl, deadline })`
- `buildOdataIdFilter(ids, field = 'Id')` — the `Id eq 'x' or …` builder
- `chunk(arr, n)`
- `isSfRecordLookupConfigured()` → `SF_RECORD_LOOKUP_URL`
- PA flow contract: `POST { object_type, fields, filter }`

`batchSize = 20` already matches Salesforce's 100-node OData ceiling — the same limit we
re-derived the hard way on the Campaign Members flow.

**So the PA side likely needs no new flow.** The existing "SF → LCC: Record Lookup" flow
is parameterized; Account is just `object_type: "Account"`, `fields: "Id,Name"`. Confirm
`SF_RECORD_LOOKUP_URL` is set before assuming — if it isn't, the worker must no-op
cleanly (the established feature-flag posture) and Scott wires the flow once.

## What to build

### Unit 1 — a generic, spec-driven sync worker

New route `?_route=sf-record-sync-tick&object=<name>` (sub-route of `operations.js`;
handler `api/_handlers/sf-record-sync.js`). **No new `api/*.js`.** GET = dry-run
(compute the missing-id set + batch plan, write nothing, call no flow), POST = drain.

Structure it around a **sync-spec registry** so adding an object later is a small
addition rather than a new worker:

```js
const SYNC_SPECS = {
  account: {
    objectType: 'Account',
    fields: 'Id,Name',
    missingIds: async (deps) => [...],   // returns the ids LCC lacks
    persist:   async (records, deps) => ({...}),  // ingest + counts
  },
  // future: contact, opportunity, lead — add a spec, not a worker
};
```

- Unknown `object` → honest 400 listing the registered specs.
- Bounded per tick: `?limit=` on ids (default e.g. 1,000), plus a wall-clock budget, so a
  tick can't run away. Resumable — a resolved id drops out of `missingIds` naturally.
- Feature-flagged on `SF_RECORD_LOOKUP_URL`; unset ⇒ clear no-op reporting
  `unconfigured`, never a crash.

### Unit 2 — the Account spec

- **`missingIds`**: DISTINCT `raw->>'sf_account_id_unresolved'` from
  `lcc_sf_list_membership` where `company_name IS NULL`, **minus** ids already present as
  a `salesforce/Account` external identity. Key by `sf15` (`api/_shared/sf-id.js`) so
  15/18-char ids compare correctly. Live today that set is **4,627**.
- **`persist`**: reuse the account-ingest logic already in
  `api/_handlers/sf-account-import.js` — extract the per-account upsert into a shared
  function both call, rather than duplicating it. Same guarantees: `ensureEntityLink`
  (salesforce/Account, `org_type: 'company'`, `via: 'sf_account_import'`), idempotent,
  junk-guarded, never fabricates a name.
- Every record fetched is needed by construction, so the PR #1434 needed-only filter
  becomes redundant here — **keep it anyway** as defense in depth against a future
  accidental bulk POST.

### Unit 3 — honest receipts + a safety property

Response must report: `object`, `missing_before`, `ids_requested`, `batches`,
`records_returned`, `records_persisted`, `entities_created`, `missing_after`, and
`unconfigured` when flagged off. `missing_after < missing_before` on a successful drain
is the property that proves progress — surface it explicitly rather than leaving it to be
inferred from a row count.

Log entity growth per tick. Given the incident history, a tick that creates thousands of
entities should be visible in its own output.

### Unit 4 — retire the bulk pull

Once this works, the bulk "SF Get Accounts" flow is obsolete and actively risky (it's the
path that adds ~100k entities). Note in `CLAUDE.md` that account backfill goes through
`sf-record-sync-tick`, and that `POST /api/sf-account-import` without `?all=1` remains
for direct posts but is not the backfill mechanism. Scott turns the bulk flow off on his
side.

### Unit 5 — schedulable

Because it's bounded and cheap, add a **commented-out** cron template (e.g. daily, small
limit) in the migration/docs — but **do not schedule it**. Same gate discipline as the
owner-deed-autofix and reconcile-engine workers: capped dry-run → capped real drain →
Scott blesses → then schedule.

## Boundaries

LCC-Opps only · no SF writes · no dia/gov writes · additive · reversible
(`metadata.via='sf_account_import'`) · idempotent · no new `api/*.js` · no migration
required · **do not refactor the working T4c comp path** — extend the shared module, leave
`sf-record-lookup.js`'s comp handler alone.

## Tests (`test/`)

- Spec registry: unknown object → 400 listing valid specs; `account` resolves.
- `missingIds` excludes ids already known as identities; 15↔18 both directions.
- Batching: 4,627 ids → 232 batches of ≤20 (assert `buildOdataIdFilter` output stays
  under the node ceiling).
- `unconfigured` no-op when `SF_RECORD_LOOKUP_URL` is unset — no flow call, no writes.
- Persist path is the SAME shared function `sf-account-import` uses (assert, don't
  duplicate).
- Idempotency: a second drain over the same ids reports ~0 created.
- Receipts: `missing_after < missing_before` on a successful drain.

## Verify (post-deploy — Cowork runs this)

1. `npm run verify:deploy`.
2. `GET /api/sf-record-sync-tick?object=account` → dry-run shows `missing_before ≈ 4,627`
   and a batch plan, writes nothing.
3. Capped real drain: `POST …&object=account&limit=200`. Confirm on LCC Opps:

```sql
-- coverage climbing (the point)
with needed as (select distinct raw->>'sf_account_id_unresolved' aid
                from lcc_sf_list_membership where raw ? 'sf_account_id_unresolved'),
     known  as (select distinct external_id from external_identities
                where source_system='salesforce' and source_type='Account')
select (select count(*) from needed) needed_total,
       (select count(*) from needed n where exists
          (select 1 from known k where left(k.external_id,15)=left(n.aid,15))) covered;

-- entity growth bounded (the safety property)
select count(*) from entities;   -- ~53,079 now; must grow by ~ids fetched, not tens of thousands

-- queue health unchanged (the incident guard)
select duration_ms, row_count, ok from lcc_refresh_log
 where refresh_name='lcc_refresh_priority_queue_resolved'
 order by refreshed_at desc limit 5;   -- must stay low single-digit seconds
```

4. Drain to completion, then `POST /api/sf-account-import?backfill=1&limit=500` until
   `members_resolved` = 0 → `has_company` climbs from 1,333 toward ~6,000.
5. Then the payoff: `POST /api/operations?_route=institution-contact-tick`.
