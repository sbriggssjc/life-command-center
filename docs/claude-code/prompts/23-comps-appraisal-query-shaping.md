# Prompt 23 — Make the comps engine robustly interpret plain-language requests and return a consistent, Team-Briggs-quality comp set EVERY time

## Goal (Scott's words)
"These chats should robustly handle all plain-language requests from various users and return the intended
output. If I say 'I need dialysis comps for The Villages,' the chat should understand what I mean, in the output
I want, at the quality and data consistency we prefer — every time."

The durable fix is in the **shared server core** (`mcp/comps-tools.js`: `parseRequest`, `runComps`,
`runSynthesize`, `scoreComp`, the template projection), NOT in per-surface prompt text — because ChatGPT
(HTTP `/api/*`), Copilot (MCP), and Claude (MCP) all call that one core. Fix it once there and every surface
behaves identically. Mirror the same contract in the `comps-engine` skill/agent instructions so the NL guidance
and the engine agree.

## Verified context (don't re-investigate — see docs/comps-rollout/comps-query-shaping-triage-2026-08-03.md)
Dialysis_DB has **3,022 live sold comps (1985–2026, 48 states, 100+ FL)**; `rpc_query_comps` serves them fine.
Agents saw only 3–9 because of engine DEFAULTS/parse gaps, not data: reliability gate on by default, small
default limits + RPC most-recent-first, and `p_tenant` being a single ILIKE (multi-operator string → ~0). This
prompt makes the core interpret intent and apply Team-Briggs defaults so a bare request "just works."

## A. Understand the request (upgrade `parseRequest` + intent detection)
1. **Place/subject resolution — the big one.** A bare place name must resolve to geography and anchor the set.
   - Add a gazetteer so city/metro/neighborhood names map to `state` (+ a canonical metro). "The Villages" →
     FL (Wildwood–The Villages metro). General fallback: resolve any recognizable US city → its state so the
     query is geo-scoped, not empty. Never leave a named place unmapped and silently nationwide.
   - **Subject anchoring:** if the named place matches one of OUR properties/listings (e.g. a Villages, FL asset
     under contract), resolve it as the SUBJECT and pull its attributes (tenant/credit, remaining term, building
     SF, chair count, cap, absolute-NNN vs NNN) to drive similarity ranking + the executive summary. If it's a
     place only, anchor similarity on location + the dialysis asset profile. Render "Not on file" for subject
     fields we don't have — never invent them.
2. **Operators are a LIST, never one ILIKE blob.** Parse operator names (DaVita, Fresenius/FMC, US Renal, DCI,
   American Renal, Satellite, Innovative Renal, DSI, Dialysis Clinic Inc, Renal Ventures, independents) into a
   tenant list; when the user says "all operators" or names none, pass tenant NULL. Fix `p_tenant` (or the
   engine) to accept a list / comma-split so a multi-operator request never collapses to 0–1.
3. **Intent detection → mode.** Recognize appraisal/valuation intent ("for the appraiser," "appraisal," "valuing,"
   "under contract," "OM/BOV support," "comp package") and switch to APPRAISAL MODE (Part C). Recognize
   comp_type ("sold"/"sales" vs "on the market/active/listings" vs "both"), a date window ("last 12 months,"
   "since 2010," "past 5 years"), size/vintage hints, and "including/excluding estimated NOI."
4. **Vertical inference** already exists (dialysis/government/medical). Keep it; ensure "dialysis" and operator
   names force the dialysis vertical, and a bare medical request stays multi-vertical.

## B. Rank by similarity to the subject, THEN cap (fixes recency skew)
Today the RPC caps to the most-recent `p_limit` BEFORE ranking, so big pulls skew recent/national over similar/FL.
- Request a LARGE candidate pool from the RPC (geo/date scoped), then score in JS with `scoreComp` extended to a
  transparent similarity model anchored to the SUBJECT: geography (same metro > same state > Southeast > national),
  tenant/guarantor credit, remaining firm term, absolute-NNN vs NNN, building SF, chair/patient scale, vintage,
  cap-rate proximity, and sale recency — then cap to the target count. Preserve a fast recency-first path for
  non-appraisal quick lookups.
- Emit the score tier (A "nearly identical" / B "very comparable" / C "market support") per comp for the workbook.

## C. Default quality + data-consistency contract (the "every time" preferences)
For a bare/appraisal dialysis request, default to ALL of:
- **Coverage:** sold comps + the best active LISTINGS as competitive comps; **all operators** (tenant NULL);
  **include estimated-NOI comps** (they're most of dialysis) WITH their review flags — do not silently drop them.
- **Geo-tiering:** subject metro → subject state → Southeast → national, weighted in that order, so the set is
  location-weighted but deep enough to reach the target count.
- **Target size:** ~20–30 properties (allow repeat sale events); if the reliable-only subset is small, fill from
  estimated-NOI comps and SAY SO. Never return a tiny set silently.
- **Data consistency (Team Briggs):** cap rate reconciled to our convention (asking = sold when we sold at ask;
  cap derived from the CURRENT contractual rent, not a future step) — reuse the existing reconciliation/
  review-flag logic (`computeReviewSignals`, cap/rent-mismatch flags). Surface conflicts, never smooth them over.
- **No fabrication:** every field is sourced; render "Not on file" / "Derived" / "Conflict" where applicable;
  label each comp's source (dialysis_db / salesforce / CoStar-staged); confidential $0 sales flagged
  price_withheld; buyer/seller omitted by default (appraiser package).

## D. Consistent OUTPUT contract (same shape every time)
`runSynthesize` (and the appraisal path) always returns, ready for the briggs-comps template:
- `template_comps[]` in the canonical Team Briggs column order (protected formula columns preserved — never write
  RENT/SF, CAP RATE, TERM, DOM, PRICE/SF, EFFECTIVE RENT/SF), with chair/patient columns populated for dialysis.
- `subject` block (resolved attributes or "Not on file").
- `summary` (methodology + cap-rate range, median & weighted-avg cap, FL vs national, term/credit observations,
  the 5–10 best value indicators) — a one-paragraph exec summary, no fabricated numbers.
- **Transparency line:** `returned N of M; M-N excluded as estimated-NOI (say 'include estimated NOI' to include)`
  whenever anything was filtered — never silent truncation.
- `review_flags[]` retained. Deterministic ordering (similarity tier, then score) so the same request → same set.

## E. Acceptance tests (worked examples — the engine must produce these intents)
1. **"I need dialysis comps for The Villages."** → dialysis; subject = The Villages, FL (resolve to our asset if
   present); APPRAISAL MODE; all operators; include estimated NOI; sold + active listings; geo-tiered FL→SE→
   national; ~20–30 ranked by similarity with A/B/C tiers; Team Briggs template + exec summary + transparency
   line. Must return a deep FL-weighted set incl. pre-2025 sales — not 3, not only-2026.
2. **"US Renal comps in Texas, last 12 months."** → dialysis; tenant=[US Renal]; states=[TX]; date_from = today-12mo;
   sold; returns all matching US Renal TX sales (not collapsed).
3. **"DaVita and Fresenius sales nationwide since 2018."** → tenant list [DaVita, Fresenius]; both matched (not 0).
4. **"Comps for the appraiser on our Woodland Hills deal."** → resolve subject = our Woodland Hills dialysis asset;
   anchor similarity to it; appraisal package; cap reconciled to our 6.00% convention.
5. **"Government medical-office comps in Texas, last 12 months."** → government vertical; unaffected by dialysis
   defaults; existing behavior preserved.

## Verify
- Each Part E example yields the described interpretation + a full, deterministic, transparently-filtered set.
- Non-appraisal quick lookups still fast + reliable-only by default.
- No DB changes needed for data (3,022 already served); if Part B needs an RPC ordering/param, keep the
  recent-first default for quick pulls. No fabricated fields anywhere; "Not on file" where absent.

## Note
Do NOT "load more comps" — the data is present and served. This is intent-parsing + defaults + ranking +
output-contract work in the shared engine so every surface turns a plain request into the intended, consistent,
Team-Briggs-quality result.
