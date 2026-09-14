# N15d + N15e — prove the PRODUCER is fixed, then recompute the 537 held rows

> **Read first:** `docs/audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md` (the build — do not
> redo it), `docs/audits/N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md` (the recurrence query lives
> here), `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Classes 8 and 11.
>
> **These are ONE prompt on purpose. N15d gates N15e** — if the producer is still minting
> key-disagreement duplicates, recomputing the residue is polishing the output of a live leak.
> **Do not run Unit 2 until Unit 1 reads clean.**

---

## Live state (2026-08-27 20:05 UTC — re-measure, do not quote)

`canonical_name` now has one writer: `lcc_entity_name_tokens` owns the stoplist,
`lcc_entity_canonical_key` joins on `' '`, and trigger `trg_lcc_entities_canonical_name`
(`BEFORE INSERT OR UPDATE OF name`) is **live**. Backfill `n15c_go` rewrote **15,402** rows.
**Invisible to `ensureEntityLink`: 10,336 → 537.** `auto_mergeable` **3,040 → 3,040**.

---

## Unit 1 (N15d) — the Class-8 check. This is the round's real verification.

**A backfill is not a fixed producer.** Re-run N15b's recurrence query.

- **Pass = 0 new key-disagreement duplicates since the trigger went live** (2026-08-27 20:05 UTC),
  against a pre-fix rate of **~4/day** (79 in 21 days).
- ⚠️ **Never quote the blended `1,879 in 30 days`** — it is burst-dominated by a 2026-07-29→08-05
  sync backfill and overstates the ongoing leak by **~24×**. The steady-state figure is the 79.
- Also confirm `v_lcc_canonical_name_drift` still shows **only** `held_stale_name_repair` and **no
  new drift class**. A new class means a writer escaped the trigger — name it before doing anything
  else.
- ⚠️ **Class 11:** if the count is 0, point the detector at a known positive before believing it —
  insert a row through a writer path in a rolled-back transaction and confirm the detector *can*
  fire. A detector that cannot fail is not evidence.

**If Unit 1 fails, STOP and report.** Do not proceed to Unit 2.

---

## Unit 2 (N15e) — recompute the 537. **Scott has approved this.**

The 537 are `canonical_name` left stale after `name` was later repaired, so the value is not a
function of the current name at all (`Scott W. Beynon` still keyed
`buyer contactsscott w beynon 801 568 1031 p`). They are the entire residual of N15c and are
excluded by design — the trigger is `UPDATE OF name`, so an unrelated write never recomputes them.

### ⚠️ The premise that made this a hard call was measured and is much smaller than stated

The stated objection was *"recomputing discards a captured string some of them preserve."*
Measured 2026-08-27: **58 of 537 (11%)** have a stale key holding materially more text than the
current name. And **the backfill ledger already preserves the old value**
(`lcc_n15c_canonical_backfill_log.old_canonical_name`), so for those 58 nothing is destroyed —
it moves from a key column to a ledger, which is where provenance belongs. **A dedup key is not an
archive.** Confirm the ledger captures every row before the update, and say so in the writeup.

### ⚠️ 39 rows will COLLIDE with a live entity — and that is the BENEFIT, not the risk

Read on named rows, the collisions are **byte-identical names the stale key was hiding**:
`1121 California Avenue LLC` ↔ `1121 California Avenue LLC` · `Alex Lyman` ↔ `Alex Lyman` ·
`Crest Properties` ↔ `Crest Properties` · `Block RE Services` ↔ `Block Re Services` ·
`919 Investments LLC; Smbc Leasing & Finance Inc` ↔ itself.

**Report them as a duplicate-candidate surface, do not merge them.** Merging is a separate,
human-confirmed decision through `lcc_merge_entity` (reversible, P196) and is **not in scope here.**

⚠️ **Several collide ACROSS `entity_type`** — `David Siegel`, `Dennis Needleman`,
`Constance Cincotta` and `Alexandria` each exist as both a **person** and an **organization**.
A shared key is correct; **reading it as identity is the person/org conflation
`sf-account-link.js` exists to prevent.** Any duplicate surface you emit must carry both
`entity_type`s and must not propose a cross-type merge.

⚠️ **`American Realty Capital` collides with `American Realty Capital Trust`** — that is Scott's
adopted rule working (a trust and its parent are one true owner, N15b decision 1), not a defect.
Name it so nobody "fixes" it later.

### How to do it

Reuse `lcc_n15c_backfill_canonical_names` if its gate can be widened to include the held class —
**do not write a second backfill function**; that is the normaliser drift this whole arc exists to
end. Dry-run first, apply under a distinct `batch_tag` (`n15e_go`), and keep the same reversal:

```sql
UPDATE entities e SET canonical_name = b.old_canonical_name
  FROM lcc_n15c_canonical_backfill_log b
 WHERE b.entity_id = e.id AND b.batch_tag = 'n15e_go';
```

## Gates — all must hold

| gate | expected |
|---|---|
| `v_lcc_canonical_name_drift` | **0 rows**, no class at all |
| invisible to `ensureEntityLink` | **537 → 0** |
| **`auto_mergeable`** | **unchanged at 3,040** — `v_lcc_merge_candidates` does not read this column, so any move means you touched something else |
| Tier 0 lane | ask / auto / parked unmoved (82 / 9 / 137 at time of writing — re-measure) |
| ledger rows | **= rows rewritten**, and the round trip run on a sample and rolled back (P195: a reversal never RUN is a claim) |
| `lcc_owner_domain_core` | byte-identical — it is not touched, and proving it is cheap |

## 👤 Still Scott's — do NOT decide it here

**Whether `canonical_name` becomes an enforced UNIQUE key.** **3,930 groups violate it today**;
the index is a plain btree `idx_entities_canonical (workspace_id, canonical_name)`. Recomputing the
537 will change that number — **report the new figure**, which is the input to his decision. Adding
the constraint is out of scope.

---

## Not in scope — the other window owns it

**A5 / A5a and the `gap_resolved` auto-close class (playbook Class 18)** belong to the A-series
thread. Do not touch `handleGenerateResearchTasks` or the research lanes.
