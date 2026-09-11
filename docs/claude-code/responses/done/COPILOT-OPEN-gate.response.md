# COPILOT-OPEN-gate — response

## What shipped

1. **`supabase/functions/ai-copilot/index.ts` (v79 → v80)** — gate added: every route but
   `GET /health` runs `authenticateWebhook(req)` (imported from `../_shared/auth.ts`) before dispatch.
   Controlled by `COPILOT_AUTH_MODE` (`log` default, `enforce` to actually refuse) and
   `COPILOT_KNOWN_IPS` (log-classification only, comma list of `class:ip-prefix` pairs). In `log`
   mode a failing request is logged `[copilot-auth] DENY-WOULD <method> <path> <ua_class> <ip_class>`
   and allowed through unchanged — nothing is refused in this deploy.

2. **`api/sync.js`** — new `_route=copilot-read` handler (`handleCopilotRead`), user-authenticated
   (`authenticate(req, res)`), proxies `GET /health`, `/sync/sf-activities`, `/sync/calendar-events`
   to the edge function with the secret header, forwarding the caller's query string verbatim.
   `connectorHeaders()` (used by every existing Railway→edge call) now also sends
   `X-PA-Webhook-Secret` when `PA_WEBHOOK_SECRET` is configured.

3. **`app.js`** — the five direct-edge-URL fetches (`sf-activities`, three `calendar-events`
   variants, `health`) now call `/api/sync?_route=copilot-read&what=...` instead. The hardcoded
   `API` const is replaced with a `COPILOT_READ` base path.

4. **`detail.js`** — the dead `const API = '...ai-copilot'` (declared, never referenced) removed.

5. **`test/ai-copilot-auth-gate.test.mjs`** — 11 tests: the gate is structurally present, runs
   before dispatch, excludes only `/health`, never returns 401 outside the enforce branch, never
   logs the secret, and reads IPs/mode from env with no hardcoded address; plus a positive-controlled
   check that `app.js`/`detail.js`/`extension/**` hold no reference to the edge URL. All pass.

6. **Docs:** `docs/architecture/flows/ai-copilot-sync-callers.md` (new — the four PA flow workflow
   ids, the header they need, the re-export/register procedure); `docs/architecture/
   edge-function-deploy-drift.md` (dated section on the v79→v80 gate); `docs/os/
   AI-SURFACES-OPERATIONAL-REFERENCE.md` §4a (new env vars); `docs/os/PLANNED-BACKLOG.md` COPILOT-OPEN
   → 🟡; `docs/claude-code/STATUS.md` (this unit's entry).

## Verified

- `npm test`: **5573 pass / 0 fail** (full suite; +11 net-new from this unit, nothing else moved).
- `node --check` clean on `api/sync.js`, `app.js`, `detail.js`.
- `grep -rn "functions/v1/ai-copilot" app.js detail.js extension/` → no matches.
- Structural gate test (`node --test test/ai-copilot-auth-gate.test.mjs`) → 11/11 pass.

## Not done here (named, not silently dropped)

- **The enforce flip.** `COPILOT_AUTH_MODE=enforce` is Scott's call, after the four PA flows carry
  the header and the log window reads zero unknown-caller `DENY-WOULD` lines for ≥3 days.
- **The four PA flow headers** — `docs/architecture/flows/ai-copilot-sync-callers.md`, 👤 Scott.
- **Deploy.** `supabase functions deploy ai-copilot --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt`
  is an operator step (this session cannot deploy Supabase edge functions); 👤 Scott also confirms
  `COPILOT_KNOWN_IPS` and reports whether `AI_EXTRACTION_PRIMARY` is set on Railway.
- **`salesforce-enrichment` (DRIFT1-sfenrich)** — needs the identical gate pattern, explicitly out of
  scope for this unit.
- **COPILOT-SYNC-500 / CAL-RECONCILE-STUCK** — separate rows, blocked on CFE-RUNAWAY; untouched.
