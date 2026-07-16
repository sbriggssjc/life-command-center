# Claude Code (LCC) — sf-contact-resolve mint fails on null workspace_id (fallback like createResearchTask)

## Symptom (grounded live, 2026-07-16)

The by-id resolver route is restored (PR #1408) and the field-map fix (PR #1407) is correct
— but the mint fails with **`create_failed: {"code":"23502", ...}`** = a NOT NULL violation
on **`entities.workspace_id`**. Both Boyd contacts came back `outcome:"retry"`:
```
Joseph Capra  (0038W00002PRo0iQAD) → create_failed: 23502, entities.workspace_id null
Eric Dowling  (0038W00002PRqkNQAT) → create_failed: 23502, entities.workspace_id null
```
Root cause: **`sf-activity-ingest.js` enqueues the WhoId into `sf_contact_resolve_queue`
with a null `workspace_id`** (it can't always resolve one at ingest), and the resolver
worker passes that null straight into the `entities` INSERT that `ensureEntityLink`
performs. `entities.workspace_id` is NOT NULL → 23502 → the row `retry`s forever.

Cowork unblocked Capra/Dowling by hand (set `workspace_id =
a0000000-0000-0000-0000-000000000001`, the canonical/primary workspace holding 36,263 of the
entities, then re-drained → both resolved, Capra minted, Dowling email-reconciled, mismatch
lane fired). But **every future WhoId enqueued with a null workspace will 23502 identically.**
This is the durable fix.

## The fix (mirror the existing `createResearchTask` fallback pattern)
`createResearchTask` already handles exactly this: "falls back to the primary/oldest
workspace when a producer has a null workspace" (per CLAUDE.md, R8 Unit 3). Apply the same
in the SF-contact-resolve path:

1. **Resolver worker (`sf-contact-resolve.js` / `handleSfContactResolveTick`) — resolve a
   fallback workspace** when the queue row's `workspace_id` is null, BEFORE calling
   `ensureEntityLink`: use the row's `workspace_id` if present, else the primary/oldest
   workspace (the same resolver `createResearchTask` uses — reuse that helper, don't
   re-derive). Pass the resolved workspace into `ensureEntityLink`'s seed so the `entities`
   INSERT always has a non-null `workspace_id`.
2. **Belt-and-suspenders (`sf-activity-ingest.js`) — set `workspace_id` at enqueue.** When
   upserting a WhoId into `sf_contact_resolve_queue`, populate `workspace_id` from the
   activity's workspace if known, else the same primary/oldest fallback — so the queue row
   is never enqueued null. (Keep the worker fallback too; the worker fallback is the
   guarantee.)
3. Confirm `ensureEntityLink` itself doesn't silently drop a passed workspace on the SF
   `Contact` mint path (the person mint must carry it).

## Verify (post-deploy, Cowork)
- Force a fresh WhoId into the queue with a null `workspace_id` (or wait for the next SF
  activity sync to enqueue one) → `POST /api/sf-contact-resolve-tick` → it mints/reconciles
  (`resolved`), NOT `retry`/`create_failed: 23502`.
- `net._http_response` shows `byid_configured:true` ticks with `minted`/`reconciled` > 0 and
  `retried:0` for workspace-null rows.

## Boundaries
LCC-Opps only; SF read-only; no fabrication; ≤12 api/*.js (handler is a sub-route, no new
api file); additive/reversible. No behavior change beyond always supplying a valid
workspace to the mint.

## Bottom line
The resolver + field-map are proven correct (Capra minted, Dowling email-reconciled, mismatch
flagged — once the workspace was supplied). The only remaining defect is the null-workspace
enqueue that 23502s the mint. Give the resolver a primary/oldest-workspace fallback (the
`createResearchTask` pattern) and set `workspace_id` at enqueue, so no WhoId is ever stranded
on a NOT NULL violation again.
