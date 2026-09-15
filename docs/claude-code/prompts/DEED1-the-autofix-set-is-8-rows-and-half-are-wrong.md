# DEED1 — the deed-wins autofix set is 8 rows, and a hand-check finds errors in half

**Filed:** 2026-09-15 (Cowork), measured live against Dialysis_DB (`zqzrriwuavgrquhisnoa`) and
government (`scknotsqkcheojiaewwh`).
**Backlog:** FLAGDARK1 decision #4 (`DECISION_OWNER_DEED_WINS`). **Read `docs/audits/FLAG_LONG_DARK_TRIAGE_2026-09-15.md` first — this prompt CORRECTS it.**

## What the triage doc got wrong

It called decision #4 "the only one that needs no purchase, no endpoint and no IT conversation — just
a decision," and recommended flipping it first. Measured, that is not what the flag does.

`v_owner_source_conflict` live, both domains:

| domain | auto_fixable = true | auto_fixable = false |
|---|---|---|
| government | **0** | 941 |
| dialysis | **8** | 415 |

So `DECISION_OWNER_DEED_WINS=on` would write **8 rows out of 1,363 conflicts**. It is not a decision
about whether deeds win; it is a switch on a population that a guard has already reduced to nothing.

## Worse: the 8 do not survive a hand-check

Full set, dialysis, ordered by deed date:

| property_id | kind | recorded_owner | deed grantee | deed date |
|---|---|---|---|---|
| 37690 | deed_newer_stale | GC KANSAS HOTELS, LLC | Realty Income Properties 17 LLC | 2026-03-31 |
| 23902 | deed_newer_stale | Sumitomo Bank Leasing And Finance Inc | **SMFG** | 2025-12-01 |
| 27709 | deed_newer_stale | Sumitomo Bank Leasing And Finance Inc | **SMFG** | 2025-12-01 |
| 29087 | stale_seller | Eagle Pass Health Enterprises Ltd | Sumitomo Bank Leasing and Finance, Inc | 2025-11-24 |
| 37574 | stale_seller | Sage Hills Mhp LLC | AGREE CENTRAL LLC | 2025-09-08 |
| 27042 | stale_seller | Rood Investments | Sumitomo Bank Leasing And Finance Inc | 2023-09-14 |
| 27006 | stale_seller | Vereit | K&T Ranch | 2021-06-25 |
| 22702 | stale_seller | MARKDEV DV WASCO LLC | HP PROPERTIES CA, LLC | 2018-03-01 |

Two problems visible without any query:

1. **`Sumitomo Bank Leasing And Finance Inc` → `SMFG` (x2).** SMFG is the same company's abbreviation.
   The rebrand guard is `dia_owner_share_significant_token(recorded_owner_name, latest_deed_grantee)`,
   which compares **shared tokens** — and an initialism shares no token with the words it abbreviates.
   The guard is structurally blind to the abbreviation case.
2. **A bank appears as grantee on three rows** (29087, 27042, and the two above as grantor). A leasing
   and finance entity taking title reads like a financing instrument, not a sale. The view already
   excludes `mortgage|deed of trust|savings bank|bancorp|…` from grantees — `Sumitomo Bank Leasing and
   Finance, Inc` contains none of those tokens and slips through.

**Do not fix these by hand and do not flip the flag.** Both are instances of a guard whose rule does
not cover a shape that is plainly in the data.

## What actually blocks the other 1,355

Measured breakdown of `auto_fixable = false`:

| domain | kind | n | dominant reason |
|---|---|---|---|
| dia | deed_newer_stale | 290 | **234 blocked ONLY by `latest_deed_date >= CURRENT_DATE - 2 years`** (31 rebrand guard, 23 grantee guard) |
| dia | spe_vs_parent | 124 | excluded by design |
| gov | deed_newer_stale | 593 | **389 have `latest_deed_date` NULL** — see the companion prompt, GOVDEED1 |
| gov | spe_vs_parent | 348 | excluded by design |

The 2-year window is doing almost all the exclusion on the dialysis side. It came from R55, when
nobody trusted the set — but **an older deed is not a less authoritative deed.** If anything it is
more settled. That window is the real decision buried under decision #4.

## Scope

Scott's call, 2026-09-15: **widen the window, but prove it first**, and fold the guard work into the
same round because it is the same view and the same question about what "high confidence" means.

### 1. Measure before changing anything
Sample the **234** dialysis rows blocked solely by the recency window and report what widening would
actually write: before → after owner, deed date, conflict kind. Bucket by deed age (2–5y, 5–10y, >10y)
so the window can be chosen from evidence rather than picked. **Report only — change no window yet.**

### 2. Fix the two guard holes, with controls
- **Abbreviation/initialism**: `dia_owner_share_significant_token` must not treat an initialism as a
  different company. Whatever you build, the negative control is the SMFG pair — it must stop being
  `auto_fixable`. State the technique and its failure modes; do not claim it generalizes further than
  you measured.
- **Financing-instrument grantees**: the existing token list misses `Leasing and Finance`. Widen it
  from the data, not from imagination — enumerate the distinct grantees in the conflict set that look
  like financing entities and report them before deciding the rule.
- ⚠️ Both guards must come with a **positive control**: a row that SHOULD be auto-fixable and still is
  after the change. A guard that fixes today's eight rows by excluding everything is not a fix.

### 3. Then, and only then, propose a window
With (1) measured and (2) shipped, recommend a window value (or removing it) **with the resulting
auto_fixable count stated**. Ship the window change only if that count is defensible.

## Prohibitions

- ⛔ **Do not set `DECISION_OWNER_DEED_WINS=on`.** That is Scott's, and not until this round proves
  the set is worth applying.
- ⛔ **Do not POST `owner-deed-autofix`.** GET is a dry run and is the only call this round makes.
- ⛔ Do not hand-edit the 8 rows to make the set look clean.
- ⛔ Do not touch `spe_vs_parent`; its exclusion is deliberate and is a separate question.
- ⛔ Do not change the government view in this round — gov's blocker is a data gap, not a gate.

## Also found, not in scope

The dialysis `v_owner_source_conflict` selects `NULL::numeric AS annual_rent`. Both
`handleOwnerDeedAutofix` and `getActivationReview(which=r51)` order candidates by
`annual_rent.desc.nullslast`, so **the value-ranking is inert for dialysis** — the "top by rent" batch
is really "arbitrary". Worth a row; do not fix it here.
