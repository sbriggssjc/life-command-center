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

**Build-out status: 4 of 5 done.** W9.2/W9.3/W9.4 built (flag-gated, awaiting Cowork flip);
**W9.5 LIVE** (2026-08-12, Prompt 97 — the standing measure). W9.1 (external contact-acquisition
on the value-ranked no-contact owners; SOS-egress design question) is the remaining unit — its own
future prompt.

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
- 2026-08-12 (later still): **W9.5 propagation-integrity tick LIVE** (Prompt 97). Read-only cross-DB
  link-coverage measure (NO LLM — pure counts): `v_{dia,gov}_w9_5_chain_coverage` + `v_lcc_w9_5_link_coverage`
  + a tick-computed owner→ops-mirror row, UNIFIED by `GET/POST /api/link-coverage-tick` into one per-link
  table (link_name, domain, total, linked, pct), snapshotted monthly (`lcc_w9_5_link_coverage_snapshot`,
  MoM deltas) on the **U4 cron POST** (no second cron). Reports INTO U4 via a new **Connectedness section**
  (`buildConnectednessSection`) — severity = **any link whose pct DROPS month-over-month** (propagation
  regressing) → high + a fix-unit stub naming the failing producer. Grounded baselines captured live (chain
  true→contact dia 32.1% / gov 27.0%; true→SF dia 16.9% / gov 11.8%; mirror conformance 100% / 0 dangling /
  0 banned; **correspondence→owner-LLC 2.5% = 6/241**, the prompt-96 split baseline for the linkage
  follow-on). Tests `test/link-coverage.test.mjs` (18) + `test/systemic-findings.test.mjs` (updated).
  Wave-9 build-out now **4 of 5** — W9.1 (external acquisition) is the remaining unit.
- 2026-08-12 (later still): **W9.1 contact-acquisition engine — STAGE 1 BUILT** (Prompt 98).
  Internal-sources-only stage runner over the value-ranked no-contact pool
  (`v_owner_contact_worklist`; 3,151 · 300 ≥ $1M): pluggable, cost-ordered, stop-at-first-success
  stages — 1a cross-reference/institution ATTACH, 1b deed-signatory MINT (verbatim-quoted), 1c
  OM broker-of-record MINT (typed distinctly). Proposal-only → new Decision Center lane
  `contact_acquisition_review` (fully 75-wired); a human verdict resolves into the ops entity
  graph (reversible). Migration `20260812130000` applied live (flag `W9_1_CONTACT_ACQUISITION`
  OFF, cron `55 4 UTC`, no fsp drift). New route `/api/contact-acquisition-engine-tick` (distinct
  from the R16 SF worker). **Grounded honest:** top-100 → ~6% crossref attaches; institution/deed
  input-thin today (deed signatory lives in `property_documents`, not the deed row) — same
  input-starved-but-correct posture as W9.2/W9.4. Stage 2 (SOS-direct, non-datacenter egress) is
  a separate prompt; the stage list is the seam. Tests 21 + guards 74/74. Dry-run:
  `docs/audits/W9_1_contact_acquisition_dryrun_2026-08-12.md`. **Wave 9 build-out now 5 of 5**
  (all flag-gated / measure-live; W9.1 awaiting the `?score=1` review → Cowork flip).
- 2026-08-12 (evening): **W9.1 BOTH STAGES BUILT — WAVE 9 BUILD-OUT 5/5 COMPLETE.**
  Stage 1 (Prompt 98, PR #1698 merged): cost-ordered pluggable stage runner on the value-ranked
  no-contact pool — 1a cross-reference ATTACH (+institution), 1b deed-signatory MINT
  (verbatim-validated), 1c broker_of_record MINT (typed, never conflated). New
  `contact_acquisition_review` DC lane; tick `/api/contact-acquisition-engine-tick` (RENAMED from
  the prompt's suggestion — the original name was the live R16 SF worker; clobber avoided). Flag
  `W9_1_CONTACT_ACQUISITION` OFF, cron 4:55. Honest yield grounding: cross-ref ~6% of top-100
  (17/300); institution registry thin; **deed stage input-thin — signatories live in
  property_documents not deed_records payloads (0/5,771 gov) → signatory/OCR backfill = new
  backlog unit**; broker tail from 2,830 broker-bearing sales.
  Stage 2 (Prompt 99, gov PR #371 + LCC PR #1700 merged): sos-proxy service (allowlisted, GET-only,
  rate-capped, NEW CF Access hostname/token, kill switches) + gov transport seam
  (`SOS_PROXY_URL`; unset ⇒ honest-blocked) + STAGE_SOS in the runner (`W9_1_SOS_DIRECT` OFF,
  weekly cadence) + migration fixing a REAL provenance drift found in recon (gov wrote
  `sos_registry` with no LCC fsp row). **Scott's live steps: install proxy on GaryBuilt (runbook,
  gov repo), add tunnel hostname + new token, re-verify FL/CA adapters side-by-side, dry-run →
  Cowork flips `W9_1_SOS_DIRECT`, rotate BOTH service tokens.**
- 2026-08-12 (scheduled check, ~22:00Z): **display-name capture NOT WORKING yet post-PA-change** — 9 new correspondence rows since 16:00Z (7 `outlook`, 2 `outlook_inbound`, 0 `outlook_sent`); new code IS live (rows stamp the `from_name`/`to_names` keys) but **all 9 are null**, including bridge `outlook` rows that should carry FROM names code-only. Scott: check both PA flows' run histories for Select/Join errors; no sent-flow traffic yet to test that path.
- 2026-08-13: **W9.1 Stage 2 SOS — honest close.** GaryBuilt session (Scott): proxy/tunnel/adapters
  built + installed, but **FL/CA SOS sites remained unreachable even via residential egress**
  (bot-detection beat the proxy) — an environmental wall at the source, not a build gap. Same class
  as the July-2026 SOS finding, now confirmed residential-IP is NOT the fix. `W9_1_SOS_DIRECT`
  stays OFF (machinery inert-but-correct; revisit if sites become reachable or OpenCorporates API
  re-prices ~Aug 28). **Cowork found + fixed a real deploy-ordering slip:** the Stage-2 migration
  (`20260812140000_lcc_w9_1_stage2_sos_direct.sql`, in PR #1700) had never been applied to LCC Opps
  — applied live (flag OFF + 10 sos_registry fsp rows). Correction to a prior Cowork claim: the
  unranked-drift 33→34 tick is NOT sos_registry (all 34 are pre-existing W6.6 baseline classes).
  Gov-repo Part A verification (proxy /health, per-state adapter re-check, CF token rotations) not
  visible from Cowork — needs Scott's confirmation or the gov verification doc.

- 2026-08-13 (later): **W9.6 correspondence → owner-LLC attribution BUILT** (Prompt 102) — the
  linkage follow-on the prompt-96 second finding flagged (correspondents are parties/deals, not
  owner LLCs). Closes the last major INTERNAL gap: correspondence→owner-LLC = 2.5% (6/241). Two
  deterministic-first paths — **Path A property_bridge** (corr entity → asset → single current
  true_owner via the ops `owns` edge; arithmetic, value-ranked) and **Path B person_match** (corr
  person tied to a single owner via `owner_contact_pivot` / an unambiguous person→owner edge;
  VERBATIM correspondent header; shared-token bridge rejected). Tick
  `/api/comms-owner-attribution-tick` (`?score=1` dry-run; POST flag-gated `W9_6_COMMS_OWNER_ATTRIBUTION`
  OFF; cron 05:05). New DC lane `comms_owner_attribution_review` (fully 75-wired); confirm appends
  the owner ops entity to correspondence `metadata.linked_entity_ids` (reversible + provenance
  `comms_owner_bridge`) — ONE anchor feeds BOTH the owner-record history AND the W9.2/W9.4
  reachability create-contact arm (**the arms compound**). W9.5 `correspondence_entity_owner_llc`
  extended to count owner bridges (baseline held at 2.5%; rises as attributions confirm). Migration
  `20260829120000` applied live. **Grounded dry-run:** Path A 3, Path B 40 unambiguous — high-value
  real owners lead (Boyd Watterson rank 1175, Kingsbarn), some pre-existing brokerage-as-owner noise
  ranks last for the human to reject. Tests 14 + lane guards green. Dry-run:
  `docs/audits/W9_6_comms_owner_attribution_dryrun_2026-08-13.md`. Live step: `?score=1` review →
  Cowork flips the flag.

## WAVE 9 — FINAL STATE (2026-08-13)
Build: **5/5 units complete.** Live: W9.1-Stage1, W9.3(×3), W9.5. Gated-on-accrual: W9.2+W9.4
(Outlook name capture — flow edits done, mail accruing). Blocked-at-source: W9.1-Stage2 SOS
(external sites unreachable; internal stages 1a/1b/1c carry the load). The connectedness chain is
built end-to-end; the remaining gap (68-73% no-contact owners) is now attacked by every INTERNAL
avenue (cross-ref, deed, broker, comms-harvest, SF drain) — the one EXTERNAL avenue (SOS) is
walled off by the registries themselves.
