# Prompt 97 — W9.5: propagation-integrity tick (the standing measure of "full propagation")

**Grounding:** `docs/audits/W9_CONNECTEDNESS_KICKOFF.md` (W9.5 — "measure, last") + the U4
systemic-findings machinery (prompt 70/73 — W9.5 reports INTO it, no new lane, no new doc). Scott's
directive: "ensuring full propagation and ingestion of useable data everywhere." W9.5 is the
instrument that proves it stays true.

## Design: a deterministic cross-DB link-coverage audit, monthly into U4 + on-demand tick

**No LLM anywhere in this unit** — pure counts. It measures every link in the chain the campaign
works on, so drift in ANY of them surfaces in the monthly report with a delta:

1. **Chain coverage (per domain):** recorded_owner→true_owner linked %; true_owner→contact %;
   contact→reachable (email/phone) %; true_owner→SF key %; contact→sf_contact_id %;
   correspondence→entity attribution % (and the parties-vs-owner-LLC split from the prompt-96
   finding — measure it so the follow-on unit has a baseline).
2. **Cross-DB mirror consistency:** ops entity ↔ dia/gov owner mirrors via `external_identities`
   (dangling identities, owners with no ops entity, ops entities whose domain rows vanished);
   `cross_domain_contacts` coverage; canonical-scheme conformance spot counts (the dia/gov alias
   footgun class — count rows violating the short-form doctrine).
3. **Campaign drains:** re-score backlog remaining, donor-key coverage trend, harvest
   proposals/accepts (once live), assist accuracy — most already exist as views; W9.5 UNIFIES them
   into one `v_lcc_w9_5_link_coverage` (per-link rows: link_name, domain, total, linked, pct)
   + a snapshot table for month-over-month deltas (U4's existing snapshot pattern).
4. **U4 integration:** a new "Connectedness" section in the systemic-findings aggregator reading
   the coverage view + deltas; severity heuristic = any link whose pct DROPS month-over-month
   (propagation regressing = the alarm this unit exists for). Fix-unit stubs name the failing link.
5. **Tick:** `GET /api/link-coverage-tick` (on-demand computed JSON, house envelope, no flag
   needed — read-only) + the monthly snapshot written by the U4 cron path (extend, don't add a
   second cron if the U4 tick can call it).
6. **Tests:** per-link count builders on fixtures, snapshot/delta, U4 section wiring, view
   presence; read-only structural guard (this unit writes NOTHING except its snapshot).

## Acceptance

- `GET /api/link-coverage-tick` returns the full chain-coverage table live (honest, matches the
  kickoff's known numbers where measured before); U4's next report carries the Connectedness
  section with baselines. ROLLOUT_STATUS W9.5 row; kickoff status; prompt to done/.
- Wave 9 build-out then stands at 4 of 5 (W9.1 external acquisition = the remaining unit, its own
  future prompt with the SOS-egress design question).

Commit with the repo Co-Authored-By + Claude-Session trailer.
