# Actor Attribution (B2 Phase 1) — foundation done + code change spec

_2026-07-29. Turns "who touched this deal" from system-attributed into broker-attributed. This is the last
engine-side gap in the rollout notes. Cadence itself is per-deal (actor-independent), so this is **team-visibility
provenance**, not a cadence fix — but it's the thing that makes the manager overview and entity timeline true._

## What the actor model actually is (measured 2026-07-29)
`activity_events.actor_id` → FK → `public.users(id)`. `users` is an **actor registry**, and only two things read
it: `v_entity_timeline` (`actor_name = users.display_name`) and `v_manager_overview` (a member's
`last_activity_at` = latest `activity_events.occurred_at` for that actor). No cadence function reads `actor_id`.

The registry was polluted: **every `users.display_name` read "Scott Briggs"** — brokers and external senders
alike (davita.com, vantix-realty, webex, adp…), and each was auto-added as a workspace `operator`. So both views
rendered ~25 different people as "Scott Briggs".

**Root cause (code):** `api/_shared/intake-om-pipeline.js` (~L265) mints a `users` row with
`display_name: callerName`, where `callerName = auth?.name ?? callerEmail`. `auth.name` is the calling token's
display name (Scott's), so any row it creates for a non-Scott email inherits "Scott Briggs". L290 then inserts a
`workspace_memberships` row (`role: 'operator'`) for it.

**Structural constraint:** `users.email` is UNIQUE, and Scott's actor identity **is** the `SYSTEM_ACTOR` sentinel
(`b0000…001`, email `sabriggs@`). So Scott-the-person and "the system" are the same row and can't be split
without freeing that email — deferred as a separate change.

## What was applied (DB, live + version-controlled)
`supabase/migrations/20260729140000_actor_identity_foundation.sql`:

1. **Broker names corrected** — Kelly Largent, Sarah Martin (were "Scott Briggs").
2. **Nate's identity created** — `nberwaldt@northmarq.com` → new `users` row + workspace membership (he had none).
3. **De-polluted the rest** — every other "Scott Briggs" row now shows a name derived from its own email
   (Ray Shuchart, Susan Holdsworth, Webex Comm…); only Scott's four aliases stay "Scott Briggs".
4. **`lcc_actor_for_mailbox(email)` helper** — given an ingesting mailbox address, returns that broker's actor id
   (`sabriggs@`→sentinel, `klargent@`→`9262ebfe…`, `smartin@`→`7072e321…`, `nberwaldt@`→new), SYSTEM_ACTOR fallback.

**Verified:** both views now render real per-actor names; helper resolves all four mailboxes + fallback.
**Backfill of Scott's history = intentional no-op:** his mail already sits on his id (== the sentinel), so there's
nothing to move until/unless we split the sentinel.

## The going-forward code change (🧑 Scott merges + deploys)
Three small edits make new mail attribute to the owning broker. None changes Scott's current behavior (his flow
has no `mailbox_owner`, so it resolves to the sentinel = today's value).

### 1. Thread the mailbox owner into intake → resolve the actor
**`api/sync.js`** — the Outlook email + calendar ingest paths currently hardcode `actor_id: user.id`
(the auth user = SYSTEM_ACTOR). Replace with a resolved actor:

```js
// near the top of the ingest handler, once per request:
const mailboxOwner = (req.body?.mailbox_owner || '').trim();       // supplied by the PA flow (see step 3)
let actorId = user.id;                                             // default = today's behavior (sentinel)
if (mailboxOwner) {
  const r = await opsQuery('POST', 'rpc/lcc_actor_for_mailbox', { p_email: mailboxOwner });
  if (r.ok && r.data) actorId = Array.isArray(r.data) ? r.data : r.data;   // fn returns a uuid
}
// then use actorId (not user.id) in the activity_events insert(s)
```

(Equivalently, resolve in JS with a `users?email=eq.…&select=id` lookup — but the DB helper keeps the mapping in
one place and applies the SYSTEM_ACTOR fallback for you.)

### 2. Same swap in the OM/intake promoter
Wherever the intake promoter writes `activity_events` from staged mail (the `intake_om` / `email_intake`
sources), set `actor_id` from the staged item's `mailbox_owner` via the same helper, not from the caller.

### 3. Each broker's PA intake flow adds one constant
In every broker's copy of `LCC - Outlook Intake to Teams (Hardened)`, add a constant to the JSON body it POSTs:
`"mailbox_owner": "klargent@northmarq.com"` (their own address). Scott's flow can add `sabriggs@northmarq.com`
or leave it off (either way → sentinel). This is the only PA-side change, and it's part of the broker-core
bundle in TEAM-ROLLOUT.

### 4. Root-cause fix (stops re-pollution) — recommended
At `api/_shared/intake-om-pipeline.js` ~L265, stop copying the caller's token name onto a row keyed by a
different email. Minimal safe change: derive the row's name from **its own email** unless it equals the caller:

```js
const isCaller = callerEmail && (callerEmail === /* this row's email */);
const display  = isCaller ? callerName
               : (/* row email */.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g, c => c.toUpperCase()));
```

Better still (design): discovered *senders* should be written as **contacts**, not as `users` + workspace
`operator` members — being a "user/operator" is why they land in the manager overview at all. Worth a short
follow-up to route sender discovery to the contacts graph instead of `users`.

### 5. Optional DB backstop (self-healing)
If you'd rather not chase every writer, a `BEFORE INSERT` trigger on `users` that rewrites a hardcoded
"Scott Briggs" onto a non-`sabriggs@` email to the email-derived name makes re-pollution impossible regardless of
which code path (api, edge fn, or PA) creates the row. Say the word and I'll add it.

## Verify after deploy
- Send/receive on a second broker's mailbox (once their flow is live) → new `activity_events` carry **their**
  `actor_id`, and `v_manager_overview` shows their `last_activity_at` moving (not Scott's).
- `v_entity_timeline` shows the correct `actor_name` per event.
- No new `users` rows appear with `display_name = 'Scott Briggs'` for non-Scott emails.

## Where this leaves the rollout
Per-broker attribution is **ready at the engine/DB layer** for Kelly, Sarah, and Nate. The remaining work is the
three small code edits above (Scott deploys) plus the one-line PA-flow constant per broker — folded into the
broker-core bundle. Scott-vs-system disambiguation (splitting the sentinel) is a later, optional refinement.
