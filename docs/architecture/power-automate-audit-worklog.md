# Power Automate Audit Worklog

Last updated: 2026-05-14 (session 2)
Project: Microsoft + Salesforce + LCC integration audit/remediation

## Instructions and Objectives
1. Maintain durable audit docs for all flow exports.
2. Map architecture gaps and prioritize by security, reliability, and business impact.
3. Repair broken/disabled flows first, then harden for bidirectional propagation.
4. Implement self-improving operational loop via metrics + recurring remediation prompts.

## Current Design Direction
1. Keep Power Automate as integration runtime due to Graph/app-registration constraints.
2. Use LCC/Supabase as canonical control and observability plane.
3. Add strict schemas, idempotency, dead-letter, and correlation tracing everywhere.
4. Treat Salesforce writes as governed mutations with audit and rollback controls.

## What Changed This Session
1. Parsed failure alert email and documented six failing flows with counts.
2. Parsed disabled-flow alert email and documented disabled `http-initLLC` incident details.
3. Updated master registry with incident snapshot and remediation waves.
4. Added dedicated remediation architecture plan document.
5. Added detailed docs for two failing flagged-email-to-ToDo flows.
6. Parsed all 29 provided ZIP exports and completed missing per-flow documentation coverage.
7. Added one-by-one execution order for repair/hardening work in the master registry.

## What Is Working
1. Core documentation framework exists and is extensible.
2. Failure sources are now concrete (flow IDs + counts + disabled flow ID).
3. Remediation sequencing is defined and tied to business impact.

## What Is Not Working / Gaps
1. Multiple export rounds still need complete per-flow detail docs restored or verified.
2. High-volume flow failures remain unresolved operationally.
3. Secret hygiene remains a P0 risk until credential rotation is complete and verified.

## Next Execution Steps
1. Execute Step 1: recover disabled `HTTP Init LLC` in non-prod and validate full upload/stage path.
2. Execute Step 2: repair `To Do - Life Command Center Sync` failure pattern (95 failures).
3. Execute Step 3: repair `LCC Flagged Email Intake` and align with To Do sync contracts.


## Session 2026-05-13/14 — Task #6 Part B + Task #7 (calendar)
1. Task #6 Part B complete — hardened 3 SF mutation flows:
   - Complete SF Task: OData injection closed (EscapeSubject Compose); Condition made null-safe + corrected always-null `['records']` key to `['value']`.
   - GovLease Lead Sync: OData injection closed (EscapeAgency Compose); Condition made null-safe.
   - Log Activity to SF from LCC: trigger Request Body JSON Schema added — fixed "Invalid parameters" broken-action state + established documented contract.
2. Task #7 complete — both calendar sync flows assessed (healthy, 0 failures/28d) then hardened per user direction:
   - retry policy set to explicit Exponential (count 4, PT10S) on the Supabase POST in each.
   - payload enriched with `correlation_id` + `schema_version`.
3. Process learning captured: PA new-designer "Update" button on existing expression chips silently fails to commit — only fresh "Add" commits; plain textareas discard pasted content on tab-switch — use native generators. For complex multi-action builds, prefer export-edit-reimport.

## Residual / Deferred Items (documented in FLOW_CHANGES_LOG.md)
1. Complete SF Task — audit Switch-case branches for the same `['records']` vs `['value']` key bug.
2. Log Activity to SF from LCC — strict `required` schema enforcement, `X-LCC-Key` request-auth Condition, audit/correlation Compose.
3. Calendar flows — confirm `/sync/calendar-events` edge function tolerates new keys + is idempotent on event-id; optional dead-letter fault branch.
4. P0 — exposed Supabase key rotation (Task #8) — must be performed by Scott directly in Vercel/Supabase.
5. Task #9 — lock observability standards across all flows.


## Session 2026-05-14 (cont.) — deferred items closed + standards locked + gap analysis
1. **Complete SF Task — Switch-case audit (Task #12).** Found the `?['records']` key bug was systemic — all 7 references across the Condition + 5 Switch-branch actions used the always-null key. Fixed every one to `?['value']`. The flow's entire complete/reschedule success path was non-functional before this; now fully repaired. No residual items.
2. **Log Activity to SF — governance hardening (Task #13).** Added a `required` array to the trigger schema (strict payload validation) and an `AuditLog` Compose emitting `{correlation_id, source, schema_version, received_payload}` before the SF write. Residual: `X-LCC-Key` request-auth Condition — blocked on needing the secret value; recommend a Power Platform environment variable.
3. **calendar-events edge function verified (Task #14).** Read `handleSyncCalendarEvents` source via Supabase MCP — confirmed idempotent upsert on event-id and that the new `correlation_id`/`schema_version` payload keys are tolerated. Task #7 calendar hardening confirmed safe against the live endpoint.
4. **Observability standard locked (Task #9).** Created `power-automate-observability-standards.md` — seven-control reliability bar, all 29 flows scored GREEN/YELLOW/RED in a compliance matrix, four-wave rollout sequence, house conventions so new flows start GREEN. No flow is GREEN yet; the two calendar flows are closest; one RED (the plaintext-apikey push variant).
5. **Pipeline gap analysis (Task #15).** Created `lcc-microsoft-salesforce-pipeline-gap-analysis.md` — mapped the current LCC ↔ MS/SF pipeline, named seven structural gaps (poll-only SF inbound, partial object coverage, no central dead-letter plane, one-way To Do/Calendar, no Teams inbound, no non-prod env, open secret-management P0), and set a prioritized build backlog.
6. Updated the master audit registry: companion-docs section added, status rows refreshed for Complete SF Task / Log Activity to SF / both calendar flows, Initial Gap Matrix annotated with current status.

## Open Items After This Session
1. **P0 — exposed Supabase/credential key rotation.** Must be performed by Scott directly in Vercel/Supabase/Power Platform. The single RED flow + the standing P0.
2. `X-LCC-Key` request-auth Condition on Log Activity to SF — needs the secret via a PA environment variable.
3. Observability retro-fit Waves 2-4 — correlation IDs / retry / dead-letter across the high-traffic and long-tail flows.
4. Architecture backlog (see gap analysis): central dead-letter/`flow_health` plane, Salesforce event-driven inbound, Account/Contact/Opportunity sync coverage, non-prod environment, flow contract-tests.
