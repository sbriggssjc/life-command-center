# Claude Code (LCC) — Option B: the state-sorted SOS capture worklist (wire the sidebar that already exists)

**Most of Option B is already built.** Grounding the extension + server (2026-07-22) found the
entire human-in-the-loop SOS capture pipeline exists and predates the failed automated-SOS work:

- `extension/content/public-records.js` — a heuristic scanner that detects an assessor / recorder
  / **SOS** page and extracts owner name, mailing/principal address, **registered agent**,
  **officers/members (managers)**, filing number, formation date, status, state of formation.
- `extension/background.js` (~line 614) — injects the scanner **on-demand** (`chrome.scripting.
  executeScript({files:['content/public-records.js']})`) when the human triggers capture on the
  active tab. Deliberately on-demand (a past auto-inject bug clobbered CoStar context). This IS
  Scott's model: the human does only the walled step (loading the bot-blocked SOS page); the
  scanner + everything after is automated.
- **`POST /api/sos-writeback`** (`api/admin.js` ~line 8292, rewritten `/api/sos-writeback`) —
  ALREADY consumes the capture: writes registered agent / officers / principal address / filing
  fields to `recorded_owners` using the SAME mapping as `llc-research-tick`, and closes the
  domain `llc_research_queue` row. Its header: *"Works for all 50 states day one (a human is the
  parser), compliant, no per-state adapter or paid API."*

So the SOS automated dead-end (FL/CA bot walls, AZ portal migration) is fully sidestepped — the
compliant human path was built in May and just lacks a **worklist to drive it** and a **wire into
the Option-A observations store**. That's this round.

## Unit 0 — verify the exact state first (report before building)

Confirm from the code: (a) the on-demand injection's **permission model** — does it rely on
`activeTab` (works on any user-invoked tab) or does it need host_permissions the manifest lacks
for SOS/county sites? (b) does `/api/sos-writeback` today feed the Option-A
`lcc_owner_address_observations` / `lcc_owner_link_observations`, or only `recorded_owners`?
(c) does the sidebar have any existing "capture public records" button, or is the trigger only
the background message? Report what's wired vs missing — do not assume.

## Unit 1 — the state-sorted, value-ranked SOS worklist (the missing driver)

A dedicated LCC surface: **registered entities that need SOS capture, sorted by state, value-ranked
within state** so the human batches one SOS site at a time and hits the highest-value owners first.

- **Source:** the union of the domain `entity_registry_records` empty-manager rows (gov, by
  `formation_state`) + the contactless high-value owners (`v_owner_contact_worklist`, already
  built) that resolve to a registered entity, minus anything already `source='sos_direct'` /
  captured. Value = the owner's `rank_value` (reuse it; don't re-derive).
- **Per-row affordance:** the entity name, state, value, and a **"Open SOS + capture"** action —
  a link to that state's SOS entity search (prefilled with the entity name where the URL allows)
  plus the instruction/trigger that runs the existing on-demand scanner and routes the result to
  `/api/sos-writeback` with the row's `recorded_owner_id`. The human clicks through, the sidebar
  captures, the writeback closes the row and it leaves the worklist.
- **State-by-state batching:** default the worklist to one state at a time (the natural rhythm —
  one SOS site's login/UX per session), highest-value-state or a picker. FL 334 · AZ 333 · CA 481
  are the seeded head; the broader empty-manager set (~6,570) is the tail.
- **Honest count + auto-retire:** a captured entity drops out (structural — it gains
  `source='sos_direct'` / a manager); the surfaced count is the remaining workable set, not the
  raw registry. Consumption-Layer: this is a producer (worklist) with a named consumer (the human
  + writeback), a value gate (rank_value), and auto-retire (captured → out).

## Unit 2 — wire the SOS capture into the Option-A observations store (reconcile continuously)

Extend `/api/sos-writeback` (its existing `recorded_owners` write is untouched) to ALSO emit
Option-A observations for every address the capture carries — principal, mailing, and registered-
agent addresses as DISTINCT source-tagged rows (`source_surface='sos_sidebar'`, appropriate
`address_kind`), via the same recorder RPC Option A added (`lcc_owner_address_observations`), and
record the manager/officer as a contact signal. Best-effort, never blocks the writeback. This is
what makes the SOS capture reconcile owners continuously (Build 2's dimension + sweep already
consume the observations store).

Also store the raw capture (the extracted JSON, and the SOS page URL) for audit/provenance — the
same "capture and keep the raw material" doctrine as the deed byte-capture (Build 1). Bytes of the
SOS page itself are optional (the fields are the value); at minimum keep the structured capture +
source URL.

## Unit 3 — confirm the closed loop end to end

The flow must be: worklist row → human opens SOS + captures → `/api/sos-writeback` →
`recorded_owners.manager_name`/`mailing_address`/`registered_agent_*` + `lcc_owner_address_observations`
→ the daily gov crons (03:20 manager-sync / 03:22 address-sync) → the LCC 05:00 signals pull →
owner pivots → cadence, AND the address observations → Build 2 reconcile. Verify each hop exists
(most do); wire only the missing links. No new propagation engine.

## Boundaries

Reuse the existing scanner, `/api/sos-writeback`, `v_owner_contact_worklist`, the Option-A
observation recorder RPCs, `rank_value`, the gov cron chain — **do not fork or rebuild any of
them** · the human does only the walled step (SOS page load); everything else automated · never
solve a CAPTCHA (the human loads the page, so there's no bot to block) · append-only observations ·
LCC-Opps + the existing sos-writeback `recorded_owners` write (already blessed) · reversible ·
no new `api/*.js` if avoidable (extend `admin.js` sos-writeback + add the worklist view/read).

## Verify

1. `npm run check:boot`, full suite.
2. Unit 0 state report (permission model; whether writeback feeds observations today).
3. Worklist returns real entities, state-sorted, value-ranked, capture-eligible; a captured entity
   drops out (auto-retire); count is the workable set.
4. A synthetic `/api/sos-writeback` capture with principal + mailing + agent addresses → all three
   land as distinct `sos_sidebar` observations (not collapsed) AND the existing `recorded_owners`
   write is unchanged; the Build-2 reconcile sweep picks up a resulting shared address.
5. Closed-loop spot-check: a real (or synthetic) capture flows recorded_owners → observations →
   dimension; confirm the gov cron chain hop exists.
6. Live human test (post-deploy, Scott): open one FL entity's Sunbiz page, capture, confirm the
   manager + addresses land and the row leaves the worklist.

## Context

Option B of the capture+reconcile design (`OWNER_CONTACT_CAPTURE_RECONCILE_DESIGN.md`). Build 1
(deed byte-capture) live + draining; Build 2 (reconcile engine + dimension) live; Option A
(multi-address observations + mirror + unverified CoStar link) live. This is the compliant SOS
path that replaces the dead automated one — the scanner + writeback exist; it needs the worklist to
drive it and the observations wire so its captures reconcile. The single conflict-review lane
(Scott's doctrine: surface a decision ONCE, only when a source disagrees with the fully-resolved
authenticated path) is DEFERRED until this authenticated path has produced data to conflict against.
