# STATUS archive — Claude Code queue, 2026-09-11 (ID0 probe → PRI5 deploy)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-12, before pushing, to hold the 200+ lines of
headroom the CLAUDE.md doctrine requires (`test/status-line-budget.test.mjs`, budget 2,500). Nothing was reworded
or dropped. **One repair made before archiving:** the *"PRI5 merged and deployed"* entry appeared **twice** — two
sessions restating instead of amending, the same merge-race class now guarded for `PLANNED-BACKLOG.md` by
`test/backlog-id-uniqueness.test.mjs`. The truncated copy was dropped and the complete one kept; no fact was lost.
Every still-open item named below is tracked in `docs/os/PLANNED-BACKLOG.md`, the canonical open-work list.

Covers 5 entries, from *2026-09-11 -- Correction: OWN-T0h's "conflict count doubled to 4,478" was my own coun* to *2026-09-11 — PRI5 merged and deployed; recommended another live CMS test run*.

---

## 2026-09-11 -- Correction: OWN-T0h's "conflict count doubled to 4,478" was my own counting bug

Caught and fixed my own error from the OWN-T0h entry earlier today. That entry re-measured the
reconciled store's conflict count with `count(*)` and reported it had more than doubled since the
2026-09-02 audit (2,097 -> 4,478). That number was wrong: `count(*)` on
`v_lcc_property_ownership_reconciled` counts owner-CANDIDATE ROWS, not properties -- and every
conflict property carries >=2 rows by construction (that's what makes it a conflict), so `count(*)`
systematically inflates the property count.

Re-ran it correctly as `count(distinct (source_domain, source_property_id))`:
**2,065 conflict properties today (gov 1,752 / dia 313) -- essentially flat vs. the audit's 2,097**
(gov 1,769 / dia 328). The small drop is fully explained by OWN-T0e's confirm lane, which has been
converting `unclassified_rival` pairs into `sponsor_family_confirmed` (1,617->1,508 rival, 64->142
confirmed) plus a handful of merges (`duplicate_entity` 417->415). No mystery growth, no root-cause
follow-up needed -- retracting that flag entirely.

I'd already written the false "doubled" claim into three docs (`PLANNED-BACKLOG.md`'s OWN-T0h row,
`ownership-history-lane.md`, `CURRENT-STATE.md`) and told Scott directly. All three are corrected in
this commit, and this entry says so plainly rather than quietly overwriting the earlier claim.
Lesson for this lane going forward: always `count(distinct property)` on
`v_lcc_property_ownership_reconciled`, never `count(*)` -- the row/property distinction is easy to
miss because most other counts in this codebase (fact ledger rows, task rows) ARE the thing being
measured.

## 2026-09-11 — ID0: identity/value-domain probe across dia + gov — the operator split is a class, not an incident; ID4 drafted

Scott (after sending ID1): *"protection and cleaning code in place so we aren't operating a database with divergent
naming and connections… one intelligent and reconciled source of truth for all properties."* Cowork ran a read-only
probe on both domain DBs: for every identity/grouping-like text column, raw distinct vs normalized distinct (case,
punctuation, corporate suffix). Findings: `docs/audits/ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md`. Worst:
**gov agency** (SSA split 4+ ways, VA 5+, ~3,300 properties; `RICHMOND FIELD OFFICE (VA)` ambiguous); **gov owners**
(`true_owners` 1,278 collapsible names + 81 identical-canonical groups; `recorded_owners` 1,241 / 115); **gov county**
(832 county/state pairs split by case); **dia guarantor** (DaVita/Fresenius legal entities split; subsidiaries must link,
not merge); **dia brokers** (116 identical-normalized groups). New invariants **I13 identity, I14 controlled
vocabularies, I15 import completeness** in `data-coherence-invariants.md` (detector table updated). Backlog §P0d:
ID3 → ID3a–f, plus **ID4** (standing detectors + shared resolver framework). Probe gotcha recorded: Postgres regex ``
is backspace; use `\y`. **Next:** ID1 is running; send `prompts/ID4-identity-integrity-program.md` after ID1 is reconciled.

## 2026-09-11 — Doctrine: truth is fixed at its source of record; operator-identity audit (ID1) queued ahead of MB-b

Scott, on the MB1e operator-name split: *"for any of these factual errors, we want to track the source to ensure that the
truth persists in all places, not just a patch… include a deeper review to ensure that there are not greater problems
underlying these naming and sorting issues."* Added as the first **Core doctrine in `CLAUDE.md`** (trace to the
source of record and every writer, fix with provenance, guard writers, move consumers to canonical ids, look one level
deeper). Cowork's read-only probe of Dialysis_DB confirms a **systemic identity defect**: the comps engine groups on
free-text `properties.operator` (no FK, 45 variants); the `operators` registry has duplicates (USRC ×3, DCI ×2, DaVita ×5)
plus categories and non-operators; `operator-normalize.js` and the registry disagree on the canonical Fresenius name;
FK coverage is partial (leases 30%); 979 clinics have no chain and no operator and drop out of every count. Backlog §P0d
gains **ID1** (audit, prompt drafted), **ID2** (build), and **ID3** (sibling sweep, linked to PDR2/OWN4/B6d-cms). MB1e item 1
re-scoped to ID; MB-b §0.1 now consumes `operator_id` (per-operator bands withheld as a named gap until ID2); spec design
rule 5. **Next:** send `prompts/ID1-operator-identity-source-of-record-audit.md`.

## 2026-09-11 -- OWN-T0h decided: reconciled store is canonical conflict count; found it doubled since 09-02

Picked up OWN-T0h next (the "756 vs 2,097 conflict denominators" question CURRENT-STATE.md had been
flagging as open since OWN-T0). Read both view definitions in full: `v_lcc_property_multi_current`
only checks whether `lcc_entity_portfolio_facts` disagrees with itself (>1 distinct current-survivor
entity on one property); `v_lcc_property_ownership_reconciled` additionally admits the resolver's
`lcc_property_owner` proposal and the domain true_owner mirror as competing current-owner candidates
-- which is what the property panel and Decision Center actually read, per OWN-T0's own "one door"
doctrine. **Decision: the reconciled store's count is canonical**, not `multi_current`'s -- they
answer different questions (data-hygiene-within-one-table vs. genuine cross-source ownership
disagreement), and the original audit had already said as much in its own §9.6 without finishing the
thought.

Re-measuring live to write the decision down surfaced something bigger than the original question:
the reconciled conflict count has **more than doubled since the 2026-09-02 audit -- 2,097 -> 4,478**
(gov 1,769->3,635, dia 328->843; by class: `unclassified_rival` 3,229, `duplicate_entity` 942,
`sponsor_family_confirmed` 307), confirmed stable on a second read minutes later. `multi_current`
itself barely moved (756->740, expected drift -- nothing end-dates those facts). Fleet size is flat
(8,068->8,070 current properties), so the growth isn't more properties -- it's more competing
current-owner-candidate claims landing on an unchanged fact ledger (more `lcc_property_owner`
resolver rows and/or `lcc_property_owner_facts` domain-mirror rows). **Did not investigate why** --
flagged plainly in all three docs so nobody quotes 4,478 as settled, and left as a named follow-up
rather than guessing at a cause I hadn't verified.

Updated `docs/os/PLANNED-BACKLOG.md` (OWN-T0h closed, decided + re-measured),
`docs/architecture/ownership-history-lane.md` § OWN-T0 (canonical page, replaced the stale
2,097/756 callouts with the decision and the live re-measurement), and `docs/os/CURRENT-STATE.md`'s
OWN-T0 row (same).

## 2026-09-11 — PRI5 merged and deployed; recommended another live CMS test run

Scott confirmed `Dialysis` PR `#7408` merged. `PLANNED-BACKLOG.md`'s `PRI5` row moved to ✅. Recommended
triggering another CMS ingestion run to verify live: does `ingestion_tracker`'s `reclaim_stale_started_runs()`
actually run and does a fresh run's own row close correctly this time; and does `census_demographics`
now either succeed or fail with an honest, recorded `run_status='failure'` instead of orphaning a
snapshot row. Every fix in this arc so far has been proven or caught out by an actual run, not by tests
alone — same discipline applies here.

> **📦 ARCHIVE (2026-09-12, sixth span):** the three 2026-09-11 entries (**MB-a3 reconciled**,
> **B1b graded**, **MB-a3 freshness-honest**) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_mba3_to_mba3.md`](../history/STATUS_claude-code_2026-09-11_mba3_to_mba3.md).
> Archived BEFORE pushing, per the convention block above. Nothing was dropped.


> **📦 ARCHIVE (2026-09-12, seventh span):** the **ID1/ID2/ID3 reconcile → ID0 identity probe** run of
> 2026-09-11 entries (the ID0–ID4 identity/operator-registry arc, OWN-T0h's corrected count, OWN-T0i) was moved
> **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_id1_to_id0.md`](../history/STATUS_claude-code_2026-09-11_id1_to_id0.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.


> **📦 ARCHIVE (2026-09-12, eighth span):** the tail of the 2026-09-11/12 run was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_12_tail.md`](../history/STATUS_claude-code_2026-09-11_12_tail.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
