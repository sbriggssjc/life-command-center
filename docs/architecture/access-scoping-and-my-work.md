# Access Scoping — My Work, Team Queue, and Correspondence Privacy (design + status, 2026-07-31)

**Trigger:** Scott's My Work is cluttered with team members' deals/BOVs he isn't the point person on
(e.g. *Innovative Renal Care MOB – Milwaukee* is Kelly's listing/BOV but sits at the top of Scott's
My Work). Requirements from Scott:
1. **My Work (any logged-in user)** shows only the deals/topics *that user* is working or should be
   working, in prioritized order. Not the whole team's.
2. **Team Queue** — the full team list + per-deal correspondence — is visible to **Scott only** (team
   lead). Kelly / Sarah / Nate do **not** get a Team-Queue list of everyone's work.
3. **Correspondence privacy** — a logged-in user can only see/review the correspondence *they* have
   with a person. Kelly viewing a deal sees her correspondence, not Scott's.
4. Everyone can still **find** any deal/BOV via search — the restriction is on the Team-Queue list and
   on whose correspondence is shown, not on discoverability.

## Root cause (why the clutter happens today)
`v_my_work` exposes `action_items.owner_id AS user_id`, and `queue.js` filters My Work by
`or=(user_id.eq.<authId>, assigned_to.eq.<authId>)`. But the deal next-step to-dos are created by the
auto-engine with **`owner_id = the system actor`** (`b0000000-…`) and `assigned_to = null` — they are
**not** scoped to the deal's point person. In dev/admin, Scott resolves to the system/admin identity,
so every system-owned to-do shows up as "his." Verified on *Innovative Renal Care*: the to-do's
`owner_id = b0000000-…`, but the deal's point-person override is **Kelly Largent**.

The point-person truth already exists: **`lcc_entity_owner_override.owner_user_id`** → `lcc_users`
(Scott/Kelly/Sarah/Nate). This is the FK-safe ownership channel (`action_items.owner_id/assigned_to`
FK the *auth* `users` table, which does not hold the reps). **31 of 40 open deals** already carry a
point-person override.

## Identity mapping
`authenticate()` returns `{ id (auth), email, … }`. `lcc_users` keys on **email**
(`lcc_users.email` → `lcc_user_id`, `role`). So: logged-in `user.email` → `lcc_users.lcc_user_id` +
`role`. Roster: **Scott = role `advisor` (team lead)**; Kelly / Nate / Sarah = role `team`.

## Built + verified (this session)
**`v_my_work_scoped`** (migration `20260818280000`) — action items with the deal's point person
resolved: adds `pointperson_user_id` (from `lcc_entity_owner_override` on `entity_id`) +
`pointperson_name`. Additive; `v_my_work` / `v_team_queue` untouched. Verified split of the
`deal_next_step` to-dos:

| Point person | My Work items |
|---|---|
| Kelly Largent | 17 |
| Scott Briggs | 13 |
| (unassigned → Team Queue / lead) | 1 |

So with scoping, Scott's My Work drops from 31 → **13 (his own)**; Kelly gets her **17**; Innovative
Renal Care leaves Scott's My Work and lives in the Team Queue (Scott-only).

## IMPLEMENTED (2026-07-31, ships on redeploy) — smoke-test per user
`queue.js` now scopes My Work by point person and gates Team Queue to the lead:
- **`resolveLccIdentity(user)`** maps `user.email` -> `{ lccUserId, role, isLead }` (`role='advisor'`
  = lead), cached on the request user.
- **`myWorkScopedPath()`** builds `v_my_work_scoped?...&or=(pointperson_user_id.eq.<lcc>,and(pointperson_user_id.is.null,or(user_id.eq.<auth>,assigned_to.eq.<auth>)))`,
  with a legacy `v_my_work` fallback when the user isn't mapped. Applied to **v1 `my_work`**,
  **v2 `v2GetMyWork`**, and the **v1 `counts`** probe.
- **Team Queue** (v1 `team`, v2 `v2GetTeamQueue`) returns `{ items:[], restricted:true }` for non-leads.
- **DB-validated:** the scoped filter yields Scott ~14 (his own) and Kelly 17 (hers) — Kelly's deals
  no longer appear in Scott's My Work; point-person match is independent of the auth id.

**Smoke test before trusting (can't be done from the backend session):** log in as Scott — My Work
shows only his deals, Team Queue shows all; log in as a `team` user (Kelly) — My Work shows only hers,
Team Queue is empty/restricted.

**Known follow-ups:**
- **v2 `work_counts` badge** reads `mv_user_work_counts` keyed by auth `user_id`; it is NOT yet
  point-person-scoped, so the Today badge may not match the scoped My Work list until that MV is made
  point-person-aware (or the badge reads the scoped count). The v1 `counts` probe IS scoped.
- **Frontend Team Queue subtab** still renders for everyone; the backend gate protects the data, but
  hide the subtab for non-leads (reuse `_teamQueueDisabledHTML()`) once the client knows `isLead`.
- **Research rows**: `v_my_work_scoped` is actions-only (see caveat below).

## Original spec (queue.js) — for reference
Security-sensitive (a wrong filter either leaks others' work or hides a user's own), and it can't be
tested from the backend session (no per-user login), so implement + smoke-test as each user.

1. **Resolve lcc identity** once per request (helper):
   ```js
   // email -> { lccUserId, role, isLead }
   const r = await opsQuery('GET',
     `lcc_users?email=eq.${encodeURIComponent((user.email||'').toLowerCase())}&select=lcc_user_id,role&limit=1`);
   const row = r.data?.[0]; const lccUserId = row?.lcc_user_id || null;
   const isLead = row?.role === 'advisor';
   ```
2. **My Work** (both v1 `case 'my_work'` and v2 `v2GetMyWork`): when `lccUserId` is known, read
   `v_my_work_scoped` scoped to the point person, keeping personal (non-deal) items owned/assigned to me:
   ```
   v_my_work_scoped?workspace_id=eq.<ws>
     &or=(pointperson_user_id.eq.<lccUserId>,
          and(pointperson_user_id.is.null,or(user_id.eq.<authId>,assigned_to.eq.<authId>)))
   ```
   Fallback to the legacy `v_my_work` filter when `lccUserId` is null (unmapped user) so nothing breaks.
   Keep the existing `order`/pagination/`countMode:'exact'`.
3. **Team Queue** (v1 `case 'team'`, v2 `v2GetTeamQueue`): **gate on `isLead`**. If not lead, return
   `{ items: [], count: 0, restricted: true }` (or the caller's own scoped work). Only Scott (advisor)
   gets the full `v_team_queue`.
4. **work_counts**: recompute the My Work count off the same scoped filter so the Today badge matches.
5. **Frontend** (`index.html` / `app.js`): hide the **Team Queue** subtab unless `isLead`
   (the app already has `_teamQueueDisabledHTML()` for the disabled state — reuse it for non-leads).

**Caveat to confirm:** `v_my_work_scoped` is action-items-only. Today's My Work query
(`item_type=neq.inbox`) also carries **research** rows. If research tasks should remain in My Work,
either add a research branch to `v_my_work_scoped` (scoped by `user_id`, `pointperson_user_id` null →
personal fallback) or surface research on its own tab. The My Work screenshot is all action items, so
actions-only is acceptable for v1 — flagged so we don't silently drop research.

## Correspondence privacy (Phase 2 — design only; not implemented)
Requirement: a user sees only the correspondence *they* participated in. The deal spine
(`activity_events`, `source_type in (email_intake, outlook_inbound, outlook_sent, …)`) currently has no
per-user visibility filter — anyone viewing a deal sees all its mail.
Design options (to decide next):
- **Participant stamp + filter.** Stamp each correspondence row with the LCC user(s) who
  sent/received it (from the `from`/`to` mailbox owner → `lcc_users.email`), then filter the deal
  timeline to `participant = me` for non-leads; the lead (Scott) sees all. Cleanest and matches the
  point-person model. Requires a `participant_user_id` (or array) on `activity_events` + a backfill
  from the existing `metadata.from`/`to`.
- **Mailbox-scoped ingestion.** Longer term, each rep's Outlook flow stamps their own mail with their
  `lcc_user_id` at ingestion, so privacy is intrinsic. (The current backfill runs from one mailbox.)
- **Lead override.** Scott (advisor) always sees all correspondence (Team Queue semantics).
This is a broader access-control change (touches the deal dossier, offer context, cadence, My Day
recent[]), so it's staged as its own phase with the participant-stamp approach recommended.

## Rollout order
1. Team Queue lead-gate + hide the subtab for non-leads (low risk). 
2. My Work point-person scoping via `v_my_work_scoped` (+ smoke-test as Scott and as a `team` user).
3. Correspondence participant-stamp + per-user timeline filter (Phase 2).

## Connections
- **Owner reconciliation engine** feeds the point-person overrides that drive this scoping; improving
  deal-owner coverage (currently 31/40 open deals) directly improves My Work accuracy.
- **Deal correspondence pipeline** is what Team Queue / correspondence-privacy governs the visibility of.
