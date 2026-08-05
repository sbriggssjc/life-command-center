# ROLLOUT_STATUS

Live rollout ledger for sequenced build waves. Newest wave on top. Each row: what
shipped, where it lives, and the operator switch (if any) that lights it up.

---

## Wave 7 — Comms-driven context propagation
Plan: `docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md`

| Unit | State | Summary |
|---|---|---|
| **W7.1** Correspondence attribution goes LIVE | **BUILT — awaiting flag flip** | Matcher on an hourly cron (flag-gated), deal-mapping at ingest via the authoritative roster, historical backfill plumbing drop-in. |
| W7.2 The propagation tick | not started | Consumer on deal-stamped correspondence → summary / milestone / next-step / dossier refresh. |
| W7.3 Call notes as first-class comms | not started | |
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
