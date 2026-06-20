# Claude Code prompt — Contact-enrichment adapters: drain the 78 contactless owners (phased, free-source)

> Final piece of the contact-selection arc. Slice 3 left three feature-flagged enrichment hooks
> (`parse_deed_signatory` / `sos_manager_lookup` / `address_reverse_lookup`) that no-op until
> built. This builds them to resolve named decision-makers for the **78 contactless high-value
> owners** (42 address-routed + 36 SOS-routed) and attach them via the existing pivot/acquisition
> machinery. Scott's preference: **free SOS-direct scrapers over paid OpenCorporates.** Phased,
> gated, capped, reversible — read the GROUNDING, the data is sparse and that drives the order.

## Grounding (measured live 2026-06-20) — the data reality that shapes the build
- 78 contactless owners in `v_owner_active_contact`: **42 → `address_reverse_lookup`,
  36 → `sos_manager_lookup`** (+ 6 `public_company_ir` = manual IR, not a scraper).
- **The driving data is thin:** gov `recorded_owners.filing_state` (state of incorporation) is
  populated on only **132** rows, `registered_agent_address` on **132**. The broader `state`
  (owner location) covers 7,941 but is a PROXY — LLCs often file in DE/NV regardless. So for most
  SOS-routed owners **we do NOT know the filing state**, and free SOS search is per-state.
- Owner-state concentration (proxy): CA 923, TX 673, FL 448, VA 435, MD 274, IL 268, NC 251,
  OH 239. A few free-SOS states cover a real chunk IF we infer state from property/owner location.
- Reuse: `ensureEntityLink` (junk/operator/implausible guards), `owner_contact_pivot` +
  `lcc_apply_contact_feedback` (Slice 2), the `owner-contact-enrich-tick` worker + the flagged
  adapter hooks (Slice 3), the folder-feed deed/PSA ingest.

## Phase A — deed/PSA signatory parse (do FIRST: highest authority, uses docs we already have)
The signature block of a recorded deed / PSA names the human who signed for the grantee LLC — the
**authority-1 signatory**, the top of the standard, and **we already ingest these docs** via the
folder feed (no scraping, no state-guessing).
1. Ground coverage first: for the 78 contactless owners, how many have a deed/PSA doc in the
   folder-feed corpus linked to their property? Report it — that's Phase A's addressable set.
2. Parse the signature block (the executed-by / "By: ___, its Manager/Member" block) → resolve
   the signer + role → `ensureEntityLink` (guards) → attach with `contact_role='signatory'`,
   authority 1 → update the pivot active pick → owner becomes reachable.
3. Gate: a sample of parsed signatories are real named signers with correct role; 0 junk/operator;
   reversible; the owner flips `acquire_contact → cadence_touch`.

## Phase B — free per-state SOS manager lookup (the 36, start with the top free-SOS states)
Free SOS-direct (NOT paid OpenCorporates). Build the adapter framework + the **highest-volume
free states first** (e.g. FL Sunbiz, CA bizfileonline, TX SOSDirect/Comptroller) — do NOT attempt
all 50 at once.
- **State inference** (the crux): use `filing_state` when present (132); else infer from the
  property/owner `state`, and try that state's SOS + DE + NV as fallbacks. Log which state
  resolved. Owners whose state can't be resolved → leave queued (honest), don't guess-attach.
- Query by owner name → parse manager/managing-member/officer → `ensureEntityLink` → attach
  `contact_role='managing_member'`/`manager`, authority 2 → pivot update.
- **Respect each site's robots/TOS + rate limits**; gentle concurrency + jitter (the
  connection-exhaustion + bot-block lessons). Cache results. Feature-flag per state so an
  unbuilt/blocked state cleanly no-ops.
- Gate: capped run on one state (e.g. FL) → real managers attached, correct role, state logged,
  0 junk; expand state-by-state.

## Phase C — address reverse-lookup (the 42, free + rate-limited)
For owners with a residential registered/notice address, the resident is the principal (Scott's
"owns the house the LLC is registered at").
1. Confirm which address field drives the 42 `has_reg_address` owners (gov `registered_agent_address`
   is only 132 — so confirm the source; may be dia `notice_address` or property address) and
   whether it's **residential** (skip commercial/registered-agent-service addresses — those are
   Phase-B agents, not principals).
2. Free reverse-address → resident name (rate-limited; gentle, cached). Attach the resident as
   `contact_role='principal'`, authority 3 (economic owner) → pivot update. A registered-agent
   *service* address resolves to a law firm/CSC → do NOT attach as the owner principal.
3. Gate: sampled residents are plausible principals (not agent services), 0 junk, reversible.

## Wire-up + guardrails (all phases)
- Each resolved contact: `ensureEntityLink` (guards) → link person→owner with `contact_role` +
  `authority_level` + `contact_source` provenance → `lcc_apply_contact_feedback`/pivot update →
  the NBT `acquire_contact` card resolves to the attached contact (owner becomes reachable).
- Gated + capped → gate → drain, per phase AND per state/source. Reversible (provenance +
  pivot_history; never hard-delete). Free sources only; respect robots/TOS + rate limits; gentle
  concurrency. Feature-flag each adapter/state so unbuilt ones no-op (the Slice-3 posture). ≤12
  api/*.js (the worker is already a sub-route).
- **Be honest about coverage:** free scraping is fragmented, rate-limited, and anti-bot-protected;
  the unknown-filing-state owners and the can't-resolve set stay queued for manual research — do
  NOT guess-attach a wrong person. Report per-phase drain (attached / queued / unresolved).

## AMENDMENT (Scott, 2026-06-20) — free-only, + web-search path + manual-research worklist
Decision: **stay free** — no paid OpenCorporates. Rely on free public sources, cross-referencing,
Google/web search, and **manual research when automation can't resolve**. Two additions:

### Phase D — free web-search enrichment (post-deploy; network)
For an owner where SOS/address can't resolve a principal, run a **free web search** of the owner
name (+ inferred `state`, + `notice_address` city) and parse principal candidates from public
results — SOS result pages, county/business filings, press, professional-profile snippets. Same
discipline as B/C: gentle/rate-limited, guarded (`ensureEntityLink` person guards — never attach a
firm/junk/agent-service), confidence-scored, and **no confident match ⇒ no attach** (route to the
worklist below). Feature-flagged on a search-provider URL; no-op until configured. Build the
parser + dispatch now (fixture-tested); the live calls run post-deploy.

### Cross-referencing (already built — lean on it harder)
The Slice-2 `lcc_detect_contact_recurrence` already promotes a person who signs/manages across ≥2
of the owner's properties. Make this an explicit enrichment input: before any external call, check
whether the owner shares a principal with a *resolved* sibling owner (same true-owner family /
same `notice_address` / same property cluster) and reuse that contact. Free, high-confidence, zero
network — run it FIRST in the worker's order (deed → cross-ref → SOS → address → web → manual).

### Manual-research worklist (the "when necessary" path — make it efficient)
Every owner automation can't crack → a **manual-research queue row** (Decision Center lane or
`research_tasks`) carrying ALL the breadcrumbs so Scott resolves it in seconds, not from scratch:
owner name, inferred state, `notice_address_1`, the candidate bench tried + why each was rejected,
links to the owner's properties, and **2–3 pre-built Google query strings** (e.g.
`"<owner> LLC" <state> manager managing member`, `<notice_address> resident`). A manual entry
attaches via the same `ensureEntityLink` + pivot path (so a hand-found contact flows into NBT
identically). This is where the unresolvable tail lands — surfaced and actionable, never silently
dropped or guess-filled.

## My gate (per phase / per state)
- Phase A: real signatories parsed from owned docs, correct role/authority, owner reachable, 0
  junk, reversible.
- Phase B: capped per-state run attaches real managers with the resolved state logged; bad/blocked
  states no-op; 0 junk/operator.
- Phase C: residential principals attached (not agent services); 0 junk; reversible.
- Net per phase: the contactless count drops by the real-attached set; the rest stays honestly
  queued; the pivot + NBT wiring reflects each attach.
