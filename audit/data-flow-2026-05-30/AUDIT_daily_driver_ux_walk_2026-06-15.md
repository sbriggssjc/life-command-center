# Audit — daily-driver UX walk: does the operator SEE the value-ranked guidance?
**Live walk 2026-06-15 (deployed app, Claude-in-Chrome): Today + Priority Queue.**

## Verdict: YES — the backend arc is surfaced coherently, with concrete gaps
The work of this whole engagement IS visible to the operator:
- **Today / NEXT BEST ACTION** — value-ranked top-10 (e.g. $247M → $134M) with
  priority + domain + data-quality badges; "10 shown · 93 total open"; the R21
  ownership-research gaps ("Research recorded owner for …") and P-BUYER priorities
  both present.
- **Priority Queue** — band tabs with live counts (P0.4 543 · P-BUYER 21 · P7 220 ·
  P-CONTACT 166 · …); a "DO THIS FIRST" hero leading with the **R14/R5 P-BUYER
  rollups** (Boyd Watterson: 145 SPEs · 167 properties · $163M rent · SF mapped →
  "Open Government Buyer opportunity →"; each parent shows SPE/property/rent/SF-status
  + a clear CTA).
- **P-CONTACT cards carry the R17 connected-property value** (Northwestern Mutual
  $26.1M, Foulger Pratt $24.3M) + "Select prospecting contact →".
Clean dark-mode design, coherent nav. The operator can see where to spend time.

## Gaps (ranked)

### 1. HIGH — P-CONTACT isn't SORTED by the value it displays
The connected-property value (R17) is computed and shown on each card, but the
in-band display order doesn't use it. Live order ran: Acquest (no value) → Met Life
$11.7M → Washington $4.2M → Mirza $2.7M → ~9 no-value (Capstone, Wharton, Prologis…)
→ **only then** Foulger Pratt $24.3M, Jamestown $22.8M … and Northwestern Mutual
$26.1M, Akridge $21.7M, Gates Hudson $19.5M appear far down. So the **highest-value
prospecting targets are buried below dozens of $0 entries.** The band looks sorted by
overdue/insertion, NOT by `rank_annual_rent`. This directly undercuts "work the
highest-value first" — the value ranking exists in data + on the card but doesn't
drive the list order the operator scans. (Likely also affects P0.4 and the other
connect bands.)

### 2. MEDIUM-HIGH — junk entities pollute P-CONTACT
Non-target garbage surfaces as prospecting contacts: **"Realtor", "Description:",
"Office | Investment Specialist", "SVN | Commercial Advisory Group", "Realty Pros
Commercial", "Mexico", "Paris, PAR 75009", "Pedregal 24 oficina 423", "GSA (US
Gov't)"** — broker labels, address fragments, a country, the government itself,
brokerage firms. The R11 follow-up (exclude `junk_name_flagged` from P-CONTACT) was
never done, and there are clearly more patterns (brokerage-firm names, address/locale
fragments, bare-label names). Clutters the contact-research worklist with things that
should never be prospected.

### 3. MEDIUM — NBA (Today) leads entirely with data-fix tasks
Top-10 NBA is 100% "Resolve agency drift" + "Research recorded owner" — no outreach
action appears. Connect-first is defensible doctrine, but "resolve agency drift" as
the #1 action at $247M (a property-vs-lease agency-name reconciliation) over any
high-value outreach is a prioritization/doctrine call worth confirming. (The Priority
Queue's "DO THIS FIRST" correctly leads with P-BUYER outreach — so the two primary
surfaces lead with *different* "first" actions, which is itself a coherence question.)

### 4. LOW — Today widget contradiction
"Sync Errors **0**" (TEAM SIGNALS) vs "SYNC ERRORS **2638**" (TEAM PULSE) on the same
page — two widgets, contradictory numbers. One is wrong/stale; reconcile to one
source.

### 5. LOW — daily briefing perpetually partial
"Partial · Unavailable/still loading: global_market_intelligence.structured_payload /
html_fragment" — the market-intelligence briefing component isn't rendering.

## Recommended fix (R25) — make the visible order match the computed value + de-junk
1. **Sort the connect bands (P-CONTACT first, then P0.4) by `rank_annual_rent` DESC
   NULLS LAST** in the queue UI / the items query the page reads, so the highest-
   value targets the cards already show are at the TOP. This is the last mile of
   R11/R17 — the value is computed; just order by it.
2. **Filter junk from P-CONTACT**: exclude `metadata.junk_name_flagged` entities
   (the R11 follow-up) AND extend the person/owner-name guard to the patterns seen
   live (bare role labels "Realtor"/"Description:", brokerage-firm suffixes
   "SVN |…"/"… Commercial", address/locale fragments "Paris, PAR…"/"Mexico", and the
   GSA-self artifact). They shouldn't appear as prospecting targets at all.
3. **Reconcile the two sync-error widgets** to one source (and confirm which is real
   — 0 or 2,638).
4. (Doctrine, for Scott) **NBA ordering** — confirm whether data-fixes should lead
   the Today NBA over high-value outreach, and whether Today-NBA and Queue-"DO THIS
   FIRST" should agree on the single first action.
5. (Low) fix the daily-briefing market-intelligence component load.

## Bottom line
The app is a real time-allocation cockpit — the value-ranked guidance, rollups, and
CTAs are all surfaced. The gap is the **last mile of presentation**: the connect
bands display value but don't order by it, and junk clutters the prospecting list.
Fixing #1 + #2 makes the surface actually guide the eye to the highest-value work,
which is the project's core objective.
