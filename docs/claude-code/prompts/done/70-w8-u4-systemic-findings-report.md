# Prompt 70 — W8 U4: systemic-findings monthly report (hygiene campaign, final unit)

**Grounding:** `docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md` Part 2 (U4) + the LIVE U1/U2/U3
machinery. U4 is the campaign's reporting layer: aggregate the systemic-defect signals that are
already logged but never synthesized, produce ONE monthly doc, feed the W6.6 audit. Numbers are
computed DETERMINISTICALLY; Ollama drafts only the narrative FROM the computed numbers
(W7.2-style no-fabrication: every figure in prose must appear in the computed table — validate,
don't trust).

## Inputs (all exist today; verify counts live before wiring)

- `ingest_write_failures`, `flow_run_failures` — the systemic-error signal nobody synthesizes
- `v_field_provenance_unranked` (schema-drift; known baseline 33) + `v_field_provenance_conflicts`
- `v_lcc_ownership_chain_completeness` + the U3 pool/drain stats (`v_lcc_w8_u3_link_health`)
- Dropped-proposal ratios: `lcc_deal_analysis_dropped_log` (W7.4), `w8_u3_dropped_log` — the
  precision floors
- U1/U2 drain + verdict stats: `v_lcc_junk_prescreen_health`, `junk_entity_review` verdict rates,
  `w8_u2_dup_pair` disposition rates, `entity_match_labels` seeder counts (`w8_u2_ollama_pair`)
- Naming-hygiene backlog counts (from the U1 tick's classifier — persist a monthly snapshot)
- Extraction health: `staged_intake_extractions._provider` mix, fallback rate (post-61 stamps)

## Do

1. **Deterministic aggregator** (`api/_shared/systemic-findings.js`): one function per section
   computing the numbers + month-over-month deltas (persist a monthly snapshot row so deltas exist
   from month 2). Sections: ingest/flow failure clusters (grouped by error signature, top-N),
   provenance drift + conflicts, chain completeness + U3 drain, precision floors (dropped ratios),
   U1/U2 lane throughput + human accept rates, naming-hygiene backlog, extraction provider mix.
   Each finding row carries: metric, value, delta, severity heuristic, and (where applicable) a
   suggested fix-unit one-liner ("candidate Claude Code prompt").
2. **Ollama narrative** (surface `clean_assist`): drafts the executive summary + per-section prose
   FROM the computed table only. **Figure validator (W7.2-style):** every number in the prose must
   match a computed value (string/regex check) — mismatch ⇒ regenerate once, then ship the tables
   with a stock header and log the drop. Never a fabricated number.
3. **Output = one monthly doc** committed to `docs/audits/systemic-findings/YYYY-MM.md` (repo) AND
   inserted as a `research_tasks`-visible artifact or DC digest entry (pick the lighter existing
   surface — do NOT build a new lane; the doc IS the consumer, feeding W6.6). Code-error findings
   formatted as ready-to-send fix-unit stubs.
4. **Schedule:** monthly cron (1st, 05:00 UTC — after the nightly chain), `W8_U4_FINDINGS_REPORT`
   flag OFF in-migration, plus `GET /api/systemic-findings-tick` dry-run returning the computed
   JSON for review before the first flip. Manual POST generates on demand.
5. **Tests:** aggregator unit tests per section (fixture data), figure-validator tests
   (match/mismatch), snapshot/delta test, no-new-lane guard.

## Acceptance

- Dry-run returns the full computed findings JSON with honest zeros where sources are empty.
- First generated doc reviewed by Scott; figures spot-check against the views; flag flips after.
- ROLLOUT_STATUS Wave 8 U4 row + prompt to done/. Wave 8 build-out COMPLETE at that point.

Commit with the repo Co-Authored-By + Claude-Session trailer.
