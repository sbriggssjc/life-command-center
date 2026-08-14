# Prompt 106 — property_twin lane: deterministic pre-rank + Ollama assist (annotation-only)

Grounding (read first): CLAUDE.md §"dia property 'address twins' — Decision Center lane property_twin", the
dia RPCs `dia_find_property_twins` / `dia_merge_property_reversible` / `dia_unmerge_property` +
`dia_property_twin_review` (project `zqzrriwuavgrquhisnoa`), the LCC lane wiring in `api/admin.js`
(`FEDERATED_DECISION_TYPES` `property_twin`, `domainQuery` server-mediated), the **W9.3 SF-assist pattern**
(`api/_handlers/` sf-link-assist-tick + `attachSfLinkAssist`/`sfAssistSortKey` + `lcc_clean_assist_proposals`
source `w9_3_sf_assist` — annotation-never-verdict), the Ollama seam `invokeExtractionAI({surface:'clean_assist'})`,
the U1/U2/U5 deterministic-first + verbatim-evidence doctrine, the Producer/Consumer honest-counts rule.

**Doctrine (non-negotiable): the assist ANNOTATES and SORTS the lane — it NEVER merges.** The dia merge
(`dia_merge_property_reversible`) stays human-gated and reversible. The tick writes ONLY the assist store, never
calls a merge RPC, never PATCHes the review row's status (the `annotation-never-verdict` guard from W9.3). This
is speed-up-the-human, not remove-the-human — because **co-located ≠ twin** (a DaVita and a Fresenius share one
plaza; the whole lane exists for that call).

## The pool (grounded live, 2026-08-14, dia)

`dia_property_twin_review` pending ≈ **1,245**: `review_name` 792 (same operator, name variant — usually a TRUE
twin), `review_conflict` 274 (competing operators — usually NOT a twin, the co-located case), `review_ambiguous`
95, `review_blank_far` 84. Each row's `detail` jsonb carries `anchor_tenant`/`shadow_tenant`,
`anchor_operator`/`shadow_operator`, `same_norm_address`, `n_anchors`, plus `distance_miles`. Real examples:
- `review_conflict`: *DaVita Selma Dialysis* (davita) vs *Fresenius East Johnston* (fresenius), same coords,
  `same_norm_address:false` → **distinct co-located** (not a twin).
- `review_name` (typical): same operator, name is a formatting variant (…Dialysis vs …Dialysis Center) → **merge**.
- Genuinely ambiguous: `same_norm_address:true` but different operators → could be an **operator change at one
  facility** (merge) OR two at one address — the human/LLM call.

## Do — two layers, deterministic-first (mirror W9.3 sf-assist)

### 1. Deterministic pre-classifier (NO LLM) — handles the bulk, bulk-confirmable
From the `detail` fields alone, per pending row, compute a `suggest` + `confidence` + a one-line deterministic
reason (all from structured fields, no model):
- **same operator AND high name-core similarity** (reuse the existing name-normalization/similarity helpers —
  grep the dup-pair / naming-hygiene planners first) → `suggest=merge` high-confidence → **one-click bulk-confirmable**.
- **different operator AND `same_norm_address=false`** → `suggest=not_twin` (co-located distinct facility).
- **`same_norm_address=true` with different operators**, `n_anchors>1`, or `review_blank_far` → `suggest=uncertain`
  → hand to the Ollama layer (the genuine judgment residue). NEVER deterministically not_twin an operator-change.

### 2. Ollama assist (annotation-only) for the `uncertain` residue
For the residue only, `invokeExtractionAI({surface:'clean_assist'})` scores each pair `same_facility` /
`distinct_colocated` / `uncertain` + confidence + a **VERBATIM evidence quote** drawn from the `detail` (tenant
names/operators/address flag) — the W7.4/U3 validator: the quote must be a substring of the supplied evidence or
the annotation is dropped (`property_twin_assist_dropped`, the precision floor). No evidence ⇒ no LLM call.
Few-shot the co-located-plaza footgun explicitly (different operator at same coords = distinct, not twin).

### Wiring (reuse, don't fork)
- **Tick** `GET/POST /api/property-twin-assist-tick` (GET dry-run `?score=1&n=`, POST flag-gated apply that
  writes annotations), bounded+cursored over the pending slice (closest-first), per-class + per-suggest counts,
  loud `scan_errors`, budget floor. Reads dia via `domainQuery` (no edge-allowlist change — same server-mediated
  path the lane already uses).
- **Store** the annotation keyed to the dia twin review id (mirror `lcc_clean_assist_proposals` shape/source
  `property_twin_assist`, or a small `lcc_property_twin_assist` table if the lane join is cleaner). Annotation =
  `{suggest, confidence, reason, evidence_quote, layer:'deterministic'|'llm'}`.
- **Lane render** — extend the `property_twin` card (dc-lanes.js) to show the suggestion + confidence + evidence
  and **sort easy-first** (mirror `attachSfLinkAssist`/`sfAssistSortKey`); add a **bulk-confirm for the
  deterministic `merge` suggestions only** (never bulk the LLM/uncertain cards) — mirror `dcFedBulkHygieneRenames`.
- **Flag** `PROPERTY_TWIN_ASSIST` OFF in-migration (register in `feature_flags_registry`); nightly cron staggered
  after the existing chain; no-ops while OFF. **No fsp rows** (annotation store, not a curated-field write).
- **Self-measure** (optional, W9.3 style): record assist-verdict vs the human's actual merge/not_twin verdict so
  we track agreement over time → U4.

## Acceptance
- `GET /api/property-twin-assist-tick?score=1&n=20`: per-class counts; a sampled sheet where deterministic
  `merge`/`not_twin` suggestions carry a structured reason and LLM `uncertain` cards carry a verbatim quote;
  `scan_errors:[]`. Honest counts (how many bulk-confirmable vs how many need eyes).
- The `property_twin` lane sorts easy-first and shows the suggestion; deterministic merges are bulk-confirmable;
  the merge RPC is still only called by a HUMAN verdict (assert the tick never calls it — structural test).
- Tests: deterministic classifier (same-op-merge / diff-op-not_twin / same-address-uncertain), verbatim validator
  on the LLM layer, annotation-never-verdict guard, cursor/bounded, flag-off + staggered cron, co-located footgun
  fixture (DaVita vs Fresenius same coords → NOT auto-merged, routed uncertain/not_twin).
- Docs: a property_twin section in ROLLOUT_STATUS (or a short kickoff) + STATUS entry; prompt → done/.

Operator flow: redeploy → `?score=1` review → Cowork flips `PROPERTY_TWIN_ASSIST` → the lane fills with
sorted, pre-ranked twins so Scott clears the 792 same-operator merges fast and spends judgment only on the
conflict/ambiguous residue. Commit with the repo Co-Authored-By + Claude-Session trailer. One PR.
