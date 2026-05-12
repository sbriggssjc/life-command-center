# Flow Detail: HTTP-Postmessagechat2

Last updated: 2026-05-12
Flow export: `HTTP-Postmessagechat2_20260512134447.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Format and post GovLease intake ops alert summaries into Teams from a manual HTTP payload.

## Trigger
- Type: `Request` (`manual`)
- Connector reference: `shared_teams`

## High-Level Action Topology
1. Receive request payload with alert list and metrics.
2. `Post_message_in_a_chat_or_channel` (`PostMessageToConversation`).
3. Message body composes fixed labels and dynamic alert rows using:
   - `join(select(triggerBody()['alerts'], ...), newline)`.

## Contract and Data Dependencies
- Expected payload fields include:
  - `alerts[]` with `level`, `title`, `body`
  - additional counters/severity fields used in template.
- Teams connector operation: `PostMessageToConversation`

## Key Risks
1. Template assumes specific payload shape; missing fields can degrade output quality.
2. Manual trigger mutation without strict schema can create malformed alerts.
3. Message formatting embedded inline is harder to maintain/version.

## Recommended Improvements
1. Add strict payload schema and fallback defaults for missing fields.
2. Move message template to a versioned text/adaptive-card artifact.
3. Add explicit error notification if alert rendering fails.

## Evidence Snapshot
- Trigger: `manual`
- Top action: `Post_message_in_a_chat_or_channel`
- Message body includes transformed `alerts[]` rows
- Connector map: `shared_teams`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

