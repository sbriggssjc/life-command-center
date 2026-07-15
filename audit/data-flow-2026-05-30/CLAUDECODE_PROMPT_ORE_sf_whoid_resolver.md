# Claude Code (LCC) — resolve SF activity WhoId → contact on the LCC side (bounded, by-id, reliable)

## Why (grounded live 2026-07-15)

The SF Activity Sync PA flow sends each Task's **WhoId** (contact id) + **WhatId**, but the
Salesforce connector **cannot return relationship fields** (`Who.Name` is rejected), and
per-record lookups **inside the recurring flow are far too slow** (a test looped over ~2,000
Tasks × serial SF calls and ran for hours). So the flow stays simple/fast (reverted to
WhoId/WhatId only), and **LCC resolves only the handful of WhoIds it actually wants to mint**
— a few new contacts per sync, not every Task — via a tiny reliable **get-by-id** flow.

This completes PR #1404 (Units 1-3: mint WhoId contact + email-reconcile + mismatch lane),
which is currently **inert** because the flow no longer carries `Who.Name`/`Who.Email`. This
round feeds those units with names resolved on demand. Reuse the built machinery — this is
the resolver + queue, not a rebuild. Additive · reversible · guarded · never-fabricate ·
LCC-Opps only · ≤12 api/*.js.

## The companion flow (Scott builds — spec below, ONE reliable primitive)
A new HTTP-triggered PA flow **"SF Get Contact By Id"**:
- **Trigger:** When an HTTP request is received. Body: `{ "contact_id": "<18-char SF Contact Id>" }`.
- **Action 1 — Get record (Salesforce):** Table **Contact**, Record Id = `triggerBody()?['contact_id']`.
  (Get-by-id always works — no `$select` relationship needed.)
- **Action 2 (optional, for the account name) — Get record (Salesforce):** Table **Account**,
  Record Id = `body('Get_Contact')?['AccountId']`. Configure run-after to tolerate failure
  (a contact with no AccountId → skip). This gives the contact's **account name** for the
  mismatch detector (Dowling's `AccountId` → "Arbor Realty Trust").
- **Response:** `200` with body:
  ```json
  {
    "id":         @{body('Get_Contact')?['Id']},
    "name":       @{body('Get_Contact')?['Name']},
    "email":      @{body('Get_Contact')?['Email']},
    "first_name": @{body('Get_Contact')?['FirstName']},
    "last_name":  @{body('Get_Contact')?['LastName']},
    "phone":      @{body('Get_Contact')?['Phone']},
    "title":      @{body('Get_Contact')?['Title']},
    "account_id":   @{body('Get_Contact')?['AccountId']},
    "account_name": @{body('Get_Account')?['Name']}
  }
  ```
  Secure it like the other webhooks (a shared secret in the URL / an `X-LCC-Key`-style header
  the LCC caller sends). The URL → env `SF_CONTACT_BYID_URL` (+ its secret).

## Unit 1 — queue the unresolved WhoIds at ingest (`sf-activity-ingest.js`)
When the ingest processes an activity whose **WhoId is present but the mint was skipped for
lack of a name** (the reverted flow carries no `Who.Name`) AND the WhoId is **not already an
LCC entity** (`external_identities salesforce/Contact external_id = WhoId`), upsert the WhoId
into a small **`sf_contact_resolve_queue`** (LCC Opps, additive migration):
`(who_id PK, first_seen_at, attempts, status seen|resolved|no_data|dead, last_attempt_at,
workspace_id, resolved_entity_id)`. Idempotent on `who_id`; never blocks the ingest
(best-effort). A WhoId already an entity is skipped (nothing to resolve). Drop the table →
zero trace.

## Unit 2 — the resolver worker (`?_route=sf-contact-resolve-tick`)
Sub-route of operations.js (no new api/*.js). GET = dry-run (queue depth + a sample) / POST =
drain, bounded by `limit` (default 25) + a ~20s wall-clock. Per WhoId:
1. POST `{contact_id: who_id}` to `SF_CONTACT_BYID_URL` → `{name,email,phone,title,...,
   account_name}`. Feature-flagged: **no-op cleanly when `SF_CONTACT_BYID_URL` is unset**
   (the find_contacts_by_account rollout posture) — queue rows stay `seen`.
2. **Mint via `ensureEntityLink`** (`sourceSystem='salesforce'`, `sourceType='Contact'`,
   `externalId=who_id`, seed name/email/first/last/phone/title). This routes through the
   **R39 email tier**, so the SF **Eric Dowling** (`edowling@boydwatterson.com`) attaches to
   the existing CoStar/RCA Dowling → one entity, no duplicate. Guards reject garbage
   (never fabricated). Capra (no prior entity) mints fresh + linked.
3. **Run the Unit-3 mismatch detector** (`sfContactAccountMismatch` from PR #1404) with the
   resolved `email` + `account_name` → seeds the `sf_contact_account_mismatch` Decision-
   Center lane (Dowling's @boydwatterson.com on "Arbor Realty Trust" → flag; Capra on Boyd →
   agrees, no flag). Record-only, no SF write.
4. Mark the queue row `resolved` (+ `resolved_entity_id`) / `no_data` (SF returned nothing) /
   dead-letter after `SF_RESOLVE_MAX_ATTEMPTS` (default 5). Bounded, idempotent, never
   re-hammer.
- Gentle cron `lcc-sf-contact-resolve` (`*/30` or hourly — small volume). No-ops until the
  flow URL is set (endpoint 404s until operations.js ships — verify post-deploy with a GET
  dry-run, the lcc-folder-feed posture).

## Boundaries / verify
- LCC-Opps only; SF read-only (the by-id flow); no SF/Outlook writes; no fabrication;
  additive + reversible; ≤12 api/*.js (worker is a sub-route). dia/gov untouched.
- **Verify (post-deploy + flow live):** after a sync + a resolve tick — **Joseph Capra**
  mints onto Boyd with a `salesforce/Contact` identity; the SF **Eric Dowling** merges into
  the existing CoStar/RCA Dowling by email (one entity, three identities, no dup); the
  `sf_contact_account_mismatch` lane shows the Dowling-on-Arbor disagreement. Queue drains;
  a WhoId that's a Lead/blank → `no_data`, not a crash. GET dry-run first.

## Bottom line
Keep the recurring flow fast and simple; resolve only the few new WhoIds in LCC via a
one-action get-by-id flow; mint + reconcile-by-email + flag the SF mismatch using the machinery
PR #1404 already built. Reliable (get-by-id), bounded (only unresolved contacts), and it lights
up Capra/Dowling without fighting the connector's relationship limitation.
