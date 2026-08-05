# Canon Index & Invariants

**CANON_VERSION: 1.4.1** — 2026-08-05. Bump this on any rule change; record it in the changelog below and
run `../SURFACE-SYNC-PROTOCOL.md`.

## Global invariants (apply to every topic, every surface)
1. **Single-source; bind, don't fork.** Rules live here; surfaces render them, never re-author them.
2. **Same engine everywhere.** Comps/BOV/context come from the LCC engines (`mcp/`+`api/`); MCP and HTTP
   return identical JSON. Never substitute a surface-local answer.
3. **Email/comms route through LCC only** — `DraftOutreachEmail`/`DraftSellerUpdateEmail` (Power Automate →
   Outlook draft). Never Work IQ or any native M365 connector for email.
4. **Confirmation tiers.** Tier 0 read · Tier 1 lightweight · Tier 2/3 explicit `user_confirmed: true`
   (`WRITE_SURFACE_POLICY.md`).
5. **Memory is Cortex, write-gated.** After any material action or stated preference, log a one-line
   conversational memory. `log_memory` is Claude/MCP-only (never HTTP).
6. **Target the OWNER, not the tenant**, in all BD/outreach.
7. **System-of-record.** Gov/Dia read via LCC proxy only; canonical writes through audited paths.

## Handler modules (the topic canon)
| Module | Covers |
|---|---|
| `comps.md` | Pulling/synthesizing/exporting sales & lease comps |
| `filing.md` | Saving/reading/updating documents in Team Briggs SharePoint |
| `email-and-routing.md` | Outreach/seller-update drafting + inbound ingestion→classify→route |
| `logging-and-touchpoints.md` | Logging calls/touchpoints + BD cadence targets |
| `offer-submission` (block) | Inbound LOI → seller submission: assemble context, draft (BCC Sarah), file-back, generic-SF log. Full workflow: `skills/offer-submission-SKILL.md` |
| `writing-voice.md` | How written deliverables sound and are formatted |
| `bov.md` | BOV / valuation-memo / pro-forma generation and the lease-terms-first rule |
| `intake-triage.md` | Staged intake triage + classification taxonomy |
| `personal.md` | Personal-life domains and how they bind to the same OS |

## Enforcement (blocks · render · parity)
The rules above are **rendered** to every surface, not re-typed. The enforced, portable rule for each topic is
`blocks/<id>.md`; surfaces receive those via `../render.manifest.json` → `tools/render-surfaces.mjs` (which
generates the `../surfaces/<id>.canon.md` bundles) and are kept honest by `tools/check-parity.mjs` (non-zero
exit on drift). See `../RENDER-AND-PARITY.md`. To change a rule: edit `blocks/<id>.md`, bump `CANON_VERSION`,
re-render.

## Handler template (copy this to add a new module)
```md
# <Topic> Canon
Canon: v<X.Y.Z>
## Purpose
## Triggers            (what user asks that invokes this)
## Inputs              (what's needed; where it comes from)
## Procedure           (the exact steps / tools, in order)
## Output contract     (what's returned; format; invariants)
## Never               (hard prohibitions)
## Surface bindings    (which surface artifact renders this — see SURFACE-SYNC-PROTOCOL.md)
## Extension notes     (how to grow this without forking)
```

## Changelog
- **1.4.1** (2026-08-05) — Comps block: the appraisal cap discipline is a **hard filter on the DISPLAYED workbook rows** (prompt 54), not just the summary stat — every shipped Sold/On-Market row obeys displayed cap ≤ subject cap + 35 bps, the sold-set average holds below the subject, and a **reliability-or-exclude** floor drops rows with a displayed cap < 4.5% or a dialysis RENT/SF outside ~12–60 (rent/SF/price errors) to the review lane. The response `summary` cap range now matches the rows actually in the sheet. Sold comps join the **real market-entry date** (rpc `list_date`, gated < sale) so the Sold tab shows ON MARKET + DOM where a genuine list date exists (never synthetic).
- **1.4.0** (2026-08-05) — Comps block gains the **appraisal cap discipline + selection policy** (prompts 48-52): comps within 35 bps of the subject cap with the set average below the subject (never a higher cap / lower value beyond the band); 18-mo default reaching to ~24 mo but keeping a handful of trailing ~7-9-mo sales; rank/filter on the **displayed cap = rent/price** (not the mislabeled stored `cap_rate`); operator **anchors similarity, not a hard filter** (appraisal spans all dialysis operators); prefer the enriched record and **drop bare same-address duplicates** (consolidated via review-lane, prompt 51); sold comps read from `sales_transactions` with recent closes **propagated from `available_listings`** (prompt 50); **address-first phrasing-independent** subject resolution + hydrated cap in `fields` (prompt 49); width contract re-applied **after** LibreOffice recalc (prompt 48). Connector verified live end-to-end 2026-08-05 (generate_comps: no 500, subject 31964 hydrated, 25 sold + 20 on-market, all operators).
- **1.3.0** (2026-08-05) — Comps field-standardization + recency doctrine (prompt 41): 18-month default sold window with operator-first widening; canonical operator brands, expense vocabulary (Absolute NNN/NNN/NN/Gross/Ground Lease/Modified Gross), OPTIONS `(N) M-yr`, bumps `X% / N yrs`. Documented in the `comps` block. (Data-quality gates + OPTIONS-header/auto-fit shipped in code/templates, prompts 42/43.)
- **1.2.3** (2026-08-05) — Comps block gains the **single-renderer hard rule**: the only acceptable comps workbook is the one `generate_comps`/`populate_comps` produces into the canonical Briggs template — never hand-author a workbook, invent sheets/columns/a summary or methodology tab/a different sort, or leave the 100-row grid untrimmed; CHAIRS/PATIENTS come from the record. Documents the **connector-down fallback** (run the same `populate_comps` renderer locally with a query_comps-named payload → `unknown_keys: []` → LibreOffice-recalc) and the **on-market implied-rent rule** (`rent = round(asking_price * asking_cap)`, `initial_price = last_price = ask`). Fixes the "many formats" divergence caused by hand-rolled layouts when the connector was unreachable (found 2026-08-04). Mirrored into the `comps-engine` skill + module `canon/comps.md`.
- **1.2.2** (2026-08-04) — Deliverable naming + save-location doctrine added to the `bov` and `filing` blocks: every finished deal artifact is named `{Property}_{DocType}_{Client}_{YYYYMM}` and the set saves to `Team Briggs - Documents/Deals/{Client}/{Property}/` (repo-local `outputs/deals/{Client}_{Property}/` fallback). Fixes the Northmarq test-chat miss (Master Sheet off-convention, artifacts not saved to disk). Note: prompt 35 first edited the top-level `canon/bov.md`/`canon/filing.md` (non-render copies); the rule was ported into `blocks/` here so it reaches every surface.
- **1.2.1** (2026-08-03) — Comps workbook/appraisal handoff now uses one-shot `generate_comps.request`
  (request in, link out) so 20-25-row curated sets stay server-side; small row-driven exports use compact
  `template_comps`, never full comp objects.
- **1.1.0** (2026-07-30) — Added the `offer-submission` block (inbound LOI → seller submission: context-assemble → draft-to-Drafts with BCC Sarah + LOI attached → file-back via property-doc-writeback → `log_offer` with LCC full detail + a GENERIC Salesforce Task). Rendered to all 5 surfaces. Engine: `mcp/offer-context.js` (offer-context/offer-log routes + `get_offer_context`/`log_offer` MCP tools), `outlook-draft.js` Bcc.
- **1.0.0** (2026-07-24) — Initial canon: comps, filing, email-and-routing, logging-and-touchpoints,
  writing-voice, bov, intake-triage, personal. Distilled from `docs/copilot/agent-instructions.md`,
  `SURFACE_CAPABILITY_PARITY.md`, the Cowork skills, and `lcc_intelligent_operating_system_v2.md`.
  Added the enforced `blocks/` layer + render/parity tooling (`tools/`, `render.manifest.json`,
  `surfaces/`) — a structural enforcement addition, no rule change.
