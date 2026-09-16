# INVENTORY1 — Pass 2: `docs/history/**` + `docs/claude-code/prompts/done/**` (2026-09-16)

**Companion to:** [`INVENTORY1_GAP_MAP_2026-09.md`](INVENTORY1_GAP_MAP_2026-09.md) (pass 1 — cross-link
back). Pass 1 covered `docs/architecture/**`, `docs/audits/**`, `docs/os/canon/**` and the four root
`SPEC_*.md` files (567 rows) and explicitly deferred the two sources below. This pass covers exactly
those two sources and appends to the same CSV, continuing the id sequence at `INV1-0568`.

## ⚠️ Method and honest scope limitation (read first — same discipline as pass 1)

**491 files (188 history + 303 prompts) were NOT individually hand-read at audit depth.** What was
actually done:

- **Scripted heading scan of all 188 `docs/history/**` files** for any `#`/`##`/`###` heading
  containing a round/unit/phase marker (same regex family as pass 1: `Phase N`, `Unit N`, `Stage N`,
  `Part N`, `Prompt N`, `P###`, `W#.#`, `B#`, `A#`, `C#`, `N##`, `OWN-T#`, `UX-T#`, `DOC#`, `OCR#`,
  `EXT#`, `BR#`, `PR#`, `GOVDUP#`, `GOVDEED#`, `SEC1*`, `MERGE1`, `XB#`, `R###`). This produced **926
  heading matches, 909 distinct after dedup**, across **94 of 188 files** (the other 94 files —
  mostly single-topic runbooks, flow docs, and short worklogs — carry no marker-bearing heading and
  were not otherwise opened). All 909 are appended to the CSV with `file:line` citations.
- **Scripted title extraction of all 303 `docs/claude-code/prompts/done/*.md` files** (the `# ` line
  of each file), one row per file, with the prompt number parsed from the filename prefix where
  present.
- **A scripted cross-reference pass** for every prompt: does its extracted round tag (e.g. `P187`,
  `ADDR1b`, `B6e-ci-red14`) OR the literal string `Prompt <N>` appear anywhere in
  `docs/architecture/**`, `docs/audits/**`, `docs/os/**`, or this repo's own `CLAUDE.md`? This is a
  **grep-level check, not a semantic one** — it says "some form of this identifier is quoted
  somewhere in the current canon," not "the work was verified as shipped." Full per-prompt result
  in the CSV (`prompt_ids` column carries the parsed prompt number; the leak-candidate list below
  names which failed the check).
- **A manual close-read of ~20 higher-signal files** to calibrate the scripted results and catch what
  a heading-only scan would miss: `docs/history/OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md`
  (a structured TODO table — the single highest-value find of this pass, see below),
  `docs/history/ROLLOUT_STATUS_waves_2026-08.md`, `docs/history/worklogs/AUDIT_PROGRESS_2026-05.md`,
  `docs/history/STATUS_claude-code_2026-09-12_to_09-14_tail10.md`, `docs/history/CLAUDE_full_2026-07.md`
  (spot-checked, not read start-to-end — it is 2,400+ lines), `docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`
  (spot-checked), and a sample of ~15 `prompts/done/` files whose titles read as consequential
  (`182-silent-disconnection-sweep.md`, `195-merge-byte-identical-owner-groups-2026-08-26.md`,
  `197-orphan-person-entities-2026-08-27.md`, `131-local-model-draft-dead-research-queues.md`, etc.).
- **A scripted forward-looking-language scan** over all 188 history files for `TODO`, `not yet
  built/implemented/wired/started`, `next step`, `plan to build/add/do/ship`, `we will build/add/
  need/do`, `not built`, `not implemented`, `follow-up (not`, `future work/enhancement`, `deferred
  to`, `left for (a) later/future` — **283 raw hits**, manually triaged to a representative subset
  (below), not all 283 individually adjudicated.

**Consequence, stated plainly:** this is a census, not a verification pass. Every new row is
`stated: unspecified` or `stated: shipped/live (filed under prompts/done/)` unless the heading or
title itself carries an explicit status word — exactly pass 1's convention. **No row from this pass
was promoted to a determined LIVE/DEAD state; that would require reading the referenced code, which
was not done.**

---

## Row counts added

| source | files scanned | rows added | id range |
|---|---:|---:|---|
| `docs/history/**` (marker-bearing headings, deduped) | 188 (94 contributed ≥1 heading) | 909 | INV1-0568 … INV1-1476 |
| `docs/claude-code/prompts/done/**` (one row per file) | 303 | 303 | INV1-1477 … INV1-1779 |
| **Total this pass** | 491 | **1,212** | INV1-0568 … INV1-1779 |

CSV total after this pass: **1,779 data rows** (567 from pass 1 + 1,212 from pass 2).

⚠️ **The `docs/history/**` count of 909 is a heading population, not a unique-capability count.**
History files are round-by-round narrative logs, so the same capability is frequently restated
across multiple archived STATUS spans and `CLAUDE_rounds_*`/`CLAUDE_full_*` files with a slightly
different heading each time (e.g. a P188/P194/P196 arc appears as three to five separate headings
across `docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md` alone — matching that file's own
"round narrative" structure). No de-duplication beyond exact title-string match was attempted;
treat the 909 as an upper bound on distinct capabilities mentioned in history, not a lower bound.

---

## Leak candidates found

### 1. Prompts that ran with NO trace anywhere in current canon — 132 of 303 (43.6%)

For 132 of the 303 files in `prompts/done/`, neither the round tag parsed from the filename/title
(when one exists) nor the literal string `Prompt <N>` appears anywhere in
`docs/architecture/**`, `docs/audits/**`, `docs/os/**`, or `CLAUDE.md`. This is the pass's single
largest leak signal by row count.

**Read this number with two corrections before treating it as "132 lost prompts":**

- **167 of the 303 files carry no extractable round tag at all** (plain descriptive filenames like
  `105-repo-line-ending-normalization.md`, `128-fix-stale-w8u3-conflict-card-test-grep.md`) — for
  those the check falls back to the bare `Prompt <N>` string, which is a weaker signal (a prompt
  whose fix later got folded into a doc without its number being restated will false-positive as
  "no trace" even though the underlying capability is documented under a different name).
- **8 of the 132 carry tags that read as cross-repo work** (`ADDR1b-merge`, `B6e-ci-openpyxl`,
  `B6e-ci-red14`, and similar) — this session's own system context shows these tags ARE referenced,
  but in the **Dialysis** and **government-lease** repos' `CLAUDE.md` files, not this repo's canon.
  `docs/claude-code/prompts/done/` in life-command-center is used for cross-repo Claude Code work
  (several prompt titles explicitly say `[DIALYSIS REPO]` or reference gov-only objects), so a
  no-trace-in-this-repo result for those 8 is expected, not a leak.

**That leaves ~124 genuinely LCC-scoped prompts with no discoverable trace in this repo's current
canon.** The full list of all 132 (including the 8 cross-repo ones, marked) is reproducible from
the CSV via `prompt_ids` + `stated_status_in_source` containing `LEAK CANDIDATE`; a representative
sample, sorted by filename:

```
118-overnight-cron-fixes-provenance-prune-and-owner-address-timeout.md
120-staged-move-drainer-app-moves-emails.md
121-staging-move-vs-flow6-ordering-hazard.md
122-cm-gov-packet-refresh-pgsleep-timeout.md
123-deal-email-matcher-cron-no-response.md
124-draft-assist-activation.md
125-draft-assist-retrieval-prefer-fullbody-and-recipient.md
128-fix-stale-w8u3-conflict-card-test-grep.md
130-clear-last-two-suite-failures.md
131-local-model-draft-dead-research-queues.md
132-research-view-dual-users-embed-collision.md
136-reachability-harvest-target-window-stall.md
137-clean-assist-provenance-ladder-not-wired.md
182-silent-disconnection-sweep.md
187-tier0-owner-domain-matching-2026-08-26.md
195-merge-byte-identical-owner-groups-2026-08-26.md
197-orphan-person-entities-2026-08-27.md
66-copilot-spec-v2-slim.md
67-add-comps-to-copilot-spec-v2.md
68-unify-comps-auth-with-copilot-passthrough.md
69-comps-oneshot-on-tranquil-delight.md
70-comps-oneshot-proxy-not-direct-db.md
71-instrument-comps-proxy-logging.md
78-pgrst204-schema-drift-writers.md
80-match-disambiguation-prerank-assist.md
81-zombie-flow-and-writer-collision-fixes.md
86-dialysis-fred-deploy-failure.md
91-empty-candidate-disambig-cards.md
92-sf-assist-cursor.md
95-fragment-name-misparse-extension.md
ACI-phase0.md
ACI-phase1-2.md
ACI-phase2-unitC.md
ADDR1-broker-office-address-minted-as-property.md
ADDR1a-two-bleed-rows-and-the-bare-buyer-header.md
BACKLOG-ids-collisions-and-restatements.md
BROKER1-prospect-assignment.md
... (full list of 132 reproducible from the CSV)
```

**Important qualifier, repeated because it matters:** *no trace of the tag/prompt-number string*
is not the same as *the work was lost or never shipped*. Several of these (`131`,
`132-research-view-dual-users-embed-collision`, `136-reachability-harvest-target-window-stall`,
`137-clean-assist-provenance-ladder-not-wired`, `182-silent-disconnection-sweep`,
`195-merge-byte-identical-owner-groups-2026-08-26`, `197-orphan-person-entities-2026-08-27`)
describe findings/fixes whose SUBSTANCE (not the exact prompt number) is very plausibly the same
finding narrated under a P-number in `CLAUDE.md`'s own P131/P132/P136/P137/P182/P195/P197 sections
— i.e. the prompt filename's descriptive slug and the round's canonical P-tag may simply not share
a literal string the grep could catch. **This pass did not do the per-prompt body-diff against
CLAUDE.md needed to confirm or refute that** — it is flagged as a leak *candidate*, meaning "worth
a human or a future pass checking by hand," not "confirmed lost work." The genuinely highest-
confidence leak candidates in this list are the ones with **no obvious P-tag sibling at all** in
CLAUDE.md's text — `66`–`95` (the low-numbered ones, mostly May–June 2026 Copilot-spec and
sf-assist micro-fixes) and the plain-slug `ACI-phase*`/`ADDR1*`/`BACKLOG-ids`/`BROKER1` files,
none of which this session found a clear current-canon echo for on a manual spot-check either.

### 2. Forward-looking statements in history logs never revisited

The scripted scan found **283 raw hits** for forward-looking language across the 188 files; not all
283 were individually adjudicated (see method note). The highest-value, manually confirmed finds:

- **`docs/history/OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md`** — a structured status table
  (Phases F/C/B/A, dated 2026-05-24) with **explicit `⬜ TODO` rows that were never marked done in
  that file and were not confidently traced to a later closure** on a spot-check of current docs:
  `C2` (sales writer refactor — contacts/lat-long), `C4` (owner-entity BEFORE INSERT trigger, gated
  on A1 which IS marked done), `C5` (`ownership_history` EXCLUDE constraint, gated on A6a),
  `C7` (SOS adapters TX/FL/CA/GA/NC — **note: a differently-scoped SOS-direct effort, FL/AZ, does
  appear live and gated in the government-lease CLAUDE.md as of this session's context, but that is
  not a 1:1 match to this file's 5-state C7 scope**), `C8` (RCM/LoopNet auth fix), `C9` (standard
  ingest TypeScript DTO contract), `B3` (deed-relink-tick — "small; tiny backlog left"), `B6`
  (propagate-recompute-tick), `B8` (Data Health dashboard tile in `ops.js`), `A6a` (chronological
  ownership-history closure across different owners — explicitly blocking `C5`), `A7` (owner→SF
  link backfill), `A8` (CoStar Contacts retroactive harvest, depends on `C2`), `A9` (unified_contacts
  consolidation — **this one DID ship**: the current `CLAUDE.md` `CONTACTS_HUB` / "A9b cutover"
  section confirms A9b landed and is live as of 2026-08-17, so A9 is NOT a leak — it is the one item
  on this table this pass could positively close).
  ⚠️ **These tags (A6–A9, B3–B8, C2–C9) are from May 2026 and are NOT the same A#/B#/C# tags used
  by later 2026-08/09 rounds documented elsewhere in this repo's canon** (letter+digit round tags
  are reused across time in this codebase's own convention — see pass 1's caveat about the same
  hazard). A grep for "C7" or "B6" alone returns dozens of unrelated hits from later rounds. **This
  pass did NOT attempt automated disambiguation of old vs. new same-named tags** — treat every TODO
  in this table as a dated hypothesis to re-test by hand (per this repo's own CLAUDE.md doctrine:
  *"a dated blocker is a hypothesis to re-test, never a fact"*), not a confirmed current gap. Filed
  here as the single most concrete "forward-looking statement never revisited" find of this pass
  precisely because it is a structured table, not prose — making it unusually easy to audit later.
- **`docs/history/worklogs/AUDIT_PROGRESS_2026-05.md`** — multiple explicit "Deferred to Phase B" /
  "Deferred to follow-up(s)" sections (lines ~612, ~736, ~781) and a named gap: *"Does NOT mirror
  the seed for non-sidebar contact creates (contacts-handler / Salesforce-sync paths) ... Deferred
  to a follow-up"* (line ~190). Not cross-checked against current `entity-identity-and-dedup.md` /
  `contact-reconciliation-outbound.md` coverage in this pass — flagged for a future pass.
- **`docs/history/ROLLOUT_STATUS_waves_2026-08.md`** — **Part C of the W10.3 full-body-ingestion
  item is explicitly scoped and explicitly NOT built**: *"a bounded/resumable PA 'Get email (V3) by
  message-id' backfill loop keyed on internet_message_id for the ~23K historical rows — recommended,
  forward-only-first, its own future unit."* This reads as a genuine, still-open, well-specified gap
  (the forward-only Part A/B did ship per the same entry) — worth checking whether
  `docs/architecture/contact-reconciliation-outbound.md` or a later prompt ever picked it up. Not
  confirmed either way this pass.
- Numerous smaller `⬜ TODO` / "not built" mentions in `CM_EXPORT_CHART_AUDIT_2026-06-22_RESPONSE.md`,
  `DEVELOPER_BD_AUDIT_v3.md`, and several `Claude_Code_Prompts_*.md` files were seen in the raw grep
  output but not individually opened and read in full — they are part of the 283 raw hits not
  triaged past the grep line itself.

### 3. New contradictions between history-log claims and current architecture docs

**None found with high confidence in this pass.** This is a genuine limitation, not a clean bill of
health: finding a real contradiction requires reading a specific history claim AND the current
architecture doc on the same topic side by side, which this pass's method (heading-title scan +
~20 manual close-reads) was not built to do at scale across 188 files. Two soft candidates,
explicitly flagged as unconfirmed:

- **`docs/history/CoStar_Ingestion_Audit_15002_Amargosa.md:113`** describes a specific code defect
  (`propagateToDomainDbDirect()` sets `recorded_owner_name` then deletes it two lines later, and it
  is "never re-populated" after `reconcilePropertyOwnership()` updates `recorded_owner_id`). This is
  a dated, address-specific bug report. Whether `sidebar-pipeline.js` still has this exact shape
  today was **not checked** (would require reading the live file, which is a code-not-docs check and
  out of this pass's read-only/docs-only scope per the brief). Filed as a candidate only.
- **The `docs/history/OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md` `C5` row** ("ownership_history
  EXCLUDE constraint... gated on A6a") implies a data-integrity constraint was never applied. The
  current `CLAUDE.md` documents extensive, much later (2026-08/09) ownership-history work (B5, B5a,
  B6b, gov sales-transition feeder, etc.) that touches the same table but never explicitly says
  whether the EXCLUDE constraint from this May TODO was ever added. Not confirmed as a live gap —
  filed as a re-test candidate, consistent with the "dated blocker" doctrine.

**Explicitly NOT filed as contradictions:** any case where a history file says something was
"broken/blocked/TODO" and this pass simply did not find a later fix mentioned — per the brief's own
caution and this repo's CLAUDE.md doctrine, absence of a found fix is not evidence the fix doesn't
exist; it is evidence this pass didn't find one, which is the leak-candidate framing above, not a
contradiction claim.

---

## What was NOT deep-read, stated plainly

- **~94 of 188 history files with no marker-bearing heading were not opened at all** (their content
  may still carry real intent statements in body prose with no matching heading — this scan is
  heading-only, same limitation pass 1 declared for architecture docs).
- **The 909 history heading titles were read; their BODY TEXT was not**, except for the ~20 files
  named in the method section above. A title like "Unit 3 — the orphan persons (the audit premise
  didn't hold)" is informative on its own (this repo's convention puts the verdict in the heading),
  but the supporting evidence/numbers behind each heading were not verified in this pass.
- **288 of 303 `prompts/done/` files had only their `# ` title line read** (not the body — the
  `Do` / `Grounding` / acceptance-criteria sections that make up the bulk of each spec). ~15 were
  read in fuller detail (listed in the method section).
- **The 283 raw forward-looking-language grep hits were not all individually triaged** — roughly 15
  were read in context; the rest remain as an unclassified pile the CSV does not enumerate row-by-row
  (unlike the heading census, which is fully represented in the CSV).
- **No code was read in this pass** (consistent with the brief's read-only, no-build prohibition) —
  every "no trace found" and "leak candidate" claim above is a documentation-corpus grep result, not
  a code-verified determination of whether a capability actually shipped.
- **The cross-reference check itself has a known false-negative mode**: a prompt's fix landing in
  code with no round-tag ever being restated in a doc will read as "no trace" even though the fix is
  real and live — this pass cannot distinguish "shipped, undocumented" from "never shipped" without
  a code read, which is why every leak-candidate claim above is phrased as "no trace in the docs
  corpus," never as "did not ship."

---

## Recommendation carried forward from pass 1, still true after this pass

Pass 1's closing recommendation — extend `feature_flags_registry` (or a sibling structured table)
to cover every named round/unit/prompt with a `state` column and a canonical-doc pointer — is
reinforced, not superseded, by this pass. **1,212 more rows** were added by grep, and the
cross-reference check above is exactly the kind of query a structured registry would answer in one
`SELECT` instead of a scripted corpus scan. The 132-prompt "no trace" list in particular would
collapse to a much smaller, much more reliable list the moment prompts are required to stamp a
round tag AND that tag is required to appear in one indexed place.
