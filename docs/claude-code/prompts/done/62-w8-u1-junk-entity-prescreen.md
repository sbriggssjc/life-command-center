# Prompt 62 — W8 U1: Ollama junk-entity pre-screen (hygiene campaign, unit 1)

**Grounding (read first):** `docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md` Part 2 (Scott's directive
+ doctrine), `docs/setup/garybuilt-local-model.md` §7 (near-term item 1 — this unit), and the
**existing prompt-32 machinery**: LCC Opps migration + `/api/ollama-clean-assist-tick` + Decision
Center hints + `OLLAMA_CLEAN_ASSIST` flag (applied live 2026-08-04, flag OFF). **Extend that
machinery — do not build a parallel agent.** Sequence: this is U1 of four units; U2–U4 come later,
each its own prompt.

## Doctrine (non-negotiable)

Ollama PROPOSES; deterministic gates or human lanes DECIDE. No LLM in auditable gates. Every proposal
evidence-grounded (quote the offending value verbatim). NEVER hard-delete; NEVER delete
FK-referenced rows (hazard class, hit 3×). Soft-retire only, reversible ledger, batch-tagged.
Flag-gated with `feature_flags_registry` rows IN the migration (36y rule).

## Do

1. **Scope pass (deterministic first):** enumerate the target entity tables across dia
   (`zqzrriwuavgrquhisnoa`), gov (`scknotsqkcheojiaewwh`), ops (`xengecqvemvfknjvbvrq`) — owners /
   true_owners / contacts / entities-class tables. Deterministic pre-filter finds CANDIDATES cheaply
   (regex/heuristics: test/asdf/gibberish tokens, all-digits names, bookkeeping stubs like "DO NOT
   USE", zero-relationship rows). Ollama (via the `invokeExtractionAI` seam) then scores ONLY the
   candidate pool with verdict-proposal + confidence + verbatim evidence quote. Batch sizing per
   GaryBuilt throughput ~1–3s/call; nightly off-hours cron (mirror the w44 retrain cron pattern).
2. **Proposals → `junk_review` lane:** new table (ops) `junk_entity_review` (domain, table, pk,
   proposed_verdict dismiss/rename/parse_contact/keep, confidence, evidence_quote, model, batch_id,
   status) + a Decision Center sub-lane rendered via `renderFederatedLane` (mirror the
   `sf_link_candidate` lane shape). One-click confirm/reject; verdicts are HUMAN. Learn from the
   ~2,000 accrued `junk_entity_name` human decisions: use them as few-shot/rubric grounding AND
   exclude already-decided rows.
3. **Apply path (deterministic writer, human-gated):** accepted `dismiss` → soft-retire (status
   column / retired_at, provenance event, reversible batch ledger `junk_review_batch`); accepted
   `rename`/`parse_contact` → the existing lane semantics. FK-referenced rows: apply path must check
   references and route to a conflict card instead of retiring.
4. **Flags:** `W8_U1_JUNK_PRESCREEN` (cron gate, default OFF) registered in the migration. Dry-run
   default on the tick route (GET dry-run / POST apply, mounted in `server.js` like the W5.2 ticks).
5. **Tests + report:** planner unit tests (candidate filter, FK guard, verdict application), and the
   tick's dry-run must emit a per-domain count report (candidates found / scored / proposed by
   verdict) so the first real run can be sampled by Scott before the flag flips.

## Acceptance

- Migration applies clean (dry-run counts reported); flag OFF; cron no-ops until flipped.
- Dry-run on live data yields a sampleable proposal sheet; zero writes without human verdict.
- Every applied verdict: provenance event + ledger row + entity_match_labels-style audit trail.
- Update `docs/audits/ROLLOUT_STATUS.md` (new Wave 8 section, U1 row) + move this prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
