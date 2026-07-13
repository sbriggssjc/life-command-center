# App Coherence Audit — navigation, duplicate action surfaces, layout parity (2026-07-13)

Live walk of Today, Priority, dia Overview, gov Overview, Pipeline/My Work,
Decision Center + a record-click convergence test. Goal (Scott): the whole app
works together — no "various pages with various places to do essentially the same
thing." Findings grouped into **quick wins** (clear, low-risk) and **one IA
decision** (opinionated, needs Scott's direction).

## A. Navigation — two overlapping systems + a misnomer

1. **Two nav layers that overlap.** The **bottom nav** (Today · Priority ·
   Dialysis · Gov · Pipeline · Inbox · More) and the **top segment bar** on the
   domain pages (Dialysis · Government · National ST · Marketing · Prospects · All
   Other) BOTH contain **Dialysis** and **Government** — two different paths to the
   domain, with the same words meaning different things (bottom = domain page;
   top = a lead/segment filter). Confusing.
2. **"Pipeline" (bottom nav) is not a pipeline.** It renders a personal task list
   ("My Work / Team Queue") — assigned to-dos, not a deal pipeline by stage. The
   label collides with the deal-pipeline concept everyone expects.

## B. The pursue/prospect/deal concept is fragmented across ~7 surfaces

The single idea "who am I pursuing / what's my work" is spread across, with a
different label each place:
- bottom-nav **Pipeline** (= My Work tasks)
- top-segment **Prospects**
- domain sub-tab **Deals**
- gov **Leads** tab / dia **Prospects** tab
- Today **My Work** card + **Work Your Outreach**
- **Priority Queue**

Six+ labels (Pipeline / Prospects / Leads / Deals / My Work / Outreach) for
overlapping concepts. This is the core of Scott's concern.

## C. "DO THIS FIRST" hero is overloaded

The same visual hero ("▶ DO THIS FIRST") leads the Priority Queue (Boyd Watterson,
BD), the Pipeline/My Work list (a contact task), AND the Decision Center lanes.
Same treatment, different meaning per surface — it dilutes the "one clear first
action" intent. It should mark ONE surface's single top action.

## D. Same item shown in multiple places

The **"Symmetry Property Dev (owner)"** contact task appears BOTH on Today's "My
Work" card AND as the Pipeline/My Work "DO THIS FIRST" item — the same to-do in
two surfaces.

## E. Ownership resolution is offered in 4+ places (cross-surface)

We consolidated the Decision Center's five ownership lanes into one — but at the
whole-app level, "resolve/research the owner" still appears on: Today **Top Data
Gaps to Close**, Priority Queue **P0.4** (518), Decision Center **Resolve
ownership** (2,015), and the dia Overview **property review queue** (89) / gov
owner-research. Different *slices* (missing vs conflicting vs BD-resolve), but the
operator meets "figure out who owns this" on every screen.

## F. dia ↔ gov Overview — shell parity good, content parity gaps

Structure is parity (same segment bar, sub-tabs, Action Items → Portfolio order —
UI Phase 2/3 delivered the shell). But:
1. **"Action Items" surfaces different KINDS per domain.** dia = data-quality
   (1,404 NPI signals, 1,000 lease backfill, 89 property review, closures, new
   clinics); gov = BD/market (505 leases expiring, 519 active listings). Same
   header, opposite content — a user expects the same *kinds* of actions in the
   same place across domains. (dia's BD signals — its own expiring leases,
   listings — and gov's data-quality items aren't shown, so each domain leads with
   a different half.)
2. **Portfolio at a Glance tile set differs.** gov shows 8 tiles (Properties, SF,
   Gross Rent, Avg Rent/SF, Agencies, NOI, Avg NOI/Property, Contacts); dia shows
   5 (Properties, SF, Projected Rent, Avg Rent/SF, Operators) — dia is missing
   NOI, Avg NOI/Property, Contacts. (Operators↔Agencies is the correct analog;
   the missing NOI/Contacts tiles are a real gap.)
3. **Label drift:** gov "Total Gross Rent" vs dia "Projected Annual Rent."
4. **Perf:** dia Overview shows a ~9.7s loading overlay; gov renders cleaner.

## G. Record-click convergence — mostly good, one dead link

- Priority Queue rows → property/entity detail (works — the 4A/4B zoom model).
- Decision Center ownership cards → route (works).
- **Pipeline/My Work owner link ("Symmetry Property Dev") is styled as a link
  (blue, underlined) but clicking it navigates nowhere** — a dead record link.

## Recommended fixes

### Quick wins (clear, low-risk — ship as one Claude Code round)
- **Rename bottom-nav "Pipeline" → "My Work"** (or "Tasks") so the label matches
  the content; free the word "Pipeline" for the real deal pipeline.
- **Fix the dead owner link** on Pipeline/My Work → route to the 4B entity detail
  (same target the Priority Queue / DC use).
- **Dedupe the Symmetry-style item** — Today "My Work" card and the Pipeline "My
  Work" list should be the same source, not two copies (or Today links INTO the
  My Work surface rather than re-rendering the item).
- **dia Overview content parity:** add the missing Portfolio tiles (NOI / Avg NOI
  / Contacts) to match gov, and make the "Action Items" section surface the same
  KINDS in both domains (BD signals + data-quality, same order) — dia should show
  its expiring leases / listings alongside its data-quality items, gov its
  data-quality alongside its BD. Align the labels (one of Gross/Projected).
- **Reserve "DO THIS FIRST"** for the Priority Queue hero only; the other lists
  use a plainer header.
- Investigate the dia Overview ~9.7s load (a slow blocking query) — separate
  perf item.

### The one IA decision (needs Scott's direction)
**Consolidate the pursue/prospect/deal/lead surfaces (B) into a coherent set with
distinct, non-overlapping roles.** Options span from light (rename + cross-link so
each label has a clear job) to structural (one "Pipeline" home with sub-views:
Prospects / Deals / My Work, and the domain "Prospects/Leads/Deals" tabs become
filtered views of it, not separate surfaces). This is opinionated IA — it should
reflect how Scott actually wants to move between "my tasks," "who I'm pursuing,"
and "deals in flight." Recommend deciding the target model before building.

## Bottom line

The app's data + value-ranking backbone is healthy; the coherence gaps are in the
*presentation layer* — two overlapping nav systems, a mislabeled "Pipeline," ~7
scattered labels for the pursue/prospect concept, an overloaded "DO THIS FIRST,"
one duplicated item, one dead link, and dia↔gov Overview content-parity gaps. The
quick wins are clear and shippable now; the prospect-surface consolidation is the
one real IA decision to make first.
