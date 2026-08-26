# Prompt 95 — micro: extend the misparse detector to sentence-fragment/doc-label "names"

**Grounding (Scott's U3 lane review, 2026-08-11):** several person_email clusters contain
sentence fragments and OM field-labels minted as PERSON records — live examples from the lane:
"The sale price RBA were verified with listing broker...", "The deed was unavailable at the time
of publication", "Income & Expenses", "Expenses", "Buyer information not available", "Sale Notes",
"Senior Managing Director Investments" (bare title), "Associate Director Investments". Same
disease as the TrafficMetrix misparse (prompt 89) with different vocabulary — the 89 detector
covers street-suffix + TM vocab only. Scott is REJECTING these clusters manually (confirming
would pollute entity_match_labels with junk-name pairs).

## Do (small — extend `api/_shared/tm-misparse.js`, don't fork)

1. **New detector classes in `isMisparseName`:** (a) `sentence_fragment` — name is
   sentence-shaped: >5 words, contains verb/stopword patterns ("was|were|the|of|at|with|not
   available"), or ends mid-clause; (b) `doc_label` — matches OM/sale-record vocabulary
   (Income & Expenses, Expenses, Sale Notes, Buyer information, Seller information, Renewal
   Options, Lease Notes, Property Description...-class exact/near-exact labels); (c) `bare_title` —
   the name is ONLY a job title (Senior Managing Director..., Executive Vice President, Associate
   Advisor...) with no personal-name token. Keep the never-flag-clean-"First Last" guarantee +
   fan-out value-gate from 89.
2. **Re-run the seeder** (`?_route=tm-misparse-seed`, same idempotent path — extended classes flow
   into the junk lane as deterministic dismisses; report would-seed counts by class in dry-run).
3. **U3 pool + sidebar guard inherit automatically** (both call the shared detector — verify with
   the existing structural tests; add fixtures from the verbatim examples above).
4. **Un-stamp semantics carry over** (fan-out email clearing on confirm, per 89).

Acceptance: dry-run lists the fragment/label/title phantoms (real people untouched — fixture the
live cluster members like "Jane G. Polen" who must NOT flag); post-apply they land in the junk
lane; U3 stops proposing clusters containing them. Commit with the repo trailer.
