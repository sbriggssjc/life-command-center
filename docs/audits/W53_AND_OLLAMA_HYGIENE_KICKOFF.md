# Kickoff — W5.3 Local-LLM Evaluation + Ollama Data-Hygiene Campaign (W8)

> Written 2026-08-06 (Cowork session 36cc) as the grounding for a fresh chat.
> Open that chat with: **"Pick up W5.3 + the Ollama hygiene campaign from
> docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md"**.
> Companion docs: AUDIT_REFRESH_2026-08-06.md (backlog #4, #13), garybuilt playbook §7
> (Ollama employment map + the never-in-auditable-gates rule), ROLLOUT_STATUS 36bb.

## Part 1 — W5.3: grade GaryBuilt (ollama) on real accrued intakes (closes Wave 5)

**Corpus confirmed (2026-08-06):** `staged_intake_extractions` holds **234 rows since
2026-08-01** (through 19:27Z today), rich field coverage (parties/NOI/cap/lease
responsibilities/brokers/parcel). `OLLAMA_EXTRACTION` has been ON since Aug 1 — this IS
the ollama-primary production sample.

**First task — locate provider attribution:** the snapshots carry fields only, no
provider tag. Find where the ai.js `invokeExtractionAI` seam records provider/tried
per extraction (candidates: a processing/diagnostics log table, `v_processing_log_daily`,
Railway app logs, or the intake row's own metadata). If attribution is only in Railway
logs, grade the whole window as ollama-primary (cloud fallback rate from log grep) and
note the gap → recommend adding a provider stamp to the snapshot (small fix).

**Grading method (human-anchored, no self-grading):**
1. Accuracy vs human verdicts: join extractions to `staged_intake_feedback` (3,900+
   rows) — acceptance/edit rates on ollama-era extractions vs the pre-Aug-1 cloud era
   (`v_matcher_accuracy_recent` bands as the template).
2. Field-level spot audit: sample 30 extractions stratified by document_type; Cowork
   eyeballs against source docs where retrievable; score per field
   correct/wrong/absent.
3. Ops: fallback rate, latency (run logs), CF-tunnel failures since Aug 1.
4. NEW surfaces to fold in (all shipped this week, all Ollama): W7.2 summaries
   (no-fabrication compliance), W7.4 roles/issues (dropped-proposal ratio from
   `lcc_deal_analysis_dropped_log` — the validator gives a FREE precision floor
   metric), W7.5 narrations.
**Verdict goes in ROLLOUT_STATUS W5.3 row**: keep ollama-primary / tune prompts /
revert any surface to cloud. Wave 5 closes with the verdict.

## Part 2 — W8: Ollama data-hygiene campaign (Scott's directive, 2026-08-06)

**Scott's intent (verbatim):** "many duplicate or junk or unconnected records across
our databases — deploy the Ollama local model to work on cleaning, propagating,
connecting and reporting back any code errors or lack of connections that are systemic
and need to be addressed."

**Doctrine (non-negotiable, playbook §7):** Ollama PROPOSES; deterministic gates or
human lanes DECIDE. No LLM in auditable gates. Every proposal evidence-grounded.
Never delete FK-referenced rows (hazard class, hit 3×). Reversible ledgers everywhere.

**Existing hygiene surfaces to build ON, not around (verified in LCC Opps today):**
- `v_lcc_person_email_merge_candidates` — person-merge candidates already computed
- `lcc_chain_unresolvable` + `v_lcc_ownership_chain_completeness` +
  `v_ownership_chain_worklist` — connection gaps already enumerated
- `cross_domain_contacts` — the cross-DB linkage surface
- The resolver (/match, Fellegi-Sunter) + entity_match_labels corpus — dupes are ITS
  job; Ollama assists, never replaces
- Review lanes / Decision Center — the human gates that already exist
- `ingest_write_failures`, `flow_run_failures` — the systemic-error signal is already
  logged, nobody synthesizes it

**Campaign units (each small, each its own consumer+gate; sequence, don't batch):**
1. **U1 Junk-entity pre-screen** (playbook near-term item): Ollama scores obvious junk
   (test rows, gibberish, bookkeeping stubs) across dia/gov/ops entity tables →
   proposals into a new `junk_review` lane; human verdict retires (soft, reversible) —
   never hard-delete.
2. **U2 Duplicate proposals → resolver fuel**: Ollama sweeps name/address near-misses
   the blocking rules skip → emits CANDIDATE PAIRS to the resolver's review pool (not
   merges); accepted pairs become entity_match_labels (training fuel — the W4 loop).
3. **U3 Connection propagation**: for `lcc_chain_unresolvable` + merge-candidate rows,
   Ollama reads the surrounding evidence (notes, comms, filings) and proposes the
   missing link WITH quoted evidence (W7.4-style verbatim validator) → confirm lane;
   accepted → deterministic writer stamps provenance.
4. **U4 Systemic-findings report**: a scheduled Cowork/edge job that aggregates
   `ingest_write_failures`, `flow_run_failures`, unranked-provenance drift, chain
   completeness, dropped-proposal ratios → one monthly "systemic defects" doc (Ollama
   drafts the narrative FROM the numbers; numbers computed deterministically) →
   feeds the W6.6 audit. Code errors surface here as fix-units for Claude Code.
**Scale note:** GaryBuilt throughput ~1-3s/call — size batches accordingly; nightly
off-hours crons like the retrain loop; every unit flag-gated with registry rows IN the
migration (36y rule).

**Recommended order:** W5.3 verdict FIRST (know the tool's real accuracy before
widening its reach), then U1 (safest, most visible), U2, U3, U4.
