# Prompt 90 — W9.3: SF linkage drain + live re-score (unlocks W9.2's donor pool)

**Status:** ✅ BUILT (flags OFF, awaiting dry-run review → Cowork flip). Session
`claude/sf-linkage-live-rescore`. Dry-run sheet:
`docs/audits/W9_3_sf_linkage_drain_dryrun_2026-08-08.md`. ROLLOUT_STATUS W9.3 row updated.

Grounding: `docs/audits/W9_CONNECTEDNESS_KICKOFF.md`; W4.3/W4.4 rows in ROLLOUT_STATUS (the splink
batch, bands, review lane, retrain loop); prompt-80's assist pattern. Sequencing correction (measured
2026-08-08): W9.2 shipped correctly but both arms are input-starved — owner contacts don't appear in
intake docs and only ~20 blank contacts carry SF identity keys. SF is where the emails/phones already
live; linkage is the unlock. True-owner SF coverage today: dia 11% / gov 12%.

## Three workstreams (one prompt, sequenced inside) — all BUILT

1. **Assist-style pre-rank on the `sf_link_candidate` review pool (~3.3k):** port prompt-80's
   annotation pattern. Nightly bounded Ollama pass ranks each candidate (same-party evidence + confidence),
   lane sorts easy-first, one-click "assist agrees" on the existing verdict path, agree/disagree
   self-measured into U4. Annotation-only (metadata-only-writer guarantee). → `/api/sf-link-assist-tick`,
   flag `W9_3_SF_ASSIST`, store `lcc_clean_assist_proposals` source `w9_3_sf_assist`,
   `v_lcc_w9_3_sf_assist_accuracy`.
2. **Live re-score of the ~23.8k no_match rows:** re-score in bounded resumable batches against the
   CURRENT registry (16,210 accts, grown from 15,987). Conservative bands 0.9/0.1 (calibrated-band
   transfer failure documented); auto-link only exact/near-exact with `splink_v2` fsp provenance;
   needs_review → the assist-ranked lane; no_match re-tagged. Reversible ledger (w43 pattern). →
   `/api/sf-link-rescore-tick`, flag `W9_3_RESCORE`, `w9_3_rescore_log` (domain DBs).
3. **Donor handoff to W9.2:** when a link lands, propagate the identity key to the DOMAIN contact rows
   W9.2's deterministic arm reads. Traced: W9.2 keys on person-level `contacts.sf_contact_id`; W4.3/W9.3
   land org-level owner `sf_account_id`/`sf_company_id` → the gap is an account→contacts expansion via
   the SF-contact bridge (unique name match, fill-blanks). → `/api/sf-donor-handoff-tick`, flag
   `W9_3_DONOR_HANDOFF`, `w9_3_donor_handoff_log`. Acceptance metric (blank contacts carrying an SF key,
   baseline 20) trended in `v_lcc_w9_3_donor_coverage` — rising = W9.2 unlock → flip
   `W9_2_REACHABILITY_HARVEST`.

## Constraints (met)

SF minimum-necessary (no cleanup writes to SF; account = org-edge). House tick pattern throughout
(windowed, budget-floored, crash-proof, batched lookups, loud errors). Flags OFF in-migration; crons
staggered after the existing chain. Tests (`test/w9-3-sf-linkage.test.mjs`, 44 pass):
annotation-never-verdict, band conservatism (no auto-link below exact/near-exact), donor-propagation,
ledger reversibility, agree/disagree measurement.

## Acceptance (met)

- Dry-runs: WS2 live probe = 5/162 top-priority gov names exact-unique auto_link, 0 ambiguous
  (conservative gate validated); WS3 donor baseline = gov 5 / dia 15 SF-keyed blanks + 2,305 blank
  contacts already under an SF-linked owner (addressable pool); WS1 model sample runs post-deploy
  (needs Ollama egress).
- Scott reviews → flags flip → nightly drain begins; U4 gains sf-linkage coverage + assist-accuracy
  metrics.
