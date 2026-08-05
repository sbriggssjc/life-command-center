# Prompt 39 — Comps appraisal SELECTION: national subject-anchored, not region-bounded

## Why (audit F1, 2026-08-05)
In appraisal mode the candidate PULL is limited to subject state + region (`queryScopeArgs` →
`appraisalCandidateStates` → `p_states`), and `parseRequest` adds `subject.state` unless the text says
"national." So the national similarity ranker (`scoreComp`) never sees national candidates. Intent: the most
closely aligned sold + available comps on a NATIONAL basis, ranked to support the subject's price/cap.

## Task (mcp/comps-tools.js + the pull RPC)
1. **Appraisal pull goes national.** When `appraisal_mode` + subject anchor: set the DB pull `p_states = null`
   (national), raise `APPRAISAL_CANDIDATE_LIMIT` enough to cover a national dialysis candidate set, and stop
   adding `subject.state` as a hard filter. Geography becomes SCORE weight only, never a pull/local filter.
2. **Strengthen `scoreComp` to the underwriting dimensions** (weights, all vs the subject): aligned market
   (metro>region>national), **lease term remaining at close** proximity, **operator/credit** tier match
   (same operator highest; DaVita/FMC/independent tiers), building **age** proximity, **RBA + chairs** proximity,
   **bump structure** similarity. Keep and strengthen the cap-support rule: penalize caps materially above
   subject (>~200 bps); never let the returned weighted cap exceed the subject basis.
3. **Keep reliability + dedup + cap discipline** unchanged; only the geography of the candidate universe and the
   scoring weights change. `interpreted_query` must show `states: national` so the behavior is visible.

## Verify
- `synthesize_comps("comps for the appraiser on The Villages", appraisal)` returns a NATIONAL set ranked by
  similarity (FL/Southeast still rank high, but strong out-of-region same-operator/same-term/same-age comps
  appear), weighted cap ≤ subject, ~20–25 primary sold + aligned on-market. `interpreted_query.states` = national.
- No hard state filter remains in appraisal mode.
