# Claude Code — UI Phase 4: zoom-model wiring (back-stack + breadcrumb, then entity parity + drill)

## Why (roadmap Phase 4 — SURFACE_WALK_ROADMAP + DOMAIN_PAGES_REDESIGN_PART3_ZOOM_NAV §B-F)
Phases 1-3 are live (routing, Overview parity, tab unification). The app already has the HARD
parts of zoom — a single universal opener (`openUnifiedDetail`), a consistent slide-over, lateral
owner↔property links, and Phase-1 hash routing. What's missing is the connective tissue that makes
it FEEL like zoom-in/zoom-out:
- **The core bug:** in `detail.js` the header renders BOTH `<button class="detail-back"
  onclick="closeDetail()">← Back</button>` (`:118`) AND `<button class="detail-close"
  onclick="closeDetail()">×</button>` (`:133`) — **"Back" EXITS instead of ascending one level.**
  A lateral chain (property → its owner → owner's other property → a comp) can't be unwound
  step-by-step; Back dumps you fully out. The label lies.
- **No breadcrumb** — no path/depth indicator, no jump targets.
- **Entity detail ≠ property detail grammar** — `openEntityDetail` (`:11948`) uses a different
  shell/tabs than `openUnifiedDetail` (`:78`), so the "zoom object" isn't uniform across types.
- **Drill stops at L3** — an in-tab lease/sale/contact/deed doesn't zoom INTO it (and back).

Phase 4 builds the zoom tissue on the Phase-1 substrate. **It's large → sliced. Build Slice 4A
now (back-stack + honest Back + breadcrumb — the core mechanic, contained); 4B (entity parity)
and 4C (sub-record drill + next-action-everywhere) are outlined for follow-on rounds.** All
client-side (`detail.js`, `app.js`, `index.html`/`styles.css`); no api/*.js (`ls api/*.js | wc
-l`=12); no migration. Keep Phase-1 routing working (the detail-token shape extends, not breaks).

---

## SLICE 4A — back-stack + honest Back + breadcrumb (BUILD THIS)

### Unit 1 — detail nav stack + honest Back/×
Introduce an in-memory **`_detailStack`** (array of detail descriptors). A descriptor captures
what's needed to re-open a level: `{ kind:'prop'|'entity', db, id, tab, fallback }` (mirror the
Phase-1 detail-token fields so the stack and the hash agree).
- **Open semantics:** `openUnifiedDetail` / `openEntityDetail` accept an optional
  `{ push?:bool }` (or detect): a NEW object opened **while a detail is already open** and not the
  same object = a **PUSH** (lateral/drill hop) → append to `_detailStack`. A fresh open from a
  page (no detail open) = **reset** the stack to `[descriptor]`. Re-opening the SAME object
  (e.g., tab switch) does NOT push.
- **Back (`← `):** pops one level — if `_detailStack.length > 1`, pop and **re-open the now-top
  descriptor** (restoring its tab); if length == 1, it closes (current behavior). Rename the
  handler to `detailBack()` (NOT `closeDetail`). Disable/hide the Back affordance at root depth=1
  (or let it close — pick one, document it).
- **Close (`×`):** always clears the whole stack + closes (the existing `closeDetail` — have it
  reset `_detailStack=[]`).
- **History/hash integration (extend Phase 1, don't fork it):** each PUSH adds a history entry +
  updates the hash detail token to the new top (reuse `_routeSetDetailHash`); `popstate`/browser-
  Back pops the stack one level (so browser Back == "← Back" == zoom-out one level), and the hash
  always reflects the **top** descriptor (reload/deep-link re-opens the current level — the deeper
  stack below it is best-effort, not required to persist). Keep the `_routerApplying` loop guard so
  programmatic re-opens during a pop don't re-push. Update the CLAUDE.md "Client routing" note
  (it already anticipates "Phase 4 lateral back-stack rides this scheme").

### Unit 2 — breadcrumb bar
Render a breadcrumb in the detail header from `_detailStack`, e.g.
`1200 Deltona Blvd ▸ Deltona Wellness LP ▸ 845 Main St`, each crumb a **jump target** (clicking
crumb N pops the stack to depth N and re-opens it). Truncate long labels; show only the tail when
deep (e.g., `… ▸ owner ▸ current`). The breadcrumb is the visible expression of the stack — it
drives the same pop logic as Back. Brand per CLAUDE.md (Northmarq chrome).

### 4A verify
- Open a property → click its owner (lateral) → click one of the owner's other properties: the
  breadcrumb shows all three; **"← Back" ascends one level at a time** (current → owner →
  property), only the LAST Back (depth 1) closes; "×" closes from any depth.
- Browser Back/Forward mirror the stack (zoom-out/in); reload re-opens the current (top) level.
- A fresh open from a list resets the stack (no stale crumbs). Tab switches don't push.
- No hashchange loop; `node --check detail.js app.js`; suite green; 12 api files.

---

## SLICE 4B — one detail grammar: entity/owner detail parity (OUTLINE — next round)
Converge `openEntityDetail` (`detail.js:11948`) onto the same shell + tab pattern as
`openUnifiedDetail`: object-type-appropriate tabs for an owner/entity (e.g. **Overview ·
Portfolio · Contacts · Activity**), portfolio sourced from `lcc_entity_portfolio_facts` (NOT the
current name-match), + the completeness-rail + Next-Step banner property detail has. So every L2
object (property OR owner) zooms identically and pushes/pops on the same stack. (Owner-as-first-
class-L2 is the BD spine — P-BUYER, portfolios — so this is high value; it's its own round
because it's a detail rebuild.)

## SLICE 4C — sub-record drill (L4/L5) + next-action everywhere (OUTLINE — next round)
Make in-tab rows (a specific lease, sale, contact, document, deed) themselves zoom targets that
PUSH onto the stack with the same Back/breadcrumb affordance, down to the source (deed PDF / SF
record / the extraction). Extend the completeness-rail + Next-Step "what do I do here" to entity
detail + sub-records so every zoom depth answers the next action. Keyboard (Enter=zoom-in on
focused row, Esc=zoom-out one level) + iOS back-gesture (rides the history integration from 4A).

## Boundaries (all slices)
Client only; ≤12 api/*.js; no migration; reversible. Don't break existing in-app open/close flows
or Phase-1 deep-links. Northmarq brand on new chrome (breadcrumb/header). Each slice ships behind
`node --check` + suite-green + a live zoom walk.

## Documentation
Update `life-command-center/CLAUDE.md` "Client routing" with the back-stack + breadcrumb model
(it already notes Phase 4 builds on the detail-token shape) at 4A; note 4B/4C as the remaining
zoom slices.

## Bottom line
Slice 4A makes "← Back" ascend one level (not exit) with a breadcrumb trail, riding the Phase-1
history/hash substrate — the operator finally gets true double-click-in / double-click-out that
follows the data hierarchy. 4B (entity parity) and 4C (sub-record drill + next-action) complete
the model in follow-on rounds.
