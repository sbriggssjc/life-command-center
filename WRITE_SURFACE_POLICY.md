# Write Surface Policy

## Purpose

This policy defines which write paths are allowed in LCC after the loop-closure remediation work.

Goal:
- internal business/domain writes must be auditable
- human-loop saves must reconcile back into ops audit tables
- exempt write paths must be explicit, narrow, and intentional

## Default Rule

Do not add new raw business-table mutations that bypass:
- `POST /api/apply-change`
- `applyChangeWithFallback()` / `applyInsertWithFallback()` in frontend/domain surfaces
- audited helper layers such as `auditedPatchGov()` / `auditedInsertGov()`

For internal business records, the expected result is:
- target data updates
- ops audit entry in `data_corrections`
- pending-review entry in `pending_updates` on failure where applicable

## Approved Patterns

Use these for internal writes:
- frontend/domain manual saves: `applyChangeWithFallback()` or `applyInsertWithFallback()`
- backend Gov contact-hub writes: `auditedPatchGov()` or `auditedInsertGov()`
- canonical mutation route: `/api/apply-change`

## Exempt Surfaces

These are intentionally allowed to write outside the generic mutation-service contract:

1. `api/sync.js`
- Canonical connector ingestion/outbound orchestration layer
- Writes sync jobs, sync errors, health, and connector-related activity as part of the sync engine

2. `api/data-proxy.js`
- Generic proxy layer
- Infrastructure surface, not an app workflow save surface

3. External messaging calls in `api/contacts.js`
- Microsoft Graph Teams send
- WebEx messaging send
- WebEx SMS send
- These are external side effects, not internal business-table writes
- Their internal Gov/ops follow-up writes must still use audited helpers

4. Token refresh in `api/contacts.js`
- `system_tokens` storage is operational secret material
- Still routed through `auditedPatchGov()` / `auditedInsertGov()` after remediation

5. Fallback direct proxy writes in `app.js`
- Only allowed inside `applyChangeWithFallback()` and `applyInsertWithFallback()`
- Only used when the audited mutation bridge is unavailable and the feature flag permits fallback

## Disallowed Patterns

Do not introduce new raw writes like:
- direct `govQuery('POST', ...)` or `govQuery('PATCH', ...)` for business records
- direct `diaQuery(... { method: 'POST'|'PATCH' })` mutations for business records
- direct `fetch('/api/gov-query' ...)` or `fetch('/api/dia-query' ...)` POST/PATCH blocks for manual business saves

If a new write surface truly needs exemption, document:
- why the mutation service is not the right abstraction
- what audit trail exists instead
- what failure/retry behavior exists

## Guardrail

`test/raw-write-guardrail.test.js` enforces a narrow subset of this policy:
- no new raw `govQuery('POST'|'PATCH')`
- no new raw `diaQuery(... method: 'POST'|'PATCH')`
- no new direct `/api/gov-query` or `/api/dia-query` mutation blocks outside approved exemptions

If that test fails, either:
- route the write through an audited path, or
- explicitly update this policy and the guardrail with a justified exemption
