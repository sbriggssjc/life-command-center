# Local Model (GaryBuilt / Ollama) Leverage Map

> **System-wide state:** [`CURRENT-STATE.md`](CURRENT-STATE.md) · **all unbuilt work (this file's
> §3 and §4 included, consolidated):** [`PLANNED-BACKLOG.md`](PLANNED-BACKLOG.md).

Last updated: 2026-08-24 (Cowork audit). Single source of truth for where the on-prem Ollama local model
(`qwen2.5:14b` on GaryBuilt, tunnel `garybuilt.briggscrelccopps.com`) is used, is built-but-dormant, is
planned, and could expand. **Doctrine:** private corpora (voice, deal correspondence, buyer LOIs, comps) NEVER
go to a cloud model; the local model is the on-box path for exactly those. All traffic flows through
`api/_shared/ai.js` (`invokeExtractionAI({surface})`, `invokeOnPremGeneration` fail-closed,
`invokeOnPremEmbeddings`). Master gate `OLLAMA_URL`; per-surface gate `OLLAMA_SURFACES`. Playbook:
`docs/setup/garybuilt-local-model.md`.

## 1. LIVE today (already leveraging the local model)
- **Extraction:** OM/deed intake (`intake-extractor.js`), leases (`lease-extractor.js`), BOV (`bov-extract.js`),
  owner-name (`cre-owner-extract.js`), party-extract (`party-extract.js`, gov live via `W51_PARTY_EXTRACT`).
- **Narrative/summary:** deal dossiers (`dossier-generator.js`), W7.2 deal-comm summaries + W7.4 roles
  (`deal-comms-propagate-tick.js`, `DEAL_COMMS_PROPAGATE_CRON` live), W7.5 action summaries (`W75_ACTION_SUMMARY`).
- **Drafting:** `draft-assist.js` (W10 Stage 2 RAG + `nomic-embed-text` embeddings; `DRAFT_ASSIST` on, save
  gated on `PA_OUTLOOK_DRAFT_URL`) — the whole email arc this session.
- **Voice:** `scripts/voice-distill.mjs` (on-box only, refuses without `OLLAMA_URL`).
- **Junk pre-screen:** `W8_U1_JUNK_PRESCREEN` (live, nightly 03:40, ~25/night).
- **Next-step derivation:** `NEXT_STEP_AI` (**live 2026-08-26**) — inline in `deal-comms-propagate-tick`
  / `intake-tagged-comm` / `intake-correspondence`; deterministic-first (zero-spend keyword classifier
  resolves clear intents, dry-run measured 6/6 correct), Ollama only on the ambiguous residue, fails
  null → generic to-do. Auto-titles/types/dates the self-updating cadence to-do from what the
  correspondent actually said.
- **Chat (optional):** Ollama is a selectable `invokeChatProvider` provider (only under `AI_CHAT_POLICY=balanced`).

## 2. ⚠️ CORRECTED 2026-08-26 — these are ALREADY ON, not dormant. The work is PRODUCTION HEALTH, not activation.
**Measured sweep of `feature_flags_registry` (2026-08-26, Cowork): 9 of 10 assist flags are `state=on`.**
The only one off is `OLLAMA_CLEAN_ASSIST` (held off after a dry-run — thin context, Prompt 134). So the
"flip these for fast leverage" framing below is **stale** — there is essentially nothing left to activate.
The real question is now whether each ON assist is actually **producing** (assert on the state delta, not
the flag). First check already found one silently stalled:
- **`PROPERTY_TWIN_ASSIST` — ON but STUCK.** Produced 200 annotations in one run on 2026-08-19, **0 in the
  7 days since**, while **1,095 rows are pending**. The tick pulls the first-200 pending window, finds all
  200 already annotated (`fresh:0`), and no-ops — it never paginates past the first 200, so ~895 pending
  twins will never be annotated. Cron fires nightly, writes nothing, looks healthy. → **Prompt 135**
  (paginate the working set / advance the cursor past the annotated window).

**→ Next real work is NOT more flips.** It is (a) fixing the stalled producers found below, and (b) the §4
NEW builds (R8). Each assist remains annotation-only (proposes into a review lane, never auto-writes),
reversible.

### Production-health pass — measured 2026-08-26 (assert on write delta, not `state=on`)

| assist | flag | state | production | verdict |
|---|---|---|---|---|
| ownership-chain draft | `OWNERSHIP_CHAIN_DRAFT` | on | 545 total, 545 in 7d, last today | ✅ healthy |
| junk pre-screen | `W8_U1_JUNK_PRESCREEN` | on | scanning, cursor advancing | ✅ healthy |
| naming hygiene | `W8_U5_NAMING_HYGIENE` | on | fresh/slice, cursor advancing | ✅ healthy |
| dup-pair | `W8_U2_DUP_PAIRS` | on | 149 fresh/slice, cursor advancing | ✅ healthy |
| match-disambig | `MATCH_DISAMBIG_ASSIST` | on | 1,270 total, 33 in 7d, 0 unannotated | ✅ healthy (caught up) |
| sf-link assist | `W9_3_RESCORE` (source `w9_3_sf_assist`) | on | 247 total, 47 in 7d, caught up | ✅ healthy (caught up) |
| next-step | `NEXT_STEP_AI` | on | inline (no proposal table) | ✅ on |
| **property-twin** | `PROPERTY_TWIN_ASSIST` | on | **200, 0 in 7d, 895 unreached** | ✅ **FIXED + LIVE-VERIFIED (P135, 2026-08-26)** — live dry-run now `fresh:895 / remaining:895` (was `fresh:0`); drains toward 1,095 over nightly runs |
| **reachability harvest** | `W9_2_REACHABILITY_HARVEST` | on | **16 ever, 0 in 11d** vs ~15k pool; diagnostic POST = fixed 120-target window, 0 evidence for those 120 while 5k intake + 4.3k comms names + 2k signature phones sit unused | 🔧 **FIXED (P136, 2026-08-26)** — checked targets are marked (`reachability_harvest_target_marker`) so the window advances, AND targets are chosen by an evidence JOIN; verify by the proposal-count DELTA past 16 |
| ollama clean-assist | `OLLAMA_CLEAN_ASSIST` | **on** | **ENRICHED (P134) + RE-GRADE PASSED 2026-08-26 → FLIPPED ON.** 20-item sample: 8/14 grounded (sf_link 4/4 incl. `merge@0.99` Realty Income citing strict_core; owner_reconcile 4/4 grounded abstentions), 6 correctly SKIPPED (no evidence), property_merge noise eliminated. Cron 200 hourly. **Provenance ladder wired (P137, merged):** `current_priority` + `priority_ladder` added to the view + handler select (join resolves 454/454, 433 decidable). Live payoff masked until the 65-row `dia_xref` backlog (ranks `1001` > ladder rows ≤1000, no ladder by design) drains via cron — optional xref re-rank is Scott's call | ✅ on (ladder wired; xref rank = optional follow-up) |

**Structural tell (CONFIRMED on both, now both fixed):** the two stalled lanes were the ONLY ones without a
**paging scan** over their backlog — every healthy assist pages through its own. property-twin used a fixed
first-200 window (**fixed in P135**: `selectFreshTwinRows` pages past the annotated prefix, bounded by
`PROPERTY_TWIN_ASSIST_SCAN_MAX`, reporting `fresh_this_run` / `remaining` / `scan_capped` so an exhausted
backlog is distinguishable from a windowed one). reachability-harvest had the same shape and **its 16 was a
stall, not a narrow-source floor** (**fixed in P136**, and note it needed TWO fixes where property-twin needed
one):

- **A paging cursor alone was not enough.** property-twin's annotations ARE its cursor — an annotated row is
  self-excluding, so lifting the window was the whole fix. reachability-harvest's proposals are keyed
  `(arm, contact, field)`, so a target that yields NOTHING leaves no trace at all: it is re-selected forever
  and nothing about it ever changes. **A lane whose only cursor is its own output cannot page past work that
  produces no output** — it needs a NEGATIVE marker (`reachability_harvest_target_marker`, dated and
  expiring) recording *checked, and empty*.
- **Blind rank picked targets that could not be resolved.** The tick ranked the unreachable pool and then
  asked "is there evidence for these?" — `donors_found:0 / with_evidence:0` on 120 targets, while 5,000
  intake records and 7,926 harvestable comms rows sat unread. Selection now JOINS the evidence index first
  (name in intake/comms, or an SF identity a donor could match) and tops the batch up with no-evidence rows
  so those get marked too. **Ask what the producer JOINS on, not just what it orders by** — the ordering was
  never the problem.

**⚠️ The generalised check for the rest of this table:** a `state=on` flag whose annotation count is FLAT is
the same silent stall wearing a healthy badge. For each remaining assist ask *what advances its working set*,
and assert on the write delta over the last 7 days — never on `state`, and never on the worker's own tally
(a re-discovery counter like `already_annotated` reads exactly like throughput while nothing moves).
Note the SF-assist flag is `W9_3_RESCORE` in code, NOT `W9_3_SF_ASSIST` as older docs said.

Each is **annotation-only** (proposes into a review lane / `metadata.assist`, never an auto-write or a verdict),
reversible. Activation gate (historical): `OLLAMA_URL` set on Railway + flag on (env + `feature_flags_registry`).

| flag | what it does | value |
|---|---|---|
| `PROPERTY_TWIN_ASSIST` | pre-ranks the ~1,245-row dia property-twin review lane (P106) | operator works real twins first |
| `MATCH_DISAMBIG_ASSIST` | nightly pre-rank of the `match_disambiguation` lane (P80) | fewer minutes per merge decision |
| `OLLAMA_CLEAN_ASSIST` | triage / record-link / field-conflict proposals into `lcc_clean_assist_proposals` | ⚠️ **dry-run 2026-08-26: HELD OFF** — 6/12 sample proposals were content-free "insufficient evidence" (thin `context` payload); safe but low-value. Needs context enrichment first → **Prompt 134**. Cron 200 exists + no-ops while off. |
| `W9_3_SF_ASSIST` | ranks the ~3.3k `sf_link_candidate` lane | drains the biggest single lane |
| `W8_U2_DUP_PAIRS` | same-party/distinct second-look on near-miss owner pairs | feeds owner reconciliation |
| `W9_2_REACHABILITY_HARVEST` | attributes contact reachability from intake snapshots/signatures (verbatim-quoted) | more owners reachable |
| `W8_U5_NAMING_HYGIENE` | abbreviation-expansion proposals | cleaner entity names → better merges |

> ✅ **`NEXT_STEP_AI` activated 2026-08-26** (moved to §1 LIVE). Was the top of this list.

**~~Recommended activation order~~ — SUPERSEDED 2026-08-26 (see §2): every flag in this list is already
`on` except `OLLAMA_CLEAN_ASSIST`. There is nothing left to activate; the table above is retained only as a
description of what each assist DOES. The remaining work is production health, per §2.** Each: pull a dry-run sample, eyeball 10–20 proposals for precision, flip,
watch the queue drain by value. **⚠️ Before flipping any lane-ranking assist, confirm the lane's SURFACE
actually renders** — the Research page task list was 500-dead until P132 (2026-08-26), so a ranked lane
would have promoted work onto a screen no operator could see.

## 3. Planned but untouched (local-model work designed, not built)
- **Template library** (W10 Stage 3 — ⚠️ **the `⬜` this used to cite does not exist in
  `ROLLOUT_STATUS.md`**; the intention lives in the prose of that file's **W10.1** row, and is now
  carried as backlog row **L5**): cluster the sent corpus by draft-type, synthesize
  Scott-voiced parameterized templates + triggers (new listing → announcement; LOI → offer-submission).
- **LoRA fine-tune** on the 10-yr sent corpus (`garybuilt-local-model.md` Phase 3) — never started.
- **~~Daily-briefing narrative~~ → SHIPPED AND LIVE (R8 Stage 1, Prompt 138). Measured 2026-08-26:**
  `BRIEFING_ANALYST_TAKE_ONPREM` reads **`on`** in the registry and today's `briefing_intel_snapshot`
  carries a **774-char** take with `analyst_take_meta.source = 'onprem_ollama'` (every prior day is
  length 0). Kept below for the scoping reasoning; **it is no longer planned work.** Remaining check:
  the `briefing-intel-snapshot` edge fn must carry the omit-when-null guard (backlog V4).
- **Daily-briefing narrative — original scoping (Prompt 138, 2026-08-26).** The brief already has an
  "Analyst's Take" section + `briefing_intel_snapshot.analyst_take` column + renderer — but the field is
  **EMPTY** (0 length, 3 days running): the generator is a **cloud Claude** call in the
  `briefing-intel-snapshot` edge fn, gated on `ANTHROPIC_API_KEY` (unset → silently skipped). P138 moves it
  **on-box** (a Node tick → `invokeOnPremGeneration`, fills `analyst_take` from the private pipeline/priority/
  deal-delta signals in Scott's voice) — doctrine-correct (private synthesis stays on-box) and lights up a
  dead section. Public market/news sections stay cloud.
- **Research synthesis** — summarize owner-contact / `research_task` results into structured payloads.
- **U4 edit-distance feedback** — the draft-vs-actually-sent accept/edit signal is wired in `draft-assist.js`
  but not fed; it's the quality loop that would tune voice over time.
- **W5.3 intake local-vs-cloud re-grade** — pending measurement on ~50 fresh intakes post Prompt-61 hardening.
- **GaryBuilt residential IP as non-datacenter egress** for owner web-search (`W9_CONNECTEDNESS_KICKOFF.md`).

## 4. Candidate NEW areas (highest business leverage, not yet built)
1. **Capital-markets marketing copy** — the quarterly ST-Market / NM-CapMarkets book copy (`capital-markets-copy`
   skill, `cm_*` views) is templated, private, repetitive → ideal on-box generation; currently routes cloud.
2. **BOV / OM exhibit narrative first-drafts** — dossier + `bov-extract` already extract the facts; draft the
   cover-note/exhibit prose in Scott's voice, deal specifics stay on-box.
3. **Comps narrative + reconciliation synthesis** — draft the appraiser-facing comp-set summary and flag
   outliers without egressing deal comps (`query-comps.js` / comps-engine).
4. **LOI/offer intake structuring** — on-box extraction of buyer/price/terms from inbound LOI PDFs
   (`offer-submission`); counterparty terms are exactly the private corpus the doctrine protects.
5. **Correspondence → cadence next-action** — extend the W7 comms summaries to propose the cadence STEP
   (who's going cold, suggested touch) into the cadence engine.
6. **Owner-resolution rationale** — draft the one-line "why these are the same party" on the hard residue the
   deterministic classifiers punt.

## Recommendation
**Capture the built leverage before building more:** run a dry-run review + flip of the Section-2 dormant assist
lanes (starting `NEXT_STEP_AI` → `PROPERTY_TWIN_ASSIST` → `W9_3_SF_ASSIST`). Then the single highest-value NEW
build is **capital-markets marketing copy** or **BOV/OM exhibit narratives** — both save Scott real time per
deal/quarter and keep private data on-box. Non-Ollama dormant items (owner-enrich SOS/deed/address adapters,
Decision-Center writebacks) are separate and mostly blocked on external egress, tracked in
`feature_flags_registry`.
