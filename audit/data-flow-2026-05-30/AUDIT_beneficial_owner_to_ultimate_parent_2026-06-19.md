# Audit — true-owner / SPE → ultimate-parent beneficial-ownership resolution (2026-06-19)

**Question (Scott):** for each property's CURRENT owner — usually an LLC/LP shell — do we
resolve *up* the control structure to the controlling parent / sponsor (the beneficial owner),
find the gaps, and direct research to close them? (The complement to R46's trace *back* to the
developer.)

## Verdict: current-owner → ultimate-parent is ~2% resolved on gov; modeled only for repeat BUYERS, not current owners

### Coverage (current owners, value-weighted, from `lcc_property_owner_facts` × `lcc_property_attributes`)
| domain | props w/ owner | LLC/LP/trust-owned | resolve to a registered parent | unresolved | unresolved rent | distinct unresolved owners |
|---|---|---|---|---|---|---|
| **gov** | 8,862 | **3,839** | **85 (2%)** | **3,754** | **$1.85B** | 3,156 |
| dia | — | 329 | few | ~320 | small | 301 |

dia is far smaller because dia `true_owner` is usually the OPERATOR (DaVita/Fresenius), not a
real-estate SPE. gov is the headline gap.

### The three structural facts
1. **No explicit parent/control edge.** `entity_relationships` has owns/purchases/sells/leases/
   finances/brokers/associated_with/guaranteed_by — but **no `parent_of` / `controls` /
   `subsidiary_of`**. The control structure is not modeled as a graph edge anywhere.
2. **Parent rollup exists only for repeat BUYERS, not current owners.** R5's `lcc_buyer_parents`
   (25 parents) + `lcc_operator_affiliate_patterns` (59 buyer patterns) + `lcc_buyer_spe_resolved`
   (743 SPEs) resolve the entity that *bought* in a sale event (the P-BUYER lane). They are not
   applied to the current-owner side, so the ownership graph doesn't roll up to the sponsor.
3. **LLC research is parked.** The Round-76ek `recorded_owners` fields exist
   (manager_name, registered_agent_name/address, filing_*, llc_research_*) but coverage is ~0%:
   gov 9 researched / 132 with a manager, dia 31; `llc_research_queue` = 883 **deferred** (no
   OpenCorporates key; Scott prefers free SOS-direct, deferred). So the external
   "manager/registered-agent → parent" leg has essentially never run.

## The resolution levers, in decreasing yield from data we ALREADY have

### Lever A — cluster-mine shell families that share a sponsor token (in our control, real)
Grouping the 3,156 unresolved gov LLC owners by a leading sponsor token yields **79 candidate
sponsor clusters covering 177 shells (14 with 3+ shells)**. The fund-numeral families are
high-confidence — a roman/arabic fund numeral across shells is a dead giveaway of one sponsor:
- `SN PROPERTIES FUNDING IV/V-*` (5 shells) → SN Properties
- `Exeter <addr>, LP/LLC` (4) → Exeter Property Group
- `SPUS6/7/8 <addr>` (4) → an institutional fund series
- `MCM Parkway <addr>` (4) → MCM
- `LSREF2/4 <…>` (3) → Lone Star Real Estate Fund
- `BPG Office Partners V/VIII/XI` (3) → BPG
- `Madison-Ofc <…>` (3) → Madison
Plus coincidental prefixes (Plaza, Route, "Property LLC") that must be human-confirmed, not
auto-merged. → **candidate parents for a confirm lane**, exactly how R5 found NGP/Easterly/Boyd.

### Lever B — apply the EXISTING registry/patterns to current owners (free, immediate)
The 85 current owners that already name-match a registered parent should roll up on the
OWNERSHIP side (the analogue of P-BUYER), so the registry's value is realized for "who controls
this property," not just "who bought it." Today that rollup is buy-side only.

### Lever C — external LLC research for the long tail (parked; mostly low-yield)
2,669 of 2,973 distinct gov LLC owners are **single-asset** (only 304 multi-asset, 30 with 5+).
A single-asset local owner usually IS the ultimate parent — there is no hidden sponsor. So
blanket SOS research is low-yield; it should be **value-ranked** and reserved for high-value
unresolved owners where a hidden sponsor is plausible. "Independent single-asset owner" is itself
a useful BD fact (different outreach than a Boyd SPE), not a failure to resolve.

## Fix doctrine (mirror R46 / R5 / the connected-system pattern)
1. **Model the parent/control edge explicitly** so a confirmed parent propagates + powers an
   owner-side portfolio rollup (reuse R5 `lcc_buyer_parents` + affiliate patterns; add the
   ownership-side resolver/rollup — do NOT fork the registry).
2. **Cluster-mine candidate parents** (Lever A) → value-ranked candidate view, esp. fund-numeral
   families; human-confirm registers the parent + pattern.
3. **Decision Center "beneficial owner / parent" lane**, value-ranked by $ rent, verdicts:
   `confirm_parent` (cluster candidate → register + link), `set_parent` (manual),
   `mark_independent` (single-asset standalone — stop asking; record the BD fact),
   `research` (spawn a value-ranked SOS lookup task). Idempotent; reversible; resolving a row
   rolls the property up to the sponsor and drops it out.
4. **(Gated / maybe defer)** wire the parked LLC-research as the data-acquisition feeder for the
   high-value long tail — free SOS-direct per Scott's preference. Big build; flag it.

## Bottom line
We trace ownership *back* to the developer (R46) but not *up* to the controlling parent for
current owners. gov current-owner → ultimate-parent is ~2% resolved ($1.85B unresolved),
because the control structure isn't modeled as an edge, parent rollup is buy-side only, and LLC
research is parked. The high-leverage, in-our-control fix is cluster-mining candidate sponsors +
applying the existing registry to current owners + a value-ranked confirm/research lane — the
external SOS research is the lower-yield long-tail feeder to gate or defer.
