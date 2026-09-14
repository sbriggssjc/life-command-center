# Request Understanding & Data-Consistency layer — cross-tool gap (2026-08-03)

Scott's question after prompt 23: is the "plain-language request → wrong/thin output" problem specific to comps,
or a system-wide gap we must architect around? **It is system-wide.** Comps is the first place it surfaced only
because Scott eyeballed the output and knew it was thin. The same three failure modes exist in every LCC tool
that turns a loose request into a deliverable.

## The three failure modes (generalized from comps)
1. **Subject/entity resolution** — "The Villages", "the Woodland Hills deal", "Cawley", "that GSA lease on Clay
   St." must resolve to the RIGHT entity (asset/contact/org/deal), disambiguate duplicates (35724 vs 29882), and
   say "Not on file" honestly. Comps hardcoded a mini-gazetteer; every other tool resolves differently or not.
2. **Intent → mode/output** — the request implies a deliverable, a template/mode, a scope, and quality defaults.
   Comps had to learn "appraisal mode"; BOV must pick dialysis vs government vs standard; a dossier must pick
   property vs deal variant. Each tool re-derives this, inconsistently.
3. **Consistent quality / data-consistency contract** — the Team Briggs meta-rules (cap reconciled to our
   convention, reliable-vs-estimated NOI transparency, source labeling, buyer/seller policy, and the standing
   "no fabrication → Not on file / Derived / Conflict") are re-implemented per tool → drift. We already had to
   fix cap reconciliation in ONE place (6.00% vs 6.46%); nothing guarantees the others match.

## Exposure by workflow (which tools have this gap today)
| Tool / workflow | Subject resolution | Intent→mode | Quality contract | Exposure |
|---|---|---|---|---|
| query/synthesize/generate comps | FIXED (23) | FIXED (23) | FIXED (23) | now good — the template |
| generate_bov / bov-underwriting / bov-government | HIGH (which property; template pick) | HIGH (dialysis/gov/standard; assumptions) | HIGH (cap/rent reconciliation) | **highest — do next** |
| get_property_context / get_contact_context / get_deal_dossier | HIGH ("the X deal", dupes) | MED (which sections) | MED (Not-on-file, conflicts) | high |
| offer-submission | HIGH (resolve listing/deal/parties from LOI) | MED (submit vs counter) | MED (factual-only, strategy verbal) | high |
| cms-npi-analysis | HIGH (facility by addr/Medicare/NPI) | LOW | MED | medium |
| search_entities | it IS the resolver front door | — | — | foundational |
| daily_briefing / queue / pipeline_health | LOW | MED (scope/timeframe) | LOW | low |

## What's lacking today (root cause)
There is **no shared "request understanding" layer**. Intent parsing, entity resolution, and the quality contract
are implemented per-tool. So every tool must independently be taught to be smart, robustness has to be re-solved
each time, and the cross-cutting no-fabrication/reconciliation rules can silently drift between tools. The
record-linkage resolver (`gracious-radiance`) exists but is for DEDUP, not NL "what did the user mean." The
entity graph (external_identities / entities) exists but nothing turns a plain phrase into a resolved subject
uniformly. And there's **no interpretation logging** — gaps only surface when a human notices bad output.

## Proposed architecture — four shared modules the tools call
1. **Subject/Entity Resolver (NL → entity).** One function: plain reference → `{entity, type, confidence,
   alternatives[], not_on_file}` via `search_entities` + `external_identities` + a gazetteer/alias table + an
   "our assets under contract" registry; disambiguation policy (surface alternatives when ambiguous, never
   silently pick). Reuse the linkage resolver where it helps.
2. **Intent Interpreter.** Generalize comps' `parseRequest` into a shared classifier: request →
   `{tool, mode, scope, output_shape, quality_flags}`. Small, testable, one place.
3. **Team Briggs Data-Consistency Contract (shared module).** The reconciliation rules, reliability transparency,
   source labeling, buyer/seller policy, and the "Not on file / Derived / Conflict" rendering — consumed by comps,
   BOV, dossiers, offer. One implementation, enforced everywhere.
4. **Reference registry / gazetteer.** Markets + aliases, our assets/deals, operator canonicalization — one
   source used by all (comps' The-Villages→FL knowledge becomes shared, not local).
Plus **interpretation logging** (request → interpreted params + what was filtered/assumed) so misunderstandings
are caught proactively, and a uniform **clarify-or-assume-and-disclose** behavior + transparency line.

## Build plan (phased — understand first, per the standing directive)
- **Phase 1 — AUDIT (prompt 24):** inventory each tool's current intent/resolution/quality handling; map gaps +
  duplication against the table above; confirm the shared-module boundaries. No refactor yet.
- **Phase 2 — EXTRACT:** pull comps' now-good `parseRequest` + subject resolution + quality bits into the four
  shared modules (they already exist in `mcp/comps-tools.js` — promote them to shared).
- **Phase 3 — ADOPT:** refactor BOV (highest exposure) → then property/contact/deal context → then offer, to
  consume the shared modules; add interpretation logging.
- **Phase 4 — OBSERVE:** surface an interpretation log + a periodic "misunderstanding review" (tie into the LCC
  Health surface) so this never regresses silently.

Net: prompt 23 made comps robust; this makes robustness a PROPERTY OF THE PLATFORM instead of a per-tool retrofit.

## Addendum (2026-08-03) — clients must ROUTE TO the understanding layer, not around it
The ChatGPT re-test (post prompt-23-commit, pre-deploy) still returned 1 comp: the GPT parsed "The Villages, FL"
+ DaVita and sent a NARROW structured query (tenant=DaVita, metro=The Villages, FL). The engine honored it →
1 comp. Two lessons:
1. **Prompt 23 must be DEPLOYED** (tranquil-delight + standalone MCP) — the live engine is still the old one.
2. **Server-side understanding only works if the client defers to it.** Appraisal-mode fires in the engine only
   when the caller passes the user's VERBATIM natural-language request (so `parseRequest`/`detectAppraisalIntent`
   run) and does NOT pre-narrow with tenant/metro. If a client over-parses and sends narrow params, it bypasses
   the whole layer. This is codified in canon (`docs/os/canon/comps.md`: SynthesizeComps first with Scott's
   verbatim request, then generate_comps), but the ChatGPT GPT + Copilot agent instructions weren't following it.
   **Fix the client instructions** (ChatGPT custom instructions, Copilot agent, OpenAPI action descriptions) to
   route every comp/appraisal request through `synthesizeComps` with the verbatim `request` and no self-narrowing.
This generalizes: the shared resolver/intent layer (Phase 2+) is only effective if every surface passes raw intent
to it. Client-routing discipline is part of the architecture, not an afterthought.
