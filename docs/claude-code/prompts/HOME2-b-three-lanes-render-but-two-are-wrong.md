# HOME2-b — the three lanes render now, and two of them are wrong: BD shows empty on first load, Inbox reads a key that does not exist, and the widget sits 2,000 px down

**Filed:** 2026-09-18 (Cowork round 32, from a live look at Railway `6656f863` with `home_three_lanes = true`,
Chrome via Cowork). **Owner:** LCC (`app.js`, `index.html`, `test/home2-three-lanes.test.mjs`).
**Read first:** `docs/audits/HOME1_HOME_PAGE_*` (the spec), backlog `HOME2`, `HOME2-fix`, commits `7d30f90e`, `f612db87`.

## Measured (browser, 2026-09-18 ~12:00 UTC)
- `#home3LanesWidget` exists, `display: block`, **top = 2,073 px** — below TODAY (Significant / Important /
  Urgent) and below *Top Data Gaps to Close*. Scott scrolled the whole Home twice on 09-17 and did not find it.
- **Research lane** = `nbaSnapshot.items` top 5 — the same five rows as the *Top Data Gaps* widget directly
  above it. A duplicate, not a lane.
- **BD lane** rendered *"No seller prospects."* while `/api/seller-prospect-queue?chip=all&limit=5` returned
  `ok`, 5 items, 507 in the `all` chip. `renderHomeThreeLanes(true)` from the console filled it at once
  (WMC ATL, FD Stonewater, …). Cause: `_home3LoadBdLane` runs once at boot, caches `[]` on a failed/early
  call (`_home3BdLoaded = true`) and never retries; the Today panel's own loads were still spinning at that
  moment. A lane that says "none" when there are 507 breaks the honest-label rule.
- **Inbox lane** reads `dailyBriefingSnapshot.inbox_summary.items`. The live snapshot's keys are
  `briefing_id, as_of, timezone, workspace_id, audience, role_view, status, global_market_intelligence,
  global_signals, _debug, daily_briefing_packet, user_specific_priorities, team_level_production_signals,
  domain_specific_alerts_highlights, cross_domain_highlights, actions` — **no `inbox_summary`**. So it always
  renders *"Inbox is clear."* beside an INBOX panel showing 171 items. Wrong source, permanent false empty.
- `HOME2-fix`'s test asserts the ids exist; nothing asserts a lane carries data or that its source exists.

## Build
1. **Placement per HOME1.** Read the spec and put the widget where it says (if HOME1 says the lanes *are*
   Home, they go at the top and the panels they replace hide under the flag — name them). Not below the fold.
2. **BD lane:** load when the widget becomes visible, retry on failure, never cache an empty result from a
   non-ok response; on failure render *"Could not load — N in Priority"* (chip count if available), never
   "No seller prospects" unless the API said 0.
3. **Inbox lane:** source it from the same call the INBOX panel uses (`/api/queue-v2?view=inbox&per_page=6&status=new`,
   `app.js` ~6247) — one source, one truth; delete the `inbox_summary` read.
4. **Research lane:** if it is Top-Data-Gaps' top 5, hide that widget under the flag or give the lane a
   different cut (HOME1 decides). No duplicate panel.
5. **Tests:** per lane, a fixture from a real `/api/daily-briefing?action=snapshot` / queue body proving the
   read path exists, and an ok response with N > 0 never rendering the empty label.
6. Verify in a real browser against Railway after deploy: screenshot at first load, no console action.

⛔ No redesign beyond HOME1. ⛔ STATUS entry labelled **(CC)**; edit STATUS/backlog only as on `origin/main`.
**Parked:** one line each.
