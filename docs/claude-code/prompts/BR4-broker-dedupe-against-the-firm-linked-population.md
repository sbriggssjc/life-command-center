# BR4 — broker dedupe against the firm-linked population: 143 duplicate-name groups, and the 661 firm strings BR1 queued

**Filed:** 2026-09-17 (Cowork). **Owner:** LCC (`supabase/migrations/dialysis/`, the broker registry on
Dialysis_DB, `test/`). **Read first:** `prompts/done/BR1-firm-registry-repair.md` + response (PR #2534:
the `;` composite classifier, alias-with-evidence rule, `dia_broker_company_composite_review`, the
`m&m` bare-row lesson), backlog `BR4`, `BR5`, `BR1-misparse-handoff`, `ID3c`; `CLAUDE.md` → ID-series
doctrines (fill-blanks, ledger every write, never merge by resemblance).

## What is true (measured 2026-09-16/17 on Dialysis_DB)

- `brokers` 2,550 rows; `broker_company_id` set on **366** (14.4%) after BR1; **143 duplicate-name
  groups** (2,280 distinct names across the table, pre-BR1 count — re-measure).
- `dia_broker_company_composite_review` holds **674 open rows**: 10 firm composites (ambiguous, leave),
  **661 `brokers.company` strings with no registry match** (batch `br1b_20260916_apply`, never
  minted), 3 existing-link conflicts.
- At least one non-broker entity sits in `brokers` (BR4's original note — find it by shape, not by name).

## What to build

1. **Measure first, by group:** the 143 (or current) duplicate-name groups joined to
   `broker_company_id` — how many groups are *same name, same firm* (a true duplicate), *same name,
   different firms* (two people, or a move), *same name, one linked one not*. Report the table before
   touching anything.
2. **Merge only the true duplicates** — same normalised name AND same `broker_company_id` AND no
   conflicting contact fields (email/phone differ → review, never merge). Survivor = the row with more
   evidence (linked sales/leases, contact fields, recency); every merge ledgered (`dia_broker_merge_log`
   or the ID-series pattern already in the repo — reuse, do not invent), reversible, and every FK that
   references `brokers` repointed (list them from `pg_constraint` first — the ID2a lesson: a merge that
   does not repoint is a split).
3. **The 661 firm strings:** resolve against the repaired registry exact-or-alias (fill-blanks); for
   the rest, group by normalised string with counts — the top strings with ≥3 brokers are candidate
   new firms **only with evidence** (a domain, a Salesforce account, a listing); mint those citing the
   evidence; everything else stays queued. No firm is minted from a lone string.
4. **The non-broker rows:** list rows whose name matches a firm/LLC/trust shape or an operator; route
   them to review with a reason, do not delete.
5. **BR5 stays out of scope** (display), but report what the merged population would render.
6. Tests: a same-name/different-firm pair is never merged; a merge repoints every FK; a minted firm
   carries evidence; suite green. Migration in `supabase/migrations/dialysis/` here; if applied live
   from the session, say so and commit in the same round.

## Prohibitions

- ⛔ No merge by name resemblance; no cross-firm merge; no delete. ⛔ Redeploy both Railway services and
  confirm `/version`.

## Reporting

The group table before/after; merges applied (count, ledger batch); firms minted with evidence; the
review residue by reason; FKs repointed. **Parked:** anything noticed out of scope, one line each
(→ `docs/claude-code/PARKING-LOT.md`). If any step was skipped, say so.
