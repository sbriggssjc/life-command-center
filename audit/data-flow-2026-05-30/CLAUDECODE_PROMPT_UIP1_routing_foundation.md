# Claude Code — UI Phase 1: client routing foundation (the zoom-model substrate)

## Why (surface-walk roadmap, Phase 1 — see SURFACE_WALK_ROADMAP_2026-06-23.md + Part 3 zoom doc)
The LCC SPA has **no URL routing** today: `navTo(pageId)` (app.js ~line 960) swaps pages
in-memory by clicking the bnav button; there is no `hashchange`/`popstate`/`pushState`, and the
detail slide-over (`openUnifiedDetail` / `openEntityDetail`, detail.js) adds no URL state.
Consequences: browser **Back/Forward do nothing** (or exit the app), **reload always drops to
Today**, nothing is **deep-linkable/shareable**, and long single-page sessions cause staleness
bugs (the R61 greeting-date issue was one symptom). This phase adds the routing substrate that
the zoom-in/zoom-out model (Phase 4), deep-links, and reload-survival all depend on. **Routing
only — no back-stack/breadcrumb/entity-parity yet (those are Phase 4); but design the route
shape so Phase 4 rides on it.**

## Approach: hash routing (lowest risk, no server change)
Use `location.hash` (not History pushState clean URLs) so the Railway static/Express server
needs **no catch-all rewrite**. The hash is the source of truth for "where am I"; existing
click handlers keep working but now also drive the hash. Additive + backward-compatible:
empty hash ⇒ current default (Today).

## Unit 1 — page-level routing
- Define a small router: parse `location.hash` into `{ page, detail }`. Page segment maps to the
  existing page ids / bnav `data-page` (e.g. `#/today`, `#/priority`, `#/dia`, `#/gov`,
  `#/pipeline`, `#/inbox`, and the More/left-menu pages). Keep a stable slug↔pageId map in one
  place.
- `navTo(pageId)` (and `navToFromMore`) now ALSO writes the hash (`location.hash = '#/'+slug`)
  — use `history.pushState`-equivalent via assigning hash (creates a history entry) for user
  navigations; use a `replace` variant for programmatic/initial sets so you don't pollute
  history.
- Add a single `hashchange` (and initial `DOMContentLoaded`) handler that reads the route and
  drives the page switch — **the router calls the existing render path, it does not duplicate
  it.** Browser Back/Forward now switch pages; reload re-hydrates the page from the hash.
- **Loop guard:** when `navTo` is invoked by the router (responding to a hashchange), it must
  NOT re-write the hash / re-fire — guard with an "applying from route" flag or by comparing the
  desired vs current hash before writing. No infinite hashchange loops.

## Unit 2 — detail-level routing (deep-link + reload-survival for the slide-over)
- Encode the open detail in the hash alongside the page, e.g.
  `#/dia/property/24703/overview` or `#/<page>?d=dia:property:24703:Overview` — pick ONE clean
  scheme and document it. Include: db (`dia|gov`), object type (`property|entity|lead|listing|
  sale`), id, and active tab.
- `openUnifiedDetail(db, ids, fallback, tab)` and `openEntityDetail(id)` write the detail into
  the hash; `closeDetail()` removes the detail segment (returning to the bare page route).
- On load / hashchange: if the route carries a detail segment, open that detail (call the
  existing `openUnifiedDetail`/`openEntityDetail` with the parsed args) AFTER the page is
  rendered. So a pasted/bookmarked detail URL and a reload both re-open the exact property/owner
  + tab. `switchUnifiedTab` updates the tab segment (replace, not push) so reload keeps the tab.
- **Do NOT build the lateral back-stack or breadcrumb here** — that's Phase 4. For now, opening a
  detail is a single history entry; closing it returns to the page route (Back from an open
  detail closes it, which is already an improvement). Keep the detail-open args parseable so
  Phase 4 can extend the route with a lateral stack.

## Boundaries / safety
- **Additive + backward-compatible**: every existing in-app click path keeps working; the hash
  just mirrors state. Empty/unknown hash ⇒ Today (no regression). Guard every parse against
  malformed hashes (never throw).
- **No PII in the URL** (ids/tabs/domain only — never names, emails, addresses). (Privacy rule.)
- Client-only: `app.js`, `detail.js`, `index.html` (+ maybe `ops.js`/`gov.js`/`dialysis.js`
  where `navTo` is called). **No api/*.js change** (`ls api/*.js | wc -l` stays 12). No
  migration. No server/Railway config change (hash routing needs none).
- Reversible (it's client JS); shipping is the Railway redeploy of merged `main`.

## Verify (report back)
- Page routing: clicking each bnav updates the hash; pasting `#/priority` (etc.) + reload lands
  on that page; browser Back/Forward switch pages; empty hash → Today. No hashchange loop
  (instrument a counter in dev if needed).
- Detail routing: opening a dia property writes the hash; **reload re-opens the same property +
  tab**; a deep-link to `#/dia/property/<id>/<tab>` opens it cold; closing clears the hash and
  Back from an open detail closes it (not exits the app); entity detail deep-links too.
- No regression: all existing nav + detail flows behave as before for in-app clicks.
- `node --check` (app.js, detail.js + any touched); `ls api/*.js | wc -l` = 12; full suite green.

## Documentation (do this in the same round)
Add a short **"Client routing"** note to `life-command-center/CLAUDE.md` (near the architecture
notes): the hash scheme, the slug↔page map location, the router entry points (`navTo` + the
`hashchange` handler), the detail-route encoding, the loop-guard, and the explicit note that the
lateral back-stack + breadcrumb are Phase 4 built on this scheme. This keeps the substrate
documented for the phases that build on it.

## Bottom line
Add hash routing as the single source of truth for page + open-detail, wired into the existing
`navTo`/`openUnifiedDetail` paths (additive, loop-guarded, no server change), so Back/Forward,
reload-survival, and deep-links work now — and the Phase-4 zoom model (back-stack, breadcrumb,
entity-parity) has a substrate to ride on. Update CLAUDE.md so the scheme is documented for what
comes next.
