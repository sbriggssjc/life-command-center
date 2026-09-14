> ⚠️ **This file is CANON-BOUND and must stay at the repo root.** `docs/os/canon/00-INDEX.md`
> global invariant #4 binds to it by name, `docs/os/REGISTRY.md` §A lists it as **canonical** at a
> root-anchored path, and `test/raw-write-guardrail.test.js` enforces a subset of it in the merge-time
> suite. **Moving it means a canon edit → `CANON_VERSION` bump → `render-surfaces.mjs` → a paste to
> every surface.** Do not move it as part of a tidy-up.
>
> ⚠️ **Its RULES are correct and enforced; its FILE NAMES were one consolidation out of date** — it
> named `api/data-proxy.js` and `api/contacts.js`, both deleted in 2026-04. **A canonical policy
> describing a retired file layout is a canon-integrity defect**, so the exempt list was corrected
> in place on 2026-08-28 rather than moved or archived.

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

2. `api/admin.js` (the data-query / edge-proxy paths) — ⚠️ **was `api/data-proxy.js`, which no longer exists; folded into `admin.js` by the 2026-04 handler consolidation. Corrected 2026-08-28.**
- Generic proxy layer
- Infrastructure surface, not an app workflow save surface

3. External messaging calls in `api/entity-hub.js` (contacts handlers) — ⚠️ **was `api/contacts.js`, deleted in the same consolidation. Corrected 2026-08-28.**
- Microsoft Graph Teams send
- WebEx messaging send
- WebEx SMS send
- These are external side effects, not internal business-table writes
- Their internal Gov/ops follow-up writes must still use audited helpers

4. Token refresh in `api/entity-hub.js` (contacts handlers) — ⚠️ **was `api/contacts.js`. Corrected 2026-08-28.**
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
