# Daily Briefing Home Panel Note

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

