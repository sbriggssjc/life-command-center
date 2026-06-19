# NBT Phase 2 — SF-Activity sync (the progress + response signal)

> Foundation spec for NEXT-BEST-TOUCHPOINT. Phase 1 (`v_next_best_touchpoint`)
> ranks Scott's real SF book by **research value** because that is the only
> usable signal today. The PROGRESS signal — last contact, days-since-touch,
> responses / non-responses — barely exists in LCC: `activity_events` holds only
> ~84 SF rows, and **every** `v_next_best_touchpoint` row shows
> `days_since_touch = NULL`. Root cause: the Power Automate → `sf_sync_log`
> `object_intake` sync pulls **Companies / Deals / Listings / Comps /
> Properties** but **NOT Activities (Task / Event)**. Phase 2 closes that.
>
> This is partly **Scott's SF / PA configuration** (add Task + Event to the
> flow's object list + fields) and partly **CC's ingest mapping**. The two parts
> are split below.

## Why it matters
Once Activities flow in:
- `v_next_best_touchpoint.last_touch_at` / `days_since_touch` become REAL — the
  engine can rank "highest value AND most overdue / never-touched", not just
  research value.
- The cadence advance loop (OUTREACH #1) and the engagement/response learning
  loop (R24) get fuel: `WhoId`/`WhatId` resolve the activity onto the right
  cadence, and replies pause the cold sequence (`phase='converted'`).
- The `OwnerId` field finally tells LCC **whose book** each account is — the
  account-owner signal the BD graph is missing today.

---

## Part A — Scott's Power Automate flow (the checklist)

Extend the existing SF → `object_intake` PA flow to ALSO pull two SF objects.
Pull **both open and completed**, with a **rolling 24-month historical window**
plus ongoing (the same incremental watermark pattern the other objects use).

### A1. Add object `Task` (calls / emails / to-dos)
Fields to include per record:

| SF field | Why |
|---|---|
| `Id` | dedupe key (`external_id`) |
| `WhoId` | Contact/Lead the activity is ON → resolves the cadence contact |
| `WhatId` | Account / Opportunity / custom the activity relates TO → resolves the account |
| `Subject` | channel inference (the OUTREACH #1 `deriveSfCategory` reads it) |
| `Description` | body / notes (optional, truncate) |
| `ActivityDate` | → `occurred_at` |
| `Status` | open vs completed |
| `TaskSubtype` / `Type` | Call / Email / … → category |
| `CallDisposition` | call outcome (connected / vm) |
| `IsClosed` | completed filter |
| `OwnerId` | whose book (account-owner signal) |
| `CreatedDate`, `LastModifiedDate` | watermark / audit |

### A2. Add object `Event` (meetings)
| SF field | Why |
|---|---|
| `Id` | dedupe key |
| `WhoId` | attendee contact → cadence contact |
| `WhatId` | related account/opp |
| `Subject` | meeting subject |
| `StartDateTime` | → `occurred_at` |
| `EndDateTime` | duration (optional) |
| `OwnerId` | whose book |
| `CreatedDate`, `LastModifiedDate` | watermark / audit |

### A3. Envelope
Each record lands as a `sf_sync_log` `object_intake` row with
`sf_object_type IN ('Task','Event')` (matching the existing Company/Deal rows'
shape). No other PA change — the existing crawl/watermark/retry plumbing is
reused.

---

## Part B — CC ingest mapping (LCC side)

**Reuse, don't fork.** The activity ingest path already exists
(`api/_handlers/sf-activity-ingest.js`, OUTREACH #1) and already writes
`activity_events` with `source_type='salesforce'` + advances the matching
cadence. Phase 2 routes the NEW `Task`/`Event` object_intake rows through it and
adds the field mapping below.

### B1. object_intake → activity_events
For `sf_object_type IN ('Task','Event')`:

| activity_events column | source |
|---|---|
| `external_id` | `Id` |
| `source_type` | `'salesforce'` |
| `category` | **`deriveSfCategory(Type/TaskSubtype, Subject)`** (OUTREACH #1) — generic Tasks whose subject is real outreach categorize `call`/`email`; genuine internal notes stay `note`; `Event` → `meeting` |
| `occurred_at` | `ActivityDate` (Task) / `StartDateTime` (Event) |
| `entity_id` | resolve via `WhoId` → person/contact entity, else `WhatId` → account entity (the SF-id → entity resolution already used by the SF graph) |
| `bd_opportunity_id` | `WhatId` when it is an Opportunity |
| `direction` | `isInboundReply(Subject)` (R24) → `inbound`; else `outbound` |
| `metadata.sf_owner_id` | `OwnerId` (whose-book signal) |
| `metadata.sf_status` / `call_disposition` | `Status` / `CallDisposition` |

### B2. The cadence advance is already wired
Because the row carries a real `category` and a resolved `entity_id` (and the
trigger's `contact_id` lookup tier from OUTREACH #1 RC3), the existing
`lcc_activity_event_advance_cadence` trigger advances the right cadence on
insert — `WhoId`→contact resolves it onto the cadence's contact person even when
that differs from the owner `entity_id`. Inbound replies (R24) pause the cadence
(`phase='converted'`). **No new advance owner** — the single-advance-owner
doctrine holds.

### B3. The whose-book signal
`OwnerId` → capture on the account entity (e.g. `entities.metadata.sf_owner_id`
or an `account_owner` relationship) so LCC knows which book each account belongs
to. This is the one genuinely-missing ownership flag the BD graph lacks today.

### B4. Feature-flag / rollout
Mirror the OUTREACH #1 / folder-feed posture: the ingest mapping is INERT until
`Task`/`Event` rows actually arrive in `object_intake` (no rows ⇒ no-op). Verify
with a GET dry-run / a single real Task once the PA flow is extended:
- `v_next_best_touchpoint.last_touch_at` becomes non-NULL for touched accounts;
- a logged SF Task advances the matching cadence (the OUTREACH #1 loop);
- `OwnerId` lands on the account entity.

---

## Acceptance (once the PA flow is extended)
1. Pull a known SF Task on a mapped account → it lands in `activity_events`
   (`source_type='salesforce'`, correct `category` via `deriveSfCategory`,
   `occurred_at` from `ActivityDate`), entity resolved via `WhoId`/`WhatId`.
2. `v_next_best_touchpoint` for that account shows a real `last_touch_at` /
   `days_since_touch`.
3. The account's matching cadence advanced exactly once (single-advance-owner).
4. An inbound reply (`RE:` subject / `direction=inbound`) pauses the cadence
   (`phase='converted'`).
5. `OwnerId` is captured as the account-owner signal.

## Out of scope (later)
- Down-weighting operator/tenant entities in the NBT ranking (Fresenius is a
  dialysis operator, USPS a tenant) — flagged by Scott, a separate refinement.
- The in-app DRAFT/sender half — Scott works Outlook/SF; deliberately untouched.
