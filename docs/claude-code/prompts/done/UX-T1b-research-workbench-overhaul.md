# UX-T1b — research workbench overhaul: each human CTA its own tab, the automation split made visible

> **Read first:** `docs/architecture/app-ux-review-2026-09-02.md` rows **UX32** (workbench overhaul,
> "the lane split (A1) is the model"), **UX35** ("Flag for research" is a producer gate wearing a
> button), **UX36** (NPI verify should show only the decidable residue), plus §2's phasing note
> ("needs UX0 and C4a first" — both ✅ shipped, canon 1.7.0/1.8.0) and §3's **UX49** ideas (*a
> per-surface contract*, *a human-in-the-loop budget*) — this round is where those two ideas get
> built for real, not left as ideas. Also read `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`
> (the model this unit is told to copy), `docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md`
> and `docs/claude-code/responses/done/C1a-e*.response.md` (the most recent, freshest precedent for
> the automate/gate/retire split — **shipped 2026-09-08**, days before this prompt, so its lane
> counts are current where P1a's are not), and `docs/os/PLANNED-BACKLOG.md` **P1a** ("a correct
> producer is now feeding lanes with ZERO consumers") for the roll-call of lanes and the doctrine
> line that governs this whole unit: *"no new producer ships without a named consumer."* The same
> rule applies here in reverse — **no lane gets a tab without a named human consumer who can act on
> it in one click.**

**Repo:** `life-command-center`. **Surfaces:** `api/queue.js` (research task CRUD/listing, v1 + v2
handlers per `CLAUDE.md`'s P132 note — **both** embed `users` twice for assignee/creator, so any
touch here re-triggers the P132 aliasing footgun; alias every embed), `ops.js`
(`renderResearchPage`, chip filters, pagination), `app.js` (page routing), plus whatever Decision
Center wiring in `api/admin.js` already exists for the split lanes (A1's `sf_link_candidate`-style
federated lanes, `ownership_history` lane split). **Canonical page to update in the same change:**
create `docs/architecture/research-workbench.md` if none exists, or extend whichever page already
owns the research-task surface — check first, say which.

---

## 0. The doctrine already stated, restated as the spec

This is not a fresh design question — Scott's app-ux-review already answered "what should this
surface be," in three rows, and canon 1.7.0/1.8.0 already state the operator doctrine those rows
depend on:

- **UX32:** *"each human CTA its own tab, minimum clicks; a flow dashboard of automations and
  where the human log-jams are. Same doctrine as UX7/UX19. The lane split (A1) is the model: four
  real actions, not one queue."*
- **UX35:** *"'Flag for research' button — new properties/info should import automatically; human
  never clicks 'allow'. The button is a producer gate; make it a code path with a review lane for
  what fails guards."*
- **UX36:** *"NPI intel: automate; if code + Ollama cannot confirm a signal, do not connect it.
  W5.2 NPI consumer routes by confidence (P181 decidability). The human-verify card is the residue
  the worker abstained on — surface only the decidable few."*
- **Operator doctrine (canon 1.7.0, `docs/os/canon/blocks/operator-doctrine.md`):** the human sees
  the minimum effective dose — a card earns a human only when the step is one only a human can take
  (send the email, make the call, spend money, reach a source the code cannot, or a judgement no
  rule can make). Everything else runs outside human view.

**Your job is to build the surface those three rows describe, grounded in a fresh census of what is
actually on the workbench today** — not to re-litigate whether the doctrine is right.

---

## 1. Sizing — enumerate the CURRENT workbench population before touching any UI

Nothing here may be designed from memory of P1a's 2026-08-27 table. **C1a-e shipped 2026-09-08**
and per its own STATUS entry retired/gated/automated several of the exact lanes P1a lists —
`true_owner_needs_salesforce` was retired as `c1c_lane_no_consumer`, and `property_missing_recorded_owner`
was narrowed. Re-derive the table, don't quote the old one.

1. **Enumerate every distinct research-task type currently reachable from the workbench** — grep
   `api/queue.js` and `ops.js` for the lane/type vocabulary (`research_type`, `lane`, chip
   definitions), not from any doc. For each:
   - open count (today, live)
   - real completions ever — `outcome NOT ILIKE '%gap_resolved%'` (the auto-close is not
     throughput; A5/A5a's rule)
   - whether it already has a **named split view** (`establish_ownership_history` does —
     `v_lcc_ownership_history_lane_split`; most do not)
   - whether it already has a **capture path** — per Dead-End playbook Class 3, only
     `owner_contact_manual` (P173) and `establish_ownership_history` (P179) have one today;
     confirm this is still true post-C1a-e, don't assume it.
   - its current disposition per C1a-e/P1a's own framework: **automated** (a code path with a
     capture-less consumer elsewhere, e.g. the Decision Center `sf_link_candidate` lane), **gated**
     (value/decidability-floored, admits a measured minority), **retired** (`lane_no_consumer`,
     0 open by design), or **genuine human queue** (real completions > 0 on real human verdicts,
     no automated consumer exists or can exist — e.g. `owner_contact_manual`'s SOS bot-wall
     constraint).
2. **Only "genuine human queue" lanes are candidates for a tab.** Anything automated/gated/retired
   this round inherits *from* — do not re-open C1a-e's decisions; if a lane reads ambiguous, say so
   and leave it out of scope rather than re-deciding it here.
3. **NPI specifically (UX36):** re-measure the W5.2 consumer's routing
   (`mv_npi_inventory_signals` → `research_tasks` types `npi_missing_inventory` /
   `npi_new_registration`, per `CLAUDE.md` §"W5.2 — NPI signal consumer") — what fraction of open
   NPI-verify cards are P181-decidable today vs abstained residue. **This number is the entire
   justification for UX36**; do not build the tab without it.
4. **"Flag for research" (UX35):** find the actual button/handler in the frontend (grep
   `app.js`/`detail.js`/`ops.js` for the literal control) and what happens on click today — is
   there a producer already running the same check automatically, and does the button just
   duplicate it, or does it do something no automated pass does? Report which before deciding
   whether it becomes a pure code path or keeps a narrower human trigger for what guards can't
   resolve.

**Report the full table before writing a line of view/handler code.** If a lane's disposition is
genuinely unclear (no C1a-e-style diagnosis exists for it), leave it OUT of this round rather than
guessing a disposition — file it as a named gap, don't build a tab on a guess.

---

## 2. The design — tabs, minimum clicks, the flow dashboard

Only after §1's table exists:

- **One tab per genuine-human-queue lane** (or a small number of lanes merged where they share one
  action shape — state which and why, mirroring A1's four-action split rather than one-tab-per-raw-type
  if that reads better; the deciding test is "does this tab answer ONE question with ONE action",
  the UX49 "per-surface contract" idea: purpose · the one question it answers · the ONE canonical
  view it reads · the human action(s) it demands).
- **Minimum clicks per card** — the action the tab exists for should be reachable without a second
  navigation. If a lane already has a federated Decision Center verdict path (P188's Tier 0 pattern,
  A1's confirm/reject/research), reuse that pattern rather than inventing a new verdict shape.
- **The flow dashboard (UX32's "where the human log-jams are" + UX49's "human-in-the-loop budget"):**
  one view, one query, rendered once — per lane (or per tab), the count of cards a code path could
  resolve vs the count actually requiring a human, and the age/backlog trend. This is NOT a new
  metrics platform; it's a small view over the same `v_lcc_research_lane_summary` family (extend it
  per-lane the way A1 extended it for ownership, per `CLAUDE.md`'s note that
  `human_actionable_tasks` is NULL for every unsplit lane today) plus §1's per-lane table rendered
  as a page, not a doc.
- **NPI tab (UX36):** renders ONLY the decidable residue from §1.3's measurement — the card must
  say why a row is here (which confidence tier, why code/Ollama could not resolve it), not "here is
  every NPI signal."
- **"Flag for research" (UX35):** per §1.4's finding — either remove the button entirely (a code
  path already covers it) or narrow it to a code path with a review lane for guard failures
  (per the row's own prescription), never leave it as a raw human-triggered import with no guard.

---

## 3. Deployment reality

- State plainly whether this needs a Railway redeploy (JS changes almost certainly do — the
  `merged is not running` doctrine) and whether any new/extended view needs its own deploy
  timing relative to the JS (additive migration first, JS after, per the standing "Deploy ordering"
  rule in `CLAUDE.md`).
- If a lane's tab reads a federated Decision Center source (`domainQuery`), no edge-allowlist
  change is needed (server-mediated, per the existing `property_twin` lane precedent); if it reads
  a browser-side `diaQuery`/`govQuery` tile, check the edge allowlist and say so.
- Pagination: **return the real `pagination` block, never a page that silently truncates** — the A1
  lesson (a chip filtering to N rows with no pager reads as the whole population). Chips filter
  server-side and their counts gate on the SAME predicate as the list (P139's lying-badge rule).

---

## 4. Out of scope

- **No change to any producer** — the CMS/GSA/SOS ingestion, A2/A3/A4/A5c value gates, W5.2's NPI
  routing logic itself. This round changes what's SHOWN and how it's ACTED ON, not how a lane
  decides what's in it.
- **No re-litigating C1a-e's automate/gate/retire calls.** If a lane already has a disposition,
  inherit it.
- **No Decision Center bucket-by-bucket audit** — that's UX44/UX-T1c, a separate unit.
- **No Today re-cut** — UX-T1a-today already shipped that.
- **No new lexical/regex classification of any kind** — if a tab needs to decide "is this decidable,"
  it reads an EXISTING confidence signal (P181/W5.2, or a lane's own split view); it does not invent
  a new name-matching rule (the repo's own banned-for-identity class, paid for a dozen times).

---

## 5. Deliverables

1. §1's lane census table (open / real completions / capture path / disposition), live-measured.
2. The tab structure decision with the reasoning (which lanes get a tab, which merge, which are
   left out as unclear-disposition gaps).
3. The flow-dashboard view + its render, extending `v_lcc_research_lane_summary`-style
   per-lane split rather than inventing a parallel metrics surface.
4. NPI tab scoped to §1.3's measured decidable residue.
5. "Flag for research" disposition per §1.4 — removed or narrowed to a guarded code path + review
   lane.
6. Tests (behavioural over the views/handlers where possible, per the repo's own "guard the shape,
   not a line-anchored grep" rule); mutation pass N/N, survivors named.
7. `docs/architecture/research-workbench.md` (new or extended) + the `PLANNED-BACKLOG.md` UX-T1b
   row flipped, in the same change (BUILD-TURN-PROTOCOL).

## 6. Verify on

- **The state delta on the surface itself**: total cards visible on the workbench before vs after
  (expect a large drop — the automated/gated/retired lanes stop appearing as raw queues), reported
  alongside the human-in-the-loop budget numbers (cards shown vs cards a code path resolves), per
  tab.
- **Not on "the page loads"** — verify each tab's count matches its source view's own count
  independently queried, and that the pagination block is real (request page 2, confirm different
  rows).
- **NPI tab**: the decidable-residue count matches the P181 confidence split measured in §1.3, not
  the raw open-card count.
- **Named-row check**: pull 5 cards from each shipped tab and confirm each answers exactly the
  "one question / one action" contract from §2 — if a card requires a second screen to know what to
  do, the tab isn't done.
