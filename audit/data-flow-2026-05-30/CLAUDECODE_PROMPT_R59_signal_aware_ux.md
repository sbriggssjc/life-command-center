# Claude Code — R59: advance the ball at every interaction (signal-aware detail + lead-with-action Today + bulk triage)

## Why (live app walk 2026-06-20 — see AUDIT_app_usability_connectivity_2026-06-20.md)
The app is strong: Today (data gaps + two-cockpit), Priority Queue (all bands + P-BUYER hero), the
R55 **Top BD Actions** unified worklist (suspected sales / maturities / owner conflicts / contacts
/ chains, value-ranked), and a rich property detail (completeness score, NEXT STEP card, ownership
resolve, SF feed, log-call, draft-email) all work live. The gap is **signal continuity**: the
system routes the operator to a property *by signal* but the destination doesn't carry the signal
forward.

Concrete: opening the $62M row "Confirm suspected sale (Lcor Inc → LCOR ALEXANDRIA LLC)" lands on
the property detail whose NEXT STEP reads the generic "Create the lead — Owner resolved" — **no
suspected-sale context, no confirm-sale action.** The operator must go back and use "Decision
Center →". Same for maturity + owner-conflict rows. The detail is signal-agnostic.

## House rules
Reuse the existing surfaces/endpoints — `v_lcc_bd_worklist` / `bd_worklist`, the R53 confirm-sale
path, R54 maturity view, R51 owner-conflict lane, R52 contact writeback, the property-detail NEXT
STEP card. UI/wiring round — no new domain data; effect paths already exist (this connects them).
≤12 `api/*.js`; `node --check`/suite green; ships on the Railway redeploy.

## Unit 1 (headline) — signal-aware property detail
When the property detail opens from a worklist/lane row OR the property carries an open BD signal,
render a **signal banner** and make the **NEXT STEP** the signal's action (not the generic
"Create the lead"):
- **suspected_sale** → banner "Suspected sale: <grantor> → <grantee> (<date>)"; NEXT STEP =
  "Confirm the sale — record price/date" wired inline to the R53 `confirm_sale` path (operator
  supplies price). `not_a_sale` option too.
- **loan_maturity** → banner "Loan matures <band> (<date>)"; NEXT STEP = "Refi/disposition
  outreach" (R54) → open the owner cadence/opportunity.
- **owner_source_conflict** → banner "Deed says <grantee>, recorded owner is <X>"; NEXT STEP =
  "Reconcile owner" (R51 accept_deed / broker_not_owner) inline.
- else → the existing owner→lead→cadence NEXT STEP (unchanged).
Carry the signal via the route param the worklist row already routes with; ALSO compute it on
direct navigation (read the property's open signals from the same views) so the banner shows
regardless of entry point. The "Owner › Lead › Cadence" progress chain stays; the banner sits above it.

## Unit 2 — Today leads with the action
Add a **"Top BD Actions"** card to the Today page (top 3-5 rows of `v_lcc_bd_worklist`, value-ranked,
with the same one-line action + route), beside the existing "Top Data Gaps" rail. So the home screen
shows the single highest-value *move* ($62M LCOR suspected sale today), not only data-quality gaps.
Keep the two-cockpit doctrine — this is the BD-action cockpit's top slice surfaced on Today, clearly
labeled, linking to the full Top BD Actions list.

## Unit 3 — bulk triage for the oversized backlogs
- **Inbox (938 `new_contact_qualify`)** — a bulk action: select-all / auto-qualify the
  high-confidence captured contacts (real email + plausible person + known role), promoting them in
  one pass (they're the R52 Salesforce-writeback candidates). Keep per-item Triage/Promote/Assign/
  Dismiss for the ambiguous remainder. Goal: the operator clears the bulk, not 938 clicks.
- **Decision Center (999+)** — group/bulk-handle within a lane where the verdict is safe
  (e.g. bulk `keep_current`/`research` on a filtered set), so the badge is workable. Don't bulk any
  destructive verdict without the existing per-lane gate.

## Unit 4 (minor) — perf + banner-on-direct-nav
Keep chipping the Priority Queue first-load (~5s spinner); ensure the Unit-1 banners render on
direct property navigation, not only via the worklist route.

## Verify (report back)
- Open a suspected-sale row → detail shows the suspected-sale banner + a confirm-sale NEXT STEP
  (not the generic lead step); same for a maturity row + an owner-conflict row.
- Today renders the Top BD Actions card (top 5, value-ranked) alongside data gaps.
- Inbox bulk-qualify promotes a high-confidence batch in one action; the ambiguous remainder still
  per-item.
- `node --check`; ≤12 api/*.js; suite green; no new domain writes (reuses existing effect paths).

## Bottom line
The system computes and routes by signal but drops the thread at the moment of action. R59 makes
every entry point carry its signal into a specific next step on the detail, leads the home screen
with the top action, and gives the big triage/decision backlogs bulk paths — so each interaction
advances the exact deal the operator was sent to work, end to end.
