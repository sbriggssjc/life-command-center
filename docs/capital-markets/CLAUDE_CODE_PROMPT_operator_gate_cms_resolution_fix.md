# Claude Code prompt — FIX the operator-agreement gate: it didn't fire on the live mismatch (HOLD the drain)

> The live gate-verification of Unit 3 FAILED. After PR #1202 deployed, I reset the
> markers on 5171/5175 and re-ran them through the operator gate: they STILL resolved to
> `enrich_create_rejected` / `dateless_active_lease` on the Satellite property 30680 —
> NOT `operator_mismatch`. The gate did not block the DaVita-doc-vs-Satellite-property
> mismatch it was built to catch. The dateless reject incidentally prevented a bad write
> (nothing corrupted), but a DATED cross-operator doc would write straight through.
> Receipts-first; drain stays HELD until this is fixed and I re-verify live.

## Proof the DATA is clean — so this is a gate-logic bug, not missing data
Direct CMS link on the property (verified live, dia DB):
```
properties.property_id = 30680
  → properties.medicare_id = '552827'
  → medicare_clinics.medicare_id = '552827'
     facility_name      = 'SHC BLOSSOM VALLEY'
     chain_organization = 'Satellite Healthcare'   ← authoritative operator
     owner_name         = 'Satellite Healthcare'
properties.tenant (stored) = 'SHC BLOSSOM VALLEY'   ← a FACILITY NAME, not an operator
```
Doc side (5171/5175) extracted tenant = `Total Renal Care, Inc.` → DaVita family.
So the authoritative comparison is **DaVita (doc) vs Satellite Healthcare (property CMS
chain)** — a clear two-sided contradiction that MUST route to `match_disambiguation`.

## Root-cause hypothesis (confirm, then fix)
The gate almost certainly fell back to the property's **stored `tenant` = "SHC BLOSSOM
VALLEY"** instead of the CMS `chain_organization = "Satellite Healthcare"`.
`dialysisOperatorFamily("SHC BLOSSOM VALLEY")` has no `satellite` token → returns `null`
→ the conservative "unknown on either side passes" rule let it through. I.e.
`getPropertyOperator` is NOT reading `properties.medicare_id → medicare_clinics.
chain_organization` (which resolves cleanly above); it degraded to the facility-name
`tenant` and the gate went blind.

(Secondary possibility: the gate is positioned AFTER `ensureLeaseRow`'s create, so the
dateless reject fires first. Rule this out with a log line — see Unit 2.)

## Unit 1 — fix `getPropertyOperator` to use the authoritative CMS chain
- For dia, resolve the property's operator via **`properties.medicare_id →
  medicare_clinics.chain_organization`** (proven to return "Satellite Healthcare" for
  30680). That is the FIRST/authoritative signal. Use `owner_name` as a secondary CMS
  signal if `chain_organization` is null.
- Fall back to the stored `properties.tenant` ONLY when there is no CMS link — and treat
  it as a facility/operator string that may not map to a family (that's fine; it just
  means "unknown" on a genuinely unlinked property, which conservatively passes).
- gov unchanged (`agency`).
- Make `getPropertyOperator` independently unit-testable with injected rows so the
  30680-shaped case (medicare_id present → chain "Satellite Healthcare") is asserted
  directly, not just end-to-end.

## Unit 2 — confirm the gate runs BEFORE the create (and is observable)
- Add a one-line server log at the gate decision point (`property_operator`,
  `doc_operator`, `families_contradict`, `decision`) so the live behavior is inspectable
  on the next drain — this is how we'll see it firing (or not) without guessing.
- Verify ordering: the operator gate must evaluate AFTER the property match resolves but
  BEFORE `ensureLeaseRow` / any write, so a cross-operator mismatch routes to
  `match_disambiguation` regardless of whether the doc is dateless. (The dateless path
  must not be able to mask the operator decision.)

## Unit 3 — tests that would have caught this
- **Dated cross-operator unit test** (the one the dateless path masked): a doc with full
  dates + DaVita tenant, matched to a property whose CMS `chain_organization` is
  Satellite → asserts `operator_mismatch` → `match_disambiguation`, NO create, NO write.
- **CMS-over-stored-tenant test:** property has `medicare_id` → CMS chain "Satellite
  Healthcare" but a facility-name `tenant` "SHC BLOSSOM VALLEY" → `getPropertyOperator`
  returns the Satellite chain (NOT the facility name), so the contradiction is detected.
- **No-false-positive test:** DaVita doc → DaVita-CMS property still enriches.
- Keep the existing conservative rule (only a clear two-sided different-family contradiction
  blocks; unknown-on-either-side passes; gov exempt).

## My live re-verification (after merge + redeploy)
1. Reset markers on **5171/5175** → re-drain → MUST now show `operator_mismatch` /
   `match_disambiguation`, **no write to 30680** (no lease, no edge, no provenance).
2. The continuing drain: a normal DaVita-doc → DaVita-property case still enriches (no
   false positive).
3. Standard sweep on anything enriched (no dup edge / no dup lease / no clobber / 40041 +
   30680 clean).

## Guardrails
- Receipts-first; ≤12 api/*.js; reuse `getPropertyOperator` / `dialysisOperatorFamily` /
  `operatorFamiliesContradict` / `match_disambiguation` — fix the resolution, don't fork.
- Don't touch the cleaned records (dia 25312 / 19530 / 14365; canonical `guaranteed_by`
  edges; superseded provenance 1403859 / 1406606 / 1406607).
- The corpus drain stays HELD until I re-verify the gate fires live.
