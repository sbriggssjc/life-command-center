# Prompt 63 — W8 U2: Ollama duplicate proposals → resolver fuel (hygiene campaign, unit 2)

**Status: ✅ DONE 2026-08-07** (branch `claude/ollama-dupe-proposals-resolver-awwyyi`).

Grounding: `docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md` Part 2 (U2), the shipped U1 machinery
(`api/_shared/junk-prescreen.js`, `/api/junk-prescreen-tick`, `junk_review_batch`).

## Doctrine (non-negotiable)
Dupes are the RESOLVER's job (Fellegi-Sunter `/match` + `entity_match_labels` corpus). Ollama emits
CANDIDATE PAIRS only — never merges, never scores the auditable band. Accepted pairs become
`entity_match_labels` rows (W4 loop; W4.3 found corpus negatives too easy → hard-negative `distinct`
pairs are the value). No LLM in auditable gates. Evidence-grounded. Reversible. Flag-gated.

## What shipped
1. **Deterministic near-miss generator** — `api/_shared/dup-pair-planner.js` (NO LLM). Over ops
   `entities` + gov/dia `true_owners`, per domain, generates the blind-spot pool the resolver's
   token-blocks + embedding-KNN skip: (a) high trigram/levenshtein name similarity with **no shared
   word token**, (b) same normalized mailing address / different names, (c) abbreviation/expansion
   (known map DVA↔DaVita + initials match). Prefix+suffix blocking (O(n·bucket), not O(n²)). Excludes
   identical cores and any pair that shares a resolver token block. Capped per run.
2. **Ollama second look (proposal-only)** — `invokeExtractionAI({surface:'clean_assist'})`:
   same_party / distinct / unsure + confidence + verbatim evidence. `unsure` + below-floor
   (`DUP_PAIR_MIN_CONFIDENCE`, 0.6) dropped (counted only). The LLM verdict writes nothing.
3. **Emit to the EXISTING resolver review pool** — proposals land in `w8_u2_dup_pair`, surfaced
   through the `owner_reconcile` Decision-Center lane as a **4th folded seeder `w8_u2_ollama_pair`
   (NOT a new lane)**. A human verdict → `writeEntityMatchLabel` (`same_party`/`distinct`) →
   nightly W4.4 retrain. The verdict branch dispositions the proposal row and **never calls
   `lcc_merge_entity`** — ZERO merges from this unit.
4. **Ledger + flags** — reversible `w8_u2_dup_pair_batch`; flag `W8_U2_DUP_PAIRS` (default OFF)
   registered in-migration (36y); nightly `dup-pair-tick` cron (03:50) no-ops while off; GET dry-run
   with per-domain counts (records / generated / excluded / fresh; scored / proposed / dropped-unsure).
5. **Tests** — `test/dup-pair-planner.test.mjs` (43): block-miss detection, exclusion joins, cap,
   prompt builder, proposal normalization + value gate, and structural guards proving an accepted
   pair writes `entity_match_labels` with the new seeder and NEVER a merge.

## Artifacts
- Migration `supabase/migrations/20260807160000_lcc_w8_u2_dup_pair_proposals.sql` (LCC Opps):
  `w8_u2_dup_pair` (status CHECK has no 'merged'), `w8_u2_dup_pair_batch`, `v_w8_u2_dup_pair_open`,
  `v_lcc_w8_u2_dup_pair_health`, flag, nightly cron.
- `api/admin.js` — `handleDupPairTick` + owner_reconcile seeder-D fetch + verdict branch + subject_ref.
- `server.js` — `/api/dup-pair-tick` mount.

## Acceptance
- ✅ Migration additive/idempotent; flag OFF; dry-run yields a sampleable pair sheet with evidence.
- ✅ Zero merges — only labeled pairs via human verdict (structural test enforces it).
- ✅ W4.4 corpus reader picks up `seeder='w8_u2_ollama_pair'`: the `w41-corpus-export` edge fn reads
  `entity_match_labels` with **no in-repo seeder allowlist** to gate rows, so the new seeder flows
  automatically (verified: no `seeder IN (...)` list exists in-repo to update).
- ✅ ROLLOUT_STATUS Wave 8 U2 row + this prompt in done/.
