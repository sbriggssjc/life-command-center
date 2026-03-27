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
- Upgraded the Data Quality surface from read-only reporting to an operator workbench:
  - duplicate candidates can trigger merge or alias actions
  - unlinked entities can trigger manual identity linking
  - stale identities can drive precedence overrides or follow-up creation
  - source precedence rows are now visible/editable from the UI
  - `api/entities.js` now exposes `set_precedence` and returns `source_precedence` in quality details
- Closed a major outbound propagation visibility gap:
  - `api/sync.js` `complete_sf_task` now creates outbound sync jobs when a Salesforce connector is available
  - success/failure now returns `sync_job_id` and `correlation_id`
  - failed Salesforce task completion/reschedule now logs `sync_errors` and degrades connector status for Sync Health visibility
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
- `node --check api/entities.js` passed after Data Quality operator actions were added.
- `node --check api/sync.js` passed after outbound task completion was aligned with sync job/error tracking.
- `node --check api/_shared/ops-db.js` passed after adding the shared perf-metric logger.
- `node --check api/apply-change.js` passed after wiring mutation latency logging.
- `node --check api/sync.js` passed again after wiring propagation latency logging and Sync Health drift/success-rate signals.
- `node --check app.js` passed after adding grouped Government/Dialysis business navigation.
- `node --check api/entities.js` passed after adding paginated entity list responses.
- `node --check gov.js` passed after aligning programmatic gov tab navigation with grouped tabs.
- `node --check dialysis.js` passed after aligning programmatic dialysis tab navigation with grouped tabs.
- `node --check ops.js` passed after moving entity/research ops pages to paginated fetches and shared active-page refresh.
- `node --check ops.js` passed again after surfacing outbound success and queue-drift signals in Sync Health and Metrics.
- `node --check test/queue.test.js` passed after adding inbox transition and promotion contract coverage.
- `node --check test/sync.test.js` passed after adding response-level Sync Health and outbound-failure coverage.
- `node --check test/contacts.test.js` passed.
- `node --check test/raw-write-guardrail.test.js` passed.
- `node --check ops.js` passed after Data Quality operator actions were added.
- `node --test test/contacts.test.js` passed outside the sandbox after the local runner hit `spawn EPERM`.
- `node --test test/raw-write-guardrail.test.js` passed outside the sandbox after the local runner hit `spawn EPERM`.
- `node --test test/apply-change.test.js` passed again after adding the pending-review failure-path case.
- `node --test test/apply-change.test.js` passed in the current validation sweep.
- `node --test test/contacts.test.js` passed again after adding the audited-write failure-path case and fixing handler error propagation.
- `node --test test/contacts.test.js` passed in the current validation sweep.
- `node --test test/entity-link.test.js` passed outside the sandbox after adding external-identity failure coverage.
- `node --test test/entity-link.test.js` passed in the current validation sweep.
- `node --test test/queue.test.js` passed outside the sandbox after adding inbox triage and promote-to-action verification.
- `node --test test/queue.test.js` passed in the current validation sweep.
- `node --test test/research-loop.test.js` passed outside the sandbox after adding cross-surface research-loop failure coverage.
- `node --test test/research-loop.test.js` passed in the current validation sweep.
- `node --test test/sync.test.js` passed outside the sandbox after adding Sync Health and complete-SF-task failure-path verification.
- `node --test test/sync.test.js` passed in the current validation sweep.
- `node --test test/raw-write-guardrail.test.js` passed in the current validation sweep.
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
- Data Quality is no longer just passive reporting; it now supports direct reconciliation actions and source-precedence management from the operator surface.
- Outbound Salesforce task completion/reschedule is now better integrated with Sync Health and unresolved sync exceptions.
- Mutation latency is now logged through the shared ops perf-metric path, and outbound propagation now records latency plus 24h success-rate and basic Salesforce queue-drift signals in Sync Health.
- The verification layer now includes response-level Sync API coverage in addition to helper-level unit tests, so health summaries and outbound failure surfacing are no longer untested.
- The queue/inbox transition contract now has direct handler-level coverage for triage and promote flows, reducing the risk that UI wiring drifts away from supported inbox state transitions.
- Government and Dialysis now expose grouped workflow navigation above the existing tab strips, which reduces top-of-screen tab density without rewriting the underlying renderers.
- The remaining heavy ops pages now use paginated entity/research fetches, and post-mutation refreshes are routed through a shared active-page refresh helper instead of scattered manual rerenders.
- Sync Health and Metrics now surface the new backend operational signals directly in the UI, including outbound success rate, unresolved sync error count, and Salesforce queue-drift indicators.
- The focused verification matrix is now green end-to-end for the core helper, audited mutation, contacts, sync, queue/inbox, and raw-write guardrail suites.
- A reusable deployment signoff checklist now exists in `LCC_DEPLOYMENT_SIGNOFF_TEMPLATE.md` so rollout validation can be run consistently by an operator.
- A deployment-oriented rollout summary now exists so implementation, validation, exemptions, and residual risk are captured outside the running worklog.
- A current-state changeset manifest now exists so the remaining loop-closure files can be separated cleanly from unrelated local edits.
- Existing tests are sparse and test execution is sandbox-limited in this environment.

## 2026-03-25 Government Evidence Runtime Port

Implemented in this pass:
- Added `/api/gov-evidence` rewrite in `vercel.json` and gov evidence proxy routing in `api/data-proxy.js`.
- Added a live government evidence workbench to `gov.js` inside the actual LCC research tab.
- The LCC gov research UI can now:
  - select a screenshot
  - call GovernmentProject screenshot extraction through `/api/gov-evidence?endpoint=extract-screenshot-json`
  - save a research artifact
  - run low-risk safe apply actions
  - promote observation rows
  - review, dismiss, note, and promote pending observation queue rows
- Confirmed `node --check gov.js` and `node --check api/data-proxy.js` both pass after the port.

Current behavior:
- The evidence workflow is now available in the live LCC government research UI rather than only in the standalone GovernmentProject dashboard.
- This port depends on the GovernmentProject FastAPI app exposing the screenshot and research-artifact endpoints and being reachable through `GOV_API_URL`.

Remaining gap:
- Browser/runtime smoke testing is still required with an authenticated LCC session and a real CoStar screenshot.

## 2026-03-26 Government Evidence Rollout Verification

Implemented in this pass:
- Added a GovernmentProject `GET /api/evidence-health` endpoint for the evidence workflow.
- Added `evidence-health` support to the LCC gov evidence proxy in `api/data-proxy.js`.
- Added a `Check Evidence Health` control to the live gov evidence workbench in `gov.js`.
- Extended `LCC_DEPLOYMENT_SIGNOFF_TEMPLATE.md` with a dedicated Government Evidence rollout section.
- Re-ran `node --check gov.js` and `node --check api/data-proxy.js` successfully after these changes.

Current behavior:
- Operators can now validate the core evidence rollout prerequisites directly from the live LCC government research tab before processing a screenshot.
- Formal deployment signoff now includes explicit checks for extraction, artifact persistence, safe apply, row promotion, and observation review.

Remaining gap:
- Full authenticated browser smoke testing against a real `GOV_API_URL` target and screenshot is still required.

## 2026-03-26 Government Evidence Conflict Review

Implemented in this pass:
- Added conflict detection to the live gov evidence workbench in `gov.js`.
- The panel now compares screenshot evidence against current research values for owner, lender, RBA, and year built.
- Added in-panel `Keep Current` / `Use Evidence` actions for each detected conflict.
- `Apply Safe Evidence` is disabled until all detected conflicts are resolved.
- Choosing `Keep Current` rewrites the working evidence payload so later artifact save / safe apply respects the operator decision.
- Re-ran `node --check gov.js` successfully after the conflict-review changes.

Current behavior:
- The live LCC government research tab no longer silently safe-applies key fields when the screenshot extraction disagrees with current research values.
- Conflict decisions append `[SAFE EVIDENCE CONFLICT]` note lines for auditability.

Remaining gap:
- This is currently screenshot-vs-current-value conflict review only.
- Multi-source conflict resolution should be added later when document evidence is ported into the same live panel.

## 2026-03-26 Single Upload Government Evidence Intake

Implemented in this pass:
- Removed the practical need for a second upload box in the live gov evidence flow.
- The gov evidence panel now reuses the latest image from the shared `Live Intake` attachment queue in `gov.js`.
- The panel now labels that source explicitly and extracts from the latest shared intake image with `source: 'auto'`.
- GovernmentProject now accepts `auto` screenshot source handling for the screenshot extraction endpoints.
- Re-ran `node --check gov.js` successfully after the single-upload refactor.

Current behavior:
- Operators upload once in the shared Live Intake area.
- The gov evidence panel then uses that same uploaded image for extraction, artifact save, conflict review, safe apply, and row promotion.
- There is no longer a separate CoStar-specific upload path exposed in the live LCC gov research UI.

Remaining gap:
- `auto` currently normalizes to the CoStar screenshot path rather than classifying among multiple screenshot platforms.

## 2026-03-26 Automatic Screenshot Source Detection

Implemented in this pass:
- GovernmentProject now performs backend screenshot source detection for `source=auto`.
- The screenshot extraction path now distinguishes detected CoStar screenshots from generic market screenshots.
- The live gov evidence panel in `gov.js` now displays the detected source returned by the backend after extraction.
- Re-ran `node --check gov.js` successfully after wiring the detected-source state back into the single-upload flow.

Current behavior:
- Operators still upload once in the shared Live Intake area.
- The live gov evidence panel now shows what source the backend recognized instead of silently assuming CoStar.
- CoStar screenshots continue down the richer CoStar extraction prompt; other screenshots fall back to the generic market screenshot extractor.

Remaining gap:
- LoopNet and other platforms still use the generic fallback extractor rather than a platform-specific schema.

## 2026-03-26 LoopNet Screenshot Extraction Routing

Implemented in this pass:
- GovernmentProject now has a dedicated `loopnet_screenshot` extraction prompt.
- Automatic screenshot source routing now dispatches detected `loopnet` screenshots to that specialized prompt instead of the generic market screenshot fallback.

Current behavior:
- The live LCC single-upload gov evidence flow still looks the same in the UI.
- When the backend detects a LoopNet screenshot, extraction quality should improve because it now uses a LoopNet-specific schema rather than the generic market prompt.

Remaining gap:
- This path still needs tuning against real LoopNet screenshots and any later LoopNet-specific normalization rules.
## 2026-03-26 LoopNet Broker Contact Promotion

Implemented in this pass:
- Added the live gov evidence panel `Apply Broker` action in `gov.js`.
- Added the LCC proxy route for `apply-broker-contact` in `api/data-proxy.js`.

Current behavior:
- Reviewed evidence artifacts that carry listing broker metadata can now push that broker information into the GovernmentProject broker/contact flow from the live LCC runtime.

Remaining gap:
- This still needs validation against a real LoopNet screenshot with visible broker contact details.

## 2026-03-26 Broker Observation Queue Compatibility

Implemented in this pass:
- Hardened the live gov evidence queue loader in `gov.js` to accept either `observations` or `items` from the backend.
- Updated the LCC queue note text so row promotion is source-agnostic.

Current behavior:
- The live LCC evidence queue no longer depends on a single backend response key during rollout.
- Broker observations can now appear in the same pending review queue as tenant and lease-activity rows once the backend promotes them.

Remaining gap:
- The live runtime still needs a browser smoke test with a real screenshot to confirm broker rows render and promote correctly.
## 2026-03-27 Broker Review Cues

Implemented in this pass:
- The live gov evidence queue in `gov.js` now renders backend-provided `review_cues` beneath pending observation rows.

Current behavior:
- Broker rows can now show hints like likely existing-contact matches or whether the lead already has a matched contact before promotion.

Remaining gap:
- This still needs live validation against a real broker screenshot to tune the usefulness of the cues.
## 2026-03-27 Broker Promotion Guard

Implemented in this pass:
- The live gov evidence queue now shows a broker promotion warning when the backend flags a likely lead-contact conflict.
- The `Promote` button now becomes a confirm step for those guarded broker rows.

Current behavior:
- Clean broker rows still promote normally.
- Broker rows that appear to conflict with the lead's current matched contact now require explicit confirmation before promotion.

Remaining gap:
- This still needs a live screenshot test against a lead that already has a different matched contact.
## 2026-03-27 Structured Current Contact Display

Implemented in this pass:
- The live gov evidence queue now renders the broker guard's current matched contact as a distinct secondary line beneath the warning.

Current behavior:
- Guarded broker rows now show both the warning sentence and a dedicated `Current matched contact:` line when that metadata is available.

Remaining gap:
- This still needs a live screenshot test to confirm the extra line improves operator decisions without cluttering the queue card.
## 2026-03-27 Structured Broker Comparison

Implemented in this pass:
- The live gov evidence queue now renders an `Evidence broker:` line beneath the existing `Current matched contact:` line for guarded broker rows.

Current behavior:
- Guarded broker rows can now show the current matched contact and the candidate evidence broker together before confirmation.

Remaining gap:
- This still needs a live screenshot test to confirm the side-by-side broker comparison is clear and not too noisy.
## 2026-03-27 Broker Dismiss Reason Buttons

Implemented in this pass:
- The live gov evidence queue now renders quick broker dismiss buttons for common reasons.
- Those buttons reuse the existing observation review endpoint by sending the selected reason through `resolution_note`.

Current behavior:
- Broker rows can now be dismissed quickly as `same as current contact`, `bad OCR`, or `not relevant` without ad hoc typing.

Remaining gap:
- This still needs live runtime validation to confirm the suggested reasons cover most broker-dismiss decisions.
