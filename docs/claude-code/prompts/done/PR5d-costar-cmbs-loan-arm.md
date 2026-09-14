# PR5d — `costar_cmbs_loan` holds 121 rungs (the ladder's largest source) for a capture arm that has never produced a row: capture gap, or unreachable arm?

**Repo: `life-command-center`.** Reads against both domain DBs (`zqzrriwuavgrquhisnoa`,
`scknotsqkcheojiaewwh`) and LCC Opps for the rungs. **Diagnosis; the write is a verdict on the
triage view plus whatever ONE gap the evidence names.** This is the last big open item on the
provenance-ladder arc.

**Read first:** `docs/architecture/field-provenance-ladder.md` (§2 instruments, §3 live state) →
backlog **PR5d** → `docs/audits/PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md` §0/§7 (the
`build_pending` verdict class this currently wears) → the sidebar/extension capture path
(`extension/` + `api/_handlers/sidebar-pipeline.js`) and, for the loan side, whatever writes
`loans` on each domain (grep `data_source` values that DO occur, as the positive control).

## The question, split

1. **Does the extension ever CAPTURE the CoStar CMBS/loan tab?** Grep `extension/` for the CMBS/
   loan page shape — a scanner, a tab name, a metadata key (`loan_amount`, `cmbs`, `originator`,
   `maturity` …). Three possible answers, each with different follow-up: (a) no scanner exists —
   the 121 rungs were registered for a capture nobody built (verdict `producer_never_wired`, the
   PR5c class); (b) a scanner exists and sends keys the server drops (the PR2 class — diff the
   sent keys against what `sidebar-pipeline` writes); (c) a scanner exists and fires only on a
   page type nobody visits (check `staged_intake_extractions` / entity captures for ANY payload
   carrying loan-shaped keys, 90-day window).
2. **Does anything else write `loans`?** `select data_source, count(*) from loans group by 1` on
   both domains — the positive control (what DOES write it), and whether `costar_cmbs_loan` was
   ever a plausible spelling of an existing writer (the rename class). Check the loans tables'
   row counts, freshness, and who reads them (`v_*` consumers, the CM books, `loan_maturity` —
   UX-T1a measured that the strongest reason-to-sell signal, 192 loans maturing ≤24 mo, "has no
   LCC table at all"; reconcile that claim against what `loans` actually holds — one of the two
   statements is wrong, find which).
3. **Is the arm worth building?** If (a)/(c): size the value before recommending a scanner —
   UX-T1a's loan-maturity finding is the demand signal; say whether these 121 rungs are the
   supply side of exactly that gap. If the CMBS data is not reachable from CoStar pages Scott
   actually visits, say so and recommend the verdict (`retire`-by-notes or keep `build_pending`
   with the named backlog row).

## Write (small)

- The rungs get a `PR5d:` verdict in `notes` (the PR5/PR5c pattern — soft, never delete), and the
  triage view keeps exposing it.
- If (b) is the answer, fix the writer the way PR2 did (registry-gated, fill-blanks, unit-parsed)
  — but ONLY if the sent keys already exist; do not build a scanner in this prompt.
- Reconcile the UX-T1a "no LCC table at all" claim in place (their page or the ladder page,
  whichever is wrong), with the measurement.

## Verify on

- The three-way answer with evidence (grep hits · payload census · loans `data_source` split).
- The 121 rungs carry a verdict; triage view row count moves accordingly.
- The UX-T1a reconciliation, stated.
- If (b): rows landing under `costar_cmbs_loan` post-fix, else the honest "no producer, verdict X".

## What NOT to do

- No new scanner, no new rungs, no rung deletion, no fuzzy matching of loan records to properties.

## Report back

The three-way verdict · the loans-table census (both domains, with consumers) · the UX-T1a
reconciliation · rung notes applied · anything that outranks this.
