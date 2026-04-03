# LCC Loop Closure Rollout Summary

## Scope

This rollout covers the loop-closure remediation work for:
- canonical research completion
- entity reconciliation on manual saves
- audited mutation and insert flows
- contact-hub audited Gov writes
- write-surface policy and regression guardrails

This summary is limited to the loop-closure stream and excludes unrelated local work already present in the repo.

## What Changed

### Backend loop closure

- Added shared helper: `api/_shared/entity-link.js`
- Added shared helper: `api/_shared/research-loop.js`
- Refactored:
  - `api/bridge.js`
  - `api/workflows.js`
- Result:
  - manual research completion now closes canonical `research_tasks`
  - entity links are created instead of silently no-oping
  - follow-up action creation and activity logging happen in one shared flow

### Mutation and audit loop

- Added schema: `schema/018_loop_closure.sql`
- Extended `api/apply-change.js` with:
  - richer audit metadata
  - pending-review creation on failure
  - composite match filters
  - audited insert mode
- Result:
  - manual writes can create `data_corrections`
  - failed writes can create `pending_updates`

### UI and domain flows

- Updated key manual save surfaces in:
  - `app.js`
  - `detail.js`
  - `dialysis.js`
  - `gov.js`
  - `ops.js`
  - `index.html`
- Result:
  - high-use CRM mutations now go through audited paths
  - key `research_queue_outcomes` writes are audited
  - ownership/contact/sales/loan helper inserts are audited
  - queue-first ops interactions are better aligned with supported APIs

### Contact hub

- Added audited Gov-write layer in `api/contacts.js`
- Routed key internal writes through it:
  - `unified_contacts`
  - `contact_change_log`
  - `contact_merge_queue`
  - `system_tokens`
- Result:
  - contact-hub internal mutations now create ops audit/pending-review records
  - external Teams/WebEx/SMS sends remain canonical side effects

### Guardrails

- Added policy: `WRITE_SURFACE_POLICY.md`
- Added guardrail test: `test/raw-write-guardrail.test.js`
- Result:
  - new raw Gov/Dia business mutations are easier to catch before they spread

## Verification Completed

- Focused tests cover:
  - entity reconciliation happy/failure paths
  - research loop happy/failure paths
  - audited mutation patch/insert happy paths
  - pending-review creation on mutation failure
  - audited contact writes and failure behavior
  - raw write regression guardrail

- Verified test files:
  - `test/entity-link.test.js`
  - `test/research-loop.test.js`
  - `test/apply-change.test.js`
  - `test/contacts.test.js`
  - `test/raw-write-guardrail.test.js`

## Recommended Rollout Order

1. Apply schema migration `schema/018_loop_closure.sql`.
2. Deploy backend changes first:
   - `api/_shared/*`
   - `api/apply-change.js`
   - `api/bridge.js`
   - `api/workflows.js`
   - `api/contacts.js`
3. Deploy UI/domain changes:
   - `app.js`
   - `detail.js`
   - `dialysis.js`
   - `gov.js`
   - `ops.js`
   - `index.html`
4. Run focused verification in production-like env:
   - manual research save
   - entity-link creation
   - audited mutation success
   - audited mutation failure
   - contact classify/update failure handling
5. Enable/keep guardrail test in normal validation flow.

## Production Validation Checklist

- Manual research completion:
  - closes canonical `research_tasks`
  - logs `activity_events`
  - creates follow-up when requested

- Entity reconciliation:
  - creates `entities` and `external_identities` when missing
  - no longer silently skips entity updates

- Mutation audit:
  - successful writes create `data_corrections`
  - failed writes create `pending_updates`

- Contacts:
  - classify/update/merge/dismiss fail visibly when audited write fails
  - successful contact writes create ops audit rows

- Guardrails:
  - `test/raw-write-guardrail.test.js` remains green

## Known Exempt Surfaces

- `api/sync.js`
- `api/data-proxy.js`
- external Teams/WebEx/SMS API sends in `api/contacts.js`

These are intentional exemptions and are documented in `WRITE_SURFACE_POLICY.md`.

## Residual Risks

- Some legacy flows remain heterogeneous and may still need follow-up review over time.
- Sandbox limitations mean full `node --test test/` was not run as one suite here; focused suites were run individually.
- Unrelated local modifications exist in the worktree and should be reviewed separately from this rollout.
