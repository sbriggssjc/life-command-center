# LCC — Fresh Chat Kickoff (paste this to start a new Cowork context window)

*Generated 2026-08-26. Copy everything below the line into a new chat.*

---

You're helping Scott Briggs run **Life Command Center (LCC)** — a CRE business-development platform
(Northmarq / Team Briggs; dialysis + government net-lease). The connected folder is
`C:\Users\scott\life-command-center`.

**Read these first, in order, before doing anything (don't rebuild from scratch):**
1. `C:\Users\scott\...\.claude\CLAUDE.md` (global instructions) + the project `CLAUDE.md` (architecture
   invariants, DB topology, the durable footguns).
2. **`docs/os/CURRENT-STATE.md`** — the one-page "where are we": what is LIVE, what is flag-gated OFF and
   **why**, the live flag snapshot, the assist production-health table, and the canonical-doc map.
3. **`docs/os/PLANNED-BACKLOG.md`** — the one ranked list of everything unbuilt-but-intended, every row
   citing its source. **Read it before proposing anything new** — it is probably already there, possibly
   already measured and refuted.
4. `docs/claude-code/STATUS.md` — the running reconcile log, newest first. It is a *log*, not the state;
   pre-2026-08-13 entries are archived at `docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md`.
5. `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` — surfaces/comps/deploy map (its §4 "DEPLOY-PENDING" is
   historical; the live answer is `PLANNED-BACKLOG.md`).
6. `docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` + `docs/os/LOCAL-MODEL-GAP-AUDIT.md` — where the on-prem Ollama
   model is live/dormant/planned, and the ranked gap backlog (R1–R9) with the refuted premises.

**Standing workflow:** Scott pastes Cowork-drafted prompts to "Claude Code" (CC), then pastes CC's responses
(as .docx) into `docs/claude-code/responses/`. Cowork reviews each against LIVE Supabase data, reconciles,
updates STATUS + the relevant docs, verifies migrations/flags live, grades dry-run samples before flipping
flags, and files finished prompts→`prompts/done/` + responses→`responses/done/`. **Git: never run git from
the sandbox** — the `.git/index.lock` is held by Scott's Windows process; hand Scott the PowerShell
(remove lock → add → commit → pull --rebase → push).

**Standing doctrine (non-negotiable):** never fabricate (render "Not on file"/"Derived"/"Conflict"); every
assist is annotation/draft-only + reversible + human-confirmed; **assert on the produced state-delta, never
on `state=on` or a worker's own tally**; re-measure any dated blocker before quoting it; private corpora
(voice, deal correspondence, LOIs, comps) NEVER egress to a cloud model — the on-prem Ollama box
(`OLLAMA_URL`, `invokeOnPremGeneration`) is the path for those. Use `AskUserQuestion` + a task list for
multi-step work.

**Live infra:** Railway host `https://tranquil-delight-production-633f.up.railway.app` (JS ships on redeploy
of merged `main`). Supabase: LCC Opps `xengecqvemvfknjvbvrq`, Dialysis_DB `zqzrriwuavgrquhisnoa`, Government
`scknotsqkcheojiaewwh`. `LCC_API_KEY` rotation is DEFERRED until the app is multi-user.

**Current state (2026-08-26) — the local-model arc is essentially complete:**
- **Production-health of all Ollama assists is GREEN.** 9 of 10 assist flags are ON and producing; the two
  that had silently stalled are fixed (P135 property-twin cursor — live; P136 reachability target-window —
  merged); `OLLAMA_CLEAN_ASSIST` was enriched (P134), re-graded clean, and flipped ON; its provenance ladder
  was wired (P137). `NEXT_STEP_AI` is ON. The Research-page task list (P132) and its ownership-chain drafts
  (P131/P133, cron 239) are live.
- **R8 Stage 1 (on-box daily-briefing "Analyst's Take") shipped (P138) and graded clean** but is **flag-OFF**
  pending two Scott steps: deploy the `briefing-intel-snapshot` edge fn (omit-when-null guard), then flip
  `BRIEFING_ANALYST_TAKE_ONPREM`. Cron 240 fills it at 10:18 UTC once on.

**Immediate next actions (in flight):**
1. **Send to CC (drafted, in `docs/claude-code/prompts/`):** `139` (clean-assist xref rank interleave —
   surface P137's ladder cards), `140` (grade the dormant `OWNERSHIP_CHAIN_ROLE_LABELS` layer), `141` (docs
   consolidation — slim to a lossless current-state + backlog).
2. **R8 gate:** Scott deploys the edge fn + flips `BRIEFING_ANALYST_TAKE_ONPREM`; then Cowork verifies the
   brief renders a real take.
3. **R8 Stage 2:** the same on-box generation pattern for **CM quarterly book copy** (higher-stakes,
   client-facing) — the next net-new build.
4. **Backlog (don't lose):** account-based-contact-intelligence + contact-reconciliation-outbound (hub-and-
   spoke, P184), SOS-direct external egress (bot-wall), the analyst-take voice-tightening tuning, capital_markets
   empty (Anthropic billing). See `LOCAL-MODEL-GAP-AUDIT.md` for R2 (engine-connectivity) + R5–R9.

Start by reading the four docs above, then confirm the current state matches and ask Scott what to pick up.
