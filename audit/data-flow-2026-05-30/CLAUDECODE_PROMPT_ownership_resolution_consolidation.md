# Claude Code — consolidate the fragmented ownership-resolution lanes into ONE property-keyed surface

## Why (grounded live across gov `scknotsqkcheojiaewwh` + LCC `xengecqvemvfknjvbvrq` 2026-06-30)

The Decision Center asks "who really owns this property?" in **five+ separate
lanes** that heavily overlap. An operator works the same property's ownership
question in three places with three different verdicts. Live counts:

| Lane / source | Count | Signal |
|---|---|---|
| Suspected unrecorded sales (`gov.v_suspected_sale`) | 939 (935 props) | GSA/state **lessor name** changed |
| Owner vs deed (`gov.v_owner_source_conflict`) | 887 | recorded owner ≠ **deed grantee** — 562 real `deed_newer_stale` ($951M rent) + **325 `spe_vs_parent` keep-noise** |
| Pending updates → ownership_discrepancy (`gov.pending_updates`, `field_name='recorded_owner_id'`) | 1,098 props | recorded-owner **discrepancy** |
| Research tasks (LCC `research_tasks`, queued) | ~2,650 | `property_missing_recorded_owner` 1,168 · `true_owner_needs_salesforce` 832 · `establish_ownership_history` 639 · `trace_ownership_to_developer` |

**The overlap is the problem.** The three *conflict* lanes cover only **2,035
distinct properties but surface as 2,924 rows** — **808 properties are in both**
pending-discrepancy AND owner-vs-deed. Plus each lane carries dilution:
`spe_vs_parent` (325, default-KEEP, not a conflict), stale >5y (246 of the
suspected set, back to 2013), no-rent (92 state lessor rows), and the SF-auto-
created-property-verify (597) + property-link (~500) rows mixed into
`pending_updates` are a *different* concern entirely.

**Also:** the R51 gated deed-grantee autofix is OFF — only **1 of 562**
`deed_newer_stale` rows is `auto_fixable` today, so 562 high-value "deed grantee
should win" updates sit for manual work.

Scott's decision (2026-06-30): **consolidate into ONE property-keyed "Resolve
ownership" surface.** This is the Consumption-Layer doctrine applied at
Decision-Center scale: one property = one ownership card = one verdict,
value-ranked, deduped, honest count.

## Target model — the "Resolve ownership" surface

**One card per property.** Each card reconciles ALL available ownership signals
for that property and presents a single recommended action:

- **Property context:** address, agency/tenant, **annual rent** (value rank).
- **Ownership state:** `current_recorded_owner` → `proposed_owner` (the best
  candidate across the signals), with an **evidence list** showing which
  signals fired (`deed_grantee`, `lessor_change: <old> → <new>`,
  `discrepancy`, `missing_owner`) + the most-recent signal date.
- **One recommended action**, chosen by evidence strength:
  - `auto_update` — a deed grantee (or corroborated lessor) that passes the
    owner guards, is newer than the recorded owner, high confidence → apply the
    recorded-owner update (the R51 `gov_apply_manual_true_owner` / owner-deed
    write-back path). The high-confidence subset auto-applies (Phase 2).
  - `confirm` — a lessor change / discrepancy that needs human judgment (and,
    optionally, a price to record the suspected sale via
    `gov_confirm_suspected_sale`).
  - `enrich` — recorded/true owner missing → the research-task step
    (`property_missing_recorded_owner` / `true_owner_needs_salesforce`).
  - `keep` — recorded owner already equals the resolved true-owner parent
    (`spe_vs_parent`) → **excluded from the worklist** (not a conflict).
- **Value-ranked** by rent desc, **recency-aware** (fresh ≤3y first; stale >5y
  ranked last or a separate "backfill history" view — still valid ownership
  history, just not a hot "act now" trigger).
- **Honest count** = distinct properties with a real open ownership question
  (≈2,035 minus the `keep`/stale set), NOT 2,924 lane rows.

## Phase 0 — the reconciling gov view `v_ownership_resolution`

Build (gov, additive, SECURITY INVOKER, names-only PII posture like the sibling
`v_*` views) `v_ownership_resolution`: **one row per gov property** that has an
open ownership question, UNION-reconciling the three signal sources and
deduping by `property_id`. Columns (at least):
`property_id, address, city, state, agency, annual_rent` (join
`properties.gross_rent` so EVERY row has a consistent rank value),
`current_recorded_owner_name, proposed_owner_name, evidence` (jsonb array of the
firing signals), `primary_signal, most_recent_signal_date, recency_band`
(`fresh`/`stale`), `recommended_action` (`auto_update|confirm|enrich|keep`),
`owner_guards_pass` (grantee passes brokerage/federal/junk guards),
`is_newer_than_recorded`.
- **EXCLUDE `spe_vs_parent`** (recorded owner already = resolved parent) from the
  worklist — it's the expected SPE relationship, not a conflict.
- Resolve `recommended_action` per the strength ladder above (deed grantee that
  passes guards + is newer ⇒ `auto_update`; lessor-change/discrepancy ⇒
  `confirm`; missing owner ⇒ `enrich`).
- Reuse the existing evidence sources — do NOT re-derive: pull deed-grantee from
  the `v_owner_source_conflict` logic, lessor-change from `v_suspected_sale`,
  discrepancy from `pending_updates`. Prefer a deed grantee (recorded evidence)
  over a lessor-name change (lease evidence) over a bare discrepancy when
  choosing `proposed_owner`.
- Add a sibling `v_ownership_resolution_counts` for the honest lane count
  (distinct properties by `recommended_action` + recency).

## Phase 1 — LCC Decision Center: replace three lanes with one

In `admin.js` (`FEDERATED_DECISION_TYPES` / `fetchFederatedSource` /
`federatedSubjectRef`) + `ops.js`:
- **Add ONE lane** `resolve_ownership` reading `gov.v_ownership_resolution`,
  value-ranked by `annual_rent DESC NULLS LAST`, fresh before stale, honest
  count from `v_ownership_resolution_counts`, top-N + "show all" (incl. the
  stale tail).
- **Retire the three overlapping lanes** from the Decision Center surface:
  `suspected_sale`, `owner_source_conflict`, and the `ownership_discrepancy`
  slice of `pending_update`. (Keep the OTHER `pending_updates` reasons — the 597
  SF-auto-created-property verify + the ~500 property-link matching — in their
  own separate lane; that's a distinct data-hygiene concern, do NOT fold it in.)
- **Card:** property · current owner → proposed owner · evidence chips · rent ·
  recency. **Verdicts (one set):** `Update owner →` (apply the proposed owner via
  the existing gov write-back), `Confirm sale →` (optional price →
  `gov_confirm_suspected_sale`), `Keep` (record not-a-change), `Research`.
  Effect-first / outcome-truthful (a failed write keeps the card open + records
  the failure). `subject_ref` keyed on `property_id` so one property = one
  decision (idempotent, dedups the 808 double-counts by construction).

## Phase 2 — turn on the gated high-confidence autofix (drain the easy 562)

The `auto_update` subset (deed grantee passes guards + newer + high confidence)
should auto-apply so humans only see judgment calls. Enable the R51
`DECISION_OWNER_DEED_WINS` path **after a GET dry-run** (`owner-deed-autofix`)
confirms the set: run the dry-run, eyeball the before/after, then apply. The
recommended-action ladder in Phase 0 IS the auto-subset predicate — keep them in
sync. Reversible (the gov write-back is logged + reversible per R51/R53).

## Phase 3 (optional, can defer) — fold the research-task ownership steps

The queued `property_missing_recorded_owner` (1,168) /
`true_owner_needs_salesforce` (832) / `establish_ownership_history` (639) tasks
are the `enrich` continuation of the SAME question — surface them as the
"enrich" tail of the resolve-ownership surface (a property with no recorded
owner is the same worklist, one step earlier), not as separate peer lanes.
Already value-gated by R60. Defer if Phase 0-2 is enough for now.

## Boundaries / verify

- gov: one additive reconciling view (+ counts view), no domain-row writes in the
  view; LCC: `admin.js` + `ops.js` lane consolidation, no new api/*.js (stays
  12); reuse the existing gov write-backs (`gov_apply_manual_true_owner`,
  `gov_confirm_suspected_sale`) + the R51 autofix — do NOT build new write paths.
- **Verify (live, read-only first):** `v_ownership_resolution` distinct-property
  count ≈ 2,035 minus keep/stale (NOT 2,924); a spot property that today appears
  in both pending-discrepancy AND owner-vs-deed shows as ONE card; `spe_vs_parent`
  properties are excluded; the lane is rent-ranked with fresh-before-stale; the
  three old lanes are gone from the badge; the autofix dry-run lists the
  high-confidence subset before any apply.
- `node --check` (admin.js, ops.js); suite green; a test asserting the unified
  lane dedups a property present in ≥2 source signals to one card, excludes
  `spe_vs_parent`, and ranks by rent.

## Documentation

Update CLAUDE.md (Decision Center): the suspected-sale / owner-vs-deed /
pending-ownership-discrepancy lanes are consolidated into ONE property-keyed
`resolve_ownership` surface (`gov.v_ownership_resolution`) — one card per
property reconciling all ownership signals, one verdict, value-ranked,
recency-aware, `spe_vs_parent` excluded, honest distinct-property count; the
high-confidence deed-grantee subset auto-applies via the (now-enabled) R51
autofix; the SF-auto-property + property-link `pending_updates` reasons stay in
their own hygiene lane. Consumption-Layer consolidation.

## Bottom line

Five lanes ask one question and triple-count 808 properties. Reconcile every
ownership signal per property into ONE value-ranked card with one verdict, drop
the SPE keep-noise and stale tail, auto-apply the high-confidence deed updates,
and the ~2,900 fragmented rows collapse to ~2,035 real, deduped, decidable
ownership decisions — the single most impactful Decision-Center cleanup, and it
directly advances the true-ownership-middle goal.
