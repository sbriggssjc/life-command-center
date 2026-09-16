# INVENTORY1 — everything ever planned, designed or discussed for LCC, against what is actually built and running

**Filed:** 2026-09-16 (Cowork), at Scott's request. Exploratory; the deliverable is an inventory and a
gap map, not a build. This is the round that lets the next hundred rounds be aimed.
**Owner:** LCC. Read-only against the databases; writes only under `docs/audits/` and one backlog section.
**Read first:** `docs/os/BUILD-TURN-PROTOCOL.md` (especially ⑦ *extract before you archive*),
`docs/os/CURRENT-STATE.md` (§6 canonical-doc map, §8 where the history went), `docs/os/REGISTRY.md`,
`docs/os/PLANNED-BACKLOG.md` (the canonical open-work list — but it is the *claimed* list, and the
point of this round is to test it), `CLAUDE.md` → "Inert-feature registry".

## Scott's words

> Collect and categorize all build, design, plans, architecture, etc. work that has ever been worked on
> and discussed to inventory it and then compare the actual work that was completed and the status of
> the build to assess the gaps and help design our path forward on unlocking and getting working all
> open or uncompleted plans. I want to make as complete and efficient the process and way we handle the
> build of this app and processes so that nothing is slipping through the cracks and we are
> intelligently pushing this thing forward in the right direction at the right spots.

## Why this is not "read the backlog"

The backlog has ~900 rows and is maintained by the same process it would be auditing. History shows
the leak is real: CONSOLIDATE1 found **25 planned items filed nowhere**; a design doc read *"not
executed"* about a cutover that had shipped three months earlier; a freshness monitor evaluated
nothing for 33 days with zero alerts. The sources of intent are scattered across at least:
`docs/architecture/**` (≈90 files), `docs/audits/**`, `docs/capital-markets/**`, `docs/comps-*/**`,
`docs/history/**` (the archived STATUS spans and prompt rounds: `claude-code-prompts*.md`,
`future_enhancement_prompts.md`, `LCC_FIX_LIST*.md`, …), the root `SPEC_*.md` files, the ~10 loose
`.docx` reports at the root (`LCC_Architecture_Gap_Analysis.docx`, `LCC_Infrastructure_Migration_Plan.docx`,
`LCC-Unified-Property-Detail-Spec-v1.docx`, `LCC_Holistic_Audit_2026-05-17.docx`, …),
`docs/claude-code/prompts/done/` (every prompt ever run), `docs/os/canon/`, and the three databases'
feature-flag registries (`CURRENT-STATE.md` §3).

## Step 1 — build the intent inventory (mechanical, exhaustive)

One row per **intended capability** — not per document. Walk every source above (including the
`.docx` files via `pandoc`) and extract every "we will / should / plan to / Phase N / Unit N / P-number /
round" statement into `docs/audits/INVENTORY1_intent_2026-09.csv` with columns:
`id · capability (one line, the doc's words) · category · first_seen (doc, date) · last_seen ·
domain (dia/gov/lcc/all) · stated_status_in_source · backlog_row (if any) · prompt_ids (if any)`.
Categories, fixed list: **ingestion** (CoStar, CMS, GSA, SOS, assessor, SF, email), **identity**
(entities, operators, agencies, dedup), **ownership** (resolution, deeds, transitions), **BD engine**
(priority, cadence, NBA, decision center), **comps / capital markets**, **BOV / OM / dossier**,
**surfaces** (app tabs, MCP, Copilot, ChatGPT, sidebar, Teams), **flows / automation** (Power
Automate, cron, ticks), **infra / CI / security**, **docs & process**. Expect 600–1,200 rows; report
the count per source so a thin source is visible.

## Step 2 — the actual-state column (measured, not read)

For each row, one of five states, each with the evidence beside it:
`LIVE` (deployed SHA contains it AND a live probe/query shows it doing work — a row count that moved,
a log line this week, a flag ON in the registry) · `BUILT-OFF` (in `main`, flag OFF or never invoked:
the inert-feature class) · `PARTIAL` (some units shipped; name which) · `PLANNED` (a doc says so;
nothing in code) · `ABANDONED` (superseded or refuted; cite the round that did it).
Rules: a merge is not LIVE (`CLAUDE.md` → "Merged is not running"); a status word in a doc is not
evidence; a `count(*)` of a table with no writes since July is `BUILT-OFF`. Where you cannot
measure, write `UNMEASURED` and why — that column is itself a finding.

## Step 3 — the gap map

From the joined table:

1. **Leaks**: intents with no backlog row and state ≠ LIVE/ABANDONED. This is the "slipping through
   the cracks" list. Expect dozens.
2. **Ghosts**: backlog rows whose intent is LIVE already (close them, with the evidence).
3. **Inert**: BUILT-OFF items, with the flag and the reason it is off if one was ever recorded; the
   ones with no recorded reason are the dangerous ones.
4. **Chains**: for each category, the dependency order of the PLANNED/PARTIAL items — what unblocks
   what. Draw it as a list, not a diagram, with the single next unit per chain named.
5. **Contradictions**: two docs stating opposite intent for the same capability, each with its date.

## Step 4 — the recommendation, in Scott's frame

One page, `docs/audits/INVENTORY1_GAP_MAP_2026-09.md`: per category, what is live, what is inert and
why, what is the single next unit that unlocks the most, and what should be formally abandoned. Then
**the process recommendation**: what in the current loop (`docs/claude-code/README.md`,
`BUILD-TURN-PROTOCOL.md`, the backlog) allowed the leaks found in step 3.1, and the smallest change
that closes each leak class — a guard test, a required column, a ritual. Every recommendation names
the leak it prevents; no recommendation without a leak.

## Prohibitions

- ⛔ No build, no schema change, no flag flip. Reading only.
- ⛔ Do not close, rename or renumber backlog rows in this round; propose the closures in the gap map
  with evidence, and Cowork applies them.
- ⛔ Do not summarise a doc from its title or first paragraph; extract from the whole file.
- ⛔ No "unmeasured" row is silently promoted to a state.

## Reporting

Row counts per source and per category; the five-state distribution; the leak / ghost / inert lists
in full; the chains; the process recommendation. State what could not be read (a `.docx` that would
not convert, a database you could not probe). If any step was skipped, say so.
