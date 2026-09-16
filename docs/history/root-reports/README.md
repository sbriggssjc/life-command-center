# Root `.docx` reports — readable copies

Ten Word documents live at the repository root (`LCC_Holistic_Audit_2026-05-17.docx`,
`LCC_Architecture_Gap_Analysis.docx`, `LCC-Unified-Property-Detail-Spec-v1.docx`, …). REPO1 (2026-09-12)
left them in place because `audit/` cites them by path. INVENTORY1 (2026-09-16) could not read them —
Claude Code's sandbox has no `pandoc`/`python-docx` — so its intent inventory skipped them.

This folder holds a **Markdown conversion of each**, made with `pandoc -t gfm` on 2026-09-16. They are
readable copies for tooling and for future chats, not new sources of truth: every claim carries the
original document's date (April–August 2026), and several are known to be stale (`CURRENT-STATE.md` §7
lists claims measurement has overturned). Re-measure before quoting.

| file | original date | what it is |
|---|---|---|
| `Data_Infrastructure_Audit_Report_2026-04-17.md` | 2026-04-17 | first data-infrastructure audit |
| `LCC_Holistic_Audit_2026-05-17.md` | 2026-05-17 | the holistic app audit (largest) |
| `LCC_Architecture_Gap_Analysis.md` | 2026-05 | architecture gaps |
| `LCC_Infrastructure_Migration_Plan.md` | 2026-05/07 | Vercel → Railway migration plan (cutover done 2026-07-20) |
| `LCC-Unified-Property-Detail-Spec-v1.md` | 2026 | unified property-detail spec |
| `LCC-Copilot-Agent-Setup-Guide.md` | 2026 | Copilot Studio agent setup |
| `Life-Command-Center-Setup-Guide.md` | 2026 | app setup guide |
| `GovLease-Salesforce-PowerAutomate-Guide.md` | 2026 | GovLease → Salesforce flow guide |
| `Power_Automate_Flow_Guide.md` | 2026 | Power Automate flow guide |
| `RCM_Power_Automate_Flow_Spec.md` | 2026 | RCM lead-parsing flow spec |

`LCC_Top_Prospects_2026-08-22.xlsx` (root) is a data export, not a document; not converted.
