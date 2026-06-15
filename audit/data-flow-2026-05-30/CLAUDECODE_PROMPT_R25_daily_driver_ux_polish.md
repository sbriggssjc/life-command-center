# Claude Code — R25: daily-driver UX polish (order by the value we compute + de-junk P-CONTACT)

## Why (live UX walk 2026-06-15)
The daily-driver surfaces are strong — Today/NEXT BEST ACTION is value-ranked, the
Priority Queue's "DO THIS FIRST" leads with the P-BUYER rollups (R14/R5), and
P-CONTACT cards show the R17 connected-property value. But the walk found the
**value ranking is computed and displayed but doesn't drive the in-band display
order**, and junk pollutes the prospecting list. The backend work (R11/R14/R17) is
all there; this is the last mile of presentation.

## Unit 1 (HIGH) — sort the connect bands by the value the cards already show
Live evidence: in P-CONTACT, the highest-value targets (Northwestern Mutual $26.1M,
Foulger Pratt $24.3M, Jamestown $22.8M, Akridge $21.7M, Gates Hudson $19.5M) appear
FAR DOWN the list, below dozens of $0/no-value entries (Acquest, Capstone, Wharton,
Prologis, …). The band is ordered by overdue/insertion, not by `rank_annual_rent`.
- In the Priority Queue page render (`ops.js`) and/or the items query
  (`admin.js handlePriorityQueueList` / the band-detail fetch), order each band by
  **`rank_annual_rent` DESC NULLS LAST** (tie-break on days_overdue) so the
  highest-value targets the cards already display sit at the TOP. Apply to P-CONTACT
  AND P0.4 (the big connect bands) — and confirm the touch bands (P1-P8, P-BUYER)
  are already value-ordered (they appeared to be). The data is there
  (`v_priority_queue_enriched.rank_annual_rent`); this is purely the ORDER BY the UI
  reads.

## Unit 2 (MEDIUM-HIGH) — filter junk out of P-CONTACT
Live evidence of non-targets surfacing as prospecting contacts: `Realtor`,
`Description:`, `Office | Investment Specialist`, `SVN | Commercial Advisory Group`,
`Realty Pros Commercial`, `Mexico`, `Paris, PAR 75009`, `Pedregal 24 oficina 423`,
`GSA (US Gov't)`.
- Exclude `metadata.junk_name_flagged = true` entities from P-CONTACT (the R11
  follow-up, never done) — at the `v_priority_queue_live` P-CONTACT branch.
- Extend the entity-name guard (`isJunkEntityName` / a new owner/prospect filter)
  for the live patterns: bare role labels (`Realtor`, `Description:`,
  `Office | …`, `… Specialist`), brokerage-firm markers (`SVN |`, `… Commercial
  Advisory`, `Realty Pros …`), locale/address fragments (`Paris, PAR \d`, bare
  country names, `… oficina …`), and the GSA-self artifact (`GSA (US Gov't)` as a
  prospect target). Anchored so legit firm names aren't false-positived.
- These shouldn't be prospecting targets; route them to the junk lane / exclude from
  the band rather than show them.

## Unit 3 (LOW) — reconcile the two sync-error widgets on Today
"Sync Errors 0" (TEAM SIGNALS) and "SYNC ERRORS 2638" (TEAM PULSE) contradict on the
same page. Point both at one source and confirm the real number (the 2,638 is likely
the all-time `ingest_write_failures`/`sf_sync_log` total mislabeled as current — show
a bounded recent window, consistent with the cron-health 24h convention).

## Unit 4 (LOW) — daily-briefing market-intelligence component
The briefing shows "Partial · Unavailable: global_market_intelligence.structured_payload
/ html_fragment" persistently. Diagnose why that fragment never loads (the
`lcc-briefing-intel-snapshot` cron output / the consumer) and either fix or hide the
perpetually-empty section.

## Unit 5 (DECIDED doctrine — Scott, 2026-06-15) — NBA = data-gap cockpit, Queue = BD cockpit; keep them DISTINCT
Decision: the two surfaces answer DIFFERENT questions and stay separate — do NOT
converge them, do NOT blend outreach into the Today rail.

The Today "NEXT BEST ACTION" rail is, structurally, a **data-quality gap queue ranked
by property value** (it reads `research_tasks` / the data-gap views; it never contains
an outreach action). Today it is MISLABELED — "NEXT BEST ACTION" implies it weighs
outreach vs data-fix, which it cannot. Per Scott's decision, make the label honest
rather than changing what it ranks:
- **Rename the Today rail** from "NEXT BEST ACTION" to a data-gap framing, e.g.
  **"Top Data Gaps to Close"** (or "Data to Connect" — pick the clearest), with a
  one-line subhead like "highest-value records missing ownership/agency data." Keep
  its current property-value ranking — that's correct FOR a data-gap queue (close the
  gaps on your biggest assets first).
- **Leave the Priority Queue "DO THIS FIRST" exactly as the BD-action cockpit** —
  P-BUYER / outreach / opportunity-opening, value-ranked by relationship value. It
  remains the place the operator goes to decide who to pursue.
- **Do NOT** add outreach to the Today rail and do NOT re-rank the NBA by BD value.
  Two tools, two questions: Today = "what data should I connect," Queue = "who should
  I pursue." This is intentional, not a coherence bug.
- Copy/label only — no ranking-algorithm change, no schema change. If there's a shared
  header/legend implying the two should match, adjust the wording so they read as
  complementary tools, not competing "first actions."

## House rules
≤12 `api/*.js`; `node --check`; suite green. Unit 1 is an ORDER BY change (no schema);
Unit 2 is a view predicate + guard extension (additive). Verify live: P-CONTACT shows
$26M/$24M/$22M targets at the top; junk names gone from the band; sync-error widgets
agree. Ships on the Railway redeploy (+ the view change applied to LCC Opps).

## Bottom line
The cockpit is built and surfaces everything; R25 makes the eye land on the
highest-value work first and clears the noise — the last mile of "guide where to
spend time."
