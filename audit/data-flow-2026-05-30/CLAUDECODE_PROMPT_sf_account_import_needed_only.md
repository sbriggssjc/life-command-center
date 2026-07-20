# Claude Code (LCC) — `sf-account-import`: only persist accounts LCC actually needs

## Why (grounded live 2026-07-20)

The SF Get Accounts flow now works end to end — first real writes landed
(`external_identities` salesforce/Account 3,769 → 3,780, 12 tagged
`metadata.via='sf_account_import'`). The remaining problem is **volume, and what we do
with it.**

Measured from the live run: `Content-Length: 29104` for ~120 accounts ≈ **242 bytes per
account**. Scott's org is estimated at **100,000+ Accounts**. So a full pull is ~24 MB —
which is what silently broke the earlier run (a 17-minute `Get records` with
`minimumItemCount: 100000` returned "No outputs"; the array exceeded what Power Automate
passes between actions, `chunk(null,200)` yielded `[]`, the loop ran zero times, and the
run reported success while writing nothing).

**The blocking risk is not the pull size — it's what the endpoint does with it.**

The handler currently mints an organization entity for every posted account. At 100k+
accounts, `entities` goes **45,797 → ~146,000**.

That is dangerous here specifically. On 2026-07-19 `v_priority_queue_live` degraded from
~1.1s to **>60s** and saturated the LCC Opps connection pool — forcing a database reset,
on the DB that also hosts auth — **because the SF campaign seed added 6,545 entities.**
The graph CTEs in that view scale with the `entities` table. PR #1422 fixed it by
repointing those CTEs to base `entities` so the planner uses index/hash scans, which grow
**linearly** — that bought headroom, not immunity. A 100,000-entity increment is ~15× the
one that caused the incident.

**And the volume is unnecessary.** LCC needs exactly **4,667** accounts — the distinct
`raw.sf_account_id_unresolved` values on `lcc_sf_list_membership`. The rest is pulled only
to be discarded. Live sample confirms much of the table is irrelevant: the first ~39
accounts returned are Northmarq internal records (`Northmarq HQ`, `Denver`, `Phoenix`,
`West`, `Agency - Freddie Mac`, `Agency - Fannie Mae/FHA`) — offices and program buckets,
not owner companies — and several others are individuals (`Daniel Lieberman`, `Kiet LE`)
that would be minted as organizations.

## What to build (`api/_handlers/sf-account-import.js` — no new `api/*.js`, no migration)

### Unit 1 — a "needed set" the POST path filters against

- Build the needed set once per request (not per account): the DISTINCT
  `raw->>'sf_account_id_unresolved'` values from `lcc_sf_list_membership` where
  `company_name IS NULL`. Key it by **`sf15`** (`api/_shared/sf-id.js`) so 15/18-char ids
  match — the same convention the existing resolver uses.
- ~4,667 ids is small; fetch with a bounded paged select into an in-memory `Set`. Do NOT
  issue a query per posted account.
- In the POST loop: if a posted account's `sf15(Id)` is **not** in the needed set, **skip
  it** — no `ensureEntityLink`, no entity, no identity row — and count it.
- **Always persist an account that is already known to LCC** (an existing
  `external_identities` salesforce/Account row), so a re-run can still correct/attach a
  name on accounts we legitimately track. Only genuinely-unreferenced, unknown accounts are
  skipped.

### Unit 2 — make it switchable and honest

- Default behavior is **needed-only** (safe by default — the entity-graph blast radius is
  the whole point).
- `?all=1` opts into the old persist-everything behavior, for the rare case Scott
  deliberately wants a full account mirror. Document that it will add ~100k entities and
  should not be used casually.
- Extend the response summary with **`accounts_skipped_not_needed`** alongside the existing
  `accounts_received / created / matched_existing / skipped_guard / skipped_no_name /
  skipped_bad_id`. A run must be able to report "received 20,000, needed 812, skipped
  19,188" — so the operator can see the filter working rather than infer it.
- Log the needed-set size once per request so a run's receipts show what it filtered against.

### Unit 3 — the backfill is unchanged, but confirm the interaction

The existing `?backfill=1&limit=N` pass resolves members from the now-populated map. It
must keep working unchanged. Sanity-check that an account skipped as not-needed can never
strand a member: by construction the needed set IS the members' unresolved ids, so any
account a member references is always persisted.

## Boundaries

LCC-Opps only · no SF writes · no dia/gov writes · additive · reversible (`metadata.via
= 'sf_account_import'`) · never fabricate a name · keep the existing "a bad record is
skipped, never throws" contract · idempotent (a re-run reports ~0 created) · no new
`api/*.js`.

## Tests (`test/sf-account-import.test.mjs`)

- A posted account whose id IS in the needed set → persisted (entity + identity).
- A posted account NOT in the needed set and NOT already known → **skipped**, counted in
  `accounts_skipped_not_needed`, no entity created.
- A posted account NOT needed but ALREADY known to LCC → still persisted (name refresh).
- 15-char vs 18-char ids match the needed set correctly (both directions).
- `?all=1` restores persist-everything.
- The needed set is fetched **once** for a batch (assert the query count — no N+1).
- Mixed batch: counts sum correctly to `accounts_received`.

## Verify (post-deploy — Cowork will run this)

1. `npm run verify:deploy` passes (SHA matches, routes return JSON).
2. `GET /api/sf-account-import` dry-run still returns `{accounts_known, members_waiting}`.
3. Scott sets pagination to **20,000** and runs the flow. Expected on LCC Opps:

```sql
-- entity growth must stay bounded — this is the safety property
select count(*) from entities;                       -- ~45.8k, must NOT jump by tens of thousands
select count(*) from external_identities
 where source_system='salesforce' and source_type='Account';   -- climbs toward ~8.4k, not ~100k

-- the map filling in
select count(*) total, count(company_name) has_company,
       count(*) filter (where raw ? 'sf_account_id_unresolved') still_unresolved
from lcc_sf_list_membership;
```

4. The run's HTTP response bodies should show a large `accounts_skipped_not_needed`
   relative to `accounts_created` — that's the filter doing its job.
5. After the pull, drain `POST ?backfill=1&limit=500` until `members_resolved` = 0, then
   confirm `has_company` climbs from 1,333 toward ~6,000+.

## Note for the human running this

Do NOT re-raise pagination to 100,000. That is the setting that produced the silent
empty-array failure. Step up from 20,000 only after measuring that the array survives, and
slice with `$filter` (e.g. `CreatedDate` ranges) rather than pushing a single pull larger.
