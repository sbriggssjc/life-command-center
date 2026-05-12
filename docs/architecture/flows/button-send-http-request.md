# Flow Detail: Button-SendanHTTPrequest

Last updated: 2026-05-12
Flow export: `Button-SendanHTTPrequest_20260512135816.zip`

## Intent
Manual HTTP button flow to call Azure cognitive extraction endpoint.

## Trigger
- Type: `Request` (`manual`)
- Connector references: none (direct HTTP action).

## High-Level Action Topology
1. Receive manual request trigger.
2. `HTTP` POST to:
   - `https://propertyaiextractor.cognitiveservices.azure.com/`
   - headers include `Ocp-Apim-Subscription-Key`, `Content-Type`.

## Key Risks
1. Subscription key secret handling and rotation governance.
2. Manual invocation can generate uncontrolled external API usage without guardrails.

## Recommended Improvements
1. Move subscription key to managed secure reference.
2. Add request schema + usage rate controls + audit logging.

## Evidence Snapshot
- Definition SHA256:
  - `32cfe1a3e83b9fddbad17bec442306ca438db0cf0b715a25248de92973515b3c`

