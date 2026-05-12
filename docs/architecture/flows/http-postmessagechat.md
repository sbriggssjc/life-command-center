# Flow Detail: HTTP-Postmessagechat

Last updated: 2026-05-12
Flow export: `HTTP-Postmessagechat_20260512134401.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Receive manual HTTP payload and post the raw payload text to a Teams chat/channel.

## Trigger
- Type: `Request` (`manual`)
- Connector reference: `shared_teams`

## High-Level Action Topology
1. Receive request body.
2. `Post_message_in_a_chat_or_channel` (`PostMessageToConversation`) with message body containing `@{triggerBody()}`.

## Contract and Data Dependencies
- Teams connector operation: `PostMessageToConversation`
- Request payload can be free-form; currently inserted directly into message body.

## Key Risks
1. No input sanitization or schema enforcement for posted content.
2. Manual trigger can be abused for noisy/unstructured channel output if not gated.
3. No structured severity/type fields for downstream triage.

## Recommended Improvements
1. Add request schema and size limits.
2. Add simple content guardrails and message prefix metadata.
3. Require correlation id + source context in payload.

## Evidence Snapshot
- Trigger: `manual`
- Top action: `Post_message_in_a_chat_or_channel`
- Connector map: `shared_teams`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

