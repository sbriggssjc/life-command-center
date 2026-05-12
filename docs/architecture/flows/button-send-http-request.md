# Flow Detail — Button -> Send an HTTP request

## Metadata
- Export artifact: `Button-SendanHTTPrequest_20260512135816.zip`
- Display name: `Button -> Send an HTTP request`
- Trigger: `Request` (`kind: Button`)
- Current status: Active (manual utility flow)

## Purpose
Manual button-triggered HTTP utility call used for operator-run actions/testing.

## Risks
1. Manual trigger can bypass normal orchestration controls if endpoint auth/validation is weak.
2. Utility flows can drift into production mutation paths without audit.

## Improvements
1. Restrict allowed target endpoints.
2. Require `schema_version` + `correlation_id` in request body.
3. Log every invocation in LCC `integration_events`.
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

