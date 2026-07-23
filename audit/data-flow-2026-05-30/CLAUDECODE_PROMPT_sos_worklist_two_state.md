# Claude Code (LCC) — SOS worklist: resolve the asset state + two-state search doctrine

The SOS Research Worklist front door works (887 owners, state picker live). But **455 owners
sit in "Unknown"** because `llc_research_queue.guessed_state` is a single field that couldn't
guess a *formation* state — even though we already know where their **property** is. And the
worklist only offers ONE state per owner, when an owner LLC has TWO relevant jurisdictions.

## Scott's doctrine (2026-07-22)

To resolve an owner via SOS you search the entity in **two** states:
1. **State of origin / filing / incorporation** — where the LLC was formed (its SOS registry).
2. **State where the real property is located** — the asset's state.

They're often different (an LLC formed in DE or a parent's home state, holding a property in
CA). Each state's SOS only shows entities registered THERE, so you may need both searches to
find the entity. The worklist must present both candidate states and let the human search each.

## Grounded (live, gov `scknotsqkcheojiaewwh`)

Of the 455 unknown-state deferred owners, the **asset state is derivable for 262 (58%)** by
joining the owner to its property through any of:
- `properties.recorded_owner_id = <owner>`
- `properties.true_owner_id = <owner>`
- `ownership_history.recorded_owner_id = <owner>` → `properties.property_id`

193 have no property link at all — they stay unresolved (surface honestly; they need the
recorded/notice address we now capture, or manual — do NOT fake a state).

## What to build

### Unit 1 — derive the asset state, shrink "Unknown"

In the worklist source (the `handleLlcResearchQueueList` query / a gov-side helper view),
derive an **`asset_state`** per owner via the COALESCE of the three link paths above. Bucket an
owner into its asset_state chip when `guessed_state` is null. This moves ~262 owners out of
"Unknown" into workable state buckets. Reuse the existing property/ownership joins; don't invent
a new matcher.

### Unit 2 — surface BOTH states per owner (two-state doctrine)

Each owner card carries up to two candidate states:
- **filing_state** = `found_filing_state` (known after a prior SOS hit) ‖ `guessed_state`
- **asset_state** = the derived property state (Unit 1)

Render both on the card (e.g. "filing: DE · asset: CA", or just the distinct set). An owner with
two distinct states appears under **both** state chips in the picker, so working "CA" surfaces
every owner whose filing OR asset state is CA. When the two agree, show one.

### Unit 3 — "Look up SOS" offers both searches

The `sosSearchUrl(name, state)` "Look up SOS" action currently opens one state's SOS. When an
owner has two distinct candidate states, offer **both** (two buttons, or a small state chooser on
the row) — "Look up SOS · <asset_state>" and "Look up SOS · <filing_state>" — each opening that
state's SOS entity search. The human searches the entity in both, per the doctrine. The
subsequent Scan → SOS→Owner flow is unchanged; whichever state the entity is actually registered
in is where the scan succeeds, and `found_filing_state` gets recorded from the real hit.

### Unit 4 — honest count

The "Unknown" chip drops from 455 to ~193 (the truly property-less). Report the real post-build
count. The 193 are a documented follow-up (resolve via the recorded/notice address, or manual),
not a silently-buried backlog.

## Boundaries

Reuse `llc_research_queue`, the existing property/ownership joins, `sosSearchUrl`, the state
picker + `renderLlcResearchQueue` — do not fork the worklist or invent a matcher · derive state,
never fabricate one (no property link ⇒ stays Unknown) · an owner can appear under two state
chips (asset + filing) — that's intended, not a duplicate · gov + dia (dia has the same
`llc_research_queue` shape) · no new `api/*.js` if avoidable (extend the worklist endpoint +
sidepanel render) · extension changes ship on unpacked-reload, endpoint on Railway redeploy.

## Verify

1. `node --check` on touched files; boot/suite as applicable.
2. Worklist "Unknown" chip drops ~455 → ~193; the freed ~262 appear under their asset-state
   chips. Report the real numbers.
3. An owner whose property is in CA but with no guessed formation state now shows under the CA
   chip with an "asset: CA" label and a "Look up SOS · CA" action.
4. An owner with two distinct states (filing ≠ asset) appears under both chips and offers both
   SOS searches.
5. The 193 truly-unresolvable stay in Unknown — confirmed as property-less, not hidden.

## Context

Next refinement of the Option-B SOS worklist (front door just shipped, PR #1475). Florida has 0
owners (confirmed live); the workable head is CA 40, TX 46 (TX SOS is paid — skip), AZ 33, VA 33,
NY 26 — plus the ~262 asset-state owners this unlocks. The captured SOS data still flows the same
`/api/sos-writeback` → recorded_owners + `sos_sidebar` observations → reconcile chain. This just
makes more of the 887 actually workable and honors the two-jurisdiction search method.
