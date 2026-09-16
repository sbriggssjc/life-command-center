# DIA1b — finish DIA1: the NPI tile reads the raw diff, the tiles need an "as of", and "45 operators" is not the 21 the database has

**Filed:** 2026-09-16 (Cowork) from DIA1's response. **Owner:** LCC (`dialysis.js`, one or two views on
Dialysis_DB). DIA1 §B is done and live (dead button: the deployed `data-query` edge function was v41 from
July and 403'd every econ view; redeployed v43; errors now surface via `lccReportError`). §A and §C were
diagnosed but not finished, and the round's full report was written to a `/tmp` scratchpad that no longer
exists — so this prompt restates what is known and asks for the rest to land **in the repo**.

## What DIA1 established

- **NPI signals tile (~1,100)** reads a raw diff view, not the gated research lane; only **81** of those
  are genuinely actionable (`v_lcc_research_lane_summary`: `npi_missing_inventory` 62 open, 141 ever
  skipped). The tile counts a backlog, not an action.
- **Lease backfill (~3,119)** may be a producer-without-consumer backlog; unverified.
- Both tile sections already read one materialised view; a spot-check found one tile exact and one
  off by a row from a 1-day MV refresh lag. Recommended a visible "as of" timestamp. **Not all 14 tiles
  were verified**, and the one Cowork measured as a *different definition* — **Operators tracked 45**
  vs `count(distinct operator_id)` = **21** on `properties` — was not looked at.

## What to build

1. **NPI tile → the lane count.** Point the tile at the gated lane's open count (the number a human
  would act on) and rename the caption to say so; keep the raw-diff number, if it matters, as a hover
  or a second line labelled "raw signals". Test: tile value equals the lane view's count.
2. **"As of" on both tile sections**, read from the MV's refresh timestamp (add one if the MV has
  none: a `refreshed_at` column or a companion one-row table written by the refresh job). Test: the
  timestamp shown equals the MV's.
3. **All 14 tiles, verified**, in the table DIA1 §C asked for: caption · query behind the tile ·
  live value · value of the query the caption claims · match?. Land it at
  `docs/audits/DIA1_TILES_2026-09.md`. For **Operators tracked**: state what 45 counts (rows in
  `operators`? distinct name strings? aliases?) and what the caption should say; if the caption is
  wrong, say which number Scott wants and ask — ⛔ never fix a number by rewording the caption to match.
4. **Lease backfill**: is there a consumer? Name it or say there is none; if none, the tile is a
  backlog count and gets the same treatment as the NPI tile (lane count + label), or moves off the
  action list per §A's rule.
5. Add the §A verdict table (human / code / noise per action item) to the same audit file — it was
  in the lost report.

## Prohibitions

- ⛔ No new aggregation tables; one view per tile at most.
- ⛔ dia only; no gov, no LCC Opps.
- ⛔ Every deliverable lands under `docs/audits/` or in code — nothing in a scratchpad.
