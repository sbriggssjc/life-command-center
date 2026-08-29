> 📍 **CANONICAL PAGE: [`docs/architecture/bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md) §3.**
> Sibling: [`tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md) (owns the merge machinery).
> **Diagnosis only — nothing written.** ⚠️ **This audit REFUTES C8b as I filed it.**

# C9 — C8b was wrong: the number is real, the entity is not. 60% of the callable list sits in an unresolved duplicate group.

**Measured live 2026-08-29 on LCC Opps.**

> ## ⚠️ First, the correction
>
> I filed **C8b** claiming `Brandywine Realty Trust` at **$34,920,891.77 with 0 properties** was
> "the N18 fabricated `attributed_rent` value surfacing as a rank." **That is refuted.**
> **Brandywine genuinely owns the highest-rent gov property in the system** (`source_property_id`
> 11504), and $34,920,891.77 is that asset's real rent. **The value is correct.**
>
> **What is wrong is which entity carries it.** There are **three live entities whose
> `canonical_name` is `brandywine realty`**, none merged. The **assets and the contact sit on one**;
> the **cadence and 36 relationship edges sit on another**. The prospecting brief ranks the
> *asset-less* one, which picks the value up through the `connected_property_value` fallback.

---

## 1. Why I was wrong, and what the tell should have been

The exact match to the gov-wide `max(annual_rent)` looked like N18's self-comparison signature, and
I wrote it up on that resemblance. **One query settled it:** the owner of the max-rent asset **is
Brandywine**. A coincidence that strong was evidence *for* the value, not against it.

⚠️ **The check I skipped is the one this repo keeps writing down: verify on named rows before
naming a mechanism.** *"Equals a suspicious aggregate"* is a **hypothesis**; *"and the row that
produces that aggregate belongs to somebody else"* is the finding. `rows_equal_to_gov_max = 1` was
also visible at the time and should have stopped me — **N18's defect was systematic (11 distinct
values across 277 candidates); a population of one is not a systematic artifact.**

## 2. What is actually there

| entity id | name | canonical_name | current facts | resolved assets | edges | cadences | contact |
|---|---|---|---:|---:|---:|---:|:--:|
| `c8422160…` | Brandywine Realty Trust | `brandywine realty` | **1** | **1** ($34.9M) | 1 | 0 | ✅ |
| `174dab5e…` | Brandywine Realty Trust | `brandywine realty` | 0 | 0 | **36** | **1** | ❌ |
| `9c2f6a49…` | Brandywine Realty | `brandywine realty` | 0 | 0 | 5 | 0 | ❌ |

**Byte-identical canonical key on all three. None merged.** The asset + the contact are on the first;
the cadence + the deal history are on the second. **This is the P177 / P198 split** — the shape that
left Gardner Tanenbaum's 240 relationships on an entity separate from its 13 assets.

### ⚠️ The detector is NOT broken — it saw this and correctly declined

```
norm_name = 'brandywine realty' · member_count = 3 · auto_mergeable = FALSE
```

`v_lcc_merge_candidates` surfaced the group and **correctly refused to auto-merge it** — three
members with genuine name variance (`Brandywine Realty` vs `Brandywine Realty Trust`) is exactly
what should go to a human. **Nothing here needs fixing in the machinery. The group has simply never
been reviewed.**

## 3. The generalisation — and it is large

| | |
|---|---:|
| merge candidate groups | **5,194** |
| …flagged `auto_mergeable` | **3,006** |
| **C6 callable owners (P1/P2/P3/P8) sharing a canonical name with another live entity** | **181 of 303 (60%)** |
| priority-queue entities in that state | **415** |
| prospecting-brief eligible entities in that state | **50** |

**60% of the callable list C6 just delivered sits in an unresolved duplicate group.**

⚠️ **State the limit of that number honestly: "shares a canonical name with another live entity" is
NOT the same as "is split like Brandywine."** The Brandywine-style split — assets on one, cadence
and contact on another — was **verified on one named row and has not been measured across the
population.** 181 is the *exposed* set, not the *defective* set. **Sizing the actual split rate is
the next question and is not answered here.**

## 4. Why this matters more now than last week

The merge backlog has been a standing item (N3a, P189→P195, P198, N15e) and was reasonably treated
as hygiene. **C6 changed its cost.** Before C6, 74 owners reached the deal-timing bands and the
duplicate problem was mostly invisible. **Now 303 owners are on a call sheet, ranked by a value that
lives on whichever twin happens to hold the portfolio fact**, and the contact may be on the other
one. A duplicate is no longer a tidy-up — **it is a wrong row on a surface an operator works.**

**This is the Class 8 shape at one remove:** the machinery is correct, the detection is correct, and
the *review* is the unbuilt half. P195 merged 66 entities; **3,006 auto-mergeable groups remain**,
and nobody has looked at the ~2,188 that need a human.

## 5. Recommendation

**Do not bulk-merge.** P195 measured the hazard precisely: `lcc_merge_entity` was irreversible until
P196, its pivot dedup could delete the group's only named contact, and a name that reduces to
nothing (`Capital`, `Partners Group`) is not an identity claim. **The 3,006 `auto_mergeable` flag
drives `lcc_apply_fuzzy_merges`, which is still deliberately unwired.**

**The proportionate step is a value-ranked review lane scoped to what is now operationally live** —
the **181 C6 owners** and the **50 brief-eligible entities**, not all 5,194 groups. That population
is small, every member is by definition on a surface someone works, and each merge is now reversible
(P196). ⚠️ **Rank by exposure, not by group size** — the point is to fix the rows being read.

⚠️ **And check the split direction before merging**: the winner rule is **ownership-first** (P195),
so for Brandywine the survivor is `c8422160…` (the entity holding the asset and the contact), with
the 36 edges and the cadence folded onto it — **not** the reverse, which would be the tempting
choice because that entity looks "more connected."

## 6. What was NOT measured

- **The actual split rate.** §3's caveat — 181 is exposure, not confirmed splits.
- **Whether the other two Brandywine members should merge at all.** `Brandywine Realty` may be the
  same firm or a different one; the detector correctly left that to a human and so do I.
- **Value at risk.** No dollar figure is attached to the 181; `rank_value` is exactly the number in
  question, so quoting it here would be circular.
- **dia.** The named row and the C6 population are gov.
- **Whether `connected_property_value` should feed `rank_value` at all.** It is the fallback that
  put a real number on the wrong entity. That is a design question about the view, not a defect —
  **unexamined.**
