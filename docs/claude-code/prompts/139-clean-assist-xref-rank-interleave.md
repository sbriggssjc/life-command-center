# Prompt 139 — Interleave the clean-assist provenance lane so P137's ladder cards surface

## Context (Cowork, 2026-08-26)
P137 wired the provenance ladder into `OLLAMA_CLEAN_ASSIST` (measured: a join to `field_source_priority`
resolves 454/454 conflicts, 433 ladder-decidable). But the payoff is **masked**: the ~65-row `dia_xref`
provenance backlog is ranked **`1000 + severity` (= 1001)**, above every ladder-bearing `field_provenance`
row (`_provImportance` maxes at **1000**), so the cursor drains all xref first — and xref has **no ladder by
design** (the dia sales-price cross-reference arm — three unlabelled numbers, correctly `uncertain`). Result:
the first ~65 provenance cards an operator (and the grader) sees are all "uncertain," and the 433 decidable
ladder cards sit behind them.

CC deliberately left the rank scales alone in P137 because `rank_value` **also orders the human-facing
Decision Center provenance lane** — so this is a deliberate, separate decision, not a bug.

## Ask
Make the two provenance sub-populations **interleave** by VALUE rather than letting the xref scale
monopolize the head, WITHOUT breaking the human Decision Center ordering.

- Preferred: put xref and field_provenance on **one comparable rank scale** so a high-value ladder-decidable
  conflict can rank ahead of a low-severity xref row. The current split (`1000 + severity` for xref vs
  `≤1000` for field_provenance) is two incomparable scales sharing one budget — collapse them to a single
  value expression (e.g. normalize xref severity into the same 0–1000 band the field_provenance importance
  uses, or add an explicit interleave key).
- Alternative if a full re-rank is too broad: give the **clean-assist tick** a per-lane fair-share so it
  pulls some field_provenance rows every run even while xref remains, rather than strict rank order draining
  xref entirely first. (Lower blast radius — touches only the assist selector, not the human lane.)
- Either way, do NOT starve xref (it still needs review) and do NOT reorder the human Decision Center lane in
  a way that hides the xref conflicts a person works.

## Verify
- After the change, `POST /api/ollama-clean-assist-tick?limit=100` surfaces `field_provenance` provenance
  proposals (not only `prov:dia_xref:*`) within the first run or two, and they carry
  `keep_current`/`accept_attempted` verdicts citing `ladder_says`, with `uncertain` only on the ~21 genuine
  ties. Assert on the presence of non-xref provenance proposals + a ladder-citing reason.
- The human Decision Center provenance lane still shows the xref conflicts (nothing hidden).

## Deploy
Likely JS-only (selector/rank expression) — Railway redeploy; a view change only if the rank lives in a
view. Small. Commit with the repo trailer. This is the visible-payoff follow-up to P137; low urgency (the
cron drains xref over ~a day regardless), but it's the difference between the ladder value showing up now vs.
after the backlog clears.
