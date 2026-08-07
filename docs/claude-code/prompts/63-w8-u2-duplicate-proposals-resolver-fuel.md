# Prompt 63 — W8 U2: Ollama duplicate proposals → resolver fuel (hygiene campaign, unit 2)

**Grounding (read first):** `docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md` Part 2 (U2),
`docs/setup/garybuilt-local-model.md` §6–7, and the shipped U1 machinery (PR #1599:
`api/_shared/junk-prescreen.js`, `/api/junk-prescreen-tick`, `junk_review_batch` ledger pattern).
Reuse U1's shapes (pure planner module, GET dry-run / POST flag-gated apply tick, nightly cron,
in-migration flag registration) — don't fork a new pattern.

## Doctrine (non-negotiable)

Dupes are the RESOLVER's job (Fellegi-Sunter `/match` + entity_match_labels corpus) — Ollama
**assists, never replaces**. Ollama emits CANDIDATE PAIRS only; it never merges, never scores the
auditable band. Accepted pairs become `entity_match_labels` rows (training fuel — the W4 loop; the
W4.3 finding was that corpus negatives are too easy, and W4.4's drift alerts are waiting on exactly
these hard cases). No LLM in auditable gates. Evidence-grounded. Reversible. Flag-gated.

## Do

1. **Target the blocking-rule blind spot (deterministic scoping first):** the resolver's token
   blocks + embedding-KNN skip name/address near-misses that share no block. Build a deterministic
   candidate-pair generator for the NEAR-MISS pool the resolver never sees: per domain (ops entities,
   gov/dia true_owners), pairs with (a) high trigram/levenshtein name similarity but no shared token
   block, (b) same normalized address + different names, (c) abbreviation/expansion patterns
   (e.g. "DVA" ↔ "DaVita"). Exclude pairs already in `entity_match_labels`, already merged, or
   already in the resolver review pool. Cap the pool per run (GaryBuilt ~1–3s/call, nightly).
2. **Ollama second look (proposal-only):** via `invokeExtractionAI({ prompt, surface: 'clean_assist' })`,
   ask same-party / distinct / unsure + confidence + verbatim evidence for each candidate pair.
   `unsure` and low-confidence → drop (logged count only). Never let the LLM verdict write anything.
3. **Emit to the EXISTING resolver review pool**, not a new lane: proposed pairs land where the W4.3
   `sf_link_candidate`-style review already lives (the resolver review pool / Decision Center
   merge-candidate lane — reuse `v_lcc_person_email_merge_candidates`-class surfacing if it fits, or
   the sf_link review-lane shape). Tag rows `seeder='w8_u2_ollama_pair'` + batch id + both entity
   refs + evidence quote. Human verdict flows exactly as today: accepted → `entity_match_labels`
   (`same_party`/`distinct`) → nightly W4.4 retrain consumes them.
4. **Ledger + flags:** reversible batch ledger (U1's `junk_review_batch` pattern or a sibling),
   `W8_U2_DUP_PAIRS` flag (default OFF) registered in-migration, nightly cron no-oping while off,
   GET dry-run with per-domain counts (pairs generated / scored / proposed / dropped-unsure).
5. **Tests:** pair-generator unit tests (block-miss detection, exclusion joins, cap), prompt-builder
   test, verdict-flow test proving an accepted pair writes `entity_match_labels` with the new seeder
   and NEVER a merge. Full suite stays green (3 known pre-existing failures).

## Acceptance

- Migration applies clean; flag OFF; dry-run yields a sampleable pair sheet with evidence quotes.
- Zero merges from this unit ever — only labeled pairs via human verdict.
- W4.4 corpus reader picks up `seeder='w8_u2_ollama_pair'` rows (verify the seeder-IN list).
- ROLLOUT_STATUS Wave 8 U2 row + move this prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
