# CLAUDE CODE PROMPT — W5.1: Party extraction from sale notes (GLiNER + GaryBuilt local LLM)

> **Unit:** W5.1 (LCC Audit Rollout Plan, Wave 5) — REVISED 2026-07-31 (session 33)
> to incorporate the GaryBuilt local model, which post-dates the original audit.
> **Read first:** `docs/setup/garybuilt-local-model.md` (the on-prem analyst),
> `api/_shared/ai.js` (the Ollama provider seam — local primary → cloud fallback,
> gated on `OLLAMA_URL`), W4.4's `field-priority-guard` (all writes go through it).
> **Goal:** fill the missing buyer/seller/broker fields on live sales from
> `sale_notes_raw` — dia missing 1,315 buyers / 2,216 listing brokers; gov
> 1,174 / 3,373 — with span-grounded extraction, at zero incremental cloud cost.

## Architecture (two channels + adjudication — revised from GLiNER-only)

1. **Channel A — GLiNER spans** (per the original plan): POST `/extract-parties`
   on the `resolver/` service — text → `{buyer, seller, listing_broker,
   procuring_broker, lender, price, cap_rate, spans}` via `gliner_medium-v2.1`
   with CRE-tuned labels. Deterministic, span-anchored, no hallucination.
   CPU-fine; bake the model into the resolver Docker image (mind the 2GB memory
   floor — measure; bump the service if needed).
2. **Channel B — local LLM** (NEW, via the EXISTING ai.js seam — do not build a
   second Ollama client): structured-JSON extraction of the same fields using
   `invokeExtractionAI`-style routing. When `OLLAMA_URL` is set this runs on
   GaryBuilt (qwen2.5:14b) for free; when unset/down it falls back down the
   existing chain — for the BULK run, treat cloud fallback as a STOP condition
   (log + skip), not a silent cost leak: bulk extraction only proceeds on
   `ai_final_provider='ollama'` unless `W51_ALLOW_CLOUD=1`.
3. **Adjudication:** field-level agreement between A and B (post-normalization —
   reuse resolver `/normalize` company-name core, not raw strings) → write with
   `source='party_extract_agree'`, confidence 0.60. A-only (LLM abstained or
   disagreed) → `source='gliner_extract'`, confidence 0.55 (the plan's number).
   B-only → do NOT write (span-less LLM claims are hallucination-shaped); log to
   the disagreement channel. All disagreements land in a reviewable table
   (`party_extract_disagreements` or equivalent) — that's future training signal,
   same philosophy as entity_match_labels.

## Write discipline (non-negotiable, same as everywhere)

- Writes go through the **field-priority guard**: register `party_extract_agree`
  (0.60) and `gliner_extract` (0.55) in `field_source_priority` BELOW
  `costar_sidebar` (70) — fill-blanks only, never override. `record_only` first.
- Every write → provenance row with the span text + note offsets in metadata
  (the audit's requirement: extraction claims must be groundable).
- Idempotent + reversible: batch tag, and a ledger table mirroring the
  w43_splink_batch pattern.

## Rollout gates (the plan's human gate, kept)

1. Build + unit tests; deploy `/extract-parties`.
2. **Sample run: 100 extractions** (mixed dia/gov, stratified by note length) to
   a review sheet → Scott approves before any bulk write. Include per-row:
   note excerpt, channel A spans, channel B JSON, agreement verdict, would-write.
3. Bulk backlog run AFTER approval, batched + resumable, ollama-gated as above.
4. Success metric (plan): missing-broker rate on live sales drops >20 points.
   Report before/after per domain.

## Operator prerequisites (Scott — likely already partially done)

- GaryBuilt: Ollama + qwen2.5:14b installed per docs/setup/garybuilt-local-model.md;
  tunnel up (Cloudflare Access or Tailscale).
- Railway LCC env: `OLLAMA_URL`, `OLLAMA_MODEL=qwen2.5:14b`, (`OLLAMA_API_KEY` if
  CF Access). Flip `feature_flags_registry.OLLAMA_EXTRACTION` → `on` when set.
  Verify with one intake: per-artifact diagnostics show `ai_final_provider: "ollama"`.
- If the tunnel is NOT up yet, the build still ships end-to-end (sample run may use
  the cloud chain — 100 calls is cheap); only the BULK run hard-requires ollama.

## Docs (update as part of the unit)

- ROLLOUT_STATUS W5.1 row + session log; W5.3 row → note GaryBuilt realizes its
  infrastructure (evaluation = measured cutover of intake extraction, separate).
- `docs/setup/garybuilt-local-model.md` roadmap: check off phase-2 items this
  unit delivers.
- Register any new env flags in `feature_flags_registry` (the inert-feature rule).
