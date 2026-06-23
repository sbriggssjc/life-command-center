# The Consumption Layer — LCC produce-vs-consume doctrine (2026-06-23)

## The pattern (one bug, found four times)
LCC is excellent at PRODUCING work — every ingestion, enrichment, and resolution pass emits
tasks, cadences, decisions, and queue rows at ingestion scale. It is weak at CONSUMING that
work. The consumer (a human verdict, a worker, an auto-sweep) doesn't keep pace, so the
operator surfaces fill with un-worked items that **bury the actionable few under noise**. The
operator can't tell signal from volume, so the system "drives box-checking, not real work."

The surface walk (2026-06-22/23) found the identical root pattern on four consecutive
surfaces, each grounded live:

| Surface | Producer (emits at scale) | Consumer state | Result |
|---|---|---|---|
| Today → Research | chain-research generators (R6/R46) | 2 producers, **0 ever completed** | 5,447 queued, +4,061/7d vs 254 done |
| Priority Queue → P7 | cadence-due mirrored into the BD queue | unranked, duplicated dashboard | 565 rows, 99.6% rank-zero |
| Cadence Dashboard | auto-seed a cadence per captured contact | **3 cadences ever touched** | 318 active, all overdue, 185 noise |
| Decision Center | seeded + federated decision lanes | verdict lanes **decided_7d = 0** | 175 confirm-owner + 114 SF-collision buried under "999+" |

Same shape every time: **produce at ingest scale, under-consume, surface raw counts.** The
already-healthy surfaces (inbox triage, match_disambiguation, property_missing_recorded_owner)
share one trait the broken ones lack — a working consumer (auto-supersede or an active
worker).

## The doctrine — five invariants every producer/consumer pair MUST satisfy
A producer may not emit operator-facing work unless all five hold. This is the standard the
fixes below already instantiate; make it the rule, not the exception.

1. **Value-gate the producer.** Emit a work item only when it clears an actionability/value
   floor — never one item per captured row. The floor is a single tunable knob.
   *Instances:* R60 `$500k` chain-task floor; R63 cadence "real BD signal" gate
   (`CADENCE_SIGNAL_MIN_VALUE`); R62 removed the cadence-rows that had no place in the queue.

2. **Auto-retire + auto-resolve.** A scheduled sweep closes items whose premise has cleared
   (the data self-resolved) AND auto-resolves the high-confidence subset, so only genuine
   judgment calls remain for a human. *Model:* `lcc_refresh_decisions` auto-supersede (drains
   match_disambiguation 978, junk 588). *Instances:* R60 close-the-unresolvable sweep; R63
   pause-no-signal sweep. *Gap:* the Decision Center verdict lanes have no auto-resolve →
   R64.

3. **Surface actionable-only, value-ranked, capped.** The operator surface defaults to the
   workable set (signal-bearing, value-ranked, top-N), with "show all" as a toggle. **Never a
   raw "5,447" / "999+" dump** — that count must reflect actionable work. *Instances:* R63
   dashboard default (318→119 actionable); R62 queue de-bloat; R60 the Today RESEARCH count.
   *Gap:* Decision Center "999+" badge = federated universe burying ~290 actionable verdicts
   → R64.

4. **Close the loop from real activity.** Where possible the consumer is driven by the
   operator's actual work (their Salesforce/Outlook outreach, their captures), not a separate
   manual queue they must remember to visit. *Instance:* OUTREACH#1 (SF activity advances the
   cadence); R63 Unit 3 (real outreach seeds + grows the cadence). This is what makes a
   worklist self-maintaining instead of a graveyard.

5. **Honest counts.** Every surfaced number is actionable work, not raw producer output. A
   badge of 5,447/999+/836 that is 95% noise trains the operator to ignore the surface — the
   worst failure mode, because it hides the real items too.

## The shared primitives (build/standardize once, reuse everywhere)
Most of these already exist as one-offs; the doctrine is to make them the standard contract:
- **A value/ signal gate fn** per producer (R60 floor, R63 `entityHasBdSignal`) — fail-closed.
- **A refresh/auto-retire sweep** per worklist (the `lcc_refresh_decisions` pattern):
  supersede-when-premise-clears + auto-resolve-high-confidence + (reversible) pause/skip the
  rest with a reason.
- **An "actionable" view + cap** per surface (default workable set; `?include_all` toggle).
- **A reality-driven advance** where an operator activity stream exists (SF/email → advance).
- **Reversibility**: pause/skip with a reason, never hard-delete, so a gate can be retuned.

## Checklist — no new producer ships without this
Before adding any code path that emits operator-facing work (a research task, a cadence, a
decision, a queue row, an inbox item):
1. **Who consumes it?** Name the consumer (human verdict, worker, or auto-sweep). If none,
   don't build the producer.
2. **What's the value-gate?** The floor/signal that makes an item worth surfacing.
3. **What's the auto-retire predicate?** When does this item self-close, and which subset
   auto-resolves without a human?
4. **Where does it surface, ranked and capped?** And does its badge count only actionable
   items?
5. **Can the operator's real activity drive it** instead of a manual queue?

## Application status (instances of the doctrine)
- **R60** — research backlog: value-gate ($500k) + bulk-close unresolvable. ✅ shipped/live.
- **R62** — queue: cadence bands removed (belong to the dashboard). ✅ shipped/live.
- **R63** — cadence: signal-gate seeder + pause noise + grow-from-outreach + actionable
  default. ✅ shipped/live.
- **R64 (next)** — Decision Center: split actionable verdict lanes (value-ranked, capped)
  from the federated "999+" universe; auto-resolve the safe mechanical subset
  (e.g., same-entity sf_link_collision); keep ownership confirmation human but value-ranked.
- **Remaining to apply the checklist to:** inbox `promoted=1` (captures triaged-not-converted);
  10,104 null-domain inbox_items (unroutable); the federated DQ lanes (provenance ~3k /
  property_merge ~7k — worked-on-demand with no value-rank/cap); `establish_ownership_history`
  auto-close as R59 deed ownership_history lands.

## Proposed: promote this to a CLAUDE.md doctrine section
Add a short "Producer/Consumer (Consumption Layer) doctrine" section to
`life-command-center/CLAUDE.md` so every future round inherits the five invariants + the
checklist, and the produce-without-consume regression can't recur by default. R64 and the
remaining targets then become straightforward instances rather than rediscoveries.

## Bottom line
The recurring failure isn't four bugs — it's one missing architectural layer: a disciplined
CONSUMPTION contract behind every producer. Value-gate what you emit, auto-retire/auto-resolve
what you can, surface only the actionable (ranked, capped, honestly counted), and drive the
loop from real activity. R60/R62/R63 already prove the fix works surface-by-surface; codifying
it as doctrine + a new-producer checklist fixes the pattern by design.
