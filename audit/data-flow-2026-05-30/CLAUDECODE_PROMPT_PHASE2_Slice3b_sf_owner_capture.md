# Claude Code — Slice 3b follow-up: capture Salesforce OwnerId on mirrored activities

## Why
The SF → LCC Activity Sync mirrors EVERY NorthMarq touchpoint on accounts/contacts
that exist in LCC (Scott's choice: full cross-firm relationship picture). To keep
that readable — "call by my team" vs "call by NorthMarq debt" — record WHO logged
each Task. The flow already returns `OwnerId` (standard Task field) in each raw
record; the handler just needs to store it. Pure additive — no filtering.

## The change — `api/_handlers/sf-activity-ingest.js`
In the per-record normalization (alongside the existing raw/canonical field
mapping), read the owner id and carry it into the activity metadata:
```js
const ownerId = rec.owner_id ?? rec.OwnerId ?? null;
// If the flow ever expands the owner name (Owner.Name), accept it too:
const ownerName = rec.owner_name ?? rec.OwnerName ?? rec?.Owner?.Name ?? null;
```
Add to the `appendActivityEvent` `metadata` object for each row:
`{ ...existing (sf_id, who_id, what_id, sf_type, sf_status, resolved_via),
   owner_id: ownerId, owner_name: ownerName }`.
Nothing else changes — entity resolution, category mapping, dedup on the SF id, and
the skip-when-no-entity behavior all stay as they are. Canonical-shape callers are
unaffected (ownerId just resolves to null when absent).

## Tests / house rules
Extend `sf-activity-ingest.test.mjs`: a raw SF record carrying `OwnerId` (and
optionally `Owner.Name`) stores `owner_id`/`owner_name` in the inserted row's
metadata; records without it still insert with `owner_id:null`. `node --check`;
≤12 `api/*.js`; suite green. Ships on the main-app Railway redeploy.

## Note (owner NAME, optional later)
The basic SF "Get records (Tasks)" returns `OwnerId` (the user id) but not the
owner's display name. To show a human name in the timeline, a later add can either
(a) expand `Owner/Name` in the flow's field selection if the connector supports it,
or (b) maintain a small SF user-id → name/team map in LCC. `owner_id` is enough to
group/attribute now; name is a polish step.

## Upgrade path (NOT this change) — account-scoped query
The reliable + light long-term design is to scope the SF Get-records query to the
LCC account/contact ids (pull only relevant Tasks instead of all-org-then-filter),
which removes both the cap-truncation risk and the per-record load on LCC Opps. That
needs an LCC endpoint returning the salesforce `external_identities` ids for the
flow to filter on (`WhatId in (...) or WhoId in (...)`). Spec on request if the
bounded-pagination run duration shows the firm-wide volume is large.
