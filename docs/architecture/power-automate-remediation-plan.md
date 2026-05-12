# Power Automate Remediation Plan (Microsoft + Salesforce + LCC)

Last updated: 2026-05-12
Owner: LCC Platform + Flow Owners

## Objective
Restore reliability and create a cohesive, bidirectional, self-improving integration engine across Power Automate, Microsoft 365, Salesforce, and Supabase-backed LCC workflows.

## Scope
- Runtime: Power Automate (primary integration layer)
- Systems: Outlook, To Do, Teams, Calendar, Salesforce, LCC APIs, Supabase tables
- Incident inputs:
  - `6 of your flow(s) have failed.eml` (2026-05-06)
  - `Alert! We've disabled one of your flows.eml` (2026-05-08)

## Target Architecture
1. Power Automate remains orchestration runtime.
2. LCC/Supabase becomes canonical integration ledger:
   - `integration_events`
   - `integration_jobs`
   - `integration_dead_letter`
   - `integration_metrics_daily`
3. Every flow call carries:
   - `correlation_id`
   - `source_flow_id`
   - `schema_version`
   - `attempt_number`
4. Salesforce writes are gated:
   - allowlisted operations only
   - strict payload schema validation
   - reversible write audit record per mutation
5. Microsoft-origin actions (flagged email, To Do, calendar) use idempotency keys:
   - `idempotency_key = source_system + source_object_id + action_type`

## Remediation Backlog by Wave
## Wave 0 (P0, immediate)
1. Rotate exposed secrets and service-role credentials.
2. Recover `http-initLLC` disabled flow (`ab11601a-b7d7-4efa-8f3a-52873e873270`) in non-prod clone first.
3. Stabilize top-failure flows:
   - `To Do - Life Command Center Sync`
   - `LCC Flagged Email Intake`
4. Add explicit terminal failure branches to all HTTP calls (no silent fail/open paths).

## Wave 1 (P1, short-term hardening)
1. Merge duplicate flagged-email-to-ToDo automations to one canonical path + one recovery path.
2. Add strict contract enforcement on:
   - `HTTP-Switch`
   - `CompleteSFTask`
   - `GovLeaseLeadSync`
3. Add dead-letter writes into Supabase for all failed mutation intents.

## Wave 2 (P1/P2, bidirectional propagation)
1. Implement event-driven sync contracts:
   - Outlook flagged state <-> To Do completion state
   - Salesforce activity/task state <-> Supabase operational queue state
   - Calendar event state <-> LCC scheduling context
2. Standardize conflict policy:
   - source precedence
   - stale-write rejection
   - deterministic retry windows

## Wave 3 (continuous self-improvement loop)
1. Daily job computes:
   - failure rate by flow
   - median run latency
   - duplicate-event rate
   - business-impact tags (lead response delay, missed follow-up risk)
2. LCC daily briefing includes auto-ranked optimization actions.
3. Weekly review promotes top changes into flow backlog with owner + deadline.

## Required Acceptance Criteria
1. No P0 secret leakage in any exported flow definition.
2. Zero disabled production flows for 14 consecutive days.
3. Top 6 currently failing flows each:
   - >= 99% successful run rate over trailing 7 days
   - explicit failure branch with notification + dead-letter write
4. All Salesforce mutation flows produce auditable before/after payload traces.

## Rollback Standards
1. Keep last-known-good export per flow with checksum in docs.
2. For each promoted change, record:
   - non-prod test run IDs (success + failure path)
   - prod validation run IDs
   - exact rollback steps and owner
