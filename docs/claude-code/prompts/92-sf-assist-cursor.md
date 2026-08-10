# Prompt 92 — micro: sf-link-assist treadmill (no annotated-exclusion in the candidate fetch)

**Grounding (live, 2026-08-10):** the 4:50 cron succeeded two nights running but total
`w9_3_sf_assist` annotations is stuck at 20 — and all 20 rows carry LAST night's
`source_run_id` (`w93a_20260810045022_…`): the tick re-scores and re-upserts the SAME first-20
candidates nightly (≈20 wasted GaryBuilt calls/night) instead of walking the 3.3k pool. Third
instance of the walk-the-pool miss (U1 prompt-84 scan, U5 prompt-83 window — same class).

## Do (small)

1. The candidate fetch excludes subject_refs already annotated (anti-join on
   `lcc_clean_assist_proposals` source='w9_3_sf_assist') — or a keyset cursor per the 83/84
   pattern; annotated-exclusion is simpler and self-healing here since the pool is finite and
   verdict-consumed.
2. Cheap pre-check remains for safety: skip-before-LLM if an annotation exists for the subject
   (belt + braces vs paying 16s to overwrite).
3. Surface `already_annotated_excluded` in the response counts.
4. Structural test pinning the anti-join (this class has now recurred 3× — consider a shared
   test helper asserting every nightly LLM tick's fetch excludes its own output).

Acceptance: next run annotates 20 NEW subject_refs (total 40, two distinct run_ids); nightly
walks the pool ~20/night. Commit with the repo trailer.
