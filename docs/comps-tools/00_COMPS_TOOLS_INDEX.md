# Comps Tools Workstream — Index

**What this is:** design + build package for two new LCC MCP tools —
`query_comps` (on-demand comps across dialysis DB + government DB + Salesforce-staged comps)
and `synthesize_comps` (plain-language → one ranked, deduped, template-ready comp set).
Started July 2026. Read this first when picking the work back up.

## Current status (2026-07-21)
- **Design:** complete and validated against live schema.
- **SQL:** `rpc_query_comps` written for both verticals, validated read-only (not yet deployed).
- **Tool code:** `query_comps.tool.js` written (not yet wired into `mcp/server.js`).
- **Not yet done:** deploy the two RPCs, wire the tools into server.js, add the LLM parse step for
  `synthesize_comps`, and finish the Comp→canonical promotion (`COMP_FIELD_MAP`) to close the 84% gap.

## Files in this folder
| File | What it is |
|---|---|
| `01_Comps_Tools_Design.md` | Original conceptual design (canonical schema, both tools). Some access-path details superseded by 04. |
| `02_Salesforce_Schema_Intake_Checklist.md` | The intake checklist used to gather the SF schema. |
| `03_Salesforce_Schema_Reference.md` | Human-readable SF object/field/relationship reference. |
| `03_salesforce_schema_catalog.json` | Machine-readable SF catalog (334 objects, 2,818 fields). Source of truth for field API names. |
| `04_Comps_Tools_Revised_Architecture.md` | **Read this** — the two tools re-specified onto the existing SF→LCC crawl + provenance engine. |
| `05_query_comps_BUILD_SPEC.md` | Developer-ready spec: data-source matrix, canonical contract, RPC + tool design, promotion map. |
| `06_Comps_Tools_Validation_2026-07-21.md` | Live validation findings (cap-rate units, dedup case, vocab split, etc.). The gotchas. |
| `rpc_query_comps_government.sql` | Deployable RPC for the `government` project (`scknotsqkcheojiaewwh`). |
| `rpc_query_comps_dialysis.sql` | Deployable RPC for the `Dialysis_DB` project (`zqzrriwuavgrquhisnoa`). |
| `query_comps.tool.js` | MCP tool module (`query_comps` + `synthesize_comps` + synonym map + dedup). Copy to `mcp/`. |

## Key facts to remember (so we don't re-derive them)
- **No Salesforce Connected App** — org is SSO-gated; Power Automate is the settled transport. Comps are crawled into `sf_comp_staging` on gov + dia (source_system='salesforce'), current as of 2026-07-20.
- **Object identity:** Deal=`Opportunity`, Company=`Account`, Contacts=`Contact`; Comp=`Comp__c`, Property=`Property__c`. Custom fields carry `_sjc__c`.
- **Comp gate:** `transaction_state='live' AND sold_price>0` (per the 2026-05-29 comp-definition audit). gov 5,686 / dia 3,689 live sales.
- **Cap rate:** canonical=decimal, `sf_comp_staging`=percent (÷100 in RPC).
- **Gov signal:** `Government__c` (bool) + `Gov_Category__c` (Federal/Local-State) on Comp.
- **Staging hygiene:** gov `sf_comp_staging` mixes 192 Account rows → filter `comp_type IS NOT NULL`.
- **Promotion gap:** only ~16% of SF comps promoted to canonical → v1 reads staging directly; COMP_FIELD_MAP (in 05) is the fix.

## Deploy sequence (when ready to build)
1. Deploy `rpc_query_comps_government.sql` → `scknotsqkcheojiaewwh`; validate vs the Muskogee VA fixture.
2. Deploy `rpc_query_comps_dialysis.sql` → `zqzrriwuavgrquhisnoa`.
3. Copy `query_comps.tool.js` to `mcp/`; register both tools in `server.js`; confirm `DIA_/GOV_SUPABASE_*` env.
4. Add the LLM parse step for `synthesize_comps`; wire the `briggs-comps` export.
5. Add `COMP_FIELD_MAP` to `sf-promotion-worker`; run report-only; promote trusted fields to `strict`.

## Open confirmations
Salesforce instance base URL (for deep links) · full `Property_Type__c` value set for non-gov verticals ·
whether `comp_scope` already segregates market vs internal comps · OM file retrieval path from `sf_files`.
