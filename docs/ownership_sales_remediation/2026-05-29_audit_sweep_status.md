# Ownership & Sales — final audit sweep (2026-05-29)

Closing out the remaining audit gaps one at a time (recommended order:
G14 → G7-dia → G15 → C7), then a re-audit. This doc tracks the sweep.

## G14 — ownership-field priority rules ✅ DONE

The `field_source_priority` matrix already covered the ownership identity
surface (81 owner rules: recorded_owner_name/id, true_owner_id,
ownership_start/end, new_owner/prior_owner, property_ownership_type, and the
recorded_owners enrichment fields incl. state_of_incorporation / filing_state /
manager_* / registered_agent_* / filing_*) with the audit's
`county > SOS > sidebar > OM` ladder. The Phase-4 drift detector flagged exactly
one written-but-unranked ingestion field: `dia.ownership_history.ownership_source`
(costar_sidebar). Added its 8-row source ladder. Verified: **0 owner-field
ingestion gaps remaining** (the leftover unranked entries are one-shot
`cleanup_run_*` provenance — correctly unranked). `recorded_owner_mailing_address`
(audit-named) is written by no source, so needs no rule. Migration
`20260529200000_lcc_g14_ownership_source_priority.sql`; audit log 56.

## G7 (dia half) — dia property → canonical entity ⏳ PARTIAL (column + authoritative backfill staged; full coverage gated on the BD entity sync)

**Decision:** dia properties link to the BD **`entities`** canonical layer (not
the people-Contacts hub, which would bloat the now-live Contacts feature with
owner-entity rows).

**Done:** added `dia.properties.unified_id uuid` (+ partial index) → LCC
`entities.id` for the property's owner. Migration
`20260529210000_dia_g7_properties_unified_id.sql`; audit log 57.

**Key finding:** the clean owner→entity link `dia.true_owners.lcc_canonical_entity_id`
**exists but is empty** — the BD entity sync that populates it has never run
(its dia/gov vault secrets were never set). Name-matching is unreliable
(dia `normalized_name` keeps suffixes + inconsistent casing vs
`entities.canonical_name`). The only clean/deterministic dia→entity link
available now is `lcc_entity_portfolio_facts` (current-owner→entity), covering
~1,159 of the ~9,488 dia owner-properties.

**Backfill script (workstation, cross-DB):** `scripts/A9b_dia_property_unified_id.mjs`
resolves `unified_id` via (1) `dia.true_owners.lcc_canonical_entity_id`
[authoritative owner-based — fills in once the BD sync runs] then
(2) `lcc_entity_portfolio_facts` [authoritative current-owner, ~1,159 now].
Idempotent, dry-run-first. Run now for the ~1,159; **re-run after the BD entity
sync is activated** (set dia/gov vault secrets) for full ~9,488 coverage.

```bash
node scripts/A9b_dia_property_unified_id.mjs            # dry-run (~1,159 resolvable now)
node scripts/A9b_dia_property_unified_id.mjs --apply
```

**Full G7-dia completion is gated on activating the BD entity sync** — the proper
canonical mechanism. That's the durable path; the script auto-covers the full
set once `lcc_canonical_entity_id` populates.

## G15 — ownership provenance design doc ✅ DONE

Authored `Ownership_Data_Provenance_Schema_Design.md` (companion to the lease
provenance doc). Documents the **existing** ownership provenance design — it
reuses the shared `field_provenance` + `field_source_priority` + `lcc_merge_field`
fabric (not parallel tables): the ownership source-tier ladder
(manual > recorded_deed > county > SOS > shell/cms > OM > sidebar), the
ownership fields under provenance (identity + SOS/LLC enrichment, incl. the new
`ownership_source`), the write-decision flow, the complementary structural
guards (C5 EXCLUDE / A6a trigger / B4 chain-tick / C4 dedup), and the mapping to
G4/G7/G13/G14/G15. Audit log 58.

## C7 / G5 — SOS adapters ⬜ NEXT (workstation; framework scaffolded, sites 403 from remote env)

## Audit-log inventory (this sweep)

| log_id | run_id | rows |
|---:|---|---:|
| 56 | G14_ownership_priority_rules | 8 |
| 57 | G7_dia_unified_id (column + script staged) | 0 |
