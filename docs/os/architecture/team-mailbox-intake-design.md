# Team Mailbox Intake (B2) — design spec

_2026-07-28. The cadence engine's biggest accuracy lever. Today LCC ingests one mailbox (Scott's), so
"overdue"/"needs-touch" is only truthful for deals Scott corresponds on — and Kelly owns most of the open
pipeline. Ingesting the team's Outlook makes cadence honest team-wide. This specs how, reusing the existing
intake pipeline rather than building new._

## Current state (what exists, measured)
- **Intake pipeline is mature:** Outlook → PA flow "LCC - Outlook Intake to Teams (Hardened)" →
  `staged_intake_items` (6,954 emails) → `intake-*` handlers (stage-om → extract → matcher → promoter) →
  `activity_events` (`outlook` 6,098 rows; `intake_om` 3,969). The deal-email matcher then attributes to deals.
- **The gap — no per-broker attribution:** **all 6,098 outlook rows carry `actor_id = SYSTEM_ACTOR`.** Mail is
  Scott's, but nothing records *which broker* the activity belongs to. So cadence can't tell "Kelly touched this
  deal 3 days ago" from "no one did."
- **Consequence:** cadence-scan's last-touch reflects only Scott-visible correspondence. Owner-scoped digests
  (already built) are correct in structure but starved of data for Kelly/Sarah/Nate.

## The design — extend intake to the team, with per-broker attribution
Three changes, each an extension of the existing pipeline:

### 1. Add team mailboxes as intake sources
Kelly, Sarah, Nate's Outlook feed the **same** staging endpoint the Hardened flow uses today — one more source
each, not a new pipeline. (Auth model = the decision below.)

### 2. Stamp the owning broker (the core change)
Each staged email carries its **mailbox owner**; the promoter sets `activity_events.actor_id` to that broker's
LCC identity (the `lcc_users` person: Scott `07fd8b1b…`, Sarah `1b63e217…`, Nate `8d56b104…`, Kelly
`4075bff9…`) instead of `SYSTEM_ACTOR`. This is what makes cadence team-aware — last-touch becomes per-broker.

### 3. Privacy-preserving match-then-persist
The pipeline already stages-then-matches, so extend that discipline: **ingest broadly, persist narrowly.** An
email is kept as a deal activity only if the matcher attributes it to a Team-Briggs deal (tenant+city, the live
v2.1 matcher). Non-deal / personal mail is matched-and-dropped — never stored. So we capture *deal* activity
across the team without warehousing everyone's inbox. (Bodies already stay out of SF per the write-back rule.)

## The one decision — the auth model (Scott's call)
How LCC reads Kelly/Sarah/Nate's mailboxes. Three options, trade-offs framed for our access reality (note: Scott
lacks SF admin, so Azure AD admin is likely also unavailable — that shapes the recommendation):

| Option | How | Needs | Pros | Cons |
|---|---|---|---|---|
| **A. Per-broker self-authorized PA flow (recommended)** | Each broker owns a copy of the Hardened intake flow on their own mailbox, signed in with their own Outlook connection, posting to the intake endpoint with their broker id. | Each broker signs into Power Automate once (self-service; no admin). | No admin/IT; each broker controls their own connection; mirrors the proven Scott flow exactly. | 3 flows to stand up; relies on each broker keeping their connection alive. |
| **B. Shared-mailbox / delegate access** | Brokers (or admin) grant delegate access; one flow reads all four via the Outlook "shared mailbox" actions. | Delegate grants (may be admin-gated). | One flow; central. | Delegate setup is often admin-gated; reads whole mailboxes. |
| **C. App-only Microsoft Graph** | Azure AD app with `Mail.Read` *application* permission, scoped by Application Access Policy to the 4 mailboxes. | Azure AD admin consent + app registration. | Most robust/scalable; server-side, no user sessions. | **Needs Azure AD admin — likely blocked** for the same reason SF admin was. |

**Recommendation: Option A.** It's self-service (no admin, which matches the constraint that just blocked the
SF route), reuses the exact flow that already works, and keeps each broker in control of their own connection.
If IT/admin turns out to be available, Option C is the better long-term home and we can migrate to it.

## Cadence impact (why this is the lever)
With per-broker activity flowing, cadence-scan's last-touch becomes team-true: Kelly's deals show *her* recent
correspondence, so "overdue" means actually overdue. The owner-scoped digests (built) then deliver each broker
their real worklist, and the team-overview is accurate. The interim "single-mailbox coverage" caveat banner
retires as each mailbox comes online (track per-broker coverage; only flag deals whose owner's mail we ingest).

## Privacy & scoping rules (canonize)
- **Persist only deal-matched mail.** Non-matched (personal/other) email is dropped at the matcher, not stored.
- **Per-broker consent.** Option A means each broker authorizes their own connection — explicit, revocable.
- **Attribution, not surveillance.** We store *that a deal was touched and when*, by whom — the cadence signal —
  not a mirror of anyone's inbox. Bodies never egress to SF (existing rule).
- **Coverage honesty.** Cadence asserts "overdue" only for a deal whose owner's mailbox LCC actually ingests;
  others show "activity not tracked yet" until their mailbox is online.

## Phased build
1. **Attribution first (no new mailboxes):** thread `mailbox_owner` through the intake promoter → set
   `actor_id` to the broker identity. Backfill Scott's existing rows to his identity. Cadence immediately
   distinguishes owner activity. Small, safe, unblocks everything.
2. **Kelly's mailbox (highest value):** stand up her intake flow (Option A) — she owns 17 of the open deals, so
   her mail is where the accuracy gap is largest. Validate her digest goes from empty to real.
3. **Sarah + Nate:** same pattern.
4. **Retire the coverage caveat** per-broker as each comes online; un-park the per-broker delivery flow (B1).
