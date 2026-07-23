# Claude Code (LCC) — SOS worklist: rapid click-through ingest + "not registered" disposition

Scott live-tested the SOS worklist on CA bizfileonline (a real owner, "Wiener Properties Inc",
CA asset). Findings + the exact redesign he wants:

- **Drop the per-state "Look up SOS" deep-link buttons.** Not wanted — finding the SOS search is
  trivial; the button (Google-routed today) just adds a hop. Remove it.
- **The real need: capture-or-dispose WHILE on the SOS page, in as few clicks as possible.**
  Every owner ends one of two ways:
  1. **Found → ingest.** The operator opens the right SOS record and the app grabs the names /
     addresses / agent / officers automatically (like CoStar ingestion) and posts them back —
     resolving that owner. Manual typing is an acceptable fallback, but auto-grab is the goal.
  2. **Not registered here → send it back.** The recorded owner isn't registered in the searched
     state (e.g. "Wiener Properties Inc" isn't in CA — the CA hits were a suspended family LLC and
     a *Minnesota* out-of-state LLC). A one-click **"Not registered in <state>"** records that
     outcome to the DB for further processing (and, per the two-state doctrine, keeps the owner
     workable for its other candidate state).
- **Rapid paste-through.** A **"Copy name"** button per owner so the operator clears the SOS
  search bar and pastes the next entity instantly. After a save or a disposition, **auto-advance**
  to the next owner in the state so they're always looking at the next one to work.

The objective (Scott's words): *"truly just clicking our way through ingestion as rapidly and
efficiently as we can."* Minimal human steps, maximum leverage.

## What to build (extension side-panel + the existing `/api/sos-writeback`)

### Unit 1 — remove the deep-link buttons; add "Copy name" + auto-advance

- Remove the "Look up SOS · <state>" button(s) from the worklist owner card
  (`renderLlcResearchQueue` / `sosSearchUrl`). Keep `sosSearchUrl` only if trivially reused;
  otherwise drop it.
- Each owner card gets a **"Copy name"** button → copies the owner's `search_name` to the
  clipboard (so the operator pastes it into whatever SOS they already have open).
- After a successful **Save** (ingest) or **Not-registered** disposition, **auto-advance**: mark
  that owner done/disposed, remove it from the visible list, and surface the next owner in the
  current state as the active target (its name ready to copy). One click → next.

### Unit 2 — "Not registered in <state>" disposition (the missing outcome)

On the active-research owner, a **"Not registered in <state>"** button. It posts a disposition
to the DB (extend `/api/sos-writeback` with a `not_found` outcome, or a sibling route) that:
- records the negative result on the `llc_research_queue` row (a status/note like
  `not_found_in_<state>` + the searched state + timestamp) — NOT `done` unless both candidate
  states are exhausted; the two-state doctrine means a CA miss still leaves the formation-state
  search open.
- if the owner has a second candidate state (asset vs filing), keep it workable under that state;
  if both are now exhausted with no find, mark it for further processing (a research task /
  status the DB can pick up) rather than silently closing.
- **Sends it back for further processing** (Scott's phrasing) — this is a real signal ("this
  recorded owner is not registered in CA"), captured, not discarded.

### Unit 3 — the auto-grab + editable capture form (like CoStar ingestion, with a manual net)

When the operator opens a SOS entity **detail** record and clicks capture:
- **Best-effort auto-grab**: run the existing `public-records.js` scanner on the detail page to
  extract registered agent / principal + mailing address / officers-members / filing number /
  formation date / status / state of formation.
- **Render the grabbed fields in a small EDITABLE form** (pre-filled where the scan succeeded,
  blank+editable where it didn't). The operator confirms/corrects — or types the fields if the
  scanner parsed nothing (SOS detail pages are per-state SPAs; the scanner is best-effort, the
  editable form is the robustness guarantee). This is the "form grabs the details automatically
  like CoStar" experience with a manual fallback so it works on ANY state's SOS.
- **Save** posts the confirmed fields to the existing `/api/sos-writeback` (unchanged contract:
  `recorded_owner_id` + the `capture` object) → `recorded_owners` + the `sos_sidebar`
  observations + closes the row → auto-advance (Unit 1).
- Improve the scanner where cheap for the two states Scott will actually use (CA bizfileonline,
  FL Sunbiz) using REAL captured fixtures; but the editable form means a scan miss never blocks
  the operator.

## Boundaries

Extension side-panel (`sidepanel.js` / `sidepanel.html`) + `/api/sos-writeback` (extend for the
`not_found` disposition; the capture contract is unchanged) · reuse the scanner + the worklist +
`renderLlcResearchQueue` · the editable form is the key new UI; auto-grab pre-fills it, never
gates it · a "not registered" outcome is recorded + routed, never a silent close · auto-advance
keeps the operator on the next owner · gov + dia · reversible · no new `api/*.js` if avoidable ·
extension ships on unpacked-reload, endpoint on Railway redeploy.

## Verify

1. `node --check` on touched files; boot/suite as applicable.
2. Worklist card no longer shows a "Look up SOS" deep-link; shows "Copy name" (copies the entity
   name) + the capture/disposition actions.
3. **Not-registered:** clicking "Not registered in CA" on a CA owner records the outcome
   (verify the `llc_research_queue` row gets the `not_found_in_CA` status/note), keeps a
   second-state owner workable under its other state, advances to the next owner.
4. **Ingest:** on a real SOS detail page, capture auto-fills the editable form where it can;
   Save posts to `/api/sos-writeback` → the owner's `recorded_owners` fields + `sos_sidebar`
   observations land; row closes; advances to next.
5. Manual fallback: on a page the scanner can't parse, the form is still editable and Save works.
6. Full loop is click-through: copy name → (operator pastes + opens record) → capture/confirm →
   Save (or Not-registered) → next owner surfaces automatically.

## Context

Next refinement of the Option-B SOS worklist. Front door (PR #1475) + two-state asset-state
recovery (PRs #1477/#351/#7346, 479 owners recovered from Unknown) are live. This makes the
human capture itself fast and gives the "not found" case a real outcome — the two gaps Scott hit
on the first live run. The captured data still flows the same `/api/sos-writeback` →
recorded_owners + `sos_sidebar` observations → reconcile chain. The scanner is best-effort
per-state; the editable confirm-form is what makes it robust across all 50 SOS layouts while
keeping the human to a few clicks.
