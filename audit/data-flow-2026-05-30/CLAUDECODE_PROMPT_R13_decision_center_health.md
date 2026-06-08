# Claude Code prompt — R13: Decision Center lane health

Audit grounded live 2026-06-08 (LCC Opps + gov + dia). **The verdict/effect
machinery is healthy** — this round is mostly one high-value de-noising fix
plus two smaller follow-ups. Lead with the de-noise.

## What's already healthy (verified — do not "fix")
- All 13 decision_type branches exist in `handleDecisionVerdict`; effect-first
  /outcome-truthful is consistent (`recordEffectFailure` + 502 on a failed
  effect keeps the decision open; `unknown_verdict_for_type` 400; final
  `unsupported_decision_type` 400; idempotent `already_decided` 409 + mint
  dedup on `subject_ref`). No dead-end verdicts.
- Federated counts are honest: the summary reflects each lane's real universe
  minus decided (e.g. intake_disposition 719 = `review_required` 638 + `failed`
  81, verified). Federated lanes list value/severity-ranked top-N, paginated,
  excluding decided.
- Live lane counts: confirm_true_owner 160, junk 747, map_sf 16,
  match_disambiguation 8, confirm_buyer_parent 1 (seeded); intake 719,
  property_merge 6,955, provenance_conflict 14,742, pending_update 2,147,
  cms_link_suspect 269, implausible_value 38 (federated). Total 25,802.

## Unit 1 — de-noise the provenance_conflict lane (the headline; 78% is noise)

`provenance_conflict` reports **14,742**, but grounding
`v_field_provenance_actionable` by `decision` shows:

| decision | enforce_mode | count |
|---|---|---|
| **skip** | warn | 9,545 |
| **skip** | strict | 1,967 |
| conflict | warn | 3,101 |
| conflict | strict | 62 |

`decision='skip'` (**11,512 = 78%**) means the field-provenance registry
**correctly chose a higher-priority source** and skipped a lower-priority
write. That is the system working as designed — NOT a human decision. Those
rows are warn/strict-mode TELEMETRY (the "would-block" log), valuable for
audit but wrong to surface in an operator decision queue. Only
`decision='conflict'` (**3,163 = same-priority disagreements**) needs Scott's
judgment.

Fix: the `provenance_conflict` lane must surface ONLY `decision='conflict'`.
- In `fetchFederatedSource` (`api/admin.js`), filter the
  `v_field_provenance_actionable` pull to `decision=eq.conflict` (both the
  items pull and the `opsCnt` total). The dia `sales_price_xref_conflict` leg
  is genuine — keep it.
- This drops the lane 14,742 → ~3,163 and de-noises the whole Decision Center
  summary (Scott sees real work, not registry telemetry).
- The `skip` telemetry stays available for audit via the view directly /
  the existing provenance panels — just not in the decision lane.
- If `v_field_provenance_actionable` is meant to BE the conflict set, consider
  renaming/repointing the lane at `v_field_provenance_conflicts` (the
  "open same-priority disagreements pending review" view per CLAUDE.md) — but
  the minimal, safe fix is the `decision='conflict'` filter. Ground which view
  gives the cleaner 3,163 and use it.
- Verify live: lane count ≈ 3,163; spot-check 5 cards are real same-priority
  ties (current_source vs attempted_source at equal priority), not a
  high-priority source beating a low one.

## Unit 2 — registry learning loop for accept_attempted (drains the class)

Even for genuine conflicts, the `accept_attempted` verdict only
`createResearchTask` — it does NOT write the chosen value through
`lcc_merge_field` or adjust `field_source_priority`. So resolving one conflict
never teaches the registry to auto-resolve the same `(target_table,
field_name, source)` class next time; the 3,163 (and every future conflict of
that shape) stays manual. Build the loop:
- On `accept_attempted`: write the attempted value through the existing
  `lcc_merge_field` path with the operator as authority (effect-first; on
  failure keep the decision open per the established pattern), AND record the
  operator's choice so the priority registry can learn (e.g. bump the
  attempted source's `field_source_priority` for that field, or log a
  preference the registry consults). This touches the shared priority registry
  — treat it as its own blessed change: gate behind a flag, exercise on ONE
  real conflict, confirm no mass re-ranking, report before/after counts.
- `keep_current` stays a safe record (the registry already agrees). `skip`
  stays record-only.
- This is the deferred item from CLAUDE.md "R7 Phase 2 follow-ups" — it's now
  the bottleneck for actually draining the provenance class.

## Unit 3 — junk 'skipped' rows stop re-surfacing (small)

`junk_entity_name` has 1,082 `skipped` lcc_decisions, but `leave_flagged`
records `skipped` while the entity stays `metadata.junk_name_flagged=true`, so
`lcc_refresh_decisions` re-seeds it every run — the operator re-sees rows they
already dismissed. Add a "stop asking" semantic: `leave_flagged` sets
`metadata.junk_name_reviewed=true` (or `junk_name_keep=true`) and the seed
query excludes reviewed entities (the seed already has the hook per CLAUDE.md).
Verify: a left_flagged entity does not reappear after `lcc_refresh_decisions()`.

## Verify + ship
- Unit 1 is the priority and is low-risk (a read filter): apply, confirm the
  lane drops to ~3,163, spot-check 5. Cache-or-live safe.
- Unit 2 is the blessed registry change — flag-gated, one-conflict exercise,
  report. Don't bulk-run.
- Unit 3: refresh round-trip proof.
- House rules: `node --check`; 12 functions; effect-first/outcome-truthful;
  migrations idempotent; report per-unit. JS ships on the Railway redeploy;
  any view/migration DB-side per the standing posture.
