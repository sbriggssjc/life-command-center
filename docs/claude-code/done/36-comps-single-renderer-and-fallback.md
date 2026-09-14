# Prompt 36 — Comps: enforce ONE renderer + a connector-down fallback (kills the "many formats" problem)

## Why (found 2026-08-04)
The same comps request produced multiple different workbooks. Root cause: there is exactly ONE correct renderer —
`bov-generator/comps_generator.py::populate_comps` — which loads the canonical template
(`bov-generator/templates/Comps Blank Template - Briggs - Dialysis.xlsx`), is header-driven, writes only input
cells, protects formula columns, sorts (Sold by DATE desc, On Market by cap asc), flags estimated NOI, and
**trims blank rows to the AVG/TOTALS bar** (`_trim_to_totals`). Divergence happened only when a surface/agent
could NOT reach `generate_comps` (connector down) and hand-rolled a layout instead — different sheets, no
CHAIRS/PATIENTS, untrimmed 100-row grids, extra "summary" tabs, wrong sort. This session did exactly that before
correcting it by importing and running `populate_comps` directly.

## Task
1. **Canon + comps-engine skill hard rule.** The ONLY acceptable comps workbook is the one `generate_comps` /
   `populate_comps` produces into the canonical template. Add a binding rule (bump CANON_VERSION, re-render):
   *Never hand-author a comps workbook. Never invent sheets, columns, a summary/methodology tab, or a different
   sort. Never leave the 100-row grid untrimmed. CHAIRS/PATIENTS come from the record, not blank.*
2. **Connector-down fallback (documented + reproducible).** When `generate_comps` (BOV service / MCP) is
   unreachable, the fallback is NOT to build by hand — it is to run the same renderer locally:
   `from comps_generator import populate_comps; populate_comps(payload, out, template_dir='bov-generator/templates')`
   with `payload={comp_type:'sales', vertical:'dialysis', sold:[...], on_market:[...]}` using query_comps field
   names (they alias straight through; a correct payload yields `unknown_keys: []`). Then LibreOffice-recalc.
   Add this as an explicit step in the comps-engine skill so every surface/agent follows the identical path.
3. **On-market rent basis.** Document the standard: an on-market listing with a known asking cap but no in-place
   NOI carries `rent = round(asking_price * asking_cap)` (implied NOI, exact) with `initial_price=last_price=ask`
   so the template's INITIAL/LAST CAP reproduce the asking cap. Keep this identical across surfaces.

## Verify
- The comps-engine skill and canon both state: single renderer, no hand-rolled layouts, local `populate_comps`
  fallback, on-market implied-rent rule. CANON_VERSION bumped + re-rendered to all surfaces (0 drift).
- A dry test: feed a small payload to `populate_comps` → `unknown_keys` empty, sheets trimmed, formulas intact.
