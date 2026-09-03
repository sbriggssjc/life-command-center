# PR5d — `costar_cmbs_loan`: 121 rungs for a capture arm that has never fired

**2026-09-03 · LCC Opps `xengecqvemvfknjvbvrq` + both domain DBs · diagnosis, one verdict write.**
Migration `supabase/migrations/20261010120000_lcc_pr5d_costar_cmbs_loan_verdict.sql` (applied live).
Guard `test/pr5d-costar-cmbs-loan-verdict.test.mjs` (12 tests, **21/21 mutations RED**).
Canonical page: `docs/architecture/field-provenance-ladder.md` §4.

---

## 0. The answer

The prompt asked a three-way question — **(a)** no scanner, **(b)** a scanner whose keys the
server drops, or **(c)** a scanner that fires only on a page nobody visits. **It is (c)**, with a
second gate under it on dia that (c) alone does not describe.

| | |
|---|---|
| scanner exists | ✅ `extension/content/costar.js` `parseCmbsLoanDetail` (Round 76ek.b) + `parseCmbsFinancials` (76ek.e) |
| writer exists | ✅ `sidebar-pipeline.js` `upsertLoanRecords` / `upsertPropertyFinancials`, both stamping `costar_cmbs_loan` |
| page reachable by the extension | ✅ `manifest.json` matches `https://*.costar.com/*` (content script + host permission) |
| SPA navigation is not a block | ✅ extraction is `chrome.runtime.onMessage`-triggered and reads `window.location.href` **at extract time**, so a client-side route change to `/loan` is captured normally — the content script is injected once per origin, not per route |
| the arm has ever fired | ❌ **0 rows, anywhere, under any `data_source`** |

**Verdicts written to `field_source_priority.notes`, surfaced as
`v_field_source_priority_triage.pr5d_verdict`:**

| verdict | rungs | tables |
|---|---:|---|
| `page_never_captured` | **94** | gov.loans 34 · gov/dia.property_financials 28 · gov.loan_snapshots 9 · dia.loans 25 (see below) · gov/dia.loan_commentary 8 · gov.loan_top_tenants 4 |
| `page_never_captured_flag_off` | **27** | dia.property_financials 14 · dia.loan_snapshots 9 · dia.loan_top_tenants 4 |

The PR5 `build_pending` verdict is kept underneath (`|| PR5:build_pending …`) — PR5d refines it,
it does not replace it, and `pr5_verdict` still reads `build_pending` on all 121.

---

## 1. The proof that it is not a rename

PR5 measured `loans.data_source` and found no `costar_cmbs_loan`. That rules out the arm writing
under its own name; it does **not** rule out the arm writing under a different one, which is the
`sidebar_capture`-style vocabulary collision PR5 itself catalogued 14 times. So it was tested.

**`costar_loan_id` and `source_url` are written at exactly one place in the repo** — the gov/dia
payload branches of `upsertLoanRecords` (a third occurrence is a `console.warn`). Across **all
2,219 loan rows on both domains**:

| | gov (1,559) | dia (660) |
|---|---:|---:|
| `costar_loan_id` non-null | **0** | **0** |
| `source_url` non-null | **0** | **0** |
| `source_url ~ /detail/lookup/[0-9]+/loan` | **0** | **0** |

Two columns only that arm can write, zero on every row: the loan sub-page has never been captured.
Corroborated by the sibling tables, which only that arm writes:

| table | gov | dia |
|---|---:|---:|
| `loan_snapshots` | **0** | **0** |
| `loan_top_tenants` | **0** | **0** |
| `loan_commentary` | **0** | **0** |
| `property_financials` where `source='costar_cmbs_loan'` | **0** of 98,510 | **0** of 676 |

⚠️ **The single-writer property is what makes the zero evidence rather than an absence, and it is
now guarded.** If a second path starts writing `loans.source_url`, this measurement stops proving
anything and the next reader re-derives a wrong answer with no error anywhere.

---

## 2. What DOES write `loans` — and why it looks like CMBS capture

| `data_source` | gov | dia | first → last |
|---|---:|---:|---|
| `costar_sidebar` | **1,393** | **358** | 2026-03-23 → 2026-08-17 / 2026-04-09 → **2026-09-02** |
| `sec_edgar` | 124 | — | 2026-03-23 → 2026-03-31 |
| `ops_asset_metadata_loan` | 39 | 86 | 2026-08-01 |
| `deed_extraction` | 3 | 1 | 2026-08 |

The live producer is a **different scanner on a different page**: the property page's Public-Records
sale/loan history plus the sidebar stat cards. It derives `cmbs_deal_name` from a lender name
matching a CMBS deal-name regex, which is why gov reads `is_cmbs` **285**, `cmbs_deal_name` 285,
`originator` 1,412 and `special_servicer` 126 — **those look like CMBS captures and are not.**

⚠️ **This SUPERSEDES the mechanism recorded by R54 Unit 3 (2026-06-20)**, which wrote:

> *"the source rows we have don't carry the Performance-section distress data (the captures so far
> are the basic loan layout, not the full CMBS Performance/snapshot walk)"*

The rows are not partial CMBS captures. **`parseCmbsLoanDetail` has never run**, and the rows come
from a scanner that reads a different page entirely. R54's *disposition* was right (no writer
change, nothing fabricated); its *explanation* was wrong, and the wrong explanation is what made the
lane look like a data-coverage question rather than a capture-never-happened question for 75 days.

---

## 3. The second gate: dia is flag-gated OFF on 27 of its 56 rungs

`upsertLoanRecords` gates the snapshot + top-tenants write on `properties.track_cmbs_snapshots`
(gov: *"always tracked"*), and `upsertPropertyFinancials` returns 0 outright for dia on the same
flag. Measured on dia:

```
select count(*) total, count(*) filter (where track_cmbs_snapshots) tracked,
       count(*) filter (where track_cmbs_snapshots is null) unset from properties;
-- total 11803 · tracked 0 · unset 0
```

**False on 11,803 of 11,803.** So capturing the page tomorrow would still write nothing to
`dia.loan_snapshots`, `dia.loan_top_tenants` or `dia.property_financials`. That is a different fact
with a different fix, so it is a different verdict.

The dia `loans` row itself and `loan_commentary` are **ungated** (verified in source — the
commentary loop carries a comment saying so explicitly), which is exactly where the 94/27 split
falls. Both boundaries are guarded.

---

## 4. Is the arm worth building? The demand is named, measured, and has a consumer with zero input

**Yes for gov, and the reason is not the ladder — it is R54's `is_distressed` arm, built and starved.**

`v_loan_maturity_watch` ranks distressed loans to the top of the BD lane. Re-measured today:

| | gov |
|---|---:|
| `v_loan_maturity_watch` rows | 178 |
| of which `is_distressed` | **0** |
| CMBS loans (`is_cmbs`) | 285 across 210 properties |
| of those with `watchlist` / `num_delinquent` / `special_servicing` / `modification` | **0 / 0 / 0 / 0** |
| `loans.dscr` non-null | **0** |

Every one of those fields is captured **only** by `parseCmbsLoanDetail`, and DSCR lands on
`loan_snapshots` (0 rows). R54 measured this 75 days ago and it has not moved. **The consumer is
built, wired and ranked; it has never had an input.**

⚠️ **NOT extended to dia.** dia's half is behind `track_cmbs_snapshots`, which is a deliberate
opt-in nobody has ever set. Turning it on for 11,803 properties is a separate decision (PR5d-b),
not a side effect of a capture fix.

**Verdict: keep `build_pending`, refine it to name the actual blocker, retire nothing.**
Backlog **PR5d-a** (gov capture path) and **PR5d-b** (the dia opt-in).

---

## 5. UX-T1a reconciliation — "the debt D has no LCC table at all"

The UX-T1a Part A audit wrote, of the strongest reason-to-sell signal:

> *"**192 loans maturing inside 24 months** across ~1,204 loan-bearing properties … None of it
> reaches LCC"* · *"the debt D has no LCC table"*

**Both halves were true when written (2026-09-02) and the second is now false.** UX-T1a-gates
shipped `lcc_loan_maturity` on 2026-09-03. Measured today:

| | |
|---|---:|
| `lcc_loan_maturity` rows | **568** |
| of which maturing ≤ 24 months | **192** |
| `v_lcc_loan_maturity_worklist` | 172 |

**192 reproduces exactly** — gov 170 + dia 22 at source, and 192 in the LCC mirror. So the number
was right, the population was right, and the "no LCC table" clause is superseded by the follow-up
the same audit recommended.

⚠️ **And `costar_cmbs_loan` contributed 0 of those 192.** The mirror's sources:

| `data_source` | rows | ≤24 mo |
|---|---:|---:|
| gov `costar_sidebar` | 271 | 104 |
| gov `sec_edgar` | 104 | 58 |
| dia `ops_asset_metadata_loan` | 85 | 12 |
| dia `costar_sidebar` | 41 | 9 |
| gov `ops_asset_metadata_loan` | 38 | 8 |
| dia (null) | 29 | 1 |
| **`costar_cmbs_loan`** | **0** | **0** |

**These 121 rungs are the supply side of a demand that was met from elsewhere.** What the CMBS arm
would add is not maturity coverage — that is now covered — but the **distress** dimension (§4),
which nothing else can supply.

Reconciled in place: `docs/audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md` §recommendations and
`docs/architecture/app-ux-review-2026-09-02.md` gate table (the audit's §237 banner already carried
the correction; the two downstream restatements did not).

---

## 6. What was NOT done, deliberately

- **No scanner built.** The scanner exists and nothing technical blocks it — the manifest matches the
  origin, and extraction reads the live URL when the side-panel button is pressed, so an SPA route
  change to the loan tab would be captured. **The remaining question is purely workflow**: does
  Scott's CoStar session reach `/detail/lookup/{N}/loan`, and does his subscription expose the CMBS
  servicer report there? Neither is answerable from the sandbox.
- **No rung deleted, no priority changed, no `enforce_mode` armed.** Registering/de-registering
  moves merge outcomes in both directions (PR5); arming `strict` on an arm that has never produced a
  row protects nothing and can only break a future write.
- **No fuzzy matching of loan records to properties.**
- **`track_cmbs_snapshots` not flipped.** 11,803 rows of opt-in is an operator decision.

---

## 7. Verify on

```sql
-- the split, and that PR5 survives underneath
select pr5d_verdict, pr5_verdict, count(*)
  from v_field_source_priority_triage
 where source = 'costar_cmbs_loan' group by 1,2;
-- page_never_captured | build_pending | 94
-- page_never_captured_flag_off | build_pending | 27

-- the detector that makes the zero mean something (must stay 0 until a capture lands)
select count(costar_loan_id), count(source_url) from loans;  -- on BOTH domains
```

**If PR5d-a ships, the number that moves is `loan_snapshots` going non-zero and
`v_loan_maturity_watch.is_distressed` leaving 0** — never `field_provenance` under this source name,
which PR8's relabel would suppress anyway unless the rung is on the first-class list (the PR1
lesson: confirm a verification can observe its own success before running it).
