# A4 / A4b — retire the unanswerable 74; adjudicate the 18 that were guarded away

**2026-08-27 · LCC Opps (`xengecqvemvfknjvbvrq`) · migration `20260827200000`, applied live · cron 245**
**A4 retires one bucket. A4b changes no guard — it measures one, and the measurement refuted the brief.**

## The lane

```
establish_ownership_history
  open      256 → 182      completed 288 (unchanged — A4 completes nothing, and should not)
  no_records 74 →   0      agrees 90 · mismatch 74 · all_guarded 18  (all three unchanged)
```

⚠️ **The brief's population was already stale and was re-measured before anything ran.** It said
`agrees` 92 / `mismatch` 73 / open 257; live at start was **90 / 74 / 256** (A2 and A3 landed in
between). The verification target is therefore *`agrees` 90 and `mismatch` 74 unchanged*, not the
brief's numbers — a gate written against a stale baseline fails on work that was correct.

---

# Unit 1 — the 74 `no_records`, retired

## ⚠️ "No records" is the drafter's verdict. It is not "nothing is recorded".

The brief describes these as *"the government records hold no transfers for these properties"*.
Measured on gov (`scknotsqkcheojiaewwh`):

| | |
|---|---:|
| transitions visible in `v_ownership_transitions_portfolio` | **0** |
| RAW `gov.ownership_history` rows for the same 74 properties | **84** |

All 84 are dropped by the view's own base filter
(`transfer_date IS NULL OR prior_owner IS NULL OR new_owner IS NULL`):

| shape | rows | properties |
|---|---:|---:|
| no prior owner, no date | 54 | 50 |
| no prior owner, no date, no new owner | 24 | 24 |
| no prior owner, dated | 5 | 3 |
| **prior owner PRESENT, undated** | **1** | **1** |

**83 of 84 carry no prior owner, and the prior owner is the lane's entire deliverable** — so the
retire is right. But the reason string says `a4_no_usable_transition_on_file`, not "no records": a
retire that overstates its own premise is how the next reader concludes the source is empty when it
holds 84 rows.

**The one exception is named, not lumped** (P181). Property **14280**,
`SUFFOLK VA III FGF, LLC → Boyd Watterson`, from a **county deed**, blocked only by a NULL
`transfer_date`. It is still undraftable today — an undated link cannot be ordered and an ordered
chain is the deliverable — so it retires with the rest, but it is one date lookup from being real
history, and it stays findable in `v_lcc_a4_undated_prior_owner_watch` rather than dissolving into
a bucket it does not belong to.

## ⚠️ `status='skipped'` is NOT terminal to the seeder — the retire would have re-minted nightly

`lcc_generate_chain_research_tasks` (cron 144, 05:10) excludes a property only for an OPEN task or

```sql
status = 'skipped' AND outcome->>'terminal' = 'true'
```

A bare `skipped` is re-minted the next morning, and the retire becomes a chore repeated silently
forever (P176). **Proven at full scale, not assumed:** all **74 retired properties are still in
`v_ownership_chain_worklist`** suggesting this exact research type — i.e. every one of them *would*
be re-minted — and with the flag stamped, **0 would be**.

## …and that stamp is exactly what turns a retire into a delete

So it ships with its inverse (the P121 re-enqueue pattern): `lcc_a4_reopen_tasks()` strips
`terminal`, returns the task to `queued`, and ledgers the reopen.

**⚠️ The re-open sensor cannot live in SQL, and that was measured rather than assumed.** LCC Opps
holds **no mirror of `gov.ownership_history`** — neither `v_ownership_chain_worklist` nor
`v_lcc_ownership_chain_completeness` carries a per-property transition count. The only reader of
`v_ownership_transitions_portfolio` in the entire system is the drafter tick, over `domainQuery`.
So the eye is a re-open pass **inside that tick**, reusing its existing `fetchTransitionsFor`
rather than adding a second gov fetcher that can drift from the one the drafts are built on. It
runs *before* the open-lane read, so a property whose records land is re-queued, re-drafted and —
if it now `agrees` — applied by A2 the same night.

**Stated plainly: the retire is live now; the re-open pass is live on the next Railway redeploy.**
Until that deploy, records landing on a retired property do not bring it back on their own.

### Two defects the live round trip exposed — neither visible to a dry run

**1. `on commit drop` drops at COMMIT, not at statement end.** Two calls in one transaction collide
on the temp table (`42P07`) — reachable in production the moment the tick sweeps gov and dia in one
transaction, which is exactly what the pass does. Both functions now `drop table if exists` first.
Verified: three calls in one statement now succeed.

**2. ⚠️ A re-open that leaves the stale draft in place re-retires the same night.** The drafter's
`fresh` set excludes any task whose `subject_ref` already carries a proposal — and a retired task
still carries the `no_records` draft that got it retired. Without superseding it the re-opened task
is never re-drafted, stays classified `no_records`, and the 06:51 retire closes it again: **a
silent loop that reads exactly like a working re-open**. The pass supersedes the stale proposal for
every re-opened property.

## The re-open, proven end to end

A self-rolling-back synthetic gate on gov, property 4510 (one of the 74):

```
before = 0 transitions → INSERT one dated transfer → after = 1
        prior/new both parties clean, visible to v_ownership_transitions_portfolio
        RAISE → rolled back;  synthetic residue in gov: 0
```

That is the exact read the drafter performs, so the pass would fire. The LCC half was then proven
directly: `lcc_a4_reopen_tasks('gov', ARRAY['4510'], false)` → status `skipped` → **`queued`**,
`terminal` cleared, watch 3 → 2, reopen ledgered.

## Gates

- **Reversal proven on real data before the real run** (the P195 lesson). Capped 3-task apply →
  buckets moved 74 → 71 with `agrees`/`mismatch`/`all_guarded` untouched → re-open one → unretire
  the batch → **baseline restored exactly: 74 / 90 / 74 / 18, 256 open, 0 outcome residue, 0 ledger
  residue.**
- **Ledger 1:1 with the write:** 74 `retired` rows against 74 retired tasks. The count comes from
  the `UPDATE`'s own `RETURNING` set, never from the ledger insert that follows it (A2 defect 2).
- `human_actionable_tasks` **92** = `mismatch` 74 + `all_guarded` 18 — unchanged by the retire,
  which is correct: A4 retired nothing a human was ever going to work.
- `v_lcc_a4_retired_watch` is `retired` MINUS any later reopen/unretire, so the ledger's row count
  can never be mistaken for the population.

---

# Unit 2 (A4b) — the 18 `all_guarded`: a measurement

**No guard was changed. This is the size and the verdict.**

## ⚠️ The brief's leading hypothesis is refuted: there is not one oscillating pair

The brief expected `is_oscillating_pair` to dominate and, if so, for the 18 to retire like the 74.
Measured over all 27 rejected transitions:

| guard | rejected rows | tasks | owners | annual rent |
|---|---:|---:|---:|---:|
| `prior_owner_unclean` | 15 | 8 | 8 | $23.2M |
| `new_owner_unclean` | 8 | 6 | 6 | $4.7M |
| `self_transition` | 3 | 3 | 3 | $4.9M |
| `name_variant` | 1 | 1 | 1 | $0.7M |
| **`oscillating_pair`** | **0** | **0** | — | — |

Each task fires exactly one guard type. **So the 18 must not be retired** — and the reason is
sharper than "no oscillation".

## Two arms of the `*_is_clean` predicate misfire on street-numbered SPEs

Computed per name, not eyeballed — every one of the 15 unclean names was run through each arm of
the gov predicate:

- **`\m[0-9]{5}\M`** (a standalone 5-digit token) fires on **6**: `EGP 17101 BROOMFIELD LLC`,
  `DE 10990 Wilshire, LLC`, `19851-53 NORDHOFF LLC`, `13151 W Alameda Parkway LLC`,
  `22690 CACTUS, LLC`, `10835 CAMARILLO STREET APARTMENTS LLC`. The intent is a zip code or a
  parcel number pasted into an owner field. The effect is that **a street number ≥ 10000 disqualifies
  the SPE named after it** — the single most common owner-name shape in a government-lease portfolio.
- **`^[0-9]+\s` AND no recognised legal form** fires on **5** — and all five carry a legal form the
  allowlist does not recognise: `L.L.C.` / `L.P.` dotted (`175 JACKSON L.L.C.`,
  `321 E. LITTLE TOKYO MASTER, L.L.C.`, `4343 COMMERCE COURT, L.L.C.`, `830 FIRST STREET L.L.C.`)
  or spelled out (`1531 UTAH AVENUE SOUTH LIMITED PARTNERSHIP` — `\mpartners\M` cannot match
  `PARTNERSHIP`). **The digit-leading test is not the defect; the legal-form allowlist is.**

The remaining 4 rejections are **correct**: `Unknown` (placeholder),
`Army Corp. Centre Operating Colliers Turley Martin Tucker` (brokerage — and note
`gov_strip_brokerage_suffix` only strips a `by <brokerage>` suffix, so a concatenated one is
rejected rather than cleaned), `COMM 2014-UBS5 HARWOOD CENTER, LLC` (CMBS trust, deliberately
registered as an artifact), and the three punctuation-variant self-transitions
(`EPA, LLC` → `EPA, L.L.C`, `MAOB, L.L.C` → `MAOB, L.L.C.`, `RGR INC` → `R.G.R, INC.`).

## The discriminator already exists, and the zero was pointed at a known positive (P182)

Over every name the 5-digit arm rejects, the split is clean: the genuine junk carries **no legal
form** — `Houston, Harris County, Texas 77007`, `Orange, Orange County, California 92866`,
`300-D Westgate Parkway, Amarillo, Texas 79121` (a trailing ZIP on a pasted address) — while the
real parties all carry one: `EGP 11201 LENEXA LLC`, `Exeter 16650 Westgrove, LP`,
`ICON 11013 KENWOOD OWNER POOL 2, LLC`, `CA-10880 WILSHIRE LIMITED PARTNERSHIP`,
`25900 GREENFIELD ROAD HOLDINGS, LLC`. Two known false negatives of a pure-allowlist gate:
`11111 GATEWAY WEST INVESTORS LC` (`LC`, not in the list) and `GREEN FAMILY TRUST DATED 10897`.

## Size

| | |
|---|---:|
| `all_guarded` tasks unblocked by waiving the two arms for names carrying a legal form | **10 of 18** |
| …reading as a genuine distinct prior owner on named rows | **9** |
| annual rent behind the 9 | **$16.9M** (of $33.5M for all 18) |
| fleet-wide gov transitions currently rejected only by those two arms | **87**, across **61** properties |
| …of which survive every other guard | **55** |

**⚠️ The 10th is a false positive in my own recovery set, and it names a second defect.**
Property 1429 is `10835 CAMARILLO **STREET** APARTMENTS LLC → 10835 CAMARILLO APARTMENTS LLC` —
the same party. `is_name_variant` is a **strict prefix** test, so a mid-string deletion slips it.
This is the gap CLAUDE.md already records (`1521 N CARPENTER LLC` vs
`1521 North Carpenter Road LLC`), now with a second named instance. Recovering the name arms
*without* widening the variant guard would write one phantom prior owner.

## Verdict

The guards are **not** all correct, so **the 18 are not retired**. The correction is a gov-side
change to `v_ownership_transitions_portfolio` (waive the two address-shaped arms when the name
carries a legal form, and widen the legal-form allowlist to dotted and spelled-out forms), paired
with widening `is_name_variant` past strict-prefix. It is filed as a sized backlog row rather than
shipped here: a guard calibrated on one population must be re-graded on named rows before it moves
(the A2 `strict_core` and A3 `sponsor token` lesson), and 55 fleet-wide transitions is a blast
radius that deserves its own dry run.

---

## What this does NOT claim

- **The lane's completion count did not move.** It is still 288, and A4 should not have moved it:
  retiring an unanswerable task is not completing it. Verify A4 on
  `select action, count(*) from v_lcc_ownership_history_lane_split group by 1` and on
  `v_lcc_a4_retired_watch`, never on `completed`.
- **The re-open pass is not yet running.** It ships on the next Railway redeploy; the retire and
  its reversal are live now.
- **`agrees` (90) and `mismatch` (74) were not touched**, and neither was `all_guarded` (18).
  A2a/A2b own the first, A3 the second, and the A4b finding above is what the third needs.
- **A2a remains blocked** on `lcc_merge_entity` reversibility (P196 Unit 1) and nothing here
  works around it.

## Reversal

```sql
select lcc_a4_unretire('a4-20260827-r1');
select cron.unschedule('lcc-a4-retire-no-records');
-- object teardown: foot of supabase/migrations/20260827200000_lcc_a4_retire_no_records.sql
```
JS: revert the A4 re-open pass in `api/_handlers/ownership-chain-draft-tick.js`.
