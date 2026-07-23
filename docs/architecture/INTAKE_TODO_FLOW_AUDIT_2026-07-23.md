# Intake → staging → completion → To-Do flow audit (2026-07-23)

Owner: LCC architecture/audit track (Scott Briggs)
Scope: consistency check of every path touching email intake / staging / To-Do
completion / retention after the 2026-07-20/21 rework (custom-task creation
REMOVED, native "Flagged email" list tracking ADDED, `todo_task_map` DEPRECATED,
`staged` outcome ADDED, multiple PA flows rebuilt).

**Bottom line:** the CURRENT architecture is internally consistent. The live
handlers, DB columns, and the three current flow specs all agree on: native
"Flagged email" list tracking, `staged` outcome, subject-matching
(`displayName == subject`), no custom task creation, no `todo_task_map`
reader/writer, no Graph token in the loop. The risks are all **STALE ARTIFACTS**
(docs/JSON/config that still describe the retired model or the dead Vercel host)
plus **one orthogonal dead code path** (a Copilot agent action). None of them is
wired into the current loop, but each is a "quietly breaks / misleads later"
hazard, itemized below.

---

## 1. PA flows that touch intake / staging / To-Do / retention

All current specs live in `docs/architecture/flows/`.

| Flow | Spec | Trigger | State vs current arch |
|---|---|---|---|
| **Closing-the-Loop overview** | `closing-the-loop-overview.md` (2026-07-20) | — | **CURRENT.** Master spec; locks "track NATIVE Flagged-email list, no custom tasks; `todo_task_map` retired 2026-07-21"; staging folder taxonomy. |
| **LCC Processing Complete → Move Message** (Flow 1) | `processing-complete-move-message.md` (2026-07-21) | HTTP request | **CURRENT.** `POST /api/webhooks/processing-complete` → `api/sync.js ?_route=processing-complete` → `api/_shared/pa-move-message.js` → PA (`PA_MOVE_MESSAGE_WEBHOOK_URL`). `clear_flag` is the sole completion lever; retired items (`complete_todo`/`todo_task_id`/`todo_list_id`/`resolveTodoCompletion`) enumerated as removed. |
| **LCC To-Do Completion Poll** (Flow 6) | `todo-completion-poll.md` (2026-07-21) | Recurrence, every ~30 min | **CURRENT.** `handleTodoCompletionPoll`. PRIMARY match `linkedResources[0].displayName == subject`; "No `MS_GRAPH_TOKEN`"; no `todo_task_id`/`todo_list_id`; native-list-tracking model. **This is the flow that scans the 60k list — the cleanup directly benefits it.** |
| **Weekly Retention Sweep** (Flow 4) | `weekly-retention-sweep.md` (2026-07-20) | Recurrence, weekly | **CURRENT.** See §4. The only flow that deletes (Processed/Duplicates >30d); explicitly out-of-scope of the staging folder. |
| **Outlook Intake to Teams** | repo-root `flow-outlook-intake-to-teams.json` | New email (V3) | **CURRENT host** (Railway). ⚠️ Hardcodes `disposition:"auto_filed"` / `target_folder:"Processed/General"` and **never emits `staged`** — see the note below. |
| **LCC Outlook Intake** | `lcc-outlook-intake.md` | — | **STALE host** — L19 points at `…nine.vercel.app/api/intake-outlook-message` (§3). |
| **LCC Flagged-email Intake** | `lcc-flagged-email-intake.md` | — | **CURRENT host** (Railway). |

**Retired custom Flag→To-Do artifacts still present in the repo (STALE — see §2/§3):**
`flow-email-flag-to-todo.json` (creates a custom task), `flow-todo-complete-unflag.json`
(15-min poll of custom lists + `[EmailID:]` unflag), `flow-personal-email-flag-to-todo.json`,
and docs `flagged-email-to-todo.md`, `flagged-email-to-todo-task.md`,
`flagged-personal-email-to-todo.md`, `unflag-completed-email-tasks.md`,
`recovery-reflag-completed-emails.md`, `sync-flagged-emails-to-supabase.md`,
`todo-lcc-sync.md`, and root `Power Automate - To Do Sync Flow.md`,
`Email-Flag-Flow-Setup-Guide.md`, `Personal-Outlook-Flow-Setup.md`.

> **`flow-outlook-intake-to-teams.json` note (needs Scott's eye):** it is on the
> right host but hardcodes `disposition:"auto_filed"` / `Processed/General` and
> never produces the `staged` outcome. If this JSON is the *deployed* "Outlook
> Intake to Teams" flow, it does not participate in the staging/To-Do loop at all
> (it just notifies + auto-files to General). Confirm whether the live flow in the
> designer matches this JSON or has diverged — the current architecture expects
> intake to route through `emitProcessingComplete` (which sets `staged` +
> `clear_flag:false`), not a hardcoded auto-file.

---

## 2. Deprecated-reference sweep

### `todo_task_map` / `todo_task_id` / `todo_list_id`

- **DB:** `supabase/migrations/20260720120000_lcc_todo_task_map.sql` CREATEs the
  table; `…20260721120000_lcc_todo_task_map_deprecate.sql` marks it deprecated
  (COMMENT), keeps it for reversibility. **Correct** (table has no live
  reader/writer).
- **Docs/tests that reference these only to DOCUMENT their retirement — CURRENT
  (leave):** `api/_shared/todo-completion.js:14,27`; `api/sync.js:2450,2515`;
  `todo-completion-poll.md`; `processing-complete-move-message.md`;
  `closing-the-loop-overview.md:96`; `docs/EMAIL_AUTO_ARCHIVE.md`;
  `test/todo-completion.test.mjs:3`.
- **⚠️ ONE live write survives — orthogonal, not the intake loop:**
  `api/operations.js:3213-3299` `createTodoTask()` is the **Copilot Studio
  `create_todo_task` agent action** — it creates a *custom* To-Do task in a "Work"
  list via Graph and writes `metadata:{ todo_task_id: task.id, … }` (L3289). It is
  **not** part of flagged-email intake/staging; it is a Copilot capability. It is
  also **effectively dead in this tenant** — it hard-requires `MS_GRAPH_TOKEN`
  (L3214), and the tenant blocks Graph app registrations, so it returns "not
  configured" / fails auth. **Recommendation:** leave functionally (it's inert),
  but flag it for removal in a Copilot-surface cleanup, and don't treat its
  `todo_task_id` metadata as evidence the retired intake mapping is still live — it
  isn't.

### `MS_GRAPH_TOKEN`

The intake/staging/completion loop **correctly never uses it** (all three current
flow specs state "LCC never calls Graph"). It remains referenced by **other,
non-intake** features that also can't actually work in the app-registration-blocked
tenant: `api/operations.js` (Copilot To-Do create, Outlook draft, OneDrive save,
mailto fallback), `api/_handlers/contacts-handler.js` (Teams messaging),
`api/admin.js:4642` (diag flag), `app.js:9155`, `.env.example:74`, and assorted
docs (`docs/RAILWAY_DEPLOYMENT.md:64`, `docs/testing/copilot_rollout_test_plan.md`,
`copilot_capability_map_lcc.md`, `copilot_wave1_build_plan.md`,
`touchpoint_execution_agent_roadmap.md`, `RENDER_MIGRATION_PLAN.md:77`). **Not a
loop inconsistency** — but a broad "Graph is unavailable in this tenant" reality
worth a separate capability-map note so nobody assumes these features work.

### Hardcoded Vercel hosts (`*.vercel.app`) — STALE (production is Railway)

The **live-risk** ones (flows/config that could actually be called):
- `docs/architecture/flows/lcc-outlook-intake.md:19`,
  `rcm-power-automate.md:20`, `loopnet-power-automate.md:20`,
  `http-parsejson-property-email.md:18`, `lcc-daily-briefing.md:20`,
  `lcc-weekday-briefing-email.md:50`, `lcc-morning-briefing.md:19`,
  `http-init-llc-repair-runbook.md:18`, `lcc-outlook-calendar-write.md:209`.
- Setup guides: `docs/setup/production_readiness_checklist_2026-04-22.md:54,69`,
  `docs/setup/LCC_OneDrive_Upload_Setup_2026-04-21.md:63`,
  `docs/setup/wave0_portal_configuration_guide.md:153`,
  `docs/MOBILE_SHARE_INGESTION.md`.
- Extension + flow JSON (could be a live caller):
  `extension/background.js` (multiple), `extension/outlook/taskpane.js:3`,
  `extension/outlook/manifest.xml`, `flow-rcm-backfill.json:63`,
  `flow-loopnet-backfill.json:63`, `flow-a-lcc-stage-om-http.json:28`,
  `.github/PA_FLOWS.md` (multiple), root `RCM_LOOPNET_FIX_INSTRUCTIONS.md`,
  `POWER_AUTOMATE_UPDATE_GUIDE.md`, `wave0-config-values.txt:20`.
- **Already handled / benign (leave):** `supabase/functions/_shared/cors.ts:11-12`
  (dead alias intentionally removed, comment explains); the
  `20260428150000_…railway_url.sql` migration (moved cron off Vercel);
  `docs/architecture/infrastructure_migration_plan.md` (intentional old→new mapping
  table); `docs/archive/openapi-legacy/**` (archived, expected).

> These are **doc/config strings**, not proof the live flows still call Vercel —
> but the Copilot audit (`lcc-microsoft-copilot-outlook-audit-2026-05-22.md:25`)
> confirms at least the **Copilot connector still carries `host:
> …nine.vercel.app`** and hits a dead host. So the Vercel deployment IS still
> being called by at least one live integration (§4).

---

## 3. Current intake / staging architecture (verified CURRENT)

- **`api/_shared/processing-complete.js`** — `STAGING_FOLDER = 'Intake Staged, Not
  Completed'`; `VALID_OUTCOMES = filed | needs_review | duplicate | staged`;
  `targetFolderFor()` (staged → staging folder; filed → `Processed/{Deals|Infra|
  Leads|General}`); `emitProcessingComplete()` resolves `final_target_folder` at
  staging time and sets `clear_flag=false` for `staged`; first-emit-wins
  idempotency.
- **`api/sync.js` `handleProcessingComplete`** — `clearFlag = outcome !== 'staged'`;
  forwards via `postMoveMessage`; 503/502 outcome-truthful.
- **`api/_shared/todo-completion.js`** — `buildStagedWorklist()` stamps
  `subject_ambiguous` cross-row via `normSubject()`; worklist items =
  `{internet_message_id, subject, staged_at, target_folder, clear_flag:true}`;
  `applyCompletionReports()` flips `staged → filed` idempotently (guarded on
  `outcome=staged`).
- **`api/sync.js` `handleTodoCompletionPoll`** — `?_route=todo-completion-poll`
  GET (worklist) / POST (report-back); auth `X-PA-Webhook-Secret`.
- **DB:** `public.processing_log` (`outcome`, `target_folder`,
  `final_target_folder`, `move_status`, `moved_at`); migrations
  `20260804120000_lcc_processing_log_auto_archive.sql` +
  `20260808120000_lcc_processing_log_staged.sql` (widened the CHECK to add
  `staged`, added `final_target_folder`).
- **Subject matching:** `displayName == subject` is PRIMARY (move-independent);
  `externalId` is an OWA ItemID that **drifts on move → unusable**;
  `subject_ambiguous` items never auto-file. **All consistent with the flow specs.**

---

## 4. Retention / cleanup (CURRENT) + the flagged-list cleanup's place

- **`weekly-retention-sweep.md` (Flow 4)** is the ONLY flow that deletes: weekly
  ~Sun 03:00 CT; delete branch = hard-coded `Processed/Duplicates` only, >30 days;
  archive branch = `Processed/*` (excl. Duplicates) >180 days → move to
  `Archive/LCC-Processed` (reversible). **The staging folder is explicitly
  out-of-scope.** This is a **mailbox-folder** retention sweep and is unrelated to
  the **To-Do task** backlog.
- **There is no existing flow that prunes the 60k "Flagged email" To-Do list** —
  that is the gap the new `flagged-email-cleanup-sweep.md` design fills. It is a
  **separate, new** flow (deletes To-Do *tasks*, not emails), with its own hard
  guard (`status=completed` AND completed 90d+), and it does **not** overlap or
  interfere with the Weekly Retention Sweep.

### 4.1 One-time 60k backlog cleanup — BLOCKED, pending IT (2026-07-23)

The go-forward `flagged-email-cleanup-sweep.md` flow (§4) prunes NEW completed
tasks, but the **existing ~60k-task backlog** on the "Flagged email" To-Do list
needs a one-time bulk delete that the sweep flow cannot reach. Investigation
2026-07-23 established that the only viable mechanism is blocked by tenant policy:

- **Path B (Power Automate `List to-do's (V2)` connector): dead.** Action is
  hard-capped at 50 items, exposes no `$top`/`$skip`/continuation cursor, returns
  newest-first, and the To-Do (Business) connector has no raw-HTTP action. The
  60k historical tasks are structurally unreachable through the connector.
- **Path A (one-shot Microsoft Graph script): viable in principle, blocked by
  tenant policy.** Raw Graph (`GET /me/todo/lists/{id}/tasks`) paginates fully
  via `@odata.nextLink`, so all tasks ARE reachable. Attempted delegated sign-in
  via Microsoft Graph PowerShell (`Connect-MgGraph -Scopes "Tasks.ReadWrite"`).
  **Result: AADSTS50105** — the *Microsoft Graph Command Line Tools* enterprise
  app has "Assignment required = Yes" and this user is not assigned. This is an
  **assignment** (not consent) block; app-substitution is not a valid workaround
  and would circumvent an explicit admin control.

**Ask for IT (smallest footprint first):**
1. **Preferred:** Assign the account to the existing *Microsoft Graph Command
   Line Tools* enterprise app — Entra admin center → Enterprise applications →
   Microsoft Graph Command Line Tools → Users and groups → Add user. Delegated
   `Tasks.ReadWrite`, scoped to **the user's own** To-Do only; no new app
   registration.
2. **Alt:** Register a single-tenant app (delegated `Tasks.ReadWrite`,
   public-client redirect `http://localhost`) and assign the user.
3. **Alt:** IT runs the one-shot cleanup script on the user's behalf.

**Scope / blast radius for approval:** delegated auth, the user's mailbox only,
read + delete of the user's own tasks — no org-wide permission, no application
permission.

**Recon-first discipline (do NOT skip):** once access lands, run a **read-only**
reconnaissance pass FIRST — enumerate every To-Do list with exact task counts +
active/completed split + created-date range (confirms WHERE the 60k live and that
`flaggedEmails` is the source before anything destructive). Only then run the
batched, 429-aware delete against the confirmed `listId`.

This is consistent with §2's finding that all `MS_GRAPH_TOKEN` features are inert
in the app-registration-blocked tenant — but note the SPECIFIC block here is
**assignment-required on a first-party app**, which IT can clear without any
registration.

---

## 5. Old Vercel deployment (`life-command-center-nine.vercel.app`) — shut down safely

**Finding:** production is Railway (Vercel retired 2026-07-20, `vercel.json`
deleted). But the Vercel deployment is **still live and still being called** by at
least the Copilot connector (`host: …nine.vercel.app`, per the 2026-05-22 Copilot
audit) and is referenced by numerous flow/setup docs. Left as-is it serves
**stale/outdated code** to any integration still pointed at it — a silent-wrong-
answer hazard.

**Recommended shutdown order (safest → done):**
1. **Do NOT delete the Vercel project first.** First **repoint every live caller**
   off the Vercel host to the Railway host: the Copilot Studio connector
   (owner-side edit — the one-line host fix noted in the Copilot audit §4A), the
   Chrome/Outlook extension (`extension/background.js`, `taskpane.js`,
   `manifest.xml`), and any PA flow / setup value still using `*.vercel.app`
   (grep list in §2). Verify each with a live call.
2. **Then neutralize the Vercel deployment — prefer a redirect over an immediate
   hard delete**, so a missed caller fails loud/observable rather than silently
   hitting stale code:
   - **Option A (recommended): replace the Vercel deployment with a catch-all
     redirect / 410** to the Railway host (a tiny `vercel.json` redirect or a
     single handler returning `308`/`410 Gone`). This turns any stragglers into an
     obvious redirect/error you can see in logs, not a stale-200. Keep it for a
     grace window (e.g. 2–4 weeks).
   - **Option B: pause the deployment** (Vercel project settings → disable
     production) — cheaper than a redirect shim but gives a generic error, not a
     redirect.
3. **Finally, delete the Vercel project** once logs show zero traffic to the host
   for the grace window. Deleting first (Option skipped) risks a silent break of a
   caller you missed; the repoint-then-redirect-then-delete order makes every
   straggler visible before anything is irreversibly removed.

---

## Recommended follow-up cleanups (surfaced, not done — all LOW-risk doc/JSON)
- Move the 10 retired custom-Flag→To-Do docs + 3 flow JSONs (§1) into
  `docs/archive/` (or add a "RETIRED — superseded by native-list tracking" header)
  so they can't be mistaken for current build sheets.
- Bulk-fix the live-risk `*.vercel.app` strings in the flow/setup docs + extension
  to the Railway host (§2), as part of the Vercel shutdown repoint (§5).
- Reconcile `flow-outlook-intake-to-teams.json` against the deployed flow (§1
  note) — confirm intake routes through `emitProcessingComplete` (staged), not a
  hardcoded auto-file.
- Remove or fence the dead Copilot `create_todo_task` action (§2) in a Copilot
  cleanup, and add a capability-map note that all `MS_GRAPH_TOKEN` features are
  inert in the app-registration-blocked tenant.
