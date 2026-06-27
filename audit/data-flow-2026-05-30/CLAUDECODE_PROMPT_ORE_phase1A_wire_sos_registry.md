# Claude Code — Ownership-Resolution Engine, Phase 1 Unit A: wire the orphaned SOS registry into owner records (managers/decision-makers)

## Why (verified live on gov `scknotsqkcheojiaewwh`, 2026-06-27)

This is the cheapest, highest-leverage piece of the ownership-resolution engine: we
have already extracted LLC managers (the decision-makers) from the Secretary-of-State
registry, and they're **orphaned** — never synced to the owner records or the BD graph.

- **`gov.entity_registry_records`: 8,262 rows, ALL 8,262 have `managers`** populated
  (+ `entity_name`, `entity_type`, `formation_state`, `file_number`, `is_spe`=6,929,
  `formation_date`, `source_url`, `raw_payload`). The typed `registered_agent` /
  `registered_agent_address` columns are EMPTY (0) — only `managers` is populated
  (agent data, if any, is inside `raw_payload`).
- **`gov.recorded_owners`: 16,830 rows; only 132 carry a `manager_name`** (and it
  HAS the columns: `manager_name`, `manager_role`, `registered_agent_name`,
  `registered_agent_address`).
- **~4,904 `recorded_owners` and ~4,906 `true_owners` exact-name-match an
  `entity_registry_records.entity_name`** (5,023 distinct registry names). So an
  exact-name sync alone lifts owner manager coverage **132 → ~4,900 (37×)**; a
  normalized/fuzzy pass adds more.

Why this matters now: the CONTACT-SELECTION signal pull
(`v_owner_contact_signals_portfolio` → `lcc_owner_contact_signals` →
`owner_contact_pivot`) already reads `recorded_owners.manager_name`. So populating
manager_name flows the decision-maker straight into the **now-working** outreach
chain (the auth fix #1355 + free-attach + seed-cadence wire) — it directly attacks
the high-value-contactless-owner problem we hit earlier today, with data we already
hold. This is the root-cause fix, not a point lever.

## Unit A — sync entity_registry_records → recorded_owners (+ true_owners)

Build an idempotent, provenance-tagged sync (GovernmentProject Python step or a gov
SQL function + cron — your call; mirror the existing ingest patterns). For each
`entity_registry_records` row, match to `recorded_owners` / `true_owners` by name
and fill-blanks the owner-contact fields:

1. **Match key:** exact normalized name first (`lower(btrim(entity_name))` =
   `lower(btrim(name))`), then a normalized/legal-suffix-stripped pass (reuse the
   existing `entity_resolution.py` / `canonical_entity_name` normalizer) for the
   long tail. Be conservative — only match a single unambiguous owner; log
   ambiguous (>1 candidate) for review rather than guessing.
2. **Parse `managers`** (inspect its shape — likely a JSON array or delimited list
   of names/roles) into a primary `manager_name` (+ `manager_role` where present);
   keep the full list (e.g. in a `managers` jsonb on recorded_owners or the existing
   column) so multi-manager LLCs aren't lost.
3. **Write fill-blanks-only** to `recorded_owners`: `manager_name`, `manager_role`,
   `is_spe`, `formation_state`, `file_number` (add columns if missing — additive),
   and `registered_agent_name` / `registered_agent_address` IF you can recover them
   from `raw_payload` (the typed columns are empty — check the payload). Never
   clobber a curated value; provenance `source='sos_registry'` via the existing
   `field_provenance` / priority machinery (register the priority rows).
4. **Idempotent + reversible**: re-running fills only new blanks; every write is
   tagged so it can be reverted by source. Match on `data_hash` to skip unchanged.

## Flow-through — confirm it reaches outreach (don't rebuild; verify)

The downstream is already built — verify it carries the new data:
- `v_owner_contact_signals_portfolio` (gov) should now surface `manager_name` as an
  owner-contact signal; the LCC `lcc_sync_owner_contact_signals` mirror +
  `owner_contact_pivot` seeding (the Unit-2 pivot-ensure from the cross-ref round)
  should pick it up for the high-value owners; the owner-contact-enrich worker (auth
  fixed) then attaches the manager as a contact → value-gated cadence → focus card.
- If the signal pull or pivot seeding needs a small extension to cover the newly-
  populated owners, do it — but the bulk of the chain exists. Confirm a high-value
  owner that gains a manager from this sync ends up with an attachable contact.

## Scope / verify

- GovernmentProject (+ gov DB migration for any new columns; additive). dia: check
  whether a `dia.entity_registry_records` equivalent exists and apply the same wire
  if so (gov is where the high-value contactless owners concentrate, so gov first).
- Provenance-gated, fill-blanks, idempotent, reversible (the established discipline);
  conservative matching (no ambiguous guesses).
- **Dry-run first:** report how many owners WOULD gain manager_name (expect ~4,900
  exact + the fuzzy lift) and a sample of (owner → manager) pairs before any write.
- **Live proof (Cowork verifies):** `recorded_owners` manager_name coverage rises
  132 → ~4,900; spot-check a sample against `source_url`/`raw_payload`; the
  CONTACT-SELECTION pull surfaces the managers; a high-value owner flows to an
  attachable contact in the outreach chain.

## Documentation

Update GovernmentProject CLAUDE.md + the ORE design doc: the SOS-registry→owner sync
(`entity_registry_records.managers` → `recorded_owners.manager_name` + SPE/formation
fields), fill-blanks + provenance `sos_registry`, feeding the CONTACT-SELECTION pull
→ outreach. Note the typed agent columns are empty (managers is the live field;
agent address mined from raw_payload if present).

## Bottom line

We already extracted the managing members of ~8,262 LLCs from the SOS registry and
left them orphaned while the owner records show 132. Wire that one table into
`recorded_owners` and the decision-makers we've been hunting flow — for ~4,900
owners — straight into the working outreach chain. This is Phase 1's headline win
and it's almost entirely a wiring job over data already in hand.
