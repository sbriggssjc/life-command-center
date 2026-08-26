# Prompt 134 — Enrich the OLLAMA_CLEAN_ASSIST candidate context (it narrates "insufficient evidence")

## Dry-run finding (Cowork, 2026-08-26)
Flipped `OLLAMA_CLEAN_ASSIST` on, generated a 12-item inert sample
(`POST /api/ollama-clean-assist-tick` limit=12), graded it, then flipped OFF + deleted the sample
(reversible, nothing canonical touched). Result:

| lane | n | verdict pattern | usable? |
|---|---|---|---|
| `property_merge` | 3 | all `uncertain @ 0.00`, reason = "context lacks detail about the properties" | ❌ noise |
| `provenance_conflict` | 3 | all `uncertain @ 0.00`, reason = "insufficient info about the conflict/sources" | ❌ noise |
| `owner_reconcile` | 3 | `uncertain @ 0.30`, correctly abstains on initials-only pairs (TK Investment Co vs Terry Kessler) | ⚠️ safe, low value |
| `sf_link_candidate` | 3 | 1 `merge` (Realty Income, reasonable) but `confidence 0.00`; 2 correct `uncertain` | ⚠️ mixed |

**The safety doctrine holds** — it abstains instead of fabricating, so no bad merges. But **~6/12 are
content-free** because the model is handed a thin `context` object with none of the actual evidence to
reason over. Shipping it as-is would flood the Decision Center with "uncertain / insufficient evidence"
cards — the Consumption-Layer noise failure (a badge that's mostly noise trains the operator to ignore
the surface). **Root cause is the context payload, not the model.**

## The seam
`api/admin.js` → `handleOllamaCleanAssistTick` → `buildCleanAssistPrompt(item, kind)` sends
`context: item.context || {}`. `item` comes from `listFederatedLane(type, perType, ...)`. The lane rows
carry identifiers but not the comparative evidence the task needs.

## Ask — enrich `item.context` per lane so the model has real evidence (or honestly abstain earlier)
For each `CLEAN_ASSIST_TYPES` lane, populate `context` with the specific facts a human would look at:

- **`property_merge`** — both properties' address / city / state, domain `property_id`s, operator/tenant,
  and (if present) the twin-detector's distance + name-similarity. Enough to judge same-vs-co-located.
- **`provenance_conflict`** — the **competing field values**, each source's `source_system` +
  `field_source_priority`, and the current winner. Narration is impossible without the two values.
- **`owner_reconcile`** — both entity names, the strict-core comparison, `nameSimilarity`, and any SHARED
  evidence (shared property, shared address, shared SF account). Keep abstaining when it's initials-only.
- **`sf_link_candidate`** — canonical entity name, SF account name, `score_resolved`, and the match basis.

Reuse existing enrichment views/helpers where they exist (twin detector, `v_field_provenance_conflicts`,
`dup-pair-planner`, `sf-link-assist-planner`) rather than re-deriving. **Never fabricate** — if a lane
genuinely has no comparative evidence available, DON'T send it to the model at all (skip it and count it
`skipped: no_evidence`), rather than paying an Ollama call to hear "insufficient evidence."

## Coherence guard
A `merge`/`link` verdict with `confidence 0.00` is incoherent (seen on the Realty Income sf_link). If the
model returns a decisive verdict with ~0 confidence, downgrade to `uncertain` (or floor the confidence to
match the verdict). Small normalizer in `cleanAssistNormalizeProposal`.

## Re-validate before re-enabling
After enriching, regenerate a 12–20 item sample and grade: the target is **most proposals carry a
grounded reason that quotes the actual evidence**, and the `uncertain` rate drops to genuine ties. Only
then flip `OLLAMA_CLEAN_ASSIST` back on (cron jobid 200, `22 * * * *`, already exists and no-ops while
off). Keep it inert-only (proposals → `lcc_clean_assist_proposals`, human-confirmed; never auto-write).

## Deploy
JS-only (Railway redeploy). No migration unless a new enrichment view is added. Commit with the repo
trailer. This is a value/precision fix, not a bug — the current behavior is safe, just low-value, so it
stays OFF until the sample grades clean.
