# BR1/BR3 — Repair the `broker_companies` firm registry before anything matches against it

**Repo: `life-command-center`.** Dialysis_DB. This is the blocker Scott's own ranking named: **ID3c (broker
duplicates) WAITS on BR1–BR5**, and BR4 (dedupe) explicitly says "after BR1/BR2, not before — resolving the firm
link is what makes a duplicate visible." **This prompt is the specific, well-scoped unit that unblocks the rest:
repair the registry itself.** BR4 (dedupe `brokers`) and BR5 (two-field display) are real follow-ups but should
NOT be done in this same build — each needs the repaired registry as an input, not as a simultaneous edit.

**Read first:** `docs/os/PLANNED-BACKLOG.md` BR1, BR3, BR4, BR5, ID3c, ID4 rows · PR #7392 (BR1's original typing
pass) · the ID2a/ID3a migrations for the registry+alias+resolver+guard shape (the pattern to copy).

## Why this, why now — confirmed live, unchanged since the 2026-09-02 audit

Measured live against Dialysis_DB (Cowork, 2026-09-12) — **the population has not moved in 10 days, meaning
nobody has touched this table since it was typed; safe to build against these numbers today:**

- `broker_companies`: **131 rows, 73 (56%) contain a `;`** — composite pseudo-firms, not real single companies.
  Confirmed live: **8 separate rows all containing "colliers"** (`colliers`, `colliers international`, `colliers;
  mason`, `colliers; olaiz`, `colliers; patel`, `colliers; spisak`, `colliers; yeggy`, and buried inside `cbre;
  smyth & colliers; patel`) — one real firm, minted 8 times because each `firm; agent` capture was inserted as its
  own row instead of resolving `firm` against an existing row.
- **23 single-token abbreviations** (`ay`, `cb`, `acre`, `cook`, …) sit as their own `company_name` rows —
  unclear whether they're a real distinct firm or a shorthand for one of the 131.
- `brokers`: **2,447 rows, only 184 (7.5%) carry `broker_company_id`.** The FK column exists and is barely used —
  same unwired shape as every other ID3/BR class this session has measured. `brokers.company` (free text) still
  carries **71 semicolon-composite values** of its own, separate from the registry-row contamination above.
- **The `&` vs `;` distinction is real and must not be flattened**: BR3's own finding — `Lee & Associates` is a
  real firm name using `&`, not a co-listing separator; `;` is the actual composite-record separator this repo's
  capture path used. Confirmed live: a handful of `broker_companies` rows carry `&` with no `;` — leave those
  alone, they are real names.

## 1. Measure before repairing (repeat live — this is a 2026-09-12 snapshot)

For each of the 73 semicolon-bearing `company_name` rows, split on `;` and classify each token: does it match
(case-insensitively, punctuation-normalized) an EXISTING `company_name` in the registry already? Group by the
first token specifically (the `colliers` case shows the firm is usually first, agent-name(s) after) but **verify
this per-row rather than assuming a fixed position** — `Acre Advisors; Reid` is firm-then-agent, but check for
counter-examples before generalizing. For the 23 single-token abbreviations, check whether each is a substring/
initialism of one of the 131 (or of a full firm name found in `brokers.company` free text) with real evidence
(a shared broker or address), never a guessed expansion.

## 2. Repair it

- The composite `;` rows are a CAPTURE bug, not a naming variant — the fix is not a case-fold, it's a **split**:
  each `firm; agent[; agent...]` row should become (a) the firm resolved to its real existing `broker_companies`
  row (creating one if it genuinely doesn't exist yet — the 8-way colliers case collapses to 1), and (b) the
  agent name(s) captured as `brokers` rows with `broker_company_id` pointing at that firm, never as their own
  company row.
- Abbreviations resolve via an alias table (`dia_broker_company_aliases`, new — mirroring ID2a/ID3d's pattern:
  raw string → `broker_company_id`, provenance, never a live join against an unrelated table), evidence-backed
  only; anything without real corroborating evidence goes to review, not a guess.
- `&`-bearing names with no `;` are left untouched — they are real firm names, not composites.
- Backfill `brokers.broker_company_id` from the repaired registry + alias table. Auto-apply only exact/alias
  matches; everything else to review with raw text intact. Report the auto/review split.
- Hard write guard + parity view (broker counts per firm before/after — the only movement should be the 8-way
  colliers-shaped collapses, never a real distinct firm merging into another).

## 3. What NOT to do

No `brokers` dedupe (BR4) in this build — it explicitly waits on this repair landing first, so a duplicate is
visible/explained rather than guessed at. No display-layer change (BR5) — that consumes this registry once it's
trustworthy, it doesn't need to ship simultaneously. No ID3c (broker identity merge) — still correctly on hold
per Scott's ranking; this prompt is what unblocks it, not ID3c itself. No inventing a "BR2" — no such row exists
in the backlog today; if the gap BR4 references turns out to be part of this repair, say so explicitly in the
ship report rather than assuming.

## Guard + ship

Tests: the colliers-shaped 8-way collapse (must land on ONE row, not silently merge a genuinely different
firm), the `&`-name must-not-split guard, alias resolution on fixtures, guard rejection, backfill auto/review
split. Full suite green. Branch → PR → CI → merge (no Railway redeploy needed unless a consumer view changes).

## Ship + record

Report: composite-row split counts, abbreviation resolutions with their evidence, `broker_company_id` coverage
before/after, parity table, review lane left for a human. Update `PLANNED-BACKLOG.md` (BR1, BR3 — mark repaired;
note whether BR4/BR5/ID3c are now unblocked or what's still needed), `STATUS.md`, `CURRENT-STATE.md`.
