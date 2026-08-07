# Prompt 71 — W8 U3 fix round: evidence-assembly depth + different_people verdict

**Grounding:** Scott's first live `GET /api/link-propagation-tick?score=1&n=6` (2026-08-07,
post-#1609). Safety held perfectly (6 honest no_evidence_found, dropped_not_verbatim 0, nothing
fabricated). Two yield defects:

1. **Evidence assembly starving.** Chain pool: 59/60 candidates skipped `no_evidence` at assembly;
   the one scored (gov 11504, Cira Square — a major property) assembled only **459 chars**.
   Person-email evidence 130–296 chars. LCC holds far more for these subjects (domain
   sale/deed rows + notes, intake extraction snapshots, activity_events/correspondence, ORE
   observations). Root-cause which sources the assembler actually reaches: wrong join keys
   (domain property_id vs ops entity linkage via `external_identities`), allowlist 403s swallowed
   (add loud per-source errors like U2's `scan_errors`), or sources simply not queried. Surface a
   per-source hit count in the dry-run (`evidence_sources: {sale_notes: n, intake: n, activity: n,
   …}`) so starvation is visible per run, not inferred.
2. **`different_people` findings discarded.** Person-email pool: model confidently (0.95)
   determined "multiple distinct names share this email" with role `different_people` — but the
   verdict vocabulary only has `link_proposal`/`no_evidence_found`, so a candidate-RESOLVING
   finding is dumped into no_evidence and lost. Per the consumption doctrine a producer's findings
   must have a consumer.

## Do

1. **Evidence assembly:** fix reach per above; keep the char cap but raise the per-source topK if
   sources were unreachable rather than empty. Honest per-source counts in dry-run + tick output.
   If, after the fix, a gap class (e.g. `no_prior_owners_recorded`) is GENUINELY evidence-free
   internally, record that as a measured finding for the U4 report (data-acquisition backlog) —
   don't keep re-scoring it: mark `no_evidence` rows with an evidence-hash so they only re-enter
   when new evidence lands (the existing marker mechanism — verify it covers assembly-level skips,
   not just scored rows).
2. **New verdict `different_people` (person_email pool only):** first-class shape with the same
   verbatim-quote requirement (the quote = the evidence showing distinct names/roles). Disposition:
   proposal to the SAME review lane; on human confirm, the deterministic writer resolves the merge
   candidate as rejected/distinct (however `v_lcc_person_email_merge_candidates` rows are
   dispositioned today — reuse that path; if none exists, a minimal `dismissed_reason` mark on the
   candidate surface, reversible) + an `entity_match_labels` `distinct` row (seeder
   `w8_u3_shared_email`) — MORE hard-negative fuel for W4.4. CHECK constraint updated (still no
   merge/auto-link shape).
3. **Validator unchanged** — verbatim quote required for BOTH link_proposal and different_people;
   no_evidence_found requires NO quote (drop the stray quotes seen on no_evidence rows: if the
   model returns a quote with no_evidence, ignore the quote, keep the verdict).
4. **Tests:** per-source assembly counts, different_people flow (verdict → lane → label write,
   never a merge), no_evidence quote-stripping, assembly-skip marker; existing 36 stay green.

## Acceptance

- Re-run `?score=1&n=6`: per-source evidence counts visible and non-trivially populated for chain
  candidates that have sale/intake history; person-email scored rows produce `different_people`
  proposals (with verbatim quotes) instead of discarded no_evidence; chain rows with genuinely no
  internal evidence stay honestly no_evidence.
- Flag stays OFF until the re-run shows real yield.

Commit with the repo Co-Authored-By + Claude-Session trailer.
