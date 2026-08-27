# A5 — `true_owner_needs_salesforce`: the lane never stalled, because it was never work

**Diagnosis only. Nothing was built, nothing was written to any lane.** Measured live 2026-08-27
against LCC Opps `xengecqvemvfknjvbvrq`, dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`.

> ## The one-line finding
>
> **`815 open` is not a backlog. It is `1000 − 185` — the leftover slots in a truncated query
> window.** The generator reads a **29,643-row** feed through a call that PostgREST caps at
> **1,000 rows**, then auto-closes every open task outside that window as `gap_resolved`.
> **All 596 "lifetime completions" are that auto-close, and 93% of them are false.**
>
> ## ⚠️ And the same bug invalidates this audit's OTHER headline
>
> The re-audit called gov `property_missing_recorded_owner` *"the healthiest lane in the system —
> 908 completions in 30 days, ~23/day, clears in ~7 weeks. **Leave it alone.**"*
> Measured: its open count is pinned at **exactly 1,000** (the cap), **885 of 885** 30-day
> completions are the same `gap_resolved` auto-close, and of **146 sampled properties, 146 still
> have `recorded_owner_id IS NULL`** — **100% false**. That lane has completed **zero real work in
> 30 days** and cannot clear, because its open count is a constant. It was not left alone because
> it was healthy; it was left alone because the instrument reads a constant as throughput.

---

## 1. Cliff, not slope — and the cliff has a date

Completions per week, whole lifetime (`research_tasks`, `research_type='true_owner_needs_salesforce'`):

| week | completed | skipped |
|---|---:|---:|
| 2026-06-01 | 28 | 0 |
| 2026-06-08 | 169 | 0 |
| 2026-06-15 | **303** | **849** |
| 2026-06-22 | 57 | 0 |
| 2026-06-29 | **1** | 0 |
| 2026-07-13 → 07-27 | 5 / 7 / 21 | 0 |
| 2026-08-10 → 08-24 | 3 / 1 / 1 | 0 |

A **cliff at 2026-06-22**, not a decay. The 849 `skipped` are a single bulk `r21_dedup_collapse`
on 2026-06-15 — not work either.

## 2. Nobody ever worked a single one of these

`outcome` has exactly **two** distinct values across all 1,445 terminal rows:

| outcome | status | n |
|---|---|---:|
| `"gap_resolved"` | completed | **596** |
| `{"reason":"r21_dedup_collapse",…}` | skipped | 849 |

`gap_resolved` is written in one place — the auto-close arm of `handleGenerateResearchTasks`
(`api/admin.js`, the `if (feed.length < limit)` block). It means *"this key is no longer in the
feed"*. **It is not a human, a worker, or a resolution.** There is no verdict path, no
`completed_by`, no evidence anywhere that anyone opened one of these tasks.

**So the re-audit's premise — *"proven consumable, the machinery demonstrably worked and then
slowed to ~1/week"* — is refuted.** The machinery never worked. It emitted, and then it
silently unemitted.

### 2a. And 93% of those closures were false

Sampled the 200 most recent completions → **183 distinct** true_owners (17 were *repeat* closures
of the same owner). Checked each against dia `true_owners`:

| | n |
|---|---:|
| checked | 183 |
| owner row deleted (a legitimate way to leave the feed) | **0** |
| genuinely linked (`salesforce_id` now set) | **13** |
| **still `salesforce_id IS NULL` — the gap never resolved** | **170 (93%)** |

## 3. The mechanism, end to end

1. Cron **34** (`06:35`) posts `generate-research-tasks&domain=both&limit=2000`; cron **35**
   (every 30 min) posts `limit=300`.
2. `fetchNbaFeed` asks the `data-query` edge function for `v_next_best_research`
   `order=priority.desc&limit=2000`. The edge fn's own `MAX_LIMIT` is 10,000, so it passes 2000
   through — but **PostgREST caps the response at 1,000 rows** (the invariant already documented
   in `CLAUDE.md`).
3. The dia feed is **29,643 rows**. The app sees a **1,000-row truncation**.
4. `v_ownership_gaps`'s salesforce arm is `FROM true_owners WHERE salesforce_id IS NULL` with
   **`20 AS priority` — a hard-coded literal**. There is no value term and **no tiebreak** in the
   sort.

   | band | rows |
   |---|---:|
   | priority **> 20** (all `property_missing_recorded_owner`) | **185** |
   | priority **= 20** (all `true_owner_needs_salesforce`) | **6,324** |
   | priority **< 20** | 23,134 |

5. So the window is `185 + 815`. **Open tasks: exactly 815.** Simulating the real query returns
   **185 + 815** by research type — an exact match, not a coincidence.
6. **The auto-close guard is comparing the wrong two numbers.** Its own comment says *"never on a
   capped slice"* — but it tests `feed.length (1000) < limit (2000)`, the **requested** limit, not
   the **returned** cap. The test passes, so the auto-close fires over a truncated feed and closes
   every open task outside the window as `gap_resolved`.
7. **The cliff is the date the window saturated.** Once the top 1,000 is stably filled, nothing
   enters or leaves except when the `>20` band moves. Churn evidence: **2,260 tasks over 1,152
   distinct owners = 1.96 tasks per owner** — create, falsely close, re-create.

**Consequence: 5,509 of the 6,324 real gaps have never had a task at all.** The lane is not
815 deep. It is 6,324 deep and only 815 are visible, arbitrarily chosen by an untied sort.

## 4. The residue, measured on the 6,324 real gaps (not the 815 artifact)

| class | owners | properties held | verdict |
|---|---:|---:|---|
| owns **zero** properties | **5,338 (84%)** | 0 | **unanswerable and worthless** — orphan owner rows |
| owns property but is an **operator** (`is_operator_not_owner`) | 20 | 5,131 | P113 trap — the tenant in the owner slot |
| owns property but the name is a **placeholder** | 3 | 96 | `Independent`, `Other`, `State Owned` |
| **real prospectable owner** | **963** | **1,215** | the genuine population |

**81% of the apparent value is not owners.** Ranked by property count the head reads
DaVita Inc. **2,626**, DaVita Kidney Care **1,183**, `Independent` **754**, U.S. Renal Care **342**,
`Other` **110** — operators and literal placeholder strings carrying **5,227 of 6,442** properties.
Any value-ranking built without those two guards would put DaVita at the top of a lane whose
purpose is prospecting owners.

⚠️ **`properties.estimated_annual_revenue` is CLINIC operating revenue, not owner rent.** Summing it
over this population gives **$45.5B**, which is not a BD value signal and must not be quoted as one.

## 5. The P131 category — the lane is a mixture, and each part gets a different answer

Resolved **ID-to-ID, never by name**, per `CLAUDE.md`: dia `true_owner_id` →
`external_identities(source_system='dia', source_type='true_owner')` → does that entity carry a
`salesforce/Account` identity? (Prefix join verified sound: **0 ambiguous 8-char prefixes** across
all 7,146 dia true_owners.)

| category | n | verdict |
|---|---:|---|
| **(a) on-box and STRUCTURED** — LCC entity already carries an SF Account identity | **293** (of which **49** own a property) | **deterministic plumbing, no model** |
| **(b) on-box but UNSTRUCTURED** | **0** | **no LLM.** There is no document corpus anywhere stating a Salesforce account id. A model would have nothing to read and would fabricate |
| **(c) not on-box at all** | **~6,031** | neither — Salesforce lookup by a human, i.e. CRM data entry / acquisition |

**This is the third time in this arc a top-ranked "LLM opportunity" measured out as (a) plus (c).**

### 5a. No consumer exists, and the handler that looks like one runs the other way

`api/_handlers/sf-link-reconcile.js` reads `true_owners.salesforce_id` **where it already exists**
and mirrors it onto the LCC entity. It is the *downstream* of this lane, not its consumer. The only
code that ever *fills* `salesforce_id` is Python in the **Dialysis** repo
(`match_prospect_sf_leads.py`, `ownership_linker.py`, `crm_enrichment.py`) — name-matching against
Salesforce Accounts, and not on any schedule this audit could find.

**Also a data-hygiene note:** of the 822 rows that *are* linked, some carry `003…` **Contact** ids
in a field meant for `001…` **Account** ids — already flagged by `sf-link-reconcile.js` Unit 3.

## 6. Recommendations, sized — nothing built here

| id | what | size | why now |
|---|---|---|---|
| **A5a** | **Fix the truncated-feed auto-close.** Compare against the **returned** row count, not the requested `limit`; page the feed; add a stable tiebreak to the sort. | Stops **~900 false closures/month** across **all** dia+gov NBA lanes; unpins two lanes frozen at exactly 1,000 and 815 | **Correctness bug, not a lane fix.** It is currently manufacturing the throughput number the whole re-audit was ranked on |
| **A5c** | **Value-gate the producer.** Require ≥1 property held, not an operator, not a placeholder name. | **6,324 → 963.** Makes the lane finite and reachable | The producer has no value gate at all — `20 AS priority` is a literal |
| **A5d** | **Deterministic on-box fill** for the 293 via the ID-to-ID `external_identities` join, fill-blanks, reversible, no model. | **293 owners (49 owning property)** | The answer is already held; this is plumbing |
| **A5e** | **Retire the 5,338 zero-property owners** with a re-open predicate (owner acquires a property). | −5,338 | Retirement is the honest fix; they cannot be prospected |

**Order matters: A5a first.** Doing A5c/A5d/A5e while the auto-close still falsely closes tasks
means the repaired lane is re-corrupted nightly.

## 7. Ruled out, so nobody re-walks them

- **"It is four jobs under one label"** (the `establish_ownership_history` shape) — **refuted.** It
  is one job. The predicate is a single `salesforce_id IS NULL`.
- **"A human worked it and stopped"** — refuted; zero human verdicts have ever been recorded.
- **"A producer or config changed on 2026-06-22"** — refuted; nothing changed. The window saturated.
- **"The owner rows were merged or deleted"** — refuted; **0 of 183** deleted.
- **"Seed the answer from Salesforce name-matching"** — out of scope and hazardous: name matching for
  identity is banned by `CLAUDE.md`, and it is what the dormant Python already does.

## 8. Verify (for the prompt that acts on this)

There is deliberately no drain to verify in a diagnosis. The next prompt's gate is:

```sql
-- real completions, not auto-closes
select count(*) from research_tasks
 where research_type='true_owner_needs_salesforce'
   and status='completed' and outcome::text <> '"gap_resolved"';   -- today: 0
```

**Never count `gap_resolved` as throughput.** It is a re-discovery artifact that reads exactly like
work (the P159a trap), and on this lane it has been 93% false for three months.
