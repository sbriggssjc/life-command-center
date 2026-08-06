# Wave 7 — Comms-Driven Context Propagation (email/call → dossier/tasks/next-steps, automatically)

> **Scott's directive (2026-08-06):** "every time an email or call on the topic is sent or notes
> taken or logged," the LCC should automatically adjust to-do lists, next steps/action items,
> the deal dossier, and context packets. This plan consolidates the EXISTING dossier-program
> designs into a sequenced build. Tracked as Wave 7 in ROLLOUT_STATUS; also backlog #19 in
> `AUDIT_REFRESH_2026-08-06.md`.

## 0. What already exists (grounded 2026-08-06 — do not rebuild)

| Piece | State | Where |
|---|---|---|
| Email corpus flowing in | **22,881 rows** in `email_bodies` (subject/from/to/conversation_id/received_at, sent+received) | Outlook bridge (`bridge-handlers-outlook.js`) |
| Deal spine tables | LIVE (migration `20260820120000_lcc_deal_spine`): `lcc_deal_milestone` (3 rows), `lcc_deal_correspondence_summary` (1), `lcc_deal_diligence`, `lcc_deal_document`, `lcc_deal_commission`, `lcc_deal_conflict`, `lcc_dossiers` (1) | LCC Opps |
| Deal-email matcher (Spine #3, v2.1) | Built — core-tenant + city precision matching, dry-run refuted recall mode, digest exclusion; writes deal-attributed `activity_events` + `email_derived` deal_party edges | `mcp/deal-email-matcher.js` |
| Dossier generator (no-fabrication contract) | Built (PR #1549) — deterministic facts + Ollama-authored Analysis only, `source_hash` reuse, SharePoint push | `api/_shared/dossier-generator.js`; program index `docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md` |
| Correspondence-ingestion design | Written 2026-07-31 — ongoing dual-anchor capture (mostly built) + historical per-deal backfill flow (PA/Graph, SF-owner-flow pattern) + `lcc_deal_correspondents()` seed fn | `correspondence-ingestion-design.md` |
| Next-step engine | Phase 1 BUILT (ollama-wired) | `ai-next-step-engine-PHASE1-BUILT.md` |
| Context packets | 1,799 rows, context-broker edge fn | `context_packets`, `supabase/functions/context-broker` |
| Task surface | `research_tasks` (structured payloads, W5.2 pattern) + My Work queue-v2 + Decision Center | api/admin.js |

**The gap in one line:** comms land in `email_bodies`/activity spine, but NOTHING ticks the
deal state forward — summaries, milestones, next steps, dossier, and packets all sit static
until a human or a manual generation touches them.

### State (2026-08-06 — updated as units land)
| Unit | State |
|---|---|
| **W7.1** correspondence attribution LIVE | **BUILT — awaiting flag flip** (`DEAL_EMAIL_MATCH_ENABLED`). Matcher hourly cron (flag-gated) + run-log + loud-failure alert; deal mapping at ingest via the authoritative `deal_party` roster + conversation-thread continuity; `/api/intake-deal-backfill` alias. Dry-run report: `W7_1_deal_email_match_dryrun_2026-08-06.md`. Ledger: `ROLLOUT_STATUS.md`. |
| W7.2 propagation tick | **BUILT — awaiting flag flip** (`DEAL_COMMS_PROPAGATE_ENABLED`). Hourly tick `/api/deal-comms-propagate-tick` (pg_cron `lcc-deal-comms-propagate` `:32`, ~15min after the matcher) over deal-stamped comms → (1) is_current-versioned correspondence summary (Ollama, no-fabrication), (2) deterministic milestone cues → `lcc_deal_milestone` + LLM-only candidates → `milestone_confirm` lane, (3) Phase-1 `deriveNextStep`→`lcc_advance_todos` for recent inbound, (4) dossier regen-on-hash + `context_packets` invalidation. Own ledger seam `lcc_deal_comm_propagated`; run-log `lcc_deal_comms_propagation_run_log`. Migration `20260806140000`. Session log: `ROLLOUT_STATUS.md` (W7.2). |
| W7.3 call notes | **BUILT — awaiting flag flip / PA connector** (migration `20260821120000`). Three capture paths, one spine shape (all deal-stamped `activity_events` → the W7.2 tick, zero new propagation code): (A) in-app quick-log `POST /api/intake-log-call` + deal-surface "Log call" button (`logManualCallNote`, Ollama structuring proposal-only/gated); (B) Copilot actions `log_call_note` + `tag_comm_to_deal` (ambiguity→pick-list, never guess; cross-deal restamp refused); (C) Outlook category tagging `POST /api/intake-tagged-comm` (flag `TAGGED_COMM_INTAKE`, X-PA-Webhook-Secret) — unresolved→`tag_unresolved` My Work lane. PA spec: `docs/setup/OUTLOOK_CATEGORY_TAGGING_FLOW.md`. Ledger: `ROLLOUT_STATUS.md` (W7.3). |
| W7.4 role evolution + open issues | **BUILT — flag off** (`W74_ROLE_ISSUES`, migration `20260822120000`). A new W7.2-tick pass (AFTER summaries/cues/to-dos, own watermark over the comm set) PROPOSES: (a) party ROLE evolution (decision-maker vs transaction manager vs attorney/lender) and (b) OPEN ISSUES / "what's coming" (asks/questions/commitments/deadlines) — one Ollama call/deal via `invokeExtractionAI`, JSON-constrained. Every proposal is EVIDENCE-VALIDATED (`api/_shared/deal-role-issues.js`): a quote not appearing verbatim (whitespace-normalized) in the CITED comm is DROPPED + logged to `lcc_deal_analysis_dropped_log`, never surfaced. Versioned like the summary (`lcc_deal_dossier_analysis`, kind=roles\|issues, `is_current` flip, history retained); idempotent (unchanged corpus → 0 writes). Issue lifecycle: a later comm that answers an open issue flips it to resolved (with closing evidence) via a new versioned row. Stage awareness (`api/_shared/deal-stage-line.js`) is 100% deterministic from the milestone set (latest stage + Banning-style regression flag, no LLM). Dossier renders a "What's Coming / Open Issues" panel + an emerging-roles note under Parties, both labeled ANALYSIS with collapsible evidence. Isolated try/catch — a role/issues failure never blocks the summary/cue/to-do passes. Dry-run: `GET /api/deal-comms-propagate-tick?dry_run=1&force=1&roles=1`. Ledger: `ROLLOUT_STATUS.md` (W7.4). |

| W7.5 outbound loop closure | **BUILT — flag off for Part C** (`W75_ACTION_SUMMARY`, migration `20260823120000`). (A) tagged outbound sends now advance to-dos (`lcc_advance_todos` outbound + `lcc_reconcile_deal_todo`) in `intake-tagged-comm.js`, mirroring the inbound branch; (B) untagged Sent-Items sweep feeds the existing `handleOutlookSent` engine (PA spec `docs/setup/OUTLOOK_SENT_SWEEP_FLOW.md`) + cross-path de-dupe on `internet_message_id` (`api/_shared/outbound-advance.js`) so a to-do never advances twice; (C) flag-gated per-action Ollama narration (`api/_shared/action-summary.js`) with a no-fabrication validator, surfaced in the dossier correspondence section. Parts A/B need no flag (extend the live outbound engine). Ledger: `ROLLOUT_STATUS.md` (W7.5). |

## 1. Doctrine for this wave (unchanged, applied)
- LLM may EXTRACT/SUMMARIZE/PROPOSE (correspondence summaries, milestone candidates, action-item
  drafts, dossier Analysis) — it may NEVER be the value gate for an auditable write. Structured
  facts land deterministically; proposals route to My Work/Decision Center or write with
  explicit low-confidence provenance.
- Every producer needs a consumer + gate; every writer is idempotent + ledgered; seams are
  owned (the W5.2b lesson — one seam, one writer).
- No-fabrication contract governs all generated prose (the dossier standard).

## 2. Build units (sequenced; one per chat/Claude Code run)

### W7.1 — Correspondence attribution goes LIVE (the unlock)
The correspondence-ingestion design, executed: (a) run the deal-email-matcher against the
22,881-email corpus (dry-run report → Scott approves → live), verifying deal-stamped
`activity_events` + party edges land; (b) tighten ongoing capture per the design's two gaps
(folders forwarded; `lcc_resolve_contact` maps counterparties → DEAL); (c) build
`lcc_deal_correspondents(deal)` + `POST /api/intake-deal-backfill` for the historical PA/Graph
backfill per open deal. Exit: every open deal shows its email thread trail in the spine,
new mail auto-attributes within minutes.

### W7.2 — The propagation tick (the heart of Scott's ask) — ✅ LIVE 2026-08-06

**Verified live (session 36m):** dry-run → Scott-approved → live tick over the first
10-deal batch: 239 comms ledgered, 11 is_current summaries (grounded, citing
source_activity_ids — spot-checks factual: IRA Capital OM receipt on Pops Mart
Barnwell; Sal Cammarata inquiry on 519 N Main), 24 evidence-linked milestones
(detail_ref = source email), 0 to-do spam from the backlog (7-day window held).
Registry flag DEAL_COMMS_PROPAGATE_CRON → on; hourly cron (:32) finishes catch-up.
**Refinements SHIPPED (W7.2c, 2026-08-06 — migration `20260806150000`):**
1. **Milestone same-key collapse (the Banning finding).** FIRST occurrence per (entity, key) is THE row;
   re-occurrences roll up into `metadata.{occurrence_count,first_on,last_seen_on,last_detail_ref,occurrences}`.
   A >90d-stale AND stage-regressed re-occurrence opens a genuinely new round (a 2nd LOI after a fell-through
   deal). Rule = `api/_shared/deal-milestone-collapse.js`; `lcc_deal_record_milestone` (now returns
   `{outcome,id}`) + the one-shot collapse mirror it, per-deal advisory-locked. Collapse ran live: 41→21
   milestone rows (20 backed up, reversible); Banning's 6+ loi rows → 3 genuine rounds (×9/×4/×1). Dossier
   panel shows "LOI — first …, discussed ×N, last …".
2. **Briefing delta** — deterministic "What Changed on Your Deals" (last 24h) from the ledger + summary/dossier
   writes, one deep-linked line per deal; omitted when empty (`fetchDealPropagationDelta`).
3. **Incremental summaries** — persist `compressed_block` + watermark in the summary metadata; next tick feeds
   compressed history + only the newer slice (`buildIncrementalSummaryPrompt`), no-fabrication extended to the
   compression; full-corpus fallback on first run.
4. **Reply-SLA to-dos** — `lcc_deal_reply_sla_candidates` → guarded `reply_overdue` to-do (new `reply_sla`
   branch on `lcc_advance_todos`) for open deals whose latest comm is inbound with >3 business days no outbound.
   Live dry-count: 1 deal trips today.
A consumer on deal-attributed correspondence (cron tick, W5.2 shape; seam = its own ops-side
ledger keyed on activity_event id): for each NEW deal-stamped comm since last tick →
1. **Correspondence summary refresh** (`lcc_deal_correspondence_summary`, is_current
   versioning) — LLM-authored under the no-fabrication contract, older threads compress.
2. **Milestone detection** — deterministic cues first (LOI/PSA/executed/wire/close dates from
   structured extraction with BOTH-channel agreement where possible); LLM-only candidates go
   to a My Work confirm lane, never straight to `lcc_deal_milestone`.
3. **Action-item generation** — next-step engine invoked per changed deal; output lands as
   structured `research_tasks`/My Work items (ids + deep_link, instructions NULL) with
   don't-re-ask; completing/waiving feeds back (template-loop pattern).
4. **Dossier + packet invalidation** — bump the deal's `source_hash` inputs so the next
   dossier/packet fetch regenerates (or regenerate eagerly for active-stage deals);
   `context_packets` for the deal's property/contacts refresh.
Exit: send/receive a deal email → within one tick the summary, next steps, and dossier
reflect it. Verify live on the Woodland Hills gold-standard deal + one active deal.

### W7.3 — Call notes + voice as first-class comms — ✅ BUILT 2026 (a+b+ Outlook tagging)
Today calls have NO capture surface. SHIPPED all three, one spine shape (deal-stamped
`activity_events` → the LIVE W7.2 tick, zero new propagation code):
(a) **Quick-log**: deal-surface + route "Log call" action (deal/direction/free notes) via
`logManualCallNote` — reuses the spine writer + Phase-1 `deriveNextStep`→`lcc_advance_todos`
(a "send them the OM" note produces that to-do). Ollama structuring is PROPOSAL-ONLY + gated
(`OLLAMA_URL`); AI-fail logs the raw text.
(b) **Copilot actions**: `log_call_note` + `tag_comm_to_deal` (the manual override for the 21
zero-match deals). Deal resolution NEVER guesses — ambiguous → candidate pick-list, write
nothing; cross-deal re-stamp refused (conflict surfaced). Registered in both registry docs.
(c) **Outlook category tagging** (zero-UI, works at send time): a PA flow posts `LCC` /
`LCC:<hint>`-categorized mail (sent OR received) to `POST /api/intake-tagged-comm` (flag
`TAGGED_COMM_INTAKE`, X-PA-Webhook-Secret); unresolved → the `tag_unresolved` My Work lane
rather than guessing. Spec: `docs/setup/OUTLOOK_CATEGORY_TAGGING_FLOW.md`.
(voice-memo transcription — GaryBuilt Whisper — remains the later enhancement.)
Exit MET: a logged call adjusts next steps/dossier exactly like an email.

### W7.4 — Role evolution + open-issues surfacing (living-dossier §1 completeness)
From the attributed thread corpus: party role inference (decision-maker vs transaction
manager emerging near LOI), open-issues/topic extraction into the dossier's "what's coming"
panel, correspondence-aware commission stage awareness. All LLM outputs are proposals into
the dossier's Analysis/summary sections or confirm lanes — never silent fact writes.

### W7.5 — Outbound loop closure (sent mail completes work) + per-action summaries — ✅ BUILT 2026-08-06
The gap: `handleOutlookSent` (the outbound completion engine — auto-resolves offer_review/
follow_ups + schedules the seller follow-up) was complete but **UNFED** (no live flow posted
sent mail), and the tagged-comm receiver only advanced to-dos for INBOUND mail — a tagged
outbound send stamped the spine but completed nothing. Three parts, one PR:
- **A (outbound advance in the tagged path):** `intake-tagged-comm.js` now calls
  `lcc_advance_todos` (`p_direction='outbound'`) + `lcc_reconcile_deal_todo` when a tagged
  send resolves a deal — mirroring the inbound branch. The existing 5-min tagged sweep then
  closes to-dos for tagged sends with zero new infra.
- **B (untagged sent-mail feed):** PA spec `docs/setup/OUTLOOK_SENT_SWEEP_FLOW.md` — a 5-min
  Graph sweep of Sent Items → `POST /api/intake-outlook-sent` (the existing engine). Server:
  cross-path de-dupe on `internet_message_id` (an `outlook_sent` vs `outlook_tagged` row for
  the same send skips the second insert AND advance — a to-do never advances twice).
- **C (per-action Ollama summary, proposal-only):** flag `W75_ACTION_SUMMARY` (default off,
  migration `20260823120000`). After an advance, a one-line "action taken" narration is
  validated (only references to-dos actually touched — a fabricated label drops it) and stored
  in `activity_events.metadata.action_summary`, surfaced in the dossier correspondence section.
  Ollama via `invokeExtractionAI`; failure = no summary, never an error.
Out of scope (need Scott decisions): mailbox write-back (unflag/move/mark-read → now W7.6),
filing email bodies as deal-folder artifacts, SF parity for calls. Ledger: `ROLLOUT_STATUS.md` (W7.5).

### W7.6 — Mailbox Mirror (Outlook folders reflect open LCC work) — ✅ BUILT 2026-08-06
The W7.5 out-of-scope mailbox write-back, done as a PULL model — LCC never touches the
mailbox. LCC publishes a **deterministic** worklist of intake-captured flagged emails whose
loop has CLOSED; a Power Automate "mover" flow moves each from the "Intake Staged, Not
Complete" Outlook folder to a Processed folder (+ unflag + mark read) via Graph and acks back.
**Move-only, never delete.**
- **Closure gate = pure SQL** (`v_lcc_mailbox_reconcile_worklist`, NO LLM): closed when ANY of
  (a) every to-do generated from it (`action_items.inbox_item_id`) is terminal, (b) a later
  in-thread outbound reply exists (same `conversation_id`), (c) the `inbox_item` was triaged
  `dismissed`/`archived`. Inverse guard: withheld while the deal has an open `offer_review`.
- **Own seam:** ledger `lcc_mailbox_reconcile_ledger` (unique on `internet_message_id`); ack
  RPC `lcc_mailbox_reconcile_ack` is idempotent, backs off failed moves 1h, and **parks after
  5 tries** with a loud `lcc_health_alerts` (`mailbox_mirror_parked`) row.
- **Endpoints:** `GET /api/mailbox-reconcile-worklist` + `POST /api/mailbox-reconcile-ack`
  (`api/_handlers/mailbox-reconcile.js`), flag-gated `MAILBOX_MIRROR` (default off →
  `{skipped:'flag_off'}`). PA spec: `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md`. Migration
  `20260824120000`.
- **Grounded:** live worklist = 3,908 closed-loop flagged emails (all via the triage arm today
  — historical inbound rows predate W7.1 `conversation_id`, so the thread-reply arm is
  wired-but-inert until forward mail carries it, same honest pattern as the rest of Wave 7).
  Gate proven by a self-rolling-back synthetic fixture (all 8 invariants, 0 residue).

## 3. Operator prereqs
- W7.1's backfill needs the Outlook/Graph PA flow (SF-owner-flow pattern) — connector work.
- Ollama env on Railway for dossier/summarization (OLLAMA_URL live since Aug 4 ✅).
- Decide W7.3 capture option(s) at unit start.

## 4. Verification standard
Each unit closes only on a live end-to-end demo: real email (or call log) → observed
summary/milestone/task/dossier delta, ledger-verified idempotent re-run, ROLLOUT_STATUS
session entry. The W6.6 monthly audit gains a "propagation freshness" check
(max lag between latest deal-stamped comm and its summary/task tick).
