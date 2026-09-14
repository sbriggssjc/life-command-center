# W9.2 — Contact-reachability internal harvest — dry-run sheet (2026-08-08)

**Unit:** Wave 9 (data connectedness), unit 1 (Prompt 88). **Flag:** `W9_2_REACHABILITY_HARVEST`
(OFF). **Route:** `/api/reachability-harvest-tick`. **Lane:** Decision Center
`reachability_harvest_review`. **Migration:** `20260826120000_lcc_w9_2_reachability_harvest.sql`
(applied live to LCC Opps `xengecqvemvfknjvbvrq`).

## The gap (grounded live 2026-08-08)

Domain contacts with **NEITHER email nor phone** — the "who do I call" gap:

| Domain | Contacts total | Missing both | % unreachable | Named | Owner-linked | Carry an SF identity key |
|---|---|---|---|---|---|---|
| dia | 5,951 | **4,234** | **71%** | 4,128 | 1,955 | 15 |
| gov | 15,434 | **10,542** | **68%** | 10,542 | 4,313 | 5 |

The **gov reachability count (10,542 / 68%) was measured for the first time this unit** — the
kickoff gap map had only the dia figure.

## Two arms (deterministic-first)

**ARM 1 — deterministic (arithmetic, NO LLM, confidence 1.0, provider `none`).** The SAME
person's synced record — matched via an EXACT identity key (`sf_contact_id`, or dia's
`salesforce_id`), NOT name-fuzz — carries an email/phone the target lacks. Batched `in.()`
donor lookups over BOTH domains' `contacts` (an SF contact id is global). Bulk-confirmable in
the lane (one click), excluded from any distribution guard.

- **⚠ Honest yield today (grounded):** only **15 dia + 5 gov** blank contacts carry an
  `sf_contact_id` at all, and within-dia same-identity donors resolve to **~5** (`sf_contact_id`)
  / **~4** (`salesforce_id`). The deterministic arm is **input-starved today** — the durable
  ENDPOINT is the fix; yield scales as W9.3's SF-linkage drain lands identity keys on the blank
  contacts. This mirrors the U3 / Phase-A1 lesson: *the mechanism is the win; realizing value
  needs the upstream capture.*

**ARM 2 — llm-attributed (surface `clean_assist`, verbatim-quote validator).** An email/phone
observed in an **intake extraction snapshot** naming this contact (the party's NAME appears in
the same evidence). One bounded scan builds an in-memory index of snapshot parties carrying a
contact detail, keyed by normalized name; a target's name looks up the index; Ollama proposes
with a VERBATIM quote; the validator DROPS a value not present verbatim in the quote
(`reachability_harvest_dropped_log` = precision floor). No evidence ⇒ no LLM call (counted
`no_evidence`).

- **Evidence pool (LCC Opps `staged_intake_extractions`, 8,256 snapshots):** `owner_contact_email`
  609 / `owner_contact_phone` 609 / `owner_contact_name` 610, `seller_email` 606, `buyer_phone`
  606, `listing_broker_email` 8,228. The LLM arm fires only where a snapshot party name matches
  a blank contact's name — honest, bounded, never fabricated.

## Per-source evidence hit counts (dry-run reports them live)

`GET /api/reachability-harvest-tick?score=1&n=8` returns, per run:
`scan_counts` (targets dia/gov, deterministic donors_found / proposed / no_donor, llm
with_evidence / no_evidence / fresh), `evidence_sources` (`sf_contact_id`, `salesforce_id`,
`intake` scan size), loud `scan_errors[]`, and a sampled `proposals[]` where **every
deterministic row carries an exact source pointer** (`evidence_source = <identity-key>:<donor
contact_id>`) and **every LLM would-propose carries `quote_verbatim: true`** (the harvested
value is a substring of the assembled evidence; a value not in the quote is dropped).

## Operator step before flip (the gate)

1. Redeploy Railway (merged `main`) so the route + lane ship.
2. `GET /api/reachability-harvest-tick` → confirm the gap `pool_counts` (dia 71% / gov 68%).
3. `GET /api/reachability-harvest-tick?score=1&n=8` → review the sampled sheet: deterministic
   fills have exact donor pointers; LLM fills carry a verbatim quote containing the value; check
   `scan_errors` is `[]` and the per-source hit counts.
4. Flip `W9_2_REACHABILITY_HARVEST` → `on`. The nightly cron (04:40 UTC, after the W8 chain)
   then drains ~100 deterministic + ~15 LLM/night → the `reachability_harvest_review` lane. Every
   fill is a HUMAN verdict; every write is reversible (`reachability_harvest_apply_log`); a
   now-populated field routes to a conflict, never a clobber.

## Metrics for U4 (the campaign headline)

Per-run + cumulative reachability coverage, trending monthly:
`% contacts reachable` = `1 - contacts_missing_both / contacts_total` per domain (today: dia 29%,
gov 32%), and `% top-N-value owners with a reachable contact` (owner-linked blank contacts: dia
1,955 / gov 4,313 are the addressable value tier). The health view
`v_lcc_reachability_harvest_health` carries open/applied/dropped counts.

## Boundaries verified

`v_field_provenance_unranked` = **0** rows for `w9_2_internal_harvest` / `comms_observed` (8 fsp
rows registered on dia/gov contacts email+phone). Flag OFF ⇒ cron no-ops. Zero writes without a
human verdict. Zero fabricated contact data structurally possible (deterministic = a real donor
value; LLM = a value that must appear verbatim in the quoted evidence).
