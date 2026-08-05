# Prompt 41 — Comps SELECTION defaults + field standardization (engine, all surfaces)

## Why (Scott's export notes, 2026-08-05)
Recency + operator breadth + inconsistent field text. From the notes: default to sales in the **last 18 months**
("older is a different capital-markets condition"), and to fill the set within that window **prioritize adding
Fresenius / US Renal over staying region- or single-operator-strict**. Also: TENANT isn't the standardized
operator name; EXPENSES aren't a standard vocabulary; renewal OPTIONS aren't standardized. This must live in the
engine so every surface returns identical, clean text — not be hand-fixed per export.

## Task (mcp/comps-tools.js + skill/canon)
1. **Recency default.** In appraisal/synthesize, default `date_from = today − 18 months` when the user gives no
   window. If fewer than the target count qualify, widen in this order: **add operators (DaVita → +Fresenius →
   +US Renal → +others)**, then loosen geography (already national per prompt 39), then extend the window. Never
   silently keep stale comps to hit the count — log what was widened.
2. **Operator standardization.** Normalize `tenant`/operator to the canonical brand: DaVita, Fresenius Medical
   Care, US Renal Care, American Renal, Innovative Renal Care, etc. (map FMC/BMA/Bio-Medical→Fresenius;
   USRC→US Renal Care). The TENANT column shows the standardized operator, not the raw clinic name.
3. **Expense-structure vocabulary.** Standardize to a fixed set: `Absolute NNN`, `NNN`, `NN`, `Gross`,
   `Ground Lease`, `Modified Gross`. Map "Double Net"→NN, "Triple Net"/"Modified Triple Net"→NNN, etc.
4. **Renewal OPTIONS + bumps formatting.** OPTIONS → `(N) M-yr` (e.g. `(3) 5-yr`); parse counts from words/digits,
   never mistake the term-length for the count. Bumps → `X% / N yrs` or `X% / yr`; leave uninterpretable source
   values (e.g. bare `0.1`, `1.75`) untouched but route them to the review lane as bad data.
5. Apply identically to sold + on-market, dialysis + gov. Document the vocabularies once in canon so surfaces match.

## Verify
- A no-window appraisal pull returns only sales ≤18 months old (or logs the widening), spanning DaVita + Fresenius
  (+US Renal when needed). TENANT/EXPENSES/OPTIONS/bumps come back in the standard forms above on every surface.
