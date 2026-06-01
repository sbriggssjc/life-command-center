# Claude Code prompt — build Federal/State/Municipal agency-tier classification + propagation

> Copy everything inside the fenced block into a new Claude Code session opened in the
> **GovernmentProject** repo (the codebase for the government Capital Markets data).

```
Build a 3-tier (Federal / State / Municipal) government-agency classification and
propagation system so sales and tenancy records get an accurate, auditable
`government_type` — instead of a regex buried in a chart view. Use the existing
infrastructure; do not reinvent it.

## Environment
- Supabase project "government", ref `scknotsqkcheojiaewwh`, schema `public`. Use the
  Supabase MCP / CLI. Put schema changes in this repo's `supabase/migrations/`.
- Follow this repo's git rules (feature branch off origin/main, PR, copy/paste merge
  + test commands at the end). Never commit secrets.

## Context (read before coding)
- `sales_transactions` has free-text `agency` (e.g. "GSA - Social Security Admin",
  "State of Texas", "Fairfax County Government", "City of El Paso") and a `government_type`
  text field (Federal/State/Municipal/Local), populated on ~975 of ~2,474 cap-eligible
  sales — almost all Federal.
- This is a ~95% FEDERAL-leased portfolio (GSA/SSA/FBI/DEA/IRS/VA/USPS…). Real State
  (~14–24) and Municipal (~33) deals are genuinely rare. GOAL = accurate, propagated,
  auditable labels — NOT inflating the state/municipal tiers.

## Existing infrastructure to build ON (verify each before changing)
- `government_agencies` (agency_id uuid, code, full_name, government_type, parent_agency,
  cabinet_department, credit_rating, typical_lease_term, typical_lease_type,
  mission_critical, active, notes). Currently 46 rows, ALL government_type='Federal'. This
  is the canonical agency→tier reference.
- `broker_enrichment_rules` (rule_id, partial_name, full_name, firm_name, enriched_label,
  confidence, match_method, evidence, …) — a WORKING pattern→label rule engine. Mirror
  this design for agencies.
- `field_value_provenance` (provenance_id, table_name, record_id, field_name,
  authority_source, authority_rank, last_change_event_id, last_confirmed_at,
  manual_override, …) + `provenance_event_log` — the authority/propagation layer. Write
  every classification decision here; a row with manual_override=true must ALWAYS win.
- `frpp_records` (reporting_agency, using_agency, state_code, …) — Federal Real Property
  Profile, federal-only — can corroborate Federal labels.

## Tasks
1. Extend `government_agencies` into a true 3-tier reference. Keep the 46 Federal rows.
   Seed common STATE agencies (Dept of Revenue / Labor / Health / Family & Protective
   Services / Administration, DMV, State Police, State University systems, State
   Properties Commission, Commonwealth of …) and MUNICIPAL patterns (County of X / City
   of X / Town / Village / Borough / Sheriff / Public Works / Council of Governments /
   Public Schools), each tagged government_type='State' or 'Municipal'.
2. Create `agency_enrichment_rules` mirroring `broker_enrichment_rules`:
   (rule_id, pattern text, match_method text [exact|ilike|regex], tier text
   [Federal|State|Municipal], confidence numeric, evidence text, priority int,
   active bool). Seed it from the validated classifier below. Federal rules MUST evaluate
   before State/Municipal (so "U.S. Department of Labor" stays Federal). Add explicit
   NON-GOVERNMENT exclusion rules (Fresenius, %LLC, %Inc, Amazon, Aramark, Regus,
   Restoration Hardware, Northrop Grumman, realtors) → leave NULL (not classified).
3. Build a pure function `gov_classify_agency(agency text) returns text` (Federal/State/
   Municipal/NULL) that resolves via: (a) exact/ILIKE match to
   government_agencies.full_name or code, else (b) agency_enrichment_rules by priority,
   else NULL. Make it unit-testable.
4. Backfill `sales_transactions.government_type = gov_classify_agency(agency)` ONLY where
   the current value is null OR not a manual override. For every write, insert a
   `field_value_provenance` row (authority_source='agency_classifier') and NEVER overwrite
   a manual_override=true value.
5. Wire it into ingestion: find the gov-sales upsert writers (OM-intake pipeline and the
   CoStar-sidebar pipeline) and call `gov_classify_agency()` to set government_type at
   write time, recording provenance, so new sales are labeled automatically.
6. Simplify `cm_gov_cap_by_credit_q` to read `government_type` directly (drop the inline
   regex — it becomes redundant once the field is authoritative). Map 'Local' → 'Municipal'.
   Keep the existing output columns (period_end, subspecialty, federal_cap, state_cap,
   municipal_cap) and the TTM-quarterly structure + n-gates (federal n>=3, state/muni n>=2).
7. Verify and report: tier distribution before vs after; spot-checks — "U.S. Department of
   Labor"→Federal, "General Services Administration"→Federal, "State of Texas"→State,
   "Fairfax County Government"→Municipal, "Fresenius Medical Care"→NULL; confirm the
   municipal line renders in cm_gov_cap_by_credit_q and that NO manual_override rows were
   clobbered.

## Validated classifier logic to seed agency_enrichment_rules (from 2026-06-01)
Evaluate in this order (Federal first), all case-insensitive regex on `agency`:
- Federal: u\.?s\.?  | united states | ^gsa | \mgsa\M | general services admin | federal |
  national | department of (defense|justice|energy|labor|transportation|veterans|homeland|
  the treasury) | veterans | \mva\M | va clinic | va outpatient | va medical | homeland |
  treasury | \mfbi\M | \mirs\M | \musda\M | \musgs\M | \musps\M | postal | social security |
  \mssa\M | customs | immigration | \mice\M | \muscis\M | \mcbp\M | \mepa\M | \mfda\M |
  \mdea\M | drug enforcement | \mdoj\M | \mdod\M | \mdhs\M | \matf\M | \mblm\M | \mnps\M |
  \mfws\M | \mmsha\M | \maoc\M | \mfec\M | \mnoaa\M | oceanic and atmospheric |
  forest service | army | navy | naval | air force | coast guard | border patrol |
  bureau of | military entrance | \mmeps\M | \mosha\M | courthouse |
  substance abuse and mental health | field office
- Municipal: county of | \mcounty\M | city of | \mcity\M | town of | village of |
  borough of | municipal | public schools | metropolitan | council of governments |
  sheriff | public works
- State: state of | commonwealth of | district of columbia | department of
  (administration|family|protective|child support|corrections|revenue) | state properties |
  \mstate\M | board of cooperative
- Also honor `government_type` when already present on the row: 'municipal'/'local'→Municipal,
  'state'→State, 'federal'→Federal (these come before the agency regex).

## Constraints / non-goals
- NEVER clobber a hand-entered (manual_override) government_type.
- This is a federal-dominated dataset: the deliverable is ACCURACY + a clean municipal
  line, not large state/municipal volume. Note in the PR that growing those tiers requires
  ingesting more state/local comps.
- There is currently NO state/municipal ingestion source (FRPP/OPM are federal only). The
  government_agencies seed list IS the new state/municipal reference — keep it maintainable
  (one migration, well-commented, easy to append to).
```
