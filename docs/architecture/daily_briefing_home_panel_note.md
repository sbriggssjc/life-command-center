# Daily Briefing Home Panel Note

> 🗄️ **HISTORICAL (DOCMAP1, 2026-09-08).** Short note (35 lines); likely folded into the live daily-briefing docs, not itself the reference.
>
> Kept for the record — nothing below was edited; treat any status/data claim in it as a
> point-in-time snapshot, not current state.

## Where the panel is rendered
- Homepage container:
  - `index.html` -> `#pageHome` -> `.home-main`
  - Widget id: `#dailyBriefingWidget`
  - Render target id: `#dailyBriefingContent`
- UI render logic:
  - `app.js` -> `renderDailyBriefingPanel()`
  - Data loader:
    - `app.js` -> `loadDailyBriefingData(force = false)`

## Data source
- Read-only endpoint:
  - `GET /api/daily-briefing?action=snapshot&role_view=<broker|analyst_ops>`
- Client uses structured JSON as primary render path.
- If `global_market_intelligence.html_fragment` is present, panel shows it in expandable `More market detail`.

## Role view selection
- Supported role views:
  - `broker`
  - `analyst_ops`
- Default role selection:
  - `operator`/`viewer` -> `analyst_ops`
  - `owner`/`manager` (or fallback) -> `broker`
- User override:
  - Header toggle in the panel (`Broker` / `Analyst/Ops`)
  - Persisted in local storage key: `lcc-daily-briefing-role-view`

## Freshness and degraded state
- Panel shows:
  - `as_of` timestamp
  - completeness badge (`Complete` or `Degraded`)
  - `missing_sections` list when degraded

