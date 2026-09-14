> ## ⚠️ NAMING TRAP — "OWNER" HERE MEANS THE **POINT PERSON**, NOT THE PROPERTY OWNER
>
> This captures the Salesforce **Task assignee** as the deal's point person. It says nothing about
> property ownership. Property owner → **`lcc_property_owner`** /
> [`property-owner-subsystem.md`](property-owner-subsystem.md). Chain state:
> [`connectivity-and-open-threads.md`](connectivity-and-open-threads.md) §0.

# Salesforce owner capture → owner-scoped My Day

**Status: LIVE end-to-end (2026-07-31). Owner source = the assignee of the Salesforce
Task on the deal's account. Weekly refresh cron enabled.**

## Owner source (important)
The Salesforce **Account** owner is a generic integration user ("Salesforce User"),
not the broker — so we do NOT use Account.OwnerId. The real deal owner is the assignee
of the **Task** logged on the account. The PA flow's `owners_by_ids` op queries
`SELECT WhatId, OwnerId, Owner.Name, LastModifiedDate FROM Task WHERE WhatId IN (<account ids>)
AND OwnerId IN (<team user ids>) ORDER BY LastModifiedDate DESC`; LCC keeps the most recent
task's owner per account and writes `lcc_entity_owner_override`.

## First live run (2026-07-31)
63 deal-linked accounts → 3 resolved to a team member (all Kelly Largent: Capri Development,
Mike Spisak, Ryan Michaels), written to the override table and confirmed scoping into Kelly's
My Day and out of Scott's. Coverage is thin because most team activity on these accounts is
**not** logged as a Task with `WhatId` = the account (Scott resolved 0 — his activity is
likely logged against contacts via `WhoId`, or as email in the LCC spine rather than SF Tasks).

**Coverage-broadening option (not yet built):** also match Task by `WhoId` (the contact) and
resolve the contact's account, so contact-logged activity counts. Requires passing the deals'
contact ids and resolving `Who.AccountId`. Do this if too many of Kelly's (or Sarah's/Nate's)
deals still leak into Scott's My Day.

## Refresh
`cron.job` **lcc-sf-owner-sync-weekly** — `30 6 * * 1` (Mon 06:30 UTC) →
`lcc_cron_post('/api/sf-owner-sync','{}')`. Re-pulls owners weekly; manual LCC overrides
(set_by not starting `sf_owner`) are never overwritten.

---

## Original design notes

## Why this exists

`lcc_my_day` shows a to-do only to its effective owner. It resolves that owner from
`lcc_entity_owner_override` **first**, then `assigned_to`/`owner_id` — but those two columns
FK the `users` auth table, which does **not** contain Scott's or Kelly's ids, so they can't
carry rep ownership. The override table's `owner_user_id` FKs `lcc_users`, which *does* have
all four reps (each with a `salesforce_owner_id`). So per-deal ownership in the override table
is the only FK-safe channel — and it was empty, which is why auto-created to-dos showed as
"unassigned" in **both** Scott's and Kelly's My Day.

Populate the override from each deal's Salesforce owner and My Day separates cleanly. Because
`lcc_my_day` reads the override first, **auto-created to-dos inherit the deal's owner with no
change to `lcc_advance_todos`.**

## What was built (live in LCC Opps)

- `lcc_apply_owner_backfill(p_map jsonb, p_set_by text default 'sf_owner_backfill') → jsonb`
  Bulk sink. `p_map` is a JSON array of `{sf_id, <owner ref>}`:
  - `sf_id` — a Salesforce **Account or Opportunity Id** (15 or 18-char). Matched against the
    SF ids already stamped on entities (`metadata.salesforce.account_id`, `metadata.sf_account`,
    `metadata.sf_opp_id`) and `unified_contacts.sf_account_id`, on the 15-char prefix.
  - owner, given by any one of: `sf_owner_id` (005… SF User Id, mapped via `lcc_map_sf_owner`),
    `owner_name` (matches `lcc_users.display_name`), or `owner_email` (matches `lcc_users.email`).
  Returns `{input_ids, entities_written, owner_unresolved, resolved_no_entity_match}`.
  **Preserves manual LCC overrides** — only refreshes rows whose `set_by` starts `sf_owner`.
- `lcc_set_entity_owner_from_sf(p_entity_id uuid, p_sf_owner_id text, p_set_by text) → boolean`
  Single-entity live hook for keep-fresh when a deal links/relinks to a Salesforce record.

Verified end-to-end on a synthetic deal: SF-owner backfill scoped the to-do into Scott's My
Day (1) and out of Kelly's (0); a subsequent manual override to Kelly survived a re-backfill.

## Activating it — feed owner data (pick one)

### Option A (zero Salesforce-code dependency): one report export
1. In Salesforce, build a report of the Accounts (or Opportunities) the team works:
   columns **Account ID** (or Opportunity ID) and **Account Owner** (the owner's name).
   Owner ID (005…) is even better if your report can show it, but the name is enough.
2. Export CSV. Drop it in the LCC folder (or hand it to Claude) — Claude converts it to the
   `p_map` array and calls `lcc_apply_owner_backfill`. Re-run anytime ownership changes; manual
   overrides you've set in LCC are never overwritten.

Example call shape:
```sql
select lcc_apply_owner_backfill('[
  {"sf_id":"001A000001abcдE","owner_name":"Scott Briggs"},
  {"sf_id":"0061A00000xyzQAA","owner_name":"Kelly Largent"}
]'::jsonb);
```

### Option B (automated keep-fresh): extend the PA lookup flow
The server reaches Salesforce only through the Power Automate flow (`SF_LOOKUP_WEBHOOK_URL`);
its `find_account_by_id` op returns Id/Name/Type/Industry — **not OwnerId**. To automate:
1. In the PA flow, add `OwnerId` (and ideally `Owner.Name`) to the Account/Opportunity SOQL
   projection so the op returns it.
2. Surface it in `getSalesforceAccountById` (return `OwnerId`), then call
   `lcc_set_entity_owner_from_sf(entity_id, ownerId)` wherever a deal links to its SF account
   (e.g. in `sf-account-link.js` after a successful link). New/relinked deals then self-assign.

## Open follow-ups
- Reconcile `users` vs `lcc_users` so `assigned_to`/`owner_id` could also carry reps (not
  required for the override path, but would let per-to-do assignment work too).
- Unmatched deals (no SF id on the entity, or owner not one of the 4 reps) stay unassigned →
  visible to everyone, which is the safe default until they're linked.
