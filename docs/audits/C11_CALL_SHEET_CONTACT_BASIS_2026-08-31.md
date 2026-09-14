# C11 — the call sheet named a person and never said why they were the contact

**Measured live 2026-08-31 on LCC Opps (`xengecqvemvfknjvbvrq`). One JS change in
`api/operations.js::handleProspectingBrief` + two appended view columns
(migration `20260831140000`, applied). No new table, no cron, no classifier.**

> ## The one-line finding
>
> **121 of the 126 rows on the operator call sheet carry a recorded owner→contact
> relationship whose role is on file, and the sheet printed none of it.** C10 made
> the sheet legible — real owner names, real portfolio values — and legibility is
> exactly what makes an unjustified contact dangerous: the sheet now confidently
> names a person, at scale, with no basis for the operator to weigh.
>
> ⚠️ **`works_at` — the Salesforce org edge P161 measured and disqualified as
> evidence of control — is 12 of the 126 rows carrying $130.7M, more rank value
> than the 35 `institution_decision_maker` rows, and 3 of the current top 10.**
> It was rendering identically to a decision-maker.

## 1. What C10 left standing

| | rows |
|---|---:|
| sheet rows / distinct owners | **126 / 126** |
| carrying a contact email | 113 |
| …whose email domain corroborates the owner | **22** ⚠️ *(brief said 16 — see §4)* |
| …consumer mailboxes | 14 |

All reproduced live. The brief's framing holds: **that corroboration figure is a
LOWER BOUND, not a claim that the rest are wrong** (P188 — a real employee can
use a personal address; Easterly's own confirmed contact sits on
`@centurytel.net`). Nothing in this change filters, ranks or demotes on it.

## 2. The signal we already held and did not print

Reproduced exactly against §2 of the brief, over the eligible 126:

| basis (`metadata->>'role'` on the owner→contact edge) | rows | corroborated | rank value |
|---|---:|---:|---:|
| `prospecting_contact` | **58** | 20 | $714,658,927 |
| `institution_decision_maker` | **35** | 0 | $56,311,959 |
| `manager` | **15** | 0 | $52,442,594 |
| ⚠️ `works_at` | **12** | 2 | **$130,738,989** |
| **no edge at all** | **5** | 0 | $3,590,460 |
| `decision_maker` | **1** | 0 | — |

⚠️ **The value column is the finding the count alone hides.** `works_at` is 10% of
the rows and the **second-largest value block** — 2.3× `institution_decision_maker`
on a third of the count. The weakest evidence sits near the head of the sheet.

## 3. Before / after — the live top 10, rendered

Both columns produced by compiling the **real** map + template out of `git HEAD`
and out of the working tree and running them over the live rows, so the harness
cannot drift from what ships.

```
BEFORE                                     AFTER
1. Boyd Watterson Asset Management, LLC    1. Boyd Watterson Asset Management, LLC
   Email: spencer.hale@mcwhinney.com          Email: spencer.hale@mcwhinney.com
   (no basis stated)                          Contact basis: prospecting_contact

2. Easterly Gov Properties (REIT)          2. …  Contact basis: prospecting_contact
3. NGP Capital                             3. …  Contact basis: prospecting_contact
4. USAA Real Estate            $62.0M      4. …  Contact basis: works_at — ⚠ association only
                                                 (Salesforce org edge), not evidence of authority
5. US Fed Properties Trust                 5. …  Contact basis: prospecting_contact
6. Elman Investors                         6. …  Contact basis: prospecting_contact
7. Gba Associates LP           $27.2M      7. …  Contact basis: works_at — ⚠ association only …
8. TIAA CREF                               8. …  Contact basis: prospecting_contact
                                                 · employer corroborated by email domain
9. Trammell Crow Co                        9. …  Contact basis: manager
10. Beacon Capital Partners    $23.8M     10. …  Contact basis: works_at — ⚠ association only …
                                                 · employer corroborated by email domain
```

Off the top 10, the other two states:

```
Robert Maslow — buyer [domain not on file]
   Email: rosemaslow@voyager.net
   Contact basis: no relationship on file
```

⚠️ **Row 10 is the case that proves the two signals are independent and both
worth printing.** Beacon Capital Partners' contact is `jbrown@beaconcapital.com` —
the domain corroborates the employer perfectly — and the only relationship we
hold is `works_at`. Corroborating *where someone works* says nothing about
*whether they decide*. Collapsing the two into one "confidence" would lose that.

## 4. ⚠️ The brief's corroboration figure was an argument-shape artifact — it is 22, not 16

C10b reported **16 of 113**. Reproduced: 16 comes out only when the **whole
domain** is passed to `lcc_tier0_company_confirms_domain(p_company, p_sldn)`.
`p_sldn` is the **second-level label**, not the domain. The function is
bidirectional substring containment between `lcc_owner_domain_core(company)` and
`p_sldn`, so passing `beaconcapital.com` where it wants `beaconcapital` silently
kills the **reverse** arm — an owner core never contains a `.com` — and loses
every domain-abbreviates-the-owner case.

Six rows, **all genuine, all read correct on named rows**:

| owner | `lcc_owner_domain_core` | mailbox | recovered by |
|---|---|---|---|
| Truist Bank | `truistbank` | `truist.com` | dropping the TLD |
| Brookfield Asset Management | `brookfieldassetmanagement` | `brookfield.com` | dropping the TLD |
| Highwoods Properties | `highwoodsproperties` | `highwoods.com` | dropping the TLD |
| Beacon Capital Partners | `beaconcapitalpartners` | `beaconcapital.com` | dropping the TLD |
| Acquest Development LLC… | `acquestdevelopment…` | `acquestdevelopment.com` | dropping the TLD |
| **TIAA CREF** | `tiaacref` | `tiaa-cref.org` | the **alphanumeric strip** |

The view therefore reuses `v_lcc_tier0_owner_contact_candidates`' own `sldn`
expression **verbatim** rather than inventing a second one — a hand-rolled copy
of a normaliser is the drift this codebase keeps paying for (P189, A2, N15c).
⚠️ Note `lower()` runs **before** the `[^a-z0-9]` strip; the other order deletes
every uppercase character.

**The correction makes the lower bound less alarming, and it is still a lower
bound.** 22 of 113 is not "91 are wrong".

## 5. Where the fact lives, and why

Two appended columns on `v_bd_cadence_dashboard` (positions 38–39), exactly as
C8 did for `is_resolved_owner` / `is_brokerage`. The POLICY — how a role renders,
what is flagged — stays in JS.

- **`contact_owner_role`** — `COALESCE(NULLIF(btrim(metadata->>'role'),''), relationship_type)`
  off the owner→contact edge. **NULL means "no relationship on file"**, a
  different fact from a weak role, carried as null so the renderer can say so.
- **`contact_domain_confirms_owner`** — P197 employer corroboration.
  **Additive positive only.**

### ⚠️ The C8 pre-aggregate precedent is the wrong shape here — measured, not assumed

C8 pre-aggregates (`SELECT DISTINCT owner_entity_id FROM lcc_property_owner`)
specifically to avoid a correlated probe, so that was the obvious thing to copy.
`entity_relationships` holds **115,726 rows** against `lcc_property_owner`'s
8,636, and a `DISTINCT ON (from, to)` pre-aggregate materialises the whole table
on every read. Measured on the handler's **real** query shape (its filters plus
`order=rank_value.desc.nullslast,days_overdue.desc.nullslast&limit=10`):

| shape | wall clock | buffers |
|---|---:|---:|
| baseline (no basis columns) | 275–282 ms | 99,528 |
| **`LEFT JOIN LATERAL … LIMIT 1` (shipped)** | **253–259 ms** | **106,126** (+6.6%) |
| pre-aggregated `DISTINCT ON` | 649 ms | 184,857 (2.6× slower) |

The LATERAL is a BitmapAnd index probe at `loops=2304`, ~8,613 buffers. Raw
timing is session-variable, so the durable evidence is the **buffer count and the
plan shape**, not the clock.

### ⚠️ Fan-out, direction and the inert fallback — all three measured

- **Fan-out.** `entity_relationships` has **no unique constraint** on
  `(from, to, type)` (P177 says so explicitly). Today: 753 of 1,702 cadence pairs
  carry an edge, `max_edges = 1`, **0 rows with conflicting roles**. `LIMIT 1`
  makes that structural rather than lucky; the `ORDER BY` (still-effective edge →
  newest → id) makes the pick **deterministic** instead of whatever the plan emits.
  A `DISTINCT ON (c.id)` view would have hidden a future fan-out as a silent
  arbitrary pick, not as a row-count change.
- **Direction is owner→contact only, and that is a measurement**: across all 1,702
  cadence pairs there are **753 forward edges and 0 reverse-only**. Probing both
  doubles the cost for a population of zero. A future reverse edge reads NULL and
  the sheet says "no relationship on file" — it **fails toward under-claiming**.
- **The `relationship_type` fallback is inert and kept anyway**: all 753 edges
  carry `metadata->>'role'`, and `relationship_type` is `associated_with` on all
  753 — a token stating an edge exists without stating a role. If it ever fires
  the sheet prints it verbatim, which is honest.
- ⚠️ **The corroboration is computed OUTSIDE the role LATERAL, deliberately.** The
  two facts are independent, and folding it in would make it NULL for every
  edge-less row — **all 5 of which carry an email**, so "no relationship on file"
  would have silently swallowed a computable signal.

## 6. ⚠️ The role vocabulary is NOT closed

Fleet-wide the edge roles include `MGR` (1), `broker_of_record` (2) and
`economic_owner_contact` (2) alongside the five in §2. The renderer prints the
token **verbatim** and no consumer may assume a fixed set: an allowlist with a
friendly fallback would swallow exactly the tokens worth seeing — a
`broker_of_record` appearing on a BD call sheet **is** the signal
(`account-based-contact-intelligence.md`: brokers are never prospected as
principal-buyer contacts). Guard-tested against four unexpected tokens.

## 7. Result — asserted against the brief's predictions

| | predicted | measured |
|---|---|---|
| rows served | 126 unchanged | ✅ **126 unchanged** |
| rows showing a role basis | 0 → 121 | ✅ **121** |
| rows saying "no relationship on file" | 0 → 5 | ✅ **5** |
| rows flagged association-only (`works_at`) | 0 → 12 | ✅ **12** |
| gate · ordering · limit | unchanged | ✅ **untouched** — no query, filter, order or limit in the diff |

**View equivalence gate, both directions.** Pre-snapshot vs post over the 37
pre-existing columns: 2,304 → 2,304 rows, **3 rows differing each way**.
⚠️ **The 3 are the wall clock, not the change** — all three have
`next_touch_due = 2026-06-21 19:32:4x`, and `now()` crossed the 70→71-day
boundary at 19:32 UTC between snapshot and diff (`utc_now` read 19:34:02).
Exactly 3 pre-snapshot rows recompute a different `days_overdue` against the
current clock, matching the diff precisely, and **the diff excluding only the two
`now()`-dependent columns is 0 rows in both directions**. Positive-controlled: a
deliberately mutated `entity_name` makes the same detector report 2,304 (P182 —
an implausibly clean zero is a bug signal, so the detector was pointed at a known
positive before its zero was believed).

## 8. What was deliberately NOT done

- **No filter on corroboration.** Dropping ~91 rows on a lower bound would
  re-create the Class 24 mistake C8 has just finished undoing on this very
  surface — excluding real owners because a *label* is missing rather than a
  *fact* being false.
- **No re-rank.** Ordering is `rank_value`; C9a is already an open question about
  that column and this change must not entangle with it.
- **No corroboration classifier.** P188/P196/P198 measured lexical owner↔person
  matching at ~25% raw and 4-of-6 guarded. The edge role is a **recorded fact**.
- **No change to the pitch.** Showing the role does not choose the tone —
  acquisitions vs disposition remains **C4a**, Scott's call.
- **Not routed to Tier 0.** Only **12 of 126** eligible owners appear on the
  Tier 0 confirm lane; that lane selects on a different basis and does not cover
  this population.

## 9. Guard

`test/call-sheet-contact-basis.test.mjs` — 7 tests, **all 10 mutations verified
RED**, control green: drop the basis line · allowlist-with-fallback · render
`works_at` like any other role · warn on every role · null role → `''` · render
corroboration as a negative · drop the positive · client-side filter on
corroboration · PostgREST gate on corroboration · strip the prompt ground rules.

Mostly **behavioural** — it compiles the real map + renderer out of
`api/operations.js` and asserts on what they emit, rather than grepping a literal
that moves (block-slice footgun). Two invariants are structural because they are
statements about what the code must *not* do, and an absence cannot be observed
from one row's output.

⚠️ **Comments are stripped before matching, and that is load-bearing:** the fix's
own comments say `works_at`, "association only" and "no relationship on file"
repeatedly while explaining the hazard, so a detector reading raw source would
find every token present and pass over a real regression (the A5c / N18 lesson).

`test/prospecting-brief-column-mapping.test.mjs` (C10) needed the two new columns
added to `VIEW_COLUMNS`, and **that is the guard working**: verified RED against
the shipped handler with the additions removed. Its invariant — every `c.<field>`
the map reads must be a real view column — is what forces the view and the
handler to move together.

## 10. 🔴 Found while shipping — filed, NOT fixed

- **C11a — `institution_decision_maker` is 0-for-35 on employer corroboration**,
  against `prospecting_contact` at 20 of 58. Two lanes with very different
  provenance wearing one sheet. Not a defect on its face; worth a look before
  anyone treats the label as strong evidence.
- **C11b — one cadence contact is Scott himself.** `Edwin K.S. Ryu` (no edge, no
  rank value) carries `contact_email = sabriggs@northmarq.com`. A self-addressed
  contact reaching a call sheet is a capture defect, not a display one.
- **C11c — 2 of the 5 edge-less rows point at a brokerage mailbox**
  (`Patrick R. Luther @srsre.com` — SRS Real Estate Partners;
  `Ryan Gaylord @triprop.com`). The owner-name brokerage guard (`is_brokerage`)
  reads the OWNER, and these owners are person-named individuals, so it cannot
  see a broker in the *contact* slot. The sheet now says "no relationship on
  file" on both, which is honest and is the first time either was visible.

## 11. Verify

```sql
-- must stay 126; this change touches no selection logic
select count(*) from public.v_bd_cadence_dashboard
where workspace_id='a0000000-0000-0000-0000-000000000001'
  and phase not in ('paused','unsubscribed') and contact_id is not null
  and (owner_role in ('developer','user_owner','buyer','seller_flipper','operator')
       or is_resolved_owner is true)
  and is_brokerage is false;

-- and the basis distribution must read 58/35/15/12/5/1
select coalesce(contact_owner_role,'<NO EDGE ON FILE>') basis, count(*),
       count(*) filter (where contact_domain_confirms_owner) corroborated
from public.v_bd_cadence_dashboard
where workspace_id='a0000000-0000-0000-0000-000000000001'
  and phase not in ('paused','unsubscribed') and contact_id is not null
  and (owner_role in ('developer','user_owner','buyer','seller_flipper','operator')
       or is_resolved_owner is true)
  and is_brokerage is false
group by 1 order by 2 desc;
```

Then **read the sheet** — legibility of the *basis* is the deliverable, not a
count. ⚠️ **If the row count moves, something is wrong**; find the mechanism
before adjusting anything.

⚠️ **The view half is LIVE NOW; the JS half is not.** The two appended columns
ship instantly (a migration applied to the DB), the renderer ships only on the
next Railway redeploy of merged `main` — the half-applied deploy this repo has
documented repeatedly. Confirm with `/version` + `git merge-base --is-ancestor
<sha> <deployed>`, never by probing the handler (`/api/*` is auth-enforced; a
`401` body greps as "the field is absent").
