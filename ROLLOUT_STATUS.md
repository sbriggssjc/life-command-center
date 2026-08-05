# ROLLOUT_STATUS

Live rollout ledger for sequenced build waves. Newest wave on top. Each row: what
shipped, where it lives, and the operator switch (if any) that lights it up.

---

## Wave 7 — Comms-driven context propagation
Plan: `docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md`

| Unit | State | Summary |
|---|---|---|
| **W7.1** Correspondence attribution goes LIVE | **BUILT — awaiting flag flip** | Matcher on an hourly cron (flag-gated), deal-mapping at ingest via the authoritative roster, historical backfill plumbing drop-in. |
| **W7.2** The propagation tick | **BUILT — awaiting flag flip** | Hourly consumer on deal-stamped correspondence → summary / milestone / next-step / dossier + packet refresh. Own ledger seam; LLM summarizes/proposes only. |
| **W7.3** Call notes + Microsoft-side capture | **BUILT — awaiting flag flip / connector** | Three capture paths, one spine shape: in-app quick-log (`/api/intake-log-call`), Copilot actions (`log_call_note` + `tag_comm_to_deal`), Outlook category tagging (`/api/intake-tagged-comm`, flag `TAGGED_COMM_INTAKE`). All land as deal-stamped `activity_events` → W7.2 propagates them with zero new propagation code. |
| W7.4 Role evolution + open-issues | not started | |

### W7.1 — session log (2026-08-06)
Branch `claude/deal-correspondence-attribution-live-s8ta63`.

**A. Matcher on a cadence.**
- Full-corpus **dry-run report** produced (deterministic SQL replication of the v2.1 engine):
  37 in-scope open deals, 16 would attribute (~306 candidate attributions), 21 zero-match
  (recall gap, not precision). Precision held — no same-operator/different-city bleed. Report:
  `docs/architecture/W7_1_deal_email_match_dryrun_2026-08-06.md` (Scott's approval gate).
- **Cron wrapper** `api/_handlers/deal-email-match-cron.js` runs the SAME matcher engine
  (no logic fork), writes one `lcc_deal_match_run_log` row/run (observable stats line),
  and opens a **deduped `lcc_health_alerts` (cron_failure / deal_email_matcher)** only on
  two consecutive failed runs (loud-failure like other crons).
- Route `POST /api/pipeline/match-deal-emails-cron` (X-LCC-Key), mounted in `server.js`.
- pg_cron `lcc-deal-email-match` (hourly, `17 * * * *`) → `lcc_cron_post` → the route. **Inert**
  until `DEAL_EMAIL_MATCH_ENABLED` is set in Railway (feature flag `DEAL_EMAIL_MATCH_CRON`).
  `?force=1` runs once regardless; `?dry_run=1` reports and writes nothing.
- **Operator switch:** approve the dry-run → set `DEAL_EMAIL_MATCH_ENABLED=1` in Railway,
  flip the `feature_flags_registry.DEAL_EMAIL_MATCH_CRON` row to `on`.

**B. Ongoing-capture tightening (deal mapping at INGEST).**
- `lcc_resolve_contact` (migration `20260806120000`) now maps a counterparty → the DEAL via
  the **authoritative `deal_party` roster** (`email_derived` + `sf_opp_team` edges) and
  `metadata.primary_contact`, not only via a prior body-mention. Both `handleOutlookSent` and
  `logInboundCorrespondenceDualAnchor` read `primary_deal`, so a known deal party self-stamps
  `deal_entity_id` at ingest. Verified live: an `email_derived` party resolves to its deal.
- **Conversation-thread continuity:** a reply on a thread whose prior message is deal-stamped
  inherits that deal stamp (`metadata.conversation_id`), on both the inbound
  (`intake-correspondence.js`) and sent (`intake.js`) paths.
- Verified both live-mail handlers (`handleOutlookMessage` inbound flag path,
  `handleOutlookSent`) route through the dual-anchor loggers.

**C. Historical backfill plumbing (connector-ready).**
- `lcc_deal_correspondents(deal)` + the backfill receiver already exist
  (`/api/deal-correspondence-backfill`); added the design-named alias
  **`POST /api/intake-deal-backfill`** (same handler/contract) so the connector work is drop-in.
- Flow spec documented for the operator: `docs/setup/power-automate-deal-thread-search.md`.

**Doctrine held:** matcher precision unchanged (city required, word-boundary, digest excluded);
no LLM in attribution; idempotent by `(entity_id, external_id)` / `internet_message_id`; all DB
work additive + reversible.

### W7.2 — session log (2026-08-06)
Branch `claude/deal-comms-propagation-tick-eiaaxn`. Migration
`20260806140000_lcc_w7_2_deal_comms_propagate.sql` (applied live to LCC Opps
`xengecqvemvfknjvbvrq`). One tick, four propagations over the deal-stamped comm backlog.

**The tick** — `GET|POST /api/deal-comms-propagate-tick`
(`api/_handlers/deal-comms-propagate-tick.js`), mounted in `server.js` (X-LCC-Key). pg_cron
`lcc-deal-comms-propagate` (`32 * * * *`, ~15min after the W7.1 matcher at `:17`) → `lcc_cron_post`.
**Inert** until `DEAL_COMMS_PROPAGATE_ENABLED` (flag `DEAL_COMMS_PROPAGATE_CRON`); `?force=1` runs one
live tick, `?dry_run=1` reports only. Bounded to `DEAL_COMMS_PROPAGATE_MAX_DEALS` (default 10),
oldest-backlog first — the ledger makes catch-up automatic.

- **Seam = its own ledger** `lcc_deal_comm_propagated (activity_event_id pk)` — a consumed comm never
  reprocesses; re-runs no-op. Batch read: `lcc_deal_comms_unpropagated()` returns the deals with new
  (un-ledgered) comms, each carrying its full comm corpus + per-comm `is_new`/`is_inbound`/`is_recent`,
  reconciling direction/sender/subject/body across both stamp shapes (`lcc:deal_match` join to
  `email_bodies`, ingest dual-anchor via `metadata`). Run-log `lcc_deal_comms_propagation_run_log`
  (mirrors W7.1).
- **1. Correspondence summary** — regenerated via `invokeExtractionAI` (Ollama/GaryBuilt primary) from
  the deal's full comm corpus (inbound AND Team Briggs sent), no-fabrication contract, older threads
  compressed. **is_current versioned** (demote prior, insert new; never update-in-place). AI down/empty
  ⇒ keep the prior row, count `summary_skipped`, move on.
- **2. Milestones** — DETERMINISTIC cues (`api/_shared/deal-milestone-cues.js`, word-boundary LOI/PSA/
  escrow/EMD/DD/financing/marketing/close) write `lcc_deal_milestone` directly via idempotent
  `lcc_deal_record_milestone` (`source='comms_tick'`, `detail_ref`=activity id). An LLM-only candidate
  with **no** cue opens a `milestone_confirm` Decision-Center lane (subject_ref `mstone:<entity>:<key>:<date>`);
  approve writes the milestone (`source='comms_tick_confirmed'`). **No LLM verdict writes a milestone directly.**
- **3. Next-step to-dos** — reuses the Phase-1 `deriveNextStep` → `lcc_advance_todos` path (NOT forked)
  for recent (≤7d) INBOUND matcher-backfill comms only; ingest dual-anchor rows already ran it. The
  existence-guard dedupes (counted).
- **4. Dossier + packets** — `buildDealPacket` already includes the correspondence summary, so the
  refreshed summary changes `source_hash`; for deals with a stored deal dossier the tick regenerates
  on-changed-hash (reuse-if-fresh makes it cheap). `context_packets` for the deal are invalidated (TTL
  generate-on-demand — the existing context-broker path rebuilds on next fetch; no new generator).

- **Operator switch:** set `DEAL_COMMS_PROPAGATE_ENABLED=1` in Railway, flip
  `feature_flags_registry.DEAL_COMMS_PROPAGATE_CRON` to `on`. Verify: dry-run first, then a live tick
  over the 312-comm backlog (15 deals get is_current summaries citing real activity ids; Woodland Hills
  is the gold standard); a fresh test email → next tick refreshes that deal's summary + Phase-1 to-do +
  dossier regen on the changed hash.
- **Grounded live:** batch reader returns 20+ deals oldest-first with correct is_new/inbound/recent
  flags; `lcc_deal_record_milestone` verified idempotent (first insert `t`, re-emit `f`); the
  `milestone_confirm` lane opens as a seeded decision — all via a self-rolled-back synthetic gate (0 residue).
- **Tests:** `test/deal-milestone-cues.test.mjs` (19), `test/deal-comms-summary.test.mjs` (7),
  `test/deal-comms-propagate-tick.test.mjs` (10, fetch-level mocks per the W7.1 posture) — idempotency,
  summary versioning flip, deterministic cue write w/ detail_ref, LLM-candidate → confirm lane (no write),
  recent-inbound-only to-dos + dedupe, AI-failure keeps prior summary + counts skip, dry-run/flag-off.

**Doctrine held:** LLM summarizes/proposes only — every auditable write (milestones from cues, to-dos via
the Phase-1 guard, ledger rows) is deterministic; own seam only; additive + reversible + idempotent + dry-run.

### W7.2c — propagation refinements (2026-08-06)
Migration `20260806150000_lcc_w7_2c_propagation_refinements.sql` (applied live to LCC Opps
`xengecqvemvfknjvbvrq`). Four refinements from W7.2's first live batch; all backward-safe against the running
tick (`DEAL_COMMS_PROPAGATE_CRON` on) — ledger/run-log changes are additive, the collapse is per-deal
advisory-locked with the live writer.

1. **Milestone same-key collapse (the Banning finding).** `lcc_deal_record_milestone` now returns
   `{outcome:inserted|rolled_up|new_round|noop,id}`. Per `(entity_id, milestone_key)` the FIRST occurrence is
   THE row; a re-occurrence rolls up into `metadata.{occurrence_count,first_on,last_seen_on,last_detail_ref,
   occurrences[≤20]}` — no new row — UNLESS the prior same-key row is >90d stale AND the deal stage regressed
   (deal's max `lcc_milestone_stage_rank` > this key's rank), which opens a genuinely new round. Same-evidence
   re-feed = noop (idempotent). The rule is the canonical spec in `api/_shared/deal-milestone-collapse.js`; the
   SQL writer + the one-shot collapse mirror it. **Collapse ran live: `lcc_deal_milestone` 41→21 rows, 20 backed
   up to `_lcc_milestone_collapse_20260806_backup` (reversible), 6 rows now carry an occurrence roll-up.**
   Banning's 6+ `loi` rows became 3 genuine LOI rounds (first 2024-12-13 ×9 last 2025-02-20; a new round
   2025-09-30 ×4; a new round 2026-03-31 ×1) — the repetition IS the signal. The dossier milestones panel now
   renders "LOI — first …, discussed ×N, last …" (`dossier-generator.js`; `lcc_deal_spine` surfaces the
   occurrence metadata).
2. **Briefing "what changed on your deals" delta.** New deterministic (NO LLM) section — `fetchDealPropagationDelta(24)`
   (`briefing-data.js`) aggregates the propagation ledger (`lcc_deal_comm_propagated.actions`) + the two
   deal-level writes it drove (comms_tick summary refresh, w7.2_tick dossier regen) into one deep-linked line
   per deal touched in 24h (new comms / summary refreshed / milestones written+rolled-up by key / to-dos /
   dossier). Rendered HTML+text (`renderDealPropagationDelta`), omitted entirely when empty.
3. **Incremental summary compression.** The summary row's `metadata` now persists `compressed_block` +
   `compressed_through_at`/`compressed_through_activity_id`. Next regeneration feeds the compressed history +
   only comms newer than the watermark (`buildIncrementalSummaryPrompt`), producing the new summary AND an
   updated compressed_block — no-fabrication extended to the compression (restate prior only). First run per
   deal (no watermark) = full-corpus as before. Input sizes logged (`slice=N/corpus`).
4. **Reply-SLA to-dos (deterministic, highest-ROI).** `lcc_deal_reply_sla_candidates(days,limit)` returns open
   in-scope deals (open bd_opportunity, not paused/on_hold) whose latest deal-stamped comm is INBOUND with
   >`DEAL_COMMS_REPLY_SLA_DAYS` (default 3) business days elapsed and no outbound since. The tick generates one
   guarded `reply_overdue` to-do per deal via a new `reply_sla` branch on `lcc_advance_todos` (existence-guard =
   one open per deal; an outbound reply auto-clears it). **Live dry-count: 1 deal currently trips the SLA**
   (Scott sanity-checks before enabling more broadly).

- Run-log: additive `milestones_rolled_up`, `reply_overdue_generated`.
- **Tests:** `deal-milestone-collapse.test.mjs` (8 — rank order, insert/roll-up/new-round incl. stale+regressed,
  idempotent noop, boundary cases), `deal-comms-incremental-summary.test.mjs` (3 — prompt slice + compressed_block
  round-trip), `deal-propagation-briefing-delta.test.mjs` (2 — ledger aggregation + empty-omit), and the extended
  `deal-comms-propagate-tick.test.mjs` (reply-SLA generate/dedupe/dry-count, rolled_up counting).
- **Reversal:** runbook in the migration header (`_lcc_milestone_collapse_20260806_backup` restore + revert the
  three functions).

### W7.3 — session log (call notes + Microsoft-side capture)
Branch `claude/call-notes-microsoft-capture-0eg1yp`. Migration
`20260821120000_lcc_w7_3_call_notes_capture.sql` (additive — feature_flags_registry row only; no new tables).

Three capture paths, ONE spine shape. Everything lands as `activity_events` (category `call`/`email`)
deal-stamped where known, through the EXISTING dual-anchor spine (`appendActivityEvent`) — so the LIVE
W7.2 tick propagates it with **zero new propagation code** (the tick keys on `metadata.deal_entity_id`).
The W7.2 tick was NOT touched.

- **A. Quick-log call (in-app).** New shared logger `logManualCallNote` (`api/_shared/intake-correspondence.js`)
  reuses the spine writer + Phase-1 `deriveNextStep`→`lcc_advance_todos` (a note that states a commitment
  produces that to-do). Route `POST /api/intake-log-call` (`intake.js::handleLogCall`). Frontend: a deal-surface
  **Log call** button in the entity slide-over header (`detail.js`, self-contained modal → `openCallNote`/
  `submitCallNote`), distinct from the existing Salesforce-task `openLogCall`. Ollama structuring
  (`structureCallNotes`) is PROPOSAL-ONLY + gated on `OLLAMA_URL`; any AI failure logs the raw notes unchanged.
- **B. Copilot actions.** `log_call_note` + `tag_comm_to_deal` (`operations.js`, registered in
  `ACTION_REGISTRY` + `ACTION_SCHEMAS` + both registry docs). Deal resolution NEVER guesses — ambiguous →
  candidates + writes nothing (`resolveDealByQuery`, no LLM in the gate). `tag_comm_to_deal` is the manual
  override for the 21 zero-match deals / matcher misses; idempotent, REFUSES a cross-deal re-stamp
  (`decideCommTagOutcome` → conflict surfaced).
- **C. Outlook category tagging (zero-UI, works at send time).** Receiver `POST /api/intake-tagged-comm`
  (`api/_handlers/intake-tagged-comm.js`, X-PA-Webhook-Secret auth, flag `TAGGED_COMM_INTAKE`). Resolves the
  deal by `LCC:<hint>` → sender (`lcc_resolve_contact`) → conversation continuity → else PARKS a
  `research_tasks` `tag_unresolved` row (idempotent) rather than guessing. Logs deal-stamped, idempotent on
  `internet_message_id`. PA flow spec: `docs/setup/OUTLOOK_CATEGORY_TAGGING_FLOW.md`.

- **Tests:** `test/manual-call-note.test.mjs` (14 — dual-anchor stamp, empty-notes skip, deterministic dedup,
  AI-fail→raw-text, no-anchor no-todo, structuring gated on OLLAMA_URL, resolver ambiguity/exact/none, tag
  outcome, category-hint parse) + `test/tagged-comm-receiver.test.mjs` (5 — hint/sender/conversation/unresolved
  resolution + idempotent parking). All pass; boot check + subroute-dispatch guard green.
- **Awaiting (env/connector, not code):** flip `TAGGED_COMM_INTAKE_ENABLED` + set `PA_WEBHOOK_SECRET` and build
  the PA flow (path C); `OLLAMA_URL` already live (Aug 4) so structuring is active. Paths A + B are live on
  redeploy. **Verify (Scott):** (1) quick-log a call on an open deal → next tick updates its summary + any
  commitment to-do; (2) from Copilot run `log_call_note` + `tag_comm_to_deal` on a real email; (3) categorize a
  sent email `LCC:<deal>` → receiver logs it deal-stamped. All three visible in the deal's next summary regen.
