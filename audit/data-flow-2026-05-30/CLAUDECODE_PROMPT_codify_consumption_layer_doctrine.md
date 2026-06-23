# Claude Code — codify the Consumption Layer doctrine into CLAUDE.md (docs-only)

## Why
The surface walk (2026-06-22/23) found the same root pattern on four consecutive operator
surfaces — producers emit work at ingest scale, consumers don't keep pace, surfaces fill with
noise that buries the actionable few (research tasks 5,447 / 0-completed producers; queue P7
565 unranked cadence rows; cadence 318 active / 3 ever touched; Decision Center verdict lanes
`decided_7d=0` buried under "999+"). R60/R62/R63 fixed three of them with the same move. To
stop the regression recurring by default, codify the doctrine as a standing CLAUDE.md section
so every future round inherits it.

Full write-up:
`audit/data-flow-2026-05-30/CONSUMPTION_LAYER_DOCTRINE_2026-06-23.md`.

## Change (docs-only, zero code)
Add the section below to `life-command-center/CLAUDE.md`, placed near the other architectural
doctrine sections (after the BD-engine / R-series doctrine blocks, before the per-round logs —
wherever it reads best as standing guidance, not a dated round entry). Do not edit any other
file. No migration, no api change (`ls api/*.js | wc -l` stays 12).

```markdown
## Producer/Consumer (Consumption Layer) doctrine

LCC produces work (research tasks, cadences, decisions, queue rows, inbox items) at ingestion
scale and historically under-consumed it, so operator surfaces filled with un-worked noise
that buried the actionable few (the worst failure mode: a 5,447 / 999+ badge that is mostly
noise trains the operator to ignore the surface). Every code path that emits operator-facing
work MUST satisfy all five invariants:

1. **Value-gate the producer.** Emit a work item only above an actionability/value floor —
   never one item per captured row. The floor is a single tunable knob (e.g. R60
   `$500k` chain-task floor; R63 `CADENCE_SIGNAL_MIN_VALUE`).
2. **Auto-retire + auto-resolve.** A scheduled sweep closes items whose premise has cleared
   (data self-resolved) and auto-resolves the high-confidence subset, leaving only genuine
   judgment calls for a human. Model: `lcc_refresh_decisions` auto-supersede. Reversible —
   pause/skip with a reason, never hard-delete.
3. **Surface actionable-only, value-ranked, capped.** The operator surface defaults to the
   workable set (signal-bearing, value-ranked, top-N) with a "show all" toggle. A surfaced
   count must reflect ACTIONABLE work, not raw producer output.
4. **Close the loop from real activity.** Where an operator activity stream exists (Salesforce
   / Outlook), drive the consumer from it (e.g. OUTREACH#1 SF-activity → cadence advance)
   rather than a separate manual queue.
5. **Honest counts.** Every badge/number is actionable work, not raw output.

**No new producer ships without:** (a) a named consumer (human verdict, worker, or auto-sweep
— if none, don't build the producer); (b) a value-gate; (c) an auto-retire predicate (+ which
subset auto-resolves); (d) a ranked, capped surface whose count is actionable-only; (e) where
possible, reality-driven advance. Instances: R60 (research), R62 (queue cadence), R63
(cadence), R64 (Decision Center verdict lanes). A healthy worklist (inbox triage,
match_disambiguation) is one whose consumer keeps pace; a graveyard is one without.
```

## Verify
- The section is present in `life-command-center/CLAUDE.md`, well-placed, markdown renders.
- No other file changed; `ls api/*.js | wc -l` = 12; `node --check` n/a (docs-only); suite
  unaffected.

## Bottom line
One short standing doctrine section so the produce-without-consume pattern is prevented by
design, and R64 + future producers are written against the checklist instead of rediscovering
the bug.
