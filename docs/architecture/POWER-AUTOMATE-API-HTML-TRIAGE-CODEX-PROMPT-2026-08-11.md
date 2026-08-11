# Codex Prompt: Power Automate API / HTML Response Triage

Use the prompt below in a separate Codex chat with access to the `sbriggssjc/life-command-center` repository
and, if available, the Northmarq Power Automate environment.

```text
Work in the sbriggssjc/life-command-center repository. Diagnose and safely triage Power Automate flows and
Microsoft connector definitions that may call retired or noncanonical LCC hosts, unmounted API routes, or
routes returning HTML instead of the JSON contract the flow expects.

Start by reading, in order:
1. AGENTS.md
2. CLAUDE.md
3. .github/AI_INSTRUCTIONS.md before changing anything under /api
4. docs/os/FLOW-REGISTRY.yaml
5. docs/os/POWER-AUTOMATE-DEPLOYED-CATALOG.md
6. docs/architecture/flows/FLOW_CHANGES_LOG.md
7. docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md
8. docs/architecture/lcc-microsoft-copilot-outlook-audit-2026-05-22.md

Current architecture facts to verify, not blindly assume:
- Production LCC runs on Railway through server.js.
- The canonical web/API host is tranquil-delight-production-633f.up.railway.app.
- Vercel was retired; life-command-center-nine.vercel.app references are presumptively stale.
- Unknown /api routes should return JSON 404, not SPA HTML.
- The deployed catalog records two roster flows using life-command-center-production while other Railway
  flows use the canonical tranquil-delight hostname. Determine whether that hostname is a healthy intentional
  alias before changing it.
- The committed Copilot v4 swagger already uses the canonical Railway host, but imported Power Platform
  connectors do not automatically update when a repository swagger changes.

Objectives:
1. Build a flow-by-flow endpoint matrix from the registry, deployed catalog, retained exports, flow docs, and
   any Power Automate inventory/run history available. Include flow display name, immutable GUID, enabled
   state, action name, HTTP method, full host/path/query pattern with secrets redacted, expected status/content
   type/schema, actual latest status/content type/body prefix, and evidence timestamp.
2. Identify every live definition still calling:
   - life-command-center-nine.vercel.app;
   - life-command-center-production or any other Railway alias;
   - an unmounted or obsolete route;
   - a route whose response is text/html, a redirect/login page, SPA shell, or malformed JSON;
   - a route with an empty required query value, especially intake_id=.
3. Separate four failure classes:
   A. stale host or alias drift;
   B. correct host but wrong/unmounted route or method;
   C. auth failure/redirect caused by X-LCC-Key or Bearer mismatch;
   D. valid JSON business-state failure that the flow incorrectly treats as success.
4. Confirm server.js mounts and handler dispatch for every proposed replacement route. Run the repository's
   route tests and npm run verify:deploy where applicable. Probe only non-destructive health/diagnostic or
   idempotent test paths; never replay a production write merely to test routing.
5. For HTML responses, capture status, content-type, redirect chain, final URL, and the first 200 redacted body
   characters. Do not paste tokens, signed URLs, JWTs, API keys, message bodies, client data, or raw exports.
6. Produce a remediation table ranked P0/P1/P2 with exact owner-side Power Automate edits, code-side edits,
   deployment dependencies, rollback instructions, and acceptance tests.

Known candidates requiring explicit review (documentation may be historical, so verify live status):
- LCC Outlook Intake -> retired Vercel /api/intake-outlook-message.
- LCC Morning Briefing and LCC Weekday Briefing Email -> retired Vercel /api/briefing-email.
- LCC Daily Briefing -> retired Vercel /api/daily-briefing?action=snapshot&role_view=broker.
- HTTP ParseJSON Property Email -> retired Vercel /api/property.
- LoopNet Power Automate -> retired Vercel /api/loopnet-ingest.
- RCM Power Automate -> retired Vercel /api/rcm-ingest.
- LCC Outlook Calendar Write callback -> retired Vercel /api/operations?_route=draft&action=record_calendar_invite.
- HTTP Init LLC / extract path -> historical empty intake_id and missing business-state Condition.
- Deal-team and deal-contact roster flows -> life-command-center-production hostname alias drift.
- Imported LCC Deal Intelligence Power Platform connector -> confirm its live Host is Railway even though the
  committed v4 swagger is correct.

Safety and change rules:
- Diagnose first. Do not disable, delete, overwrite, or rotate credentials during discovery.
- Never expose or commit credential values. Treat retained packages and run-history headers as private.
- Export each live flow before editing and retain its GUID, checksum, modified time, enabled state, and last
  successful run.
- Prefer clone/test/swap for consequential flow changes. Change one flow family at a time.
- Do not replace a hostname until the target route, method, auth mode, and JSON schema are verified.
- Do not harden LCC_ENV/LCC_API_KEY independently; a mismatch can lock out every automation call.
- Power Automate transports governed writes; it is not a new canonical domain-write layer.

Deliverables:
A. A sanitized endpoint inventory and evidence report in docs/architecture/.
B. A proposed patch for stale repository documentation/configuration, clearly separating historical records
   from current runbooks.
C. A private operator checklist for Power Automate edits and test runs.
D. If evidence proves a safe repository-side fix, implement it on a branch, run targeted tests, and stop for
   review before changing live flows or secrets.
E. Update docs/os/FLOW-REGISTRY.yaml and docs/architecture/flows/FLOW_CHANGES_LOG.md only with verified deployed
   facts, timestamps, GUIDs, and redacted outcomes.

Report the first checkpoint before making changes: exact suspected flows, evidence source, failure class,
proposed non-destructive test, and whether owner access to Power Automate is required.
```
