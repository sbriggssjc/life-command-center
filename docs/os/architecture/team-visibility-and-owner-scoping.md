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

## Fix — Layer 1: owner-scoped digests (do now)
- `cadence-scan` / `weekly-digest` take an **owner scope** param (`owner=<lcc_user_id>` or SF owner id). Default
  behavior becomes: a broker's digest = the deals **they own** (+ deals where they're the responsible party).
- Each digest line shows the **owner** so any shared/overview view makes attribution obvious.
- **Delivery model** (Scott's call — see Decision): per-broker "my actions" emails, and/or a **team-overview**
  digest for Scott-as-lead that is grouped by owner and explicitly labeled "team pipeline, not your to-dos."
- Consequence today: Scott owns 0 open deals, so *Scott's* personal digest is near-empty — which is **accurate**
  (he isn't the one touching these). Kelly's digest is where the 17 belong.

## Fix — Layer 2: team activity coverage (the real accuracy fix)
The "overdue" signal is only valid for a broker whose mailbox LCC ingests. To make cadence trustworthy for the
whole team, **extend mail-intake to each broker's Outlook mailbox** (Kelly, Sarah, Nate) — same distill →
`activity_events` pipeline, wider source. Calls already flow via the LCC write-back for anyone who logs them.
- **Until team mailboxes are ingested**, the honest move is to **not assert "overdue"** for a deal whose owner's
  activity LCC doesn't capture. Options: (a) suppress the overdue/needs-touch flag for those and show them as
  "activity not tracked in LCC yet"; (b) gate cadence to owners with an ingested mailbox. Prevents false alarms.

## Design rule this establishes
> Cadence/next-best-action is only as truthful as the activity LCC can see for that deal's owner. **Never flag a
> deal actionable/overdue for a broker whose activity LCC does not ingest.** Owner scope + per-owner activity
> coverage are a matched pair — shipping the digest without both produces confident, wrong to-do lists.

## Decision needed from Scott
1. **Delivery model:** (a) per-broker "my actions" emails (Kelly gets hers, etc.); (b) one team-overview to Scott
   grouped by owner, labeled as overview; (c) both.
2. **Team mail-intake:** ingest the other brokers' mailboxes now (makes cadence real team-wide), or defer and
   meanwhile suppress "overdue" for owners LCC can't see.
