# Claude Code Prompt — W7.1: Deal-correspondence attribution goes LIVE (Wave 7, unit 1)

**Repo: life-command-center.** First unit of Wave 7
(`docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md` — read it first, plus
`docs/architecture/correspondence-ingestion-design.md` and
`mcp/deal-email-matcher.js` header (v2.1 history — city is load-bearing; the dry-run
refuted tenant-alone recall; do NOT loosen precision)).

## Grounded state (2026-08-06, live)
- `email_bodies`: 22,881 rows and flowing (Outlook bridge).
- Matcher: BUILT + MOUNTED (`mcp/server.js` → `POST /api/pipeline/match-deal-emails`,
  engine deploy) and has run at least once: 90 deal-tagged `activity_events`
  (metadata.deal_entity_id), 60 `email_derived` deal_party edges (252 deal_party total).
- Deal spine tables live but near-empty (1 dossier / 1 correspondence summary / 3 milestones).
- `lcc_resolve_contact` (RPC, called from `api/_shared/intake-correspondence.js`) resolves
  party + primary open deal; the design doc's gap: deal counterparties must map to the DEAL.

## Build (three pieces, per the wave plan)

### A. Matcher on a cadence (from ran-once → always-on)
1. **Full-corpus dry-run first:** run the matcher `?dry_run=1` across in-scope open deals;
   capture the per-deal report (would_attribute counts + sample_titles) into the PR
   description AND a doc under `docs/architecture/` — Scott approves before the live run
   (precision doctrine: the v2 recall mode was refuted by exactly this kind of report).
2. **Live run** after approval (or gate it behind a flag Scott flips) — then **schedule
   recurring runs**: pg_cron → `lcc_cron_post` → the engine route (mirror the W5.2 cron
   pattern), frequency ~hourly (new mail attributes within the hour; the matcher is
   idempotent by (entity_id, external_id)). Loud-failure like other crons.
3. Emit a per-run stats line (scanned/attributed/skipped_digest/deduped) somewhere
   observable (run response + console; a deduped health alert on repeated failure).

### B. Ongoing-capture tightening (design doc §A gaps)
1. `lcc_resolve_contact` → deal mapping: when the counterparty email belongs to a deal's
   party set (deal_party edges incl. email_derived, SF opp contacts,
   metadata.primary_contact), the dual-anchor logger must stamp `deal_entity_id` at
   INGEST time — new mail on a known deal thread should not wait for the matcher pass.
   Conversation-id continuity: if a prior message in the same `conversation_id` is
   deal-stamped, stamp the new one to the same deal (cheap, precise).
2. Verify (and fix if broken) that `handleOutlookMessage`/`handleOutlookSent` actually
   route through this path for the folders that carry deal mail — document any PA/folder
   config the operator must change (don't silently assume).

### C. Historical backfill plumbing (connector-ready, design doc §B)
1. `lcc_deal_correspondents(p_deal_entity_id)` DB function — search seeds per deal:
   party emails (all deal_party edges + SF opp contacts + primary_contact) + property/deal
   name + core tenant + city (reuse the matcher's coreTenantOf discipline).
2. `POST /api/intake-deal-backfill` — accepts `{deal_entity_id, messages[]}` (the SF-flow
   JSON contract style), logs via the existing dual-anchor loggers with the deal stamp,
   idempotent on `internet_message_id`, returns counts. The PA/Graph flow itself is an
   OPERATOR follow-up (document the flow spec in docs/setup/ mirroring the SF-owner flow
   doc) — build the LCC side now so the connector work is drop-in.

## Doctrine / Do NOT
- Do NOT loosen matcher precision (city stays REQUIRED; word-boundary; digest exclusion).
- No LLM anywhere in attribution (deterministic matching only — LLM enters in W7.2 for
  summaries/proposals, not here).
- Idempotent everywhere; the matcher's (entity_id, external_id) dedupe is the ledger.
- Don't build W7.2's propagation tick here — this unit ONLY gets correspondence reliably
  deal-stamped (it's W7.2's producer).

## Verify (live)
Dry-run report produced; after live run: deal-tagged activity_events count reported
(before/after), edges count, per-deal distribution (top 10). New-mail path: send/receive
one email on a known deal thread → deal-stamped at ingest (or next matcher pass) without
manual action. Record in ROLLOUT_STATUS (Wave 7 section — create it: W7.1 row + session
log) and update WAVE7 plan §0 state table.
