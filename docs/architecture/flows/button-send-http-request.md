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
