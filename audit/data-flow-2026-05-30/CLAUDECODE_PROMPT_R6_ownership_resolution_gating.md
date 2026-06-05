# Claude Code prompt — R6: ownership-resolution gating + chain-to-developer doctrine

Paste into Claude Code, run from the **life-command-center** repo. Doctrine
refinement from Scott (2026-06-05), after R5 deployed. R5's gate works, but
the queue's CTA still gets ahead of the workflow.

---

## The doctrine (Scott, verbatim intent)

The Priority tab is a **ranked hierarchy of next best actions in the natural
cadence of what's next**. An opportunity is only the next action when the
control structure is ALREADY resolved and connected:

1. **SPE LLC needs connecting to its true owner/parent BEFORE an opportunity
   can be created** — ownership resolution and connection in Salesforce/owner
   contacts is a prerequisite, not an afterthought.
2. **A categorized buyer owning a leased property implies acquisition after
   initial development** → that property's ownership history must be traced
   back to the original developer, with EACH historical owner and their
   contacts connected in the Salesforce/LCC contact structure.
3. The queue CTA must reflect the entity's resolution state, not jump to
   "Open opportunity" by default.

## Verified grounding (2026-06-05 — don't re-investigate)

- **P0.5 = 402 entities. ALL 402 have `contact_id` NULL; only 16 have ANY
  `(salesforce, *)` external identity.** Under the doctrine, essentially the
  whole band is mis-CTA'd — "Open opportunity →" is shown where "Resolve
  ownership →" is the true next action.
- **R5's prefix patterns miss structurally-named SPEs:** 11 `*FGF*` entities
  sit in P0.5 ("ARLINGTON VA I FGF", "WINCHESTER VA I FGF", "ALBUQUERQUE NM
  III FGF"…) — Scott confirms FGF LLCs are **wholly owned Boyd Watterson
  subsidiaries**. Also present: "OPI BND Properties LLC", "Opi Wf Owner LLC"
  (OPI = Office Properties Income Trust, the GPT/Government Properties
  Income Trust successor REIT — same parent family as the existing GPT
  anchor), "USGP II LAKEWOOD DOT LP", "DC 12-13 FUND, LLC", "LAS VEGAS ICE
  LLC" — fund/SPE shells with unresolved control.
- **THE KEY FACT: the domain DB often already knows the answer.** Gov
  properties carry `recorded_owner = the SPE` and `true_owner = the parent`:
  e.g. "WASHINGTON DC VI FGF, LLC" → true_owner **"Boyd Watterson"** (prop
  3123); "WASHINGTON DC III FGF LLC" → "Boyd Watterson" (3134). (One FGF row
  → "Mountain Real Estate" — not all FGF map to Boyd; per-row truth beats
  name patterns.) The queue banded the recorded-owner shell without
  consuming the existing true_owner linkage.
- **Chain-to-developer gap is real:** `properties.developer` NULL on all
  sampled FGF rows despite each having 2–15 `ownership_history` rows + 1–4
  sales — the chain raw material exists but doesn't terminate at an
  identified, connected developer.

## Task

### 1. Resolution tier 0: consume the domain true_owner linkage
Extend R5's SPE→parent resolution (`v_lcc_buyer_spe_candidates` /
`lcc_resolve_buyer_parent`) with an authoritative first tier: if the queue
entity corresponds to a domain `recorded_owner` whose property rows carry a
`true_owner` that maps to a registered parent (buyer or otherwise), resolve
to that parent. Per-row domain truth OUTRANKS name patterns. Then add the
missing patterns as tier 2: `% FGF%`→Boyd Watterson (with the caveat above —
pattern only where domain truth is absent), `OPI %`/`OPI BND%`/`Opi Wf%` →
the GPT/OPI parent (consider renaming that anchor "Office Properties Income
Trust (OPI)" since it's the successor entity — flag for Scott).

### 2. Queue gating by resolution state (the core change)
P0.5 "Needs a BD opportunity opened" must REQUIRE resolution-complete:
- entity resolves to a known parent (or is itself the controlling owner —
  not an SPE shell), AND
- owner contact / SF account linkage exists (contact_id or a salesforce
  identity on the entity or its parent).
Entities failing the gate move to a new band/reason ahead of P0.5 in the
cadence (e.g. **P0.4 "Resolve ownership & control"**) whose CTA is
**"Resolve owner →"** routing to the property detail's existing resolution
flow (the Owner › Link › Lead ladder / `_udResolveEntityViaCreateLead`
machinery — reuse, don't reinvent). Rows whose resolution lands them on a
buyer parent flow into R5's P-BUYER lane automatically. Expect P0.5 to
shrink dramatically (currently 402 → only the genuinely-ready); report the
re-banded counts in the PR.

### 3. Ownership chain back to the developer (data program, phase it)
For properties whose CURRENT owner is a categorized buyer (their ownership
is an acquisition, not development):
- **(a) Chain completeness metric:** per-property, does
  `ownership_history` + `sales_transactions` trace back to an identified
  original developer (`properties.developer` populated or the chain's
  earliest owner classified as developer)? Expose as a view (gov first; dia
  same pattern if cheap) with `chain_complete` / `earliest_known_owner` /
  `missing_segments`.
- **(b) Research generation:** chain-incomplete properties feed the existing
  research-task machinery (generate-research-tasks pattern) as
  "trace ownership to developer" tasks, prioritized by property value.
- **(c) Connection:** each chain owner that IS identified gets connected:
  LCC entity (existing ensureEntityLink path) + contact linkage so the
  SF/LCC contact structure covers the full chain — developer included. The
  P0 "developer" band then has real fuel.
Phase (a)+(b) this round; (c) rides existing machinery where it already
works — state in the PR what's wired vs deferred.

### 4. UI truthfulness
Queue rows in the new resolve band show the resolution context ("Recorded
owner shell — true owner unresolved" / "True owner: Boyd Watterson — connect
SF account"), and the property-detail Next-Step banner stays consistent with
the queue's verdict (same state source — the R4-C state-aware pattern).

## Verify + ship
- "ARLINGTON VA I FGF, LLC" (and the 11 FGF rows): resolve to Boyd Watterson
  via tier 0/2 → they leave P0.5 (P-BUYER rollup or resolve band), CTA no
  longer "Open opportunity".
- A genuinely-ready P0.5 row (resolved owner + SF/contact link) still shows
  "Open opportunity →"; report how many of the 402 survive the gate.
- Chain view: the three grounded FGF properties (8744, 3123, 3134) appear
  chain-incomplete (developer NULL) and generate research tasks.
- No regression on R5: NGP SPE refusal still works; P-BUYER lane intact.
- `node --check`; `ls api/*.js | wc -l` = 12; migrations idempotent;
  deploy-ordering noted (prefer backward-compatible view/RPC changes —
  same discipline as R5's appended refusal payload).
