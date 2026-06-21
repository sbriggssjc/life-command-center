# Audit — LCC app functionality, usability + connectivity (live walk, 2026-06-20)

**Scott's ask:** walk the live app as the operator; find functionality/usability improvements and
further connectivity; advance the ball forward at every interaction.

**Method:** live walk of the deployed app (Today → Priority Queue → Top BD Actions → a property
detail).

## Headline: the app is genuinely well-built and the R46–R58 signals ARE surfaced. The gap is signal CONTINUITY — the system routes by signal but the destination doesn't carry the signal forward into a specific next action.

### What works (confirmed live — strong)
- **Today** — "Top Data Gaps to Close" (R25), value-ranked ($247M agency-drift … $107M
  recorded-owner) with county-recorder deep links; the two-cockpit split ("who to pursue → Priority
  Queue") is intact; MY PRIORITIES shows the P-BUYER parents; canonical TTM metrics (169 dia / 64
  gov) render.
- **Priority Queue** — all bands with counts (P0.4 523, P0.5 107, P-BUYER 24, P1-P8, P-CONTACT
  145…), a "DO THIS FIRST" hero (Boyd Watterson $169M → Open Government Buyer opportunity), and the
  header wires every new surface: **Top BD actions**, Cadence dashboard, Next best touchpoint,
  Qualify contacts.
- **Top BD Actions (R55)** — the unified worklist is excellent: "every BD signal ranked highest $
  first," filter chips (Loan maturity / Suspected sale / Owner conflict / Push to CRM / Ownership
  chain), each row a clear action + route. Top items live: $62M LCOR Alexandria suspected sale,
  $34M Cira Square chain, $26M Morgan Chase→USPS suspected sale, $24M USGBF maturity. R53/R54/R51/
  R52/R46 all merged + value-ranked. This is the daily driver working as designed.
- **Property detail** — rich and action-oriented: a **COMPLETENESS score (85 GOOD) + "Resolve
  Data Gaps (5)"** with point-weighted suggestions; a single **NEXT STEP card** ("Create the lead
  — Owner resolved" with an Owner › Lead › Cadence progress chain); Ownership Assistant (AI);
  Resolve-Ownership form; SF activity feed; Log Call; Draft Email (templates). Excellent surface.

### The improvement theme — signal continuity is lost at the handoff
The operator opens the $62M row **"Confirm suspected sale (Lcor Inc → LCOR ALEXANDRIA LLC)"** →
lands on the property detail → and the detail shows **no suspected-sale context at all.** Its
NEXT STEP reads the generic "Create the lead — Owner resolved," not "Confirm the suspected sale —
record price/date." To actually do the thing that routed them there, the operator must go *back*
and use "Decision Center →". The destination doesn't echo the signal. Same for the maturity rows
("Loan maturing <=24mo") and owner-conflict rows ("Reconcile owner: EMERALD → ABJ 201 MAPLE SPV")
— the detail is **signal-agnostic**. The system did the hard part (compute + rank + route) but
drops the thread at the moment of action. **Making the detail's NEXT STEP signal-aware is the
single biggest "advance the ball at every interaction" win.**

### Other concrete findings
1. **Today doesn't surface the #1 BD action.** Today leads with data gaps + P-BUYER, but the
   highest-value *action* in the system ($62M LCOR suspected sale, the top of Top BD Actions) isn't
   on the home screen. The daily driver should lead with the worklist's top 3-5 items, not only
   data-quality gaps.
2. **Triage/decision backlogs are too big to work one-by-one.** Inbox = **938 items**, almost all
   `new_contact_qualify` (CoStar-captured contacts → Promote/Assign/Dismiss); Decision Center badge
   = **999+**. These are per-item surfaces with no bulk path. The 938 contacts are exactly R52's
   writeback candidates — they need bulk-qualify / auto-promote-high-confidence, not 938 clicks.
3. **Property detail doesn't render the R51/R53/R54 banners.** R54 was meant to show a maturity
   banner on detail; the LCOR detail (a suspected-sale subject) showed none of the
   suspected-sale / owner-conflict / maturity context. Surfacing these as banners (with the
   signal's action) closes the continuity gap above.
4. **Ownership History 0 records on a $62M property** — the R46 establish_ownership_history gap,
   visible at the point of work; the detail's research-quick-links + the chain research task are
   the path, but the gap is real on high-value assets.
5. **Priority Queue load ~5s** (spinner) — the R7 perf floor is better than the old 5-7s but still
   a visible wait on the most-used surface.

## Fix doctrine → R59 (signal-aware detail + lead-with-the-action Today + bulk triage)
1. **Signal-aware property detail (headline).** When the detail is opened from a worklist/lane row
   (or the property carries an open signal), render a banner + make the **NEXT STEP** the
   signal's action: suspected sale → "Confirm sale: <grantor>→<grantee>, record price/date" (the
   R53 confirm path, inline); maturity → "Refi/disposition outreach" (R54); owner conflict →
   "Reconcile owner: deed says X" (R51 accept_deed). Carry the signal via the route param the
   worklist already has. Echo R51/R53/R54 banners on detail regardless of entry point.
2. **Today leads with the action.** Add a "Top BD actions" card to Today (the top 3-5 from
   `v_lcc_bd_worklist`), beside the data-gaps rail — so the home screen shows the single
   highest-value move, not only data hygiene.
3. **Bulk triage.** A bulk-qualify path for the 938-contact inbox (auto-promote high-confidence
   captured contacts — they're R52 writeback candidates) and bulk/grouped handling for the 999+
   Decision Center backlog, so these surfaces are workable, not just countable.
4. (Minor) keep chipping the Priority Queue load time; render the detail's maturity/suspected/
   conflict banner even on direct navigation.

## Bottom line
The app is in strong shape — the R46–R58 signals are surfaced, the unified worklist works, and the
property detail is action-oriented. The improvement is *continuity*: the system computes and routes
by signal but the detail drops the thread, the home screen doesn't lead with the top action, and
the triage/decision backlogs need bulk paths. R59 makes every entry point carry its signal into a
specific next step — so each interaction advances the exact deal the operator was sent to work.
