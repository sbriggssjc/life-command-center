# Prompt 69 — W8 U3: connection propagation (evidence-grounded link proposals)

**Grounding (read first):** `docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md` Part 2 (U3), the LIVE
U1/U2 machinery (this is unit 3 — reuse their shapes: pure planner, GET dry-run / `?score=1&n=` /
POST flag-gated tick, bounded+resumable scoring, nightly staggered cron, in-migration flag,
distribution-style sanity guards), and the W7.4 verbatim-evidence validator +
`lcc_deal_analysis_dropped_log` pattern (the free precision floor).

**PREMISE CORRECTION (verified live 2026-08-07):** `lcc_chain_unresolvable` is EMPTY (0 rows) —
do NOT build against it. The live connection-gap surfaces are:
- **`v_ownership_chain_worklist` — 3,405 rows** (ops), ranked by `rank_value`, keyed
  (source_domain, source_property_id, current_owner_entity_id), with `gap` (e.g.
  `developer_unidentified`), `suggested_research_type` (e.g. `trace_ownership_to_developer`),
  chain context (true_owner_name, earliest_known_owner, owner_links).
- **`v_lcc_person_email_merge_candidates` — 257 rows** (already-computed person-merge candidates).

## Doctrine

Ollama PROPOSES a missing link ONLY from evidence LCC already holds, quoted VERBATIM (W7.4-style
validator: the quote must appear in the source text or the proposal is dropped and logged —
never shipped). Human confirm lane decides; a deterministic writer applies with provenance
(fill-blanks, `field_source_priority` row registered in the migration — `v_field_provenance_unranked`
must stay 0). Never fabricate: no evidence found ⇒ no proposal (counted). No web search
(`owner-contact-websearch` is PAUSED — internal evidence only).

## Do

1. **Value-gate the pool (producer/consumer doctrine):** worklist rows with `rank_value > 0`,
   processed in rank order, top-N per nightly run. Zero-rent/zero-rank rows only after the valued
   pool drains. Email-merge candidates are a second, smaller pool (257) — same pipeline, different
   proposal type.
2. **Evidence assembly (deterministic, per gap row):** gather what LCC already holds for that
   property/entity — domain sale/deed rows + `sale_notes_raw`/`notes`, ops `activity_events` /
   correspondence summaries, intake extraction snapshots, entity_relationships neighborhood,
   ORE observation stores. Bounded (~topK snippets, chars capped for GaryBuilt). If assembly finds
   nothing: `no_evidence` counter, NO LLM call (don't burn 16s to learn nothing).
3. **Ollama proposal (surface `clean_assist`):** given the gap (e.g. "developer unidentified for
   4635 Binz Engleman Rd; chain: Alliance Equities → … → SMBC Leasing") + evidence snippets,
   propose the missing link (entity name + role + which chain position) with a VERBATIM quote and
   source pointer. Verdict shapes: `link_proposal` / `no_evidence_found`. Validator: quote must be
   a substring of the supplied evidence (normalize whitespace only) — fail ⇒ drop + log to a
   `w8_u3_dropped_log` (the precision-floor metric, W7.4 pattern).
4. **Confirm lane + deterministic writer:** proposals land in a `w8_u3_link_review` table surfaced
   through the Decision Center (reuse the federated-lane shape; can fold into the ownership-chain /
   research lane if one fits). On human accept: the writer creates the `entity_relationships` edge /
   fills the worklist gap field via the provenance path (`lcc_merge_field()` semantics, new
   `field_source_priority` row for source `w8_u3_link_propagation` at a rank below all record
   sources), reversible batch ledger. On reject: labeled + retained (rubric fuel). NEVER auto-write.
5. **Flags/cron:** `W8_U3_LINK_PROPAGATION` (OFF, in-migration), nightly cron staggered AFTER U1/U2
   (e.g. 4:10 UTC — GaryBuilt is serial), bounded batch (~15/night; evidence assembly makes calls
   longer than U1/U2), resumable scored-marker keyed (domain, property_id, gap, evidence-hash) so a
   row re-scores only when its evidence changes.
6. **Tests:** evidence-assembly bounds, verbatim-validator (accept substring / reject paraphrase),
   no-evidence short-circuit, writer-provenance test (fsp row present, unranked view unaffected),
   value-gate ordering, zero-merge/zero-fabrication structural guards.

## Acceptance

- Migration clean, flag OFF, dry-run shows pool counts by gap type + a scored sample where every
  proposal carries a verbatim quote that string-matches its evidence; `no_evidence_found` honest.
- `v_field_provenance_unranked` = 0 after migration (fsp row registered).
- Scott reviews `?score=1&n=` sample → Cowork flips flag after it passes.
- ROLLOUT_STATUS Wave 8 U3 row + move prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
