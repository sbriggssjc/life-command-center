# DOCMAP3 — deep-read by consequence, and close the boundary DOCMAP2 left

> **DOCMAP2 (PR #2173, reconciled 2026-09-08) swept 7 retired terms across 855 `.md` files and shipped 2 fixes.
> The reconcile found the same term had 12 defects, not 2 — the grep was `Vercel` (capitalised) and six flow
> docs carry the retired host only inside a lowercase URL. It also found that "`docs/architecture/` grew 181 → 232"
> was a non-recursive count: the 51 are subdirectories nobody has ever classified.** Both are now filed
> (`STATUS.md` 2026-09-08 DOCMAP2 entry, backlog J13/J13a/DOCMAP2). **This unit does the pass DOCMAP2 named
> and did not start: Unit 1b, deep-read by consequence.**

**Repo:** `life-command-center` · **No code, no DB, no migrations. No deletion. No hand-edit of any file whose
header says GENERATED.** Banner, move, or fold — DOCMAP1's convention, original text preserved.

**Read first:** `docs/claude-code/STATUS.md` (the 2026-09-08 DOCMAP2 entry) → `docs/os/DOCMAP1_CLASSIFICATION.md`
(method + tiers) → `docs/audits/README.md` (why audits are not classified per file).

---

## 0. Three rules this unit inherits, because each was paid for this week

1. **Grep the machine identifier, case-insensitively, across every file type — never the brand name.**
   `grep -ri life-command-center-nine` found 12 where `grep Vercel` found 2. A retired dependency is a hostname,
   a table, a function, a flag — the prose word is what the correctly-framed history mentions.
2. **Candidates, defects and READ-AND-CLEAN are three numbers.** "58 of 59 correctly framed" recorded 57 unread
   files as clean. For every term and every unit: *how many hits, how many read, how many defects, how many
   fixed.* An unread file is counted-only; never call it clean.
3. **Count recursively, and say which count you mean.** `find -maxdepth 1` and `find` differ by 51 here.

---

## Unit A — classify the 51 `docs/architecture/` subdirectory files (never classified by any pass)

`docs/architecture/flows/` (45) · `ai-chat-routing/` (4) · `backfill-artifacts/` (1) · `office-scripts/` (1).
`DOCMAP1_CLASSIFICATION.md` has zero rows with a `flows/` path. **Six of DOCMAP2's ten missed defects were in
`flows/`, so start there.** Verdict each file STALE / HISTORICAL / CANONICAL / DUPLICATE with DOCMAP1's
confidence tier, and **append the rows to `DOCMAP1_CLASSIFICATION.md`** under a dated "subdirectories" section
(do not renumber or re-verdict the 181). For `flows/`: the authority on a flow's *current* host and state is
`docs/os/FLOW-REGISTRY.yaml`, not the as-built doc — where they disagree, banner the doc and cite the registry
line. Ten `flows/`+`setup/` docs already carry a J13 banner; leave those banners, verdict the file.

## Unit B — the five count-only terms, per hit

DOCMAP2 counted these and read none: `SOS-direct` (18) · `CONTACTS_HUB` (13) · `owner-contact-websearch` (6) ·
`GOV_STATE_SIGNALS` (6) · `queue_v2_enabled` (7) · `exec_sql` (5). Per rule 1, **re-grep each by its concrete
symbol, case-insensitively, over every file type** before reading (`grep -ri`), and record the new count beside
DOCMAP2's. Then read every hit: CANDIDATE or DEFECT, with the refuting `CLAUDE.md` line or measurement.

- **`SOS-direct` is re-scoped, per DOCMAP2's own note:** it is not retired, it is *blocked* (`W9_1_SOS_DIRECT`
  off; residential-egress proxy mid-rollout, `CLAUDE.md` §25). The defect shape is "this doc says SOS-direct is
  ENABLED / scheduled / yielding rows", not "this doc mentions SOS-direct".
- **`GOV_STATE_SIGNALS`** (merged into `GOV_SIGNALS`, DRIFT1-routing-gap): the defect shape is a doc still
  asserting the OLD routing mechanism as live. Note that the repo-side fix is merged but the `intake-salesforce`
  edge fn is **not yet redeployed** — a doc saying "GOV_SIGNALS is live in production" is ALSO a defect today.
- **`CONTACTS_HUB`**: the trap is `govQuery` reading LCC Opps after the A9b cutover while writers still target
  gov (`CLAUDE.md` §Pointers, `contact_merge_queue` paragraph). A doc that says "the contacts hub is the gov
  project" is stale; one that names the split is current.
- Add at least these RENAMES to the list and sweep them the same way: `gov_merge_property` (→
  `gov_merge_property_apply`), `docs/os/architecture/` (the merged path — DOCMAP1 fixed 7 refs; confirm 0 now
  across all file types), `life-command-center-production.up.railway.app` (the dormant Railway service, I16b —
  count only, it is tracked in `FLOW-REGISTRY.yaml` deliberately).

## Unit C — Unit 1b proper: deep-read a NAMED set, chosen by consequence

**Enumerate first, then read, then state the count read.** The set (expect ~35–40 files; list them in the
response before reading):

1. The three repo-root files DOCMAP2 left unclassified: `BRIGGS-WRITING-VOICE.md` (is it referenced by path
   from prompt-assembly code? `grep -rn BRIGGS-WRITING-VOICE --include=*.js --include=*.mjs --include=*.ts
   --include=*.json --include=*.yaml`), `SPEC_forsale_om_and_webpage_ingest.md` (built? check against
   `docs/architecture/om_intake_pipeline.md` and `server.js` routes), `SPEC_sos_direct_scraper.md` (check against
   the live `W9_1_SOS_DIRECT` state).
2. Every file in `docs/setup/` and `docs/architecture/` (top level + subdirs) with `BUILD`, `PLAN`, `SPEC`,
   `ROADMAP`, `SETUP` or `CHECKLIST` in its name — these assert a procedure or a future.
3. Everything `CLAUDE.md` §"Pointers to canonical docs" cites by path that is NOT already CANONICAL-[deep-read]
   in `DOCMAP1_CLASSIFICATION.md`.

For each: **does this tell a reader to do something, or believe something, that is now false?** Cite the
refutation (a `CLAUDE.md` line, a registry line, a live measurement you can make without DB access — file
existence, route present in `server.js`, flag default in code). Banner in place. DOCMAP1's follow-up found 7 STALE
in ~90 files this way; **expect a comparable yield and state the count read.**

## Unit D — open the five directories DOCMAP2 never opened

`docs/setup/` (24) · `docs/os/canon/` (22) · `docs/copilot/` (6) · `docs/data-quality/` (2) · `docs/resolver/` (3).
Title+skim every file; deep-read anything that overlaps Unit C. **`docs/os/canon/` is special:** the blocks are
the single source for every AI surface and the rendered surfaces carry GENERATED headers. Verify a canon block's
claims; **never edit a GENERATED file**; if a canon block is stale, say so and stop — the fix is a canon edit +
`CANON_VERSION` bump + `render-surfaces.mjs` + surface paste, which is a separate, operator-paced unit.

---

## Out of scope — say so in the response, do not drift into it

- `docs/history/`, `docs/capital-markets/` (156), `docs/archive/`.
- `docs/claude-code/` (~230 non-`done/` files) — prompts and responses are dated by nature; a separate rule.
- Re-verdicting DOCMAP1's 87 remaining title+skim rows (except where a Unit B grep hits one — expected).
- **Any repoint of a JSON/zip artifact (J13a)** — those are importable flow/agent definitions; re-export the live
  flow, do not hand-edit. Operator work.
- The Vercel teardown (J13 👤), DRIFT1-retire, the `intake-salesforce` redeploy — operator items, carry forward.

## Deliverables

1. **Per unit: enumerated / read / defects / fixed — four numbers.** Never "files reviewed".
2. `DOCMAP1_CLASSIFICATION.md` extended with the 51 subdirectory rows (Unit A).
3. Per-term tables for Unit B with DOCMAP2's count and the case-insensitive recount side by side.
4. The named Unit C set, in the response, with a verdict per file.
5. **An explicit NOT REACHED boundary** in DOCMAP1's format — what was enumerated and not read is the most
   useful line in it.

## Verify on

- Defects fixed with the refuting citation each.
- Counts stated with their method (`grep -ri <symbol>` across all types; `find` recursive).
- **A term yielding many candidates and zero defects is a RESULT** — record it so DOCMAP4 does not re-grep it.
- Not on files touched.
