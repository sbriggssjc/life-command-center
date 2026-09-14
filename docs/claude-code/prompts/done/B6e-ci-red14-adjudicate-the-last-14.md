# B6e-ci-red14 — adjudicate the last 14, then the unmask is possible

**Repo: `Dialysis`.** Read-only against **Dialysis_DB `zqzrriwuavgrquhisnoa`** where noted. No LCC
changes.

**Read first:** `docs/architecture/producer-health-and-ci-enforcement.md` §3 in
`life-command-center` (canonical).

## Where this stands

| | collected | errors | **executed** | pass | fail |
|---|---:|---:|---:|---:|---:|
| `73f1418` | 3,110 | 5 | **0** | — | — |
| `c80f778` (#7389) | 3,128 | 0 | 3,128 | 3,065 | 55 |
| `eac8668` (#7390) | 3,128 | 0 | **3,128** | **3,106** | **14** |

**14 remain, and all 14 fail in isolation** — genuine test-vs-code disagreements, not harness
pollution. That distinction is already established; do not re-litigate it.

⚠️ **`git log` cannot adjudicate these. Every file traces to the single squashed import merge
`8c67444`, so there is no "which side moved last."** The evidence has to come from the code and the
data, not the history.

## The governing rule

**For each failure, establish whether the TEST or the CODE is wrong BEFORE changing either.**

⚠️ **Twice in this arc a red test was stale and the code was correct** — the `+5000` character
window over a function that had grown to 6,845 chars, and the stub lambda never widened after
production started passing more arguments. **"Make the test pass" is the expensive error here.**
Say which side you concluded is wrong, and why, for every one.

⚠️ **Do NOT mass-skip or quarantine to reach green.** `executed` must stay at **3,128** — report it
before and after. A fix that reduces failures by reducing what runs is the exact defect this arc
exists to close.

## The 14, and how to treat each group

### 🔴 `financial_ground_truth` (3) — MEASURE THE GAP, DO NOT CHANGE THE CONSTANTS

Revenue-model constants disagreeing with the reconciled model. **This is the one group where a
guess is genuinely dangerous** — it risks the documented `dialysis_econ_reconciled_v1` calibration.

**But it is measurable, and there is a live authority to measure against.** `clinic_econ_reconciled`
holds **81,105 rows / 8,281 clinics / FY2011–2026, a single `model_version_id = 21`, computed
2026-09-01**, with `avg blended_rate_per_treatment = 375.47` and
`avg reconciled_revenue_per_treatment = 380.14`.

**Do this:** for each of the 3, name the constant the test asserts, the value the code produces, and
**the corresponding live value from `clinic_econ_reconciled`** (read-only). Then say which of three
cases it is:

- the **test** encodes a superseded calibration → the test is stale;
- the **code** drifted from the reconciled model → a real product bug;
- **both are internally consistent and describe different things** → a naming/scope problem, and the
  most likely answer if the numbers are close but not equal.

**Report the three-way comparison. Change nothing here without saying so explicitly — the decision
is Scott's.**

### 🔴 `listing_broker_update` (2) — already filed as a real product bug

`update_database.update_field` normalises a broker NAME to `listing_broker_id` **only if
`resolved_field == "listing_broker_id"` — but the alias is the identity mapping, so the branch is
dead.** ⚠️ **Both columns genuinely exist in dia** (53 vs 34 migration references) **and
`available_listing_ingestor.py` explicitly guards against alias normalisation putting a name into the
`_id` column**, so the identity alias is defensible and **flipping either side changes a write
path.**

**Diagnose and propose; do not ship the flip.** Say which column the alias *should* resolve to,
what writes today, and what would change. Backlog **B6e-ci-listing-broker**.

### `handle_natural_language_query` (2) — known drift

Already diagnosed in a previous pass. Resolve it or state plainly why it cannot be.

### `backfill_*` (3) and the 4 singles

`clinic_history`, `clinic_alert_date`, `reverse_cms_propagation`, `run_summary_gate`. **Most likely
to be straightforward test-or-code calls** — work these first to shrink the number, and apply the
governing rule to each.

## Also in scope: the 27 latent slice windows

`test_processing_audit.py` still carries **27 fixed-character source slices**
(`source[fn_start:fn_start+N]`). They are green today. ⚠️ **The window fails in BOTH directions:
undershoot gives a stale red over correct code (already bit twice); OVERSHOOT is silent — the
assertion runs against the NEXT function, so a green guard may be passing on code it never named.**

**Re-anchor all 27 on the AST span** and report whether any of them was, in fact, asserting outside
its named function. **A green that turns red on re-anchoring is a finding, not a regression.**
Backlog **B6e-ci-slice-window**.

## Explicitly NOT in this change

**Do not remove the `|| echo` from the pytest line.** That is **B6e-ci-unmask** and it comes after
this. Unmasking against known red ships a gate red on day one — the documented *"never green once on
`main`"* trap. **The import check is the model: unmask one line, prove it green on `main`, then it
counts.** `pip-audit` and the secrets grep queue behind it.

⚠️ **A green check on your PR still means nothing** — the pytest line is masked, so `Run Tests`
reports success at 14 red or 55 red. **Read the collected / executed / passed / failed split out of
the job log.**

## Report back

`executed` before and after (must be 3,128); the per-failure verdict with which side was wrong and
why; the three-way comparison for `financial_ground_truth`; the `listing_broker` proposal; how many
of the 27 slices were mis-anchored; what remains red and whether it blocks the unmask; and anything
the sweep turns up that outranks the task.
