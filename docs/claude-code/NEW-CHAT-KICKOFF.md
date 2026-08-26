# LCC — Fresh Chat Kickoff (paste this to start a new Cowork context window)

*Regenerated 2026-08-26 (evening). Copy everything below the line into a new chat.*

> **Maintenance rule:** this file goes stale faster than anything else in the repo — it is a
> snapshot of "what's in flight," and in-flight things land. **Rewrite it at the end of any
> session that closes or opens a prompt.** The last version claimed 139/140/141 were still to be
> sent and that the Analyst's Take was flag-off; all four claims were wrong within a day.

---

You're helping Scott Briggs run **Life Command Center (LCC)** — a CRE business-development platform
(Northmarq / Team Briggs; dialysis + government net-lease). The connected folder is
`C:\Users\scott\life-command-center`.

**Read these first, in order, before doing anything (don't rebuild from scratch):**

1. `~/.claude/CLAUDE.md` (global) + the project `CLAUDE.md` — architecture invariants, DB topology,
   and the durable footguns. The footgun list is the most valuable thing in the repo; read it.
2. **`docs/os/CURRENT-STATE.md`** — the one-page "where are we": LIVE / flag-gated OFF and **why** /
   the live flag snapshot / the assist production-health table / the canonical-doc map.
3. **`docs/os/PLANNED-BACKLOG.md`** — the one ranked list of everything unbuilt-but-intended, every
   row citing its source. **Read it before proposing anything** — it is probably already there,
   possibly already measured and refuted.
4. `docs/claude-code/STATUS.md` — the running reconcile log, newest first. It is a *log*, not the
   state; pre-2026-08-13 entries are archived under `docs/history/`.

Then, only if the task touches them: `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` (surfaces /
comps / deploy map) and `docs/os/LOCAL-MODEL-{LEVERAGE-MAP,GAP-AUDIT}.md` (where the on-prem model
is live/dormant, and the ranked gaps with their refuted premises).

**Standing workflow:** Scott pastes Cowork-drafted prompts to Claude Code (CC), then pastes CC's
responses (as .docx) into `docs/claude-code/responses/`. Cowork reviews each against **live**
Supabase data, reconciles, updates STATUS + the affected docs, verifies migrations/flags live,
grades dry-run samples before flipping flags, and files finished prompts → `prompts/done/` and
responses → `responses/done/`. **Git: never run git from the sandbox** — the `.git/index.lock` is
held by Scott's Windows process; hand Scott the PowerShell (remove lock → add → commit →
pull --rebase → push).

**Standing doctrine (non-negotiable):** never fabricate (render "Not on file" / "Derived" /
"Conflict"); every assist is annotation/draft-only, reversible, human-confirmed; **assert on the
produced state-delta, never on `state=on` or a worker's own tally**; re-measure any dated blocker
before quoting it; private corpora (voice, deal correspondence, LOIs, comps) NEVER egress to a
cloud model — the on-prem Ollama box is the path for those. Use `AskUserQuestion` + a task list
for multi-step work.

**Live infra:** Railway `https://tranquil-delight-production-633f.up.railway.app` (JS ships on a
redeploy of merged `main`; **a deploy of engine code = redeploy BOTH** tranquil-delight and the
standalone MCP). Supabase: LCC Opps `xengecqvemvfknjvbvrq`, Dialysis_DB `zqzrriwuavgrquhisnoa`,
Government `scknotsqkcheojiaewwh`.

---

## Where things actually stand (measured 2026-08-26 evening)

**Scott is actively working the Tier 0 owner-contact lane** — 27 confirms logged today, lane
**109 → 87 open** (78 `ask` / $237M, 9 `auto` / $10M). That is the highest-value operator surface
in the system and it is draining. His track and the build track do not block each other.
*(That −22 is three effects mixed: Scott's confirms, P193's SPE inheritance removing cards, and
P191 restoring some. Don't quote it as a confirm rate.)*

**The local-model arc is essentially complete.** 30 flags `on`, 27 `off`, 2 `partial`. The on-box
daily-brief **Analyst's Take is LIVE and producing** (774 chars, `source = onprem_ollama`).
Clean-assist, ownership-chain drafts, sf-link, junk pre-screen, naming hygiene, dup-pairs,
match-disambig, next-step: all healthy.

**Three things are open and cheap, and all three are "verify," not "build":**

1. **⏳ THREE LANES ARE AWAITING THEIR FIRST POST-DEPLOY RUN — check these before anything else.**
   property-twin, reachability-harvest and the Analyst's Take all had merged fixes that were
   **never deployed** (they landed after the 16:03 UTC cutoff on 2026-08-26; PR #1789 shipped them
   at 23:13 UTC). **They were not broken — they were not running.** Verify by the delta:

   | lane | cron | window (UTC) | passes when |
   |---|---|---|---|
   | property-twin | 220 | 05:45 | proposals pass **200** |
   | reachability-harvest | 212 | 04:40 | `reachability_harvest_review` passes **4** |
   | Analyst's Take | 240 | 10:18 (weekdays) | a take lands with `generated_at` **inside** that window |

   If any is still flat, *now* it is a code stall. → backlog V1/V2/V7.
2. **`OWNERSHIP_CHAIN_ROLE_LABELS` is built, merged (#1788), deployed, and still ungraded.** The
   endpoint is now live: `GET /api/ownership-chain-draft-tick?role_labels=1&generate=1` (ungated,
   write-free). Read `summary.providers` **first** — a cloud-fallback sample is not a grade of the
   on-box layer the flag turns on — then `chains_altered_by_layer2` must be **0**. → backlog N2.
3. **The `briefing-intel-snapshot` edge fn must carry `if (row.analyst_take == null) delete
   row.analyst_take;`** or a manual re-fire upserts NULL over the on-box take. → backlog V4.

**Two structural findings from 2026-08-26 that change how you read everything else:**

- **⚠️ CI RUNS NO TESTS.** `boot-check.yml` is the only PR check and it runs `npm run check:boot`.
  The 4,551-test suite **never executes on a PR** — which is how #1786 merged green with a red
  suite. **Every "guarded by `test/*.test.mjs`" claim in `CLAUDE.md` is a local regression
  detector, not a merge gate.** Fix is scoped and small; it needs Scott's word → backlog **N9**.
- **⚠️ `staged_intake_extractions` is not one population.** Three channels with different *input
  types* feed it, and the sidebar channel — **56% of rows, 0 hardened-schema extractions out of
  350** — has never run the Prompt-61 prompt. Any unsplit coverage number measures the channel
  **mix**, not the prompt. This reverts the W5.3 "validated" verdict to *unproven* (not refuted).
  → `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`, backlog **N8 / L8 / V6**.

**Live prompt queue — three files in `docs/claude-code/prompts/`:**

| # | What | State |
|---|---|---|
| **189** | **Duplicate owner entities — the top build priority.** Step 1 shipped (`v_lcc_merge_candidates_normalizer_blind`: **121 groups / 300 entities / $136.5M** invisible to the normalizer). Remaining: the wording-difference blind spot (Easterly ×2) and the merge pass. **This is costing Scott operator time right now** — "NGP Capital" is five entities asking the same question. | 🔴 |
| **192** | Tier 0 auto-attach sweep + the living loop. Triage shipped (255 → 109 cards). Remaining: attach the `exact` single-candidate cards **through the existing JS verdict path** (never a new SQL writer that skips the shape gates), un-park signals, learning from `lcc_tier0_confirm_log`. **Auto-attach on `exact` ONLY** — the next tier down proposes *JP Morgan CMBS Trust → jpmorgan.com*. | 🟡 |
| **194** | Trace the sidebar-channel extraction bypass with runtime evidence (+ optionally the CI test workflow). | 🔴 new |

**Next net-new build after those:** R8 Stage 2 — capital-markets book copy on-box (higher-stakes,
client-facing; the same pattern as the brief's Analyst's Take).

Start by reading the four docs above, confirm the current state still matches (**re-measure; this
file is a snapshot**), then ask Scott what to pick up.
