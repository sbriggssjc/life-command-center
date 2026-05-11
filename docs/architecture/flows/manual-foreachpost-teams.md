# Flow Detail: Manual ForEach Post (Teams)

Last updated: 2026-05-11
Flow export: `manual-foreachpost_20260511211947.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Accept a manual HTTP payload and iterate attachments to post Teams card/message content per item.

## Trigger
- Type: `Request` (`manual`)
- Connector reference: `shared_teams`

## High-Level Action Topology
1. Receive request payload.
2. `For_each` over `@triggerOutputs()?['body']?['attachments']`.
3. For each item, execute Teams action:
   - `Post_card_in_a_chat_or_channel`
   - operation id: `PostCardToConversation`
   - target configured to specific group/channel.

## Contract and Data Dependencies
- Input payload requires `attachments[]` with `content` field.
- Teams connector target uses configured group/channel identifiers.

## Key Risks
1. No observed payload validation before foreach.
2. Channel/group ids are hardcoded in action parameters.
3. Potential message flood if large attachment arrays are posted.

## Recommended Improvements
1. Add input schema + max item guardrails.
2. Externalize channel/group ids where feasible.
3. Add per-item error handling and summary response metrics.

## Evidence Snapshot
- Trigger: `manual` request
- Top action: `For_each`
- Inner action: `Post_card_in_a_chat_or_channel` (`PostCardToConversation`)
- Connector map: `shared_teams`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

