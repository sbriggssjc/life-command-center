# RECON2-d — rename `holdover_confirmed` → `occupied_term_unknown`, decide the one "no date" marker, teach the classifier, count the blind clinics

**Filed:** 2026-09-18 (Cowork round 42; backlog `RECON2-d`, PL-52, PL-54). **Owner:** LCC (`supabase/migrations/dialysis/`,
`api/_handlers/sidebar-pipeline.js` lease block ~11,600–11,700, rent-roll / exhibit renderers, `test/`).
**Read first:** backlog `RECON2`, `RECON2-b`, `RECON2-c`, `RECON2-d`, `SIDEBAR2`; `docs/architecture/reconcile-property-spec.md` R5;
`docs/audits/RECON2-b-confirmed-expired-leases-review-2026-09-18.md`; migrations `20260917220000_dia_recon2_*`,
`20260918120000_dia_recon2b_*`, `20260918130000_dia_recon2c_*`, `20260918120000_dia_sidebar2a_*` (all live on Dialysis_DB).

## What is true (Scott, CoStar, 2026-09-18)
Goldsboro 23259, Dixon 12678, Scranton 13058 are labelled `holdover_confirmed`. CoStar shows each as an **active lease with no
expiration date on file**. DaVita is in occupancy past the recorded expiration. That is all that is known. `holdover_confirmed`
asserts month-to-month; `renewed_confirmed` asserts a renewal — neither is evidenced. **Redefine the state; invent no date.**

## Build
1. **Rename the state.** Migration: `holdover_confirmed` → **`occupied_term_unknown`** ("tenant confirmed in occupancy past the
   recorded expiration; current term not on file"). Update the CHECK on `leases.expiration_state`, the guard trigger's
   confirmed-set (`20260918120000_dia_recon2b_*` line ~63 shape), `dia_recon2_confirm_lease_expired()` if it names the state,
   the three rows, and spec R5's vocabulary. `is_active` untouched (Scott's rule: a lease goes inactive only on confirmed
   expiration). Ledger the rename in `dia_recon1_run_log`.
2. **One "no date" marker, two columns, one writer each (PL-54).** `expiration_state` says *what is true about the term*;
   `lease_expiration_source_state` (SIDEBAR2-a) says *what the CoStar capture carried*. Rule to implement: when the sidebar
   writer stamps `source_no_date` on a lease whose recorded expiration has passed → `expiration_state = occupied_term_unknown`
   (evidence row `costar_lease: active`, no date); on a lease with **no** recorded expiration at all → `expiration_unknown`.
   `dated` → the guard's normal date logic. Write the rule into spec R5 in one paragraph naming both columns.
3. **Classifier.** `dia_recon2_classify_expired_leases()`: a `costar_lease` evidence row saying *active* proposes
   `occupied_term_unknown`, never holdover. Re-run on the 2,454 and report the state histogram before/after (no writes beyond
   the three renamed rows unless the report shows a class that is provably safe — say so, do not do it).
4. **Render.** Rent roll and exhibits show `occupied_term_unknown` as *"Occupied — lease term not on file (expired <date>)"*.
   The three sit in the research worklist (`pending_updates` lane) for a lease abstract / OM — no new lane.
5. **Count the blind clinics.** `medicare_clinics.chain_organization IS NULL` on operating rows (35849's class): count, top
   10 by state, fix 35849 by evidence already on file (its DaVita lease) and file the rest as a row, not a write.
6. **Tests** for the CHECK, the guard, the sidebar rule (fixture: a `source_no_date` capture on 23259), the render string.
7. **Report:** per lease (23259, 12678, 13058) old → new state; the histogram; the NULL-chain count; every migration filed and
   whether it was applied (Cowork applies unapplied Dialysis migrations at reconcile — say which).

⛔ No fabricated expiration dates. ⛔ `is_active` never flips in this round. ⛔ Repo owns Dialysis_DB objects only (gov `leases`
belongs to `government-lease` — file the gov mirror as a line, do not touch). ⛔ STATUS heading **`Round <this prompt's
round>-CC (CC)`**, never a bare Cowork number; entry written before the PR. Browser/SQL proof in the response, not "should".

**Parked:** one line each.
