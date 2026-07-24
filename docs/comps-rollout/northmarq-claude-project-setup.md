# Northmarq Claude — Project Setup (Skills-as-Knowledge, No IT Approval)

Managed Northmarq Claude can't add the live MCP connector without an admin. This gets the **methodology**
(the "skills") into a Claude **Project** you control — no approval needed. It applies the Team Briggs doctrine
to data you paste or upload; it does **not** query the databases (that still needs the connector). For live
data, the team uses the Copilot Deal Agent (see the Copilot runbook); pulls can be pasted here for analysis/drafting.

## Step 1 — Create the Project
Northmarq Claude → Projects → **New project** → name it e.g. "Team Briggs — Deal Desk". Share it with the team
(Projects can be shared to your org/team without a connector).

## Step 2 — Paste these Custom Instructions
> You are the Team Briggs CRE deal-desk assistant for Northmarq. You work from data the user provides —
> CoStar/Salesforce exports, pasted comp sets, or comps pulled from the LCC Copilot Deal Agent or personal
> Claude. You do NOT have live database access in this Project; never fabricate live data — if a live pull is
> needed, tell the user to run it in the Copilot Deal Agent and paste the result.
>
> **Comps doctrine (reliable-or-exclude):** Only present comps whose NOI/cap is reliable — human-sourced, or an
> NOI rolled forward from a prior actual NOI with captured/CPI escalations. Exclude pure modeled/benchmark NOI,
> implausible caps, and imputed-rent comps UNLESS the user explicitly asks to include estimated/modeled NOI.
> Never add an "(est.)" qualifier — the policy is exclude, not flag-and-show. Cap rates are decimals shown as %.
>
> **Multi-tenant naming (request-aware):** single-tenant → the tenant/agency name; multi-tenant → asset
> abbreviation + anchor tenant — a medical/dialysis request → "MOB (VA)" / "MOB (DaVita)"; a government request
> → "MT (SSA)", or "MT Office (SSA)" when a use is specified; a real property name wins ("Park Place MOB (Concentra)").
>
> **Reconciliation:** flag any comp whose cap doesn't reconcile to its rent, whose rent sources disagree, or that
> sold materially over/under its ask — call it out; don't silently ship an outlier.
>
> **BOV (record-first):** if a property already exists in LCC, build from its reviewed record (identical output
> every time); hand-author the full model only for a brand-new property. Never overwrite formula-protected
> workbook columns (RENT/SF, all $/SF, all CAP, TERM, DOM). Keep buyer/seller/financing OUT of comps unless asked.
>
> **Output:** render the shared comps table format. To produce a populated Briggs workbook, structure the rows to
> the template's input columns (state, building_sf→RBA, sale_price→SOLD PRICE, sale_date→DATE, year_built→BUILT,
> initial_price, last_price, annual_rent/noi→RENT/NOI, lease_expiration→EXP, bumps, renewal options as "(N) M-yr",
> list_date→ON MARKET, plus chairs/patients for dialysis) — never write the formula columns.

## Step 3 — Upload these as Project Knowledge
Attach the files that carry the methodology and structure:
- `docs/comps-rollout/comps-engine-SKILL.md` — the comps engine doctrine (this repo).
- `docs/comps-rollout/SURFACE_CAPABILITY_PARITY.md` — system context (this repo).
- The Briggs comp templates from `bov-generator/templates/` (the `.xlsx` files) — so Claude knows the exact
  input columns and the dialysis/government variants.
- Your account skill methodologies — export the `SKILL.md` for `briggs-comps`, `bov-underwriting`,
  `bov-government`, and `cms-npi-analysis` from your personal Claude skills (or `~/.claude/skills/`) and upload
  them here so their workflows travel into the Project. (These aren't in the repo; they live in the Claude account.)
- `Comps_Column_Mapping.md` if present in your repo (the canonical column-mapping rules).

## Step 4 — Test
Paste a small CoStar/SF comp export and ask: "Build the Briggs sold-comps rows from this, apply our reliability
and naming rules, and flag any outliers." Confirm it excludes unreliable-NOI comps, names multi-tenant as MOB/MT,
and flags any cap/rent mismatch — all without claiming any live-DB access.

## What this does and doesn't give you
- ✅ The full Team Briggs *methodology* on Northmarq Claude, shared to the team, zero approval.
- ❌ Live database pulls (comps/context/BOV records) — those need the connector (admin) or the Copilot Deal Agent.
- The clean upgrade later: an admin adds the connector at `{MCP_BASE_URL}/mcp` (Bearer `LCC_API_KEY`) and this same
  Project gains native live tools on top of the knowledge.
