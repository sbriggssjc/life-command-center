# Phase 3.5 — Timeline Integration

Phases 1–3 wrote per-source mirror tables (`salesforce_activity_log`,
`email_bodies`, `meetings`) and updated `unified_contacts.last_*_date`
counters, but they did **not** write into the canonical `activity_events`
timeline. The entity sidebar therefore couldn't render a unified
"recent activity" feed across SF + Outlook + Calendar.

Phase 3.5 closes that loop. Every successful ingest now appends one
`activity_events` row, deduped per source.

> **No new function. No bridges.js change.** The shared helper
> `api/_shared/activity-events.js` is imported by the existing handlers.
> Total functions stays at 12.

## What ships

| Component | Path | Purpose |
|-----------|------|---------|
| Migration | `supabase/migrations/20260608000000_phase3_5_timeline_integration.sql` | Adds `unified_contacts.entity_id` (with backfill from SF Contact external_identities) + partial unique index on `activity_events (workspace_id, source_type, external_id)`. |
| Helper   | `api/_shared/activity-events.js` | `appendActivityEvent()` — idempotent insert, never throws. |
| Handlers | `bridge-handlers-salesforce.js` (updated) | SF activity handler writes timeline row when `actor_user_id` resolved (Phase 1.5). SF contact handler sets `unified_contacts.entity_id`. |
| Handlers | `bridge-handlers-outlook.js` (updated) | Outlook + Calendar handlers write timeline rows attached to the primary tracked contact. |

## How the timeline gets attached

The canonical `activity_events.entity_id` is the link between a touch
and the entity sidebar. Resolving it requires a path from the source
identifier to `entities.id`:

```
Salesforce Contact 0035g0000XYZ
  └─ external_identities (source_system='salesforce', source_type='Contact', external_id='0035g0000XYZ')
        └─ entity_id

Outlook message  to=alice@acme.com
  └─ unified_contacts (email='alice@acme.com')
        └─ entity_id   ← Phase 3.5 column

Calendar event   organizer=bob@example.com, attendees=[carol@…]
  └─ unified_contacts (email IN (...))
        └─ entity_id   ← Phase 3.5 column
```

The `unified_contacts.entity_id` column added in this migration short-cuts
the second path — handlers no longer have to walk `external_identities`
on every email/meeting ingest.

The migration includes a backfill that fills `entity_id` for every
existing `unified_contacts` row that has a `sf_contact_id` matching an
SF Contact in `external_identities`. Rows without an SF link stay at
`entity_id=null` until the next SF Contact ingest links them, OR until a
Phase 4+ resolver populates them from other identifiers (gov_contact_id,
dia_contact_id, outlook_contact_id, etc.).

## Idempotency

`activity_events` now has a partial unique index:

```sql
unique (workspace_id, source_type, external_id)
where source_type is not null and external_id is not null
```

`appendActivityEvent` uses `Prefer=resolution=ignore-duplicates`, so
retried ingests (SF batches replayed after a transient failure, Outlook
delta pages re-posted, etc.) are no-ops. Manually-logged
`activity_events` rows (legacy code paths that don't set source_type or
external_id) are unaffected.

## What lands per source

### sf.activity.append → activity_events

- **Only when** `actor_user_id` is non-null (Phase 1.5 SF→LCC user
  mapping). The activity_events.actor_id column is `NOT NULL → users(id)`
  and we don't manufacture a synthetic actor for unresolved SF owners.
- `category`: `call` / `email` / `meeting` / `note` (SF Tasks → 'note').
- `entity_id`: contact entity preferred, falls back to account entity.
- `source_type`: `'salesforce'`, `external_id`: SF activity Id.
- `external_url`: SF Lightning deep-link.
- `metadata`: sf_activity_id, sf_call_type, sf_status, sf_owner_id,
  contact/account entity ids.

### outlook.message.extract → activity_events

- **Always** (source_user_id is required by the bridge config).
- `category`: `'email'`.
- `entity_id`: primary tracked contact's entity (first non-source-user
  contact in the message). Other tracked contacts in metadata.
- `source_type`: `'outlook'`, `external_id`: internetMessageId.
- `metadata`: conversation_id, is_sent, from_email, to_emails (jsonb),
  cc_emails, has_attachments, linked_unified_ids[], linked_entity_ids[].
- `body`: bodyPreview (truncated to 4000 chars). Full body stays in
  `email_bodies`; the timeline doesn't carry it.

### calendar.event.link → activity_events

- **Always** (source_user_id required).
- `category`: `'meeting'`.
- `entity_id`: first tracked attendee's entity. Other tracked attendees
  in metadata.
- `source_type`: `'calendar'`, `external_id`: Graph event id.
- `occurred_at`: `start.dateTime` (the meeting's start).
- `metadata`: ical_uid, organizer_email, starts_at, ends_at,
  is_online_meeting, location, linked_unified_ids[], linked_entity_ids[],
  attendee_count.

## Querying the unified timeline

```sql
-- Recent timeline for one entity
select category, source_type, title, body, occurred_at, external_url, metadata
from activity_events
where workspace_id='<ws>' and entity_id='<entity uuid>'
order by occurred_at desc
limit 50;

-- "What did Bob do today?" (per LCC user)
select category, source_type, title, occurred_at, entity_id, metadata
from activity_events
where workspace_id='<ws>' and actor_id='<bob uuid>'
  and occurred_at >= current_date
order by occurred_at desc;

-- Most-touched entities in the last 7 days
select entity_id, count(*) as touches,
       count(*) filter (where category='email')   as emails,
       count(*) filter (where category='call')    as calls,
       count(*) filter (where category='meeting') as meetings
from activity_events
where workspace_id='<ws>' and occurred_at >= now() - interval '7 days'
  and entity_id is not null
group by entity_id
order by touches desc
limit 25;
```

## Verifying after deploy

```sql
-- How many existing unified_contacts got their entity_id backfilled?
select count(*) as linked, count(*) filter (where entity_id is not null) as with_entity
from unified_contacts;

-- Are timeline rows landing? Per source:
select source_type, count(*), max(occurred_at) as latest
from activity_events
where source_type in ('salesforce','outlook','calendar')
group by source_type;

-- Idempotency check — should never see duplicate (source_type, external_id)
select source_type, external_id, count(*)
from activity_events
where source_type is not null and external_id is not null
group by 1, 2 having count(*) > 1
limit 10;
```

## What's deferred

- **SharePoint timeline rows.** Phase 2 indexes the entire library
  (potentially thousands of files); writing one timeline row per
  classified document would flood the sidebar. A future opt-in could
  fire timeline rows only when a doc is *extracted* (Phase 2.5) — that's
  a meaningful event, "we ingested an OM for this property."
- **Multi-entity attachment.** Today an Outlook email touching three
  tracked contacts attaches the timeline row to the primary contact and
  records the others in `metadata.linked_entity_ids`. The sidebar can
  cross-render via `metadata`, but a `activity_event_links(activity_id,
  entity_id)` join table would make per-entity feeds query without the
  JSONB scan. Defer until volume warrants.
- **Backfilling existing per-source rows.** Phases 1–3 already wrote
  thousands of `salesforce_activity_log` / `email_bodies` / `meetings`
  rows that have no corresponding `activity_events` entry. A one-shot
  backfill job could read them and call `appendActivityEvent`. Keyed
  on the unique index, the backfill is naturally idempotent. Hold for
  a quiet weekend; forward-only is fine for daily use.
- **`unified_contacts.entity_id` for non-SF contacts.** Today the
  backfill only fills rows linked via SF. Outlook/Calendar contacts
  without an SF Contact stay at `entity_id=null` and their timeline
  rows aren't written. A small enhancement: when the Outlook handler
  creates a unified_contacts row that has no entity, also create a
  matching `entities` row (entity_type='person') and link them. Defer
  until we see how often this case shows up.
