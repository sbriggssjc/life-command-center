# A4b — a P138 guard rejected every SPE named after a street number

**2026-08-27 · gov (`scknotsqkcheojiaewwh`) · migration
`government-lease sql/20260827_gov_a4b_transition_clean_legal_form_gate.sql`, applied live.**
**View-only. No data written by the migration. `all_guarded` 18 → 7.**

---

## 1. The defect, and its real size

`v_ownership_transitions_portfolio` computes `new_owner_is_clean` / `prior_owner_is_clean` from an
inlined disjunction — **twice**, once per side. Two of its arms are address-shaped:

| arm | gate |
|---|---|
| `\m[0-9]{5}\M` — a standalone five-digit token | **none** |
| `^[0-9]+\s` or a trailing street suffix | a legal-form allowlist |

Postgres binds `AND` tighter than `OR`, so the second arm *was* gated and the first was a bare
disjunct. The intent was a ZIP or parcel number pasted into an owner field. The effect is that
**a street number ≥ 10000 disqualifies the SPE named after it** — the single most common owner-name
shape in a government-lease portfolio.

**A4 sized this at 18 tasks. It is wider, and it always was:**

| | |
|---|---:|
| dated gov transitions | 9,595 |
| name slots the 5-digit arm rejects | **70**, across **40** properties |
| …carrying a legal form (i.e. real parties) | **63** |
| …carrying none | 7 |
| guard-passing transitions, before → after | **7,316 → 7,379** |
| newly passing | **70**, across **59** properties |
| newly blocked (the variant pairing, §4) | 7, across 7 properties |

The visible 18 were a lower bound because the arm also drops links **inside chains that did draft**.

## 2. The discriminator was measured, not assumed — and the residue is 3 of 3 correct

Every name the arm rejects was read, not sampled. The split is clean: **the junk carries no legal
form; every real party carries one.**

**Still rejected after the fix — the complete residue:**

```
Houston, Harris County, Texas 77007
Orange, Orange County, California 92866
300-D Westgate Parkway, Amarillo, Texas 79121
```

All three are pasted addresses, and **nothing else in the predicate catches them** — the first
matches no other arm at all. So the arm is **narrowed, never deleted**: removing it wholesale would
trade one silent error for another.

**Newly admitted, read by name** (a rate is not a review) — 31 names, of which:

```
EGP 17101 BROOMFIELD LLC     DE 10990 Wilshire, LLC        13151 W Alameda Parkway LLC
EGP 11201 LENEXA LLC         ICON 11013 KENWOOD OWNER POOL 2, LLC
Exeter 16650 Westgrove, LP   25900 GREENFIELD ROAD HOLDINGS, LLC
CA-10880 WILSHIRE LIMITED PARTNERSHIP    JBG/12420 PARKLAWN, L.L.C
11111 GATEWAY WEST INVESTORS LC          1531 UTAH AVENUE SOUTH LIMITED PARTNERSHIP
830 FIRST STREET L.L.C.      321 E. LITTLE TOKYO MASTER, L.L.C.   300 WEST PRATT STREET, LLLP
7799 LEESBURG PIKE, LLLP     2929 NORTH BROAD STREET PARTNERSHIP  …
```

Zero junk. **Positive control (P182):** the detector was pointed at the two casualties A4 named
before any number was trusted, and both appear; 13 named rows were probed against the shipped
predicate with stated expected answers — **13 of 13 correct, in both directions.**

### The 5-digit arm was not the whole defect

A4 identified it; it does **not** explain all 23 unclean rows. The allowlist recognises neither
dotted (`L.L.C.`, `L.P.`) nor spelled-out (`LIMITED PARTNERSHIP` — `\mpartners\M` cannot match
`PARTNERSHIP`) forms, so the *gated* arm rejected real SPEs too. Both are the same question, so both
now share one discriminator. **Load-bearing levers, measured:**

| lever | names admitted |
|---|---:|
| stripping periods before matching | 17 |
| `partnership` | 9 |
| `limited` | 7 |
| `lllp` | 3 |
| `lc` | 2 |
| `incorporated` `companies` `plc` `pllc` `dst` `association` | **0 each** — included as standard forms, reported as measured |

Deliberately excluded: bare `pc` (0 contribution, two letters, large collision surface) and `co`
(collides with ordinary prose).

## 3. The predicate now has ONE owner

It was inlined twice. `gov_owner_name_is_transition_clean(text)` is the single definition, calling
`gov_owner_name_has_legal_form(text)`.

⚠️ **That helper is scoped to this gate and is NOT interchangeable with `gov_owner_strict_core`.**
Strict-core answers a different question (*what is the distinctive core, for identity comparison*)
with a different technique (**punctuation removed**, which is exactly why its own list must exclude
`lc`/`plc`/`pc` — §20 — or they bleed into adjacent letters). Here punctuation survives and word
boundaries hold, so those forms are safe. **The hazard travels with the technique**, so the two
vocabularies differ on purpose and neither may be swapped for the other. The token list is pinned by
a test: a list that quietly loses `partnership` stops describing the population it was measured on
while every count still looks plausible (P195).

## 4. ⚠️ The paired change — without it the fix writes phantom owners

`is_name_variant` was a **strict prefix** test, so a mid-string token deletion slips it. Once
street-numbered names are clean, `10835 CAMARILLO STREET APARTMENTS LLC → 10835 CAMARILLO APARTMENTS
LLC` reads as a real transfer, and A2 (cron 244) writes it as ownership history. A4 flagged this;
it is why the widening ships in the same migration.

**The rule chosen** — equality after removing street-type tokens, reusing this predicate's own
vocabulary rather than inventing a normalizer — fires on **15 rows, and all 15 read as the same
party**:

```
355 GELLERT BOULEVARD, LLC   <->  355 GELLERT BLVD LLC
59 Elm St Partners LLC.      <->  59 ELM STREET PARTNERS LLC
500 PLUM STREET SPE LLC      <->  500 PLUM ST SPE LLC          (x6, both directions)
MCM 6406 IVY LLC             <->  MCM Parkway 6406 Ivy, LLC    (x5 MCM SPEs)
10835 CAMARILLO STREET APARTMENTS LLC <-> 10835 CAMARILLO APARTMENTS LLC
```

**7 of those were ALREADY PASSING**, so this corrects seven pre-existing phantom transfers as well as
preventing the eighth. Checked before claiming harm: `lcc_ownership_chain_apply_log` holds **0 rows**
for all seven properties — **no phantom fact was ever written**, and only 2 of the 7 ever entered the
lane (both `skipped`). The widening is preventive, and saying otherwise would overstate it.

**⚠️ The obvious wider rule was implemented, measured and rejected.** An ordered token-subsequence
test (one name is the other with tokens deleted) drops **108 additional rows across 63 properties** —
a bigger blast radius than the defect being fixed — to prevent one phantom. That is a re-rank of the
whole population wearing a bug fix's clothes.

## 5. ⚠️ A corrected guard is invisible without a re-draft

This is the half that decides whether any of the above is ever *seen*, and it is a different bug from
A4's.

The drafter's `fresh` set excludes any task whose `subject_ref` already carries a proposal — and all
18 `all_guarded` tasks carry the stale `all_transitions_guarded` draft the **old** guard produced. A
view change is live the instant it is applied; the drafts built from the old view are not. Fix the
predicate, change nothing on any surface: the lane never drains and the fix reads as a no-op.

`runA4bRedraftPass` (`api/_handlers/ownership-chain-draft-tick.js`) is the sensor. It runs **before**
the existing-draft read, so the same run re-drafts what it supersedes (06:45 draft → 06:49 A2 apply).

**⚠️ It is keyed on STATE, never on "A4b shipped."** A one-shot supersede is a chore repeated
silently the next time any guard moves (P176 / playbook Class 8). Its predicate is *this task
believes every transfer was guarded away, and the gov view now passes at least one* — so it
self-clears, and it equally covers a property whose records simply improved. It re-uses
`fetchTransitionsFor` and `OCD.guardTransition`; there is **no JS copy** of the SQL name rules, which
a test enforces.

**And no JS mirror of the predicate exists at all** — the planner reads `prior_owner_is_clean` /
`is_name_variant` off the view. The SQL is the single owner; that is why the fix needed no change to
the guard logic in LCC.

## 6. The drain

Predicted with the **real planner** (`buildChainDraft` over the live corrected view), not a
re-derivation:

| action | before | after |
|---|---:|---:|
| `agrees` | 64 | **73** (+9) |
| `mismatch` | 49 | **51** (+2) |
| `sponsor_spe` | 25 | 25 — unchanged |
| `all_guarded` | 18 | **7** |

The 11 stale drafts were superseded, so the lane already reads **`all_guarded` 7** with the 11 in
the modelled `awaiting_draft` transient. They re-draft at 06:45 and cron 244 applies at 06:49.

**⚠️ The predicate is not the verification.** Verify on
`v_lcc_ownership_chain_apply_run_health` (`facts_inserted`, `tasks_completed`) and on
`awaiting_draft` returning to 0 — never on "the guard is fixed", and never on
`links_already_present`.

The 2 `mismatch` are `5379` (`175 JACKSON L.L.C. → BSREP II West Jackson LLC` vs owner *Brookfield
Asset Management*) and `6992` (`10401 FERNWOOD, LLC → TFO REVA Meritage Rockspring Property, LLC` vs
owner *TFO REVA or affiliated investment fund*) — both sponsor↔SPE shaped, i.e. **A3's question, not
a data-integrity failure.**

## 7. The `prior_owner_unclean` / `new_owner_unclean` split (brief §4)

Every one of the 27 rejected rows behind the 18 tasks, before → after:

| before | after | rows | props | what they are |
|---|---|---:|---:|---|
| `prior_owner_unclean` | **passes** | 7 | 6 | dotted/spelled-out forms + street numbers |
| `prior_owner_unclean` | `name_variant` | 1 | 1 | the Camarillo phantom, correctly re-caught |
| `prior_owner_unclean` | `prior_owner_unclean` | 7 | 2 | 6× literal `Unknown` (1429) + 1 concatenated brokerage (7966) |
| `new_owner_unclean` | **passes** | 5 | 5 | street-numbered SPEs |
| `new_owner_unclean` | `new_owner_unclean` | 3 | 1 | `COMM 2014-UBS5 HARWOOD CENTER, LLC` — a CMBS trust, deliberately an artifact |
| `self_transition` | `self_transition` | 3 | 3 | **untouched — A2b's `gsa_lease_diff` flicker** |
| `name_variant` | `name_variant` | 1 | 1 | `PMMC, LTD AND HMUSGS, LLC → PMMC, LTD`, a genuine strict-prefix variant |

**So: `prior_owner_unclean` 15 rows = 8 address-shaped + 7 correct. `new_owner_unclean` 8 rows =
5 address-shaped + 3 correct. No third sub-arm is misfiring**, and the residue in both buckets is
right. `self_transition` was deliberately left alone.

## 8. Sized separately, deliberately not folded in

`is_name_variant` still misses **spaced-letter legal forms and TIC**: `1201 CORBIN, L. L. C.`,
`1325 J STREET L P`, `1329 North Lake Street Tic`, `321 E 2nd St TIC`, `7027 OLD MADISON PIKE, TIC` —
**18 address-arm names** in total, mixed with genuine address fragments (`120 College Ave`,
`MILFORD ROAD`, `401 Focus St`) that are correctly rejected. That is a different rule with a
different blast radius; grading it belongs to its own pass, not to a migration whose numbers were
measured on street-token equality. Filed as **A4b-res**.

## 9. Gates

- **Equivalence, both directions:** an md5 over every column A4b does not touch
  (`new_owner_cleaned`, `prior_owner_cleaned`, `new_owner_true_owner_id`, `is_latest_for_property`,
  `is_self_transition`, `is_oscillating_pair`, ordered by `ownership_id`) is **byte-identical**
  before and after — `dfc9dce45558f0aeff9fa1bab7156e17`. Row count 9,595 unchanged. Only
  `new_owner_is_clean` (+47), `prior_owner_is_clean` (+49) and `is_name_variant` (+15) moved.
- **P157:** the migration raises if the rebuilt view ever comes back `security_invoker` — anon would
  get HTTP 200 with `[]` and a silent freeze.
- **Column list and order unchanged** (`CREATE OR REPLACE VIEW` is append-only, 42P16), pinned by a test.
- **P194:** the migration carries the **whole** view. No committed source for it existed in either
  repo before this file, which is exactly how the next rebuild silently regresses.
- **Tests, all mutation-verified red:** `government-lease
  tests/unit/test_a4b_transition_clean_gate.py` (8 tests / 7 mutations, including re-introducing the
  original ungated arm) and `test/a4b-guard-redraft.test.mjs` (8 tests / 6 mutations).

## Reversal

```sql
-- gov: restore the prior inlined predicate (foot of the migration file), then
drop function if exists public.gov_owner_name_street_key(text);
drop function if exists public.gov_owner_name_is_transition_clean(text);
drop function if exists public.gov_owner_name_has_legal_form(text);
-- LCC: the one-shot supersede of the 11 stale drafts
update lcc_clean_assist_proposals set status='proposed'
 where proposal_id in (536,563,614,663,708,729,757,774,900,925,1021);
```
JS: revert `runA4bRedraftPass` in `api/_handlers/ownership-chain-draft-tick.js`.
