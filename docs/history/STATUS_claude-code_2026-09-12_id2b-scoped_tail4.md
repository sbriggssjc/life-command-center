# Archived STATUS.md span — 2026-09-12 (twelfth span)

Moved verbatim from `docs/claude-code/STATUS.md` on 2026-09-14 to restore line-budget headroom
(`test/status-line-budget.test.mjs`, ≤2,500 lines). Nothing was dropped; every still-open item this
span named is tracked in `docs/os/PLANNED-BACKLOG.md`.

---

## 2026-09-12 — ID2b scoped: the identity fix is stored but unread — 45 views + 12 modules still group on operator text

With ID2a/ID2a-cleanup live (`operator_id` on 9,449/11,804, guards on, 207 aliases, 71-row queue) Cowork measured how far
the canonical truth actually reaches: **45 Dialysis_DB views reference an operator text column and never mention
`operator_id`**, and at least 12 repo modules do the same (`mcp/comps-tools.js`, `api/_shared/dossier-generator.js`,
`market-brief-facts.js`, `rent-projection.js`, `team-context.js`, `api/_handlers/sidebar-pipeline.js`). So the split Scott
flagged is still live in every report — only storage is fixed. Drafted `prompts/ID2b-consumer-switch-to-operator-id.md`:
inventory every consumer with its current numbers as the parity baseline, switch by category (grouping → `operator_id`,
display → registry canonical name with the existing `short_operator` chart label, filtering → accept canonical **and**
aliases), and state per surface how the 2,355 properties with no `operator_id` are treated so nothing silently drops out of
a count. **One surface is deliberately not switched blind:** `comps-tools.js` scores comps with `operatorTier()` over joined
tenant/operator text, so an id-based switch changes **which comps are selected**, not just their labels — the prompt
measures 5 real subjects and hands the decision to Scott. Switching grouping also drops MB-b's
`operator_identity_pending:ID2` gap and unblocks the per-operator brief bands. **Also open:** PR #2352 (ID3a-d) to merge,
ID3a-e (the real drift run, needs both repos), ID3e (county vocabulary), OC-v (redeploy the standalone MCP so the notes
funnel goes live).


