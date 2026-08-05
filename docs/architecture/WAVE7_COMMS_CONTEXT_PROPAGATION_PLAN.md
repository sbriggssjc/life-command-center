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
| W7.2 propagation tick | not started (W7.1 is its producer) |
| W7.3 call notes | not started |
| W7.4 role evolution | not started |

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

### W7.2 — The propagation tick (the heart of Scott's ask)
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

### W7.3 — Call notes + voice as first-class comms
Today calls have NO capture surface. Options to decide at unit start (recommend a+b):
(a) **Quick-log**: a My Work / sidebar "Log call" action (deal/contact, direction, free
notes) writing the same activity spine shape (`call_note` kind) → flows through W7.2
automatically; (b) **Teams/Outlook path**: PA flow ingesting call/meeting notes (Teams
recap or a designated Outlook folder/subject convention) through the same dual-anchor
logger; (c) voice-memo transcription (GaryBuilt Whisper?) as a later enhancement.
Exit: a logged call adjusts next steps/dossier exactly like an email.

### W7.4 — Role evolution + open-issues surfacing (living-dossier §1 completeness)
From the attributed thread corpus: party role inference (decision-maker vs transaction
manager emerging near LOI), open-issues/topic extraction into the dossier's "what's coming"
panel, correspondence-aware commission stage awareness. All LLM outputs are proposals into
the dossier's Analysis/summary sections or confirm lanes — never silent fact writes.

## 3. Operator prereqs
- W7.1's backfill needs the Outlook/Graph PA flow (SF-owner-flow pattern) — connector work.
- Ollama env on Railway for dossier/summarization (OLLAMA_URL live since Aug 4 ✅).
- Decide W7.3 capture option(s) at unit start.

## 4. Verification standard
Each unit closes only on a live end-to-end demo: real email (or call log) → observed
summary/milestone/task/dossier delta, ledger-verified idempotent re-run, ROLLOUT_STATUS
session entry. The W6.6 monthly audit gains a "propagation freshness" check
(max lag between latest deal-stamped comm and its summary/task tick).
