# Claude Code prompt — R4-C: self-propelling UX — inbox↔intake unification + state-aware CTAs

Paste into Claude Code, run from the **life-command-center** repo. From the
2026-06-04 round-4 live audit. North star (unchanged): every surface advances
the ball — the user always sees the next best action for the CURRENT state,
and automation outcomes clear human queues instead of leaving stale work.

---

## 1. THE HEADLINE — Inbox doesn't know what the intake pipeline already did

Verified live: the Inbox page shows "100 of **6,827** items", all status
"new", each card offering manual Triage/Promote/Assign/Dismiss. But most are
OM emails the intake pipeline already auto-extracted, matched, and promoted
(the same stream feeds `staged_intake_items`, which now drains via the
rematch/disposition crons). Two parallel representations of one email stream;
automation outcomes never reflect back. Consequences: a 6,827-item fake
backlog, double-triage work, and the genuinely-actionable few are buried.

Fix the flow, not the cosmetics:
- **Join inbox items to their staged intake outcome** (they share the email /
  `inbox_item_id` / internet_message_id lineage — staged_intake_items
  `raw_payload.inbox_item_id` exists; verify the exact key). On each card show
  the pipeline verdict: `finalized/matched` → "Processed ✓ — matched to
  <property> (domain)" with a link to the property; `review_required` →
  "Needs review" + the REAL next actions (Create property → / Re-extract
  (OCR) for `ocr_needed` / View extraction); `discarded(non_deal)` →
  "Auto-archived: not a deal doc".
- **Auto-triage the backlog + ongoing:** items whose intake finalized/matched
  or was dispositioned non-deal move out of "New" automatically (to Triaged/
  Archived with the verdict recorded). Run the backfill over the 6,827 and
  wire the ongoing transition wherever intake status advances (or a cheap
  sweep on the existing rematch cron tick). Report before/after counts of
  "New".
- **Make Promote do the right thing:** the card's Promote currently routes to
  the sidebar-propagation path. For email_om items it should run/re-run the
  OM promotion (the create-property/rematch machinery) — or be replaced by
  the outcome-specific buttons above.
- **Bulk ops:** enable bulk select for at least Dismiss/Archive on filtered
  views (the control exists but says "Bulk ops disabled").
- **Stop the list reflowing under clicks** (it re-sorted mid-click during
  testing — debounce the refresh or pin order during interaction).

## 2. Priority Queue CTA must be state-aware

Verified: P0 hero (EAGLE RIVER — opportunity opened yesterday, cadence touch
now overdue) still shows "Open opportunity →". Required: CTA reflects state —
no opportunity → "Open opportunity →"; open + touch due/overdue → "Log
touch →" (open the touchpoint logger or the entity's cadence panel); open +
not due → "View opportunity →". The priority-band payload already carries
`open_opportunity`/`cadence_next_touch_due` (used by the detail banner — reuse
it here). Also:
- Band reason labels leak doctrine jargon ("Developer Overdue") — map to
  plain language ("Onboarding touch overdue (developer)" or similar).
- P0.5 has 488 identical "needs a BD opportunity opened" rows: add value-sort
  within band (rows with rent/value first — currently no-value rows rank
  above $385K-rent rows) and a "Open top N" bulk action (cap ~10-20 per
  click, reusing the idempotent open_opportunity path).

## 3. Review Console: workable lanes, not backlog universes

Verified lane counts: 80,191 / 19,336 / 13,928 / 6,914 / 2,018 / 44. The 44
(SOS links) is real work; the rest are databases. Per lane: show "workable
now" (top-N by value with inline actions, like the gov Listings-Needing-
Confirmation lane already does) with the universe count demoted to a subtitle.
And add the MISSING lane: **staged-intake review** (~1.9k review_required,
shrinking via cron) with its per-item Create property →/OCR/View-extraction
actions — the round-3 machinery has no console surface today.

## 4. Today page wiring

- "MY PRIORITIES — No priority items" while the queue holds 1,130: wire the
  briefing's My Priorities section to the top of v_priority_queue (same
  source as the NBA list) or remove the section.
- Daily Briefing stuck "Partial — some briefing sections are still loading"
  hours after generation: check the briefing snapshot pipeline status flag —
  if sections legitimately failed, show which, not an eternal partial.

## 5. Loading honesty (zeros-before-data)

Slow sections render literal 0/"—" before data arrives (gov Ownership
Intelligence showed all-zeros ~20s, then 15,131 transfers/$58B; CONTACTS
0→10,520). A zero the user can't distinguish from real data is a correctness
bug. Sweep the overview section renderers: skeleton/spinner until resolved,
explicit error state on failure, never placeholder zeros. (Related perf note:
gov overview self-reports 21.0s — if cheap wins exist in the loader fan-out,
take them; full perf work can be its own round.)

## Verify + ship

- Inbox: card verdicts render for all three outcome classes; "New" count
  drops to genuinely-pending after backfill (report the number); bulk archive
  works; Promote on an email_om item runs OM promotion.
- Queue: hero for an entity with open+overdue cadence shows "Log touch →" and
  it logs/advances; P0.5 sorted by value; bulk open works idempotently.
- Review console shows the staged-intake lane with working actions.
- Today: My Priorities mirrors queue top items.
- `node --check`; function count = 12; no migration ordering hazards (any
  inbox backfill rides existing crons or a one-shot route, same rules).
