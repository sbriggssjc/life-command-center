# Claude Code (LCC) — Build 2: continuous owner-address reconcile (the connective tissue)

Build 1 (deed byte-capture) is merged + verified live — deeds now flow
`url_captured → bytes_captured → text_extracted → deed_parsed`, and the CoStar CDN links are
alive (54+ deeds recovered, 0 retired). That drain populates `recorded_owners.mailing_address`
via the existing deed grantee-address propagation (ORE Phase 1C). **Build 2 makes every owner
address that lands reconcile owners continuously** — so as the deed drain + forward capture +
(later) SOS fill the address sources, duplicate owners collapse and contacts propagate
automatically.

## The engine already exists — do NOT fork it

Grounded live on LCC Opps (`xengecqvemvfknjvbvrq`):
- `lcc_reconcile_owner(...)` — the multi-signal, authority-weighted owner resolver (present).
- `lcc_signal_authority` — weights, **`shared_mailing_address=50`** already defined (above
  `shared_phone=45`, `shared_name_core=40`). The address signal is weighted; it just has no data.
- `lcc_owner_evidence_cache` — the R7-pattern materialized evidence cache (present).
- Two address-normalize functions + `lcc_apply_contact_feedback` (present).
- `api/_shared/address-reverse.js` + `buildAddressReverseAdapter` — built, gated on
  `OWNER_ENRICH_ADDRESS_URL`, **no-op until wired**.
- `api/_shared/owner-cross-reference.js` — its `same_address` strategy is **starved**; header
  literally says *"owner entities hold no notice address in LCC."*

## The honest problem this solves — and its near-term ceiling

Owner-address coverage is ~0 today: gov `recorded_owners.mailing_address` = **18 / 16,901**;
LCC `entities.address` (org) = **43 / 38,004**. So the `shared_mailing_address=50` signal and the
`same_address` strategy have almost nothing to compare **right now**.

**Therefore Build 2 is not a one-shot over today's empty data — it is a consume-as-produced
wiring.** Its yield grows as the address SOURCES fill:
- Build 1's deed drain → grantee mailing addresses → `recorded_owners.mailing_address` (climbing now).
- Forward deed/OM capture (ORE Phase 1C/1E) + ORE Phase A1 parcel-mailing promote.
- Salesforce account/contact addresses.
- Build 3's SOS capture (later).

Build the engine so it reconciles each address the moment it arrives — that IS Scott's "reconcile
continuously wherever an owner address appears." Be explicit in the report that immediate yield is
small and grows with source coverage; do not inflate it.

## What to build

### Unit 1 — a unified owner-address dimension

A view/materialized dimension gathering EVERY owner-address source per owner entity, normalized
through the EXISTING address normalizer (do not write a new one):
- `recorded_owners.address` / `mailing_address` / `registered_agent_address` (county deed +
  assessor, dia + gov — via the domain bridges already in the owner-facts mirror)
- SOS registry `principal_address` / `mailing_address` (`entity_registry_records`)
- Salesforce account/contact address (where present on the linked SF identity)
- The asset's own location (context, lower authority — an owner-at-property signal, not a notice
  address; keep it distinct)

One row per (owner entity, normalized address, source, authority). This is what feeds the
starved `same_address` strategy and the `shared_mailing_address` evidence signal.

### Unit 2 — reconcile-on-write + a continuous sweep

- **Reconcile-on-write:** wherever an owner address lands (the deed propagation path, the SOS
  sync, SF sync, OM party-contact write), after the address is written, feed it through
  `lcc_reconcile_owner` / the evidence cache so a newly-shared normalized notice address
  immediately surfaces same-party candidates. Best-effort, never blocks the write.
- **Continuous sweep:** a gentle cron (mirror `lcc-owner-reconcile-*` cadence) that refreshes the
  address dimension + re-runs reconcile over owners whose address evidence changed since last
  pass. Bounded, resumable, ANALYZE at the end (the R7 caching discipline). This is what makes it
  "continuous" — the sweep catches addresses that arrive between writes.
- **Auto-merge vs review:** a same-party match driven by `shared_mailing_address` (weight 50)
  ALONE is corroborating, not decisive — a shared address can be a registered-agent office or a
  building with many tenants. Follow the existing engine's threshold: auto-merge only above the
  confidence bar (address + name-core, or address + another signal); a bare shared-address
  match goes to the **review lane**, never a silent merge. Reuse `lcc_reconcile_owner`'s existing
  verdict logic — do not invent a new threshold.

### Unit 3 — wire the address-reverse adapter as ONE input (not the whole build)

Wire `OWNER_ENRICH_ADDRESS_URL` / `buildAddressReverseAdapter` so `enrichment_action=
'address_reverse_lookup'` turns an owner's known address into an occupant/name candidate that
FEEDS the address dimension + reconcile — one contributor among the sources, feature-flagged and
no-op until the env is set (the established rollout pattern). Do NOT make the whole build depend
on it.

## Boundaries

LCC-Opps only (reads the domain owner-facts mirror; no dia/gov writes) · reuse
`lcc_reconcile_owner`, `lcc_signal_authority`, `lcc_owner_evidence_cache`, the existing address
normalizer, `address-reverse.js`, the `same_address` strategy — **do not fork a matcher,
normalizer, or resolver** · a bare shared-address match is reviewed, never silently merged ·
reconcile-on-write is best-effort and never blocks a write · continuous sweep is bounded +
resumable · every merge reversible via the existing `merged_into_entity_id` / batch-tag path ·
no new `api/*.js` if avoidable.

## Verify

1. `npm run check:boot`, full suite.
2. Seed a synthetic pair: two owner entities sharing a normalized notice address + a name-core →
   confirm reconcile surfaces them as same-party and the verdict matches the engine's existing
   threshold (auto-merge only above bar; bare address-only → review). Delete the synthetic rows,
   confirm 0 residue.
3. Confirm the address dimension counts climb as Build 1's deed drain proceeds (report
   `recorded_owners.mailing_address` coverage now vs after a drain pass).
4. Queue-refresh stays low single-digit seconds; the reconcile sweep is bounded (report duration).
5. Report honestly: how many same-party candidates the address signal surfaces **today** (small,
   grows with coverage) — do not project.

## Context

Build 2 of the three-part capture+reconcile design
(`OWNER_CONTACT_CAPTURE_RECONCILE_DESIGN.md`). Build 1 (deed capture) is merged/live. Build 3
(SOS human-in-the-loop sidebar) follows and will feed this same address dimension + reconcile.
The SOS automated path is dead from CI (`GovernmentProject/docs/SOS_ENDPOINT_VERIFICATION_2026-07-22.md`)
— do not revisit it. This is the connective tissue that makes every captured address, from any
source, continuously reconcile the owner graph.
