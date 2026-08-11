# Power Automate API / HTML Triage Evidence Report

Date: 2026-08-11
Branch: `codex/power-automate-route-triage`
Scope: LCC Power Automate retained exports, Microsoft connector host evidence, Railway route mounts, and read-only live route probes.

## Checkpoint Summary

The August retained baseline does not show any of the 17 exported baseline flows calling `life-command-center-nine.vercel.app`. It does show two roster flows calling `life-command-center-production.up.railway.app`, and live probes show that hostname is not a healthy alias for the current LCC app: `/version` and the roster path return `text/html` 404 bodies. The canonical `tranquil-delight-production-633f.up.railway.app` host returns JSON for `/version` and JSON 404s for unknown `/api/*` routes.

The two roster endpoints were also missing from Railway `server.js`. The handlers already existed in `mcp/deal-roster.js` and were mounted by the standalone MCP server, so the repository-side fix is to mount those same handlers in `server.js` and add them to the deploy gate's critical route list.

## Evidence Sources

- Required read-first files: `AGENTS.md`, `CLAUDE.md`, `.github/AI_INSTRUCTIONS.md`, `docs/os/FLOW-REGISTRY.yaml`, `docs/os/POWER-AUTOMATE-DEPLOYED-CATALOG.md`, `docs/architecture/flows/FLOW_CHANGES_LOG.md`, `docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md`, `docs/architecture/lcc-microsoft-copilot-outlook-audit-2026-05-22.md`.
- Retained export packages: `private/power-automate/exports/production/2026-08-11/*.zip`.
- Live probes: unauthenticated `GET` requests only, no production write replay, no payload replay.
- Route source: `server.js`, `mcp/deal-roster.js`, `mcp/opportunity-sync.js`, `scripts/verify-deploy.mjs`, `test/critical-subroutes.mjs`.

## Endpoint Inventory

Fields that require owner/admin Power Automate access are marked `owner-access required`: enabled state, latest action status/content type/body prefix, last successful run, and imported custom connector Host.

| Priority | Flow | GUID | Enabled | Action | Method | Endpoint Pattern | Expected Contract | Actual Evidence | Class |
|---|---|---:|---|---|---|---|---|---|---|
| P0 | SF Deal Team -> LCC Roster | `9879c0fd-2dc0-4304-a82b-d68de3fcc991` | owner-access required | `HTTP` | POST | `https://life-command-center-production.up.railway.app/api/pipeline/ingest-deal-parties` | JSON `{ok:true,total,...}` from `mcp/deal-roster.js::ingestParties`; `X-LCC-Key` auth | Export verified 2026-08-11. Live GET 2026-08-11: alias `/version` 404 `text/html`; alias route 404 `text/html`; canonical route 404 JSON before this branch deploy because route was unmounted. | A + B |
| P0 | SF Deal Contacts -> LCC Roster | `a50d3f56-3891-4d8f-8636-b9b09e58c2ee` | owner-access required | `HTTP` | POST | `https://life-command-center-production.up.railway.app/api/pipeline/ingest-deal-contacts` | JSON `{ok:true,total,...}` from `mcp/deal-roster.js::ingestContactRoles`; `X-LCC-Key` auth | Same alias failure class. Export verified 2026-08-11. Route unmounted on canonical Railway before this branch. | A + B |
| P1 | SF Deal -> LCC Opportunity Sync | `7657a3bc-8761-4d2e-b385-ed112411bc42` | owner-access required | `HTTP` | POST | `https://tranquil-delight-production-633f.up.railway.app/api/pipeline/ingest-opportunities` | JSON batch summary from `mcp/opportunity-sync.js::ingestBatch`; `X-LCC-Key` auth | Export host is canonical. `server.js` mounts `/api/pipeline/ingest-opportunities`. Latest run status owner-access required. | none found |
| P1 | LCC - Outlook Intake to Teams (Hardened) | `45faffcc-a96c-4ca3-a62d-c2fa150386ed` | owner-access required | `HTTP_PostIntakeMessage` | POST | `https://tranquil-delight-production-633f.up.railway.app/api/intake-outlook-message` | JSON intake result; `X-LCC-Key` auth | Export host is canonical. `server.js` mounts alias to intake `_route=outlook-message`. Latest run status owner-access required. | none found |
| P1 | LCC - Outlook Intake to Teams (Hardened) | same | owner-access required | `HTTP_GetIntakeSummary` | GET | `https://tranquil-delight-production-633f.up.railway.app/api/intake-summary?correlation_id=<from intake>&limit=1` | JSON summary | Export host is canonical. `server.js` mounts `/api/intake-summary`. | none found |
| P1 | LCC - Outlook Intake to Teams (Hardened) | same | owner-access required | `HTTP_ProcessingComplete` | POST | `https://tranquil-delight-production-633f.up.railway.app/api/webhooks/processing-complete` | JSON processing-complete result | Export host is canonical. `server.js` mounts sync `_route=processing-complete`. | none found |
| P1 | LCC Flagged Email Intake | `44227dbb-3c8b-46b2-9a6a-6c46130a6beb` | owner-access required | `HTTP` | POST | `https://tranquil-delight-production-633f.up.railway.app/api/intake/prepare-upload` | JSON upload URL; `X-LCC-Key` auth | Export host is canonical. `server.js` mounts `/api/intake/prepare-upload`. | none found |
| P1 | LCC Flagged Email Intake | same | owner-access required | `HTTP_-_outlook-message` | POST | `https://tranquil-delight-production-633f.up.railway.app/api/intake?_route=outlook-message` | JSON intake result | Export host is canonical. Mounted through base `/api/intake` handler plus explicit `/api/intake-outlook-message` alias. | none found |
| P2 | LCC To Do Completion Poll | `a77e7a00-9ae0-4b7e-a8c1-b6a1685e2f98` | owner-access required | `HTTP_GetStagedWorklist` | GET | `https://tranquil-delight-production-633f.up.railway.app/api/webhooks/todo-completion-poll` | JSON worklist | Export host is canonical. `server.js` mounts sync `_route=todo-completion-poll`. | none found |
| P2 | LCC To Do Completion Poll | same | owner-access required | `HTTP_1` | POST | same path | JSON ack/update result | Export host is canonical. POST is a governed write; not replayed. | none found |
| P2 | Historical briefing/property/LoopNet/RCM/calendar flows | mixed historical GUIDs | owner-access required | mixed | mixed | `life-command-center-nine.vercel.app` paths in May docs | JSON with auth/business contract depending path | Not present in August 17-flow retained baseline. Read-only probes against old Vercel returned JSON, not SPA HTML, for sampled routes; `/version` is 404 JSON so deployment identity cannot be verified. | A if still live |
| P1 | HTTP Init LLC historical repair | `ab11601a-b7d7-4efa-8f3a-52873e873270` historical prod | owner-access required | `Call_extract` | POST | historical `https://life-command-center-nine.vercel.app/api/intake-extract?intake_id=` | Should only run when prior stage returned `ok:true` with non-empty `intake_id` | May run-history evidence shows upstream `{ok:false, skipped:...}` was treated as success, causing empty `intake_id=` and 400. Need owner verification whether prod flow remains live. | D |

## Live Probe Results

Timestamp: 2026-08-11 local session.

| URL | Status | Content-Type | Redacted Body Prefix |
|---|---:|---|---|
| `https://tranquil-delight-production-633f.up.railway.app/version` | 200 | `application/json; charset=utf-8` | `{"version":"14da2f55c5e3","source":"railway_git_commit_sha","git_pinned":true,...}` |
| `https://life-command-center-production.up.railway.app/version` | 404 | `text/html; charset=utf-8` | `<!DOCTYPE html> <html lang="en"> ... Cannot GET /version ...` |
| `https://tranquil-delight-production-633f.up.railway.app/api/__definitely_missing_route__` | 404 | `application/json; charset=utf-8` | `{"error":"Unknown API route","path":"/api/__definitely_missing_route__","version":"14da2f55c5e3"}` |
| `https://tranquil-delight-production-633f.up.railway.app/api/pipeline/ingest-deal-parties` | 404 | `application/json; charset=utf-8` | `{"error":"Unknown API route","path":"/api/pipeline/ingest-deal-parties","version":"14da2f55c5e3"}` |
| `https://life-command-center-production.up.railway.app/api/pipeline/ingest-deal-parties` | 404 | `text/html; charset=utf-8` | `<!DOCTYPE html> <html lang="en"> ... Cannot GET /api/pipeline/ingest-deal-parties ...` |
| `https://life-command-center-nine.vercel.app/version` | 404 | `application/json` | `{"error":{"code":"404","message":"The page could not be found"}}` |
| `https://life-command-center-nine.vercel.app/api/__definitely_missing_route__` | 404 | `application/json` | `{"error":{"code":"404","message":"The page could not be found"}}` |

## Failure Classes

- A, stale host or alias drift: confirmed for the two roster flows. `life-command-center-production.up.railway.app` is not serving the current LCC Railway app contract.
- B, correct host but wrong/unmounted route or method: confirmed for roster route mounts on current canonical deploy before this branch. The repo had no `server.js` route for `/api/pipeline/ingest-deal-parties` or `/api/pipeline/ingest-deal-contacts`.
- C, auth failure or redirect: not proven from retained exports. Several unauthenticated probes correctly returned 401 JSON. Whether live flows carry the correct `X-LCC-Key` requires owner-side run-history/header validation without exposing values.
- D, JSON business-state failure treated as success: historical `HTTP Init LLC` evidence remains valid. Owner must verify whether that prod flow is still live/enabled and whether the nonprod condition fix was promoted.

## Remediation Table

| Priority | Item | Owner-Side Power Automate Edit | Code-Side Edit | Deploy Dependency | Rollback | Acceptance Test |
|---|---|---|---|---|---|---|
| P0 | Roster flows call alias and an unmounted route | After code deploy, export both flows, change Host to `tranquil-delight-production-633f.up.railway.app`, keep same path, verify `X-LCC-Key` secure reference, save one flow family at a time | Done on this branch: mount existing `mcp/deal-roster.js` handlers in `server.js`; add critical-route coverage | Merge to `main`, Railway redeploy, then `npm run verify:deploy`; only after deploy edit PA host | Revert `server.js` route additions and critical route list; switch PA URLs back only if canonical route fails acceptance | `GET /api/pipeline/ingest-deal-parties` on canonical returns JSON 401/404 but never HTML; controlled clone/test POST returns JSON `{ok:true,...}` or expected JSON validation error |
| P1 | Imported Copilot connector Host may still be stale | In Power Platform custom connector, verify imported Host equals `tranquil-delight-production-633f.up.railway.app`; re-publish agent if changed | No patch needed; committed v4 swagger already canonical | Re-import/publish connector after owner confirmation | Restore previous connector export if action calls regress | Copilot action against `/api/copilot-spec` / `/api/chat` returns JSON; no SystemError from HTML/transport |
| P1 | Historical non-baseline flows may still call Vercel | Open each candidate by GUID/display name; if live, export before edit, compare URL and latest run content type; replace only after target route/auth/schema is verified | No code patch unless target route is missing | Per-flow clone/test/swap | Re-enable old clone or restore retained export | Latest run after edit returns expected JSON status and schema; no `text/html` body |
| P1 | `HTTP Init LLC` empty `intake_id=` | Verify prod flow definition has condition after stage response: only call extract when `ok == true` and `intake_id` non-empty; otherwise return skip JSON and terminate succeeded | None unless intake extract contract needs clearer 400 JSON | Owner-side clone/test/swap | Restore prior flow export | Skip sample returns 200 JSON business-state skip and does not call extract |
| P2 | Secret material in retained exports/run history | Move secrets to secure references/environment variables; rotate exposed values after coordinated cutover | None in this branch | Coordinate `LCC_API_KEY` and `LCC_ENV=production` order | Roll back env only with connector key alignment | New export contains no reusable credentials; live calls return JSON auth success/failure as expected |

## Verification

- `node --check server.js` passed.
- `node --test test/operations-subroutes.test.mjs` passed.
- Full `npm run verify:deploy` was not run as a success gate after the patch because this branch is not deployed yet; running it now would correctly fail SHA/route freshness against the current production deploy.

## Open Owner-Access Gaps

1. Capture enabled state, exact modified time, last successful run, and latest failed/success action output for the 17 baseline flows.
2. Confirm whether historical May-era flows still exist live outside the 17-flow baseline.
3. Export or screenshot the imported Power Platform `LCC Deal Intelligence` connector Host and auth policy.
4. For any HTML response found in live run history, record status, content type, redirect/final URL, and first 200 redacted body characters.
