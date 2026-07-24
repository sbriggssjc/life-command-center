# Claude Code (LCC extension) — pin the SOS scan button so it can't scroll off

The "⎙ Scan this SOS page" button (`#scanPageBtn`) IS rendering — DevTools confirmed it's in the
live DOM at the top of `#propertyBody`, correctly styled — but it lives at the TOP of the
scrolling worklist card list, so once the operator scrolls down through owners (or the list
auto-scrolls to the active card), the button scrolls above the fold and looks missing. This
cost a long live-debug session. Make it un-missable.

## The fix

Move the **⎙ Scan this SOS page** button (and its one-line helper) OUT of the scrolling
`#propertyBody` html and INTO the persistent **`#propertyActions`** bar — the same bar that
renders "Government / Dialysis / ← Back" and stays visible at all times (it never scrolls with
the card list; it's present in every screenshot the operator took).

In `_renderWorklistFromState` (`extension/sidepanel.js`, ~line 3281 for the actions bar and
~line 3326 for the current in-body button):

- **Remove** the `<div style="margin:6px 0 10px;"><button id="scanPageBtn" …>⎙ Scan this SOS
  page</button>…</div>` block from the `html` string that goes into `#propertyBody`.
- **Add** the scan button to `actions.innerHTML`, alongside (ideally first / most prominent)
  the Government / Dialysis / ← Back buttons, e.g. a full-width or clearly-primary
  `id="scanPageBtn"` button at the top of the actions bar so it's the obvious action.
- Keep `wireScanButton()` wired after the render (it already runs); it binds `#scanPageBtn`
  regardless of where the button lives, so no trigger change is needed.
- Keep the short helper text ("Open the owner's record on your SOS site, then Scan…") — put it
  in the actions bar with the button, or drop it to a tiny caption; the button itself is the
  important part.

Everything else is unchanged: the scan still fires `SCAN_PAGE` → `loadOrgView` (the editable
capture form) with the active worklist owner as the save target; Copy name / Not-in-state /
auto-advance all stay as-is.

## Boundaries

Extension side-panel only (`sidepanel.js`) · reuse `wireScanButton`/`SCAN_PAGE`/`loadOrgView` —
no scan/form rebuild · this is purely relocating one existing button from the scrolling body to
the persistent actions bar · no server/API change · ships on unpacked-reload.

## Verify

1. `node --check extension/sidepanel.js`.
2. Open the worklist, scroll the card list all the way down — the **⎙ Scan this SOS page**
   button stays visible in the bottom actions bar (with Government / Dialysis / ← Back), never
   scrolls away.
3. With a CA bizfile entity detail record as the active browser tab, clicking it runs the scan →
   the editable capture form opens (pre-filled where the scanner parsed, blank+editable where it
   didn't) → Save posts to `/api/sos-writeback` for the active owner → auto-advance.

## Context

Final polish on the Option-B SOS capture flow — everything works (front door, 887 owners,
two-state recovery, capture form, disposition, and the scan button itself, which DevTools
confirmed is live). The button was simply scrolling off the top of the card list; pinning it to
the persistent bar closes the last usability gap so the operator can run owners through without
hunting for it.
