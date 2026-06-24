# Claude Code — UI Phase 4B: entity/owner detail parity (one detail grammar)

## Why (roadmap Phase 4B — DOMAIN_PAGES_REDESIGN_PART3_ZOOM_NAV §D + SURFACE_WALK_ROADMAP)
Slice 4A (back-stack + breadcrumb) is live. But the **owner/entity detail is still a second-class
zoom object** — `openEntityDetail` (`detail.js:11958`) uses a DIFFERENT shell than property detail
(`openUnifiedDetail:78`): no tab bar, no completeness rail, no Next-Step, and — critically — it
sources the portfolio by **fuzzy name-match** (`v_ownership_current` `true_owner=ilike.*<name>*`
in both domain DBs, `:12022/12030`) instead of the authoritative BD spine. The BD model is
owner-centric (P-BUYER, portfolios, cadence), so the owner deserves property-detail-grade
treatment. 4B converges entity detail onto the property-detail shell so every L2 object (property
OR owner) zooms identically on the 4A stack — and it's the prerequisite for Phase 5 (the
owners-missing-a-contact worklist clicks INTO this shell).

4A wiring is already present in `openEntityDetail` (`detailBack`, `_detailStackSync`, `_routeSetDetailHash`)
— keep it. Client-side (`detail.js` + at most a sub-route on an existing handler for the
portfolio read — **no new api/*.js**, `ls api/*.js | wc -l` stays 12); no migration. Reuse the
property-detail shell + the 4A stack; don't fork them.

## Unit 1 — tabbed shell parity
Convert `openEntityDetail` to render the SAME slide-over shell as `openUnifiedDetail`:
`#detailHeader` (title + ENTITY badge + `detailBack()`/`closeDetail()` — already there) + a real
**`#detailTabs` bar** + `#detailBody`. Entity tab set (object-type-appropriate):
**Overview · Portfolio · Contacts · Activity**. Add a `switchEntityTab(name)` mirroring
`switchUnifiedTab` (name-keyed dispatch, updates the active pill, re-renders the body; mirror the
tab into the hash the same way property tabs do so reload keeps the tab). Keep the entity badge +
4A stack sync. Visual grammar identical to property detail (same card/section helpers).

## Unit 2 — Portfolio from `lcc_entity_portfolio_facts` (authoritative, not name-match)
Replace the fuzzy `v_ownership_current true_owner ilike` portfolio fetch (`:12020-12035`) with the
authoritative per-entity portfolio from the **BD spine**: `lcc_entity_portfolio_facts` filtered by
`entity_id` (joined to `lcc_property_attributes` for address / rent / value / domain — or read
`v_entity_portfolio_all` for the rollup + a per-property list). Source it from the LCC Opps API
(an existing entity/portfolio endpoint if one exists; else add a **sub-route on an existing
handler** like `entity-hub.js`/`operations.js` — not a new file). Render:
- a **rollup header** (property count, Σ rent/value, domains) and
- a **per-property list** where **each row is a 4A zoom target**: clicking it calls
  `openUnifiedDetail(domain, {property_id}, …)` which PUSHES onto the 4A stack (property → owner →
  property hops unwind via "← Back" + breadcrumb).
This fixes both the accuracy bug (name-match is fuzzy/wrong; SPEs + renamed owners mismatch) and
makes the owner a real hub in the zoom graph.

## Unit 3 — completeness rail + Next-Step (next-action at the owner level)
Mirror the property detail's completeness-rail + Next-Step banner for the owner. Source the
owner's next BD action from the priority-queue spine (`v_priority_queue_enriched` by `entity_id`:
`priority_band` + `reason` + `rank_value` + the resolve/connect/contact columns) so the banner
reads the SAME truth as the Priority Queue / Decision Center — e.g. "Resolve ownership & control",
"Select prospecting contact", "Open Government Buyer opportunity", "Cadence touch due", or
"Connected — no action". Completeness chips: has SF Account link? has ≥1 linked person/contact?
portfolio value known? Each chip/Next-Step routes to the existing action (the contact-acquisition
picker, the open-opportunity path, etc.). This is the "next-action at every depth" invariant for
the owner level (4C extends it to sub-records).

## Unit 4 — Contacts + Activity tabs
Keep the existing data paths (`/api/contacts?entity_id=`, `/api/activities?entity_id=`) but render
them as the **Contacts** and **Activity** tabs in the new shell. Contacts tab lists the people at
this owner; when there are none, surface the **acquire-contact CTA** (reuse the P-CONTACT/buyer
contact picker — `?action=buyer_contacts` / `select_prospecting_contact`) so the owner detail is
where Phase 5's "owner missing a contact" gets resolved. Activity = the timeline (SF activities +
touchpoints).

## Boundaries / verify
- Client `detail.js` (+ at most one sub-route on an existing handler for the portfolio read);
  **no new api/*.js** (stays 12); no migration; reversible. Reuse the property-detail shell + 4A
  stack/breadcrumb — entity opens/pops on the SAME stack as property.
- Keep Phase-1 entity deep-link (`?d=entity:<id>`) + 4A stack working; entity tab switches mirror
  to the hash (replace, not push) like property tabs.
- `node --check detail.js` (+ any handler); suite green; 12 api files.
- Live walk: open an owner (e.g. from a P-BUYER card or a property's owner chip) → it renders the
  TABBED shell (Overview/Portfolio/Contacts/Activity) with the completeness rail + Next-Step;
  Portfolio shows the authoritative `lcc_entity_portfolio_facts` properties (count/value matches
  the queue rollup, NOT a fuzzy name-match); clicking a portfolio property PUSHES (breadcrumb
  grows, "← Back" returns to the owner); Contacts/Activity render; Next-Step matches the Priority
  Queue band for that entity.

## Documentation
Update `life-command-center/CLAUDE.md` (Client routing / zoom note): entity detail now shares the
property-detail shell + tabs + 4A stack; portfolio is `lcc_entity_portfolio_facts`-sourced;
Next-Step reads `v_priority_queue_enriched`. Note 4C (sub-record drill + next-action on
sub-records) remains.

## Bottom line
Make the owner a first-class zoom object: same tabbed shell as property detail, authoritative
portfolio from the BD spine (not name-match), completeness rail + Next-Step that matches the
Priority Queue — all on the 4A back-stack. Every L2 object now zooms identically, and Phase 5's
contact-acquisition worklist has a real owner detail to land in.
