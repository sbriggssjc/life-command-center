> ⛔⛔ **SUPERSEDED 2026-08-31 — DO NOT RUN.** Scott's definitions arrived after this was staged and
> **the role is MULTI-LABEL** (*"these categories can exist multiple iterations per one account"*).
> This prompt encodes a **precedence-ordered single role**, which is refuted on **957 entities —
> 772 of them `investor_owner` + `repeat_buyer` simultaneously**, the exact population whose dual
> status determines BD treatment. Its populations and definitions are also stale.
> ✅ **`C13b-owner-role-multilabel.md` WAS RUN AND SHIPPED 2026-09-01** (`prompts/done/`) — the rewritten, multi-label version.
> Background: `docs/architecture/owner-role-classification.md` §2c–§2c-iii, §2e and §6.

# C13 — the derived owner-role classification

> ⛔ **DO NOT RUN THIS UNTIL SCOTT HAS ANSWERED §0.** Every one of those five is a doctrine call, and
> three of them change what gets written. This prompt is staged so that the moment they are answered
> it can go straight to Claude Code without another measurement cycle.

**Read first:** `docs/architecture/owner-role-classification.md` — **the whole page**, it is the
design and it carries the measurements · `docs/audits/C12_C4a_DECISION_BRIEF_2026-08-31.md` (the
sizing that preceded it, **superseded on two points**) · Dead-End playbook **Class 8, 22, 23, 24,
30, 31** · `CLAUDE.md` Consumption-Layer doctrine.

---

## 0. 👤 BLOCKING — Scott's five decisions, and what each one changes

| # | question | what changes |
|---|---|---|
| 1 | **Confirm `one_off_owner` + `investor_owner`** as two distinct states (§2d) | the two largest arms — 2,448 and 292 entities |
| 2 | **Confirm `former_owner`** (§2b) | 3,795 entities, 191 callable |
| 3 | **`user_owner` as a HUMAN-CONFIRMED lane, not an automated arm** (§2) | whether 13 candidates are surfaced for review or written automatically |
| 4 | **View vs recomputed column** (§3) | implementation shape only; accuracy is identical |
| 5 | **Confirm the newcomer routing** — a BD-activation band, not P0.4 (§4) | whether ~2,949 rows land in the right band or flood the wrong one |

**Record the answers in `owner-role-classification.md` §6 before building**, so the next reader sees
the decision and not just the outcome.

## 1. What to build (once §0 is answered)

A **derived, re-computed** classification of `entities.owner_role`. **Recorded facts only.**

| priority | role | evidence |
|---:|---|---|
| 1 | `operator` | `is_operator_not_owner` / recorded `owner_type` (P113) |
| 2 | `user_owner` | 👤 human-confirmed from the owner ≈ tenant lane |
| 3 | `investor_owner` | ≥2 current `lcc_entity_portfolio_facts` rows |
| 4 | `one_off_owner` | exactly 1 current row, ≤1 `purchases` edge, no past holdings |
| 5 | `former_owner` | held a fact that ENDED, holds none now |
| 6 | `buyer` | ≥2 `purchases` edges, no current holding |
| 7 | `developer` | the existing classifier |
| — | `unknown` | **no qualifying evidence — an honest absence** |

⚠️ **Precedence is a judgement, and the overlap is UNMEASURED.** An entity that currently holds *and*
buys repeatedly is both. **Measure the overlap and report it before choosing** — do not assume it is
small because the ordering looks obvious.

⚠️ **Not classified, deliberately:** the **477** single-asset-but-active and the **35**
SPE-shell-named. They are genuinely ambiguous and, under accuracy-first, **an honest `unknown` beats
a guess.** Surface them; do not bucket them.

**Mandatory on every row:** `role_source` (which arm decided) and `role_computed_at`. ⚠️ **A role
with no recorded basis is the "status nobody earned" failure this repo has hit three times** (A5's
`gap_resolved`, B6b-lead's `filtered_multi_tenant`, C7's proposed default-stamp). And **a manual
`behavioral_override` always wins** — 374 entities already carry one.

## 2. ⚠️ What this must NOT do

- **No lexical classifier.** No arm may read a name to decide a role. Names appear only in the
  existing exclusion guards (`lcc_owner_name_is_brokerage` 6 hits · `lcc_is_placeholder_owner_name`
  3 · `lcc_owner_name_is_not_prospected` 124). Every name-based owner classifier measured in this
  arc landed ~25% raw, 7%, or 4-of-6 guarded.
- **No value floor on the classification.** Scott's first constraint. Suppressing an accurate
  determination to protect a downstream band is the wrong trade.
- **No one-shot stamped backfill** (Class 8). ⚠️ **Re-measure the churn first** — it was 3 holdings
  ended / 1 started in 90 days when taken, on one day, and a bulk ingestion would move it. That
  number is what makes derivation safe rather than noisy.
- **Do not let the prospecting guard suppress a role.** Wake Forest and Mayo are correctly
  `user_owner`; whether they are *prospected* is a separate gate.
- **Do not bake recency into `former_owner`.** Expose `last_ownership_end` beside the role. A cutoff
  in the label starts lying the day it stops matching how Scott works.
- **Do not touch P0.4** (§4 — it needs no gate; the newcomers are routed elsewhere).

## 3. Predicted deltas — assert against these

| | today | expected |
|---|---:|---:|
| `unknown` organizations | 38,837 | **↓ by ~6,600** |
| `investor_owner` | — | **292** (of the currently-unknown holders) |
| `one_off_owner` | — | **2,448** |
| `former_owner` | — | **3,795** |
| `user_owner` | **0** | **≤13, human-confirmed only** |
| P0.4 | **555** | **555 — UNCHANGED** |
| the deal-timing bands (P1/P2/P3/P8) | 620 | **unchanged** — C6 removed the role from them |
| the prospecting brief | 126 | **little or no change** — C8's resolved-owner arm already admits most |

⚠️ **If P0.4 moves, the routing is wrong — stop.** That is the whole point of §4.

## 4. Report back

- Each arm's population against §3, and **the precedence overlap you measured**.
- The churn re-measurement, and whether it still supports derivation.
- Which shape you built (view or recomputed column) and why.
- **The 477 + 35 you left unclassified** — confirm they are surfaced, not bucketed.
- ⚠️ **Read 10 named rows per new arm before declaring it correct.** Every classification error in
  this arc was found by reading rows, not by checking a count — including two of mine that a count
  would have passed.
