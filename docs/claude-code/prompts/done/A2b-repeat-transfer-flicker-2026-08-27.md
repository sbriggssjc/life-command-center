# Prompt A2b — one conveyance recorded on several dates. Fix the producer, not the applier.

> **Automation/data-process audit window.**
> **Read first:** `docs/architecture/ownership-history-lane.md` (canonical), the A2 writeup, and
> the **`gsa_lease_diff` flicker** notes in `CLAUDE.md` (P138 — *the DATE is real, the DIRECTION is
> not*).

---

## 1. The blockage

**`repeat_transfer_unrepresentable` — 14 tasks / 32 links.** A2's applier refuses them, correctly.

`lcc_entity_portfolio_facts` has PK `(entity_id, source_domain, source_property_id)` — **one
interval per party per property.** These chains carry the *same* `(grantor, property)` pair on
**several dates**, so a single conveyance would need several rows and the second collides.

**A2 already established what they are:** ONE conveyance recorded repeatedly, e.g.
`SENTINEL SQUARE I → WASHINGTON DC VI FGF` on 2020-02, 2020-03 **and** 2020-04. That is the
documented **`gsa_lease_diff` flicker** — the producer emits an "acquisition" every time the GSA
lessor field flickers. It survives P131's `(from, to, date)` dedup precisely *because the date
differs*.

**This is a producer problem.** Do not make the applier tolerate duplicates — that would write a
false ownership history in which a party acquired the same asset three times.

## 2. ⚠️ Established by measurement — do not re-derive or assume

- **This is NOT the same population as the A3 mismatches.** 46 mismatch properties vs 12
  repeat-transfer properties, **overlap ZERO**. Both cite `gsa_lease_diff`; they are two distinct
  failure modes. **A shared producer name is not a shared population.**
- **`is_oscillating_pair` is per-property by design** (P138) and is **not** firing on these — A4
  measured zero oscillating pairs across the guarded set.
- The count has moved: A2 reported 12 tasks / 28 links; it now reads **14 / 32**. **Re-measure and
  quote your own number.**

## 3. What to build

**Collapse a repeated conveyance to one link before it reaches the applier.**

The question to answer first, and state plainly: **which date is the true one?** Options, and this
is a judgement worth making explicitly rather than defaulting:
- **earliest** — when the transfer was first observed;
- **latest** — when the record settled;
- **the date the lessor field actually changed** — closest to the conveyance, if recoverable.

⚠️ **Whichever you choose, the others are not "wrong data" — they are the same fact observed
repeatedly.** Preserve the evidence (all source `ownership_id`s on the surviving link's citation)
so the collapse is auditable and reversible. **Do not delete gov rows.**

**Non-negotiables:**

- **Fix it in the chain DRAFTER (P131's planner) or as an explicit pre-apply collapse — not by
  loosening the applier's conflict handling.** The PK is correct; it is the input that is wrong.
- **Deterministic. No model.** These are dates and ids.
- **Additive and reversible**; dry-run default; **report links collapsed and tasks unblocked**,
  never "rows scanned".
- **Do not touch gov's `ownership_history`** — the raw records stay as recorded. This is a
  representation fix on our side.

## 4. Also worth answering while you are here

**Is the flicker still producing?** Check whether new repeated-date transitions have landed
recently. If the producer is live, a one-shot collapse is a chore repeated forever (P176) — it
needs a sweep or a producer-side dedup. **If it is dormant, say so** and a one-shot is enough.
**That distinction determines whether this prompt ships a cron.**

## Guardrails

- **Do not touch** `mismatch` (49), `sponsor_spe` (25), `all_guarded` (18 — A4b owns those), or the
  other blocked reasons (`ambiguous_entity` 18, `no_entity` 18, `placeholder` 15).
- The downstream consumer exists: **cron 244 applies unblocked chains the same night. Do not write
  a second applier.**
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`), expect the Update-branch gate.

## Deliverables

- The collapse, with **the date rule stated and justified**.
- Evidence preservation shown — every source `ownership_id` still traceable from the surviving link.
- The live/dormant verdict on the producer, and a sweep **only if** it is live.
- `docs/architecture/ownership-history-lane.md` §3 and §5 updated.

## Verify

```sql
select blocked_reason, count(distinct research_task_id) tasks, count(*) links
from v_lcc_ownership_chain_apply_blocked group by 1 order by tasks desc;
```

**Expect `repeat_transfer_unrepresentable` → 0**, and `completed_ever` on
`establish_ownership_history` to rise by roughly 14 after cron 244. The other three blocked reasons
must not move.
