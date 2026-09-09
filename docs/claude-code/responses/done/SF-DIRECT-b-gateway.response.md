# SF-DIRECT-b response — route the direct-Salesforce path through the PA gateway (2026-09-09)

> **Provenance.** CC shipped this as branch `claude/zen-shannon-lb9wir` → PR #2199 (commit `c23cc7c2`) with a
> surface transcript (`SF Direct Power Automate surface response.docx`, beside this file); no response `.md` was
> committed, so this file carries the transcript's substantive half plus the Cowork reconcile.

## CC's summary (from the transcript)

- **Unit 1 — flow spec.** `docs/architecture/flows/http-switch-salesforce-lookup.md` § "soql operation": new
  `Switch` case, request contract, the two client-guarded rejections + clamp-never-reject `max_rows`, the
  connector action (**Execute a SOQL Query**), both response shapes matching `pickFlowMessage`/`ok`/`reason`/
  `detail`, Secure Inputs/Outputs, registry-bump instruction.
- **Unit 2 — `supabase/functions/_shared/salesforce-gateway.ts`.** `sfGatewayQuery(soql, {maxRows})`: SELECT-only
  + no-`;` client guard, `max_rows` clamped to [1,500] default 200, POST with 20 s abort, `pickFlowMessage` ported
  verbatim, `SfGatewayError` with five named reasons — never the webhook URL.
- **Unit 3 — `sf-ping` fallback.** SOAP first; on `SfAuthError` with `INVALID_SSO_GATEWAY_URL` or `INVALID_LOGIN`
  only, falls back to the gateway. Response carries `via: "soap"|"pa_gateway"` and `soap_fault_code` on fallback.
  Same `authenticateWebhook` gate, no new slug.
- **Unit 4 — tests.** `test/salesforce-gateway.test.mjs` (24) + `intake-salesforce-sf-ping-auth.test.mjs` (+5).
  Full suite 5,543 pass / 0 fail / 6 skipped.
- **Unit 5 — docs.** Backlog SF-DIRECT-b → 🟡👤; ops reference notes `SF_LOOKUP_WEBHOOK_URL` on Dialysis_DB;
  drift page dated v25→v26 entry.
- **Remaining (Scott):** build the `soql` case in the PA designer, re-export, `supabase secrets set
  SF_LOOKUP_WEBHOOK_URL … --project-ref zqzrriwuavgrquhisnoa`, deploy `intake-salesforce` v26, run `sf-ping`,
  report the `open_tasks` count.

## Cowork reconcile (2026-09-09)

**Held.** 42/42 targeted tests here (gateway 24, ping-auth 9, soap 13 — the response's "101 targeted" counted
the whole SF family); fallback set is exactly `{INVALID_SSO_GATEWAY_URL, INVALID_LOGIN}`
(`index.ts:107`); `SF_LOOKUP_WEBHOOK_URL` read at one site and absent from every error; `grep -rn "sig="` finds
only the teams-alert detector and the test's own assertion; the flow spec names the connector action and the
Secure I/O settings. **Live `intake-salesforce` remains v25** — v26 is the operator deploy, as scoped.

**Sequence for Scott (in order):** (1) build the `soql` case from the spec; (2) re-export the flow to
`private/power-automate/exports/production/2026-09-09/`; (3) set the secret on Dialysis_DB; (4) deploy v26 with
`--no-verify-jwt`; (5) `sf-ping` → expect `ok:true, via:"pa_gateway", open_tasks:n`. Record `n` only.
