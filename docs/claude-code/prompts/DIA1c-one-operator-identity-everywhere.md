# DIA1c — one operator identity everywhere: the Operators tile counts canonical operators, and the 878 unresolved operator names are folded onto them

**Filed:** 2026-09-16 (Cowork), from decision **S2**. **Owner:** LCC (`api/_handlers/dialysis-overview*.js`,
the dia operator registry `operators` / `dia_operator_aliases` on Dialysis_DB, `supabase/migrations/dialysis/`).
**Read first:** `prompts/done/DIA1b-…md` + response (the tile audit; "45 operators" vs 21 `operator_id`),
the ID2b / ID2b-caps rounds (operator canonicalization — the alias table, the fill-blanks write guard,
the "third comp source fixed at source" lesson), `CLAUDE.md` → ID-series doctrines.

## Scott's decision (S2, verbatim in intent)

> Our ultimate objective is an accurate truth and one version used everywhere. The name and which is
> used should not be evidence of the control of operations we are summarizing here. US Renal vs
> U.S. Renal Care as the name should be one operator displayed and linked everywhere, not two.

So the tile does not choose between 45 and 21 — **21 (or whatever the canonical count is when you
measure) is the only number**, and the 878 properties carrying a raw operator string with no
`operator_id` are the work, shown as such until they are gone.

## What to build

1. **Measure first, on Dialysis_DB:** `properties` with `operator_id IS NULL AND operator_name <> ''`
   (expect ~878) grouped by the raw string, with counts; how many of those strings already match a
   `dia_operator_aliases` row case-/punctuation-insensitively (`U.S. Renal Care` / `US Renal` /
   `USRC`); how many are single-clinic names that are not operators at all.
2. **Fold what the registry already knows** — fill-blanks only, via the existing resolver: for each raw
   string with an exact-or-alias match, set `operator_id`; never overwrite a set id; ledger every write
   (batch tag, raw string → id) in the pattern ID2b used. Report before/after counts.
3. **New aliases only with evidence**: a raw string that is a spelling variant of a canonical operator
   (`US Renal` → `U.S. Renal Care`) gets an alias row citing the evidence (the canonical row's own
   name, a CMS operator string, or a lease). ⛔ No alias by resemblance; a string that could be a
   different company (`Renal Care Group` vs `RCG`) goes to a review list, not the table.
4. **The tile:** *Operators tracked* = `COUNT(DISTINCT operator_id)` on dia properties; second line
   "N properties with an unresolved operator name" linking to the review list; "as of" stamp as DIA1b.
   Same number wherever an operator count is shown (Dialysis Overview, briefs, MCP `get_operator_inbox`
   if it counts) — one source view, e.g. `v_dia_operator_canon_counts`, consumed everywhere; no second
   COUNT anywhere.
5. Tests: a raw string with an alias resolves; a set id is never overwritten; the tile view and the
   overview handler read the same view (source-shape assertion); the review list contains every
   unresolved string exactly once.

## Prohibitions

- ⛔ No name text is "cleaned" on `properties`; only `operator_id` is written.
- ⛔ Migration files land in `supabase/migrations/dialysis/` in THIS repo (doctrine table), applied via
  the normal path; if applied live from the session, say so and commit the file here in the same round.
- ⛔ Redeploy both Railway services and confirm `/version`.

## Reporting

The 878 by raw string (top 30 + long tail count), how many resolved by existing alias, how many by new
evidence-backed alias (list them), how many go to review and why; tile before/after; suite counts.
