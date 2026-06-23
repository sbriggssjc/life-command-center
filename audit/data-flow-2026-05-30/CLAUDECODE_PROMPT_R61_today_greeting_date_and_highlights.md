# Claude Code — R61: Today greeting date staleness + dia-highlights asymmetry (two small fixes)

## Why (live Today-page audit, 2026-06-22)
Two low-severity but real Today-surface bugs grounded live.

### Unit 1 — greeting date goes stale across midnight (the "Sunday June 21" bug)
The header greeting renders **"Sunday, June 21, 2026"** while the browser clock + the daily
briefing both correctly read **Monday, June 22**. Root cause is NOT the computation — it's
**staleness**. `app.js:8537` computes the date correctly and tz-aware:
```js
if (_greetDateEl) _greetDateEl.textContent = new Date().toLocaleDateString('en-US',
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
```
…but it runs **once at module init**. A tab left open across midnight keeps yesterday's date
forever, because `updateGreeting()` (which DOES re-run after each data load/refresh,
`app.js:8501`) updates only the greeting **text** (`#greeting`), never `#greetingDate`. The
stale date also feeds the "N events today" line via `tzDateStr(new Date())` consistency, so a
stale day-boundary skews "today."

**Fix:** recompute `#greetingDate` wherever the day can roll over, not just at init —
- move the `_greetDateEl` date-set into a small `setGreetingDate()` helper, call it from
  `updateGreeting()` (so every refresh re-stamps it), AND
- add a lightweight day-rollover refresh: a `visibilitychange` listener (recompute when the
  tab is re-focused) and/or a timer that re-stamps at local midnight. Keep the existing
  tz-aware `America/Chicago` formatting (it's correct). No behavior change beyond freshness.

### Unit 2 — hot contacts only ever boost GOV highlights (dia can't surface)
`supabase/functions/daily-briefing/index.ts` `buildDomainSignals` (≈line 1023): the
`hotContacts` loop pushes **unconditionally into `govHighlights`**, never dia:
```js
for (const c of (hotContacts || [])) {
  if (govHighlights.length >= 5) break;
  ...
  govHighlights.push(`${name}${score}`);   // gov-only, regardless of the contact's domain
}
```
So a hot **dialysis** contact can never appear in Dialysis Highlights. (Live: Government
Highlights had 3 fresh contacts; Dialysis Highlights = "No dialysis highlights." The dia
panel is *mostly* honest — dia had only ~10 inbox items in 3 days vs gov's ~249 — but this
asymmetry guarantees dia never gets the hotContacts boost gov gets.)

**Fix:** classify each hot contact by domain (reuse the existing `inferDomain(c)` helper used
for `allOpsItems` a few lines above) and route to `govHighlights` / `diaHighlights`
accordingly, each respecting its own `>= 5` cap. Unknown-domain hot contacts keep current
behavior (gov default) or are skipped — your call, but dia-classified ones MUST be allowed
into dia. (`inferDomain` already handles `"government"`/`"dialysis"`; inbox_items carry those
long forms, verified live, so no alias change needed here.)

## Out of scope (noted, separate follow-up)
- **10,104 inbox_items have `domain = null`** (unclassified) on LCC Opps — they can't route to
  either highlights feed or the domain inbox views. That's a data-quality backfill (infer +
  set domain on the null rows), not part of this UI fix. Flagging for a later DQ pass.

## Verify
- Unit 1: simulate/confirm the greeting date re-stamps on `updateGreeting()` and on
  tab-refocus; formatting unchanged (tz-aware Chicago). No regression to the "events today"
  line.
- Unit 2: a hot dia contact lands in Dialysis Highlights (unit-test `buildDomainSignals` with
  a mixed hotContacts list → gov vs dia split); gov unchanged when all hot contacts are gov.
- `node --check`; ≤12 api/*.js (no api change expected — app.js client + the daily-briefing
  edge function); suite green. Unit 1 ships on the Railway redeploy; Unit 2 ships on the
  daily-briefing edge-function redeploy.

## Bottom line
Two small honesty fixes for the first surface the operator sees each day: the greeting shows
the actual current date even on a long-open tab, and Dialysis Highlights can surface hot dia
contacts instead of being structurally gov-only.
