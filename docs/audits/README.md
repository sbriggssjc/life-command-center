# `docs/audits/` — point-in-time measurements, not current state

**An audit in this directory is not stale for being old — it is stale only if someone cites it as
current state instead of as the record of a measurement taken on a date.** (DOCMAP2, 2026-09-08)

Every file here is a dated diagnosis or a dated fix write-up: "on this date, this population read
this way, and this is what shipped." That is durable as history and NOT durable as a live number —
counts, backlog sizes, and "still open" claims in an audit file drift the moment the next producer
run or migration lands.

## The rule

- **Cite an audit for its MECHANISM (what was wrong and why), never for its live NUMBER.** A count
  quoted from an audit six weeks old should be treated as `title+skim`-grade evidence, not as a
  measurement — re-run the query.
- **Every arc's current state lives on its CANONICAL PAGE**, not in the audit trail. `CLAUDE.md`'s
  "Pointers to canonical docs" section and `docs/os/DOCUMENTATION-MAP.md` are the index; most audit
  write-ups are already cross-linked from there (e.g. `A2_...md` from the A2 section of `CLAUDE.md`,
  `B6d_...md` from the producer-health canonical page). If an audit is NOT reachable from a
  canonical page or `DOCUMENTATION-MAP.md`, that is itself a defect — file it, don't silently fix it
  by writing a new audit.
- **Do not re-classify these 110 files individually.** DOCMAP1/DOCMAP2's per-file STALE/CANONICAL
  verdict system applies to `docs/architecture/` and similar reference pages, which assert *current*
  state. An audit's job is different — it is a dated exhibit, correctly frozen at its own date, and
  the correct fix for a wrong CONCLUSION reached in an old audit is a NEWER audit or a canonical-page
  correction (per `CLAUDE.md`'s own "re-measure a dated blocker before quoting it" doctrine), never
  an edit to the old file's numbers.

## Discoverability check (DOCMAP2, 2026-09-08)

Spot-checked: audits referenced from `CLAUDE.md`'s "Pointers to canonical docs" section and from
arc-specific canonical pages (`docs/architecture/tier0-owner-contact-system.md`,
`docs/architecture/producer-health-and-ci-enforcement.md`,
`docs/architecture/public-records-source-lane.md`, `docs/architecture/entity-identity-and-dedup.md`,
etc.) resolve correctly. **Not exhaustively verified for all 110 files** — see the DOCMAP2 response
for the reached/not-reached boundary.
