# The ownership → true-owner → CRM truth pipeline — state of play (2026-09-10)

> **Read this first for "where are we on the whole ownership chain, end to end."** Every other doc on
> this topic covers one stage; this is the only page that walks the full pipeline Scott specified:
> **property → recorded owner → recorded-owner history (developer → current owner) → true owner →
> Salesforce / Outlook / WebEx / other enrichment → LCC pushed back out as the source of truth.**
> It does not restate any stage's numbers — every figure below is a link to the doc or audit that
> measured it, per this repo's own doctrine (`CLAUDE.md`: cite an audit for its mechanism, never
> re-quote its live number from memory). Re-measure before quoting anything here as current.

Companion pages, each already the canonical "start here" for its stage — do not duplicate their
content, extend them:
- Stage 1–2 (capture → recorded owner): `docs/architecture/property-owner-subsystem.md`,
  `property-owner-source-authority-and-doctrine.md`, `data-quality-lease-and-owner.md`,
  `ownership-data-provenance.md`, `docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md`
- Stage 3 (chain to developer): `docs/architecture/ownership-history-lane.md`
- Stage 4 (recorded → true owner, LCC entity resolution): `docs/architecture/owner-role-classification.md`,
  `docs/architecture/entity-identity-and-dedup.md`, `docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md`
- Stage 5 (true owner → contact/CRM): `docs/architecture/tier0-owner-contact-system.md`,
  `contact-reconciliation.md`, `contact-reconciliation-outbound.md`, `contact-entity-resolution.md`
- Backlog of record for every open item named below: `docs/os/PLANNED-BACKLOG.md` — search the row id
  in brackets, e.g. `[OWN-T0a]`.

---

## The pipeline, stage by stage

### Stage 1 — Property → recorded owner (per-domain capture)

**What exists:** each domain (gov, dia) captures ownership signal from deeds, leases, GSA/state
lessor changes, and bulk importers, and resolves a per-property `recorded_owner` /
`lcc_property_owner` via an evidence-weighted vote (`lcc_reconcile_property_owner`,
`property-owner-subsystem.md`).

**Where it's solid:** the vote mechanism itself, and the doctrine that Salesforce is a *source*, not
truth (`property-owner-source-authority-and-doctrine.md`).

**Where it's not:**
- **`[OWN-T0a]`** 🔴 gov's own two stores — the latest recorded deed/lease transition grantee, and
  `properties.true_owner_id` — disagree on **43.4%** of comparable properties. This is upstream of
  everything else in the pipeline; nothing downstream can be more correct than this input.
- **`[RO2a]` / `[RO2b]`** 🟢 `recorded_owners` itself carries same-party name variants (at least 45 of
  217 sampled pairs) and known capture artifacts — a property manager (`RMR`) or a tenant (`USPS`)
  captured as the grantee.
- **`[A5c]`** 🔴 the producer that should prioritize `true_owner_needs_salesforce` work emits a
  hard-coded priority literal, no real value term — the head of its queue is dominated by operators
  and placeholder names holding no real research value (`DaVita`, `Independent`, 5,227 of 6,442
  properties in the sampled lane).

### Stage 2 — Recorded-owner history: developer → current owner (the chain)

**What exists:** `ownership-history-lane.md` is canonical. `A2` (✅ shipped 2026-08-27) auto-applies
agreeing ownership-chain facts — first completion the lane has ever had, 0→288, with a named,
ranked 92-row residue. `B6b` (✅ shipped) restarted the GSA landlord-change feed that the chain partly
depends on.

**Where it's not:**
- **`[B1b]`** 🔴 `trace_ownership_to_developer` — 983 below-floor skips, still gated behind `B5`.
  Re-scoped: expect the fix to add **coverage** (more properties get *any* history), not **depth**
  (it cannot recover chain links that were never recorded).
- The A2 residue (92 rows) is dominated by **duplicate-entity blocking** (54 of 92, `ambiguous_entity`
  — e.g. `Duke Realty Limited Partnership` vs `DUKE REALTY LIMITED PARTNERSHIP`) — the SAME defect
  class Stage 4 exists to fix. **This is the first of two places in the pipeline where Stage 4
  (entity resolution) is a hard dependency of an earlier stage, not just a downstream consumer of it**
  — worth remembering before sequencing future work here.

### Stage 3 — Recorded owner → LCC's resolved "true owner" (entity resolution)

**What exists — this is the arc most of this thread's recent work has been in.**
`v_lcc_property_ownership_reconciled` is the reconciled store; conflict rows are classed
`unclassified_rival` / `duplicate_entity` / `sponsor_family_confirmed`.
- **`[OWN-T0e]` / `[OWN-T0e-b]`** ✅ shipped — sponsor-family confirmation and same-party merge lanes,
  reading a 4-hourly cache, both reversible through the single writer `lcc_merge_entity`.
- **`[C13g-min]` / `[C13g-min-lane]`** ✅ shipped — a reversible per-row `entity_type` retype
  (`lcc_retype_entity`), unblocking type-guarded merges. 13 retypes worked live this arc.
- **`[C13g-min-lane-placeholder]` / `[OWN-T0e-c]`** ✅ both shipped 2026-09-10 — placeholder
  entities now route to `junk_entity_review` instead of the retype lane, and a card whose own
  sponsor is a recognized duplicate can now merge into the correct target directly (`merge_into_sponsor`,
  same `lcc_merge_entity` writer as every other verdict here). ⚠️ The sponsor-is-duplicate affordance
  is unit-tested but has never fired against a live card — the one historical instance (NGP Group) was
  already resolved by hand before it shipped; the next real case is its first live test.

With both of those closed, the item below was the largest open gap in Stage 3 — and in the whole
pipeline — as of the last version of this page. **It is now mostly closed:**
- **`[C13g]`** ✅ **the CAPTURE-PATH fix shipped 2026-09-10.** Traced to `unpackContacts() -> contactEntityType()`
  in `api/_handlers/sidebar-pipeline.js`, the one mint path both RCA and CoStar sidebar capture share.
  RCA's deed-party owner slot sends no explicit type at all, so a too-narrow org-marker regex was the
  SOLE signal for 115 of the 142 sampled mistyped rows — now routed through the same `hasFirmSuffix()`
  guard used everywhere else in the repo. Forward-mint only, by design: the existing ~1,950-entity
  population stays `entity_type_review` lane material, not bulk-retyped from here.
  **`[C13g-costar-stoplist]`** ✅ **shipped 2026-09-10 too — and the residue's own cause was wrong.**
  The CoStar scanner's verdict DOES win outright (`contactEntityType()` checks `contact.type` first),
  so the "never read back" framing above was incorrect. The real gap ran the other direction: the
  scanner's stoplist is missing several terms `hasFirmSuffix()` has (Bancorp, Investments, Development,
  Fund, Ptnrs, Cos, Property, Enterprises, Mgmt), so a real firm like "Sentinel Bancorp" got an explicit
  but wrong `type:'person'` stamp that was trusted verbatim. Fix: `contactEntityType()` now treats an
  explicit `type:'person'` as a floor, not an absolute — `hasFirmSuffix()` can still override it to
  `'organization'`, one-directional only. `owner-role-classification.md` §9i.
- **`[OWN-T0b/c/d/f/g]`** 🔴 residue named in the 2026-09-02 audit, re-measured 2026-09-14 (b/c/g
  still open, d shipped, f reviewed/closed): no LCC mirror of `v_ownership_transitions_portfolio`;
  `duplicate_entity` merges re-measured at **1,183** live (the same `Duke Realty` class blocking Stage 2's
  A2 residue) -- the trailing-"The" framing this residue was originally sized under is now a contested,
  undecided question (see `PLANNED-BACKLOG.md`'s OWN-T0b/c/d/f/g row); ✅ **d shipped 2026-09-14** — the
  11 tombstones (12 ghost fact rows) still holding a live current fact beside their survivor were cleaned
  up via the existing, already-deployed `lcc_repair_tombstone_portfolio_facts` (P175), reversible via
  batch tag `own_t0d_2026-09-14`; ✅ **f reviewed 2026-09-14, no action needed** — the per-row UUID in
  `ownership_source` is deliberate source-chain-link citation, not noise, and the one live consumer that
  groups on it already normalizes correctly (verified 0 rows fall to `other` across 27,421 rows); 🔴 **g
  sized, not shipped** — `lcc_finalize_entity_portfolios` (live, cron-driven, runs both domains' syncs)
  confirmed to supersede only within its own inflight request payload on gov (a pagination-split property
  never gets end-dated across calls) and not at all on dia; needs a supersession-rule design decision
  before building, since "new current owner supersedes old" is not universally safe here (gov/1708 has
  two genuinely-current co-owners).
- **`[OWN-T0h]`** 🟢 two different conflict-property denominators (756 vs 2,097) are both live and
  disagree by nearly 3×; undecided which the panel and backlog should quote.
- **`[OWN-T0i]`** 🟢 hedge-phrase "owner" entities (`X or affiliated investors`) are live candidates in
  the reconciled store — an extractor's uncertainty written as if it were a party name.
- **`[UX-T1c-resolveown-vs-ownt0]`** ✅ measured, nothing built — gov's `resolve_ownership` lane and
  the LCC reconciled store were never reconciled against each other; **`[RO1]`** ✅ shipped (retired
  the 836-row no-op half); **`[RO2]`** ❌ refuted, do not build (a "sync" would have minted duplicate
  owners and made a property manager and a federal tenant into owners of record); **`[RO3]`/`[RO4]`/
  `[RO5]`** 🟡/🟢 still open — repoint the lane at the reconciled store, size the undated-deed problem,
  split the residue by arm.

### Stage 4 — True owner → contact / CRM (Salesforce, Outlook, WebEx, enrichment)

**What exists:** `tier0-owner-contact-system.md` is the canonical door into person↔owner matching
(13 audit documents, P186–P198, behind it). `contact-reconciliation.md` specs the identity spine
(one person = one LCC entity, resolvable by email or phone). The Decision Center federated lanes
(`contact_company_link`, `comms_owner_attribution_review`, `owner_contact_attach_review`,
`sf_link_candidate`) are the human-verdict doors into this stage.

**Where it's not — this is the stage furthest from the "push LCC's truth back out" goal:**
- **`[UX12a]`** 🔴 `sales_transactions.sf_deal_id` has **never** been written — **0 of 4,785** rows.
  Every "open in Salesforce deal book" button on a closed sale has nothing to link to. This is not a
  button bug; the producer that should write this field does not exist.
- **`[UX13a]`** 🔴, deferred by Scott — only Scott's own mailbox is synced (`email_bodies` = 0 for
  Kelly, Nate, Sarah). Deliberately deferred until those teammates are added as users, so correspondence
  attribution (Stage 4's main evidence source) is structurally one-quarter of what it could be until
  then.
- **`[UX48a]`** 🔴 the user/membership minting is polluted — 42 `workspace_memberships` rows for a
  4-person team, and **0 of 42 carry an auth identity, including the real owner** — `auth.users`
  cannot be used to clean this up from the inside.
- **`[UX-T1c-coa-stall]`** 🟡 the comms-owner-attribution cron has run green for 7 straight days and
  produced zero new proposals since 08-20 — pool genuinely exhausted, or a stuck cursor re-discovering
  its own output; not adjudicated.
- **`[UX-T1c-ccl-gap]`** 🟢 8 `contact_company_link` rows are reachable by **neither** the human lane
  nor the auto-applier — a small, named coverage hole between the two consumers of one view.
- **`[UX-T1a-reach]`** 🔴 "reached" as a concept is broken in both directions: counting only
  owner-entity-linked touches gives a false floor of 19 owners; following any link at all gives a false
  ceiling of 1,024 (it imports machine-written asset events). The real constraint the audit found:
  **only 847 of 6,480 owners (13%) have a linked person at all — 5,633 (87%) have none** — missing
  *links*, not missing *touches*. Re-measured live 2026-09-14 (Cowork) alongside verifying the Tier 0
  auto-attach fix (see `tier0-owner-contact-system.md`): **13.5% (1,377 of 10,187)** by the same
  method against today's live counts -- essentially the same ratio despite the fix now genuinely
  writing (9 new links 09-13, confirmed live, the first ever). The universe grew faster than the
  fix can close it (part of that growth is un-merged OWN-T0b/c duplicate-entity residue inflating
  the owner count); 9/day against a gap this size is not going to move the headline number on its own.
  `[UX-T1a-touchcount]` 🔴 blocks grading any fix here — `current_touch` reads p50 0 / max 8,198 against
  a 7-step sequence, so cadence position is presently unreadable.
- **SFENRICH / SF-DIRECT / RAILWAY-PA-SECRET** — separate, currently-active infra threads (owned by
  the other Cowork window working this repo) rebuilding the Salesforce SOAP-login capability lost when
  `sf-test` was deleted, and gating the enrichment webhook. Track them in `STATUS.md`, not here — they
  are plumbing for this stage, not part of the resolution logic.

### Stage 5 — LCC pushed back out as the source of truth

**What exists, narrowly:** a small number of reversible, trigger-based propagations —
`trg_gov_pse_propagate_to_sale` (property_sale_events → the sales_transactions spine, `[B6c-dup]` ✅),
`trg_propagate_ownership_to_property` (B5's fill-forward guard). LCC writes back to Salesforce **only
for direct team benefit** (email/contact correction, BD list add, a logged call's ROE territory) —
"never merely to sync" is a standing doctrine line from `property-owner-source-authority-and-doctrine.md`,
not yet contradicted by anything built since.

**Where it's not:** this is the *thinnest* stage in the whole pipeline. Almost nothing here writes back
out past Salesforce today — no Outlook write-back, no WebEx write-back, and the one Salesforce
write-back doctrine line is aspirational more than it is a built system with guards and a ledger the
way `lcc_merge_entity` or `lcc_retype_entity` are. **This is the natural next design question once
Stage 4's mailbox/link gaps close (Stage 3's entity-type capture-path arc is now fully shipped,
`C13g-costar-stoplist` included)** — there is limited value in building more push-back machinery while
the upstream store is still 43% disagreeing with itself (`OWN-T0a`) and Stage 4 itself has only 13%
owner-to-person linkage.

---

## Reading the shape of the whole pipeline

Two patterns repeat across every stage, worth carrying into whatever gets prioritized next:

1. **Every stage's residue is smaller once the SAME class of fix lands upstream.** Stage 2's A2 residue
   (54 of 92) and Stage 3's OWN-T0b/c/d/f/g residue (417 `duplicate_entity` merges) are both blocked by
   the identical entity-dedup gap; Stage 3's `C13g` capture-path gap (now fully closed, RCA and CoStar
   both) was what kept re-creating the
   population Stage 3's retype lane exists to clean up. **Fixing entity-dedup and entity-typing at the
   root (once, upstream) is worth more than any one stage's local patch** — this is the single highest-
   leverage thread across the whole pipeline as stated. **`[ID3b]` ✅ shipped 2026-09-12 — one slice of
   this root-level fix, now done:** the gov `recorded_owners`/`true_owners` fuzzy-name-VARIANT residue
   (name-format/punctuation/abbreviation duplicates like `Baker Properties Limited Partnership` /
   `Baker-Properties, Ltd.`) that RO2a sized (1,380 groups / 2,870 rows combined) is now merged —
   1,466 `recorded_owners` rows + 232 `true_owners` rows collapsed into their survivors via two new
   guarded tick functions, 26 correctly routed to human review (bank/lienholder/brokerage names,
   never auto-merged), parity confirmed bit-for-bit. **This is NOT the same population as the
   OWN-T0b/c/d/f/g `duplicate_entity` residue below** — that 417-row population is Stage 3's
   `entity_match_candidates`-classified rival/duplicate entities (a different classification lane,
   `sponsor_family_confirmed`/`duplicate_entity`/`unclassified_rival`), still open. ID3b closed the
   *upstream, mechanical, name-variant* half of "the same entity-dedup gap"; the *downstream,
   classification-driven* half (OWN-T0b/c/d/f/g, and Stage 2's A2 residue) is unaffected by this build
   and remains the next entity-dedup slice to take.
2. **The human-verdict lanes (Decision Center) are unevenly used, independent of whether they're built
   well.** `[UX-T1c]`'s live census found **12 of 28 federated lanes have never received a single
   verdict**, several holding thousands of live, fully-wired candidate rows (`agency_risk_action` 692,
   `npi_dedup_review` 285). Before building a new lane anywhere in this pipeline, check whether an
   existing one with real population is simply not being worked — that is cheaper to fix than it is to
   build.

## Open decisions — needs Scott, compiled across the whole chain (2026-09-14, Cowork; updated 2026-09-15 with Scott's answers)

Every item below is a genuine judgment call, not sizing work Cowork can push further alone. Compiled
in one place per Scott's request so nothing sits scattered across per-stage docs waiting to be
noticed. Re-measure the live numbers before acting on any of these -- this pipeline's populations
move by hundreds between sessions (see OWN-T0c's 417 → 1,183 in two weeks as the cautionary case).

Scott answered all six of the items below on 2026-09-15, in one message, compiled together per his
own request. Item #1 is closed and shipped (see below); items #2-#6 have a decided RULE but most
still need building -- each keeps its own numbered entry with Scott's verbatim answer and current
state.

1. **✅ CLOSED 2026-09-15 — Trailing "The" in the canonical entity key** (`[OWN-T0c]`, `PLANNED-BACKLOG.md`).
   Scott's answer, verbatim: *"Good question. I'm not sure I care so long as we are getting to truth
   and accuracy as the priority. If they are the same entities, merge. I don't have a preference about
   the naming structure."* Shipped: `lcc_entity_name_tokens` strips a trailing "The" token; 12
   confirmed collision groups (16 entities) merged. That alone only moved the property-conflict-scoped
   `duplicate_entity` class 1,183 → 1,177 -- most of that residue turned out to be a SEPARATE
   collision class. Measured the true scope of the decision (6,636 groups / 14,007 entities sharing a
   canonical_name, not scoped to property conflicts) and found `v_lcc_merge_candidates` +
   `lcc_apply_fuzzy_merges` already built to apply it safely -- ran it live, 3,021 groups / 3,305
   entities merged, 0 failures. `duplicate_entity` now **930** (was 1,183 at the start of this
   decision). Remaining 3,772/8,005 canonical-name collisions are the review-gated tail (bridged
   unknown-role, multiple Salesforce accounts, low name similarity) -- not swept, needs its own review
   pass. Full detail: `docs/claude-code/STATUS.md` 2026-09-15 entry,
   `supabase/migrations/20261102160000_lcc_own_t0c_trailing_the_and_fuzzy_merge_sweep.sql`.
2. **🟡 RULE DECIDED, not yet built — `entities.canonical_name` as an enforced UNIQUE key**
   (`[N15c] (2)`, `tier0-owner-contact-system.md` §6). Scott's answer: *"Yes, probably good to
   establish the name standard for each group that is most accurate and use it everywhere, merging
   those naming variants that do not comply."* Was blocked by #1; #1's merge sweep is done, so this is
   now much closer to safe, but NOT yet measured -- the 3,772/8,005 remaining canonical_name
   collisions (the review-gated tail) would still violate a hard unique constraint today. Next step:
   measure how close to unique-clean the population is after a review pass on that tail, then add the
   constraint.
3. **✅ CLOSED 2026-09-15 — `lcc_finalize_entity_portfolios`'s supersession rule** (`[OWN-T0g]`).
   Scott's answer: *"If there was a deed or a transfer of ownership in some clear capacity, then the
   prior ownership has ended. Accuracy first."* Classified `ownership_source` producers by data, not
   assumption (live query against `lcc_entity_portfolio_facts`): `county_deed`, `gov_ownership_chain`,
   `sales_transaction`, `sales_transactions_seller_exit` are genuine recorded transfer instruments;
   `gsa_lease_diff`, `gsa_lease_lessor`, `lcc_property_owner`, `county_records`, `costar`/
   `costar_sidebar`, and null are lease-record restatements, internal snapshots, or market data -- not
   proof an ownership change happened. Sized the live blast radius against `v_lcc_property_multi_current`'s
   735 `multi_current_distinct_parties` population before writing anything: 72 properties had a
   transfer-evidenced current fact competing with a stale current fact for a different party; of
   those, 57 were safe to auto-resolve (the stale fact's own last-known date was on or before the
   transfer's date, or unknown) and 15 were a genuine unresolved conflict (the "stale" fact was itself
   dated *later* than the transfer) -- deliberately left alone for `v_lcc_portfolio_ownership_conflict`
   / human review, never guessed. Shipped `lcc_own_t0g_supersede_by_transfer_evidence(p_dry_run,
   p_batch_tag)`, reversible via `lcc_own_t0g_revert_supersession(batch_tag)`, fully logged to
   `lcc_own_t0g_supersession_log`. Ran it live (batch `own_t0g_2026-09-15`): dry run matched live
   exactly, **65 facts / 61 properties superseded**, 0 failures; re-running the dry run afterward found
   **0** remaining (idempotent, self-terminating). `v_lcc_property_multi_current`'s
   `multi_current_distinct_parties` count dropped **735 → 678**. Verified the known genuine co-ownership
   case (gov/1708, The Greystone Group vs. Silverstone Company) was correctly left untouched -- neither
   of its current facts carries transfer evidence, so the rule correctly declines to guess. **Also wired
   the forward fix**: `lcc_finalize_entity_portfolios` (live, cron-critical, `SECURITY DEFINER`, both
   dia and gov domains) now calls the same supersession function, live, at the end of every run --
   scanning the WHOLE table (cheap, ~14k rows), not just that run's payload, which is what actually
   closes the cross-sync-batch gap the audit found. Verified the modified live function still runs
   clean (`select * from lcc_finalize_entity_portfolios()`, no error, no unintended side effect --
   `multi_current_distinct_parties` stayed at 678, 0 new log rows since nothing was left to supersede).
   Migrations: `supabase/migrations/20261102180000_lcc_own_t0g_transfer_supersession.sql` (log table +
   both functions), `supabase/migrations/20261102190000_lcc_own_t0g_finalize_calls_supersession.sql`
   (the forward-fix wiring into `lcc_finalize_entity_portfolios`). Full detail:
   `docs/claude-code/STATUS.md` 2026-09-15 entry.
4. **✅ CLOSED 2026-09-15 — 1,475 Salesforce-campaign orphans** (`[N15]`,
   `tier0-owner-contact-system.md` §6). Scott's answer: *"These are members of a specific group?
   Usually means that there is some vested interest in the space mapped by the name. Some may be
   brokers, some may be a new fund exploring the space, but the vast majority will be owners or prior
   owners and the membership is evidence that some prior research has concluded that in our team's BD
   history and just because the LCC doesn't yet have that connection mapped, does not mean that its
   not out there undiscovered."* Re-measured live: the SF-campaign gate held at exactly 1,475 (the
   source table, `lcc_sf_list_membership`, is a frozen 2026-07-16→07-21 snapshot -- not itself
   live-syncing, a separate gap not fixed here). Shipped `lcc_n15_mint_sf_campaign_hub_rows`
   (dry-run-safe, reversible), reusing the existing `lcc_tier0_company_confirms_domain`
   anti-fabrication gate from P197 -- `company_name` written only when the person's own email domain
   corroborates it (228 of 1,475, 15%; the rest correctly left blank, not guessed). Ran live: 1,475
   `unified_contacts` hub rows created, 0 failures, fully logged and reversible. Does not touch the
   ~4,197 email orphans outside the SF-campaign gate, and does not itself change Tier 0's blockage
   (P197 already fixed that separately with a read-time resolver) -- this is Scott's stated
   connectivity-coverage goal, not a Tier 0 fix. Migration:
   `supabase/migrations/20261102170000_lcc_n15_sf_campaign_hub_mint.sql`.
5. **✅ CLOSED 2026-09-15 — T2b: widened ownership resolution to the remaining properties**
   (`connectivity-and-open-threads.md` §4k.1). Scott's answer: *"Yes, again, the objective is accurate
   coverage of all properties in our target submarket. We want to get there as fast and efficiently as
   possible."* Re-measured live before running: 2,255 properties / 2,068 owners (essentially unchanged
   composition from the 2,241/2,054 sizing -- 805 under $50k, 712 at $50-100k, 537 rent-unknown). Ran
   the same mechanism T2a used, `lcc_mint_gov_asset_entities` + `lcc_ingest_domain_owner_evidence`
   (self-excluding view, so T2b's population was simply whatever remained in
   `v_lcc_c2e_asset_mint_plan` after T2a): dry run matched live exactly, 2,255 minted / 0 skipped,
   2,255 assets resolved, 0 orphans. The 7-row evidence gap is the identical brokerage guard T2a hit
   (`Stan Johnson Co`, `NAI Pfefferle`, `Bradford Allen Realty Services`, `SVN®`) -- working as
   designed. `v_lcc_c2e_asset_mint_plan` now reads 0 -- gov ownership resolution is exhausted at the
   $100k+/below-$100k tranche split; both tranches are fully applied. Migration/data-operation detail:
   `docs/os/PLANNED-BACKLOG.md`'s `C2e-T2b` row, `docs/claude-code/STATUS.md` 2026-09-15 entry.
6. **✅ CLOSED 2026-09-15 -- what evidence promotes an owner out of `unknown` role, and how prospecting
   coverage should widen** (`connectivity-and-open-threads.md` §4o). Scott's original answer: *"If they
   currently own an asset in our target market, that broker assigned to working that market should be
   assigned the prospecting and cadence should match the schedule planned for (7 touchpoints in the
   first 6 months, average 4 a year thereafter, but each client interaction and profile dictates the
   exact timing and content)."* Follow-up answer, resolving the one open scope question below, verbatim:
   *"Yes, we want to pursue, in research, until every current and prior owner of a building leased to
   one of the operators or agencies in our target swimlanes (dialysis and government-leased) are known
   and connected to our LCC app and code processes. The brokers can then make the election on whether
   to pursue the account or not individually, with the guidance and coaching of the LCC on the next best
   relatively important lead."*

   **Review** (per the decision's own "review before building" instruction) found more already-shipped
   machinery than expected, and one genuine category error caught before it was built:
   - **Cadence engine** (`api/_shared/cadence-engine.js`): already implements the exact 7-touch/6-month,
     ~4/year-thereafter template. No new machinery needed, and none was built -- per Scott's "brokers
     can make the election," a cadence should start when a broker elects to pursue an account, not be
     bulk-seeded for everyone who is merely known and connected.
   - **Broker/market assignment**: `BROKER1` (shipped + live 2026-09-11) already is the broker-to-market
     rule -- vertical default (`gov`->Scott, `dia`->Kelly Largent, Scott catch-all, Nate excluded),
     fill-blanks-only, reversible. No new policy needed, only a wider population to run it over.
   - **Role classification -- caught before writing anything**: the OLD scalar `entities.owner_role` /
     `behavioral_override` (`effective_owner_role`) is a HUMAN-manual-override field by convention
     (`owner-role-classification.md`) -- writing a system-derived "promotion" into it would have been a
     category error, the exact "second registry" / fabrication class this repo avoids. The live
     deterministic role-SET view (`v_lcc_entity_roles`) already correctly classifies **445 of 447**
     reachable current owners `investor_owner` and **3,804 of 3,820** prior owners `former_owner` --
     computed live, no backfill needed. **Promotion was never a data gap; it was already correct in the
     system that has the right semantics.** The OLD scalar column stays stale and unused for gating
     (C6, 2026-08-29, already dropped the role predicate from the live queue) -- fixing its display on
     the operator card, if it still reads 'unknown' there, is a UI concern, not a data build, and is not
     addressed here.

   **Sizing, live 2026-09-15**: current target-market owners at `effective_owner_role = 'unknown'`:
   3,322 distinct, 447 reachable. Prior owners (held a fact that ended, holds none now): 3,820 distinct,
   197 reachable. Reachability is the dominant bottleneck for both populations (86.5% of current, 94.8%
   of prior owners are NOT reachable) -- this is a contact-data-sourcing gap, not a role/broker-mechanics
   gap, and lines up with the already-filed, not-yet-decided **owner-enrichment-adapters** question
   (`FLAGDARK1`, `PLANNED-BACKLOG.md`) -- address/deed/SOS/websearch/OpenCorporates adapters are the
   actual lever for moving these reachability numbers, not anything in this decision's scope.

   **Shipped**: `lcc_own_t0i_extend_broker_assignment(p_dry_run)` -- the identical BROKER1
   **Shipped**: `lcc_own_t0i_extend_broker_assignment(p_dry_run, p_batch_tag)` -- the identical BROKER1
   vertical-default policy, applied over the wider population Scott's follow-up asked for (every
   reachable current-OR-prior target-market owner, not just the live priority-queue's lease-timing
   bands), fill-blanks-only, reversible (`delete ... where set_by like 'own_t0i_%'`). Does not touch
   `lcc_broker1_assign_prospect_brokers` or its population. Dry run matched live exactly: **1,044
   reachable owners total, 487 already assigned, 557 newly defaulted** (315 gov->Scott, 238 dia->Kelly,
   4 catch-all->Scott). Re-run afterward: 0 remaining, idempotent. Verified Nate untouched (0 rows).
   Migration: `supabase/migrations/20261102200000_lcc_own_t0i_extend_broker_assignment.sql`.

   **What "known and connected" now means concretely, for every reachable current-or-prior owner**: role
   is already correctly classified (`v_lcc_entity_roles`), a broker is now assigned (BROKER1 +
   OWN-T0i together), and the current-owner half already surfaces in the live seller-prospecting queue
   wherever lease timing puts them in-band -- brokers now have what they need to make the pursue/no-
   pursue election Scott described. **Not shipped, deliberately**: a bulk cadence seed (contradicts
   "brokers elect individually") and any change to the priority queue's lease-timing bands themselves
   (a separate, larger ranking-surface decision, not required by this answer once "known and connected"
   is read as data/assignment connectivity rather than forced outreach).

**✅ Resolved and shipped:** banks and CMBS trustees excluded from prospecting (`[N3c]`, Scott
2026-09-14, see `tier0-owner-contact-system.md` §4/§6) -- revisitable if lender prospecting via
Northmarq debt-side coordination is taken up later. Trailing-"The" (#1 above) closed and shipped
2026-09-15, including the general canonical-name merge sweep it unblocked. fcp/tmg sponsor-domain
confirmations are stale (no live population left, re-checked 2026-09-14) -- no decision needed unless
they resurface.

## Where we are toward 100% -- a snapshot, not a target date (2026-09-14, updated 2026-09-15, Cowork)

Scott's stated goal is complete connection across every targeted property and its ownership history,
pushed all the way through the BD/prospecting pipeline. These are the load-bearing numbers as measured
this session and the sessions immediately before it -- each is a live re-measurement, not a historical
quote, and each will have moved by the time this is read again:

| stage | metric | now | context |
|---|---|---:|---|
| Stage 1 | gov's two stores disagree (`[OWN-T0a]`) | 43.4% | 1,509 of 3,474 gov properties -- not re-measured this window |
| Stage 3 | duplicate-entity conflicts open (`[OWN-T0b/c]`) | **930** | ✅ decision #1 shipped 09-15; was 1,183 at the start of this decision (1,177 after the narrow trailing-"The" merge alone, 930 after the general fuzzy-merge sweep it unblocked) |
| Stage 3 | canonical_name collisions, full population (not property-scoped) | **3,772 groups / 8,005 entities** | was 6,636/14,007 before 09-15's sweep; remainder is the review-gated tail (`bridged_unknown_pinned`, `multiple_sf_accounts`, etc.) -- feeds decision #2 |
| Stage 3 | tombstone-duplicate-current defect | **0** | ✅ shipped 09-14 (OWN-T0d), was 11 |
| Stage 3 | `ownership_source` producer noise (`[OWN-T0f]`) | **0 action needed** | ✅ reviewed 09-14, already handled |
| Stage 3 | portfolio-facts supersession gap (`[OWN-T0g]`) | **✅ closed** | shipped 09-15 -- 65 facts/61 properties superseded live (batch `own_t0g_2026-09-15`), `multi_current_distinct_parties` 735→678; forward fix wired into `lcc_finalize_entity_portfolios` so every future sync self-heals |
| Stage 4 | owner-to-person linkage | 13.5% | 1,377 of 10,187 as of 09-14 -- not yet re-measured post-merge-sweep; entity-dedup can shift this denominator, recheck next pass |
| Stage 4 | Tier 0 auto-attach mechanism | ✅ verified working | 9 writes 09-13, confirmed live 09-14 |
| Stage 4 | banks/CMBS trustees in prospecting pool | excluded | ✅ shipped 09-14 |
| Stage 4 | Salesforce-campaign orphans (`[N15]`) | **0 remaining in the gated population** | ✅ shipped 09-15 -- 1,475 `unified_contacts` hub rows minted live, 228 with a domain-confirmed company |
| Stage 4 | remaining unresolved ownership (T2b) | **0 remaining in the mint plan** | ✅ shipped 09-15 -- 2,255 gov properties minted and resolved, both tranches of gov asset-anchor resolution now fully applied |
| Stage 4 | owner-role promotion doctrine | none live | rule decided 09-15 (decision #6); not yet built |
| Stage 4/5 | "reached" (person-link definition, C4/C5) | 618 of 6,480 (9.5%) | 08-28 measurement, not re-measured this session |
| Stage 5 | Salesforce deal-book linkage (`[UX12a]`) | 0 of 4,785 | producer does not exist |
| Stage 5 | teammate mailbox sync (`[UX13a]`) | Scott-only | deliberately deferred |

**Honest read:** decision #1 is closed -- the single largest named blocker is gone, and the
canonical-name collision population dropped by more than half (6,636 → 3,772 groups) in one guarded
sweep using machinery that was already built and just needed running. That directly reduces Stage 3
noise feeding Stage 4, but Stage 4's headline linkage number (13.5%) has not yet been re-measured
against the cleaned-up entity graph -- that re-measurement, plus decisions #3-#6 (all ruled on but
none yet built), are the next concrete steps toward 100%. Decision #4 (Salesforce orphans, 1,475
entities) and #5 (T2b, 2,241 properties) are the next-largest counted populations still sitting on a
decided-but-unbuilt rule.

## The UX review (the Word-document walkthrough)

`app-ux-review-2026-09-02.md` is canonical for the 48-comment operator review; `PLANNED-BACKLOG.md` §P16
is authoritative for state, not this page. Status by tier, at a glance (re-read §P16 before quoting a
row's live state — this table is a map, not a source):

| Tier | What it covers | State |
|---|---|---|
| UX-T0 | The defect sweep (39 items) | ✅ swept — 9 fixed, 4 owned elsewhere, 4 hypotheses refuted, 2 removals refused (Scott's call), 2 not measured |
| UX-T1a | Outreach/cadence machinery (queue, "reached", touch count, debt badge) | 🔴 mostly open — several genuinely broken (touch count unreadable, 90.5% "not reached") |
| UX-T1b | Research workbench overhaul | ✅ shipped 2026-09-08 |
| UX-T1c | Decision Center bucket audit (28 lanes) | 🟡 census done, several sub-fixes shipped, several small items still open |
| UX-T2 | Dashboards where data is right, surface is wrong | 🔵 queued, not started |
| UX-T3 | Draft→send→log loop + Marketing + Lender role | 🔵 queued, needs P6 design first |
| UX-T4 | Buyer-rep / 1031 vertical | 🔵 queued, needs P11 design first |
| UX-process | Review process itself (contracts, human-in-the-loop budget) | 🟢 adopted |

**Queue order, per Scott's own instruction recorded in `PLANNED-BACKLOG.md` §P16:** this whole review
queues *behind* the OCR thread (OCR1 re-run, OCR2) — check that thread's status before pulling a row
from here.

## Consolidation note (2026-09-10)

This page is new; nothing it cites was rewritten or deleted. The existing per-stage canonical pages
(`ownership-history-lane.md`, `owner-role-classification.md`, `entity-identity-and-dedup.md`,
`tier0-owner-contact-system.md`, `app-ux-review-2026-09-02.md`) were checked against this page while
writing it and are current — each already carries its own "START HERE" banner and correctly separates
itself from the dated audits underneath it, which is this repo's own doctrine working as designed.
`property-owner-subsystem.md`, `property-owner-source-authority-and-doctrine.md`, and
`data-quality-lease-and-owner.md` (all 2026-07-31) are **not stale** — they describe the still-live
Stage 1 evidence-vote mechanism (`lcc_reconcile_property_owner`) that Stage 3's reconciled store reads
as one of its inputs (`OWN-T0h`) — they were read and kept as-is, not superseded, because nothing since
has replaced that mechanism. No file was bannered on a guess; do the same check before adding a banner
to any of them later.
