# Prompt 89 — TrafficMetrix misparse: quarantine the class + guard the sidebar parser

**Grounding (live forensics, Cowork 2026-08-08):** Scott found a U3 person_email card whose
"evidence" is street names. Root cause: a sidebar/CoStar capture (2026-05-09) parsed a property
page's **TrafficMetrix traffic-count table as a contact list** — every street name / column label
("Collection Street", "Traffic Vol", "Last Measured", "Made with TrafficMetrix® Products") became
a PERSON entity, and all 16 got stamped with the one real email on the page
(`rehmer@ehmergroup.com` — Richard Ehmer, a real broker; James Devincenti also real, same net).
Scale (measured): **17 street-label person entities, 7 email clusters with ≥6 members (max 16),
newest 2026-05-23** — dormant ~2.5 months, but the graph contamination persists and the U3
person_email pool is feeding garbage clusters to the LLM. Anchor example: entity
`6fedfbc1-b80e-4484-bb0a-d14ca66aa34e` (name "Made with TrafficMetrix® Products", person, dia).

## Do

1. **Quarantine via the EXISTING U1 lane (no new machinery):** a one-shot seeder writes the
   misparse class into `junk_entity_review` as DETERMINISTIC dismiss proposals (heuristic
   `tm_misparse`, provider 'none', evidence = the verbatim name) — the class detector: person
   entities whose name matches street-suffix (`\m(St|Ave|Blvd|Hwy|Pkwy|Aly|Walk|Dr|Ln|Rd)\.?$`) or
   TM vocab (`Traffic Vol|Last Measured|Cross Street|Collection Street|Made with TrafficMetrix`),
   EXCLUDING real-name members of the clusters (Richard Ehmer / James Devincenti class — anything
   that parses as First Last with no street token). Human confirms in the lane; soft-retire as
   usual (reversible).
2. **Un-stamp the fanned-out email:** on confirm of a tm_misparse dismiss, the writer also clears
   `rehmer@`-style emails from the retired junk member (provenance-logged, reversible) so the real
   broker's email stops binding phantom people. The REAL members keep theirs.
3. **Sidebar parser guard (even though dormant — belt+braces):** the contact-extraction path
   rejects candidate names matching the street/label patterns AND caps one-email fan-out (a single
   page email attaching to >4 parsed contacts = suspect, route to review, don't mint). Regression
   fixture = the verbatim 16-name TrafficMetrix cluster. Confirm from capture history whether the
   misparse path is truly dead or just quiet.
4. **U3 pool hygiene:** person_email candidates exclude clusters with junk-flagged/quarantined
   members (don't spend LLM cycles or lane clicks adjudicating garbage); also exclude clusters
   whose member names trip the misparse detector, pending quarantine.
5. **Lane count quirk:** the U3 lane header read "1 shown · 0 workable in this lane" while showing
   a workable card — trace the `workable` counter and fix the mismatch.
6. **Tests:** class detector (streets caught, "Richard Ehmer" NOT), fan-out cap, pool exclusion,
   seeder idempotency.

Acceptance: the 15 phantom members of the rehmer@ cluster appear in the junk lane as deterministic
dismisses; post-confirm the cluster resolves to Richard Ehmer (+ any real members); sidebar guard
fixture green; U3 stops surfacing junk clusters; lane counter honest. Commit with the repo trailer.
