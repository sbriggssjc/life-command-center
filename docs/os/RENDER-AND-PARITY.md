# Render & Parity — enforcing "same output everywhere"

Turns the canon from documentation into something structurally enforced: one rule, rendered to every surface,
with automated drift detection. Companion to `SURFACE-SYNC-PROTOCOL.md` (which is the human procedure) — this
is the machine layer.

## The pieces
- **`canon/blocks/<id>.md`** — the *enforced, portable* rule for each topic (the distilled, surface-agnostic
  text that must appear identically wherever it's rendered). The sibling `canon/<id>.md` is the human
  explanation; the block is what surfaces actually receive.
- **`render.manifest.json`** — structure only: which blocks each surface renders, its live-artifact path, and
  its managed-region markers. `CANON_VERSION` is read from `canon/00-INDEX.md` (never duplicated here).
- **`surfaces/<surface>.canon.md`** — GENERATED bundles: the exact canon region for each surface, version-stamped.
- **`tools/render-surfaces.mjs`** — regenerates the bundles from canon; with `--write-live`, writes the bundle
  into a live artifact's `CANON:BEGIN … CANON:END` region without touching surface-specific content.
- **`tools/check-parity.mjs`** — fails (non-zero exit) if any bundle is stale vs canon, or any migrated live
  artifact's managed region drifts. CI-friendly.

## Daily use
```bash
# after editing any canon/blocks/*.md and bumping CANON_VERSION in canon/00-INDEX.md:
node docs/os/tools/render-surfaces.mjs --root=docs/os          # regenerate bundles
node docs/os/tools/check-parity.mjs   --root=docs/os           # verify (exit 0 = clean)
```
Verified behavior: a version bump without a re-render makes `check-parity` exit non-zero and name each stale
surface — so drift cannot pass silently (and can gate CI).

## How each surface consumes its bundle
| Surface | Consumption |
|---|---|
| Copilot (`agent-instructions.md`) | Migrate once: add `<!-- CANON:BEGIN --> … <!-- CANON:END -->` around the shared-rule region, then `render --write-live` keeps it current; paste & Publish. |
| ChatGPT (`gpt-actions-system-prompt.txt`) | Same, with `# CANON:BEGIN` / `# CANON:END` markers. |
| Northmarq prompt (SharePoint), Claude skills | External — not in the repo tree. Copy the surface's `surfaces/<id>.canon.md` bundle into the prompt/skill on change (protocol §3). |

## One-time migration (bootstrap the live artifacts)
For `copilot` and `chatgpt`: locate the block of shared rules already inline in the live artifact, wrap it in
the two markers, delete the now-duplicated inline rules, then run `render --write-live`. From then on the
managed region is generated; surface-specific content (approve-all override, param notes, personas) stays
hand-authored around it. `check-parity` reports un-migrated artifacts as ⚠ (warn), migrated-and-current as ✓,
and migrated-but-stale as ✗.

## Engine parity (already enforced, noted here for completeness)
Comps/BOV/context come from one implementation; MCP and HTTP return byte-identical JSON
(`SURFACE_CAPABILITY_PARITY.md`). This layer adds the same guarantee for *instructions*.

## Extending
A new capability = add `canon/blocks/<id>.md`, list it under the surfaces that should carry it in
`render.manifest.json`, bump `CANON_VERSION`, re-render. A new surface = add a manifest entry (its blocks +
markers) and render once. No script changes needed.
