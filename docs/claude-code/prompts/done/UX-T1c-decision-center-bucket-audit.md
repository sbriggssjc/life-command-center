# UX-T1c — Decision Center bucket audit: every lane graded human-required vs resolvable, one-click per bucket

> **Read first:** `docs/architecture/app-ux-review-2026-09-02.md` row **UX44** ("Decision Center:
> good layout; audit every bucket for human-required vs code/Ollama-resolvable; design each for
> one-click resolution; candidate for a deeper audit") and §3's **UX49** ideas (*a per-surface
> contract*, *a human-in-the-loop budget*) — the same two ideas UX-T1b built for the research
> workbench; this round builds them for the Decision Center. Also read
> `docs/architecture/research-workbench.md` (UX-T1b, **shipped 2026-09-08** — the model to mirror:
> live census before design, one tab/bucket per genuine human action, named gaps instead of guessed
> dispositions, a flow-dashboard-style human-in-the-loop count) and the three prior grading rounds
> this row cites — `docs/audits/P134...` (Ollama clean-assist context/evidence gating),
> `docs/claude-code/STATUS.md` **P137** (provenance-conflict ladder wiring), **P139** (two
> incomparable rank scales sharing one lane, interleave fix) — so you don't re-grade what's already
> graded, you audit the buckets nobody has looked at yet.

**Repo:** `life-command-center`. **Surfaces:** `api/admin.js` (`FEDERATED_DECISION_TYPES` at
~line 7335 — the source-of-truth lane set; each lane's verdict handler lives nearby), `ops.js`
(`_DC_FEDERATED` at ~line 1856 — the client-side mirror; **CLAUDE.md documents this repo's own
class of dual-list drift**, e.g. DRIFT1's `GOV_SIGNALS`/`GOV_STATE_SIGNALS` split and the P132
v1/v2 embed-parity trap — confirm these two lists actually agree before building on top of either),
`dc-lanes.js` (`_DC_FED_META` at ~line 23 — per-lane render metadata, card copy, verdict buttons).
**Canonical page to update in the same change:** extend `docs/architecture/research-workbench.md`
with a Decision Center companion section, or create a new sibling doc if the surface is different
enough to warrant its own page — check first, say which, and cross-link both from
`docs/os/CURRENT-STATE.md`'s canonical-doc map.

---

## 0. The doctrine already stated, restated as the spec

Same two ideas UX-T1b already built for the research workbench, applied to the Decision Center:

- **UX44:** *"audit every bucket for human-required vs code/Ollama-resolvable; design each for
  one-click resolution."*
- **UX49 (per-surface contract):** purpose · the one question the bucket answers · the ONE
  canonical view/query it reads · the human action(s) it demands · (new here) **can this action be
  taken in the same click that surfaces the card, or does it need a second screen.**
- **UX49 (human-in-the-loop budget):** per bucket, the count a code path could resolve vs the count
  actually requiring a human — the exact number UX-T1b computed for the research workbench
  (~4,900 → 204). Do the same arithmetic here.
- **Operator doctrine (canon 1.7.0):** a card earns a human only when the step is one only a human
  can take. Everything else runs outside human view. This audit's job is to find where that rule is
  being violated — a bucket showing raw machine output with no genuine human judgement required —
  and where it's already correctly applied but the UI doesn't make the ONE required action obvious.

**Your job is to build the audit UX44 asks for, grounded in a fresh live census of every Decision
Center bucket that actually exists today** — not to re-litigate any bucket P134/P137/P139 already
graded, and not to re-design lanes UX-T1b already disposed of (`sf_link_candidate`,
`owner_needs_salesforce`/`true_owner_needs_salesforce` are C1's territory, not this round's).

---

## 1. Sizing — enumerate the CURRENT bucket population before touching any UI

1. **Enumerate every distinct federated Decision Center lane** from `FEDERATED_DECISION_TYPES`
   (`api/admin.js`) — not from memory, not from this file's list below (which is illustrative from
   a prior grep and may be stale or incomplete; re-derive it). Cross-check against `_DC_FEDERATED`
   (`ops.js`) and flag any lane present in one list and not the other (the DRIFT1/P132 class of
   defect — report it even if fixing it is out of scope this round).
2. **For each lane, report:**
   - open count (today, live)
   - real verdicts ever recorded (not a re-discovery tally — the A5/A5a/P159a rule: count actual
     human decisions, distinguish from any auto-resolve/auto-close path already wired)
   - does it already have a documented grading pass (P134/P137/P139, C1's `sf_link_candidate`,
     A1/A3's ownership-history lanes, P188's Tier 0 confirm lane, P196's `property_twin` lane) —
     if yes, **inherit that disposition, don't re-grade it**, just cite it and move on
   - for anything WITHOUT a prior grading pass: is the card's required action **one click**
     (a single verdict button that resolves it) or does it need a second screen/navigation to know
     what to do — name which, with 3 named example cards
   - is there a code/Ollama path that could pre-decide or pre-rank this lane and doesn't yet
     (P134's evidence-gating pattern is the template — don't invent a new mechanism, ask whether
     that one applies)
3. **Classify each un-graded lane** using the same four-way disposition UX-T1b/C1a-e used:
   **automated** (has or could have a capture-less consumer elsewhere), **gated**
   (value/decidability-floored), **retired** (`lane_no_consumer` candidate — 0 open by design),
   or **genuine human queue** (real judgement required, no automated consumer exists or can exist).
   Leave a lane's disposition unclear rather than guessing — file it as a named gap.

**Report the full table before writing a line of UI code.** Expect most of the enumerable lanes to
already have a disposition from a prior round; the value of this audit is the ones that don't, and
confirming the ones that do actually match what's rendered today (a lane graded `retired` that
still shows cards on screen is itself a defect worth naming, mirroring UX-T1b-g2's discovery that a
"retired" lane's sweep had never run).

---

## 2. The design — one-click contract per bucket, human-in-the-loop budget

Only after §1's table exists:

- **For each genuine-human-queue lane still lacking one, apply the UX49 per-surface contract**:
  state its purpose, its one canonical query, and redesign the card so the required verdict is
  reachable in the SAME click (reuse P188's Tier 0 confirm/reject/research button pattern, or A1's
  ownership-lane split pattern — don't invent a third verdict shape).
- **A companion flow-dashboard section** (extend UX-T1b's `v_lcc_research_workbench_flow`-style
  view, or a sibling Decision-Center equivalent) showing, per lane: cards shown vs cards a code path
  resolves, mirroring UX-T1b's ~4,900 → 204 arithmetic for this surface.
- **Any lane found present in one of the two lane lists (`api/admin.js` / `ops.js`) and not the
  other** gets fixed in this round if it's a one-line parity fix (add the missing entry); if fixing
  it is larger, file it as a named gap rather than scope-creeping this round.
- **No new lexical/regex classification of any kind** — same rule as UX-T1b §4: if a bucket needs
  to decide "is this decidable," it reads an EXISTING confidence signal, never a new name-matching
  rule (the repo's own banned-for-identity class).

---

## 3. Deployment reality

Same three checks as UX-T1b §3: state whether this needs a Railway redeploy (JS changes almost
certainly do); state deploy ordering for any new/extended view (additive migration first, JS
after); state whether any surface reads a browser-side `diaQuery`/`govQuery` tile needing an edge
allowlist change vs a server-mediated `domainQuery` lane needing none.

---

## 4. Out of scope

- **No re-grading any lane P134/P137/P139/C1a-e/A1/A3/P188/P196 already graded.** Inherit the
  disposition; cite the source.
- **No producer changes** — value gates, auto-close predicates, ranking logic stay as-is unless a
  lane is found genuinely undisposed and this round is doing the first grading pass on it (in which
  case follow the existing grading pattern from a cited precedent, don't invent a new one).
- **No UX-T1d work** (the "ever prospected" fact) — separate unit.
- **No Today re-cut** — already shipped (UX-T1a-today).

---

## 5. Deliverables

1. §1's lane census table (open / real verdicts / prior grading citation or "ungraded" / one-click
   or not / disposition), live-measured, both lane lists cross-checked.
2. Per ungraded lane: the one-click redesign or the named reason it stays multi-step.
3. The flow-dashboard companion view/render.
4. Any lane-list parity fix, or the gap filed.
5. Tests (behavioural over views/handlers where possible); mutation pass N/N, survivors named.
6. `docs/architecture/research-workbench.md` extended (Decision Center section) or a new sibling
   canonical page, cross-linked from `docs/os/CURRENT-STATE.md`, plus the `PLANNED-BACKLOG.md`
   UX-T1c row flipped — in the same change (BUILD-TURN-PROTOCOL).

## 6. Verify on

- The state delta on the surface: total cards visible before vs after, per lane, alongside the
  human-in-the-loop budget (cards shown vs cards a code path resolves).
- Named-row check: pull 5 cards from each redesigned lane and confirm each resolves in one click —
  if a card still needs a second screen, the lane isn't done.
- **Re-run the exact class of check UX-T1b's own gap-finding used**: for any lane already claimed
  `retired`/`automated` elsewhere in the docs, confirm live that the retirement/automation actually
  executed against production (not just that the code shipped) — this is precisely the "merged is
  not running" trap this file's history keeps paying for.
