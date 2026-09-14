# Prompt A5a — the auto-close fires over a truncated feed. ~900 false closures a month.

> **Automation/data-process audit window.**
> **Read first:** `docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`, the **correction block
> at the top of** `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`, and the PostgREST
> 1,000-row cap footgun in `CLAUDE.md`.
>
> ⚠️ **This is a CORRECTNESS bug in a shared generator, not a lane improvement. It must land before
> A5c / A5d / A5e — every measurement in this area is untrustworthy until it does.**

---

## 1. The bug

`handleGenerateResearchTasks` reads its feed with `order=priority.desc&limit=2000`. **PostgREST caps
any response at 1,000 rows regardless of `limit`** — a documented invariant in this repo that has
bitten it before (the dia owner-facts sync loaded 6,196 of 12,196).

It then auto-closes every open task **not present in the feed** as `gap_resolved`, guarded by
`feed.length < limit`. Its own comment says the guard exists so this never fires *"on a capped
slice."* **It compares `feed.length` (1,000) against `limit` (2,000)** — the number it *asked for*,
not the number it *got* — so the guard passes and the auto-close runs over a truncation.

**Measured consequences:**

| lane | "completed" | auto-closed `gap_resolved` |
|---|---:|---:|
| `property_missing_recorded_owner` | 4,781 | **4,781 (100%)** |
| `true_owner_needs_salesforce` | 596 | **596 (100%)** |

- **170 of 183 sampled** `true_owner_needs_salesforce` owners still have `salesforce_id IS NULL`
  (93% false); **146 of 146 sampled** `property_missing_recorded_owner` properties still have
  `recorded_owner_id IS NULL` (100% false).
- **Two lanes are frozen at a constant**: open counts pinned at exactly **1,000** and **815**
  (`1000 − 185`). Neither can ever clear.
- **5,509 of 6,324 real gaps have never had a task at all.**
- Cliff at **2026-06-22** — the date the window saturated.
- **~900 false closures/month, across ALL dia+gov NBA lanes** that share this generator.

## 2. The fix — three parts, and all three are needed

1. **Compare against the RETURNED row count, never the requested limit.** The guard must know the
   feed was truncated.
2. **Page the feed.** Stride at **exactly 1,000** — a larger stride silently skips rows (documented).
   Page until exhausted, or until a stated cap, and **report whether you exhausted it.**
3. **Add a stable tiebreak to `order=priority.desc`.** There is none today, and the gap arm is
   `20 AS priority` — a hard-coded literal, so **6,324 rows tie at exactly 20** and the "top 1,000"
   is arbitrary and unstable between runs. Without a tiebreak, paging is not deterministic either.

**⚠️ Fail CLOSED on ambiguity.** If the feed cannot be exhausted, **do not auto-close anything** —
skip the close entirely and say so in the response. A false closure is far more expensive than a
task left open: it silently asserts a gap was resolved when it was not.

## 3. What NOT to do

- **Do not "fix" it by raising `limit`.** The cap is server-side; a bigger number changes nothing and
  re-creates the same lie (`CAND_LIMIT = 1200` is a documented instance of exactly this).
- **Do not re-open the 5,377 falsely-closed tasks in this prompt.** That is a data-repair decision
  with its own blast radius — size it, file it as **A5b-repair**, and let Scott decide. The
  producer must be correct *before* anything is re-opened, or you refill a broken window.
- **Do not touch the value-gate, the 293 ID-to-ID fills, or the 5,338 retirements** — A5c/A5d/A5e
  own those, and each is gated on this landing first.

## 4. ⚠️ Establish the blast radius before changing the guard

This generator serves **multiple lanes across dia and gov**. Before the fix:

- **Which lanes does it auto-close?** Enumerate them, with each one's open count and lifetime
  `gap_resolved` share. `establish_ownership_history` reads **0% auto-closed** — confirm it is
  genuinely unaffected rather than assuming.
- **Which lanes' open counts are pinned at a suspicious constant** (1,000, or `1000 − n`)? That is
  the signature, and it is cheap to check fleet-wide.
- **After the fix, how many tasks does the generator newly emit?** 5,509 gaps have never had a task;
  if they all mint at once that is a producer flood into surfaces nobody can work. **Value-gate or
  cap the first run and say what you did** — A5c exists precisely because 84% of that population
  owns zero properties.

## 5. Verify — and the honest signal here is NOT a drain

**The success signal is that false closures STOP**, which looks like *nothing happening*:

```sql
-- must go to ~0 for lanes fed by this generator
select research_type, count(*)
from research_tasks
where status='completed' and outcome::text ilike '%gap_resolved%'
  and completed_at > now() - interval '1 day'
group by 1 order by 2 desc;

-- the pinned constants must move off 1,000 / 815
select research_type, count(*) filter (where status in ('queued','in_progress')) open_
from research_tasks group by 1 order by open_ desc limit 8;
```

**⚠️ Do not read a rising open count as a regression.** Open going **up** is the fix working — real
gaps that were being silently closed now stay visible. The number that must fall is
`gap_resolved`-per-day; the number that must move is the pinned constant.

## Guardrails

- Additive, reversible, dry-run default. **Report rows the auto-close WOULD have closed vs did.**
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`), expect the Update-branch gate.
- A guard test that **goes red on the pre-fix comparison** — mutation-verify it, as A2a did.

## Deliverables

- The fix (returned-count guard + paging + stable tiebreak), with the fail-closed path exercised.
- The fleet-wide blast radius: every lane this generator auto-closes, and which were pinned.
- The newly-emitted task count, capped or value-gated, with the choice stated.
- **A5b-repair filed** (do not build): how many falsely-closed tasks exist, and the options.
- `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md` correction block updated with the
  post-fix numbers — **that document's rankings are still built on the corrupted metric.**
