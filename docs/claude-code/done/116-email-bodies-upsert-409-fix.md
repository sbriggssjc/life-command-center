# Prompt 116 — `email_bodies` body upsert 409s on existing rows (the last blocker on the voice corpus)

**Status: DONE (2026-08-17).** One PR, additive + reversible. Backfill applied live to LCC Opps
(`xengecqvemvfknjvbvrq`); the handler fix ships on the next Railway redeploy of merged `main`.

## The premise was half right — and the half that was wrong is the finding

The prompt's read: `Prefer: resolution=merge-duplicates` is not taking, so the POST does a plain
INSERT and the existing row 23505s. Suspect #1 was `opsQuery` losing the `Prefer` header to a
`return=` merge.

**Neither holds.** `opsQuery` spreads `opts.headers` LAST, so `Prefer: resolution=merge-duplicates`
reaches PostgREST intact, and `email_bodies_ws_msg_uidx` (a plain UNIQUE INDEX) is a perfectly valid
`ON CONFLICT` arbiter — the extra non-unique `ix_email_bodies_message_id` on the same columns does not
interfere. Proven live by a self-rolling-back gate: the identical
`ON CONFLICT (workspace_id, internet_message_id) DO UPDATE` with a **valid user id** updates the
existing row in place (body 12,763 → 7,200 chars, 1 row, rolled back, 0 residue).

**The actual root cause, read from the Postgres log rather than the status code:**
```
insert or update on table "email_bodies"
  violates foreign key constraint "email_bodies_source_user_id_fkey"
insert or update on table "activity_events"
  violates foreign key constraint "activity_events_actor_id_fkey"
```
`23503` (foreign_key_violation) — and **PostgREST maps 23503 AND 23505 both to HTTP 409**, so
`upsert_409` was indistinguishable from the conflict everyone assumed.

`email_bodies.source_user_id`, `meetings.source_user_id` and `activity_events.actor_id` all FK
`public.users(id)`. The bridge receiver (`api/bridges.js`) takes `_source_user_id` **verbatim** from
the flow's `X-LCC-Source-User-Id` header, and the backward Sent-Items sweep was configured with the
**`lcc_users`** id `1d3f7321-a4ad-4f83-9c7b-489554fc1c51` while the working forward sweep used the
**`public.users`** id `b0000000-0000-0000-0000-000000000001` — *the same person*
(sabriggs@northmarq.com). The two tables have disjoint id spaces bridged only by EMAIL — the footgun
already in `CLAUDE.md` for `touchpoint_cadence.owner_user_id`, recurring in a new place.

Live evidence (2026-08-17): **every** one of the 10,470 `upsert_409` jobs carried that one bad id;
all 112,030 jobs carrying the good id had no error. Blast radius was wider than reported — the same
id was silently killing the `activity_events` timeline row too (423 FK rejections in 24 h;
`appendActivityEvent` is best-effort and swallowed them). **The PA sweep was correct all along**, and
so was the merge-duplicates upsert.

## Fix

- **NEW `api/_shared/source-user-id.js`** — `resolveSourceUserId` normalizes any inbound id to a real
  `public.users.id`: pass-through if it already is one → else `lcc_users.lcc_user_id` → email →
  `public.users` (ilike-narrowed then EXACT case-insensitive verified in JS, so an `_` in a local part
  can't widen the match) → else null. Memoized per process (one lookup per id, not per message); a
  transient READ failure is deliberately NOT cached so a blip can't poison a 10k-message sweep.
- **`bridge-handlers-outlook.js`** — both handlers resolve before writing, so the resolved id lands on
  `email_bodies.source_user_id`, `meetings.source_user_id` AND `activity_events.actor_id`. An
  unresolvable id writes **NULL** into the nullable provenance column rather than 409ing the row
  (losing the "whose mailbox" stamp is recoverable; losing a 250 KB body is not) and is surfaced as
  `result.source_user_unresolved` / `result.source_user_resolved_via`.
- **`describeWriteFailure`** — `body_persist_error` keeps its shape and now gains
  `body_persist_detail{status,code,message}` from the PostgREST body, so the next 409 is
  self-diagnosing. The calendar path got the same treatment (`meeting_persist_error`), which was
  previously an unchecked write.
- `deps.opsQuery` test seam added to both handlers (repo DI convention).

## Backfill — applied live, no re-sweep needed

`supabase/migrations/20260914120000_lcc_p116_email_body_source_user_fk.sql`. Re-drives the bodies
already sitting in `enrichment_jobs.payload` (the sweep captured them; only the write failed).
Mirrors the P115 normalizer in SQL (3 body shapes, HTML sniff), keyed on
`(workspace_id, internet_message_id)` — the real unique index — and resolves `source_user_id` through
the same email bridge.

**Bodies >255 chars: 24 → 654.** 465 blank rows filled + **165 rows the FK had blocked from ever
existing** (those messages had already passed the privacy gate, so the row was always intended);
all `body_format='html'`, 2,233–248,516 chars, `<html>…</html>` intact. All 165 inserts resolved to a
valid `users.id`; `email_bodies` rows with a dangling `source_user_id` = **0**. Fill-blanks (a stored
body is never overwritten), idempotent (re-run probe = 0/0/0), reversible via
`lcc_p116_email_body_backfill_backup` (`op='update'` restores, `op='insert'` deletes). Recovered jobs
stamped `result.body_persist_recovered_by` so "still broken" stays distinguishable from "recovered".

## Tests

`test/outlook-body-upsert-fk.test.mjs` (11) — a faithful PostgREST simulator (FK checked first as the
DB does; merge-duplicates honored only when the header asks; DO UPDATE touching only the payload's
columns) pins: an EXISTING row is UPDATED not 409'd · a bodyless touch does NOT null a stored body ·
a brand-new id INSERTS · an `lcc_users` id is bridged before it reaches the FK · an unbridgeable id
still writes the body with a NULL stamp · a real FK rejection reports `23503` · the upsert declares
`on_conflict` AND asks for merge-duplicates. **Mutation-checked:** reverting the resolver fails 4;
dropping the `Prefer` header fails 2. `test/outlook-body-persist.test.mjs` (12) still green.

## Files

- `api/_shared/source-user-id.js` (NEW)
- `api/_shared/bridge-handlers-outlook.js`
- `supabase/migrations/20260914120000_lcc_p116_email_body_source_user_fk.sql` (NEW, applied live)
- `test/outlook-body-upsert-fk.test.mjs` (NEW)
- `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` (third blocker + STATUS), `CLAUDE.md` (two footguns:
  the id-space collision reaching the bridges, and "a PostgREST 409 is not necessarily a conflict")

## Follow-ups (deliberately NOT done here)

- **Until the Railway redeploy the live sweep keeps 409ing** — the corpus holds at 654 and new jobs
  still record `body_persist_error`. Verification queries are in the sweep doc's STATUS section.
- The PA flow's `X-LCC-Source-User-Id` still sends the `lcc_users` id. The code is now robust to
  either, so this is cosmetic — but correcting the header removes a lookup per sweep.
- `is_sent` remains the handler's pre-existing approximation ("sent by us unless the FROM address is
  itself a tracked contact"), so Scott's own outbound reads `is_sent=false`. The backfill mirrors that
  rule exactly rather than silently redefining 23,760 rows; fixing it is a separate change.
