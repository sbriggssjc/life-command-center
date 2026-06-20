# Consolidation audit — feed freshness + deploy drift across R46–R55 (2026-06-20)

**Question (Scott):** after the R46–R55 build arc, audit the work for residual gaps. The recurring
vulnerability across the arc was twofold — "captured but not fed back" (which the rounds fixed) and
**"a recurring feed silently went stale"** (USAJobs/SAM/GSA all dead since March). Every signal we
built decays if the feed under it is stale, so the retrospective focuses on feed freshness + silent
deploy gaps.

## Verdict: the system is mostly connected + fresh; two concrete loose ends undercut the new work, and the durable fix is a freshness monitor

### Feeds are mostly fresh (today = 2026-06-20)
- **gov:** USAJobs 06-20 ✓, SAM 06-18 ✓ (both recovered this session), loans 06-18 ✓,
  agency_risk_signals 06-15 ✓, federal_lease_awards 06-15 ✓, available_listings 06-13 ✓,
  investment_scores 06-15 ✓, gsa_leases snapshot 06-01 ✓, sales 06-01 ✓.
- **dia:** loans 06-16 ✓, clinic_financial_estimates 06-13 ✓, CMS medicare_clinics 06-09 ✓,
  deed_records 06-05 ✓, sales 06-05 ✓.
The USAJobs/SAM recovery held — the recurring stale-feed problem is mostly resolved.

### Residual gap 1 (HIGH) — the GSA monthly diff is the one truly-stalled automated pipeline
`gsa_lease_events` is stuck at **2026-03-01** while `gsa_leases` snapshots are current (06-01). The
snapshot ingest runs; the **diff step that produces lease events does not.** This is the gov
vertical's core BD intelligence (renewals / expirations / **lessor changes**) AND the exact feed
under **R53's suspected-sale signal** — so R53 won't surface *new* lessor-change sales until the
diff is caught up. R53 Unit 5 documented the catch-up (`python -m src.gsa_monthly_diff --diff PREV
CURR` for the three Mar→Jun pairs); it needs to be run, and the diff step wired to run with each
snapshot ingest. **A just-built signal is sitting on a dead feed.**

### Residual gap 2 (HIGH) — R49 v3 never applied to live gov (silent deploy drift)
gov `investment_scores` has **0 v3 columns** — `sql/20260620_gov_r49_investment_scores_v3.sql` +
the v3 scorer run never happened on the live gov DB (it was committed to the branch). So R49's
entire payoff (the risk-aware grade) can't be computed *or* reviewed, and `SCORING_MODEL_ACTIVE=v3`
is moot until it lands. This is the kind of silent gap the audit was for — a whole round's value
unapplied because a Python-repo migration doesn't auto-apply like the MCP-applied LCC/gov view
migrations do.

### Residual gap 3 (LOW) — OPM workforce stale (2026-03-17)
Manual FedScope download; known, low urgency (the agency-risk overlay's main input,
`agency_risk_signals`, is fresh).

### Not a gap (characteristics worth knowing)
- **deed_records is capture-driven, not real-time.** Ingest is active (88 new gov rows/30d, last
  06-15) but only 1 deed *recorded* in the last 90 days — we capture historical deeds via CoStar,
  not a live deed feed. So R51/R53 deed-driven signals work off historical deeds; new sales surface
  on CoStar-capture cadence, not instantly. A limitation, not a stall.
- **dia available_listings** last created 04-19 — likely capture cadence (small dia on-market
  universe), watch item not a confirmed stall.

### The activation backlog is itself the biggest "gap"
Most of the arc's payoff is behind flags not yet flipped: R46 developer writeback, R49 v3 (blocked
on gap 2), R51 owner-deed autofix (now safe post-R55), R52 contact writeback (needs the PA flow),
R53 GSA catch-up (gap 1). **The system is built but not yet "on."** Value is realized when the
flags flip + the operator works the `v_lcc_bd_worklist`.

## The durable fix → R56: a feed-freshness health monitor
The retrospective's core insight: the whole premise is "improving as new info is ingested," but
nothing tells you when a feed STOPS. USAJobs/SAM/GSA each died silently and were found months later
by accident. The durable fix is a **feed-freshness monitor**: a view + alert that flags any
ingestion feed whose latest data is older than its expected cadence, surfaced in the existing
`lcc_health_alerts` / daily briefing. That would have caught all three stalls automatically. Build
it so the system self-reports when it stops improving.

## Bottom line
The arc is sound and the feeds are mostly fresh, but two concrete loose ends undercut the new work
— the **GSA diff is stalled** (R53's feed is dead) and **R49 v3 was never applied to gov** (a whole
round unrealized) — and most of the payoff waits behind un-flipped flags. The durable fix for the
recurring stale-feed vulnerability is a freshness monitor (R56) so the system tells you when a pipe
dies instead of you finding out by accident.
