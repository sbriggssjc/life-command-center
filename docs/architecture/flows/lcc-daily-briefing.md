# Flow Detail: LCC Daily Briefing

Last updated: 2026-05-11
Flow export: `LCCDailyBriefing_20260511215104.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Fetch daily briefing snapshot from LCC and post an Adaptive Card/message to a Teams channel.

## Trigger
- Type: `Recurrence`
- Frequency: `Week`
- Interval: `1`
- Schedule: `Monday` to `Friday`
- Start time observed: `2026-04-06T12:30:00Z`

## High-Level Action Topology
1. Trigger on weekday schedule.
2. `HTTP` GET:
   - `https://life-command-center-nine.vercel.app/api/daily-briefing?action=snapshot&role_view=broker`
   - header includes `x-lcc-key`
3. `Post_card_in_a_chat_or_channel` via Teams connector.

## Contract and Data Dependencies
- Endpoint dependency: `/api/daily-briefing?action=snapshot&role_view=broker`
- Header dependency: `x-lcc-key`
- Teams dependency: `shared_teams` channel target.

## Key Risks
1. Hardcoded endpoint URL and role query parameter.
2. Channel/message delivery failures can silently degrade daily ops if no alerting.
3. Card payload format drift risk if API response changes.

## Recommended Improvements
1. Add failure notification path for Teams post failures.
2. Add response schema validation before post.
3. Move role/cadence settings into centrally governed config.

## Evidence Snapshot
- Trigger: `Recurrence` weekday schedule
- Top actions: `HTTP`, `Post_card_in_a_chat_or_channel`
- Connector map: `shared_teams`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

