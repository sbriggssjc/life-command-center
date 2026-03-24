# LCC Audit Loop Closure Worklog

## Session

- Date: 2026-03-24
- Objective: Implement the audit remediation plan with loop-integrity work first.

## Scope In Progress

- Add missing ops schema for manual-review and audit-loop records.
- Create shared backend helpers for research closure and entity link reconciliation.
- Refactor bridge/workflow/domain paths onto those helpers.
- Fix ops UI endpoint mismatches and replace prompt-based critical actions where practical.
- Add verification coverage for the new backend contracts.

## Findings Guiding This Session

- `bridge.complete_research` does not close canonical `research_tasks`.
- `bridge.update_entity` is a no-op when no `external_identities` row exists.
- `apply-change` logs to tables that do not exist in repo migrations.
- Ops inbox UI posts unsupported actions to `/api/inbox`.
- Legacy Salesforce logging/reschedule flows bypass canonical sync contracts.

## Change Log

- Created worklog for this remediation stream.
- Added schema migration `schema/018_loop_closure.sql` for `pending_updates` and `data_corrections`.
- Added shared helpers:
  - `api/_shared/entity-link.js`
  - `api/_shared/research-loop.js`
- Refactored `api/bridge.js` and `api/workflows.js` to use the shared research-closure path.
- Upgraded `api/bridge.js` entity-update and manual-save flows to create canonical entity links instead of silently no-oping.
- Extended `api/apply-change.js` to create reviewable pending updates on failure and return audit/reconciliation metadata on success.
- Added data-quality detail API support in `api/entities.js`.
- Fixed research queue loading and inbox/action transition wiring in `ops.js`.
- Added assignment, escalation, and follow-up modals in the ops UI and reworked the primary nav to queue-first in `index.html`.
- Switched key Salesforce logging calls in `app.js` and `detail.js` to canonical outbound sync endpoints.
- Added targeted tests for the new loop-closure helpers:
  - `test/entity-link.test.js`
  - `test/research-loop.test.js`
- Routed the remaining high-use CRM/marketing mutations in `app.js` through the mutation service:
  - Salesforce task complete
  - Salesforce task reschedule
  - Salesforce task dismiss
  - Marketing deal reassign
  - Marketing deal reclassify
  - Marketing lead status updates
  - Log-and-reschedule modal task date update
- Extended `api/apply-change.js` and the `app.js` mutation helper to support composite match filters so audited writes can safely target `salesforce_activities` rows by `sf_contact_id + subject`.
- Extended the mutation service to support audited inserts (`mutation_mode: insert`) and added `applyInsertWithFallback()` in `app.js`.
- Moved key manual `research_queue_outcomes` inserts/updates onto the audited path in:
  - `dialysis.js`
  - `detail.js`
  - `gov.js`
- Covered clinic lead outcomes, research outcome updates, sales-comp research saves, ownership-resolution logs, dismiss-lead outcomes, and intel research note saves with mutation-service audit logging.
- Extended audited insert coverage to auxiliary domain records in `detail.js` and `gov.js`, including:
  - `true_owners`
  - `recorded_owners`
  - `contacts`
  - `outbound_activities`
  - `sales_transactions`
  - `loans`
- Updated insert helpers to return created rows so ownership/contact flows can keep linking newly created IDs without falling back to raw proxy responses.

## Verification Notes

- `node --check` passed for all modified JS files.
- `node --check app.js` passed after the second-pass CRM mutation refactor.
- `node --check api/apply-change.js` passed after adding composite filter support.
- `node --check dialysis.js` passed after routing research outcome writes through the audited path.
- `node --check detail.js` passed after routing detail research outcome inserts through the audited path.
- `node --check gov.js` passed after routing government intel research notes through the audited path.
- `node --check detail.js` passed again after moving ownership/contact/sales/loan inserts onto the audited path.
- `node --check gov.js` passed again after moving sale/loan inserts onto the audited path.
- `node --test ...` is blocked in the current sandbox with `spawn EPERM`, so the new tests were added but could not be executed here.

## Open Risks

- Legacy domain flows are heterogeneous, so not every direct write can be eliminated in one pass.
- The remaining non-audited `POST` in the scanned domain files is a canonical outbound sync call rather than a raw table mutation.
- RPC helper paths and any writes outside the currently scanned gov/dialysis/detail/app surfaces still need review for full repo-wide closure.
- Existing tests are sparse and test execution is sandbox-limited in this environment.
