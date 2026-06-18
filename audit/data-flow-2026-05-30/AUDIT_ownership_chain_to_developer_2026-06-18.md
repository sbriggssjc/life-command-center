# Audit — ownership history traced back to the original developer (2026-06-18)

**Question (Scott):** as ownership/deed data is ingested, do we resolve each property's chain
back from current owner → prior owners → **original developer** across all sources, find the
gaps, and direct manual research to close them?

## Verdict: chains are far from complete (gov ~1%), from THREE compounding gaps — not deed propagation
`v_lcc_ownership_chain_completeness` (3,800 chains):
| domain | chains | complete | incomplete | developer named | only current owner (no history) | incomplete rent |
|---|---|---|---|---|---|---|
| **gov** | 3,020 | **33 (1%)** | 2,987 | **8** | **2,167** | **$1.88B** |
| dia | 780 | 233 (30%) | 547 | 72 | 50 | $89M |

The three gaps (gov), in priority order:

### Gap 1 — 2,167 buyer-owned properties have NO ownership history at all (ingestion gap)
72% of gov chains are just the current owner with no prior owners. These are NOT a propagation
problem: of all deed-linkable properties, only **31** lack ownership_history — so the 2,167
mostly have **no county deeds ingested at all**. The chain can't be built because the raw deed
evidence was never captured for them. → directed **deed ingestion / county-recorder research**
(ties to the R26 county-portal links already built).

### Gap 2 — the developer endpoint is essentially unknown (resolution gap)
**Only 17 of 12,465 active gov properties have a `developer`** (0.14%). So even chains WITH owner
history can't be marked "complete" — completeness requires reaching the developer, and the
endpoint is almost never populated. `developer` should flow from the Excel master DEVELOPER
column, OM extraction (BTS deals name the developer), and the earliest construction-era deed
grantee — but it isn't. dia is far better (72 developers) because dia OMs/CoStar carry it.

### Gap 3 — the research pipeline under-generates and isn't worked
`lcc_generate_chain_research_tasks` + cron `lcc-r6-chain-research` exist and run, but produced
only **113 `trace_ownership_to_developer` tasks for ~3,534 incomplete chains (~3%)**, and
**106 sit queued/unworked**. So the machinery is real but covers a sliver and nothing's being
resolved.

## NOT the problem (verified, so we don't chase it)
deed → ownership_history propagation mostly works: `parcel_owner_xref` bridges deed
`parcel_id` → `property_id` (9,479 rows; all 5,534 deed parcels reach it), and only **31
deed-linked props lack history + 137 deed transfers** aren't reflected. Small cleanup, not the
headline.

## Fix doctrine → CLAUDE CODE PROMPT R46
Resolve at the source + direct research, value-ranked by $ rent:
1. **Populate `developer` from existing sources** — wire master-sheet DEVELOPER + OM-extracted
   developer + earliest-deed-grantee candidate into `properties.developer` (17 → far higher).
   This alone completes many chains that already have history.
2. **Generate value-ranked research tasks for ALL incomplete chains**, split by gap type:
   `establish_ownership_history` (the 2,167 no-history → county-deed lookup, reuse R26 recorder
   links), `trace_ownership_to_developer` (has history, missing endpoint),
   `confirm_developer` (deed-grantee candidate to confirm). Not 113 — all of them, ranked.
3. **Surface as a Decision Center "ownership chain" lane** so research is worked in-flow; when a
   developer / chain segment is resolved it propagates to the chain + entity graph (R6/R40) and
   drops out of "incomplete."
4. **Small cleanup:** propagate the 31 deed-props / 137 transfers into ownership_history.

## Bottom line
The chain-to-developer is mostly unresolved on gov because (1) deed evidence was never ingested
for 2,167 properties, (2) the developer endpoint is essentially unpopulated (17/12k), and (3)
the research pipeline covers ~3% and isn't worked — not because deed propagation is broken. R46
populates the developer from sources we already have, directs value-ranked research at the rest,
and surfaces it as a workable lane so the chain completes and keeps completing as new deeds/OMs
are ingested.
