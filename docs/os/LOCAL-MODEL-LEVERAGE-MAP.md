# Local Model (GaryBuilt / Ollama) Leverage Map

Last updated: 2026-08-24 (Cowork audit). Single source of truth for where the on-prem Ollama local model
(`qwen2.5:14b` on GaryBuilt, tunnel `garybuilt.briggscrelccopps.com`) is used, is built-but-dormant, is
planned, and could expand. **Doctrine:** private corpora (voice, deal correspondence, buyer LOIs, comps) NEVER
go to a cloud model; the local model is the on-box path for exactly those. All traffic flows through
`api/_shared/ai.js` (`invokeExtractionAI({surface})`, `invokeOnPremGeneration` fail-closed,
`invokeOnPremEmbeddings`). Master gate `OLLAMA_URL`; per-surface gate `OLLAMA_SURFACES`. Playbook:
`docs/setup/garybuilt-local-model.md`.

## 1. LIVE today (already leveraging the local model)
- **Extraction:** OM/deed intake (`intake-extractor.js`), leases (`lease-extractor.js`), BOV (`bov-extract.js`),
  owner-name (`cre-owner-extract.js`), party-extract (`party-extract.js`, gov live via `W51_PARTY_EXTRACT`).
- **Narrative/summary:** deal dossiers (`dossier-generator.js`), W7.2 deal-comm summaries + W7.4 roles
  (`deal-comms-propagate-tick.js`, `DEAL_COMMS_PROPAGATE_CRON` live), W7.5 action summaries (`W75_ACTION_SUMMARY`).
- **Drafting:** `draft-assist.js` (W10 Stage 2 RAG + `nomic-embed-text` embeddings; `DRAFT_ASSIST` on, save
  gated on `PA_OUTLOOK_DRAFT_URL`) — the whole email arc this session.
- **Voice:** `scripts/voice-distill.mjs` (on-box only, refuses without `OLLAMA_URL`).
- **Junk pre-screen:** `W8_U1_JUNK_PRESCREEN` (live, nightly 03:40, ~25/night).
- **Chat (optional):** Ollama is a selectable `invokeChatProvider` provider (only under `AI_CHAT_POLICY=balanced`).

## 2. ⭐ BUILT BUT DORMANT — the leverage already engineered, awaiting a dry-run review + flip
Each is **annotation-only** (proposes into a review lane / `metadata.assist`, never an auto-write or a verdict),
reversible, and designed to be flipped after reviewing a dry-run sample. **Flipping these is the fastest way to
increase leverage — no new build, just review + activate.** Activation gate for all: `OLLAMA_URL` set on
Railway + flip the flag (env + `feature_flags_registry`).

| flag | what it does | value |
|---|---|---|
| `PROPERTY_TWIN_ASSIST` | pre-ranks the ~1,245-row dia property-twin review lane (P106) | operator works real twins first |
| `MATCH_DISAMBIG_ASSIST` | nightly pre-rank of the `match_disambiguation` lane (P80) | fewer minutes per merge decision |
| `OLLAMA_CLEAN_ASSIST` | triage / record-link / field-conflict proposals into `lcc_clean_assist_proposals` | clears review-lane noise |
| `W9_3_SF_ASSIST` | ranks the ~3.3k `sf_link_candidate` lane | drains the biggest single lane |
| `W8_U2_DUP_PAIRS` | same-party/distinct second-look on near-miss owner pairs | feeds owner reconciliation |
| `W9_2_REACHABILITY_HARVEST` | attributes contact reachability from intake snapshots/signatures (verbatim-quoted) | more owners reachable |
| `W8_U5_NAMING_HYGIENE` | abbreviation-expansion proposals | cleaner entity names → better merges |
| `NEXT_STEP_AI` | derives the specific to-do (type/title/due) from inbound correspondence | auto-populates cadence next-step |

**Recommended activation order (highest value / lowest surprise first):** `NEXT_STEP_AI` (already feeds the
email arc) → `PROPERTY_TWIN_ASSIST` (bounded lane, P106-tested) → `W9_3_SF_ASSIST` (largest lane) →
`MATCH_DISAMBIG_ASSIST` → the rest. Each: pull a dry-run sample, eyeball 10–20 proposals for precision, flip,
watch the queue drain by value.

## 3. Planned but untouched (local-model work designed, not built)
- **Template library** (ROLLOUT_STATUS W10 Stage 3, `⬜`): cluster the sent corpus by draft-type, synthesize
  Scott-voiced parameterized templates + triggers (new listing → announcement; LOI → offer-submission).
- **LoRA fine-tune** on the 10-yr sent corpus (`garybuilt-local-model.md` Phase 3) — never started.
- **Daily-briefing narrative polish** — generate the brief's prose section on-box each night.
- **Research synthesis** — summarize owner-contact / `research_task` results into structured payloads.
- **U4 edit-distance feedback** — the draft-vs-actually-sent accept/edit signal is wired in `draft-assist.js`
  but not fed; it's the quality loop that would tune voice over time.
- **W5.3 intake local-vs-cloud re-grade** — pending measurement on ~50 fresh intakes post Prompt-61 hardening.
- **GaryBuilt residential IP as non-datacenter egress** for owner web-search (`W9_CONNECTEDNESS_KICKOFF.md`).

## 4. Candidate NEW areas (highest business leverage, not yet built)
1. **Capital-markets marketing copy** — the quarterly ST-Market / NM-CapMarkets book copy (`capital-markets-copy`
   skill, `cm_*` views) is templated, private, repetitive → ideal on-box generation; currently routes cloud.
2. **BOV / OM exhibit narrative first-drafts** — dossier + `bov-extract` already extract the facts; draft the
   cover-note/exhibit prose in Scott's voice, deal specifics stay on-box.
3. **Comps narrative + reconciliation synthesis** — draft the appraiser-facing comp-set summary and flag
   outliers without egressing deal comps (`query-comps.js` / comps-engine).
4. **LOI/offer intake structuring** — on-box extraction of buyer/price/terms from inbound LOI PDFs
   (`offer-submission`); counterparty terms are exactly the private corpus the doctrine protects.
5. **Correspondence → cadence next-action** — extend the W7 comms summaries to propose the cadence STEP
   (who's going cold, suggested touch) into the cadence engine.
6. **Owner-resolution rationale** — draft the one-line "why these are the same party" on the hard residue the
   deterministic classifiers punt.

## Recommendation
**Capture the built leverage before building more:** run a dry-run review + flip of the Section-2 dormant assist
lanes (starting `NEXT_STEP_AI` → `PROPERTY_TWIN_ASSIST` → `W9_3_SF_ASSIST`). Then the single highest-value NEW
build is **capital-markets marketing copy** or **BOV/OM exhibit narratives** — both save Scott real time per
deal/quarter and keep private data on-box. Non-Ollama dormant items (owner-enrich SOS/deed/address adapters,
Decision-Center writebacks) are separate and mostly blocked on external egress, tracked in
`feature_flags_registry`.
