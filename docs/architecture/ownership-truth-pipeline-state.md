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
  ⚠️ **`[C13g-costar-stoplist]`** 🟡 **not closed** — the CoStar residue (32 of 142) has a DIFFERENT
  cause the fix didn't touch: the CoStar scanner's own `looksLikePerson()` stoplist is broader than
  the backend's and is never read back, so its classification can disagree with the backend's on the
  same name even when CoStar sets an explicit type. Filed, not fixed.
- **`[OWN-T0b/c/d/f/g]`** 🔴 residue named in the 2026-09-02 audit: no LCC mirror of
  `v_ownership_transitions_portfolio`; **417** `duplicate_entity` merges still needed (the same
  `Duke Realty` class blocking Stage 2's A2 residue); 11 tombstones still holding a live current fact
  beside their survivor; per-row UUID noise in `ownership_source`; `lcc_finalize_entity_portfolios`
  supersedes only within its own payload on gov and not at all on dia.
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
  **847 of 6,480 owners have no linked person at all** — missing *links*, not missing *touches*.
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
Stage 3's remaining `C13g-costar-stoplist` residue and Stage 4's mailbox/link gaps close** — there is limited value in
building more push-back machinery while the store it would push from is still ~2% mistyped
(`C13g`) and 43% disagreeing with itself upstream (`OWN-T0a`).

---

## Reading the shape of the whole pipeline

Two patterns repeat across every stage, worth carrying into whatever gets prioritized next:

1. **Every stage's residue is smaller once the SAME class of fix lands upstream.** Stage 2's A2 residue
   (54 of 92) and Stage 3's OWN-T0b/c/d/f/g residue (417 `duplicate_entity` merges) are both blocked by
   the identical entity-dedup gap; Stage 3's `C13g` capture-path gap (now mostly closed, `C13g-costar-stoplist` excepted) was what kept re-creating the
   population Stage 3's retype lane exists to clean up. **Fixing entity-dedup and entity-typing at the
   root (once, upstream) is worth more than any one stage's local patch** — this is the single highest-
   leverage thread across the whole pipeline as stated.
2. **The human-verdict lanes (Decision Center) are unevenly used, independent of whether they're built
   well.** `[UX-T1c]`'s live census found **12 of 28 federated lanes have never received a single
   verdict**, several holding thousands of live, fully-wired candidate rows (`agency_risk_action` 692,
   `npi_dedup_review` 285). Before building a new lane anywhere in this pipeline, check whether an
   existing one with real population is simply not being worked — that is cheaper to fix than it is to
   build.

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
