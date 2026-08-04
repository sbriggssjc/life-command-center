---
name: comps-engine
description: >
  Pull, synthesize, and export unified CRE sales comps for Team Briggs from the live dialysis + government
  databases and Salesforce-staged comps. Use whenever Scott asks for comps, comparable sales, a cap-rate set,
  or a comps workbook for medical office / dialysis / government-tenanted properties — e.g. "pull DaVita comps
  in Texas," "government medical office comps last 12 months," "build a comps workbook for this deal." Wraps the
  MCP tools query_comps, synthesize_comps, and generate_comps with the Team Briggs reliability, naming, and
  reconciliation policies. Distinct from briggs-comps (which maps a raw CoStar/Salesforce EXPORT into the
  template) — this skill pulls comps straight from the databases.
---

# Comps Engine

One shared engine (dialysis DB + government DB + Salesforce staging), normalized and de-duplicated, exposed
through three MCP tools. Every surface (Claude, Copilot, ChatGPT) inherits the same rules, so results never diverge.

## Which tool
- **synthesize_comps** — DEFAULT for a plain-language request. Pass the raw text as `request`; it parses
  states, property/place anchors, property types, operator lists, date window, appraisal/full-set intent, and
  government intent, routes, scores by subject similarity, and returns the ranked set. Add explicit fields only
  to override the parse. **Never invent a tenant/metro/state/date filter the user didn't state** — pre-narrowing collapses the set; the engine expands from the subject.
- **query_comps** — when you already have structured filters (states, property_types, verticals, tenant, dates,
  size, limit). Same output shape, no relevance scoring.
- **generate_comps** — build the populated Briggs Excel workbook. **For an appraisal / full-set / workbook
  request, call it with `request` = the raw text** — the server runs synthesize + build in one pass and returns
  only a download link + counts (the 20-30 rows never round-trip the model/connector). For a small curated set
  you can instead pass the rows (see Export).

## Non-negotiable policies (already enforced by the engine — don't fight them)
- **Appraisal/full-set mode.** Requests like "I need dialysis comps for The Villages," "for the appraiser,"
  "valuation," "under contract," "OM/BOV support," or "comp package" trigger appraisal mode. For dialysis this
  means all operators (`tenant` null), sold + active listings, estimated-NOI comps included with review flags,
  a larger candidate pull, and final ranking by similarity before truncation to roughly 20-30 comps.
- **Reliable-or-exclude for quick lookups.** Non-appraisal quick lookups still return only comps with a reliable
  NOI/cap by default: human-sourced, or an NOI rolled forward from a prior actual NOI with captured (or
  CPI-modeled) escalations. Pure benchmark-modeled NOI, implausible caps, and imputed-rent comps are excluded
  unless the request says "including estimated/modeled NOI," "without NOI," or "all comps," or appraisal mode
  applies.
- **Operators are lists.** If the user names multiple operators (DaVita and Fresenius, US Renal + DCI, etc.),
  preserve them as an operator list; never pass a comma-separated blob as one tenant. "All operators" means no
  tenant filter.
- **NOI/rent basis is the same for dialysis and government.** Cap rates are decimals (0.0745 = 7.45%).
- **Multi-tenant naming is request-aware.** Single-tenant → the tenant/agency name. Multi-tenant → asset
  abbreviation + anchor tenant: a medical/dialysis request → `MOB (VA)` / `MOB (DaVita)`; a government request →
  `MT (SSA)`, or `MT Office (SSA)` when a use is specified; a real property name wins (`Park Place MOB (Concentra)`).
  The engine sets this on `tenant`/`agency` — use it as returned.
- **Government-only requests never hit the dialysis DB** (keeps private DaVita/US Renal comps out of a gov set).
  Dialysis/operator requests route to dialysis. Bare medical requests can remain multi-vertical.

## Reconciliation flags — surface them
Each pull returns `meta.flagged_for_review` + `meta.review_flags`. A flagged comp still appears, but its cap/rent
didn't reconcile (`cap_mismatch` = computed cap vs reliable cap >75 bps; `rent_disagreement` = rent sources
disagree >10%; `price_over_ask` = sold materially over/under the linked ask). When presenting comps, mention the
flagged count and, for a small set, which comps and why — these are routed to the dialysis review queue for
correction, so an outlier in the set is a known-and-tracked item, not a silent error.

## Reading the output
`comps[]` (normalized, cap rates decimal, `price_withheld` for confidential $0 sales, dialysis carries
`chairs`/`patient_count`, each row carries `score_tier` A/B/C when synthesized), `template_comps[]` in the
Team Briggs export shape, `subject` (resolved fields or "Not on file"), `summary` (one-paragraph methodology and
cap-rate observations), `transparency` (`returned N of M...` with estimated-NOI/truncation notes when relevant),
`meta` (returned, total_before_cap/candidate_total, flagged_for_review, review_flags, excluded_unreliable_noi,
by_source, warnings, interpreted_params), and `markdown` (the ready-to-show table — prefer rendering this).

## Export to the Briggs workbook (generate_comps)
**One-shot — the default for an appraisal or ANY workbook of ~20+ comps:** call `generate_comps` with
`request` = Scott's text (plus `comp_type`/`vertical`). The server synthesizes + builds server-side and returns
`{ download_url, counts, cap_rate_range, tiers, flagged_count, subject }` — deliver the link. Do NOT pass 20-30
rows back through the model; they truncate on ChatGPT (45k) and overflow Copilot (SystemError).

**Two-step — small curated sets only:** map each comp to a row and call generate_comps (`comp_type: "sales"`; `vertical: "dialysis"` selects the
CHAIRS/PATIENTS template; government comps route to the government template automatically). **Use the engine's
own field names** — they map straight through: `state`, `building_sf`→RBA, `sale_price`→SOLD PRICE,
`sale_date`→DATE, `year_built`→BUILT, `initial_price`, `last_price`, `annual_rent`/`noi`→RENT/NOI,
`lease_expiration`→EXP, `bumps`, renewal options, `list_date`→ON MARKET (drives DOM), plus `chairs`/`patients`.
Include `land` and `list_date` — they're easy to forget and leave LAND/ON MARKET/DOM blank. Renewal options use
the standard `(N) M-yr` form. Never write the formula-protected columns (RENT/SF, all $/SF, all CAP, TERM, DOM) —
the template computes them. `buyer`, `seller`, and `financing` stay OUT unless Scott explicitly asks for them.
Check the response: `unknown_keys` should be empty and `recalc_errors` 0; then deliver the .xlsx.

## Endpoints (for reference)
MCP: `{MCP_BASE_URL}/mcp` (Bearer LCC_API_KEY). HTTP mirrors for non-Claude surfaces:
`{MCP_BASE_URL}/api/query-comps`, `/api/synthesize-comps`. generate_comps builds on the BOV service.
