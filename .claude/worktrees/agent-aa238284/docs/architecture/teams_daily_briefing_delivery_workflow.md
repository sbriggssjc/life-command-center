# Teams Daily Briefing Delivery (Wave 1)

## Objective
Deliver the existing unified Daily Briefing snapshot from LCC to a Teams channel each morning.

Scope is read-only:
- Uses `GET /api/daily-briefing?action=snapshot`
- No write actions
- No approvals/mutations
- No Outlook delivery in this step

## Artifacts
- Adaptive Card template:
  - `docs/architecture/teams_daily_briefing_adaptive_card.json`
- Flow spec:
  - `flow-daily-briefing-to-teams.json`

## Endpoint and role view
- Snapshot endpoint:
  - `GET /api/daily-briefing?action=snapshot&role_view=<broker|analyst_ops>`
- Supported role views in this delivery:
  - `broker`
  - `analyst_ops`

Recommended approach:
- One scheduled flow per audience/channel role view.
- Example:
  - Broker briefing -> Broker channel -> `role_view=broker`
  - Analyst/Ops briefing -> Ops channel -> `role_view=analyst_ops`

## Power Automate scheduled delivery path

1. Trigger
- Recurrence (weekdays, e.g. 7:30 AM America/Chicago)

2. HTTP fetch snapshot
- Method: `GET`
- URL: `https://<LCC_HOST>/api/daily-briefing?action=snapshot&role_view=<ROLE_VIEW>`
- Headers:
  - `x-lcc-key: <LCC_API_KEY>`
  - `x-lcc-workspace: <WORKSPACE_ID>`

3. Compose card binding data
- Map snapshot fields into compact strings/counters for card slots.
- Keep null-safe via `coalesce()` expressions.

4. Post Adaptive Card to Teams channel
- Use template: `docs/architecture/teams_daily_briefing_adaptive_card.json`
- Bind with composed data object.

## Required env/config
- `LCC_HOST` (e.g. `https://<your-lcc-host>`)
- `LCC_API_KEY`
- `WORKSPACE_ID`
- `ROLE_VIEW` (`broker` or `analyst_ops`)
- `TEAMS_TEAM_ID`
- `TEAMS_CHANNEL_ID`

## Example payload mapping

| Card field | Snapshot source |
|---|---|
| `summary_headline` | `global_market_intelligence.summary` |
| `as_of_display` | `as_of` |
| `completeness_status` | `status.completeness` |
| `top_priorities_text` | `user_specific_priorities.today_top_5[*].title` (joined/truncated) |
| `work_open_actions` | `team_level_production_signals.work_counts.open_actions` |
| `work_inbox_new` | `team_level_production_signals.work_counts.inbox_new` |
| `work_sync_errors` | `team_level_production_signals.work_counts.sync_errors` |
| `government_highlights_text` | `domain_specific_alerts_highlights.government.highlights[*]` (joined/truncated) |
| `dialysis_highlights_text` | `domain_specific_alerts_highlights.dialysis.highlights[*]` (joined/truncated) |
| `is_degraded` | `status.completeness == "degraded"` |
| `degraded_note` | `status.missing_sections` (joined) when degraded |

## Card sections included
- Summary headline
- `as_of` timestamp
- Completeness status
- Top priorities
- Work/inbox/sync counts
- Government and dialysis highlights
- Action buttons back into LCC

## LCC action buttons (read-only navigation)
- Open LCC Home
- Open My Queue
- Open Inbox
- Open Sync Health

## Setup instructions

1. Import or recreate flow from `flow-daily-briefing-to-teams.json`.
2. Set parameters:
   - `LCC_HOST`
   - `LCC_API_KEY`
   - `WORKSPACE_ID`
   - `ROLE_VIEW`
   - `TEAMS_TEAM_ID`
   - `TEAMS_CHANNEL_ID`
3. Confirm the HTTP step returns `200` and snapshot JSON.
4. Verify Adaptive Card renders with:
   - headline
   - counts
   - highlights
   - completeness badge text
5. Verify degraded behavior by temporarily using a snapshot that reports missing sections.
6. Enable schedule.

## Wave 1 guardrails
- No mutation calls in flow.
- No approval actions.
- No domain write calls.
- Use only snapshot payload fields for Teams content.

