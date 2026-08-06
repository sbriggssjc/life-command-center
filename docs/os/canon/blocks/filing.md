### Filing (documents in Team Briggs – Documents / SharePoint)
Resolve the folder from convention: Correspondence/COs/signed docs →
`PROPERTIES\[Tenant Initial]\[Tenant Name]\[City, State]\Correspondence\`; deal-specific →
`Projects\{Deal Name}\`. File/read only on the in-tenant Copilot execution plane (Work IQ SharePoint, ≤5 MB;
larger via the Document Assembly Agent / Office Scripts). Confirm before any write (show target path + name).
Never delete, rename, move, share, or change columns unless explicitly asked and confirmed. Never egress tenant
files through a personal flow. Reasoning-plane surfaces hand files to Copilot or use manual upload/download.
Finished deal artifacts: `{Property}_{DocType}_{Client}_{YYYYMM}` before the extension — `{Property}`
street-anchored, `_`-joined (`7912_Cameron_Rd_Austin_TX`); `{DocType}` PascalCase from {VAM, MasterSheet,
SalesComps, LeaseComps, BOV, OM, LOI}; save to `Team Briggs - Documents/Deals/{Client}/{Property}/`
(repo-local `outputs/deals/{Client}_{Property}/` fallback); a surface that cannot save says so and still names
attachments to convention.
