# LCC Decision Center — design doctrine (Scott, 2026-06-05)

## The objective (verbatim intent)

All manual decisions live in a similar location, **organized by the request
being asked of the user**, so the user knows exactly where to go to move the
property or lead to the next bucket. The pipeline is a series of gates:
anything not ready for the opportunity-creation step sits at the prior step's
decision point until it's ready to move forward — and so on for every stage.
The app should never offer a next-stage CTA early (R6 made this true for
opportunities; this generalizes it), and every advancing decision should be
one click from the place where the question is presented.

## Why now (the two motivating examples)

1. **SPE→parent confirmations** — USGBF's controlling sponsor needs Scott's
   confirmation; new buyer parents need registering; anchor names need
   blessing. Today this lives in a `needs_sf_mapping` flag + a migration
   comment — no surface asks the question.
2. **Stale-vs-current true_owner verdicts** — ARLINGTON VA I FGF shows domain
   true_owner "The Shooshan Company"; Scott believes FGF shells are all Boyd
   today. Is the domain row stale (pre-acquisition) or correct? That's a
   human judgment with a clear verdict set (confirm current / mark stale +
   set new owner / research), and today it has nowhere to live except the
   P0.4 row's generic "Open property →".

## Decision-type inventory (everything we know of, 2026-06-05)

| # | Decision being asked | Where it lives today | Workable scale |
|---|---|---|---|
| 1 | Resolve ownership & connect (entity → SF/contact) | P0.4 queue band (348) | high-value first |
| 2 | Confirm/correct domain true_owner (stale-vs-current) | nowhere (P0.4 context line only) | per-property |
| 3 | SPE→parent: confirm sponsor / register parent / bless anchor name | flags + migration notes (USGBF…) | ~handful, high leverage |
| 4 | Map buyer parent → SF parent account | `lcc_buyer_parents.needs_sf_mapping` (17/24) + research tasks | 17 |
| 5 | Staged-intake review (create property / OCR / discard) | Inbox verdict cards (~457 + flow) | top-N by deal value |
| 6 | Property merges & duplicates | Review Console lane → scattered surfaces (gov 6.9k) | top-N by value |
| 7 | Data conflicts & provenance (incl. sales-price xref) | Review Console lane (13.9k actionable) | top-N |
| 8 | Pending updates (gov state machine) | Review Console lane (2,018) | top-N |
| 9 | Owner-contact links to confirm (SOS weak links) | Review Console lane (44) — already workable | 44 |
| 10 | Chain-to-developer research | research_tasks (100+, daily cron) | rent-prioritized |
| 11 | LLC research queue | dia/gov queues (1,882, stalled outside FL) | blocked on adapters |
| 12 | CMS↔property link suspects (dia) | `v_property_cms_link_suspect` (215) — no surface | 215 |
| 13 | Listing availability confirmations (Sold/Withdrawn/Active) | gov overview lane — **the model done right** | ~33 due |
| 14 | Implausible-value review ($950M class) | suppressed from NBA; flags only | small |
| 15 | Junk entity names (flagged, never deleted) | `metadata.junk_name_flagged` (41) — no surface | 41 |

## Architecture (federate, don't rebuild)

**One surface — the Review Console becomes the Decision Center** (same nav
slot). Lanes keyed by the DECISION TYPE (the ask), never by source table or
domain. Each lane renders the same anatomy:

```
[Question being asked]  e.g. "Who controls this SPE?"
[Subject + context]     entity/property card: name, value, the evidence
                        (true_owner, chain, conflict values, extraction…)
[Verdict buttons]       2-4 one-click verdicts that MOVE THE SUBJECT FORWARD
                        (+ "Research →" / "Skip" escape hatches)
[Workable top-N]        ranked by $ value; universe count demoted to subtitle
```

**The decision record is first-class.** One table (suggest `lcc_decisions`,
or generalize `research_tasks`): decision_type, subject refs (entity /
domain+property / intake), question payload, verdict, decided_by, decided_at,
effects_applied (jsonb trail). Soft-disposition doctrine: decisions are
recorded and reversible, never silent mutations. This is also the audit
trail for "why is this entity in this bucket."

**Verdicts ride existing machinery — no new write paths.** Each verdict maps
to calls that already exist: ensureEntityLink, lcc_buyer_parents upsert,
create-property route, merge functions, lcc_record_listing_check, provenance
RPCs, etc. The Decision Center is a router + recorder, not a new pipeline.

**Gate enforcement generalizes R6.** Every stage transition (intake→property,
property→owner-resolved, resolved→connected, connected→opportunity,
opportunity→cadence) has a readiness predicate; surfaces upstream of an
unmet predicate show the *current* gate's decision, and nothing offers a
later-stage CTA. The queue (P-bands), the detail Next-Step banner, and the
Decision Center lanes must all read the same state source (the R4-C/R6
pattern — one truth, three renderings).

**Automation funnels INTO the same lanes.** Crons that can't auto-decide
(ambiguous matcher hits, conflicting owners, bot-blocked listings) emit
decision rows instead of parking work in hidden statuses. A decision lane is
the standard "human needed" output for every engine — current and future.

## Phasing (matches the R7 prompt)

- **Phase 0 (perf prerequisite):** materialize the buyer-parent rollup +
  resolution-state hot path so the queue/lanes read in ms, not 5-7s.
- **Phase 1:** Decision Center shell + decision record + the two motivating
  lanes (#2 stale-owner verdicts, #3/#4 SPE-parent/SF-mapping) + adopt the
  listing-confirmation lane (#13) as-is. P0.4 rows deep-link into lane #1/#2.
- **Phase 2:** fold the existing Review Console lanes (#5-#9) into the
  anatomy (workable top-N + inline verdicts), surface the surfaceless
  (#12, #14, #15).
- **Phase 3:** gate-predicate sweep (every stage CTA checks readiness from
  the shared state source) + automation→lane wiring for the engines.
