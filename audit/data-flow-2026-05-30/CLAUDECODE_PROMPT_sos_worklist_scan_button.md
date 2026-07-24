# Claude Code (LCC extension) — the worklist is missing its Scan button

The rapid-ingest build shipped (Copy name, Not in CA, the editable `loadOrgView` capture form,
auto-advance). Live test exposed the one missing link: **there is no way to trigger the scan
from inside the worklist.**

## The gap (grounded in the merged code)

The scan trigger — `#scanPageBtn` → `wireScanButton()` — is rendered ONLY in the Property-tab
empty-state (`extension/sidepanel.js` ~line 721) and the scan-result-empty view (~744). The
**worklist view** (`renderLlcResearchQueue`) renders each owner card with only **"📋 Copy name"**
and **"✕ Not in \<ST\>"** — no Scan button. Yet the worklist's own instruction label
(~line 3320) reads: *"Copy the name ▸ paste into your SOS search ▸ **Scan the record** — or
dispose it."* There is nothing to Scan with.

So the operator does everything right — copies the name, pastes into CA bizfile, opens the entity
detail record (e.g. LINCHAO LLC: Principal + Mailing Address, Agent, Status all visible) — and
then hits a dead end: the sidebar shows the worklist, the SOS record is the active browser tab,
but there is no button to scan it. The editable capture form (`loadOrgView`) exists and is
wired, it's just unreachable from where the operator is.

The wiring is otherwise complete: "Copy name" already marks the active capture target
(`getActiveLlcResearch` ~line 3163), and `loadOrgView`'s Save posts to `/api/sos-writeback` using
that target. Only the scan button is missing from the worklist.

## The fix

Add a persistent **"⎙ Scan this SOS page"** button to the worklist view (in the worklist
header/section, always visible while the worklist is showing — not per-owner-card, since the
operator's active browser tab is the SOS record regardless of which card is highlighted).

- Wire it to the SAME scan trigger the empty-state uses (`wireScanButton` / the `SCAN_PAGE`
  message that on-demand-injects `public-records.js` into the active tab).
- The scan result flows through the existing path → `loadOrgView` renders the editable capture
  form pre-filled with whatever the scanner grabbed (agent, principal/mailing address, officers,
  status, filing) from the active SOS tab, with the active owner (set by Copy name) as the save
  target.
- On a scan that parses nothing (SPA the scanner can't read), `loadOrgView` still renders the
  editable form blank so the operator types the visible fields — the manual net already built.
- Keep "Copy name" + "Not in \<ST\>" exactly as they are; this only ADDS the Scan entry point.

The intended loop then completes without leaving the worklist: Copy name → (paste + open the SOS
record in the browser) → **Scan this SOS page** → confirm/correct the auto-filled form → Save →
auto-advance to the next owner.

## Boundaries

Extension side-panel only (`sidepanel.js` / `sidepanel.html`) · reuse `wireScanButton` /
`SCAN_PAGE` / `loadOrgView` / the active-target machinery — do NOT rebuild the scan or the form ·
add ONE Scan button to the worklist, wired to the existing trigger · no server/API change · no
new logic · ships on unpacked-reload.

## Verify

1. `node --check extension/sidepanel.js`.
2. Open the worklist → a **"Scan this SOS page"** button is visible (persistent in the worklist,
   not hidden behind a scan).
3. With a CA bizfile entity DETAIL record as the active browser tab and an owner marked active
   (Copy name), clicking Scan this SOS page runs the scanner on that tab and opens the editable
   capture form — pre-filled where the scanner parsed the fields, blank+editable where it didn't.
4. Save posts to `/api/sos-writeback` for the active owner and auto-advances.
5. Confirm the whole loop runs without leaving the worklist view.

## Context

Final wiring of the Option-B SOS capture flow. Everything else is built and live: front door,
887 owners, two-state recovery (479 owners un-Unknowned), Copy name / Not-in-state disposition,
and the editable capture form. This one button connects the worklist to the form so the operator
can actually scan the record they've navigated to. After this, Scott can run a real CA owner
(e.g. Linchao LLC) start-to-finish, and the captured data flows the same `/api/sos-writeback` →
recorded_owners + `sos_sidebar` observations → reconcile chain.
