# N15b — `entities.canonical_name` is the dedup key and it has at least THREE authors. That is the duplicate factory.

> **Read first:** `docs/architecture/tier0-owner-contact-system.md` (traps 1, 11, 12),
> `docs/audits/A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md` §producer,
> `docs/audits/P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md`,
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Classes 11 and 17.
>
> ⚠️ **Do NOT start by rewriting 4,156 rows.** Rewriting `canonical_name` changes what
> `v_lcc_merge_candidates` groups, which changes what `lcc_apply_fuzzy_merges` would auto-merge.
> This is a graded change with a live blast radius, not a repair. **Measure, propose, gate — then
> stop and hand the decision back.**

---

## Why this is the root, not another symptom

Five rounds have now cleaned up duplicate owner entities — P189 (detector blind to 1,089 orgs),
P195 (66 merged, $102.2M), A2a (28 merged), P198 (3 merged), and **N3h is queued with 9 more**.
Every one of them was downstream of the same producer: **a writer looks up
`canonical_name = <its own normalization>`, misses the existing row, and mints a duplicate.**

Measured live 2026-08-27 16:35 UTC over **62,363** live entities:

| `canonical_name` equals… | rows | share |
|---|---:|---:|
| `lcc_normalize_entity_name(name)` — the SQL normalizer | 46,045 | 73.8% |
| `lower(btrim(name))` — verbatim, no legal-form strip | 42,260 | 67.8% |
| **neither** | **3,400** | 5.5% |
| (`sql_norm` is empty — the P189 acronym blind spot) | 1,070 | 1.7% |

The two large buckets overlap (for most names the normalizer is a no-op), which is exactly why this
survived: **the disagreement is invisible until two writers meet on the same name.** A2a measured
the consequence directly — `"671 Poplar LLC"` stored as both `671 poplar llc` and `671 poplar`;
`"BALTARA ENTERPRISES, L.P."` as both `baltara enterprises, l.p.` and `baltara enterprises l p`.
**2,037 byte-identical-name groups covering 4,156 entities carry disagreeing `canonical_name`.**

**The 3,400 "neither" rows are the part nobody has looked at.** They match no known normalization,
so there is a third author — or a stale value from a normalizer that has since changed. Start there.

## What to do, in this order

### 1. Enumerate the writers before proposing a rule
Grep every path that writes `entities.canonical_name` — `api/_shared/entity-link.js`
(`normalizeCanonicalName`), the SQL `lcc_normalize_entity_name`, the domain sync functions, the
sidebar pipeline, `r9_chain_connect`, and any migration that backfilled it. **Report the list with
what each one computes.** ⚠️ A2a already measured and **REFUTED** the obvious suspect: r9's
`normalizeCanonicalName` lowercases *and* strips punctuation, so it is strictly *looser* than the
chain key on the axis these duplicates differ on, and r9 is the FIRST entity in 18 of 43 groups.
**Do not re-run that hypothesis.**

### 2. Characterise the 3,400 "neither" rows on NAMED rows
Sample across value bands, print `name`, `canonical_name`, `lcc_normalize_entity_name(name)`,
`lower(name)`, `created_at`, `domain`, and the external-identity `source_system`. **State the
expected answer before you look.** The question is *which writer produced this, and is it stale or
a third rule?* An aggregate will not answer it.

### 3. Propose ONE normalization — and quote what it costs
Whichever is chosen, report **before you change anything**:
- how many rows change,
- **how `v_lcc_merge_candidates` group membership changes** — new groups, dissolved groups,
  changed winners,
- **the delta to `auto_mergeable`**, with the changed groups NAMED. ⚠️ `lcc_apply_fuzzy_merges`
  loops on that flag. P195 gated at 3,053 → 3,053; A2a explained 3,053 → 3,041; P198 explained
  3,041 → 3,043. **A move you cannot explain is a stop.**
- whether any group that becomes auto-mergeable contains a **sibling SPE** — the pattern that
  recurs in every one of these rounds (`UIRC-GSA V Douglas AZ` vs `UIRC-GSA V VAN HORN TX` are
  different properties in different states).

### 4. Fix the PRODUCER, not just the column
A one-shot rewrite of 4,156 rows is Class 8 — a chore repeated forever. The durable fix is that
**every writer calls one function**. Prefer a SQL-side default/trigger over asking each caller to
remember, for the same reason P177 used a trigger rather than patching `insertEntityRelationship`.
⚠️ But a `BEFORE INSERT` trigger that *skips* a row silently defeats `ON CONFLICT DO UPDATE`
(P196) — if you reach for one, say what it does on conflict.

## Traps already paid for — do not re-discover these

- **The hazard travels with the TECHNIQUE, not the name.** `lcc_normalize_entity_name`,
  `lcc_owner_strict_core`, `dup-pair-planner.ownerCore` and `lcc_owner_domain_core` all reduce a
  name, and each has been measured wrong for a different job. **A comparator sanctioned for one
  gate must be re-graded on named rows for the next** (A2: `BAMMF (8) LLC == BAMMF (3) LLC`).
- **The normalizer returns NULL/empty for 1,070 live entities** — acronym-named firms (`NGP Capital`
  → `ngp`, under the 4-char floor). Any rule you pick must say what it does with those, or it
  re-creates the P189 blind spot. `v_lcc_merge_candidates_normalizer_blind` is the existing
  fallback and it is **deliberately not `auto_mergeable`**.
- **An implausibly clean result is a bug signal, not a finding** (Class 11). Point every detector at
  a known positive before believing a zero. P198's first run reported 95/95/0/0 because
  `min(a.name)` collapsed both sides of a pair.
- **`IS NOT DISTINCT FROM` treats NULL–NULL as equal** and will label the blind rows "already
  visible to the detector" — the exact opposite of the truth (P189).

## Verify by

**Not** by rows rewritten. By: (a) the named list of writers, each pointing at one function;
(b) `v_lcc_merge_candidates` surfacing the A2a examples (`671 Poplar`, `Baltara`) as ONE group each;
(c) `auto_mergeable` moving only by an amount you can name group by group; and (d) a re-run a day
later showing **no new disagreeing pairs minted** — the Class 8 check that separates a fixed
producer from a backfill.

---

## Still open elsewhere (do not action here)

**Dated:** cron 241 at **06:55 UTC** is the first honest test of `TIER0_AUTO_ATTACH` — expect
`active_source='tier0_auto'` 0 → 9. Sidebar `_provider` stamp rate still 0%; one CoStar capture
settles it.

**Needs Scott:** **N3h** — 9 duplicates on Easterly (3, byte-identical), Cambridge (2) and Gardner
(4, `min_loser_sim` 0.667), all at $0 rent; **Gardner's deal history is split, 240 relationships on
an entity separate from the one holding its 13 assets**. `fcp→fcpdc.com` / `tmg→tmgdc.com`; **N3c**
bank/trustee scope; **N15** whether the 1,475 SF-campaign orphans get hub rows; **N13** test-suite
pruning.

**Carried:** N3a (wording-difference detection — the domain-keyed fix was measured at 25% and
rejected); N10 (4 held generic-name groups); N12 (four Windows-only path tests); **A2b**
(repeat-transfer flicker, prompt already written and unstarted).
