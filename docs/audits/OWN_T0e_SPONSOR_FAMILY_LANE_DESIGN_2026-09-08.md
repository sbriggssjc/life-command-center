# OWN-T0e — the sponsor-family confirm lane: sized, designed, dry-run surface shipped (2026-09-08)

**Nothing writes in this unit.** One read-only view was created and applied live
(`v_lcc_ownt0e_sponsor_family_proposals`, migration `20260908150000`); the lane itself (card +
verdict path) is designed here and NOT built. Backlog: `OWN-T0e`. Canonical page:
`docs/architecture/ownership-history-lane.md` § OWN-T0.

## 1. Why this, now

Three consecutive measurements hit the same wall from three sides: the `resolve_ownership` lane's
dispute half is dominated by sponsor↔SPE pairs (UX-T1c §10.1); the OWN-T0 store reads `conflict` on
470 of that lane's properties (§10.3); and the "217 syncs" of RO2 were mostly sponsor↔SPE in both
directions (§10.7). OWN-T0 had already read the top 60 conflicts by rent and found the same class,
and named the remedy: **one human confirm into `lcc_ownership_sponsor_family` clears a whole family**
(A3 measured `boyd` at 20 of 24 chains). Today that registry holds **6 rows, all written by hand in
SQL** (`boyd`, `sunflower`, `highwoods`, `rxr`, `arc`, `east`), and there is no lane — the A3
proposals view exists but only over the research-task mismatch population (26 rows today).

## 2. The population, measured live

`v_lcc_property_ownership_reconciled` where `is_current and is_owner_candidate and
property_state='conflict'`:

| | gov | dia | total |
|---|---:|---:|---:|
| conflict properties, any class | 1,769 | 328 | **2,097** |
| of which `unclassified_rival` | 1,401 | 216 | **1,617** |

⚠️ **OWN-T0 quoted 756 conflict properties; the reconciled store says 2,097.** The 756 is
`v_lcc_property_multi_current`, which counts only `lcc_entity_portfolio_facts` rows; the reconciled
view also admits the resolver's `lcc_property_owner` claim and the domain `true_owner` mirror as
current owner candidates. Two detectors, two denominators, both honest about different stores —
recorded as **OWN-T0h**, not adjudicated here. This design uses the reconciled store because it is
what the panel reads.

## 3. Applying the ONE sanctioned gate to that population

`lcc_ownership_sponsor_token(owner, other)` is A3's proposal gate — the brand token shared by two
names that are both parties to ONE property, after the strict-core (name-variant), person, brokerage
and street guards. Two current owner candidates of one asset satisfy its scope exactly, so no second
detector was written (P189/A2/N15c: the hazard travels with the technique).

Sponsor side is a **recorded fact**: the party holding more current properties fleet-wide. Ties are
surfaced as `sponsor_side='tied'`, never guessed.

Live view state at apply (`v_lcc_ownt0e_sponsor_family_proposals`):

| | groups | properties | rent |
|---|---:|---:|---:|
| all proposal groups | **182** | 317 | $172.7M |
| sponsor decided by breadth | 131 | — | — |
| tied breadth | 51 | — | — |
| generic-word token (`realty`, `federal`, `george`, `john`…) | 6 | 13 | — |
| already confirmed in the registry | **0** | — | — |
| **breadth-decided, non-generic** | **126** | **241** | **$109.1M** |

So the gate reaches **317 of 1,617** `unclassified_rival` properties (20%). The other 1,300 carry no
shared brand token between their two owners — they are a different question (genuine rivals, name
variants beyond the strict core, deed-lag, or junk) and this lane must not pretend to them.

### 3a. The "SPE" side is often the sponsor's DUPLICATE, not its SPE — read on named rows

| pattern | groups | props | example |
|---|---:|---:|---|
| the "SPE" itself holds ≥2 properties | **13** | **85** | `Gardner Tanenbaum Holdings ← Gardner-Tanenbaum` (spe holds 18) · `RMR ← RMR Group` (7) · `Massmutual ← Massmutual Asset Finance LLC; MassMutual Life` (14) · `Incommercial Property Group ← InCommercial, Inc.` (5) · `Wells Fargo Bank ← Wells Fargo & Company` |
| the "SPE" holds exactly 1 | 31 | 66 | `UIRC ← UIRC-GSA CLARKSVILLE TN LLC …` · `Orion Office REIT ← Orion Cocoa Fl LLC` · `Agree Realty CORP ← Agree Central LLC` — the genuine family shape |
| the "SPE" holds 0 current facts (resolver- or mirror-only claim) | 87 | — | — |

A true SPE holds one asset. **A "SPE" holding 18 is the sponsor under a second entity** — the
P195/A2a duplicate class, and a family confirm there would paper over an entity merge (and the
`lcc_ownership_sponsor_family_token` match would keep firing on the duplicate forever, hiding it).
`lcc_owner_strict_core` cannot see these (`Holdings` is not a legal form, so the cores differ) — the
view's `same_party_suspect` reads **0**, correctly, because the gate already excluded strict-core
equals. **The discriminating fact is `spe_props_max ≥ 2`, a recorded fact, and it is on the row.**

One group mixes both: `NGP Capital` (30 properties, $43.2M) lists `National Government Properties
(NGP)` and `NGP Group` (sponsor duplicates) beside 27 `NGP V/VI/VII <city> LLC` rows (true SPEs).
The lane must let one confirm cover the SPEs while the two duplicates go to a merge — which is why
the card shows the SPE list, not a count.

### 3b. Other shapes visible on the surface, named so they are not confirmed blind

- **Generic tokens** (6 groups): `Realty Income Corporation ← American Realty Capital JV Elman
  Investors` (`realty` — different parties), `Federal Building LLC ← Helena Federal Office Building`
  (`federal`), `George Washington University` (`george`), `John Hancock` (`john`). Flagged
  `token_is_generic_word`; `token_entities_fleetwide` reads 116–633 on them. **Shown, not filtered**
  — a stoplist is a second lexical rule (P158a) and the blast-radius column already says it.
- **Hedge-phrase entities as owner candidates**: `Richard Dunn or Blue Onyx Companies leadership`,
  `GRE Partners LLC or affiliated individuals`, `FGF Management LLC or affiliated individuals`,
  `Mercantil Servicios Financieros or related stakeholders`. These are not parties; they are an
  extractor's uncertainty written as a name (the RO2b `CIM Group or affiliated investors` class,
  here in LCC `entities`). Filed **OWN-T0i**: size `entities.name ~* '\m(or|and/or) (affiliated|related)\M'`
  and route to `junk_entity_review`.
- **Tied breadth** (51): both sides hold the same count, mostly 1 vs 1 (`Savlan Cc Property LLC ~
  Savlan Capital`, `Velocity Capital ~ Velocity US Properties Inc`). The card must ask the operator
  which side is the sponsor rather than infer it.

## 4. The lane — design (✅ BUILT 2026-09-09 — §6 records what shipped and where it departs from this section)

**Decision type** `sponsor_family_confirm` (federated; registered in `FEDERATED_DECISION_TYPES`,
`_DC_FEDERATED`, `_DC_FED_META`, `review-shared.js` — all four or the P139/UX-T1c registry-drift
test goes red). **Source**: `v_lcc_ownt0e_sponsor_family_proposals`, `sponsor_side='breadth'`
first, `annual_rent desc`; tied groups in a second chip. **`subject_ref`**:
`t0e:<sponsor_survivor_id>:<token>` (tied: `t0e:tied:<lower_id>:<token>`). Excluded-refs by
`lcc_decisions` as every federated lane does; the badge counts the same filtered population (RO1).

**Card shows**: sponsor name + its property count · the token · every SPE name with its own
property count (so a "SPE" at 18 reads as what it is) · rent · `token_entities_fleetwide` ·
`token_is_generic_word` as a visible warning · `also_confirmed_for_contacts` labelled *evidence about
a different question* (P188) · the OWN-T0 property_state before/after preview (how many
`unclassified_rival` rows this one confirm flips).

**Verdicts — four, and only ONE writes:**

| verdict | effect | reversibility |
|---|---|---|
| `confirm_family` | **INSERT `lcc_ownership_sponsor_family (sponsor_entity_id, sponsor_token, confirmed_by, notes)`** — the SAME curated shape P190/A3 established, `confirmed_by` = the operator. The reconciled view flips every covered pair to `sponsor_family_confirmed` on the next read; nothing is end-dated, merged or repointed. | `DELETE` the registry row (the registry IS the ledger — add `decision_id` to `notes`) |
| `same_party` | **no write here** — records the decision and opens the pair on the existing `merge_duplicate_entities` lane (its `<select>` picks the survivor; `lcc_merge_entity` is reversible since P196). Offered when `spe_props_max ≥ 2` or on operator judgement. | that lane's own |
| `not_family` | record-only; `subject_ref` excluded from the lane. | re-open the decision |
| `research` | `research_task` `sponsor_family_confirm`, existing machinery. | — |

**Guards at verdict time** (the card is re-read from the view, never trusted from the request —
P188): `confirm_family` refuses when the (sponsor, token) is already in the registry, when the
sponsor entity is a tombstone (resolve through `lcc_entity_survivor` first), and when the token
fails the registry's own CHECKs (≥3 chars, `[a-z0-9]`). A generic-word token does **not** refuse —
it is the human's call — but the decision records `token_is_generic_word=true` so a later grade can
find it.

**What it must never do**: auto-confirm anything (A3: lexical sponsor detection measured 3 of 74 on
GSA SPEs; P198 co-proposal 7%); fold into A2's `agrees` apply path (A3b is a separate decision);
write `lcc_entity_portfolio_facts`; touch gov `recorded_owners`/`true_owners`.

**Verification**: `select conflict_class, count(*) from v_lcc_property_ownership_reconciled where
is_current and property_state='conflict' group by 1` — `sponsor_family_confirmed` rises by the
confirmed group's property count and `unclassified_rival` falls by the same; the lane's own total
falls by exactly one. The registry row count is the decision count.

## 5. What this does NOT settle

The 1,300 `unclassified_rival` properties the gate does not reach; the 2,097-vs-756 denominator
question (OWN-T0h); whether the 87 zero-fact "SPE" claims (resolver/mirror-only) are real owners or
stale resolver output; and the hedge-phrase entities (OWN-T0i). None of these is made worse by the
lane; none is fixed by it.

## 6. Build record (2026-09-09) — what shipped, what was measured on the way, what departs from §4

**Shipped** (branch `build/own-t0e-sponsor-family-lane`): decision type `sponsor_family_confirm` in all four
registries (`api/admin.js` `FEDERATED_DECISION_TYPES` + `federatedSubjectRef`; `ops.js` `_DC_FEDERATED` +
sublane tile; `dc-lanes.js` `_DC_FED_META` + card + `dcSponsorFamilyConfirm`; `review-shared.js` → lane
`ownership`), the pure planner `api/_shared/sponsor-family-planner.js` (subject refs, card, verdict gate,
ordering), the fetch branch and the verdict branch in `api/admin.js`, migration
`20260909120000_lcc_own_t0e_proposals_member_ids.sql` (applied live), guard
`test/own-t0e-sponsor-family-lane.test.mjs` (13 tests, **19/19 mutations RED**, comments stripped; two
assertions were re-anchored during the mutation pass because a view COMMENT names `lcc_merge_entity` and
"INSERT into lcc_ownership_sponsor_family" in prose — OCR1c: the deliverable is the string, so the guard reads
the STATEMENT shape). Verdicts exactly as §4: `confirm_family` is the one write (INSERT, `notes` carries
`decision:<id>` + `token_is_generic_word` + `token_entities_fleetwide`); `same_party` records and forwards
to `merge_duplicate_entities`; `not_family` record-only; `research` a task. A generic-word token confirms
without an explicit acknowledgement (the design's default, left for Scott to tighten).

**Three departures from §4, each forced by a measurement:**

1. **⚠️ The dry-run view was NOT a request path — 64.3 s.** `EXPLAIN ANALYZE` on the 2026-09-08 body:
   the `cur a join cur b` self-join was planned as a nested loop with the join keys in the FILTER (the CTE
   estimated 1 row) — 11.3M rows removed by join filter, ~20 s; and `token_entities_fleetwide` ran a
   `regexp_replace` over all 69k entities **once per group** (SubPlan, loops=182, ~43 s). service_role's
   `statement_timeout` is **30 s**, so the lane would have 500'd on every open and, worse,
   `/api/decisions?summary=1` calls every federated source on page load. Rewritten (per-property
   `array_agg` + `generate_subscripts` pair walk; one token pass over `entities`) to **19.8 s**, with md5
   over the 21 pre-existing columns identical before and after (`ce0a83c9…`, 182 rows) — and the
   remaining ~15 s is reading `v_lcc_property_ownership_reconciled` for the whole population, a view built
   for panel point-queries (OWN-T0's `not materialized` lesson, from the other side). **So the lane reads a
   CACHE**: `lcc_ownt0e_sponsor_family_proposals_cache`, refreshed by `lcc_ownt0e_refresh_proposals()` on
   cron `lcc-ownt0e-proposals-refresh` (`27 */4 * * *`, after `lcc-portfolio-sync-finalize`) — the
   `lcc_priority_queue_resolved` pattern. `already_confirmed` is re-derived LIVE from the registry in the
   fetch, and both guards that can refuse the write (registry membership, tombstone) are read live at
   verdict time; only display columns can lag. Cache locked to `service_role` (Supabase's default grants
   had given `anon` SELECT — measured, revoked, asserted).
2. **A tied group needs the operator to NAME the sponsor, and the view had no ids.** Appended
   `member_ids uuid[]`, `spe_ids uuid[]`, `member_names text[]` (aligned with `member_ids`, both ordered
   by id). ⚠️ `tied_pair` names ONE pair; a tied group holds up to **9** members (`NGP ~ …`, measured), so
   labelling a picker from `tied_pair` by position would have mislabelled the pick — caught on the first
   live read, not by a test. The subject_ref keeps its `tied` form after a confirm: the ref names the
   QUESTION, the payload names the answer.
3. **`properties` in the view COUNTS PAIRS.** Rolled-back positive control on the top card (NGP Capital,
   `ngp`, 30 "properties"): inserting the registry row took the group's `unclassified_rival` count
   **35 → 7** and `sponsor_family_confirmed` **0 → 28** — 28 distinct properties, not 30, because a
   property with three candidates carries two pairs. The card says "covers N owner pairs (≤ that many
   properties)"; the design's 317 "props" is 317 pairs. §4's verification rule stands (the confirmed
   group's rows flip, the lane's total falls by one) with that unit corrected.

**Read on the first live cards:** the top three by rent are **NGP Capital / `ngp` / $43.2M** (29 SPEs,
two of which — `NGP Group`, `National Government Properties (NGP)` — are duplicate entities of the
sponsor riding inside the family), **George Washington University / `george` / $23.4M** (a pure
duplicate: `George Washington University (The)`), **RMR / `rmr` / $11.5M** (a pure duplicate: `RMR Group`).
The `same_party` verdict exists for exactly the second and third. The first is MIXED — a `confirm_family`
is correct for the 27 SPEs and leaves the two duplicates classified as family, which is the
"papers over a merge" case §3a warned about at group grain. Stated, not solved: a group can need both
verdicts, and the lane offers one per card (backlog **OWN-T0e-c**).

**⚠️ `same_party` forwards to a lane that cannot always show the pair.** Of the 13 duplicate-suspect groups
(`spe_props_max ≥ 2`), **8** have a member on `v_lcc_merge_candidates` and **5 do not** — `Four Springs
Capital`, `Gardner Tanenbaum Holdings`, `Incommercial Property Group`, `NGP Group`, `Truist Bank` — because
the merge detector groups on a canonical-name key these variants do not share (`Gardner Tanenbaum Holdings`
vs `Gardner-Tanenbaum`). For those the forward lands on a lane with no matching card. Filed **OWN-T0e-b**:
a direct pair-merge effect on `same_party` (through `lcc_merge_entity`, reversible), gated on a second
confirm. Until then the operator merges from the entity panel.

**Verify (after the Railway deploy — DB half is live now, JS half is not: merged is not running):**
`select conflict_class, count(*) from v_lcc_property_ownership_reconciled where is_current and
property_state='conflict' group by 1` before/after each confirm; `select count(*) from
lcc_ownership_sponsor_family` = 6 + confirms; the lane's `parts` (`breadth` 131 / `tied` 51 /
`duplicate_entity_suspect` 13 at build) and `total` 182 falling by one per verdict. Read
`cache_refreshed_at` on the lane before quoting a count.
