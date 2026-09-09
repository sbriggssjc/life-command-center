# J13-teardown-preflight — response

**Read-only, as specified.** No code, DB writes, migrations, deploys, or deletions. Branch
`claude/gallant-lovelace-e1b1jc`.

## What was done

**Unit 1 — caller enumeration.** Queried Supabase `edge_logs` on LCC Opps (`xengecqvemvfknjvbvrq`) via
`mcp__Supabase__query_logs`. Each call caps at 24h; one call was made, covering
**2026-09-08T01:22:00Z → 2026-09-09T01:21:22Z** — stated as the actual window, not the requested 14
days (getting 14 days would need 14 separate daily calls this session could not make retroactively).

Split the traffic by P194's IP-class technique: found the documented stable Railway block
(`152.55.176.x`/`152.55.177.x`/`162.220.232.x`, ~30 addresses, each active a contiguous window and
never recurring) against an AWS/Azure ephemeral-address population (~14 addresses, mostly short
bursts). Most of the ephemeral traffic reads as broad multi-table app usage rather than the narrow
single-path fingerprint P194's W53 audit describes — flagged as a different caller shape than the
prior finding, not silently equated to it.

One signal did match a narrow, scheduled fingerprint: `18.208.213.136` POSTed an upsert to
`briefing_intel_snapshot` at **10:00:27 UTC** (`on_conflict=as_of_date,workspace_id`, HTTP 201) — 18
minutes ahead of Railway's own cron-240 read+PATCH of the identical row at 10:18 — and
`18.209.20.81` fired an 18-request composite "render the briefing/My Work dashboard" burst at
**12:30:01 UTC**. Both times bracket the cron-240 schedule CLAUDE.md already documents
("between the 10:00 snapshot and the 12:30 send"), and the pattern matches the desktop-task note in
`docs/ops-logs/daily-briefing-cache-2026-09-01.md`. Explicitly confirmed the Cowork verification probe
from 21:43–21:44 UTC did **not** persist a snapshot and excluded it from every count.

Ran the six candidate-caller checks from Unit 1b:
- **Cowork desktop task**: pattern found in logs (above); exact config Not on file — 👤 Scott.
- **iPhone Shortcut**: `grep`ed `server.js` for every `app.all/get/post` — **`_route=mobile-share` is
  not mounted anywhere**. Reported as a blocker (no live target to repoint to), not a routine clear.
- **Extension**: read `extension/background.js` — `pickIntakeHost()` prefers `LCC_RAILWAY_URL` first;
  shipped `extension/manifest.json` version **1.0.52**. Installed-build currency is Not on file (can't
  see Scott's browser).
- **Copilot Studio connector**: canonical file is `copilot/lcc-deal-intelligence.connector.v4.swagger.json`
  (v1 superseded, archived); its `host` field was not confirmed by grep in this pass — the runbook
  instructs reading it directly rather than trusting this doc's paraphrase.
- **Power Automate**: `docs/os/FLOW-REGISTRY.yaml` — 0 Vercel hits. Unzipped and grepped the
  2026-08-11 production export set (17 zips) for `vercel` — 0 hits. Named, did not identify, the
  pre-existing "3 flows outside the registry and `retired_flows`" boundary from CLAUDE.md's own
  backlog.
- **`outputs/daily-briefing-logs/` runner**: confirmed it is a single dated file
  (`2026-04-17-briefing-run.md`) with no live script, workflow, or `Scheduled/` reference anywhere in
  the repo — a dead one-off log, not a live runner.

Ran a lighter sanity pass on Dialysis_DB and government (top-15 IPs by volume, same 24h window) —
the same ephemeral pool shows up there too, at lower relative volume; not deep-dived (out of budget),
and a genuinely unidentified residential IP on gov (`108.235.254.15`) is flagged as an open question
rather than assumed benign.

**Unit 2 — runbook.** `docs/os/RUNBOOK_vercel_teardown.md`: 5 ordered steps (repoint → observe →
rotate key → delete → close the loop), each with a concrete proof. Step 3 explicitly separates this
key-rotation trigger from the deferred SEC2–SEC4 rotation and states it is Scott's call whether this
changes that decision. Step 4's proof table explicitly distinguishes the Vercel-platform
`DEPLOYMENT_NOT_FOUND` from today's actual frozen-build 200 response, so nobody reads a lesser signal
as proof of teardown. Includes a rollback section naming the failure signature for each caller class
if one surfaces after deletion — always "repoint that caller," never "redeploy."

**Unit 3 — filing.**
- `docs/audits/J13_TEARDOWN_PREFLIGHT_2026-09-09.md` — full measurement, every query run verbatim, the
  actual retention window, the complete caller table.
- `docs/os/PLANNED-BACKLOG.md` — J13 split into **J13-preflight** (✅, dated) and **J13-teardown** (👤
  Scott, pointing at the runbook).
- `docs/claude-code/STATUS.md` — dated entry added at the top of the log.
- This file.

## Out of scope, confirmed not done

Nothing on Vercel was deleted. No key was rotated. No caller was repointed. The Railway
`life-command-center` service (frozen under I16b) was not touched. No code files were changed — only
the five markdown files listed above.

## Caveats carried forward, stated rather than hidden

- The 24h window is one sample, not 14 days — a weekly-only caller could exist and not have been seen.
- `postgres_logs` mutation-statement correlation was not run; the edge-log HTTP method (POST/PATCH)
  already identifies the one confirmed write without it.
- The "3 undocumented PA flows" and the gov `108.235.254.15` IP remain unidentified — named as
  boundaries, not resolved.
- The mobile-share Shortcut cannot be repointed today without either adding a route to `server.js` or
  retargeting it to an existing route — flagged in the runbook as a blocker, not glossed over.

## Push

Committed to `claude/gallant-lovelace-e1b1jc` and pushed. No PR opened (not requested).

---

## Cowork reconcile (2026-09-09)

**Held:** method, stated 24 h window, the six candidate checks (`_route=mobile-share` genuinely not mounted;
extension Railway-first at 1.0.52; registry + 17 exports 0 hits; the log runner is dead), the runbook, the J13
split.

**Corrected in place:** the 10:00:27 upsert to `briefing_intel_snapshot` is **not** the Vercel build — its
`user_agent` is `Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.74.3)`, i.e. the `briefing-intel-snapshot` edge cron
(V4), which shares the AWS egress pool. The frozen build is the **12:30:00 UTC `node` burst with three 400s**
(`v_my_work`, `mv_user_work_counts`, `action_items`) — read-only — seen Thu 09-04, Mon 09-07, Tue 09-08, absent
Fri 09-05 and Sat 09-06 (a desktop-awake pattern, not a PA weekday recurrence). The 10:00/12:30 "pair" was two
different callers. **The column the pass did not read was the discriminator.**

**Filed:** BRIEF-400 (Railway's own 10:18 cron 400s on `v_my_work` — a live defect, not Vercel's).
