# GOVDEED1 — two-thirds of government deed records have a grantee and no date

**Filed:** 2026-09-15 (Cowork), measured live.
**Companion to:** `DEED1-the-autofix-set-is-8-rows-and-half-are-wrong.md` (dialysis side).

## The measurement

`properties`, both domains, same two columns:

| domain | grantee present | of those, **deed date NULL** | share |
|---|---|---|---|
| government (`scknotsqkcheojiaewwh`) | 5,922 | **3,930** | **66.4%** |
| dialysis (`zqzrriwuavgrquhisnoa`) | 1,774 | **2** | **0.1%** |

Same field, two pipelines, a 600x difference in miss rate. **The dialysis pipeline is a working
reference implementation of the thing the government pipeline is failing at** — that is the strongest
fact in this prompt and the place to start.

## Why it matters now

Every consumer that reasons about deed recency is silently disabled for those 3,930 properties.
Concretely, `v_owner_source_conflict.auto_fixable` requires
`latest_deed_date >= CURRENT_DATE - 2 years`, and NULL fails that. Of the 593 government
`deed_newer_stale` conflicts, **389 are blocked by the NULL date alone** and only 7 have a date recent
enough to qualify — which is why the government domain has **zero** auto-fixable rows. No policy
decision unblocks that. A date does.

⚠️ **This is a `NULL` that reads as a verdict.** Downstream, "no deed date" is indistinguishable from
"deed is old," and the code treats them the same. That is the same shape this repo has now hit four
times (XB2-counter, `flag_long_dark`, DOC-TABLE2, MISPARSE1's `email_fanout`): **one signal carrying
two different meanings.** Whatever the fix, the end state should let a consumer tell *"we have no
date"* apart from *"the deed is from 2009."*

## Scope — diagnose, then report

1. **Find where the date is dropped.** Trace the government deed path end to end: the ingestion that
   writes `properties.latest_deed_grantee` / `latest_deed_date`. The question to answer is narrow —
   does the source lack the date, or does the code have it and fail to persist it? Those have
   completely different fixes and the answer is knowable.
2. **Compare against the dialysis path**, which gets this right on 1,772 of 1,774. If the two paths
   share code, say where they diverge. If they do not share code, say that — it is itself the finding.
3. **Characterize the 3,930.** Are they one source, one county, one ingestion era, one loader? A
   `min`/`max` on `created_at` and a group-by on whatever source column exists will answer it quickly.
   If the gap is one batch, the fix is a backfill; if it is continuous, the writer is broken and is
   still writing dateless rows today. **Check whether it is still happening** — that changes urgency.
4. **Report a recommended fix with its population sized.** Do not build the backfill in this round.

## Prohibitions

- ⛔ **Do not backfill, guess, infer, or derive a deed date.** A date reconstructed from a
  `created_at`, a sale record, or a neighbouring row is fabrication, and this repo's standing rule is
  "Not on file" over a plausible value. If a date cannot be sourced from the deed record, it stays
  NULL and the finding is that it stays NULL.
- ⛔ Do not change `v_owner_source_conflict` in the government DB. Its gate is correct; the data
  feeding it is not.
- ⛔ Do not flip `DECISION_OWNER_DEED_WINS`.

## Repo ownership

⚠️ Check this before writing code. Per the ID3a-d doctrine ("one repo owns each database's objects"),
government-database objects belong to the **`government-lease`** repo, not to `life-command-center` —
LCC's copy of the gov migrations was deliberately retired under I16. If the fix lands in gov ingestion
code, this round's deliverable is a **written handoff to that repo**, not a migration here. Say
plainly which repo owns the fix; do not write a gov migration into `life-command-center` to make the
round feel complete.
