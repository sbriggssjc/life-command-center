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
  states, property types, tenant, date window, and government intent, routes, scores by relevance, returns the
  ranked set. Add explicit fields only to override the parse.
- **query_comps** — when you already have structured filters (states, property_types, verticals, tenant, dates,
  size, limit). Same output shape, no relevance scoring.
- **generate_comps** — build the populated Briggs Excel workbook from comp rows (see Export below).

## Non-negotiable policies (already enforced by the engine — don't fight them)
- **Reliable-or-exclude.** By default only comps with a reliable NOI/cap are returned: human-sourced, or an NOI
  rolled forward from a prior actual NOI with captured (or CPI-modeled) escalations. Pure benchmark-modeled NOI,
  implausible caps, and imputed-rent comps are excluded. Only pass `include_unreliable_noi: true` if Scott
  explicitly asks for comps "including estimated/modeled NOI," "without NOI," or "all comps." Never add an
  "(est.)" qualifier — policy is reliable-or-exclude, not flag-and-show.
- **NOI/rent basis is the same for dialysis and government.** Cap rates are decimals (0.0745 = 7.45%).
- **Multi-tenant naming is request-aware.** Single-tenant → the tenant/agency name. Multi-tenant → asset
  abbreviation + anchor tenant: a medical/dialysis request → `MOB (VA)` / `MOB (DaVita)`; a government request →
  `MT (SSA)`, or `MT Office (SSA)` when a use is specified; a real property name wins (`Park Place MOB (Concentra)`).
  The engine sets this on `tenant`/`agency` — use it as returned.
- **Government-only requests never hit the dialysis DB** (keeps private DaVita/US Renal comps out of a gov set).

## Reconciliation flags — surface them
Each pull returns `meta.flagged_for_review` + `meta.review_flags`. A flagged comp still appears, but its cap/rent
didn't reconcile (`cap_mismatch` = computed cap vs reliable cap >75 bps; `rent_disagreement` = rent sources
disagree >10%; `price_over_ask` = sold materially over/under the linked ask). When presenting comps, mention the
flagged count and, for a small set, which comps and why — these are routed to the dialysis review queue for
correction, so an outlier in the set is a known-and-tracked item, not a silent error.

## Reading the output
`comps[]` (normalized, cap rates decimal, `price_withheld` for confidential $0 sales, dialysis carries
`chairs`/`patient_count`), `meta` (returned, total_before_cap, flagged_for_review, review_flags,
excluded_unreliable_noi, by_source, warnings, interpreted_params), and `markdown` (the ready-to-show table —
prefer rendering this).

## Export to the Briggs workbook (generate_comps)
Map each comp to a row and call generate_comps (`comp_type: "sales"`; `vertical: "dialysis"` selects the
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
