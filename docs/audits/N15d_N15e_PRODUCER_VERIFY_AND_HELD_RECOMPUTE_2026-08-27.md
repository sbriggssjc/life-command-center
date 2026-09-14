> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)**
> (entity identity + merges). **This file is the EVIDENCE for one round.** Predecessors:
> [`N15b`](N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md) (the measurement) →
> [`N15c`](N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md) (the single writer).
> ✅ **N15e APPLIED 2026-08-27 20:38 UTC (batch `n15e_go`): 537 rewritten, drift 0, every one of
> 62,368 live entities now keys to `lcc_entity_canonical_key(name)`.** ✅ **N15d RESOLVED 2026-08-28 02:30 UTC — see §1a, appended.** The wall-clock arm is still
> weak (6.41 h, 2 entities, both keyed correctly, drift 0) and is reported as weak; the **positive
> control is decisive**: a writer supplying `century park` had it overridden to
> `century park partners` on a live insert, 0 residue. §1's refusal to claim a pass off an empty
> population stands as written and was correct.

# N15d + N15e — the producer proof, and the 537

**LCC Opps (`xengecqvemvfknjvbvrq`), 2026-08-27. 62,368 live entities.**

| fact | value |
|---|---:|
| `v_lcc_canonical_name_drift` | **537 → 0** (no class at all) |
| invisible to `ensureEntityLink` | **537 → 0** |
| rows rewritten / ledgered | **537 / 537** |
| `auto_mergeable` | **3,040 → 3,040** |
| Tier 0 lane ask / auto / parked | **82 / 9 / 137 → 82 / 9 / 137** |
| `lcc_owner_domain_core` over all live names | **byte-identical** (`md5 f88dc475…` before and after) |
| new duplicate-candidate collisions surfaced | **47 entities / 73 pairs** (39 vs pre-existing + 14 held↔held) |
| UNIQUE-constraint-violating groups | **6,584 → 6,608** ⚠️ *not* the briefed 3,930 — see §5 |

---

## 1. ⚠️ N15d's WALL-CLOCK ARM IS VACUOUS TODAY. It was not run, and it did not pass.

The trigger and backfill landed at **20:03–20:05 UTC**. The check was run at **20:26 UTC**.

> **Elapsed window: 21 minutes. Entities created in it: ZERO.**

The pre-fix rate is ~4/day — roughly **one every six hours**. A detector observing a
**zero-row population for 21 minutes** returns 0 no matter what the producer is doing. That is
the Class 11 failure the prompt itself warns about: *a detector that cannot fail is not evidence*.
Reporting "0 new key-disagreement duplicates since the trigger went live" would have been literally
true and completely uninformative — the exact shape of every "failure looks like success" entry in
`CLAUDE.md`.

**The wall-clock re-run is still due 2026-08-28**, and even then a single day at ~4/day is weak
(the daily counts range 0–8). What follows is the arm that *is* decisive today.

### ⚠️ And N15b's recurrence query is not published, so it cannot be "re-run"

N15b §1/§9 quote the numbers but not the predicate. Three defensible reconstructions were built and
run against the pre-backfill values (reconstructed as
`coalesce(ledger.old_canonical_name, e.canonical_name)`, which is what makes the baseline
reproducible *after* a backfill has rewritten 15,402 rows):

| reconstruction | through 07-28 | burst 07-29→08-05 | since 08-06 |
|---|---:|---:|---:|
| A — group disagrees on stored key | 5,618 | 1,761 | **94** |
| B — byte-identical name, disagreeing | 3,190 | 870 | **70** |
| **C — E was minted because an OLDER sibling sharing its key was invisible** (adopted) | 862 | **1,760** | **89** |
| N15b as published | 1,768 | 1,789 | **79** |

All three reproduce the **burst** (1,760–1,789 vs 1,789) and the **most-recent date, 2026-08-26,
exactly**; the trickle lands at **70–94 against the quoted 79**. Variant C is adopted because it
encodes the actual mint mechanism. **Quote the band, not the 79** — and never the blended
`1,879 in 30 days`, which is burst-dominated and overstates the ongoing leak ~24×.

## 2. The arm that IS decisive: every writer path, exercised

Waiting for a producer to *maybe* leak is weaker than *making* every writer path try. Run live in a
self-rolling-back transaction (`RAISE` after the assertions; residue verified 0 afterwards):

| probe | writer shape it stands for | result |
|---|---|---|
| P1 | plain INSERT carrying `lower(btrim(name))` — SQL writers 4–6 | **OVERRIDDEN_OK** |
| P2 | `INSERT … ON CONFLICT (id) DO UPDATE` — `lcc_finalize_classified_owners`, the **P196 hazard** | **OVERRIDDEN_OK** |
| P3 | INSERT carrying `lcc_normalize_entity_name` — SQL writer 7, banned-for-identity | **OVERRIDDEN_OK** |
| P4 | `UPDATE … SET name = …` — the N15b §2a staleness class | **RECOMPUTED_OK** |
| P5 | `UPDATE … SET canonical_name = …` only | **BYPASSED** (by design — `UPDATE OF name`) |

**P5 is also the Class 11 positive control**: it drove `v_lcc_canonical_name_drift` **537 → 538**
in the same transaction. The detector can fail, so its zero means something.

### ⚠️ One latent bypass, named: `merge_duplicate_entities` can write around the trigger
`api/operations.js:4666` PATCHes `canonical_name: '[MERGED] …'` **without `name`**, so the trigger
never fires — and it stamps `metadata.merged_into`, **not the `merged_into_entity_id` column**, so
such a row would stay in the live population *and* in the drift view forever.

**Measured: `canonical_name LIKE '[MERGED]%'` returns 0 rows** — the path has never produced one.
It is a **latent** bypass, not a live defect, and it is filed rather than patched (changing a merge
path is not this round's scope). Any future `backfillable` row in the drift view should suspect it
first. Backlog **N15f**.

## 3. N15e — the 537, and the premise that shrank under measurement

The held rows are `canonical_name` left stale after `name` was later repaired, so the value is not a
function of the current name at all (`Scott W. Beynon` still keyed
`buyer contactsscott w beynon 801 568 1031 p`). The trigger is `UPDATE OF name`, so nothing
incidental ever recomputes them — they were N15c's entire residual.

**The stated objection was "recomputing discards a captured string some of them preserve."**
Measured on alphanumeric content:

| stale key vs recomputed key | rows | share |
|---|---:|---:|
| stale holds MORE (any) | 73 | 13.6% |
| stale holds >10 chars more | 57 | 10.6% |
| **stale holds LESS** | **463** | **86.2%** |
| identical length | 1 | 0.2% |

So for **86% of the population the stale key held *less* information**, and the concern applies to
~57–73 rows. For those, **the backfill writes the ledger BEFORE the UPDATE** (verified in source and
by the round trip), so the captured string moves from a key column to
`lcc_n15c_canonical_backfill_log.old_canonical_name`. **A dedup key is not an archive.**

### One backfill function, not two
`lcc_n15c_backfill_canonical_names` gained **`p_include_held boolean DEFAULT false`**. A second
function would be the normaliser drift this whole arc exists to end. ⚠️ Adding a parameter creates an
**overload**, and with defaults on both, every 1–3-arg call becomes *"function is not unique"* — so
the old signature is **DROPPED** first. Nothing in `api/`, `test/` or `cron.job` references it
(grepped). **The default gate still plans 0 rows**, i.e. N15c's behaviour is byte-for-byte unchanged.

### The round trip was RUN, not asserted (P195)
50 rows applied → 50 ledgered → 0 still drifted → the **documented reversal, verbatim** → **0 rows
differing from the pre-state (byte-identical)** → rolled back, ledger residue 0.

## 4. The 39 collisions are the BENEFIT — and they are candidates, never merges

`v_lcc_n15e_canonical_collision_candidates` (new, read-only). Read on named rows, these are
**byte-identical names the stale key was hiding**: `1121 California Avenue LLC` ↔ itself,
`Crest Properties` ↔ itself, `National Government Properties` ×3, `Block RE Services` ↔
`Block Re Services`, `Whitestone Funds, LLC` ↔ `WHITESTONE FUNDS LLC`.

- **The pre-apply prediction was 39; the actual is 47 entities / 73 pairs.** The prediction could
  only see held-vs-**pre-existing** collisions. Post-apply the held rows also collide with **each
  other** — 14 such pair rows. Decomposed: **39 entities vs pre-existing** (the briefed number,
  confirmed exactly) **+ 8 more reachable only held↔held**.
- ⚠️ **9 pair rows are CROSS-`entity_type`** — `David Siegel`, `Dennis Needleman`, `Alexandria`,
  `Alexandria Foster`, `Jason Douglas`, `Robert Kapusta`, `Societe Generale`,
  `Ronald & Susan L Volmer` each exist as both a **person** and an **organization**. A shared key is
  correct; reading it as identity is the person/org conflation `sf-account-link.js` exists to
  prevent. The view carries both types and `cross_entity_type` so nobody proposes that merge.
- ⚠️ **The view deliberately carries NO `auto_mergeable` column.** `lcc_apply_fuzzy_merges` loops on
  that flag (P198), and admitting an ungraded key there would auto-merge unreviewed groups.
- ⚠️ **`American Realty Capital` ↔ `American Realty Capital Trust` is Scott's adopted trust rule
  WORKING** (a trust and its parent are one true owner, N15b decision 1), not a defect. Named here
  so nobody "fixes" it. Same for `Elliott Bay Capital Trust` ↔ `Elliott Bay Capital`.

**Nothing was merged.** That is a separate, human-confirmed decision through `lcc_merge_entity`
(reversible, P196).

## 5. ⚠️ The briefed UNIQUE-violation figure was stale — the input to Scott's decision has changed

The prompt says *"3,930 groups violate it today."* That number is **pre-N15c**. Collapsing keys is
precisely what *creates* collisions, so the backfill raised it:

| point | groups violating `UNIQUE (workspace_id, canonical_name)` |
|---|---:|
| N15b measurement (pre-N15c) | 3,930 |
| **after N15c's 15,402-row backfill** | **6,584** |
| **after N15e (now)** | **6,608** |

**The honest input to the UNIQUE-key decision is 6,608, not 3,930** — a 68% increase over the figure
the question was originally framed against. This is the dated-claim trap caught on a number rather
than a blocker: it was true when written, and re-measuring is one query.

## 6. Gates

| gate | expected | actual |
|---|---|---|
| `v_lcc_canonical_name_drift` | 0 rows, no class | ✅ **0** |
| invisible to `ensureEntityLink` | 537 → 0 | ✅ **0** |
| `auto_mergeable` | unchanged 3,040 | ✅ **3,040** |
| Tier 0 ask / auto / parked | unmoved | ✅ **82 / 9 / 137** |
| ledger rows = rows rewritten | 537 | ✅ **537**, round trip run + rolled back |
| `lcc_owner_domain_core` | byte-identical | ✅ same md5 over all 62,368 |
| default backfill gate | still 0 (N15c unchanged) | ✅ **0** |
| test suite | green | ✅ **4,772 pass / 0 fail / 6 skipped** |

**Reversal:**
```sql
UPDATE entities e SET canonical_name = b.old_canonical_name
  FROM lcc_n15c_canonical_backfill_log b
 WHERE b.entity_id = e.id AND b.batch_tag = 'n15e_go';
```

## 7. 👤 What needs Scott — NOT decided here

1. **Whether `canonical_name` becomes an enforced UNIQUE key.** **6,608 groups violate it today**
   (§5), not 3,930. Out of scope; the number is the input.
2. **The 47 collision entities.** Surfaced as candidates only. The 9 cross-type pairs are almost
   certainly *not* merges; the byte-identical same-type pairs mostly are.

## 8. Still open

- ⏳ **N15d wall-clock, due 2026-08-28.** Re-run reconstruction C over
  `created_at >= '2026-08-27 20:05+00'`; **read `drift_class`, not the total** — a new
  `backfillable` row means a writer escaped the trigger, and §2's latent bypass is the first suspect.
- **N15f** — `merge_duplicate_entities` writes `canonical_name` without `name` and stamps
  `metadata.merged_into` instead of `merged_into_entity_id` (§2). Latent; 0 rows to date.
- **N18** — `v_lcc_developer_classification_candidates.attributed_rent` is a self-comparison
  (`pof.source_property_id = pof.source_property_id`), one distinct value across every row. Unchanged
  by this round.


---

## 1a. N15d RESOLVED — 2026-08-28 02:30 UTC (appended)

§1 refused to claim a pass off a 21-minute window with zero entities in it. **That refusal was
correct and is left standing.** Here is the read that closes it.

**Wall-clock arm — weak, and stated as weak.** 6.41 hours after the trigger: **2 entities created,
both keyed correctly**, `v_lcc_canonical_name_drift` **0**. `JACO SAVANNAH REALTY, INC.` →
`jaco savannah realty`; `asset 4477` (the gov mint path) → `asset 4477`. ⚠️ **Neither is a name
where the old and new normalizations disagree**, so this shows the trigger breaks nothing — not
that it corrects anything. Two rows is a thin sample.

**Positive-control arm — decisive.** A row was inserted through the real writer path carrying a
deliberately wrong `canonical_name` of `century park` — exactly what the outgoing aggressive
normalizer produces — inside a self-rolling-back transaction:

```
writer supplied "century park"
trigger stored  "century park partners"
expected        "century park partners"
corrected = t          residue after rollback = 0 rows
```

**The trigger overrides a drifted writer on a live insert.** That is the mechanism proven, rather
than the absence of failures inferred from an empty population — the distinction §1 drew.

### The control closes the exact hazard `CLAUDE.md` documents

| name | new key (live) | old aggressive normalizer |
|---|---|---|
| `Century Park Partners LLC` | `century park partners` | `century park` |
| `Century Park Properties LLC` | `century park properties` | `century park` |

**`would_falsely_link = false`.** Under `lcc_normalize_entity_name` both collapse to `century park`,
so `ensureEntityLink` would have linked two different companies **automatically, with no human
review** — the banned-for-identity failure this repo has warned about for months. Closed, and
demonstrated side by side.

**Verdict: substantially passed.** A full-day wall-clock read remains worth taking (daily mint
counts range 0–8), but the risk N15d guarded is materially retired.
