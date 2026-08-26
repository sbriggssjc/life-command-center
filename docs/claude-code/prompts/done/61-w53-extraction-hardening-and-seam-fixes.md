# Prompt 61 — W5.3 follow-up: ollama extraction hardening + seam fixes

**Grounding (read first):** `docs/audits/W5_3_LOCAL_LLM_EVALUATION_2026-08-06.md` (the measured
verdict), `docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md` Part 1, `docs/setup/garybuilt-local-model.md`
§7 doctrine. All findings below were measured live on LCC Opps 2026-08-06.

## Problem (measured)

1. **Recall/schema failure on intake OM extraction under ollama (qwen2.5:14b).** Same-window OM-class
   comparison vs cloud-fallback extractions: NOI 1/24 vs 13/14, tenant_name 1/17 vs 9/14,
   hvac/roof/structure responsibility keys NEVER emitted, sale-comp key drift (`seller_name`,
   `sold_price`, `sold_cap_rate` on OMs), PSAs/listing agreements/valuation proposals misclassified
   `om`, one signature-block wrong-party grab. No fabrication observed (good — preserve that).
2. **17/50 attributed artifacts since Aug 1 never tried ollama** — `ai_chain` starts at `edge`
   (status 400), i.e. `OLLAMA_URL` unset in the executing process (scattered Aug 1/3/5 — likely one
   of the two Railway services). Also: that edge primary 400s on every such call (pre-existing).
3. **No provider stamp on the extraction snapshot** — attribution only in
   `staged_intake_items.raw_payload.extraction_result.diagnostics[]`, and only 88/238 items carry it.

## Do

1. **Harden the intake extraction prompt for the local model** (`intake-extractor.js` prompt builder;
   keep the cloud chain's prompt working — one prompt, model-agnostic, or a local variant behind the
   seam):
   - Strict JSON schema in-prompt: enumerate the FULL expected key list (address/city/state/zip,
     tenant_name, noi, cap_rate, asking_price, building_sf, lot_sf, year_built, lease_* incl.
     hvac/roof/structure/parking responsibilities, expense_structure, brokers, parcel), `null` for
     absent — no extra keys, no sale-comp keys unless document IS a sale record.
   - Doc-type rubric with the real vocabulary (om / marketing_brochure / psa / listing_agreement /
     valuation_proposal / broker_email / flyer / unknown) + 1-line definitions — stop PSA→om.
   - Party-role guard: signature blocks / broker lines are NOT seller/buyer.
   - Consider Ollama's native structured output (`format: json` / json_schema) via
     `invokeOllamaExtraction` — verify qwen2.5:14b behavior; fall back to prompt-only if it degrades.
   - Preserve abstain-don't-fabricate.
2. **Provider stamp:** write `ai_final_provider` + `ai_fell_back` into the extraction snapshot itself
   (`staged_intake_extractions.extraction_snapshot._provider` or sibling column) so W5.3-style grading
   never depends on the raw_payload join. Backfill not required.
3. **Find the OLLAMA_URL-less process:** audit which services/crons invoke the intake extractor
   (tranquil-delight vs standalone MCP vs edge fn) and report which one lacks the OLLAMA_* env
   (report → Scott sets env; don't guess-set). While there, log a loud one-line warn when
   `invokeExtractionAI` runs without `OLLAMA_URL` while `OLLAMA_EXTRACTION` flag is on.
4. **Triage the always-400 edge primary** (chain stage `primary`, provider `edge`, status 400 on all
   17 calls) — root-cause and fix or document why it 400s on extraction prompts.
5. **Per-surface gating (needed for Scott's approved interim revert):** today the seam is gated only
   on `process.env.OLLAMA_URL` (global), so reverting intake to cloud would also revert W7.2/7.4/7.5.
   Add a per-surface knob (e.g. `invokeExtractionAI({ prompt, surface })` + env/flag map like
   `OLLAMA_SURFACES=summaries,roles,narrations,next_step`) so intake can run cloud-primary while the
   narrative surfaces stay local. Default preserves current behavior.
6. **Tests:** prompt-builder unit tests (schema keys, doc-type rubric present), snapshot-stamp test,
   seam warn test. Keep 116-green comps suite untouched.

## Acceptance

- Re-run guidance for Cowork: after redeploy + ~50 fresh intakes, the W5_3 report queries show
  ollama OM field coverage within 15pts of cloud on noi/tenant/cap; zero sale-comp keys on OM docs;
  zero `edge-first` chains while the flag is on; every new extraction row provider-stamped.
- Verdict row update in `docs/audits/ROLLOUT_STATUS.md` (W5.3 re-grade note) after measurement.

Doctrine: no LLM in auditable gates; reversible; never fabricate; commit with the repo trailer.
