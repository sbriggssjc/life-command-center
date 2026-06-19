# Claude Code prompt — OUTREACH #1: close the SF-activity → cadence-advance loop (Scott's real workflow)

> From the outreach-loop audit (2026-06-19). Scott confirmed he does outreach in **Outlook /
> Salesforce**, NOT in-app. The whole cadence engine (R10/R16/R20/R24) is built and DATA-READY
> (297 prospecting cadences reachable + overdue, 23 templates, value-ranked dashboard), but it
> has produced **0 template sends and ~1 cadence touch ever** — because the one link his workflow
> depends on is broken: **SF-logged outreach does not reliably advance the matching cadence.** Fix
> that and the loop closes in his real workflow (he works SF/Outlook; the cadence advances + the
> dashboard updates automatically). Receipts-first; gated; reversible; root-cause before fixing.

## Grounding (measured live 2026-06-19, LCC Opps — independently verified by the gate)
- Scott DOES do BD: **36 outreach activity_events in 120 days** (23 calls + 13 emails, last
  2026-06-18), all carrying **Salesforce fields** (`sf_id`, `sf_type='Call'/'Email'`, `who_id`,
  `what_id`) — i.e. pulled from SF via the activity sync. So outreach reaches the app.
- **But it doesn't close the loop.** Of the SF outreach events on cadence-bearing owners, only
  **4 of 13 advanced the cadence; 9 did not.** Clearest case: a steady_state cadence with **7 SF
  calls logged 2026-06-17** still shows `last_touch_at = 2026-05-19` — never advanced. Net:
  cadences sit permanently overdue, the dashboard looks dead, "0 sends" — even though Scott is
  actively calling/emailing.
- **What the gate already ruled IN/OUT** (so don't re-chase these):
  - The advance trigger `activity_event_advance_cadence` IS bound (AFTER INSERT) on
    `activity_events`. ✓
  - `lcc_advance_onboarding_cadence` advances **unconditionally** — NO touch-type gate (a call on
    an email-next cadence would still advance if the function is reached). So type-mismatch is NOT
    the cause. ✓
  - SF events have `occurred_at` set and `skip_cadence_advance` is null (not skipped). ✓
  - The BEFORE trigger `lcc_resolve_activity_entity_id` only resolves **OM-intake** activity (keys
    on `inbox_item_id` → asset entity); it does NOT touch SF activity. So SF `entity_id` is set by
    the **sf-activity-ingest path (JS)**, not that trigger.
- So the break is in the runtime SF path: either the SF-ingest resolves `entity_id` to an entity
  the cadence isn't on / sets it after the advance trigger has run, or the advance trigger's
  `EXCEPTION WHEN OTHERS` is **silently swallowing a failure** (it only `RAISE WARNING`s — invisible
  here). 9/13 failing points at one of these.

## Unit 1 — root-cause (definitive, before any fix)
Read `api/_handlers/sf-activity-ingest.js` (and the SF sync edge function) + reproduce on the 9
historical misses. Determine exactly which is true:
1. **Entity mismatch** — does the ingest set `activity_events.entity_id` to the SF **Contact**
   (`who_id`) person, the **Account** (`what_id`), or the owner? The cadence's `entity_id` is the
   OWNER; its `contact_id` is the person. The advance trigger only looks up cadences by
   `entity_id` (+ an `owns` asset→owner hop) — it does NOT match `contact_id`. If SF activity
   resolves to the contact-person, the trigger can't find the owner cadence.
2. **Timing** — was `entity_id` NULL at insert (contact not yet linked — many were linked only by
   the 2026-06-18 SF reconciliation) and backfilled later? The AFTER trigger ran once, at insert,
   with NULL → skipped; the later backfill doesn't re-advance.
3. **Silent exception** — instrument/inspect: is `lcc_advance_onboarding_cadence` throwing (e.g.
   `lcc_steady_state_interval_days` on a null `priority_tier`) and being swallowed by the trigger's
   `WHEN OTHERS`? Make the swallow observable (log to a table / `lcc_health_alerts`, don't just
   `RAISE WARNING`).
Report which cause(s) actually fire on the 9 — receipts, not theory.

## Unit 2 — fix so SF outreach reliably advances the cadence (the workflow unblock)
Based on Unit 1, fix at the right layer (reuse the existing advance machinery — do NOT fork
`lcc_advance_onboarding_cadence`):
- If **entity mismatch**: extend the cadence lookup (in the trigger AND/OR the ingest) to also
  match a cadence by **`contact_id = activity.entity_id`** (the activity is on the person who IS
  the cadence's contact) and the contact→owner `associated_with` hop — so an SF touch on the
  contact advances the owner's cadence. Mirror the existing asset→owner `owns` hop pattern.
- If **timing**: have sf-activity-ingest **advance explicitly after it resolves entity_id** (call
  the advance in the same path, tagged so the AFTER trigger doesn't double-advance — reuse the
  R10 `skip_cadence_advance` single-owner convention), OR re-fire the advance on the `entity_id`
  UPDATE that backfills it.
- If **silent exception**: fix the underlying throw AND stop swallowing it silently.
- **Backfill the 9 historical misses** (advance their cadences from the existing SF events) so the
  dashboard reflects reality — reversible.

## Unit 3 — confirm the loop closes end-to-end (Scott's workflow)
A synthetic SF-style activity (`sf_type='Call'`, on a cadence owner / its contact, no
`skip_cadence_advance`) must advance the matching cadence: `current_touch +1`, `last_touch_at` =
the event, `next_touch_due` rescheduled into the future, `calls_made +1`. Then the value-ranked
cadence dashboard shows the owner moving out of overdue. That is the loop Scott needs: he works
SF/Outlook → the cadence advances automatically.

## My gate (read-only)
- Unit 1: the actual root cause(s) named with receipts on the 9 misses (not speculation).
- Unit 2: a synthetic SF call/email on a cadence owner (or its contact) advances the cadence
  (touch +1, last_touch set, rescheduled); no double-advance; the silent-swallow is observable;
  the 9 historical misses backfilled (reversible); existing in-app advance path unchanged.
- Unit 3: the dashboard reflects the advanced cadences; 0 residue from synthetic tests.

## Guardrails
- Receipts-first; root-cause before fix; reversible; reuse `lcc_advance_onboarding_cadence` + the
  existing trigger/skip-flag convention (single advance owner — never double-advance). ≤12
  api/*.js. Bump `?v=` if the dashboard render changes.
- **Scope note:** this is the ADVANCE half (Scott's actual blocker). The DRAFT half (generate an
  email in-app for him to send from Outlook) is secondary — he may not need it; do NOT expand into
  building an in-app sender. The win is: his SF/Outlook outreach advances cadences, so the
  dashboard becomes a live, trustworthy "who to contact next," value-ranked.
- Net: the outreach loop finally closes in Scott's real workflow — the connectivity work made the
  owners visible + SF-linked; this makes his outreach against them actually move the cadence.
