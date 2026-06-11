# Claude Code — Phase 2 Slice 3b: route real correspondence into the activity timeline

## Why (grounded live 2026-06-11)
The property + contact context packets (Slice 3a/3a.1) include an `activity_timeline`,
but it's almost entirely **system** events: of ~18k `activity_events`,
`copilot_action` 7,074 / `rca_deed_record` 4,477 / `intake_om` 3,660 /
`costar_deed_record` 1,742 / `note` 494 / `call` 1 — essentially no human
correspondence (email/SF). The Layer-3/4 goal ("every conversation has all agents
informed — email, Salesforce notes, conversation notes") needs the real
correspondence flowing into `activity_events` linked to the right entity. Grounded
state:
- **Writer exists:** `api/_shared/activity-events.js` `appendActivityEvent({
  workspaceId, actorId, category, title, body, entityId, sourceType, externalId,
  externalUrl, occurredAt, domain, metadata })` — deduped on
  `(workspace_id, source_type, external_id)`, never throws.
- **Outbound SF only:** `createSalesforceTask` writes TO Salesforce; there is **no
  inbound SF → activity_events mirror** (the code says so:
  `briefing-data.js:1184` / `briefing-email-handler.js:613` — "the SF →
  activity_events mirror is not [wired]"). The SF object-sync
  (`supabase/functions/intake-salesforce`) pulls Account/Contact/Lead but **not
  Task/Activity** (the logged calls/emails/meetings/notes).
- **Outlook handler exists** (`bridge-handlers-outlook.js` writes category
  `email`/`meeting`) but the OM-intake email channel doesn't log the email itself as
  correspondence on the matched entity.

## Unit 1 (achievable now, no new connector) — log the email-OM intake as an `email` activity
When the flagged-email / Outlook OM intake resolves a confident entity match (the
match the promoter already computes), ALSO append an `email` activity row on that
entity — so the email correspondence shows in the timeline, not just the extracted
OM. In the email channel's post-match path (`intake-extractor.js` /
`intake-om-pipeline.js` / `intake-promoter.js` — wherever the matched entity_id is
known), call `appendActivityEvent`:
- `category:'email'`, `entityId:<matched LCC entity id>`,
  `title:<email subject>`, `body:<short snippet of the email body>`,
  `sourceType:'email_intake'`, `externalId:<internet_message_id>` (the dedupe key —
  so re-processing the same email is a no-op), `externalUrl` if available,
  `occurredAt:<email received time>`, `domain:<dia|gov>`,
  `metadata:{ intake_id, from, to }`.
- Guard: only when a confident entity match exists (never log against a guessed/null
  entity); fire-and-forget (a failed append must NOT block intake — `appendActivityEvent`
  already never throws, just don't await-fail the pipeline).
This immediately enriches the timeline with the email correspondence we ALREADY
process, using only existing infrastructure.

## Unit 2 (the SF mirror — higher value, has a connector dependency) — design + the LCC-side handler
Salesforce is the system of record for client interactions (calls, emails,
meetings, notes logged on Contacts/Accounts). Mirror SF Task/Activity records into
`activity_events`, linked to the LCC entity via the existing
`external_identities (source_system='salesforce')` → entity mapping.

Build the **LCC-side ingest handler** now (it's the part that's unblocked), and
clearly mark the SF-side feed as the dependency:
- **New ingest endpoint** (sub-route, NO new `api/*.js` — e.g. `intake.js`
  `?_route=sf-activity` + a `server.js` mount): accepts a batch of SF activity
  records `{ sf_id, type (Call|Email|Meeting|Task|Note), subject, description,
  activity_date, who_id (Contact), what_id (Account/other), status }`. For each:
  resolve the LCC entity from `who_id`/`what_id` via `external_identities
  (source_system='salesforce')`; map the SF type → category
  (Call→`call`, Email→`email`, Meeting→`meeting`, Note/Task→`note`);
  `appendActivityEvent(... sourceType:'salesforce', externalId:<sf_id>, ...)`.
  Dedup is automatic on `(salesforce, sf_id)`. Skip (don't guess) when no entity
  resolves; report `{matched, skipped_no_entity, inserted, deduped}`.
- **The SF-side feed is the dependency (Scott / PA):** the SF connector must QUERY
  Task/ActivityHistory (e.g. a PA "SF → LCC: Activity Sync" flow, or extend the
  existing object-sync to `object_type=Task`) and POST batches to the new endpoint.
  Confirm the SF connection has read access to Task/Activity before wiring. **Spec
  the endpoint + handler in this slice; the PA flow is a separate manual step** (I'll
  build it via browser once the handler is live, same pattern as the other PA flows).

## Tests / house rules
- Unit-test Unit 1: a matched email-OM intake appends an `email` activity with the
  right entity/category/externalId; re-running the same `internet_message_id` is a
  dedup no-op; an unmatched intake appends nothing.
- Unit-test Unit 2 handler: SF Call/Email/Meeting/Note → correct category + entity
  resolution via the salesforce external_identity; unresolved who_id → skipped (no
  row); dedup on `(salesforce, sf_id)`.
- `node --check`; ≤12 `api/*.js` (sub-route + shared modules only); full suite green.
  Ships on the Railway redeploy.

## After deploy (Claude/Cowork)
- Unit 1: trigger / find a matched email-OM intake and confirm an `email`
  activity_event appears on the entity + in the packet's `activity_timeline`.
- Unit 2: POST a sample SF-activity batch to the new endpoint, confirm it resolves
  entities + dedups; then I build the "SF → LCC Activity Sync" PA flow in the
  browser to feed it live.

## Note / sequencing
Unit 1 is fully shippable now and is the quickest timeline win. Unit 2's handler is
shippable now; its live feed waits on the SF Task-access confirmation + the PA flow.
Keep them in one PR or split — your call; both use the same `appendActivityEvent`
writer and the same entity-resolution pattern.
