# Team Function vs LCC Visibility — the owner-scope + activity-coverage gap

_2026-07-28. Break-out design note. Surfaced when the weekly digest (BUILD 05) sent Scott a worklist that
is almost entirely **Kelly Largent's** deals, flagged overdue using activity LCC cannot actually see._

## The finding (with data)
- **Ownership:** of the 21 in-scope open deals, **Kelly owns 17, Scott owns 0**, 4 are partnership (Scott on
  the team, another/unmapped owner). The digest is Team-scoped but **not owner-scoped**, so it dumps the whole
  team's pipeline into one recipient's inbox as if it were their to-do list.
- **Activity coverage:** the Outlook pipeline in LCC is **one mailbox — Scott's** (`activity_events` outlook
  rows have 1 distinct actor; sampled row is a thread Scott was cc'd on). So LCC only sees correspondence Scott
  was on. **Kelly's own activity (calls, emails without Scott) is not in LCC**, so her deals appear neglected
  when they're being actively worked.

**Net:** the cadence engine currently reflects *"deals Scott can see activity on,"* not *"the team's work."*
Two things must change for it to reflect the team's actual function.

## Fix — Layer 1: owner-scoped digests (SHIPPED in engine)
- `cadence-scan` / `weekly-digest` take an **owner scope** param (`owner_email`, `owner=<lcc_user_id>`, or
  `owner_sf=<salesforce_owner_id>`), read from the query string OR the POST body (the root proxy drops query
  strings, so body is the path that actually reaches the engine). Default behavior: a broker's digest = the
  deals **they own** (+ deals where they're the responsible party). No arg = team overview, owner shown per row.
- Each digest line shows the **owner** so any shared/overview view makes attribution obvious.
- **Delivery model** (Scott's call — see Decision log): per-broker "my actions" emails, and/or a **team-overview**
  digest for Scott-as-lead that is grouped by owner and explicitly labeled "team pipeline, not your to-dos."
- Consequence today: Scott owns 0 open deals, so *Scott's* personal digest is near-empty — which is **accurate**
  (he isn't the one touching these). Kelly's digest is where the 17 belong.

## Fix — Layer 2: team activity coverage (the real accuracy fix)
The "overdue" signal is only valid for a broker whose mailbox LCC ingests. To make cadence trustworthy for the
whole team, **extend mail-intake to each broker's Outlook mailbox** (Kelly, Sarah, Nate) — same distill →
`activity_events` pipeline, wider source. Calls already flow via the LCC write-back for anyone who logs them.
- **Until team mailboxes are ingested**, the honest move is to **not assert "overdue"** for a deal whose owner's
  activity LCC doesn't capture. The shipped digest carries an amber **coverage banner** caveating exactly this;
  full suppression/gating of the overdue flag for un-ingested owners is the next hardening step.

## Design rule this establishes
> Cadence/next-best-action is only as truthful as the activity LCC can see for that deal's owner. **Never flag a
> deal actionable/overdue for a broker whose activity LCC does not ingest.** Owner scope + per-owner activity
> coverage are a matched pair — shipping the digest without both produces confident, wrong to-do lists.

## Decision log
- **2026-07-28 — Delivery model resolved to "Both" in principle; per-broker fan-out DEFERRED.**
  Owner-scoping shipped in the engine (`cadence-scan.js`: owner arg via query or POST body, per-owner filter,
  coverage banner). **Flow A (team-overview digest to Scott) remains the single LIVE delivery.** Flow B
  (per-broker "my deals" emails to Kelly/Sarah/Nate) is fully specced and endpoint-ready but **parked until the
  whole app architecture/build-out is complete and all errors are triaged** — no point wiring three inboxes (two
  empty today) into a surface that may still move. Current in-scope open deals: Kelly 17, no-TB-owner partnership
  4, Scott/Sarah/Nate 0.
- **Open call for when Flow B is un-parked:** the 4 partnership deals have **no Team Briggs owner**, so
  owner-scoped emails never surface them — they live only in the team overview. If they should route to a
  specific TB person's "my deals" list, we must first designate a responsible party per deal.
- **Team mail-intake:** deferred alongside Flow B; meanwhile the coverage banner is the interim honesty.
