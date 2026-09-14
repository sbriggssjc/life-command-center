# Dialysis economics & Medicare data — what is measured, what is modeled

> **START HERE before flagging any dialysis revenue, rate, payer-mix or census figure as wrong.**
> Several things on this page look like defects and are **understood, correct behaviour**. They are
> recorded here specifically so a future session does not re-open them as bugs.
>
> **The one rule that matters: `clinic_econ_reconciled.confidence_tier` separates MEASURED from
> MODELED, and almost nothing filters on it.** Quote the tier, or quote nothing.

**Live state 2026-09-01 · DB `zqzrriwuavgrquhisnoa` · related: `producer-health-and-ci-enforcement.md`.**

---

## 1. The reconciled model — live and healthy

`clinic_econ_reconciled`: **81,105 rows / 8,281 clinics / FY2011–2026**, a single
`model_version_id = 21`, **computed 2026-09-01**. This is the authority for clinic economics; a test
constant or a report figure that disagrees with it is the thing to question first.

| FY | rows | avg blended rate | avg rev/tx | avg Medicare % |
|---:|---:|---:|---:|---:|
| 2021 | 6,510 | 375.44 | 380.27 | 35.04 |
| 2022 | 6,611 | 374.97 | 379.89 | 35.16 |
| 2023 | 6,700 | 374.27 | 379.25 | 35.31 |
| 2024 | 6,754 | 373.24 | 378.34 | 35.71 |
| **2025** | **61** | 377.58 | 384.57 | 40.47 |
| **2026** | **724** | **297.87** | 313.36 | **73.66** |

## 2. ✅ NOT A DEFECT — the rate is flat, and that is the correct answer

**The blended rate per treatment moves −0.6% across four years** (375.44 → 373.24). What drifts is
**payer mix** (Medicare 35.04% → 35.71%), not the rate.

**Consequence, recorded so it is not re-litigated:** `RATES_2025` and `CMS_2023_RATES` holding
**identical constants is defensible** — the rates genuinely have not moved materially between those
vintages. ⚠️ **But they are kept as two named constants deliberately.** Collapsing them costs
nothing today and permanently destroys the ability to express a divergence when CMS does move.
**Do not "simplify" them into one.**

## 3. 🚨 THE THING TO KNOW — FY2026 is 100% MODELED, not measured

`payer_mix_source` has three values and they are not equivalent:

| FY2021–2024 | source | tier | rows | clinics | avg blended | avg Medicare % |
|---|---|---|---:|---:|---:|---:|
| | `hcris_form_265_11` | **high** | **26,021** | **6,590** | **376.15** | **34.5** |
| | `partial_plus_default` | medium | 523 | 256 | 295.35 | 75.2 |
| | `national_default` | medium | 31 | 13 | 301.36 | 65.0 |

**98% of the dense years are HIGH confidence, from real HCRIS cost reports.** Then:

| FY | `hcris_form_265_11` | `partial_plus_default` | `national_default` | tier |
|---:|---:|---:|---:|---|
| 2024 | 6,536 | 210 | 8 | high / medium |
| 2025 | 58 | 2 | 1 | high / low |
| **2026** | **0** | **659** | **65** | **ALL low** |

⚠️ **FY2026 contains ZERO measured payer mix. Every row is a default fallback**, because HCRIS cost
reports for 2026 have not been filed yet.

**So FY2026's "73.66% Medicare, $297.87 blended" is NOT a market shift — it is the fallback
signature.** The fallback is stable and distinctive across every year it appears (~$295–301 blended,
65–75% Medicare), which makes it **easy to detect and easy to mistake for a trend.**

🚨 **The dangerous reading: a year-over-year chart including FY2026 shows the blended rate dropping
~375 → ~298 and reads as a 20% rate collapse. It is not. It is an absence of filed cost reports.**

## 4. ⚠️ Only ONE of eight econ views filters on confidence — audited 2026-09-01

| view | `confidence_tier` in a WHERE? |
|---|---|
| `v_clinic_econ_current` | ✅ **yes — the only one** |
| `v_clinic_econ_series` | ❌ selects it, does not filter |
| `v_dia_econ_value_crosswalk` | ❌ selects it, does not filter |
| `cm_dialysis_clinic_econ_trend_y` | ❌ **CM BOOK EXHIBIT** |
| `cm_dialysis_operator_unit_economics` | ❌ **CM BOOK EXHIBIT** |
| `v_dia_econ_market_summary` / `_operator_benchmark` / `_scale_curve` | ❌ |

⚠️ **A `definition ILIKE '%confidence_tier%'` test reports the opposite of the truth** — it matches
the SELECT projection. **Three views were nearly recorded as "careful" on that basis.** Test for the
predicate (`WHERE … confidence_tier`), and treat a comfortable result as a bug signal (P182).

### ✅ FIXED 2026-09-02 (DE1) — and my "latent, not live" call was WRONG

Both CM econ exhibits are now gated on **`payer_mix_source = 'hcris_form_265_11'`** — the fact, not
`confidence_tier`, its proxy. **Both views MOVED, so this was a live error, not a latent one.**

⚠️ **The error in the original analysis, recorded because it is instructive.** I reasoned about
FY2026 alone — which the trend view's `HAVING count(*) >= 1000` does exclude at 724 rows — and
concluded the exhibits were safe. **But modeled rows exist in EVERY year** (523 `partial_plus_default`
across FY2021–24, 210 in FY2024 alone). The year filter never protected against them.

| exhibit | effect of the gate |
|---|---|
| `cm_dialysis_clinic_econ_trend_y` | FY2024 clinic count **6,754 → 6,536**; avg revenue/clinic **$3,476,458 → $3,584,713 (+3.1%)** — the modeled rows were dragging every year's average down |
| `cm_dialysis_operator_unit_economics` | 🚨 **LIVE-WRONG** — it filters on `is_current_year`, which spans **FY2011–2026**, so it was serving the FY2026 fallback husks directly. **Satellite's revenue/clinic was understated by 41%**, and several operator margins were roughly halved |

**The confound was tested and rejected, which is what makes the gate safe:** modeled ≠ merely stale.
Measured-but-stale clinics look normal (avg $3.42M, 8,742 treatments/yr); the modeled rows are
damaged in **both** vintages — stale ones are husks at **27 treatments/yr**, recent ones carry the
$301.85 fallback signature. **Gating on the fact is correct; gating on vintage would not have been.**

**`HAVING count(*) >= 1000` is retained** — it guards a different thing (a year too thin to average
at all), and two guards with stated purposes beat one doing double duty.

> **The transferable lesson: a year-based guard and a quality-based guard are not substitutes.** I
> treated the row-count threshold as though it were protecting against modeled data. It was
> protecting against thin years, and the two populations only partly overlap.

## 5. Medicare coverage — the rest of the picture

| | |
|---|---|
| `medicare_clinics` | **8,547 rows**, `source_last_seen` **2026-08-31 22:51** |
| `properties.medicare_id` | **7,514 of 11,802 (64%)** |
| `facility_patient_counts` | **189,851 rows across 28 snapshot dates** |

- ✅ **The 67-day CMS outage is repaired** (B6d-cms) — root cause was a 30-day throttle keyed on the
  last **attempt** rather than the last **success**, so a failed run bought 30 days of silence.
- ✅ **NOT A DEFECT: `facility_patient_counts` is a CMS reporting-period time series, published
  roughly annually — not a nightly feed.** Re-running ingestion only adds rows when a genuinely new
  `snapshot_date` lands. **Do not report it as stale**, and do not rank sub-1% re-stamp noise.
- ✅ **NOT A DEFECT: a future-dated `snapshot_date` (e.g. 2026-12-31) is CMS fiscal-period-end
  convention**, not bad data.

## 6. What would actually get us closer to accurate

1. ⭐ **`DE1` — gate the two CM econ exhibits on measured-vs-modeled.** The single highest-value
   item: it is the only one with a path to a client deliverable, and the data to gate on already
   exists on every row.
2. **`DE2` — surface the tier wherever a figure is shown.** A `$3.48M avg revenue` from HCRIS and one
   from a national default are different claims; today they render identically. **Render the tier or
   the source, never a bare number.**
3. **`DE3` — 36% of properties carry no `medicare_id`** (4,288 of 11,802). Those clinics have no
   economics at all, and the gap is invisible on any revenue surface because they simply do not
   appear. **Size the gap before deciding whether it matters** — some are non-clinic assets.
4. **`DE4` — decide the FY2026 display policy explicitly.** Suppress it, label it, or admit it with
   the tier attached. Doing nothing means the `HAVING >= 1000` threshold decides it silently.

## 7. Where else to look

| for | read |
|---|---|
| producer health, the CMS outage, CI | `producer-health-and-ci-enforcement.md` |
| broker / firm name storage | `broker-and-firm-identity.md` |
| the invariants | `data-coherence-invariants.md` |
| open rows | `../os/PLANNED-BACKLOG.md` — `DE*`, `B6d-cms*` |
