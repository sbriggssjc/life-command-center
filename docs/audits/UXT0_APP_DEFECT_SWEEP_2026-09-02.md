# UX-T0 — the app defect sweep of 2026-09-02: measured, then fixed at the source

> Closes the T0 tier of `docs/architecture/app-ux-review-2026-09-02.md` §2.
> Twenty items. **Nine were real defects and are fixed. Four were real and are
> owned elsewhere. Four hypotheses in the review were REFUTED by measurement.
> Two removals were refused on measurement — that is the user's call, not mine.**
> One (UX1) could not be root-caused from the sandbox and was made diagnosable
> instead of being guessed at.

## 0. The result table

| id | measured | verdict | fix | delta |
|---|---|---|---|---|
| **UX1** | `v_bd_cadence_dashboard` = **2,119 ms / 313 actionable rows**, well inside the 8 s PostgREST and 12 s client limits. The view is healthy, so the failure is in the REQUEST path — and the tile rendered ONE string for a 401, a 500, a timeout and a network error. Sandbox cannot reach the live host (`/version` → `http=000`). | **defect, not root-caused** | tile now names the cause (`_outreachFailureReason`) + logs it | unmeasurable → diagnosable on Scott's next load |
| **UX10** | Overview headline reads `v_available_listings` (**462**, 461 after the client blank-filter); Deals ▸ Availables uses `v_dia_on_market` (**207**). Same question, two views, **2.2×**. | **defect** | headline repointed at the canonical `diaData.onMarketRows` | **461 → 207** |
| **UX11** | 1,400 of 1,400 verification rows in 7 days are the cron's `auto_scrape`/`inferred_active` timer advance. Evidence lane last wrote **2026-08-06**. `asking_price_at_check` non-null on **69 of 13,837**, none since 2026-05-05. | **defect (two)** | the 76et-E migration — written 2026-04-29, **never applied on either domain** — applied to dia+gov; drilldown now opens on `evidence` | card reads `0 evidence/7d · 1400 cron-only/7d` instead of `1400 checks/7d` |
| **UX12** | Sale 14832 **already carries `is_northmarq = true`**, `listing_broker = 'Team Briggs / Northmarq'` (382 of 4,785 sales flagged). `sf_deal_id` is non-null on **0 of 4,785**. | **half refuted / half real** | none — see §3 | flag is set in the DB; the deal-book buttons have no data on any sale, ever |
| **UX13** | Kelly's `activity_events` **do land** (7 total, last 2026-08-11). `email_bodies` is **0 for Kelly, Nate AND Sarah**; only Scott has any (30,357). | **refuted as stated** | none — see §3 | not a rejected write; one mailbox is synced, not four |
| **UX14b** | `medicare_clinics.source_last_seen` max **2026-08-31**, touching **249 of 8,547** clinics — one day in 45. | **confirmed, owned elsewhere** | none (operator) | `B6d-cms-restart` |
| **UX20** | `loadMarketing().then(() => renderDomainProspects(...))` writes Pipeline into the shared `#bizPageInner` with no check that its tab is still current. Deals' group default IS `prospects`, and `loadMarketing` is the slowest load in the app. | **defect** | `renderDomainProspectsIfCurrent` on all **7** deferred renders | last-writer-wins race removed |
| **UX22** | not separately measured — the blank-field census is a per-column exercise on `rpc_query_comps` | **not measured** | none | see §4 |
| **UX23** | not measured — needs the record Scott had on screen | **blocked on a named record** | none | see §4 |
| **UX26** | `sum(canonical_total_properties)` over the 16 distinct canonicals = **exactly 500**. | **REFUTED** | none | the 500 is real, not `limit: 500` leaking |
| **UX27** | "Total Buyers (all)" sat beside "Total Deals" that was **top-50 only**. | **defect** | every tile title carries its own scope; dataset totals reported beside | two populations no longer read as one |
| **UX28** | Top-50 by volume: rank 1 `Sumitomo Bank Leasing And Finance Inc` ($267.7M) and rank 4 `Sumitomo Bank Leasing and Finance, Inc` ($199.2M) — **one buyer, split**. | **defect** | punctuation-insensitive party key | the split closes; **38** spelling-variant groups fold |
| **UX29** | `seller_type` **is not a column** on dia `sales_transactions`. Every request 42703'd; `diaQuery` returned `[]`. | **defect** | column removed from the select; both Players loads opt into `throwOnError` | **0 sellers / $0 → 2,142 sellers / $13.48B** |
| **UX30** | `listing_broker_id` non-null on **1,027**; name-with-no-id **1,086**. Matches BR2's post-fix figures. | **owned elsewhere** | none | → **BR3** |
| **UX31** | `building_size`: median **8,646 sf**, mean **24,044 sf**, max 2,507,852; 357 rows carry a whole building's RBA. | **defect** | tile reports the **median**, labelled, with p95 in the sub | **24,044 → 8,646** |
| **UX34** | `v_cms_data` executes in **6,965 ms** against an 8 s PostgREST `statement_timeout` — 87% of budget, warm cache, page 0 of 8. | **defect, partly fixed** | `VACUUM (ANALYZE) facility_patient_counts` applied | worst node: **heap fetches 176,763 → 0**, that node 2,631 → 149 ms; total 6,965 → 5,720 ms. **Still not safe** — see §4 |
| **UX37** | — | **owned elsewhere** | none | → **K13–K18** |
| **UX39** | The `national_st` CM vertical has **18 live views and 480 rows**; the tab is the **only** route to `renderNatlStCapitalMarkets` and its RCA upload card. | **removal REFUSED** | none | see §2 |
| **UX41** | `all_other` holds **6,245** opportunities — the largest domain bucket. Prospects is a **search box with no list**; All Other is the browsable list. | **removal REFUSED** | none | see §2 |
| **UX48** | Roster = **42 rows**: ~21 email local-parts, 3 system mailboxes, one literal `" <>"`, and **four** Scott Briggs rows (3 operators at zero, 1 owner with all the work). `lcc_users` says the team is **4 people**. | **defect** | `is_team_member` appended to `v_manager_overview`; roster shows the team and states the suppression | **42 → 4** |

## 1. The four refuted hypotheses — read these before re-filing them

The review doc named a plausible mechanism for each T0 row. Four were wrong, and
each was wrong in a way worth keeping:

- **UX26 — "500 is the round-number tell."** It is not. The loader really does
  pass `limit: 500`, and the lane really does say 500 — and those two facts are
  **a coincidence**. `sum(canonical_total_properties)` over the 16 distinct
  canonicals is exactly 500. The genuine finding is the one already on file
  (OWN1): the lane is a readout of 38 hand-written regexes covering 72 of 7,262
  owners, and it does not say so. **A number that matches a query window is a
  hypothesis, not a finding — check the arithmetic before "fixing" the count.**

- **UX11 — "the feed is built on the NULL price columns."** It is not: the
  drilldown selects `id, listing_id, verified_at, method, check_result, notes,
  source_url` and never touches `asking_price_at_check`. The "no update" text is
  the cron's own note, rendered faithfully. **The feed was honest; what it was
  honestly reporting is that nothing has been verified with evidence in 27 days.**
  Both the NULL price columns and the dead evidence lane are real, and neither is
  what the operator was looking at.

- **UX13 — "P116 rejected Kelly's writes."** Her `activity_events` land fine. The
  measurement that matters is one column over: `email_bodies` is 0 for Kelly,
  Nate *and* Sarah. **It is not a broken write for one user; it is one configured
  source mailbox for four people.** That is an operator/Power-Automate step, not
  a code fix, and it would have been missed by looking only at Kelly.

- **UX12 — "the Team Briggs flag is missing."** It is set. `is_northmarq = true`
  on sale 14832, one of 382 flagged sales. What is genuinely absent is
  `sf_deal_id`, **non-null on zero of 4,785 sales** — so the deal-book buttons
  have nothing to link to on any row. **A button that never populates is a
  producer gap, not a button bug.**

## 2. The two removals, refused

The brief said to delete after checking nothing is lost. I checked, and
something is lost in both cases, so I did not delete. **Scaling this down is
Scott's call to make with the numbers in front of him, not mine to take
silently.**

- **UX39 National ST.** The tab is one nav button and one `else if`, so removing
  it is trivial — but it is the **sole** entry point to `renderNatlStCapitalMarkets`
  and to the RCA upload card, and the vertical is not dead: **18 `cm_natl_st*`
  views, 480 rows in `cm_natl_st_rca_unioned` and `cm_natl_st_volume_ttm_q`**.
  That is the ingestion path for the Single-Tenant quarterly book. Deleting the
  tab orphans it. (`cm_natl_st_top_buyers` is 0 — that is a separate, real gap.)

- **UX41 All Other.** Prospects and All Other are **not duplicative**.
  `renderProspects()` is a cross-project **search box** that renders nothing
  until you type; `renderDomainProspects('all_other')` is a **browsable,
  filterable, paginated list**. And `all_other` is not a rump: **6,245
  opportunities, the largest of the three domain buckets** (gov 3,176, dia
  2,410). Folding it in loses the only browsable surface over the biggest
  population in the system, and Prospects has no list mode to fold it into.

## 3. Found while measuring — filed, not fixed

- **UX48a — the producer.** The roster fix labels the 38 non-members; it does
  not stop something minting `users` + `workspace_memberships` rows from
  correspondence. ⚠️ **`auth.users` cannot be the discriminator** — measured,
  **0 of 42 memberships carry an auth identity, including the real owner row**,
  so "only show people who can sign in" returns an empty roster.
- **UX11a — the evidence producer is dead.** Last evidence-bearing verification
  **2026-08-06** (27 days); 2 rows in 30d against 1,400 cron rows in 7d.
- **UX11b — the `asking_price_at_check` writer is dead**, 69 rows, none since
  **2026-05-05** (120 days). The lvh writer records `prior_asking_price` only.
- **UX12a — nothing has ever written `sales_transactions.sf_deal_id`** (0 of
  4,785).
- **UX13a — one mailbox is synced for a four-person team.**
- **UX34a — `v_cms_data` is still 5.7 s** after the VACUUM, and the dominant cost
  is now a correlated subplan on `clinic_financial_estimates` at **`loops=7534`,
  55,656 buffers** — the documented P118 shape, which needs the aggregate hoisted
  and LEFT JOINed once. The tab also pages it **8 times**, each re-materialising
  the whole view under an `ORDER BY`.

## 4. Not measured in this pass, and why

- **UX22 (comps blank fields)** — a per-column blank census over
  `rpc_query_comps`. Real work, not started; it needs its own pass rather than a
  guess at which columns Scott meant.
- **UX23 (Contacts block on a property's true owner)** — this is the Class-11
  "read named rows" case and I do not have the record from the screenshot.
  Naming one property makes it a 20-minute job; guessing at it does not.

## 5. Durable lessons

- **⚠️ A CONSUMER CAN ASK FOR A COLUMN ITS SOURCE HAS NEVER HAD, AND THE SIBLING
  ARM IS THE POSITIVE CONTROL.** UX29 is C10 at the query layer instead of the
  render layer: `buyer_type` exists, `seller_type` does not, the two arms are
  otherwise identical, and that single difference was the whole defect. **When
  one of two near-identical surfaces works, diff their column lists first** —
  it is one query and it beats reading either renderer.
- **⚠️ `diaQuery` RETURNING `[]` TURNED A 42703 INTO A CONFIDENT `$0`.** The
  2026-08-29 Ownership-lane fix added `throwOnError` for exactly this and left
  ~70 callers on the default. Sellers was one of them. **Any surface whose empty
  state asserts something about the DATA must opt in** — "0 in dataset" is such
  an assertion.
- **⚠️ A TILE'S SCOPE BELONGS IN ITS TITLE, NOT ITS SUBTITLE.** UX27 was not a
  wrong number: "Total Deals" really was the top-50 total and the sub-label said
  so. Two tiles side by side, one counting the dataset and one counting the page,
  read as one population regardless of the small print.
- **⚠️ "TOO LARGE" IS A DISTRIBUTION QUESTION BEFORE IT IS A UNIT QUESTION.**
  UX31 was filed under the I12 acres/sq-ft class. It is not that: the column is
  genuinely square feet and the median is genuinely right. **The mean was the
  defect.** Check the median against the mean before reaching for a conversion —
  a 2.78× ratio names the shape immediately.
- **⚠️ A MIGRATION IN THE REPO IS NOT A MIGRATION IN THE DATABASE.** The 76et-E
  breakout was written 2026-04-29, is correct, and had **never been applied to
  either domain** — while the JS that reads it shipped a fallback comment saying
  "when running against a database that hasn't applied the migration yet". The
  fallback made a permanently-unapplied migration indistinguishable from a
  temporarily-unapplied one, for four months. This is *merged is not running* in
  its quietest form: nothing errored, and the card just kept flattering itself.
- **⚠️ AND BEFORE APPLYING AN OLD MIGRATION, DIFF THE LIVE VIEW AGAINST IT.**
  gov's file is NOT dia's (different lifecycle columns — `listing_status` +
  `exclude_from_listing_metrics` vs `is_active`). Applying dia's body to gov
  would have silently rewritten gov's semantics. The live gov definition was read
  first and matched the file's first nine columns exactly, which is what made the
  apply safe.
- **⚠️ TWO OF MY OWN GUARDS PASSED THEIR OWN MUTATION, AND THE MUTATION PASS IS
  WHAT FOUND IT.** A bare `/is_team_member/` search stayed green when the
  `.filter()` was deleted, because the token also appears in the `_flagged`
  probe one line above; `/_hidden/` stayed green when the disclosure was mutated
  to `if (false)`, because the `const` still declared it. Both are the documented
  "a guard that matches a shape is defeated by a name that legitimately appears
  elsewhere". Re-anchored on the filter expression and on the reachable branch:
  **15/15 mutations RED**.
- **⚠️ COMMENT-STRIPPING IS LOAD-BEARING IN THIS GUARD, NOT HYGIENE.** Every fix
  here explains itself by naming the thing it removed — `seller_type`,
  `diaAvailListings`, `'all'`, `renderDomainProspects(` — so a raw-source grep
  finds all of them present and passes over a complete revert.

## 6. Verify

```sql
-- UX11 (dia + gov): the breakout exists and reconciles
select verifications_last_7d, evidence_verifications_7d, cron_timer_advances_7d,
       verifications_last_7d = evidence_verifications_7d + cron_timer_advances_7d as reconciles
  from v_listing_verification_summary;          -- dia: 1400 / 0 / 1400 / true

-- UX10: the two surfaces now answer with one number
select (select count(*) from v_dia_on_market) as canonical,      -- 207
       (select count(*) from v_available_listings) as broader;   -- 462

-- UX29: the sellers population the tile was hiding
select count(distinct upper(btrim(seller_name))) from sales_transactions
 where seller_name is not null and btrim(seller_name) <> '';     -- 2142

-- UX48: 42 memberships, 4 team members
select count(*) total, count(*) filter (where is_team_member) team
  from v_manager_overview;                                        -- 42 / 4
```

Front-end: `node --test test/uxt0-defect-sweep.test.mjs` (22 tests, **15/15
mutations verified RED**).

**⚠️ Every front-end fix here ships on the next Railway redeploy of merged
`main`; the two view migrations and the VACUUM are live already.** Read
`/version` against the merge SHA before reading any of the front-end deltas as
confirmed — the DB half ships instantly and the JS half does not.
