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
  - extended with failure-path coverage for entity-link and research-loop abort behavior
- Added targeted mutation-service tests in `test/apply-change.test.js` covering:
  - composite-filter PATCH behavior
  - audited insert mode returning inserted rows
  - pending-review creation on mutation failure
- Added focused contact-hub auditing coverage in `test/contacts.test.js` for a classified contact mutation writing both Gov records and ops audit records.
  - extended with a failure-path case proving pending-review creation on audited contact mutation failure
- Added repo policy and guardrails for write surfaces:
  - `WRITE_SURFACE_POLICY.md`
  - `test/raw-write-guardrail.test.js`
- Added rollout handoff summary:
  - `LCC_LOOP_CLOSURE_ROLLOUT_SUMMARY.md`
- Added current-state changeset manifest:
  - `LCC_LOOP_CLOSURE_CHANGESET.md`
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
- Added an internal audited Gov-write layer in `api/contacts.js` and routed key internal contact-hub mutations through it:
  - `unified_contacts` create/update/classify/engagement updates
  - `contact_change_log` inserts
  - `contact_merge_queue` inserts/patches
  - `system_tokens` WebEx token upserts
- Kept Teams/WebEx/SMS external sends as canonical side effects, but now their internal contact/log writes pass through the audited layer.
- Fixed contact-hub manual mutation handling so classify/update/merge/dismiss stop and return an error when an audited Gov write fails, instead of continuing after a failed write.
- Added broader loop-edge verification:
  - `ensureEntityLink()` now has a test for external identity creation failure after entity creation
  - `closeResearchLoop()` now has tests for entity reconciliation failure and research-task patch failure
- Completed a broader repo sweep after the contacts pass:
  - remaining write paths in `api/sync.js` are canonical connector/outbound jobs
  - `api/data-proxy.js` remains the generic proxy layer, not a business-flow save surface
  - remaining `POST`s in `api/contacts.js` are external Teams/WebEx/SMS API calls, not raw internal business-table writes
- Documented approved exemptions and disallowed mutation patterns in `WRITE_SURFACE_POLICY.md`.
- Added a repo guardrail test that flags:
  - raw `govQuery('POST'|'PATCH')`
  - raw `diaQuery(... method: 'POST'|'PATCH')`
  - direct `/api/gov-query` or `/api/dia-query` mutation blocks outside approved exemptions

## Verification Notes

- `node --check` passed for all modified JS files.
- `node --check app.js` passed after the second-pass CRM mutation refactor.
- `node --check api/apply-change.js` passed after adding composite filter support.
- `node --check dialysis.js` passed after routing research outcome writes through the audited path.
- `node --check detail.js` passed after routing detail research outcome inserts through the audited path.
- `node --check gov.js` passed after routing government intel research notes through the audited path.
- `node --check detail.js` passed again after moving ownership/contact/sales/loan inserts onto the audited path.
- `node --check gov.js` passed again after moving sale/loan inserts onto the audited path.
- `node --check test/apply-change.test.js` passed.
- `node --check test/entity-link.test.js` passed after adding entity-link failure coverage.
- `node --check test/research-loop.test.js` passed after adding research-loop abort/failure coverage.
- `node --test test/apply-change.test.js` passed outside the sandbox after the local runner hit `spawn EPERM`.
- `node --check api/contacts.js` passed after the audited contact write refactor.
- `node --check test/contacts.test.js` passed.
- `node --check test/raw-write-guardrail.test.js` passed.
- `node --test test/contacts.test.js` passed outside the sandbox after the local runner hit `spawn EPERM`.
- `node --test test/raw-write-guardrail.test.js` passed outside the sandbox after the local runner hit `spawn EPERM`.
- `node --test test/apply-change.test.js` passed again after adding the pending-review failure-path case.
- `node --test test/contacts.test.js` passed again after adding the audited-write failure-path case and fixing handler error propagation.
- `node --test test/entity-link.test.js` passed outside the sandbox after adding external-identity failure coverage.
- `node --test test/research-loop.test.js` passed outside the sandbox after adding cross-surface research-loop failure coverage.
- `node --test ...` is blocked in the current sandbox with `spawn EPERM`, so the new tests were added but could not be executed here.

## Open Risks

- Legacy domain flows are heterogeneous, so not every direct write can be eliminated in one pass.
- The remaining non-audited `POST` in the scanned domain files is a canonical outbound sync call rather than a raw table mutation.
- A separate write-heavy surface remains in `api/contacts.js`; those calls appear to be contact engagement/messaging and token-management paths rather than the gov/dialysis/detail human-loop saves already remediated.
- `api/contacts.js` now has audited coverage for its main internal Gov writes, but broader repo-wide review is still needed for any other APIs that mutate domain/business tables outside the mutation-service or audited-helper model.
- The primary remaining repo-wide review item is explicit policy/cleanup around exempt write surfaces: connector sync, external messaging APIs, token refresh, and the generic data proxy.
- Repo-wide write policy is now explicit; the remaining work is broader end-to-end verification rather than major write-path refactoring.
- Remaining verification work is now concentrated on broader cross-surface scenarios rather than single-handler mutation plumbing.
- The core helper layer now has both happy-path and failure-path coverage for entity reconciliation, research closure, audited mutations, and audited contact writes.
- A deployment-oriented rollout summary now exists so implementation, validation, exemptions, and residual risk are captured outside the running worklog.
- A current-state changeset manifest now exists so the remaining loop-closure files can be separated cleanly from unrelated local edits.
- Existing tests are sparse and test execution is sandbox-limited in this environment.
