# Prompt 94 — W9.4: Comms-harvest arm (third arm of the W9.2 reachability tick)

**Status: DONE (built as the third arm of the live W9.2 tick; flag `W9_2_REACHABILITY_HARVEST`
stays OFF). 2026-08-12.**

W9.4 closes the Outlook↔LCC↔SF loop by making the correspondence LCC already ingests
(`activity_events`) a THIRD input source for the existing reachability-harvest tick — it
extends, never forks. One flag (`W9_2_REACHABILITY_HARVEST`), one lane
(`reachability_harvest_review`), one cron (04:40 UTC), now three arms.

## Three sub-arms (reuse the existing deterministic + llm split)
1. **Header pairs → deterministic** — a header display name bound to a valid, non-internal,
   non-generic email/phone matching a blank contact's normalized name (arithmetic fill,
   confidence 1.0, provenance `comms_observed`, source pointer = message id).
2. **Signature phones → llm** — `extractSignaturePhones` over the body signature region,
   assembled under the sender name; the SAME verbatim-quote validator gates them.
3. **Create-contact → `target_kind='owner'`** — a thread participant attributable to an
   owner (ops entity → domain `true_owner` via `external_identities`) with zero contacts →
   propose CREATE-contact; minted ONLY via a human verdict, never auto.

Privacy-scoped: harvests ONLY business-attributed, `visibility<>'private'` threads.

## Deliverables shipped
- Planner helpers (pure, tested) in `api/_shared/reachability-harvest-planner.js`.
- Tick + create-contact producer + verdict-path mint (idempotent, reversible) in
  `api/admin.js`; DC lane create-contact card + bulk-confirm exclusion in `dc-lanes.js`.
- Migration `supabase/migrations/20260827120000_lcc_w9_4_comms_harvest.sql` (applied live to
  LCC Opps): 2 NAME-field `comms_observed@40` fsp rows (`v_field_provenance_unranked`=0 for
  the reachability fields) + flag notes refreshed to 3 arms. No new table.
- Tests `test/reachability-harvest-planner.test.mjs` (22 → 34, all pass).
- Dry-run + grounding `docs/audits/W9_4_comms_harvest_dryrun_2026-08-12.md`; ROLLOUT_STATUS
  W9.4 row.

## ⚠ Grounded honestly — input-starved today (the finding)
Live (2026-08-12): of 7,751 business-attributed correspondence rows, **0 carry a header
display name** (Outlook ingestion flattens Graph `{name,address}` → bare email), so header
pairs = 0 and the 2,410 phone-bearing signature bodies are not name-keyable; the 309 linked
correspondence entities are deals/properties and **0 map to a `true_owner`**, so
create-contact = 0. The arm is correct + complete and lights up the moment header display
names are preserved at ingestion. Same honest posture as W9.2's input-starved deterministic
arm and the SOS "yields nothing from CI" finding.

## The single unlock (W9.4 follow-on, not built here)
Preserve the header display name at Outlook ingestion — capture Graph's
`from.emailAddress.name` / `toRecipients[].emailAddress.name` (`metadata.from_name`/`to_names`
on the mailbox-mirror row + the inbound/sent loggers, forward-only). That one field lights up
all three sub-arms at once. Then redeploy → `GET /api/reachability-harvest-tick?score=1&n=10`
should show non-zero `comms_counts` → review → Cowork flips `W9_2_REACHABILITY_HARVEST`→on.
