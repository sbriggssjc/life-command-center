# C13g-min — a single-row `entity_type` retype behind a human verdict, so OWN-T0e-b's type guard can be answered instead of walked around

**Read first:** `docs/os/BUILD-TURN-PROTOCOL.md` · `docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md`
**§7–§8** (the guard that refuses, and the live after-state) · `docs/architecture/owner-role-classification.md`
**§9b** (C13g sized, not started) · `CLAUDE.md` on **A2a** (the recorded `entity_type` is the fact; a
name-shape guess held six real companies), **P149** (the bulk retype and its `metadata.p149_prior_entity_type`
reversal shape), **P167** (merging a person into an organisation), and **SEC1-definer-default** (any
`SECURITY DEFINER` migration needs the revoke + `has_function_privilege()` stanza in the same file).

**This is NOT C13g.** C13g is the capture-path fix at the transaction vendors (RCA/CoStar file a
company in a deal's "contact" slot and it is minted `person`). This unit is the **minimum** that
unblocks the merges the type guard is correctly refusing today: ONE human verdict that retypes ONE
entity, reversibly, with the reason on a ledger. Nothing bulk, nothing lexical, nothing automatic.

---

## 1. The measurement this rests on (2026-09-09, LCC Opps, live)

**Two OWN-T0e cards are type-blocked**, both `spe_props_max ≥ 2` groups whose "SPE" is a person-typed
duplicate of the sponsor:

| sponsor (organization) | blocked member | recorded type | current facts | co-claimed conflict props |
|---|---|---|---:|---:|
| `Gardner Tanenbaum Holdings` (6b8887c2…, 512 rels, 22 facts, owner of 50) | `Gardner-Tanenbaum` (4dac1df8…, 304 rels, 3 × `rca/contact` xids) | **person** | 18 | **14 / $6.17M** |
| `Massmutual` | `MassMutual Life` | **person** | 14 | **14 / $5.25M** |

⚠️ **A merge clears fewer than 14.** On **10 of the 14** Gardner properties a THIRD owner candidate is
current — the firm's own SPEs (`RTD ANDERSON LLC`, `RTD ST. LOUIS - FBI, LLC`, `TEP Flint MI SSA LLC`,
`TEP Roseville LLC`, … one per property), which share **no brand token** with the sponsor, so the
OWN-T0e gate cannot reach them either. Retype + merge takes **4** properties out of `unclassified_rival`;
the other 10 stay there as the "1,300 the gate does not reach" class (design §3). MassMutual: 4 of 14
carry a third claimant. **Predict −4 / −10, not −14 / −14.**

`Gardner-Tanenbaum` has no org marker in its name, so **P149's sweep structurally could not see it**
(`lcc_owner_name_has_org_marker` = false). Its three identities are all `rca/contact` — the C13c
producer class exactly. Six older Gardner rows are already tombstones (0 rels, 0 facts); ignore them.

**The population a per-row verdict serves is 18 entities, not 2:** live `person`-typed entities holding
**≥2 current portfolio facts** = **18 / $69.4M** current rent. Read by name the head is companies —
`UIRC` (34 facts), `Global Net Lease` (40), `SMBC Leasing and Finance` (31), `Gardner-Tanenbaum` (18),
`MassMutual Life` (14), `SMFG` (11), `Foulger Pratt`, `American Infrastructure Funds`, `Kvalitena AB` —
and the tail has real people who must NOT be retyped: `Patrick R. Luther` (the only one of the 18 carrying
a `salesforce/Contact`), `William S Stuart Jr`, `Rafael A`. Plus one placeholder, `Research In Progress`.
**0 of 18 carry an org marker; 7 of 18 fail `lcc_looks_like_person`** — both instruments are useless here
(§9b), which is why this is a human verdict and not a rule.

⚠️ **Fan-out trap paid for while sizing this:** joining `external_identities` into the fact count
tripled Gardner-Tanenbaum to 54 and the population to 67 / $205M. The 18 / $69.4M is the fixed
count (`EXISTS`, not a join). Re-derive it before quoting.

## 2. Build — the smallest thing that is a real lane

**Decision type `entity_type_review`** (federated; all four registries — `api/admin.js`
`FEDERATED_DECISION_TYPES` + `federatedSubjectRef`, `ops.js` `_DC_FEDERATED` + tile, `dc-lanes.js`
`_DC_FED_META` + card, `review-shared.js` → lane `merges_dupes` — or the P139/UX-T1c registry-drift test
goes red). `subject_ref` = `etype:<entity_id>`.

**Source view `v_lcc_entity_retype_candidates`** (LCC Opps, migration): live `person`-typed entities
with ≥2 current facts, UNION any person-typed member of an OWN-T0e `spe_props_max ≥ 2` group whose
sponsor is an organization (so a blocked card surfaces here even at 1 fact). Columns: id, name,
current facts, current rent (value rank), **every recorded corroboration on the row** —
`has_salesforce_contact`, `has_salesforce_account`, vendor `rca/contact` / `costar/contact` counts,
`lcc_looks_like_person(name)` shown as a WARNING not a gate, `lcc_owner_name_has_org_marker(name)`,
relationship count, resolved-owner-of count — and `blocks_own_t0e_merge` (the sponsor id + token
when it does). Rent desc, blocked cards first. Expect **18–20 rows**.

**Verdicts — three, ONE writes:**

| verdict | effect | reversibility |
|---|---|---|
| `retype_organization` | `entities.entity_type := 'organization'` via ONE RPC `lcc_retype_entity(p_entity, p_to, p_decision_id, p_reason)`; writes `lcc_entity_retype_log(entity_id, from_type, to_type, decision_id, reason, retyped_at, reverted_at)` AND stamps `metadata.c13g_prior_entity_type` (the P149 shape, so one `update … where metadata ? …` reversal covers both sweeps). | `lcc_unretype_entity(p_entity)` restores from the log, sets `reverted_at` |
| `keep_person` | record-only; excluded from the lane (the honest answer for Luther/Stuart) | re-open the decision |
| `research` | `research_task` `entity_type_review` | — |

**Guards at verdict time, all read LIVE** (the card is re-read, never trusted from the request — P188):
entity exists, is not a tombstone, recorded type is still `person`; `p_to` ∈ {`organization`} only (a
person→asset or org→person retype is out of scope — refuse by name). **A `salesforce/Contact` identity does
NOT refuse** — it is shown as evidence (C13c: 12 of 13 corroborated were individuals) and the human
decides. No lexical guard refuses either.

**RPC privileges:** prefer `SECURITY INVOKER` (service_role calls it through `opsQuery`); if you make it
DEFINER for any reason the SEC1 stanza is mandatory and `test/sql-definer-privilege-stanza.test.mjs`
will tell you. Either way assert `has_function_privilege('anon', …, 'EXECUTE') = false` in the migration.

**After the write:** no cache refresh is needed for the guard — OWN-T0e-b reads `entities.entity_type`
live at verdict time (design §7), so a retype followed by `same_party` + `merge_now` on the sponsor's card
works in the same minute; only the card's DISPLAY lags the 4-hourly cache. Say so in the card's success
toast ("retyped — now merge from the Gardner Tanenbaum Holdings card").

## 3. What a retype touches downstream — measure, do not assume

`entity_type` is read by more than the merge guard. Before the positive control, census the consumers
(`grep -rn "entity_type" api/ supabase/migrations/ | grep -v test` and the live view definitions) and
predict each delta for the Gardner row. Known ones: `v_lcc_entity_roles` (`one_off_owner` needs exactly
one asset, so Gardner does NOT move; state it), `lcc_supersede_property_owner` (an org is admitted
without the credible-person arm — expect **no** ownership change, the entity already resolves as owner
of 19), `v_lcc_merge_candidates` / `auto_mergeable` (filter `entity_type='organization'` — Gardner may
JOIN a candidate group; **`auto_mergeable` must not move**, positive-control it), the **Tier 0 `people`
bench** (person-typed only — a retyped row LEAVES it; measure whether Gardner or MassMutual Life is on any
Tier 0 card today), `v_lcc_entity_role_ambiguity`, and the C13c corroboration CTE.

## 4. Positive control — rolled back, on the real pair

In one transaction on LCC Opps: `lcc_retype_entity(4dac1df8…, 'organization', null, 'control')` →
assert `validateSponsorFamilyVerdict`'s live-read inputs now agree (`sponsor_type = duplicate_type =
'organization'`) → `lcc_merge_entity(p_loser := 4dac1df8…, p_winner := 6b8887c2…)` → read
`v_lcc_property_ownership_reconciled` on the 14 co-claimed properties → `lcc_unretype_entity` +
`lcc_unmerge_entity` → **0 residue** (log rows, metadata key, entity_type, facts, rels all
byte-identical). Predicted, to assert against:

| | before | after retype only | after retype + merge |
|---|---:|---:|---:|
| `Gardner-Tanenbaum.entity_type` | person | organization | (tombstone) |
| guard verdict | refuses `entity_type differs` | passes | — |
| `unclassified_rival` distinct props (whole store) | re-measure (1,516 at 14:34 UTC 09-09) | **unchanged** | **−4** (10 of the 14 keep a third claimant, the RTD/TEP SPEs) |
| `lcc_entity_merge_log` | re-measure (148) | unchanged | +1, `reversible=true` |
| `auto_mergeable` | re-measure | **unchanged** | **unchanged** |

⚠️ **`lcc_merge_entity` dedup-DELETEs the loser's facts that collide on the PK with the winner's
(P196/P160)** — the 14 co-claimed properties are exactly that collision set. That is correct (one
interval per party per property) and the merge log makes it reversible; count it and say it.

## 5. Guard

`test/c13g-min-entity-retype.test.mjs`: the four-registry presence (reuse the OWN-T0e test's shape); the
planner refuses `p_to` outside the allowlist, refuses a tombstone, refuses a non-person; the verdict path
calls the ONE RPC and never PATCHes `entities` directly (assert on the statement shape, OCR1c — the RPC
name will appear in comments and in the migration's `comment on function`); the view carries every
corroboration column the card reads (the C10 map ⊆ view test); reversal restores type + clears the
metadata key. **Mutation pass, every assertion RED, comments stripped first.** The migration's header
will quote `entity_type = 'organization'` while explaining the guard — that is the A5c/N18 trap.

## 6. Ship + record

Branch `build/c13g-min-entity-retype`. **Migration first, then Railway — BOTH services** (`tranquil-delight`
+ the standalone MCP); `/version` + `git merge-base --is-ancestor` before any live verdict. Canonical
pages in the SAME change: `docs/architecture/owner-role-classification.md` **§9e** (C13g-min shipped;
§9b's "filed not started" bannered), `docs/audits/OWN_T0e_…_2026-09-08.md` **§9** (the guard now has an
answer), `PLANNED-BACKLOG.md` rows **C13g** (split: C13g-min ✅ / C13g capture-path stays 🟠) and
**OWN-T0e-b**, `CURRENT-STATE.md` if the lane list is there, `STATUS.md`. Then the operator sequence,
not built here: Scott works Gardner-Tanenbaum → `retype_organization` → OWN-T0e card `same_party` +
`merge_now` → `MassMutual Life` the same → `NGP Group` card `same_party` (closes the 2-property OWN-T0e-c
residue) → re-measure the 19 `duplicate_entity_suspect` groups and only then decide whether OWN-T0e-c
needs UI.

## 7. Report back

- The live census of `entity_type` consumers (§3) with the predicted-vs-actual delta on each for the
  Gardner control — **the two that move and the ones that must not**.
- The 18-row lane read by name: your call on each, with the recorded evidence beside it. Do NOT retype
  any of them — that is Scott's verdict; the report is the dry run.
- Whether `Research In Progress` is a placeholder entity that belongs on `junk_entity_review` instead
  (it holds 2 current facts — say whose).
- Buffers, not wall-clock, for the new view at `limit 50` and for a single-entity probe.
