# Claude Code prompt — TIER 1: split the duplicate detector, auto-resolve provenance noise, + fix OM-intake-onto-archived

> From the deep-dive audit. Tier 0 (gov junk-shell surface exclusion) is done + gate-
> verified — the gov duplicate-address lane is now 230 active issues. Tier 1 turns the
> remaining "review queues" into precise, mostly-auto lanes so the human only sees genuine
> decisions, and fixes the active OM-intake bug Tier 0 surfaced. Receipts-first; each unit
> gated; reversible; never hard-delete.

## Unit 1 — split the duplicate-address detector (it conflates 3 problems)
Measured live: the detector mixes placeholder-address false positives, (Tier-0) archived
junk, and genuine duplicates. After Tier 0 the active set is **dia 42 / gov 230**. Of dia's
42: **16 are placeholder addresses** (`address='Dialysis Unit'` etc. — distinct clinics in
different cities, NOT duplicates), **26 have real addresses**.

Split `v_data_quality_issues` `duplicate_property_address` (dia + gov) into precise lanes:
- **`missing_address`** — a property whose `address` is null/empty or a known placeholder
  (`dialysis unit`, `suite`, `unit`, `n/a`, `tbd`, `unknown`, length < 5). These are NOT
  merge candidates — they're an address-backfill/geocode task (most are geocodable, or the
  real address is recoverable from the linked CMS clinic / county record). 16 dia issues
  move here. **Exclude placeholder/empty addresses from the duplicate-grouping key** so they
  stop generating false "N properties share an address" clusters.
- **`duplicate_property`** — properties sharing a REAL full address (dia 26, gov 230). This
  is the genuine-duplicate lane and the clean input to Tier 2's gated auto-merge. (Already
  excludes archived from Tier 0.)
- Keep the detector conservative: a genuine-duplicate row requires a real, non-placeholder
  address on both sides.
Receipts: before/after lane counts per domain; confirm the 16 dia placeholders leave the
merge lane and land in `missing_address`.

## Unit 2 — auto-resolve the provenance review queue (it's ~98% non-human work)
Measured live on `v_field_provenance_actionable` (warn+strict): **skip = 12,707**,
**conflict = 3,741** of which **3,125 (84%) are same-source** and **367 are cross-source**.
- **Exclude `decision='skip'` from the human review queue/lane entirely.** A skip is the
  registry correctly choosing the higher-priority source — it is TELEMETRY, not a decision.
  It should never render as review work. (R13 Unit 1 did this for one lane; extend it to
  every surface that renders the provenance queue — the Data Quality "Provenance Review
  Queue" + the Decision Center provenance lane both.)
- **Auto-resolve same-source conflicts (3,125).** A `conflict` where
  `current_source = attempted_source` is the SAME source disagreeing with its own earlier
  capture (e.g. costar_sidebar vs costar_sidebar on `gov.loans.origination_date`) — a
  refresh, not a cross-source disagreement. Auto-apply **newest-same-source wins**
  (`use_incoming`) and record it, via the existing R13 learning loop
  (`DECISION_PROVENANCE_LEARN` — **turn it on** and extend the auto-path to the same-source
  case). This drains 3,125 without human clicks and they stop re-surfacing.
- **Leave cross-source conflicts (~367) as the genuine human lane** — these are a
  lower-priority source genuinely disagreeing with a higher/equal one; real judgment.
Net: the provenance queue collapses from ~16k to ~367. Receipts: per-bucket counts before/
after; prove a same-source conflict auto-resolves + stops re-surfacing, and a cross-source
conflict stays.
**Gate the auto-apply** exactly like the prior provenance learning work: effect-first,
outcome-truthful, reversible, and bounded (a capped batch first, receipts to me, then the
rest). Do NOT auto-resolve cross-source.

### Unit 2b — root-cause fix in `lcc_merge_field` (the durability layer — APPLY FIRST)
The drain clears the existing 2,975 same-source conflicts, but new captures re-mint them
unless the arbiter itself stops treating a same-source refresh as a conflict. Fix
`lcc_merge_field`: when **`current_source = attempted_source` AND same priority**, record a
distinct **`decision='refresh'`** (apply newest-same-source) instead of `'conflict'`.
**Order: apply this FIRST, then drain** — so the backlog can't refill during the drain.
Exact scoping (this is the core arbiter — every writer routes through it, so precision is
mandatory):
- **ONLY same-source.** A different source disagreeing (even at equal priority) MUST still
  log `'conflict'` — the genuine 367 cross-source set is untouched.
- **Respects the priority ladder by construction.** If a higher-priority source
  (manual_decision@1, curated) is the current authority, then a lower source's attempt has
  `attempted_source ≠ current_source` → NOT same-source → stays `skip`/`conflict`. A
  same-source refresh can NEVER override a higher-priority curated/manual value. Prove it.
- **`refresh` is a distinct decision** (auditable, countable, reversible — superseded prior
  value retained). In `record_only` fields this only relabels (no data change); in
  `warn`/`strict` the newest-same-source value now applies (correct refresh behavior).
- **Skip and cross-source paths unchanged.**
Tests (mandatory): same-source same-priority → `refresh` (newest applied, no conflict);
cross-source same-priority → still `conflict`; lower source vs higher-priority current
authority → still `skip` (not overridden); record_only vs warn/strict behavior asserted.
Gate: after deploy, a simulated same-source re-capture records `refresh` not `conflict`
(accrual stops); cross-source still logs `conflict`; a strict higher-priority field stays
protected.

## Unit 3 — fix OM-intake matching onto archived/quarantined shells (the active bug)
Tier 0 found the OM-intake pipeline attached **5 real offerings onto archived junk-shell
property_ids** on 2026-06-10/11 (e.g. property 18381 = `718 Robinson St`, a junk-cluster
address). New gov OMs that match a junk-cluster address keep corrupting the book.
- In the OM-intake matcher (the address/property resolver that promotes a staged OM to a
  domain property), **exclude `status='archived'` (and any quarantine status) from the
  match-candidate set**. Match an ACTIVE property or CREATE a new one — never attach to an
  archived shell. Same doctrine as the lease-pipeline match guards (operator/location).
- Conservative: if the only address match is archived, treat as no-match → create the
  property (or route to `match_disambiguation`), don't resurrect a dead id.
- Receipts: a synthetic OM whose address matches an archived junk address resolves to a
  new/active property, not the archived shell; the 5 already-mis-matched offerings
  (17465/18381/20943/21514/23118, already un-archived in Tier 0) are confirmed correctly
  active with their listings (no further action — just verify).

## My gate (independent, read-only, per unit)
- Unit 1: dia merge lane drops to 26, 16 placeholders in `missing_address`; gov genuine-
  duplicate lane = 230; placeholders no longer generate false clusters.
- Unit 2: provenance human queue ≈ 367 cross-source; skips gone from the surface; a
  sampled same-source conflict auto-resolved (newest won) + doesn't re-surface; cross-source
  untouched; the registry learning rule recorded.
- Unit 3: archived ids excluded from OM-intake candidates; the corruption vector closed.

## Guardrails
- Receipts-first; gated per unit; reversible; never hard-delete. Capped batch on the
  same-source auto-resolve before the full drain.
- Reuse existing machinery — `v_data_quality_issues`, the R13 provenance learning loop /
  `lcc_merge_field`, the intake matcher + `match_disambiguation`. Don't fork.
- dia placeholder properties: the address-backfill itself is Tier 4 (connectivity); Unit 1
  only RE-CLASSIFIES them out of the merge lane.
- Don't touch Tier 0's archived set or the cleaned lease records.

## After Tier 1
The genuine-duplicate lane (dia 26 + gov 230) is the clean input to **Tier 2** (gated auto-
merge). Update the audit doc with the post-Tier-1 lane counts.
