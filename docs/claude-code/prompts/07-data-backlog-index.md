# Prompt 07 — Data-backlog index (property-dossier P0-P3)
- Priority: mixed (P0-P3)
- Status: index — individual items open unless noted
- Related: `docs/architecture/dossier-followup-prompts-for-claude-code.md` (full text of each), `dossier-v2-audit-and-triage.md`
- Response files: paste per-item responses as `../responses/07-<item>.response.md`

The property-dossier data backlog lives in full in `dossier-followup-prompts-for-claude-code.md` (Prompts 0-8).
Status best-known as of 2026-08-01 (confirm + tell Cowork which to close):
- Prompt 0 — design-vs-production reconciliation (23654): **open**
- Prompt 1 — P0 CMS reconciliation + $104.6M revenue bug: **landed** (commit f4518ada "Correct operations export
  to use corrected CMS clinic economics") — verify + close
- Prompt 2 — rent/SF + current-escalated-rent: **partial** (escalation carry-forward done in Dialysis #7354, but
  it drove the wrong 6.46% cap — superseded by prompt 01; rent/SF compute-on-read: verify)
- Prompt 3 — transactions/listings wiring: **open**
- Prompt 4 — lease abstract (guarantor/responsibilities) for 23654: **open**
- Prompt 5 — loan feeder + finances suppression: **superseded by prompt 04** (loan propagation)
- Prompt 6 — documents reconciliation (SharePoint + Salesforce): **open**
- Prompt 7 — relocation lineage + market competition: **open**
- Prompt 8 — Location & Trade Area (Google Static Maps + demographics backfill): **open**

Cowork will migrate any still-open item into its own `prompts/NN-*.md` on request or as it becomes the active
piece of work.


## Update 2026-08-01 (session 2): followup prompts 2 & 3 RETURNED + DONE
- Prompt 2 (rent/SF + current-escalated-rent): **done** — detail.js + entities-handler + dossier-generator render Year-1 & current rent + $/SF; lease 16307 backfilled ($28.85 -> $200,155 / $31.73). Response in `done/07-followup2-rent-per-sf.response.docx`.
- Prompt 3 (transactions/listings timeline): **done** — Transaction & Marketing Timeline wired from sales_transactions (live) + available_listings; verified on 23654. Response in `done/07-followup3-transactions-timeline.response.docx`. (Source note: active listing cap stored 0.0524, not 5.25
## Update 2026-08-01 (session 2): followup prompts 2 & 3 RETURNED + DONE
- Prompt 2 (rent/SF + current-escalated-rent): **done** — detail.js + entities-handler + dossier-generator
  render Year-1 & current rent + per-SF; lease 16307 backfilled (28.85/SF -> ~200,155 current / 31.73 SF).
  Response in `done/07-followup2-rent-per-sf.response.docx`.
- Prompt 3 (transactions/listings timeline): **done** — Transaction & Marketing Timeline wired from
  sales_transactions (live) + available_listings; verified on 23654. Response in
  `done/07-followup3-transactions-timeline.response.docx`. (Source note: active listing cap stored 0.0524, not
  5.25% — left grounded.)

## Update 2026-08-01 (session 2c): followup prompt 4 RETURNED + DONE
- Prompt 4 (lease abstract — guarantor + responsibilities): **done** — lease 16307/property 23654 now has
  guarantor "DaVita Incorporated"; roof=shared, structure=landlord, parking=shared, HVAC=shared;
  guaranty_scope null (PDF silent on the Initial-Term limit -> Not on file). Extended invokeExtractionAI seam,
  added leases.guaranty_scope; dossier renders Tenant + Guarantor distinct + guaranty scope + expense-structure
  prose. Response in `done/07-followup4-lease-abstract.response.docx`. NOTE: this updates the 5247 Airways
  dossier facts (guarantor + responsibilities were previously "Not on file").
