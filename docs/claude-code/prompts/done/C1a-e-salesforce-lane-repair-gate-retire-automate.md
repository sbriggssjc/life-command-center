# Prompt C1a–e — execute C1's own diagnosis: repair the mirror, gate, retire, automate, ladder

> **Automation/data-process audit window.**
> **Read first:** `docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md` (the diagnosis
> this prompt executes), `PLANNED-BACKLOG.md` rows **C1, C1a, C1b, C1c, C1d, C1e**, and the
> Consumption-Layer doctrine + deploy-ordering rule in `CLAUDE.md` ("additive schema before writer
> deploy").
>
> **This is EXECUTION, not diagnosis.** C1 already answered the question this arc exists to ask
> (*build a consumer or retire the lane?* → retirement, because a working consumer already exists
> elsewhere). The five units below are C1's own fully-specified follow-ups (§4b, §5, §7, §8) and
> nothing here should require new investigation beyond confirming C1's numbers still hold.

---

## 0. Re-measure before touching anything

C1 is dated 2026-08-27; today is well past this repo's own "re-measure a dated blocker before
quoting it" threshold. Before executing any unit, confirm on live data:

- `select count(*) from dia_research_tasks where research_type='true_owner_needs_salesforce' and status='queued'` (C1 read 837)
- the gov equivalent for `owner_needs_salesforce` (C1 read 108 open / 1,675 admitted by the value gate)
- `select count(*) from gov.recorded_owners where sf_account_id is not null` (C1 read 1,961)
- `select count(*) from gov.unified_contacts where sf_account_id is not null` (C1 read 1,407, of which 1,292 disagreed with the recorded_owners value)

**If any figure has moved materially, say so and adjust the unit's population before acting** —
don't silently execute against stale numbers.

## 1. Unit C1a — repair the gov mirror FIRST (resizes both lanes)

The `sf_link_candidate` verdict path (`api/admin.js:10764`) writes `gov.recorded_owners.sf_account_id`.
The research-task lane's predicate reads `gov.unified_contacts.sf_account_id`. **Nothing mirrors one
to the other**, so a human who successfully links a gov owner through the Decision Center does not
clear the research task — it stays open and is re-minted forever.

- Measured (re-verify per §0): **1,961 linked owners → 1,407 have a `unified_contacts` row → 1,292
  of those still read NULL → only 29 agree.** **96 of the 1,675 gov rows admitted by the value gate
  ($314.7M) are already-done work wearing an open badge.**
- **Fix by repointing the research-task predicate to `recorded_owners.sf_account_id`** (preferred —
  one column, one source of truth, no second store to drift) rather than teaching the verdict path
  to write both columns. Confirm nothing ELSE reads `unified_contacts.sf_account_id` as authoritative
  before repointing (grep it) — if something does, dual-write instead and say why.
- **This must land and be verified BEFORE C1b/C1c run** — gating/retiring against the old (wrong)
  gap count would gate/retire rows that are already resolved.

## 2. Unit C1b — gate both lanes `lane_no_consumer`

Mirror the existing `owner_needs_sos` gate (16,873 gov + 7,204 dia, already `lane_no_consumer` in
`v_next_best_research`) for `owner_needs_salesforce` (gov) and `true_owner_needs_salesforce` (dia).
Stops **1,702 admitted rows** (1,675 gov + 27 dia, post-C1a resize this number will shrink by the
96 already-linked) from continuing to mint into a surface with no write path — gov alone is **66%
of everything the fleet mints**.

- Keep `gate_value` computed on every row even while gated, so re-admitting later is one predicate
  flip, not a rebuild.
- ⚠️ **The membership PROBE that decides whether an open task's subject still has a gap must stay
  UNGATED** (the A5c rule) — gating the probe would read every gated-out subject as "resolved" and
  auto-close it `gap_resolved`, resurrecting the exact false-throughput defect A5a fixed.

## 3. Unit C1c — retire the 945 open tasks (837 dia + 108 gov)

Same shape as A4's 74-task retirement: **batch-tagged, reversible, with a re-open predicate** — not
a bare status flip.

- **Outcome value must be distinct** — never `gap_resolved` (that would re-manufacture the false
  throughput metric A5a exists to prevent). Use something like `retired_no_consumer`.
- ⚠️ **`status='skipped'` alone is NOT terminal to the seeder.** The seeder's dedupe excludes only
  `status='skipped' AND outcome->>'terminal'='true'` — set both, or these tasks re-mint on the next
  tick (the documented P176/A4-detail trap).
- **Re-open predicate:** the subject gaining a `sf_link_candidate` Decision Center row, or the
  entity/owner acquiring an SF Account directly. Build a `_watch` view (retired MINUS reopened —
  never count the ledger as a completion count).
- Sequence AFTER C1a (so the 837/108 counts reflect reality, not the mirror bug) and after C1b (so
  nothing new mints into the lane while you're retiring the backlog).

## 4. Unit C1d — automate the 27 dia deterministic fills

Population verified unambiguous by C1: **27 owners, exactly one `001…` SF Account each, 0
multi-account, 0 tombstones, 0 operators**; 6 own ≥1 property (35 properties, $5.59M known rent) —
**only 3 clear the value floor, so this is plumbing, not a value win.** Build it anyway; it's small
and it closes the population honestly.

- **Ship it as a NEW UNIT inside `_handlers/sf-link-reconcile.js`** — that file's Units 1–3 already
  run domain→LCC; this is the missing LCC→domain unit. **Do not write a standalone filler** — the
  `sf_link_candidate` verdict path is the single owner of `sf_account_id` writes (null-guard,
  provenance row, `entity_match_labels` row, reversal all live there); a second writer is the
  one-owner-per-transition defect this repo has hit repeatedly (P119/P194/N15c).
- Fill-blanks only. Resolve every owner through `lcc_entity_survivor()` before writing (never write
  to a merged-away tombstone). Reversible by batch tag.
- **Verify:** `select count(*) from dia.true_owners where salesforce_id is not null` — expect
  **822 → 849** (or the §0-adjusted equivalent).

## 5. Unit C1e — register the provenance rung (do this WITH or BEFORE C1d, never after)

`field_source_priority` has ladders for **both** gov tables (`sf_link_review_human`@1,
`splink_v1`/`splink_v2`@50, all `record_only`) but **`dia.true_owners.salesforce_id` has none** —
pre-existing `v_field_provenance_unranked` drift. One row.

- ⚠️ **Deploy-ordering rule applies exactly as stated in `CLAUDE.md`: additive schema (this rung)
  ships before the writer (C1d) goes live**, or C1d ships as an unranked writer and adds to the
  drift it's meant to close. If both land in the same PR, order the migration/registration ahead of
  the writer change within it.
- Verify: `v_field_provenance_unranked` does not gain a new row for this (table, field) pair after
  C1d starts writing.

## What NOT to do

- Do not touch `establish_ownership_history` or `trace_ownership_to_developer` (different
  generator, real completions already).
- Do not mass-create Salesforce Accounts. Nothing here creates one — only links to an existing
  `001…` id. Confirm you never construct or POST a new Account anywhere in these five units (LCC's
  SF surface is read-only; see C1 §3.2).
- Do not widen C1b's gate to any lane other than the two named here.
- Do not skip §0's re-measure and execute against C1's 2026-08-27 numbers as if they were current.

## Verify on

- C1a: `unified_contacts.sf_account_id` and `recorded_owners.sf_account_id` agreement rate after
  the repoint/dual-write, and the research-task lane's open count drop by the now-resolved subset.
- C1b: both lanes read `lane_no_consumer` in `v_next_best_research`; `gate_value` still computed;
  the membership probe still returns correct results for a subject that gains an SF link (ungated).
- C1c: 945 (or §0-adjusted) tasks retired with `retired_no_consumer`, reversible, a `_watch` view
  showing retired-minus-reopened, and confirmation the seeder does not re-mint any of them on the
  next tick.
- C1d: `dia.true_owners.salesforce_id` count moves as predicted; all 27 resolved through
  `lcc_entity_survivor()`; reversible by batch tag; 0 tombstones written to.
- C1e: `v_field_provenance_unranked` has one fewer row than before (this pair now ranked) and gains
  none for it going forward.
- `npm test` locally; branch → PR → both required checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`); expect the Update-branch gate.

## Report back

§0's re-measured numbers vs C1's · what changed in each of the five units and why (if anything
deviated from the spec above) · the four verify results · anything that outranks this while you're
in there.
