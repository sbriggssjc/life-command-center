# MERGE1 — a "reversible" property merge that destroys child rows, on BOTH domains, already 205 times

> **This is GOVDUP1-b widened.** It was filed as a gov blocker. Measuring it found the same class on
> **dia**, where the merge path is **live, human-driven, and has already run 585 times** — 206 of
> which hit a collision and **205 of which destroyed at least one child row that the backup claims
> to have preserved.** dia is the urgent half; gov is the preventable half.

**Repo:** `life-command-center` · **Domains:** dia (`zqzrriwuavgrquhisnoa`) **and** gov
(`scknotsqkcheojiaewwh`)
**Canonical pages to update:** `docs/architecture/gov-property-duplicates.md` (§Unit 3 already
carries the gov half) and whichever page owns the dia `property_twin` lane.

---

## 0. Standing rules

- **Every number below is dated 2026-09-05 and is a hypothesis to re-measure.** If yours differs,
  yours wins — say so and say why. Two of my own figures in this arc were wrong on first pass
  (see §2b).
- **No merges executed. No backfill of destroyed rows** — they are gone; the deliverable is that the
  *next* merge does not lose anything, plus an honest census of what the past ones cost.
- **Do not "fix" this by making the reporting better.** Both wrappers already report the loss. The
  defect is the loss.
- Guards strip comments **then** blank string literals before matching (OCR1c ordering).

---

## 1. The defect, and it is NOT the same mechanism on both domains

Both domains wrap a hard-delete merge in a snapshot/restore pair that snapshots child **ids**, not
child **rows**. When the repoint of a child row collides with an existing row on the keep side, the
drop-side row does not survive — and the id in the backup then points at nothing, so
`*_unmerge_property` reports it restored-or-lost while the data is unrecoverable either way.

**⚠️ The two domains lose the row by different routes, and a fix written for one will not catch the
other:**

| | gov | dia |
|---|---|---|
| function | `gov_merge_property_apply` | `dia_merge_property` |
| collision arm | `WHEN unique_violation THEN DELETE FROM %s WHERE %I = $1` | records `<tbl>.<col>_error` and **moves on** |
| how the row dies | **explicit DELETE** | the property row is deleted afterwards and **`ON DELETE CASCADE` takes the child** |
| what `rewired` says | `*_deleted_on_collision` (a count) | `*_error` (a message) |

**A grep for gov's vocabulary finds nothing on dia — that is how I undercounted dia at 76 before
re-keying on `%\_error` and getting 206.** State the mechanism per domain before counting.

Confirm the cascade claim rather than inheriting it: on dia, `pg_constraint.confdeltype = 'c'` on
`cap_rate_history`, `property_metadata_backfill_queue` and one of `property_embeddings`' two FKs to
`properties`. **Enumerate `confdeltype` for every FK to `properties` on both domains** — a `'c'`
turns a recorded error into a silent destruction, an `'a'` (no action) would have aborted the
delete, and a `'n'` (set null) orphans instead. The three outcomes must not be reported as one.

---

## 2. What it has already cost — measure, do not assume

### 2a. dia — live and running

`dia_property_merge_backup` holds **585** merges. Re-derive this table and correct it:

| batch_tag | merges | with a collision |
|---|---:|---:|
| `twin_merge_20260814_151532` | 240 | 41 |
| `twin_merge_20260814_151456` | 200 | 55 |
| **`dc_twin_verdict`** (the LIVE Decision Center lane) | **116** | **90 (78%)** |
| `twin_merge_20260814_150807` | 26 | 19 |
| `addr1a_20260904` | 1 | 1 |
| `addr1_costar_contacts_bleed_20260903` | 1 | 0 |
| `twin_retest` | 1 | 0 |
| **total** | **585** | **206**, of which **205** hit a CASCADE table |

🚨 **`dc_twin_verdict` is the human-verdict lane and it collides on 78% of merges.** An operator
confirming a twin today is destroying a child row four times in five, and the surface tells them the
merge is reversible.

⚠️ **Report what was actually lost per table, not just a merge count.** On the one merge I directed
(`addr1a_20260904`, 37503 → 38953) the collision was on **`pending_updates` — a queue row** — while
all 7 leases, the deed record, the listing and the document repointed correctly. **That merge was
fine.** A census that reports "205 merges lost data" without saying *what* would overstate the harm
on some rows and understate it badly on others. Split the 206 by table and by whether the table
carries substantive history (`cap_rate_history`, `property_embeddings`, financials) or queue/derived
state (`pending_updates`, `property_metadata_backfill_queue`).

### 2b. gov — zero merges run, and 100% would collide

`gov_property_merge_backup` is **0 rows**, so nothing has been lost yet. But across the 397 groups
in `v_gov_property_duplicate_review`, measured against the real unique constraints:

| table | unique constraint | groups colliding | rows destroyed |
|---|---|---:|---:|
| `investment_scores` | UNIQUE **on `property_id` alone** | **397 of 397** | 400 |
| `property_embeddings` | PK on `property_id` | 334 | 336 |
| `property_financials` | UNIQUE `(property_id, fiscal_year)` | 316 | 585 |

Because `investment_scores` is unique on `property_id` by itself and a scoring pass has run over the
population, **every pair collides by construction.** GOVDUP1's Unit 3 probed one pair and concluded
*"a pair with disjoint child rows may round-trip cleanly"* — **no such pair exists in that lane.**
**A per-pair probe answers "did this one lose"; the constraint answers "can any pair not lose."**

---

## 3. The fix — FOLD, per table, never a blanket rule

On collision the drop-side row carries information the keep-side row may not. **Fill-blanks from the
drop row into the keep row, then delete the drop row** — the P196 shape, where `lcc_merge_entity`'s
pivot DELETE destroyed the group's only named contact and correlating the predicate would have
looked like a fix while moving nothing.

⚠️ **Fold is not one rule for every table, and choosing per table is the work:**

- **`property_embeddings`** — an embedding is derived from the property's own text. Folding two is
  meaningless; **keep the keep-side row and record that the drop-side embedding was discarded as
  RE-DERIVABLE.** That is a legitimate discard, and it must be labelled as such rather than counted
  as a loss.
- **`investment_scores`** — likewise derived, but check whether anything downstream reads the score's
  history or timestamp before calling it re-derivable. **Say which you found.**
- **`cap_rate_history` / `property_financials`** — **substantive, and NOT re-derivable.** Two rows for
  one `(property, fiscal_year)` or one `(property, event)` are a genuine conflict. Fold fill-blanks
  where the columns are disjoint; where both sides state a different non-null value, **keep both by
  re-keying if the constraint allows, and otherwise surface the conflict — never silently pick one.**
  The SALE1/OWN-T0 rule applies: a conflict is stated, not resolved by whoever wrote last.
- **`pending_updates` / `property_metadata_backfill_queue`** — queue state. Folding is pointless;
  **resolve the drop-side row with a reason naming the merge**, so it neither survives as an orphan
  nor vanishes without trace.

**Every discard must be recorded in the backup with its reason** (`re_derivable`, `queue_state`,
`folded`, `conflict_surfaced`), so `*_unmerge_property`'s `_lost` report can distinguish *"we chose
not to keep this"* from *"this was destroyed."* Those are different facts and today they read the
same.

---

## 4. Sequencing — dia first, and stop the bleeding before improving anything

1. **dia, immediately:** make `dia_merge_property` fold. It is live; every day it runs is more loss.
2. **gov:** the same fix in `gov_merge_property_apply`, whose `DELETE` arm is explicit and therefore
   easier — but note it is **generic over every child table**, so a per-table fold needs a
   table→policy map rather than one branch.
3. **Only then** may GOVDUP1's lane be merged, and only after re-running its Unit 3 round trip and
   getting **0 lost / 0 changed / 0 stranded** with the fold in place.

⚠️ **Prove the round trip on a pair that currently FAILS it** (a gov pair with an
`investment_scores` collision, or a dia pair that collides on `cap_rate_history`). A round trip on a
pair that never collided proves nothing about the arm being fixed — **positive-control the fix, not
just the happy path.**

⚠️ **And fingerprint by identity, never by count.** ENTC: a row count is identical whether a child
was restored, stranded on the winner, or lost. Only an identity-keyed fingerprint separates them.

---

## 5. Out of scope

- **No backfill of destroyed rows.** They are gone. Record the census as a number and a date (the
  PR12 rule for lost provenance).
- **No change to `*_unmerge_property`'s reporting.** Both already report `_lost` honestly, and that
  honesty is what made this findable.
- **No new merge entry point.** `dia_merge_property_reversible` / `gov_merge_property_reversible`
  remain the only callers; do not add a second writer.
- **No FK re-pointing or `ON DELETE` changes** to work around the cascade — that changes the
  behaviour of every other delete path in the database. Fix the merge.

## 6. Deliverables

1. The fold, both domains, as committed migrations carrying the whole function body (P194).
2. The per-table policy map, with the re-derivable/substantive/queue call **stated per table and
   justified**, not inferred from the table's name.
3. The historical census: dia's 206 collisions split by table and by substantive-vs-queue, gov's 0.
4. A round trip on a pair that collides, before and after, fingerprinted by identity, `_lost`
   reported per table verbatim including zeros.
5. Guard `test/merge1-fold-on-collision.test.mjs`, **fully mutation-verified** — report N/N and name
   any survivor. (GOVDUP1's guard reported "9/9 spot-checked mutations" for 3 mutated assertions;
   do not repeat that.)

## 7. Verify on

- **A pair that collides now round-trips with 0 lost** — the positive control, not a clean pair.
- **dia's collision count going to 0 on NEW merges**, with the historical 206 unchanged (they are
  history, not a backlog).
- **`gov_property_merge_backup` still 0** at the end of this unit — MERGE1 merges nothing either.
