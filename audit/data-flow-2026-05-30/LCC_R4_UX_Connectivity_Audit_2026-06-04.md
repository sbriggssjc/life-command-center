# LCC Round 4 — Layout, Design & Data-Connectivity Audit (2026-06-04)

Live walkthrough of every major surface on the deployed Railway app (Today,
Priority Queue, Pipeline/My Work, Inbox, Review Console, Dialysis overview,
Gov overview, property detail incl. the new om_intake-created 44309), with DB
cross-checks on anomalies. Three fix clusters → three prompts.

## Cluster A — Identity fragmentation (SYSTEMIC, the data-connectivity root)

`external_identities` carries FIVE spellings for the two domain DBs:

| source_system | source_type | rows |
|---|---|---|
| gov_supabase | true_owner | 3,397 |
| dia_db | property | 1,341 |
| gov_db | property | 1,178 |
| dia_supabase | true_owner | 631 |
| dia_supabase | asset | 348 |
| email_intake | property | 231 |
| gov_supabase | asset | 3 |

Different writers invented different conventions; every consumer (detail-page
resolution badges, `ensureEntityLink`, BD-engine sync, cross-flow dedupe)
matches a subset. **4th occurrence of the dia/gov alias bug class** — now in
its worst form, because it silently fragments the entity graph.

**Proven symptom:** create-property's promotion wrote prop 44309's identity as
`(dia_db, property)` → the detail page (looking for `dia`+`asset` convention)
shows "(Unknown)" header, "Showing summary from search record", "LCC Entity
Not Registered", "Ownership Not Resolved" — ALL FALSE (entity `dd832dde…`,
active listing 12772, lease data, broker contacts all exist). Every
create-from-intake property lands in this degraded state.

Also caught: junk entity name in the Priority Queue —
"Seller ContactsCraig Burrows(916) 768-5544 (p)" (P0.5) — entity creation has
no junk-name filter (the `isJunkContactName` class exists in the sidebar
pipeline but not at BD-engine entity sync).

→ `CLAUDECODE_PROMPT_R4A_identity_canonicalization.md`

## Cluster B — Stats correctness & data quality (numbers the app asserts that are wrong)

1. **Aggregates computed over capped query results, presented as totals:**
   - Gov "ALL-TIME COMPS **1,000** total in database" (LIMIT artifact; gov holds ~2.6k sales) + "AVG SALE PRICE $21,493,884 across all comps" (avg over the cap)
   - "GSA EVENTS YTD **500**" / "GSA TOTAL RENT $1,762M — 500 leases tracked" (caps)
   - "TOTAL LEADS 1,000+ … PIPELINE VALUE **$28,025M+** … AVG LEAD VALUE $28,025K" (avg = total/1000 exactly — computed over the loaded page; $28M/lead is absurd)
   - Team Pulse "**3000** RESEARCH" (round cap)
2. **Gov lease-expiration risk implausible:** "EXPIRING < 1 YEAR: 7,722 = **72.3% of portfolio**", action item "7571 leases expiring within 6 months", distribution 0-1yr=7,718 vs Expired=4. Smells like stale `lease_expiration`/`term_remaining` (GSA refresh gap or daily recompute not running) — needs a forensic, not a blind fix.
3. **Duplicate SF closed-sale rows:** dialysis "Recent closed sales" lists the IDENTICAL deal 10× (DaVita Huntingdon TN, $2.2M, 2025-12-19). Also 2024 shows only 37 closed/$153M vs 781 in 2023 and 240 in 2025 — possible sync gap year.
4. **Agency-name pollution (gov):** "POTOMAC/METROPOLITAN/TRIANGLE/DC SERVICES DIVISION" rank as top "agencies" by rent ($246M/$137M/$132M/$109M) — vendor/division names, not agencies; page itself flags 3,712 properties (20.8%, $1,225M rent) as Unknown agency.
5. **Widgets stuck loading forever** (dialysis): Clinical Metrics patient data, Clinic Financial Estimates, Listings Needing Confirmation, LLC Research Queue ("unavailable" on gov) — check the queries/endpoints behind them.

→ `CLAUDECODE_PROMPT_R4B_stats_correctness.md`

## Cluster C — Self-propelling UX gaps

1. **THE HEADLINE: Inbox ≠ intake outcomes.** Inbox shows "100 of **6,827**
   items", all "new", each demanding manual Triage/Promote — but most are OM
   emails the intake pipeline ALREADY auto-extracted/matched/promoted. Two
   parallel, unconnected representations of the same email stream: automation
   outcomes never clear the human queue. Also: "Bulk ops disabled" on a
   6,827-item list; the list reflows under the user's click; the card
   "Promote" routes to sidebar-propagation, not the OM promoter; intake
   outcome (matched/finalized/review/ocr_needed) is invisible on the card.
2. **Queue CTA isn't state-aware:** P0 hero (Eagle River — opportunity opened
   yesterday, touch overdue) still shows "Open opportunity →" as its CTA;
   the right next action is "Log first touch". Band reason labels leak
   jargon ("Developer Overdue"). P0.5 has 488 rows each needing an identical
   one-click — no bulk/auto path, and within-band ordering isn't value-sorted
   (no-rent rows above $385K-rent rows).
3. **Review Console lanes are backlog universes, not work:** 80,191 /
   19,336 / 13,928 / 6,914 counts dominate; the genuinely workable lane
   (44 SOS links) drowns; the staged-intake review pile (~1.9k, now with
   Create-property/OCR actions) has NO lane here at all.
4. **Today page:** "MY PRIORITIES — No priority items" while the queue holds
   1,130 (briefing section not wired to the priority queue); Daily Briefing
   stuck "Partial — some briefing sections are still loading" at 4:16 PM.
5. **Zeros-before-data:** slow sections render literal 0/"—" then pop to real
   values (gov Ownership Intelligence showed all-zeros for ~20s, then 15,131
   transfers/$58B). Zeros are indistinguishable from real empty data. Gov
   overview self-reports **21.0s load**.

→ `CLAUDECODE_PROMPT_R4C_selfpropelling_ux.md`

## What looked good

Priority Queue band system + hero card; gov "Listings Needing Confirmation"
lane (sale_match_promote rows with one-click Confirm Sold/Withdrawn/Still
Active — the self-propelling pattern done right); dialysis action-item cards
with CTAs; Today's NBA list + value labels; markets/weather/schedule widgets;
intake highlights surfacing on Today; My Work hero + Start/Wait.

*Method: Chrome MCP live walk + LCC Opps/dia/gov SQL cross-checks. Note: page
screenshots intermittently time out on heavy pages (21s gov load) — text
extraction used instead; the load-time problem is itself catalogued in B/C.*

## Addendum — all three clusters shipped (pending merge + deploy)

**R4-A (PR #1048):** canonical scheme documented (dia/gov + asset/true_owner;
property/clinic/facility collapsed → asset; email_intake verified as a
distinct channel identity, 231/231 UUIDs, left as-is). Data migrations ALREADY
LIVE: 6,900 rows normalized, 2,521 property→asset, 2 collisions deduped, 41
junk entities soft-flagged. Writers choke-pointed through
`canonicalIdentitySystem()`; consumers tolerate deprecated forms in transition.
⚠️ **Deferred CHECK constraint `20260604121000` applies ONLY after Railway
redeploys merged main** — current deployed writers still emit dia_db/gov_db.

**R4-B (branch great-lovelace):** mv_gov_overview_stats rebuilt — All-Time
Comps 1,000→**11,911**, leads 11,537 w/ avg $7.66M (was $28M over the cap),
GSA events 52,828 of 261,254, FRPP 21,947. **Forensic corrections:** lease
pile = bucketing on clamped firm_term_remaining, not stale data — rebucketed
by lease_expiration (<1yr 7,722→793 + honest 4,798 expired/holdover cohort;
4,002 stale >1yr logged as real refresh-gap backlog). Dupe sales =
v_sjc_deal_book emitting import snapshots (13,940 rows → 161 deals; one deal
×205) — DISTINCT ON fix; "2024 gap" was dup inflation (real: 2023=6, 2024=1,
2025=3). Financial Estimates: 37 round-trips → one-row view (8,511 clinics /
$49.9B instant). Team Pulse 3000 verified genuine (3,021). Migrations live;
frontend on redeploy.

**R4-C (PR #1052):** inbox↔intake unified at the DATA layer — backfill LIVE:
"New" **6,804 → 1,749 (−74%)**; ongoing trigger `lcc_inbox_autotriage_from_intake`
closes the loop for every future writer. Cards show verdict + real next
actions; Promote runs OM promotion on OM rows; bulk dismiss/archive enabled.
Queue CTA state-aware (Eagle River → "Log touch"); within-band value sort +
"Open top N"; staged-intake lane added to Review Console; My Priorities falls
back to live queue; gov Ownership Intelligence skeletons. Flagged follow-ups:
§5 skeleton sweep across remaining lazy sections; list-reflow debounce
(deliberately not shipped — fragile).

**Post-deploy sequence:** merge all three → single Railway redeploy → (1) I
apply the deferred CHECK constraint to LCC Opps, (2) full live verification:
44309 detail header/badge + canonical writes (A); gov overview true totals +
honest lease buckets + 10 distinct recent sales (B); inbox verdict cards +
state-aware queue CTAs + new console lane + My Priorities (C).
