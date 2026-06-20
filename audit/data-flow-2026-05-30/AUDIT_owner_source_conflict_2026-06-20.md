# Audit — cross-source ownership conflict resolution (2026-06-20)

**Question (Scott):** when recorded_owner vs true_owner vs deed-grantee disagree on who owns a
property, does the right source win and propagate — or do stale/conflicting owners persist?

## Verdict: mostly consistent, BUT the authoritative deed grantee is captured and then ignored — the LESS authoritative aggregator owner is what's shown, with no detection or propagation

### What's healthy
- **Sale → owner propagation mostly works:** of recently-sold properties (24mo, with a buyer),
  the current owner matches the buyer 82% (gov) / 72% (dia). Only **16 gov + 10 dia** are
  clearly stale (owner still = the seller).
- **field_provenance owner conflicts: 0 actionable.** Same-field/different-source disagreement
  isn't the problem — owner writes come almost entirely from aggregators (costar/rca/crexi).
- `true_owner` differing from `recorded_owner` is by design (recorded = legal-title SPE,
  true = resolved parent per R47) — not a conflict.

### The real gap — deed grantee captured but never wins or propagates
The authoritative source IS captured: gov `deed_records` has **5,573 rows with a grantee**, and
**5,829 properties carry `latest_deed_grantee`**. But it's a dead-end field:
- **`recorded_owner` disagrees with the deed grantee on 630 of 5,240 gov properties (12%)** where
  both are set. recorded_owner and the deed grantee are *both* legal-title level, so a
  disagreement is a genuine inconsistency — and spot-checks show the deed is usually the **more
  recent, more authoritative** value:
  - prop 23599 — deed "International Falls MN I FGF LLC" (2026-05-15) vs recorded "ARC GSIFLMN001
    LLC" → property changed hands to a new SPE; recorded_owner stale.
  - prop 16304 — deed "The Michael Parker Living Trust" vs recorded **"Marcus & Millichap"** (a
    *brokerage*, not an owner) → recorded_owner is wrong (broker-as-owner); the deed is right.
  - prop 6643 / 983 / 11450 — deed shows a newer SPE; recorded_owner shows the prior owner.
  - (some are SPE→parent false-positives, e.g. deed "ARC VALWDCO001 LLC" vs recorded "American
    Realty Capital" — legitimately consistent; the lane must not clobber these.)

### Root cause — the priority registry never wired the deed/county source for gov owner
`field_source_priority` proves it:
- **`gov.properties.recorded_owner_name` has ONE rule: `costar_sidebar` (60).** No
  `county_records`, no `recorded_deed`. **`gov.properties.recorded_owner_id` has NO rule at all.**
- Contrast **dia**, which is wired correctly: `dia.properties.recorded_owner_name` /
  `recorded_owner_id` have `county_records` (10) **outranking** costar_sidebar (50-65).
- gov captures the deed (`latest_deed_grantee`, `latest_deed_date` ← county_records priority 10)
  but there is **no source rule and no writer** to let that deed grantee win/propagate into
  `recorded_owner`. So the deed sits in `latest_deed_grantee`, and the app shows the stale
  aggregator owner.
- **No conflict-detection surface** exists: provenance only catches same-field conflicts (0
  owner ones); the cross-table deed-vs-recorded-owner staleness is invisible — no view, no lane.

## Fix doctrine → R51 (right source wins + propagate + surface)
The doctrine the whole engagement is built on: as authoritative data (a recorded deed) is
ingested, it should win the conflict and propagate; the ambiguous cases go to directed review.
- **Unit 1 — wire the gov owner priority (mirror dia).** Add `recorded_deed` / `county_records`
  source-priority rules for `gov.properties.recorded_owner_name` + `recorded_owner_id` (and
  `gov.recorded_owners.name`/`canonical_name` already have recorded_deed=3/county=5) so the deed
  grantee OUTRANKS costar_sidebar. Forward-looking: new captures resolve correctly.
- **Unit 2 — propagate the deed grantee → recorded_owner** when it's authoritative: deed strictly
  newer than the recorded_owner capture AND the grantee is a real owner (reuse the
  broker/junk/implausible guards — Marcus & Millichap etc. are brokers, not owners). Update
  `recorded_owner` via `lcc_merge_field` (provenance `recorded_deed`), then **re-run the R47
  parent resolution** on the new SPE so `true_owner` re-resolves. Reversible. Do NOT touch
  `true_owner` directly (it's the resolved parent) and never clobber `manual_resolution` (pri 1).
- **Unit 3 — detection view + Decision Center "ownership conflict" lane.** `v_owner_source_conflict`
  (gov+dia) = recorded_owner ≠ latest_deed_grantee (+ the stale-seller set), value-ranked by rent.
  Verdicts: `accept_deed` (deed wins → Unit-2 propagate), `keep_current` (SPE→parent already
  resolved — legit), `broker_not_owner` (clear the broker-as-owner, deed wins), `research`. Reuse
  the federated-lane machinery. The high-confidence subset (deed newer + recorded_owner is
  broker/junk or = the seller) can auto-resolve behind a dry-run + Scott's blessing.

## Scope fork for Scott (asked before building)
The ~630 gov deed-vs-owner conflicts touch the *displayed* owner. How aggressive on the backlog?
- **A — wire + forward-propagate now; surface the 630 backlog to the lane** (high-confidence
  auto-subset gated behind a dry-run you bless). Safest; matches the R49 posture.
- **B — wire + auto-resolve the high-confidence subset now** (deed newer AND recorded_owner is a
  broker or = the seller), surface only the ambiguous remainder. Faster cleanup, bigger immediate
  write.
- **C — detection + lane only** (no auto-propagation); every conflict is operator-confirmed.

## Bottom line
Ownership is mostly consistent, but the one authoritative source — the recorded deed grantee — is
captured and then ignored on gov: there's no priority rule and no propagation, so 630 properties
show a stale or wrong (broker-as-owner) aggregator owner while the correct deed grantee sits
unused in `latest_deed_grantee`, and nothing surfaces the conflict. R51 wires the deed to win
(mirroring dia), propagates it into recorded_owner with R47 parent re-resolution, and surfaces the
rest as a value-ranked review lane.
