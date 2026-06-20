# Claude Code — R55: make the gated activations safe + build one unified value-ranked BD worklist

## Why
Eight rounds (R46–R54) built a lot of BD signal — but it's (a) siloed across separate lanes/views,
and (b) some bulk activations aren't safe to flip yet. This round makes the activations safe and
gives the operator ONE place to work, highest-value-first, across everything we built. Additive,
read-only over curated data (signals/worklists, not new facts); reuse existing machinery; ≤12
`api/*.js`; `node --check`/suites green; DB live after a dry-run.

## Unit 1 (priority) — fix R51 `auto_fixable` so the bulk owner-deed autofix is safe
The owner-deed-autofix dry-run (read-only, 2026-06-20) showed `auto_fixable` over-includes:
**176 of 189 `deed_newer_stale` auto-fixable rows have a deed >24mo old**, and several would
revert a CURRENT name to a STALE one — entity rebrands/acquisitions, not transfers:
- recorded "Affinius Capital" → deed "USAA Real Estate" (2014) — USAA Real Estate *rebranded to*
  Affinius.
- "Government Props Income Trust" → "First Potomac Realty Trust" (2013) — First Potomac *acquired
  by* GPT.
- multiple "Easterly Government Properties (REIT)" → "Easterly Partners" on 2012–2014 deeds.
Fix `v_owner_source_conflict.auto_fixable` for `deed_newer_stale`: require the deed to be genuinely
newer than the recorded_owner (deed `latest_deed_date` newer than the recorded_owner's
`field_provenance` last-write timestamp; if no provenance ts, require a recent deed, e.g. ≤24mo),
**AND skip same-entity rebrand cases** (deed grantee and recorded_owner share a normalized core
token via the R47/R51 owner normalizer — same entity, not a transfer). `broker_as_owner` and
`stale_seller` stay auto-fixable. Re-run the dry-run; report the corrected auto-fixable count and
confirm NO rebrand/acquisition reverts to a stale name. Keep `DECISION_OWNER_DEED_WINS` gated until
this lands; the per-row lane verdicts are unaffected.

## Unit 2 — one unified, value-ranked BD worklist (the "where do I start" surface)
Build `v_lcc_bd_worklist` (LCC Opps) that MERGES the new signal types into a single value-ranked
list the operator works top-down, each row carrying: `signal_type`, `domain`, `property_id` /
`entity_id`, a one-line `what` (the action), the resolved owner/contact (who to call), `$ value`
(rank), and a deep link to the relevant lane. Union the existing sources — do NOT recompute them:
- `loan_maturity` (R54 `v_loan_maturity_watch`) — refi/disposition trigger.
- `suspected_sale` (R53 `v_suspected_sale`) — discovered deal to confirm.
- `owner_source_conflict` (R51, the **workable** subset only — broker_as_owner / stale_seller /
  the corrected deed-newer set) — reconcile owner.
- `contact_writeback` (R52 `v_lcc_contact_writeback_candidates`) — push contact to CRM.
- `ownership_chain` (R46 `v_ownership_chain_worklist`) — resolve to developer.
- (P-BUYER / P-CONTACT / cadence already live in the priority queue — reference, don't duplicate.)
Rank across types by $ value with a sensible signal-type tiebreak (distressed/suspected-sale first,
then maturity, then value). Expose `GET ?action=bd_worklist` (+ `?type=` filter, `?summary=1`
counts-by-type) and render it as a "Top BD actions" surface (Today page or a Decision Center
overview tab) — reuse the existing card/lane renderers. Value-ranked, deduped (one row per
property+signal), read-only.

## Unit 3 — activation review outputs (so Scott can flip the gated flags from data)
Produce the review data each gated flag needs, as a `GET` dry-run / summary (no writes):
- **R49 v3 grade** — a v2-vs-v3 before/after: grade distribution, count that move, the biggest
  downgraders (esp. high-risk/footprint-reduction props that SHOULD drop). So `SCORING_MODEL_ACTIVE=v3`
  is a reviewed decision.
- **R51 owner-deed** — the corrected `auto_fixable` set (post-Unit-1) with before→after, so
  `DECISION_OWNER_DEED_WINS` is reviewed.
- **R52 contact writeback** — the top value-ranked candidate batch (the first N to push once
  `SF_CONTACT_WRITEBACK` + the PA flow are on).
Surface these as dry-run endpoints/summaries; do not enable anything.

## Guards / verify
No writes to curated data; no flag auto-flipped; reuse the existing views/lanes (Unit 2 is a union,
not a recompute); idempotent; ≤12 `api/*.js`; suites green. Report: corrected R51 auto-fixable
count + proof no rebrand reverts; `v_lcc_bd_worklist` counts by signal_type + top-20 sample; the
three Unit-3 review summaries resolve.

## Bottom line
R55 makes the bulk owner-deed autofix safe (the dry-run caught rebrands being mislabeled
auto-fixable), unifies the eight rounds of BD signal into one value-ranked worklist so the operator
works highest-value-first across maturities / suspected sales / owner conflicts / contacts / chains,
and emits the review data needed to confidently flip the remaining gated flags.
