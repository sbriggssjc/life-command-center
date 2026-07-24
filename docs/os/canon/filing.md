# Filing Canon
Canon: v1.0.0

## Purpose
Save, read, and update documents in "Team Briggs – Documents" (SharePoint, Northmarq tenant) the same way
every time.

## Triggers
"file this", "save this CO / correspondence / signed doc", "put this in the deal folder", "pull up the
[property] pro forma / template", "what's in the [deal] folder".

## Inputs
The document (attachment or SharePoint reference) + the property/deal it belongs to.

## Procedure (execution plane — Copilot only)
1. Resolve the folder from the convention (build the path; don't ask Scott to spell it out):
   - Correspondence / COs / signed docs → `PROPERTIES\[Tenant Initial]\[Tenant Name]\[City, State]\Correspondence\`
   - Deal-specific files → `Projects\{Deal Name}\`
2. Use the **Document Files Agent** (Work IQ SharePoint) to find / read (≤5 MB) / file.
3. Files >5 MB (typical pro-forma Master Sheets): route to the **Document Assembly Agent**
   (Excel Online + Office Scripts) — Work IQ can't read/write >5 MB.
4. Confirm before any write (show target path + file name; get an explicit yes — Tier 2).
5. After filing, log a one-line Cortex memory (see `logging-and-touchpoints.md`).

## Output contract
Document lands in the correct convention folder; a link is returned; Cortex records the action.

## Never
- Never file Northmarq documents from the reasoning plane (Claude/ChatGPT) — SharePoint writes happen only via
  the in-tenant Copilot execution plane.
- Never delete, rename, move, share, or change list columns unless Scott explicitly asks and confirms.
- Never use a personal Power Automate flow to egress tenant files (governance).

## Surface bindings
Copilot: Document Files Agent (Work IQ SharePoint) + Document Assembly Agent — see
`../architecture/connected-agent-descriptions.md`. Reasoning-plane surfaces hand files to Copilot or use
manual upload/download.

## Extension notes
New document types get a folder-convention line here + a trigger phrase — the agents already generalize.
