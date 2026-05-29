# LCC Template Health Report

**Week of:** May 25, 2026
**Lookback window:** 120 days
**Run mode:** Live API call against `https://life-command-center-nine.vercel.app/api/operations?_route=draft&action=health` with `X-LCC-Key` from `.env.local`.
**Status:** ⚠️ **COULD NOT COMPLETE — endpoint returning HTTP 500**

> Destination note: the task asks for this report at
> `C:\Users\scott\OneDrive\Documents\Claude\Scheduled\lcc-template-health-weekly\latest-report.md`,
> but that OneDrive folder isn't in the session's connected mounts (same as prior weeks).
> Written to the LCC workspace path instead. To restore the OneDrive destination, connect
> that folder to Cowork or update the SKILL.md to write here permanently.

---

## Executive Summary

For the first time in this report's history, the call **failed**. The template
health endpoint returned **HTTP 500 ("Internal server error")** on every attempt
this morning, so **no template data was retrieved and no health metrics could be
computed**. This breaks the four-week streak of clean (if empty) 200 responses.

This is a **backend availability problem, not a templates result** — do not read
it as "all clear."

| Metric | This week | Last week (May 18) |
|---|---|---|
| Endpoint response | **HTTP 500** | HTTP 200 |
| Total templates evaluated | **n/a — no data** | 14 |
| Need revision (edit rate >40%) | **n/a** | 0 |
| Underperforming vs targets | **n/a** | 0 |
| Stale (no sends 90+ days) | **n/a** | 14 |

---

## What happened (diagnostics)

Two corrections to the task's call spec were needed before auth even succeeded —
the SKILL.md is pointing at the wrong host and the wrong auth scheme:

| SKILL.md says | Actually works |
|---|---|
| Host `life-command-center.vercel.app` | **`life-command-center-nine.vercel.app`** (the bare host returns the frontend 404 for all `/api/*`) |
| `Authorization: Bearer <key>` | **`X-LCC-Key: <key>` header** (Bearer returns 401) |

Probes against the **correct** host with a valid `X-LCC-Key`:

| Request | Result |
|---|---|
| `POST /api/operations?_route=draft&action=health` (×2) | **500** `{"error":"Internal server error"}` (fast fail) |
| `GET /api/draft` (list templates — tier 0, no data needed) | **500** `{"error":"Internal server error"}` |
| `GET /api/queue` | **timeout** (no response in 18s) |
| `GET /api/sync?action=health` | **timeout** (no response in 25s) |
| `GET /` (site root) | 200 — frontend is up |

The 500 is returned *after* auth passes (it's a handler-level failure, not 401/404),
and it hits even the tier-0 list call that needs no send data — so the whole
`draft` route is failing, not just the `health` action. Adjacent routes
(`queue`, `sync`) are timing out entirely. Pattern points to a backend
dependency outage (e.g. the LCC Opps Supabase / data layer the draft route reads
from) or a deploy regression introduced since last Monday's healthy run.

---

## Templates Needing Revision

**Unknown — no data retrieved.** Endpoint errored before producing any
evaluations. This section will populate once the route returns 200 again.

For reference, last week (May 18) all 14 active templates were `stale` with
**0** flagged for revision and **0** underperforming, because no broker sends had
been recorded in the prior 120 days.

---

## What needs attention this week

1. **Investigate the 500 on the `draft` route.** Pull the Vercel function logs
   for `api/operations` (and check the LCC Opps Supabase status) around this
   morning's run. The fast 500 on a tier-0 list call suggests a failing
   dependency or unhandled exception at route entry, not a data-specific bug.
   The `queue`/`sync` timeouts suggest the problem may be broader than `draft`.
2. **Fix the scheduled-task spec.** Update the SKILL.md so future runs don't
   waste a cycle rediscovering this:
   - Host → `life-command-center-nine.vercel.app`
   - Auth header → `X-LCC-Key: <LCC_API_KEY>` (not `Authorization: Bearer`)
3. **Re-run manually once the route is healthy:**
   `POST /api/operations?_route=draft&action=health` with `{"lookback_days":120}`
   and the `X-LCC-Key` header.
4. **Standing item (unchanged 4 weeks running):** the refinement loop still has
   nothing to score because no `template_sends` rows exist. Once the endpoint is
   back, the report will again show "all stale" until `record_send` is wired up
   or sends start flowing. Consider dialing this task to monthly until send
   volume returns.

---

## Run Notes

- Endpoint (corrected): `POST /api/operations?_route=draft&action=health` on `life-command-center-nine.vercel.app`
- Auth: `X-LCC-Key` header sourced from `.env.local` (Bearer format → 401)
- Body: `{"lookback_days": 120}`
- Response: **HTTP 500 `{"error":"Internal server error"}`**, reproduced on retry; tier-0 `GET /api/draft` also 500; `queue`/`sync` routes timed out
- Last healthy run: May 18, 2026 (HTTP 200, 14 evaluations, all `stale`)
