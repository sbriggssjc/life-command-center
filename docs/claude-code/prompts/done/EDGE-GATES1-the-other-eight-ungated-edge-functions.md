# EDGE-GATES1 — the other Dialysis_DB edge functions that run `verify_jwt:false` with no reviewed gate: measure each, gate the writers log-only, the COPILOT-OPEN way

**Filed:** 2026-09-17 (Cowork), from PARKING-LOT PL-1. **Owner:** LCC (`supabase/functions/**`,
`docs/architecture/edge-function-deploy-drift.md`, `docs/architecture/flows/ai-copilot-sync-callers.md`).
**Read first:** `prompts/done/COPILOT-OPEN-gate.md` + response and `prompts/done/SFENRICH-gate.md` (the
pattern: `authenticateWebhook()` from `_shared/auth.ts`, `_shared/caller-class.ts`, a `<FN>_AUTH_MODE`
env defaulting to `log`, a `DENY-WOULD` line with UA/IP class, no behaviour change until `enforce`).

## What is true (Supabase MCP, 2026-09-17)

Dialysis_DB (`zqzrriwuavgrquhisnoa`) runs **22 edge functions; 20 have `verify_jwt:false`**. Two are
gated log-only (`ai-copilot` v84, `salesforce-enrichment` v27). `health-check` and `npi-lookup` are
read-only probes. The rest are unreviewed: `context-broker` (v19), `template-service` (v18),
`intake-receiver` (v19), `lead-ingest` (v27 — reports `webhook_secret_configured`, so it may already
check the header), `intake-salesforce` (v33 — the COPILOT-OPEN response says it is behind the door),
`intake-salesforce-files` (v29), `sf-promotion-worker` (v20), `npi-registry-sync` (v17),
`calendar-ics-sync` (v20), `calendar-caldav-sync` (v25), `calendar-caldav-push` (v23),
`calendar-capture` (v14), `w41-corpus-export` (v8), `w43-sf-link-export` (v9), `w44-retrain-tick` (v7),
`data-query` (v43), `copilot-chat` (v20, `verify_jwt:true`), `daily-briefing` (v21, `verify_jwt:true`).

## What to build

1. **Measure, one table, from the deployed bodies** (fetch each with the Supabase MCP, not the repo —
   `edge-function-deploy-drift.md` says why): does the function **write** (any client with the
   service-role key that inserts/updates/deletes), does it already check `X-PA-Webhook-Secret` or any
   credential, what are its routes, and who calls it in the last 24 h of `function_logs` (UA class,
   IP class, count). Also: does the repo source match the deployed body (sha) — drift is a finding.
2. **Gate every writer that has no credential check**, log-only, with the shared helper — one
   `<FN>_AUTH_MODE` per function, defaulting to `log`; `DENY-WOULD` lines carry route + UA class + IP
   class. Readers that leak PII (calendar bodies, flagged-email bodies) count as writers for this
   purpose. Do not gate `/health` routes.
3. **Deploy** the gated builds (log mode) from the session if the tooling allows and say so per
   function with the new version number; otherwise list the exact `supabase functions deploy`
   commands for Scott (checklist D-row).
4. **Caller inventory** per gated function after 24 h in a follow-up doc alongside
   `ai-copilot-sync-callers.md`, with the header edit each caller needs.
5. Tests: source-shape assertions that every writer function imports the gate and runs it before
   dispatch; a fixture request without the header logs `DENY-WOULD` and is allowed in `log` mode,
   refused in `enforce`.

## Prohibitions

- ⛔ No `enforce` anywhere in this round. ⛔ No behaviour change on the allowed path. ⛔ Do not edit
  `ai-copilot` / `salesforce-enrichment` (their flips are Q1/Q2).

## Reporting

The measurement table; which functions were gated and their deployed versions; drift found; the
caller-inventory doc. **Parked:** anything noticed out of scope, one line each. If any step was
skipped, say so.
