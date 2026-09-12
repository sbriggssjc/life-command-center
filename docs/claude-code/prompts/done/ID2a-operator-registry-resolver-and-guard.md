# ID2a — The operator source-of-record fix, phase A: canonical registry + alias table + one resolver + write guard (no consumer switch yet)

**Repo: `life-command-center`.** Builds the identity substrate ID1 designed, with Scott's decisions settled.
**Backfill is reviewed, never guessed.** Consumers switch in ID2b; the market brief (MB-b) waits on that.

**Read first:** `CLAUDE.md` → Core doctrines → "TRUTH IS FIXED AT ITS SOURCE OF RECORD" ·
`docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` — **all of it**, especially §2 (writer inventory W1–W10),
§5 (design), §9 (live findings), §10 (Cowork reconcile) · `docs/audits/ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md` ·
`docs/architecture/data-coherence-invariants.md` **I13/I14/I15** · `docs/os/PLANNED-BACKLOG.md` §P0d ID1–ID4 ·
`api/_shared/operator-normalize.js` + `supabase/migrations/dialysis/20260624_dia_operator_normalize.sql` ·
the `external_identities` cross-lane pattern.

## Scott's decisions (2026-09-11) — settled, build to them

| Decision | Answer |
|---|---|
| Canonical name, Fresenius | **`Fresenius Medical Care`** (3 of 4 sources agree). Seed `short_operator: 'Fresenius'` in the CM export display map so no chart label changes. |
| Canonical name, US Renal Care | **`US Renal Care`** (brand form, as CMS uses). `US Renal Care, Inc.` becomes an alias. |
| Registry home | **Dialysis_DB owns the registry; LCC Opps references it through `external_identities` with `source_type='operator'`** — never a second identity. `lcc_operator_affiliate_patterns` becomes a cache keyed off the domain `operator_id`, or is retired (state which, with the migration). |
| Write guard | **Hard block plus alert.** A write that doesn't resolve to a canonical operator is refused and routed to the review lane; a scheduled detector alerts on anything that slips through (the I11 alert path). |
| Gov agency sequencing | **Separate.** Gov agency identity is its own registry for its own fact (ID3a) — same pattern, different build. Don't fold it in here. |
| `DaVita`, `Dialysis Clinic, Inc.` | Settled by evidence; `DaVita at Home` is a **brand child** of DaVita, not an alias. |

## 1. Registry and aliases (Dialysis_DB)

- Rebuild `operators` as the canonical registry: one row per real company, `parent_operator_id` for brands and
  subsidiaries, a `kind` distinguishing company from classification, and provenance columns. The current 67 rows
  hold three separate identities per operator (ID1 §1.2 and §10): duplicates (USRC ×3, DCI ×2, DaVita ×5), the
  categories `None`/`Other`/`Independent`/`State Owned`, and the non-operators `UnitedHealthcare` and
  `Kaiser Permanente`. **Retire, don't delete:** every retired row keeps a `merged_into_operator_id` so old ids
  still resolve, and nothing that referenced them breaks.
  - Categories move to a classification column or lookup, not an operator row.
  - `DaVita | US Army Corps of Engineers` and `DaVita |San Antonio Kidney Disease Center` (ids 75, 70) are
    **not operators at all** — they're multi-tenant artifacts (ID3i). Retire them and leave the affected
    properties for ID3i; do not invent a merge.
- An alias table: alias text, `operator_id`, source, confidence, who or what added it, and a unique index on the
  normalized alias. Seed it from the observed variants in ID1 §1.1 and the three existing registries, each alias
  carrying the registry it came from.
- Model the subsidiaries ID0 found on the guarantor side (`Total Renal Care, Inc.`, `DVA Healthcare Renal Care,
  Inc.`, `Fresenius Medical Care Holdings, Inc.`) as **child rows with a parent link**, since a guarantor's legal
  identity is a credit fact. Don't merge them into the parent. (Guarantor columns themselves switch in ID3d.)

## 2. One resolver, and the end of the second canonical

- Extend `operator-normalize.js` into the single resolver: text in, `{operator_id, canonical_name, status}` out,
  resolving through the alias table and failing closed to `needs_review` (never minting).
- **Change its declared canonical for Fresenius to `Fresenius Medical Care`** per the decision, and keep the SQL
  mirror in lock-step (both are the same map; the test pins the receipts).
- Every writer in ID1 §2 routes through it: W1 (OM promoter), W2 (sidebar lease carry-forward), W3
  (`asset-entity.js` — this is what polluted LCC entities: it must resolve rather than mint a name-derived entity),
  and any path that writes `dia.properties.operator`, `dia.leases.operator`, `dia.tenants`, or an LCC entity from an
  operator string. W6 (the Dialysis repo's CMS ingester) can't be changed from here: document the contract it must
  honor and file it for that repo.

## 3. FK, guard, and review lane

- Add `operator_id` to `dia.properties` (and to `leases` where the audit says it belongs) with an FK to the registry.
- **Hard block:** a trigger or constraint that refuses a write whose operator text doesn't resolve, routing it to
  the review lane with its raw value intact. **Fail closed, never silently null.**
- Review lane: a Decision Center-style queue (reuse the existing lane machinery, per the audit) where a human
  resolves an unmatched string once and the answer is written back as an alias, so it never returns.
- Detector: register the identity columns in the I13 registry that ID4 builds, or ship a placeholder view ID4 will
  adopt. Say which.

## 4. Backfill — reviewed, measured, reversible

- Resolve every existing row's free text to an `operator_id`. **Auto-apply only exact and alias matches;**
  everything else goes to the review lane. Report the auto/review split before applying, and apply in a
  transaction with a recorded before/after count per operator.
- **The parity gate:** the TTM cap-rate band per operator family before and after must differ only by the merge of
  known variants (`Fresenius` n=63 + `Fresenius Medical Care` n=12 → one band, n=75, and the same for DaVita).
  Anything else means the backfill moved a row it shouldn't have — stop and report.
- Don't touch `entities` on LCC Opps in this phase beyond `external_identities` links. **Never link LCC entities
  by name match** (ID3g: asset entities carry operator names).

## 5. What NOT to do

No consumer switch (`rpc_query_comps`, CM views/exports, the market brief, the dossier, MCP tools) — that's ID2b
with its own parity measurement. No gov agency work (ID3a). No multi-tenant restructuring (ID3i). No new
normalizer anywhere.

## Guard + ship

Tests: resolver (aliases, fail-closed, parent/child), the guard (a raw write is refused and lands in review), the
backfill's auto/review split on fixtures, the retired-id resolution path, and a test that fails if a second
canonical map appears in the repo. Full suite green. Branch → PR → CI → merge → redeploy BOTH Railway services.

## Verify live, then report

Apply the migrations, run the backfill in report-only mode first, then apply. Report: registry before/after, alias
count, auto vs review split, FK coverage on `properties`, the parity check above, and the review queue depth.

## Ship + record

`PLANNED-BACKLOG.md` §P0d (ID2a done, ID2b opened for the consumer switch, ID3d/ID3g/ID3i cross-references),
`STATUS.md`, `CURRENT-STATE.md`, and an audit addendum with the measured numbers.
