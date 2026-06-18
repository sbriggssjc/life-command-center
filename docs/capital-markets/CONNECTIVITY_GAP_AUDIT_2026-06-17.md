# Connectivity-gap audit — where the data graph isn't fully connected (2026-06-17)

> Scott's directive: search for connection gaps that leave components not fully connected.
> Method: probed the core join/resolution chains across dia (`zqzrriwuavgrquhisnoa`), gov
> (`scknotsqkcheojiaewwh`), and LCC Opps (`xengecqvemvfknjvbvrq`) — orphans, dangling refs,
> resolution-chain breaks, domain↔entity bridges, and cross-store fragmentation. Read-only.

## Headline
The **hard FK links are clean** (0 orphan sales/leases, 0 dangling owner FKs) — structural
integrity is good. The gaps are in the **resolution + bridge layer**: the ownership graph
(`property → recorded_owner → true_owner → LCC entity → Salesforce`) is **fragmented at
every hop after the property**, so the BD pipeline (priority queue, portfolio, outreach,
Salesforce) "sees" only ~20% of the owner intelligence that actually exists in the domain
DBs. The data is there; it just isn't connected to the central graph.

## The chain, hop by hop (measured live)
1. **property → recorded_owner** — clean (0 dangling), but coverage is partial: dia 45.8%
   linked (post-Tier-4), gov 67.4%. (Known; Tier-4 territory.)
2. **recorded_owner → true_owner** — **dia: 2,845 of 6,850 (42%) have no `true_owner_id`**
   — 42% of recorded owners are not resolved to a canonical/beneficial owner. **Real,
   fixable chain gap.** (gov uses a different model — `recorded_owners` has no `true_owner`
   FK at all (only `recorded_owner_id`, `entity_type`, `merged_into_recorded_owner_id`); the
   gov recorded→true linkage path needs mapping — a structural gap of its own.)
3. **true_owner → LCC entity** — **the big one.** dia: only ~679 of 3,985 true_owners are in
   the entity graph (~17%); gov ~3,404 of 14,150 (~24%). This is NOT a deliberate
   classified-only filter: **97% of dia true_owners are classified (`owner_role` set) and
   1,337 actively own property**, yet only ~679 are bridged. The dia entity-sync
   (true_owners → entities) is largely incomplete — consistent with the dia owner legs being
   added late (R8). ~3,000 dia + ~10,700 gov real owners are absent from the BD graph.
4. **true_owner → Salesforce** — **fragmented across two unreconciled stores:**
   `true_owners.salesforce_id` (720 dia) vs `external_identities(salesforce, Account)`
   (2,009). A true_owner can have a domain-side SF id with no LCC SF identity, or vice
   versa — so "is this owner in Salesforce?" has two answers that don't agree.

## Other gaps found
- **`true_owners.lcc_canonical_entity_id` is DORMANT** — the column exists in BOTH domain
  schemas to point a true_owner back at its LCC canonical entity, but it's **0% populated**
  (0/3,985 dia, 0/14,150 gov). A designed connection that's never written; any domain-side
  query relying on it gets nothing.
- **348 dia orphan true_owners** — true_owners no recorded_owner references (unused;
  candidates for merge/cleanup, not connection).
- **cms medicare_ccn cluster** — 345 `external_identities` rows collapse onto **3 entities**
  (the R35 "Property link approved" writer-bug artifact) — known, separate cleanup.
- **Within-domain FK integrity: clean** — no orphan sales/leases, no dangling
  recorded_owner FKs. The base graph is sound; the gaps are all in resolution/bridging.

## Impact (why it matters)
Every BD capability that ranks/finds "who owns this / who do we know" reads the **LCC entity
graph**. With ~80% of true owners unbridged, the priority queue, portfolio rollups,
connected-value ranking, and Salesforce joins are computed over a fraction of the real owner
universe — owners that the domain DBs already know (classified, property-owning, some even
SF-linked) are invisible to BD because the bridge never ran.

## Proposed remediation (gated, receipts-first, in leverage order)
1. **✅ DONE 2026-06-18 — bridge in-use real owners regardless of archetype (the big unlock).**
   Shipped on PR #1235 (`claude/confident-ride-pmo1et`), applied live + verified by the
   independent gate. FINAL FRAMING (supersedes the "classify first" framing below): re-running
   the classifier reaches 0 of the unclassified owners — they are real owners with an
   *undetermined* archetype, not classifiable-but-unrun. So the fix was to **widen bridge
   eligibility from "classified" to "in-use real owner"** (per-domain `v_bridge_eligible_owners`
   off the live `ownership_history` / `properties.true_owner_id` join — NOT the stale
   `current_property_count` counter, which undercounted current owners 395 vs 1,020),
   minting via the existing `ensureEntityLink` / `lcc_finalize_bridge_eligible_owners`
   machinery with `owner_role='unknown'` (honest), reversible by
   `metadata.bridge_source='connectivity_inuse_owner'`.
   - **Result: dia true_owner bridge 679 → 3,570; gov 3,404 → 6,935** (from ~20% bridged to
     the real owner universe). All `owner_role='unknown'`, all linked (mint/link parity, 0
     missing identity), 0 unflagged artifacts.
   - **Drains (each independently gated):** dia conservative +372, gov conservative +3,531,
     broad dia +2,088. gov has no broad-only tier (eligibility = current title holder).
   - **Three broad-gate safeguards built first:** (a) auto-merge pin —
     `v_lcc_merge_candidates.auto_mergeable` forced FALSE for any group touching a bridged
     `unknown` owner (27→0; re-opens once the classified cron enriches off `unknown`);
     (b) all-canonical twin surfacing — `v_lcc_canonical_twin_candidates` (1,016+ groups
     visible vs 22) into the Decision Center merge lane, surface-not-merge; (c) `;`-composite
     split wired into the SQL bridge (firm-most segment + `metadata.composite_source_name`).
   - **Contamination guard (broad/prior-seller tier):** narrow, defensible artifact set
     (`$/approx/paren-amount/OBO/X by Y/Since <date>/Month D, YYYY`) added to the
     owner-scoped SQL guard + both eligibility views; the gate caught + corrected an interim
     over-reach (CMBS-shelf-code/year-series patterns wrongly snagged real CMBS-REO SPE +
     street-range LLC title holders — released, guard narrowed). Battery verified both
     directions (8/8 artifacts caught, 8/8 legit owners incl. CMBS-REO SPEs spared).
   - **Steady-state:** crons `lcc-bridge-eligible-fire` (`50 */4`) + `-finalize` (`55 */4`),
     both active — new in-use owners auto-bridge; the classified cron enriches `unknown`→real
     archetype on top.
   - **Follow-ups logged:** (i) the 17 dia + 2 gov `;`-composites bridged in the *conservative*
     pass (pre-#2) remain single entities — run the split helper retroactively anytime;
     (ii) `current_property_count` denormalized-counter drift (395 vs 1,020 live) — separate
     data-quality fix, likely undercounts elsewhere (any ranking/filter reading it).

   ---
   *Original framing (kept for the record; superseded by the DONE note above):*
   GROUNDED ROOT CAUSE (corrects the first framing): the sync is NOT broken — it
   bridges *classified* owners (~655 dia, matching the ~679 bridged). The break is upstream:
   **2,956 in-use dia true_owners have `owner_role='unknown'` AND `owner_role_source IS NULL`
   — the behavioral classifier never ran on them** — yet they are real active owners (2,193
   have txn activity, 757 own property, 442 have a `salesforce_id`). Fix = run the existing
   owner-role classifier (`acquired_after_lease`/`tenant_relationship_value_creation`/manual)
   over them; the ~2,193 with signals classify; the existing every-4h `lcc_sync_classified_
   owners` then mints their entities + `external_identities` automatically (no sync change).
   Gated/capped/reversible, reusing the `ensureEntityLink` junk/operator guards. Expected:
   ~2,000+ dia owners bridged into the BD graph; same pattern for gov. **(Prompt:
   `CLAUDE_CODE_PROMPT_CONNECTIVITY1_classify_owners_to_bridge.md`.)**
2. **Resolve recorded_owner → true_owner (dia 2,845).** Resolve each unresolved
   recorded_owner to a canonical true_owner (find-or-create, dedup, junk-guard). Many are
   the same name as an existing true_owner → a linking job, not external.
3. **Reconcile the two Salesforce stores.** Make `true_owners.salesforce_id` and
   `external_identities(salesforce, Account)` agree — one canonical SF link per owner;
   surface mismatches in the Decision Center. (Pairs with the deferred connector-gated
   SF-link backfill.)
4. **Map the gov recorded → true owner linkage** — gov has no `true_owner` FK on
   recorded_owners; establish/repair the path so gov's chain matches dia's.
5. **Decide `lcc_canonical_entity_id`** — either populate it as the canonical back-reference
   (write it when the bridge runs) or retire the dormant column. Don't leave a designed
   connection permanently empty.
6. (Cleanup) 348 dia orphan true_owners + the cms medicare_ccn artifact — small, separate.

## Guardrails (carry the project doctrine)
- Each remediation: ground first (gap vs by-design), capped batch → gate → drain;
  reversible; junk/operator guards on every entity mint (reuse `ensureEntityLink`,
  `lcc_normalize_entity_name`, the operator-agreement machinery); conflicts → Decision
  Center. Never overwrite curated links; never mint garbage entities.
- The bridge is the highest leverage — it's what makes the rest of the graph (and all the
  prior tiers' work) actually visible to BD.
