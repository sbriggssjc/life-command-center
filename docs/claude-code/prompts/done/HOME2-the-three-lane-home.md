# HOME2 — the three-lane Home (Research / BD / Inbox), a pure re-composition behind a flag

**Filed:** 2026-09-17 (Cowork). **Owner:** LCC (`app.js` Home rendering, `api/admin.js` gaps widget,
`supabase/functions/daily-briefing/index.ts` only if a field is missing, `test/`). **Read first:**
`docs/audits/HOME1_HOME_PAGE_AUDIT_2026-09-16.md` §B (the spec — three lanes, existing views only) and
§A (the human-actionable gaps predicate, live since PR #2513); `prompts/done/PRI2-on-…md` (the BD
lane's source is now the seller-prospect queue, **not** `v_priority_queue_enriched` as §B first wrote);
Scott's intent in HOME1's prompt: ≤3 lanes, gaps = high-value records with a *human* next step, highlights
= market intel not deal flow.

## What to build (flag `home_three_lanes`, OFF)

1. **Research lane** — the HOME1-filtered gaps widget as a lane: `v_next_best_action` with §A's
   human-actionable predicate, `gap_priority_score DESC`, cap 5, each row = property · the gap · the
   named source the sidebar can capture · one button. A row leaves when the gap resolves.
2. **BD lane** — **PRI2's list, top 5, labelled "same queue as the Priority tab, top 5"**: the
   `/api/seller-prospect-queue` route with the reason-first order and one card per property (PRI2-on),
   not a second query. A row leaves when a touchpoint is logged or the reach state changes.
3. **Inbox lane** — `inbox_items` new/overdue first, `created_at DESC`, cap 5, from the `inboxSummary`
   the briefing already fetches; a row leaves on the existing status transition.
4. **Remove the fallback that duplicated the Priority tab**: `_dbFillMyPrioritiesFromQueue()` fires
   when `today_top_5` is empty and silently renders `/api/priority-queue?limit=5`. Behind the flag, it
   is gone; the BD lane is the honest replacement. Measure and report how often `today_top_5` was
   empty in the last 14 briefings (the audit could not).
5. **Highlights** stay as HOME1 §C left them (market intel, domain-routed).
6. Flag OFF byte-identical (test). Tests: each lane reads the named source and nothing else (source-
   shape assertions); caps; the fallback is absent under the flag; the BD lane's rows equal the
   queue route's first five.

## Prohibitions

- ⛔ No new view, no new score, no producer changes; if a lane needs a field the view lacks, stop and
  say which. ⛔ Redeploy both Railway services and confirm `/version`.

## Reporting

A screenshot-equivalent text render of the three lanes for one real day; the `today_top_5`-empty
count; suite counts. **Parked:** anything noticed out of scope, one line each (→
`docs/claude-code/PARKING-LOT.md`). If any step was skipped, say so.
