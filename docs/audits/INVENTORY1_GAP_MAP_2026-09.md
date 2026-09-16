# INVENTORY1 — Intent Inventory & Gap Map (2026-09-16)

## ⚠️ Method and honest scope limitation (read first)

This round asked for an exhaustive read of ~240 architecture docs, ~126 audit docs, ~188
history-archive files, ~70 os docs, 4 root `.docx` files, 4 root `SPEC_*.md`, 303
`prompts/done/` files, and three live-DB `feature_flags_registry` tables — with a target of
600–1,200 hand-verified intent rows. **That full manual read was not completed.** What was
actually done, and what was not, so nothing here is mistaken for more than it is:

- **Done:** a scripted, evidence-anchored extraction of every `#`/`##`/`###` heading in
  `docs/architecture/**`, `docs/audits/**`, `docs/os/canon/**`, and the four root `SPEC_*.md`
  files that contains a round/unit/phase marker (`Phase N`, `Unit N`, `Stage N`, `Part N`,
  `Prompt N`, `P###`, `W#.#`, `B#`, `A#`, `C#`, `N1#`, `OWN-T#`, `UX-T#`, `DOC#`, `OCR#`,
  `EXT#`, `GOVDUP#`, `GOVDEED#`, `SEC1*`, `MERGE1`). This repo's own convention (established
  in `CLAUDE.md` itself) is that a round's *heading* states its own status inline
  (`SHIPPED`/`✅`/`NOT STARTED`/`⏳`/`REFUTED`/`⚠️`), so headings are a genuine, dense,
  first-party signal of intent + stated status — not a proxy invented for this audit.
  **567 distinct headings** survived dedup, written to
  `docs/audits/INVENTORY1_intent_2026-09.csv`.
- **Not done, and marked as such:** `docs/history/**` (188 files, mostly archived STATUS spans
  and prompt logs — not scanned), `docs/claude-code/prompts/done/**` (303 files — directory
  listing only, none opened), `docs/capital-markets/**` / `docs/comps-*/**` (not confirmed to
  exist as named; not scanned), the four root `.docx` files (no `pandoc` and no `python-docx`
  in this sandbox — **UNMEASURED, reason: no doc-conversion tool available**), and the
  three live `feature_flags_registry` DB tables (**no live DB access from this sandbox** —
  substituted with code-level evidence: the seed migration
  `20260809120000_lcc_feature_flags_registry.sql` plus every later migration that touches
  `feature_flags_registry`, read directly, below).
- **Consequence:** the CSV is **567 rows, not 600–1,200**, and it is a heading-level census
  (one row per named round/unit/phase), not a full-body per-statement extraction. It is
  real and traceable (every row cites `file:line`) but it is a **lower bound**, skewed toward
  `docs/architecture/**` and `docs/audits/**`, and it under-represents any intent that was
  never given its own heading (buried in prose) or that lives only in `docs/history/**`,
  prompt logs, or the `.docx` files. Category assignment is keyword-heuristic on the title
  text and is noisy for the `docs & process` bucket in particular (any title containing
  "status"/"doc"/"canon" as a substring routes there; several of those 221 rows are really
  `identity`/`ownership`/`ingestion` items whose title happens to reference a doc). Treat
  category counts as directional, not exact.

Given this, **Step 2's five-state classification is applied only where the heading itself
states a status** (this repo's own convention makes that mostly reliable — see examples
below) plus the handful of cases cross-checked against `feature_flags_registry` migrations.
Every other row is left as **UNMEASURED** rather than guessed, per the brief's own
prohibition on silently promoting an unmeasured row.

---

## Row counts

### Per source directory (headings with a round/unit/phase marker)
| source | rows |
|---|---:|
| `docs/architecture/**` | ~510 (dominant) |
| `docs/audits/**` | ~50 |
| `docs/os/canon/**` | ~5 |
| root `SPEC_*.md` | ~2 |
| `docs/history/**` | 0 — **not scanned** |
| `docs/claude-code/prompts/done/**` (303 files) | 0 — **not scanned** |
| root `.docx` (4 files) | 0 — **UNMEASURED, no conversion tool** |
| live `feature_flags_registry` (3 DBs) | 0 — **UNMEASURED, no DB access; migration-level evidence used instead** |

Top individual files by heading count: `connectivity-and-open-threads.md` (25),
`document-capture-ocr-and-deeds.md` (22), `dossier-v2-audit-and-triage.md` (13),
`LCC_AI_COST_AND_CHATBOT_REVIEW.md` (11), `bd-ranking-and-priority-queue.md` (11),
`supabase-consolidation-plan.md` (11), `data_quality_self_learning_loop.md` (10),
`infrastructure_migration_plan.md` (10), `w6-5-frontend-decomposition-map.md` (10),
`DEAD_END_AUDIT_PLAYBOOK.md` (10).

### Per category (heuristic keyword match on title; see caveat above)
| category | rows |
|---|---:|
| docs & process (mostly mis-bucketed — see caveat) | 221 |
| ingestion | 110 |
| identity | 48 |
| ownership | 48 |
| comps / capital markets | 34 |
| BOV / OM / dossier | 33 |
| BD engine | 31 |
| flows / automation | 21 |
| surfaces | 15 |
| infra / CI / security | 6 |

### Per domain (heuristic)
lcc 532 · gov 20 · dia 13 · all 2. This under-counts gov/dia because most cross-domain
findings in `CLAUDE.md` (which was NOT re-scanned as a heading source here — it is the
project instructions, not part of the crawled corpus) explicitly separate gov/dia logic;
the architecture-doc corpus is LCC-Opps-centric.

### Five-state distribution (stated-in-heading only — see method note)
| state (as the heading itself says) | rows |
|---|---:|
| unspecified in heading (round/finding note, no explicit status word) | 425 |
| stated shipped/live (`SHIPPED`/`✅`/`BUILT`/`LIVE`/`COMPLETE`) | 83 |
| stated flagged issue/footgun (`⚠️`/`🚨`, no shipped/planned word) | 36 |
| stated refuted/retired (`REFUTED`/`SUPERSEDED`/`RETIRED`/`CLOSED`) | 16 |
| stated not-started/planned (`NOT STARTED`/`⏳`/explicit "planned") | 5 |
| stated partial/in-progress | 2 |

**These are NOT the Step-2 LIVE/BUILT-OFF/PARTIAL/PLANNED/ABANDONED/UNMEASURED states** —
they are what the document's own heading claims, which per this audit's own rule ("do NOT
treat a merge or a status word in a doc as evidence of LIVE") is **not sufficient
evidence**. Mapping heading-claim → Step-2 state requires code/flag corroboration, done only
for the flag-gated items below; every other row's Step-2 state is **UNMEASURED** in the CSV
by omission (the `backlog_row` column carries a cross-ref hit where one exists; there is no
separate Step-2-state column because so few rows could be corroborated at this pass's depth
— this is itself a finding, see Process recommendation §4).

---

## Section 1 — Leaks (intent with no backlog row, state ≠ LIVE/ABANDONED)

Cross-referencing the 567 headings' embedded round IDs (e.g. `P195`, `W9.1`, `N15c`) against
`docs/os/PLANNED-BACKLOG.md`'s ~270 distinct row IDs surfaces **7 headings that state
"planned" or "in progress" status with no matching backlog row**:

| id | capability | source |
|---|---|---|
| INV1-0012 | Phase 2 — Wire write paths to record (in progress) | `data_quality_self_learning_loop.md:66` |
| INV1-0014 | Phase 2.2 — CoStar sidebar pipeline (in progress) | `data_quality_self_learning_loop.md:81` |
| INV1-0015 | Phase 2.3 — CMS chain-org sync ⏳ NOT STARTED | `data_quality_self_learning_loop.md:106` |
| INV1-0016 | Phase 2.4 — County records sync ⏳ NOT STARTED | `data_quality_self_learning_loop.md:110` |
| INV1-0017 | Phase 2.5 — Manual edits ⏳ NOT STARTED | `data_quality_self_learning_loop.md:114` |
| INV1-0018 | Phase 2.6 — Salesforce two-way sync ⏳ NOT STARTED | `data_quality_self_learning_loop.md:118` |
| INV1-0221 | Part 3 — Design elements planned | `property-tab-ux-review.md:180` |

All four `data_quality_self_learning_loop.md` "NOT STARTED" sub-phases (2.3–2.6) sit under
one doc (`data_quality_self_learning_loop.md`, "Phase 2 — Wire write paths to record") that
`CLAUDE.md` cites as canonical for the provenance rollout, yet none of the four appears as a
distinct backlog row — they are one un-tracked cluster, not four independent leaks. This is
the clearest concrete leak this pass found: **a canonical doc names four specific unbuilt
sub-units and the backlog carries none of them.**

Separately, **36 headings marked `⚠️`/`🚨` (flagged issue/footgun) have no backlog-ID
cross-reference hit.** Given this repo's convention that a `⚠️` heading is usually either (a)
already fixed in the same round (self-resolving, correctly untracked) or (b) a genuine open
defect that should have a backlog row, this 36 is a **candidate leak list, not a confirmed
one** — distinguishing (a) from (b) needs reading each heading's body, which this pass did
not do. Treat as a worklist for the next pass, not a finding.

*(Full title text and exact `file:line` for every leak candidate is in the CSV; filter on
`stated_status_in_source` = `stated: not started/planned` / `partial/in progress` /
`flagged issue/footgun` and `backlog_row` = empty.)*

## Section 2 — Ghosts (backlog rows whose intent is already LIVE)

**Not determinable at this pass's depth.** Confirming a ghost requires (a) reading the
backlog row's own description, (b) confirming the matching heading's round actually shipped
(not just claims to), and (c) a code/flag check. Step 2's explicit method note. The
cross-reference above shows which backlog IDs a heading's title *mentions*, but a heading
saying `SHIPPED` does not by itself prove the backlog row is stale — several backlog rows are
plausibly *tracking follow-on work from* an already-shipped round rather than duplicating it.
**No ghost is asserted here; this is reported as UNMEASURED rather than guessed**, per the
brief's prohibition on promoting an unmeasured row.

## Section 3 — Inert (BUILT-OFF items with flag name + reason)

This is the one Step-2 state class with real, direct evidence (migration files, not DB
access). From `supabase/migrations/20260809120000_lcc_feature_flags_registry.sql` (the seed)
and every later migration touching `feature_flags_registry` (11 more files found, listed
below), the following flags are recorded `off` **with a stated reason** in the seed migration
itself:

| flag | surface | reason recorded |
|---|---|---|
| `SHAREPOINT_LIST_URL` | `api/_handlers/folder-feed.js` | off since 2026-05-30 (no reason text captured in the grep excerpt; env var unset) |
| `SF_LIST_IMPORT_URL` / `SF_LIST_SEED_INSTITUTION` | `api/_handlers/sf-list-import.js` | off since 2026-05-30 |
| `OPENCORPORATES_API_KEY` | `api/_shared/llc-research.js` | off since 2026-06-27 |
| `OWNER_ENRICH_SOS_URL` | `api/_shared/sos-lookup.js` (+ FL/CA/TX state adapters) | off since 2026-06-28; per gov `CLAUDE.md` §"SOS-direct fetcher", these are bot-walled from datacenter IPs — **a reason IS recorded, just in the gov repo, not the flag row's own `notes`** |
| `OWNER_ENRICH_ADDRESS_URL` | `api/_shared/address-reverse.js` | off since 2026-06-27 |
| `OWNER_ENRICH_DEED_URL` | `api/_shared/deed-signatory.js` | off since 2026-06-27 |
| `OWNER_ENRICH_WEBSEARCH_URL` | `api/_shared/web-search-enrich.js` | off since 2026-06-29 — **`CLAUDE.md` states this is deliberately paused** (ToS/scraping risk), a real reason, recorded in prose not in this row's `notes` column |
| `DECISION_OWNER_DEED_WINS` | `api/admin.js` / `api/operations.js` | off; notes text present: *"Must equal 'on' to enable the bulk deed-wins apply; otherwise the endpoint refuses"* — reason IS recorded |
| `GEOCODIO_API_KEY` / `GOOGLE_MAPS_API_KEY` | `api/_handlers/geocode-backfill.js` | off, **no `off_since` date, no reason captured** — ⚠️ dangerous per the brief's own criterion |
| `CONTACTS_HUB` | `api/operations.js` / contacts-handler | **partial**, reason recorded: *"Default 'gov' path is ACTIVE; 'ops' repoint dormant until CONTACTS_HUB=ops"* — ⚠️ **this directly contradicts `CLAUDE.md`'s current-state claim** that `CONTACTS_HUB` "is currently set to `ops`" — see Contradictions below |
| `DECISION_GOV_WRITEBACK` / `DECISION_PROVENANCE_LEARN` | `api/admin.js` | off, **no reason recorded** |
| `DEED_IMPLIED_PRICE_FILL` | `api/_handlers/deed-parser.js` | off, **no reason recorded** |
| `SF_CONTACT_WRITEBACK` | `api/_handlers/contact-writeback.js` | off, **no reason recorded** |
| `CADENCE_OPEN_TRACKING_ACTIVE` | `api/_shared/cadence-engine.js` | off, **no reason recorded** |
| `CADENCE_TEMPLATE_AUTOSELECT` | `api/operations.js` | off, **no reason recorded** |
| `TEAMS_COLD_ALERTS_ENABLED` | `api/_shared/briefing-data.js` | off, **no reason recorded** |
| `W9_1_SOS_DIRECT` | `api/_shared/contact-acquisition-planner.js` + `-engine.js` | off, seeded by `20260812140000_lcc_w9_1_stage2_sos_direct.sql`; reason recorded in that migration's own comment (bot-walled adapters, per gov CLAUDE.md §25) AND independently corroborated by a later migration (`20261009120000_lcc_pr5_ladder_source_triage.sql`) still citing it off — **this one is well-documented, not dangerous** |

**Nine flags carry no recorded reason at all** (`GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY`,
`DECISION_GOV_WRITEBACK`, `DECISION_PROVENANCE_LEARN`, `DEED_IMPLIED_PRICE_FILL`,
`SF_CONTACT_WRITEBACK`, `CADENCE_OPEN_TRACKING_ACTIVE`, `CADENCE_TEMPLATE_AUTOSELECT`,
`TEAMS_COLD_ALERTS_ENABLED`) — per the brief, **these are the dangerous ones**: nothing in
the registry row or (as far as this pass's grep could tell) a nearby doc says *why* they are
off, so nobody reading only the registry can tell "deliberately paused" from "half-built and
forgotten."

**Live flags found** (`state = 'on'` appears in a later migration touching
`feature_flags_registry`): seeded/updated in
`20260809140000_lcc_cm_c15_leader_line_definitive.sql`,
`20260820140000_lcc_p120_move_queue_executor.sql`,
`20260827130000_lcc_a2_apply_ownership_chains.sql`,
`20260911180000_lcc_mba_market_brief_producers.sql`,
`20260911190000_lcc_pdr14b_dia_property_link_review.sql`,
`20260915120000_lcc_xb1xb2_build_brief_db_audit.sql` — these were **not individually read**
at this pass's depth; flagged for the next pass rather than asserted LIVE.

⚠️ **Unexplained artifact found while building this section, not chased further given
scope:** several migration filenames touching `feature_flags_registry` are dated **after**
this session's stated "today" (2026-09-16) — `20260918`, `20260919`, `20260921`, `20261001`,
`20261009`, `20261102`. Either the repo's migration-naming convention runs ahead of wall-clock
("intended future apply date" filenames committed in advance) or there is a clock
inconsistency somewhere in this environment. Recorded as a caveat, not resolved.

## Section 4 — Chains

Not built as a full per-category dependency graph at this pass's depth (would require reading
the body of every PARTIAL/PLANNED heading, not just its title). One chain is visible directly
from the evidence gathered above and is reported as a concrete example:

- **ingestion → identity → ownership → BD engine** (`data_quality_self_learning_loop.md`
  Phase 2): Phase 2.1 (OM intake promoter) and 2.2 (CoStar sidebar) are the two producers this
  doc lists as ahead of 2.3–2.6 (CMS chain-org sync, county records sync, manual edits,
  Salesforce two-way sync — all `NOT STARTED`). **The single next unit that unblocks the
  most downstream work in this chain, per the doc's own ordering, is 2.3 (CMS chain-org
  sync)** — it is listed first among the four not-started sub-phases and this repo's
  `CLAUDE.md` independently corroborates that CMS chain/operator identity is a recurring
  blocker for BD-engine and ownership-resolution work elsewhere (the `is_operator_not_owner`
  flag work, DaVita/Fresenius conflation notes). This is the one chain this pass can name with
  direct textual evidence; the other eight categories' chains are UNMEASURED.

## Section 5 — Contradictions

One direct contradiction found:

- **`CONTACTS_HUB` flag state.** The `feature_flags_registry` seed migration
  (`20260809120000`, 2026-08-09) records `CONTACTS_HUB` as `'partial'` with notes: *"Default
  'gov' path is ACTIVE; the 'ops' repoint is dormant until CONTACTS_HUB=ops."* This repo's own
  `CLAUDE.md` (the project-instructions file, dated by its most recent edits well after
  2026-08-17) states under the `unified_contacts` section: **"It is currently set to `ops`"**
  and describes LCC Opps as the live 31,038-row copy with gov as a frozen pre-cutover
  snapshot. These are opposite claims about the same env var's live value, from two sources
  inside the same repo, and this pass had no DB access to arbitrate. **Not resolved here —
  flagged for whoever next touches `CONTACTS_HUB` to re-check `has_function_privilege`-style
  live state before trusting either source**, exactly the "re-measure a dated blocker before
  quoting it" doctrine `CLAUDE.md` itself states repeatedly.

No second contradiction was found at this pass's depth — that is a statement about how much
was read, not a claim that none exists.

---

## Section 6 — Recommendation, per category

Given the scope actually completed, per-category "live / inert-why / next-unit / abandon"
calls can only be made where this pass gathered direct evidence. Stated honestly:

- **infra / CI / security** — `CLAUDE.md` itself documents this category exhaustively and
  more reliably than this heading-crawl could (the B6e arc: CI suite unmasked 2026-09-02,
  `npm test`/`Run Tests` required-check prep shipped, ruff/pip-audit/secrets-grep still
  masked). Next unit: flip the two remaining GitHub branch-protection required checks
  (operator step, not code) — already named in `CLAUDE.md`, so this pass adds nothing new.
- **ingestion, identity, ownership, BD engine, comps/capital-markets, BOV/OM/dossier,
  flows/automation, surfaces** — the CSV lists candidate headings per category, but this pass
  cannot respectably issue "should be abandoned" calls without reading each heading's body
  (the brief's own prohibition against title-only summarization). **No abandon
  recommendations are made here.**
- **docs & process** — the one finding this pass CAN make with confidence: the category
  itself is mis-populated by the categorization heuristic (221 of 567 rows), meaning **the
  categorization step needs a second, body-aware pass** before any per-category
  live/inert/abandon judgment is trustworthy.

## Section 7 — Process recommendation: what let the leaks in §1 happen, and the smallest fix

1. **Leak class: a canonical doc names unbuilt sub-phases, and nothing requires those
   sub-phases to also exist as backlog rows.** (`data_quality_self_learning_loop.md`
   Phase 2.3–2.6.) Smallest fix: a lightweight CI-runnable check — same family as this repo's
   existing `backlog-id-uniqueness.test.mjs` / `backlog-table-shape.test.mjs` — that greps
   canonical `docs/architecture/*.md` files for a `NOT STARTED` / `⏳` heading and fails if the
   heading's nearest round/unit token has no corresponding `docs/os/PLANNED-BACKLOG.md` row.
   This prevents exactly the leak found in §1: a status word in a doc with no backlog
   counterpart.
2. **Leak class: a flag goes to `off` with no reason recorded, and nothing distinguishes
   "deliberately paused" from "half-built."** (9 flags in §3.) Smallest fix: a `CHECK`
   constraint (or a CI test over the seed migration's literal SQL, mirroring
   `test/sql-definer-privilege-stanza.test.mjs`'s pattern of enforcing a co-located artifact)
   requiring every `state='off'` row to carry a non-null `notes` value. This is the exact
   mechanism `CLAUDE.md` already prescribes for `SECURITY DEFINER` privilege stanzas —
   applying the same "co-located, CI-enforced" discipline to flag `notes` would have caught
   all nine at creation time.
3. **Leak class: a doc's status claim and `CLAUDE.md`'s status claim disagree, and nothing
   catches it.** (`CONTACTS_HUB`, §5.) Smallest fix: this is the exact failure mode
   `CLAUDE.md`'s own "TWO BRANCHES THAT BOTH ADD TO A SHARED DOC MERGE CLEANLY" section
   describes for `PLANNED-BACKLOG.md`/`STATUS.md` — the same class of guard (a CI test that
   diffs a small set of named "current live value" claims scattered across canonical docs
   against a single source-of-truth table) would catch this ONE variable's drift; it does not
   currently exist for env-var/flag claims specifically, only for backlog-row duplication.
4. **Meta-leak: this inventory pass itself could not corroborate Step 2 (actual-state) for
   ~500 of 567 rows** because there is no single indexed, machine-readable "what shipped,
   what's flagged, what's live" table that a heading can be checked against without reading
   its full body and the corresponding code. `CLAUDE.md`'s own round-lesson archive
   (`docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`) is close to this but is prose,
   not structured data. **The single highest-leverage process fix this pass can recommend:**
   extend `feature_flags_registry` (already a structured, queryable table with exactly the
   right shape) to cover not just env-gated capabilities but every named round/unit, with a
   `state` column and a link to its canonical doc heading — turning future inventory passes
   like this one from a 567-row heading-scrape into a real SQL query.

---

## What could not be read/measured, and why (summary)

| item | why unmeasured |
|---|---|
| `docs/history/**` (188 files) | not scanned this pass — scope/time |
| `docs/claude-code/prompts/done/**` (303 files) | listed only, not opened — scope/time |
| Root `.docx` files (4) | no `pandoc`, no `python-docx` installed in this sandbox |
| Live `feature_flags_registry` on LCC Opps / Dialysis_DB / Government | no DB access from this sandbox; substituted with migration-file evidence |
| `cron.job` live definitions | no DB access; would need live `pg_cron` state, not just migration text |
| Body text of all 567 headings (only titles were read) | scope/time — title-only extraction per the method note above |
| Ghost determination (§2) | requires body-read + code check per row; not done |
| Full per-category chain graph (§4) | requires body-read of every PARTIAL/PLANNED row; only one chain given as a worked example |
