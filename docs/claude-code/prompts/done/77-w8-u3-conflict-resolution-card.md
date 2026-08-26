# Prompt 77 — W8 U3 polish: resolution card for ambiguous_entity_match conflicts

**Grounding (live, 2026-08-07):** Scott confirmed the Trammell Crow link proposal; the
canonical-resolve guard correctly found ≥2 existing "Trammell Crow" entities and routed to
`status='conflict'` (`apply_detail: ambiguous_entity_match`, apply-log row written). But
`v_w8_u3_link_review_open` excludes conflict rows → the conflict is a DEAD-END (invisible, no way
to resolve). review_id 2 is sitting there now.

## Do (small)

1. Surface conflict rows: include `status='conflict'` in the U3 lane feed (view or fetch) rendered
   as a **pick-the-survivor card**: show the proposal + the candidate entities (name, domain,
   relationship/portfolio counts so the right one is obvious) + "Mint new" as an explicit option.
   Mirror the sf_link three-way conflict card pattern.
2. Verdict handling: picking a candidate resumes the deterministic writer with that entity id
   (edge + provenance + apply-log + decision 'decided'); "Mint new" mints (canonical_name per 76);
   reject → 'skipped'. Idempotent if clicked twice.
3. Badge: conflict rows count in the U3 lane badge (they're real work).
4. Tests: conflict-in-feed, pick-resume writer path, mint-new path; the 75 structural guard still
   green.

Acceptance: the Trammell Crow card reappears with the candidate list; picking one completes the
edge end-to-end. Commit with the repo trailer.
