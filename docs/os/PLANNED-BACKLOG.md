# PLANNED / BACKLOG — every unbuilt-but-intended thing, in one place

> **Companion to `CURRENT-STATE.md`.** That file says what IS; this one says what is **intended and
> not yet done**. Assembled 2026-08-26 (Prompt 141) by sweeping every design brief, prompt
> "follow-ups" section, gap-audit tail, status ledger and archived STATUS block in the repo.
>
> **Nothing here is a new idea.** Every row cites **where it came from** so you can read the original
> reasoning, and so a future consolidation can prove nothing was invented or dropped. Rows are kept
> even when they look dead — *a contemplated feature is never deleted, only re-ranked or explicitly
> retired with a reason.*
>
> **Before building any row: apply the P131 lens.** Classify the gap first —
> **(a)** the answer is already on-box and STRUCTURED → deterministic plumbing, **not** an LLM;
> **(b)** on-box but UNSTRUCTURED text → an LLM fits; **(c)** not on-box at all → neither, an LLM
> would fabricate. Two of the top-ranked local-model gaps turned out to be (a) and (c) once measured.
>
> **And re-measure the row before you build it.** Several rows below carry dates from July; the
> standing doctrine is that a dated blocker is a hypothesis, not a fact.

**Legend** — 🔴 not started · 🟡 partially built · 🟢 designed/specced, ready to build ·
⏳ built, pending a manual apply/flip · 👤 needs Scott (tenant / human decision) · ⚪ optional/roadmap ·
🔍 needs re-measure before it can be ranked honestly.

---

## P0 — Verify, don't build (open loops on work already shipped)

These are the cheapest and highest-trust items: something shipped, and the **delta has not been
confirmed**. This repo's own rule is that a fix is not fixed until the population moves.

| # | Item | State | Source |
|---|---|---|---|
| V1 | **property-twin assist has not written since 2026-08-19.** P135 lifted the fixed 200-row window and dry-ran `fresh:895`, but live proposals are still 200 total / 0 in 7d. Confirm the nightly apply moves the count past 200. | 🔍 | measured 2026-08-26; `LOCAL-MODEL-LEVERAGE-MAP.md` §2 |
| V2 | **reachability-harvest has not written since 2026-08-13.** P136 added the negative marker + the evidence JOIN. `lcc_decisions` `reachability_harvest_review` = 4 total / 0 in 7d. Confirm by the proposal-count delta. | 🔍 | measured 2026-08-26; P136 |
| V3 | **Ownership-history lane drain.** 545 chains are drafted and the Research page is un-500'd (P132), but the lane's own metric is `completed > 0` for the first time. Watch it, and prioritise the **~73 current-owner-vs-deed mismatch flags** (a free data-integrity signal). | 🔍 | `LOCAL-MODEL-GAP-AUDIT.md` R1 |
| V4 | **`briefing-intel-snapshot` edge-fn guard.** The on-box Analyst's Take is live, but a manual snapshot re-fire will upsert NULL over it unless the deployed fn carries `if (row.analyst_take == null) delete row.analyst_take;`. Fn is v21 (updated 2026-08-26) — confirm the source. | 🔍 👤 | `docs/architecture/briefing-analyst-take-onprem.md` |
| V5 | **`PA_OUTLOOK_DRAFT_FLOW` reads `off`** in the registry with `off_since` = 2026-08-21 — the same day the Outlook draft seam was proven working end to end. One of the two readings is stale. | 🔍 👤 | registry, measured 2026-08-26; STATUS 2026-08-21 |

## P1 — In flight / next up

| # | Item | State | Source |
|---|---|---|---|
| N1 | **Prompt 139 — interleave the clean-assist provenance lane.** The 65-row `dia_xref` backlog ranks `1001`, above every ladder-bearing `field_provenance` row (`_provImportance` maxes at 1000), so the 433 ladder-decidable cards sit behind cards that are `uncertain` by design. Re-ranking also moves the human-facing Decision Center order — **Scott's call**, deliberately not a side-effect of the P137 wiring fix. | 🟢 👤 | `docs/claude-code/prompts/139-*.md` |
| N2 | **Prompt 140 — grade `OWNERSHIP_CHAIN_ROLE_LABELS` before flipping.** The Ollama Layer 2 labels a transfer type on links it may not add/remove/reorder/re-date/rename. Never graded, so it stays off. | 🟢 | `docs/claude-code/prompts/140-*.md` |
| ~~N3~~ | ~~**Prompt 188 — the Tier 0 confirm lane.**~~ **BUILT AND LIVE 2026-08-26** (PR #1785). Lane `tier0_owner_contact`, **237 actionable cards / 171 owners / $695M**, one card per (owner, DOMAIN). Nothing is written to `owner_contact_pivot` until Scott clicks Attach. | ✅ | `prompts/done/188-*.md`; `docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md` |
| N3a | **Prompt 189 — duplicate owner entities.** Step 1 shipped: `v_lcc_merge_candidates_normalizer_blind` makes visible the **121 groups / 300 entities / $136.5M** that `v_lcc_merge_candidates` is structurally blind to (`lcc_normalize_entity_name` returns NULL for 1,089 live orgs / $185.1M). **60 groups carry byte-identical names** — five entities named "NGP Capital" ($68.3M), five "RMR Group". Remaining: the wording-difference blind spot (Easterly ×2 → 4 cards for one firm) and the merge pass itself. | 🟡 👤 | `prompts/189-*.md`; playbook Class 11 |
| N4 | **R8 Stage 2 — capital-markets book copy on-box.** The quarterly ST-Market / NM-CapMarkets copy is templated, private and repetitive — the highest-value remaining on-box generation target after Stage 1 (the brief). Currently routes cloud / is hand-authored. | 🟢 | `LOCAL-MODEL-GAP-AUDIT.md` R8; `LOCAL-MODEL-LEVERAGE-MAP.md` §4.1 |
| N5 | **R8 (rest) — BOV/OM exhibit narrative first-drafts** and **comps narrative + reconciliation synthesis.** Facts are already extracted; draft the cover-note/exhibit prose in Scott's voice, deal specifics stay on-box. | 🟢 | `LOCAL-MODEL-LEVERAGE-MAP.md` §4.2–4.3 |
| N6 | **R4 (remaining half) — going-cold detection + suggested-touch prose.** `NEXT_STEP_AI` is on; the missing half is Ollama reading the deal thread and drafting *who's quiet, why, suggested touch* into the cadence engine. | 🟢 | `LOCAL-MODEL-GAP-AUDIT.md` R4; leverage map §4.5 |
| N7 | **R2 (re-classified) — OM-economics write-back + owner-edge creation.** Measured as category (a): the LLM already ran (3,955 staged items carry `asking_price`/`cap_rate`, `lcc_property_attributes` exists). What is missing is the **deterministic** write-back and the asset→owner edge from the extracted owner. Unblocks offer-context, cadence and dossiers. **Moved OUT of the local-model track into engine connectivity — still high value.** | 🟢 | `LOCAL-MODEL-GAP-AUDIT.md` R2 (re-measured 2026-08-24) |

## P2 — Local-model gaps still open (R5–R9)

| # | Item | State | Source |
|---|---|---|---|
| L1 | **R5 — wrong-party edge substance-check.** Role-string guards let 80 competitor/own-firm edges (CBRE/Eastdil/JLL/@northmarq), 27 owners, $340.7M through as `prospecting_contact`. Ollama classifies a contact's *substance* as a second look on edges the label guard clears. Low effort, annotation on an existing view. | 🟢 | gap audit R5; `v_lcc_prospecting_edge_review` |
| L2 | **R6 — undecidable owner-attach residue.** ~18 "no lean — human call" rows/run (acronym/subset cases); draft the same-party rationale + verbatim quote. | 🟢 | gap audit R6 |
| L3 | **R7 — activate the `signals` learning loop.** `writeSignal` fires in 9 producers; 3 static SQL views consume it; the draft-vs-sent edit distance (`template_refinements`) is captured and unfed. Weekly Ollama few-shot over the diffs → voice/template refinement proposals. **Compounding.** | 🟢 | gap audit R7; leverage map §3 "U4 edit-distance feedback" |
| L4 | **R9 — named-lead → find-their-line matching.** `v_lcc_named_lead_worklist` (SAM.gov POC name+title, no email) toward ~478 unreachable owners ($454.6M). High volume, but the acquisition half is still egress-blocked → partial. | 🟡 | gap audit R9 |
| L5 | **W10 Stage 3 — template library.** Cluster the sent corpus by draft-type, synthesize Scott-voiced parameterized templates + triggers (new listing → announcement; LOI → offer-submission). ⚠️ The leverage map points at a `⬜` in `ROLLOUT_STATUS.md` that **does not exist**; the intention lives in the W10.1 row prose. Preserved here so the broken pointer cannot lose it. | 🟢 | `ROLLOUT_STATUS.md` W10.1 prose; `docs/architecture/template_library_spec.md` (Draft) |
| L6 | **W10 Stage 4 — LoRA fine-tune** on the 10-yr sent corpus. Never started; explicitly optional (the RAG path was chosen precisely to avoid needing it). | ⚪ | `docs/setup/garybuilt-local-model.md` Phase 3 |
| L7 | **Research synthesis** — summarize owner-contact / `research_task` results into structured payloads. | 🟢 | leverage map §3 |
| L8 | **W5.3 intake local-vs-cloud re-grade** on ~50 fresh intakes post Prompt-61 hardening. | 🟢 | leverage map §3 |
| L9 | **LOI/offer intake structuring** — on-box extraction of buyer/price/terms from inbound LOI PDFs. Counterparty terms are exactly the private corpus the doctrine protects. | 🟢 | leverage map §4.4 |
| L10 | **Owner-resolution rationale** — draft the one-line "why these are the same party" on the residue the deterministic classifiers punt. | 🟢 | leverage map §4.6 |

## P3 — Account-based contact intelligence (design, not built)

Scott's 2026-08-26 doctrine: **the ACCOUNT is the primary pursuit; who to call there is a separate,
standing function.** Source: `docs/architecture/account-based-contact-intelligence.md`.

| # | Item | State | Notes |
|---|---|---|---|
| ~~AC1~~ | ~~**Tier 0 — link what we already know**~~ **BUILT AND LIVE 2026-08-26** (P186→P187→P188). Matching by email domain ↔ owner identity; **237 cards / 171 owners / $695M** awaiting human verdicts. Brokers never attachable at any deal size; public bodies out of scope. ⚠️ **Shipped as a CONFIRM LANE, not the auto-promoter this line envisaged** — measured link precision is **~91% only at ~$16M+ of rent and ~60–70% in the ~$2M SPE band**, so an unattended write would mis-attach roughly once in eleven. **Work the lane top-down.** | ✅ 👤 | Easterly yields 7 people; Boyd Watterson ($179.8M), RMR incl. Adam Portnoy, Realty Income incl. Sumit Roy now visible |
| ~~AC1a~~ | ~~Two operator decisions blocking Tier 0 coverage.~~ **DECIDED AND APPLIED 2026-08-26 (P190).** (a) Scott: **"drop all universities"** — public and private alike, costing GWU $23.8M and Georgetown $8.0M, prospecting only. `lcc_owner_name_is_not_prospected()` is now the single source of truth. (b) Sponsor map seeded with **4 of 6**: ngp→ngpv.com, uirc→uirc.com, hpi→hpitx.com, jbg→jbg.com. **Result: pairs 558→650, lane cards 237→260, sponsor arm $123.4M (NGP alone 17 owners / $105.5M).** | ✅ | `20260827040000_lcc_p190_*.sql` |
| AC1b | **⚠️ Close the prospecting-scope drift (P190 residue).** `v_lcc_top_seller_prospects` (4,118 rows, −17) and `v_lcc_owner_contact_decidability` (311 rows, −2) still call `lcc_owner_name_is_public_body` directly, so **universities remain in their scope** while Tier 0 excludes them. Two one-line swaps to `lcc_owner_name_is_not_prospected`; deliberately not done blind at the end of a session. This is exactly the two-definitions drift CLAUDE.md warns about. | 🔴 | `STATUS.md` 2026-08-26 P190 |
| AC1c | **Confirm or reject the two held sponsor entries** — **fcp→fcpdc.com** (Federal Capital Partners, for MEPT/FCP PATRIOTS PLAZA, $14.2M) and **tmg→tmgdc.com** (The Meridian Group, for TMG 801 EYE STREET, $3.9M). Scott: *"I'm unsure… would need to google and check SF and our records."* TMG also matched an unrelated `tmgre.com` during measurement. Add a row to `lcc_owner_sponsor_domain` only with a recorded `confirmed_by`. | 🔴 👤 | `20260827040000_lcc_p190_*.sql` header |
| AC2 | **Tier 1 — rank the bench, don't pick one winner** (volume, recency, two-way, seniority, inferred function). The pivot already has a `bench` column. | 🟢 | |
| AC3 | **Tier 2 — Ollama infers function** and drafts the account strategy, **carrying confidence**, with the surface gated on it (the P181 lesson). | 🟢 | |
| AC4 | **Tier 3 — the standing loop.** Re-run on new correspondence/transactions/replies. A reply that redirects us ("talk to X") is the highest-quality signal available. Never one-and-done. | 🟢 | |
| AC5 | **Tier 4 — broker intelligence kept separately.** Never a prospect target; surfaced as *who transacts with this buyer, where the gaps are for a buyer's-rep pitch, where competitors are winning*. | 🟢 | |
| AC6 | **Spin-off: professional emails landing in the "personal" bucket.** Likely the same bucketing that produced P124's `cold_bd_outreach` catch-all. Needs its own measurement — it corrupts both the voice corpus and this engine's inputs. | 🔴 | own item |
| AC7 | **Spin-off: `Andrew Pulliam` duplicated** — two live person entities on one address, 37 edges vs 1. Merge candidate. | 🔴 | |
| AC8 | **Spin-off: `v_lcc_prospecting_edge_review` (P166) is narrower than its name** — it does not contain the Easterly broker edges and returned a false zero when used as a broker test. Widen before trusting it again. | 🔴 | |
| AC9 | **Spin-off: 7 competitor-broker edges on Easterly wear role `prospecting_contact`.** Re-role, don't delete — they are the Tier-4 intelligence. | 🔴 | |
| AC10 | **`v_owner_contact_worklist` excludes owners that already have a linked person, and nothing writes that person into `owner_contact_pivot`** — 11 owners, $240.5M, suppressed AND invisible. *An exclusion needs a counterpart that promotes.* | 🔴 | `CLAUDE.md` pointer section |

## P4 — Contact reconciliation, outbound (measured 2026-08-26, Prompt 184)

Source: `docs/architecture/contact-reconciliation-outbound.md` §6. **Order follows value, not the old
"determine writability first" plan** — Outlook is writable, and even so there are only ~144 clean
field-values to carry outbound.

| # | Item | State | Notes |
|---|---|---|---|
| CR1 | **Fix `pickBestEmail`'s primary selection.** 98 contacts show a dead `@stanjohnsonco.com` primary; 56 already hold the live address. Largest correctness win available, hub-side only, no write surface. | 🟢 | do this first |
| CR2 | **Run Probe B** (`flow-lcc-probe-outlook-contact-write.json`) — sentinel write → re-read → restore → re-read. ~2 minutes; gates CR3 only. | 🟢 👤 | the original probe design could not answer its own question |
| CR3 | **CREATE projector for the 487** named + touched-within-24-months contacts absent from the address book. Dry-run, junk-guarded, value-ranked, verified by re-read. | 🟢 | gated on CR2 |
| CR4 | **Repoint the `contact_merge_queue` writer** from `government` to the hub (producer and consumer are on different databases — it has never held a row on either), then work the 45 colliding contacts. | 🟢 | small enough to finish |
| CR5 | **Write down the Salesforce allowlist** and get Scott's explicit per-entry sign-off. | 🟢 👤 | |
| CR6 | **WebEx / Teams** — record "not used for external contacts here" and close them, unless ingest proves worth building. | ⚪ 👤 | |
| CR7 | **DO NOT build a PATCH projector for the 2,809 Outlook contacts.** Recorded as an explicit *anti*-item: it would re-send Outlook its own data, run green, and change ~144 fields. | 🚫 | kept so it is not re-proposed |

## P5 — Deal-intelligence spine, next layers (designed, not built)

Sources: `docs/os/BUILD-BACKLOG.md`, `docs/os/BUILD-OUT-CATALOG.md`, `docs/os/BUILD-STATUS.md`.
⚠️ Both catalogs date from **2026-07-27/28** — re-measure a row before acting on it.

| # | Item | State |
|---|---|---|
| D1 | **Proactive Deal Monitor** — the automation-plane loop reading `list_deal_checkpoints` on a schedule and acting on overdue/due-soon milestones (notify / draft / update). Foundation exists; loop not built. | 🟢 |
| D2 | **Mail-intake → dossier** — distil Outlook deal-mail into `activity_events` so correspondence auto-appends (broader than the matcher). | 🟢 |
| D3 | **Fold the pipeline digest into the daily LCC email** as a leaner `cadence-section` variant. | 🟢 |
| D4 | **Matcher recall** — add address / escrow# / OM-PSA signals (misses e.g. Innovative Renal Care). | 🟡 |
| D5 | **Store SF `deal_name` on `bd_opportunities`** — column added live, writer updated, populates on the next full refresh once redeployed. | ⏳ |
| D6 | **Shared SF 15-char-id helper** — the prefix-matching logic is duplicated today. | 🔴 |
| D7 | **Contact-entity resolution backfill** — 31,014 contacts, 5,696 linked, only 41 match by email; the gap is entity *creation* (~11,700 recoverable), a policy decision coupled to the roster question. ~13,505 are no-signal junk. **No bulk create done, deliberately.** | 🟢 👤 |
| D8 | **A1f — OM/document-ingestion address feed** into the Deal-Address Resolution Engine. Highest-leverage automation for capturing TB's own listing addresses. | 🟢 |
| D9 | **A1g — SF browser-read address feed.** The Deal record PAGE renders `Property_Address__c` even though the API/connector cannot (FLS + no relationship traversal). Proven live on 5 addresses; automatable, bypasses the API block, needs no SF admin. | 🟢 |
| D10 | **SF write-back drainer → more kinds** (`create_task`, `advance_opportunity_stage`); `updateOpportunity` beyond stage (close_date/amount/probability/next_step); an idempotency key on `logActivity`; the connector write-action target description → "deal or person"; repeatable contact onboarding. | 🟡 |
| D11 | **PSA milestone-timeline population** at LOI-executed / In-Escrow (always carry an explicit Fresenius-style timeline). | 🟢 |
| D12 | **Account layer — new-prospect 7-touch** (days 0/7/14/28/42/72/102) + tier nurture. **OPEN red-line: tiering computed-vs-manual.** | 🟢 👤 |
| D13 | **Draft-and-hold the due touches** → Outlook drafts, never auto-sent. | 🟢 |
| D14 | **Investor-outreach campaign manager** (ELA broad marketing — buyer list, priority, revisit). | ⚪ |
| D15 | **Incremental SF sync optimization** — a `LastModifiedDate` window instead of the 30-min full refresh. | ⚪ |

## P6 — Next-Best-Action layer, Marketing (Domain F), edge & cross-cutting layers

All designed, none built. Sources: `architecture/next-best-action-and-app-layout.md`,
`LCC-SYSTEM-MAP.md`, `architecture/edge-layers-design.md`,
`architecture/fact-ingestion-and-propagation.md`, `architecture/cross-cutting-design.md`.

| # | Item | State |
|---|---|---|
| NBA1 | **All domains emit `action_items`** — one universal action store (exists, barely used); adapters from reconcile/comps/BOV/lease/cadence/marketing. | 🟢 |
| NBA2 | **Generalize the ranker** — extend `v_priority_queue` bands to score every action type; expose `next_best_action(user, context)`. | 🟢 |
| NBA3 | **App "Today" home** — ranked next-best-action stream + one-tap execution; team→user→role lenses. **Design H1 (RBAC) first.** | 🟢 |
| NBA4 | **Domain F feeds into the stream** — listing-scoped likely-buyers + buyer-intent boost. | 🟢 |
| NBA5 | **Cross-surface parity** — every surface reads the same queue. | 🟢 |
| F1 | **Ownership-of-similar "likely buyers"** — rank likely acquirers for a listing from `entity_relationships` + owner-reconcile. Data exists; logic doesn't. | 🟡 |
| F2 | **Buyer-intent ingestion** — webhits / OM downloads / saved searches (CREXi/Buildout/LoopNet) → intent touchpoints. **Genuinely unbuilt.** | 🔴 |
| F4 | **OM distribution + engagement tracking loop.** | ⚪ |
| E1 | **Reporting & Analytics** — BI views/snapshots, RBAC-scoped, app Reports + scheduled emails. | 🟢 |
| E2 | **Onboarding & Backfill** — bulk backfill + repeatable contact/deal onboarding tools. | 🟢 |
| E3 | **Compliance / Governance / Retention** — PII+RBAC, retention config, audit view, a compliance canon module. | 🟢 |
| E4 | **Integration Catalog** — CoStar / CREXi-Buildout-LoopNet / county recorders / title-escrow, all via the LCC broker + fact fabric. | 🟢 |
| E5 | **System QA & Trust Validation** — fixtures + invariant checks + regression gate. | 🟢 |
| FP1 | **Fact-propagation coverage audit** — every learning point writes through `lcc_merge_field` and emits propagation; list the ad-hoc writers. | 🟢 |
| FP2 | **Canonical lease record + lease-abstraction merge writer** — lease structure becomes first-class and provenanced. | 🟢 |
| FP3 | **Closing propagator** — ownership edge + sale-comp creation + deal-close + SF + dossier from ONE closing event. | 🟢 |
| FP4 | **Generalize propagation** on the `sync_inflight`/`listing_events` rails with idempotency + dead-letter. | 🟡 |
| H1 | **Identity, Users, Roles & Permissions (RBAC)** — the biggest gap; design **before** the app "Today" home. | 🟢 |
| H2 | **Feedback / learning loop** — outcomes tune cadence/scoring/tiering; build the NBA ranker as configurable weights from day one. | 🟢 |
| H3 | **Autonomy & Trust ladder** — one policy for autonomous vs propose vs confirm, per action type. | 🟢 |
| H4 | **Lifecycle off-ramps** — lost / dormant / revived deals + account attrition. | 🟢 |
| H5 | **Pipeline resilience & explainability** — idempotency, dead-letter, reconciliation, self-monitoring, "why". | 🟢 |
| R1 | **Dossier `.md` = pure render of the LCC dossier** (one writer; kill drift). | 🟡 |
| R2 | **Collapse the two-server topology** (unification Phase 2), retire the standby. | ⚪ |
| R3 | **Commit to the v4 connector repave** (53 ops) — end v3/v4 drift. | 🟡 |
| G1 | **Vertical-neutral build invariant** — quarantine asset-type logic to 3 plug-in points (comps source, BOV skill, enrichment). | 🟢 |
| G2 | **Anti-overlap invariant** — all domains read/write the shared substrates; no sibling stores. | 🟢 |

## P7 — Work products

| # | Item | State | Source |
|---|---|---|---|
| W1 | **Seller Response (counter) generator** — on-request post-call; DDP (Genesis) vs standard (owner-of-record) template. | 🟢 | `BUILD-OUT-CATALOG.md` G4 |
| W2 | **Close offer-context gaps** — (a) reconcile fragmented deal entities; (b) capture ask/NOI/cap + `owner_entity_id` at listing-signing; (c) index the Team Briggs OM/lease/PSA docs to the deal. Makes the packet fill without a manual OM. **Same root as N7.** | 🔨 | `BUILD-OUT-CATALOG.md` G5 |
| W3 | **Draft / file / log wiring** — Outlook draft → Drafts (LOI attached); folder writer → deal folder; `activity_events` / To-Do / critical-date / SF loggers. | 🔨 👤 | `BUILD-OUT-CATALOG.md` G6 |

## P8 — Surfaces, rollout & operator steps (Scott's tenant)

| # | Item | State | Source |
|---|---|---|---|
| S1 | **Paste the ChatGPT persona** into the GPT (canon-migrated, parity ✓). | ⏳ 👤 | BUILD-STATUS C1 |
| S2 | **Sync the surface bundles** — Northmarq Claude project prompt; Personal Claude / Cowork skills (v1.4.3+ comps sync). | ⏳ 👤 | BUILD-STATUS C2 |
| S3 | **Create the 2 Copilot specialists** (Document Files Agent, Document Assembly Agent) in Studio, connect to the orchestrator, publish the delegation block. | 🟢 👤 | BUILD-STATUS C3 |
| S4 | **Work IQ least-privilege config** — enable set + pin the Team Briggs site via Inputs + end-user auth. | ⏳ 👤 | BUILD-STATUS C4 |
| S5 | **Office Script + its Power Automate flow** (pro-forma lease-escalation fix). | ⏳ 👤 | BUILD-STATUS C5 |
| S6 | **Correct the 4 SharePoint `_WORKFLOW` deployment docs** (they still assert tranquil-delight *is* the MCP server). | ⏳ 👤 | `REGISTRY.md` §F |
| S7 | **True one-command-updates-all** — give each surface master (Northmarq prompt, the skills) a managed `CANON:BEGIN…END` region + a portable render target. Today only Copilot + ChatGPT auto-render. | 🟢 | `AI-SURFACES-OPERATIONAL-REFERENCE.md` §1 |
| S8 | **Swap the regenerated blank BOV templates** (NNN + MOB/MT, DSCR correct) into Northmarq/Copilot project knowledge + `Templates/`. | ⏳ 👤 | STATUS archive, prompt 34 |
| S9 | **Northmarq admin connector** — the Northmarq project has no live LCC connector; an admin adds it at `{MCP_BASE_URL}/mcp`. | 🔴 👤 | STATUS archive |
| S10 | **D-drive triage + home the personal projects.** | 🟢 👤 | `ACCESS-TOPOLOGY.md` |

## P9 — Security & hygiene (deferred to the end by design)

| # | Item | State | Source |
|---|---|---|---|
| SEC1 | **Rotate `LCC_API_KEY`** — flagged P0 on 2026-08-03 after it was pasted in plaintext during a curl diagnostic. Threaded through the PA flows, so it is deliberately last. Must land identically on tranquil-delight + the standalone MCP + BOV, then ChatGPT / Copilot / the personal-Claude connector / every PA flow. **Still open as far as any doc in this repo shows — 🔍 re-measure before assuming otherwise.** | 🔴 👤 | STATUS archive §SECURITY; `BUILD-BACKLOG.md` E2 |
| SEC2 | **Rotate the Supabase `service_role` key** (it appeared in a PA run output) + enable **Secure Inputs** on the drainer's Supabase HTTP steps. | 🔴 👤 | `BUILD-BACKLOG.md` E1 |
| SEC3 | **Function `search_path` hardening + revoke EXECUTE from anon/authenticated** — ~130 (OPS) + 150 (GOV) + 228 (DIA) functions. WARN-level; safe (the engine calls via service_role). | 🔨 | `BUILD-OUT-CATALOG.md` E2 |
| SEC4 | **DIA Postgres upgrade** (flagged `vulnerable_postgres_version`). | 🔨 👤 | E3 |
| SEC5 | **`materialized_view_in_api`** (OPS 2, GOV 5, DIA 13) — matviews can't take `security_invoker`; revoke from anon/authenticated instead. | 🔨 | E4 |
| SEC6 | **`auth_leaked_password_protection`** (OPS) — one toggle. | 🔨 👤 | E5 |
| SEC7 | **RLS hardening** on the 34 exposed tables — run in a Supabase branch first. | 🟢 | `BUILD-BACKLOG.md` E3 |
| SEC8 | **Enforce `LCC_API_KEY` auth in production** — set the key **then** `LCC_ENV=production`, in that order; verify `would_pass_in_production` first. | 🟢 👤 | `docs/AUTH_ENFORCEMENT_ROLLOUT.md` |

## P10 — Known, sized, unfixed data defects (carried from `CLAUDE.md`)

These are *measured* problems with a *known* shape. They are not vague.

| # | Item | Size |
|---|---|---|
| K1 | **`lcc_reconcile_property_owner` scores an ownership CHAIN as competing claims.** Recency decay floored at 0.25 means a thrice-sold building yields three near-equal candidates under the 0.55 gate. **876 assets have evidence and still read "Unresolved."** A strict-latest-purchase supersession tier would resolve **465**, correctly abstaining on the 360 that tie on date. **Adding another feeder does not fix this class — don't reach for one first.** |
| K2 | **The SAM tier ladder vs the real quota.** Tiers 0 (131) and 1 (514) run before tier 2 — and **tier 2 holds 9,153 valued owners topping out at $62.3M**. Sized for 600/day; the key actually delivers ~10/day, so the $62.3M owner is ~2 years out. Either interleave value across tiers or raise the SAM account tier. **Scott's call.** |
| K3 | **`v_field_provenance_unranked` returns 35 rows** for tables other than `entities.email/phone` — pre-existing writer/ladder drift. Should be 0. |
| K4 | **`v_owner_contact_enrich_queue`'s exclusion never expires.** All 316 `owner_contact_manual` tasks are `queued` and none has ever changed status, so the owners are permanently removed from automated processing — while **115 of them ($102.4M) already carry a genuine named active contact.** *Ask what event sets this state false, and whether anything ever fires it.* |
| K5 | **`v_lcc_weak_reach_worklist`** — 93 owners ($153.8M of annual rent) gated out of "reachable" by P161 because their only route is a weak `works_at` edge. They are the contact-acquisition engine's queue, not a defect. |
| K6 | **`v_lcc_portfolio_ownership_conflict`** — 12 ghost-vs-survivor portfolio conflicts, never auto-resolved by design (deleting the ghost would resolve toward the stale side). |
| K7 | **gov firm-term tail** — 625 sold-cap chart rows still lack a term; ~178 are STATE/municipal (no federal register can cover them; the state-lease producer has been **silent since 2026-06-23**), and 58 properties are OCR-pending. Surfaced in `v_gov_firm_term_backfill_queue` / `_reextract_queue`. |
| K8 | **gov `listing_verification_history`** records `prior_asking_price` but leaves `asking_price_at_check`/`price_delta` NULL on 5,636/5,637 rows. The reprice triggers made the chart writer-agnostic, but fixing the lvh writer would enrich the ledger. |
| K9 | **gov FRPP↔property matching pass.** The CoStar VA/SSA comp tail was never linked to its FRPP row (address-match ceiling ~29 of 533 distinct properties). FRPP holds `lease_expiration_date` on 19,756 leased assets — a geo/address matching pass is the real-volume unlock. |
| K10 | **gov Phase A1b — per-county assessor fetchers.** Mass owner-mailing capture needs them; the AI-extraction path only yields "echoes" for counties whose assessor URL is a search portal. |
| K11 | **dia CMS `patient_month_backfill`** — must run on a CMS-reachable runner (the sandbox has no data.cms.gov egress). Loads whatever months the current survival window covers; never fabricates a period. |
| K12 | **W6.5 Stage 2 continues** — `detail.js` decomposition by region; Stage 3 is mapped. Recipe + invariants in `docs/architecture/w6-5-frontend-decomposition-map.md`. |

## P11 — New verticals & long-horizon specs (design-only, nothing authorized)

Kept verbatim in place; listed so they are not mistaken for abandoned. **Every one of these carries an
explicit "no ingestion / no migration / no production write authorized" status line** — that gate is
part of the design, not an oversight.

| Cluster | Docs |
|---|---|
| **Healthcare / ASC / IDTF lane** | `HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1`, `HEALTHCARE-ASC-FIRST-STAGING-RUNBOOK-v0.1`, `HEALTHCARE-ASC-IDTF-{ECONOMICS-AND-SAMPLING,LCC-INTEGRATION-CONTRACT,PRIVATE-RUN-AUTHORIZATION,SOURCE-MANIFEST-CONTRACTS}-v0.1`, `HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1`, `OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1` |
| **Oncology / infusion lane** | `ONCOLOGY-INFUSION-{IMPLEMENTATION-READINESS-PACKAGE,NPPES-SOURCE-ADAPTER-SPEC,PHASE-A-BUILD-PLAN,PILOT-COHORT-SPEC,PRIVATE-VERIFICATION-SAMPLE,STAGING-AND-INGESTION-CONTRACT}-v0.1`, ADR-005. ⚠️ `READ-ONLY-PROFILE-RESULT-2026-08-11` records the **existing-source sufficiency gate FAILED** — read it before reviving. |
| **Identity** | `ADR-004-CANONICAL-PERSON-IDENTITY.md` — *proposed for approval; migration not started.* |
| **Sizing docs (measured, nothing built)** | `supersession-tie-lane-2026-08.md` (changes what "owner" means for ~63 assets), `gov-asset-identity-coverage-2026-08.md`, `dia-ownership-master-bridge-2026-08.md`, `sf-note-records-ownership-bridge-2026-08.md` (**read §11 first — Scott's validation reframed what the dataset IS**) |
| **Foundational drafts** | `lcc_workflow_engine_spec.md`, `context_broker_api_spec.md`, `context_packet_schema.md`, `infrastructure_migration_plan.md`, `template_library_spec.md`, `lcc_intelligent_operating_system_v2.md` (the founding vision) |
| **Salesforce metadata** | `SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md`, `SALESFORCE-PAYLOAD-FIELD-PROFILE-2026-08-11.md` |

## P12 — Explicitly excluded (kept so they are not re-proposed)

| Item | Why |
|---|---|
| **Work IQ Mail / Teams connectors** | Excluded by decision — email and comms stay on the LCC path. |
| **A PATCH projector for the 2,809 Outlook contacts** | Measured: ~144 field-values, most of which came *from* Outlook. Would run green and move nothing. |
| **Any CAPTCHA-solving service for SOS egress** | Standing prohibition. The unlock is client fidelity (cookie jar + browser-grade TLS), not defeating a challenge. |
| **Scraping LinkedIn** | ToS. Use the user's own connections export, company team pages, SEC filings, or a licensed API. |
| **Name-keyed web/LinkedIn enrichment** | Confidently moves people to the wrong firm (a 2026-08-26 search returned a *different* Andrew Pulliam). Key on email domain + employer corroboration, never a name match. |
| **`Deal_Participants__c` / SF OpportunityContactRole as the deal-party roster** | Verified dead end for Team Briggs — OCR is empty on all 592 backbone deals; `Deal_Participants__c.Deal` is `Fannie_Mae_Deal__c`. The correspondence-driven matcher is the roster. |

## P13 — Decision forks (Scott's call; do not build past them)

1. **Entity reconciliation** — 232 deals in multi-asset cities are parked as flagged entities. Auto-merge
   on best-match with a review queue, require manual confirmation for all 232, or treat the flagged
   entity as canonical and merge lazily as signal arrives?
2. **Team mailbox intake (Kelly / Sarah / Nate)** — the single biggest cadence-accuracy lever (LCC sees
   only Scott's mailbox; every outlook row is `SYSTEM_ACTOR`). Which mailboxes, what auth model, how to
   attribute per broker. **Deferred by Scott.** Phase 1 (attribution) is buildable independently.
3. **Per-broker delivery (owner-scoped digests)** — live in the engine, specced as a PA flow,
   **PARKED by Scott** until build-out is done and errors are triaged.
4. **Cadence tiering: computed vs manual** (the D12 red line).
5. **The clean-assist rank scales** (N1) — re-ranking `dia_xref` also re-orders the human-facing
   Decision Center lane.
6. **SAM account tier vs interleaving value across tiers** (K2).

---

### How to keep this file honest

- When a row ships, **move it to `CURRENT-STATE.md` §2 and delete it here** — do not leave a ✅ row,
  that is how a backlog rots into a changelog.
- When a row is genuinely retired, **move it to P12 with the reason**, never delete it.
- When measurement refutes a row's premise (it happens often here), **rewrite the row with the
  measurement** rather than silently dropping it — the correction is usually the more valuable artifact.
