# LCC — Fresh Chat Kickoff

> **Every new chat starts from `docs/os/DOCUMENTATION-MAP.md` §0 "Where to start"** (DOCMAP3, 2026-09-24): the five
> state files, `STATUS.md`'s Open-threads table, `docs/claude-code/OPERATOR-CHECKLIST.md`,
> `docs/claude-code/SB notes/TRIAGE.md`, and the prompt/response loop in `docs/claude-code/README.md`. The block below
> is **topic-specific** (the ASC provisional-review handoff of 2026-09-15). Use it only when picking up ASC, and
> re-measure its numbers first. Its step 4 names `docs/os/BUILD-BACKLOG.md`, which is dated 2026-07-27; the current
> backlog is `docs/os/PLANNED-BACKLOG.md`.

*Regenerated 2026-09-15 for the ASC provisional-review handoff. Copy the block below into a fresh chat.*

---

We are continuing the **Life Command Center** build in public repository
`sbriggssjc/life-command-center`. Work from current `main`; do not rebuild or re-litigate completed ASC source
collection.

Read these repository files first, in order:

1. `CLAUDE.md` and `AGENTS.md`
2. `docs/os/BUILD-TURN-PROTOCOL.md`
3. `docs/os/CURRENT-STATE.md`, especially “2026-09-12 ASC frozen-50 review boundary”
4. `docs/os/BUILD-BACKLOG.md`, section F
5. `docs/architecture/HEALTHCARE-ASC-IDTF-PRIVATE-RUN-AUTHORIZATION-v0.1.md`, sections 13–14
6. `docs/architecture/HEALTHCARE-ASC-FIRST-STAGING-RUNBOOK-v0.1.md`, section 8
7. `docs/audits/HEALTHCARE_ASC_50_PROPERTY_CAPTURE_CHECKPOINT_2026-09-11.md`
8. `docs/audits/HEALTHCARE_ASC_50_PROVISIONAL_REVIEW_CHECKPOINT_2026-09-15.md`

Current verified handoff:

- ASC source collection is complete: 50/50 resolved, comprising 44 licensed-source captures and six governed
  source exceptions.
- The governed workbench and migration shipped in PR #2355 (`9829cc3391dc`).
- Reviewer guidance shipped in PR #2384, merge `3f60666055892616648b2348f952d1d53fbefd42`.
- Railway `/version` reported `3f6066605589`, and `/asc-review.html` returned HTTP 200 on 2026-09-12.
- Read-only measurement on 2026-09-15 found 1/50 completed primary scorecards, 0 completed independent second
  reviews, and the submitted primary open in `second_review`. Re-measure before presenting these as current.
- A read-only, evidence-cited provisional pass over all 50 candidates was completed without writing the other
  49 judgments. Its identifier-free aggregate misses four of five gates and provisionally supports
  `enrichment_only`; it is not the official aggregate receipt or an accepted lane decision.
- PR #2384 intentionally excluded `docs/claude-code/STATUS.md` and `docs/os/PLANNED-BACKLOG.md`; do not
  reintroduce those excluded changes by copying them from an old branch.
- No candidate judgment was created or changed by the deployment. IDTF activation, canonical-property writes,
  Salesforce writes, outreach, production-opportunity writes, and lane advancement remain unauthorized.

Next recommended step: use the private provisional ledger to adjudicate the six provisionally qualifying rows
and the 24 `unknown` rows, then make an explicit governance choice: complete the formal 50-row review for an
official comparable receipt, or retain ASC as provisional `enrichment_only` without lane activation. Preserve
`Unknown`/`Unresolved` when evidence does not establish a fact. Every row routed to `second_review` requires a
different authenticated person and disagreements remain open. Re-measure live state before database work. Do
not create or change a judgment without Scott's explicit candidate-scoped authorization or direct human
submission through the workbench.

After all 50 primary scorecards and every required second review are complete, generate and inspect only the
privacy-safe aggregate gate receipt, then make the documented ASC lane decision. Do not start IDTF or extract a
lane-neutral property matcher until that aggregate gate is accepted and separately authorized.

Keep documentation current as work proceeds. At the end of every implementation turn, follow
`docs/os/BUILD-TURN-PROTOCOL.md`: reconcile current `main`, verify the actual state delta, correct stale claims
in place, name the next step, and update this kickoff file. Use branch → PR → required checks → merge for all
publication; never push directly to protected `main`.
