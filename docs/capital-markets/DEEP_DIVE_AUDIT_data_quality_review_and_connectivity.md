# Deep-dive audit — Data Quality review surfaces, auto-resolution, and cross-DB connectivity

> Triggered by Scott (2026-06-16): a clear duplicate (GSA Tallahassee, identical address)
> required a manual merge and 500'd; the Data Quality section has many scattered manual-
> review surfaces; and the Domain Health connectivity view shows gaps. Ask: where can we
> auto-consolidate/auto-correct instead of manual, connect the fragmented review surfaces,
> and improve cross-database connections.
>
> Method: grounded in the LIVE dia (`zqzrriwuavgrquhisnoa`), gov (`scknotsqkcheojiaewwh`),
> and LCC Opps (`xengecqvemvfknjvbvrq`) databases + a full read of the app review surfaces
> (companion file `UX_CONSOLIDATION_AUDIT.md`). Read-only; no writes made by this audit.

## The headline (and it reframes the ask)
The instinct "auto-merge the clear duplicates" is right for the *genuine* ones — but the
review queues are **not mostly duplicates**. They are dominated by **junk rows and
telemetry noise**, and blindly auto-merging them would destroy data. The real wins are a
**junk purge + detector fixes + auto-resolving the safe slivers**, which collapses the
queues by ~95% and leaves a tiny genuine-review set — then consolidate the surfaces.

Three measured facts drive everything below:

1. **~37% of each property book has no commercial data — but gov and dia are DIFFERENT
   problems.** Properties with **no recorded owner, no lease, no sale, no listing**:
   **gov 6,833 / 19,148 (36%)**, **dia 4,549 / 12,280 (37%)**. Breaking them down changes
   the action entirely:
   - **gov = junk import artifacts.** **6,657 of 6,833 (97%) sit in big shared-address
     clusters** (≥10 properties at one address, null `lease_number`). 490 properties sit at
     just three addresses (`3800 Charlotte Ave` ×173, `277 looney rd` ×163, `718 robinson
     st` ×154), all null lease number, **0 distinct owners, 0 leases, 1 sale, 1 listing**
     among 490. Not 173 leases, not duplicates — corrupted placeholder rows. → **quarantine.**
   - **dia = real un-enriched clinics.** **0 dia shells are in big clusters; 4,517 of 4,549
     (99%) have a UNIQUE, mostly-geocoded address.** These are CMS facilities we know exist
     but haven't attached owners/transactions to — the legitimate market universe and the
     enrichment frontier. → **NOT a purge; a backfill target** (Finding F / connectivity).
     Only the 41 dia shells with a missing/placeholder address need an address fix.

2. **The "duplicate property address" detector fires on junk, not duplicates.**
   - dia: the severity-8 clusters are properties whose `address` is the literal
     placeholder **"Dialysis Unit"** in *different cities* with *different operators*
     (Atlantic City/Trenton/Elizabeth/Montclair/Bayonne/Old Bridge; H. Fuld, Trinitas,
     Mountainside, Fkc Bayonne, DaVita Old Bridge). Auto-merging them merges 6 distinct
     clinics. (52 dia properties have missing/placeholder addresses.)
   - gov: 6,908 properties fall in same-address groups, but the big groups are the
     empty-shell clusters above. Even the "same agency" half (71 groups) is mostly these.

3. **The provenance "review queue" is ~98% noise.** Of 16,362 actionable-looking rows:
   **12,657 are `skip` telemetry** (the registry correctly chose a higher-priority source
   — not a human decision) and of the 3,705 `conflict` rows **3,110 (84%) are same-source
   re-litigations** (CoStar disagreeing with its own earlier capture). Only **~355
   cross-source conflicts** genuinely need human judgment.

So: of the thousands of "manual review" items the app surfaces, the genuine human-decision
set is on the order of **a few hundred**, not tens of thousands.

## Finding A — gov junk-shell rows are the root pollutant (6,657 rows)
A gov property with no owner, lease, sale, or listing AND sharing one address with ≥10
others (null lease number) is a corrupted/placeholder import row. These gov shells:
- **Flood the duplicate-merge queue** (the gov 6,914 "property_merge" lane is mostly these
  shells sharing a stamped address — 6,657 of them).
- **Deflate the gov connectivity metrics** — coverage % is measured against a denominator
  inflated by ~6,657 un-enrichable junk rows.
- **Inflate the book** (gov shows 19,148 properties; ~6,657 are junk shells).

**Action (Tier 0, highest leverage, GOV ONLY):** classify + **quarantine** (never hard-
delete — the project doctrine) the gov junk-shell set by signature: `recorded_owner_id IS
NULL AND no sale AND no lease AND no listing AND in a ≥10-member same-address cluster`.
Provenance-tag, set the quarantine status the R23 census/reconcile already understands so
the LCC mirrors self-prune, exclude from market metrics + the duplicate detector + the
connectivity denominators, keep reversible. This single action collapses the gov duplicate
queue, fixes the gov metrics, and de-noises the Data Quality surface. Pair with a root-cause
trace of which import created them so they stop re-accruing.

**dia is explicitly OUT of Tier 0.** The 4,517 unique-address dia shells are real un-
enriched clinics (the market universe). They stay in the book; they are a recorded-owner /
transaction backfill target (Finding F), not a purge. (The 41 missing/placeholder-address
dia shells get an address fix, not a quarantine.)

## Finding B — the duplicate detector conflates three different problems
`v_data_quality_issues` `duplicate_property_address` (and the gov equivalent feeding the
property_merge lane) mixes:
- **(b1) Placeholder/missing-address false positives** (dia "Dialysis Unit") → NOT merges.
  Fix = backfill the real address + **exclude placeholder/empty addresses from the
  detector**. These become a *"missing address"* lane (auto-geocodable in many cases),
  not a merge lane.
- **(b2) Empty-shell duplication** (gov 150+ at one address) → NOT merges → Tier-0 purge.
- **(b3) Genuine duplicates** — identical *real, full* address + same tenant/agency, small
  n, BOTH sides carrying real data (the Tallahassee class: 1530 Commonwealth, GSA-ICE,
  4 sales). **This** is the auto-merge-safe set, and it is small.

**Action:** split the one noisy detector into three precise lanes; only (b3) is "merge",
and (b3) is safe to **auto-merge** under a strict gate (below).

## Finding C — auto-merge policy (do this, but gated)
Scott's ask — don't make a human click "merge" on an obvious identical-address duplicate —
is correct for (b3). Safe auto-merge predicate:
- identical **normalized FULL address + state** (not an over-stripped key), AND
- same **operator/tenant family** (dia: CMS `chain_organization`; gov: `agency`) — reuse
  the operator-agreement machinery just built for the lease pipeline, AND
- **no field that hard-conflicts** (e.g. different real `sold_price` on overlapping
  sale dates, different building size beyond tolerance), AND
- group size small (n ≤ a threshold, e.g. 4) — a 150-member "group" is a corruption
  signal, never an auto-merge, AND
- both sides non-shell (each has ≥1 of owner/lease/sale/listing).
Anything failing the gate → the (small) manual lane. Auto-merge uses the existing
`gov_merge_property` / `dia_merge_property` (now FK-unblocked) and records provenance.
**Prereq:** the merge-function hardening already prompted (PR follow-up) must land so a
batch auto-merge can't 500 mid-run.

## Finding D — auto-resolve the provenance queue (98% is not human work)
- **`skip` rows (12,657)** are registry telemetry — they should NOT appear in a human
  review queue at all. Exclude `decision='skip'` from the lane (the R13 Unit-1 filter was
  meant to do this for the gov lane; extend it everywhere the provenance queue renders).
- **same-source conflicts (3,110, 84%)** — CoStar vs its own earlier CoStar capture. These
  are auto-resolvable: newer capture of the *same* source wins (it's a refresh, not a
  cross-source disagreement). Auto-apply newest-same-source, record it; this is the R13
  learning-loop already built (`DECISION_PROVENANCE_LEARN`) — **turn it on** and extend it
  to same-source.
- **cross-source conflicts (~355)** — the genuine human set. Keep in the lane.
Result: the provenance queue drops from ~16k to ~355.

## Finding E — surface fragmentation (companion: `UX_CONSOLIDATION_AUDIT.md`)
The same kinds of manual work are scattered across **13 top-level surfaces**; a user must
visit **8+ pages** to clear all review work. Concretely:
- **Entity/contact duplicate-merging appears in 5 places** — Data Quality "Duplicate
  Candidates", Decision Center duplicate-entities lane, junk-entity lane, Unified Contacts
  "Merge Queue", Entities detail panel.
- **Property merging in 2 places** — Decision Center property_merge lane + Priority Queue
  property detail ("Consolidate Property").
- **Owner-contact linking in 3 places**; **"Create Follow-up" in 6+ places** with
  inconsistent UX; **provenance work** split between Data Quality and the Decision Center.
- Data-quality *metrics* are computed/displayed differently on the Data Quality page vs the
  Decision Center vs the Today rail.

**Action (Tier 3):** the **Decision Center is already the intended single surface** (R7
built it as the router keyed by the QUESTION being asked). Finish that consolidation:
1. Make the Decision Center the ONE place every review lane lives; the Data Quality page
   becomes a read-only *health dashboard* (metrics + sparklines), not an action surface.
2. One reusable **merge modal** (entity + property) invoked from anywhere, writing through
   the one RPC per domain.
3. One **follow-up** component.
4. Collapse the 14 `decision_type`s into ~8 logical lanes; surface open counts in the nav.
5. Every lane gets an **auto-resolved vs needs-you** split so the human only ever sees the
   genuine residue (Findings C/D feed this).

## Finding F — cross-DB connectivity gaps (Domain Health view)
Measured live (denominators include the shells, see Finding A):
- **Property → recorded_owner:** dia **2,349 / 12,280 = 19%**; gov **8,423 / 19,148 =
  44%** — but the gov cell renders **"—"** (the metric isn't wired for gov; it's actually
  44%, not blank). gov jumps after the Tier-0 junk-shell quarantine leaves the denominator
  (~6,657 un-enrichable rows go). **dia's 19% is a REAL coverage gap, not a denominator
  artifact** — the dia shells are real clinics that genuinely need owners → a recorded-owner
  backfill (county/deed/CMS-chain sourced) is the actual fix, not a purge.
- **Geocode (lat/lng):** dia **10,602 / 12,280 = 86%**, gov **17,093 / 19,148 = 89%** —
  healthy (the R76gn backfill worked); the residual is largely shells.
- **SF-link backfill (A7):** **0 / 3,106 dia, 0 / 27,605 gov (0%)** — the entity→Salesforce
  account linkage has never run/landed. This is the biggest *real* connectivity gap: the BD
  graph isn't tied to Salesforce, so the "who do we know / who owns this" joins are blind.
- **Unlinked entities 97 · Stale links 966 (7d+)** — a modest, genuine link-maintenance
  backlog (real work, but small).

**Action (connectivity):**
1. **Wire the gov `recorded_owner` metric** (display bug — it's 44%, shown blank) and
   re-baseline all coverage % AFTER the shell purge so the numbers reflect enrichable
   properties.
2. **Stand up the SF-link backfill** (A7) — 0% on 30k+ entities is the connectivity hole
   that matters; it's the join between the property/owner graph and Salesforce. Scope a
   batch linker (name/address match → SF account) with a confidence gate + a review lane
   for the ambiguous.
3. **Recorded-owner backfill** for the non-shell properties missing an owner (the real
   denominator) — county/deed/CMS-chain sourced, same pattern as the geocode backfill.
4. Drain the 97 unlinked / 966 stale via the existing entity-link machinery (small).

## Recommended sequencing (each tier de-noises the next)
- **Tier 0 — gov junk-shell quarantine** (6,657 big-cluster shells; GOV ONLY). Biggest
  single unlock: collapses the gov duplicate queue, fixes the gov connectivity denominators,
  de-inflates the book. Reversible, provenance-tagged, with a root-cause trace of the source
  import. dia shells are NOT in scope (they're real un-enriched clinics → backfill).
- **Tier 1 — Detector split + auto-resolve.** Split duplicate-address into missing-address
  / shell / genuine-duplicate; turn on provenance auto-resolve (skip-exclude +
  same-source). Queues drop ~95%.
- **Tier 2 — Gated auto-merge** of the genuine (b3) duplicates (needs the merge-function
  hardening first). Tallahassee-class merges happen automatically; only true ambiguity
  reaches a human.
- **Tier 3 — Surface consolidation.** Decision Center becomes the single action surface;
  Data Quality becomes a read-only dashboard; one merge modal, one follow-up, ~8 lanes,
  auto-vs-manual split per lane.
- **Connectivity — SF-link backfill + recorded-owner backfill + gov metric wiring**, re-
  baselined post-purge.

## Guardrails (carry the project doctrine)
- **Never hard-delete** — quarantine/exclude/provenance-tag, reversible.
- Auto-actions are **gated + recorded**; the conservative rule (agreement OR unknown
  passes; only a clear contradiction blocks/escalates) mirrors the operator/location gates
  just shipped on the lease pipeline.
- Receipts-first; each tier is independently verified at the gate before the next.
- Root-cause each junk source so it stops re-accruing (don't just sweep).

## Suggested CC prompts (one per tier — to be drafted on Scott's go)
1. Empty-shell classifier + quarantine (gov+dia) + source-import root-cause.
2. Duplicate-detector split (missing-address / shell / genuine) + provenance auto-resolve
   (skip-exclude + same-source) + flip `DECISION_PROVENANCE_LEARN`.
3. Gated auto-merge engine over the genuine-duplicate lane (after merge-fn hardening).
4. Decision Center consolidation (single surface, reusable merge modal, unified follow-up,
   lane rationalization, auto-vs-manual split).
5. SF-link backfill (A7) + recorded-owner backfill + gov metric wiring, re-baselined.
