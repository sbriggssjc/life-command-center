# LCC — Fresh Chat Kickoff

*Regenerated 2026-09-12 for the ASC frozen-50 governed-review handoff. Copy the block below into a fresh chat.*

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

Current verified handoff:

- ASC source collection is complete: 50/50 resolved, comprising 44 licensed-source captures and six governed
  source exceptions.
- The governed workbench and migration shipped in PR #2355 (`9829cc3391dc`).
- Reviewer guidance shipped in PR #2384, merge `3f60666055892616648b2348f952d1d53fbefd42`.
- Railway `/version` reported `3f6066605589`, and `/asc-review.html` returned HTTP 200 on 2026-09-12.
- The last database-verified review baseline, measured before reviewer work began, was 0/50 primary reviews and
  0/22 initially required independent second reviews. Re-measure before presenting these counts as current.
- PR #2384 intentionally excluded `docs/claude-code/STATUS.md` and `docs/os/PLANNED-BACKLOG.md`; do not
  reintroduce those excluded changes by copying them from an old branch.
- No candidate judgment was created or changed by the deployment. IDTF activation, canonical-property writes,
  Salesforce writes, outreach, production-opportunity writes, and lane advancement remain unauthorized.

Next recommended step: guide the authenticated primary reviewer through the frozen candidates in
`/asc-review.html`, one candidate at a time, using only cited evidence. Preserve `Unknown`/`Unresolved` when the
evidence does not establish a fact. Every candidate routed to `second_review` must be reviewed by a different
authenticated person; disagreement remains open. Before doing any database work, measure the live counts and
candidate states read-only. Do not create or change a review judgment without Scott's explicit, candidate-scoped
authorization or direct human submission through the workbench.

After all 50 primary scorecards and every required second review are complete, generate and inspect only the
privacy-safe aggregate gate receipt, then make the documented ASC lane decision. Do not start IDTF or extract a
lane-neutral property matcher until that aggregate gate is accepted and separately authorized.

Keep documentation current as work proceeds. At the end of every implementation turn, follow
`docs/os/BUILD-TURN-PROTOCOL.md`: reconcile current `main`, verify the actual state delta, correct stale claims
in place, name the next step, and update this kickoff file. Use branch → PR → required checks → merge for all
publication; never push directly to protected `main`.
