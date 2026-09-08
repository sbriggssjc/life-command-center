# Flow Detail: LoopNet Power Automate

> 🚨 **STALE (DOCMAP2, 2026-09-08): the endpoint below (`life-command-center-nine.vercel.app`) is
> the RETIRED Vercel deployment (retired 2026-07-20, root `CLAUDE.md`).** It still answers and
> still holds a service key (P194), so the flow is not broken — but this doc's endpoint is wrong;
> the live endpoint is the Railway host (`server.js` `/api/loopnet-ingest`). Already tracked as
> backlog **J13** in `docs/os/PLANNED-BACKLOG.md`. Do not repoint the live Power Automate flow from
> this doc alone — confirm against `docs/architecture/infrastructure-topology.md` first.

Last updated: 2026-05-11
Flow export: `LoopNetPowerAutomate_20260511214000.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Ingest new LoopNet-related emails from Outlook and forward parsed content to LCC LoopNet ingestion endpoint.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `OnNewEmailV3`
- Connector references:
  - `shared_office365`
  - `shared_conversionservice`

## High-Level Action Topology
1. Trigger on new email.
2. Convert HTML to text.
3. POST to `https://life-command-center-nine.vercel.app/api/loopnet-ingest`.
4. Mark email as read/unread based on condition logic.

## Contract and Data Dependencies
- Endpoint dependency: `/api/loopnet-ingest`
- Header dependency: `X-PA-Webhook-Secret`
- Conversion step depends on conversion service connector availability.

## Key Risks
1. Hardcoded endpoint URL.
2. Condition expression currently references `POST_to_LoopNet_ingest` while top-level action name observed as `HTTP` (potential naming drift risk).
3. Secret header handling requires controlled reference storage.

## Recommended Improvements
1. Align condition references to canonical action names and add regression test.
2. Add contract version field and response schema checks.
3. Externalize URLs and secrets.

## Evidence Snapshot
- Trigger: `When_a_new_email_arrives_(V3)`
- Top actions: `Html_to_text`, `HTTP`, `Mark_as_read_or_unread_(V3)`, `Condition`
- HTTP endpoint: `/api/loopnet-ingest`
- Connector maps: `shared_office365`, `shared_conversionservice`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

