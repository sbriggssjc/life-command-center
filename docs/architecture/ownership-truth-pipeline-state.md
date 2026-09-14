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

## Open decisions — needs Scott, compiled across the whole chain (2026-09-14, Cowork)

Every item below is a genuine judgment call, not sizing work Cowork can push further alone. Compiled
in one place per Scott's request so nothing sits scattered across per-stage docs waiting to be
noticed. Re-measure the live numbers before acting on any of these -- this pipeline's populations
move by hundreds between sessions (see OWN-T0c's 417 → 1,183 in two weeks as the cautionary case).

1. **Trailing "The" in the canonical entity key** (`[OWN-T0b/c]`, `PLANNED-BACKLOG.md`). Does
   `"XYZ Company, The"` name the same real-world party as `"XYZ Company"`? The audit's premise says
   yes; a deliberate, dated, SQL-verified test corpus (`test/entity-canonical-key.test.mjs`) says the
   opposite on purpose. Blast radius if merged: ~43 entities carry a trailing "the" token, ~6
   actually collide (Port Authority of New York & New Jersey, Brady Bunch, Graham Companies, Bridge
   Behavioral Health, Buncher Company, Carrington Company). **Blocks:** the 1,183-conflict
   `duplicate_entity` residue cannot be safely worked at scale until this is settled (some of those
   1,183 pairs are trailing-"The" variants, some are not, and today nothing tells them apart).
2. **`entities.canonical_name` as an enforced UNIQUE key** (`[N15c] (2)`, `tier0-owner-contact-system.md`
   §6). The token rule is built and live; whether the column becomes a hard uniqueness constraint is
   still open. **Blocked by #1** -- collapsing keys is exactly what creates new collisions, so this
   can't be decided independently of the trailing-"The" call.
3. **`lcc_finalize_entity_portfolios`'s supersession rule** (`[OWN-T0g]`, sized 2026-09-14, not
   shipped). Gov's current-owner supersession only looks within a single sync-request payload (a
   property split across sync calls never gets end-dated); dia has no supersession logic at all. The
   open question: should supersession compare against ALL historical facts for a property, not just
   the current payload -- and is "a new current owner appeared" even a safe signal that the old one
   ended, given gov/1708 has two owners that are both genuinely, simultaneously current (The Greystone
   Group and the Silverstone survivor)? Needs a rule before it needs code.
4. **1,475 Salesforce-campaign orphans** (`[N15]`, `tier0-owner-contact-system.md` §6). Do they get hub
   rows (become addressable entities in the graph) or stay excluded?
5. **T2b -- widen ownership resolution to the remaining 2,241 properties / 2,054 owners**
   (`connectivity-and-open-threads.md` §4k.1). Sized safe and cheap to run against the post-T2a graph
   (duplicate-group growth is actually LOWER than T2a's measured actual, not higher). The real
   question is value, not risk: only 3.7% of this population (76 owners) is contactable today, down
   from T2a's already-low 17.2%. "Resolve all ownership, rank later" is the standing doctrine; this is
   the population where that doctrine is most expensive relative to its payoff. **Not run. No default
   taken.**
6. **What evidence promotes an owner out of `unknown` role** (`connectivity-and-open-threads.md`
   §4o, marked explicitly "the open question is Scott's, and it is doctrine"). Decides who gets
   prospected and in which bucket. Candidate signals already modelled and unused: portfolio shape
   (asset count/domain/rent), acquisition history (`purchases` edges distinguishing a repeat investor
   from a one-off), `is_operator_not_owner`, and deed/sales-party roles. Whatever rule is adopted needs
   a value gate and an auto-retire predicate, or it reproduces a prior 931-row data-work flood.

**✅ Resolved this session:** banks and CMBS trustees excluded from prospecting (`[N3c]`, Scott
2026-09-14, see `tier0-owner-contact-system.md` §4/§6) -- shipped, not just decided; revisitable if
lender prospecting via Northmarq debt-side coordination is taken up later. fcp/tmg sponsor-domain
confirmations are stale (no live population left, re-checked 2026-09-14) -- no decision needed unless
they resurface.

## Where we are toward 100% -- a snapshot, not a target date (2026-09-14, Cowork)

Scott's stated goal is complete connection across every targeted property and its ownership history,
pushed all the way through the BD/prospecting pipeline. These are the load-bearing numbers as measured
this session and the sessions immediately before it -- each is a live re-measurement, not a historical
quote, and each will have moved by the time this is read again:

| stage | metric | now | context |
|---|---|---:|---|
| Stage 1 | gov's two stores disagree (`[OWN-T0a]`) | 43.4% | 1,509 of 3,474 gov properties |
| Stage 3 | duplicate-entity conflicts open (`[OWN-T0b/c]`) | 1,183 | blocked on decision #1 above |
| Stage 3 | tombstone-duplicate-current defect | **0** | ✅ shipped 09-14 (OWN-T0d), was 11 |
| Stage 3 | `ownership_source` producer noise (`[OWN-T0f]`) | **0 action needed** | ✅ reviewed 09-14, already handled |
| Stage 3 | portfolio-facts supersession gap (`[OWN-T0g]`) | open | sized 09-14, needs decision #3 above |
| Stage 4 | owner-to-person linkage | 13.5% | 1,377 of 10,187 -- essentially flat vs. 13% on 08-27 despite Tier 0's auto-attach fix now genuinely writing |
| Stage 4 | Tier 0 auto-attach mechanism | ✅ verified working | 9 writes 09-13, confirmed live 09-14 |
| Stage 4 | banks/CMBS trustees in prospecting pool | excluded | ✅ shipped 09-14 |
| Stage 4/5 | "reached" (person-link definition, C4/C5) | 618 of 6,480 (9.5%) | 08-28 measurement, not re-measured this session |
| Stage 5 | Salesforce deal-book linkage (`[UX12a]`) | 0 of 4,785 | producer does not exist |
| Stage 5 | teammate mailbox sync (`[UX13a]`) | Scott-only | deliberately deferred |

**Honest read:** the mechanisms keep getting fixed (auto-attach now writes, tombstone duplicates are
gone, the bank/trustee category is closed), but the entity-dedup residue upstream (#1/#2 above) and
the sheer size of the unlinked-owner population mean the headline linkage number hasn't moved much yet
-- 13% → 13.5% in over two weeks of real fixes landing. The fastest path to moving it is almost
certainly #1 (trailing-"The"), because it's the single blocker sitting in front of the largest counted
population (1,183) and touches Stage 3, Stage 4, and this session's re-measurements all at once.

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
