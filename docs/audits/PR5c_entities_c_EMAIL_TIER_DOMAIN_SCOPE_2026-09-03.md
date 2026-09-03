# PR5c-entities-c — the six named predicates are all refuted; the sibling tier carries the same defect (2026-09-03)

**Verdict: no predicate change. The mechanism was already found, fixed and deployed by
PR5c-entities-b-dupes. The new finding is that the EMAIL tier carries the identical
`&domain=eq.` filter — and removing it was measured at 27% precision and REFUSED.**

Target: LCC Opps `xengecqvemvfknjvbvrq`. Live `/version` = **`9158055a77df`** (read via
`net.http_get` from the DB — the sandbox cannot reach Railway). The brief's `886cdf86` is stale.

---

## 1. The six predicate tests — 6 of 6 refuted on 9 of 11 pairs

The brief located the defect in `findEntityForUpsert`
(`api/_shared/bridge-handlers-salesforce.js:209`), lookup
`entity_type=eq.person & email=ilike.<email> & workspace_id=eq.<ws> & limit=1`, and listed six
mechanisms to test. Every one comes back **negative** for the nine non-race pairs:

| # | test | result across the 11 same-email pairs |
|---|---|---|
| 1 | older row's `entities.email` is NULL | **false on 11/11** |
| 2 | older row's `entity_type` is not `person` | **`person` on 11/11** |
| 3 | case / whitespace / `+` / `%` / `_` / encoding | `lower(btrim())` equal on **11/11**; one (Alexander Moore) differs only in CASE, which `ilike` matches anyway; zero `%`/`_`/`+`/whitespace |
| 4 | `workspace_id` differs or is NULL | **same, non-null, 11/11** |
| 5 | tombstone reading live (`metadata.merged_into`, `[MERGED]` prefix) | **false on 11/11** |
| 6 | the "older" row is itself brand new | **true on exactly 2** — the two races |

So the older row is a live person, in the same workspace, carrying a byte-identical email. **The
lookup as written would have found it.** The defect is not in that predicate, and — as
PR5c-entities-b-dupes established from `bridge_runs` — that handler did not execute for these
rows at all.

## 2. What actually happened (already fixed, already deployed)

| new entity | older→new domain | gap | mechanism |
|---|---|---:|---|
| Joshua Jacobs | lcc → dia | 25d | `cross_domain_canonical_miss` |
| Blaze Katz | NULL → dia | 48d | `cross_domain_canonical_miss` |
| Adam Gallistel | gov → lcc | 97d | `cross_domain_canonical_miss` |
| Nick Taylor | NULL → lcc | 52d | `cross_domain_canonical_miss` |
| John Rooney | NULL → lcc | 35d | `cross_domain_canonical_miss` |
| Frank Johnson | dia → lcc | 120d | `cross_domain_canonical_miss` |
| Sukhpreet Sidhu | lcc → gov | 41d | `cross_domain_canonical_miss` |
| Alexander Moore | lcc → gov | 75d | `cross_domain_canonical_miss` |
| Martin Ding | lcc → dia | 79d | `cross_domain_canonical_miss` |
| W. Aaron Poling | gov → gov | **0.14s** | `intra_request_race` |
| Ransome Foose | dia → dia | **0.14s** | `intra_request_race` |

`d5b0ac8` removed the `&domain=eq.` filter from `ensureEntityLink`'s canonical_name tier and is
**live at `9158055`**. The two races are not addressable by any lookup — they need a unique
constraint on `(workspace_id, canonical_name)`, the open operator decision N15e sized at 6,608
violating groups.

**The 6 firm-change pairs are confirmed non-duplicates** (different email domains, both rows
legitimate — people change firms). Correct treatment is an `entity_relationships` edge, filed not
built (`account-based-contact-intelligence.md` §5a).

## 3. ⚠️ THE NEW FINDING — the fix landed on ONE of two tiers

`ensureEntityLink` has two identity tiers. PR5c-entities-b-dupes fixed the canonical_name tier and
its guard explicitly scoped the other one out: *"the email tier is a separate query and must not be
fed the candidate row (it is unchanged by this fix)."*

**`api/_shared/entity-link.js:1168` — the email tier — carries the identical filter:**

```js
if (domain) epath += `&domain=eq.${pgFilterVal(domain)}`;
```

It is the only remaining `domain=eq.` in the file. This is *"the hazard travels with the
TECHNIQUE, not the name"* (P189) — one round later, in the same function. Both tiers were blind at
once, which is why the nine cross-domain pairs had no fallback.

## 4. ⚠️ REMOVING IT WAS MEASURED AND REFUSED — 27% precision

The population the email tier is blind to: live person pairs sharing a **non-generic** email with
**different** canonical names (so the canonical tier cannot catch them either) and **different**
domains. **55 pairs** — `v_lcc_entity_email_tier_blind_pairs`.

Read on named rows, not counted:

- **15 are the same person under a name variant** — Andy/Andrew Nathan, Carl/Carl J. Verstandig,
  Nicholas/Nick Borrelli, Steven/Steve Karlson, Vince/Vincent Curran, Ravi/Ravindra G. Gangavaram,
  John/John J. Pollock, Michael/Michael L. Glass, Stephen/Stephen L. Owens, Jeffrey/Jeffrey W.
  Cole, James/Jamie Harrison, James/Jim I. Anthony, Gregory/W Greg Geiger, Frank/Frank D. Johnson,
  Randy Blankstein/Blankenstein.
- **40 are not.** Two different **real** brokers on one mailbox (**Phillip Kelly / Toby Scrivner**
  @northmarq.com; Jack Minter / Creighton Stark; David Gellner / Matthew Dodson; Darpan Patel /
  Peter Sibicky; Will Pike / Brian Pfohl). **Firms filed as persons** ("Marcus & Millichap",
  "Kidder Mathews", "Global Net Lease", "Avison Young", "SUMMIT RE"). **P131 document row labels**
  ("Income & Expenses", "Per SF", "Condo Size", "First Vice President", "Executive Vice Chairman",
  "Equity Funds", "This was an all-cash deal.", "Singapore", "Japan", "Foreign", "Government",
  "User", "Condo").

**Precision 27% (15/55)** — the band this codebase has twice measured and rejected: P189's
domain-keyed merge grouping at 25%, P198's co-proposal at 7%. Dropping the filter would
**auto-attach 40 wrong parties at the identity choke point** to prevent 15 duplicates. An attach is
worse than a duplicate: a duplicate is merged later with a reversible, snapshotted
`lcc_merge_entity`; a wrong attach silently folds two people into one row at write time.

**And there is no safe corroboration to substitute.** The canonical tier matches on NAME so it can
require EMAIL to agree cross-domain (that is exactly what `d5b0ac8` did). The email tier matches on
EMAIL, so the symmetric corroboration is a NAME test — fuzzy name matching is banned for identity
throughout this codebase. A structural person-shape gate on the resolved row was considered and
does **not** fix the core case: Jack Minter and Creighton Stark are both plausible real people on
one mailbox.

## 5. Shipped

- **`v_lcc_entity_email_tier_blind_pairs`** (migration `20261012120000`, applied live) — the 55,
  read-only, human review only, **no `auto_mergeable` column** (P198: `lcc_apply_fuzzy_merges()`
  loops on that flag and would merge the 40 wrong pairs unattended). Makes a measured blindness
  *emit* rather than vanish (I4 / B6a) and makes the 27% re-gradeable instead of a claim that rots.
- **`lcc_is_generic_inbox_localpart(text)`** — SQL mirror of `isGenericInboxEmail()`, **pinned
  token-for-token** against the JS Set by the guard (the P195 stoplist-pinning precedent), so the
  two copies cannot drift. Positive-controlled: fires on `info@`, `sales+tag@`, `  INFO@Example.com  `;
  does not fire on `toby.scrivner@nmrk.com`, a malformed string, or NULL. ⚠️ It excludes **0** pairs
  from this population — inert here, not protective.
- **`test/pr5c-entities-c-email-tier-domain-scope.test.mjs`** — 6 tests, **8/8 mutations RED**.
  It pins the filter as DELIBERATE with the reason attached, so a future "finish the job for
  consistency" cleanup goes red rather than shipping the 40 attaches. Comment-stripping is
  load-bearing and population-controlled: the subject and this guard both quote `&domain=eq.` in
  prose, so a raw-source grep finds it present over a complete revert (A5c / N18).

## 6. Verify on

**The 30-day rate query** (the standing metric; `v_lcc_entity_duplicate_mint_review` is the surface):

```sql
with creates as (
  select distinct on (e.id) e.id, e.created_at
  from external_identities ei join entities e on e.id = ei.entity_id
  where ei.source_system='salesforce' and ei.source_type='Contact'
    and ei.created_at >= now() - interval '30 days'
    and e.merged_into_entity_id is null
  order by e.id, ei.created_at
)
select (select count(*) from creates) as creates,
       count(*) filter (where is_probable_duplicate) as probable_dupes
from v_lcc_entity_duplicate_mint_review
where new_created_at >= now() - interval '30 days';
```

Baseline today: **326 creates / 13 landed on an existing live key (3.99%) / 11 probable duplicates
(3.37%)**. (The brief's "14 / 4.3%" does not reproduce — re-derive, never quote.)

⚠️ **THE POST-DEPLOY RATE IS NOT YET MEASURABLE, AND SAYING SO IS THE POINT.** The fix is deployed
(`9158055`) but **zero `salesforce/Contact` identities have been created since it landed** — newest
is `2026-09-02 16:01:40`, the fix committed `22:30`. The code path itself has run (5 entity mints
since, via CoStar), so this is not a dead deploy; the SF producer simply has not minted. *A green
deploy is not an exercised one* — the N15c lesson (drift = 0 proves the backfill, not the
producer). Expect ~0.6% residual, not 0, from the races.

Unmoved and re-checked: `v_lcc_canonical_name_drift` = **0**.

## 7. Filed, not built

- **PR5c-entities-c-race** — the 2 intra-request races need a unique constraint on
  `(workspace_id, canonical_name)` or retry-on-conflict. Blocked on N15e's operator decision
  (6,608 violating groups today).
- **PR5c-entities-c-oldest** — the email tier resolves to `order=created_at.asc` and takes the
  first email match **without checking the resolved row is person-shaped**. Where a mailbox's
  oldest row is a P131 row label ("Income & Expenses" predates the real broker on
  `alex.sharrin@am.jll.com`), an inbound real person attaches to the junk row. This is live
  *within* a domain today and is out of scope here — it is a behaviour change to R39 Unit 1 that
  nobody has graded.
- **PR5c-entities-c-review** — the 15 genuine same-person pairs in
  `v_lcc_entity_email_tier_blind_pairs` are a human merge decision, one row at a time, via
  `lcc_merge_entity` (reversible since P196). No merges were performed here.
