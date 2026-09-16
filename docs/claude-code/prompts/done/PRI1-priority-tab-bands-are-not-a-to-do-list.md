# PRI1 — the Priority tab's bands (P1…P8) don't tell the user what to do; Scott wants a ranked, human-only to-do

**Filed:** 2026-09-16 (Cowork) from `docs/claude-code/SB notes/LCC app notes - Sept 12.docx` §3.
Triage row **SBN-5**. Exploratory: the deliverable is a measured design proposal and a naming fix,
not a rebuild. **Read first:** the Priority Queue render + the four sub-entries it carries
("Next best touchpoint", "Cadence dashboard", "Top BD actions", "Qualify contacts"); the cadence
engine (`docs/architecture/PHASE4_CADENCE_ENGINE.md`, HP1 series in `PLANNED-BACKLOG.md`);
`CLAUDE.md` → "A band named for the doctrine can select the opposite population".

## Scott's words

> The naming structure of each category isn't self explanatory and does not allow the user to
> intuitively navigate their way through the work. I envision this tab being a dynamic to do list
> that limits and narrows the most prioritized work and is only the human in the loop work
> summarized and gated. We want this section to be the tip of the spear in relative ranked order of
> importance so that the user can quickly and readily navigate to the most impactful work required
> to advance our entire research, business development and pipeline work.

Screenshot state: `All 939 · P1 217 · P2 131 · P3 226 · P4 14 · P5 59 · P8 292`; banner "150 rows
just need an opportunity opened → Open top 20 opportunities"; every P1 card reads "Lease expires
within 24 months · Open property →".

## Measure first

1. **What each band means, from the code, in one line each** — the predicate, not the label — and
   the band's population's *human action* (what does a broker do with a P8?). If two bands imply
   the same human action, say so.
2. **How much of the 939 is human-in-the-loop?** The banner already says 150 rows "just need an
   opportunity opened" — that is a code action with a button. Classify every band's rows as:
   *code can do it* (open opportunity, link CRM, fold agency) / *human must act* (call, visit,
   research a named source) / *waiting* (cadence not due). Report the split.
3. **Rank-order test:** take the top 10 of "All" as the tab shows them and the top 10 by a single
   explicit score (rent × lease-urgency × contactability, or whatever the cadence engine already
   computes — name it). Do they agree? Where they don't, which is right by Scott's stated goal?
4. **The four sub-entries**: which of "Next best touchpoint / Cadence dashboard / Top BD actions /
   Qualify contacts" are distinct workflows, and which are views of the same list? Count overlap of
   their top 20s.

## Propose

A one-page spec: the tab shows **one ranked list** of human-only items, each row = *who · what to do
· why now · one button*; bands become **labels the user can read** ("Lease ≤ 24 mo, no contact",
"Owner known, no CRM link", …) rather than P-numbers; code-doable rows are **not shown** — they are
executed (or queued for the code path) and counted in a footer ("150 opportunities opened
automatically today"). State what existing view/function supplies each column so the build is a
re-composition, not a new engine.

**Build in this round only the label change** (P-number → readable band label, same predicates),
flag-gated, with a test that the label ↔ predicate mapping is one-to-one. Everything else is the spec.

## Prohibitions

- ⛔ No new scoring engine; reuse the cadence engine's score and name it.
- ⛔ Do not auto-execute "code can do it" rows in this round — count them, propose the path.

## Reporting

The band table (predicate · human action), the HITL split, the rank-order comparison, the overlap
count, the spec, and the label change with its test. If any step was skipped, say so.
