# B6e-fred — green in CI, dead for 25 days, and it feeds the Capital Markets book

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6e-fred`.
**Repo:** **Dialysis** (`.github/workflows/fred-ingest-daily.yml`, `src/ingest_fred_to_dialysis.py`).
**DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`.
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4**.
**Found by:** `v_dia_producer_health`'s first honest run (B6d-cms-escalation).

---

## 0. The finding, verified twice

**16 consecutive GREEN scheduled GitHub Actions runs wrote ZERO rows.**

| check | value |
|---|---|
| `economic_indicators` newest row | **2026-08-07** (25 days ago) |
| rows written since 2026-08-10 | **0** |
| scheduled runs since 2026-08-10 | **16, all green** |
| total rows / distinct series | 8,316 / **5** (incl. `DGS10`, the 10-year Treasury) |

**Mechanism, two compounding defects:**

1. **The module dies at import** — `ModuleNotFoundError: postgrest`.
2. **The step pipes through `| tee` without `set -o pipefail`**, so **bash returns TEE's exit status,
   not Python's.** A crashed job and a working one are indistinguishable to the runner.

⚠️ **And it is absent from `INFRASTRUCTURE.md`'s job map** — *a producer nobody had written down,
failing silently, wearing a green badge.* **Nothing watched it, and what did watch it lied.**

---

## 1. ⚠️ The operator cost — this is not an obscure table

**`economic_indicators` feeds exactly two consumers, and both are Capital Markets book exhibits:**

- **`cm_dialysis_macro_rates_m`** (monthly)
- **`cm_dialysis_macro_rates_q`** (quarterly)

**These are the macro-rate exhibits in the Dialysis State of the Market book** — Scott's actual
client deliverable. **Any book or export produced since 2026-08-07 carries rates that stopped
updating**, and the series include `DGS10`. ⚠️ **Establish whether a book or CM export was generated
in that window and say so plainly** — if one went out, that is a correction to make, not just a
pipeline to fix.

---

## 2. What to do

1. **Fix the exit-code masking first** — `set -o pipefail` (or check `PIPESTATUS`) on every step of
   this workflow that pipes. **Do this before the dependency fix**, so the next failure is loud
   even if the dependency fix is wrong.
2. **Fix the import** — declare/install `postgrest` (check whether the repo pins it in
   `requirements.txt` and the workflow simply does not install it, versus it being genuinely absent).
3. **Re-run and confirm rows land** — `economic_indicators` takes rows dated after 2026-08-07.
4. **Backfill the 25-day gap** if FRED serves history (it does, for these series) — ⚠️ **and say
   whether you backfilled or only resumed**; they are different, and the CM views read a time series.
5. 🚨 **SWEEP THE OTHER WORKFLOWS FOR THE SAME `| tee` SHAPE.** One instance implies a pattern, and
   this pattern is invisible by construction. **Report every workflow with a piped step lacking
   `pipefail`, whether or not it is currently failing.**
6. **Register it in `INFRASTRUCTURE.md`'s job map** — it is already in `dia_producer_registry`;
   the human-readable map is still missing it.

---

## 3. ⚠️ Rules

**3a. Assert on ROWS WRITTEN, never on the runner's exit status.** That is the entire lesson here.
✅ **Verification is `max(economic_indicators.created_at)` advancing past 2026-08-07** — not a green
check, not a clean log.

**3b. ⚠️ Do not let the green badge come back before the writes do.** If `pipefail` lands and the
dependency does not, the workflow will correctly go RED. **That is success for step 1** — a loud
failure is the improvement. **Do not "fix" the redness by reverting the pipefail.**

**3c. Give it a run ledger while you are here — or say explicitly that you did not.**
`fred_ingest` writes **no run row**, which is why `ingestion_tracker` could never see it and why
`v_dia_producer_health` shows it as `no_run_ledger`. ⚠️ **This is `B6e-ledger`'s territory and it
covers three producers** — if you do it for `fred_ingest` alone, **say so**, so the other two are not
assumed done.

**3d. Do not widen the fix into the CM views.** Whether the book exhibits need regenerating is a
**separate operator decision** (§1). Name the exposure; do not silently regenerate anything.

**3e. Python + GitHub Actions in the Dialysis repo** — every network call carries its own
`timeout=`, and note the FRED API is rate-limited.

## 4. Verification

- **`max(economic_indicators.created_at)` advances past 2026-08-07** — the state delta.
- **A deliberately-broken run turns the workflow RED** — positive-controlled, seen failing, then
  restored. ⚠️ *A pipeline that has never been seen going red on a real failure is a claim, not a
  guard* — that is the rule that made B6a and B6d trustworthy, and it is the whole point here.
- **`v_dia_producer_health` for `fred_ingest` reflects reality** (either a run ledger appears, or its
  `blindness_reason` still correctly says why not).
- **The `| tee` sweep is reported**, with every affected workflow named.
- **Backfilled-vs-resumed is stated**, and the CM exposure is named.
- Guards mutation-verified RED, comments stripped before matching.

## 5. Deliverable

`docs/audits/B6e_fred_GREEN_CI_DEAD_PRODUCER_2026-09-01.md`, plus the **BUILD-TURN-PROTOCOL closing
checklist**: `PLANNED-BACKLOG.md` (`B6e-fred`, and a row per workflow the sweep implicates),
`INFRASTRUCTURE.md`'s job map, the Dialysis `CLAUDE.md`, and a STATUS entry.
⚠️ **The `pipefail` footgun is already in the LCC `CLAUDE.md`** — mirror it into the Dialysis repo's
own, since that is where the workflows live.

⚠️ **If the sweep finds this shape in several workflows, that is the finding and it outranks the FRED
fix.** One dead producer is a bug; **a class of workflows that cannot report their own failures is a
blind spot**, and it would explain more than this one table.
