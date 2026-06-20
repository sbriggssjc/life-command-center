# Claude Code — R51: make the deed grantee win the owner conflict (wire + forward-propagate + review lane)

## Why (audit live 2026-06-20 — see AUDIT_owner_source_conflict_2026-06-20.md)
Cross-source ownership is mostly consistent (sale→owner 82% gov / 72% dia; `true_owner`≠`recorded_owner`
is by-design SPE-vs-parent), BUT the one authoritative source is captured and ignored:
- gov `latest_deed_grantee` is set on 5,829 properties, yet **`recorded_owner` disagrees with the
  deed grantee on 630 / 5,240 gov props (12%)** — and the deed is usually newer/correct
  (e.g. prop 23599 deeded to a new SPE 2026-05-15 but recorded_owner stale; prop 16304
  recorded_owner = "Marcus & Millichap", a *brokerage*, vs the real deed grantee).
- **Root cause:** `field_source_priority` has only `costar_sidebar` (60) for
  `gov.properties.recorded_owner_name` and **no rule at all** for `gov.properties.recorded_owner_id`
  — no `recorded_deed`/`county_records`. dia is wired correctly (county_records 10 outranks
  aggregators). So the deed can never win, and nothing propagates `latest_deed_grantee` →
  `recorded_owner`. No conflict-detection surface exists (provenance only catches same-field
  conflicts → 0 owner ones).

**Scope (Scott, 2026-06-20): A — wire + forward-propagate now; surface the 630 backlog to a
value-ranked lane; the high-confidence auto-subset is identified in a dry-run Scott blesses before
any bulk write.**

## House rules
The deed grantee is authoritative for **`recorded_owner` (legal title) ONLY** — never write
`true_owner` directly (it's the R47-resolved parent; re-run R47 resolution after a recorded_owner
change instead). Never clobber `manual_resolution`/`manual_edit` (priority 1). Reuse the
broker/junk/implausible guards (`isCompetitorBroker`/`COMPETITOR_BROKER_RE` in sf-nm-classifier.js,
+ the entity-link junk guards) so a brokerage/garbage deed grantee never becomes the owner.
Value-ranked by rent; reversible/snapshot; idempotent; effect-first/outcome-truthful; gov + dia
(dia's priority is already wired — still build the detection lane for its backlog). ≤12 `api/*.js`;
`node --check`/suites green; DB live after a dry-run.

## Unit 1 — wire the gov owner priority (mirror dia)
Add `field_source_priority` rows (LCC) so the deed outranks the aggregator for gov owner fields:
- `gov.properties.recorded_owner_name`: add `recorded_deed` (≈3) + `county_records` (≈10) ABOVE
  the existing `costar_sidebar` (60).
- `gov.properties.recorded_owner_id`: add the full ladder (`manual_resolution`/`manual_edit` 1,
  `county_records` 10, `recorded_deed` 3, aggregators 50-60) — it currently has NO rule.
Mirror the dia rows exactly (dia already has county_records=10 beating costar). Idempotent upsert;
`v_field_provenance_unranked` stays at 0.

## Unit 2 — propagate the deed grantee → recorded_owner (forward, authoritative-only)
On deed capture (wire into the deed writer path — `sidebar-pipeline.js`
`upsertGovernmentDeedRecords` / `upsertDialysisDeedRecords`, and/or a county-records sync), when:
- the captured deed grantee is **newer** than the current recorded_owner's provenance, AND
- the grantee passes the owner guards (not a broker / not junk / plausible owner name),
then update `recorded_owner` via `lcc_merge_field` (`source='recorded_deed'`, top-of-aggregator
priority so it wins), and **re-run the R47 owner-parent resolution** on the new SPE so `true_owner`
re-resolves. Fill-or-update (deed wins over aggregator), but the priority rule + lcc_merge_field
decision is the gate — a lower-priority source still can't clobber a higher one. Reversible
(provenance row + the prior value recoverable). This makes NEW deeds self-correct the owner.

## Unit 3 — detection view + Decision Center "ownership conflict" lane (the 630 backlog)
- **`v_owner_source_conflict`** (gov + dia) — properties where `recorded_owner` ≠
  `latest_deed_grantee` (normalized), PLUS the stale-seller set (owner = the seller of a recorded
  sale). Per row: deed grantee, deed date, current recorded_owner, true_owner, a `conflict_kind`
  (`deed_newer_stale` / `broker_as_owner` / `spe_vs_parent` / `stale_seller`), and rolled-up rent
  for ranking. `spe_vs_parent` = recorded_owner is the registered parent of the deed SPE (legit —
  default keep).
- **Decision Center lane** `decision_type='owner_source_conflict'` (reuse the R7/R46/R47 federated
  lane machinery in admin.js/ops.js), value-ranked. Verdicts:
  - `accept_deed` → Unit-2 propagate (deed grantee → recorded_owner + R47 re-resolve).
  - `broker_not_owner` → clear the broker-as-owner recorded_owner, set the deed grantee, re-resolve.
  - `keep_current` → recorded_owner is right (spe_vs_parent already resolved) — record + stop-asking.
  - `research` → spawn a directed task.
  Effect-first, idempotent mint, reversible.
- **High-confidence auto-subset (dry-run gated):** a function that lists the rows where
  `conflict_kind IN ('broker_as_owner','stale_seller')` OR (`deed_newer_stale` AND deed date is
  clearly newer AND grantee passes guards). GET/dry-run returns the would-change set + before/after
  for Scott; a POST (or a `DECISION_OWNER_DEED_WINS`-style gate) applies them via Unit-2. Do NOT
  bulk-write the 630 without the dry-run blessing.

## Verify (report back)
- Unit 1: the new gov owner priority rows present; `v_field_provenance_unranked`=0.
- Unit 2: a synthetic forward test — a newer deed grantee on a throwaway gov property propagates
  to recorded_owner (deed wins via lcc_merge_field), true_owner re-resolves, fully reverted, 0
  residue. A broker/junk grantee is REJECTED (recorded_owner unchanged).
- Unit 3: `v_owner_source_conflict` counts by `conflict_kind` (gov ~630 + dia); a verdict
  round-trip per kind (0 residue); the dry-run auto-subset returns a before/after WITHOUT writing.
- No `true_owner` clobbered; no `manual_resolution` overwritten; suites green; ≤12 api/*.js.

## Bottom line
The recorded deed grantee — the authoritative "who took title" — is captured on 5,829 gov props
but can't win and never propagates, so 630 show a stale or broker-as-owner value. R51 wires the
deed to outrank the aggregator (mirroring dia), propagates it into recorded_owner on new captures
with R47 parent re-resolution, and surfaces the existing backlog as a value-ranked review lane with
a dry-run-gated high-confidence auto-subset — so ownership self-corrects as deeds are ingested.
