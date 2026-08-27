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
| V1 | **property-twin assist — DIAGNOSED 2026-08-26 evening: the fix was never deployed.** ⚠️ **An earlier version of this row called it "a second stall to diagnose." That was WRONG and is corrected here per the fix-the-note-in-the-same-change rule.** P135 merged at **18:16 UTC**; the build running all day was `bb26453a`, cut at **16:03 UTC**. The code simply was not there. **Cleared by the redeploy at 23:13 UTC (PR #1789) — `git merge-base` now confirms P135 is live and 0 commits are un-deployed.** ⏳ **Verify on the next cron 220 run (05:45 UTC): the proposal count must move past 200.** Until it does, nothing is proven. | ⏳ | diagnosed 2026-08-26 (Cowork); P135 |
| V2 | **reachability-harvest — same cause, same correction.** P136 merged at **18:56 UTC**, also after the 16:03 cutoff. Now live. ⏳ **Verify on the next cron 212 run (04:40 UTC): `reachability_harvest_review` must move past 4.** | ⏳ | diagnosed 2026-08-26 (Cowork); P136 |
| V7 | **⚠️ R8 Stage 1's Analyst's Take is a ONE-SHOT, not a running pipeline — and the docs written the same day already call it "LIVE and producing."** The 774-char take carries `generated_at = 2026-08-26T20:51:16Z`, but its row was created at **10:00 UTC** and cron 240 fires at **10:18 UTC** — so the cron did not write it; it was generated manually during the P138 session, hours later and after the deploy cutoff. **P138's tick only became deployable at 23:13 UTC.** ⏳ **The real verification is tomorrow's 10:18 UTC cron run (weekdays): a take must appear with `generated_at` inside that window.** Same class as V6 — a one-shot result read as a live capability (P176). | ⏳ | measured 2026-08-26 (Cowork) |
| V6 | **⚠️ `_provider` stamp coverage is DECAYING, not fixed.** Post-93 recorded "100% (87/87 backfilled)" — that was a **backfill, not a repaired writer**, and the daily new-row rate decays straight back to zero (2026-08-10: 64/64 after the backfill → 08-14 1/9 → 08-19 0/4 → **08-26 0 of 21**). Assert on the 7-day new-row rate, never the cumulative. Root cause is shared with N8 below. | 🔴 | `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md` |
| V3 | ~~**Ownership-history lane drain.**~~ **MEASURED 2026-08-26 — and the lane will not drain as built, for a structural reason.** 545 open / **0 completed in 68 days**. The 545 drafts split into **FOUR structurally different actions presented as one undifferentiated queue**: **380 agree with the current owner** (a confirmation, auto-appliable, carrying **450** missing ownership links), **73 MISMATCH** (last recorded grantee ≠ our owner — a data-integrity alert, and exactly the "~73 flags" this row predicted), **74 no records on file**, and **18 `all_transitions_guarded`** — transfers that exist but were all guard-rejected, which is *not* the same fact as "no records". Nobody completes one because all four look identical from outside. **Superseded by A1 (shipped) → A2/A3/A4/A4b.** | ✅→A1 | `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md` |
| V4 | **`briefing-intel-snapshot` edge-fn guard.** The on-box Analyst's Take is live, but a manual snapshot re-fire will upsert NULL over it unless the deployed fn carries `if (row.analyst_take == null) delete row.analyst_take;`. Fn is v21 (updated 2026-08-26) — confirm the source. | 🔍 👤 | `docs/architecture/briefing-analyst-take-onprem.md` |
| V5 | **`PA_OUTLOOK_DRAFT_FLOW` reads `off`** in the registry with `off_since` = 2026-08-21 — the same day the Outlook draft seam was proven working end to end. One of the two readings is stale. | 🔍 👤 | registry, measured 2026-08-26; STATUS 2026-08-21 |

## P1 — In flight / next up

| # | Item | State | Source |
|---|---|---|---|
| ~~N1~~ | ~~**Prompt 139 — interleave the clean-assist provenance lane.**~~ **SHIPPED 2026-08-26** (PR #1787 for the load-order follow-up; the P139 work itself was already on main). `interleaveByKind`, the band collapse, the seeder chips with honest `6 of 65` counts. CLAUDE.md carries the P139 section. | ✅ | `prompts/done/139-*.md` |
| N2 | **Prompt 140 — grade `OWNERSHIP_CHAIN_ROLE_LABELS` before flipping.** **BUILT AND MERGED 2026-08-26 (PR #1788); the GRADE ITSELF IS STILL OUTSTANDING and the flag is still off** (`off_since` 2026-08-26, confirmed in the registry). The grading endpoint ships with the Railway redeploy of merged `main` — the sandbox has no `OLLAMA_URL`, so every model path was stubbed and **no real sample exists yet.** After the redeploy: `GET /api/ownership-chain-draft-tick?role_labels=1&generate=1` (ungated, write-free). Read in order: **`summary.providers`** first — a sample rescued by the cloud fallback is not a grade of the on-box layer the flag turns on; then `summary.chains_altered_by_layer2` (**must be 0**); then `party_presence_fail_rate` (a meaningful drop rate is the guard working, not the run failing); then the surviving labels against each link's facts (an SPE reshuffle must not read arms-length; a nominal-price deed must not either). | ⏳ 👤 | `prompts/done/140-*.md`; `docs/audits/P140_ROLE_LABEL_GRADE_DRYRUN_2026-08-26.md` |
| N8 | **⚠️ The sidebar channel has NEVER run the hardened extraction prompt — 0 hardened rows of 350 in 30 days, and it is the LARGEST producer (56%).** All seven Prompt-61 keys are structurally absent, `_provider` is unstamped, `stripNonSaleKeys` never runs. **Ruled out, do not re-walk:** stale deploy (live `/version` **includes** the P61 commit); a second writer (one insert site, both guards above it); a flow writing the table (none); **and the `seed_data` passthrough — TESTED AND REFUTED**: 65 of the 101 rich-seed rows carry a `cap_rate` in the seed, **0** in the snapshot. **Corrected hypothesis: a distinct sidebar DOCUMENT-extraction path with its own older prompt.** Needs runtime evidence → prompt 194. | 🔴 | `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md` |
| N8a | **Sidebar is two populations and only one was ever the story.** 101 CoStar **page** captures (rich seed: asking_price, cap_rate, tenant_name, `domain_property_id`) produce **0 OM-class rows, 0% cap, 0% NOI**; 249 **document** captures produce the 87%-cap OM rows. **Open question: is the page-capture structured data reaching the domain DBs, or being dropped?** `CLAUDE.md` asserts `sidebar-pipeline.js` writes domain DBs directly — **a docs assertion, unverified.** If dropped, that is a real capture loss on 101 rows / 30 days. Folded into prompt 194. | 🔴 | same audit, §3 |
| ~~N8b~~ | ~~Seed the email/PDF path from structured capture the way sidebar does.~~ **NOT A THING — refuted before it was proposed.** Sidebar's coverage does not come from its seed (the seed reaches the snapshot 0% of the time); it comes from its document extraction. Recorded so the idea is not re-raised on the strength of the 87%-vs-65% gap. | 🚫 | measured 2026-08-26 |
| N9 | ⚠️ **PARTIALLY SHIPPED AND CURRENTLY RED — read this before trusting any guard.** `.github/workflows/test-suite.yml` shipped 2026-08-27 (PR #1792), **and has never once been green, including on `main`.** It was pinned `node-version: '20'`, copied from `boot-check.yml`; three test files import Deno `.ts` edge modules and **Node 20 cannot load a `.ts` file** (`ERR_UNKNOWN_FILE_EXTENSION`, 0 pass). On Node 22 the suite is **4,606 pass / 0 fail**. **The one-line fix (`'20'` → `'22'`) is on a pushed branch with NO PR open** — `main` is still red. Two operator steps remain: (a) merge that fix, (b) add *"npm test"* to branch protection as a **required** check (Settings → Branches → main) — without (b) a red suite still merges, as PR #1793 proved by merging **58 seconds after opening, before CI finished**. **Durable rule now in `CLAUDE.md`: a new CI job is not shipped until it has been green once on `main`** — a job red on every run is a badge people learn to merge past, which is the exact failure N9 existed to close. | 🟡 👤 | `CLAUDE.md` footgun; A1 response |
| N3c | **Bank / trustee owners in the prospecting scope — a scope question, not a person-pick.** Surfaced while ranking the live lane: `Truist Bank → truist.com` ($6.2M, **15 candidates**), `Wells Fargo Bank, National Association`, `JP Morgan Chase … CMBS Trust`. A bank appearing as owner-of-record is usually a **trustee or lender**, not a party we prospect — same family as public bodies and securitization vehicles. Decide the rule once rather than asking Scott to pick among 15 bank employees. ⚠️ Do NOT generalise from one row: the CMBS trust was left unfixed in P187 precisely because it was a single instance; measure the population first. | 🔴 👤 | `STATUS.md` 2026-08-26 division-of-labour |
| ~~N3~~ | ~~**Prompt 188 — the Tier 0 confirm lane.**~~ **BUILT AND LIVE 2026-08-26** (PR #1785). Lane `tier0_owner_contact`, **237 actionable cards / 171 owners / $695M**, one card per (owner, DOMAIN). Nothing is written to `owner_contact_pivot` until Scott clicks Attach. | ✅ | `prompts/done/188-*.md`; `docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md` |
| N3d | **⭐ NEXT: work the 60 BYTE-IDENTICAL merge groups ($102.4M).** P189 made them visible — "NGP Capital" ×5, "AVG Partners" ×4, "GI Partners" ×3, 60 groups where every member name is the same string. Highest-confidence cleanup available, and it directly removes the duplication Scott hit in the lane. Rank by rent, propose per group, merge through `lcc_merge_entity` only. ⚠️ **Do NOT auto-merge** — the fallback groups are deliberately `auto_mergeable = false`. ⚠️ **Boyd Watterson's 7 zero-rent siblings are NOT merge targets** (JV vehicles + a brokerage artifact). ⚠️ Run the Class 8 sweep a day later — a verified result has a shelf life. | 🔴 | `docs/audits/P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md` |
| N3e | **⚠️ 95 parked Tier 0 cards ($118M) are stuck PERMANENTLY, and the prompt claimed otherwise.** They carry person evidence (correspondence / SF campaign / SF contact / title) but no *link* evidence, and the decidability `CASE` reads only link evidence. **Do NOT fix by widening the un-park** — that restores the Gary George noise P192 removed. They need a **different resolution path**: enrichment to establish the employer, or an explicit "domain-only, needs research" lane. Observable in `v_lcc_tier0_park_watch`. | 🔴 | `STATUS.md` 2026-08-26 reconciliation |
| N10 | **The 4 byte-identical owner groups P195 HELD — a junk/name-repair job, not a merge.** `partnersgroup` (18 entities, 17 of them empty husks minted 2026-06-24/26 with no domain/identity/relationship/portfolio), `capital` (3 entities across dia+gov with three DIFFERENT external identities — three real parties whose captured name got truncated to one word), `properties` (2), `capitalgroupproperties` (2, $158,846 — one is a gov `true_owner`, the other carries a `costar/company` external_id of `capital properties`). **Merging these on name identity would fabricate a party**, which is why the P195 gate held them. The work is junk-entity retirement + name repair at the capture source. | 🟡 | `docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md` §1 |
| N11 | **⚠️ `lcc_merge_entity` is IRREVERSIBLE — it calls the reconcile with `p_snapshot => false`.** Every dedup DELETE it performs (portfolio facts, external identities, relationships, watchers, `owner_contact_pivot`) is unrecoverable, so **`lcc_apply_fuzzy_merges` auto-merges 3,053 groups with no undo**. P195 worked around it by snapshotting in its own driver rather than widening the shared path's write volume mid-pass. Separately its pivot dedup `EXISTS` is **uncorrelated** — it asks only whether the winner has a pivot at all, then deletes the loser's, which on `bamproperties` would have destroyed the group's only named contact. Fix the shared path: snapshot by default, and fold the pivot fill-blanks inside the merge. | 🔴 | `docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md` §2 |
| N3a | **Prompt 189 — duplicate owner entities. The byte-identical half is DONE (P195); the wording-difference half is not.** P195 merged **66 entities into 56 survivors, $102.2M consolidated** (NGP Capital 5→1, $59.8M→$68.3M, 29→38 assets) and scheduled the Class-8 re-sweep (cron 243). **Still open: the wording-difference blind spot** — Easterly ×2 (`easterly gov reit` vs `easterly government`) still renders 4 cards for one firm, and P189 measured and REJECTED the obvious fix (grouping on the shared email domain: 25% precision, 4 pairs / 1 real; the domain is shared because an SPE family shares its sponsor's). Needs a different signal, not a re-run. | 🟡 | `prompts/189-*.md`; `docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md` |
| N4 | **R8 Stage 2 — capital-markets book copy on-box.** The quarterly ST-Market / NM-CapMarkets copy is templated, private and repetitive — the highest-value remaining on-box generation target after Stage 1 (the brief). Currently routes cloud / is hand-authored. | 🟢 | `LOCAL-MODEL-GAP-AUDIT.md` R8; `LOCAL-MODEL-LEVERAGE-MAP.md` §4.1 |
| N5 | **R8 (rest) — BOV/OM exhibit narrative first-drafts** and **comps narrative + reconciliation synthesis.** Facts are already extracted; draft the cover-note/exhibit prose in Scott's voice, deal specifics stay on-box. | 🟢 | `LOCAL-MODEL-LEVERAGE-MAP.md` §4.2–4.3 |
| N6 | **R4 (remaining half) — going-cold detection + suggested-touch prose.** `NEXT_STEP_AI` is on; the missing half is Ollama reading the deal thread and drafting *who's quiet, why, suggested touch* into the cadence engine. | 🟢 | `LOCAL-MODEL-GAP-AUDIT.md` R4; leverage map §4.5 |
| N7 | **R2 (re-classified) — OM-economics write-back + owner-edge creation.** Measured as category (a): the LLM already ran (3,955 staged items carry `asking_price`/`cap_rate`, `lcc_property_attributes` exists). What is missing is the **deterministic** write-back and the asset→owner edge from the extracted owner. Unblocks offer-context, cadence and dossiers. **Moved OUT of the local-model track into engine connectivity — still high value.** | 🟢 | `LOCAL-MODEL-GAP-AUDIT.md` R2 (re-measured 2026-08-24) |

## P1b — Consumption-layer repairs (data-process audit, 2026-08-26) — **owned by the automation chat**

Source: `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`. **~3,000 research tasks and 419
decisions are open; 983 tasks sit in lanes that have never completed a single item.** The system is
not short of automation — it is short of **consumption**. Ranked by operator-time saved per unit of
build effort.

⚠️ **A1–A4 are category (a) under the P131 lens — the answer is already on-box and STRUCTURED.
They need deterministic plumbing. Do NOT put a model anywhere in this path.**

| # | Item | State | Notes |
|---|---|---|---|
| **A1** | ~~Split `establish_ownership_history` into its FOUR real actions.~~ **DONE 2026-08-27** — `v_lcc_ownership_history_lane_split` (one row per open task, LEFT JOIN to its draft, `action` ∈ agrees/mismatch/no_records/all_guarded) + `v_lcc_ownership_history_lane_actions` (chip rollup) + `human_actionable_tasks` appended to `v_lcc_research_lane_summary`. Migration `20260827090000`, applied live; P180 view equivalence-gated at **0 rows differing both directions**. Measured from the STRUCTURED booleans: **agrees 380 / mismatch 73 / no_records 74 / all_guarded 18**, links 450/120/0/0, **0 tasks without a draft** (545/545, no orphans, no dupes). Badge now reads **91**, not 545. Server-side `lane_action` filter in BOTH research branches (v1 + v2 — `V2_MAP` reroutes the endpoint when `queue_v2_enabled` flips, and a filter implemented once would silently unfilter). Guard `test/ownership-lane-split.test.mjs` (15 tests, mutation-verified red on prose-classification, on an INNER JOIN, and on a v2 branch missing the filter). Writeup: `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`. | ✅ | **the split is NOT the verification** — this lane has still never completed a task; A2–A4b are what move that |
| **A2** | **UNBLOCKED by A1** (read `action='agrees'` off `v_lcc_ownership_history_lane_split` — 380 tasks / 360 owners / 450 links; do NOT re-derive the bucket). **Auto-apply the 380 "agrees" chains** through the existing merge/provenance path — dry-run first, reversible by batch tag, honest counts (report **links written**, never chains scanned). Adds **450 missing ownership links** to `lcc_entity_portfolio_facts`, the exact gap the lane was minted for. ⚠️ *An earlier draft said ~707 — that was P131's stale figure; measured now it is 570 across all 453 draftable, 450 in the 380 auto-appliable.* **Never a new SQL writer that skips the shape gates.** | 🟢 | removes 380 of 545 from a human queue |
| **A3** | **UNBLOCKED by A1** (`action='mismatch'` — 73 tasks / **45 owners** / $401.2M; note the 1.6× task-per-owner inflation, so value is per owner). **Route the 73 MISMATCH rows to a data-integrity lane**, value-ranked, with **both readings on the card** — our owner may be wrong, or the chain may be incomplete. Do not presume which. ⚠️ **E4 MEASURED 2026-08-27 — the mismatches PARTIALLY cluster, so triage by source before building 73 human cards.** Links on the 73 chains by `citation.data_source`: **`gsa_lease_diff`/acquisition 50 links across 46 chains** · `costar_sidebar` 53 links / 21 chains · `sales_transaction`/sale 15 / 15 · `county_deed` 2 / 2 (chains carry links from more than one source, so these overlap). **46 of 73 chains touch `gsa_lease_diff`** — the producer `CLAUDE.md` already documents as emitting an "acquisition" every time the GSA lessor field flickers between an SPE and its parent, which is exactly the shape that leaves a chain ending on the wrong side of the flicker. **That is a hypothesis, not a verdict** — it was not confirmed that the flicker causes these specific mismatches. Test it on the 46 first: if it holds, most of A3 is one upstream fix and only ~27 chains are genuine human judgements. | 🟢 | highest value *per item* in the audit, currently invisible |
| **A4** | **UNBLOCKED by A1** (`action='no_records'` — 74 tasks / 62 owners; the view can never hand you the 18, which is the point). **Auto-retire the 74 `no_transitions_on_file`** with a terminal, dated state that re-opens if new records land. ⚠️ **Only the 74 — NOT all 92.** | 🟢 | stops permanently-unanswerable items ageing into "overdue" |
| **A4b** | **UNBLOCKED by A1** (`action='all_guarded'` — 18 tasks / 18 owners / $33.5M; `rejected_count` on the split view carries how many transitions each one lost, and the draft's `rejected[]` names which guard fired). **⚠️ The other 18 are `all_transitions_guarded` and are NOT "no data."** Transfers exist and **every one was rejected by a P138 guard** (self-transition, oscillating pair, unclean name, missing `true_owner_id`). A guard that is marginally too strict is recoverable; retiring these alongside the 74 would silently discard the recoverable half. Sample them, name which guard fired, decide per guard. | 🟡 | the P181 lesson — one label covering two different facts |
| ~~**A0**~~ | ~~**Committed conflict markers are on `main`, and nothing detects them.**~~ **DONE 2026-08-27.** `docs/architecture/panel-redesign-verification.md` lines **424–571** (148 lines) were an unresolved merge committed as file content — `<<<<<<< HEAD` / `=======` / `>>>>>>> f59679a2`, introduced by `5bbe8c0f` and unnoticed for 75 days. **Git does not flag it** (no `UU` — the conflict *was* resolved, by committing the markers), and prose has no parser. Third instance of the keep-both-sides class in one evening: in YAML it made a workflow unrunnable; in prose it silently voided half a verification document. **Guard:** `test/no-conflict-markers.test.mjs` — scans every tracked text file, reports a bare `=======` (and diff3 `|||||||`) **only inside** a `<<<<<<<`…`>>>>>>>` span since a lone `=======` is a valid Markdown setext underline; **verified RED on the live pre-fix file** naming all three line numbers, green after. **Repair:** the two sides were **not alternatives** — one held §4.2f (browser verification), the other §4.2d's supersession note plus §4.2e (the view rewrite); **both kept verbatim, reordered to 4.2e → 4.2f**, nothing dropped, no measurement changed, and the one genuine conflict (§4.2f is headed 2026-08-15 yet verifies §4.2e, headed 2026-08-16, with *Post-115* numbers) is **flagged in the file rather than adjudicated**. **Sweep: this file was the ONLY hit repo-wide** — 4,107 tracked files, zero other markers, so this is one file and not a pattern, and per the prompt no `CLAUDE.md` footgun entry was added (`GITHUB-WORKFLOW.md` §4b carries the guard pointer instead). | ✅ | `GITHUB-WORKFLOW.md` §4b; `prompts/A0-conflict-marker-guard-2026-08-27.md` |
| **A5** | **Give a consumer to — or retire — six lanes with ZERO lifetime completions:** `milestone_confirm` (56 open, 21d), `confirm_tenant_mismatch` (26, 64d), `npi_new_registration` (17, 20d), `state_lease_distress_review` (8, 21d), `person_email_merge_review` (8, 14d), `confirm_deed_transfer_sale` (4, 42d). **119 items.** Per doctrine a producer with no consumer should not have shipped — **retirement is often the honest fix, not a new surface.** | 🔴 👤 | one decision per lane; Scott's call on which are worth consuming |
| **A6** | **Re-measure `confirm_true_owner`** — 152 open, 35 ever decided, **0 in 7 days**, 82 days old. It decided 35 once, so it is *stalled*, not dead: a different diagnosis. Ask what advances its working set. | 🔍 | |
| **A7** | **Decide `match_disambiguation`'s fate** — a ranked lane with **1** lifetime decision in 81 days. Either surface it or stop paying to rank it. | 🔴 👤 | ranking a queue nobody works is spend with no return |

**Areas for further exploration (E1–E6)** — questions this audit opened but did not measure, kept
so they are not lost. **None is a recommendation yet.** Full detail in the audit doc §5:
**E1** are the 9,605 `skipped` genuinely retired or is work hiding there · **E2** measure the
healthy lanes' **7-day rate**, not their lifetime totals (the P176/V6 trap) · **E3** where Scott's
time actually goes *outside* any queue — likely the biggest wins and invisible to every table here
· ~~**E4** do the 73 mismatches cluster by `data_source`~~ **ANSWERED 2026-08-27: they PARTIALLY
cluster — 46 of 73 chains touch `gsa_lease_diff`, the known SPE↔parent flicker producer. Not one
fix, but triage-by-source could reduce A3 to ~27 genuine judgements. Folded into A3; the causal
link is a hypothesis and still needs testing on the 46.** · **E5** re-test whether
`owner_contact_manual`'s egress block is still true or now a dated blocker · **E6** size the CM
book-copy saving in hours before building the top-ranked new automation (N4).

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
| L8 | **⚠️ W5.3 intake re-grade — PREMISE CORRECTED 2026-08-26, the row was asking the wrong question.** It read "re-grade on ~50 fresh intakes post-Prompt-61." Two things measured: (a) the re-grade **already happened** on 2026-08-11 (102 extractions) and upgraded the verdict to "validated" — but (b) it averaged **three channels with different INPUT types**, and the sidebar channel (56% of rows) has never run the hardened prompt at all. So the number graded the channel **mix**, not the prompt. The real open work is a **channel-split grade of the email/PDF path on its own**, which is the only path Prompt 61 touched. First unmixed reading: email OM-class NOI **52%** / tenant **60%** / responsibilities **44%** over 30 days, against the 89/79/79 claimed fleet-wide. **Whether that is a regression, a harder document mix, or simply the first honest measurement is NOT established — do not assert either way.** Blocked on N8 (a grade of a channel that is silently bypassing the prompt cannot mean anything). | 🔴 | `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`; supersedes leverage map §3 |
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
| AC1e | **⭐ Prompt 193 — SPE subsidiaries inherit the sponsor's contact.** Scott from the lane: subsidiaries "should be connected to the true owner parent once we have a connected domain and person." **19 of 107 cards are one question asked three times** (ngp 13 SPEs, uirc 5, jbg 1). ⚠️ **NOT prompt 189's merge problem** — these are legitimately distinct SPEs, so the fix is a parent edge + inheritance and merging them would corrupt ownership. `lcc_buyer_parents` (25 curated parents, incl. NGP/UIRC/RMR) and `v_lcc_entity_tier0_parent` (330 proposals, 85 covering these SPEs) already exist; the gap is that **`entity_relationships` has no parent TYPE and 0 parent edges**. Rollup view shipped; bulk attach must go through the JS verdict path, and the WHICH-PERSON choice stays human (UIRC has 7 candidates). | 🟡 | `prompts/193-*.md` |
| AC1d | **⭐ Prompt 192 — the auto-attach sweep + the LIVING loop.** P192 shipped the triage (255→109 cards, `parked_domain_only` computed live so it self-unparks). Still to build: (a) the sweep that attaches the 11 `exact`+single-candidate cards **through the existing JS verdict path**, never a new SQL writer that skips the shape gates; (b) un-park signals wired from correspondence / SF campaign / title / sponsor map; (c) learning from `lcc_tier0_confirm_log` — a **reject** should demote that domain for other owners sharing the weak token. ⚠️ **Auto-attach on `exact` ONLY** — `domain_is_core_prefix` reads ~9/12 and proposes *JP Morgan CMBS Trust → jpmorgan.com* and *Frontier Hub LLC → frontier.net* (an ISP). | 🟡 | `prompts/192-*.md` |
| AC2 | **Tier 1 — rank the bench, don't pick one winner** (volume, recency, two-way, seniority, inferred function). The pivot already has a `bench` column. **Scott 2026-08-26: this is the requirement, not a nicety** — the active contact must be the current head of a re-derived ranking, not a decision recorded once, because roles/firms/funds change. ⚠️ The target is the **acquisitions** contact, not the highest-volume one (Easterly: Pulliam 109 emails EVP-Acquisitions = target; Shuler 51 emails DD manager = not). | 🟢 | `prompts/192-*.md` §3 |
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

### K13–K18 — the Capital-Markets chart defects (recovered 2026-08-27 from a root-level worklog)

⚠️ **These five were measured in detail on 2026-08-10/11 and never reached this backlog**, because
the P141 consolidation swept `docs/` and they lived in `CAPMARKETS_TAB_PACKET_WORKLOG.md` at the
repo **root**. Recovered while consolidating the root worklogs; source now archived at
`docs/history/worklogs/CAPMARKETS_TAB_PACKET_WORKLOG.md`. **Each carries its own live measurement —
re-measure before acting, but do not re-derive.**

| # | Item | Size |
|---|---|---|
| K13 | **`cm_gov_sold_cap_by_term_dot` uses the OLD term ladder, not `firm_term_years_at_sale`.** It prioritises `(gsa_leases.termination_date - sale_date)`, then `leases.firm_term_years - elapsed`, then the older `sales_transactions.firm_term_years` — the **opposite** of the dia R68/R66x pattern where the sale-frozen field is canonical. **1,368 cap-eligible sales bucket differently** under the two ladders; 2025–26 sales with 10+ years at sale plot as `<5` or `outside` because a stale GSA termination date wins first. Term data is NOT missing (3,211/3,211 populated). **Also the view's `cap_5to10` cohort is labelled `6-10`**, so 5–6yr sales sit in the middle bucket behind a wrong label. Fix: `COALESCE(firm_term_years_at_sale, lease fallback only when null)`, align buckets to 10+/6-10/<6/outside, keep the 2yr TTM + n>=5 gate, expose per-cohort n. **This is a stale view definition, not a data-ingestion failure.** |
| K14 | **`cm_gov_lease_termination_rate_m/_q` can select a CORRUPT partial snapshot as its active denominator.** `gsa_snapshots` 2019-02 holds **11 lease keys** against ~8,050 in adjacent months, so Feb-2019 plots `total_leases_active=11`. The view already builds a `clean_snap` set for departure endpoints but the active count still carries forward from raw `snap_agg`. Fix: carry forward the latest **clean** snapshot on/before the period using the same plausibility guard. |
| K15 | **Corrupt source snapshot months need re-ingest/repair** — `gsa_snapshots` 2019-02; `gsa_inventory_snapshot_lines` 2019-02, 2022-10, 2022-11. Separate from K14: fixing the view stops this chart hitting them, but every other consumer still can. |
| K16 | **`cm_gov_rent_price_psf_q` has no display policy and pre-1997 history is not reliable.** 1990–96 has `rent_psf` null throughout (`n_with_rent_ttm=0`) while `price_psf` rides 3–4 TTM observations (1994-12 ≈ $638/SF, 1995-12 ≈ $528/SF). First sustained period by a conservative gate (8 consecutive quarters, both series populated, both n>=4) is **1997-06-30**; density is materially better from 2003 and strong 2005+. No `rent_and_price_psf` row exists in the gov `cm_view_registry`, so nothing is cropped today. **Scott's call: 1997-06-30 for maximum history, or 2003-01-01 to prioritise sample density.** |
| K17 | **`cm_gov_market_turnover_m` — export-side crop applied in code, DB and export policy have not converged.** Pre-2012 rows are artifacts (2005-01 `active_count=1`, 2008-12 `=2`) against 79–180 TTM sales. A curated `resolveEffectiveDisplayFrom()` fallback pins gov market_turnover at 2012-01-01 in the exporter, **because the live gov `cm_view_registry` has no `display_from` column** (`42703`). Fix: migrate the registry columns or crop in the view, so source and export agree. |
| K19 | **gov seller-sentiment fix was never mirrored to dia.** `cm-excel-export.js` drops the `_8q` columns and relabels `10+ yr` → `6+ yr` for gov; the 2026-08-12 follow-up ("mirror the fix to dia + recent-tail coverage guard") is recorded as intent with no evidence it landed. Re-measure before acting. → `docs/history/worklogs/GOVERNMENT_SELLER_SENTIMENT_WORKLOG.md` |
| K20 | **dia 23654 Census-radius demographics write never completed.** Prompt 16's live-apply checklist items 1–2 were applied and re-verified; **item 3 (the Census-radius demographics write) is the remaining one.** `scripts/backfill-dia-location-trade-area-23654.mjs` passes syntax check and `.env.local` carries a `CENSUS_API_KEY`. Related to the un-re-measured "Census key" note carried in `CURRENT-STATE.md` §7. → `docs/history/worklogs/DOSSIER_LOCATION_TRADE_AREA_23654_WORKLOG.md` |
| K18 | **`cm_gov_core_cap_rate_dots` retains a lease-derived term fallback that nothing currently uses.** Audited 2026-08-11: all 1,143 plotted dots come from sale-frozen `firm_term_years_at_sale`; `lease_fallback_term_dots = 0`. **Acceptable for current report use** — but future unbackfilled sales could enter through the fallback. Fix if stricter provenance is wanted: expose a term-source flag, or require `firm_term_years_at_sale IS NOT NULL` in the core-dot wrapper. |

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
