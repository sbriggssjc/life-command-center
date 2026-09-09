# J13-teardown-preflight — enumerate every live caller of the retired Vercel host, then write the teardown runbook

> **The retired deployment `life-command-center-nine.vercel.app` is executing today** — measured 2026-09-08
> 21:44 UTC from LCC Opps: `/api/daily-briefing` → 200 with a briefing generated at that instant. It still holds
> an LCC Opps service key (P194), so it is a second writer, not a dead link. Three documentation passes and a CI
> guard (J13a-guard) have removed every *repo* pointer to it; **what is left is whatever still calls it from
> outside the repo — and tearing it down before those are known strands a caller silently** (the P194 lesson,
> inverted: the calls will fail *quietly* instead of succeeding quietly). This unit finds them and writes the
> runbook. **It does not tear anything down** — that stays 👤 Scott, backlog **J13**.

**Repo:** `life-command-center` · **No code, no DB writes, no migrations, no deploy.** Reads only: Supabase
`edge_logs`/`net._http_response` via the MCP (read), the repo, `docs/os/FLOW-REGISTRY.yaml`. Output is one
runbook + one dated audit + STATUS/backlog rows. Branch → PR → CI green → merge.

**Read first:** `CLAUDE.md` § P194 (the writer-IP fingerprint technique — Railway is a small set of stable
addresses; the Vercel stand-in is a rotating pool of ephemeral AWS IPs) · `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`
· `docs/claude-code/STATUS.md` 2026-09-08 J13a-guard-reconcile entry · `docs/ops-logs/daily-briefing-cache-2026-09-01.md` §3.

---

## Unit 1 — who is still calling it? (measure, don't enumerate from memory)

**1a. Supabase side (the only place a caller cannot hide).** On LCC Opps `xengecqvemvfknjvbvrq`, and then on
Dialysis_DB and government, query the PostgREST/edge request logs for the last **14 days** and bucket writers by
`request.headers.cf_connecting_ip` class per P194: stable Railway addresses vs ephemeral AWS pool. For the
ephemeral class, report **count, distinct paths, distinct days, hour-of-day histogram, and the tables written**.
A daily spike at a fixed hour is a scheduled caller; a burst around a human's working hours is a client
(extension / phone / Copilot). ⚠️ **Exclude the Cowork probes of 2026-09-08 21:43–21:44 UTC** (six `net.http_get`
calls from LCC Opps — they will appear as writes only if `/api/daily-briefing` persisted a snapshot; say whether it
did). ⚠️ If the log retention window is shorter than 14 days, state the window you actually read — a zero over
2 days is not a zero over 14.

**1b. Known candidate callers (confirm or clear each, with the measurement that decides it):**

| candidate | where it is | how to decide |
|---|---|---|
| **Cowork desktop task `daily-briefing-cache`** | Scott's desktop app (not the cloud API — the four cloud tasks were checked 2026-09-08 and are clean) | 👤 Scott opens the task; CC records its current target verbatim. The 09-01 ops-log says it still names the Vercel host **and** a `?_route=daily-briefing` path `server.js:273` would swallow anyway. |
| **iPhone Shortcut "Send to LCC"** | Scott's phone — built from `docs/MOBILE_SHARE_INGESTION.md` step 1 (bannered; leads with the Vercel URL) | 👤 Scott reads the Shortcut's URL. Repo side: does `/api/intake?_route=mobile-share` exist on `server.js`? If not, the Shortcut has no live target to be repointed to — say so. |
| **Chrome/Edge extension** | `extension/background.js` — P194 removed the seven fallbacks; `pickIntakeHost()` is Railway-first | Confirm the installed build: the extension's `manifest.json` version vs the last P194-carrying commit; a user running a pre-P194 build still posts to Vercel. |
| **Copilot Studio / Teams agent** | the package was archived (J13a); the *imported* connector in Scott's tenant may still carry `host: life-command-center-nine.vercel.app` (`lcc-microsoft-copilot-outlook-audit-2026-05-22.md` §cause #1) | 👤 Scott checks the imported connector's host in Copilot Studio. Repo side: which canonical connector file should replace it (`copilot/lcc-deal-intelligence.connector.v1.swagger.json` — confirm its `host`). |
| **Power Automate flows** | `docs/os/FLOW-REGISTRY.yaml` — 0 hits for the Vercel host as of 2026-09-08 | Re-grep the registry AND the retained exports under `private/power-automate/exports/` (zips: `unzip -p … \| grep`). The registry describes 17 baseline flows; PA5 says three flows exist in neither the registry nor `retired_flows` — those three are exactly the ones this check cannot see; name them as a boundary. |
| **The `outputs/daily-briefing-logs/` runner** | `outputs/daily-briefing-logs/2026-04-17-briefing-run.md` GETs the Vercel host | Is there a live script or task behind it, or is it a one-off log? Decide from the repo (`Scheduled/`, `scripts/`, `.github/workflows/`). |

**1c. Report as four numbers per caller class:** *observed in logs (14d) / identified / repointed already /
still live.* A caller you could not observe is "Not on file", not "clear".

## Unit 2 — the runbook: `docs/os/RUNBOOK_vercel_teardown.md`

Write it in the order that cannot strand a caller, each step with its **proof**:

1. **Repoint every live caller found in Unit 1** (each 👤 item names the exact new URL, taken from `server.js`
   route mounts — never from a doc). Proof per caller: one request from that caller landing at a **Railway** IP
   in the logs, carrying the P61 50-key schema / `_provider` stamp where applicable.
2. **Observation window:** *N* days with **zero ephemeral-pool writers** in `edge_logs` (propose *N* from the
   Unit 1a hour-of-day histogram — a weekly caller needs ≥ 8 days). Proof: the Unit 1a query re-run reads 0.
3. **Rotate the LCC Opps service key the frozen build holds** (P0s deferred rotation `SEC2`–`SEC4` was deferred
   for a *second user* trigger; this is a different trigger — a retired deployment holding a live key — say
   whether it changes the deferral or not, and let Scott decide). Proof: the old key returns 401.
4. **Delete the Vercel project.** Proof: `https://life-command-center-nine.vercel.app/` → Vercel
   `DEPLOYMENT_NOT_FOUND`, and `/api/daily-briefing` → the same (not a 200, not a 404 from the frozen build).
5. **Close the loop in the repo:** J13 → ✅ with the dates; move the ten `STALE (DOCMAP…` banners' wording from
   "still answers" to "torn down <date>" — a banner that says "still answers" after the teardown is itself stale.
   The J13a-guard fixture entry's `note` gets the teardown date.

Also a **rollback paragraph**: what to do if a caller surfaces *after* step 4 (redeploy is not an option — the
answer is the caller's own repoint, so name the failure signature each caller would show).

## Unit 3 — file it

- `docs/audits/J13_TEARDOWN_PREFLIGHT_2026-09-XX.md` — the Unit 1 measurement, with the exact queries and the
  retention window read.
- `docs/os/PLANNED-BACKLOG.md` J13: split into **J13-preflight** (✅ on merge) and **J13-teardown** (👤, with the
  runbook's step list as the checklist).
- STATUS entry; response in `docs/claude-code/responses/J13-teardown-preflight.response.md`.

---

## Out of scope — say so

- **Deleting anything** (the Vercel project, the key, the `life-command-center` Railway service — the last is
  frozen under **I16b** until Scott reads the Railway dashboard; do not touch it here).
- Repointing any caller yourself — every caller in Unit 1b is on Scott's tenant/phone/desktop.
- Rotating any key.

## Verify on

- Every caller row carries a measurement or "Not on file" — never "should be fine".
- The runbook's step 4 proof is a `DEPLOYMENT_NOT_FOUND`, explicitly distinguished from the frozen build's own 404.
- The log window actually read is stated in days.
