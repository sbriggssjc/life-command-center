# Local-Model Gap Audit — value-ranked, tackle most-impactful first

Last updated: 2026-08-24 (Cowork whole-system audit). Companion to `LOCAL-MODEL-LEVERAGE-MAP.md` (which maps
where the on-prem model is live/dormant). THIS doc inventories the **manual-research, feedback-loop, and
code-connectivity gaps** where the local Ollama model could unlock a business-process step, **ranked by
data/productivity/efficiency impact**, with the plan to tackle them most-impactful → least. Doctrine unchanged:
private corpora stay on-box; every assist is annotation/draft-only (proposes into a review lane, never an
auto-write) and reversible.

## Ranked gaps (impact = stalled volume × frequency × downstream unlock; effort/risk noted)

**R1 — Dead research queues: draft-then-confirm the ownership-history + manual-contact lanes.** *(MANUAL-RESEARCH
+ FEEDBACK-LOOP)* `establish_ownership_history` **545 open / 0 lifetime completions**, `owner_contact_manual`
**316 / 0**, `npi_missing_inventory` **203 / 0** — ~1,064 stalled rows across 7 never-consumed research types
(DEAD_END_AUDIT_PLAYBOOK Class 2). The evidence to work them is ALREADY on-box (deeds, SOS `manager_name`,
signatures, `activity_events`); `manual-research-worklist.js` even pre-assembles the breadcrumbs + Google
queries — a human then researches from scratch. **Unlock:** Ollama drafts the chain-of-title / most-likely
decision-maker + rationale into the review card, flipping the operator from "research" to "confirm." **Impact:
highest raw** — the single largest never-consumed inventory. **Effort: medium** (new draft-generator over
existing data; annotation-only).

**R2 — Correspondence-first ORE + OM-economics write-back (the spine that self-resolves per deal).**
*(CODE-CONNECTIVITY)* On an emailed listing OM, the owner arrives as name fragments with ZERO ownership edges
(Snellville: RCG Ventures ×3 + Rcg-Brywood ×2 + RCG LLC + Frank Meyrath → asset 44179, no edge —
`offer-context-connectivity.md` root-cause #1), AND the extracted ask/NOI/cap/lease-structure never land on a
canonical store (root-cause #2). **Unlock:** Ollama drafts (a) the "collapse these fragments to one canonical
owner + link the person" verdict into the owner-contact lane, and (b) an economics fill-blanks writer with a
typed confidence/source note. **Impact: highest connectivity** — fixes the asset→owner→contact→economics spine
on EVERY inbound OM, which unblocks offer-context, cadence, AND dossiers downstream. **Effort: medium-high**
(engine writers + the ORE dedupe path).

**R3 — Generalize Decision Center lane pre-ranking (activate the dormant assists).** *(FEEDBACK-LOOP)* ~20 lanes
(`api/admin.js:6874`), `lcc_decisions` **2,358 open / 1,254 decided in 30d**; only a few carry LLM proposals, so
operators page past thousands (the P-Class-7 "first actionable card at row 1,869 / page 75" finding). The
`*_ASSIST` lanes (`PROPERTY_TWIN_ASSIST`, `MATCH_DISAMBIG_ASSIST`, `W9_3_SF_ASSIST` ~3.3k rows, `OLLAMA_CLEAN_ASSIST`,
`W8_U2_DUP_PAIRS`, `W9_2_REACHABILITY_HARVEST`, `W8_U5_NAMING_HYGIENE`) are BUILT but OFF. **Unlock:** nightly
Ollama pre-rank per lane so page 1 = real work; flip the dormant flags after a dry-run sample. **Impact: high,
compounding across every lane. Effort: LOW** — already built, just dry-run review + flag flip. *(Best
impact/effort ratio — the fast win.)*

**R4 — Going-cold detection + suggested-touch prose (feed the cadence engine its missing consumer).**
*(FEEDBACK-LOOP)* `cadence-alerts.js` / `cadence-engine.js` / `deal-comms-summary.js` have ZERO Ollama calls;
`NEXT_STEP_AI` (derive the to-do from inbound) is dormant. **278 active cadence rows** (post-P112) have a
producer but a thin consumer. **Unlock:** flip `NEXT_STEP_AI` + Ollama reads the deal thread and drafts
"who's quiet, why, suggested touch." **Impact: high** (drives daily BD action). **Effort: low-medium.**

**R5 — Wrong-party edge substance-check (guardrail).** *(MANUAL-RESEARCH)* Role-string guards let **80
competitor/own-firm edges (CBRE/Eastdil/JLL/@northmarq) / 27 owners / $340.7M** through as `prospecting_contact`
(Class 4, `v_lcc_prospecting_edge_review`). **Unlock:** Ollama classifies a contact's *substance*
(broker/own-firm/principal) as a second look on edges the label guard clears. **Impact: medium-high** (data
integrity on $340.7M of owners). **Effort: low** (annotation on an existing review view).

**R6 — Undecidable owner-attach residue.** *(MANUAL-RESEARCH)* `owner_contact_attach_review` deterministic
triage leaves **~18 "no lean — human call" rows/run** (acronym/subset cases). **Unlock:** Ollama drafts the
same-party rationale + verbatim quote for those. **Impact: medium.** **Effort: low.**

**R7 — Activate the `signals` learning loop (the compounding one).** *(FEEDBACK-LOOP)* `writeSignal` fires in 9
producers; only 3 static SQL views consume it; the draft-vs-sent edit-distance (`template_refinements`) is
captured, unfed. **Unlock:** weekly Ollama few-shot over the diffs + response outcomes → voice/template
refinement proposals (the quality loop, no LoRA needed). **Impact: compounding** (tunes ranking + voice over
time). **Effort: medium.**

**R8 — Recurring-artifact drafting: daily-briefing prose, comps/BOV/OM narratives, quarterly CM book copy.**
*(MANUAL-RESEARCH)* `briefing-data.js` is string-templated (no Ollama); CM copy is hand-authored; comps/BOV
cover-prose is manual. **Unlock:** `invokeOnPremGeneration` drafts each on-box from assembled facts. **Impact:
medium-high time-per-artifact, recurring. Effort: medium** (per surface).

**R9 — Named-lead → find-their-line matching (partly egress-blocked).** *(MANUAL-RESEARCH)* `v_lcc_named_lead_worklist`
(SAM.gov POC name+title, no email) is a text-matching backlog toward ~478 unreachable owners ($454.6M). **Unlock:**
Ollama matches named leads to owner LLCs on-box + drafts the target rationale. **Impact: high volume BUT** the
contact-*acquisition* half is still SOS/web egress-blocked, so partial. **Effort: medium.**

## ⚠️ CORRECTION 2026-08-24 (measured live, not from seed migrations)
The live `feature_flags_registry` shows **R3 is mostly ALREADY ON**: `MATCH_DISAMBIG_ASSIST`,
`PROPERTY_TWIN_ASSIST`, `W8_U2_DUP_PAIRS`, `W8_U5_NAMING_HYGIENE`, `W9_2_REACHABILITY_HARVEST`,
`W9_3_SF_ASSIST` (+ junk-prescreen) are **on**; only **`NEXT_STEP_AI` and `OLLAMA_CLEAN_ASSIST` remain off.**
The Explore sweep + `LOCAL-MODEL-LEVERAGE-MAP.md` read the SEED-migration states; the registry had moved
(re-measure-the-dated-blocker doctrine — it bit this very audit). Production confirmed for two:
`w9_3_sf_assist` 247 proposals / 47 in 7d (active), `property_twin_assist` 200 / 0 in 7d (worth a "drained vs
stalled?" glance). Others write to other stores — not verified inert. **So R3 shrinks to: dry-run + flip the 2
remaining lanes, and spot-check the on-lanes actually drain.** The REAL top untapped leverage is R1 + R2 (both
net-new, genuinely unbuilt). **Re-ranked #1 = R1.**

## ⚠️ P131 VERDICT (2026-08-24) — R1 was misframed; a durable LENS for the whole audit
Building R1 (PR #1774, both flags OFF) re-measured both premises and **both were wrong** — the corrections are
the real value:
- **Ownership-history was NOT an LLM gap — it was a deterministic data-plumbing gap.** The chain of title is
  ALREADY on-box, structured, and unread: 544/545 rows have `gov.ownership_history`; **453 yield a clean dated
  chain (707 links)** via the P138 view. LCC never read it (the P138–P141 feeder only fed `is_latest_for_property`
  = the current owner). Fix = **deterministic** chain drafter (`ownership-chain-draft-planner.js`, flag
  `OWNERSHIP_CHAIN_DRAFT`), citation = a record reference, breaks = "Not on file". Ollama is confined to a safe
  LABEL layer only (`OWNERSHIP_CHAIN_ROLE_LABELS`) — it can't add/remove/reorder/re-date/rename a link.
  Two hard stops on the LLM framing: **`gov.deed_records` holds 0 legal-description chars across 5,804 rows**
  (no deed text to quote), and **an Ollama proposer for this exact gap already exists + is ON (W8 U3) with a
  ~52% quote-not-verbatim hallucination rate** — a second would duplicate it and inherit that floor.
- **`owner_contact_manual` is NOT answerable on-box at all** — 0/316 have a notice address, 0 a linked person,
  1 any correspondence; the bench is 86% self-echoes (SOS naming the LLC as its own manager) + OM row-labels
  minted as people. It's the residue automation already picked over. **A drafter here would FABRICATE — CC
  correctly built none;** instead `v_lcc_owner_contact_decidability` (6 decidable / 310 blocked) surfaces the
  answerable few so they stop being buried.
- **DURABLE LENS — classify EVERY gap before proposing a local-model unlock:** (a) answer already on-box &
  STRUCTURED → deterministic plumbing, NOT the LLM (ownership-history); (b) on-box but UNSTRUCTURED text → LLM
  fits (drafting, summaries, role-labels); (c) NOT on-box → neither; an LLM would fabricate (owner_contact_manual).
  **R2–R9 below were written before this lens — re-measure each against it before building; several may be (a)
  or (c), not (b).** (This is the re-measure-the-dated-blocker doctrine applied to my own audit.)

## Tackle order (most impactful first) — and the first concrete action for each
1. **R3 first (fast, high, low-risk):** dry-run review + flip the dormant Decision Center `*_ASSIST` lanes in
   value order (`NEXT_STEP_AI` → `PROPERTY_TWIN_ASSIST` → `W9_3_SF_ASSIST` → the rest). No new build. → *first
   action: pull a dry-run proposal sample for the top lane.*
2. **R1 (biggest raw impact):** build the Ollama draft-generator for the dead research lanes
   (ownership-history + owner_contact_manual) → *first action: draft a CC prompt.*
3. **R2 (biggest connectivity unlock):** correspondence-first ORE dedupe + OM-economics write-back → *CC prompt.*
4. **R4** going-cold/next-touch (folds R3's `NEXT_STEP_AI` flip + a new draft). 5. **R5** edge substance-check.
   6. **R6** undecidable residue. 7. **R7** signals loop. 8. **R8** recurring-artifact drafting. 9. **R9**
   named-lead matching (after the egress question).

Rationale for ordering R3 before R1/R2 despite R1/R2's higher raw impact: R3 is already built (review+flip, not
a build), so it banks impact this week while R1/R2 go through the CC build loop — highest impact/effort first,
then highest raw impact.
