# Prompt 26 — Fix appraisal-mode over-filtering: subject location must RANK, not hard-filter

## Observed (live engine, prompts 23+25 ARE deployed)
`synthesize_comps("...dialysis...The Villages, FL...appraiser...20-25...")` returns `appraisal_mode:true`, resolves
`subject` (metro "Wildwood-The Villages", region Southeast, fields "Not on file"), score tiers, transparency — all
the new behavior. BUT `interpreted_params` carry `p_metros:["Wildwood-The Villages"]` + `p_states:["FL"]` as HARD
filters, so `applyLocalScope` collapses Florida's ~14 dialysis comps to **1** — the subject's own metro listing
(DaVita, 1050 Old Camp Rd) — and returns "1 of 1". The Team Briggs workbook then refuses ("no comp rows").

## Root cause
In appraisal mode the parsed subject **metro** (and the state) are applied as RESTRICTIVE filters instead of
similarity ANCHORS. `scoreComp` already weights same-metro > same-state > region > national, so the location should
rank, not gate. (Confirmed: `query_comps states=[FL]` with NO metro returns 14; adding the metro filter drops it to 1.)

## Fix (`mcp/comps-tools.js`)
1. **In `appraisal_mode`, do NOT hard-filter by the subject metro** — drop metro from `applyLocalScope`. And do NOT
   constrain the pull to the subject state only: pull a broad candidate pool (subject STATE + REGION, then national
   fallback if under target) and let `scoreComp` rank by proximity. Metro/state stay ranking signals only.
2. **Pool size:** request a candidate pool ≥ ~2–3× the appraisal target (e.g. 60–90) before ranking + capping to 30,
   and scope by state/region so the RPC's most-recent-first cap doesn't crowd out older in-region comps with recent
   national ones (the prompt-23 "rank before truncate" intent, applied to geography).
3. **Exclude the SUBJECT itself** from the comp set when it resolves to our asset / subject candidate (the DaVita
   1050 Old Camp Rd Villages listing is the SUBJECT, not a comp).
4. **Non-appraisal behavior unchanged:** when the USER explicitly names a metro/state, keep it a hard filter. Only
   appraisal mode relaxes subject-derived geography to ranking.

## Verify
- The Villages appraisal request → ~20–30 ranked dialysis comps, FL-weighted then Southeast/national, sold + active
  listings, subject excluded, tiers A/B/C populated, "returned N of M" with N ≥ 20; workbook builds.
- A user request that DOES name a metro ("dialysis comps in Tampa") still hard-filters to that metro.

## Secondary (not the blocker)
Subject resolved as `subject_candidate` with all fields "Not on file" — if feasible, resolve the actual
under-contract Villages deal record to populate subject tenant/term/SF/chairs/cap for richer similarity ranking.
