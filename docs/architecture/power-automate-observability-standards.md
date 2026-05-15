# Power Automate Observability & Reliability Standards

Last updated: 2026-05-14
Owner: LCC Control Plane / architecture-audit track
Scope: every Power Automate cloud flow that integrates Outlook, Teams, Microsoft To Do, OneDrive, Salesforce, or LCC / Supabase endpoints in the `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` environment.

## Why this document exists

Across the 2026-05-13/14 remediation work, the same handful of defects kept recurring flow-to-flow: no retry policy on outbound HTTP, no correlation identifier in payloads, no dead-letter path when a downstream call fails, unvalidated request bodies, and logical failures (a 200 response whose body says `ok:false`) that the run treats as success. This document fixes the moving target: it defines the **minimum observability and reliability bar** every flow is held to, and it carries the **compliance matrix** that records where each flow currently stands. "Locking observability standards" means: the standard is written down, every flow is scored against it, and no flow is considered "done" until it is GREEN or has a dated, owned exception.

## The Standard — the seven controls

Every flow must satisfy the controls that apply to its shape. A control is "N/A" only when the flow genuinely has no action of that kind (e.g. a flow with no outbound HTTP call has no retry-policy obligation).

1. **Correlation identifier.** Every flow generates a `correlation_id` (`guid()`) at the top of the run and includes it in (a) every outbound payload it POSTs and (b) any audit/Compose record it writes. Scheduled flows that fan out per-item should also carry a stable per-item key. The goal: one identifier that ties a Power Automate run to the downstream endpoint log to the final stored row.

2. **Schema version + request validation.** HTTP-triggered flows declare a Request Body JSON Schema on the trigger with a `required` array covering the fields the flow cannot function without, and the contract carries a `schema_version` string. Payloads that do not match are rejected by the platform with a 400 before any action runs. Scheduled flows that emit payloads include `schema_version` in what they send.

3. **Retry policy on every outbound call.** Every HTTP action and every connector action that crosses a network boundary (Salesforce, Supabase, Graph) has an explicit retry policy — `Exponential interval`, count 4, interval `PT10S` is the house default — rather than the opaque platform `Default`. Explicit beats implicit: the policy is then visible and tunable.

4. **Dead-letter / fault branch.** Any action whose failure means real work was lost has a `Configure run after → has failed / has timed out` branch that records the failure somewhere durable and observable (a dead-letter row, an alert, or at minimum a structured Compose) rather than letting the run fail silently. Terminal HTTP actions whose failure already surfaces as a Failed run are a partial exception, but a dead-letter sink is still preferred for outage alerting.

5. **Logical-failure detection.** A 200/OK response is not the same as success. Flows that call an endpoint which can return a soft-failure body (`ok:false`, `skipped:...`, an empty result set) must inspect the body with a `Condition` and branch accordingly — never assume HTTP 200 means the work happened. This is the defect that auto-disabled `HTTP Init LLC` for 14 days.

6. **Null-safe accessors.** Any expression that walks into a connector response (`body('X')?['value']`, `first(...)`, `length(...)`) must be null-safe — wrap arrays in `coalesce(..., json('[]'))` before `length()`, and confirm the accessor key actually matches the connector's response contract. The PA Salesforce `Get records` action returns rows under `?['value']`, not `?['records']`; the `Complete SF Task` flow was non-functional for exactly this reason.

7. **Input escaping on injected values.** Any user- or caller-supplied value interpolated into a SOQL string, an OData `Filter Query`, or a constructed JSON body is escaped first. SOQL escapes `'`→`\'`; OData escapes `'`→`''`. Never interpolate a raw caller value into a query literal.

## Severity scoring

Each flow is scored GREEN / YELLOW / RED against the controls that apply to it.

- **GREEN** — every applicable control is satisfied (or has a dated, owned exception).
- **YELLOW** — the flow is functional and not actively failing, but one or more applicable controls are missing. Hardening recommended, not urgent.
- **RED** — a missing control is causing, or could imminently cause, data loss, a security exposure, or silent failure.

## Compliance Matrix (2026-05-14)

| Flow | Shape | Correlation | Schema/validation | Retry policy | Dead-letter | Logical-failure | Null-safe | Injection escaping | Score |
|---|---|---|---|---|---|---|---|---|---|
| HTTP Init LLC | HTTP orchestration | ☐ | ☐ | partial | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ✅ (soft-skip Condition, Task #2) | ✅ | N/A | YELLOW |
| To Do - LCC Sync | Scheduled aggregation | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ✅ (accessor drift fixed, Task #3) | N/A | YELLOW |
| LCC Flagged Email Intake | Email-triggered | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W2; also Terminate-Succeeded guard, Task #4) | partial | ☐ | N/A | YELLOW |
| Flagged Email to To Do (canonical) | Email-triggered | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| HTTP-Switch | HTTP → Salesforce lookup | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | ✅ (SOQL escape, Task #6A) | YELLOW |
| Complete SF Task | HTTP → Salesforce read/update | ☐ | partial (trigger schema, no required) | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ✅ (null-safe Condition, Task #12) | ✅ (`['value']` fix, Task #12) | ✅ (OData escape, Task #6B.1) | YELLOW |
| GovLease Lead Sync | HTTP → Salesforce upsert | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ✅ (null-safe Condition) | ✅ (coalesce) | ✅ (OData escape, Task #6B.2) | YELLOW |
| Log Activity to SF from LCC | HTTP → Salesforce write | ✅ (AuditLog Compose, Task #13) | ✅ (schema + `required`, Task #13) | ✅ (PostDeadLetter Fixed 2×PT5S) | ✅ (PostDeadLetter + Terminate, Gap #2) | N/A | N/A | N/A | YELLOW (request-auth gap only) |
| LCC - Personal Calendar Sync | Scheduled → Supabase | ✅ (`correlation_id` in payload, Task #10) | ✅ (`schema_version` in payload) | ✅ (Exponential 4×PT10S) | ☐ | N/A | ✅ | N/A | GREEN* |
| Outlook Calendar - LCC Sync | Scheduled → Supabase | ✅ (`correlation_id` in payload, Task #11) | ✅ (`schema_version` in payload) | ✅ (Exponential 4×PT10S) | ☐ | N/A | ✅ | N/A | GREEN* |
| LCCSFFlow1 (queue worker) | 1-min recurrence | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W2) | ☐ | ☐ | ☐ | YELLOW |
| LCC Outlook Intake | Email-triggered | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W2) | ☐ | ☐ | N/A | YELLOW |
| LoopNet Power Automate | Email-triggered | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| RCM Power Automate | Email-triggered | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| LCC Morning Briefing | Scheduled | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| LCC Daily Briefing | Scheduled | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| HTTP-ParseJSON | HTTP → LCC lookup | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| Manual ForEach Post | HTTP → Teams | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| HTTP-Postmessagechat | HTTP → Teams | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| HTTP-Postmessagechat2 | HTTP → Teams | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| Flagged Personal Email to To Do | Email-triggered | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| Button → Send an HTTP request | Manual button | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| Sync SF Tasks to Supabase | Scheduled → Supabase | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W2) | ☐ | ☐ | N/A | YELLOW |
| Sync SF Activities to Supabase | Scheduled → Supabase | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W2) | ☐ | ☐ | N/A | YELLOW |
| Sync Flagged Emails to Supabase (Graph Pull) | Scheduled → Supabase | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| Sync Flagged Emails to Supabase (Supabase Push) | Scheduled → Supabase | ☐ | ☐ | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | RED (P0: plaintext apikey in export) |
| Unflag Completed Email Tasks | Scheduled / sync | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| Recovery - Reflag Completed Emails | Scheduled / sync | ☐ | N/A | ☐ | ✅ (PostDeadLetter + Terminate, Gap #2 W4) | ☐ | ☐ | N/A | YELLOW |
| Flagged Email to To Do Task | Email-triggered | — | — | — | — | — | — | — | OFF (deprecated, Task #5) |

`GREEN*` — the two calendar flows meet every applicable control except an explicit dead-letter branch; that was deliberately deferred (a failed terminal POST already surfaces as a Failed run) and is the only item between them and unqualified GREEN.

## Reading the matrix

No flow is GREEN today; the two calendar sync flows are the closest. That is expected — the standard is new and the 2026-05-13/14 work fixed *defects* (injection, null-handling, broken actions) rather than retro-fitting *observability* across the whole portfolio. The matrix is the backlog: each ☐ in a non-N/A cell is a unit of hardening work.

**Dead-letter column — complete (2026-05-14).** As of the Gap #2 Wave 4 rollout, the Dead-letter control is ✅ for every active flow in the portfolio. The only ☐ remaining in that column are the two calendar sync flows (`LCC - Personal Calendar Sync`, `Outlook Calendar - LCC Sync`), a deliberate exception: they were hardened separately in the 2026-05-13 campaign, already carry `correlation_id` + `schema_version` + an Exponential retry policy, and a failed terminal POST on them surfaces as a Failed run; folding them into the generic `PostDeadLetter` pattern is deferred, not missed. The remaining ☐ in the *other* columns (correlation, schema, retry on primary actions, logical-failure, null-safe) are the observability-standard Waves 3-4 backlog and are unaffected by Gap #2.

The single RED is `Sync Flagged Emails to Supabase (Supabase Push Variant)` — its exported definition carries a plaintext apikey. That is the P0 and is tracked separately under the key-rotation task; it is RED until the key is rotated and the secret moved to a secure reference.

## Rollout sequence (recommended)

The standard is "locked" in the sense that it is now the definition of done. Retro-fitting the whole portfolio is a sequenced campaign, not a single sitting:

1. **Wave 1 — close the RED.** Rotate the exposed Supabase key, move it to a secure reference, re-export and confirm redaction. This is the P0.
2. **Wave 2 — the high-traffic and mutation flows.** The two flagged-email intake paths, the queue worker (`LCCSFFlow1`, 1-minute recurrence), and the three Salesforce sync flows. These run constantly and/or write to systems of record; correlation + retry + dead-letter there has the highest payoff.
3. **Wave 3 — the request-auth gap on `Log Activity to SF from LCC`.** Add the `X-LCC-Key` header Condition once the secret is available via a Power Platform environment variable.
4. **Wave 4 — the long tail.** Briefing flows, Teams-post flows, the email-to-ToDo flows, and the recovery/unflag pair. Lower traffic, lower blast radius; bring them to GREEN as capacity allows.

## House conventions (so every future flow starts GREEN)

- New HTTP-triggered flow: first action after the trigger is an `AuditLog` Compose building `{correlation_id: guid(), source, schema_version, received_payload}`; the trigger has a Request Body JSON Schema with a `required` array.
- New outbound HTTP/connector call: set the retry policy to Exponential 4×PT10S at creation, not "Default".
- New call to an endpoint that can soft-fail: add the `Condition` on the response body in the same sitting you add the call.
- Any caller value going into a query: escape it in a dedicated `Compose` named `Escape<Field>` first.
- Editor mechanics that bite (recorded so the next person does not rediscover them): the new-designer "Update" button on an existing expression chip silently fails to commit — delete the chip and use the fresh "Add" instead; the trigger schema textarea commits on in-panel blur but reverts on tab-switch; the per-action Code view is read-only; for JSON-body fields, select-all and paste the whole corrected body (PA converts `@{...}` tokens to chips on paste) rather than editing chips in place.

## Change log

- 2026-05-14 — Document created. Standard defined (seven controls), all 29 flows scored, rollout sequence set. This is the "locked" baseline; subsequent hardening updates the matrix in place.
