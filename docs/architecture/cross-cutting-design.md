# Cross-Cutting Layers — design specs (build later, decide now)
_2026-07-27._ Design for each gap/redesign from `design-considerations.md`. Each: **what · design · plug-in · when.**

## H1 · Identity, Users, Roles & Permissions (RBAC)
**What:** who sees/does what as brokers, admin, and future users join.
**Design:**
- **Identity:** `lcc_users` = the person; each maps to `sf_user_id` + Outlook mailbox + (optional) a Claude/ChatGPT seat. Writes act *as* this identity (SF activity OwnerId, sending mailbox).
- **Membership/role:** `workspace_memberships(user, workspace, role)`. Role set (small): **Broker** (own deals/actions; log + SF-write on own deals), **Team Lead** (broker + team queue + reassign), **Admin** (all + config/autonomy/cadence), **Analyst** (comps/BOV/research production, no client-facing writes), **Viewer**.
- **Capabilities not screens:** grant by capability — `view_deal, edit_dossier, trigger_sf_write, send_email, reassign_action, edit_config, view_team_queue`. Role = a capability set.
- **Visibility:** every `activity_events`/`action_items`/dossier row already has `visibility_scope`(private/assigned/shared) + `owner_id`/`assigned_to` + `workspace_id`. Rule: a user sees **shared-in-workspace ∪ owned/assigned-to-them**; Lead/Admin also see team. Enforce with **RLS** (ties to `rls-hardening.sql`).
- **Acting-as:** SF write-back must stamp the **acting user's** `sf_user_id` (today it uses a system actor) so activities attribute correctly.
**Plug-in:** NBA queue filters by user/role; app "Today" is a per-user view; SF writes carry the acting identity.
**When:** **before the app "Today" home** (H1 is its prerequisite).

## H2 · Feedback / Learning loop (closed-loop)
**What:** the system tunes itself from outcomes instead of static rules.
**Design:**
- **Capture outcomes:** action completion (done/skipped/snoozed) + result; deal stage transitions + won/lost + reason; touch → response (reply detected via email pipeline); template perf (`GetTemplatePerformance` exists).
- **Learning job (periodic):** aggregates outcomes → proposes adjustments to (a) cadence intervals, (b) **NBA weights** (which factors predict done/valuable), (c) tier bands, (d) channel/template effectiveness.
- **Propose-not-silently-change:** writes suggestions to a review queue with an explanation ("tighten BD cadence — 2-touch responders convert 3×"); Admin approves → updates config.
**Plug-in:** reads `activity_events`/`action_items`/`bd_opportunities`; writes the config tables that the ranker + cadence read. Requires **R4 (configurable weights)**.
**When:** after NBA + cadence are live and producing outcome data.

## H3 · Autonomy & Trust ladder
**What:** one consistent policy for how much the system does on its own.
**Design:**
- **Four levels per action-type:** `AUTO` (do it), `PROPOSE` (draft/queue for 1-click), `CONFIRM` (ask first), `MANUAL` (human only).
- **Default by reversibility:** internal/reversible → AUTO (log call, file doc, rank, attribute email); external/irreversible → CONFIRM+ (send email, SF write, reassign). Matches what we already do (SF confirm gate, monitor notify-first) — now unified.
- **Trust escalation:** an action-type graduates CONFIRM→PROPOSE→AUTO as its acceptance/accuracy (from H2) crosses thresholds. Per-workspace `autonomy_policy` config; auditable.
**Plug-in:** every capability checks its level before acting; NBA "one-tap execute" honors it (AUTO auto-runs, PROPOSE shows a button, CONFIRM asks).
**When:** before broad draft-and-hold / intent outreach (Domain F, cadence Phase 3).

## H4 · Lifecycle off-ramps
**What:** the exits, not just BOV→close.
**Design:** add a `lifecycle_state` alongside `bd_opportunities.stage`:
- **LOST** (didn't win ELA / died) — stop active cadence, capture reason, log to Cortex, schedule a long-interval revive.
- **DORMANT** — no progress > threshold days-in-stage → stall flag → nudge → dormant.
- **REVIVED** — re-engaged → back into stage cadence.
- **Account ATTRITION** (bottom 20% post-7, no engagement) → attrition-review action → drop from active cadence (archive, not delete).
**Plug-in:** `cadence-scan`/monitor detect stall+no-engagement and emit off-ramp `action_items`; revival = a quarterly re-touch cadence.
**When:** with cadence Phase 1–2 (so the monitor doesn't nag dead deals).

## H5 · Pipeline resilience & explainability
**What:** the async web (email, SF sync, drainer, monitor, intent) fails safely and is explainable.
**Design (cross-cutting standard):**
- **Idempotency** — every writer carries an external key (email `message_id`, `action external_id`, queue rows) and upserts (we did property_documents; generalize).
- **Dead-letter** — failed items → `status=failed` + a dead-letter record (generalize the SF flow's `lcc_record_flow_failure`) → a review queue.
- **Reconciliation** — periodic reconcilers detect enqueued-not-processed / LCC↔SF drift and repair or flag (owner-reconcile is the template).
- **Self-monitoring** — surface `GetSyncRunHealth` + `pipeline_velocity` as a pipeline-health monitor (alert if email pipeline or drainer stalls).
- **Explainability** — a standard `reason`/provenance field on every ranked action + every attribution (email→deal carries its match signal); app shows "why" on demand.
**When:** fold into each pipeline as it's built (a checklist, not a separate build).

## R1 · Dossier `.md` = pure render of the LCC dossier (one writer)
**What:** kill the two-writer drift.
**Design:** LCC dossier (entities + `activity_events` projection) is the system of record. The SharePoint `.md`
becomes a **rendered output** (regenerated from `get_deal_dossier` on change), using the canon render/parity pattern.
Folder-watch's role shifts from "append the `.md`" to "signal file/activity into `activity_events`"; the `.md`
re-renders from the one source.
**When:** bake in **now** while only Fresenius is seeded (cheap now, expensive later).

## R2 · Collapse the two-server topology (unification Phase 2)
**What:** remove the root-proxy + mcp-engine split that caused this session's deploy bug.
**Design:** one service serving both the public HTTP routes and the MCP engine/tool logic — single package.json, single
deploy context, no `../api` cross-context imports; tool logic + HTTP surface co-located. Preserve external URLs
(tranquil-delight / GOV_API_URL) across cutover; do it in a branch, verify parity, then retire the standby.
**When:** a dedicated maintenance window; before the surface count/complexity grows further.

## R3 · v4 connector repave
**What:** end the v3(94)+v4(53)+~65-action-agent drift.
**Design:** execution, not new design — replace the connector definition with **v4 (53 clean ops)**, remove all agent
actions, re-add the 53 from the finalized list (`LCC-Deal-Agent-Actions-Finalized.html`), delete duplicates/orphans.
**When:** a maintenance window after write-back testing settles.

## R4 · NBA ranker = configurable weights
**What:** make the prioritization tunable/learnable from day one.
**Design:** store the score factors + weights + band thresholds in an `nba_scoring_config` table (not hardcoded); the
ranker reads it; changing priorities = a config edit, no deploy. H2's learning loop tunes these weights.
**When:** **build the NBA ranker this way from the start** (NBA2) — don't hardcode then refactor.

## Sequencing summary
- **Bake in now:** R1 (one-writer dossier), R4 (configurable weights).
- **Design-prereq for the app:** H1 (RBAC) before the "Today" home.
- **Fold into builds as reached:** H4 with cadence; H5 per pipeline; H3 before draft/intent autonomy; H2 after outcomes exist.
- **Maintenance windows:** R2 (two-server collapse), R3 (connector repave).
