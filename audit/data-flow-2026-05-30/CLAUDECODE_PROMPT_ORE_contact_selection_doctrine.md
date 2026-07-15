# Claude Code (LCC) — align contact selection + prospecting with the authoritative, org-aware doctrine

## Why (Scott's doctrine, 2026-07-15 — see `ORE_REALIGNMENT_first_principles_2026-07-15.md` §9)

Contact discovery/selection/prioritization must be **authoritative-weighted and
org-structure-aware** — the same discipline as ownership reconciliation (§7) — with a
**parallel experience/direction lane**, and it must **never stall**. Objective: reach the
individual with **control to bind, or direct action on behalf of, the organization.** Who
that is depends on org size/structure, so contact resolution must match owner resolution.

**Reuse, don't rebuild.** The CONTACT-SELECTION machinery is largely built:
`owner_contact_pivot` (bench / consumed / demoted / pivot_history / recurrence_locked /
active_authority_level / active_contact_role / active_source), `v_owner_active_contact`,
the signatory→controlling→economic→agent ladder, the feedback re-rank
(`lcc_apply_contact_feedback`: referral/no_response/bounce/two_way), R5 buyer-parents +
`v_owner_archetype` (institutional/local), the just-built `lcc_signal_authority` weights,
and the deed-signatory capture (`api/_shared/deed-signatory.js`). This round EXTENDS that
structure; it does not fork it. Additive · reversible · provenance-tagged · guarded ·
never-stall · ≤12 api/*.js. No fabrication.

## Unit 1 — contact authority hierarchy: signer/managing-member/notice > CoStar
The person who **signed** is better evidence of control than an aggregator listing.
- Extend/reuse `lcc_signal_authority` (or a parallel `lcc_contact_authority`) so contact
  SOURCES rank: deed **signatory** + loan-document **executor** + LLC **managing member**
  (SOS) + **notice-address** individual (county/SOS) **> CoStar "ownership contact"** >
  naming/inference. The pivot's `active_authority_level` should reflect this ordering, so
  a deed-signer/managing-member outranks a CoStar contact for the same owner.
- Wire the **deed-signatory** (`deed-signatory.js`) + loan-executor + SOS managing-member
  + notice-individual as first-class contact candidates on the bench (they're captured but
  should be the *top* of the bench, above CoStar). Fill-blanks, provenance-tagged.

## Unit 2 — org-archetype-aware role model (the target matches the structure)
The right contact + how many depends on the org. Extend `v_owner_archetype` (today
institutional/local) into a **role-selection policy**:
- **Small LLC (`local`, 1-few individuals):** the managing member / deed signer / notice
  individual IS the target — usually the same person across SOS + deed + notice. Bench =
  those individuals; prospect directly.
- **Large REIT / institution (`institutional`, role-separated):** model functional roles —
  **acquisition** (analyst→associate→director→IC) drives buy/offer; **disposition +
  broker-selection** (asset mgmt / capital markets) drives sell decisions, informed by
  acquisition. For SELLER work, prioritize the disposition/broker-selection role; for
  BUYER work, the acquisition role. Bench carries `contact_role` typed to function.
- **Not one, not all:** resolve a considered **set** (the bench), sized + role-typed to
  structure — never arbitrarily one, never everyone. Partnership dynamics ≠ ownership %:
  weight signer/managing-member/decision-maker, not the cap table.

## Unit 3 — control-contact vs directed-contact (Lane 2 adjusts intensity, not control)
A handoff ("call my wealth manager / talk to Jane in acquisitions") **directs future
action but does NOT change who holds control.** Model two distinct dimensions on the pivot:
- **Control contact** (Lane 1, authoritative) — resolved from the authority hierarchy;
  stays the control anchor even after a handoff.
- **Directed contact** (Lane 2, experience/direction) — added when the org/contact tells
  us who to call, or from personal experience. It **elevates that person's priority** and
  **lightens** (not stops) the touch cadence on the control contact. A handoff is
  non-binary: keep prospecting the decision-maker lighter, focus on the directed person.
- Record direction in `pivot_history` with a `direction`/`handoff` event; add
  `directed_contact_*` fields (or a bench role `directed`) + a per-contact **intensity**
  (full / light) so the cadence engine touches the control contact lightly + the directed
  contact fully. Reuse `lcc_apply_contact_feedback` — add a `handoff`/`directed` verdict.

## Unit 4 — buyer vs seller prospecting mode (drives cadence type + touch content)
Classify each true company by behavior; prospect accordingly:
- **Programmatic Buyer** (REIT / repeat acquirer — reuse R5 `lcc_buyer_parents` /
  `v_lcc_buyer_spe_entities`): mode `buyer` → prospected via **ongoing listing marketing**
  (buy-side), NOT the seller cadence. This is the existing P-BUYER buy-side path — wire
  the company's buyer classification into the contact/prospecting layer so buyers route
  buy-side automatically.
- **Everyone else → mode `seller`** → seller cadence. The touch **content** maximizes
  name-recognition resonance: "you own this, I sell this" (location + blue-suit —
  tenant/asset-type + a comparable we closed/listed), always leading with value / non-
  public info (Buyers: early product access; Sellers: info that could move value /
  timeline / financing / valuation / tenant-renewal trends).
- Surface `prospect_mode` (buyer|seller) + a `touch_theme` (location / blue-suit / value-
  info) on the company so the cadence draft + template selection pick the resonant content
  automatically (extend the R24 template layer + the draft path).

## Unit 5 — never-stall guarantee
The authoritative lane (Lane 1) must **always** produce a best-authoritative control
contact + keep working — the pivot always carries an `active_contact` from the authority
hierarchy, and enrichment/reconciliation proceed **without waiting** on a manual "who to
call" decision. Manual feedback only when genuinely stuck (no authoritative candidate at
all) → a directed research task, not a global stall. Verify no code path blocks the
whole owner's resolution pending an operator pick.

## Boundaries / verify
- LCC-Opps orchestration (pivot/bench extension, authority weights, archetype role policy,
  buyer/seller mode, touch content); reuse the built CONTACT-SELECTION + R5 + reconciliation
  primitives. Additive · reversible · provenance-tagged · never fabricate a contact ·
  never-stall · ≤12 api/*.js.
- **Verify:** (a) for a small LLC, the managing-member/deed-signer sits ABOVE CoStar on the
  bench; (b) for a REIT, the bench is role-typed (acquisition vs disposition) and seller
  work targets disposition; (c) a `handoff` verdict adds a directed contact + lightens the
  control-contact cadence without dropping it; (d) a buyer-classified company routes
  buy-side, a seller-classified one gets a seller cadence with a location/blue-suit theme;
  (e) no owner's resolution stalls pending a manual pick. Spot-check 3 owners across the
  small-LLC / REIT / buyer archetypes.

## Bottom line
Make contact selection mirror ownership reconciliation: authoritative-weighted (signer >
CoStar), org-structure-aware (individual for small LLCs, role-separated for REITs), a
considered set not an arbitrary one, with a second experience/direction lane that
re-weights intensity without overwriting control — and a buyer/seller mode that drives the
whole prospecting motion + the resonant, value-first touch content. Lane 1 never stalls;
Lane 2 makes it smarter as we learn.
