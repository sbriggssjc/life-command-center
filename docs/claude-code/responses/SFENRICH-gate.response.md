# SFENRICH-gate — response

## What shipped

1. **`supabase/functions/salesforce-enrichment/index.ts`** — the deployed v26 body committed
   **verbatim** in its own first commit (no edits), fetched via Supabase MCP `get_edge_function`,
   project `zqzrriwuavgrquhisnoa`, slug `salesforce-enrichment` (`ezbr_sha256
   8d993301030c57b5087a80bee5a0b0ffc5bec3233b495be14f668d3324c6e23d`). This function's source had
   never been in this repo (DRIFT1's ~10-sourceless-deployments finding).

2. **Second commit — the gate.** Every route (`/diagnostics`, `/run`, bare `/`, `/`) now runs
   `authenticateWebhook(req)` (imported from `../_shared/auth.ts`) before dispatch. **No `/health`-
   equivalent exemption** — the only GET route this function has, `/diagnostics`, is itself the
   leak (row/gap counts), so nothing is carved out. Controlled by `SFENRICH_AUTH_MODE` (`log`
   default, `enforce` to refuse) and `SFENRICH_KNOWN_IPS` (log-classification only, same
   `class:ip-prefix` format as `COPILOT_KNOWN_IPS`). In `log` mode a failing request is logged
   `[sfenrich-auth] DENY-WOULD <method> <path> <ua_class> <ip_class>` and allowed through
   unchanged — nothing is refused in this deploy.

3. **`supabase/functions/_shared/caller-class.ts`** — new shared module: `parseKnownIps`,
   `uaClass`, `ipClass`, `requestIp`. Factored out of `ai-copilot/index.ts`'s inline
   `copilotUaClass`/`copilotIpClass`/`copilotRequestIp` (which are now thin wrappers delegating to
   it) so `salesforce-enrichment`'s identical gate does not grow a second copy of the same
   classifier regexes — the normaliser-drift class this repo warns about repeatedly.

4. **`supabase/config.toml`** — `[functions.salesforce-enrichment] verify_jwt = false` pinned with
   a dated comment, matching the `ai-copilot`/`intake-salesforce` entries, so a bare `functions
   deploy` cannot silently re-enable the gateway JWT check.

5. **`test/salesforce-enrichment-auth-gate.test.mjs`** — 14 tests: the gate is structurally
   present, runs before dispatch, has NO path exclusion (unlike ai-copilot), both real routes
   dispatch only after it, log mode never 401s, the DENY-WOULD line never carries the secret,
   `SFENRICH_AUTH_MODE` is checked exactly once, `SFENRICH_KNOWN_IPS` is read via the shared
   parser with no hardcoded IP, and — the Unit 3 confirmation — every one of the function's step
   queries is a fixed template literal with **no** `${...}` interpolation of request data (with a
   positive control proving the check would catch one). A second describe block asserts
   `caller-class.ts` exists, both functions import it, `ai-copilot` no longer defines the regex
   bodies inline, and the classifier's output is byte-identical on a fixed set of UA/IP pairs
   after the move. All 14 pass; `test/ai-copilot-auth-gate.test.mjs`'s 11 pre-existing tests still
   pass unchanged.

6. **Docs:** `docs/architecture/edge-function-deploy-drift.md` (new dated section, "SFENRICH-gate"),
   `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` (env var table), `docs/os/PLANNED-BACKLOG.md`
   (DRIFT1-sfenrich row: 🔴 → 🟡, gate shipped, the two data-quality findings — name-equality
   identity writes and the missing provenance ladder — left open and unfixed, as scoped).

## What did NOT ship (deliberately out of scope)

- Fixing steps 3/8B's name-equality identity writes, or registering the missing
  `field_source_priority` rows for the curated BD columns this function writes. Both need the
  CONTACT1 ladder machinery, not a gate, and are larger, separate units.
- Disabling the pipeline, changing its schedule, or deciding whether it should keep running.
- The `enforce` flip — this ships log-only. The pre-gate `function_edge_logs` read saw zero
  callers in 24h, which is a reason to read a longer window before enforcing (a monthly or
  ad-hoc caller is invisible in one day), not a reason to skip logging.

## Deploy (👤 Scott)

```
supabase functions deploy salesforce-enrichment --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt
```

Then one `curl -X POST .../salesforce-enrichment/run?dry_run=true` with no header (expect the
dry-run JSON body, plus a `[sfenrich-auth] DENY-WOULD POST /run node other` line — or whatever
UA/IP class it actually reads — in the function log) and one with `X-PA-Webhook-Secret: <secret>`
set (expect no DENY-WOULD line for that request).

## Verify

- `npm test` — green, 0 live calls (net-guard verified this doesn't reach Supabase/Salesforce).
- Body diff: the committed `index.ts` reads byte-for-byte what `get_edge_function` returned on
  2026-09-09 — no line was touched in the first commit.
