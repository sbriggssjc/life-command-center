# Claude Code — R47: resolve current owners → ultimate parent (cluster-mine + registry-to-owners + lane)

## Why (audit live 2026-06-19 — see AUDIT_beneficial_owner_to_ultimate_parent_2026-06-19.md)
We trace ownership *back* to the developer (R46) but not *up* to the controlling parent for the
CURRENT owner. Grounded on LCC Opps (`lcc_property_owner_facts` × `lcc_property_attributes`):
- gov: 8,862 props w/ owner; **3,839 LLC/LP/trust-owned; only 85 (2%) resolve to a registered
  parent; 3,754 unresolved; ~$1.85B unresolved rent; 3,156 distinct owner names.** dia ~320 (its
  owner is usually the operator, not an SPE).
- **No `parent_of`/`controls` edge** exists. Parent rollup (R5 `lcc_buyer_parents` = 25 parents,
  `lcc_operator_affiliate_patterns` 59 buyer patterns, `lcc_buyer_spe_resolved` 743) is applied
  ONLY to the entity that *bought* in a sale (P-BUYER), never to the current owner.
- LLC research (manager/registered-agent → parent) is parked (~9 gov researched, 883 deferred) —
  **out of scope this round** (deferred per Scott; it's the lower-yield long-tail feeder).

**Scope (Scott, 2026-06-19): Units 1-3 only.** Cluster-mine candidate sponsors + apply the
existing registry to current owners + a value-ranked Decision Center lane. Do NOT build the
external SOS-research feeder this round.

## House rules (same as R5/R6/R46)
Reuse `lcc_buyer_parents` + `lcc_operator_affiliate_patterns` — **do NOT fork the registry**;
a sponsor that buys also holds, so it's the same parent. **Operator consumers must stay filtered
`relationship='operator'`** (the R5 rule — `v_lcc_operator_affiliates` /
`_operator_effective_portfolio` / `v_lcc_listing_event_queue`). Fill-blanks; value-ranked by $
rent; idempotent; reversible; LCC-Opps-only (no domain DB writes needed — parent resolution
lives on the LCC entity graph); ≤12 `api/*.js`; `node --check`; suite green; apply DB live after
a dry-run; cache-or-live safe (empty candidate set ⇒ pre-R47 behavior). Never auto-merge a
coincidental-prefix cluster — candidates are confirmed by a human.

## Unit 1 — model the parent/control edge + apply the registry to CURRENT OWNERS
- **Owner-side resolver.** Add `lcc_resolve_owner_parent(entity_id)` (or extend the existing
  resolver path) that resolves a current-owner entity to its controlling parent by consulting
  the SAME registry + patterns the buyer side uses — `lcc_buyer_parents` +
  `lcc_operator_affiliate_patterns` where `relationship IN ('buyer_parent','owner_parent')`
  (a sponsor's SPE naming is identical whether it buys or holds). Mirror `lcc_resolve_buyer_parent`
  (tier-0 domain-truth → name-match), same `(parent_entity_id, parent_name, match_tier)` shape.
- **Owner-side rollup view** `v_lcc_owner_parent_effective_portfolio` — the ownership analogue of
  `v_lcc_operator_effective_portfolio`/P-BUYER: per registered parent, the set of CURRENTLY-owned
  properties (via `lcc_property_owner_facts` resolving to that parent) with count + rolled-up
  rent. So a confirmed parent's controlled portfolio surfaces and value rolls up to the sponsor.
- Materialize/cache like the R7 caches if it's on a hot path; otherwise a plain view. Empty
  registry ⇒ returns the 85 already-matching, no regression.

## Unit 2 — cluster-mine candidate sponsors (the free lever)
- `v_lcc_owner_parent_candidates` (gov + dia) over UNRESOLVED LLC/LP owners, grouped by a
  normalized sponsor token (leading 2 significant words; strip leading numerics/articles), with
  per-cluster: shell count, distinct properties, **rolled-up $ rent** (the rank), and a
  `confidence` tag:
  - **high** = fund-numeral family (a roman/arabic numeral varies across shells sharing the
    token: `SPUS6/7/8`, `LSREF2/4`, `BPG … V/VIII/XI`, `SN Properties Funding IV/V`,
    `Exeter <addr> LP`) — unmistakably one sponsor.
  - **review** = ≥2 shells share a distinctive token but no numeral signal (human-confirm).
  - Exclude coincidental/generic prefixes (`the/first/new/<compass>/saint/fort/park/main/grand/
    plaza/route/property llc/<bare-number>`) and tokens < 4 chars. Never auto-confirm.
- Value-ranked; idempotent; this view is the SOURCE for the Unit 3 confirm lane.

## Unit 3 — Decision Center "beneficial owner / parent" lane (value-ranked)
Reuse the federated-lane machinery (R7/R46: `fetchFederatedSource` + `listFederatedLane` +
verdict dispatch in `admin.js`, lane render in `ops.js`, `lcc_open_decision`/record verdict).
New `decision_type='resolve_owner_parent'`, ranked by cluster/owner $ rent. Per-row verdicts:
- **confirm_parent** — register the cluster's sponsor in `lcc_buyer_parents` (resolve/create the
  parent entity; reuse the R5 path; `needs_sf_mapping` if no SF account) + add an
  `lcc_operator_affiliate_patterns` row `relationship='owner_parent'` for the token, then link
  the member shells → parent (the new owner-parent edge) and refresh the owner rollup. Effect-first,
  outcome-truthful (a failed registry write keeps the decision open).
- **set_parent** — operator names/picks the parent manually (same register+link path).
- **mark_independent** — single-asset / standalone owner with no hidden sponsor → record the BD
  fact (the owner IS its own ultimate parent) and **stop re-asking** (the R13 junk-reviewed
  "stop-asking" pattern — exclude from the candidate view going forward). This is a resolution,
  not a skip.
- **research** — spawn a value-ranked research task (SOS/manual lookup) for the high-value
  unresolved owner where a hidden sponsor is plausible (reuse `research_tasks`; this is the only
  nod to the deferred Unit-4 feeder — a task, not the build).
Idempotent producer (one open decision per cluster/owner subject_ref); resolving rolls the
property up to the sponsor (Unit 1 rollup) and drops it out of the candidate view.

## Guards recap
Reuse `lcc_buyer_parents` (don't fork); keep operator consumers `relationship='operator'`;
fund-numeral = high-confidence, everything else human-confirm (no auto-merge); `mark_independent`
is a real resolution + stop-asking; value-ranked; idempotent; reversible; LCC-Opps-only; ≤12
`api/*.js`; suite green; DB live after dry-run.

## Verify (report back)
Before/after: registered parents (25 → ?), current-owner parent coverage (85 → ? props;
unresolved $1.85B → ?), candidate clusters (79 / 177 shells; 14 high-confidence), owner-rollup
spot-check (e.g. Exeter / SPUS / Lone Star portfolio), DC lane open count, a confirm_parent +
mark_independent round-trip (0 residue), and confirm no operator consumer regressed (P-BUYER /
operator-effective-portfolio byte-identical).

## Bottom line
Closes the trace-*up* gap: current owners roll up to the controlling sponsor using the registry
we already have, cluster-mining grows that registry from the shells themselves (the SPUS/LSREF/
Exeter families), and a value-ranked lane lets the operator confirm parents or mark genuine
independents — the ownership-side analogue of R5's buyer-parent doctrine, with the external SOS
research left as the gated long-tail feeder for a later round.
