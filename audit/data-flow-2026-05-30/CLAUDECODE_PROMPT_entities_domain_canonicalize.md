# Claude Code prompt — entities.domain canonicalization (5th dia/gov alias bug) + entity-bridge tenant guard

Paste into Claude Code, run from the **life-command-center** repo. Two units,
one writer. Grounded live 2026-06-07 during the R9 follow-ups verification.

## The finding

`entities.domain` on LCC Opps carries BOTH spellings — live counts:
gov 8,950 / dia 6,713 / **government 871 / dialysis 142** / lcc 35 / NULL 1,293.
The long-form rows are nearly all from the last 7 days and the writer is
unmistakable from metadata: the **CoStar sidebar pipeline's entity bridge**
(`source: costar`, `_pipeline_summary.domain: "government"`). R4-A
canonicalized `external_identities.source_system` through
`canonicalIdentitySystem()`, but `entities.domain` itself was never normalized
at that writer. This is the **5th** instance of the alias class (after
`getDomainCredentials`, QA#9, E2E#5, R4-A) — the fix must make a 6th
structurally impossible, same playbook as `20260604121000`.

Same sample exposed a second leak: the bridge mints **tenant-mix labels as
organization entities** — "Massage Therapist", "Wing King Express", "Chicago
Steak House" from a multi-tenant CoStar capture (property 31457, Delano CA).
`isJunkTenant()` guards the leases writer but the entity bridge doesn't run
it, so demographic/tenant-panel bleed-through becomes entity-graph pollution.

## Unit 1 — canonicalize the writer + the data + the constraint

1. **Writer fix (the choke point).** Find every path that writes
   `entities.domain` (sidebar-pipeline's entity bridge is the proven offender;
   sweep for others — `ensureEntityLink` callers, domains.js connector sync,
   operations.js create paths) and route the value through the existing
   canonical mapper (`canonicalIdentitySystem()` or a sibling
   `canonicalEntityDomain()` if the identity-system semantics don't fit —
   `dialysis→dia`, `government→gov`, preserve `lcc` and NULL untouched; `lcc`
   is a legit third value per the E2E#5 rule, never remap it).
2. **One-time normalization migration** (LCC Opps):
   - **Dedup first**: 17 cross-spelling duplicate pairs exist (same
     `canonical_name` + `entity_type` under both spellings). Merge long-form
     loser → short-form winner via `lcc_merge_entity` (the established
     direction: newer artifact into established entity — verify per pair that
     the short-form row is the older/richer one; report any where it isn't).
     Repoint any `lcc_developer_classification_log` rows (the merge function
     does NOT touch that ledger — known from the R9 one-click run).
   - Then `UPDATE entities SET domain='dia' WHERE domain='dialysis'` (and
     gov). Idempotent.
3. **Constraint, deploy-ordered**: `CHECK (domain IN ('dia','gov','lcc') OR
   domain IS NULL)` in a SEPARATE migration applied only AFTER the Railway
   redeploy of the writer fix — the deployed bridge still writes long-form
   until then, and an early constraint would 500 every CoStar capture (the
   R4-A rule, stated in the migration header).
4. **Consumers**: grep for `domain = 'dialysis'` / `'government'` /
   `in.(dia,dialysis)` transition filters against `entities.domain` and tidy
   them to canonical-only once the data is normalized. Check the queue/band
   views and `_pipeline_summary` consumers don't break — the metadata jsonb
   keeps its historical long-form strings (don't rewrite metadata).

## Unit 2 — tenant-label guard at the entity bridge

The bridge needs the same junk discipline the leases writer has:

1. At the entity-mint boundary in the sidebar bridge (and ideally inside
   `ensureEntityLink` so every caller inherits it), run tenant-candidate
   names through `isJunkTenant()`-equivalent checks before minting an
   `organization`. The specific leak class: names sourced from the CoStar
   tenant-mix/tenant-panel (the capture's `tenants[]` array) minting as
   first-class org entities. Role labels ("Massage Therapist") are junk
   everywhere; real-but-irrelevant co-tenants ("Wing King Express") are a
   judgment call — recommend: only mint org entities for the PRIMARY tenant
   (`tenant_name`) and owners/buyers/sellers/brokers, never for the
   tenant-mix list. If the mix list has value, store it in the asset
   entity's metadata (it already is — `metadata.tenants`), don't mint.
2. **Sweep**: find existing org entities whose only provenance is a
   tenant-mix capture (no portfolio facts, no identities beyond the capture,
   no relationships except to the one asset) and whose names match role-label
   or non-CRE-business shapes; soft-flag to the junk lane
   (`junk_name_source='tenant_mix_bleed'`). Report count + 5 spot-checks
   before flagging. Zero hard-deletes.

## Verify + ship
- Unit 1: post-migration `SELECT domain, count(*) FROM entities GROUP BY 1`
  shows only dia/gov/lcc/NULL; 17 dup pairs resolved (report the list);
  constraint deferred with the header note; one live CoStar capture
  post-redeploy mints short-form (I'll drive that check).
- Unit 2: a synthetic capture with a tenant-mix list mints ONLY the primary
  tenant + asset; the sweep count + spot-checks reported.
- House rules: `node --check`; 12 functions; migrations idempotent;
  constraint AFTER writer deploy; zero hard-deletes; effect-first; report
  per-unit status.
