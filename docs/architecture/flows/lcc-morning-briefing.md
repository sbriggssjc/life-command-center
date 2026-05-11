# Flow Detail: LCC Morning Briefing

Last updated: 2026-05-11
Flow export: `LCCMorningBriefing_20260511215210.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Fetch a preformatted briefing payload from LCC and send morning/weekend briefing emails via Office 365.

## Trigger
- Type: `Recurrence`
- Frequency: `Week`
- Interval: `1`
- Schedule: `Saturday`, `Sunday`
- Start time observed: `2026-04-11T12:00:00Z`

## High-Level Action Topology
1. Trigger on weekly schedule.
2. `HTTP` GET to `https://life-command-center-nine.vercel.app/api/briefing-email` with `X-LCC-Key`.
3. `Parse_JSON` on briefing payload.
4. `Send_an_email_(V2)` via Office 365 connector.

## Contract and Data Dependencies
- Endpoint dependency: `/api/briefing-email`
- Header dependency: `X-LCC-Key`
- Email delivery dependency: `shared_office365`

## Key Risks
1. Hardcoded endpoint URL.
2. Weekend-only schedule may diverge from business expectations if not centrally governed.
3. Email payload parsing assumes stable API shape.

## Recommended Improvements
1. Add centralized cadence register entry with owner/intent.
2. Validate payload schema before email send with explicit fallback branch.
3. Externalize endpoint base URL + key references.

## Evidence Snapshot
- Trigger: `Recurrence` weekly on `Saturday`,`Sunday`
- Top actions: `HTTP`, `Parse_JSON`, `Send_an_email_(V2)`
- Connector map: `shared_office365`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

