# Claude Code Prompt — W7.4: Role Evolution + Open-Issues Surfacing (last Wave 7 unit)

> Grounding: `docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md` §W7.4 + §4
> (verification standard), `docs/audits/ROLLOUT_STATUS.md` sessions 36k–36v (the W7 stack
> as shipped). Read both before writing code. The W7 propagation stack you are extending:
> `api/_handlers/deal-comms-propagate-tick.js` (hourly :32, flag
> `DEAL_COMMS_PROPAGATE_CRON=on`, ledger `lcc_deal_comm_propagated`) →
> `api/_shared/deal-comms-summary.js` (Ollama summaries, `is_current` versioning,
> `compressed_block` watermark), `api/_shared/deal-milestone-cues.js` (deterministic,
> same-key collapse), Phase-1 `deriveNextStep` to-dos (7-day window), dossier
> `source_hash` regen, `api/_shared/deal-resolve.js` (never-guess). Verify all names
> against the repo — do not trust this prompt over the code.

## Objective
From each deal's attributed thread corpus (deal-stamped comms + logged calls), surface
into the living dossier: (a) **party role evolution** — who is emerging as
decision-maker vs transaction manager vs attorney/lender-side as the deal approaches
LOI/PSA; (b) **open issues** — outstanding asks, unanswered questions, and upcoming
commitments ("buyer wants updated financials", "survey due Friday") in a "what's coming"
panel; (c) **stage awareness** — the dossier header reflects the deterministic milestone
picture (advance/regress), correspondence-aware.

## Doctrine (hard constraints — same as W7.1–W7.3)
1. **LLM proposes, never writes facts.** Role inferences and open issues land ONLY in
   the dossier's Analysis/summary sections (or a confirm lane) — never onto contact
   records, deal stage fields, or any auditable gate. Stage awareness (c) is 100%
   deterministic from the milestone cues table — no LLM in that path.
2. **No-fabrication contract.** Every proposed role and issue MUST carry evidence:
   source comm ids + a short quoted span from the actual comm text. A validator DROPS
   any proposal whose quote does not appear verbatim (normalized whitespace) in the
   cited comm. Dropped proposals are logged, never surfaced.
3. **Own seam only.** Extend the existing propagate tick with a new pass AFTER
   summaries/cues/to-dos, watermarked independently (per-deal `source_hash`-style
   watermark over the comm set considered) — do NOT touch the gov seam, the matcher, or
   other producers' ledgers. Idempotent: unchanged corpus → 0 writes on re-run.
4. **Versioning like summaries:** new issue-set/role-set rows supersede via `is_current`
   flip, never UPDATE-in-place of a current row's content; full history retained.
5. **Ollama primary** via the existing `ai.js invokeExtractionAI` seam (GaryBuilt
   qwen2.5:14b), cloud fallback per seam config; AI failure logs raw text and skips the
   deal that tick (never blocks summaries/cues).
6. **Flag-gated + inert until enabled:** `W74_ROLE_ISSUES` (default off). Merging the PR
   changes nothing in prod until the flag flips.

## Design sketch (adjust to repo reality)
- New shared module `api/_shared/deal-role-issues.js`: given a deal's current comm
  corpus (same accessor the summary pass uses), produce
  `{ roles: [{party, proposed_role, confidence, evidence:[{comm_id, quote}]}],
     issues: [{title, kind: ask|question|commitment|deadline, due_hint?, status: open,
               evidence:[{comm_id, quote}]}] }` via one Ollama call per deal (single
  prompt, JSON-constrained), then run the evidence validator.
- **Issue lifecycle:** on each pass, previously-current open issues are re-presented to
  the model with the NEW comms only, asking which are now addressed (evidence required
  to close, same validator). Closed issues keep their row (status flip via new
  versioned row), so the panel shows open + recently-resolved.
- Storage: one new table (e.g. `deal_dossier_analysis`) holding versioned role-set and
  issue-set JSON per deal (`kind` column), or two narrow tables — pick what fits the
  dossier renderer best. Dossier `source_hash` regen must incorporate the current
  analysis rows so the dossier refreshes when they change.
- Dossier render: "What's coming / open issues" panel + a parties sub-section note
  ("emerging decision-maker: …, per 3 threads"), clearly labeled ANALYSIS (proposal),
  with evidence quotes collapsible. Stage awareness: a deterministic line derived from
  the milestone cues (latest milestone, whether a prior-stage milestone re-occurred
  after a later one = regression flag) — no LLM.
- Migration: repo mirror ONLY from what you actually apply live (standing rule: mirrors
  come from the applying session; never fabricate a narrative).

## Tests (all green before PR)
- Evidence validator: fabricated quote → dropped + logged; verbatim quote → kept;
  whitespace-normalized match accepted; cross-comm quote (right text, wrong comm id) →
  dropped.
- Idempotency: same corpus twice → second pass 0 writes (watermark short-circuit).
- Versioning: changed corpus → old row `is_current=false`, new row current; history
  intact.
- Issue lifecycle: an issue closed by a later comm flips via a NEW versioned row with
  closing evidence.
- Deterministic stage line: unit tests over milestone fixtures incl. the Banning-style
  same-key collapse and a regression case.
- Tick integration: role/issues pass failure does NOT block the summary/cue/to-do
  passes (isolated try/catch, error persisted to the run log like the matcher fix).

## Deliverables
PR with: shared module + tick pass + migration (+ mirror), dossier render additions,
tests, `W74_ROLE_ISSUES` flag documented in the flags registry, WAVE7 plan §0 state
table row updated to "built (flag off)", and a DRY-RUN REPORT in the PR description:
run the pass read-only against the live corpus (no writes) for the 5 most
comm-active deals and paste the proposed roles/issues with their evidence quotes so
Scott can eyeball quality before the flag flips.

## Verification (Cowork will run post-merge, per plan §4)
Flag on → next tick → one comm-active deal shows an issues panel with real evidence;
re-run idempotent; a new inbound comm that answers an open issue closes it on the
following tick; ROLLOUT_STATUS session entry recorded.
