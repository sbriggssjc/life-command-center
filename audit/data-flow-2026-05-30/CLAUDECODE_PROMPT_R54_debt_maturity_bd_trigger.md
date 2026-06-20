# Claude Code — R54: turn loan maturity (+ distress) into a value-ranked BD trigger

## Why (audit live 2026-06-20 — see AUDIT_debt_maturity_to_bd_trigger_2026-06-20.md)
The debt layer is captured but dormant:
- gov: 1,500 loans / 761 props; **155 loans / 106 active properties maturing within 24 months
  ($138.9M annual rent)**; 59 already matured. dia thin (8 maturing).
- **Distress flags scaffolded but UNPOPULATED:** `loans.watchlist` / `special_servicing` /
  `dscr<1` / `num_delinquent` all 0 across 1,500 gov loans (only `maturity_date` is actionable).
- **No BD trigger:** research_types are all ownership-related (no maturity/refi/debt); no debt
  priority band; no decision lane. `maturity` is only a displayed packet field — drives nothing.
- The score stores debt columns (741 has_debt) but the 6-factor model ignores them (the R49
  agency-risk pattern).

**Scope:** build the maturity-watch BD trigger now; the score-factor is deferred/gated (R49 v3
pattern). Additive read features — no writes to curated data; signals/candidates, not facts.

## House rules
gov-focused (build dia in parallel; expect few). Value-ranked by rent (tie owner via R47/R51
resolution → who to call). Reuse the existing research-task + Decision-Center + property-detail/
context-packet machinery — don't fork. Idempotent (no dup tasks — R21 discipline); reversible;
≤12 `api/*.js`; `node --check`/`py_compile`/suites green; DB live after a dry-run.

## Unit 1 — maturity-watch view (the BD trigger source)
`<dom>_loan_maturity_watch` (gov + dia) — one row per property with a loan maturing within
`horizon_months` (default 24) OR already matured, carrying: nearest maturity_date,
months_to_maturity (negative = matured), loan_balance (where present), the property's rent (rank),
the resolved owner (recorded/true owner → who to contact), and a `maturity_band`
(`matured` / `<=6mo` / `<=12mo` / `<=24mo`). Value-ranked. This is the source for Units 2-3.

## Unit 2 — surface it as a value-ranked BD action (the headline)
Wire the watch into a surface the operator actually works:
- A **Decision Center "loan maturity / refi" lane** (reuse the R7/R46/R51 federated-lane
  machinery), value-ranked, verdicts e.g. `pursue_refi` (open a buy-side/advisory outreach on the
  owner — reuse the cadence/opportunity path), `pursue_disposition` (the owner may sell — outreach
  / watch), `not_relevant` (record + stop-asking), `research`. AND/OR a `refi_or_disposition`
  research/outreach signal per high-value maturing property.
- Surface maturity on the **property detail page + the context packet** (it's currently only a raw
  field) as a flagged BD signal ("loan matures in N months").
Effect-first, idempotent, reversible.

## Unit 3 — populate the distress flags (sharpen the watch)
Investigate the CMBS ingest (Round 76ek loan pipeline): the CoStar CMBS Loan Detail tab carries
servicer/watchlist/special-servicing/delinquency/DSCR — confirm whether the parser captures them
and the writer persists them. They're scaffolded empty live, so either (a) the parser drops them
or (b) the source rows we have don't include them. Fix the writer to populate
`watchlist`/`special_servicing`/`num_delinquent`/`dscr` where the source provides them; if the
source genuinely doesn't, **document that** (don't fabricate). A watchlisted / special-serviced /
DSCR<1 loan ranks at the TOP of the maturity-watch (imminent forced sale).

## Unit 4 — (optional, gated, deferred) feed maturity/leverage into the grade
Only if wanted: add a maturity/leverage signal to the R49 v3 model (or a risk overlay), gated
behind the existing `SCORING_MODEL_ACTIVE` / overlay pattern, with a before/after. Default: NOT in
this round — the BD trigger is the value.

## Verify (report back)
- `<dom>_loan_maturity_watch` counts by `maturity_band` (gov ~106 within 24mo + 59 matured; dia
  few); spot-check a high-rent maturing property resolves its owner.
- The maturity lane/signal renders + a verdict round-trip (0 residue); maturity shows on the
  property detail/packet.
- Unit 3: report whether the CMBS source carries distress flags + how many got populated (or the
  documented finding that the source lacks them).
- No writes to curated data; suites green; ≤12 api/*.js.

## Bottom line
A loan maturity is the classic CRE BD trigger and we capture 155 gov loans maturing in 24mo
($139M rent) — then ignore them. R54 builds a value-ranked maturity-watch wired into the operator's
surfaces (lane + research signal + property detail), populates the distress flags to sharpen it,
and leaves the grade-factor as a gated R49-style follow-up — lighting up the dormant debt layer the
same way R50 lit up the geocode layer.
