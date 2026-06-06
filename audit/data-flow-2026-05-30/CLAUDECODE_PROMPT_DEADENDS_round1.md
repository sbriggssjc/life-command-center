# Claude Code prompt — Dead-end fixes, round 1

Paste into Claude Code, run from the **life-command-center** repo. Read
`audit/data-flow-2026-05-30/LCC_DEADEND_AUDIT_2026-06-06.md` first — it
carries the full catalog (7 already resolved this week; this round clears the
open backlog). North star: **no workflow ever stalls without a way forward**
— every terminal state offers the next action, every success advances the
surface, every failure says what happened and what to do.

Scott is actively working the app: keep changes additive, exercise only
side-effect-safe verifications (synthetic rows / safe verdicts), zero residue.

## A. Flow gaps — machinery exists, wire the hand-off (do these first)

1. **Intake card → create property.** Live Ingest cards (app.js ~660-700)
   toast "No matched property found" and stop. The F4 machinery
   (`/api/intake?_route=create-property`, the inbox verdict card pattern) is
   live — give the card the same actions: "Create property →" (full-deal-
   signature intakes), "View extraction →", and a match-search affordance.
   Reuse the inbox card renderer; don't fork.
2. **Listing document toast → link path.** "No document linked to this
   listing" (app.js ~481) gets an upload/link affordance (whatever the
   property_documents machinery supports — even just deep-linking to the
   property's Documents tab beats a dead toast).
3. **Kill the `prompt()` class.** Implausible-value "Correct value…", junk
   "Rename…"/"Merge into…", true-owner "Stale — new owner is…" all use native
   prompts: no context, no validation, unstylable. Replace with inline forms
   in the card (the SF-mapping card's input/typeahead pattern): show current
   value + evidence beside the input; validate before POST; entity-merge gets
   the existing entity typeahead.
4. **Log & Reschedule partial failure.** detail.js ~5525 runs two sequential
   POSTs (log-activity, task-reschedule); if the second fails the user can't
   tell the first succeeded. Per-step feedback ("Call logged ✓" / "Follow-up
   FAILED — retry") and retry only the failed step; reset the form only on
   full success.
5. **Sync Health reconnect.** A disconnected connector's only CTA is "Sync
   Now" (which can't succeed). Disconnected → "Reconnect →" routing to the
   connector auth flow (or honest "reconnect via Settings > Connectors"
   guidance if no in-app flow exists). Also: there appear to be 3 outlook
   connector rows (2 healthy, 1 disconnected) — determine if the disconnected
   one is a stale duplicate and offer remove/archive (soft).

## B. Honest + ergonomic states

6. **Entities page truth.** Header says "All (25)" — a fetch limit presented
   as the universe (the R4-B class; real entity count is ~16k+). Server-side
   count + honest framing ("25 of N — search to narrow"), plus search/filter
   that queries the backend, not the loaded page.
7. **Standardize error states.** One error-state component for widgets and
   page-level failures: what failed (status/detail), Retry, and when retry is
   hopeless (4xx config errors) say so instead of looping. Sweep:
   `.widget-error` renders, gov/dia page-level "Failed to load", live-ingest
   "Search error", decision-lane load failures (ops.js ~1152/1519/1672 —
   currently no retry at all).
8. **SF activity log advance.** app.js ~5410: after a successful log, refresh
   the activity feed section and clear the form (the toast-without-advance
   sibling).
9. **Junk lane bulk verdicts.** 1,050 flagged rows can't be worked
   one-by-one. Add bucket bulk-disposition with preview: classify the flagged
   set into buckets (`by <brokerage>` attribution strings; `<Parent>
   JV/Fund/CMBS/deal` strings; bare fragments), preview the bucket (count +
   samples), then one verdict applies to the bucket (retype/merge/leave) via
   a batch-limited worker — effect-first, decision rows recorded per entity
   (or one bucket-decision with per-row effects), idempotent, report counts.
10. **detail-open race.** ops.js ~2712/2843/2980 guard `typeof showDetail !==
    'function'` → dead toast. Fix the class: defer via a readiness check
    (queue the open until detail.js is loaded) or reorder script loads;
    remove the dead-toast fallback.

## C. Polish (batch these; small)

11. "No sale recorded for this property yet" → append "Add first sale →"
    (opens the existing `_salesToggleForm`).
12. Excel export CDN race → on missing XLSX lib: try dynamic import, then
    CSV fallback; never just "try again".
13. Empty-queue celebrations ("Nothing awaiting confirmation 🎉") → add
    "Next: <the busiest decision lane> →".
14. Team Queue flag-off message → tell admins where to enable (Settings/flags)
    instead of a bare statement.
15. Contacts list unnamed rows render "? / —" → show source/company line and
    a "needs name" chip instead of punctuation soup.
16. Consolidate modal: add explicit "Not a duplicate" (records the dismissal
    like the merge lane does) so Close isn't ambiguous.

## D. Data (small, carried from the sweep)

17. Duplicate sale `activity_events` (same sale, ~1s apart, system category)
    — dedupe at the writer (idempotency key on source event) and collapse
    existing dupes (keep oldest).
18. `sf_comps_staging` null-`import_batch` failures (the second spike-alert
    offender) — root-cause the writer; fix or park with reason.

## Verify + ship
- Per A-item: exercise the happy path live where side-effect-safe (synthetic
  intake → Create property; synthetic doc link; inline form verdicts on a
  test/sandbox row; partial-failure simulation for #4) — zero residue.
- B6: Entities header shows true count. B7: kill-switch test — point one
  widget at a 404 and confirm the error state renders detail + doesn't loop.
  B9: bulk verdict on ONE bucket with preview, report counts (leave the other
  buckets for Scott).
- C: spot-render each.
- `node --check`; 12 functions; migrations idempotent; crons after routes;
  ANALYZE after bulk refreshes. Report per-item status (shipped / deferred +
  why) in the PR.
