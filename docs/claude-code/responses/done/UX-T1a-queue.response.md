# UX-T1a-queue — the doctrine's seller queue as ONE view, gates as named columns

**Measured and applied live 2026-09-03** against LCC Opps `xengecqvemvfknjvbvrq`
(with gov `scknotsqkcheojiaewwh` / dia `zqzrriwuavgrquhisnoa` reached through the mirrors).
Migration `supabase/migrations/20261016120000_lcc_uxt1a_seller_prospect_queue.sql`
(+ `..._perf`, applied). Guard `test/uxt1a-queue.test.mjs` — 22 tests, **24/24 mutations RED**.
**Nothing writes. No cadence change, no Today re-cut, no new lexical rule.**

## The queue

**520 rows / 453 owners / 466 properties.** Three objects, one definition of every gate:

| object | what it is |
|---|---|
| `v_lcc_seller_prospect_universe` | all 8,383 current (owner, property) holdings, every gate as a named column |
| `v_lcc_seller_prospect_queue` | variant F — in band AND (newer lease OR a recorded reason) AND not touched |
| `v_lcc_seller_prospect_queue_summary` | the funnel, each count equal to the rows a filter would show |

Surface: `GET /api/seller-prospect-queue?chip=&domain=&limit=&offset=`
(`api/_shared/seller-prospect-queue.js` + `handleSellerProspectQueue`, mounted in `server.js`).

### The funnel, re-derived

| bucket | rows | owners |
|---|---:|---:|
| universe (post-guard) | 8,383 | 6,219 |
| `value_unknown` | 1,468 | 922 |
| in band | 3,433 | 2,717 |
| …`term_unknown` | 293 | 240 |
| …older lease | 2,855 | 2,305 |
| …**newer lease** | **285** | 260 |
| …reason `debt` | 93 | 65 |
| …reason `developer` | 224 | 170 |
| variant F before reach | 567 | 464 |
| excluded — already touched | 47 | 11 |
| **queue** | **520** | **453** |

By domain: gov 405 / 363 owners, **dia 115 / 90 owners** — dia contributes at all only
because UX-T1a-gates mirrored its lease dates. Reach: `no_linked_person` 384 ·
`in_pipeline_untouched` 97 · `never_touched` 39. 188 of 520 rows sit on an asset with more
than one current owner (the OWN-T0 sponsor↔SPE class), and `owners_on_asset` says so.

## ⚠️ The delta from the audit's 592/495 has TWO causes, and I could not reproduce it line for line

The audit says re-derive rather than quote (§9), and this does not reproduce as a single
adjustment. Attributed as far as measurement allows:

- **Rows are UP** because the dia newer-lease gate is computable for the first time.
- **Owners are DOWN** because this view's `reason_to_sell` carries only the two RECORDED
  arms, while variant F was measured with all four D-arms — including the trust/estate
  regex the audit itself measured at **42% false-positive** (§5c).
- The owner guards cost exactly **5 rows** (2 brokerage + 3 not-prospected; 0 tombstone,
  0 placeholder), measured by running the same predicate with and without them.
- **I did not reverse-engineer the audit's exact predicate to force a match.** The
  numbers above are what the shipped view produces.

## 🚨 The debt arm is keyed on the PROPERTY, and that is a 95-row decision

A loan is secured by a specific asset, so a maturity is a reason to sell **that** building —
not every other building the same owner holds. Measured both ways on the same population:
**owner-scoped 615 rows, asset-scoped 520.** The 95-row difference is entirely owners riding
in on a loan against a different property. Asset-scoping is the conservative reading and is
what shipped; the alternative is stated in the migration so nobody re-derives it as a bug.

## ⚠️ §7b's 89.6% disjointness is TRUE OF THE NEWER-LEASE HALF AND NOT OF THE QUEUE

The number that justified building a new view rather than re-ranking the bands reproduces
**exactly**: of the 285 in-band newer-lease rows, **27** appear in `v_priority_queue_enriched`
at the (owner, asset) grain — the audit's own 27, against its 259.

But the **whole queue** overlaps far more: **181 of 520 (34.8%)** exact pairs are already in
the band queue, and 255 of 520 share an owner with it. That is not a contradiction and not a
reason to merge the surfaces — it is the reason-to-sell half doing exactly what it should. A
maturing loan usually sits on a **late-term** lease, which is precisely what P1/P2/P3 select.
**Quote the disjointness for the newer-lease population, never for variant F**; the two are
different measurements and the second was not in the audit.

Consequence for the surface: this queue **sits beside** the band queue rather than replacing
it. The band queue keeps its six seller-timing bands (694 rows) and its four hidden automated
ones; deleting it would drop the late-term timing signal the doctrine also names.

## The gates, and the states that are not zero

- **`value_unknown` (1,468 rows / 17.5%)** — `value` and `in_band` are **NULL**, never 0 and
  never false. "We cannot price this" and "this is out of band" are different facts.
- **`term_unknown`** — `newer_lease` is **NULL**, never false. "We cannot tell" is not "the
  lease is old."
- **`no_linked_person`** is its own reach state (384 of 520). Folding it into `never_touched`
  would report a prospecting gap where the real gap is a data gap (C11: 847 of 6,480 owners
  have a linked person at all).
- **`reason_to_sell_unmeasured`**, not `none`. Death and divorce are not measurable from
  anything we hold; asserting "no reason to sell" claims an absence nobody tested.

### Newer lease, per swimlane

`gov_within_first_3y_firm` (commencement within 3 years AND firm term still running — gov's
measure is FIRM term) · `dia_ge_12y_remaining` (against the measured 15-year new-build
standard) · `dia_within_first_3y`. **dia's new-build/retrofit lane split has no recorded
fact** and the year_built proxy was measured not to discriminate (§4c), so the uniform
measured standard is applied and no classifier is invented.
⚠️ My dia union reads **70 in-band rows / 64 owners / 52 properties** against the gates
round's 56/53/41 — ordinary drift plus a different per-property lease selection. Re-derive.

### Value ladder

gov `noi/cap` · dia `annual_rent/cap` · gov-without-NOI `annual_rent × 0.703/cap` · else
`value_unknown`. Reproduces the audit's §2 table **exactly** (6,002/2,995/2,604/403 ·
1,203/294/902/7 · 45/17/23/5 · 1,608) — an unlooked-for cross-check that the ladder is the
same one that was measured. **`sale_price` is never the band value** (gov portfolio trades:
ratio p50 0.949 at one property per price, 0.164 at 5+), and the ladder is **not** re-validated
against it (§2a — gov derives `noi = price × cap`, so dividing back is circular and reads as a
clean p75 of exactly 1.000).

## Positive controls

| control | result |
|---|---:|
| a `touched` owner in the queue | **0** |
| a row outside $2.5M–$25M, or unpriced | **0** |
| a row with neither a newer lease nor a recorded reason | **0** |
| variant A (strict, both gates) rows present in variant F | **19 of 19** |
| G1 universe reproduces the audit's 8,858 / 6,480 / 8,068 | ✅ exact |
| §7b newer-lease overlap with `v_priority_queue` | **27**, as measured |

⚠️ **The no-regex control is `0 rows admitted with no recorded gate`, not "no trust/estate
names present".** 6 owners in the queue have "real estate" in the name and 12 match a
trust/estate/DST pattern — every one of them entered on the band plus a newer lease or a
recorded reason. Excluding them would be the destructive half of the P124/A3 trap. What is
proven is that **no name pattern can admit a row**: there is no `~*` or `ILIKE` anywhere in
the classifier, and the guard goes RED if one appears.

## Performance — measured, and one alternative measured and rejected

The handler's real shape (`order=rank_value.desc.nullslast,years_into_term.asc.nullslast`,
`limit 50`): **115,223 buffers / ~819 ms**, down from **118,559 / ~1,208 ms** before scoping
the person-link CTE to current owners. Quote buffers; wall-clock on this box moves 2–4×
between sessions.

Dominant remaining costs, named not hidden: the `links` CTE at **51,854 buffers** (two
index-only scans of the 115,820-row relationship index — the `owners` hash join cannot push
down), and `v_lcc_entity_roles` at **30,640** (inherent to that view). **A LATERAL rewrite of
`links` was implemented and measured at 137,623 buffers — worse — and rejected.** No
`loops=`-shaped correlated subplan is present, so `not materialized` was not needed and was
not added.

The scoping change is also **correctness-neutral and equivalence-checked**: all eleven funnel
buckets and the full `reach_state` distribution are byte-identical before and after, and
`person_link` over current owners is **847** — the audit's own §6a figure.

## Guard

`test/uxt1a-queue.test.mjs` (22 tests, **24/24 mutations RED**). Two layers: behavioural over
the pure surface rules, source over the migration for the SQL-only invariants. Comments are
stripped first and **the stripper is positive-controlled**, because the migration's header
explains every refused shape by naming it.

⚠️ **Two of my own assertions survived their own mutation and were found by the mutation
pass, not by reading them** — both the documented "a guard that matches a shape is defeated by
a name that legitimately appears elsewhere":

1. A bare search for `'reason_to_sell_unmeasured'` stayed GREEN when the SELECT's `ELSE` arm
   was changed to `'none'`, because the **queue view's WHERE clause** names the same string.
   Anchored on `ELSE '…' END AS reason_to_sell` now.
2. A file-wide `merged_into_entity_id IS NULL` stayed GREEN when the tombstone guard was
   deleted from the owner join, because the token legitimately appears in both arms of the
   person-link CTE. Anchored on the `base` join now.

And the guard caught a real defect in my own code before it shipped: `buildPagination` used
`Number.isFinite(Number(total))`, and **`Number(null)` is 0** — so "we could not count" would
have rendered as "there are none", the P180 sentinel class in the one field a pager reads.

## What is NOT done

- **Today is untouched** (UX-T1a-today owns the Significant / Important / Urgent split).
- **Cadence is untouched** (UX-T1a-cadence; it cannot be graded until `current_touch` is
  trustworthy — UX-T1a-touchcount).
- **UX-T1a-regex stays refused.** Death and divorce remain unreachable; the 42%-false-positive
  arm is still not a write, and this view's guard fails if a lexical arm appears.
- **No front-end.** The route returns items + chips + pagination + funnel; rendering it is a
  separate change.
- ⚠️ `UX-T1a-debt-badge` (the summary badge undercounts by 2) is inherited from the gates
  round and still open.
