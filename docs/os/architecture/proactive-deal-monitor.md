# Proactive Deal Monitor — architecture & design
_Design draft, 2026-07-27._ Automation-plane capstone: watch active deals at their checkpoints and
proactively surface (and optionally draft) what needs attention, until close.

## Vision
"An automatic monitor at checkpoints that updates until close." The Monitor doesn't replace judgment — it
removes the *watching* burden: nothing time-sensitive on a deal slips because a human forgot to look.

## It sits on what we already shipped
- **`list_deal_checkpoints`** already computes per-deal `overdue / due-soon / pending / met / waived` from
  `activity_events` milestones. ← the Monitor's core signal.
- **Dossier** holds the living deal state; **Cortex** holds durable memory.
- **Existing tools it composes** (no new capability needed): `get_daily_briefing`, `GenerateTeamsCard`,
  `DraftSellerUpdateEmail` / `DraftOutreachEmail`, `update_deal_dossier`.
So the Monitor is mostly a **scheduled orchestrator + one new scan endpoint**, not a new subsystem.

## The loop
```
(schedule: weekday AM + event-driven on milestone change)
  1. SCAN     engine: /api/deal/monitor → for every ACTIVE deal, collect flagged checkpoints + staleness
  2. RANK     overdue → due-soon → stale; dedupe; bound to top-N (surface-safe digest)
  3. ROUTE    a) feed the daily briefing (pull surface — every AI door sees it)
              b) push a Teams card / email for OVERDUE + urgent (proactive)
              c) log a monitor observation to the dossier (activity_events, category=system) + Cortex
  4. (opt) DRAFT-AND-HOLD  for a due-soon touchpoint, draft a nudge into Outlook drafts — never auto-sent
  5. CLOSE    milestones flip to met/waived via mail-intake, manual dossier update, or in-agent confirm →
              the Monitor stops flagging them. Each scan's actions are audit-logged.
```

## New piece to build — the scan endpoint
`POST /api/deal/monitor` (engine, `mcp/`), returns a bounded, ranked digest:
```json
{ "generated_at": "...", "counts": {"overdue":N,"due_soon":N,"stale":N},
  "items": [ { "entity_id","deal","flag":"overdue|due-soon|stale","milestone","date","days_out","last_activity_at" } ] }
```
- **Active-deal definition (v1):** an `entity_type='asset'` with ≥1 milestone whose status ∈ (pending, overdue)
  — i.e., open checkpoints remain. (v2: a real deal stage/status field once we add one.)
- **Staleness:** no `activity_events` for the deal in > `STALE_DAYS` (default 14) while still open.
- Reuses `checkpointFlags()` from `deal-dossier-tools.js` across all active deals (one query + in-proc rank).

## Actions & policy (governance)
- **Notify-first, never auto-act externally.** The Monitor surfaces and *drafts*; it never sends email or writes
  Salesforce on its own. External sends + SF writes stay human-in-loop (the confirmation pattern we built).
- **Distill before egress.** Teams/email digests are summaries, not raw deal data.
- **One writer per artifact.** The Monitor writes only its own observation events; it doesn't mutate milestones
  (those are set by the dossier's writers / mail-intake).
- **Escalation ladder:** pending → (in daily brief) → due-soon → (brief + gentle flag) → overdue → (Teams/email
  push) → overdue > `ESCALATE_DAYS` → escalated/highlighted.

## Integration points
- **Daily briefing** — the digest's items merge into `get_daily_briefing` so every surface (Copilot, ChatGPT,
  Claude) sees "deals needing attention" without a separate check. (Pull.)
- **Teams / email** — proactive push for overdue/urgent via `GenerateTeamsCard` or a PA email step. (Push.)
- **Mail-intake (future)** — inbound deal-mail that satisfies a milestone (CO received, estoppel delivered)
  flips its status → the Monitor's next scan drops it. This is the "updates until close" loop closing itself.

## Build sequence (phased)
- **Phase 1 — Notify-only.** Scan endpoint + a weekday-AM Power Automate recurrence that calls it and posts an
  overdue/due-soon Teams card (or email). Proves the loop; zero autonomy risk.
- **Phase 2 — Briefing merge + staleness.** Feed the digest into the daily briefing; add stale-deal detection.
- **Phase 3 — Draft-and-hold.** For select checkpoints, auto-draft a nudge into Outlook drafts for review.
- **Phase 4 — Event-driven.** Mail-intake / dossier updates trigger a targeted re-scan so flags clear in near-real-time.

## Open design decisions (for Scott)
1. **Cadence** — weekday morning only, or twice daily (AM + mid-afternoon)?
2. **Primary channel** — Teams adaptive card, email digest, or ride the existing morning brief?
3. **Active-deal scope** — "any asset with open milestones" (v1 heuristic) enough, or do we add an explicit
   deal stage/status field now so monitoring is precise?
4. **Autonomy** — stay notify-only for a while, or go to draft-and-hold (Phase 3) sooner for routine nudges?
