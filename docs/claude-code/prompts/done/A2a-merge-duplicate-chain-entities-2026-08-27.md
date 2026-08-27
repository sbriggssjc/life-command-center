# Prompt A2a — merge the duplicate entities blocking 48 ownership chains. No new code required.

> **Automation/data-process audit window.**
> **Read first:** the A2 writeup, `docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md`,
> `docs/audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md`, and the
> `lcc_merge_entity` / P175a / P177 sections of `CLAUDE.md`.
>
> ⚠️ **This prompt writes to production via a shared, formerly-irreversible function. Read §2
> before touching anything.**

---

## 1. The opportunity

A2 completed **288** ownership-history tasks and left **90 `agrees` chains still open**, every one
named rather than residual. The largest block:

**`blocked_reason = 'ambiguous_entity'` — ~50 tasks / 54 links / 45 distinct parties.** The chain is
drafted, record-cited and appliable; it cannot land because the grantor name resolves to **more
than one LCC entity**. The canonical example is `Duke Realty Limited Partnership` vs
`DUKE REALTY LIMITED PARTNERSHIP`.

**No new applier is needed.** Merge the duplicate pairs and **cron 244 applies those chains the
same night**, through the path A2 already built and proved reversible. The surface listing them is
`v_lcc_ownership_chain_apply_blocked` (`blocked_reason`, `grantor_name`, `grantor_key`,
`rival_entity_names`, `n_entities`, `owner_annual_rent`).

⚠️ **Re-measure before acting.** A2's writeup said 48 tasks / $210.6M; a later count read 50 tasks /
45 parties. Neither dollar figure was aggregated per-owner correctly. **Size it properly and quote
your own number.**

## 2. Why this was blocked until now, and what changed

Until **2026-08-27** `lcc_merge_entity` had **no undo** — every dedup DELETE was unrecoverable, and
its `owner_contact_pivot` dedup was *uncorrelated*: it asked only whether the winner had a pivot at
all, then deleted the loser's. **P195 proved that is not theoretical** — on `bamproperties` the
winner-by-ownership held a pivot naming nobody while the loser held the group's **only named
contact**.

**Prompt 196 Unit 1 fixed it.** `lcc_merge_snapshot_loser`, `lcc_merge_fold_pivot` and
`lcc_unmerge_entity` are all live, and the round trip was proven on real data. **That is the only
reason this prompt is now safe to run.**

**Non-negotiables:**

1. **Use `lcc_merge_entity` — do NOT write a third merge driver.** P195 needed an external
   snapshot driver only because the shared function lacked one. It no longer does. A second
   implementation is the drift this repo warns about repeatedly.
2. **Prove the round trip on this population before the batch.** Merge one pair, `lcc_unmerge_entity`
   it, compare. P195's reversal failed its first live attempt (`428C9: cannot insert a non-DEFAULT
   value into column "is_current"` — a GENERATED ALWAYS column) and P196's failed on a
   BEFORE-INSERT trigger silently defeating `ON CONFLICT DO UPDATE`. **A reversal path that has not
   been exercised on THIS data is a claim, not a capability.**
3. **⚠️ Identity must be earned, not assumed from the name.** `ambiguous_entity` means the name is
   ambiguous — that is the whole problem. **Byte-identical-after-case is the safe core** (P195's
   population). Anything beyond it needs evidence: shared `external_identities`, shared assets,
   overlapping portfolio facts. **Do NOT use `lcc_owner_strict_core`** — A2 measured and rejected it
   on this exact population (it collapses `BAMMF (8) LLC` onto `BAMMF (3) LLC`), and
   `lcc_normalize_entity_name` is banned for identity for the same reason.
4. **Where the pair is NOT provably the same party, leave it blocked and say so.** A wrong merge
   writes a false ownership fact and costs far more than an unapplied chain. **Report
   merged / held / held-because-unprovable separately.**
5. **Winner rule: ownership-first**, per P195 — the entity that actually owns assets, not the one
   with the longer name or the earlier id.

## 3. Verify by the DRAIN, not the merge count

```sql
-- the number that matters
select count(*) filter (where status='completed') completed_ever,
       count(*) filter (where status in ('queued','in_progress')) still_open
from research_tasks where research_type='establish_ownership_history';

-- and the bucket this prompt targets
select blocked_reason, count(distinct research_task_id) tasks
from v_lcc_ownership_chain_apply_blocked group by 1 order by 2 desc;
```

**Expect `completed_ever` 288 → ~336 after cron 244's next run**, and `ambiguous_entity` to fall by
the number of pairs merged. **Merges performed is an input, not an outcome** — a run that merges 45
pairs and drains no chains has done nothing this prompt was for.

⚠️ **Do not force the apply yourself to make the number move.** Cron 244 is the consumer; letting it
run is the proof that the loop closes unattended. If you want same-session evidence, invoke the
apply through its own endpoint and say plainly that you triggered it.

## 4. Also worth checking while you are in here

`r9_chain_connect` (cron 104) mints a prior-owner entity per chain name and attaches it to nothing
— **291 of the 331 grantors A2 resolved are its unattached output.** It is a plausible *source* of
these duplicates: it may be minting a second entity for a name that already exists. **Measure
whether the `ambiguous_entity` pairs trace to it**, and if so, say whether the producer needs a
resolve-before-mint step. **Do not fix that here** — size it and file it.

## Guardrails

- **No model.** Identity by evidence, never by name similarity.
- Dry-run default; batch-tagged; reversible; honest counts.
- **Do not touch** `mismatch` (74, awaiting Scott's sponsor confirms), `all_guarded` (18, A4b) or
  the other blocked reasons (`no_entity` 18, `placeholder` 15, `repeat_transfer` 12).
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`), and expect the Update-branch gate.

## Deliverables

- The merge pass (dry-run + apply), the proven round trip, and the drain measured after cron 244.
- Merged / held / unprovable, reported separately with the held reasons named.
- The `r9_chain_connect` question answered and filed.
- `PLANNED-BACKLOG.md` A2a → done; A2b / A4b / A3-residue untouched.
