# Kickoff — Wave 9: Data Connectedness (owner → contact → SF → Outlook, full propagation)

> Scott's directive (2026-08-08, verbatim intent): "Data connectedness across the databases to the
> LCC ensuring full propagation and ingestion of useable data everywhere. We seem to have a real
> gap between recorded owners, true owner reconciliation, contact pursuit on true owners,
> reconciliation and connection with Salesforce, the LCC and Outlook/contacts."
> Open a fresh chat with: **"Pick up Wave 9 from docs/audits/W9_CONNECTEDNESS_KICKOFF.md"**.
> Companions: connectivity-and-open-threads.md, property-owner-subsystem.md + source-authority
> doctrine, OWNERSHIP_RESOLUTION_ENGINE.md (gov repo), correspondence-ingestion-design.md,
> AUDIT_REFRESH_2026-08-06.md.

## Grounded gap map (live counts, 2026-08-08)

The chain: recorded_owner → true_owner → contact → reachable contact → SF account → Outlook/comms.

| Link | State | Verdict |
|---|---|---|
| recorded → true (dia) | 112 / 7,208 unlinked (1.6%) | ✅ SOLVED — ORE draining (resolver enabled Aug 6; queue 2,064→538 in 2 days, ~750/day) |
| recorded → true (gov) | ORE same engine | ✅ draining |
| true owner → ANY contact | dia **4,825/7,105 (68%) NONE**; gov **11,922/16,268 (73%) NONE** | 🔴 THE gap — contact pursuit |
| contact → reachable (email or phone) | dia **4,234/5,951 (71%) neither** | 🔴 second gap — shells, not contacts |
| true owner → SF | dia 89% / gov 88% unlinked | 🟠 W4.3 linked 3,442; ~3.3k in human review pool; 23,817 no_match judged vs LOCAL registry only (stale caveat) |
| comms → contact/entity | W7 attribution machinery live | 🟡 exists; not yet harvested INTO contact records |

**Reframe:** ownership resolution succeeded; the pipeline dies at "who do I call." ~70% of
resolved owners are un-pursuable and ~90% invisible to Salesforce.

## Existing machinery to build ON (never around)

- **Contact acquisition chain (sanctioned):** cross-reference resolver → SOS-direct (CI-blocked,
  needs non-datacenter egress — GaryBuilt residential IP is a candidate worth designing) →
  address reverse-lookup → deed. Web-search proxy PAUSED — stays paused.
- `owner_contact_pivot`, `v_owner_contact_worklist`, `lcc_institution_contacts`, ORE observation
  stores, `cross_domain_contacts`, sidebar contact captures.
- W8 U3 link-propagation (internal-evidence proposals w/ verbatim validator) — the pattern for
  comms-harvest proposals.
- W7 correspondence attribution + summaries (Outlook side already ingests; harvest is the gap).
- SF: `sf_link_candidate` review lane (3.3k), `ensureEntityLink`, sf-account-as-org-edge doctrine,
  minimum-necessary SF writes.
- W8 tick/lane/budget house pattern (66/73/83/84/85 lessons) + 75 lane-wiring structural guard.

## Doctrine (inherited, non-negotiable)

Value-gate everything (rank_value order — a $14M property's owner gets a contact before a $200k
one); fill-blanks only; provenance + fsp rows in-migration; reversible; never fabricate a contact;
human lanes for judgment; honest per-source counts (the 71/78/84 lesson: loud errors, windowed
scans, budget floors from day one — new units START with the house pattern).

## Campaign units (sequence; each its own prompt + gate)

1. **W9.1 Contact-coverage engine:** rank the no-contact true owners by portfolio value; drive the
   sanctioned acquisition chain per owner; measurable metric = % of top-N-value owners with a
   reachable contact (feeds U4 monthly). Consumer = owner-contact worklist + outreach.
2. **W9.2 Reachability enrichment:** the 4,234 email-less/phone-less dia contacts (+gov
   equivalent): harvest INTERNAL sources first — correspondence headers (W7), SF contact records,
   sidebar captures, intake artifacts — via U3-style verbatim-evidence proposals; external chain
   only after internal exhausts.
3. **W9.3 SF linkage drain + re-score:** work the 3.3k review pool down (assist-style pre-rank?);
   re-score the 23,817 no_match against LIVE SF (the W4.3 local-registry caveat) in bounded
   batches; SF writes remain minimum-necessary.
4. **W9.4 Outlook/comms harvest loop:** every attributed correspondence fills contact blanks
   (email observed on a thread → fill-blanks the contact, provenance `comms_observed`) — closes
   the loop Scott named: Outlook ↔ LCC ↔ SF.
5. **W9.5 Propagation-integrity tick:** cross-DB consistency audit (ops entity ↔ dia/gov owner
   mirrors, cross_domain_contacts, identity coverage) reporting per-link-coverage into U4 — the
   standing measure that "full propagation" stays true.

**Recommended order: W9.2 first** (internal harvest = highest yield, zero external dependency,
reuses U3's proven pattern), then W9.1 (external chain on the value-ranked remainder), W9.4
(continuous), W9.3 (parallel, review-paced), W9.5 (measure, last).

## Status
- 2026-08-08: kickoff written; ORE layer verified self-draining; gap counts grounded live.
- 2026-08-12: **W9.4 comms-harvest arm BUILT** (Prompt 94) as the THIRD arm of the W9.2 tick
  (correspondence `activity_events` → header pairs/deterministic, signature phones/llm-verbatim,
  create-contact/`target_kind=owner` never-auto; privacy-scoped to business-attributed,
  `visibility<>private` threads). Migration `20260827120000` applied live (2 NAME-field
  `comms_observed@40` fsp rows, drift 0; flag notes → 3 arms; no new table). Tests 34/34.
  **⚠ Grounded input-starved TODAY:** 7,751 attributed rows but 0 header display names (Outlook
  ingestion flattens Graph `{name,address}`→bare email) and 0 correspondence entities map to a
  `true_owner`, so all three sub-arms yield 0 until the unlock lands — **preserve header display
  names at Outlook ingestion** (`metadata.from_name`/`to_names`, forward-only). Flag stays OFF;
  flip after the unlock + a non-zero `?score=1` dry-run. Dry-run:
  `docs/audits/W9_4_comms_harvest_dryrun_2026-08-12.md`.
- 2026-08-12 (later): **display-name unlock SHIPPED** (Prompt 96, PR #1693 merged+deployed).
  Root cause: FOUR Outlook writers flattened Graph {name,address} → bare email. New shared parser
  `outlook-recipients.js`; forward-only `metadata.from_name`/`to_names[]` on all four writers;
  harvestBuildCommsIndex binds structured pairs. **FROM names live immediately; TO/CC on the
  string-based PA flows needs Scott's one-time Select+Join flow change** (click-steps:
  `docs/audits/W9_4_display_name_capture_2026-08-12.md`). Flip path: PA change → a few days'
  mail accrual → `?score=1&n=10` shows non-zero header_name_pairs → Cowork flips
  `W9_2_REACHABILITY_HARVEST` (three arms live). Second starvation finding confirmed ORTHOGONAL:
  correspondents are parties/deals, not owner LLCs — a linkage-design follow-on (candidate W9.5
  input), not a names issue.
