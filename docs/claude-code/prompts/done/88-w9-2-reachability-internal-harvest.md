# Prompt 88 — W9.2: Contact-reachability internal harvest (Wave 9, unit 1)

**Grounding (read first):** `docs/audits/W9_CONNECTEDNESS_KICKOFF.md` (the directive + live gap
map), `docs/architecture/property-owner-subsystem.md` + source-authority doctrine,
`correspondence-ingestion-design.md`, and the W8 house pattern (U3's verbatim-evidence proposals +
the 66/73/83/84/85 tick lessons — new units START with windowed scans, budget floors, crash-proof
envelopes, batched lookups, loud per-source errors).

**The gap (live 2026-08-08):** dia contacts with neither email nor phone: **4,234/5,951 (71%)**
(measure the gov equivalent in this unit — count was not yet taken); true owners with NO contact
row at all: dia 4,825 / gov 11,922. LCC already HOLDS much of the missing data — correspondence
headers/bodies (W7 attribution), synced SF contact records, sidebar captures, intake extraction
snapshots (broker/owner emails+phones), ORE observation stores. W9.2 harvests INTERNAL sources
only. External acquisition (SOS/deed chain) is W9.1 — NOT this unit. Web-search proxy stays PAUSED.

## Design (two arms, deterministic-first — the U5/85 lesson)

1. **Deterministic fills (no LLM):** exact-identity matches — e.g. the synced SF contact record
   for the SAME person (matched via existing sf link/external_identities, not name-fuzz) carries
   an email/phone the domain contact lacks → fill-blanks proposal with source pointer, provider
   'none', confidence 1.0. Same for sidebar captures keyed to the same contact identity. These are
   arithmetic, not judgment: bulk-confirmable in the lane, excluded from any distribution guard.
2. **LLM-attributed fills (ollama, surface `clean_assist`):** fuzzy attribution — an email
   observed on an attributed thread / in an intake snapshot that LIKELY belongs to this
   contact/owner (name in signature, role context). U3-pattern: verbatim quote REQUIRED (the
   evidence span containing the email/phone + name), validator drops non-verbatim (dropped log =
   precision floor), confidence floor, `no_evidence_found` honest + skip-marked by evidence-hash.

## Do

1. **Pool + value-gate:** targets = (a) contacts with neither email nor phone, (b) true owners
   with no contact where an internal source NAMES a person (that's a propose-new-contact shape —
   minted only via the lane, never auto). Rank by owner portfolio value (worklist rank_value);
   measure and report the gov reachability count this unit didn't have.
2. **Evidence assembly (deterministic, batched):** per target, gather internal sources — SF
   contact/account records via existing identity links, correspondence (subject/headers/attributed
   summaries), sidebar captures, intake snapshots (`listing_broker_email`-class fields), ORE
   observations. Batched `in.()` lookups per source per batch (NEVER per-row round trips — the 83
   lesson); per-source hit counts + loud scan_errors in every response.
3. **Proposals → the EXISTING owner-contact surfaces:** reuse `v_owner_contact_worklist` /
   `owner_contact_pivot` + the "Owner-contact links to confirm" lane shape if it fits (extend
   before you fork; if a new lane is unavoidable, the 75 structural guard makes half-wiring
   impossible). Confirm → deterministic fill-blanks writer through the provenance path (new fsp
   source rows in-migration, e.g. `w9_2_internal_harvest`@~60 and `comms_observed`@~40 — BELOW
   manual/recorded sources; unranked view must stay clean). Reversible batch ledger. Reject →
   retained as rubric fuel.
4. **Tick + flag + cron (house pattern from day one):** `/api/reachability-harvest-tick`
   (GET dry-run w/ `?score=1&n=`, POST flag-gated), `W9_2_REACHABILITY_HARVEST` OFF in-migration,
   nightly cron 4:40 UTC (after the W8 chain — GaryBuilt serial), windowed resumable scans,
   deterministic arm ~100/night + LLM arm ~15/night, crash-proof envelope, budget floors.
5. **Metrics for U4:** per-run + cumulative reachability coverage (% contacts reachable; % top-N
   value owners with reachable contact) — the campaign's headline number, trending monthly.
6. **Tests:** deterministic-vs-LLM routing, verbatim validator, batched-lookup guard (no per-row
   fan-out), fsp registration, lane wiring (75 guard), windowed-scan cursor resume.

## Acceptance

- Dry-run: pool counts (incl. the measured gov gap) + per-source evidence hit counts + a sampled
  sheet where deterministic fills carry exact source pointers and every LLM proposal carries a
  verbatim quote containing the harvested email/phone.
- Scott reviews → Cowork flips the flag. Zero writes without a human verdict; zero fabricated
  contact data structurally possible.
- ROLLOUT_STATUS Wave 9 section + W9.2 row; prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
