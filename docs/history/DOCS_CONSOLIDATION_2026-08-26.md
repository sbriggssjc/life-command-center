# Docs consolidation — 2026-08-26 (Prompt 141): what changed, and the preservation manifest

**Scope: documentation only.** No code, no migrations, no flags, no canon rule text were touched.
`CANON_VERSION` is unchanged at **1.5.0** (no `canon/blocks/*` file was edited, so no bump was owed).

The goal was a slim, accurate, **lossless** current-state reflection: a fresh Cowork chat should be able
to answer *where are we* and *what's left* from two files, without rebuilding either from archaeology
and without re-proposing something already built or dropping something still intended.

---

## 1. What was created

| File | Purpose |
|---|---|
| **`docs/os/CURRENT-STATE.md`** | The single current-state index: runtime truth · what is LIVE by subsystem · the **live feature-flag snapshot** (30 on / 27 off / 2 partial, measured against LCC Opps) grouped by *why* each flag is off · the local-model surface state + a re-measured production-health table · surfaces & canon · the canonical-doc map · the stale claims this pass overturned · where the history went. |
| **`docs/os/PLANNED-BACKLOG.md`** | ONE ranked backlog of everything unbuilt-but-intended, in 14 sections (P0 verify → P13 decision forks). **Every row cites its source file**, so nothing can be mistaken for invented and a future pass can prove nothing was dropped. Includes an explicit **P12 "excluded"** section so retired ideas are not re-proposed, and a **P13 decision-forks** section for the calls that are Scott's. |
| **`docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md`** | The verbatim STATUS tail (see §2). |
| **`docs/history/DOCS_CONSOLIDATION_2026-08-26.md`** | This file. |

## 2. What was archived (verbatim, nothing summarised away)

**`docs/claude-code/STATUS.md`: 3,741 → 2,440 lines (327 KB → 200 KB).**
Original lines **2434–3741** were moved byte-for-byte to
`docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md` — the comps arc (prompts 19–60), the
Wave 8 hygiene campaign, the Wave 9 connectedness build-out, the ChatGPT/Copilot surface rollout, and
the 2026-08-03/04 security + deploy-pending notes. STATUS now opens with a current-state header
pointing at `CURRENT-STATE.md` / `PLANNED-BACKLOG.md`, followed by the 2026-08-13 → 2026-08-26 arc.

> ⚠️ **Deviation from the brief, stated plainly.** The instruction was to keep "the last ~6 weeks" and
> archive older blocks. **Every entry in STATUS.md falls inside a 6-week window** (the file spans
> 2026-08-03 → 2026-08-26, ~3.4 weeks), so a literal 6-week cut would have moved nothing and left the
> file opening on archaeology. The stated *intent* — "STATUS should open with the CURRENT state" — was
> applied instead, cutting at the 2026-08-12/13 boundary. Say the word and the cut can move either way;
> the archive is a clean verbatim split, so re-joining is trivial.

**Nothing was deleted.** No file was removed, no prompt was retired, no design brief was rewritten
away. `docs/claude-code/prompts/141-*.md` was deliberately **left in `prompts/`** — per
`docs/claude-code/README.md` it is Cowork that moves a prompt to `done/` after processing the response.

## 3. What was edited in place (drift corrections, all measured)

| File | Change |
|---|---|
| `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` | Added the CURRENT-STATE / PLANNED-BACKLOG pointers. **Corrected `CANON_VERSION` 1.2.2 → 1.5.0.** Marked §4 "DEPLOY-PENDING" as **historical (2026-08-04)** rather than the current what's-left, and named the two items from it carried forward as still-open (`LCC_API_KEY` rotation, the Census key) rather than declaring them resolved. |
| `docs/os/README.md` | Two new rows at the top of the §3 capability map; step 1–2 of "how a future chat should begin" now routes through CURRENT-STATE and PLANNED-BACKLOG. |
| `docs/os/REGISTRY.md` | Two new §A canonical rows. |
| `docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` | Header pointers. **Fixed the broken `⬜` pointer** (§3 cited a `⬜` in `ROLLOUT_STATUS.md` that does not exist — the W10 Stage 3 intention lives in that file's W10.1 prose, now also carried as backlog **L5**). Marked the daily-briefing narrative as **shipped and live**, with the measurement. |
| `docs/os/LOCAL-MODEL-GAP-AUDIT.md` | Header pointer noting R4–R9 are also carried in the consolidated backlog; the reasoning and refuted premises stay here. |
| `CLAUDE.md` | START-HERE banner now names CURRENT-STATE + PLANNED-BACKLOG. **P138 section corrected**: the flag reads `on` and a real 774-char on-box take exists; the edge-fn deploy note updated to the observed fn version with the confirm-before-re-fire caveat. |
| `docs/architecture/briefing-analyst-take-onprem.md` | Status line corrected from "flag OFF, awaiting the operator gate" to live, with the measurement and the one gate item that may remain. |
| `docs/claude-code/STATUS.md` | New header (see §2). |
| `docs/history/INDEX.md` | New "Status / worklog archives" section indexing this split and the earlier ones. |

## 4. Stale claims measurement overturned

Recorded in `CURRENT-STATE.md` §7 and fixed at each source in the same change, per the standing
"fix the note in the same change" rule.

1. `CANON_VERSION` documented as 1.2.2; actual **1.5.0**.
2. `BRIEFING_ANALYST_TAKE_ONPREM` documented as OFF; registry says **on**, and today's snapshot carries
   a **774-char** take with `source = 'onprem_ollama'`.
3. The leverage map's `⬜` pointer into `ROLLOUT_STATUS.md` matches nothing.
4. **P135 and P136 are written up as fixed but have produced no live write delta** — property-twin
   proposals are still 200 total / **0 in 7 days** (last write 2026-08-19); `reachability_harvest_review`
   is 4 total / **0 in 7 days** (last 2026-08-13). By this repo's own rule that is not yet fixed in
   production. Carried as backlog **V1 / V2** rather than quietly inherited as done.

Queries used (LCC Opps `xengecqvemvfknjvbvrq`, read-only):
`select flag, state, off_since from feature_flags_registry` ·
`select source, count(*), count(*) filter (where created_at > now()-interval '7 days') from lcc_clean_assist_proposals group by source` ·
`select as_of_date, length(analyst_take), analyst_take_meta->>'source' from briefing_intel_snapshot order by as_of_date desc` ·
`list_edge_functions`.

**Deliberately NOT re-measured, therefore NOT declared resolved:** the `LCC_API_KEY` rotation, the
Supabase `service_role` rotation, the Census key, the prompt-19/21/22/23/24/25 open rows, and every
2026-07-27/28 catalog row. All are carried forward as open, several tagged 🔍 *needs re-measure*.

---

## 5. PRESERVATION MANIFEST — every contemplated feature carried forward

This is the checkable list. Each source was swept and its unbuilt items landed in the backlog section
named. **Nothing on the left is absent from `PLANNED-BACKLOG.md`.**

| Source swept | Items carried | Landed in |
|---|---|---|
| `docs/os/BUILD-BACKLOG.md` (2026-07-27) | A1–A8 deal monitor/cadence · B1–B5 SF write-back extensions · NBA1–NBA5 · F1–F4 marketing · E1–E5 edge layers · FP1–FP4 fact propagation · H1–H5 cross-cutting · R1–R4 redesign · G1–G2 invariants · C0–C6 OS rollout · E1–E3 security | P5, P6, P8, P9 |
| `docs/os/BUILD-OUT-CATALOG.md` (2026-07-28) | A1–A11 (incl. A1f OM address feed, A1g SF browser-read feed) · B1–B2 team visibility · C1–C5 surfaces · D1–D5 operational errors · E1–E9 security · F1–F2 roadmap · G1–G6 offer submission · the 3 design forks | P5, P7, P8, P9, P13 |
| `docs/os/BUILD-STATUS.md` (2026-07-28) | "What done needs" 1–6 · Copilot specialists · Office Script · Work IQ config · Proactive Deal Monitor · Mail-intake → dossier | P5, P8 |
| `docs/os/LOCAL-MODEL-GAP-AUDIT.md` | R2 (re-classified to the engine track) · R4 remaining half · R5 · R6 · R7 · R8 · R9. (R1, R3 shipped — recorded as done, not carried.) | P1 N6/N7, P2 L1–L4 |
| `docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` §3 + §4 | Template library (W10 S3) · LoRA (W10 S4) · research synthesis · U4 edit-distance feedback · W5.3 re-grade · GaryBuilt residential egress · CM marketing copy · BOV/OM narratives · comps narrative · LOI structuring · correspondence→cadence next-action · owner-resolution rationale | P1 N4/N5/N6, P2 L3/L5–L10 |
| `docs/architecture/account-based-contact-intelligence.md` | Tiers 0–4 · the 4 spin-off defects · the exclusion-without-a-promoter finding | P3 AC1–AC10 |
| `docs/architecture/contact-reconciliation-outbound.md` §6 | Steps 1–6 · the explicit anti-item (no PATCH projector) | P4 CR1–CR7, P12 |
| SOS egress (`government-lease/CLAUDE.md` §25, LCC `ROLLOUT_STATUS.md` W9.1 Stage 2) | Client fidelity in `sos-proxy/fetcher.js` · adapter re-verification · the flag flip · the per-host hourly cap idea | P0/P1 via §3 flag table, P9 context; **CURRENT-STATE §3** "external egress" row |
| R8 Stage 2 (CM book copy) | The quarterly book copy generator | P1 N4 |
| `ROLLOUT_STATUS.md` | W10 Stage 3/4 (prose, no `⬜` exists) · every BUILT-flag-off unit reconciled against the live registry | P2 L5/L6, CURRENT-STATE §3 |
| STATUS archive (2026-08-03→12) | Open prompts 19/21/22/23/24/25 · `LCC_API_KEY` rotation · the Census key · the BOV template swap · the Northmarq admin connector · the 4 SharePoint `_WORKFLOW` docs | P8 S6/S8/S9, P9 SEC1, P9 third-party keys |
| `CLAUDE.md` known-open findings | Ownership-chain scoring (876 assets) · SAM tier ladder · `v_field_provenance_unranked` 35 rows · the enrich-queue exclusion that never expires · weak-reach worklist · portfolio-ownership conflicts · gov firm-term tail · gov `listing_verification_history` writer · gov FRPP matching · gov Phase A1b · dia CMS month backfill · W6.5 Stage 2/3 | P10 K1–K12 |
| `docs/architecture/*` status lines | Healthcare/ASC/IDTF lane (8 docs) · oncology/infusion lane (7 docs + ADR-005) · ADR-004 identity · 4 sizing docs · 6 foundational drafts · 2 Salesforce metadata docs | P11 |
| `docs/claude-code/prompts/` | 139 (xref rank interleave) · 140 (role-labels grade) · 188 (Tier 0 confirm lane) | P1 N1–N3 |
| Excluded-by-decision items found across all of the above | Work IQ Mail/Teams · PATCH projector · CAPTCHA solving · LinkedIn scraping · name-keyed enrichment · `Deal_Participants__c`/OCR as the roster | P12 (kept, with the reason) |

### Cross-repo work referenced but left in its own repo

Not duplicated into the LCC backlog beyond the P10 pointers — each repo's `CLAUDE.md` remains the
canonical home:

- **Dialysis** — CMS `patient_month_backfill` (needs a CMS-reachable runner); the census/econ reconciliation
  follow-ups.
- **government-lease** — the SOS proxy client-fidelity unlock (§25); Phase A1b per-county assessor fetchers;
  the FRPP↔property matching pass; the stale state-lease diff producer (§21); the `listing_verification_history`
  writer (§29).

---

## 6. How to verify nothing was lost

1. `git diff --stat` on this commit — every source file is either **unchanged**, **appended to**, or
   **split with its tail preserved verbatim**. No file was deleted.
2. `diff <(sed -n '2434,3741p' <old STATUS.md>) <(tail -n +20 docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md)`
   is empty — **verified during this pass: IDENTICAL.** The archive is a byte-identical copy of the removed range.
3. Read §5 above and spot-check any row against `docs/os/PLANNED-BACKLOG.md`.
