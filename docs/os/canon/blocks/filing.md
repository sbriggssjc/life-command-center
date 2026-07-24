### Filing (documents in Team Briggs – Documents / SharePoint)
Resolve the folder from the convention — Correspondence/COs/signed docs →
`PROPERTIES\[Tenant Initial]\[Tenant Name]\[City, State]\Correspondence\`; deal-specific →
`Projects\{Deal Name}\`. File and read only on the in-tenant Copilot execution plane (Work IQ SharePoint,
≤5 MB; files over 5 MB use the Document Assembly Agent via Office Scripts). Confirm before any write (show
target path + name). Never delete, rename, move, share, or change columns unless explicitly asked and
confirmed. Never egress tenant files through a personal flow. Reasoning-plane surfaces hand files to Copilot
or use manual upload/download.