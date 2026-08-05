# Comps Pipeline — Gap Audit (2026-08-05)

> **STATUS 2026-08-05 — CLOSED.** Every gap mapped below is fixed and live end-to-end. Fixes landed across prompts
> 36–53: single renderer + conformance (36/37/48), OAuth connector (33/38), national subject-anchored selection
> (39/49), on-market enrichment (40), recency/field-standardization + operator-as-similarity (41/52), data-quality
> gates (42), template OPTIONS/auto-fit + post-recalc width contract (43/48), 25-best/rescore/bumps (44), price-
> adjustment recovery (45), closed-sale propagation from `available_listings` (50), same-address duplicate-record
> consolidation (51). `generate_comps` verified live: no conformance 500, subject 31964 hydrated + excluded on
> every phrasing, all operators, displayed-cap ranking with cap discipline. Canon v1.4.0 documents the policy.
> Open (non-blocking): 269 E Caroline review-lane decision; prompt-50 review lane (57 rows); cosmetic `subject.kind`.


Why: the same request ("comps for The Villages") produced different, wrong outputs across attempts — Florida-only
selection, threadbare on-market rows, and format drift. This maps the whole pipeline and root-causes each gap in
the CODE (not just agent behavior), so fixes land at the source. Anchor subject: **DaVita — The Villages, FL**,
`1050 Old Camp Rd`, 6,453 SF, 12 chairs, ~18 patients, listed $3.05M @ 6.75% (Team Briggs listing).

## Pipeline stages
subject resolution → **candidate pull** → similarity scoring → reliability/cap discipline →
**on-market enrichment** → dedup → render (template) → conformance → surface parity.

## Findings

### F1 — SELECTION is region-bounded, not national (the big one)  → Prompt 39
`scoreComp` (mcp/comps-tools.js) already ranks nationally by market, size, chairs, cap spread, and PENALIZES caps
>2% above subject (the appraisal-support rule). But it never receives national candidates:
- `parseRequest` adds `subject.state` as a filter unless the text says "national/nationwide" (~line 555).
- `queryScopeArgs` → `appraisalCandidateStates(subject)` sets the DB pull `p_states` = subject state + REGION only
  (~lines 378, 171). So for The Villages the SQL pull is FL + Southeast; national best-matches never enter the set.
**Root cause:** geography is applied as a PULL FILTER, not (as intended) a SCORE BOOST. **Fix:** in appraisal mode
pull national (`p_states = null`) with a larger candidate cap, and let `scoreComp` rank; keep state/metro as score
weight only. Add explicit similarity weights for the dimensions we actually underwrite (below).

### F2 — ON-MARKET rows aren't enriched to the full record  → Prompt 40
On-market/available comps flow from the listings path (`available_listings` → thin `v_dia_on_market`: tenant,
address, price, cap, date only). They are NOT joined to the property + active-lease record, so LAND, BUILT, EXP,
TERM, EXPENSES, BUMPS, RENEWAL OPTIONS (and often CHAIRS/PATIENTS) come back blank — exactly the missing-data
seen in the deliverable. **Fix:** enrich the on-market pull to the same record depth as sold (join properties +
current lease), so an on-market comp carries every column the Sold sheet does.

### F3 — Multiple renderers / hand-rolling  → Prompt 36 (existing)
One correct renderer exists (`comps_generator.populate_comps` → canonical template, header-driven, trims to
AVG/TOTALS). Divergence came from hand-rolled fallbacks when `generate_comps` was unreachable. Fix: mandate the
single renderer + a documented local `populate_comps` fallback; never hand-author a layout.

### F4 — Template drift + no conformance gate  → Prompt 37 (existing)
Blank template lives in several copies that can drift; nothing validates a produced workbook. Fix: single-source
`bov-generator/templates/`; add a conformance validator (canonical sheets/headers, formula columns intact,
trim applied, 0 recalc errors) wired into the export path.

### F5 — Connector still errors after MCP_BASE_URL set  → Prompt 38 (existing)
Deep-diagnose the exact failing hop (well-known metadata / register / authorize→token / mcp initialize).

## Appraisal ranking spec (the north star for F1)
Rank ALL national dialysis sold + on-market comps against the subject by, in priority:
1. **Aligned market** — metro/region proximity as a weight (never a hard filter).
2. **Lease term remaining AT CLOSE** — proximity to subject's remaining term at its sale date.
3. **Tenant credit / operator** — DaVita / Fresenius(FMC) / independent tiers; same-operator scores highest.
4. **Building age** (year built) and **size** (RBA + chairs) proximity.
5. **Bump / escalation structure** similarity.
6. **Cap & price that SUPPORT the subject** — down-weight/penalize comps with caps materially above subject
   (>~200 bps) or values below; never present a set whose weighted cap exceeds the subject basis (existing rule,
   keep + strengthen). Truncate to ~20–25 primary sold + all aligned on-market.

## Priority order
F1 (selection) and F2 (on-market data) are the substance — they decide whether the comps are RIGHT. F3/F4 make
the output uniform; F5 makes the engine reachable. Do F1+F2 first.
