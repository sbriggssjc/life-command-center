# Prompt 90 — W9.3: SF linkage drain + live re-score (unlocks W9.2's donor pool)

**Grounding:** `docs/audits/W9_CONNECTEDNESS_KICKOFF.md`; W4.3/W4.4 rows in ROLLOUT_STATUS (the
splink batch, bands, review lane, retrain loop); prompt-80's assist pattern.
**Sequencing correction (measured 2026-08-08):** W9.2 shipped correctly but both arms are
input-starved — owner contacts don't appear in intake docs (probe: 0/7 sampled names anywhere in
snapshots) and only ~20 blank contacts carry SF identity keys. **SF is where the emails/phones
already live; linkage is the unlock.** True-owner SF coverage today: dia 11% / gov 12%.

## Three workstreams (one prompt, sequenced inside)

1. **Assist-style pre-rank on the `sf_link_candidate` review pool (~3.3k):** port the prompt-80
   annotation pattern — nightly bounded Ollama pass ranks each candidate's likelihood
   (same-party evidence one-liner + confidence), lane sorts easy-first, one-click "assist agrees"
   on the existing verdict path, agree/disagree self-measured into U4. Annotation-only; the
   metadata-only-writer guarantee (80's migration pattern). This makes the 3.3k workable at
   Scott's pace instead of dead.
2. **Live re-score of the 23,817 no_match rows:** W4.3 judged them against the LOCAL SF-account
   registry (15,987 accounts, now stale). Re-score in bounded resumable batches against the
   CURRENT registry (refresh the local registry from the SF sync first — do NOT hit live SF per
   row): new/changed accounts since 2026-07-31 may match. Same conservative bands as W4.3
   (0.9/0.1 — the calibrated-band transfer failure is documented); auto-link only exact/near-exact
   with provenance (`splink_v2` fsp row), needs_review → the same lane (now assist-ranked),
   no_match re-tagged with the new batch id. Reversible ledger (w43-pattern).
3. **Donor handoff to W9.2:** when a link lands (auto or human), ensure the identity key
   propagates to the DOMAIN contact/owner rows W9.2's deterministic arm reads
   (sf_contact_id/sf_account_id/sf_company_id on the right tables — trace what W9.2's donor query
   actually keys on and close any propagation gap). Acceptance metric: count of blank-reachability
   contacts carrying an SF key (baseline ~20) — this number RISING is W9.2's unlock. When it
   crosses a useful threshold, Cowork flips `W9_2_REACHABILITY_HARVEST`.

## Constraints

SF stays minimum-necessary (no cleanup writes to SF; account = org-edge on persons per doctrine).
House tick pattern throughout (windowed, budget-floored, crash-proof, batched lookups, loud
errors). Flags: `W9_3_SF_ASSIST` + `W9_3_RESCORE` OFF in-migration; crons staggered after the
existing chain. Tests: annotation-never-verdict, band conservatism (no auto-link below exact/
near-exact), donor-propagation, ledger reversibility.

## Acceptance

- Dry-runs: assist sample on real candidates (rankings sane); re-score batch report (matched /
  review / no_match deltas vs the refreshed registry); donor-key baseline + projected unlock count.
- Scott reviews → flags flip → nightly drain begins; U4 gains sf-linkage coverage + assist-accuracy
  metrics. ROLLOUT_STATUS W9.3 row; prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
