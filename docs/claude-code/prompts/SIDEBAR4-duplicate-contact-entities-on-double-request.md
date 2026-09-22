# SIDEBAR4 — the sidebar still fires twice per send and now mints twin CONTACT entities

## Context

`SIDEBAR2` (round 40) fixed the double-posted `inbox_items` symptom by adding an
idempotency key (`inboxItemDedupKey()`, `api/_handlers/sidebar-pipeline.js`) so a
duplicate capture is caught by the existing `idx_inbox_items_dedup` unique index
instead of minting a second row. That fix covers `inbox_items` only.

Round 44 found the underlying double-request is still happening, and now shows up one
layer deeper: "John Messer (buyer_broker)" posted twice at 19:52:12 UTC, 26ms apart,
and each request created its **own new `entities` row** (two distinct contact
entities, each spawning its own `new_contact_qualify` inbox card keyed
`contact:<entity_id>` — a key the `SIDEBAR2-c` dedup key can't see, because the two
cards are for two genuinely different entity ids, not the same key twice).

So there are two separable problems here, and both need fixing:

1. **The sender still fires the capture twice.** Nobody has confirmed why — it could
   be the extension itself double-firing on one click, a retry on a slow response, or
   something else entirely. Measure it directly: log request ids (or add one if none
   exists) for a single sidebar send and reproduce with a real capture, or find the
   client-side cause by reading the send path in `extension/sidepanel.js` /
   `extension/background.js`.
2. **Even if request duplication is never fully eliminated, entity creation should be
   idempotent.** Right now two near-simultaneous requests for the same contact each
   independently insert a new `entities` row with no idempotency check — the same
   class of gap `SIDEBAR2-c` fixed for `inbox_items`, just one layer down at the
   entity insert itself.

## Ask

**Part A — fix entity creation to be idempotent.**
- Add a check before the contact `entities` insert in the sidebar pipeline (same
  code path referenced in `api/_handlers/sidebar-pipeline.js` around the
  `contactEntityType()` / entity-link call sites, roughly lines 2400-2700 and
  2870-2930) — search for an existing entity by
  `(workspace_id, normalized_name, coalesce(email, phone))` before inserting a new
  one, and add a unique index on that same tuple so it's enforced at the DB level,
  not just in application logic (mirrors what `SIDEBAR2-c`'s doc comment describes
  doing for `inbox_items`, one layer down).
- Confirm this doesn't regress legitimate re-captures of the same contact on a
  different property, or a genuinely different person who happens to share a name
  with no email/phone on file — read the existing `entity-link.js` dedup/merge logic
  first (`ensureEntityLink`) before adding a second, possibly conflicting dedup path;
  reuse it if it already does something close to this rather than inventing a
  parallel mechanism.

**Part B — measure and, if feasible, fix the double-fire at the source.**
- Add or confirm a request id / trace id is logged on each sidebar capture POST, then
  either reproduce a real double-send with logging in place, or read the extension's
  send path for an obvious cause (a retry-on-slow-response pattern, a duplicate event
  listener, etc.).
- If the cause is client-side and fixable, fix it. If it turns out to be
  unavoidable (e.g. a legitimate retry-on-timeout pattern that should stay), say so
  plainly and lean on Part A as the durable fix instead of forcing a client change
  that might reintroduce lost captures on real network failures.

**Cleanup:** merge today's already-created twin contact pair from round 44 — keep
`95b8ad0a…`, alias `e05f3649…` — using whatever the existing entity-merge mechanism
is (read `entity-link.js` / any `lcc_merge_entity`-style function before writing a
new one).

## Do not touch

- `inbox_items` dedup (`SIDEBAR2-c`) — already correct, not in scope.
- Any misparse-disposition / `person_junk_name` logic — unrelated.
