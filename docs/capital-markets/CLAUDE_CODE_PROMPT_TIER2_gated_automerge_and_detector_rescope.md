# Claude Code prompt — TIER 2: re-scope the duplicate detector + gated auto-merge of true duplicates (+ gov expired-lease fix)

> From the deep-dive audit. Tier 1 split the detector + drained provenance. The Tier-2 gate
> grounding found the "genuine duplicate" lane is STILL mostly not-duplicates (same-address/
> different-operator co-located buildings), and only ~32 small same-operator groups are
> truly auto-mergeable. So Tier 2 = (1) re-scope the detector to stop flagging co-located
> distinct properties, (2) gated auto-merge of the real duplicates, (3) the gov expired-lease
> over-firing fix Tier 1 surfaced. Receipts-first; gated; reversible; never hard-delete.

## Prereq — confirm the merge-function hardening landed (Tier 2 depends on it)
The gov sale-FK fix is LIVE (0 NO-ACTION FKs to `sales_transactions`). Before any batch
auto-merge, CONFIRM (and apply if missing) the full
`CLAUDE_CODE_PROMPT_property_merge_sale_fk_and_function_hardening` scope:
- gov FK migration committed (already live); **dia FK parity** applied
  (`broker_market_coverage.sale_id`, `loans.sale_id`, `property_documents.sale_id` →
  ON DELETE SET NULL) so a dia batch merge can't 500;
- `gov_merge_property` / `dia_merge_property` collision-fallback DELETE wrapped in its OWN
  `BEGIN…EXCEPTION` so a single blocked delete records into `rewired` instead of aborting
  the whole batch.
Receipts: dia FKs to `sales_transactions` show 0 NO-ACTION; a synthetic colliding merge
records the block and does NOT 500.

## Unit 1 — re-scope the duplicate detector (same-address ≠ duplicate)
Measured live: of the duplicate_property candidates, the majority are same-address but
**different operator** — co-located distinct properties (gov multi-tenant buildings: 84
groups; dia hospital campuses: 9 groups), NOT duplicates. Only same-address + **same
operator** is a duplicate candidate (gov 30, dia 2). Re-scope `v_data_quality_issues`
`duplicate_property`:
- **`duplicate_property`** (merge candidate) = same full real address + state AND **same
  operator family** (gov `agency`; dia CMS `chain_organization`, falling back to `tenant`)
  AND small group (n ≤ 4). This is the auto-merge input (~32 groups).
- **Same address + DIFFERENT operator → NOT a duplicate.** Reclassify as a separate, lower-
  priority informational signal (e.g. `colocated_distinct` / "verify not multi-tenant") or
  drop from the review surface entirely — it is NOT merge work. (84 gov + 9 dia groups
  leave the merge lane.)
- **Large groups (n > 4)** stay a small manual lane (a big same-address cluster is a
  corruption/multi-tenant signal, never an auto-merge). 1 gov + 1 dia.
Receipts: merge lane drops to the ~32 same-operator candidates; the co-located set is
relabeled out, not merged.

## Unit 2 — NO auto-merge; produce a clean MANUAL merge lane (~9 groups)
**Grounding decision (verified live): do NOT build/run a blind auto-merge.** After Unit 1
re-scopes, the genuine duplicate candidates are only **~7 gov + ~2 dia ≈ 9 groups**, and
even the cleanest (Tallahassee: property 3867 lease `LFL50031` + 8 sales vs 23343 lease NULL
+ 4 sales, non-overlapping sale_ids) is a real property-dup whose merge **combines 12 split
sales onto one property** — a consequence a human must see, not a clean auto-action. With ~9
items and messy child-data consequences, auto-merge is all risk, no leverage.
- **Unit 2 = surface the precise manual candidate lane**, not an engine. Candidate predicate:
  same full real address + same operator family + **non-conflicting lease/identity** (same
  or one-null `lease_number` gov / `medicare_id` dia — NOT different non-null, which = two
  distinct leases). gov ~7, dia ~2.
- Route that lane to the EXISTING Decision Center **Consolidate / property_merge** surface
  (now FK-unblocked + hardened) for one-click human merge — the human picks the surviving
  record and sees the combined-sales consequence. This is the right home for the
  irreversible decision.
- **Defer the auto-merge engine.** Revisit only if a truly-unambiguous class emerges at
  volume (e.g. one record near-empty + same lease + same sale-set). Today it would process
  0 safely.
Receipts: the manual lane resolves to ~9 candidates; each is same-address + same-operator +
non-conflicting-identity; the 23 gov different-lease + 84 different-agency groups are NOT in
it (Unit 1 relabeled them out).

## Unit 3 — gov expired-lease: re-scope the over-firing detector (NO auto-supersede)
gov `expired_lease_not_superseded` = 5,839, but it's almost entirely a false-positive
detector. Verified live, tightening scope: 136 have *any* newer co-located lease → only **6**
have a strict successor (newer lease `commencement_date > expiration_date`) → **0** of those
share the same `tenant_agency`. So the clean same-tenant-renewal auto-supersede population is
**0**; the 6 are different-tenant (ambiguous re-let vs multi-tenant), which the dia doctrine
explicitly leaves for human review.
- **Do NOT build a gov auto-supersede trigger** — it has ~0 safe targets (0 same-tenant
  successors). Auto-superseding the different-tenant 6 would risk the overlapping/multi-tenant
  case dia deliberately avoids.
- **Re-scope the detector** (the real fix): the **5,703 no-replacement** expired leases →
  relabel `expired_no_renewal` (low-priority status signal — vacant/disposed, or a missing-
  renewal enrichment gap; NOT a supersede action). The **~133 overlapping/co-located** (incl.
  the 6 different-tenant successors) → route to the existing **multi-active-lease / human-
  review** lane, not auto-actioned. Net: the 5,839 "supersede" lane → **~0 actionable**.
Receipts: detector no longer flags the 5,703 as supersede work; the overlapping handful is in
the human lane; nothing auto-superseded.

## My gate (independent, read-only, per unit)
- Unit 1: merge lane = ~32 same-operator candidates; co-located-different-operator relabeled
  out; large groups in the manual lane.
- Unit 2: capped batch merged cleanly (no 500, dup gone, richest kept, child rows handled);
  every auto-merge had address+operator+identity agreement and no hard conflict; manual
  residue is the genuinely-ambiguous set.
- Unit 3: 136 auto-superseded + reversible; detector re-scoped; 5,703 relabeled.

## Guardrails
- Receipts-first; gated per unit; capped batch before full; reversible; never hard-delete.
- Reuse the hardened merge RPC, the operator-agreement machinery (lease pipeline / CMS
  chain), `v_data_quality_issues`, the dia auto-supersede pattern. Don't fork.
- A wrong merge is the highest-risk action in this whole plan — keep the identity gate
  strict; when in doubt, escalate to manual, don't auto-merge.

## After Tier 2
The duplicate + expired-lease lanes are now precise + mostly auto. Remaining manual review
is a small genuine residue. Tier 3 consolidates the surfaces; Tier 4 is connectivity.
Update the audit doc with post-Tier-2 lane counts.
