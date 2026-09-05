# Claude Code queue — STATUS

> **START HERE for the current state:** `docs/os/CURRENT-STATE.md` (what is LIVE / flag-gated OFF /
> PLANNED, plus the canonical-doc map). **Everything unbuilt-but-intended:**
> `docs/os/PLANNED-BACKLOG.md`. **Surfaces / comps engine / deploy mechanics:**
> `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`.
>
> **This file is the running work log, newest first.** It is *not* the state of the system — a block
> here was true on the day it was written and may since have been superseded (re-measure a dated
> blocker before quoting it; that doctrine has bitten this file repeatedly).
>
> **Archive:** entries for **2026-08-03 → 2026-08-12** (the comps arc prompts 19–60, the Wave 8
> hygiene campaign, the Wave 9 connectedness build-out, the ChatGPT/Copilot surface rollout, and the
> 2026-08-03 security/deploy-pending notes) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md`](../history/STATUS_claude-code_2026-08-03_to_2026-08-12.md)
> on 2026-08-26 (Prompt 141). Every still-open item from that range was carried into
> `PLANNED-BACKLOG.md`; nothing was dropped.

## 2026-09-05 — SEC1-unit2: gov anon+mutating 5 → 1 · dia dedupe ported · Unit 2 DECLINED with a reason · 🚨 and the branch is NOT on `main`

🚨 **READ THIS FIRST: the privilege changes are APPLIED LIVE and the migrations are NOT MERGED.**
The work sits on `origin/claude/sec1-unit2-anon-gov-triage-01KgcbZF2CgeC8nisk5PEi74`; `main` at
`b22d1c29` does not contain it (the PR merged today was **#2139 ASC39**, a different branch). **A
rebuild from `main` silently restores the anon grants this unit removed.** That is the *"running but
not merged"* class GOVDUP1-a recorded **yesterday**, now landing on our own security work — and it
is the worse direction, because the repo does not describe the database and nothing errors.
👤 **Operator step: merge that branch.** Until then, treat gov's lockdown as un-reproducible.

### Unit 1 — shipped and verified live, gov anon+mutating **5 → 1**

Locked, each `anon` false / `authenticated` false / `service_role` true /
`proacl = {postgres=X,service_role=X}`: **`gov_apply_om_confirmed_noi`**,
**`gov_truncate_sam_public_staging`**, `gov_match_sam_public_extract`, and
`gov_pse_propagate_to_sale` (a trigger — locked for tidiness, not reachability). The single holdout
is **`gov_check_queue_slas`, left anon deliberately** as a monitor-shaped exception with the reason
recorded — *a decision to leave something anon is a result, not a gap.*

⚠️ **`gov_apply_om_confirmed_noi` already carried a `REVOKE ALL FROM PUBLIC` in its migration and
was still anon-executable.** That is the two-grant footgun, live, on a function whose author
believed they had closed it — the clearest confirmation yet of the canonical
`CLAUDE.md` §*SECURITY DEFINER PRIVILEGES* section: **PUBLIC and the explicit `anon`/`authenticated`
grants are independent, and removing one is a no-op for the other.**

✅ **CC did the deployed-caller check GOVDUP1-a earned.** Both real callers of the NOI function were
confirmed to use the **service-role** path before the revoke — `om-comp-resolver.js` via
`domainQuery`, and `ingest_sam_public_extract.py` hard-coded to the service key — then each function
was behaviourally re-probed inside a rolled-back transaction after the revoke. **That is the
sequence: find the caller, revoke, re-probe.**

### Unit 3 — the dia dedupe port, shipped and proven

`trg_dia_sf_staging_identity_dedupe` / `_record` live on dia's `sf_property_staging`. Proven
rolled-back: a fresh staging row for a known `sf_property_id` returns
`linked_property_id = 22008`, `match_method = 'sf_identity_dedupe'` instead of minting. ✅ **Both new
definer trigger functions shipped LOCKED** (`anon` false, `{postgres=X,service_role=X}`) — the
SEC1-definer-default guard working for the **second** consecutive unit.

### Unit 2 — the 62 were triaged and deliberately NOT locked, and that restraint is correct

CC classified them (`docs/audits/SEC1_UNIT2_RESULTS_2026-09-05.md`) and declined to revoke, because
**the deployed-artifact caller search was not completed** — citing GOVDUP1-a's proof that a real
caller can live in an edge function, cron command or PA flow that no repo grep can see. Nine
`*_check_*` health functions are flagged as likely deliberate-anon. **Refusing to revoke 62
functions whose callers you have not enumerated is the right answer**, and it is the same discipline
that made Unit 1 safe. → **SEC1-unit2-lock**.

## 2026-09-05 — GOVDUP1-a SHIPPED: the writer was DEPLOYED BUT NEVER COMMITTED · and yesterday's SEC1 guard worked on its first real opportunity

**PR #2138, verified live.**

🚨 **The producer is `intake-salesforce`, a Supabase edge function on Dialysis_DB — deployed
`version 23`, ACTIVE, while the committed source is v1-era with ~400 lines of drift.** Path:
`handleCrawlComplete → linkProbe(autoCreate=true) → autoCreateProperty()` → a bare POST into
`gov.properties` plus the `_new_property` advisory. **GOVDUP1's search was not sloppy — it read the
committed file, which genuinely has no insert path.** ⚠️ **This is "running but not merged", the
inverse of the doctrine this repo states everywhere, and it is the SECOND instance** (P194: the
extension's hard-coded Vercel URLs, also client-side and also invisible to a repo grep). **A
producer whose deployed code is ahead of the repo is invisible to every code search, and no test,
guard or reviewer can see it.** Confirmed independently: `list_edge_functions` on
`zqzrriwuavgrquhisnoa` shows `intake-salesforce` v23 ACTIVE.

**The defective key, confirmed:** `uq_sf_property_staging_dedup` is
`(sf_property_id, source_system, **import_batch**)` — and `import_batch` changes every crawl, so it
**can never collide**. A dedupe key containing a per-run value is not a dedupe key.

**The fix, proven behaviourally (rolled back):** two `BEFORE INSERT` triggers on
`sf_property_staging` pre-link by `sf_property_id` *ahead of* the mint. A fresh crawl row for the
Rutland `sf_property_id` — the exact shape that minted 154 husks — now returns
`linked_property_id = 36283`, `match_method = 'sf_identity_dedupe'`, confidence 1.0, so
`autoCreateProperty` never fires. ✅ **And it prefers a LIVE row when one exists**: given the
39064 (active) / 39128 (archived) pair it links to **39064**. Linking to an archived husk happens
only when every row for that SF property is archived — which beats re-minting.

✅ **The SEC1-definer-default guard worked on its first real opportunity.** Both new trigger
functions (`gov_sf_staging_identity_dedupe`, `gov_sf_staging_identity_record`) are SECURITY DEFINER
and shipped **locked** — `anon` false, `authenticated` false, `proacl = {postgres=X,service_role=X}`.
The migration carries the stanza because the guard requires it. *That is the first evidence the
guard changes behaviour rather than merely existing.*

**Counts:** `_new_property` advisories still `pending` **220 → 63** (157 resolved this batch, with a
fix to the expiry function, which only asked *does the property exist* — and archiving does not
delete). Live duplicate properties **6 → 3** (18945, 22102, 39064); the two 2026-05-17 rows were
deliberately **left alone** as the sole record at their address, which is the right call —
archiving them would have destroyed real data. ✅ **Guard `test/govdup1a-sf-property-dedupe.test.mjs`:
12/12 mutations RED, 0 survivors — the first genuine full mutation pass of the week**, after three
that reported a strength they did not have.

⚠️ **My "8 still live" in the filing prompt was wrong; the answer is 6.** I counted advisory **rows**
where the population is **properties** — two properties carried two advisories each. `CLAUDE.md`'s
own rule (*state which grain a count is on — rows ≠ assets ≠ owners*) broken by me, in the prompt
that told CC to re-measure everything. CC re-measured and corrected it, which is exactly what the
standing rule is for.

**Open, filed honestly rather than skipped:** the ~400-line deployed-vs-committed drift; sibling
staging tables (comps, listings) sharing the same collision-prone key shape; a dia-side branch of
the same function not covered by this dedupe; and **the real confirmation — that no new
`_new_property` rows appear — needs ~24h**, since the crawl is hourly. Flagged unverified rather
than claimed. → **GOVDUP1-a-residue**.

## 2026-09-05 — SEC1-merge-family Unit 1 SHIPPED: the 7 functions a name-only sweep missed are locked

**PR #2136, verified live.** `anon` false / `authenticated` false / `service_role` true /
`proacl = {postgres=X,service_role=X}` on all seven — dia `dia_consolidate_property_reviewed`,
`dia_reverse_property_consolidation`, `dia_merge_twins`, `p31_property_consolidation_apply`,
`p31_same_event_sales_apply`; gov `p31_property_consolidation_apply`, `p31_same_event_sales_apply`.
Each asserted in-migration with `has_function_privilege()`, and each behaviourally re-probed as
`service_role` **after** the revoke, so the live `domainQuery` caller path is proven unaffected
rather than assumed.

**The census moved by exactly the predicted amount** — the check that a revoke hit its intended
population and nothing else:

| project | definer | anon (was) | anon + mutating (was) |
|---|---:|---:|---:|
| LCC Opps | 196 | 89 (89) | **62** (62) — untouched, Unit 2 |
| dia | 79 | **8** (13) | **4** (9) |
| gov | 54 | **7** (9) | **5** (7) |

⚠️ **A triage axis worth adding, and it cuts both ways.** PostgREST does not expose functions
returning `trigger`, and Postgres does not check `EXECUTE` when a trigger fires — so an anon grant
on one is **not a reachable path**. **gov's 5 is really 4** (`gov_pse_propagate_to_sale` is
B6c-dup's trigger function). But **LCC Opps' 62 is really 62 — 0 of them return `trigger`.** I
expected this to shrink the big number; it does not. Recorded as a hypothesis tested and refuted so
the next reader does not spend the query.

**The residue is NOT one class**, and the sharpest two are on gov: 🚨
**`gov_apply_om_confirmed_noi(p_property_id, p_noi, …)` lets anon write an NOI onto any gov
property** — a curated-value write — and 🚨 **`gov_truncate_sam_public_staging()` takes no arguments
and TRUNCATEs.** Against those, four `*_check_*` monitors are **the `compute_feed_freshness` shape**
and may be deliberately anon for a cross-DB pull; **each needs checking, and a deliberate anon grant
there is a result, not a gap.**

**Units 2 and 3 were honestly deferred, not glossed** — CC recorded the 62 as needing per-function
reads it did not have room to do, and refused the blanket revoke the prompt refused. That is the
right call. → **SEC1-unit2**.

## 2026-09-05 — SEC1-definer-default SHIPPED (the guard exists now) · live census supplied · 🚨 the property-merge family is only HALF locked

**PR #2133.** `test/sql-definer-privilege-stanza.test.mjs`, **13/13 pass**, full suite 4,976 pass /
0 fail. It scans every `.sql` under `supabase/migrations/**` for a `SECURITY DEFINER` function and
requires, **in the same file**, a `revoke … from public, anon, authenticated` **and** a
`has_function_privilege(` assertion. **220 definer-creating migrations, 219 on a path-keyed
allowlist** (verified: 219 entries, 219 unique, 219 resolve on disk) with a stale-entry test that
fails if an entry's file is gone, no longer creates a definer function, or now *has* the stanza —
so the list cannot rot into a lie.

✅ **It is positive-controlled in BOTH directions, which is stronger than the mutation pass I asked
for and did not get:** one test asserts the **pre-fix MERGE1 shape is flagged**, another asserts the
**real MERGE1-sec follow-up migrations satisfy the stanza** — so it is known to fire *and* known to
recognise a genuine fix. It also pins `revoke from public+anon` alone (missing `authenticated`) as
**not** satisfying the stanza — the B6d/OCR2 mechanism encoded as a test rather than prose.
`compute_feed_freshness` / `compute_feed_cadence` are named exemptions with the reason in the file.

⚠️ **My sizing in the filing prompt was wrong, and CC's is right: 220 / 219, not 236 / 154.** My
grep asked whether a `revoke` appeared **anywhere in the file** — so a migration revoking on a
*table* scored as compliant for a *function* stanza it does not have. Scoped properly the repo reads
**233 of 236 lacking**; CC's 220 is lower still because its detector is quote- and comment-aware and
excludes `SECURITY DEFINER` occurring inside comments or string literals. **A grep for "is the fix
present" that does not check what the fix is attached to will always report the reassuring
number** — the same class this very prompt warned CC about, committed in the prompt itself.

✅ **CC caught a real bug mid-build and the refinement is worth keeping.** The repo's standing rule
is *strip comments, then blank string literals* (OCR1c). Applied naively here it broke twice: English
prose inside a SQL string literal desynced quote-tracking, and — the subtle half — **blanking
literals for the STANZA check would blind the guard to every real fix in this repo, because the
production revokes are built with `execute format(...)` and therefore live inside string literals.**
Resolved with a quote/comment-aware state machine, with literal-blanking scoped to *definer
detection only*. **The OCR1c rule is not "blank literals everywhere" — it is per-assertion, and
where the deliverable IS a constructed string, blanking is the bug.**

### The live census the triage doc asked for — supplied from Cowork

CC had no Supabase access and said so plainly. Measured:

| project | definer fns | anon-executable | …mutating | …dynamic SQL |
|---|---:|---:|---:|---:|
| LCC Opps | 196 | **89** | **62** | 1 |
| dia | 79 | 13 | **9** | 0 |
| gov | 54 | 9 | **7** | 0 |

All prior lockdowns spot-checked and holding: the four MERGE1 fold helpers, `gov_merge_property_apply`,
and the three ENTC unmerge functions are `service_role`-only; `compute_feed_freshness` stays anon by
design.

🚨 **The finding: SEC1-property locked the merge functions it NAMED, and the same capability is still
anon-executable under other names.** `dia_consolidate_property_reviewed(p_keep_id, p_drop_id, …)` is
a keep/drop property merge — **exactly what SEC1-property locked** — plus
`dia_reverse_property_consolidation`, `dia_merge_twins`, `p31_property_consolidation_apply` and
`p31_same_event_sales_apply` (**both domains**), and `gov_truncate_sam_public_staging`.
⚠️ **This is the ADDR1b lesson one level up: it applies to the AUDIT, not just the function.**
*"Porting a function carries its logic, not its privileges"* — and enumerating **by name** cannot
find a sibling that does the same thing under a different one. **Before calling a privilege sweep
complete, ask what else can do this, not whether the list was finished.** → **SEC1-merge-family**.

⚠️ **Correction to my own prompt:** I called `lcc_apply_cleared_tombstones` *"the MERGE1 shape"* and
told the next unit to start there. Read live, its dynamic SQL is over a **hard-coded `VALUES` map of
column names**, not a caller-supplied table, and it defaults to `p_dry_run => true`. It still mutates
mirror columns when called with `false`, so it stays on the list — but **below** the merge family.
*A shape matched by a regex over `pg_get_functiondef` is a hypothesis; read the function before
ranking it.*

## 2026-09-05 — MERGE1 SHIPPED (fold-on-collision, both domains) · and its own migration shipped 4 ANON-EXECUTABLE destructive definer functions, found and fixed the same day

**Verified live (PR #2130, commit `344d360e`).** `{dia,gov}_merge_child_policy` seeded from the
measured population; `{dia,gov}_merge_fold_table` + `_{dia,gov}_merge_fold_one_row` created; both
merge functions route `unique_violation` through the fold dispatcher and **gov's old
`_deleted_on_collision` shape is gone** (grep = 0). `gov_property_merge_backup` still **0** —
nothing merged. Lane still 397. Audit: `docs/audits/MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md`.

**The fix is proven behaviourally on BOTH domains, not read off the code** — each re-run inside
`BEGIN … ROLLBACK` after the privilege change below:

| domain | policy exercised | result |
|---|---|---|
| dia | `property_embeddings` → `re_derivable` | 1 row remains on keep; ledger `{"policy":"re_derivable","discarded_re_derivable":1}` |
| gov | `property_financials` → `fold_fill_blanks` | 1 row remains, and the keep row's **NULL `noi` was filled from the drop row (987654.32)** — the value the old code destroyed |

✅ **The new `rewired` ledger reports `folded` / `repointed` / `resolved_in_place` /
`discarded_re_derivable` separately per table**, so a deliberate discard and a loss no longer read
the same — which was the substantive complaint against `_error` / `_deleted_on_collision`.

🚨 **MERGE1-sec — the four new fold helpers shipped reachable by `anon` and `authenticated` on both
databases.** They are **destructive and take a TABLE NAME as a parameter** (`*_merge_fold_table`
runs dynamic `UPDATE`/`DELETE` against whatever table the caller names), so this was **a strictly
worse hole than the one SEC1-property closed three days earlier** on
`*_merge_property_reversible`. The callers were already locked; the helpers they gained were not.
Measured: `proacl = {=X/postgres,…,anon=X/postgres,authenticated=X/postgres,…}`,
`has_function_privilege('anon',…)` **TRUE** on all four.

- **Fixed live on both domains and committed** as
  `supabase/migrations/{dialysis,government}/20260905130000_*_merge1_fold_function_privileges.sql`,
  each carrying a positive-controlled assertion that fails loudly if either role can still reach
  either function **and** if `service_role` cannot. After: anon/auth **false**, service_role
  **true**, `proacl = {postgres=X,service_role=X}`, all four.
- ⚠️ **Third instance of this class in a week** (B6d `compute_feed_cadence`, OCR2
  `<dom>_merge_document_extracted_data`, ADDR1b `gov_merge_property_apply`) and **the first where
  the same PR that fixed a data-loss defect opened a privilege one.** Postgres grants EXECUTE to
  PUBLIC on every new function and Supabase additionally grants `anon`/`authenticated`
  **explicitly**, so `REVOKE … FROM public` alone is a no-op for the two roles that matter.
  **A migration that CREATEs a definer function needs its privilege stanza in the same file.**
  → filed as **SEC1-definer-default** so the rule stops being re-learned.

**Historical losses NOT backfilled** — the 205 dia merges are gone, recorded as a number and a date
(PR12 rule). `dc_twin_verdict` merges from here forward fold instead of destroying.

⚠️ **Stated gap CC recorded rather than solved:** `resolve_status` (dia `pending_updates`) repoints
the row back on unmerge but does **not** restore its original `status`, so that reversal is not
byte-perfect. The row survives; the reversal is lossy in one column. → **MERGE1-resolve-status**.

⚠️ **The response `.docx` was 0 bytes** (Word lock file `~$RGE1…` beside it) — this entry was
reconciled from the merged PR and `docs/audits/MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md` instead.

## 2026-09-05 — SEC1-property SHIPPED (all 4 locked, migrations committed on both domains) · 🚨 the CMBS Loan-tab capture produced NOTHING — the arm is confirmed unreachable, not merely uncaptured · GOVDUP1 drafted, and it REPLACES the planned ADDR1c-twin-lane.

### GOVDUP1 SHIPPED — and the verification found the producer CC could not, plus a merge that cannot be reversed

**Verified live 2026-09-05:** 154 husks archived (`status='archived'`, never deleted) and logged
row-by-row in `gov_property_dup_retire_log` (154 rows, reversible by batch tag) ·
`v_gov_property_duplicate_review` **397 groups / 797 properties** = exact **130 / 263** +
punctuation_only **267 / 534** · `gov_property_merge_backup` **0 — nothing merged anywhere** ·
three zip states kept genuinely distinct (`zip_agrees` **138** / `zip_differs` **24** /
`zip_not_comparable` **235**). All as reported. LCC PR #2127, government-lease PR #397.

**CC's own mid-unit self-correction was right and my prompt was wrong:** I wrote that the 154 husks
were pure (0 owners/leases/sales/documents) having checked four tables. Each husk carries **1
`investment_scores` row and 1 `pending_updates` row** — and `investment_scores` has **no declared
FK**, so enumerating FKs would not have found it either. ⚠️ **This is P160's lesson recurring:
declared FKs are not references; match on the column NAME as well.**

🚨 **CORRECTION 1 — the producer IS identified, and it names itself in the child row CC discovered.**
CC recorded "producer NOT FOUND" after correctly ruling out the SF promotion worker, the CoStar
sidebar and `auto_apply_property_links.py`. But all 154 `pending_updates` rows read
`field_name='_new_property'`, `reason='Salesforce auto-created property — verify accuracy and check
for duplicates'`, and carry **one shared `sf_property_id = a068W00000FbBqwQAF`** with `sf_zip='5701'`
and `sf_state=null` — the husk's exact values, with a different `staging_id` each time. **A
Salesforce auto-create path mints one gov property per staging row and does not dedupe on
`sf_property_id`.**

- **Class-wide: 808 gov properties from 125 distinct SF properties.** 53 SF properties fanned out
  into **736** rows; **8 still live**, newest **2026-08-25** — 11 days before this unit ran.
- **It was already cleaned once, in June** (`junk_backfill_archived_2026-06-09` archived the
  2026-05-17 batch) **and recurred.** P176 exactly, and GOVDUP1 just repeated the one-shot.
- ⚠️ **Why the search missed it: the hunt was keyed on `data_source`, and this producer wears more
  than one label.** Property 39064 (`700 technology dr`, Charleston WV, **`costar_sidebar`**, 08-24)
  and 39128 (`700 Technology Dr`, South Charleston WV, **`unknown_writer`**, 08-25) are the same SF
  property minted twice a day apart under two different sources — **and that pair is in the review
  lane right now.** So Unit 1's husks and Unit 2's duplicate pairs are **two symptoms of one
  producer**. The invariant is `field_name='_new_property'` + `sf_property_id`, never `data_source`.
- **The durable rule: a child row written 1:1 with its parent is a CO-WRITER, not a downstream
  consumer.** CC found the rows and classified them without opening the payload. → **GOVDUP1-a**.

🚨 **CORRECTION 2 — no pair in this lane round-trips cleanly, and it is provable from the indexes.**
CC's Unit 3 probe found `investment_scores` 1, `property_embeddings` 1, `property_financials` 14
rows destroyed on one pair, and concluded *"a pair with disjoint child rows may round-trip
cleanly."* Measured across all 397 groups against the actual unique constraints:

| table | unique constraint | groups colliding (of 397) | rows destroyed |
|---|---|---:|---:|
| `investment_scores` | UNIQUE **on `property_id` alone** | **397 — every group** | 400 |
| `property_embeddings` | PK **on `property_id`** | 334 | 336 |
| `property_financials` | UNIQUE `(property_id, fiscal_year)` | 316 | 585 |

Merging the lane as it stands destroys **~1,321 child rows permanently**. ⚠️ **A collision handler
that DELETEs makes the surrounding reversibility a lie** — the wrapper snapshots child *ids*, while
`gov_merge_property_apply`'s `WHEN unique_violation` arm runs `DELETE`, so the id in the backup
points at nothing. `gov_unmerge_property` is *honest* about it (`_lost` per table plus a `note`) and
honesty is not sufficiency. **This is P196 one layer down** — there `lcc_merge_entity`'s pivot DELETE
destroyed content instead of folding it; here the same shape sits in the generic handler serving
*every* gov child table. **The fix is to FOLD on collision, and it blocks any batch merge.**
→ **GOVDUP1-b**.

**Three smaller residues:** `verdict_hint` is a pure synonym for `address_match` (267/267 `merge`,
130/130 `review` — it reads no other signal, and says `merge` on 10 groups whose zips disagree) →
**GOVDUP1-d** · 154 `pending_updates` still `pending` against archived properties, nothing clears
them → **GOVDUP1-c** · **94 LIVE properties carry a `.0`-suffixed zip** (`95492.0`), the same
numeric-coercion fingerprint as `'5701'`, one of them inside this lane → **GOVDUP1-e**. Guard is
9/9 pass with **3 assertions spot-mutated, not 9** → **GOVDUP1-guard**.

Canonical page: `docs/architecture/gov-property-duplicates.md` (both corrections recorded in place).

🚨 **AND CORRECTION 2 IS LIVE ON dia, WHERE IT HAS ALREADY RUN 205 TIMES.** Checking whether the fix
should be ported found `dia_property_merge_backup` holds **585 merges, 206 with a collision, 205 of
those on a CASCADE table** — and **`dc_twin_verdict`, the human-verdict Decision Center twin lane,
collides on 90 of 116 (78%)**. An operator confirming a twin destroys a child row four times in five
while the surface tells them the merge is reversible.

- ⚠️ **The two domains lose the row by different routes, so a grep for one finds nothing on the
  other.** gov `DELETE`s explicitly and records `*_deleted_on_collision`; **dia records
  `<tbl>.<col>_error`, moves on, and the row dies to `ON DELETE CASCADE`** when the property is
  deleted afterwards (`confdeltype='c'` on `cap_rate_history`, `property_metadata_backfill_queue`
  and one `property_embeddings` FK). **Keying on gov's vocabulary undercounted dia at 76** before
  re-keying on `%\_error` gave 206 — my own measurement, caught in the same session.
- ✅ **The one merge I directed came out fine, and saying so precisely matters.**
  `addr1a_20260904` (37503 → 38953) collided only on **`pending_updates`, a queue row** — all 7
  leases, the deed record, the listing and the document repointed correctly. **"205 merges lost
  data" overstates that row and understates a `cap_rate_history` loss**, so the census must split
  substantive from queue/derived.
- Filed as **MERGE1** (prompt written), which supersedes GOVDUP1-b and puts **dia first because it
  is live**. Fix = FOLD per table with a stated re-derivable / substantive / queue policy.

### GOVDUP1 — sizing the gov "twin lane" refuted the plan to port dia's

Measured before drafting, and **three of the plan's premises are wrong**:

1. **The producer is a spreadsheet, not a capture.** `excel_master` — 9,633 gov properties, all
   created **2026-03-05, one run**. This is not an ADDR1/CoStar-sidebar continuation and must not be
   filed under that arc.
2. **`co-located ≠ twin` is dia's risk, not gov's.** dia's lane exists because a Fresenius and a
   DaVita share a plaza. gov's analogue — two agencies in one federal building — is what a merge
   **fixes**: `1120 E 80th St, MN` carries `MN/WI SERVICE CENTER` on one row and `DHS` on the other,
   and those belong as two leases on one property. **122 of 128 exact-key pairs have BOTH members
   carrying real attachments**, so the operation is consolidation, never deletion of an empty shadow.
3. 🚨 **gov `properties` has NO `merged_into_property_id`.** `gov_merge_property_apply` **hard-DELETEs**
   the dropped row; reversibility is entirely `gov_property_merge_backup`, and it snapshots child
   **ids**, not child **rows** — so children the apply dedup-deleted on `unique_violation` are gone.
   ✅ `gov_unmerge_property` is **already honest** about this (it reports `<table>.<col>_lost` per
   table plus an explicit note) — that is the P196/ENTC lesson already applied; do not "improve" it
   away.

⚠️ **Two measurement traps, both caught before publishing:**

- **The key decides the population and I nearly reported a false retraction.** Re-measuring on the
  exact-string key gave **132 groups / 419 properties** and I was one sentence from writing that my
  earlier **399 / 953** "did not reproduce." It reproduces exactly on the punctuation-stripped key.
  The 267-group difference is `1000 Terminal Dr` / `1000 Terminal Dr.`, `100 NE Loop 410` /
  `100 N.e. Loop 410` — **same city, same state, punctuation only, and the cleanest duplicates in the
  whole set.** *Never report a duplicate count without the key; when a re-measurement disagrees,
  check the key before concluding either is wrong.*
- **`lpad('',5,'0')` is `'00000'`, not NULL.** Sizing zip agreement, an empty `zip_code` normalized to
  a present-and-disagreeing zip: **46 agree / 82 differ / 0 missing**, plausible and wrong. Corrected
  by requiring ≥4 digits before padding: **42 / 15 / 71**. Same family as PR1a's retracted roundness
  statistic, which measured zeros.

**Population, and it is three classes not one:** 399 groups / 953 live properties (normalized key) =
**A** one group of **154 empty husks** (`1085 Route 4 E` Rutland, `data_source='unknown_writer'`,
`state` NULL, zip `'5701'` = VT 05701 leading-zero-stripped, **0 owners / 0 leases / 0 sales /
0 documents**) → a producer defect and a bulk retire, *not* a merge question · **B** 267
punctuation-only groups · **C** 132 exact-string groups, **106 of which differ in city**.

⚠️ **Do not gate on city-string similarity.** The city difference takes three shapes and only one is
a spelling variant: abbreviation (`St Louis`/`Saint Louis`), county-qualified form
(`Lexington-Fayette`/`Lexington`, `New York-Kings`/`Brooklyn`), and **genuinely different
municipality names for one location** (`Essington`/`Lester` PA — both `DELAWARE VALLEY FIELD OFFICE`;
`Sweet Water`/`Miami` FL; `Greece`/`Rochester` NY). A similarity test rejects the third shape, which
is real duplicates.

🚨 **One group must never merge and the lane must exclude it by construction:** address
`international airport`, TX — Brownsville 78521 vs Corpus Christi 78406. **Two different airports
sharing a placeholder string.**

Prompt: `docs/claude-code/prompts/GOVDUP1-gov-property-duplicate-consolidation.md`. **Nothing merges
in that unit** — gov's hard-delete-with-partial-restore is a strictly higher bar than dia's soft
tombstone, so the round trip is proven on this population *before* any batch (P195).

### SEC1-property — verified live, both domains

`dia_merge_property_reversible`, `dia_unmerge_property`, `gov_merge_property_reversible`,
`gov_unmerge_property` — **all four now `anon` false / `authenticated` false / `service_role` true**,
`proacl = {postgres=X/postgres, service_role=X/postgres}`, matching the already-locked precedents.
`gov_merge_property_apply` (locked in Cowork 09-04) confirmed still locked. Asserted with
`has_function_privilege`, never by reading the REVOKE. **Migrations committed on BOTH domains**
(`20261015120000_{dia,gov}_sec1_property_merge_definer_lockdown.sql`) — a privilege applied only live
is invisible to the repo.

- ⚠️ **The safety check was DONE rather than trusted, and the doc would have been the wrong source.**
  The prompt flagged that revoking `anon` could break the `property_twin` Decision Center lane if it
  calls the RPC from the client. `supabase-keys.js` documents a **fallback to the historically-anon
  `DIA_SUPABASE_KEY`** when the service key is unset — so "it's server-mediated" was not safe to
  assume. **The proof used was behavioural:** the same decision lane already calls
  `dia_merge_property`/`gov_merge_property` through the identical `domainQuery` path, and **those two
  were already locked to service_role** — a live, working lane calling an already-locked function
  proves `domainQuery` resolves to `service_role` in production. **That is the right shape of proof:
  a sibling that already works under the constraint you are about to impose.**
- **Caller census:** `dia_merge_property_reversible` has one live caller (the property_twin lane) plus
  an operator CLI; `dia_unmerge_property` only the CLI; **both gov functions have zero callers
  anywhere** (shipped same-day by ADDR1b-merge, not yet wired).
- **SEC1 re-measured and BUCKETED, nothing else revoked:** LCC Opps **89** anon-executable definer
  functions (63 mutating-like / 26 read-only-like) — 89 not the filed 91, reconciling with ENTC's 3
  already fixed; dia **13** (9/4); gov **9** (6/3). `compute_feed_freshness` is anon-executable on
  both domains and was **correctly left alone** — `CLAUDE.md` records that grant as deliberate, and
  revoking it would silently blind the freshness monitor. Named next candidates on dia:
  `dia_merge_twins`, `p31_property_consolidation_apply`, `dia_consolidate_property_reviewed`,
  `dia_reverse_property_consolidation`.

### 🚨 The CMBS capture wrote nothing — and that upgrades PR5d's verdict

Scott captured property **3302 (2100 2nd St SW, Washington DC)** and its **Loan page**. Measured:
- `loans` rows updated in 24h on gov: **0**. Every loan on 3302 still dates to **2026-07-15**.
- **`properties.updated_at` for 3302 is 2026-09-01** — the capture did not touch the property row either.
- **7 `staged_intake_extractions` in 30 hours and NOT ONE carries a loan-shaped key** (`loan*`,
  `cmbs*`, `servic*`, `dscr`, `watchlist`, `maturit*`).
- The only gov entities written in the window (02:05 UTC — Coast Guard, Laszlo Tauber & Associates)
  carry **NULL metadata**, i.e. they are from a sync, not a sidebar capture.

⚠️ **PR5d concluded the arm was case (c) — "the scanner is live and correct; the page has simply never
been captured."** The page has now been captured and **still nothing reached the server**. That moves
it to case **(a) or (b): either `parseCmbsLoanDetail` does not fire on the page Scott is on, or the
payload is dropped before the writer.** The distinguishing evidence is on Scott's side — 👤 **a
screenshot of the Loan tab, and confirmation the extension sidebar shows a capture happening there.**
→ **PR5d-c**, which supersedes PR5d-a's framing.

## 2026-09-04 — ADDR1b-merge SHIPPED: gov has a reversible property merge, the destructive one now raises — and I closed a privilege hole the rename opened.

**Verified live on gov:** `gov_merge_property_reversible`, `gov_unmerge_property`,
`gov_merge_property_apply` and `gov_property_merge_backup` all exist; the old public name
`gov_merge_property` **raises**; backup table 0 rows (nothing merged for real); property 9893
untouched. **The port walks `pg_constraint` at call time rather than a hard-coded list**, so gov's
16 domain-specific tables (`gsa_leases`, `frpp_*`, `cmbs_loans`, `sam_lease_opportunities`, …) are
covered without a gov list to maintain — the same reason dia's works.

- **FK census: gov 36 edges / 35 tables vs dia 54 / ~40.** `sales_transactions_properties` has a
  2-column PK and is correctly reported unrecoverable rather than silently skipped.
- **Every BEFORE/AFTER trigger on every repointed table was checked for the P196 failure mode** (a
  trigger that silently SKIPS instead of raising). None does — `gov_supersede_prior_active_listing`
  and `llc_research_queue_auto_skip` both always `RETURN NEW`. **That check was the point of asking.**
- **Round trip proven on a real pair, rolled back**: 7655 (9 sales, 18 leases, 5 deeds) → 581 →
  unmerge, compared by **`array_agg` of primary keys per table, not counts** — sales 12/12, leases
  31/31, deeds 5/5, both property rows present. **0 lost / 0 stranded / 0 changed.**

🚨 **A gap the rename opened, found and closed here (Cowork).** The prompt warned that leaving a
destructive merge callable beside a safe one is how the wrong one gets used. The redirect blocks the
OLD name — but the renamed mutator **`gov_merge_property_apply` was `anon` AND `authenticated`
executable**, i.e. the destructive path stayed reachable under a new name.
**dia's equivalent is locked** (`dia_merge_property`: anon `false`, auth `false`), so the port
carried the logic and not the privilege posture. **Revoked from `public`, `anon` AND `authenticated`
(all three — the documented trap is that revoking one leaves the others), asserted with
`has_function_privilege`:** `proacl` is now `{postgres=X/postgres, service_role=X/postgres}`,
anon `false`, auth `false`, service_role `true`.
⚠️ **Still open and pre-existing on BOTH domains:** `*_merge_property_reversible` and
`*_unmerge_property` are SECURITY DEFINER and remain `anon`-executable. ENTC narrowed the three
ENTITY unmerge functions to `service_role` on 2026-09-03 for exactly this reason; the PROPERTY merge
pair was never given the same treatment. → **SEC1-property**.

**Twin-lane sizing: 399 candidate groups / 953 properties** on a crude exact-normalized-address+state
grouping, before any geospatial fuzz. ⚠️ **That is not "three rows"** — my prompt said to size it and
stop precisely because a tiny number would have argued for skipping it; it argues the other way.
Recommendation recorded, nothing built → ~~**ADDR1c-twin-lane**~~ **superseded 2026-09-05 by
GOVDUP1** — reading the rows refuted the ported-lane premise; see below.

## 2026-09-04 — CONTACT1a SHIPPED: the LIVE entities.email/phone writer now feeds field_provenance

> 📍 **CONTACT1a has TWO entries in this file and they are not duplicates — read both.** This one
> carries the diagnosis and what shipped; **the later "CONTACT1a SHIPPED: the ladder is wired to
> `ensureEntityLink`'s CREATE path"** entry below carries the **live verification** (deploy
> confirmed via `/version`, and why **0 new rows is the EXPECTED reading**, not a stall). Neither
> supersedes the other.

CONTACT1 (2026-09-03) diagnosed why `entities.email`/`phone`'s ten-rung field_source_priority
ladder had governed almost nothing (`email` zero rows ever, `phone` 4) and found the wired writer
(`bridge-handlers-salesforce.js::insertEntity`, PR5c-entities-b) is dead code — its two callers are
`enrichment_jobs.job_type`s (`salesforce.contact.upsert`/`.account.upsert`) that nothing in this
repo ever enqueues. This is that fix, on the LIVE writer.

**Census, not guesswork:** an AST walk (acorn) of every `ensureEntityLink(...)` call site found
**48 across 34 files**. `ensureEntityLink` never PATCHes `email`/`phone` onto an existing entity
(`seedFields` is discarded once a prior entity resolves — a fill only ever happens at CREATE), so
there is exactly ONE choke point: the CREATE payload construction. Of the 48 callers, **9** ever
pass a non-null email/phone (CoStar sidebar contact mint — the largest producer, `sf-list-import.js`,
`institution-registry.js`, the cross-domain contact matcher in `api/sync.js`, OM/lease party
contacts, and two open API surfaces whose `req.body` fields could carry either). All 9 — and any
future caller — now flow through the one wired site with zero per-caller changes.

Wired `recordFieldWrites` (audit-only, post-INSERT) into `ensureEntityLink`'s CREATE block —
`shouldWriteField` is deliberately NOT called pre-write, same reasoning as the dead PR5c-entities-b
block it supersedes: a create has no prior value to protect (`lcc_merge_field`'s "current value"
comes from `field_provenance`, empty for a row that doesn't exist yet), and all ten
`entities.email`/`phone` rungs are `enforce_mode='record_only'` anyway. Source is the caller's own
`sourceSystem`, mapped onto the registry spelling where recognised (`salesforce`,
`costar`/`costar_sidebar`), else passed through verbatim to `lcc_merge_field`'s UNREGISTERED branch
(still a real, recorded row — PR5's "unregistered is a different branch, not a low rung").

Guard: `test/contact1a-entity-link-provenance.test.mjs` — 3 behavioural tests invoking
`ensureEntityLink` through a stubbed `fetch`, asserting (a) one `rpc/lcc_merge_field` POST per
governed field on a create carrying both, with the exact registry spelling
(`target_table='entities'`, `target_database='lcc_opps'`); (b) zero merge-field calls on a create
carrying neither field (never assert a positive fact the source didn't state); (c) a registry
outage never blocks or reverts the entity create (fail-open, PR12's rule). **Mutation-verified
RED** when the `recordFieldWrites` call is disabled. Full suite: **5,381 pass / 0 fail / 6
skipped** — unchanged failure count, no regression.

**Not done, deliberately (per the prompt's scope):** no `enforce_mode` flip — PR5c-enforce stays
blocked; this gives the ledger its first real ongoing feed, not a graded gate. `SF_CONTACT_WRITEBACK`
untouched. `metadata.field_sources`/`planContactFieldPromotion` untouched (PR10's "one source, two
ladders" question is narrowed but not closed — `field_provenance` is now the ladder that actually
gets fed by live traffic; the metadata cache remains the writer's own private read-back). No
backfill of past writes — CONTACT1a only records from here forward.

**Caveats, stated plainly:** this session has no live Supabase credentials for
LCC Opps (`xengecqvemvfknjvbvrq`) — all verification above is against the source and a stubbed
`fetch`, not a live row count. The next session (or Scott, with live access) should re-measure
`field_provenance where target_table='entities'` a day or two after this deploys and confirm rows
are landing under `email`/`phone` with real `source` values (`salesforce`, `costar_sidebar`, and
whatever the two open-API callers' `sourceSystem` values turn out to be in practice).

Docs: `docs/architecture/field-provenance-ladder.md` §4 (new CONTACT1/CONTACT1a arc rows + a
correction to the PR5c-entities-b row, which had been misattributed as "the lane that actually
runs"); `docs/os/PLANNED-BACKLOG.md` (PR5c-entities-b corrected, CONTACT1/CONTACT1a rows added,
PR5c-enforce's blocker note updated, PR10 marked answered).
## 2026-09-04 — CONTACT1a SHIPPED: the ladder is wired to `ensureEntityLink`'s CREATE path — the choke point, not the 30+ callers. Deploy current; 0 new rows and that is the EXPECTED reading.

**Verified live:** `api/_shared/entity-link.js` calls `recordFieldWrites` after the entity INSERT
(commit `4805a761`); guard `test/contact1a-entity-link-provenance.test.mjs` exists and is
behavioural. **Live `/version` = `f1fe43e5`, which contains `4805a761` — the code is running.**

**`field_provenance` on `entities` is still 4 rows (`phone`/`domain_owner_contact`, newest 09-03
17:01) and that is CORRECT, not a stall.** Only **2** entities carrying an email/phone were created
today — `Jeff Lichner` 08:17 UTC and `Michael Papazis` 06:30 UTC — and **both predate the code
(12:04 UTC)** by hours. ⚠️ **This is the CONTACT1 lesson applied in the safe direction: the zero is
*quiet*, not *unreachable*, and we can say which because the population is nameable and the writer
sits on a path with 30+ live callers.** The next SF-Contact or sidebar create records.

**Three design decisions worth carrying, all in the code's own comments:**
- **`shouldWriteField` is deliberately NOT called pre-write** — this is the CREATE path, so there is
  no prior value to protect; only `recordFieldWrites` runs, AFTER the INSERT.
- **A null field is deliberately NOT recorded** — "a null here would assert *the source says this
  contact has no email*, which the payload never claimed." Absence stays absence.
- **`confidence: 1.0` is a claim about what the source SAID, not that it is right** — trust lives in
  the rung's priority, not the confidence. That distinction is easy to get backwards.

**Residual gaps, named rather than implied:**
- **CREATE path only.** An UPDATE of `email`/`phone` on an existing entity still records nothing.
- **`salesforce-sync.js` and `sf-list-import.js` were NOT instrumented directly** (0 `recordFieldWrites`
  in either) — they are covered only insofar as they mint through `ensureEntityLink`. CONTACT1
  traced `writeEntitySalesforceLink` as writing 195 of 336 links in 30 days; whether those are
  creates-through-the-choke-point or updates is the open question.
- **PR5c-enforce is still blocked** — 4 rows, 1 source, all `write`, against a condition of
  **~50 rows across ≥2 sources**. Re-check in 7 days.

## 2026-09-04 — SALE1c/SALE1c-gov/ADDR1b: 7 of the 8 "undecidable" rows resolved by splitting the ledger on EVENT TYPE, the dedup pair was never a collision, and my claim about gov's producer mix was WRONG.

**Verified live.** dia: 7 rows tagged `sale1c-null-2026-09-04`, all 7 nulled, `calculated_cap_rate`
NULL on all 7, sale 7972 correctly untouched; 902 and 903 **both `duplicate_superseded`**;
`v_dia_sale1_price_review` **133 → 125**, `ledger_disagreement` **100 → 92**. gov: bleed view **0**,
property 9893's address NULL.

- 🚨 **The 8 were not undecidable — the ledger has an `event_type` and nobody had split on it.**
  SALE1a compared the current price to the *earliest observation of any type*; CC compared
  `event_type='sale'` against `event_type='listing'` separately. **7 of 8 carry a distinctly-dated
  SALE event at a different price**, while the current value matches the linked listing's ask —
  which is the bleed signature, not a full-ask close. **Reading the same ledger at a finer grain
  answered a question filed as unanswerable.**
- **Sale 7972 was correctly left alone** — two independently-sourced records AGREE with the current
  price against three same-batch listing echoes. The one genuine full-ask-shaped row.
- ⚠️ **The 902/903 "unique-index collision" never existed** — the index covers LIVE rows only. The
  prompt (mine) framed it as a constraint to work around; the truth is 902 is a mis-dated copy of a
  real 2021 sale and 903 a phantom bridge row with no evidence. **Both moved to
  `duplicate_superseded` — the duplication fixed, not dodged.** The blocker I described was an
  artifact of not reading the index definition.
- 🚨 **My gov claim was WRONG and is corrected: gov's dominant producer is CoStar (sidebar+export)
  at 72% — the SAME family as dia, not "a different dominant producer (GSA/deed feeds)" as I
  recorded on 09-04.** I inferred that from the small listing-match share (4 of 127) without
  measuring the producer mix. Re-measured: **98 rows, not 127** — only **2** show listing bleed,
  **~18%** an A2b repeat-conveyance signature, **~80% unclassified** wider/messier revisions.
  **Same producer family, different failure distribution.** Classified, **no gov row written**.
- **ADDR1b: gov has NO reversible property merge** — confirmed live (`gov_merge_property_reversible`
  does not exist; `gov_merge_property` is a **hard delete with no snapshot**). So 9893 was
  **quarantined**, not merged, and the missing machinery is filed as **ADDR1b-merge**. ⚠️ **This is
  a real asymmetry between the domains worth knowing before any gov dedup work** — dia's
  `dia_merge_property_reversible` walks every FK and snapshots; gov's namesake destroys.

## 2026-09-04 — ADDR1a CLOSED: dia review view at 0, and the header question answered by reading the CODE PATH rather than widening a regex on a guess.

⚠️ **Filing correction (Cowork, this turn): `CONTACT1a` was moved to `prompts/done/` by
`a4bd2e63` without having been run** (superseded a few hours later the same day — see the
2026-09-04 "CONTACT1a SHIPPED" entry above, which landed after this one on the branch history but
sorts above it in this newest-first log; the code shipped in `4805a76`, and the prompt has been
re-filed to `done/` accordingly) — that commit reconciled the CONTACT1 *response* and filed the
follow-up prompt alongside it. **`field_provenance` on `entities` is still 4 rows, one source
(`domain_owner_contact`), `salesforce` = 0** — i.e. nothing CONTACT1a asks for has happened. Moved
back to `prompts/`. **`done/` means run, not superseded** — a prompt filed there is invisible to the
next session's queue.

**Consolidation this turn:** the CoStar capture producer now has one canonical page,
`docs/architecture/costar-sidebar-capture-pipeline.md` — PR2 · SALE1 · SALE1a · ADDR1 · ADDR1a as a
single arc table, the guards (with **which one actually closes each class** — the address class is
closed by the role-agnostic server-side belt, not the header regex), dated live state, and the
transferable lessons. Pointers added from `CURRENT-STATE.md`, `public-records-source-lane.md` and
the handoff. Five arcs that were spread across STATUS, two audits and the backlog now have one door.


**Verified live:** `v_dia_contact_office_address_bleed_review` = **0**; 37503 gone (merged);
37783's address NULL with `address_source='addr1a_quarantined_contact_bleed'`, city/state/zip intact;
`dia_property_merge_backup` row **585** present. gov mirror holds **1** row.

- **37503 → merged into 38953** (`dia_merge_property_reversible(38953, 37503, 'addr1a_20260904')`).
  **What came home: 1 sale, 1 listing, 7 leases, 1 deed record, 1 property doc.** The seven leases
  are the point — this shell had accumulated far more than the sale I could see, and a delete would
  have taken all of it. Reverse with `select dia_unmerge_property(585);`.
- **37783 → quarantined, not merged.** CC checked **all 23 Oakland dia properties** by address,
  operator and building size before concluding there is no twin — the 50990 disposition, reached by
  looking rather than by absence of evidence. Original street + rationale preserved in `notes`.
- 🚨 **The header question was answered by reading the CODE PATH, and the answer is "no change
  needed" — which is the harder call to make.** Both bled contacts carry `role: "true_buyer"`, and
  `extractContacts()` only ever runs `parseEntityBlock` (the function that extracts an address)
  under a **True Buyer** header; a bare `Buyer` line is used **solely as a name-reject pattern**
  (`CONTACT_NAME_REJECT`) and never triggers address capture. `true\s+buyer` was already in
  `FOREIGN_PARTY_HEADER_RE`. **Both captures predate the fix (2026-04-22 and 2026-05-09 vs the
  09-03 landing) — pre-fix artifacts, not evidence of a live gap.** The regex was NOT widened.
  ⚠️ **This is the right restraint:** a header regex that matches too much starts rejecting the
  subject property's own address block and fails silently in the opposite direction.
- **The server-side belt is the real closure, and it is stronger than the regex.**
  `contact-address-bleed-guard.js::findContactOfficeAddressBleed` is **role-agnostic** — it compares
  any captured contact's address to the property's exact street regardless of the header that
  labelled it — and is live in `upsertDomainProperty` (`sidebar-pipeline.js:4503`), refusing the
  write outright. **It would have caught both rows at ingest, and it covers a bare-header variant
  too.** So the class is closed by construction, not by enumeration of headers.
- **gov: 1 row — property 9893, `245 Park Ave` in Raton, NM**, bled from J.P. Morgan Asset
  Management's Manhattan office. Sized and classified, **not repaired** (gov has no repair half) →
  **ADDR1b**.

**Operator consequence: Contacts/Sale-tab captures are safe again.** The belt refuses the bad street
at write time on both domains.

## 2026-09-04 — SALE1a/SALE1b: 29 propagated prices NULLED (not reset), gov measured and NOT clean, and ADDR1a's two rows are now identified — 37503 has a named twin.

**Verified live:** backup `_sale1a_price_reset_20260904_backup` holds **30** rows; **29** nulled and
tagged `sale1a-null-2026-09-04`; `ledger_disagreement` **129 → 100**; review total 133.

- **Zero of the 38 had deed corroboration**, so per the reset rule **nothing was reset to the ledger
  value — 29 were NULLED.** That is the right call: `cap_rate_history` records what was FIRST
  RECORDED, and with no deed the earliest value has no more evidentiary weight than the current one.
  A missing comp beats a wrong comp.
- ⚠️ **The cap-rate handling is more careful than its own summary says, and I misread it first.**
  The response says "all 19 lost their derived cap rate"; live, **`calculated_cap_rate` is NULL on
  all 29 (correct)** while **10 retain a `cap_rate_final` — every one `broker_stated` or
  `source_reported`.** Those are the SOURCE's own stated cap rates, not derived from the price CC
  nulled, so keeping them is right. **6 of the 10 remain in comps with a stated cap rate and no
  price** — defensible (usable for cap-rate analysis, not $/SF) but it should be stated, not
  discovered. **I flagged these as orphans before checking `cap_rate_source`; they are not.**
- **The population moved 132 → 129 → 38 (from my 45)** between 09-03 and 09-04 — the writer fix
  stops new corruption, but incidental writes still shift the residual. **Re-derive, never quote.**
- **8 `linked_same_listing` rows left alone** — the price matches the listing the sale is formally
  joined to via `listing_sale_id`, so it could be a genuine full-ask close. **1 deferred dedup pair**
  (902/903) — nulling both would collide on the unique index. Both are human reads → **SALE1c**.
- **The ~8 within-2% rows are NOT a tolerance defect** — re-measured as 21 rows at 1.0–2.8%, all
  plausible rounding/late corrections, no unit or magnitude tell. **Leave the >1% threshold alone.**
  The 12× artifact (sale 562) was inside the 29 and is nulled.
- **SALE1b — gov is NOT clean:** gov has an equivalent ledger (`cap_rate_history`, `event_type='sale'`,
  via `trg_gov_auto_cap_rate_on_sale`) and shows **127 `ledger_disagreement` rows**, of which only
  **4** match a listing ask — a much smaller listing-bleed share than dia, consistent with gov's spine
  having a different dominant producer (GSA/deed feeds vs dia's CoStar capture). **Measured, not
  graded, not fixed** → **SALE1c-gov**.

### ADDR1a — both open rows identified, and 37503 has a NAMED TWIN

Neither needs a re-capture. Both were last written **2026-09-01, before the ADDR1 fix (09-03)**, so
they are historical residue — but they are two DIFFERENT dispositions, which is exactly the 37491 vs
50990 split again:
- **37503** `3121 Michelson Dr, Suite 500` / Kokomo IN (IRA Capital's Irvine CA office) is a
  **phantom duplicate of 38953 `2312-2330 S Dixon Rd, Kokomo, IN`** — identical `building_size`
  10,603.00, identical operator (Fresenius) and tenant, identical timestamp. **The real street
  already exists in the table.** → merge via `dia_merge_property_reversible`, as 37491 was.
- **37783** `4700 Wilshire Blvd` / Oakland CA (CIM Group's LA office), Satellite Healthcare,
  `building_size` NULL, **no stat twin in Oakland** → likely the **50990 case**: a real property that
  lost its own street. Quarantine, do not guess, do not merge.
⚠️ **A re-capture is NOT the fix and may not be safe yet:** both bleeds came from a `buyer`-role
contact, and `FOREIGN_PARTY_HEADER_RE` matches `recorded buyer` / `true buyer` — **a bare `Buyer`
header would still slip through.** Confirm the literal header text before re-capturing either.

## 2026-09-03 — CONTACT1: entities.email/phone ladders are empty because the wired writer is dead code (diagnosis only, no code shipped)

Both authority ladders on `entities.email/phone` (`field_provenance`@10-rungs and
`metadata.field_sources`) are near-empty (4 rows / 1 row) — not because there's no history to
grade yet, but because **the real writers never consult either one.**
`bridge-handlers-salesforce.js::handleSalesforceContactUpsert` — the function PR5c-entities-b
instrumented with provenance recording — **has never run** (`enrichment_jobs` holds zero
`salesforce.contact.upsert` rows ever); its header's claimed 10,086-lifetime/336-in-30d writer
population belongs to two DIFFERENT, unrecorded live writers (`salesforce-sync.js` on cron 165,
and `sf-list-import.js` → `ensureEntityLink` at entity creation), neither of which calls
`recordFieldWrites`/`shouldWriteField`. `SF_CONTACT_WRITEBACK` is off — correctly, per
`CLAUDE.md`'s "never writes back to clean SF" doctrine, not a pending rollout.
`owner-contact-propagate` has no cron (unscheduled, not broken — one manual run today wrote 4
provenance rows / 4 phones / 31 review tasks).

PR10 answered on evidence: `field_provenance` should own the decision, `metadata.field_sources`
should retire — but that recommendation is moot until the real writers are repointed. Filed as
new backlog **CONTACT1a**. Numeric unblock condition for **PR5c-enforce** recorded: grade
`enforce_mode` once `field_provenance` for `entities.email/phone` exceeds ~50 rows spanning ≥2
sources with real write/skip/conflict decisions (today: 4 rows, 1 source, all `write`). No
`enforce_mode` flip, no `SF_CONTACT_WRITEBACK` enable, no backfill, no code changed. Record:
`docs/claude-code/responses/done/CONTACT1-both-entities-ladders-govern-nothing.response.md`. (CC's
own independent reconciliation of this same finding, plus its self-correction of an earlier
PR5c-entities-b entry, landed in a concurrent PR — see the entry below dated the same day.)

## 2026-09-03 — UX-T1a-today SHIPPED: Today is Significant / Important / Urgent

Recut the Home "Today" panel into the canon's three sections (operator-doctrine.md 1.8.0),
replacing the unlabelled "Work Your Outreach" + "Top BD Actions" cards. Measured every candidate
producer named in the prompt before assigning a bucket (never by feel):

- **Significant** (new-client research/first outreach/follow-ups) = the WHOLE
  `v_lcc_seller_prospect_queue` (520 rows) — every row is, by its own gates, an owner not yet
  reached, ranked identically to UX-T1a-queue. `touchpoint_cadence.current_touch` confirmed
  unreadable again (p50 0, max 8,298), so the fallback to the seller queue's `reach_state` (the
  prompt's own instruction) is what shipped.
- **Important** (BOVs/ELAs/working buyers/marketing live listings) = `bd_opportunities` open rows
  (47, the only real recorded producer). **Two named gaps, not fabricated:** no DB row anywhere
  states "a BOV was generated/due" (`lcc_deal_milestone` has no such key — its 7 keys are
  loi/psa/escrow/diligence/financing/marketing/close, and `marketing`='next' reads **0** rows
  today), and no producer exists for "marketing a live listing" as a task
  (`lcc_listing_events` is a sale-EVENT feed with no marketing-touch column at all).
- **Urgent** (pipeline management/deal correspondence, ~90 days) = `action_items` open/in_progress
  rows tied to a deal (58 open — `deal_next_step` 34, `send_info` 8, `reply_overdue` 4,
  `review_response` 3, `schedule_call` 3, `seller_follow_up` 3, `follow_up` 2, `advance_to_contract`
  1) UNIONED with `v_lcc_bd_worklist`'s `contact_writeback` (1,568) + domain
  `owner_source_conflict(auto_fixable)` (gov 0, dia 8) — reusing `assembleBdWorklist`, the SAME pure
  function the full worklist uses, never a second shape. `loan_maturity` and `ownership_chain` are
  deliberately excluded, per the prompt's own rule: loan_maturity's ≤24mo window has no ~90-day
  sub-slice to test against, and ownership_chain is A2's automated apply lane (a cron consumer, not
  a human task) — both stay reachable via Priority Queue / BD worklist.

Shipped: `api/_shared/today-sections.js` (pure classification, `assembleTodaySections`) +
`api/operations.js::getTodaySections` (`GET ?action=today_sections`) + the Home widget recut
(`index.html`/`app.js`: `renderTodaySections` replaces `renderOutreachOnramp`/
`renderTodayBdActions`) + `pageSellerProspectQueue` — the seller queue's first front-end surface
(chips + real pagination, reusing `GET /api/seller-prospect-queue` verbatim). Guard
`test/uxt1a-today.test.mjs` (12 behavioural tests over named-row fixtures per section — P180
null-vs-0 collapse caught and fixed by the guard itself before shipping). Full suite 5,384 tests,
5,378 pass / 0 fail / 6 skipped — unchanged failure count, confirming no regression. Record:
`docs/claude-code/responses/done/UX-T1a-today.response.md`.

## 2026-09-03 — EXT2a SHIPPED (PR #2098): the schedule-blend double count is fixed

**SALE1 SHIPPED (PR #2102, branch `claude/sale1-price-propagation-bwq4pz`) — verified live 2026-09-03.**
All four reproduce: **31 rows flipped** by the eligibility migration (`sale1-eligibility-20261009`
marker), excluded now 1,781, **`nominal` still in comps = 0**, review view **165 rows**
(`ledger_disagreement` 132 / `deed_says_undisclosed` 33). Two independent defects were found where
one was assumed — the `upsertDomainSales` re-match PATCH overwriting a non-null `sold_price`, and
the dia `sale_notes_raw` stamp that gov already gates on `isMostRecentSale`. Both are fixed forward;
**nothing was reset, which is correct.**
⚠️ **I did the read CC flagged as its honest gap, and the 132 must NOT be treated as 132 defects.**
Splitting `ledger_disagreement`: **45 match one of the property's own listing prices** (the Hillsboro
shape — the listing bleeding into a deed row) and **41 match a sibling sale on the same property**
(overlapping with those); the ratio distribution is otherwise unremarkable — **1** row is a clean
12× artifact (`$64,583.57` vs `$775,000` = the monthly figure), 8 sit within 2% (a tolerance
question, not a defect), and the rest are modest revisions consistent with a later, better source
correcting a bad master import. **87 of the 132 are still in comps, 83 with a live cap rate.**
**The prioritised set is the 45 listing-matches, not the 132** — that is the shape with a proven
mechanism. The remainder needs a named-row read before anyone resets a price.
⚠️ **Also open:** the eligibility gate shipped as the BROADER 4-signal set (nominal + foreclosure +
disclaimer + REO = 31 flipped) rather than the 28/20 nominal+disclaimer slice; CC read all 3 REO
rows first, which is the right bar, but the scope difference is deliberate and should be stated
rather than discovered. And **gov's own price-conflict rate is unmeasured** — the guard is shared,
the measurement is not.


**SALE1 checkpoint verified (Cowork, 2026-09-03).** CC's central claim reproduces exactly:
`cap_rate_history` shows sale 8091 (2009) first recorded at **$1,233,000** on 2026-04-17
(`dia_master_sales`) with the listing at **$1,593,750** the same day — the sale row now carries the
LISTING's figure. **Two independent defects, confirmed:** (a) `upsertDomainSales`' re-match PATCH
overwrites a non-null `sold_price` with a later capture's figure (34 rows / $106.8M in the
single-source slice; **24 live comps computing a cap rate off it**); (b) the dia branch stamps
`sale_notes_raw` on EVERY sale in the per-sale loop while **gov gates the same write to
`isMostRecentSale`** — and gov's own comment states the rule ("the notes describe the
displayed/most-recent deal"). ⚠️ **Counts moved:** nominal is **38 / 28 in comps / 20 with a cap
rate** today, not the 33/28/23 of the first pass. ⚠️ **The path is LIVE** — the listing trigger fired
at 17:16:53 during Scott's capture. **Reordered the build: the writer guard FIRST** (captures are
ongoing; everything else is cleanup behind an open tap), then the one-line notes gate, then the
comp-eligibility migration, then the review view, then the 46 two-source groups. ⚠️ **Do not reset
8091 to $1,233,000 on the ledger alone** — `cap_rate_history` records first-RECORDED, not true, and
a "Nominal Transfer" price may be meaningless; prefer NULL + non-comp unless the deed corroborates
(the rule CC already applied to 8090's "Not Disclosed"). The 235 "matches earliest" rows are genuine
repeats — an A2b comp-COUNT question, not a price defect; note it so nobody re-opens them.


- `baseFromPeriodQuote` reads a schedule period's own labelled base/additional split (ground-truthed
  against the real Chesterbrook lease); components merge into `additional_rent` deduped
  `(kind,amount)`; `resolveYear1TotalRent` gained a `schedule_composition_unknown` guard (null total
  rather than guessing when a schedule figure's makeup can't be determined). Doc 255 now resolves
  **89,340 base / 101,568 total / `schedule_period_1`** (was 101,568/113,796 — equipment counted
  twice). Guard: 6 new tests, 39/39 in file, 162/162 across the whole `bov-extract`-touching
  population.
- **Found + fixed along the way:** a literal apostrophe inside a regex character class
  (`[a-z0-9 /&'-]`, in the test file's own literal-blanking regex — the OCR1c apostrophe-in-prose
  bug one syntax class over) was mistaken for a string delimiter and blanked ~20 lines of real code,
  failing an unrelated test — fixed with `\x27`. Transferable to any future comment/literal-stripping
  guard.
- Docs closed in the same reconciliation: EXT2 residual-risk framing, `ai-and-ocr-cost-strategy.md`,
  `CURRENT-STATE.md`, `PLANNED-BACKLOG.md`, `OPERATOR-ACTIONS.md`. Record
  `responses/done/EXT2a-schedule-line-definition.response.md`. The EXT arc (EXT1→EXT1b→EXT2→EXT2a)
  is now fully closed — no open residue.

## 2026-09-03 — the Chesterbrook lease was READ; EXT2a ground-truthed and prompt drafted

- Scott uploaded the actual lease; OCR'd and read in-session. Exhibit B defines the split in its own
  words: base $7,445/mo + $1,019/mo equipment, "Total payment each month $8,464"; escalations apply
  to the base; months 121-180 exclude the equipment payment. **So base = 89,340/yr, equipment is
  `additional_rent`, total = 101,568 — the current schedule-wins output (101,568 base / 113,796
  total) is wrong on both fields for this lease.** 15-yr initial term + one 5-yr renewal, consistent
  with the swimlane-standard doctrine.
- `prompts/EXT2a-schedule-line-carries-its-own-definition.md`: `baseFromPeriodQuote` (a schedule
  line carrying its own base/additional split is parsed, components deduped into `additional_rent`)
  + a composition guard (total = null + `schedule_composition_unknown` when a schedule figure's
  makeup is unknown). Ground truth encoded as the fixture. EXT2-spotcheck closed.

## 2026-09-03 — UX-T1a-queue SHIPPED (#2092) + EXT2 floor re-run DONE

- **The doctrine's queue exists: 520 rows / 453 owners** (`v_lcc_seller_prospect_queue`, variant F,
  gates as named columns; funnel + chips + pager on `/api/seller-prospect-queue`). CC's key
  corrections: the debt arm is **asset-scoped** (a 95-row decision, stated); **§7b's 89.6%
  disjointness is true of the newer-lease HALF only** — the whole queue overlaps the band queue
  34.8% because a maturing loan usually sits on a late-term lease, so the queue **sits beside** the
  band queue, not replacing it. `no_linked_person` = 384 of 520 — the binding constraint is links.
  No front-end yet (a separate change); UX-T1a-today / -cadence untouched.
- **EXT2 floor re-run (workstation):** 7/8 decided docs agree on `year1_rent_source`; 299's
  two-period residue GONE; **the named residual risk fired on 255** — schedule blend won AND
  `year1_total_rent` double-counted equipment → **EXT2a** (null the total under `schedule_*` unless
  schedule == base quote) + 👤 Chesterbrook spot-check (OPERATOR-ACTIONS). 431 flips credit basis on
  a model guaranty-quote omission — code correct, variance is omission. Record:
  `responses/done/EXT2-floor-measurement.response.md`. **The extractor arc is closed** modulo EXT2a.

## 2026-09-03 — PR5d: the ladder's largest source is a capture that never happened, not a wiring gap

`costar_cmbs_loan` holds **121 rungs** — more than any other source — and PR5 had it filed
`build_pending` on one measurement. The three-way question (no scanner / dropped keys / unreachable
page) resolves to **the third**, and there is a second blocker underneath it that the third does not
describe.

**Verdicts written** (migration `20261010120000`, applied live; `v_field_source_priority_triage`
gains `pr5d_verdict`): `page_never_captured` **94** · `page_never_captured_flag_off` **27**.
PR5's `build_pending` is preserved underneath on all 121 — PR5d refines it, and `pr5_verdict`,
`pr5c_verdict`, `is_orphan_column` and `is_retired` are unmoved (2,141 rungs / 426 / 33 / 49 / 51).

- **The scanner, the writer and the host match are all live and correct.**
  `extension/content/costar.js parseCmbsLoanDetail` (76ek.b) + `parseCmbsFinancials` (76ek.e) →
  `sidebar-pipeline.js upsertLoanRecords` / `upsertPropertyFinancials`, and `manifest.json` matches
  `https://*.costar.com/*`. Nothing has ever visited `/detail/lookup/{N}/loan`.
- **Ruling out the rename class needed a column only that arm writes.** `loans.costar_loan_id` and
  `loans.source_url` are **0 of 2,219 rows across both domains**; `loan_snapshots`,
  `loan_top_tenants` and `loan_commentary` are **0 rows on both**; `property_financials` carries
  **0** `costar_cmbs_loan` rows against gov's 98,510 and dia's 676. What *does* write `loans` is a
  different scanner on the property page (`costar_sidebar`, gov 1,393 / dia 358) — and it sets
  `cmbs_deal_name` from a lender-name regex, which is why gov reads `is_cmbs` 285 and
  `special_servicer` 126 and **looks like CMBS capture while being nothing of the kind.**
- ⚠️ **This supersedes R54 Unit 3's mechanism** (*"the captures so far are the basic loan layout, not
  the full CMBS Performance walk"*). R54's disposition was right and its explanation was wrong, and
  the wrong explanation is what made this read as a coverage question for 75 days.
- ⚠️ **The dia blocker is a second one, not the same one.** `properties.track_cmbs_snapshots` is
  **false on 11,803 of 11,803** and gates snapshots / top-tenants / financials, so capturing the page
  tomorrow would still write nothing there. The dia `loans` row and `loan_commentary` are ungated —
  that boundary is exactly the 94/27 split, and both sides are guarded.
- **NOT retired, and the reason is a starved consumer rather than the ladder.** R54's
  `is_distressed` arm on `v_loan_maturity_watch` reads **0 of 178** gov rows, with watchlist /
  num_delinquent / special_servicing / modification / dscr at **0 across 285 CMBS loans / 210
  properties** — captured only by this arm. Backlog **PR5d-a** (gov capture: an operator question
  about Scott's CoStar workflow) and **PR5d-b** (the dia opt-in).

**UX-T1a reconciled in three places.** Part A's *"the debt D has no LCC table at all / 192 loans
maturing ≤24 mo … none of it reaches LCC"* was true on 09-02 and is superseded by UX-T1a-gates the
next day: `lcc_loan_maturity` holds **568 rows carrying exactly those 192** (gov 170 + dia 22 at
source — reproduces to the row). ⚠️ **And `costar_cmbs_loan` supplied 0 of the 192** — they come
from `costar_sidebar` (113), `sec_edgar` (58), `ops_asset_metadata_loan` (20) and one null. So the
121 rungs are the supply side of a demand already met from elsewhere; **the residual debt gap is
DISTRESS, not maturity.** Corrected in `app-ux-review-2026-09-02.md`, the audit's recommendation
list, and `CLAUDE.md`.

**Nothing built:** no scanner, no rung added or deleted, no priority or `enforce_mode` change, no
fuzzy loan↔property matching, and `track_cmbs_snapshots` not flipped.

Guard `test/pr5d-costar-cmbs-loan-verdict.test.mjs` (12 tests, **21/21 mutations RED**) — it pins
the single-writer property, because **a zero is evidence only while exactly one writer could have
made it non-zero**, and a second writer would destroy the detector without breaking anything.
⚠️ Three of my own assertions survived their first mutation and the mutation pass found all three
(a slice anchored on a token a gate moves past; a manifest check that a narrowed match still
satisfied; `SET priority =` never spelled by a second SET clause on its own line).
Audit: `docs/audits/PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md`.
## 2026-09-03 — UX-T1a-gates SHIPPED (#2088): both queue gates honest; UX-T1a-queue prompt drafted

- Deltas: dia lease dates in mirror **0 → 1,747** (the break was the dia SOURCE VIEW — never carried
  lease columns; three edits, any one alone a silent no-op); `v_lcc_bd_worklist.loan_maturity`
  **0 → 172 / 109 owners** (the real gap was owner attribution, not a missing producer — the handler
  always read the domain watch views but with `entity_id: null`); operator queue **1,635 → 694**
  (941 hidden by `lcc_priority_band_is_human_surface`, fails open, chips gate on the same predicate).
- CC already updated backlog + CLAUDE.md + the bd-ranking page. This turn: CURRENT-STATE row, files
  to `done/`, and **`prompts/UX-T1a-queue-seller-prospect-view.md`** — variant F as one view, gates
  as named columns, recorded reasons only (debt + developer; death/divorce stay unmeasured), reach
  via person-links with `no_linked_person` first-class, rank = value then lease recency.
- `PR5d-costar-cmbs-loan-arm.md` in prompts/ belongs to the parallel provenance window — left alone.

## 2026-09-03 — UX-T1a Part A MEASURED (#2084): the queue is 89.6% disjoint from the doctrine; Part B held; UX-T1a-gates prompt drafted

**ENTC verify (Cowork, post-merge):** every number reproduces live — junk80 view **80**
(41/27/6/4/2 split exact), plan 15, blind pairs 55, drift 0, `lcc_p195_unmerge` anon EXECUTE
**false**. ✅ **And the Railway redeploy already carries the merge** (`/version` = `5b3b1227`,
09:27 UTC) — so the JS half (mint gate, un-stamp keying, junk80-seed handler) is LIVE and
**junk80-apply is unblocked**; CC's "can't run before the deploy" caveat is superseded.


- Funnel 8,858 → 3,529 → 259 → 31 → 23. G3 (newer lease) cuts 93% and G4 (reason to sell) 88% — both
  COVERAGE gaps: dia has no lease dates in the mirror (3,823 live leases at source), and debt (192
  maturities ≤24 mo) has no LCC table while Today already renders a `loan_maturity` label nothing fills.
  P1/P2/P3 select assets late in term — the opposite of "newer". 58% of queue rows are plumbing.
- CC updated the backlog (UX-T1a + six sequenced rows) and the bd-ranking page itself; this turn adds the
  CURRENT-STATE row, the CLAUDE.md lessons (circular `sale_price` validation; portfolio price; reach
  floor/ceiling; 42% regex FP; label-is-not-a-lane), and moves files to `done/`.
- **Next CC prompt: `prompts/UX-T1a-gates-dia-lease-mirror-and-loan-maturity.md`** — three units:
  mirror dia leases (find the break first: view columns vs `select=` list vs anon read), `loan_maturity`
  via a `*_portfolio` view + mirror leg + worklist emission, hide P0.4/P-CONTACT/P0.5/P-BUYER as a
  `human_surface` column. Then UX-T1a-queue.
- Two stray `.docx` copies of prompts sit untracked in `responses/` (EXT2, UX-T1a) — delete locally.

## 2026-09-03 — C4a answered → canon 1.8.0 (the queue, quantified) → UX-T1a prompt ready

- Scott answered the five ordering questions (app-ux-review **§0b**, verbatim in substance): newer lease is
  relative to the swimlane's standard initial term (first 2–3 yrs; dialysis 15-yr new build → 12+
  remaining; retrofit 7–12 → 7–10; gov = FIRM term, gov-only) · reason to sell = **death, debt, divorce,
  value creation** · $2.5M–$25M is the individual property sale (velocity; repeatable size; the wake) ·
  not-reached = no touch ever by anyone / not in pipeline · 7 touches in 6 months then ≈1/quarter by role ·
  Today = day's tasks, client-value ranked, **Significant / Important / Urgent**.
- Canon **1.8.0** (operator-doctrine quantified), rendered, parity 0 drift (copilot region 7,472 chars).
- `prompts/UX-T1a-seller-first-queue-and-today-recut.md`: Part A measures each gate's admitted population on
  named rows (unknown as its own state) before Part B builds `v_lcc_seller_prospect_queue` + the
  three-section Today; buyer/plumbing bands leave the human surface; cadence spacing proposed, not changed.
- Fixed a jammed backlog row (UX-T1a had been appended to the OWN-T0b/c/d/f/g line with no newline — the
  dedupe grep is line-anchored and could not see it).

## 2026-09-03 — UX0 DONE: operator doctrine is canon 1.7.0

- `canon/blocks/operator-doctrine.md` + Global invariant 8 (minimum effective dose · seller-first queue
  $2.5M–$25M / newer lease / reason to sell / untouched owner · buyers pursued by showing deals · truth
  over signal · one tab one question). Rendered: 5 bundles, copilot managed region rewritten (7,472 /
  20,000 chars), parity 0 drift. 👤 External pastes owed (`OPERATOR-ACTIONS.md` UX0-paste).
- Next: C4a's concrete ordering questions (posed to Scott in chat) → UX-T1a home/priority re-cut prompt.

## 2026-09-03 — EXT2 SHIPPED (#2078); the extractor's three definition questions are now the lease's to answer

- EXT2 merged (`f83c2d99`; 32 guards, 28/28 mutations RED). `year1_rent_source` / `year1_total_rent`
  / `credit_entity` + `credit_entity_basis` ride the tenant object; `parent_mentioned` cannot be
  promoted, guarded. ⚠️ Named residual: schedule outranks the base-rent quote, so a BLENDED period-1
  schedule figure would win — doc 255's `year1_rent_source` on the re-run is the row to read.
- 👤 **Floor re-run owed** (workstation; command + jq on `OPERATOR-ACTIONS.md` §2). Success = both
  sides agree on the SOURCE, not the rate.
- ⚠️ Deploy: live `/version` reads `cbac828a`, which is **not in this clone's history** (local HEAD
  `10b86f1b` = #2078). Either a later PR (OWN-T0e?) landed after this reconciliation's fetch, or the
  clone is behind — `git merge-base --is-ancestor f83c2d99 <deployed>` after the next pull settles
  whether EXT2 is running. Not asserted either way.
- Cleanup: `responses/EXT2 desktop rsesponse.docx` was a copy of the PROMPT (not a response) —
  delete it locally (the sandbox cannot; it is untracked, so nothing to commit). Prompt + response → `done/`. CURRENT-STATE's AI/OCR row rewritten as a summary that
  points at the canonical page instead of restating it.

## 2026-09-03 — EXT2 DECIDED: the lease defines it; prompt drafted. OWN-T0e sent to CC.

- Scott's answer to all three EXT2 questions is the same shape: **there is no house rule — each
  lease defines base rent, rent commencement and the tenant.** So the extractor quotes the lease's
  OWN definition (`defined_term`, `definition_as_stated`, `additional_rent[]` never summed,
  `rent_commencement`, `tenant_legal_entity` / `tenant_dba` / `co_tenants` / `parent_mentioned`)
  and code applies it (`resolveYear1Rent`, `resolveCreditEntity`). **Credit = the counterparty
  legal entity that guarantees the lease; a parent named without an express guaranty is never
  promoted.** `prompts/EXT2-lease-defines-base-rent-year1-and-tenant.md`.
- OWN-T0e (sponsor-family confirm lane) is with CC.

## 2026-09-02 — EXT1b floor MEASURED (rent + expiration 100%); OWN-T0 verified live; my prescribed remedy refuted on named rows; EXT2 filed

- **EXT1b floor:** `year1_rent` 89→**100%**, `lease_expiration` 80→**100%**, floor **94%** on 10 docs.
  The residue is a DEFINITION: the model now quotes faithfully and picks a different rent LINE per
  side (255: base $7,445 vs total $8,464 with equipment; 299: two schedule periods) or a different
  tenant name (DBA vs entity). → **EXT2**, a decision for Scott before code. Record
  `responses/done/EXT1b-floor-measurement.response.md`. **EXT1/EXT1b are closed as builds.**
- **OWN-T0 (#2074) verified live:** deployed `47d0a934`; three views present; detector positive
  control **756 = 745 + 11**; 2,095 conflicts on the panel view. ⚠️ **CC refuted the remedy I
  prescribed** (end-date the earlier owner): the top-60-by-rent pairs are sponsor↔SPE — both true —
  and 121 rows carry no date to order by. Nothing was end-dated; the producer predicate (P117, the
  wrong grain) was fixed, the reconciled view built, the detector made to see. Same lesson as A3:
  **a ten-row read turns a plausible remedy into a refuted one.** Follow-ups OWN-T0a–g filed by CC;
  **OWN-T0e** (sponsor-family confirm lane) is the leverage.
- Files → `done/`. Prompts folder: handoff + PR5c (other window) only.

## 2026-09-02 — EXT1b shipped + deployed; three named rows re-score exactly; floor re-run owed

`#2068`, deployed `a013aea6`. 431 rent → **105,558** (`basis_source: as_stated`), 336 → **75,000**,
431 dates → `2021-03-15` day-precision on BOTH runs, 255 untouched. 23 guards, 16/16 mutations RED.
Three decisions worth carrying (each measured against the obvious alternative): the basis window
stops at the next `$`; amount is presence-in-the-quote, never a tolerance; a formula is never turned
into a date even when it contains one. Prediction on file: rent + both dates → ~100% self-rate, with
the date denominators rising — read counts, not rates. 👤 Re-run command on `OPERATOR-ACTIONS.md`
(OCR1 row). EXT1b + UX-T0 files → `done/`. Next: **OWN-T0** to CC.

## 2026-09-02 — EXT1b SHIPPED: `as_stated` is the authority, the model's labels are the fallback. ⚠️ The floor movement is PREDICTED — the measurement is Scott's re-run.

- **What shipped:** `basisFromAsStated` / `amountFromAsStated` / `precisionFromAsStated` + two
  reconcilers in `api/_shared/bov-extract.js`, wired before `annualizeRent` and both date resolvers
  and into `cleanRentPeriod`. **One JS file. No migration, no prompt change, no OCR change, no
  backfill.** Guard `test/ext1b-as-stated-authority.test.mjs` — 23 tests, **16/16 mutations RED**;
  full suite **5,178 / 0 fail**; the 21 EXT1 tests unchanged. Record:
  `responses/EXT1b-basis-precision-quotes.response.md`.
- **The three named rows, re-scored:** 431 rent `null → **105,558**` (quote said *per month*, label
  said `per_sf_annual`, amount was ÷1,000); 336 `null → **75,000**` (the year-1 figure is the first
  `$` in the schedule quote); 431 dates `formula/null → **2021-03-15, precision day**` on BOTH runs.
  **255 held at 101,568** — EXT1b must not move the row EXT1 already fixed, and it does not.
- **⚠️ THE AMOUNT RULE IS PRESENCE-IN-THE-QUOTE, NOT A TOLERANCE.** 8.7965 and 8,796.50 are the same
  figure scaled by 1,000; **no threshold separates that from a different figure on the page.** The
  model keeps its amount only when that amount appears as a `$`-figure in its OWN quote — measured on
  *"a security deposit of $10,000 and base rent of $8,796.50 per month"*, where a bare first-figure
  rule takes the deposit.
- **⚠️ THE BASIS WINDOW STOPS AT THE NEXT `$`.** Doc 336 states a period *and* a parenthetical
  monthly restatement of the same rent; over the whole string that is ambiguous and abstains, losing
  the row. Where a window genuinely carries both markers the answer is **null and the model's label
  stands** — silence hands the decision back rather than flipping a coin.
- **⚠️ A FORMULA IS NEVER TURNED INTO A DATE, INCLUDING ONE THAT CONTAINS A DATE.** The parser must
  CONSUME the whole quote; *"the earlier of March 1, 2021 or thirty days after Delivery"* contains a
  calendar date and IS a formula, and a `.search()` would resolve it and re-commit the exact defect
  EXT1 removed. And the quote decides in BOTH directions — a month-only quote under a `day` label
  drops the day the model invented.
- **PREDICTED floor:** `year1_rent` 89 → ~100, both dates 80 → ~100, other three fields unchanged.
  ⚠️ **Two caveats, stated because EXT1's prediction was wrong in exactly this way:** it assumes the
  residue is only the rows already read (last time I assumed the model's LABELS were as reliable as
  its QUOTES), and **`decided fields` should RISE on the dates** as 431 stops being both-null, so the
  denominator moves and the rate is not directly comparable to run 3's. Doc 425's dates must stay
  honest nulls — that is a real OCR miss.
- **Next:** Scott's `--run --model real --control self --engines tesseract`, then read the same two
  floor rows.
## 2026-09-02 — UX23 went wholesale: 9.4% of properties carry >1 CURRENT owner and the conflict detector reads 0 → OWN-T0; two operator decisions recorded

Scott on UX23: *almost every property* shows owner gaps/lapses and the ownership tab conflicts with
itself — asked for a wholesale approach rather than a named record. **Measured before writing the
prompt:** `lcc_entity_portfolio_facts` has **756 of 8,068 properties with >1 `is_current` owner**
(33 with 3+); `lcc_property_owner` disagrees with the current fact on **667 of 8,223**;
`v_lcc_portfolio_ownership_conflict` = **0** (built for P175a's ghost-vs-ended pair; structurally
blind to two live current owners). And `chain_2plus` is 178, so a developer→owner gap is the DEFAULT
state the panel never labels. **OWN-T0 staged**: disagreement matrix over every store the tab reads
+ ten named rows → fix the supersession writer that leaves the prior current fact un-ended
(reversible, predicted delta) → `v_lcc_property_ownership_reconciled` as the ONE view the panel
reads with `gap` / `conflict` / `operator_not_owner` as words → detector sees 756 before, 0 after.
⚠️ **A detector reading 0 over a 9% defect is the P182 class, again.**

Decisions: **UX39/UX41** keep both, move off the headline tabs to a back-end screen (UX39b/UX41b,
with UX-T2). **UX13a** deferred to user onboarding. EXT1b sent to CC.

## 2026-09-02 — UX-T0 reconciled (deploy + migrations verified); EXT1 floor MEASURED — two noise classes gone, labels are the next layer → EXT1b

- **UX-T0 (#2061) verified live:** JS in deployed `a3172f44`; `v_manager_overview.is_team_member`
  reads **42 / 4**; dia `v_listing_verification_summary` **1,400 / 0 evidence / 1,400 cron**. CC's
  verdicts stand: 9 fixed, 4 owned elsewhere, **4 of my mechanism hypotheses REFUTED** (the "500"
  was arithmetic, not `limit: 500`; the verification feed was honest about a dead evidence lane;
  Kelly's writes land — three of four mailboxes are simply not synced; the Woodland Hills flag IS
  set), **2 removals refused** on measurement. The two refusals are now decisions on
  `OPERATOR-ACTIONS.md` (UX39/UX41), and the mailbox step is an operator row (UX13a). Not measured:
  UX22 (per-column comps census — its own pass) and **UX23, which needs the property Scott had on
  screen** — name it and it is a 20-minute job.
- **EXT1 floor re-run:** rent disagreements vs tesseract **2 → 0**, date disagreements **4 → 0**;
  doc 255 reads **101,568** on all three runs (was 8,464 / 89,496 / 84,464). But `year1_rent`
  self-rate **89 → 89** and dates **90/71 → 80/80**, not the predicted ~100 — the model now
  mislabels `basis`/`precision` on quotes that are unambiguous in English (431: *"$8,796.50 per
  month"* labelled `per_sf_annual`; a plain *"March 15, 2021"* labelled `formula` on one of two runs).
  The 7 new date both-nulls are CORRECT nulls (formula leases). One clean OCR miss now visible:
  425's dates came through tesseract as garbage and were honestly reported as formula/null.
  Record: `responses/done/EXT1-floor-measurement.response.md`. **EXT1b staged** — parse
  `as_stated` in code as the authority.
- ⚠️ **Lesson for my own predictions:** I predicted the floor would reach ~100% and it did not,
  because I assumed the model's LABELS would be as reliable as its QUOTES. Read the rows before
  predicting the aggregate.

## 2026-09-02 — EXT1 deploy confirmed; the box bake-off graded NO GPU engine (two install misses); harness Windows-python fix; duplicate rows merged

- **EXT1 is deployed**: `985d322` is an ancestor of live `30eaced2` (cache-busted `/version`). The
  floor re-run that MEASURES it is still Scott's (`--control self --engines tesseract`).
- **Box run (19:00 UTC):** `paddle.utils.run_check()` printed *"works well on 1 CPU"* — the CPU wheel,
  not `paddlepaddle-gpu`, so the identical oneDNN/PIR failure ×18; surya's `SURYA_INFERENCE_BACKEND`
  setting exists and was not tried; tesseract byte-identical to the workstation. **Still no GPU engine
  graded.** Corrected steps on `OPERATOR-ACTIONS.md`. ⚠️ Corrected my own claim in four places
  earlier today: GaryBuilt is **Windows**, not Linux.
- **Harness:** `--self-test` now tries `python3` → `python` → `py` (the box had `python` + Pillow one
  line away and skipped). Self-test + 32 guards green in the sandbox.
- **Consolidation:** the two windows each wrote an EXT1 and an OCR1 backlog row — merged to one of
  each (dedupe grep clean). EXT1 prompt + responses → `done/`.

## 2026-09-02 — EXT1 SHIPPED (`de6daca`): the lease extractor QUOTES; the code annualizes and resolves dates. ⚠️ The floor movement is PREDICTED — the measurement is Scott's re-run.

- **What changed.** `leasePrompt` no longer asks for an answer, it asks for a quote:
  `base_rent {amount, basis: monthly|annual|per_sf_annual|per_sf_monthly, as_stated}` replaces
  `year1_rent`; `lease_commencement` / `lease_expiration` become
  `{date, as_stated, precision: day|month|year|formula}`; `lease_term {as_stated, years, months}` is
  the only input a derivation may use. `annualizeRent` / `resolveQuotedDate` /
  `deriveExpirationFromTerm` (all pure, all exported) do the deterministic part.
- ⚠️ **THE OLD `'Dates as YYYY-MM-DD.'` LINE IS REMOVED, NOT SOFTENED.** It sat two lines below the
  prompt's own `'Use null for anything the lease does not state — NEVER guess a value.'` and is the
  format rule that forced the guess. Adding `precision` beside it would have left both instructions
  live and let the model pick which to obey — which is what it had been doing.
- **A model `year1_rent` number is IGNORED whenever a quote is present**, on the tenant and on every
  `rent_schedule` row. Measured live, the model returned **84,464 and 89,496 on two runs over one
  `$8,464.00 per month` lease**; its own arithmetic can never be preferred to ours (101,568).
- ⚠️ **TWO JUDGEMENT CALLS, STATED RATHER THAN BURIED.** (1) An amount with **no stated basis**
  resolves to `null` + `rent_basis_unresolved`, not to itself — passing 90,000 through as an annual
  figure is the same guess as annualizing, in the other direction. **This is the one place EXT1 can
  LOWER coverage, and it lowers it only where the previous number was unearned**; `as_stated` is kept
  so a human can settle it. (2) *The lease states no rent* keeps that flag **false** — it is a
  different fact from *we cannot convert the rent it states* (P180's unknown-is-not-a-value, applied
  to the REASON as well as the value). Mutating either goes red.
- **Consumer contract unchanged, pinned three ways.** The six graded keys keep their names and types,
  `rent_schedule` keeps `annual_rent` (the generator's `RentPeriodInput` reads it), and a bare legacy
  number or date string still resolves — so **no backfill and no re-extraction**; the quoted evidence
  rides BESIDE the six (`bov-generator/main.py`'s `TenantInput` is `extra="allow"`).
- ⚠️ **PREDICTED, NOT MEASURED — and the sandbox cannot measure it.** No OCR engine on PATH
  (`--self-test`: surya / paddleocr / ocrmypdf / tesseract all absent) and no model, so
  `--control self` cannot run here. Prediction: `year1_rent` 89% → **~100%** (the arithmetic left the
  model); `lease_expiration` 71% → **rises**, bounded by how consistently the model classifies
  `precision`. 👤 **Verify:** `node scripts/ocr-bakeoff.mjs --run --control self --engines tesseract`,
  reading **exactly two rows** of the §1 floor table. The other four fields are the control (EXT1 does
  not touch them).
- ⚠️ **A RISING `lease_expiration` SELF-RATE IS NOT "MORE EXPIRATIONS FOUND."** Some disagreements
  become a stable **both-null**, which the harness excludes from the rate by design — read
  `self_both_null` beside the rate, or a field that got more HONEST reads as a field that got better.
- **What WAS proven here is plumbing.** The harness's offline stub (`stubExtractionAI`) now emits the
  quoted shape, so `--self-test` exercises the production path; had it kept the pre-EXT1 shape it
  would have run the legacy fallback on every self-test and left the new path untested by the one
  command that needs no model. A guard drives that stub through the real `extractTenantFromLease`.
- **Guard:** `test/ext1-lease-rent-basis-quoted-dates.test.mjs` — 21 tests, **20/20 mutations RED**.
  ⚠️ **Two survived their first mutation pass and BOTH were the test's fault, not the code's:** the
  cents assertion was built on `12.51 × 3810`, which is **exact in IEEE-754**, so it passed with the
  rounding removed; and the schedule test supplied no conflicting `annual_rent`, so "prefer the model
  number" changed nothing. **The mutation pass found both; reading the tests did not.**
- ⚠️ **The one source-shape guard needed comments stripped THEN literals blanked.** The module's
  comments quote `year1_rent` and `84,464` while explaining the fix, and **the prompt itself is a wall
  of string literals naming `base_rent`, `basis` and `precision`** — so a code-shape grep matches the
  prompt text. It pins `cleanRentPeriod(p, sf)`: `.map(cleanRentPeriod)` bare passes the array
  **index** into the leased-SF slot, making period 0 unconvertible and period 1 a 1-SF building,
  silently.
- Full suite **5,102 pass / 0 fail / 6 skipped**. Record:
  `responses/EXT1-lease-rent-basis-quoted-dates.response.md`.

## 2026-09-03 — CONTACT1: 🚨 PR5c-entities-b INSTRUMENTED A FUNCTION THAT HAS NEVER RUN. The ladder was wired to dead code, and my own STATUS entry asserting otherwise is corrected in place.

**Verified live, every claim reproduces:** `enrichment_jobs` holds **0** rows of type
`salesforce.contact.upsert` — **ever** — and the only job types that exist at all are
`outlook.message.extract` and `cre.doc.text`. `field_provenance` on `entities` is still **4 rows**
(`phone`/`domain_owner_contact`, from one manual tick); `source='salesforce'` is **0**; and
`provenance_write_failed` alerts are **0 — because the instrumented path never even attempts a write
to fail.**

**Where the traffic actually is.** Traced through `external_identities.metadata->>'synced_via'` over
the last 30 days of `salesforce/Contact` mints (337 measured today):
**195 `salesforce-sync.v1`** → `api/_shared/salesforce-sync.js::writeEntitySalesforceLink`, driven by
cron 165 (`lcc-sf-contact-resolve`, every 30 min) · **142 null**, not yet traced ·
**0 `phase1.bridge-handlers-salesforce`.** The entity carrying the email at creation is minted
separately by `sf-list-import.js` → `ensureEntityLink`, bypassing `insertEntity` entirely. **None of
`ensureEntityLink`, `salesforce-sync.js` or `sf-list-import.js` calls
`recordFieldWrites`/`shouldWriteField`** (grepped, zero hits).

**So "both ladders are empty" had the wrong cause.** It is not *no history yet* — it is *the wiring
landed on unused code while the two live writers remain invisible to both ladders.*
⚠️ **My PR5c-entities-b STATUS entry is corrected in place above** — it named `insertEntity` as "the
single owner of the `entities` POST" and predicted ~12 rows/day. Both were wrong, and the
`0 provenance_write_failed` I recorded as reassuring is actually the tell: **a path that never runs
cannot fail.**

**Answers to the two questions the prompt asked:**
- **PR10 — `field_provenance` should own it**, `metadata.field_sources` retires to a private
  per-writer cache. It is fleet-wide, registered, queryable, and its gate is what
  `planContactFieldPromotion` reads back next run; the metadata copy is undiscoverable, unregistered,
  and self-perpetuating when wrong. ⚠️ **Moot until the real writers point at either ladder.**
- **PR5c-enforce unblock condition, numeric:** grade only once `field_provenance` for
  `(entities, email|phone)` exceeds **~50 rows across ≥2 distinct sources with real
  write/skip/conflict decisions**. Today: 4 rows, 1 source, all `write`.
- **`SF_CONTACT_WRITEBACK` reads as standing doctrine, not a pending rollout** — the handler pushes
  LCC-resolved contacts OUTBOUND to Salesforce, the direction `CLAUDE.md` forbids ("never writes back
  to clean SF"); `off_since` NULL means nobody has ever flipped it. **`owner-contact-propagate` has
  no cron** (confirmed absent; 11 other contact-family jobs exist) — unscheduled, not broken.
- **`sf-list-import.js`'s CREATE lane is live and quiet, not dead** — 142 mints in 14 days (~10/day).

**Nothing was built, correctly** — the fix touches `ensureEntityLink`, the live person-entity mint
path used far beyond Salesforce, and CC declined to guess at that scope. → **CONTACT1a**.

## 2026-09-03 — ADDR1 SHIPPED (#2108, `9bff5289`) and verified live: the mechanism was FOUR missing section headers in one regex, and my "second phantom" reading was WRONG.

**The mechanism, and it explains the asymmetry my prompt asked about.**
`extension/content/costar.js`'s `FOREIGN_PARTY_HEADER_RE` — the guard that stops
`findAddressInLines` from taking an address out of a foreign-party block — knew
`recorded buyer / listing broker / lender / borrower / …` and **did not know
`Sales Company` / `Sales Contacts` / `Listing Contacts` / `Property Manager`.** So on the Contacts
tab the first address-shaped line the one-pass scanner met was SRS's office, and it won. **City/state/
zip came out right because they come from a different field** — that was the tell, and it is now
four alternations wider, plus a server-side belt (`api/_shared/contact-address-bleed-guard.js`,
wired into `upsertDomainProperty`) so a future client build cannot re-open it alone.

**⚠️ My reading of the second row was wrong, and the correction matters.** I filed 50990 as a
probable duplicate of the same phantom. It is **a REAL, DISTINCT Gary, IN property** with different
stats and its own broker, which merely lost its street to the same bleed. CC read it before acting
and applied the right doctrine: **the corrupted street is QUARANTINED (nulled, original preserved in
`notes`, `address_source='addr1_quarantined_contact_bleed'`), not guessed at** — *write no address
rather than a wrong one*. city/state/zip were already correct and were left alone. **A "repair" that
treated it as a duplicate would have destroyed a real property.**

**37491 was the duplicate, and its attached sale was real data.** Merged into 35722 via the EXISTING
reversible `dia_merge_property_reversible` (walks every FK, snapshots the dropped row) — verified:
37491 gone, `dia_property_merge_backup` holds 1 row under `addr1_costar_contacts_bleed_20260903`,
and **35722 now carries 1 sale + 3 listings**, i.e. the phantom's $4.38M 2017 sale (buyer OSAGE
TOWERS, seller LAKE DELTON RE — Lake Delton adjoins Wisconsin Dells) came home to the real property
rather than being deleted with the shell. `properties where address='680 Newport Center Dr'` = **0**.

**The detector is narrow ON PURPOSE and that is the load-bearing choice.** It requires a captured
CONTACT to name that exact street as *its own* office at a DIFFERENT city/state — so an owner
genuinely headquartered at its property (**12 of 13 raw matches on this table**) is excluded by
construction. This is why my two loose detectors (108 addresses over 2+ cities / 242 rows; 98 over
2+ states / 202 rows) were correctly refused: they were dominated by `Dialysis Unit`, `TBD` and
common street numbers. **`v_dia_contact_office_address_bleed_review` reads 2 today** — property
37503 (`3121 Michelson Dr` ← IRA Capital, Irvine CA) and 37783 (`4700 Wilshire Blvd` ← CIM Group,
Los Angeles) — **both `buyer`-role contacts, i.e. a DIFFERENT capture surface from the Sales-Company
block the regex fix covers.** Neither is auto-repaired. The gov mirror view exists and is applied.
Guards: `addr1-costar-foreign-party-header.test.mjs` + `addr1-contact-office-address-bleed.test.mjs`.

## 2026-09-03 — ✅ PR2's PRODUCER PROOF IS CLOSED (a new sidebar capture wrote a parcel row WITH stats), and the same session surfaced 🚨 ADDR1: the Contacts tab's broker office address minted as a property.

### PR2 — Class 8 closed, on the state delta

Scott captured three dia properties chosen because they had **no** `property_public_records` row,
forcing an INSERT. **A new `costar_sidebar` parcel row landed 20:08:42 UTC** — APN `08H-61-0665`,
St. Louis MO, **`building_sf` 5,600 · `lot_sf` 196,543 · `year_built` 2020** — the first parcel row
since 2026-08-31 and the first ever written by the FIXED writer. **0 sub-100-sq-ft lots**, so the
acres bug is absent on the forward path too. The verify-next that had been open since 09-02 is done:
**the producer is fixed, not just the backfill.**
⚠️ **Why the earlier Hillsboro capture did NOT prove it:** APN `145416` already had a parcel row from
**April**, and its stats came from the 09-02 backfill (its zoning is `"C" - Commercial` — the exact
PR12 quote-loss row). `fetched_at` never moved. **An existing row makes the proof invisible** — pick a
subject with no row when testing a writer.

### 🚨 ADDR1 (new) — a phantom property minted from the broker's office address

Capturing `E10196 County Road P — DaVita, Wisconsin Dells WI` **with the Contacts tab open** created
**property 37491 = `680 Newport Center Dr, Wisconsin Dells, WI 53965`** — SRS Capital Markets'
Newport Beach office street stapled to the subject's city/zip, carrying the real property's stats
(7,895 SF / 2017 / 45,302 lot) and **already holding 1 sale and 3 listings**. It is a live duplicate
competing with the real row 35722. **Not a one-off — property 50990 is `680 Newport Center Dr,
Gary, IN 46408` from 09-02.**
- ⚠️ **The city/state/zip came out RIGHT and only the street was wrong** — that asymmetry is the
  diagnostic and it is in the prompt.
- ⚠️ **The naive detectors are too loose and must not be used to drive a repair:** 108 addresses
  across 2+ cities / 242 rows, and 98 across 2+ states / 202 rows, are dominated by placeholders
  (`Dialysis Unit`, `TBD`, `1 sect`) and common street names — **not this bug.**
- Same producer and same shape as the Prompt-89 TrafficMetrix misparse (reading the wrong region of
  a CoStar page); `tm-misparse.js` is the existing guard for the CONTACT version.
- Prompt drafted: `ADDR1-broker-office-address-minted-as-property.md`.

### The Loan tab is being captured — and the CMBS fields still do not land

Scott confirms he opens the Loan tab on every capture, and **3 `loans` rows were touched today**
(`Oklahoma Fidelity Bank`, `Wells Fargo Bank Na`, `National Medical Care Inc`). But all three carry
`data_source='costar_sidebar'`, `is_cmbs=false`, and **`costar_loan_id` NULL — still 0 of 662 dia
rows.** So the property-page scanner is writing the loan summary while
`parseCmbsLoanDetail` never fires. **PR5d's verdict is refined, not overturned:** the loan
SUMMARY is captured; the CMBS servicer detail is not. → **PR5d-a is now a question about WHICH
sub-page/section, not about subscription access** (Scott has the Loan tab). A screenshot of the Loan
tab on a CMBS-financed property is the cheapest next input.

### Junk lane — worked, with a named residue

All 80 decided: **41 mailboxes freed** (email cleared + identities detached on all 41), 37 holds
correctly untouched, 2 renames. The 41 show `status='conflict'` = `conflict_fk`: **the un-stamp ran
first and the soft-retire was then blocked because other rows still reference the entity.** That is
the design working — harm stopped, nothing destroyed — but they remain live, flagged, de-emailed and
un-retired. → backlog **ENTC-junk80-fk-residue**.

## 2026-09-03 — gov parcel backfill RUN server-side (1,230 rows, 0 unit errors) and PR5d verified: the CoStar CMBS arm is a page nobody has ever captured, with a second blocker underneath.

### gov PR2 backfill — executed from Cowork, not the script

Scott's shell has no `*_SUPABASE_*` vars, so this ran DB-side. ⚠️ **The parse was NOT
re-implemented in SQL** — the metadata was pulled from LCC Opps, run through the SHIPPED
`parcelStatsFromMetadata` in the sandbox, and only the parsed values were written. That keeps the
lot-unit rule (I12) in exactly one place, which is the whole reason the script exists.
**gov `costar_sidebar` parcels: `building_sf` 0 → 1,192 · `land_area_sf`/`land_area_acres` 0 → 1,109 ·
`year_built` 0 → 1,153 · `zoning` 0 → 291** (1,230 rows touched of 1,527). Snapshot
`_pr2_parcel_stats_backup_pr2govcowork20260903` (1,230 rows, **all pre-states blank** — fill-blanks
proven, not asserted); reversible by batch tag `pr2_gov_cowork_20260903`.
- **0 sub-100-sq-ft lots and 0 absurd lots after the write** — the acres-as-square-feet bug (43,560×)
  is absent, confirmed on all three CoStar formats present in the data (`5.26 AC`,
  `6.00 (261,360 sf)`, `68,259 SF`).
- ⚠️ **One row EXCLUDED before writing:** APN `0403` parsed to **2,304,454,680 sq ft / 52,903 acres**
  — 82 square miles. The parser is faithful; CoStar's own string is `52,903.00 (2,304,454,680 sf)`.
  Writing it would poison every land metric, so it was left blank and is named here rather than
  silently dropped. **The dia run had no such outlier** — worth a look if a land ratio ever reads odd.
- ⚠️ **`tax_amount` / `land_use` / `owner_name` stay 0 on gov too**, same measured ceiling as dia —
  those keys have never appeared on any capture.

### PR5d (#2098 lineage, migration `20261010120000`) — verified live

**121 rungs verdicted: `page_never_captured` 94 / `page_never_captured_flag_off` 27.** Rungs 2,141,
PR5 426, PR5c 33, orphan 49 — all unmoved. `lcc_loan_maturity` 568.
- **The answer is (c): the scanner, the writer and the manifest match are ALL live and correct** —
  `parseCmbsLoanDetail` → `upsertLoanRecords`, `https://*.costar.com/*`, and `pageUrl` read from
  `window.location.href` at extract time so SPA routing is a non-issue. **The CoStar loan sub-page
  has simply never been captured.**
- **Ruling out the rename class needed a column only that arm writes:** `loans.costar_loan_id` and
  `loans.source_url` are **0 of 2,219 rows on both domains**, and `loan_snapshots` /
  `loan_top_tenants` / `loan_commentary` are 0 rows on both. ⚠️ **That zero is evidence only while
  exactly one writer could have made it non-zero** — the guard now pins that single-writer property.
- ⚠️ **A second blocker the (c) framing misses:** dia's `properties.track_cmbs_snapshots` is `false`
  on **11,803 of 11,803**, so capturing the page tomorrow would still write nothing there. That
  boundary IS the 94/27 split.
- ⚠️ **It supersedes R54 Unit 3's mechanism (75 days old):** gov reads `is_cmbs` 285 /
  `special_servicer` 126 and looks like CMBS capture — but those come from a DIFFERENT scanner on the
  property page deriving `cmbs_deal_name` from a lender-name regex. R54's disposition was right, its
  mechanism wrong, which is why this read as a coverage question for 75 days.
- **Not retired, and the reason is a starved consumer:** R54's `is_distressed` arm is built, ranked
  and has never had an input — **0 of 178 gov watch rows**, with watchlist / delinquency / DSCR at 0
  across 285 CMBS loans. Only this arm can feed it. → **PR5d-a** (👤 does Scott's CoStar session reach
  that sub-page, and does the subscription expose the servicer report?) and **PR5d-b** (the dia flag).
- **UX-T1a reconciled in place:** its *"192 loans maturing ≤24 mo has no LCC table at all"* was true
  on 09-02 and superseded the next day by UX-T1a-gates — `lcc_loan_maturity` holds those 192 exactly
  (gov 170 + dia 22), and `costar_cmbs_loan` supplied **0** of them. **The residual debt gap is
  DISTRESS, not maturity.** Corrected in `app-ux-review-2026-09-02.md`, the audit and `CLAUDE.md`.
- Guard 12 tests, **21/21 mutations RED** — three of CC's own assertions survived their first
  mutation and the pass caught all three. Suite 5,314 / 0.

**CC's own recommendation, and I agree:** `PR5c-enforce` outranks PR5d-a — the ten `entities`
contact rungs are all `record_only`, so that ladder records and protects nothing.

## 2026-09-03 — ENTC-confirm EXECUTED (15/15 merged, `goes_by` stamped) and 🚨 SALE1 FOUND: one price propagated across several sales of one property, with the source's own "not a comp" markers ignored.

**Merges (Scott approved all 15):** every pair merged cleanly through `lcc_merge_entity` — 14 moved
an external identity, 1 moved none, 0 portfolio edges (contact-only rows, as the plan predicted).
Reversible per row with `lcc_unmerge_entity(loser)`. **`metadata.goes_by` stamped on all 15
survivors** (`goes_by_source='entc_merge_20260903'`) at Scott's request — Vincent Curran carries
`["Vince Curran"]`, etc. ⚠️ **Nothing reads it yet** → backlog **ENTC-goes-by**; it is an ALIAS,
never an identity key.

**SALE1 (new, 🚨):** Scott's Hillsboro capture surfaced **three sales of dia property 35612 at an
identical $1,593,750**, all `live` and all in comps — a 2009 **Nominal Transfer**, a 2024 Resale,
and a 2026 row whose own CoStar note says **"not suitable for sales comparable purposes"** —
yielding **three different cap rates (5.24 / 7.48 / 7.84%)** from one price.
- Class: **668 (property, price) groups / 1,517 rows / 568 properties**; **272 span >1yr, 166 of
  those with 2+ rows still in comps.**
- ⚠️ **The dedup machinery is working and cannot see it.** `dedup_natural_key` is
  `property|price|YYYY-MM` (UNIQUE; 485 same-month collisions correctly `duplicate_superseded`) —
  property 26404 shows both halves at once, two pairs correctly deduped and three cross-month rows
  at $10,260,000 all live. **A key that encodes the month is structurally blind to a cross-month
  repeat**, which is exactly the propagation shape.
- Second defect: `transaction_type ilike '%nominal%'` = **38 rows, 28 in comps**; the CoStar "not
  suitable" string = 1 row, in comps. `exclude_from_market_metrics` is set on 1,750 of 4,785 rows,
  so the column is used — just not from these signals.
- `cap_rate_final` derives from `sold_price`, so this reaches every CM consumer. Prompt drafted:
  `SALE1-repeated-price-and-comp-eligibility.md`.

**Also:** the Hillsboro capture landed on the EXISTING property 35612 (no new property needed) and
wrote no `parcel_records` row — **PR2's producer proof is still open**; it needs a dia capture whose
CoStar page exposes the Public Record panel.

## 2026-09-03 — OPERATOR QUEUE RUN SERVER-SIDE (Cowork): junk80 SEEDED (80), the propagate tick TICKED (`entities` provenance 0 → 4), `availability-checker` DEPLOYED (v21, verified live).

All three via the DB (`lcc_cron_post` / direct SQL / the Supabase MCP), because the sandbox has no
Railway egress and Scott's PowerShell hit two doc errors:

- **junk80: seeded 80 proposals (41 dismiss / 39 holds), batch `junk80_sql_20260903`** — by direct
  SQL replicating the handler byte-for-byte, because `?_route=junk80-seed` **500s on the deployed
  build** (filed **ENTC-seed-500**) and the doc said `?action=` where the dispatcher keys on
  `?_route=`. Two schema traps en route, both already in this file's catalogue: `review_id` is
  `GENERATED ALWAYS` identity (`information_schema` shows no default for identity columns — the
  P195 428C9 shape), and the first insert attempt guessed uuid for a bigint.
- **`owner-contact-propagate` tick: `field_provenance` on `entities` 0 → 4** (`domain_owner_contact`,
  batch `ocp_20260903`; 24 owners with candidates, 4 org phones filled, 31 reviews queued, 192
  `no_contact_detail`). The PR5c-entities verify-next is CLOSED.
- **`availability-checker` v20 → v21 deployed** (index + parsers + `_shared/cors`, verify_jwt off as
  before). Health green; a live `domain=dia&limit=3` run returned a clean 200 apply envelope
  (3 × `skipped_no_url` — the head of the overdue queue has no URLs; a data fact). PR5c-deploy CLOSED.
  ⚠️ `lcc_cron_post`'s edge arm prefixes `https://…/functions/v1` itself — an endpoint carrying
  `/functions/v1/` doubles the path and 404s `Requested function was not found`.

**Scott's remaining queue is now only:** work the junk cards · ENTC-confirm (15 merges) · one dia
sidebar capture (PR2 producer) · gov backfill · N15e / PR9 / BR1-confirm decisions · Dialysis CI
toggle · SAM/Regrid keys.

## 2026-09-03 — PR5c-entities-c-review + -oldest (#2083, `dc52e922`): the 15-pair merge plan is built and WAITING ON SCOTT; the oldest-row gate is measured and REFUSED; and the round trip broke `lcc_p195_unmerge`.

**Verified live:** `v_lcc_entities_c_review_merge_plan` **15 rows / 2 bases** (`initial_only_expansion`
6 — a structural rule that fires on 0 of the other 49; `human_read` 9 — the honest basis, since the
alternative is the banned comparator); blind pairs 55; drift 0; nothing merged; still **0** SF-Contact
mints since `d5b0ac8` (the post-fix rate remains unmeasurable).

- 🚨 **`lcc_p195_unmerge` STRANDS byte-identical edges while reporting `restored`** — three identical
  `(from,to,'brokers')` edges are all snapshotted, and P196's own BEFORE-INSERT trigger skips the 2nd
  and 3rd as duplicates so they never reach `ON CONFLICT (id) DO UPDATE`. **P196's exact finding, in
  the one reversal path that never got P196's fix.** Row count identical in both runs — only the
  identity-keyed fingerprint exposed it; a count-based unmerge verification is worthless.
  **Reverse with `lcc_unmerge_entity`, never `lcc_p195_unmerge`** (now in the invariants). Filed
  `PR5c-entities-c-p195-unmerge`.
- ⚠️ **The P195 winner rule DEGENERATES on contact-only populations** — owns/rent/facts are 0 on 92
  of 93 endpoints, so the winner falls to external-ids-then-relationships and picks `Frank Johnson`
  over the older, better-connected `Frank D. Johnson`. The plan exposes `winner_decided_by` +
  `ownership_tiers_all_zero` so a row can be swapped before confirming.
- **The oldest-row gate is REFUSED on measurement:** reach 22 of 193 groups, accuracy 12 of 26 on
  the population it exists for (`lcc_looks_like_person` PASSES 16 of the 26 junk rows), useless for
  the 37 junk rows alone on their mailbox, and 171 of 193 groups have ≥2 rows passing every guard so
  no shape gate can pick. **Retire the junk rows instead** → `PR5c-entities-c-junk80` (80 live
  junk-named person entities with emails; 0 in `junk_entity_review`, 0 flagged — invisible to both
  existing lanes). Two unstated facts recorded: the email tier's `.find` scans the **oldest 10 rows
  only**, and an inbound with no domain searches the whole workspace.
- **The race count is 3, not 2** — two live `Matthew Dodson` entities 0.107 s apart that the prior
  audit read as a duplicate view row (backlog corrected).

All docs closed by CC in the same change (audit, canonical page §5, CLAUDE.md invariants, backlog ×5).
👤 **The 15-pair confirm is Scott's** → OPERATOR-ACTIONS. Prompt + response filed to `done/` this turn.

## 2026-09-03 — ENTC: the junk80 census (**the 80 are not one class**), the entity-mint gate, and `lcc_p195_unmerge` FIXED — retiring it would have made 66 live merges irreversible.

Migrations `20261014120000` (p195 fix) + `20261015120000` (`v_lcc_entities_c_junk80`), both applied.
Guard `test/entc-junk80-and-p195-unmerge.test.mjs` — 13 tests, **19/19 mutations RED**; full suite
5,278 pass / 0 fail. **Nothing retired, renamed, merged or swept; the seeder is dry-run and unapplied.**

- ⚠️ **BEFORE RETIRING A SUPERSEDED FUNCTION, CHECK THE POPULATION IT STILL OWNS — NOT THE DATE THE
  SUCCESSOR SHIPPED.** `lcc_p195_merge_log` holds **66 open merges, ZERO with a
  `lcc_entity_merge_log` row**; they ran hours before P196 taught `lcc_merge_entity` to
  self-snapshot, so `lcc_unmerge_entity` answers `no_open_merge_log_row` for all of them. Both
  ledgers start 2026-08-27, which is exactly why "redundant now" reads true and is false. Fixed to
  P196's shape + a want-vs-have `note`; round trip 24/24, **0 lost, 0 stranded**, `restored` 17 → 19.
- ⚠️ **A GUARD-DEFINED POPULATION IS NOT A CLASS.** 41 `sweep_candidate` / 27
  `hold_salesforce_identity` / **6 `hold_email_corroborated`** / 4 `hold_inbound_reference` / 2
  `hold_name_repairable`. The six carry a name token inside their own mailbox localpart
  (`Eyal (Al) Elkayam`/`eyal@`, `Hunt`/`hunt@`, `Jackson`/`kjackson@`) — **the row IS that
  mailbox's person; clearing its email is the harm.** Two more are a real person behind a CoStar
  `Seller Contacts…` prefix (a `rename`, not a retire). Only sweep candidates propose an action.
- ⚠️ **TWO WRITERS ON ONE CAPTURE, TWO DEFINITIONS OF "JUNK", AND THE WEAKER ONE MINTED THE
  ENTITY.** `upsertSidebarContacts` always dropped `isJunkContactName` failures; the entity mint
  (`unpackContacts`) applied only the TrafficMetrix detector. Gated by INJECTING the existing guard
  into `planContactMinting`, **PERSON-ONLY** (it rejects firm suffixes, so on an organization it
  would block every real company mint). **38 of 80 (47.5%), 0 of the 6 real people.**
- ⚠️ **THE REMEDY WAS UNREACHABLE AND THE TEMPTING FIX WAS A LIE.** `unstampMisparseMember` fired
  only for `heuristic === TM_MISPARSE_HEURISTIC`; relabelling junk80 rows `tm_misparse` to reach it
  would have put a false fact in the ledger. Keyed on the CLASS now (`EMAIL_CONFLATION_HEURISTICS`).
- ⚠️ **Two corrections to the prior audit: 11 of the 80 DO carry `metadata.junk_name_flagged`**
  (not 0), and **"37 alone on their mailbox" is domain-scoped — by address it is 31** (both emitted).
- ⚠️ **The brief's two verification targets are in tension and the protective one wins:** junk-oldest
  contested mailboxes **14 → 3**, but alone only **37 → 29**, because 23 of the 37 carry an SF
  identity and go to review by design. 35 mailboxes freed, 49 identities detached, **0 relationships
  touched**. (The prior audit's 26 was a HUMAN read; the guard-measurable figure is 14.)
- All three definer unmerge functions narrowed to `service_role` (0 PostgREST callers), revoking
  from **both** `public` and the explicit grants, **asserted with `has_function_privilege()`**.

👤 **`junk80-apply` is Scott's** (OPERATOR-ACTIONS). Open: `junk80-gate-p131`, `p195-unmerge-callers`.

## 2026-09-03 — PR5c-entities-b-dupes (#2076, `d5b0ac8`) + PR5c-entities-c (#2079, `cbac828a`): the duplicate-mint mechanism was `entities.domain` scoping the IDENTITY key — and the sibling tier must NOT get the same fix. Entity-identity topic consolidated.

**Verified live 07:40 UTC:** `/version` = `cbac828a` = `main` (both PRs running); drift **0**;
`v_lcc_entity_email_tier_blind_pairs` **55**; `v_lcc_entity_duplicate_mint_review` **691** (90-day,
incl. the 553-pair `older_row_has_no_email` bucket — deliberately unswept); **0** SF-Contact mints
since the fix, so the post-fix rate is **not yet measurable** (baseline 3.37%).

- **The prompt named the wrong module, and a run ledger settled it in one query.** `bridge_runs` =
  **zero** Salesforce bridge runs in the incident window; `findEntityForUpsert` never executed. The
  writers were the `lcc-sf-contact-resolve` tick (cron 165, 10 of 13 mints within seconds of :00/:30)
  and the CoStar sidebar — both through `ensureEntityLink`, whose canonical_name tier carried
  `&domain=eq.<domain>`. **All six predicates the prompt listed are refuted** (older row live, person,
  same workspace, byte-identical email). 9 of 11 = `cross_domain_canonical_miss`; 2 = 0.14 s races.
- 🚨 **A shallow clone reports the graft boundary as the "add"** — `git log -S` dated the lookup to
  2026-09-02 and it was published as a refutation before `git fetch --unshallow` showed 2026-05-09;
  and `git show <sha>^:file | grep -c` over a nonexistent parent printed a confirming `0`. **Never let
  an error render as a zero** — the file's own doctrine, committed by its author.
- **The obvious follow-up (drop the filter on the EMAIL tier too) was measured at 27% precision and
  REFUSED**: 40 of 55 cross-domain same-email pairs are two real brokers on one mailbox (Phillip
  Kelly / Toby Scrivner @northmarq), firms filed as persons, or P131 row labels. **An attach is worse
  than a duplicate** — the guard goes RED if someone "fixes it for consistency."
- Honest rate: 326 creates / 13 on an existing live key (3.99%) / **11 probable duplicates (3.37%)**
  — the brief's 14 / 4.3% does not reproduce. Expect ~0.6% residual until the
  `(workspace_id, canonical_name)` unique constraint (N15e, 👤 6,608 groups).
- **Filed:** PR5c-entities-c-race · -oldest (email tier attaches to the OLDEST row, row-label or not —
  live within a domain) · -review (15 genuine pairs → human merge, one at a time).

**Consolidation (this turn):** `docs/architecture/entity-identity-and-dedup.md` is the canonical page
— model, banned comparators, dated live state, arc index (P189 → P195 → N15c/d/e → dupes → entities-c),
open ids — with the five `CLAUDE.md` blocks (P195, N15c, N15d/e, dupes, entities-c; **357 lines**)
moved **verbatim** and an eight-bullet invariant list left in place. The dupes work had no audit doc;
the page is now its record. Ladder page §4 and handoff updated; prompt + response filed to `done/`.

## 2026-09-02 — PR5c-entities-b SHIPPED (#2072, `886cdf86`) and ✅ THE RAILWAY REDEPLOY IS CONFIRMED: live `/version` = `886cdf86` = `main` HEAD. Every JS half of the provenance arc is running. New finding outranks the arc: the SF bridge mints a duplicate on 4.3% of creates.

**Verified live 22:08 UTC:** `/version` read from the DB —
`net.http_get('https://tranquil-delight-production-633f.up.railway.app/version')` → `net._http_response`
15 s later → `{"version":"886cdf8622f4","git_pinned":true}`. ⚠️ The bare host without `-633f`
answers **404 `Application not found`**, which reads exactly like a dead deploy; I hit it first.
`source='salesforce'` on `entities` **0** (deployed minutes ago; 3 SF contacts in the prior 24 h;
~12 rows/day predicted — read tomorrow); unranked 29; drift 0; 0 failure alerts.

- 🚨 **SUPERSEDED 2026-09-03 by CONTACT1 — THIS WHOLE BULLET IS WRONG.** `insertEntity` is
  reached only from `handleSalesforceContactUpsert`, which **has never run**: `enrichment_jobs` holds
  **0** rows of type `salesforce.contact.upsert`, ever (the only job types that exist are
  `outlook.message.extract` and `cre.doc.text`). The ~336/30d population is real but belongs to
  **different, uninstrumented writers**. The provenance recording below was added to dead code.
  *Was:* **The write site is `insertEntity` (`bridge-handlers-salesforce.js:232`)**, the single owner of
  the `entities` POST — recording placed there so a future third caller inherits it. **Records,
  never gates**: a create has no prior value, and gating would let a registry outage cost a
  Salesforce contact. Rolled-back proof: 2 rows, `write`/`no_prior_provenance`, rung 20 (the
  registered rung resolved, not the unregistered branch); positive control `'lcc'` → 23514.
- 🚨 **`PR5c-entities-b-dupes` (new):** of 329 creates in 30 days, **14 (4.3%) landed on a
  `canonical_name` an older LIVE entity already held** — 9× N15c's bulk-sync rate. 8 of 14 share the
  older row's email (the bridge's own `email=ilike` dedup should have caught them); not a race (2 of 8
  within 5 min). 6 of 14 read as a person who changed firms — the documented "track where they went"
  case; a name-only sweep would be destructive. **Measured, not diagnosed; outranks PR5c-enforce.**
- CC also collapsed a merge artifact on the ladder page (two "Deploy state" blocks, one two
  redeploys stale) — the parallel-window shape again.
- Guard +6 tests, 8/8 mutations RED; CI 5,192 / 0.

**What is now purely operator-side** (`OPERATOR-ACTIONS.md`): one `owner-contact-propagate` tick;
one dia sidebar capture (PR2 producer proof — no capture since 08-31); the gov backfill; the
`availability-checker` edge deploy; PR9. Docs: ladder page §3 (deploy state corrected to `886cdf86`
+ the host suffix trap), handoff verify-next table, OPERATOR-ACTIONS (a duplicated `PR2-gov` row
from the parallel merge collapsed to one). Prompt + response filed to `done/`.

## 2026-09-02 — PR5c-entities SHIPPED (#2066, `e9c74357`): the two `entities` contact writers consult the ladder — and it buys RECORDING, not protection, because every rung is `record_only`.

**Verified live:** `field_provenance where target_table='entities'` **0** (correct — neither writer
has a cron, `SF_CONTACT_WRITEBACK` is `off`); all ten `email`/`phone` rungs `enforce_mode='record_only'`
(`manual_edit`/`manual_resolution`@1 → `salesforce`@20 → `domain_owner_contact`@55 → `costar_sidebar`@60);
unranked **29**; 0 provenance-failure alerts. CI green on the merged SHA — CC checked the run on
`b71fde0f`, not the one it validated (`3093f846`), because the merge UI added a second commit; merged
**7 s after** the required suite went green.

- **Wiring a ladder onto a table with an empty ledger cannot protect a curated value it has never
  seen** — `lcc_merge_field` compares against `field_provenance`, not the live column, so the first
  call on every field returns `no_prior_provenance ⇒ write`. And under `record_only`,
  `shouldWriteField` records a `skip` and the write proceeds anyway. **Read the enforce mode before
  predicting any behaviour change**; this is the prerequisite for grading a gate, not the gate.
- **A grep does not find the writers of a column** — grep 24 sites / 13 files, AST walk **41 / 16**;
  per-file column unions mis-labelled `bridge-handlers-salesforce.js` as an `email`/`phone` PATCHer
  when only its CREATE path carries them. Count with a parser, read the payload per SITE.
- **Where the writer has its own ledger (`metadata.field_sources`), a field the ladder drops must
  lose its stamp there too** — that stamp is what the writer reads next run (the PR10 two-ladders shape).
- **Two premature `check_suite.completed` webhooks** (one 46 s before the test job started) — read
  as "CI passed" either would have been wrong. Verified against the runs each time.
- **Filed:** `PR5c-enforce` (all ten rungs `record_only`; ungradeable until the ledger has history)
  and **`PR5c-entities-b`** (`bridge-handlers-salesforce.js`, ~336 SF contacts/30d, unwired — the
  nearer win because it runs daily). JS ships on the Railway redeploy (`e9c74357`).

**Verify-next:** post-deploy, an operator tick of `owner-contact-propagate` → `entities` rows `0 → N`
split by source/decision. Guard `test/pr5c-entities-ladder-wiring.test.mjs` (14 tests, 17/17
mutations RED). Docs: `docs/audits/PR5c_entities_LADDER_WIRED_2026-09-02.md` · ladder page §3/§4 ·
`CLAUDE.md` invariant list · backlog (all by CC). Handoff §3 rewritten this turn into a verify-next
ledger (the closed-PR narrative now lives on the ladder page only). Prompt + response filed to `done/`.

## 2026-09-02 — PR5c CLOSED (#2060, `06a3ee5d`): the 33 zero-row LCC-internal rungs were one CHECK constraint — five callers sent a `target_database` outside the vocabulary and failed 23514 on 100% of calls, silently.

**Verified live on LCC Opps after the merge:** all **33** rungs carry a `pr5c_verdict` —
`no_merge_path_caller` 13 · `reached_and_broken` 10 · `ledger_is_elsewhere` 6 ·
`producer_never_wired` 2 · `unreached_and_broken` 2; `field_provenance` rows on the six tables
**0** (correct until a producer runs post-deploy); rows with an out-of-vocabulary
`target_database` **0**; unranked **29**. CI 5,132 / 5,126 / 0 fail.

- **`lcc_merge_field` ALWAYS inserts a row** (write/skip/conflict, no early return), so a
  (table, field, source) at zero rows means the RPC never COMPLETED. That one observation turned
  "did the lane run?" into "does the call succeed?", answerable in one rolled-back replay: **6 of 6
  PR5 §2 sources fail, 5 with 23514**; the sixth (`lcc_generated`) is correct and simply unrun.
  Single owner now: `provenanceTargetDatabase()` in `field-priority-guard.js`; guard 12/12 mutations RED.
- **The rule was already written beside ONE call site** (`comms_owner_bridge`, the only LCC-internal
  lane that has ever written provenance) — and it cited `availability-checker` as a correct
  precedent, which sends the bare `'dia'`. **A comment naming a sibling as correct is not evidence.**
- **Corrects PR12 §4 in place:** its ~0.03% break-class rate measured the stored COLUMN; three
  sites `JSON.stringify` a jsonb parameter, so their payload rate was ~100%. The verdict survived
  (23514 fires regardless), the reasoning did not.
- **Corrects PR5 §1a:** `field_provenance` HAS run on one LCC-internal table (`comms_owner_bridge`, 22 rows).
- **PR12's failure signal cannot see any of the five** — they call the RPC directly, not through
  `shouldWriteField`: **0 open alerts over a population failing 100%** → `PR5c-signal`.
- **Not fixed, filed:** `PR5c-entities` (13 rungs, no merge-path caller at all while a dozen paths
  PATCH the table — the next real piece of work), `PR5c-avail-field` (rung says `status`, writer
  writes `is_active`), **`PR5c-deploy`** (the `availability-checker` edge function is a THIRD deploy
  surface, fixed in source, NOT deployed — Scott's call).

**Verify-next (Class 8):** a `field_provenance` row on `public.lcc_cre_property_documents` after the
next CRE folder-feed registration, **post-Railway-redeploy** — the count correctly stays 0 until then.

Docs: `docs/audits/PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md` · `CLAUDE.md` PR5c block · backlog
PR5c ✅ + four siblings · handoff (all by CC, in the same change — the turn protocol working).
OPERATOR-ACTIONS + CURRENT-STATE this turn. Prompt + response filed to `done/`.

**Consolidation (this turn): the provenance ladder now has ONE canonical page** —
`docs/architecture/field-provenance-ladder.md` (model · instruments · dated live state · arc index ·
open ids · and the PR8/PR5/PR12/PR5c lessons moved out of `CLAUDE.md` **verbatim**, 251 lines).
`CLAUDE.md` § "Field-level data provenance" keeps a ten-bullet invariant list and points there.
Relocate, not archive (DOCUMENTATION-MAP §6z): nothing deleted, every inbound mention is a bare name.

## 2026-09-02 — PR12 SHIPPED (#2057, `68ede28c`): `field_provenance` no longer drops values with quotes/newlines — fixed WITHOUT a 1 GB table rewrite — and the exposure was 16× the row's number.

**Verified live on LCC Opps after the merge:** `value_text_hash.attgenerated = ''` (plain column,
1 BEFORE trigger); `field_provenance` **1025 MB, unchanged** (no rewrite); **1,979 rows** written by
live producers since the migration, **8 break-class** (backslash-rendering values), **0 null
hashes**; `provenance_write_failed` alerts **0**; unranked **29**. ⚠️ **The JS half (the
`provenance_failed` counter + alert) ships on the Railway redeploy — the fix itself is already in
force in the DB.** Confirm `/version` ≥ `68ede28c` alongside PR2's `98248e18`.

- **The defect was every backslash-rendering character, not the double quote**: `"`, newline, tab,
  CR, backspace, formfeed, control chars, including inside jsonb object/array string members.
  Rule validated 14/14 against the live cast. **The dominant population is the NEWLINE in ordinary
  narrative** — `dia.sales_transactions.notes` 927/2,969 (31%), `sale_notes_raw` 60/447, gov
  `sale_notes_raw` 47/269 ⇒ **~1,101 exposed today**, on columns that are NOT rungs. The
  ladder-scoped census (as the prompt asked) read 67 and structurally could not see them —
  `lcc_merge_field` is called for unregistered pairs too. **My census scope was the error.**
- **Three numbers, three meanings:** exposure 79 ladder-governed · 12 proven SAFE (writer passes a
  jsonb ARRAY, no backslash) · **1 demonstrated loss** (PR2's zoning). Cumulative historical loss
  is **structurally unmeasurable** — an overwritten break-class value leaves nothing.
- **No rewrite:** `ALTER COLUMN … DROP EXPRESSION` is metadata-only (probed: `pg_relation_filenode`
  unchanged, values byte-identical) → plain column + BEFORE trigger over `convert_to(…,'UTF8')`.
  0 of 1,270,785 stored values contain a backslash, so every hash reproduces — verified over the
  **whole population**, mutated-expression control at 1,270,785. The prompt's sizing premise
  (a 1.26M-row rewrite) was wrong; the disk-full → sign-in-lockout risk made finding this matter.
- **PR5c is NOT explained by PR12** — `entities.name` 23/69,462 break-class (0.03%), 0 on every
  other LCC-internal column; a dropped stamp would need ~100%. **PR5c is gradeable now.**
- **`::bytea` sweep, three projects:** this was the only first-party instance.
- **Three measurement traps, all caught by positive controls:** `LIKE '%\%'` returned a
  confirming 0 (backslash is LIKE's escape); `to_jsonb(col::text)` over a jsonb column read
  **100%** (`sale_notes_extracted` 250/250 — real 0/0); and the ladder scope above.
- **Filed:** **PR12a** (the 67 residual, unmeasurable total) · **PR12b** (new this turn:
  `lcc_flush_provenance_events` advances `max_event_id` past an errored event — permanent skip).
- Guard `test/pr12-provenance-hash-and-failure-signal.test.mjs` (12 tests, 17/17 mutations RED;
  the fix's own `COMMENT ON` literal named the banned shape — literals blanked, comments first).
  CI 5,099 / 5,093 / 0 fail.

Docs: `docs/audits/PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md` · lane page §2 · `CLAUDE.md` PR12 block ·
backlog PR12 ✅ / PR12a / PR5c re-worded (by CC); PR12b, handoff, CURRENT-STATE, OPERATOR-ACTIONS this
turn. Prompt + response filed to `done/`.

## 2026-09-02 — PR5 SHIPPED (#2051, `d8beb555`): the 39 never-written ladder sources are triaged IN THE DATABASE, 25 of them are not defects, and 7 are live on a second ledger. PR7 re-measured 1 → 19 orphan pairs. PR9 stated for Scott.

**Verified live on LCC Opps after the merge:** `field_source_priority` **2,141** rungs (+1, the
`costar_sidebar → gov.properties.government_type` rung); **426** rungs carry a `PR5:` verdict (=
`v_field_source_priority_triage`); **49** rungs marked `PR7:orphan_column`; `v_field_provenance_unranked`
**29**. Every number in the audit reproduces. ⚠️ **No deploy gap on this one** — the diff touches no
`api/` file (CC corrected its own "ships on the next redeploy" line); the migration was live before
the PR existed.

- **Seven of the 39 are LIVE — on the property-owner authority ladder** (`manual`, `rel_purchase`,
  `rel_owns`, `sf_seller`, `domain_true_owner`, `gov_ownership_transition` → 15,052 rows in
  `lcc_property_owner_evidence`, scored by `lcc_reconcile_property_owner`, which writes no
  `field_provenance`) plus `property_sale_events` (B6c-dup's gov trigger → gov's own
  `field_value_provenance`). **Enumerate the LEDGERS before recording a source as never written.**
- 🚨 **`field_provenance` has never run on ANY LCC-internal table** — 33 rungs across `entities`,
  `entity_relationships`, `lcc.lcc_property_owner`, portfolio facts, `lcc_cre_properties`,
  `lcc_cre_property_documents`, with live `lcc_merge_field` call sites on four of them → **PR5c**
  (graded against PR12 first, since a silent 22P02 is one candidate cause).
- 🚨 **"Unregistered" is NOT a low rung — it is a different branch of `lcc_merge_field`.** A
  72-combination rolled-back replay showed ONE registration changing four decision classes,
  including a loss of blank-filling. So rungs are **soft-retired in `notes`, never deleted** —
  which is why `never_written` correctly stays 39 and `write_but_unregistered` stays 21 (the
  brief's predicted 21 → 20 was wrong: at source grain `costar_sidebar` was always registered on
  73 other rungs; the field-grain detector is the one that moved, 30 → 29).
- **PR7 is 19 orphan (table, column) pairs / 49 rungs, only ONE live** (`gov.properties.recorded_owner_name`,
  28 writes/30d → **PR7a**). 13,955 rows of apparent drift on `gov.sales_transactions.buyer_name/seller_name`
  stop dead 2026-07-29 — historical residue, closed at source (**PR7b**). Standing check
  `scripts/check-field-source-priority-columns.mjs` — **operator-run, not a merge gate** (neither
  domain schema is derivable from this repo).
- **PR9 restated with its data:** `manual_verify`@20's 673 rows are all one field — a human-confirmed
  clinic↔property link — competing with the `auto_link_*` family, not with `manual_edit`. 👤 Scott.
- **Filed, not built:** PR5a (29 field-grain gaps, mostly `dia.sales_transactions` bookkeeping
  columns — decide whether a ladder should govern them at all), PR5b (`om_extraction` unregistered
  where it competes), PR5d (**`costar_cmbs_loan`: 121 rungs, the ladder's largest source, for a
  capture arm that has never produced a row**), PR5e (`gov_ownership_chain` dead constant — A2's
  304 facts carry no provenance stamp).
- Guard `test/pr5-ladder-source-triage.test.mjs`; CI **5,087 / 5,081 pass / 0 fail / 6 skipped**,
  count byte-identical to local (the Node-20 tell checked, not just the conclusion).

**PR8 verify-next is STILL open**: `field_provenance where source='agency_classifier'` = 0 — still
a no-population zero (no gov write has fired `gov_classify_agency()` since the migration).

Docs: `docs/audits/PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md` · lane page §2 · `CLAUDE.md` PR5 block ·
backlog PR5 ✅ / PR7 ✅ / PR9 👤 / PR5a–e, PR7a–b (by CC). Handoff + OPERATOR-ACTIONS + CURRENT-STATE
this turn. Prompt + response filed to `done/`.

## 2026-09-02 — PR2 SHIPPED (#2045, `98248e18`): the sidebar writer now carries the parcel stats — and the parser was the load-bearing half. PR11 re-scoped, PR12 found.

**Verified live after merge (dia `zqzrriwuavgrquhisnoa`, LCC Opps):** `costar_sidebar` parcel rows
932 — `building_sf` **767**, `lot_sf` **734**, `year_built` **714**, `zoning` **232**, **0** lots under
100 sq ft; `field_provenance` batch **2,532** rows; `v_field_provenance_unranked` **30 → 30**;
30 `costar_sidebar` rungs on the four parcel/tax tables. Every number in the response reproduces.

- **The filed PR2 premise was refuted in the prompt itself** ("77% tax coverage" was the gpt-4o
  leg — 25,331 APN-less rows); the real source is the sidebar and its writer built the INSERT from
  `apn/county/state/assessed_value` only.
- 🚨 **Fixing the writer alone would have shipped a 43,560× unit error.** CoStar's dominant lot
  format `"1.00 (43,560 sf)"` (68% of captures) fell through `parseLotSF` → `parseSF` and read as
  **1 sq ft**; 476 of 760 backfilled lots came through that arm. `metadata.lot_sf` holds BOTH
  units (I12 one level up); `"0.00 (1 sf)"` is CoStar's no-data sentinel (PR1a's class).
- **Measured ceilings of zero, stated not silent:** `tax_amount` / `land_use` / `owner_name` have
  never appeared on any of 55,901 captures — wired, will read 0 until an assessor capture lands.
  The 84-property `$/SF` comp residue is a **disjoint** population (0 of 84 have a sidebar parcel).
- 🔴 **PR12 (new):** `field_provenance.value_text_hash` (`::bytea` over a jsonb string) throws
  22P02 on any value containing a double quote; `shouldWriteField` **fails open**, so the write
  lands and the provenance vanishes silently. One live hit (`"C" - Commercial`). Loss unmeasured.
- **PR11 re-scoped, not built:** the marker already exists (`v_dia_public_record_acquisition` /
  `dia_public_record_source_is_trustworthy`); what is missing is consumers filtering on it and the
  producer gate in the Dialysis repo (a retirement decision, per §2a).
- **gov: writer fixed, backfill NOT run** — 1,527 rows, one command, Scott's call
  (`OPERATOR-ACTIONS.md` §3 **PR2-gov**).

⚠️ **Class 8 — the backfill is proven, the PRODUCER is not.** 0 `costar_sidebar` parcel rows have
landed on dia since the merge (last capture 2026-08-31 18:33 UTC), and the Railway redeploy carrying
`98248e18` is unconfirmed from the sandbox. **The number that proves PR2 is a NEW sidebar parcel row
carrying `building_sf` after the redeploy — not today's 767.** Guard:
`test/pr2-sidebar-parcel-stats.test.mjs` (12 tests, 15/15 mutations RED; three guard defects found
and recorded in the response: a body slice closing on a default parameter, a neighbour's copy of
`blankOnly`, a grep matching a later `select=`). Suite 5,031 / 0.

Docs: `public-records-source-lane.md` §2 (PR2/PR11/PR12 blocks, by CC) · `CLAUDE.md` public-records
pointer · `PLANNED-BACKLOG.md` PR2 ✅ / PR11 🟡 / PR12 🔴 · handoff + OPERATOR-ACTIONS (this turn).
Response filed to `done/`.
## 2026-09-02 — OCR1c: the bake-off harness has a FLOOR now. ⚠️ NO real-document verdict changed — the sample on file is still 10 arm-A documents, tesseract only, and the 77% is still uninterpretable until Scott re-runs with `--control self`.

Harness-only; nothing wired; no real document run (the sandbox still cannot reach Supabase or
SharePoint). `scripts/ocr-bakeoff.mjs` + `test/ocr-bakeoff.test.mjs`. Writeup:
`docs/audits/OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md` **§8**; response
`docs/claude-code/responses/OCR1c-bakeoff-harness-self-agreement-control.response.md`.

**Four changes, each guarded (30 tests, 0 fail; 25/25 new mutations RED; full suite 5,038 pass / 0 fail):**

1. **Comparator artifacts normalized** — curly quotes/apostrophes, en/em dashes, NBSP, whitespace;
   `""` / `null` / `N/A` / `—` → null BEFORE the both-null decision; numbers strip a trailing `sf`.
   **4 of the first run's 11 non-agreements were this, not OCR.** ⚠️ Rounding is **not** a
   tolerance — `412500` vs `412600` stays a disagreement, and the sentinel list is narrow on purpose
   (`0` is a value; `Nullarbor Holdings LLC` is a name), both mutation-verified.
2. **`--control self`** — the model run TWICE on the same DocAI text, scored with the SAME
   `scoreDocument` and the same both-null exclusion, printed ABOVE the engine tables with
   `rate − self` per field. Two independent calls, deliberately **not** `temperature=0`.
   `deltaVsSelf` returns **null, never 0**, when there is no floor. A run without it prints a red
   *NOT RUN* banner instead of a bare rate. Cost: 10 extra model calls/run.
3. **Failure reporting** — `stderrTail` shows the LAST 300 chars (the first 160 were the same
   `RequestsDependencyWarning` on **all 36** first-run failures and hid BOTH real causes); the probe
   now separates *wrapper only* (`pip install paddlepaddle`) / *cannot check* / *needs a Docker VLM
   server → the GPU box*; `--self-test` names `pip install pillow`. **Positive-controlled live** with
   a fake `paddleocr` on PATH — the workstation's exact state, now reported instead of run 18 times.
4. **Arm B carries the VALUES** (`graded_values`/`fields_found` + a report table) — a `5/6 found` at
   confidence 68 is unreadable as a count.

⚠️ **Two guard defects the mutation pass found, both new to this repo's collection:** a detector for
a CODE shape must **blank string literals as well as comments** (the rendered report says
*"deliberately NOT `temperature=0`"* in a pushed string, so the anti-pinning grep went RED over
correct code); and the **order is load-bearing — comments FIRST, then literals**, because a bare
apostrophe in prose opens a string the blanker never closes and swallows real code behind it. That
is how the positive-control mutation for that very assertion survived its first run.

👤 **Scott:** `pip install paddlepaddle`, then
`node scripts/ocr-bakeoff.mjs --run --engines tesseract,paddleocr --control self` on the staged 15.
Read the floor table first, then `rate − self`, then the named disagreements. Surya still belongs on
GaryBuilt.

## 2026-09-02 — B6e-ci-required-check-prep LANDED (Dialysis #7395 + #7397): the gate has been seen RED, the docs-only path is proven, and MY "11 ruff errors" was an annotation cap. PR8 reconciled: the producer half is an EMPTY-WINDOW zero.

### Dialysis — verified from the PR bodies' run ids, not the response (which was captured mid-run)

| run | what it proves |
|---|---|
| **33647155312** (throwaway #7394, closed) | **RED proof:** 3,154 collected / **1 failed** / 3,145 passed → job conclusion `failure`, Build Check skipped. **The gate can fail.** |
| **33648697621** (throwaway #7396, one `.md`) | docs-only: Scope 5 s → "documentation only"; Lint/Security/Build skipped; **Run Tests SUCCESS in 5 s**, whole run 17 s |
| **33649047563** (#7397, a real docs-only PR) | same on a non-throwaway change — 19 s |
| **33647627137** (`main` @ `8ee8412`) | green once on `main`: 3,153 collected / 3,145 passed / 0 failed; `executed` **3,139 → 3,145**, the delta exactly the 6 new guard tests |

What shipped (#7395, `8ee8412`): **`paths-ignore` REMOVED** — it listed `**/*.txt`, which matched
`requirements.txt` / `requirements_utf8.txt` / `runtime.txt`, so **a dependency bump skipped every
job with no status and no trace**; a ~6 s API-driven **Scope** job decides inside the run; `Run
Tests` carries `if: ${{ !cancelled() }}` and gates its STEPS (a job-level `if:` is the same
deadlock one layer down — a skipped job reports no conclusion); every gate is `!= 'false'` so a
broken Scope runs everything. Guard `tests/test_b6e_ci_required_check_guard.py` — 6 tests, **8/8
mutations RED**, keyed on every workflow that runs pytest, asserting the prose allowlist by
**executing the shipped JavaScript under node**. ✅ **`exit code 128` is GONE — read from the
checkout log of job 100287516023** (closes my residue from this morning and `B6e-fred-git128`).

### 🚨 Correction, mine: "11 ruff errors" was page one of the instrument

I wrote *"ruff is red on `main` with 11 errors"* into STATUS, the backlog, `CLAUDE.md`,
`CURRENT-STATE.md`, the handoff and the canonical page. **GitHub caps step annotations at ten**;
ruff emits in path order and the three files I named sort first. Measured with the CI's exact
command on `main`: **`ruff check .` = 5,746 → 5,738** after the PR (E501 3,139 · E402 1,198 ·
F401 637 · F821 163 · …), **`ruff format --check` = 1,293 → 1,292 files**. Same class as A5's
`815 = 1000 − 185`. **So ruff stays masked, correctly** — unmasking would ship a red job on day
one. The three files were still dealt with (two scratch files deleted, two dead imports dropped;
`alias_review.py`'s two E402 are a deliberate `sys.path` bootstrap, commented not `# noqa`'d).
**All six pages corrected in place this turn.** ⚠️ CC could not read the ruff step's log back
either (the formatter's 1,305-file diff exceeds the API's tail window) — the count is a local
reproduction with the CI command.

⚠️ **Third merge-before-CI in this arc:** #7395 merged **3 m 30 s** after opening while `Run
Tests` was still running (#7393 at 8 s, LCC #1793 at 58 s). It is exactly what the toggle exists
to make impossible. ⚠️ **`pip-audit` and the secrets grep are RED today** (pypdf2 3.0.1
`PYSEC-2026-1835`, fix 3.9.0; five secret-pattern matches — fake JWT fixtures under `tests/` and
a redacted literal in `src/smoke_tests`) and stay masked → `B6e-ci-mask-security` now has its
real content.

👤 **Three operator steps, in order:** merge **#7397** (docs-only, "Ready to merge", 2 checks
passed / 3 skipped — it is itself the live proof) → delete `claude/tmp-red-gate-proof` and
`claude/tmp-docs-only-proof` from the UI (the push proxy refuses ref deletes) → **Settings →
Branches → `main` → require `Run Tests`** (the exact check name; unique across all five workflows,
no matrix suffix). That closes the B6 CI arc.

### PR8 — reconciled, and the "verify next" is an empty-window zero, not a stall

CC's entry below is complete and it corrected my *"39 is 38"* in place (still 39: `qa22_…` swaps
out, `domain_trigger` swaps in — nothing has ever actually been `domain_trigger`). Verified live at
16:01 UTC: `v_first_class` literal **gone**, `agency_classifier` **4 rungs**,
`v_field_provenance_effective_source` **present**, `v_field_provenance_unranked` **30** (all
`costar_sidebar` / `om_extraction` / `salesforce` — a rolling window moving on its own).
**`field_provenance where source='agency_classifier'` is still 0 — and that is a NO-POPULATION
zero (N15d):** gov `provenance_event_log` reads **0 unflushed / 0 errors**, the flush crons (188
dia `4,34 * * * *`, 189 gov `9-59/10`) are healthy, and the only `agency_classifier` event since
noon was **12:05, flushed 12:09 — before the migration**. Nothing has passed through the fixed
path yet. The proof is the next gov write that fires `gov_classify_agency()`; until then the
producer half rests on CC's rolled-back synthetic-event control. **Do not read the 0 as broken.**
Also surfaced by CC and filed, not fixed: **`costar_sidebar` writes `gov.properties.government_type`
(52/30d) with no rung** — a second unregistered writer on the very field PR8 registered; PR5's
write-but-unregistered triage owns it.

### 🚨 PR2's premise REFUTED before it was sent — "77% tax coverage" was the model leg

Checking PR2's own premise before drafting it (*"the tax fetcher demonstrably reaches 77%"*), split
by `raw_payload->>'source'`: **25,334 of 25,621 `tax_records` rows are `source` NULL with `apn` NULL
and `tax_amount` on 10** — the gpt-4o leg PR1 named — and **9,033 of the 9,107 "tax-linked"
properties point at those rows** (22,131 links). The **41 parcel rows with building stats are the
same leg.** There is no county fetcher reaching 77%; the number was the generator's output read as
reach. The only genuine rows are **`costar_sidebar`: 932 parcels / 931 real APNs / 883 properties
(7.5%), assessed on 286, building stats on ZERO** — from a page that carries building SF, year
built and lot size. **PR2 re-scoped** to *where does the sidebar → `parcel_records` writer drop the
stats* (prompt drafted), **PR11** filed (quarantine the APN-less rows, reversibly, with the producer
stopped in the same change). Canonical page §2 carries the split table; §3 item 2 struck through.
**Split by source before quoting coverage** — the third time this arc a headline number was a
population mix (W5.3 channels, `0 % 100000`, now this).

**Filed this turn:** `B6e-ci-mask-ruff` rewritten (5,738 / fix-or-ignore one RULE at a time),
`B6e-ci-mask-ruff-format` (1,292 files), `B6e-ci-mask-security` re-sized, `B6e-worktree-gitlinks`
+ `B6e-fred-git128` closed on evidence. **STATUS archived again** (9,216 → 6,614 lines; the
morning cut was too shallow) → `docs/history/STATUS_claude-code_2026-08-20_to_2026-08-28_cowork-block.md`,
verbatim, indexed. Both prompts + both responses filed to `done/`.

## 2026-09-02 — PR8 SHIPPED: the registry is the allowlist. Two of the brief's own numbers were wrong.

`lcc_flush_provenance_events()`'s four-name `v_first_class` literal is **gone**. A
`field_source_priority` row for THIS (table, field, source) is now the whole rule; anything
unregistered still merges as `domain_trigger`, which is the honest fallback for an unranked writer
and what keeps `v_field_provenance_unranked` meaningful. `agency_classifier` registered at the **4
rungs it writes, @90** — the rung its rows already merged at, so the change is **name-only**.
`v_field_provenance_effective_source` exposes the recovered name; **`field_provenance` is not
rewritten**. Migration `20261007120000_lcc_pr8_provenance_relabel_registration.sql`, applied live to
LCC Opps. Full suite **5,012 / 0 fail**; guards **13/13 mutations RED**.

**Before/after, one session, two self-rolling-back transactions over the same live state** —
1,521-event stratified replay, 150 per combo, covering all **15** live (source, table, field)
combos. **Predicted: 5 combos change SOURCE, 0 decisions change. Actual: exactly that**, every
decision count byte-identical including `dia.properties|tenant|skip=1` and
`gov.property_agencies|government_type|superseded=106`. Decisions are identical because
`lcc_merge_field` tests `same_priority_same_value_refresh` **before**
`same_source_refresh_newest_wins`.

🚨 **The consequence the brief did not name, and it is the one that mattered: removing a relabel
ARMS every registered source.** `county_records` holds 93 rungs at a best rung of **5**, above
`salesforce`@20 and every sidebar, and PR1 measured its producer to be gpt-4o recall. Under the old
code it merged as `domain_trigger` — **no rung for those fields, so at most a blank-fill**. Under
"the registry is the allowlist" it merges at **@5 and overrides real evidence**. The four-item
literal was the only structural thing stopping it, and nothing else was. The refusal is now
**explicit** (`v_never_first_class`), positive-controlled live in a rolled-back transaction: a
synthetic `county_records` event still stores `domain_trigger`, while `qa22_…` and
`agency_classifier` keep their own names and an unregistered writer falls back. **0 residue.**
That is a preservation of PR1's decision, not an addition to any allowlist. **When you delete a
suppression mechanism, enumerate what it was suppressing.**

⚠️ **"The 39 is 38" is wrong — it is still 39, and the swap is the finding.** `qa22_…` leaves the
never-written set and **`domain_trigger` enters it**: all 17,371 of its rows carry a `:evt` run id,
so **nothing has ever actually been `domain_trigger`** — a registered source with 6 rungs that no
producer is. PR5 re-keyed on the effective source, post-registration: **68 registered · 39 never
written · 21 write-but-unregistered** (back to the benign `cleanup_run_*` set, because
`agency_classifier` is now registered). Keyed on the RAW `source` it reads **40** until the next
flush writes an `agency_classifier` row under its own name — **that new row, not today's count, is
what proves the producer is fixed** (Class 8).

⚠️ **The brief's own recovery expression was a plausible-number generator.**
`coalesce(nullif(split_part(source_run_id,':evt',1),''), source)` is unguarded: `split_part` returns
the **whole string** when the delimiter is absent, and it is absent on **943,916 of 1,263,825 rows**.
Measured, it **invents 9,950 source names that do not exist** and answers the write-but-unregistered
arm with **9,951 instead of 21**. The shape test `~ '^.+:evt[0-9]+$'` is load-bearing. Same family
as P157 `reloptions` / P182 deparse. ⚠️ **And its guard cannot be a file-wide presence check** — the
predicate legitimately appears twice in the view, so a grep *and a ±300-char proximity window* both
stayed green while one site lost its guard. Found by the mutation pass, not by reading it.

**Producer read, not assumed:** gov `gov_classify_agency()` is a pure `STABLE` plpgsql rule engine
over the curated `government_agencies` lookup and `agency_enrichment_rules` patterns — **no HTTP, no
`pg_net`, no model** — and fill-blanks. A defensible source, unlike this lane's producer.

**Residual, sized:** during the transition a differing re-classification would record `conflict`
instead of `write` (two sources at equal priority 90). Measured over the producer's whole history —
17,277 events, 309 keys re-written, **0 keys have ever changed value**. Never once exercised;
self-clears. That is the reason to register at 90 rather than a new rung.

**Filed, not decided (PR10):** `agency_classifier` is **90** in LCC `field_source_priority` and
`authority_rank` **30** in gov's own `field_value_provenance`. Two ladders, one source, two numbers;
a re-rank changes which writes win and needs its own before/after. **Not done deliberately:** no
rung for `gov.properties.agency_canonical` (0 rows written — PR7's class); `domain_trigger` rungs
kept; `lcc_merge_field` untouched; nothing added for `county_records`.

**Verify next on:** a NEW `field_provenance` row with `source='agency_classifier'` after the next
flush (the producer's own fix, not the backfill) — and `v_field_provenance_unranked` staying at 22.

## 2026-09-02 — B6e-ci-last5 LANDED: the Dialysis pytest line is UNMASKED and green on `main` — and it is still NOT a merge gate (Dialysis PR #7393, `83d53f0`)

**Read from the `main` job log (run 33642110673, job 100287516338), never the badge:**
`collected 3147 items` → **`3139 passed, 7 skipped, 1 xfailed, 0 failed in 417.81s`.** The step's
own header now reads *"B6e-ci-unmask (2026-09-02): UNMASKED. A red suite now fails the job."*
`executed` **3,132 → 3,147**, up again — nothing skipped or quarantined at any step of the arc
(`0 → 3,128 → 3,132 → 3,147`; `55 → 14 → 5 → 3 → 0` failed).

| unit | outcome |
|---|---|
| `financial_ground_truth` (3) | test-side fixes landed; `RATES_2025` and `CMS_2023_RATES` kept as **two named constants with the WHY documented**; 9/9 mutations RED on the model+vintage guards |
| `listing_broker_update` (2) | **already cleared by BR2** before this prompt ran — the backlog was **3, not 5** |
| latent `UnboundLocalError` in `_dynamic_payer_model` | found by the sweep, reachable, one populated column from firing — **fixed** |
| pytest `\|\| echo` | **removed**, 5/5 mutations RED on the unmask guard, **green once on `main`** |
| `B6e-worktree-gitlinks` | the PR touches `.claude/worktrees/`; the CC task list marks the 3 gitlinks removed. ~~⚠️ Not verified from a checkout log this turn~~ ✅ **verified later the same day from job 100287516023's checkout log — `exit code 128` is gone** |

### ✅ `B6e-ci-baseline39` is SETTLED by supersession, and the 39 was never `main`'s state

The apples-to-apples run landed: **`main` at `ff712e0` (post-#7392) measured 3,138 collected /
3,127 passed / 3 failed** — recorded in the workflow comment — and `83d53f0` reads **0** on a real
runner. The 39 came from CC's own sandbox run at #7392 time and **was never reproduced in the
authoritative environment**. ⚠️ **What produced 39 there is still not named** (the documented
cross-module stub pollution is the likely shape, not a proven one), but it no longer gates anything:
the gate now runs on the runner, and the runner reads 0. Recorded as closed-with-residue, not
explained.

### 🚨 Two corrections to previously-stated figures — one of them mine, on a canonical page

- **"The code sits within 0.3% of the reconciled model" does NOT reproduce.** CC measured
  **−4.90% vs live, and no segment sits within even 1%.** That figure was in the prompt, in
  `producer-health-and-ci-enforcement.md` §3, in the backlog row, and in `CLAUDE.md`. **All four
  corrected in place this turn.** The verdict it supported (test-side fix, keep both constants) is
  unchanged — the code is the closer of the two to live, and the constants question was settled on
  the FY table, not on that number.
- **FY2026's 73.66% Medicare is the fallback bucket's signature, verified live this turn:**
  `partial_plus_default` reads **74.6–76.3% Medicare in EVERY year 2021–2026**, and FY2026 has
  **zero `hcris_form_265_11` rows** (65 `national_default` + 659 `partial_plus_default`). Not a
  market shift. Feeds **DE4**.

### 🔴 What the workflow file says that the response did not — read `ci.yml`, not the PR

1. **Dialysis has NO branch protection.** The workflow header states it in so many words (*"CI is
   NOT a required status check — this repo merges via a local `git merge` + `git push`"*), and
   **PR #7393 merging 8 seconds after its test job started is the proof.** So the unmask makes a
   red suite **fail the job** — it does **not block a merge**. The gate is one operator step short:
   → **B6e-ci-required-check** (👤 Scott). ⚠️ **`paths-ignore` skips CI on docs-only changes, and a
   skipped run reports no status** — so making `Run Tests` required will block docs-only PRs until
   the LCC docs-only-branch pattern (`test-suite.yml`) is copied across. File both halves together.
2. **Ruff is masked and red on `main` right now.** Both ruff steps carry
   `continue-on-error: true`; the current run shows a green *Lint & Type Check* with ~~**11 errors
   behind it**~~ ⚠️ **CORRECTED the same day: 11 was GitHub's ten-annotation cap plus one — the real
   count is 5,746 (`ruff check .`) and 1,293 files (`ruff format --check`). Ruff stays masked; see
   the B6e-ci-required-check-prep entry above.** The three files I named (root scratch
   `.tmp_source_gap_classify.py` / `.tmp_prop_diag.py`, `alias_review.py`) were real and are dealt
   with; they were page one, not the total. → **B6e-ci-mask-ruff**.
3. **Named in the workflow, absent from the backlog until now:** `import src.main` / `import app`
   in the build job are still masked and **red for a real reason** — both run a live Supabase
   health check at module import. → **B6e-ci-mask-srcimport**. `pip-audit` and the secrets grep
   remain `continue-on-error` → **B6e-ci-mask-security**.

### CC's own tooling caught two silences worth keeping

- A `curl` poller against the GitHub API returned *"GitHub access is not enabled"* and would have
  sat silent forever — **indistinguishable from "CI still running."** Only the MCP path reaches
  GitHub from CC. Committed while verifying a fix for exactly this shape.
- A branch-filtered runs query returned a stale page whose newest row was 2026-06-27, and CC
  reported *"no push-to-main CI for two months"* before cross-checking. Wrong; retracted in-line.
  **A filtered query returning a comfortable answer is the same shape as every detector trap in
  this arc.**

### Also this turn — PR8 decomposed by measurement, PR5's count moves

`lcc_flush_provenance_events` stamps `source_run_id := v_src || ':evt' || id`, so the relabelled
source name **survives on every row**. `domain_trigger` 17,371 = **`agency_classifier` 17,277**
(gov `government_type` on `sales_transactions` / `properties` / `leases` / `property_agencies`,
writing 2026-07-30 → today) **+ `qa22_davita_brand_canonicalize` 94** (one-shot 2026-07-30).
`agency_classifier` is **unregistered** — PR5's reverse arm reported 21 write-but-unregistered
sources, "all benign `cleanup_run_*`", and could not see this 22nd because it wears the catch-all's
name. `qa22_…` is registered and counted among the "39 never written" while 94 of its rows exist
under the wrong label — ~~**39 is 38**~~ ⚠️ **CORRECTED 2026-09-02 when PR8 shipped: it is still 39.**
`qa22_…` leaves the never-written set and **`domain_trigger` enters it** — all 17,371 of its rows are
relabels, so nothing has ever actually *been* `domain_trigger`. Post-registration, keyed on the
effective source: **68 registered · 39 never written · 21 write-but-unregistered.** PR8 is now
**shipped**, not a build prompt (`done/PR8-provenance-relabel-decompose.md`). Re-measured the top-three sizes at session start too:
BR1 131/73/28/7, PR2 1,604/41/908-vs-9,107, PR5 67/39/21 — all reproduce; `recorded_deed` positive
control 2,681 → **2,731**, still writing.

**Verify next on:** the first *red* PR on Dialysis actually showing a failed `Run Tests` job (the
gate has only been proven green, never proven to fail); the checkout log free of `exit code 128`;
`B6e-ci-required-check` flipped. Prompt + response filed to `done/`
(`B6e-ci-last5-decisions-resolved.response.md` is a transcription of the mid-flight `.docx`; the
outcome above is from the run itself).
## 2026-09-02 — OCR1 run 2 (with the floor) → tesseract = §5 row 2; OCR2 verified live; EXT1 filed

- **OCR1 run 2:** model self-agreement floor **93%** (`lease_expiration` only 71%); tesseract **80%**
  (−13 pp) on 10 real docs. Read on named rows: 2 model-arithmetic, 4 date-default noise, **3 real
  tesseract misses** (one promoted a person's name over the company — a layout/reading-order effect),
  2 fixture. **Verdict for tesseract: §5 row 2** — free pre-filter/fallback that removes the page cap,
  not a DocAI replacement. Paddle failed on all 18 with a paddlepaddle 3.x oneDNN/PIR runtime error
  (Windows CPU); surya reported its Docker requirement once. **Deciding run → GaryBuilt** (👤).
  Record: `responses/done/OCR1-run2-with-self-control.response.md`.
- **EXT1 filed:** the extraction model, not OCR, is the larger error source on `year1_rent`
  (annualized in the model's head, differently per call) and `lease_expiration` (29% self-disagree).
  Return rent with its basis, annualize in code, dates as quoted.
- **OCR2 verified live:** `gov_/dia_merge_document_extracted_data` present on both domains, `anon`
  EXECUTE **false** by `has_function_privilege`, 0 provenance rows (correct — no new deed), Railway at
  `35528de9`. ⚠️ **A `/version` probe can return a CACHED body** — the first fetch showed the morning's
  SHA with the morning's `ts`; a cache-busting query param returned the truth. Add one always.
- Files: OCR1c + OCR2 responses and the OCR2 prompt → `done/`. `prompts/` holds the handoff and
  PR2 (other window).

## 2026-09-02 — Scott's app walk-through catalogued: 48 comments → UX0–UX49, tiered T0–T4 (P16)

Source: `LCC App Function Notes.docx` (41 screenshots; kept outside the repo). Canonical page
`docs/architecture/app-ux-review-2026-09-02.md`; backlog §P16; doctrine block added to `CLAUDE.md`
pending a canon entry (UX0). **Queues behind OCR1 re-run / OCR2 by instruction.** Points worth the
next reader's time: several "is this an error?" questions are ANSWERED on the page rather than
queued (CMS "since Sept 2025" = a reporting-period series + the still-open B6d-cms-restart; the
"high" clinic revenue is almost certainly OPERATING revenue not rent — the A5 misread); the Sellers
"0 / $0" is the `diaQuery` `[]`-on-error shape, so it is a response to read, not an empty table; the
Ownership "500" is the paged-query-as-count footgun; Brokers and the CM charts map to open rows
(BR1–BR5, K13–K18) rather than new ones. The single largest shared primitive across the feature asks
is the **draft → send → log loop** (Pipeline drawer, Marketing tab, buyer-rep) — build it once.

## 2026-09-02 — OCR1c built (self-agreement floor + honest engine probes); branch pushed, NO PR opened

CC delivered all four changes on `claude/ocr-bakeoff-self-agreement-qnyl9z` (`837a7ba`): quote/dash/
NBSP normalization and sentinel→null before comparing (accounts for 4 of the 11 non-agreements),
`--control self` (two independent model calls on the DocAI text, same scorer, `rate − self` column,
red NOT RUN banner when absent), last-300-chars stderr + tri-state engine probe (`wrapper only` /
`could not check` / `needs a Docker VLM server`), arm-B values in the JSON. 30 guards, **25/25
mutations RED**; two guard defects found by the mutation pass (a code-shape grep must blank string
literals too, and comments must be stripped BEFORE literals or a prose apostrophe swallows code).
⚠️ **As of this reconciliation the branch is NOT in `main` and no PR exists** — CC ended with "say the
word if you want one." Merge first, then the re-run (`OPERATOR-ACTIONS.md` OCR1). No real-document
verdict changed. Response + prompt → `done/`.

**DOC18 at 17:10 UTC:** 6 attempted, 4 windowed (169 pages billed), 1 true partial, `bov_ready` 48; the
predicted 12 MB residual appeared on doc 128 (`over_ocr_cap`, 0 calls) → **DOC18-bytes**, sized after
the drain. Dedupe grep clean.

## 2026-09-02 — OCR1 first REAL run reconciled: page-cap case measured TRUE; quality unprovable until the harness has a self-agreement control

Scott's re-run (after the main-guard fix) completed on **15 real documents + 3 fixtures, tesseract
only**: surya 0.22 runs its VLM in a Docker container (daemon off; belongs on GaryBuilt), paddleocr
lacked `paddlepaddle` (the wrapper installs without the engine). Record with the artifact analysis:
`responses/done/OCR1-run.response.md` (values-free; `bakeoff/agreement.md` stays local).

- ✅ **Arm B — the page cap is gone for a local engine:** 141 pages read in one pass, 4/4
  back-half clauses legible on 3 of 4 leases (the 1/4 is a title bundle at conf 68); 2.3–3.5 s/pp CPU.
- ❓ **Arm A — 36/47 fields agree (77%), and the number has NO interpretation yet.** The 11
  non-agreements were READ: 2 curly-apostrophe comparator artifacts, 2 `""`-vs-null artifacts,
  2 model-arithmetic disagreements on IDENTICAL source text (both texts carry the same monthly rent
  verbatim), 4 date disagreements of unknown cause, 1 real OCR error — on the synthetic fixture.
  **Without grading the model against a second run of itself on the DocAI text, "how much
  disagreement is the model" is unmeasured and no engine rate can be read.** → **OCR1c** (prompt
  staged: normalization, `--control self`, last-300-chars stderr, honest engine probes) → re-run
  with paddle.
- **DOC18 drained unattended meanwhile:** 4 windowed (80/91/109 full, **doc 96 the first true
  partial: 57pp → 50**), `bov_ready` 43 → 47, backlog 42 → 38 + 1 `window_failed`.
- Stale claims corrected in place: the OCR1 audit's own header (surya/paddle install assumptions);
  a drifted `:328-347` line ref on the cost page.

## 2026-09-02 — The bake-off's first real run did NOTHING: a Windows main-guard bug, silent exit 0

Scott ran the sequence; engines installed, `ocr-bakeoff-stage.ps1` staged **15 of 15**, and then
`--self-test`, `--fetch-baselines` and `--run` each **printed nothing and exited 0**. Cause:
`scripts/ocr-bakeoff.mjs:975` guarded `main()` with `import.meta.url === \`file://${process.argv[1]}\``,
which never matches on Windows (`C:\…` vs `file:///C:/…`) — so `main()` never ran. Line 960's
`new URL(import.meta.url).pathname` had the mirror bug. The sandbox is Linux and could not have
caught it; the silence was the only signal, and it is the `| tee`-without-`pipefail` shape again.
**Fixed** (`pathToFileURL` / `fileURLToPath`; the same `.pathname` idiom fixed in
`d1-cross-db-provenance-diff.mjs`; 10 other scripts already had it right). **Class guard added:**
`test/scripts-main-guard-windows.test.mjs`, mutation-verified RED on the original line. Self-test
now prints its 15 assertions. Footgun recorded in `CLAUDE.md`. **Scott re-runs from step 3 after
merging.**

## 2026-09-02 — OCR2 SHIPPED: deed OCR provenance persisted; the column had a second writer that REPLACED it

**Built:** `<dom>_merge_document_extracted_data` on gov + dia (applied live) = the **single owner** of
writes to `property_documents.extracted_data`; `api/_shared/document-text-provenance.js` (shape +
merge, one owner for both); `processOneDoc` writes provenance on both exits **after** the deed parse;
`deed-parser.js` routes its own write through the merge RPC with a legacy-replace fallback; the
`ocrTiered:false` opt-out is closed. Surfaces `v_gov_deed_ocr_provenance` /
`v_dia_deed_ocr_provenance`. Suite **5,074 / 5,068 pass / 0 fail**.

- ⚠️ **The prompt's premise was incomplete in a way that would have shipped a silent no-op.** It
  anticipated my write clobbering the deed parser's; the reverse was the live hazard —
  `deed-parser.js` PATCHed `extracted_data: {...}`, a **wholesale replace**, so provenance written
  beside `deed_extraction` was destroyed on every deed and on every re-parse. Proven by a key census,
  not a code read: gov's 185 rows carry exactly two keys, dia carries 10 with a third.
- ⚠️ **`revoke ... from public` left `anon`/`authenticated` holding EXPLICIT grants** (Supabase
  default privileges) — the complementary half of the documented B6d trap, caught only because the
  check was `has_function_privilege` rather than re-reading the REVOKE. Both roles now false.
- ⚠️ **Two guards passed their own mutation via the import line** and were replaced with behavioural
  tests. 16/16 mutations RED.
- **No backfill**: 507 rows' tier is unknowable (154 gov extractions predate DocAI, 140 undated).
  `unrecorded` holding at gov 325 / dia 182 IS the verification.
- ⚠️ **The two halves verify on different clocks.** PROVENANCE is pending a new deed (extraction backlog 0 on both domains, and the re-parse path deliberately writes none). The **MERGE fix runs on the next tick with no new deed** — the re-parse queue holds **gov 166 + dia 119 = 285** rows, each of which was a wholesale replace before. An earlier draft said only "pending a new deed" and that overstated the wait.
- Filed: **OCR2a** (re-parse writes none, deliberately — no extraction, no tier), **OCR2b** (the
  `needs_ocr` refusal reason is still discarded, unlike the CRE sidecar).
- Writeup `docs/audits/OCR2_DEED_OCR_PROVENANCE_2026-09-02.md`; canon
  `ai-and-ocr-cost-strategy.md` §0, `CLAUDE.md` (new jsonb-merge-owner doctrine + the privilege
  half), backlog OCR2 → ✅.

## 2026-09-02 — OCR2's premise REFUTED before drafting; re-scoped to deed OCR provenance; bake-off staging script

- ⚠️ **"The deed lane never tiers — all 325 deeds went to gpt-4o" was in three canonical documents
  and is false on both halves.** `document-text.js:217` passes `ocrTiered: true` by default and no
  caller passes `false`. The 325 was a **date artifact**: 154 of 185 dated gov deed extractions ran
  2026-07-15→07-25, before DocAI went live on 08-12. **Corrected in place** (strike-through) in
  `ai-and-ocr-cost-strategy.md` §0 + §5, `CURRENT-STATE.md`, backlog OCR2, and the handoff.
- **The real defect:** the handler computes `ocr_tier`/`ocr_engine`/`ocr_pages` and the PATCH at
  `:233` persists only `raw_text` — gov 325/0 and dia 182/0 deeds with text/with provenance. That is
  how an unverifiable claim reached three docs. **OCR2 re-scoped** to persist provenance (additive
  jsonb, RPC merge, fill-blanks, NO backfill onto pre-08-12 rows) and close the gpt-4o opt-out.
  Prompt: `prompts/OCR2-deed-lane-ocr-provenance.md`.
- **OCR1 run made mechanical:** `scripts/ocr-bakeoff-stage.ps1` copies the 15 sample PDFs from the
  synced OneDrive `PROPERTIES` folder into `bakeoff/<id>/source.pdf` (paths verified against the
  mount; 407 is a title/docs bundle, noted). `--model real` needs `OLLAMA_URL` (+ `OLLAMA_EXTRACTION`,
  CF Access pair) in `.env.local`, alongside `OPS_SUPABASE_URL` / `OPS_SUPABASE_SERVICE_KEY` for the
  baselines.

## 2026-09-02 — OCR1 reconciled (harness built, bake-off NOT run); DOC18's first tick failed on a THIRD deploy surface, fixed, verified on a real lease

**OCR1 (PR #2038) delivered the instrument, not the measurement.** `scripts/ocr-bakeoff.mjs` +
11 guards (9/9 mutations RED); sample size **3 synthetic fixtures, 0 real documents**; no §5 row
selected. The run is Scott's (workstation/GaryBuilt) — now on `OPERATOR-ACTIONS.md`. CC's canonical
edits to `ai-and-ocr-cost-strategy.md` were checked and stand. Two findings worth carrying: (1) the
harness caught its own C10-class defect — graded fields read under the model's JSON key scored
`both_null` forever, and counting both-null as agreement would have rendered 6/6 for fields never
read; (2) **removing the OCR cap does not give the consumer the whole lease** —
`LEASE_TEXT_SLICE_CHARS` (90k) caps consumption at ~52pp median / ~33pp p90, so OCR1b must say which
ceiling it moves. Arm B is 42 docs / 2,200 pages, not the four names my prompt listed.

**DOC18's first live tick (15:07) FAILED — `window_failed / cloud_ocr_non_ok`, `window_calls: 0`.**
Cause: the `docai-ocr` edge function was still **v24 (2026-09-01)**. DOC18 changed three surfaces —
`api/` (Railway), a migration, and `supabase/functions/docai-ocr` — and its deploy note named only
the first two. With the old function the `page_range` selector was ignored silently, the whole
39-page PDF went to DocAI, and it was refused over the cap; the route reported it honestly. Deployed
**v25** from the repo at 15:29 (health probe `page_range_supported: true`), re-fired one tick:
**doc 80 (31pp) → 2 calls, 31 pages, `[[1,31]]`, 0 gaps, 0 duplicates, 76,346 chars, full
coverage.** Backlog 42 → 41 + 1 attempted (doc 61 retries when its marker rotates to the head).
⚠️ **Rule added to `CLAUDE.md`: a change touching `api/`, `supabase/migrations/` and
`supabase/functions/` has THREE deploys; check `list_edge_functions` `updated_at` against the merge
time the way `/version` is checked for Railway.** ✅ Positive control on the diagnosis: the DOC17
probe function (`docai-page-probe`) had been deployed the same day by CC, which is why DOC17's
measurements were real while DOC18's route was not.

**Consolidation:** OCR1 prompt + response → `done/`; eight already-reconciled responses (C13, DOC1,
DOC8, DOC14, DOC16, DOC17) → `responses/done/`; ten already-shipped prompts (C6, C8, C10, C11, C13,
DOC1, DOC14, DOC16, DOC17, B6e-ci-required-check-prep) → `done/`. **`prompts/` now holds only the
open PR8 and the handoff.** Dedupe grep clean.

## 2026-09-02 — DOC18 LIVE (migration applied, deploy confirmed, dry run correct); OCR1 prompt corrected before send

- **Deploy confirmed** by `/version` = `f8d42593` (the `main` tip after #2034), not by a handler
  probe. **Migration `20260902120000` applied from Cowork** and censused: 3 columns, cron
  `lcc-cre-doc-text-longdoc` active, `v_lcc_cre_longdoc_backlog` = 42 / pages 31–141 / 0 unknown.
  ⚠️ Order was writer-first (Railway auto-deploys on merge); safe only because the non-windowed
  payload carries no new keys. **Ungated dry run** (`mode=longdoc&limit=3` via `pg_net` + the vault
  key): plans correct on docs 61/80/91 — first segment 30, every later segment ≤15.
- ⚠️ **`'vercel'` was a dead LABEL, not a dead host — and it is now RETIRED at the source** (Scott:
  *correct it so it cannot distract a future chat*). `lcc_cron_post` routes anything not `'edge'` to
  the Railway URL; 50 of 155 jobs still said or defaulted to `'vercel'`, and C1 had already misread
  one as "posts to the retired host". Migration `20260902140000` (applied live): default → `'railway'`,
  all 36 explicit commands relabelled via `cron.alter_job` (0 remain), `'vercel'` kept as a silent
  alias so a replayed older migration cannot break. `CLAUDE.md` C1 line + backlog **C1-note**
  corrected in place with strike-through; footgun added under `lcc_cron_post()`.
- **OCR1 prompt corrected in place before sending — three defects:** (1) **the sample it asked
  for cannot exist** — the longest DocAI baseline is exactly 30 pages *because* of the cap, so
  "≥3 leases over 30pp with a baseline" is structurally empty; split into arm A (head-to-head,
  ten named ids) and arm B (over-cap leases 319/320/200/61, graded on consumer-field coherence,
  no baseline); (2) **the sandbox cannot reach the PDFs or the baselines** (DOC17/18 measured
  `http=000`), so CC builds the harness and proves it on a synthetic fixture, Scott runs it on
  the box; (3) `extractTenantFromLease` calls a model — same model both arms, recorded. Two
  drifted line refs fixed (the `deps.freeOcr` seam is ~:631, not :328; `rawDocument` is in the
  edge fn, not `document-text.js`).
- `bakeoff/` added to `.gitignore` (it will hold client lease text). The arm-A baselines are NOT
  pre-exported — a 538k-char SQL result does not belong in a chat transcript; the harness fetches
  them itself on the workstation (`--fetch-baselines`, §6b).

## 2026-09-02 — DOC18 reconciled: merged (#2032), NOT running; §7b re-measured; six backlog ID defects fixed

**DOC18 came back and is merged** (`e5c8f34e`, PR #2032). Claude Code had already written the
canonical DOC18 section; this turn reconciled the rest. Re-measured on LCC Opps at ~16:00 UTC:

- **Migration `20260902120000` is NOT applied** — 0 of the 3 partial-extract columns, no
  `lcc-cre-doc-text-longdoc` cron, no `v_lcc_cre_longdoc_backlog`. **42 `over_docai_page_cap`
  markers unmoved.** Redeploy unconfirmed (Railway unreachable from the sandbox). *Merged is not
  running.* Operator sequence is in backlog **DOC18**: migration → redeploy both services → the
  ungated `mode=longdoc` dry run → let the cron run one document per tick.
- **§7b**: undrained **401** (was 426), consumer-visible sidecars **289**, `bov_ready` **43** (was
  37), `bov_extraction` **25**, gov deeds **325/325**.
- ⚠️ **Corrected my own claim in place:** "ZERO gpt-4o since redeploy" is false by two rows — both
  in the first two ticks after the 09-01 15:00 redeploy (15:00 and 16:00), both `thin_ocr_result`
  fragments (116 / 211 chars), and **zero since 16:01**. 88 DocAI events in the same window. The
  escalation is closed; the wording was over-stated for the window it was read in.
- **Consolidation:** the canonical page's CURRENT STATE block carried a merge artifact — two copies
  of the "live gap" / "retry markers" rows and two "Open" lists (one pre-DOC17, one post). Collapsed
  to one. **Backlog duplicate grep found six:** `B6d-pri-metrics` and `B6d-sam` were genuine
  duplicate rows (merged); **`J2`–`J4` and `PR6` were ID COLLISIONS** — two unrelated items sharing
  an ID (P1c's JV items vs P14d's Power-Automate items; the I12 `land_area` defect vs the
  `manual_verify` priority question). Renamed P14d `J1–J6 → PA1–PA6` (one cross-ref in
  `OPERATOR-ACTIONS.md` updated) and the `manual_verify` row → `PR9`. ⚠️ **The dedupe grep reports
  collisions and duplicates identically — read the rows before merging.**
- Response + prompt moved to `done/`.

**Next:** run **OCR1** (`docs/claude-code/prompts/OCR1-local-ocr-bakeoff.md`), leading with its §0.

## 2026-09-02 — Thread wrapped: handoff written, STATUS archived, topic set consolidated

**This window is being continued in a fresh context.** `docs/os/DATA-PROCESS-AUDIT-HANDOFF.md` is
the kickoff document — it replaces reading this file end to end, and `CLAUDE.md` now points at it.

**Consolidation done in this turn:**

- **`STATUS.md` archived at 10,531 lines** → `docs/history/STATUS_claude-code_2026-08-20_to_2026-08-21.md`
  (1,726 lines, verbatim, pointer left behind). Now 8,814. ⚠️ **The file is NOT strictly
  date-sorted** — two windows append to it — so a date-based cut must be verified against the actual
  headings rather than assumed. I checked the archived range before writing it.
- **Nine canonical topic pages** now carry live state, decisions made, and traps paid for; the
  fourteen B6 audits are bannered as evidence-for-their-date pointing at them.
- **Backlog: 169 open 🔴 / 56 🟡 / 76 ✅.** Nothing unbuilt was dropped — the rule is *extract before
  archiving*, which recovered 62 items earlier in this arc that existed in no tracker.

**The handoff carries what a fresh chat actually needs**: which of the two parallel windows it is
(and which queued prompts belong to the OTHER one), the through-line that *every producer failure in
this arc reported success*, the in-flight `B6e-ci-last5` with its unresolved `B6e-ci-baseline39`
caveat, the next steps in order, the git sequence including the index-lock step, the consolidation
rules, and the eight traps this thread paid for.

⚠️ **Recorded honestly in the handoff: two of the corrections this thread made were to my own claims
that had already shipped into canonical pages** — the "latent, not live" call on the CM econ
exhibits, and "the firm model is unpopulated" when it is mis-populated. **The turn protocol now says
to correct your own prior claims in place and say so plainly**, because both were caught only by
re-measuring something that sounded right.

## 2026-09-02 — OCR1 staged as a BAKE-OFF, and the cost case does not survive the numbers

**Scott asked for the cheapest, highest-quality OCR source we can build. Measured it first, and the
justification I had been carrying is wrong.**

| method | tier | docs | avg chars | **billed pages** |
|---|---|---:|---:|---:|
| `pdf_text` — **free** | — | **140** | 38,664 | 34 |
| `office_text` — **free** | — | **45** | 32,935 | 0 |
| **`ocr`** | **DocAI** | **91** | **13,801** | **574** |
| `ocr` | gpt-4o | 20 | 1,511 | — |

🔴 **185 of 362 documents (51%) already extract FREE. Only 111 ever needed OCR. Total DocAI spend to
date: 574 billed pages ≈ $0.86** — corpus scale $23–53. **So cost is NOT the case for local OCR, and
the prompt leads with that rather than burying it.** Anyone arguing it on savings is arguing from a
number that does not support it.

🟢 **The real prize is that a local engine has NO PAGE CAP.** ⚠️ **Every hard problem in this arc —
DOC8, DOC14, DOC16, DOC17, DOC18 — was about Google's 15/30-page limit, not money.** Five prompts, a
refuted design, a blocked GCS build and a live probe, all to work around a cap a local engine simply
does not have. **It dissolves the class, including DOC18's partial-extract ceiling and DOC14
entirely.** Then **confidentiality** (today the complete PDF of every under-cap lease is sent to
Google) and **resilience** (⚠️ this session lost time to a credit-balance 400 on the Anthropic path).

**Prompt staged: `OCR1-local-ocr-bakeoff.md` — exploratory, measures before building.** ⚠️ **The
metric is FIELD AGREEMENT from `extractTenantFromLease`, never `char_len`** — a garbled OCR produces
plenty of characters, and **this repo was already burned by exactly that**: gpt-4o's 1,511-char rows
passed every count-based check while being useless. Sample ≥10 documents that actually needed OCR
(**not `pdf_text` rows, which would flatter both sides**), including ≥3 leases over 30pp. Runs on the
**GaryBuilt box** behind the existing tunnel + CF Access — ⚠️ **a dedicated service token, never the
ollama one** — and must **fail soft to DocAI**, with "the box is down" distinguishable from "the
document has no text." **Wiring is OCR1b, only if the bake-off measures a winner. Losing is a
legitimate outcome and is recorded so it is not re-proposed.**

📋 **The handoff now carries a recommended order:** DOC18 (reconcile) → **OCR1** → OCR2 → OCR1b (if
OCR1 wins) → OCR3 → then the BD thread (C18, C19). ⚠️ **And a standing instruction: if OCR1 wins,
revisit DOC18's ceiling and DOC14 immediately** — carrying a workaround past the thing that removed
the need for it is its own failure.

## 2026-09-02 — AI/OCR COST STRATEGY: the free tier is designed, has a producer, and is NOT WIRED

**Scott asked whether these AI calls should run local, Microsoft-native, or Google — with the
long-term view rather than the current subtask's best objective. Inventoried the whole surface.**
New canonical page: **`docs/architecture/ai-and-ocr-cost-strategy.md`**. Filed **OCR1–OCR6**.

🔴 **THE HEADLINE: `deps.freeOcr` — Tier 1, the $0 tier — HAS NO SERVER-SIDE PRODUCER AND NO
DEFAULT.** Both real callers build `deps` without it, so the whole Tier-1 block is skipped and
execution falls straight through to paid. **Every OCR call this system has ever made started at a
paid tier.** The only producer (`scripts/lease-ocr-backfill.mjs:379`) takes a **filesystem path**,
not `{buffer, mediaType}` — **structurally incompatible with the seam** — and runs on the
workstation. **The $0 tier exists in the design, the comments and a script, and has never once run
in production.**

🔴 **AND THE DEED LANE NEVER TIERS AT ALL** — `document-text.js:502-505` calls gpt-4o directly,
bypassing DocAI, gated only on `OPENAI_API_KEY`. **All 325 extracted deeds went to the 6–14× tier by
default** (OCR2).

⛔ **MICROSOFT IS REFUTED, and the repo had already established why:** M365 Copilot has **no
batch-OCR API**; Microsoft's OCR product is **Azure Document Intelligence, separately metered** (not
in the M365 subscription); and ⚠️ **Northmarq IT BLOCKS Azure AD app registrations** — documented in
three independent places. There is **no Azure AI client anywhere** and **no AI action in any of the
18 Power Automate flows.** It would be a new paid vendor through a blocked auth path, for no
advantage over DocAI. **Recorded as OCR6 so it is not re-proposed.**

✅ **The LLM side is already largely local** — `qwen2.5:14b` on GaryBuilt, with **9 flags ON**
(`OLLAMA_EXTRACTION`, `OLLAMA_CLEAN_ASSIST`, `PROPERTY_TWIN_ASSIST`, `MATCH_DISAMBIG_ASSIST`,
`W9_3_SF_ASSIST`, `OWNERSHIP_CHAIN_DRAFT`, `DRAFT_ASSIST`, `BRIEFING_ANALYST_TAKE_ONPREM`,
`OCR_CLOUD_DOCAI`). ⚠️ **The migration seeds say `off` and the DB says `on` — the seeds are
authoring-time snapshots that deliberately do not update `state` on conflict. Only the DB is
authoritative.** ⚠️ **But OCR is not an LLM task and Ollama does not do it** — conflating the two is
the trap here.

🔵 **The default cloud path may be FAILING rather than spending** (OCR3): `invokeChatProvider`
defaults to the edge fn pinned to **`claude-sonnet-4-20250514`**, which two independent records say
is **retired (400)** and additionally hitting *"credit balance too low."* ⚠️ **The fallback chain
would absorb that silently into `gpt-4o-mini`** — so ~10 un-flagged call sites may be on a fallback
nobody chose. **Measure before assuming either way.**

⚠️ **No pricing constant, rate variable or spend budget exists in executable code** (OCR5). The
~$1.50/1k figure is **comment-only in four places**, `ocr_pages` is recorded as *what we were billed
for* and **never priced**, and **the rate itself is unverified** — the pricing page is egress-blocked
from every environment tried.

**Recommendation: ship DOC18 now (~$3.30, don't hold it), then OCR1 — an OCR endpoint on the
GaryBuilt box behind the EXISTING tunnel + CF Access (the SOS-proxy precedent), injected at the two
call sites where the seam already exists and is already stubbed in tests.** That makes routine OCR
**$0/page permanently** and leaves DocAI as the escalation, which is what the design always said.

⚠️ **THE RISK, NAMED NOT ASSUMED PAST: local OCR quality on executed leases is UNMEASURED.** The only
tier comparison we hold — DocAI 14,687 avg chars vs gpt-4o 1,579 — says **gpt-4o is bad, not that
Surya matches DocAI.** **A bake-off on 10 real leases is part of OCR1.** If local loses, Tier 1
becomes a born-digital pre-filter and DocAI stays the workhorse — still a large and honest saving.

📋 **Session handoff written:
`docs/claude-code/prompts/HANDOFF-2026-09-02-document-ocr-and-owner-roles.md`** — carries the state,
the open items, the git/lock procedure, the documentation and consolidation discipline, and the
measurement traps that actually bit this session.

## 2026-09-02 — DOC17: the cap is measured against the SELECTION. The cheap route works; DOC18 staged.

✅ **Probed on a real 316-page PDF. `individualPageSelector {pages:[31..45]}` returned 200 with pages
31–45 and 65,297 chars, and the positive control (`fromStart:15`) also passed.** ⚠️ **Both arms
passing is what makes it an answer** — a single success proves nothing about a selector that might
have been ignored, so **the returned page NUMBERS are the evidence, not the page count.**

**THE RULE: 30 pages per call contiguously from page 1 (imageless); 15 pages anywhere else.**
⚠️ **A 31-page selection was refused for being 31, NOT for being part of 316 — the document total
never enters the arithmetic.**

**So a 50-page window is 3 calls, our 141-page maximum is 9, and the whole 42-document backlog is
~$3.30 — with no GCS, no IAM, no service-agent grant, no lifecycle rule, no LRO table and no
confidentiality decision.**

⚠️ **This corrects my own last entry: DOC16's refutation stands, its CONSEQUENCE does not.** Its
pages-31–50 call **is** available, just at 15 pages rather than 30 — three calls where it assumed
two. **The "~40% of the window unreachable" figure was the honest number for a ONE-call route and
must not be carried into Scott's DOC14 decision.**

**Four traps measured, all load-bearing for DOC18:** ⚠️ **`metadata.page_limit` reports the MAXIMUM
ACHIEVABLE limit, not the one in force** (says 30 when 15 applies — and `pageLimitFromError` prefers
the structured field **by design**, so a retry sized from it loops forever) · **the `At most 15
pages` shape carries no `details[]` and BOTH parser halves are blind to it** · **the base limit is 15
and the baseline arm said 30** — *one error's metadata is not a limits table* · `docai-ocr` resolves
one secret with `||` so the first env var **shadows** the others.

⚠️ **Honest gap, stated not glossed: the probe document is NOT one of the 42** —
`SHAREPOINT_FETCH_URL` is a Railway var, not a Supabase secret, so their bytes are unreachable from
where the credentials live. **Nothing moved:** 42 markers, `docai-ocr` byte-identical, spend $0.09.

🟢 **DOC18 staged** — the three-call route, with all four traps written into it and the honest
ceiling recorded (pages beyond ~50 stay unread; the `abstract` wants clauses from the back half).
👤 **DOC14 should probably be CLOSED — Scott's call**, and the input has changed: no longer *"a GCS
build or lose 40% of the window"* but **"a GCS build or nine cheap sync calls."**

🧹 **Consolidation: the DOC backlog went 19 rows → 11.** ⚠️ **DOC8 and DOC9 each had TWO rows** (as
DOC13 did last round). Eight resolved items are now one summary line pointing at the canonical page;
**every open item keeps its full detail and nothing was lost.**
## 2026-09-02 — DE1/BR1/BR2 shipped, and MY "latent, not live" call was wrong (Dialysis PR #7392)

| unit | outcome |
|---|---|
| **DE1** | both CM econ exhibits gated on `payer_mix_source`; **both MOVED** |
| **BR1** | 2,425 rows typed from recorded facts; **nothing written**, 72 mints withheld |
| **BR2** | producer fix **+** 846-row backfill together; `name_set_id_null` 1,930 → **1,084**, `id_set_name_null` held at **0** |

### 🚨 The correction, and it is mine

I wrote *"latent, not live — do not describe it as a current book error"* into the prompt and into
the canonical page. **It was wrong, and CC measured it before acting on my premise.**

I reasoned about FY2026 alone — correctly excluded by `HAVING count(*) >= 1000` at 724 rows — and
concluded the exhibits were protected. **But modeled rows exist in EVERY year**: 523
`partial_plus_default` across FY2021–24, 210 in FY2024 alone. **The year threshold never guarded
against them.** Verified live after the fix:

- `cm_dialysis_clinic_econ_trend_y`: FY2024 clinic count **6,754 → 6,536**, avg revenue/clinic
  **$3,476,458 → $3,584,713 (+3.1%)**.
- 🚨 `cm_dialysis_operator_unit_economics` was **LIVE-WRONG**: it filters on `is_current_year`, which
  spans **FY2011–2026**, so it served the FY2026 fallback husks directly. **Satellite's
  revenue/clinic was understated by 41%** and several operator margins roughly halved.

**The lesson: a year-based guard and a quality-based guard are not substitutes.** I treated a
row-count threshold as if it protected against modeled data; it protected against thin years, and
the two populations only partly overlap.

⚠️ **And CC rejected the obvious confound rather than assuming it** — modeled ≠ merely stale.
Measured-but-stale clinics look normal ($3.42M, 8,742 treatments/yr); modeled rows are damaged in
**both** vintages (stale = husks at **27 treatments/yr**, recent = the $301.85 fallback signature).
**Gating on the fact is right; gating on vintage would not have been.**

### 🚨 Second correction: the firm registry is MIS-populated, not merely unpopulated

My page said *"the model is right, it is unpopulated."* Measured on `broker_companies` (131 rows):
**73 (56%) contain a `;`**, 28 are single-token abbreviations (`ay`, `cb`, `acre`, `cook`), 9 read as
person names, and **7 are the `colliers%` family**. Live: **`cbre; smyth & colliers; patel`** minted
as one company; `colliers`, `colliers international` and five `colliers; <agent>` rows as separate
firms; `colin cornell` as a company. **The composite defect was written into the firm table too, so
the real distinct-firm count is far below 131** — and any matcher pointed at this registry will
attach agents to composite pseudo-firms. Both canonical pages corrected in place.

### Also worth keeping

- **`contacts.entity_type` is NULL on all 1,916 rows** — useless as a typing instrument, and CC
  graded it *before* relying on it rather than after.
- **CC caught its own masking twice**: `| tail -30` hid pytest's summary behind a module's `atexit`
  output, and a background shell's cwd made `tests/` unresolvable while the shell still reported
  success. **Same class as the `| tee` defect this whole arc is about** — its numbers now come from
  a file rather than a pipe.

### ⚠️ OPEN — the suite reads 39 failed against a documented baseline of 14

None of the 39 touches broker, `listing_broker`, `update_field` or the econ views, and
`test_listing_broker_update` (9 tests, 5/5 mutations RED) passes inside the full run. But
**isolation cannot adjudicate it** — the same 12 files give 7 failures alone and ~34 inside the
suite, which is the documented cross-module stub pollution. The apples-to-apples baseline run was
still in flight. **Do not treat 14 → 39 as a regression or as noise until that lands.** → `B6e-ci-baseline39`.

## 2026-09-02 — DOC16 REFUTED on an unpredicted branch; my "lossless" claim inverts; DOC17 probes the decider

**The gate ran and the sync path DOES accept a page selector** — `processOptions` →
`individualPageSelector {pages}` / `fromStart` / `fromEnd`, read from the live v1 discovery document
(rev 20260820), **not** inferred from the repo's `imagelessMode` comment.

⚠️ **But the constraint sits where neither DOC16 nor its own STOP clause looked.** Google's Limits
page: the 30-page extended cap *"is only applicable when processing pages contiguously **starting
from page 1**."* So DOC16's second call — pages 31–50 — **cannot claim it by construction**, and that
call was the load-bearing half: the whole difference between **~54,000** and **~90,000 chars**.

🔴 **AND MY §4 CLAIM INVERTS RATHER THAN SHRINKS.** I wrote that this route was *"lossless on the
consumer's terms."* A 30-page-only route drops pages 31–50 across **all 42** documents — **~36,000
chars, ≈40% of the consumer's 90,000-char window**, content `extractTenantFromLease` genuinely reads.
**Corrected in place rather than left standing.**

⚠️ **Good instrument discipline in the run, worth keeping:** the discovery document states **no page
limits at all**, and that was read as **a property of the instrument (a schema, not a quota surface),
not as permission** — Class 11, caught rather than cashed.

**Re-measured: the population is 42, not 40** (18 at 31–50pp, 24 at >50pp, max 141); chars/page
reproduces at 1,808 / 1,732 over 85 rows. Live now: undrained **419**, `bov_ready` **39**, gpt-4o
escalations still **0**.

🟢 **DOC17 staged — ONE API call decides between "no GCS at all" and the full GCS build.** The
unsettled question: **is a NON-page-1 selection measured against the selection or the document
total?** Google's docs are silent, and DOC8's `{page_limit:30, pages:40}` **was taken with no
selector, so it does not discriminate.** ⚠️ **The probe carries a mandatory positive control**
(`fromStart:15` on the same document, which must succeed) — **without it a failure cannot be told
from a silently-ignored selector**, which is the DOC8 no-op shape exactly. ⚠️ **Probe only; build
nothing either way.**

**Succeeds** → multi-call sync reaches ~50 pages with no GCS, no IAM, no new vendor surface and **no
confidentiality decision at all.** **Fails** → sync caps at 30 pages, **DOC14 becomes genuinely
necessary**, and Scott's decision gets weighed against an honestly priced alternative: **30 pages
captures ~60% of the consumer's window.**

## 2026-09-02 — DOC16 staged: the consumer truncates at ~50 pages, so the GCS build is probably unnecessary

**I was about to take Scott a confidentiality decision. Two measurements first, and they changed the
question.**

**1. `bov-extract.js:147` slices lease text at 90,000 characters before prompting.** Our corpus runs
**1,799 chars/page (median 1,727) → 90,000 ≈ 50 PAGES.** **The consumer never reads past ~page 50 of
any lease, however it was extracted.** Against the 40 over-cap documents: **16 are 31–50pp (fully
used) and 24 are 51–141pp** — ⚠️ **so for 60% of the population the entire GCS batch build delivers
text `extractTenantFromLease` throws away.**

**2. ⚠️ The confidentiality delta is much narrower than it appeared.** `document-text.js:262` already
sends `content_base64` of the **whole file**, and deployed `docai-ocr` v24 passes it through as
`rawDocument` — **Google already receives every under-cap lease in full, today.** Batch adds
**persistence at rest in a bucket**, not disclosure. **Still a real decision, but a different one —
and I would have put the wrong question to Scott.**

**DOC16 staged: two sync calls, pages 1–30 and 31–50, concatenated into one contiguous `raw_text`** —
~50 pages ≈ 90,000 chars, **exactly what the consumer can use, with no GCS, no IAM, no new vendor
surface.** ⚠️ **NOT the analysis-chunking DOC14 §6 forbade** — that warned against splitting the
*analysis*; this splits the *OCR call* and yields one contiguous text.

⚠️ **It rests on ONE unverified question and the prompt leads with it:** does the 30-page imageless
cap apply to the page **SELECTION** or the document **TOTAL**? **If the total, the route is
impossible — stop and fall back to DOC14.** The repo sends **no `processOptions` at all** today, and
⚠️ the existing `imagelessMode` comment is about a **different field** and is **not evidence** about
where a page selector belongs — **DOC8's exact lesson, written into the prompt so it is not repeated.**

⚠️ **Honest residual, recorded not buried:** `raw_text` is not read only by `extractTenantFromLease`.
The `abstract` block wants **renewal options, early termination, default cure, holdover, key lease
risks** — clauses that routinely sit in the **back half** of a long lease. Pages 51+ are not
captured, and **a `partial_extract` row must never count as complete coverage.**

**DOC14 is not withdrawn — it is the fallback, and the confidentiality decision is DEFERRED, not
answered.**

## 2026-09-02 — DOC14 blocked on a CONFIDENTIALITY decision; DOC13 answered; the sizing moved ~2×

**DOC14 stopped at the operator prerequisite and built nothing — the intended outcome.** The async
contract was verified from the **live v1 discovery document** (rev 20260820): `batchProcess` → LRO,
poll `operations.get`, output at `outputGcsDestination`.

⚠️ **TWO WAYS MY PREREQUISITE LIST WAS WRONG, and the missing half is the expensive one.**
**`BatchDocumentsInputConfig` accepts ONLY `gcsPrefix`/`gcsDocuments` — batch takes NO inline
bytes**, so an **INPUT bucket is mandatory too and every SharePoint byte-stream must be uploaded to
GCS first** — materially more than "add a bucket." And **`imagelessMode` does not exist on
`BatchProcessRequest`**: DOC8's flag does not carry over.

🔴 **THE GATE IS CONFIDENTIALITY, NOT COST.** ~$3 for the whole projected backlog. **But batch writes
the FULL TEXT of confidential executed client leases to GCS as JSON** — Scott's decision, not
plumbing. ⚠️ The **~500 pp ceiling remains UNVERIFIED** (`docs.cloud.google.com` egress-blocked).

⚠️ **THE SIZING MOVED ~2× OVERNIGHT — my own "small sample" caveat cashed in, and it corrected three
documented claims:** lease **17.0%** (was 8.1%, then 10.1%) · ⚠️ **"100% leases" REFUTED — DD is 4 at
4.4%** · **max pages 57 → 141**, which **makes the unverified ~500 pp ceiling load-bearing after
all**, reversing yesterday's "our largest is 59 pages" reasoning. **~87 projected; 40 already marked
with 426 undrained.** ⚠️ **Third time in this arc a rate moved materially as the sample grew** (the
86% escalation, `repeat_buyer` 8×, now this) — **quote a rate with its denominator AND its sample.**

✅ **DOC13 ANSWERED — `retry_admitted: 0` is CORRECT.** 11 of 14 markers are past 24 h with no
re-extraction, which reads like a stall and is not: `scan_lowest_id: 2 · scan_capped: false ·
eligible: 15` — **the scan reaches the oldest document, is not budget-capped, and fills its limit
from the 426 FRESH documents first.** Retries are correctly lowest priority while real work exists.

🔵 **DOC15 filed as a watch:** if documents arrive faster than the drain, **the retry lane never
runs** — Class 12 one level up, a lower-priority lane that can starve. **Verify `retry_admitted`
goes non-zero as `undrained` approaches 0.**

🧹 **Consolidation, and one real defect found:** **`PLANNED-BACKLOG.md` carried TWO DOC13 rows** —
collapsed to one. And **the canonical page now opens with a CURRENT STATE block**; §0 had become an
eight-entry dated worklog a new reader would have to read backwards. Live: deeds **325/325** · drain
**771 → 426** · **`bov_ready` 5 → 37** · **22+ OCR events, 100% DocAI, zero gpt-4o** · 🔴 **40
documents getting no text at all.**

## 2026-09-01 — DE1 + BR1 + BR2 drafted as one prompt, and Unit 3 carries a hard prerequisite

`DE1-BR1-BR2-confidence-gate-and-broker-identity.md`. Three units, ordered smallest-and-independent
first, each shippable alone.

**Unit 1 (DE1)** gates the two CM econ exhibits on **`payer_mix_source = 'hcris_form_265_11'`** — the
FACT — rather than on `confidence_tier`, its proxy. ⚠️ **The expected result is NO CHANGE today**, and
that is the point: it proves the gate is additive. **A view whose output moves today would mean it
was already admitting modeled rows, which is a bigger finding.** The `HAVING count(*) >= 1000` stays,
because it guards a different thing.

**Unit 2 (BR1)** types the person/firm split. ⚠️ **Recorded facts before regexes** — `company`,
`broker_company_id` and `contact_id` (1,916 populated) all carry evidence, and the
two-capitalised-tokens name heuristic has already cost this codebase real companies. **Undecidable
rows stay undecided.**

🚨 **Unit 3 (BR2) has a hard prerequisite I nearly missed while sequencing this.**
`B6e-ci-last5-decisions-resolved.md` is **still queued, not run** — and it carries the `update_field`
producer fix. **Backfilling the broker FK while that producer is still broken is a one-shot repair of
a live producer, the Class 8 failure this repo documents over and over.** So the prompt requires
**either landing the producer fix in the same change, or stopping at the plan and saying so.** It may
not ship the backfill alone.

**Deliberately out of scope: BR4 (the 143 duplicate-name groups).** Deduping before the firm link is
populated would merge two real people at the same firm — resolving the firm is what makes a duplicate
visible or explains it away.

## 2026-09-01 — Broker + Medicare storage audited and CANONICALISED, so neither gets re-flagged as a bug

Scott: *"clean the broker and firm name storage so it's cleanly shown everywhere… be sure to update
this finding in all documentation so we don't flag it as an error in future chat either way…
document the same for medicare… anything else that would get us closer to accurate."* Two new
canonical pages, both leading with **what is NOT a defect**:
`broker-and-firm-identity.md` and `dialysis-economics-and-medicare-data.md`.

### Broker — yes, clean it, but it is a MODELLING job, not string cleaning

🚨 **`broker_name` is not a name field. It is a composite** — `;` on **344 of 2,425** broker rows and
**778 sales rows**, carrying at least three different facts: `Acre Advisors; Reid` (firm ; agent),
`Adrian Mendoza; Sean Sharko; Austin Weisenbeck` (a three-agent team), and `Avison Young; Barnes`
alongside `AY; Barnes` — **the same firm, spelled out and abbreviated.** ⚠️ **49 rows carry `&` and
no `;` and are mostly REAL firm names** (`Lee & Associates`) — the P158a hazard again: **an `&` is
part of a name, not a separator.**

⚠️ **So "clean the strings" would destroy information.** A co-listing is a real fact; collapsing it
asserts something false. **The model already exists** — `broker_companies` (131 rows), `brokers`
(2,425), `broker_company_id` — and it is **7.6% populated**, while **299 `broker_name` values look
like a firm** and **177 have `broker_name` == `company`**. Parse into it; keep the raw string as
evidence. → `BR1`–`BR5`.

✅ **Recorded as explicitly NOT a defect: `listing_broker_id` set with the name NULL is 0 of 4,783.**
Both-columns is the existing design, not a new requirement.

### Medicare — the accuracy answer is a column nobody filters on

**`clinic_econ_reconciled.confidence_tier` separates measured from modeled.** FY2021–2024 is
**98% `hcris_form_265_11` / high** (26,021 rows, 6,590 clinics). 🚨 **FY2026 holds ZERO
`hcris_form_265_11` rows — 659 `partial_plus_default` + 65 `national_default`, all `low`** — because
2026 cost reports have not been filed. **Its "73.66% Medicare / $297.87 blended" is the fallback
signature, not a market shift**, and that signature is stable across every year it appears
(~$295–301 / 65–75%), which makes it very easy to read as a trend.

⚠️ **A year chart including FY2026 shows the blended rate going ~375 → ~298 and reads as a 20% rate
collapse.** **Latent, not live** — `cm_dialysis_clinic_econ_trend_y` tops out at 2024 — **and its
only protection is `HAVING count(*) >= 1000`, a magnitude proxy, with FY2026 sitting at 724.** → `DE1`.

⚠️ **I nearly published the opposite finding.** My first audit used
`definition ILIKE '%confidence_tier%'` and reported three views as "careful"; that matches the
**SELECT projection**, not a filter. Re-tested for the predicate: **exactly 1 of 8 econ views has
`confidence_tier` in a WHERE clause.** The P182 deparse-grep trap, committed while auditing for
precisely that class — and caught only because the trend view's actual output stopped at 2024 and
did not match my alarm.

Also recorded as **not defects**, so they stop being re-raised: the flat blended rate (−0.6% over
four years — what drifts is payer mix), `RATES_2025` == `CMS_2023_RATES`, `facility_patient_counts`
being an ~annual CMS reporting series rather than a nightly feed, and future-dated `snapshot_date`
values being CMS fiscal-period convention. **What would genuinely improve accuracy is `DE1`–`DE4`**,
of which DE1 is the only one with a path to a client deliverable.

## 2026-09-01 — C13c SHIPPED: `one_off_owner` carries its confidence, and the fourth column answered

**Live on LCC Opps.** `one_off_owner` **142 = 13 `_sf_corroborated` + 129 `_unverified`** — the
COUNT deliberately unchanged — plus **21 named institutional rows** on
`v_lcc_entity_role_ambiguity.entity_type_contradicted_by_named_review`, read from the
`lcc_entity_role_confirmation` ledger and **never a name stoplist in the classifier**. Every other
arm, `v_lcc_user_owner_candidates` (15), multi-role (954) and **P0.4 (555)** unmoved. Migration
`20261006120000`; guard `test/c13c-one-off-owner-confidence.test.mjs` (9 tests, **21/21 mutations
RED**). Writeup `docs/audits/C13c_ONE_OFF_OWNER_CONFIDENCE_2026-09-01.md`.

⚠️ **C13b's "no non-lexical corroboration exists" was THREE ABSENCES, NOT A SEARCH.**
`salesforce/Account`, `works_at` and `org_type` are genuinely 0 — and the fourth column,
`salesforce/Contact`, answers on **13 of 142**, with **ZERO of the institutional names carrying
one.** *Before recording that a fact has no corroboration, enumerate every identity the table can
hold.*

⚠️ **The routed set is 21, not the ~15 the brief predicted, and the extra 6 are the arm's biggest
rows.** The brief's list is drawn from the 28 that FAIL `lcc_looks_like_person`, so it structurally
cannot contain **`Gates Hudson` ($19.6M)** or **`Metropolitan Life Insurance` ($11.8M)** — #2 and #3
by rent, both of which **pass** the name test and were already read in the design page. **A list
filtered by a failing instrument is not the population.**

⚠️ **The uncorroborated 129 read ~80% genuine, and nobody had measured it.** A deterministic 10-row
sample: **8 clear individuals, 1 clearly not (`Everbank`, already routed), 1 ambiguous
(`Peter Hanson RE`)**. The 28 name-test failures are not a random sample of the 129.

⚠️ **The brief's prose and its numbers disagreed and the numbers won.** "…so they stop being emitted
as individuals" against an assertion table reading 142 unchanged, split 13/129. Shipped the split,
not the suppression — and **proved the reason: all 21 keep `investor_owner`**, so the wrong label
removes nobody and admits nobody today. Suppression is **C13f**; the `entities.entity_type` repair
is **C13g** (floor 414 entities / $181.8M — ⚠️ *the lexical 13,225 measures the regex, not the
population*); the corroboration ceiling is **C13h** (9% here vs 75% fleet-wide, because this arm is
RCA/CoStar capture the CRM has never held).

⚠️ **`test/c13b-entity-roles-multilabel.test.mjs` now reads the C13c migration** — C13c rebuilds the
view, so the C13b file no longer describes what ships (P197). All 11 C13b invariants pass over the
shipped definition.

## 2026-09-01 — DOC14 sized and staged: the over-cap population is 100% LEASES, at 8.1%

**Re-measured on a larger sample per my own caveat, and it sharpened rather than softened.**

| doctype | drained | **over cap** | rate | still undrained |
|---|---:|---:|---:|---:|
| **lease** | 86 | **7** | **8.1%** | **360** |
| dd | 51 | **0** | 0% | 205 |
| om | 30 | **0** | 0% | 39 |

**Every over-cap document is a lease**, 31–57 pages. **Projected: ~29 more, ~36 total** receiving no
text at all.

⚠️ **AND THE DENOMINATOR CAUGHT ME MID-SESSION.** `over_cap ÷ page_counted_leases` reads **32%** —
but only OCR-path rows carry a `page_count`, so that is the OCR subset, not all leases. I had begun
compounding that into a projection of ~130 before measuring the rate directly at **8.1%**. **A ~4×
overstatement, avoided only by measuring instead of multiplying two estimates.**

**The bimodality now has a semantic explanation:** leases are either **short (1–12 pages** —
amendments, short forms) or **long (31–57** — full executed leases). **The 16–30 band holds ONE
document corpus-wide and it is a DD.** So DOC8's 15 → 30 raise unlocks **zero leases** — the DOC12
finding, restated with the doctype attached.

**Why it is the right next item:** `bov-extract.js` reads leases to extract the tenant, and these are
the full executed documents. ⚠️ **They yield nothing while `bov_ready` climbs — the marker makes the
gap quiet**, which is this repo's own honest-counts failure pointed back at us.

**Prompt staged: `DOC14-long-lease-ocr-async.md`** — DocAI async/batch through the **existing
`mode=jobs` lane** (submit → poll → ingest), with three constraints written in: ⚠️ **async cannot fit
the 22 s tick** (long-running operation, GCS output); ⚠️ **verify the contract against the live v1
discovery document**, since DOC8's flag was a top-level boolean and the prompt's framing would have
made it a silent no-op; ⛔ **never fall back to gpt-4o.** ⚠️ **And if the route is unavailable, stop
and say so** — chunking a lease changes what `extractTenantFromLease` receives, and a named honest
ceiling beats a plausible workaround.

**Drain at 22:20: undrained 604, sidecar 167, `bov_ready` 13, gpt-4o escalations still 0.**
🔵 **DOC13 (retry re-admission) remains time-gated to ~16:00–16:30 UTC 2026-09-02 and has NOT run.**

## 2026-09-01 — C13c SHIPPED and verified; DOC12 CLOSED, and its finding inverts DOC8's premise

⚠️ **Naming note for whoever reads this next: the response filed as "DOC13" was C13c.** DOC13 (the
document-lane retry check) has **not** run and is still time-gated to **~16:00–16:30 UTC 2026-09-02**.
**C13c ≠ DOC13** — two different threads, one keystroke apart.

✅ **C13c verified live: `one_off_owner` held at 142** exactly as predicted, split into
**13 `individual_single_current_asset_sf_corroborated` / 129 `..._unverified`**, with **21 rows
routed to ambiguity as contradicted** — six more than the list I had read. `user_owner` 10 and
`entities_with_role` 10,655 both unchanged, so nothing else moved.

🔴 **DOC12 CLOSED — the escalation is fixed, but NOT by what we shipped it for.** 14 OCR events since
redeploy, **zero gpt-4o**; drain **695 → 615**; `bov_ready` **5 → 13**. The page distribution settles
the cause:

| band | docs | range |
|---|---:|---|
| 01–15 — the OLD cap already served these | **19** | 1–12 |
| **16–30 — the entire population DOC8's raise exists for** | **1** | 25 |
| 31+ — marker, no OCR | **5** | **31–57** |

**The 16–30 band holds ONE document in the whole corpus and it predates the deploy.** The documents
that were actually falling through are **31–57 pages — above 30 either way.** ⚠️ **So the cap raise
fixed almost nothing; the MARKER closed the escalation.** DOC8's fix was chosen from Google's error
text (*"imageless raises the limit to 30"*) — **a fact about the API, not about our corpus.**
**A vendor's stated limit tells you what the API will accept, never whether your population sits
under it. Measure the distribution before sizing a fix to a threshold.**

🔴 **DOC14 filed — and it is the part that matters now.** Those **5 documents at 31–57 pages get NO
text at all**: marked, invisible to both consumers, never extracted. At that length on this corpus
they are almost certainly **full executed leases — the highest-value input BOV extract could get** —
and the count grows as the backlog drains. ⚠️ **The marker is correct behaviour but it is not
coverage, and it makes the gap QUIET**: `bov_ready` climbs while the longest leases silently yield
nothing. Likely route is DocAI **async/batch**; ⚠️ **verify the ceiling against the live discovery
document** (DOC8's own lesson) and **do not reach back for gpt-4o** (9.3× less text).
⚠️ `page_count` is populated on **25 of 156** rows — right population, small sample; re-measure.

## 2026-09-01 — C13c measured and staged: `one_off_owner`'s evidence column fails BOTH ways

**`one_off_owner` = 142 and its only evidence is `entities.entity_type='person'`.** 28 fail
`lcc_looks_like_person`; **reading them is what settles it, not the rate.**

⚠️ **Institutions typed `person`, by rent: `Jamestown` at $22,801,678** — an institutional
investment manager sitting on a one-off-individual lane — then SkyREM $1.48M, Deoworks, Protea
Primewest, Everbank, Gofsco, **`AEI NET Lease Portfolio XIII D`** (a fund, in its own name), plus
Alexandria, Brixmor, AvalonBay, BREIT, LaSalle, MIT, Komatsu.

⚠️ **And the name test rejects genuine individuals**, so tightening it is not the fix:
`Maslow Robert C & Michele C` $654k · `Anil M & Rajeshkumar K Khatri` $454k · `Rubinfeld Family` ·
`Chad Schnabel (GA)` · `Neeta` · `Guy` · `Joan` · `Buddy`. **`&` is a married couple (P158a)**, and
`lcc_owner_name_has_org_marker` catches **0 of 142**.

✅ **A discriminating RECORDED fact exists: a `salesforce/Contact` identity — 13 of 142, and 12 of
the 13 are unmistakable individuals** (the miss is `Law Offices`, the documented
two-capitalised-tokens false positive). ⚠️ **The positive control is the important half: ZERO of the
institutional names carry one** — not Jamestown, BREIT, AvalonBay, Brixmor, Alexandria or MIT.
**The signal separates exactly the population that must be separated**, which is why it is worth
building on where a name test is not.

**Disposition: a CONFIDENCE SPLIT, not a deletion.** ⚠️ 142 → 13 discards genuine individuals simply
absent from Salesforce; asserting all 142 keeps a $22.8M manager mislabelled. So the count stays 142
and the **`evidence_arm` splits** — corroborated 13 / `entity_type`-only 129 — with the ~15 named
institutions routed to ambiguity as **reviewed rows**, never a name stoplist. **P181 one layer
down.** Prompt: `done/C13c-one-off-owner-confidence.md`. **✅ Executed — see the entry above.**

🔧 **Git locks — I am the cause, and my first diagnosis was incomplete.** `ORIG_HEAD.lock` is written
by `pull`/`merge`/`reset`, so I blamed `git pull` from the sandbox. ⚠️ **Then `git fetch` left an
`index.lock` behind too.** The real rule is broader: **the Linux sandbox cannot unlink ANY lock file
it creates on the Windows mount** (`Operation not permitted`), so **no git command that takes a lock
should be run from the sandbox** — not `pull`, not `fetch`. Read-only inspection
(`git log`, `git show origin/main:<path>`, `ls`) is safe. ⚠️ **I had also grepped the warning out of
my own output**, which is why it took three occurrences to notice.

## 2026-09-01 — ✅ C13b SHIPPED: the owner-role classification is a SET, and three of its own inputs were wrong

`v_lcc_entity_roles` is live on LCC Opps — **one row per (entity, role)** with its evidence arm,
dates and pacing. **10,655 entities carry ≥1 role (was 4,132); 946 carry ≥2 (was structurally
impossible); 0 duplicate (entity, role) pairs.** A VIEW over the existing spine, never a stamped
column. **P0.4 555 → 555, deal bands 621 → 621, no consumer repointed, nothing writes.**
Migration `20261005120000`; guard `test/c13b-entity-roles-multilabel.test.mjs` (11 tests,
**19/19 mutations RED**); suite 4,954 pass / 0 fail. Writeup
[`../audits/C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md`](../audits/C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md);
canonical `docs/architecture/owner-role-classification.md` **§7**.

**Three inputs the design, the prompt and C13 all carried were corrected by measurement:**

- ⚠️ **`repeat_buyer` 3,258 → 401** (385 after guards). 3,258 counts `purchases` EDGES, and
  `entity_relationships` has no unique key on `(from,to,type)` (P177) with three sources observing
  the same conveyance. Read on named rows the difference is single-asset SPEs — Korea Investment
  Corporation on ONE property recorded twice. **The `(asset, date)` middle key was also measured and
  rejected** (735; the extra 334 are A2b cross-source lag). Knock-on: the design's *"2,627 repeat
  buyers dormant 5+ years"* is **219**, and 98 are active within 2 years.
- ⚠️ **A manual override REPLACES the column an arm reads.** 119 entities carry
  `owner_role='developer'` AND an override of `buyer`; emitting `developer` anyway resurrects the
  machine call a human corrected. `developer` **838 → 718**. The override rides **verbatim** —
  `buyer` (124) is not remapped into the derived vocabulary.
- ⚠️ **`one_off_owner` rests on `entities.entity_type`, which is wrong in both directions.** Top ten
  by rent: Jamestown $22.8M, Metropolitan Life Insurance, Gladstone Commercial, SkyREM — all typed
  `person`; and 979 `former_owner` rows are typed `organization` and read as individuals.
  **`first_name`/`last_name` looked like the corroboration and is a re-split of the same string**
  (P125). 0 of 142 carry any independent org signal. Surfaced in `v_lcc_entity_role_ambiguity`,
  not patched — a name test is banned and `lcc_looks_like_person` flags only 28 of 142 anyway.
  Backlog **C13c**.

**Also:** the obvious view shape (union-all over a materialized CTE) was **48× slower** on the exact
probe the consumer mapping issues (39,968 → 1,787 buffers); the fix needed BOTH a `not materialized`
LATERAL and hoisting the name guards out of the per-arm predicates. **C13's "477 + 35 ambiguous" do
not reproduce** — the SET dissolved them; the real residue is 298 rows. `user_owner` reads **0 by
design** (15 candidates read, 10 genuine / 5 SPE-named-after-tenant; the confirm ledger ships empty).

**Next:** **C13d** repoint `handleProspectingBrief`'s BD gate (measured 126 → 130, +4/−0; needs
`has_bd_role` as a view COLUMN); **C13e** build the `user_owner` confirm surface; **C13c** the
`entity_type` defect; **C18** (`ownership_start_date`) is unchanged and still the highest-value item
— though §7.2 corrects WHY: the 50.7% blindness belongs to `investor_owner` pacing, not to
repeat-buyer pacing, which is 98.8% dated.
## 2026-09-01 — Both blocking decisions RESOLVED ON MEASUREMENT, and the rate answer is better than either option offered

Scott's direction: *"the most accurate determination possible… we don't want to lose valuable
information but we want connected and clean and accurate data."* **Neither question needed an
opinion — both were answerable against the live database.** Prompt queued:
`B6e-ci-last5-decisions-resolved.md`.

### Decision 1 — the rate vintage: keep BOTH constants, and the real defect is elsewhere

Measured on `clinic_econ_reconciled` (`model_version_id = 21`, computed 2026-09-01), avg blended
rate per treatment by FY: **2021 375.44 · 2022 374.97 · 2023 374.27 · 2024 373.24.** **A −0.6% drift
over four years, and what moves is PAYER MIX, not rate** (Medicare 35.04% → 35.71%).

**So identical values for `RATES_2025` and `CMS_2023_RATES` are defensible — but keep them as two
named constants.** Collapsing costs nothing today and **permanently destroys the ability to express
a divergence** when CMS does move. That is Scott's *"don't lose valuable information"* applied to a
constant rather than a row. And the test-side one-liners are safe: **the code is within 0.3% of the
reconciled model; the test is 12.5% high.**

🚨 **The finding that outranks the question as asked: FY2025 has 61 rows and FY2026 has 724, against
~6,700/yr for 2021–2024 — and FY2026 reads 73.66% Medicare against a ~35% baseline.** Those are not
rate vintages, they are **thin partial-year populations with a different composition**, and a
ground-truth test calibrated against them is calibrating on noise. ⚠️ **An assertion averaging over
`fiscal_year >= 2021` drifts on its own as the thin years fill, with no code change.** Each
assertion must state its population.

### Decision 2 — the broker path: the design question is already settled by the data

`dia.sales_transactions`, 4,783 rows: **name set 2,111 · id set 181 · name-with-no-id 1,930 ·
id-with-no-name 0 · 528 distinct unresolved names.**

🎯 **`id_set_name_null = 0` settles it.** On all 181 rows that carry an id, **the name was kept
too** — the intended pattern is BOTH columns, and it simply stopped being applied. *"Don't lose
valuable information"* is not a new requirement here; it is the existing design being restored.

**And the resolution is far more tractable than 1,930 suggests.** The FK target `brokers` holds
**2,425 rows**, and **422 of 528 names (80%) match `broker_name` exactly, case-insensitively** — no
fuzzy matching, no identity guessing. Tier 2 (`normalized_name` 373 / `company` 209) takes the
remainder where unambiguous; **everything else goes to a review lane.**

⚠️ **The residue's shape is the argument against ever fuzzy-matching it**: `Avison Young; Barnes` and
`AY; Barnes` (multi-broker co-listings *plus* an abbreviation), `Anthony Falcone` / `Babcock`
(individuals), and **`4802 D Dialysis, LLC` — a property name misparsed into the broker slot.** A
fuzzy matcher would confidently attach the wrong firm to several. **Grouping-for-review ≠
identity-for-write**, again. And **a multi-broker string is a real fact, not a defect** — record that
it is one rather than picking half of it.

## 2026-09-01 — ✅ 14 → 5, the 6 false-green guards were real, and both remaining blockers are now SIZED decisions (PR #7391, `5d464dd`)

| | executed | pass | fail |
|---|---:|---:|---:|
| `73f1418` (pre-#7389) | **0** | — | — |
| `c80f778` (#7389) | 3,128 | 3,065 | 55 |
| `eac8668` (#7390) | 3,128 | 3,106 | 14 |
| **`5d464dd` (#7391)** | **3,132** | **3,119** | **5** |

**`executed` went UP, 3,128 → 3,132.** Nothing skipped or quarantined at any step in the arc. From
a suite that could not execute at all to one that executes fully with **five known, named,
individually-argued failures.**

### 🎯 The slice-window sweep confirmed the silent failure mode

**All 27 fixed-character windows re-anchored on their AST spans: 21 undershoot / 6 overshoot / 0
exact.** ⚠️ **Six guards were asserting against code outside the function they name** — the silent
false-green I flagged as theoretical when filing it. It was not theoretical. **B6e-ci-slice-window
closed.**

### The `financial_ground_truth` three: measured, and the test is the stale side

**The code sits within 0.3% of the live reconciled model; the test is 12.5% high.** So
`DEFAULT_PATIENTS` 79 → 72 and the 2-payer/4-payer reconstruction are **safe test-side one-liners on
the evidence.** ⚠️ **The genuine open question is much narrower than I filed it**: whether
`RATES_2025` and `CMS_2023_RATES` holding **identical constants** is a deliberate collapse or a lost
vintage distinction. 👤 **That is Scott's, and it is the only part of this group that is.**

### `listing_broker_update` (2): the cost of not deciding is now quantified

Move the broker-name normalisation into `update_field` (keeps the identity alias protecting every
other caller) — **or leave 1,930 sales carrying a broker name with no FK, invisible to
`broker_ranking.py`.** 👤 Scott's call; both blockers gate `B6e-ci-unmask`, and **the mask is
correctly still in place** — unmasking against 5 known failures ships a job red on day one.

### ✅ This also closes a mystery I filed two days ago

**`B6e-fred-git128` is explained.** Three `.claude/worktrees/*` gitlinks are committed with **no
`.gitmodules`**, which is what puts `The process '/usr/bin/git' failed with exit code 128` in *every*
CI job log. Pre-existing (from `325aca3`), not introduced by any recent PR. → **B6e-worktree-gitlinks**.

### ⚠️ One new finding verified, and its scope corrected

`properties.clinic_metadata` **does not exist anywhere in the dia schema** — confirmed, no column of
that name on any table — so `propagate_cms_to_properties` writes it and `update_row` **silently
drops it, no error.** ⚠️ **But the report called this "CMS certification-date propagation is a dead
write", and that is broader than the data supports.** Measured: `properties.certification_date` is
set on **2,417** rows and `cms_last_propagated_at` on **1,814**, stamped as recently as **2026-08-31
20:33** — **the certification-date propagation is LIVE.** What is dead is only the `clinic_metadata`
payload riding alongside it. ⚠️ **Also surfaced by that check and unexplained: 2,417 have a
certification date while only 1,814 carry a propagation stamp — 603 came from somewhere else.**

Also filed, not fixed: a **schema-refresh N+1** in `FinancialEstimateTracker.save_estimate()` (a
retry-with-backoff schema fetch *inside* the row loop, ~4.5 s/row).

⚠️ **Run 2279 carried 5 failures and reported success** — concrete, current evidence for why the
mask matters, from this very PR.

## 2026-09-01 — B6e-ci-red14 drafted: the last 14, and the `financial_ground_truth` group is measurable after all

Prompt queued: `B6e-ci-red14-adjudicate-the-last-14.md`. **The governing rule is the one this arc
keeps paying for — establish whether the TEST or the CODE is wrong before changing either** (twice
here a red test was stale and the code was correct), and **`executed` must stay at 3,128**.

⚠️ **I had filed the three `financial_ground_truth` failures as "needs Scott, not a fix." That was
half right and it under-specified the work.** The decision is his; **the gap is measurable now.**
`clinic_econ_reconciled` is live and current — **81,105 rows / 8,281 clinics / FY2011–2026, a single
`model_version_id = 21`, computed 2026-09-01**, `avg blended_rate_per_treatment 375.47` /
`avg reconciled_revenue_per_treatment 380.14`. So the deliverable is a **three-way comparison** —
test constant vs code output vs live reconciled value — resolving to one of: **stale test**,
**drifted code**, or **two internally-consistent things describing different scopes** (the most
likely answer if the numbers are close but unequal). **Nothing changes there without Scott.**

The other groups: `listing_broker_update` (2) is the real product bug — diagnose and propose, **do
not ship the flip**, because both columns exist and `available_listing_ingestor.py` deliberately
guards the alias; `handle_natural_language_query` (2) is the known drift; `backfill_*` (3) and four
singles are most likely straightforward and are worked first to shrink the count.

Also folded in: **re-anchor the 27 latent fixed-character slice windows** in
`test_processing_audit.py` on their AST spans. They are green today, and ⚠️ **the overshoot case is
silent — a green guard may be asserting against the NEXT function.** A green that turns red on
re-anchoring is a finding, not a regression.

**Still explicitly out of scope: the pytest unmask.** That is `B6e-ci-unmask`, after the red clears.

## 2026-09-01 — ✅ 55 → 14 red, and the fix that "worked" was RELOCATING the damage (PR #7390, `eac8668`)

| | collected | errors | executed | pass | fail |
|---|---:|---:|---:|---:|---:|
| `73f1418` (pre-#7389) | 3,110 | 5 | **0** | — | — |
| `c80f778` (#7389) | 3,128 | 0 | 3,128 | 3,065 | **55** |
| **`eac8668` (#7390)** | 3,128 | 0 | **3,128** | **3,106** | **14** |

**`executed` held at 3,128 across every step — nothing was hidden to make the number fall.** That
was the one thing the prompt demanded and it is the number that makes the rest trustworthy.

⚠️ **My prompt estimated the openpyxl cluster at ~12. Measured, it was 36 across three packages.**
The estimate came from counting error *strings* in a summary; the measurement came from running each
failing file alone.

### 🎯 The triage technique is the transferable part

**One `pytest <file>` per failing file split 55 into 36 pollution / 19 genuine *before a single
traceback was read*.** `test_master_sheet` + `test_work_product_base` are **21 passed alone, 21
failed in the suite, on identical source** — **that comparison, not the error text, is what proves
harness-vs-product.** Error messages describe the symptom; isolation identifies the class.

### 🚨 The sharp finding: restoring the real module RELOCATES the damage

Putting the genuine `openpyxl` back in `sys.modules` **created a new defect**.
`test_build_excel_summary.py`'s autouse fixture does `sys.modules["openpyxl"].Workbook =
DummyWorkbook` and never restores it. **While `openpyxl` was a throwaway stub, that line wrote to
garbage; once the real package is back, the same line permanently rebinds `openpyxl.Workbook`.**
The existing `_CRITICAL_ATTR_SNAPSHOT` could not see it — **it ran at collection time and the write
happens at run time.**

**Same shape in `dateutil`**, and its symptom is the reason to care: a live write to
`dateutil.parser.parse` surfaced as **`quarantine_dead_ends` silently deleting 0 rows instead of 1 —
in a module that never mentions `dateutil`.** That is a *data-affecting* bug reached through a test
harness.

Three layers were all required: **sys.modules objects** (fixed 9) · **attributes on the real module**
(24) · **symbols already bound into `src.*` globals** by a `from X import Y` executed inside the
stub window (8).

### The 14 that remain, and one real product bug

**5 genuine failures fixed.** Two are the **block-slice footgun, recurred**:
`test_processing_audit` asserted over `source[fn_start:fn_start+5000]`, and
`sanitize_pending_update` grew to **6,845 chars in B6d-pri-reason**, so five guards at chars
5,290–6,794 **fell outside the window over correct code.** Re-anchored on the real AST span, both
mutation-verified RED. ⚠️ **27 more fixed-window slices remain in that file** — green today, but a
window can *overshoot* into the next function, so **a green one may be passing on code it never
named** → **B6e-ci-slice-window**.

**14 left red, all failing in isolation** — genuine test-vs-code disagreements, not pollution.
⚠️ **`git log` cannot adjudicate them: every file traces to one squashed import merge `8c67444`, so
there is no "which side moved last."** Composition: `financial_ground_truth` (3 — revenue-model
constants vs the reconciled model; **guessing risks the documented `dialysis_econ_reconciled_v1`
calibration**), `handle_natural_language_query` (2, the known drift), `listing_broker_update` (2),
`backfill_*` (3), and 4 singles.

🔴 **One is a real product bug, filed rather than guessed at.** `update_database.update_field`
normalises a broker name to `listing_broker_id` **only if `resolved_field == "listing_broker_id"` —
but the alias is the identity mapping, so the branch is dead.** Both columns genuinely exist in dia
(53 vs 34 migration references) and `available_listing_ingestor.py` explicitly guards against alias
normalisation putting a *name* into the `_id` column, **so the identity alias is defensible and
flipping either side changes a write path** → **B6e-ci-listing-broker**.

✅ **`timeout-minutes` on all four jobs, sized from a real run** (33550677412): Tests 7 m 58 s → 20;
Lint / Security / Build ≤1 m 50 s → 10. They were inheriting the **6-hour** default.

⚠️ **Two reading traps, both flagged by CC and worth keeping.** Run 33550677412 **reports success
while carrying all 55 failures** — the conclusion is worthless here and the job log split is the only
real number. And **the merged PR body's figures are wrong**: it says 3,073 → 3,114 passed; the
measured values are **3,065 → 3,106**. The body assumed `pass + fail = collected` and silently
absorbed the **7 skipped + 1 xfailed** into the pass count. (Arithmetic confirms it: 3,114 + 14 =
3,128 leaves no room for skips.) **The commit message and `CLAUDE.md` carry the correct figures.**

⚠️ **PR #7390 was created 21:11:17 and merged 21:11:28 — eleven seconds, before CI finished.** Fifth
instance recorded in two days.

**Still masked, deliberately: the pytest line.** → **B6e-ci-unmask**, now against **14** known
failures rather than 55.

## 2026-09-01 — ✅ THE DIALYSIS SUITE RAN FOR THE FIRST TIME IN THE REPO'S HISTORY (PR #7389)

| | before (`73f1418`) | after (`fd724a5`) |
|---|---|---|
| collected | 3,110 / **5 errors** | **3,128 / 0 errors** |
| **tests executed** | **0** | **3,128** |
| step duration | 22 s | **6 m 12 s** |
| job conclusion | success (masked) | success (**still masked**) |

**Result: 3,065 passed · 55 failed · 7 skipped · 1 xfailed.** The first true measurement this repo
has ever had. ✅ **And the import check is now a genuine gate** — `import src, src.utils_shared,
src.ingest_fred_to_dialysis` is unmasked and **green once on a real runner**, which was the standard
B6e-ci-mask set. That is the check that would have caught FRED's `ModuleNotFoundError` during 25 days
of green badges over a dead producer.

⚠️ **BE PRECISE ABOUT THE STATE THIS LEAVES: MEASURED, NOT ENFORCED.** The pytest line is **still
masked**, so **55 real failures are now visible on `main` and still cannot fail a merge.** That is a
narrower but sharper hazard than before — previously nobody could mistake the badge for a gate;
now the job runs 3,128 real tests, reports red, and merges green.

⚠️ **Step 3 (fix or quarantine what is red) is UNFINISHED because the PR merged ~2 minutes after the
suite result first existed.** Fourth instance of merge-before-CI recorded in two days. **The result
was not ignored — it did not exist yet when the merge happened.**

⚠️ **A number I quoted repeatedly as fact was never stable: 3,042 → 3,110 → 3,128.** The 3,042 came
from a sandbox `--collect-only` with an incomplete local install; CI collected 3,110 before the fix
and 3,128 after. **Quote the run, not the figure** — and note the +18 is the newly-loadable files,
which is the fix working.

**The 55, with a finding inside them.** The largest cluster (~12) is **`openpyxl` leaking as a stub
across modules** — `module 'openpyxl' has no attribute 'load_workbook'`, `requires openpyxl; install
it` (**it is installed**), `'DummyWorksheet' does not support item assignment`, `isinstance() arg 2
must be a type`. **That is the same cross-module stub-pollution class CC had just fixed one module
over**, and the `conftest` mechanism added there handles exactly this shape. The rest look like
genuine logic failures (`test_financial_ground_truth` rate assertions, `test_cmbs_propagator`,
`test_clinic_history` dedupe) plus 2 known `test_handle_natural_language_query` drifts.

✅ **Positive control on the sweep — LCC is CLEAN, checked rather than assumed.** All seven workflows
carry `timeout-minutes`; `npm test` runs as a bare unmasked `run:`; the `exit 0` / `|| true`
instances are deliberate control flow inside a `set -euo pipefail` gating script. **The masking class
is Dialysis-specific, not fleet-wide** — which is worth stating, because "grep for the shape, not the
spelling" is only useful if the answer is allowed to come back clean.

**Two smaller items surfaced and filed:** Dialysis `ci.yml` has **no `timeout-minutes`**, so an
unbounded job inherits the **6-hour** default on every PR — now sizeable against a measured 6 m 12 s;
and `AGENTS.md:60` / `CLAUDE.md:60` still call `requirements_utf8.txt` canonical, **a stale line that
already produced a false P1 finding from Codex.**

**Recommended next: finish Step 3, then unmask pytest** — the openpyxl cluster plus `timeout-minutes`
in one change, then the unmask as its own. → **B6e-ci-openpyxl**, **B6e-ci-timeout**,
**B6e-ci-unmask**, **B6e-doc-reqs**.

## 2026-09-01 — ✅ PR1a/PR1b SHIPPED across three repos — and the CI finding underneath it is now the top open item

**Merged: Dialysis #7388, government-lease #396, life-command-center #2004.** Independently
re-verified live, both domains:

| column | before | after |
|---|---|---|
| `dia.properties.assessed_value` | 8,700 zeros / 262 positive | **0 zeros / 262 positive** |
| `dia.properties.tax_amount` | 9,025 zeros / 1 positive | **0 zeros / 1 positive** |
| `dia.properties.tax_delinquent` | `false` on 11,802 of 11,802 | **NULL on 11,802, 0 false, 0 true** |
| `dia.tax_records.is_delinquent` | — | **NULL on 25,621**, `raw_payload` intact |
| `gov.properties.tax_delinquent` | `false` on 20,495 | **NULL on 20,495** |
| `gov.properties.assessed_value` | — | **0 zeros / 370 positive** (untouched) |

**Every real value survived** — the 262 and the 1 and the 370 are exactly the non-model-traced rows,
which is the separation PR1a required be proven before writing. Both column defaults dropped;
reversal ledgers hold **55,148 + 20,495** rows. ⚠️ **The source tables were deliberately NOT
cleaned** — gov `parcel_records` still shows 9,264 zeros with `raw_payload` intact, which is correct:
that is the record of what the producer emitted, and it is the evidence.

⚠️ **Correction to a number I have been quoting: gov `properties` is 20,495 rows, not 13,837.** The
smaller figure was the non-archived count from C2e. Both are right about different questions; the
denominator for a whole-portfolio claim is 20,495.

⚠️ **THE PRODUCER IS UNVERIFIED — only the backfill is.** Newest `tax_records` / `parcel_records`
row is still **2026-08-31 18:33**; nothing has landed since, and the Python half ships on the next
deploy. **A one-shot backfill and a fixed producer are indistinguishable until the producer runs** —
the N15d lesson, and it is filed rather than assumed. → **PR1e**, with the exact four-count check.

### 🚨 The finding that outranks it: Dialysis CI runs ZERO tests and reports success

CC read the job log instead of trusting the badge — *because `CLAUDE.md` says that badge is
meaningless* — and found something worse than **B6e-ci-mask** as filed:

```
!!!!! Interrupted: 5 errors during collection !!!!!
======== 1 warning, 5 errors in 18.16s ========
Tests completed (some may have been skipped)     ← the || echo mask
→ job conclusion: success
```

**It is not "failures are hidden." pytest aborts at collection and not a single test executes** — on
this PR and on every `main` run sampled. So the 3,042-test figure in B6e-ci-mask is **tests
COLLECTED in a healthy local run, not tests CI has ever attempted.** Consequences: **CC's 31 + 34 new
mutation-verified guards have never run in CI**, and **one of the five files erroring is
`test_b6e_pipefail_workflow_guard.py` — the pipefail guard itself.** Five files fail on `flask` /
`geopy` environment issues; **none belongs to the changed modules**, so this is pre-existing, not
introduced.

**Correctly not fixed** — the repo's own doctrine forbids the obvious move. But it is no longer a
vague "the suite is masked": it now has a **concrete starting measurement — 5 collection errors,
named** — which is exactly what the *measure → fix or quarantine → unmask one line at a time*
sequence needed to become actionable. **This is my recommended next step.**

⚠️ **And #7388 merged at 18:04:07 with CI finishing 18:05:40** — merged before its own checks
reported, the third instance of that pattern recorded in two days.

📁 **Consolidation:** `B6d_pri_PUBLIC_RECORD_INGEST_REPAIR_2026-08-31.md` now carries a context
banner — it repaired the **throughput of a generator**, and its fixes stand, but it must not be read
as evidence the lane is healthy. **Fixing a producer's RELIABILITY says nothing about the VALIDITY of
what it produces.**

## 2026-09-01 — 🚨 PR1 REFUSED, CORRECTLY — the lane's producer GENERATES its values. And two repos merged a retracted claim as fact.

**PR1 asked for the reconciliation consumer. It was not built, and not building it is the right
call.** `src/public_record_ingest.py` — the producer of `parcel_records` / `tax_records` /
`deed_records` on **both** domains — **contains no county record fetch.** dia's one external call is
`chat.completions.create(model="gpt-4o")` on a prompt seeded with the property's own address *and the
owner we already hold* (the parsed result is literally named `gpt_parcel`); gov fetches a ≤4,000-char
snapshot of the assessor **portal homepage**, which cannot state a specific parcel's assessed value.
**Wiring that to `lcc_merge_field` would have promoted model output to `county_records`, which
outranks `salesforce`(20), `om_extraction`(30–50) and every sidebar(45–65) on 93 rungs.**

⚠️ **My PR1 prompt made this harder to catch, and that is worth recording.** It said *"no new
acquisition, no new schema, no new ladder entry"* as a **selling point**. That phrasing describes a
source whose producer nobody had re-graded — **"it needs no new acquisition" is the tell, not the
recommendation.** The lesson generalises to PR5's other 38 registered-but-unwritten sources: **read
what a producer's external call actually talks to before wiring it.**

### ⚠️ A statistic was published, refuted and corrected — and I verified the correction independently

The first cut claimed *"100.0% of gov's model-leg assessed values are exact multiples of $100,000
vs 3.8% on the CoStar leg — real assessed values are not round."* **It was counting zeros
(`0 % 100000 = 0`).** Measured live by me on gov `parcel_records`: **11,529 rows — 9,264 exactly
`0.00`, 1,848 NULL, 417 positive, and of those positives only 17 are round = 4.1%**, statistically
indistinguishable from the 3.8% control. **The metric was structurally unable to express the
question** — the P157 `reloptions` / P182 deparse trap, committed on the page that documents it.

**The corrected finding is different and worse: the model leg does not invent plausible numbers, it
emits almost nothing, as zeros** — and a `0` is a *positive assertion* that propagates into curated
columns and reads as measured, where a NULL would have been honest. Verified live on dia:

| curated column | zeros | positives |
|---|---:|---:|
| `dia.properties.assessed_value` | **8,700** | 262 (all CoStar-traced) |
| `dia.properties.tax_amount` | **9,025** | **1** |
| `dia.properties.tax_delinquent` | **`false` on 11,802 of 11,802** | — |

⚠️ **`tax_delinquent` is the sharpest of the three: `bool(None) is False` turned *"the source did not
say"* into *"this property is not tax-delinquent"*, on every property in the portfolio.** A negative
finding asserted at 100% coverage, never once measured, on a field that can reach a BOV.

**What the refusal actually rests on — none of it the retracted statistic:** the producer has no
county fetch (a fact about code); dia `tax_records` carries **186 rows with a literal `XYZ …`
placeholder owner** plus city-templated names (*"Santa Rosa Dialysis LLC"*); gov's 9,749 `owner_name`
values are the recorded owner we fed the prompt, echoed back (the ORE Phase A1 finding); and **0
Regrid-shaped payloads exist**, so the vendor path has never run.

### 👤 URGENT — two repos merged the PRE-CORRECTION version, and `main` cannot rebuild either DB

| repo | `main` | correction | branch |
|---|---|---|---|
| Dialysis | `8246ded` | ❌ not an ancestor (`5a6d511`) | ✅ pushed |
| government-lease | `86e9ba7` | ❌ not an ancestor (`70d6a07`) | ✅ pushed |
| life-command-center | not merged | — | ✅ pushed |

Two consequences, both verified:
1. **The refuted claim is committed as the rationale for a live database object**, and in Dialysis's
   `CLAUDE.md` — the durable reference file, where a wrong lesson does the most damage. A reader
   learns *the model fabricates plausible round numbers* instead of *it emits zeros*.
2. **Neither migration can be replayed.** I checked: live `v_gov_public_record_acquisition` column 6
   is **`assessed_value_zero`**; the committed file's column 6 is `with_owner_name`. `CREATE OR
   REPLACE VIEW` is append-only for columns, so a rebuild from `main` **errors 42P16** rather than
   silently downgrading — the better failure mode, but **the repo is not currently a replayable
   record of either database.** This is the §13 *"running but not merged"* hazard **inverted: the
   correction is running and not merged.**

⚠️ **Dialysis #7386 merged at 16:50:09 while its own checks finished 16:52 and 16:54** — merged ~2.5
minutes before CI reported. Green this time; **green-after-merge is not a gate**, and it is the exact
pattern LCC's `CLAUDE.md` already records ("merged 58 seconds after opening").

### 🚨 The trap that would have hidden a wiring in EITHER direction

`lcc_flush_provenance_events()` carries `v_first_class := ARRAY['splink_v1','sf_link_review_human',
'splink_v2','sf_account_contact_expansion']` and **relabels every event whose source is not on that
list to `domain_trigger`.** So a correct `county_records` wiring would have landed in
`field_provenance` as `domain_trigger`, at a rung that does not exist for these fields — **while the
verification I wrote into the PR1 prompt (`field_provenance where source='county_records'`) still
read ZERO.** My own success criterion could not have detected success. → **PR7**.

### What shipped instead — the marker, not the verdict

Producer provenance stamps on both domains (`raw_payload.source`; ⚠️ **excluded from `data_hash` on
dia**, or every row re-inserts as a duplicate — proven hash-stable with a positive control),
`{dia,gov}_public_record_acquisition_class()` as the single owner of "which path produced this row"
(with `ai_gpt4o_presumed` kept **distinct** from a forward stamp, so a measurement is never reported
as a stamp), `v_{dia,gov}_public_record_acquisition`, and `v_dia_curated_field_ai_provenance`.
Guards: 10/10 and 3/3 mutations RED, both stripping comments first.

## 2026-09-01 — 🚨 SCOTT'S CORRECTION: I scoped a SOURCE to one CONSUMER's gap list. The public-records lane is BUILT and has NEVER WRITTEN A FIELD

**My "don't build" verdict below was scoped to the 662-row metadata backfill queue and is WRONG as a
statement about public records as a source.** Scott: *"assessor data is valuable regardless of sale
status or previous ingestion… It should be its own lane that populates all properties in the
database that later code processes can evaluate against to find the most accurate representation of
each property by field."* **That is exactly right, it is the inversion `I1` exists to prevent, and I
committed it as the author of I1.** The correct denominator is every property — dia 11,802 + gov
13,837 — not 662. A sold property's assessor record is still ownership history, still a sale, still
physical stats.

🚨 **And measuring it properly found something much bigger: the lane he is describing already
exists, in full, and has never written one field.**

- `parcel_records` (apn, assessed_value, owner_name, zoning, **building_sf, lot_sf, year_built**,
  year_renovated, land_use, mailing_address, `raw_payload`, `data_hash`), `tax_records`,
  `deed_records`, **`property_public_records`** (the link + confidence layer), and
  `county_authority_cache` with **926 counties** carrying `assessor_url` / `gis_url`.
- ⚠️ Keyed on **APN + county + state**, not `property_id` — i.e. **already designed as an
  independent lane**, exactly as Scott specified.
- **`county_records` is registered at priority 5 across 93 field rungs on BOTH domains** —
  `year_built`, `building_size`, `land_area`, `lot_sf`, `zoning`, `assessed_value`,
  `recorded_owner_*`, `ownership_history.*`, `sales_transactions.*` — outranking `om_extraction`
  (30–50) and `costar_sidebar` (45–60).
- **`property_public_records` links 9,166 of 11,802 dia properties (78%)**; `tax_records` holds
  25,621 rows; the producer **ran 2026-08-31**.
- 🚨 **`county_records` has ZERO `field_provenance` rows. Ever.** Positive-controlled in the same
  query: `recorded_deed` has 2,681 / 371 writes. No variant spelling across 49 sources.
- **The clinching detail: `dia.properties.year_built` has 3,586 provenance rows and the only source
  is `salesforce`@20** — while the @5 county source sits unread in the same database holding the
  answer.

**Class 2 on the most extensively registered source in the system, and invisible to every check we
run** — tables non-empty and growing, producer green, ladder registered, field filling from
somewhere worse. → **PR1** (build the reconciliation consumer; no new acquisition, no new schema, no
new ladder entry, immediate reach **9,166 properties**), **PR2** (why does one live producer return
tax rows for 9,107 properties and parcel stats for **41**? — the tax fetcher reaches 77%, so this is
a fetcher question, not an acquisition one), **PR3** (`confidence` is the constant 1.000 on all
23,728 rows and `verified` is false on every one), **PR4** (the `mortgage` and `entity` legs are dead
since 2026-05-10, hidden because the lane's other legs kept writing).

🚨 **Generalising the detector across the whole ladder: 39 of 67 registered sources (58%) have never
written a field.** `costar_cmbs_loan` **121 rungs**, `county_records` 93, `lease_document` **25 at
priority 10**, `opencorporates`/`mi_lara` 16 each. ⚠️ **The reverse arm was run and is benign** — all
21 write-but-unranked sources are one-shot `cleanup_run_*` tags from the May remediation; a
one-directional result would have invited a wrong drift conclusion. ⚠️ **And `manual`@1 reading 0
rows is NOT a protection gap** — `manual_edit` (207 rungs @1, 841 rows) and `manual_resolution` (203
@1) carry it; checked rather than claimed. → **PR5**, playbook **Class 31**.

📁 **New canonical page: `docs/architecture/public-records-source-lane.md`.**
`property-metadata-coverage.md` keeps a supersession banner rather than being rewritten — its
fabrication finding, I12 and Ollama measurement all stand; only its verdict and its 662-denominators
do not.

## 2026-09-01 — ✅ FRED IS ALIVE (verified on the delta), and the metadata build-out is measured: DON'T BUILD IT ⚠️ *(verdict superseded — see the entry above)*
## 2026-09-01 — DOC8 / DOC9 / DOC10: the expensive OCR tier was FAILING, and its fragments read as covered leases

**PR #1995 — open, not merged. `docai-ocr` v23 IS deployed to LCC Opps (15:50 UTC) and the DOC10
backfill IS applied (15:51 UTC); the JS half ships on the Railway redeploy of the merge.**

**The measurement first.** Across every OCR row the CRE lane has ever produced: **gpt-4o 19 rows,
avg 1,579 chars, 12 under 500, minimum 31; DocAI 6 rows, avg 9,055, none under 500.** The
**expensive** tier returned ~9× LESS text, on 86% of the OCR events. Cause read from the edge log,
not guessed: `PAGE_LIMIT_EXCEEDED — "15 got 19"`, DocAI's synchronous page cap, **not** the
documented Custom-Extractor footgun.

- **DOC8** — `docai-ocr` sets `imagelessMode`, cap **15 → 30**. ⚠️ **Verified against the live v1
  discovery document, not taken from the prompt: it is a TOP-LEVEL `ProcessRequest` boolean, NOT
  `processOptions.ocrConfig`** — nesting it there is a silent no-op that leaves the cap at 15. A
  processor that rejects the field retries once without it, so the deploy cannot break the ≤15-page
  path that already works. **Above 30 the CRE worker now stops with a named, dated
  `over_docai_page_cap` marker from a pdf-parse pre-flight and spends nothing** — the gpt-4o tier is
  NOT removed, it is just no longer reached silently on the one class it is measured to fail. The
  pre-flight is opt-in (`ocrPageCap`, default null), so **cron 160 and the deed lane are
  byte-identical**.
- **DOC9** — the spend counter accumulated only when `ocr_pages > 0`, and gpt-4o reports no pages, so
  the tick read `ocr_by_engine: {}` **while spending gpt-4o money**. Engine now counted
  unconditionally, pages only when known, unknown counted as `ocr_pages_unknown` and **never 0**.
  ⚠️ **`ocr_by_engine` is REMOVED rather than redefined** — it counted PAGES, so reusing the name for
  a document count changes its meaning silently. The same blindness is still live in
  `document-text.js` (the deed lane, deliberately untouched) and `lease-backfill.js`.
- **DOC10** — a **31-character fragment satisfied both consumers** (`needs_ocr=is.false ∧ raw_text≠
  null`; `NOT needs_ocr`) so BOV extract received it as the lease and it could never be retried.
  `reason='thin_ocr_result'` was already set and **nothing read it**. Page-aware floor now
  (`max(120, pages×200)`; **500** when pages are unknown — a 500 that sits inside a 3.9× gap the data
  actually has). **Backfill: 12 rows / 9 properties, re-run marks 0, reversal RUN not asserted (12 of
  12 restored byte-identically in a rolled-back round trip).**

**⚠️ `v_lcc_cre_bov_ready` 7 → 4, and that is the fix working.** Those three properties were never
covered — they were "covered" by 31–200-char fragments. Consumer-visible sidecars 77 → 65; OCR rows
reading covered 25 → 13; `v_lcc_cre_thin_ocr_watch` still-covered 12 → **0**. gov deeds unchanged at
**325/325**, cron 160's command unchanged, crons 167/169 still active.

✅ **THE EDGE HALF IS CONFIRMED ON BEHAVIOUR, 16:00:35 UTC.** The first post-deploy OCR event (cron
167, document 24, `ACMP EXEC Lease 10.9.14.pdf`) logged
`Document AI 400 (…, imageless=true): "Document pages exceed the limit: 30 got 40"`,
`metadata { page_limit: "30", pages: "40" }`. **The limit Google reports is now 30, not 15**, and the
phrase *"in non-imageless mode"* is gone — the field was accepted and the fallback did not fire.
(The sandbox cannot reach `*.supabase.co` — proxy 403 — so the edge log IS the probe.)

⚠️ **And that same line is the FIRST 31+-page observation this lane has ever had: 40 pages.** It fell
through to gpt-4o for **211 chars**, because the caller-side pre-flight is JS and unmerged. Both
halves of the fix are correct and neither was deployed for that document. Page evidence to date is
**8 observations, 1 over 30** — a reason to expect more, not a rate.

⚠️ **The wording of that error has already changed once**, so `pageLimitFromError` now reads
`details[].metadata` first and keeps the prose regex as a fallback (**v24**). Two mutants survived
the first test of it, because the live body's `message` repeats the same numbers as its metadata —
fixed by adding the discriminating case (a re-worded message with intact metadata), not by accepting
them. ⚠️ **v24 is deployed and UNEXERCISED** — the behavioural confirmation above is v23's, and no
DocAI call has been made since v24 landed. Deployed is not exercised.

**⚠️ STILL NOT MEASURABLE, and stated rather than guessed:** (a) **`cloud_cheap` overtaking `cloud`**
— the only post-deploy OCR event so far was that 40-page document, which is over the cap either way,
so the tier split needs the next few ticks; (b) **a re-read of the 12 thin documents** —
re-admission needs `thin_ocr_result` in `CRE_RETRY_REASONS`, which is JS and unmerged; (c) **how much
of the backlog is 31+ pages.** The `over_page_cap` counter, `page_count` on every marker, and
`v_lcc_cre_thin_ocr_watch` are what will answer all three.

**Next:** merge → Railway redeploy → read `ocr_docs_by_engine` on the first ticks (`cloud_cheap` must
overtake `cloud`), then read three named re-extracted documents at their MIDPOINT — a tier change is
not evidence the text is usable. Full state: `docs/architecture/document-capture-ocr-and-deeds.md`
§0d.
## 2026-09-01 — ✅ FRED IS ALIVE (verified on the delta), and the metadata build-out is measured: DON'T BUILD IT

### FRED — the fix is PROVEN

Scott dispatched `fred-ingest-daily`. Verified on the state delta, not the green check:
**`max(created_at)` 2026-09-01 15:31:40** (past the 2026-08-07 19:59:41 hand-run) and
**`max(observation_date)` 2026-08-28** (past 2026-08-06). Rows 8,316 → **8,336**. The 25-day gap on
the two high-frequency series is **closed**: `DGS10` +17 (2026-08-06 → 08-28), `MORTGAGE30US` +3
(08-13 → 08-27). **After 25 days green-and-dead, this producer has now written its first rows ever
from CI.**

⚠️ **One residual, and it is a real one.** The three monthly series took **0 rows**: `FEDFUNDS` and
`UNRATE` still end 2026-07-01, which is *correct* (August prints ~Sept 2–4, not yet published), but
**`CPIAUCSL` ends 2026-06-01 and July CPI published ~2026-08-12** — inside the dead window and
retrievable now. The likely mechanism, inferred from the fetch boundaries rather than read in code:
**a lookback keyed on `observation_date` cannot reach a monthly series whose observation date is
older than the window even though its value was published inside it** (`DGS10`'s new rows start
2026-08-06, consistent with a ~30-day observation-date window; 2026-07-01 falls outside it). Filed
**B6e-fred-monthly**.

Two run annotations, both filed and neither blocking: **`/usr/bin/git` exit 128** (a warning on a
green run — ⚠️ *an unexplained non-zero in a workflow we just fixed for exactly this class* →
**B6e-fred-git128**), and **Node 20 deprecation** on `checkout@v4` / `setup-python@v5` /
`upload-artifact@v4` — the same shape as the LCC Node-version lockout already in `CLAUDE.md` →
**B6e-node24**.

### The metadata build-out — measured against all three options, and the answer is don't

Scott asked whether **local Ollama**, the **LCC sidebar Chrome extension**, or a combination
maximises leverage on the ~646 remaining gaps. **All three were measured against the actual
population before designing anything, and all three fail on reach:**

| option | reach on the 662 | |
|---|---:|---|
| Ollama over our own documents | **9** with usable text (23 with any doc) — **1.4%** | ❌ no corpus; P131 case (b) is empty |
| Sidebar, in the flow | **6** `status='active'` | ❌ no natural encounters |
| Sidebar, deliberate lookup | 662 searches, **1 listing URL** | ❌ 617 are **sold**, 86 superseded |

⚠️ **I nearly reported "554 are on-market listings — send Scott to CoStar."** They are rows in
`available_listings`, but **211 are `data_source='synthetic_from_sale'`** (synthesized from a sale,
never marketed) and by `status` only **6** are active. *Check what a population IS before routing
work to it.*

⚠️ **And the extension is not the problem — it already extracts all three fields**
(`costar.js`: `year_built`, `square_footage`, and a `lot_size` branch handling **both** "Land Acres"
and "Land SF"). **The 393 `land_area` gaps have NEITHER column populated** — these properties were
never captured at all. **Absence of capture, not a mapping loss**, so a mapping fix buys nothing
here. Found while checking: `sidebar-pipeline.js` ~4597 sets `land_area` only on `/AC/i`, a latent
I12 minter — **measured, 0 such rows exist fleet-wide**, so it is a hazard to guard, not the cause.

**Recommendation: no build on this 662.** Stale sold comps, no documents, no live surface, no key —
a documented ceiling is worth more. The concrete cost is narrow and now stated: **82 properties have
a sale price and no building size, so they cannot produce a $/SF comp.** If a book needs those, that
is a targeted value-ranked ask (82 lookups with a named purpose), not draining a 662-row queue.
The two things carrying real leverage are **forward**: capture-at-ingest, and closing the I12
asymmetry so no future capture mints another unclosable row. → **B6d-assessor-capture**.

📁 **Consolidated into one canonical page: `docs/architecture/property-metadata-coverage.md`** — the
gap, the queue's structure, why the lane was retired, I12, the three refuted sources, and what is
actually worth doing. Future sessions start there rather than re-deriving it.

## 2026-09-01 — B6d-assessor-marker: the marker was built, and what it exposed is worse than a dead lane

**VERDICT: RETIRE.** PR **sbriggssjc/Dialysis#7385** merged (`422ef419`). The marker shipped
(`src/assessor_queue_marker.py`, four outcome paths, `skip:` / `source:` / `error:` prefixes, 30-day
cooldown + `last_attempt_at ASC NULLS FIRST`), and the two-run test is proven: **selection overlap
25/25 → 0/25**. But building it surfaced three things that outrank the task, and I verified the
DB-side claims live before recording them.

🚨 **1 — THERE IS NO COUNTY ASSESSOR ADAPTER. THE ONE EXTERNAL CALL ASKS gpt-4o TO RECALL PARCEL
FACTS.** Zero HTTP calls to any county in the module. A model cannot know a given parcel's year built
or lot size — it can only produce a plausible number, which this would have written into `properties`
as a fact. **`enriched: 0` is what saved us, not a guard.** ⚠️ **The gov repo already rejected
LLM-recall enrichment on exactly these grounds (ORE Phase A1) and nobody checked the dia side.**
Doctrine added to `CLAUDE.md`: *read what a producer's external call actually talks to before trusting
its name* — `*_enrichment` names an intent, not a source.

🚨 **2 — THE LARGEST BLOCKER IS A UNIT MISMATCH, NOT A COVERAGE GAP — verified live.** The closure
trigger watches **`land_area` (acres)**; the writer fills **`lot_sf` (square feet)**. Across all
**3,702** rows holding both: **0 equal**, and the ratio is **exactly 43,560 ±1 on 3,373 (91.1%)**,
within 1% on 98.1%, with 27 genuine disagreements (0.8%). One fact, two units, no reconciliation. So
**223 of 662 open rows (34%) carry only gaps this writer can never close** — the writer succeeds and
the gap persists, silently, on both sides. Filed as data-coherence invariant **I12**.

⚠️ **3 — AND THE "OTHER PATHS WILL HANDLE IT" FALLBACK IS REFUTED.** The 51% self-resolution I quoted
last turn hides a collapsed rate: **May 14 → June 174 → July 510 → August 5 → September 0.** July was
a burst, not a run rate. Quoting the cumulative share was the mistake; the monthly series is the fact.

Also measured here: **500 of 662 open rows (75.6%) have no parcel number** — the key the module's own
docstring says it depends on. Closable at all: **236 of 662 (36%)**, and that is the ceiling *at
perfect accuracy*. **A lane that is keyless, fabricating, and capped at 36% cannot be graded into
working.** No cron. The queue also still has no enqueuer.

⚠️ **I CORRECTED ONE CLAIM.** The response calls `land_area = lot_sf / 43560` *"the single high-value
fix… closable 236 → 439."* The closability arithmetic is right; **the value framing is not — it fills
ZERO rows today.** Measured: **0** `properties` rows have `land_area IS NULL AND lot_sf IS NOT NULL`.
It changes what a *future* source could close, which is plumbing, not yield — and with the lane
retired there is no such source queued. Re-filed at 🟡 as **B6d-assessor-landarea** with that
correction attached.

**Guard methodology worth keeping** (from the response, unverified but sound): a mutation scoped to a
FILE rather than the function it names **graded the wrong code** — `+= fields` appears twice and the
mutation landed in `run_batch`, not `run_queue_batch`, falsely reporting a survivor. Mutations are AST
-scoped now. And two genuine survivors came from **monkeypatching the function under test**. 28 tests,
23/23 mutations RED; full suite 2,980 → 3,008 passing with an identical 54-failure set before and
after. The `|| echo` masking was not touched (**B6e-ci-mask**) and CI was not relied on.

⚠️ **Dangling pointer, open:** the merged Dialysis `CLAUDE.md` references
`docs/audits/B6d_assessor_marker_ASSESSOR_DRAIN_TRACE_2026-09-01.md` in *this* repo, pushed to
`claude/assessor-marker-trace-2ospul` with **no PR**. → **B6d-assessor-doc**.

## 2026-09-01 — assessor enrichment: ran it once, and the answer is DO NOT WIRE IT

**`python -m src.assessor_enrichment --from-queue 25` → `processed 25, enriched 0, fields_updated 0,
errors 0, elapsed 114.8s`.** ~4.6 s per property of real elapsed work for **zero yield** — and,
decisively, **zero trace**. This is a *don't build* answer, and running it once before scheduling it
is the only reason we have it.

🚨 **`errors: 0` with `enriched: 0` is a worker reporting clean success while doing nothing** — the
failure mode this whole arc is about. Had the schedule been wired first, it would have run weekly
forever, reported no errors every time, and nobody would have known it produces nothing. Verified
live against the state delta, not the tally:

| probe | result |
|---|---|
| `attempts > 0` | **0 of 1,365 rows** |
| `last_attempt_at` / `last_error` set | **0 / 0** — the columns exist and *nothing has ever written them* |
| queue gaps after the run | `land_area` 409 · `year_built` 404 · `building_size` 108 · `tenant` 95 — **unchanged** |
| `properties` rows written by the run | **0** (the 6 in the window are a 12:00:0x top-of-hour burst, 5 of 6 not queue members) |

⚠️ **It cannot page past what it cannot mark — Dead-End Class 12, in its purest form.** P136's
reachability harvest at least wrote proposals when it succeeded; this worker writes **nothing on
either outcome**, so `--from-queue 25` re-selects **the same 25 rows on every future run**, spends
the same 115 seconds, and returns the same clean zero. A schedule would have made that permanent.

⚠️ **And the queue behind it is a one-shot — Class 8.** `max(enqueued_at)` is **2026-05-21**, 103
days ago; 703 `captured` / 662 `open` and nothing has enqueued since. **Even a working worker would
drain a frozen 662-row set and then run forever on empty.** Two defect classes stacked, plus the
silent-success reporting: three, in one unscheduled job.

**The gating question is unanswerable as built, and that is the finding.** 4.6 s/property is real
network time, so it is *reaching* something — but with `last_error` never written we cannot
distinguish *the assessor has nothing for these parcels* (a genuine ceiling; retire the lane) from
*every call is failing* (a fixable adapter). **The prerequisite is not a cron, it is a marker**:
record the attempt and the reason on every row, both outcomes, then re-run 25 and read the reasons.
Backlog **B6d-assessor-marker** (prerequisite) → **B6d-assessor-verdict** (retire or fix, decided on
the reasons) → **B6d-assessor-producer** (the queue has no producer; only relevant if the other two
come out positive). **No schedule until all three resolve.**

## 2026-09-01 — B6e-fred: the sweep was the finding; the FRED fix was already merged and still has not run

**`fred_ingest` has NEVER written a row** — not "dead for 25 days". `economic_indicators` has exactly
ONE write event in its life (2026-08-07 19:59, 86 rows) and it landed **after** both of that day's
workflow runs finished (19:47, 19:55): a hand-run. The workflow was added that day to fix a silent
stall and has been silently stalled from its first green run.

**The fix was already merged before this session** (`e0ec3fc`, PR #7383, 12:53 UTC) — deps + `set -o
pipefail` + fail-on-stale. **It has still never executed**: today's scheduled run fired ~11:30 UTC,
before the merge. *Merged is not running.* Next scheduled run 2026-09-02 11:30 UTC.

🚨 **The sweep outranked the FRED fix, as the brief predicted.** 2 of 3 piped producer steps were
broken. **`public-record-ingest-daily.yml` had `bash …sh 2>&1 | tee` with no pipefail** — and the
script sets `set -euo pipefail` internally and exits non-zero correctly, so **B6d-pri's brand-new
`EXIT_DRAIN_FAILED = 3` was being discarded one layer up by that pipe.** Fixed.
⚠️ **A guard for this exact defect already existed and was scoped to the ONE file the previous audit
was looking at** (`test_fred_workflow_sets_pipefail_before_piping_to_tee`), and used a file-wide
`find()` rather than a step anchor. **A guard written for an instance does not cover the class.**
Replaced with `tests/test_b6e_pipefail_workflow_guard.py` — class-wide, step-anchored, 10 tests,
**7/7 mutations RED**, with its own positive control.

🚨 **The operator exposure is a WRONG NUMBER, not a gap.** `economic_indicators` feeds only
`cm_dialysis_macro_rates_m/_q` — both CM book exhibits. The views do **not** go blank: the monthly
view still emits `2026-08-31` and the quarterly `2026-09-30`. Behind that "August" point:
**DGS10 = 3 observations (Aug 3–5), MORTGAGE30US = 1 (Aug 6), and FEDFUNDS/UNRATE/CPIAUCSL = 0.**
A complete-looking monthly average of the 10-year Treasury from three business days.
👤 **Whether a book went out after 2026-08-07 is an operator check; if so it is a correction, not
just a pipeline fix.** Nothing was regenerated.

⚠️ **BLOCKER — the live re-run is operator-gated and the gap is NOT backfilled.** `workflow_dispatch`
returned **403 (no Actions write scope)**; running it directly is impossible here (no `FRED_API_KEY`,
no service key, and `api.stlouisfed.org` is `connect_rejected` by the proxy). The fix remains
**unproven** until `max(economic_indicators.created_at)` advances past 2026-08-07.
⚠️ **If the dependency fix is wrong the workflow will now go RED — that is success. Do not revert the
pipefail to restore green.**

🚨 **The sweep's SECOND pass found the bigger one: Dialysis `ci.yml` cannot fail on its own subject
matter.** `| tee` is one masking idiom; **`|| echo` is another, used 5× in `ci.yml`** —
`pytest tests/ … 2>/dev/null || echo "Tests completed…"` swallows the exit code, so **3,042 collected
tests can never fail CI.** Every guard in `tests/` is a regression detector no merge gate enforces —
the LCC repo's own *"no workflow runs `npm test` on a PR"* finding, in a different disguise. ⚠️ **The
cruellest instance is `python -c "import src.main" 2>/dev/null || echo`: exactly the check that would
have caught FRED's `ModuleNotFoundError`.** **NOT flipped** — gating a never-enforced suite whose
greenness is unmeasured is the documented *"never green once on main"* trap. Backlog **B6e-ci-mask**.
Also added `PyYAML>=6.0.1` to `requirements.txt`: the new guard parses workflow YAML, and a guard that
cannot import is a guard that does not run.

Also: `INFRASTRUCTURE.md`'s job map gains `fred-ingest-daily.yml` (a scheduled producer nobody had
written down) and `metadata-backfill-queue.sh`; `dia_producer_registry.notes` for `fred_ingest`
rewritten to say *merged, not yet executed*. Writeup:
`docs/audits/B6e_fred_GREEN_CI_DEAD_PRODUCER_2026-09-01.md`.

## 2026-09-01 — B6d-cms-escalation: dia's producer-health surface, and a workflow that was green 16 times over nothing

**Shipped:** `dia_producer_registry` + `v_dia_producer_health` on Dialysis_DB
(`20260901120000`, applied live) — the dia half of gov's `v_pipeline_task_health`. Before it, dia
ran **five scheduled ingestion producers and had zero producer-health objects**; the only
instrument was a 45-day freshness bound on a downstream table. Writeup:
[`docs/audits/B6d_cms_escalation_DIA_PRODUCER_HEALTH_2026-09-01.md`](../audits/B6d_cms_escalation_DIA_PRODUCER_HEALTH_2026-09-01.md).

**The enumeration was the finding, and it outranks the view.**
`.github/workflows/fred-ingest-daily.yml` has reported `conclusion: success` on **16 consecutive
scheduled runs since 2026-08-10 while writing ZERO rows** — and it has **never** written a row in
its 20-run life, despite being added on 2026-08-07 *to fix a silent FRED stall*. Root cause:
`ModuleNotFoundError: No module named 'postgrest'` at import (the workflow installs only
`requests python-dotenv`; both `postgrest` and `supabase` are pinned in `requirements.txt`),
**masked by `cmd | tee` without `pipefail`** — measured directly as `exit 0` vs `exit 1`. That
masking also defeated the script's own `sys.exit(1 if nothing written)` guard, which never ran.
The 2026-08-07 "recovery" was a hand-run at 19:59, after both workflow runs finished (19:47,
19:55). Three surfaces each held half the truth — GH Actions said success, the watchdog held an
`lcc_health_alerts` row open 16 days, the workflow printed `{"status":"stale"}` in its own log
every green run — **and nothing joined them.** Workflow fixed: deps + `set -o pipefail` +
fail-on-stale.

**Four of five dia producers write no run ledger at all** (verified by reading
`public_record_ingest.py`, `assessor_enrichment.py`, `ingest_fred_to_dialysis.py`,
`sf_object_sync.py` — zero `ingestion_tracker`/`run_log` writes). They read **`no_run_ledger`**
with a CHECK-enforced `blindness_reason`: the blindness is stated, never hidden behind a proxy.
⚠️ **Enumerating from `ingestion_tracker` would have rebuilt that blindness** — its five distinct
`source` values are the real producer plus the janitor, the watermark writer, a one-shot and a dead
lane.

**Two readings that exist only because columns were kept separate:** `cms_ingestion` reads
`last_success_at` **2026-04-04** against `last_rows_written_at` **2026-08-31** (no clean `success`
since April, yet moving rows via `partial` runs); and its observed **p90 gap of 30.44 days against
a declared 1-day cron** is the removed 30-day throttle still legible in the run history.

**Verification:** positive control on three arms (`overdue` / `never_ran`, plus a **negative
control on the same rows** reading `ok`), 0 residue. Guards
`tests/test_b6d_cms_escalation_producer_health.py` — 14 tests, **14/14 mutations RED**. Two guard
defects were caught by the mutation pass itself: a file-wide `exit 1` grep passed its own mutation
(the token appears twice — re-anchored on the step), and comment-stripping proved load-bearing.

⚠️ **No alert shipped, deliberately** — 50 zero-duration watermark rows still wear
`run_status='success'`, so alerting on it would manufacture false all-clears. Follow-ups filed:
**B6d-cms-escalation-emit** (make the four blind producers emit — the fix that turns this from a
blindness report into monitoring), **-alert**, **-metadata** (is `metadata-backfill-queue` actually
wired in Railway?), **-infradoc** (`INFRASTRUCTURE.md` is dated 2026-05-16 and its job map is
missing `fred-ingest-daily` entirely).

## 2026-08-31 — B6d-cms-step second pass: the latch had two more doors, and one was open in the live watermark

**Reconciled first.** The first pass shipped in a parallel window (`68da552`, PR #7381) and is on
`main`; nothing was re-done. Re-measuring afterwards found three more instances of the same shape —
*a slot that exists to carry meaning, written with something else* — and **corrected two claims the
first pass made.**

- 🔴 **The "success on a no-op" defect is REAL; the first pass dismissed it on a true fact.** It
  split `ingestion_tracker` by `source`, correctly established that `cms_ingestion` has never
  reported success, and concluded the defect does not exist. But `get_last_ingestion_meta()` filters
  on `dataset_id` + `run_status` and **not on `source`** — so the `source='CMS'` rows ARE this
  pipeline's watermark, and the live one is a **zero-duration** row (`finished_at = started_at`),
  `rows_upserted` NULL, every count 0. **Split by the key the CONSUMER uses, not the one that best
  explains the population.** Fixed: the stamp carries `WATERMARK_RUN_STATUS='watermark'` instead of
  wearing `success` (still in `INGESTED_RUN_STATUSES`, so the gate arms exactly as before).
- 🔴 **B6d-pri's own code comment is false in effect.** It says the `recorded` skip row *"can never
  re-arm the change-detection watermark"*. That row is correctly excluded — and the **same
  invocation** wrote a `CMS`/`success` row 0.4 s earlier carrying the **identical**
  `dataset_modified_date`, which is not. **An exclusion is only as strong as the set of rows that
  can carry the same fact.**
- 🔴 **The reason latched on a channel the fix did not cover — 470 rows.** The first fix recovers
  from `payload`; these producers pass the reason as an **argument** (`clinic_removed`,
  `status_unknown`), and `update_data.get("reason") or reason` let a placeholder outrank it.
  `_first_real` is hoisted to module scope (`_pu_first_real`) and both channels resolve through it —
  one implementation, one vocabulary.
- ✅ **`error_summary` has its first writer.** Both janitors wrote `error_log`, overwriting the
  process's own diagnostic — which is why 16 of 18 populated values were janitor artifacts rather
  than tracebacks. The janitor is an **outside observer**; it writes `error_summary` now.
- ✅ **The queue is legible for the first time.** `address_change` 2,148 → **5,102**;
  `unknown_reason` 3,424 → **0**; `table_name='unknown'` 470 → **0**. Predicted 2,954 repairable /
  470 not and got **exactly that**. The 470 are **marked, not repaired** —
  `producer_supplied_no_reason` is a provenance statement, not a reason, worded so it cannot later
  be mistaken for recovered content. ⚠️ `field_name` stays `__record__` deliberately: it is a live
  **sentinel** elsewhere, so *recoverable* and *safe to rewrite* are different questions
  (**B6d-cms-step-field**).
- ✅ **Zero regressions, established by a full-suite before/after baseline diff** — identical failure
  set (53 pre-existing, all environmental). Guard `tests/test_b6d_cms_step_error_channel.py`,
  **11/11 mutations RED**, asserting on the **AST**: the fixes' comments quote `error_log`,
  `"success"` and the old `or` expression while explaining them, and comments are absent from the
  AST by construction — removing the stripper-bug class rather than working around it.
- ⚠️ **Three prior-window guards went red and were established STALE, not breached, before being
  touched.** Each pinned a literal (`INGESTED_RUN_STATUSES == ("success",)`, `sink[0]["error_log"]`)
  while its stated intent survives; rewritten to assert the intent, and the reclaim guard was
  *strengthened* to assert `error_log` is not written.
- ⚠️ **Still no exception text, and that is the honest deliverable.** The 18:30 run reproduces the
  shape exactly: heartbeat at 18:38:14.99 on `current_step: medicare_ingestion`, declared failed at
  18:38:16.10 by a **`(force)`** reclaim — alive 1.1 s earlier. It was **killed**, then
  force-reclaimed by a second invocation. `ingestion_tracker` structurally cannot carry an OOM;
  **Railway deploy logs remain the next step.**
- 🔴 **The outage broke open further during the work**: `max(medicare_clinics.source_last_seen)`
  **2026-06-25 → 2026-08-31**. ⚠️ **Still climbing while this was written — 61 → 84 → 163 of 8,547
  across three measurements in one session, so quote it with its timestamp or not at all.** Even at
  163 that is **1.9%**: the pipeline can write again; the feed is not healthy. The last clinic write is an hour *after* the last `ingestion_tracker`
  row, so that work carries **no run record at all**.
- ⚠️ **New, unproven, filed not asserted:** `dataset_modified_date` looks **clock-derived** (one
  second after the preceding reclaim; the patient-counts skip row carries the identical stamp for a
  different dataset; CMS's own `last_modified` is captured on 3 of 193 rows, newest 2026-03-24).
  That would be the same latch through a third door — **B6d-cms-step-watermark-clock**.

## 2026-08-31 — B6d-cms-step + B6d-pri-reason: the error channel works; the audit read a decoy column

**The premise was refuted, and the correction is the deliverable.** `ingestion_tracker` has **two**
error columns. **`error_summary` has ZERO writers repo-wide** (no migration; the only hits store a
value in a `notes`/`details` dict under that *key*) — so 47/47 NULL is correct and expected — while
**`error_log` is populated on 18 of 18 `cms_ingestion` failures.** The capture the row asked to be
built **already exists**: `traceback.format_exc()` on the exception path, a SIGTERM handler, and the
step heartbeat, **all writing `error_log`**. They did not fire because every row was still `started`
at reclaim time: **the process is hard-KILLED, so there is no exception to capture.** Every populated
`error_log` is a **janitor artifact** that overwrote the diagnostic slot — the newest reads
`(force)` with a heartbeat **2 s before** it was declared failed and a new lock row **0.4 s after**,
i.e. the documented `FORCE_RUN=true` self-sabotage, recorded in the DB and read as a crash.

Three further corrections: the two `started`+NULL rows are **`ingestion_lock`** rows, not pipeline
runs (the lump-the-lock footgun); **none of the "6 success runs" is `cms_ingestion`** — that pipeline
has *never* reported success in the window, so §2's "success on a no-op" defect does not exist; and
**every "failed" run is a PAIR of rows 27–61 ms apart**, so the failure count itself is inflated by
the instrumentation.

**Shipped — B6d-pri-reason.** 437 → **2,148 rows** (growing ~78/min), and **the reason was never
missing**: every row carried `payload.fields.reason='address_change'` / `medicare_clinics` /
`address`, **100% recoverable**. `sanitize_pending_update` runs **twice**; pass 1 stamps its own
`unknown_reason`, and pass 2's `if not p.get("reason")` sees a non-empty string and **refuses to
correct it** — *a value the function invented blocked the real one it could now see*. Reproduced
byte-identically via the stored `file_name='auto:medicare_clinics:unknown_reason:noid'`. Fixed
(placeholders are treated as ABSENT; one owner for the vocabulary; nothing fabricated) **+ 2,148 rows
backfilled reversibly** (`20260831190000`). Guard: 9 tests, **7/7 mutations RED**. ⚠️ Two guard
defects were found in this session's own tests — a stripper that deleted the declaration it asserted
on, and a source assertion whose pattern contained a literal and so **passed its own mutation**.

🔴 **The live finding that outranks both rows (`B6d-cms-divert`):** a process wrote those 2,148 rows
**with no `ingestion_tracker` row at all** while `max(medicare_clinics.source_last_seen)` stayed
**2026-06-25** and `refreshed_today = 0`. **It reads CMS, queues a change per clinic, and never
writes the clinic.** New rows: `B6d-cms-divert`, `B6d-pri-address-noise`, `B6d-cms-doublerow`,
`B6d-cms-orphan-scope`.

⚠️ **`source_last_seen` did not move and was not expected to.** ⚠️ The full suite cannot run in this
sandbox (`flask` absent, pre-existing) — 35 tests green on the affected surface; **not a clean-suite
claim.** Writeup: [`docs/audits/B6d_cms_step_ERROR_CHANNEL_2026-08-31.md`](../audits/B6d_cms_step_ERROR_CHANNEL_2026-08-31.md).

## 2026-08-31 — B6d-pri: four defects, ~1,950 failures a day, exit code 0

**Repo: Dialysis.** Writeup `docs/audits/B6d_pri_PUBLIC_RECORD_INGEST_REPAIR_2026-08-31.md`;
backlog **B6d-pri** ✅, **B6d-cms-restart** re-scoped, **B6d-pri-metrics** filed.

- 🎯 **The biggest item was settled by the FIRST check, and it is a deploy gap.** The 2026-08-31
  log emits `"CMS ingestion recently run (3 days ago < 30); skipping."` — a format string
  `fc342b3` **deleted on 2026-08-29** and present nowhere in `main`. Arithmetic corroborates to
  the day (pre-fix watermark → the **abandoned** 08-27 row → 3.99d → `.days` = 3). **So no second
  throttle fix was written**: keying on last SUCCESS is already `INGESTED_RUN_STATUSES =
  ("success",)`. *Merged is not running*, fourth time in this arc.
- **It also explains B6d-cms-restart's "no attempt on 08-28/29/30":** the pre-fix throttle
  **returns before writing any tracker row**, so a skip and a cron that never fired are the same
  absence. Fixed — a skip now emits with a reason (B6a's rule inside the ingester), under
  `status='recorded'`, which is deliberately not in `INGESTED_RUN_STATUSES` so it cannot re-arm
  the watermark. **Why the earlier runs were KILLED is still open and still needs Railway logs.**
- **`reason` was dropped from a SELECT and written back** → 23502 on every stale row
  (`pending_updates.reason` is NOT NULL; live 1,959 rows / 0 nulls / 1,952 past the 7d threshold).
- ⚠️ **THE MISSING DSN WAS A SYMPTOM MASKING THE REAL ERROR.** A bare `except: pass` swallowed the
  23502 and let the fallback's *"DSN not configured"* be the only visible message. **Setting the
  DSN would have fixed nothing** — the fallback INSERTs and the table is NOT NULL on four more
  columns; it would have failed differently, and a fallback that satisfied them would mint fresh
  queue rows for a status flip. Fixing the reason bug is what makes the DSN symptom disappear.
- ⚠️ **The fix nearly landed on dead code.** `logging_helpers` defines `upsert_pending_update`
  twice and rebinds the name to `upsert_pending_update_v2`; `inspect` says the live body is line
  **4528**. Two definitions of one name in one Python module — the later silently wins.
- **`properties._new_property` is a pseudo-field** (0 columns, 65 rows): the 42703 was swallowed
  and the row **silently read as "no change"**.
- ⚠️ **The 1,001 log lines are a viewer cap, not a run boundary.** 496+486+10+~9 = 1,001 against
  1,952 stale rows — the brief's counts are **floors**; the true per-run figure is **~1,950**.
- **`public-record-ingest` and `cms-ingestion` are in NO producer registry** — `feed_freshness_registry`
  is table-keyed (5 dia rows) and `ingestion_tracker` has no health consumer; B6a's
  `v_pipeline_task_health` is gov-side only. **B6d-cms-escalation stands, unbuilt by design.**
- Guards: 21 tests, **20/20 mutations RED**. ⚠️ One guard **passed its own mutation** first
  (`"wholesale_failure" in body` matched the local `drain_wholesale_failure` — the N15c lesson);
  it asserts the AST attribute access now. A second sliced **past** the function it named into a
  module-level `try/except: pass`; the slicer uses `ast` line spans now. Suite **2,957 / 44
  failed, failure set byte-identical to the same-session baseline**.
- 👤 **Nothing here ingests.** The restart is a Railway **Redeploy** (not `FORCE_RUN=true`).
  Verify on `max(medicare_clinics.source_last_seen)` past 2026-06-25 + the `feed_stale` alert
  auto-resolving — never `updated_at`, never the log line.
## 2026-08-29 — D1: the cross-database provenance diff, standing (and mostly good news)

**NOTHING BUILT** — no feeder, no backfill, no migration. Shipped a detector, a ledger and a guard.
Writeup `docs/audits/D1_CROSS_DB_PROVENANCE_DIFF_2026-08-29.md`; **I2**, **Class 20**, backlog
**D1** + **D1a'–D1i** updated.

- **The honest headline: the two domains are substantially coherent.** **69 producer-set differences
  over 23 two-sided fact stores — 58 legitimate, 5 unexplained, 6 unwired, and NONE B5-sized.** The
  largest is 1,021 rows of broker market intelligence against B5's 2,776 ownership rows over 2,000
  properties. ⚠️ **That is a real result and it is what the prompt named as valuable — the detector's
  value is now preventing the next divergence, not closing a current one. Manufacturing a finding to
  justify the query was the failure mode here.**
- ⚠️ **THE BIGGER FINDING IS A PRECONDITION NOBODY HAD STATED: 12 tables exist in BOTH domains and
  record provenance in only ONE**, so I2 cannot be evaluated on them at all. The one that matters is
  **dia `ownership_history` — 10,037 rows, no provenance column**, i.e. the very store B5 was a
  finding about is un-diffable on dia's side. **A store with no provenance column is not clean, it is
  UNMEASURABLE — and it reads identically to clean.** Backlog **D1g**.
- ⚠️ **Positive control: 2 of 3, and I am not claiming the third.** B5 fires (dia
  `sales_transactions_seller_exit` 2,310 facts / 1,554 entities, gov absent); B6c-dup fires (dia PSE
  carries `sales_transactions` 2,646, gov carries none). **B6b is structurally out of reach —
  `gsa_lease_change_facts` has no provenance column at all**; it was found by B6a's skipped-step
  instrument, a different detector answering a different question.
- ⚠️ **B5's control still fires even though B5 SHIPPED** — gov's equivalent work landed under
  different bucket labels, so a naive reading re-reports a closed finding as open. That is exactly
  why the mechanism is **acknowledgement-with-a-reason**: `legitimate` silences a row,
  `unexplained`/`unwired` keep it **rendering** as known and tracked. Every entry, synonym and
  exclusion **requires a reason** or the detector rejects it.
- ⚠️ **I corrected my own reading twice, and both corrections shrank the finding.** The raw diff said
  *"gov harvests sale contacts, dia does not — wire dia up"*; the parser diagnostics said dia has
  **6x** the raw material and writes nothing, which looked bigger; **reading the rows** showed every
  row on **both** sides is a **BROKER**, which the account doctrine never prospects — so it is Tier-4
  market intelligence, not a BD gap. The genuinely valuable thing found en route is **symmetric and
  therefore invisible to this detector**: buyer/seller sale-role contacts have **never** been
  persisted in **either** domain, though dia's parser reports one on **540 of 942** captures
  (**D1a'**, Class 2 not Class 20).
- ⚠️ **Five ways this query returns a confident wrong answer, all hit live, all now guarded:**
  per-domain column NAMES (`properties` = `data_source`/`source`); a **dead** second column (gov
  `property_financials.source`, **0 of 98,510 populated**) so resolve by POPULATION not name;
  per-row suffixes; a provenance column holding a **data value at modest cardinality**
  (`ingestion_tracker.source` = temp paths, ~41 buckets, under any sane cardinality guard) — excluded
  by **recorded decision with a reason, emitted and counted**, never by a name pattern (P182); and one
  producer wearing two labels, folded by synonym **stingily** (dia carries BOTH `costar_import` and
  `costar_sidebar`, so folding those would have hidden a real difference).
- ⚠️ **The ledger-completeness gate caught 5 differences I had missed by eye.** Verifying the ledger
  against the measured population, rather than assuming it complete, is what made it complete.
- **Guard:** `test/d1-cross-db-provenance-diff.test.mjs` — 18 tests, **19 mutations verified RED**,
  comments stripped before source matching.
- 👤 **NOT scheduled, deliberately (D1h), and the script has never run.** The sandbox holds no
  `GOV_/DIA_SUPABASE_*` credentials, so **every number above was measured through the Supabase MCP
  seam and the runner's I/O path is unexercised.** A job that has never been green once is the badge
  people learn to merge past. **First credentialed run is an operator step.**
- Also fixed in passing: the backlog's **D1 row had 5 cells in a 4-column table and an unescaped `|`
  inside a code span**, so GFM was silently dropping its status cell.
## 2026-09-01 — 🚨 B6e-fred's sweep found the bigger thing: Dialysis CI CANNOT FAIL on its own subject matter

**The FRED fix shipped (PR #7384) and the sweep did what §3 of the prompt hoped — it outranked the
fix.**

### `B6e-ci-mask` — 3,042 tests collected, not one can fail CI

Dialysis `ci.yml` uses `|| echo` **five times**:

```
pytest tests/ -v --tb=short --ignore=tests/integration/ 2>/dev/null || echo "Tests completed…"
```

**`|| echo` swallows pytest's exit code, so the step always succeeds; `2>/dev/null` discards the
traceback.** ⚠️ **Every guard in `tests/` — including the mutation-verified B6d ones and the new
pipefail guard — is a regression detector that no merge gate enforces.**

⚠️ **This is LCC's own documented "no workflow runs `npm test` on a PR" finding, in a second repo,
wearing a different idiom.** `| tee` was one masking form; `|| echo` is another.

🎯 **And the cruellest instance is lines 137–138: `python -c "import src.main" 2>/dev/null || echo`.**
**That is exactly the check that would have caught FRED's `ModuleNotFoundError: postgrest`.**
**The repo already had the detector. It simply could not fail.** Twenty-five days of green badges
over a dead producer, with the guard sitting right there, muzzled.

✅ **CC did NOT flip it, and that was right.** Gating a never-enforced 3,042-test suite is the
documented **"never green once on `main`"** trap — and whether that suite is green is *unmeasured*.
The sequence filed is the correct one: **measure on `main` → fix or quarantine what is red → remove
the masking ONE LINE AT A TIME, starting with the import check.** It also declined to extend the
pipefail guard to cover `|| echo`, because that would ship a test red on every run with no safe way
to green it.

### ⚠️ FRED itself is fixed but UNPROVEN — verified: still 25 days stale

`economic_indicators` newest row is **still 2026-08-07**, **0 rows since 2026-08-10**. The workflow
fix is merged; **the producer has not yet been shown to write.** ⚠️ **"Merged is not running" — and
here it is also "fixed is not proven."** Dispatching the workflow needs Actions-write scope Claude
Code does not have (403), so **`B6e-fred-verify` is Scott's**: run it and confirm rows land past
2026-08-07, then decide on backfilling the 25-day gap.

### A merge resolution worth preserving as a rule

Two windows answered `B6e-meta` simultaneously and both edited that backlog row; the auto-merge was
clean and produced **two rows under one id**. ⚠️ **CC resolved it correctly: a duplicated row id is
a MAPPING, not an addition, so "keep both" was wrong** — it kept the richer version (the one with
the queue measurement) and folded in the single fact only its own had. **That is the YAML
`node-version` lesson from `CLAUDE.md` §4a, applied to prose, and got right this time.**

## 2026-09-01 — Registry corrected, and the queue measured: DO NOT schedule it yet

**SQL run.** `dia_producer_registry.metadata_backfill_queue` now reads **CONFIRMED UNSCHEDULED**
with the operator check recorded; `scheduler_confirmed` stays `false`, which remains accurate.

### 📊 Scott asked whether to wire the schedule while we are here. The measurement says NO — a schedule solves the wrong half.

`property_metadata_backfill_queue`:

| fact | value |
|---|---|
| total rows | **1,365** |
| enqueued | **ALL on ONE day — 2026-05-21** |
| `attempts > 0` | **ZERO rows. The drain has never processed a single row.** |
| `open` | 662 · `captured`/resolved | 703 |

**Three findings, and they point the same way:**

1. **Nothing ENQUEUES.** No new rows in 3.5 months. **A weekly cron would drain 662 once and then
   run empty forever** — a consumer with no producer, the mirror of Class 2.
2. **The drain has NEVER executed.** ⚠️ **Scheduling untested code is exactly how the last three
   silent producers happened** (`fred_ingest` green-and-dead, `cms_ingestion` throttled,
   `public_record_ingest` failing 500×/run). **Prove it works before automating it.**
3. **But the gaps ARE real** — of the 662 open rows, **0 properties are gone** and only **16 have
   since had `year_built` filled (16 for `land_area`)**, so **~646 are still genuine**
   (`year_built` 224, `land_area` 205, plus combinations). **This is worth doing; it is not worth
   scheduling yet.**

⚠️ **The most interesting number is the one that argues for caution: 703 rows are `captured` and
RESOLVED with ZERO attempts.** **51% of the original queue self-resolved through other ingestion
paths.** That is simultaneously evidence the fields do fill over time *and* a reason to **size the
assessor's marginal yield before automating** — it may be doing less work than the queue depth
implies.

**Recommended sequence, in order:**

1. **Run it ONCE, manually, against the 662** — measure the real yield (how many of ~646 gaps does
   the assessor actually fill?).
2. **If the yield justifies it, build the ENQUEUER** — the missing producer half. Without it, any
   schedule is a one-shot wearing a cron.
3. **Only then add a schedule**, and register it with a declared cadence so
   `v_dia_producer_health` can see it from day one.

**This is the Consumption-Layer bar applied to a producer we were about to switch on because it
existed** — the exact move `B6b-lead` was refused for, and the reason that refusal was right.

## 2026-09-01 — 👤 Operator check: `metadata_backfill_queue` was NEVER WIRED, and a second Railway deployment surfaced

**Scott checked Railway.** The service exists on **both** the `life-command-center` and
`tranquil-delight` deployments, and **neither carries a Cron Schedule setting.**

✅ **So `metadata_backfill_queue` has no trigger anywhere — it is deployable code that nothing runs.**
That is the third of the three outcomes I laid out: **designed and never wired**, not *scheduled and
undocumented*.

⚠️ **This converts it from a bug into a DECISION.** It has never run, so **nothing regressed by its
absence** — wiring it is **new capability**, and it should clear the Consumption-Layer bar (named
consumer, value gate, auto-retire predicate, honest counts) exactly like any other new producer.
**Not "turn it on because it exists."**

⚠️ **And the registry row needs a precise correction, because the two states are different facts.**
`dia_producer_registry.scheduler_confirmed` stays **false**, but the notes currently say
*"SCHEDULE UNCONFIRMED — operator must confirm"*. **It is now CONFIRMED UNSCHEDULED.** Leaving it as
"unconfirmed" implies the weaker claim and invites someone to re-check what has already been
checked. Proposed one-line update handed to Scott.

### ⚠️ Second finding, surfaced incidentally: the dormant `life-command-center` service is still live

The metadata service appearing on **both** deployments means **the dormant `life-command-center`
Railway service still exists**, carrying service definitions, alongside `tranquil-delight`.

**`I16` already names deleting it** (part of the Render-contingency decision), and
`CURRENT-STATE.md` treats `tranquil-delight` + the standalone MCP as the live pair. ⚠️ **This is the
P194 shape** — the retired Vercel deployment that still answers and still holds a service key — **and
the lesson there was that a stale deployment is invisible to every check this repo runs.** Filed as
**`I16b`**: confirm it holds no live traffic and no live credentials **before** deleting, and confirm
it is not quietly serving something unaccounted for. *Do not delete on the assumption it is dormant;
that assumption is exactly what P194 punished.*

## 2026-09-01 — B6e-fred drafted, and the operator cost turns out to be the Capital Markets book

**Prompt: `prompts/B6e-fred-green-ci-dead-producer-2026-09-01.md`.**

🚨 **`economic_indicators` is not an obscure table. It feeds exactly two consumers, and both are
Capital Markets book exhibits** — **`cm_dialysis_macro_rates_m`** and **`cm_dialysis_macro_rates_q`**,
the macro-rate exhibits in the **Dialysis State of the Market book**. The series include **`DGS10`**,
the 10-year Treasury.

**So this is not a stale internal table — it is a client deliverable running on rates that stopped
updating 2026-08-07.** ⚠️ **The prompt requires establishing whether a book or CM export actually
went out in that window: if one did, that is a correction to make, not just a pipeline to fix.**

**Two sequencing decisions written in, both counter-intuitive:**

- **Fix `pipefail` BEFORE the dependency**, so the next failure is loud even if the dependency fix is
  wrong.
- ⚠️ **If `pipefail` lands first, the workflow will correctly go RED — and that is SUCCESS for step
  1.** The prompt says explicitly: **do not "fix" the redness by reverting the pipefail.** A loud
  failure is the improvement; a green badge over a dead producer is the defect.

🚨 **And the sweep is the bigger prize.** One instance of `| tee` without `pipefail` implies a
pattern, and the pattern is **invisible by construction**. The prompt requires every workflow with a
piped step lacking `pipefail` to be reported **whether or not it is currently failing** — and says
plainly: **if the shape appears in several workflows, that is the finding and it outranks the FRED
fix.** *One dead producer is a bug; a class of workflows that cannot report their own failures is a
blind spot.*

## 2026-09-01 — ✅ B6d-cms-escalation SHIPPED, and its FIRST honest run found a producer green in CI and dead for 25 days

`dia_producer_registry` + `v_dia_producer_health` are live. **The instrument was the deliverable; what
it revealed on first run is the point — and it revealed more than the CMS thread did.**

### 🚨 `fred_ingest` — 16 consecutive GREEN scheduled runs wrote ZERO rows

**Verified independently: `economic_indicators` last took a row on 2026-08-07 — 25 days ago — and
ZERO rows since 2026-08-10**, across **16 green GitHub Actions runs**.

**Mechanism:** the module **dies at import** (`ModuleNotFoundError: postgrest`), and **`| tee`
without `pipefail` masks the exit code**, so the workflow reports success. ⚠️ **It is not in
`INFRASTRUCTURE.md`'s job map either** — a producer nobody had written down, failing silently, with a
green badge.

⚠️ **This is the purest instance of the class this whole arc has been about**, and it was found by
the very rule I insisted on: **enumerate producers from the SCHEDULER, not from the run ledger.**
`fred_ingest` writes no run row, so it is **invisible to `ingestion_tracker`** — building the
registry from the tracker would have missed it entirely.

### ⚠️ And the CMS outage is OLDER than we have been saying

**`cms_ingestion.last_success_at` = 2026-04-04**, not 2026-06-25. **The 06-25 date was
`source_last_seen` — a watermark, not a successful run.** The pipeline has not had a clean success in
**five months**. ⚠️ **And `last_outcome` reads `started` at 2026-09-01 06:08 — another orphan forming
right now**, with `failures_30d = 4`.

⚠️ **`refreshed_since` is still 249** — unchanged since yesterday. **The check I flagged has its
answer: the pipeline completes without finishing.**

### The registry's own headline: 4 of 5 producers emit no run row at all

| producer | scheduler | emits run row | state |
|---|---|---|---|
| `cms_ingestion` | railway cron `0 6 * * *` | ✅ | last clean success **2026-04-04**; orphan forming |
| **`fred_ingest`** | GH Actions `30 11 * * 1-5` | ❌ | 🚨 **green, dead 25 days** |
| `public_record_ingest` | railway cron `0 7 * * *` | ❌ | running (wrote parcel/deed 08-31) — **a failure would be invisible** |
| `metadata_backfill_queue` | railway cron **UNCONFIRMED** | ❌ | 👤 *"either scheduled and undocumented, or never wired"* |
| `salesforce_object_sync` | GH Actions `0 7 1 1,7 *` | ❌ | twice a year — **a failure is invisible for months** |

**The view is honest about its own blindness** — every row carries a `blindness_reason`,
`scheduler_confirmed` flags the unconfirmed one, and `cadence_basis` says `declared_schedule` rather
than implying a measurement. **That is what makes it trustworthy on day one.**

⚠️ **One design decision worth preserving:** `cms_ingestion` is mapped on `source='cms_ingestion'`
**only** — `source='CMS'` rows are zero-duration **watermark stamps** and `source='ingestion_lock'`
rows are the **janitor**. **Folding either in would have inflated `last_success_at` with rows that
never moved data** — the same honest-count discipline, applied while building the instrument.

## 2026-09-01 — B6d-cms-escalation drafted: dia has five producers and no health surface over any of them

**Prompt: `prompts/B6d-cms-escalation-dia-producer-health-2026-09-01.md`.** This is the answer to
*"why did the CMS outage take two months?"*, and it is the structural half of **I4**.

**Verified live:**

| | gov | **dia** |
|---|---|---|
| producer health view | ✅ `v_pipeline_task_health` | ❌ **does not exist** |
| producer run table | `run_log` (5,813 rows) | `ingestion_tracker` (292) |
| producer-registry objects | ✅ | ❌ **zero** |
| `feed_freshness_registry` | per-feed | **5 rows, TABLE-keyed** |
| producers writing runs | — | **5 distinct**, newest 2026-09-01 |

**dia runs five ingestion producers and has no surface that can say whether any is healthy.** The
only instrument pointing at them is a freshness bound on the **output** — which structurally cannot
distinguish *the producer failed* from *the source published nothing*. **B6a built this for gov; dia
never got it.**

✅ **The port is well-defined, and gov's view already carries the exact distinction this thread was
about: `last_success_at` SEPARATE from `last_outcome_at`.** That is precisely what the CMS throttle
violated — it keyed on the last *attempt* and bought 30 days of silence per failure. Plus
`skip_reason`/`skip_declared` from B6a and `p90_gap_days` from B6d. ⚠️ **It is a port with a column
mapping, not a copy** — gov reads `run_log`, dia has `ingestion_tracker` with different columns and a
producer keyed on `task_name` **or** `source`.

🚨 **The prompt's central trap, and it would have rebuilt the blindness one level up: ENUMERATE
PRODUCERS FROM THE SCHEDULER, NOT FROM `ingestion_tracker`.** The tracker's five are only those that
have **ever written a row** — *a producer that has never emitted is invisible to it*, which is Class
21 exactly. **A scheduled producer with zero rows ever is the highest-value row that view can
contain.**

**Two honesty constraints carried in:** ⚠️ **`last_error` will be empty at first** — `error_summary`
is NULL on **47 of 47** dia runs until `B6d-cms-step` lands — **and a view showing always-null errors
must not be read as "no errors."** ⚠️ **`success` is not yet trustworthy on dia** (six successes
while zero clinics refreshed), so **`last_success_at` inherits that weakness and NO alert ships until
the view is honest** — an alerting surface over an untrustworthy `success` would manufacture false
all-clears.

## 2026-09-01 — ✅ CLOSED. The CMS alert auto-resolved, the placeholder regression is at ZERO, and one feed_stale alert remains.

**Both checks I promised, run — and both passed.**

### ✅ Check 1: the alert auto-resolved on its own

**`medicare_clinics` — detected 2026-08-28, RESOLVED 2026-09-01.** ⚠️ **This, not my query, was
always the confirmation** — I said so explicitly last night and it is worth naming that the rule
held: *the monitor closed its own alert*, which is the whole point of B6a-follow-up.

**Open `feed_stale` alerts: 4 → 1.** The only survivor is **`sam_lease_opportunities`**, which is
`B6d-sam` — a 401, an owner action, and correctly still open.

### ✅ Check 2: the placeholder regression is fixed properly, not just stopped

| | baseline | peak | **now** |
|---|---:|---:|---:|
| `pending_updates` total | 1,959 | **7,531** | **1,965** |
| `reason = 'unknown_reason'` | 0 | **3,424** | **0** |

**And the writer now emits a REAL reason** — `public_record_ai_no_yield` moved 1,893 → **1,899**
with `last_seen` **2026-09-01**, so the six new rows today carry a meaningful reason. The three
legitimate categories are intact and nothing else was disturbed.

⚠️ **Recorded precisely: the 3,424 were DELETED, not re-labelled.** `public_record_ai_no_yield`
gained **6**, not ~3,424 — so the placeholder rows were removed as the artifact they were, and the
writer was fixed separately. **That is a defensible third option beyond my "backfill or mark"
framing** (they were one day's output of a broken path, not real pending work), **but it is a
different act and the record should say which happened.**

### ⚠️ The one thing NOT finished: the ingest is 2.9% complete

**`refreshed_since` 61 → 249 of 8,547 clinics = 2.9%.** `source_last_seen` is 2026-08-31.

**So the pipeline can write again and is progressing — but this is not a completed ingest.**
⚠️ **And the alert resolving does NOT mean the feed is whole**: the freshness check asks *has data
arrived recently*, which 249 rows satisfy. **A green alert and a complete dataset are different
facts** — the same shape as every honest-count lesson in this arc, now in our favour rather than
against us. **The next scheduled run should push 249 higher; if it stalls there, the pipeline
completes without finishing.**

**Sixty-seven days of silence, closed.** The chain that did it: B6a made producers visible →
B6a-follow-up made them alertable → **B6d graded the bound and refused to widen it** → the Railway
logs named a throttle → `--force-run` proved the throttle was hiding a real failure → B6d-pri/-step
made the failure legible. **No single step would have done it, and the one that mattered most was
declining to widen an SLA that looked wrong.**

## 2026-08-31 (evening) — ✅ THE CMS OUTAGE IS BROKEN OPEN after 67 days. 🚨 And the placeholder regression grew 8×.

**Measured against this morning's baseline. Two results, in opposite directions.**

### ✅ Data moved for the first time since 2026-06-25

| metric | baseline | now |
|---|---|---|
| `max(medicare_clinics.source_last_seen)` | 2026-06-25 | **2026-08-31** |
| clinics refreshed since 2026-06-25 | **0** | **61** |
| newest run | 08-27 `abandoned` | **08-31 `success`** |

**67 days of silence ended.** The chain that got here — B6a made producers visible, B6a-follow-up
made them alertable, B6d graded the bound that refused to be widened, the logs named a throttle, and
`--force-run` proved the throttle was hiding a real failure — **every step was necessary and none of
them alone would have done it.**

⚠️ **Three honest qualifications, none of which undo the result:**

1. **61 of 8,547 clinics is 0.7%.** This is a **partial** ingest, not a completed one. **Do not read
   `source_last_seen` moving as "the feed is healthy"** — read it as "the pipeline can write again."
2. **The `feed_stale` alert is STILL OPEN.** The LCC-side monitor has not re-evaluated since the
   data moved at 20:25. **It should auto-resolve on its next cycle — and THAT is the confirmation,
   not this measurement.** ⚠️ *Reading the alert ledger rather than my own query is the rule
   B6a-follow-up exists for; it applies to good news too.*
3. **The 20:25 run reported `success` with `rows_upserted` NULL.** So the §2 defect
   (`success` on a no-op, and `rows_upserted` never recorded) is **still live** — it is in
   `B6d-cms-step`, which is now in flight.

### 🚨 The `unknown_reason` regression grew 8× in one day — this is now the urgent item

| | this morning | after the first fix | **now** |
|---|---:|---:|---:|
| `pending_updates` total | **1,959** | 2,341 | **7,531** |
| carrying `reason = 'unknown_reason'` | 0 | 437 | **3,424** |

**The human triage queue nearly quadrupled in a day, and 45% of it is now unactionable placeholder
rows.** ⚠️ **And the asymmetry is the tell: 61 clinics refreshed against +5,572 queue rows.** The
drain is generating queue work two orders of magnitude faster than it is refreshing data.

**This is the Consumption-Layer failure in its purest form** — a fix that satisfied a NOT NULL
constraint turned ~500 loud errors per run into **3,424 silent, unactionable rows in a queue a human
is supposed to work.** `B6d-pri-reason` was filed as a correctness nit this morning; **it is now the
most operator-damaging open item on the board**, and it is already bundled into `B6d-cms-step`.

⚠️ **Whoever picks this up: the placeholder rows must be BACKFILLED or MARKED, not just stopped.**
Stopping the writer leaves 3,424 rows nobody can triage sitting in the queue forever.

## 2026-08-31 — B6d-cms-step drafted, and measuring it found the defect is 47× bigger than one run

**Prompt: `prompts/B6d-cms-step-capture-the-error-2026-08-31.md`**, bundled with **`B6d-pri-reason`** —
same file, same class: *a field that exists to carry meaning, written with nothing in it.*

⚠️ **I set out to "capture the exception on the `medicare_ingestion` step" and the measurement
reframed it: `error_summary` is NULL on 47 of 47 runs since 2026-06-01.** `abandoned` 24 · **`failed`
10** · `success` 6 · `recorded` 3 · `started` 2 · `partial` 2 — **every one NULL.** **The column has
never been written, not once, across ten explicit failures. The error CHANNEL has never worked**,
which is a different and much cheaper problem than instrumenting one step.

⚠️ **And a third defect surfaced while measuring: six runs report `success` — newest 2026-07-30 —
while `max(source_last_seen)` stayed at 2026-06-25 and 0 clinics were refreshed.** **`success` can
be returned on a no-op.** That is **Class 26** (*two different facts sharing one status value*) in a
new table, and it means the last three months of "successes" cannot be read as data movement.

**What DOES work is the instrumentation B6d-pri added** — the failed run carries
`notes: {"current_step": "medicare_ingestion", "heartbeat_at": …}`. **We now know WHERE it dies and
have never once known WHY.** That asymmetry is the whole prompt.

**Three guardrails carried in, each earned:** ⚠️ **do not widen a `try` to make the error appear** —
that is exactly how the swallowed 42703 made 65 rows silently read as *"no change"*, a **data**
defect B6d-pri caught; **a terminal status must be reachable** (2 rows are still `started` with
`finished_at` NULL, the orphan shape re-forming); and ⚠️ **the prompt says plainly that it does NOT
fix the hang — expect the run to still fail, and that is SUCCESS for this change.** The captured
exception text is the deliverable, because two months of silence have been about not having it.

## 2026-08-31 — ✅ D1 SHIPPED: the two domains are already coherent, and the real gap is in the INSTRUMENT

`docs/audits/D1_CROSS_DB_PROVENANCE_DIFF_2026-08-29.md`. **The honest result I asked for, and it is
mostly a clean bill of health — which the prompt explicitly said was an acceptable outcome.**

**69 differences triaged: 58 legitimate · 5 unexplained · 6 unwired — and NONE is B5-sized.** The
largest unwired candidate is **1,021 rows of broker market intelligence**. **D1c** is the closest
analogue: `property_sale_events` fed from `ownership_history` — dia 52, gov 0 — *"same shape as B5,
~2% of the size."*

**⚠️ The finding the prompt did NOT anticipate, and it is the more valuable one: 12 stores cannot be
diffed at all, because they carry no provenance column** — **including dia `ownership_history`
(10,037 rows)**, *the very store whose provenance diff found B5*. **B5 was a finding about ownership
history, and dia's copy of that table is invisible to the detector that found it.** That is a gap in
the **instrument**, not the data — the same class one level up.

**The design constraints I asked for were all met, and one better than specified:**
**acknowledgement is not silencing** — `legitimate` silences a row; **`unexplained` and `unwired`
keep emitting**, in `scripts/d1-provenance-acknowledgements.json`. That is what stops this becoming
the badge-of-noise failure B6d fixed one layer up.

⚠️ **The positive control was honest about itself: 2 of 3 re-found, the third out of reach** — and it
said so rather than reporting three. B6c-dup was re-found from cold (dia `property_sale_events`
carries producers `sales_transactions` 2,646 and `ownership_history` 52; **gov carries neither**).

**So the P0d thesis holds and is now measured: the domains are substantially coherent, and D1's
standing value is preventing the NEXT divergence rather than clearing a current backlog.**

## 2026-08-31 — RECONCILED against the baseline. The throttle was hiding a real failure, and one fix traded a loud error for a silent one.

**Measured against this morning's baseline. Three results, and two of them are corrections to me.**

| metric | baseline | now | verdict |
|---|---|---|---|
| `max(medicare_clinics.source_last_seen)` | 2026-06-25 | **2026-06-25** | ❌ **unmoved** |
| clinics refreshed since | 0 | **0** | ❌ unmoved |
| newest CMS attempt / status | 2026-08-27 · `abandoned` | **2026-08-31 · `failed`** | ✅ it RAN |
| `rows_upserted` | null | **null** | ❌ |
| `pending_updates` | 1,959 | **2,341** | ⚠️ **moved — I predicted it would not** |

### 🎯 The force-run answered the decisive question: the throttle was hiding a REAL failure

`--force-run` bypassed the throttle and the run executed — **18:30:26 → 18:38:16, ~8 minutes,
`failed`** — with `notes: {"current_step": "medicare_ingestion", "heartbeat_at": …}`. **The new
instrumentation works: it names the step it died in.** ⚠️ **And two rows remain `started` with
`finished_at` NULL — the orphan shape re-forming in the same session.**

**So the 2026-06-23 hang is still live underneath.** The throttle was never the disease; it was what
kept us from seeing it for two months. **That is the branch I flagged as *a finding, not a failure*,
and it is the more useful outcome.**

⚠️ **`error_summary` is `(none)` on the failed run.** A run that fails without recording why is
**I5's defect in a second place** — the PA fault branch has the identical shape. **Filed as
`B6d-cms-step`: the step is named, the error is not.**

### ⚠️ My prediction was wrong, and the reason matters more than the prediction

I wrote: *"the DSN fix should NOT move `pending_updates` on its own — if it does, my read of the two
defects as independent is wrong."* **It moved +382.** The cause is not the DSN: **`B6d-pri`'s code
fix landed and made the writes succeed.** So the two defects were independent after all — **the
prediction was right about the mechanism and wrong about what else would ship in between.**

### 🚨 But the fix satisfied the constraint with a PLACEHOLDER, which the prompt explicitly forbade

**437 rows written today carry `reason = 'unknown_reason'`** — first and last seen **2026-08-31**, so
entirely new. `B6d-pri` §2 said: *"give it a real reason string — **not a placeholder** … a reason
that restates the source is not a reason."*

⚠️ **And the same table already demonstrates the standard:** `public_record_ai_no_yield` (1,893),
*"Salesforce auto-created property — verify accuracy and check for duplicates"* (65), *"unmatched
property_id during financial propagation"* (1). **The codebase knows how to write meaningful
reasons.**

**In operator terms this is arguably a regression.** Before: the writes failed loudly, ~500 errors a
run. After: they succeed silently and **437 unactionable rows enter a human triage queue**. **A loud
failure is more useful than a quiet placeholder** — this is the Consumption-Layer rule (every badge
is actionable work) violated by a fix meant to satisfy a NOT NULL. Filed as **`B6d-pri-reason`**.

### CC's two corrections to my brief — both accepted

1. **The 1,001 log lines are a VIEWER CAP, not a run boundary.** 496+486+10+~9 = 1,001 against
   **1,952 stale rows** — **my counts were FLOORS; the true per-run figure is ~1,950.** I read a
   truncated export as a complete run.
2. **The logs are the `cms-ingestion` service, not `public-record-ingest`.** The drain lives in
   `run_cms_ingestion.main()`, *which is also why the failures precede the skip* — a detail that
   only makes sense once the service is identified correctly. **I mis-attributed it twice.**

### Two further findings from B6d-pri, both worth carrying

- **`properties._new_property` is a pseudo-field (0 columns, 65 rows), and the swallowed 42703 meant
  those rows silently read as "no change."** It was a **data** defect, not a log defect.
- **§5b answered, and the answer is worse than expected: NEITHER cron is registered anywhere.**
  `feed_freshness_registry` is table-keyed (5 dia rows), **`ingestion_tracker` has no reader**, and
  `v_pipeline_task_health` is **gov-only**. → **`B6d-cms-escalation`**, unbuilt by design.
- **New: `B6d-pri-metrics`** — `metrics.persist_run_summary` defines an inner `_insert()` and
  **never calls it**, so it writes no summary row anywhere.

## 2026-08-31 — 📋 BASELINE captured before the CMS force-run and the DSN fix land

**Three things are in flight at once**, so the baseline is recorded *before* any of them lands —
otherwise tomorrow we compare against memory.

**In flight:** (1) Scott running the CMS ingestion locally with `--force-run`; (2) `SUPABASE_DB_DSN`
set on the Railway `public-record-ingest` service and redeployed; (3) `B6d-pri` and `D1` both with
Claude Code.

**Baseline — dia `zqzrriwuavgrquhisnoa`, 2026-08-31:**

| metric | value |
|---|---|
| `max(medicare_clinics.source_last_seen)` | **2026-06-25** |
| `medicare_clinics` rows | 8,535 |
| clinics refreshed since 2026-06-25 | **0** |
| newest CMS attempt / status | **2026-08-27 · `abandoned`** |
| `pending_updates` rows | **1,959** (newest 2026-08-26) |
| open `feed_stale` alerts | **2** — `medicare_clinics` (dia), `sam_lease_opportunities` (gov) |

**What each fix should move — and what it should NOT:**

- **The force-run** → `source_last_seen` advances past **2026-06-25**, `clinics_refreshed_since`
  rises above **0**. ⚠️ **The confirmation is the `feed_stale` alert AUTO-RESOLVING, not the run
  finishing** — read the alert ledger, not the console.
- **The DSN fix** → the next `public-record-ingest` run stops emitting the **486** `Failed to mark
  stale … DSN not configured` lines. ⚠️ **It should NOT move `pending_updates` on its own** — those
  writes fail on the separate **23502 `reason` NOT NULL** defect, which is a code fix in `B6d-pri`.
  **If the row count moves after the DSN change alone, my read of the two defects as independent is
  wrong, and that is worth knowing.**
- ⚠️ **A redeploy is not a run.** The DSN change proves nothing until the service's next scheduled
  execution; **the evidence is a clean log, not a green deploy.**

⚠️ **The decisive question the force-run answers:** if it **completes**, the throttle was the last
obstacle. If it **hangs**, the 2026-06-23 hang is still live underneath and the throttle was merely
hiding it — **a finding, not a failure**, and the one thing two months of silence could not tell us.

## 2026-09-01 — DOC1 BUILT: the CRE doc-text drain now reaches id 2

**One function + one handler in `api/_shared/cre-property-doc-text.js` /
`api/_handlers/cre-doc-text.js`. No migration, no new cron, no schema change.** Canonical page
**`docs/architecture/document-capture-ocr-and-deeds.md`** §0 (the fix), **§7** (what moved and what
must not), **§7b — the standing status check with its 2026-09-01 baseline**.

**The diagnosis reproduced exactly before anything was touched:** population **771** · drained
**76** · undrained **695** · ids **2 → 2317** · `newest60_done` **60**. And the undrained half is
**100% SharePoint server-relative, the same kind of document as the drained half** — nothing about
it made it unfetchable.

**The fix:** `fetchEligibleCreDocs` walks **oldest-first** (`order=id.asc`) on a keyset cursor
(`id=gt.<last id>`, 200/page — under the PostgREST 1000-row cap — budget 12 pages), stops at
`limit`, and reports `scan_pages` / **`scan_capped`** / `scan_exhausted` / `scan_lowest_id` /
`retry_admitted`. **`cap * 4` was NOT simply raised** — a bigger constant moves the jam to row N+1
and makes it more expensive to see (P136's explicit finding).

⚠️ **THE PROMPT'S §2 TOLD ME TO VERIFY SELF-EXCLUSION ON THE CODE PATH RATHER THAN FROM THE TABLE,
AND THAT IS THE WHOLE ROUND.** The sidecar's `ocr_non_ok` / `over_ocr_cap` / `thin_ocr_result` rows
genuinely prove that **post-fetch** failures persist a row and self-exclude. They say nothing about
the **pre-fetch** case — and `extractDocumentText` has **exactly ONE `ok:false` return,
`fetch_failed`** (`document-text.js:361`), on which `runPropertyDocText` returned **without writing
anything**. Live confirmation of the mechanism: **zero `fetch_failed` rows have ever existed in that
table.** All 771 documents are SharePoint refs fetched through the PA flow, so **one unset
`SHAREPOINT_FETCH_URL` would have parked the entire lane on the oldest document, forever** — an
oldest-first cursor alone would have been strictly worse than the jam it replaced.
**Reading the table would have "confirmed" safety; reading the code path refuted it.**

**So a fetch failure (and an extraction throw) writes a DATED negative marker** — `needs_ocr=true`,
`raw_text=null`, `reason='fetch_failed'|'extract_error'` — invisible to **both** consumers
(`gatherPropertyText` filters `needs_ocr=is.false`; `v_lcc_cre_bov_ready` counts covered only
`AND NOT t.needs_ocr`), **and deliberately not terminal**: re-admitted after 24 h, and **each retry
refreshes `extracted_at`, which is what makes the cursor advance** instead of re-trying the same head
every 30 minutes (P136). `mode=jobs` is untouched — `sidecarStatus` short-circuits only on `done`.

**Second defect fixed in passing: the sidecar probe failed OPEN**, treating an errored probe as
"nothing is done" and handing every row to the drain. Harmless behind a 60-row window; a re-OCR bill
across a full-population scan. **There is no spend guard that halts a tick**, so it fails closed now.

**Deliberately NOT done** (§3 of the prompt, all held): cron 160 stays `doctype=deed` (**DOC7 —
`property_documents.raw_text` has one deed-only consumer**); `claimPendingJobs` semantics untouched;
`limit` cap 50 and the 22 s budget untouched; no per-doctype tier logic; **no manual bulk backfill**
— 695 against a 15/tick cap is about a day of normal cron operation, and a hand-run is a Class 8
chore that skips the budget.

Guard **`test/cre-doc-text-window-jam.test.mjs`** — 15 tests, **11 of 11 mutations verified RED**
(descending order · keyset removed · `scan_capped` hard-coded false · either marker removed · the
clobber guard removed · expiry removed · the retry-reason filter removed · the probe failing open ·
a page size above the PostgREST cap · a reference to the domain store). ⚠️ **Source assertions strip
comments first** — the fix's own prose names `id.desc` and `fetch_failed` repeatedly, so a raw grep
would pass over the regression it exists to catch (A5c / N18 / B1).

✅ **VERIFIED LIVE ON THE FIRST REAL TICK — 15:00:00 UTC** (PR #1989 merged 14:56:09 by Scott,
Railway redeployed, cron 167 fired). `eligible` **0 → 15** · **`scan_lowest_id` and
`eligible_lowest_id` both `2` — the oldest document in the population** · `scan_pages 1` ·
`scan_capped false` · `scanned 4` / `text_extracted 3` / `ocr 1`. Documents reached: id **2** (om,
57,084 chars), **7** (lease, 6,935), **10** (lease, 9,492), **11** (lease, OCR). `scanned 4` against
`eligible 15` is the 22 s budget stopping on an item boundary, reported not hidden. Backlog
**695 → 691**, sidecars **76 → 80**, and **`bov_ready_properties` 5 → 6 — the CONSUMER moved on the
first tick**, which is the metric that matters.

🔴 **AND THE FIRST OCR ROW IS A LIVE SPEND FINDING — DOC8/DOC9, filed not fixed.** Document 11 came
back `ocr_tier:'cloud'`, `gpt-4o-2024-08-06`, **116 chars**, `thin_ocr_result`: the 6–14× premium
paid for nothing. ⚠️ **It is NOT the Custom-Extractor footgun this file documents, and checking the
ERROR rather than the SYMPTOM is what separated them.** The `docai-ocr` log at 15:00:18 reads
**`PAGE_LIMIT_EXCEEDED` — "non-imageless mode exceed the limit: 15 got 19"** against the **correct**
Enterprise OCR processor (`5ecc6339861c88e1`). A 19-page lease over DocAI's 15-page sync cap, falling
through to the documented gpt-4o last resort. **Google's own error names the fix: imageless mode
raises the cap to 30** — an edge-function deploy with its own grade, hence DOC8 rather than a
same-change patch. ⚠️ **DOC9: `ocr_by_engine` read `{}` and `ocr_pages_total` `0` on that very
tick**, because `bump()` only accumulates when `ocr_pages > 0` and gpt-4o returns no page count —
**the counter built to catch the escalation is blind to exactly the escalating path.** Until DOC9
lands, read `items[].ocr_tier`, never `ocr_by_engine`. ⚠️ **Sample size is ONE OCR row** — the
mechanism is confirmed, the rate across the remaining 691 is not, and the population is lease-heavy.

⚠️ **I did not merge #1989 and was told not to.** Scott merged it 5 seconds after `npm test` went
green, which is why the §7b baseline correction landed as a separate PR (#1990).

## 2026-09-01 — `user_owner` confirmed (10/4/1); DOC12 half closed, and the reason is NOT the cap raise

✅ **The `user_owner` lane produced its first verdicts — 10 confirmed, 4 rejected, 1 left
undecided.** `v_lcc_entity_roles.user_owner` **0 → 10**, multi-role **946 → 954**. Verdicts live in
`lcc_entity_role_confirmation`, the INPUT to the view, never a derived stamp.

⚠️ **The 4 rejects are ONE shape — an SPE/DST named after the tenant it houses** (`FSC FMC
Carbondale IL DST` ← Fmc-Carbondale · `USGBF NIAID LLC` ← NIAID · `NOAA Maryland LLC` ← NOAA ·
`MORGANTOWN GSA USDA, LLC` ← USDA) — **and `name_reads_as_spe_shell` read FALSE on ALL FOUR.** The
SPE detector caught none of them. **The case for a human lane is now measured rather than argued: a
person separated them in one pass; the guard that exists would have separated zero.**

⚠️ **Wake Forest is `is_not_prospected` and is STILL correctly `user_owner`** — the classification
is a fact about the party; prospecting is a separate gate. **`Mena Dialysis` left undecided on
purpose** (tenant is *DaVita Mena Dialysis Center* — landlord or predecessor practice, undecidable
from the record). ⚠️ Verdict vocabulary is CHECK-constrained to **`confirmed`/`rejected`**.

**C4b is closed by this** — `user_owner` is no longer *"written by nothing, ever."*

🟡 **DOC12 half closed — and the precise reason matters more than the win.** Since the redeploy:
**9 of 9 OCR events on DocAI, ZERO on gpt-4o** (char lengths 33,590 · 21,454 · 4,378 … 627, all
real), and **`over_docai_page_cap` fires correctly on 2 documents at 39 and 31 pages.** The 86%
escalation is finished and the marker path is proven.

⚠️ **But the flip is the MARKER's doing, not the cap raise's. Every successful DocAI row since
deploy is ≤12 pages — which the OLD 15-page cap served too — and the two over-cap documents are 31
and 39, both ABOVE 30. The 16–30 band, the exact population the 15 → 30 raise exists for, has still
had ZERO successful OCR events.** **Do not quote the zero-escalation result as evidence for the cap
raise: two changes shipped together and only one has been exercised.** *A win in the metric you were
watching is not automatically a win for the change you shipped.*

**Drain: undrained 695 → 639; `bov_ready` 5 → 11 — the consumer more than doubled.**
🔵 **DOC13 is narrowed to the retry half, time-gated to ~16:00–16:30 UTC 2026-09-02.**

## 2026-09-01 — C13b SHIPPED (PR #2003); it corrected THREE of my own numbers; stale files consolidated

✅ **`v_lcc_entity_roles` is LIVE on LCC Opps** — verified: investor_owner 6,447 · former_owner 3,786
· developer 718 · repeat_buyer 385 · one_off_owner 142 · buyer 124 · operator 29 · **user_owner 0 by
design.** **10,655 entities carry ≥1 role, 946 carry ≥2, 0 duplicate pairs.** A **VIEW over the
existing spine** per the storage decision — no table, no second cross-DB roll-up, no stamped column,
`entities.owner_role` left in place. **P0.4 555 → 555, deal bands 621 → 621, nothing writes, no
consumer repointed.**

🔴 **THREE OF THE DESIGN'S INPUTS WERE MINE AND WERE WRONG. Recorded as playbook Class 34.**

1. ⚠️ **`repeat_buyer` was 3,258 and is 401** (385 after guards) — **an 8× error carried through
   three documents.** I counted `purchases` **EDGES**; `entity_relationships` has **no unique key on
   `(from,to,type)`** — **a fact this repo had already written down (P177)** — and the arm is fed by
   three sources independently. Read on named rows the difference is single-asset SPEs: *Korea
   Investment Corporation* reading as a repeat buyer on **one property recorded twice.** The
   `(asset,date)` middle key was measured and rejected too (735 — A2b cross-source lag).
   ⚠️ **The knock-ons are the expensive part: "2,627 dormant 5+ years" is 219, and
   `investor_owner`+`repeat_buyer` is 167, NOT 772 — and 772 was my headline argument for
   multi-label.** The shape is still right (946 carry ≥2); **the argument for it was inflated 4.6×.**
2. ⚠️ **A manual override REPLACES the column an arm reads; it does not sit beside it.** 119
   entities carry `owner_role='developer'` AND a human override of `buyer`. In a multi-label world
   *"both are true"* is the tempting default and it is wrong — emitting both resurrects the machine
   call the human corrected. `developer` **838 → 718**.
3. ⚠️ **`one_off_owner` rests on `entities.entity_type`, which is wrong in BOTH directions** —
   Jamestown and MetLife typed `person`; 979 `former_owner` organizations reading as individuals.
   `first_name`/`last_name` looked like corroboration and is a **re-split of the same string**
   (P125). **Surfaced in `v_lcc_entity_role_ambiguity`, not patched — C13c.**

✅ **C18 was corrected, not just carried:** the *"2,627 dormant"* figure was the same edge-count
artifact. **Repeat-buyer pacing is 98.8% dated** (it reads `entity_relationships.effective_from`);
**the 50.7% blindness is real and belongs to `investor_owner`.** Still the highest-value item — but
the P180 failure is on the investor arm, **not on the repeat-buyer signal Scott cares most about.**

🧹 **Consolidated the two files this round made inaccurate:**
**`C12_C4a_DECISION_BRIEF`** — superseded banner: its three options were never chosen (the framing
did not survive Scott's definitions), and three of its numbers are refuted (`user_owner` sized at
thousands is **13**; `repeat_buyer` 2,478 is an edge count). Kept for its consumer-blast-radius
table. **`bd-ranking-and-priority-queue.md`** — *"`user_owner` has no producer anywhere"* is now
half false: the arm exists and **still reads 0 BY DESIGN**, because Scott chose a human-confirmed
lane. ⚠️ **The count is unchanged and its MEANING is not** — *"nothing ever wrote it"* became *"13
candidates surfaced, none confirmed yet."* **Do not "fix" it by automating it.**

**Open: C13c** (`entity_type` is unreliable) · **C13d** (the consumer mapping was measured at
126 → 130, +4/−0, and deliberately NOT applied) · **C18** · **C19** · **DOC13** (due 2026-09-02).

## 2026-09-01 — C13b unblocked: both questions answered; C19 filed (clients first, not product type)

✅ **`one_off_owner` is ALL SWIMLANES**, and the reason is doctrine rather than a detail:

> *"We are pursuing **clients first, not necessarily the product type itself.** We use the product
> type and expertise to develop relationships but **we want to sell all net lease product.**"*

⚠️ **Filed as C19 because it reaches past the arm that surfaced it: every domain/swimlane filter on
a BD or prospecting surface is now a CANDIDATE DEFECT rather than a given**, and nobody has swept
for them.

⚠️ **His answer also exposed a ceiling worth stating plainly.** *"All swimlanes"* is the intent;
**the spine can only express two** — `lcc_entity_portfolio_facts` carries `source_domain` = **`dia`
and `gov` and nothing else** across all 14,119 rows. So anything computed off the spine says *all
swimlanes* and **means dia + gov.** Other net-lease product is invisible to every role arm **until a
domain feeds the spine — a ceiling in what LCC INGESTS, not in the classifier.**

✅ **Storage decided (Scott: *"your call"*): a VIEW — `v_lcc_entity_roles` over the existing spine.**
⚠️ **The "roll up from all other databases" instinct is right and ALREADY BUILT:
`lcc_entity_portfolio_facts` IS that roll-up**, fed from gov and dia by the mirror/sync, so every arm
computes from LCC Opps alone. **A second cross-DB aggregation would drift from the spine the panel
and the queue already read.** Derived beats stamped (Class 8 + his *"isn't a one-time
determination"*); profile against the handler's REAL query shape first (115,744 edges; the
`LIMIT 5`-without-`ORDER BY` footgun understated one view ~100×); materialize only on a measurement,
following `lcc_priority_queue_resolved`, never a stamped column. `entities.owner_role` stays.

**`C13b-owner-role-multilabel.md` now has zero open decisions and is ready to run.**

🔧 **Git `index.lock` cleared** — 0 bytes, ~5 h stale, nothing staged and nothing unpushed, so a
plain delete was safe. ⚠️ **The documented reflex cleanup (`reset --hard`) would have destroyed the
unstaged doc edits** — `GITHUB-WORKFLOW.md` §2a.

## 2026-09-01 — C13 rewritten to MULTI-LABEL (C13b staged); DOC13 standing check filed

**Document pipeline: closed for now, with two questions parked on a dated check.**
**DOC13** (due **2026-09-02 ~16:30 UTC**) resolves both on one pass — the backlog supplies the
16–30 page documents **DOC12** needs, *and* the **14 retry markers** cross the 24 h re-admission
window. ⚠️ **Read `retry_admitted` and `marked_and_readmittable`** — 10 of the 24 markers are
**ceiling** markers and must NOT re-admit.

**C13 is superseded; `C13b-owner-role-multilabel.md` is staged and ready.** The rewrite carries
Scott's decisions in §0 so they are not re-asked, re-measures the populations
(`investor_owner` **6,469 → 6,480** — which is why you re-measure rather than quote), and marks the
two questions that remain **his**: whether `one_off_owner` is **dia-only** (his wording says *"our
target submarket category (dialysis)"*; the 143 is fleet-wide) and the storage shape.

⚠️ **Corrected an internal contradiction in `owner-role-classification.md`:** §6 item 2 still said
`developer` was *"under-specified… nobody has measured"* while **§2e of the same page shows it is
built, live, and five generations old** (`v_gov_owner_at_first_gen`, 2026-05-22). §6 now defers to
§2e. **A page that argues with itself misdirects the next reader exactly as reliably as a stale
one.**

🟠 **C18 filed — the highest-value item in the owner-role design, and it is DATA ACQUISITION.**
`ownership_start_date` covers **7,152 of 14,119 facts (50.7%)**, so **pacing — the dimension Scott
says drives seller-vs-buyer treatment — is half unmeasurable.** Sized: **6,967 dateless facts, gov
4,575 / dia 2,392, 5,176 entities, 3,523 of them CURRENT.** ⚠️ **2,627 repeat buyers read "dormant
5+ years" and about half of that is missing dates, not inactivity.** ⚠️ **The route is UNMEASURED** —
`ownership_source` has 2,931 distinct values on this slice, so the D1 producer-set diff needs a
different key. **Do not assume the deed layer supplies these dates until the join is measured.**

## 2026-09-01 — REDEPLOY VERIFIED: DOC10 closed, one straggler repaired, DOC8's cap still unexercised

**Deploy confirmed BEHAVIOURALLY** (the sandbox cannot reach Railway): a **zero-work
`mode=jobs&limit=1` tick** fired through `lcc_cron_post` returned `thin_ocr` / `over_page_cap` /
`ocr_docs_by_engine` / `ocr_pages_unknown` **with `ocr_by_engine` gone** — the DOC9/DOC10 build
answering. ⚠️ **A tick that does no work still proves the shape; that is the cheapest deploy probe
on this lane.**

| check | result |
|---|---|
| **rows covered-and-thin** | ✅ **0 — the DOC10 defect is fully closed** |
| drain | ✅ undrained **695 → 678** today, `lowest_id_reached` = 2 |
| floor not over-firing | ✅ a **1,886-char** lease extracted clean, unmarked |
| `bov_ready` | 7 → 4 → **5** |
| `over_docai_page_cap` | ⚠️ **0 — deployed but UNEXERCISED** |

🔧 **One straggler repaired — document 24**, written by the pre-deploy build at 16:00:51, between
DOC10's backfill and the JS deploy: 211 chars against a floor of 500, `needs_ocr = false`. A sweep
found **exactly one** such row fleet-wide. Set to `needs_ocr=true, reason='thin_ocr_result'` —
**byte-identical to what `cre-property-doc-text.js:296` now writes.**

⚠️ **The reason is load-bearing, and this was checked in the code before writing.**
`CRE_RETRY_REASONS = ['fetch_failed','extract_error','thin_ocr_result']` — **`no_page_anchors_gpt4o`
is NOT in it**, so marking the row while keeping its original reason would have made it
**marked-and-idle forever**. Line 296 overwrites the reason when a row is thin, so every future thin
gpt-4o result re-admits correctly. **The design is sound; doc 24 was a deploy-window artifact.**

⚠️ **10 of the 24 markers are CEILING markers** (`ocr_non_ok`, `over_ocr_cap`, `office_unreadable`)
and will never re-admit — by design, distinct from the 14 retry markers. **Read
`marked_and_readmittable`, never the bare `needs_ocr` count.**

⚠️ **STILL UNPROVEN — DOC12.** `over_docai_page_cap` has never been written and **v24's
structured-metadata parser has never been exercised**; the only observation of the new cap
(*"30 got 40"*) was on **v23**. **The 16–30 page band, the entire population DOC8 exists for, has
had zero OCR events either way.** The backlog drains in ~3–4 days and will supply them.

## 2026-09-01 — DOC8/9/10 SHIPPED; edge half live, JS half MERGED AND NOT DEPLOYED

**PR #1995 merged. `docai-ocr` v23 → v24 deployed to LCC Opps. DOC10's backfill applied.**

✅ **DOC8's cap fix is CONFIRMED ON BEHAVIOUR, not asserted.** The imageless flag was verified
against the **live v1 discovery document** — it is a **top-level `ProcessRequest` boolean**, not
`processOptions.ocrConfig`, where the prompt's own framing would have put it and where **nesting it
would have been a silent no-op leaving the cap at 15.** Google's error then moved from *"non-imageless
mode exceed the limit: 15 got 19"* to *"Document pages exceed the limit: **30** got 40"*.
**Verifying an API contract against the live schema instead of the prompt is what made that real.**

✅ **The tier split HAS flipped and is now measurable** (the response said it was not — true when
written, 15:30's rows landed minutes later). Today **3 DocAI vs 2 gpt-4o**; the DocAI rows carry real
page counts and **7,572 / 2,094 / 601** chars, both gpt-4o rows carry **no page count and 116 / 211**.
The mechanism behind the 9.3× gap is visible in five rows.

✅ **DOC10 backfill: 12 rows / 9 properties, reversal round-tripped and rolled back, `bov_ready`
7 → 4.** ⚠️ **That number going DOWN is the fix** — three of those four were never really ready.

🔴 **THE RAILWAY REDEPLOY HAS NOT RUN. Three independent tells:** `over_docai_page_cap` has **never**
been written despite a **40-page** document at 16:00:51 · the 16:00 tick body **still carries
`ocr_by_engine`**, which DOC9 **removed** · **document 24 was written `needs_ocr = false` at 211
characters**, which DOC10's floor would have marked.

🔴 **Document 24 is the DOC10 defect recurring live, four minutes after DOC10 shipped** — 211 chars,
`needs_ocr = false`, so BOV extract will take it as a lease and it can never be retried.
***Merged is not running*, demonstrated on the exact defect the merge closed.**

⚠️ **Verify after the redeploy, do not assume:** doc 24's reason is **`no_page_anchors_gpt4o`, not
`thin_ocr_result`**. DOC10 re-admits on a **set membership over reasons**, so a thin row arriving
under a different reason must be caught by the char floor AND land in `CRE_RETRY_REASONS`, or it is
marked and never re-admitted.

**Also from DOC8, worth keeping:** `ocr_by_engine` was **removed, not redefined** — it counted
PAGES, gpt-4o reports none, so the spend guard read `{}` exactly when the escalation happened. Read
**`ocr_docs_by_engine`** (unconditional) and **`ocr_pages_unknown`** (P180 — unknown is never 0).
⚠️ **31+ pages is honestly unsized: 8 page observations exist in total, 1 over 30.** That is a
sample, not a distribution.

**Backlog 691 → 682, `lowest_id_reached` = 2.**

## 2026-09-01 — DOC1 SHIPPED AND DRAINING; the spend check found a bigger problem than cost

**DOC1 merged (PR #1989), deployed, verified live.** `eligible` 0 → 15 · `lowest_id_reached`
35 → **2**, the oldest document in the population · undrained 695 → **691** · sidecars 76 → 80 ·
**`bov_ready` 5 → 6 — the consumer moved.** Deeds unchanged at 325/325; cron 160 untouched.
⚠️ **PR #1990 (the docs follow-up) is OPEN with both checks green and needs merging** — it was
split off because #1989 merged 5 seconds after CI went green.

⚠️ **The §2 self-exclusion premise was HALF TRUE and the other half would have jammed oldest-first
on row one.** The sidecar's `ocr_non_ok` / `over_ocr_cap` / `thin_ocr_result` rows are all
*post-fetch* outcomes. `extractDocumentText` has exactly one `ok:false` return — `fetch_failed` —
on which nothing was written, and **zero such rows have ever existed**, which reads as *nothing ever
failed to fetch* and is equally consistent with *a failure never persists*. All 771 documents are
SharePoint refs through the PA flow, so **one unset `SHAREPOINT_FETCH_URL` would have parked the
lane on document 1 forever.** **Reading the table would have "confirmed" safety; reading the code
path refuted it.**

🔴 **THE SPEND CHECK PAID FOR ITSELF, AND THE FINDING IS CORRECTNESS, NOT COST.** DOC1's writeup
called it *"sample size is one."* Measured across every OCR row the lane has ever produced:

| tier | rows | avg chars | **under 500** | thin |
|---|---:|---:|---:|---:|
| **gpt-4o** | **19 (86%)** | **1,579** | **12 (63%)** | 5 |
| DocAI | 3 | **14,687** | 0 | 0 |

**The expensive tier returns 9.3× LESS text** — gpt-4o's minimum is **31 characters**. Cause, read
from the edge log rather than guessed: `PAGE_LIMIT_EXCEEDED — 15 got 19`. ⚠️ **NOT the documented
Custom-Extractor footgun; the processor is correct.** It is DocAI's 15-page sync cap against a
lease-heavy corpus → **DOC8**, urgent, because the undrained 416 leases + 235 DDs carry ~257 more
OCR events at 86% to the failing tier over the ~3–4 days the backlog drains.

🔴 **DOC10 is the one that matters most.** `gatherPropertyText` admits on
`needs_ocr=is.false&raw_text=not.is.null` and `v_lcc_cre_bov_ready` counts covered on
`AND NOT t.needs_ocr`. **A 31-char fragment satisfies both** — so BOV extract gets it as if it were
the lease, the property reads *covered*, and **it is never retried.** ⚠️ `reason='thin_ocr_result'`
is already set on 5 rows and **nothing reads it.** ⚠️ **DOC8 must land first**, or the floor
correctly rejects most leases and parks the backlog.

🔴 **DOC9 — the counter built to catch the escalation is blind to it.** `ocr_by_engine: {}` and
`ocr_pages_total: 0` while spending gpt-4o money, because `bump()` only counts when `ocr_pages > 0`.
**Read `items[].ocr_tier`, never `ocr_by_engine`.** ⚠️ This is also why §7c's SQL spend check could
not have caught DOC8 alone — the sidecar column is populated, the tick's own summary is not.
**Both instruments were needed.**

~~**Prompt staged: `DOC8-docai-page-cap-and-thin-ocr-floor.md`**~~ ✅ **EXECUTED 2026-09-01 (PR #1995), prompt filed to `prompts/done/`** (DOC8 → DOC9 → DOC10, in that order — the order was kept).

## 2026-09-01 — DOCUMENT PIPELINE: one canonical page, and the blocker found

**NOTHING BUILT.** Canonical page **`docs/architecture/document-capture-ocr-and-deeds.md`**;
`document-capture-and-ocr-status.md` + `UW6_REV_document_byte_capture.md` bannered as
narrative/design; **DOC1–DOC7 filed**; prompt **`DOC1-cre-doc-text-window-jam.md`** staged.

**Scott's recollection was right and it was acted on.** He asked whether we needed to *"download
those deeds and mortgages at ingestion and store them somewhere to be processed later."* That was
the diagnosis and the decision — `UW6_REV_document_byte_capture.md`, merged **PR #1703 + #1707**.
**It worked: 1,057 of 1,177 gov domain documents (90%) carry durable bytes and deeds are 325/325
text — 100%.**

⚠️ **THE FINDING — a green cron has been returning `eligible: 0` over 695 waiting documents.**
There are **TWO** document stores and conflating them is why this topic keeps recurring:

| | domain store | **CRE registry** |
|---|---|---|
| table | `property_documents` | `lcc_cre_property_documents` |
| bytes column | ✅ `storage_path` | ❌ **none — `source_url` only** |
| consumer | deed parser | **BOV extract** |
| state | **deeds 325/325 ✅** | ⚠️ **76 of 771, permanently stuck** (FIXED next day — see the DOC1 BUILT entry above) |

`fetchEligibleCreDocs` (`cre-property-doc-text.js:265-290`) reads **only the newest `cap*4`=60**
registry rows and diffs out the done ones. Measured: **60 of 60 already done**, so `eligible` is
**0 forever** while **695 documents (ids 2→2250) are unreachable** — 446 leases, 256 DDs, 69 OMs
that never reach `bov-extract.js`. Crons 167/169 have returned HTTP **200** every 30 minutes
throughout. ⚠️ **Dead-End Class 12 for the THIRD time** (P135 fixed window, P136 re-checking the
same 120). **Same signature every time: green cron, honest-looking zero counters, nothing moving.**

⚠️ **And these are SharePoint paths — 100% of 1,066 rows, `/sites/TeamBriggs20/…`.** They do not
expire, are not session-bound, and **need no residential egress.** The CoStar problem never applied
to this store.

⛔ **I RETRACT MY OWN RECOMMENDATION FROM EARLIER TODAY.** I proposed widening cron 160 from
`doctype=deed` to `all` to drain 732 domain-store documents. **Refuted, and the check I wrote into
the page is what caught it:** `property_documents.raw_text` has **exactly one consumer and it is
deed-only** (`document-text.js:235-243`) — every other doctype returns `text_extracted` and nothing
reads the column again. Widening would spend DocAI/gpt-4o money to fill a column nobody reads.
**Filed as DOC7 so it is not re-proposed.** ⚠️ My claim that this blocked gov's firm-term gap was
also wrong — `runLeaseExtraction` re-fetches bytes itself from `folder_feed_seen` and **never reads
`property_documents.raw_text`. The gov docs assert a chain that is not wired** (DOC3).

**The lesson: a drain is only worth widening where something CONSUMES the result** — and the
measurement that settles it is grepping every read of the column.

Also filed: **DOC2** GovernmentProject docs stale and would buy unneeded egress · **DOC4** no cron
on `doc-bytes-backfill` · **DOC5** silent per-profile extension reload · **DOC6** brochures excluded.

⚠️ **Watch spend on DOC1's first run:** the pre-jam tier split was **12 rows on gpt-4o vs 3 on
`cloud_cheap`** — the 6–14× escalation shape, predating the 2026-08-12 DocAI fix. The 695 have never
been sampled.

## 2026-08-31 — C14 RE-located (§2h): a live producer defect, not an OCR pass — §2g was wrong

**NOTHING BUILT.** Design **§2h**; **C14 rewritten.** I set out to write the extraction prompt and
**checked first, per §2g's own instruction. Three checks, each of which changed the answer.**

1. **Is the date already in the row?** `deed_records.raw_payload` carries a **`recording_date` KEY on
   4,919 of the 4,995 undated rows** — which reads as a free win. ⚠️ **It holds a VALUE on 10.**
   4,985 are JSON `null`. **Not checking would have produced a promotion script that moved 10 rows.**
2. **Is there a document to extract from?** ⚠️ **No.** `deed_records` are scraper/AI **metadata**
   rows — **0 of them carry a `legal_description`** — and `property_documents` holds only **325**
   deed documents, **all 325 already text-extracted.** **The corpus an OCR pass would read is 325
   rows, already done — not 4,995.** §2g's framing was wrong.
3. **Is the producer still running?** ⚠️ **Yes. `created_at` spans 2026-03-27 → TODAY.** The county
   ingest lane (`run_county_ingest_cron`, W3.1, Railway) **is actively writing deed rows with no
   recording date.**

**So C14 is a LIVE PRODUCER DEFECT plus a re-fetch backlog:**

- ⚠️ **Fix the producer first — backfilling a live producer is Class 8**, a chore repeated silently
  forever. This is the opposite of the instinct, which is to backfill.
- **Then measure the re-fetch. 3,413 have a `source_url`**, but W3.1/§26 document county and CoStar
  URLs as frequently **`session_bound_or_dead`** to a datacenter fetch — **3,413 is an upper bound,
  not a plan.**
- **The remaining 1,582 have no document and no URL** — **not recoverable from what we hold.** An
  honest ceiling, and it should be stated before anyone promises full date coverage.

**The durable lesson, third time in this arc:** ⚠️ **a KEY is not a VALUE, a metadata ROW is not a
DOCUMENT, and a backlog is not a backlog if its producer is still running.** Each looked settled
until one query; §2g would have started at the wrong end of all three.

## 2026-08-31 — C14 located: it is deed DATE EXTRACTION, not data acquisition

**NOTHING BUILT.** Design **§2g**; **C14 promoted 🔴 → 🟢 with a specific, bounded fix.**

I recommended following B5's pattern — find a dated source nobody has consumed. **Measured, and the
answer is neither "the data is missing" nor "the events postdate the lease."**

- Over the 354 gov developer candidates: **351 have deed records (99%)**, 285 have sales. The deed
  era spans **1976 → 2026**; the candidate leases span **1997 → 2024**, comfortably inside. **Only
  14 leases predate any deed we hold.** So the corpus is there and the era is right.
- ⚠️ **The constraint is that only 824 of 5,819 gov deed records carry a `recording_date` — 14.2%.**
  **The documents exist, attached to the right properties. The date is just not parsed off them.**
- ⛔ **So this is NOT county acquisition** — the expensive answer B4/C2h explicitly warn is *"the
  most expensive conclusion available"* when the tables named after the answer have not been read.
- ✅ **It is a deed-date extraction pass**, and it plugs into machinery that already exists: the
  Document AI / `document-text-tick` deed drain (gov `CLAUDE.md` §26) and **ORE Phase 1 Unit C,
  which already extracts grantor/grantee ADDRESSES off these same deeds** — the parse path is proven
  on this corpus; the recording date is one more field off the same documents.
- ⚠️ **Never infer a date.** An honest gap beats a guess, and a fabricated acquisition date would
  corrupt **both** the developer test and pacing — the two things the extraction exists to unblock.
- ⚠️ **Re-measure before building:** 14.2% is one day's reading, and OCR crons 160/167/169 have a
  documented history of `active=false` with the CoStar byte-fetch blocked. **Check the chain is
  running before assuming it will pick these up** — the dated-blocker trap.

**Why this is the right next thread:** two independent high-value threads — `developer` (§2f) and
pacing (§2c-ii) — **bottom out here and unblock from the same extraction.** It is bounded (5,819
rows), the corpus is already attached to properties, the parse path is proven, and it needs **no new
external source and no new classifier.**

## 2026-08-31 — the developer reconciliation, measured: blocked on CHAIN DEPTH, not on the rule

**NOTHING BUILT.** Design **§2f**; **C15 updated · C14 promoted to the binding constraint.**

I recommended reconciling gov v5 against the June builder-vs-net-lease-buyer lesson. **The diagnosis
is right, the fix exists one domain over, and it cannot be applied.**

- **The defect is exact.** `v_gov_developer_candidates` takes the owner **AT** first-gen commencement
  and **never requires holding BEFORE** it. **dia v5 — same version, same date — HAS that guard**
  (*"held continuously from ≥90 days BEFORE the first long-term lease"*), and its header names the
  pattern gov admits: the **"took title at delivery"** case that *"historically mis-classified buyers
  like Carrollwood, Butler Trust as developers."* **Scott's definition demands the same ordering** —
  *acquired, renovated, THEN the lease starts.* One domain implemented it; the other did not.
- ⚠️ **But the dates to apply it do not exist. Only 1 of 354 candidates has a transfer dated at or
  before the first-gen commencement.** This is **not** "no history" — **all 354 candidate properties
  have ownership rows** and 70% of gov's 18,969 history rows carry a date. **The chain simply starts
  after the lease.**
- **So the 343 are not wrong — they are UNVERIFIABLE.** We cannot distinguish *acquired-built-leased*
  from *bought-at-delivery*. That is exactly what June deferred, **and it is deferred for a DATA
  reason, not a logic one.**
- ⛔ **Do NOT add the guard now** — it takes 343 → **1**, which measures chain depth, not precision.
  ⛔ **And do not relax anything to "fix" the 343**; they are honest output of a currently
  unverifiable rule. Label by confidence and state what is unverified.
- ⚠️ **This converges with C14, which is now the binding constraint on the entire design.** Pacing is
  50.7% dated; the developer chain reaches back on 0.3% of candidates. **Both are ownership-chain
  DEPTH and DATING** — the A1–A5 / B1 / B5 lane's subject (`BD_PIPELINE_FUNNEL`: **149 of 13,835 gov
  properties have 2+ historical owner links, 1.1%**). **The classification logic is settled; what it
  needs is history reaching further back.**

## 2026-08-31 — ⚠️ `developer` is NOT unbuilt: it is defined, live, and defective in a known way

**NOTHING BUILT.** Design **§2e**; **C15 corrected · C16 updated · C17 filed**; canonical banner added
to `docs/history/DEVELOPER_BD_AUDIT_v3.md`.

⚠️ **I claimed yesterday that `developer` was "under-specified by what we hold" and that "nobody has
measured" the behaviour. That was wrong, and it was wrong because I did not search before
concluding.** Scott: *"there should be tons of details on this somewhere."* **There are — five
generations, 2026-05-22 → today.**

- **Scott's definition was already the implemented one.** *"The first owner in the chain of ownership
  with our target tenant's first action in that building"* **is `v_gov_owner_at_first_gen`**, shipped
  2026-05-22 — *"owner at time T = the `new_owner` of the most recent transfer with
  `transfer_date <= T`."* **Live: 3,667 owner-at-first-gen rows · 354 candidates · 343 classified ·
  7,736 UW#7 chain candidates.** It even handles the **retrofit** case Scott named
  (`lease_anchored_to_year_renovated`) and carries a buyer counter-rule (>90 days after commencement
  ⇒ buyer).
- ⚠️ **But its output reproduces a failure LCC already killed.** The 343 are dominated by
  **address-named single-asset SPEs at 0.75** — `1020 Lantrip, LLC`, `211 STREET LLC`,
  `30th Street, LLC`. **Only 4 reach 0.85, and one is `GPT Properties Trust`, a REIT.** Both are
  documented twice-killed modes: *"the literal earliest-owner + BTS-timing rule produced
  single-property individuals"* and *"a REIT acquiring a BTS near construction is the BUYER in a
  sale-leaseback, not the developer."* **The gov v5 view was never reconciled against that lesson.**
  **The task is reconciliation, not construction.**
- ⭐ **C16 changes: do NOT invent a multi-label table.** `entities.developer_flag_sources` is already
  an **append-only `{source, confidence, observed_at}` JSONB array** — the exact set shape §2c says
  the design needs, **already built for one role.** `developer_status_active_until` (current-vs-former,
  3–5 years) and `v_entities_effective_role.is_current_developer` also already exist. **The 2026-05-22
  taxonomy migration anticipated most of this design.**
- 🟢 **C17 — consolidation:** `DEVELOPER_BD_AUDIT_v3.md` (3,334 lines) is **duplicated verbatim in
  three repositories.** A future chat reading either mirror gets 2026-05-22 implementation claims
  with **no supersession notes** — exactly the misdirection Scott asked to eliminate. The
  life-command-center copy now carries a canonical banner; ⚠️ **the two mirrors need the same banner
  or deletion, and that is a cross-repo edit this PR cannot make.**

**The durable lesson: "nobody has measured this" is a claim about the repository, and it requires
searching the repository.** I asserted it twice without doing so.

## 2026-08-31 — Scott's definitions land: the role is MULTI-LABEL, and C13 is superseded

**NOTHING BUILT. C13 ⛔ superseded before it ever ran** — which is the staging working as intended.
Design rewritten §2c–§2c-iii and §6; **C14 / C15 / C16 filed.**

⚠️ **One line changed the SHAPE of the design, not its content:** *"I think these categories can
exist multiple iterations per one account."* Everything I had built assumed **one role per entity
resolved by precedence.** It is a **SET**.

- **Measured, and the truncation would fall exactly where it hurts:** **957 entities carry 2+
  labels — 772 of them `investor_owner` + `repeat_buyer` simultaneously.** Scott's own rule is that
  this combination *"might take a group from a seller prospect to a buyer prospect… depending on the
  pacing."* **A scalar column picks one label and silently destroys the other, on precisely the
  population whose dual status decides how it is worked.** → **C16** (storage shape).
- **Definitions, all corrected against mine:** `one_off_owner` is an **INDIVIDUAL** with one target
  asset (**143**, not my 2,448 orgs) · `investor_owner` is deliberately **broad**, SPEs included
  (**6,469**) · `repeat_buyer` is ≥2 acquisitions (**3,258**) **with pacing as a weight, not a
  label** · `user_owner` confirmed as a human lane.
- 🔴 **C14 — and it is now the highest-value item here.** Pacing is the dimension Scott says drives
  BD treatment, and **`ownership_start_date` is present on only 50.7% of portfolio facts.**
  ⚠️ **The "2,627 repeat buyers dormant 5+ years" figure is roughly half MISSING DATES, not
  inactivity** — I checked before reporting it, and reporting it as pacing would have been the P180
  failure on the one signal that matters most. **Pacing must surface as `pacing_unknown`.** This is
  **data acquisition, not classification.**
- 🔴 **C15 — `developer` is under-specified.** Scott describes a *behaviour* (build-to-suit for a
  named tenant, then sell for the cap arbitrage); we hold a **name label**. Detecting the real thing
  needs acquire→build→sell sequences, unmeasured. **Keep the 715 as a captured attribution; do not
  claim it is the behaviour.**

## 2026-08-31 — C13 staged: the C4a build is written and blocked on five decisions

**NOTHING BUILT, and deliberately nothing more investigated.** Prompt:
`docs/claude-code/prompts/C13-owner-role-derived-classification.md`. Backlog **C13 ⛔ staged**;
design doc §6 now points at it.

**C4a is fully specified and every input is measured** — the definitions (Scott's), the populations
(292 / 2,448 / 3,795 / ≤13), the churn (3 ended, 1 started in 90 days), the guards (6 / 3 / 124),
and the routing (§4: no gate, a BD-activation band). **There is nothing left to discover before
building it**, so the prompt is staged rather than another measurement being run.

⛔ **It does not run until the five §6 decisions are answered, and three of them change what gets
written.** Staging it now means the answers go straight to Claude Code without another round trip —
which is the "automate as much as we can" constraint applied to the workflow itself.

**Predicted deltas are in the prompt and include the safety assertions:** `unknown` orgs ↓ ~6,600 ·
**P0.4 unchanged at 555** · deal-timing bands unchanged (C6 removed the role from them) · brief
little or no change (C8's resolved-owner arm already admits most). ⚠️ **If P0.4 moves, the routing
is wrong — stop**, which is the whole point of C4f.

⚠️ **Two things the prompt carries forward as unmeasured, on purpose:** the precedence overlap
(entities that both hold and buy repeatedly — *measure it, do not assume it is small because the
ordering looks obvious*), and a **re-measurement of the churn** before relying on derivation.

## 2026-08-31 — C4f answered: P0.4 needs no gate; the flood was a routing error

**NOTHING BUILT.** `owner-role-classification.md` **§4** rewritten; **C4f ✅ answered**; new Dead-End **Class 31** (*a precondition correct on one surface is wrong on a neighbouring one*). ⚠️ **Numbered 31, not 30 — I collided again**: a parallel window took 30 for C10 hours earlier, and **the guard note I added at the top of the playbook on 2026-08-29 did not stop me, because the workflow appends at the bottom and never scrolls up.** That caveat is now in the note itself. This removes
the last unmeasured input to Scott's C4a decision — **both fixes I had proposed are refuted.**

**P0.4's existing 555 rows, measured:** **371 (67%) hold no current asset · 469 (85%) have NO KNOWN
RENT · ZERO are contactable.**

- ⚠️ **A value floor is the wrong instrument — 85% of the band has no known rent**, so it would
  suppress on **ignorance, not value** (P180 NULL-is-not-zero). **C12's option B is refuted by its
  own population.**
- ⚠️ **And C6's reachability precondition is ALSO wrong here — it would take P0.4 to 0 rows.** It
  looked like the obvious parallel because it worked on the deal-timing bands. **But P0.4 is a
  RESEARCH band**: you resolve ownership control by reading deeds and SOS filings, not by calling.
  **Reachability is the right precondition for a call and the wrong one for research** — copying it
  across would delete 555 rows of legitimate work. *The technique does not transfer just because
  the surface looks similar.*
- **The real problem is two kinds of work under one label.** The 555 are **research**; C4a's 2,949
  newcomers are **BD activation** — we already know who owns it and nobody has started.
  ⚠️ **An entity C4a has just classified has had its ownership resolved — that is what the
  classification IS — so it should never enter a band asking to resolve ownership.**
- ✅ **Route the newcomers to a BD-activation band (P0.5's shape): 290 reachable today**, the rest
  queue behind contact acquisition. **P0.4 stays at 555 doing research. The "6× flood" was an
  artifact of routing them into the wrong band, not something to gate down.**
- 🔴 **Noted separately, and not a defect this design creates: P0.4 does upstream research whose
  output nobody consumes as a call (0 of 555 contactable).** A Consumption-Layer question of its own.

**C4a is now fully specified and every input measured.** Remaining is Scott's: confirm
`one_off_owner` + `investor_owner`; `former_owner`; `user_owner` as a human-confirmed lane (n=13);
view vs recomputed column; and the newcomer routing above.

## 2026-08-31 — C4a §2d: the landlord gap sized, and it needs TWO states

**NOTHING BUILT.** `docs/architecture/owner-role-classification.md` **§2d**; backlog C4a updated.
This closes §6 Q1, which I had flagged as the biggest remaining gap.

The 6,308 current holders are **not one population** — they split along the distinction Scott
stated at the outset (*"developers treated differently than one-off owners, who are treated
differently than buyers"*). Of the **3,217 that are currently `unknown`**:

| proposed state | entities | current rent | contactable |
|---|---:|---:|---:|
| **`investor_owner`** — 2+ current assets | **292** | **$583.9M** | 54 |
| **`one_off_owner`** — 1 asset, no buying activity | **2,448** | **$523.1M** | **279** |
| single-asset but active | 477 | — | — |
| SPE-shell-named | 35 | — | — |

⚠️ **The one-off owners are the finding and they invert the intuition: they carry nearly as much
rent as the investors ($523.1M vs $583.9M) and are FIVE TIMES more contactable (279 vs 54).**
Scott's sweet spot is single-tenant deals at $2M–$20M reached through volume with repeat sellers —
**the one-off owner of a single net-leased building IS that market.** A vocabulary with only
`investor_owner` would name the smaller, less reachable half and leave the core of the business in
`unknown`. **Two states are required, not one.**

- **Both are deterministic from recorded facts** — a count of current portfolio rows and a count of
  `purchases` edges. **No name test, no inference.**
- ⚠️ **The 477 single-but-active and 35 SPE-shell-named are surfaced separately, not forced into
  either bucket.** Accuracy-first: an honest `unknown` beats a guess.
- 👤 **Remaining for Scott:** confirm the two names and that they are prospected differently;
  `former_owner`; `user_owner` as a human-confirmed lane (n=13); view vs recomputed column; and
  **P0.4 (C4f)**, still deliberately unbundled.

## 2026-08-31 — C4a definitions CORRECTED by Scott; my `user_owner` draft was wrong by ~3 orders

**NOTHING BUILT.** `docs/architecture/owner-role-classification.md` rewritten §1–§2c.

⚠️ **Scott defined both states and my first draft had `user_owner` badly wrong.** He: *"`user_owner`
is when a tenant like DaVita acquires the real estate to occupy it… as opposed to leasing it."*
**I had defined it as "holds ≥1 current portfolio asset" — 6,308 entities, i.e. just *an owner*.**
It would have labelled every REIT, fund and landlord an owner-occupier. **`user_owner` is about
OCCUPANCY, not ownership** — the "user" is the user of the space. Same failure this arc keeps
finding: **I reached for the fact that was easy to compute rather than the one that answers the
question.**

- **The real signal is owner ≈ tenant ON THE SAME PROPERTY** (`lcc_property_attributes.tenant_short`)
  — a comparison *within one row*, far more constrained than matching two arbitrary owner names,
  which is why it survives where this arc's rejected lexical classifiers did not.
- **Measured over 8,237 held properties carrying a tenant: 13 candidates, ~10 genuine** — Mayo
  Clinic Dialysis, Sanford Health, Northwest Kidney Centers, Puget Sound, Gundersen Lutheran,
  Michigan Kidney Consultants, Wake Forest, Atlantis, Centers for Dialysis Care, Concerto Missouri.
- ⚠️ **The 2 clear misses share ONE shape — an SPE/DST named after its tenant**
  (`FSC FMC Carbondale IL DST`, `USGBF NIAID LLC`). The sponsor↔SPE pattern from a new direction.
- ⚠️ **At n=13, human confirmation is cheaper AND more accurate than any name rule.** Scott's
  ordering is accuracy first, automation second — so **`user_owner` is a human-confirmed lane, not
  an automated arm.** The automation worth having is surfacing the 13, which is one query.
- ⚠️ **Wake Forest and Mayo sit in the `not_prospected` guard's territory. They are still correctly
  `user_owner`** — the role is a fact about them; whether we prospect them is a separate gate.
  **Do not let a prospecting guard suppress an accurate role.**
- **`former_owner` confirmed and structurally clean: 3,795 — 2,071 gov + 1,727 dia, ZERO other
  domains**, so "used to own in our target market" is guaranteed, not assumed. **784 sold ≤3y,
  1,537 ≤5y, 191 contactable today.** ⚠️ **Carry recency separately — do not bake a cutoff into the
  label**, or the role starts lying the day the cutoff stops matching how Scott works.
- ⚠️ **NEW and bigger than the gap I originally reported: under the corrected definitions, NO role
  describes the ordinary owns-and-leases-out landlord — 6,308 entities.** They would stay `unknown`.
  A further state (`investor_owner` or similar) is probably what accuracy requires. **§6 Q1.**

## 2026-08-31 — C4a DESIGNED to Scott's constraints; `former_owner` is the finding

**NOTHING BUILT.** Canonical design: **`docs/architecture/owner-role-classification.md`** — a new
sibling page, linked from `bd-ranking-and-priority-queue.md`, `CURRENT-STATE.md` and the backlog.
**C4a 👤 designed · C4f 🔴 filed.**

Scott's four constraints, and what each settled:

- *"most accurate determination possible as the guiding principle"* → ⚠️ **RETIRES C12's option B**
  (classify + gate P0.4 to hold the flood down). **Suppressing an accurate determination to protect
  an ungated band is the wrong trade.** P0.4's missing value gate is P0.4's defect — filed **C4f**.
- *"can change over time, isn't a one-time determination"* → ⛔ **no one-shot stamped column**
  (Class 8). **Derived and re-computed.** ✅ **And that is safe: churn is 3 holdings ended and 1
  started in 90 days**, so a re-derived role is stable, not flapping.
- *"automate as much as we can, secondary to accuracy"* → automate the decidable; `unknown` stays an
  honest absence and will remain large. That is correct, not a failure.
- *"resolution at the entity level would limit the work"* → one determination per entity, ~10k.

⚠️ **The finding that matters: the vocabulary cannot express the most valuable state.**
**3,795 organizations owned before and hold nothing now — 2,784 still typed `unknown`.** Scott's
model is *"volume with repeat seller clients"*, so **a party that has sold to us before is the
highest-value prospect in the business**, and the five declared roles have no word for it.
**`former_owner` is required for accuracy** — without it a correct classifier concludes "not
currently an owner" about 3,795 real parties, which is true and useless.

**Design:** recorded facts only — operator flag (P113) · holds ≥1 current fact (6,308) ·
**former owner (3,795)** · ≥2 `purchases` edges (2,478) · the developer classifier — behind the
existing brokerage / placeholder / not-prospected guards. **No lexical classifier anywhere**
(~25% raw, 7%, 4-of-6 guarded across this arc). `role_source` is mandatory; a manual
`behavioral_override` always wins.

👤 **Four open questions in §6:** confirm `former_owner`; precedence when an entity both holds and
buys repeatedly (recommended `user_owner`, ⚠️ **overlap unmeasured**); view vs recomputed column;
and P0.4 (C4f, deliberately not bundled).

## 2026-08-31 — C12: C4a sized into a decidable question (decision brief, nothing built)

**NOTHING WRITTEN, nothing recommended for build.** 👤 **This is a decision brief for Scott** —
`docs/audits/C12_C4a_DECISION_BRIEF_2026-08-31.md`; canonical §7 decisions table updated;
**C4a 👤 sized · C4b 👤 settled in principle.**

- **The classifier is easy and the signal is clean: 3,217 `unknown` organizations hold a current
  portfolio asset** — a **recorded fact**, not a name guess. Top 16 by rent read Easterly (85
  assets / $114.9M), NGP Capital, USAA, US Fed Properties Trust, Government Properties Income
  Trust, Elman, Piedmont REIT. Guards over the whole set: **brokerage 6 · placeholder 3 ·
  not-prospected 124** (GWU among them — the drop-universities decision already covers it).
- ⚠️ **The blast radius IS the decision: 2,949 of the 3,217 would enter P0.4, taking it 555 →
  ~3,500** — 6× the band that already makes the queue 57% data-completion work, **because P0.4 has
  no value gate**. ⚠️ **The deal-timing bands are unaffected** (C6 removed the role from them) and
  the prospecting brief barely moves (C8's resolved-owner arm already admits most).
- ⚠️ **Worth stating plainly: P0.4's job is *resolve ownership control*, and these 3,217 are exactly
  owners whose control is unresolved — admitting them is arguably CORRECT. It is also 6× a band
  nobody is working.** Correct and unusable are not mutually exclusive.
- **Three options, each with its measured consequence** (A absorb / **B classify + gate P0.4** /
  C retire `user_owner`). ⚠️ **Which floor B uses is its own question — five distinct $500k floors
  exist (§4g) and any new one must be NAMED.** At ≥2 assets the set is 292; at ≥5 it is 30.
- **C4b is settled in principle: `user_owner` is not a mistake to remove — it is a role with an
  obvious producer nobody built.** Its disposition follows C4a and must not be decided separately.
- ⚠️ **Named as unmeasured:** whether a P0.4 floor would apply to newcomers only or to its existing
  555 rows — **different changes, different consequences, and it matters for option B.**

## 2026-08-31 — C11 SHIPPED; the call-sheet arc is COMPLETE, and C11a is refuted

**C11 is LIVE** — the sheet now states the BASIS on which each person is the contact. **C6 → C8 →
C10 → C11 are all shipped: 126 rows, correctly gated, legible, each justified.** Canonical **§4b**
is the new "state of this surface" section. **C11a ❌ refuted · C9 re-scoped.**

- ⚠️ **C11a is NOT a defect.** `institution_decision_maker` reading **0-for-35** on employer
  corroboration is the **sponsor↔SPE pattern** — the arc's most recurrent finding (A3 32-of-74,
  P188/P196, C2h's 69 pairs). Named rows: **`ar-global.com` serves six `ARC GS…001, LLC` SPEs**
  (AR Global); `princetonholdingsllc.com` two FGF SPEs; `usrealco.com` two US… entities; 7 are
  gmail/aol on genuine individual owners. **34 contacts / 20 domains — they cluster because a
  sponsor's people serve its SPE family.** `lcc_tier0_company_confirms_domain` **structurally
  cannot** confirm a sponsor domain against an SPE name. Compare `prospecting_contact`: 58 rows /
  55 domains / 15 corroborated — near 1:1, different provenance.
- ⚠️ **The obvious fix was measured and rejected: wiring `lcc_owner_sponsor_domain` into the
  corroboration signal rescues 1 of 34.** The map holds 8 confirmed rows; only 4 sheet rows
  fleet-wide sit on a known sponsor domain; and `hpitx.com` — already confirmed — still fails
  because `TEP Houston DHS` lacks the `hpi` token. **Populate the map (C2i) before wiring it.**
- ⚠️ **C9 re-scoped: its 45 true splits touch exactly ONE of the 126 sheet rows.** 35 sheet rows sit
  in some name group; 1 is a true split. **C9 is real but is not a call-sheet problem.**
- **What is left on this surface is ~4 rows of 126** — C11b (a cadence contact is **Scott himself**,
  1), C11c (brokerage guard blind to a broker in the **contact** slot, 2), C9 (1).
  **The surface is in good shape; further polishing here has sharply diminishing returns.**
- **The remaining leverage is upstream: C4a** (what promotes an owner out of `unknown` — still
  governs the 57% data-work share, and it is Scott's doctrine call) and **C7a** (mailbox coverage —
  the precondition under assignment, voice corpus, deal attribution and draft-assist alike).

## 2026-08-31 — C10 SHIPPED (the sheet is legible); C11 prompt written for what it exposed

**C10 is LIVE.** All 126 rows render a real name and portfolio value; gate, ordering and limit
untouched, count held at 126. **C8's benefit is only now visible** — Easterly reads
"$114,864,150 across 85 properties" instead of "Unknown … rent unknown". Guard
`test/prospecting-brief-column-mapping.test.mjs`. **C10b 🟢 build-ready as C11.**

- ⚠️ **Two of my C10 brief's predictions were wrong, and CC measured rather than accepting them.**
  **4 rows DO carry a null `rank_value`**, and **`[mixed]` was a genuine null `domain` on 74% of
  rows**, not a mapping defect — still dishonest to print, but a different one (**C10a**:
  `is_cross_vertical` is never read). That is the right instinct and worth naming.
- 🟢 **C10b is next and it is small.** The sheet names a person and gives **no basis**. Only **16 of
  113** contact emails corroborate the owner domain — ⚠️ **a LOWER BOUND, not "97 are wrong"**
  (P188: Easterly's own confirmed contact is `@centurytel.net`). ⚠️ **And only 12 of 126 owners are
  on the Tier 0 lane**, so routing there is not the answer either.
- **What we hold and never print: 121 of 126 carry a contact↔owner edge with a role** —
  `prospecting_contact` 58 · `institution_decision_maker` 35 · `manager` 15 · **`works_at` 12** (the
  SF org edge **P161 disqualified** as evidence of control) · `decision_maker` 1 · **no edge 5**.
- **The fix is to PRINT THE BASIS, not filter on it.** ⚠️ Filtering on corroboration would drop ~97
  rows on a lower bound — the Class 24 mistake C8 just fixed.
- 🔴 **C8a correctly re-characterised by CC: inert, not mismapped.** Its mapping is real for
  `unified_contacts`; the branch is dead because `engagement_score` is 0 on all 30,714 gov rows.
  **The open decision is whether to delete it.**

## 2026-08-31 — C6 + C8 both SHIPPED; C10 prompt written for the defect C8 exposed

**C6 and C8 are LIVE.** C8: migration `20260831120000` (+`is_resolved_owner`, `is_brokerage` on
`v_bd_cadence_dashboard`), gate composed in `handleProspectingBrief`, guard
`test/c8-prospecting-brief-gate.test.mjs`. Canonical `bd-ranking-and-priority-queue.md` §3 updated;
backlog **C8 ✅ · C8a 🔴 · C8c 🟢 build-ready**.

- **C8 landed 80 → 126, not the predicted 127, and the miss was informative.** Every other figure
  reproduced exactly. ⚠️ **§2 sized the brokerage population by reading only the EXCLUDED half —
  there are 4 of 311, not 3.** `Stan Johnson Co` carries `owner_role='buyer'` and **was being
  shown**; the explicit guard drops it, so the delta is **+47 − 1**. **A population counted on one
  side of a gate is not the population.**
- ⚠️ **P116's false positive appeared and costs nothing.** Of the 4 flagged, three are genuine;
  **`Clark Matthews` is the bare-surname false positive** — but he is `unknown`, owns no asset and
  fails the OR arm anyway. **The guard is outcome-bearing for exactly 1 of 4.**
- **At `limit=10`, 9 of 10 slots change** — Easterly enters at rank 2; NGP, USAA, US Fed Properties
  Trust, Elman, Trammell Crow, Beacon reach page 1 for the first time. **A REACH fix, not a count
  fix** — which is the right way to judge it.
- 🟢 **C8c is the next build and it is the important one:** the handler maps `c.name` /
  `c.company_name` / `c.annual_rent` / `c.priority_signal` while the view supplies **`entity_name`**
  / *(none)* / **`rank_value`** / *(none)*. **Four of six meaningful fields are dead on the queue
  path.** ⚠️ **C8 just put Easterly and 45 more on the sheet and every one renders "Unknown".**
  ⚠️ **It plausibly explains why the role gate went unexamined for so long — an illegible sheet is
  not one anyone works. Two defects, each making the other harder to see.**
  Prompt: `docs/claude-code/prompts/C10-prospecting-brief-field-mapping.md`.
- 🔴 **C8a:** the fallback branch is ungated **and structurally dead** (`engagement_score` = 0 on all
  30,714 gov rows). **Not a `V2_MAP` failure** — a different source that never carried the gate and
  cannot. **Do not re-implement the guard there; decide whether to delete the branch.**

**Repo hygiene this pass:** CC had already filed C8a/C8c in the backlog and I added duplicates —
**merged to one row each**, keeping CC's richer detail and adding the build pointer.

## 2026-08-29 — C9 split rate measured: 45 groups, not 181 (and my first metric was wrong)

**NOTHING WRITTEN.** Folded into `C9_...md` **§7**, canonical **§3**, backlog **C9** revised,
**C9b** filed. Measured before building the lane C9 recommended — which changed its scope 4×.

- Of **5,131** canonical-name groups with ≥2 live organizations: **45 are TRUE splits** (facts on
  one member, cadence/contact on another) — 0.9%. ⚠️ **C9's headline "181 of 303 (60%)" was
  EXPOSURE and reads alarming.** **A lane scoped to 45 is a morning's work; 181 was never
  justified by the measurement.**
- 🔴 **C9b filed: 434 groups hold their relationship history on the twin that does NOT hold the
  facts** — an order of magnitude larger, and it is **P177**'s defect (Gardner Tanenbaum's 240
  relationships sat off the entity holding its 13 assets). It **under-ranks** rather than
  misdirecting a call. **Sized, not addressed.**
- ⚠️ **My first defect metric was WRONG and the named rows caught it.** Counting C6 owners with
  `lcc_property_owner` assets = 0 gave **33**, which I was about to report as the defect set.
  Reading them showed case-variant pairs — `10668 SIERRA, LLC` / `10668 Sierra Llc`,
  `1300 LAFAYETTE PKWY, LLC` twice byte-identical — **where BOTH members hold zero.** Nothing split.
  **`lcc_property_owner` (resolved owner) is not `lcc_entity_portfolio_facts` (what the bands
  read).** Two ownership tables, two questions; substituting one produced a plausible number that
  meant nothing. *Verify on named rows* caught a defect in the **instrument**, not the data.

## 2026-08-29 — the role-gate sweep: there is no third surface (C8's open gap, closed)

**NOTHING WRITTEN.** Folded into `docs/audits/C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md`
**§5** and canonical **§3** rather than opening a new audit.

C8 left *"whether any other handler carries an equivalent gate"* unmeasured. **Leaving it unswept is
exactly how the prospecting brief survived C6**, so it was closed the same day.

- **JS:** 22 `owner_role` hits across `api/` + the SPA; **exactly one is a FILTER**
  (`api/operations.js:4807`). The rest are display projections, `select=` lists, or writes.
- **DB:** of **14** `public` views mentioning `owner_role`, **exactly one FILTERS** on it —
  `v_priority_queue_live`. The other 13 select only.
- **So the entire system contains TWO role gates: one view, one handler.** C6 fixed the first;
  **C8 completes the Class 24 remediation.** The problem is now bounded.
- ⚠️ **Positive-controlled** (Class 11) — the detector fired on the known true positive and
  correctly called `v_bd_cadence_dashboard` *selects only* (its gate is in JS).
- ⚠️ **Limits stated, not glossed:** `pg_views.definition` is **deparsed** (P182), and a gate via a
  JOIN to a role table, inside a function, or in an RLS policy would not match. Matviews not
  separately enumerated.

## 2026-08-29 — B6d-cms: a 30-day throttle on a daily cron, latched by its own crashes

**FIXED IN CODE (Dialysis `fc342b3`); the restart ships on the next Railway run.** Audit
`docs/audits/B6d_cms_INGESTION_REPAIR_2026-08-29.md`; backlog **B6d-cms ✅**, three follow-ups filed
(**B6d-cms-restart** 👤, **-escalation**, **-lock**); parent B6d §3a corrected; live
`feed_freshness_registry.expectation_basis` corrected in place. **SLA untouched at 45d.**

`medicare_clinics` unfed since **2026-06-25** (65d stale) while CMS published **2026-08-25**. Two
coupled defects, **neither of which ever recorded an error**: `main()` gated on **`if days_ago >= 30`**
— a calendar throttle capping a **daily** (`0 6 * * *`) cron at ~one ingest/month against a p50 2-day
republish cadence — and `get_last_ingestion_meta()` took the newest tracker row **of any status**, so
a run killed mid-flight recorded CMS's new publish date and **suppressed its own retry**. A latch.
⚠️ **Removing the throttle alone would have fixed nothing.**

⚠️ **Three premises in the brief were wrong.** `cms-ingestion-daily.yml` **does not exist** (deleted
2026-07-29, `5d54fd7`; it is the Railway `cms-ingestion` cron) — so the Actions logs it pointed at
hold nothing, and that stale name had already propagated into the live registry basis. The
"40 failed + 16 abandoned" totals **lump `source='ingestion_lock'` janitor rows in with pipeline
runs**, and the runs were **never daily**: **7 attempt-days in 100, spaced 31 days** — the throttle
was visible in the calendar before any code was read. And **no failure carries a CMS error**; every
`error_log` is a janitor artifact. Since the code writes a real traceback on an exception, **the
absence of one is the evidence: the process is killed, not failing.**

⚠️ **The measurement that reframed it — find what the job writes on EVERY run.**
`cms_dataset_updates` shows **99 of the last 100 days, including 06:02 that morning**, so the cron is
healthy and CMS egress works. That killed a well-fitting "Railway credit exhaustion" hypothesis (the
month-end clustering matched it) and turned *"the cron isn't running"* into *"it runs and skips"*.

**Still open and honestly handed off:** *why* each attempt died. No traceback ⇒ a hard kill (suspect
container OOM on the ~45-min `medicare_ingestion` step); **Railway deploy logs are the check and the
sandbox cannot reach them** (proxy denies `data.cms.gov` too, so nothing was re-run live). ⚠️ **Do
not retry with `FORCE_RUN=true`** — it propagates `force=True` into the lock, which force-reclaims the
run's own tracker rows; a plain Redeploy suffices. **Verify on `source_last_seen` advancing past
2026-06-25 and the `feed_stale` alert auto-resolving — never on `medicare_clinics.updated_at`**, which
the econ denorm keeps fresh and which read healthy straight through the outage.

Guard `test_b6d_cms_ingestion_throttle.py`: 8 tests, **4/4 mutations RED**, comments stripped first
(the fix's own comments quote `days_ago >= 30`). Suite **2919 passed / 52 failed, failure set
byte-identical to the pre-change baseline**.
## 2026-08-29 — C9: C8b REFUTED; the merge backlog is now on the operator surfaces

**NOTHING WRITTEN.** Audit `docs/audits/C9_MERGE_BACKLOG_REACHES_THE_OPERATOR_SURFACES_2026-08-29.md`;
canonical **§3**; new Dead-End **Class 29**. **C8b ❌ refuted · C9 🟢 · C9a 🔴 filed.**

⚠️ **I filed C8b wrongly and it is corrected in place in the C8 audit AND the C8 prompt.** I claimed
`Brandywine Realty Trust` at $34,920,891.77 / 0 properties was the N18 fabricated `attributed_rent`
value. **Refuted: Brandywine genuinely owns the highest-rent gov property (11504); the value is
real.** ⚠️ **The tell I skipped was visible at the time — `rows_equal_to_gov_max = 1`.** N18's defect
was systematic (11 distinct values over 277 candidates); **a population of one is not a systematic
artifact.** New **Class 29**: *a value that matches a known-bad aggregate is a hypothesis, not a
finding* — reproduce the MECHANISM, not the number.

**The real defect is worse.** Three live entities share `canonical_name = 'brandywine realty'`, none
merged: **assets + contact on one, cadence + 36 edges on another** — the P177/P198 split (Gardner
Tanenbaum's shape). ⚠️ **The detector is NOT broken** — it surfaced the group at `member_count=3,
auto_mergeable=false` and correctly declined genuine name variance. **It has never been reviewed.**

- **5,194 merge groups, 3,006 auto-mergeable. 181 of the 303 C6 callable owners (60%)** share a
  canonical name with another live entity; 415 queue entities; 50 brief-eligible.
- ⚠️ **181 is EXPOSURE, not confirmed splits** — the split was verified on ONE named row; the
  population rate is **unmeasured**.
- **C6 changed the cost.** Duplicates were hygiene when 74 owners reached these bands; with 303 on a
  call sheet **ranked by a value that lives on whichever twin holds the portfolio fact**, a
  duplicate is a wrong row an operator works.
- **Recommendation: a value-ranked review lane scoped to the 181 + 50 that are operationally live —
  NOT a bulk merge.** P195's hazards stand and `lcc_apply_fuzzy_merges` stays unwired. ⚠️ **Winner
  rule is ownership-first** — the survivor is the asset+contact holder, not the more-connected twin.
- 🔴 **C9a filed:** should `connected_property_value` feed `rank_value` at all? **146 rows carry a
  rank value with 0 current properties.** Unexamined design question, not a defect on its face.

## 2026-08-29 — C8: the prospecting brief hides $515M of resolved owners (C4b resolved as inert)

**NOTHING WRITTEN.** Audit `docs/audits/C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md`;
prompt `docs/claude-code/prompts/C8-prospecting-brief-admit-resolved-owners.md`; canonical **§3**.
**C4b ✅ resolved · C8 🟢 build-ready · C8b 🔴 filed.**

- ⚠️ **C4b was mis-sized by me last round and is corrected.** Removing `user_owner` is a **literal
  no-op** (0 rows). *"Governs 46% of the surface"* **conflated the GATE with the ARM** — the gate is
  load-bearing, the token inside it is inert. `seller_flipper` is also 0; **`unknown` (93.9%) is not
  in the declared `BD_OWNER_ROLES` vocabulary at all.**
- ⚠️ **P0.4's gate IS load-bearing — 703 gated vs 66,167 ungated (94×)** — because P0.4/P0.5 have
  **no bounding JOINs**. **So C4 §5's 62,554 is CORRECT for that arm**: the right number attached to
  the wrong arm. **Class 23 in mirror image — the same predicate on two arms has different blast
  radii; measure each.**
- **The real finding: the same Class 24 defect on a SECOND, live, operator-facing surface.**
  `handleProspectingBrief` shows **80 of 311** eligible rows. Of the 231 excluded as `unknown`,
  **47 are resolved owners carrying $515.2M — more than the $442.8M it shows** — against **3**
  brokerages. **Easterly ($114.9M, 85 properties), NGP Capital, USAA Real Estate, US Fed Properties
  Trust, Gardner Tanenbaum, GI Partners, Trammell Crow, Clarion Partners** are all excluded.
  **16 of the top 18 excluded rows are resolved owners; zero are brokerages.**
- **The gate's INTENT is right** (its comment says brokers polluted the call sheet) — `owner_role`
  is the wrong instrument. Fix is C6's rule: admit on the per-asset fact, with an **explicit**
  brokerage guard. **80 → 127 rows, +$515.2M.**
- 🔴 **C8b filed:** `Brandywine Realty Trust` at **$34,920,891.77 / 0 properties** is the N18
  fabricated `attributed_rent` value (the gov-wide `max`). **N18 fixed one consumer; `rank_value`
  is another and was never checked.**

## 2026-08-29 — C7: broker assignment is premature, not broken (diagnosis; recommendation is NOT to build)

**NOTHING WRITTEN.** Audit `docs/audits/C7_BROKER_ASSIGNMENT_IS_PREMATURE_2026-08-29.md`; canonical
**§6 rewritten**; **C4c moved to ⛔ do-not-build**; **C7a filed**.

C4c was my own recommendation last round — *"a build rather than an investigation, with a documented
answer and a documented trap."* **Measuring it first refuted that.**

- **The bridge is not broken.** 161 of 161 `lcc_entity_owner_override` rows resolve through
  `v_lcc_entity_point_person`. The documented three-user-table trap is real **and already solved**.
- ⚠️ **It is empty, and the two populations are DISJOINT: 0 of the 303 C6 owners has an
  assignment.** A propagator would move **0 rows** for the population C6 just surfaced — **P137**,
  a consumer wired to a producer that does not exist, reporting success while moving nothing.
- ⚠️ **No derivation signal exists.** 263 of 303 C6 owners have a contact email; **13 have ever
  been emailed; 1 distinct sender.** Only one mailbox has ever been ingested.
- ⚠️ **The real reason: `lcc_users` has 4 rows and one is active.** The queue belongs to nobody
  because the team has not started working it, not because the plumbing failed.
- ⚠️ **Do NOT default-stamp 303 owners to Scott** — the "status nobody earned" failure (A5
  `gap_resolved`, B6b-lead `filtered_multi_tenant`). A UI default or filter is free; a row is not.
- 🟢 **C7a filed — mailbox coverage.** One ingested mailbox bounds every relationship signal in the
  system, not just assignment; `contact-reconciliation-outbound.md` hits the same wall. **It was
  filed nowhere before.** Sized at zero, deliberately.

## 2026-08-29 — C6 SHIPPED: the seller-side bands now gate on current holding + reachability

**LIVE on LCC Opps.** Migration `supabase/migrations/20261002110000_lcc_c6_current_holding_seller_bands.sql`;
evidence `docs/audits/C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`; canonical
`docs/architecture/bd-ranking-and-priority-queue.md` (**§3 rewritten — the old gate is RETIRED**).

**All four predicted deltas hit exactly** (verified live off `v_priority_queue`, cache refreshed):
**P1 74→149 · P2 32→95 · P3 61→163 · P8 76→213 = 620 rows / 497 assets / 303 owners.**
P5 58 · P0.4 555 · P0.5 148 · P-CONTACT 231 · P-BUYER 22 · P4 12 and all dia held.
⏰ **All 14 owners with a gov lease inside 90 days who were contactable-and-invisible now appear.**

**Doc corrections made in this pass** — the canonical page had four passages that went stale the
moment C6 landed:

- **§3 presented the RETIRED role predicate as the live gate** and still said "observed P1 = 74".
  Rewritten to show what actually runs, with the old form kept beneath it, labelled retired.
- **The "73% data work" line used the pre-C6 denominator.** It is **934 of 1,646 (57%)** now —
  ⚠️ and **both numerator and denominator moved**, so the percentages are not comparable: the
  data-completion rows did not fall, **the deal-timing rows doubled underneath them.**
- **"1,924 owners are invisible / 224 contactable" was present tense.** Past-tensed; the reachable
  half is closed, and ⚠️ **the unreachable ~1,700 remain invisible DELIBERATELY** (P112) — they are
  a contact-acquisition backlog, not a queue backlog.
- **Broker denominator** 14 of 1,267 → **14 of 1,646**.

⚠️ **New fact worth acting on: C6 cleared `gov_owner_props` only. Four `effective_owner_role = ANY`
predicates remain** (counted live off `pg_get_viewdef`) — the two-value form still gates **P0.4 +
P0.5 + P5 = 761 of 1,646 rows**, P4 uses a three-value form. **A gate arm that has never matched a
row still governs 46% of the surface** (C4b, re-sized from cosmetic to real).

⚠️ **C6 also made C4c the binding constraint:** +377 deal-timing rows, **none carrying an owner**.
## 2026-08-29 — B6d: the feed expectations are graded, and two "mis-sized SLAs" are real outages

Closes the **B6a → B6a-follow-up → B6b → B6b-lead** arc.
[`docs/audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md`](../audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md).
Backlog **B6d** (+ **B6d-cms**, **B6d-sam**). Applied live to gov, dia and LCC Opps; every committed
function body and all 25 registry rows verified byte-identical to live by md5.

**Open `feed_stale` 4 → 2, and both survivors are genuine breaks.** All 25 feeds now carry a
`cadence_class` and either a bound with a mandatory `expectation_basis` or **no bound with a mandatory
`unwatched_reason`** — CHECK-enforced, so a round number with no reasoning can no longer be added.

- ⚠️ **THE POPULATION IS 25, NOT 23.** LCC Opps has its own registry (`om_intake`, `salesforce_sync`),
  evaluated by the same check through its `lcc_local` arm and invisible to a count taken from the
  domain databases. **Enumerate every registry that feeds the monitor.**
- ⚠️ **RULE 3c HELD TWICE — and this is the finding.** Both alerts the brief read as mis-sized SLAs
  are ingestion outages. dia **`medicare_clinics`**: p50 gap 2d and a **max gap ever of 41d**, so the
  45d bound was never the problem — **27 failed + 6 abandoned** CMS runs since the last success
  2026-06-25, while `dataset_modified_date` reads **2026-08-25**. gov **`sam_lease_opportunities`**:
  re-scoped 14 → 21 **and deliberately left violated at 33d**; the weekly producer is healthy
  (`usajobs`, same workflow, landed 2026-08-24) and the SAM call returns **401 Unauthorized**.
  ⚠️ That 401 is **not** §18's rate limit (different key, different endpoint) — and §18's own
  *"the 401 is not real"* correction is exactly what makes a real 401 easy to dismiss.
- ⚠️ **MEASURING A FEED'S OWN GAPS IS CIRCULAR ONCE IT HAS BEEN DEAD.** An outage is a CLOSED gap and
  enters its own distribution: `gsa_lease_change_facts` has 2 dates and one 170d gap — *the outage B6b
  repaired* — so 3×p90 derives a **510-day** bound. **B6a's p90 rule does not transfer from steps to
  feeds** (a dead step's gap never closes; a dead feed's does). Lifetime windows also mix eras
  (`usajobs` p90 31.8 over life, 7 in the scheduled era). Primary basis = the **declared** schedule;
  below three gaps the verdict is `cannot_be_sized_from_data`, recorded rather than dressed up.
- ⚠️ **THE GSA FAMILY IS FOUR FEEDS, ONE PUBLISHER, AND CARRIED FOUR BOUNDS** (65/35/45/45) — three
  below the publication cycle's own peak. Publication is monthly with a **21–51d lag**, so peak data
  age is ~82d: snapshot **65 → 90**, derived trio **→ 75** (pinned by a guard). It was **6 days from
  firing** on a healthy feed, with `consecutive_unchanged=3` proving GSA has not published August, and
  `gsa_lease_events` **would have fired 2026-09-10** — its cadence changed on 2026-08-10 when the
  fingerprint dedupe began skipping, and its bound had not. **`gsa_source_pull` stays tight at 21**:
  *did WE stop pulling* is a different question, with a different owner, from *is GSA publishing*.
- ⚠️ **`opm_workforce` 120 → 200 because 120 was UNMEETABLE by the process that feeds it** — data is
  74–75d old *at the moment of a successful manual import* and the one observed import interval is
  119d. It fired three times in three months, every one closed "expected".
- ⚠️ **RETIRING AN EXPECTATION MADE ITS ALERT PERMANENT, and it was already live.** The auto-resolve
  arm requires the feed to be PRESENT, so a retired feed's alert can never close — exactly what
  B6c-dup's `is_active = false` did to `property_sale_events` earlier the same day. Fixed with **B6a's
  own lesson one layer up: an unwatched feed EMITS**, with a NULL bound as a *positive* statement, and
  a resolve arm keyed on that — **never on absence**, which also covers a feed whose query errored or
  whose mirror went blind. The residual is **counted as `alerts_orphaned`, never auto-resolved**.
- **Controls (rolled back):** opm@199d → 0 alerts, opm@205d → 1, gsa@95d → 1, unwatched@1800d → 0,
  orphan counter → 1 named. Guards: LCC 7 tests **12/12 mutations RED**, gov 8 tests **12/12 RED**;
  full LCC suite **4,855 tests, 0 fail**.
- ⚠️ **Both guards first passed a mutation they were written to catch** — a whole-body grep for a
  literal (`feed_mirror_stale`) and for a predicate (the 3-day exclusion) that each legitimately appear
  more than once, which is **B6c-dup's own documented lesson, reproduced in guards written after it**.
  And **comment-stripping was not enough**: B6d stores each retirement's reasoning in a *column*, and
  `property_sale_events`' reason quotes `is_active = false` — so the gov guard failed on itself until
  it also blanked **string literals**. The A5c/N18 defect one level deeper.
- **Housekeeping:** the pre-existing backlog id **B6d was renamed B6h** (the `parcel_owner_xref`
  divergence consumer, unbuilt and doc-only) — this round's id was already inside `expectation_basis`
  values on three live databases, so it was the cheaper rename. Pointers in `STATUS`, `I6` and the
  backlog updated.
- **NOT done, deliberately:** no producer started, stopped or altered. The two real breaks are filed
  (**B6d-cms**, **B6d-sam**), not fixed — fixing them here would blur which change moved which number.
- ⚠️ **FOLLOW-UP, and it is this round's own theme turned on itself: a REVIEW BOT caught a security
  claim B6d asserted without positive-controlling it.** `REVOKE EXECUTE … FROM anon, authenticated`
  on `compute_feed_cadence` was a **no-op** — Postgres grants EXECUTE on a newly created FUNCTION to
  **PUBLIC** by default, so both roles still reached the SECURITY DEFINER function that runs dynamic
  full-table scans. Measured live *after* the "fix" shipped: `proacl = {=X/postgres, …}` (the leading
  `=X` IS the PUBLIC grant) and `has_function_privilege('anon', oid, 'EXECUTE') = TRUE` on gov and
  dia. Fixed by `REVOKE … FROM PUBLIC`; verified false after. **A VIEW takes no default PUBLIC
  grant**, which is why the view half of the same migration WAS effective. **Assert a privilege with
  `has_function_privilege()`, never by reading the REVOKE you just wrote** — it was one query away,
  and four artifacts (migration comment, audit doc, backlog row, guard) repeated it unverified.
  ⚠️ Not generalisable: `compute_feed_freshness` keeps its `anon` grant BY DESIGN (the cross-DB pull
  reads `v_feed_freshness` as anon); the gov guard now pins that asymmetry in both directions.

## 2026-08-28 — CONSOLIDATION: BD ranking gets a canonical page

**Docs only.** New canonical page **`docs/architecture/bd-ranking-and-priority-queue.md`** — one
door into **C4 → C5 → C6**, following the `tier0-owner-contact-system.md` pattern. It carries: where
this sits in Scott's chain (hops 6–7), the band table, the gate and its exact reconciliation, the
role-column distribution, the two defects, the C6 build with predicted deltas, **the four traps**,
broker assignment, and a decisions table separating what is decided / open / **refused**.

Wired in: `connectivity-and-open-threads.md` §0 canonical-pages table (now **four**, not three) and
banners on §4o/§4p marking them the dated evidence · `CURRENT-STATE.md` canonical-doc map ·
`DOCUMENTATION-MAP.md` subsystem example · **a canonical-page banner in both C4 and C5 audits**
(a trap list is only a guard if it is on the path someone walks).

⚠️ **The page states DIAGNOSED, NOT BUILT** in three places. Nothing in C4/C5 touched a live system.

## 2026-08-28 — C5b answered; C6 build prompt written (still nothing written to live systems)

Closes **C5b** and corrects C5 §5's "narrower" framing. Prompt:
`docs/claude-code/prompts/C6-per-asset-band-eligibility-with-reachability.md`. Backlog **C6**.

- ⚠️ **The per-asset fix is better founded than widening to `unknown` but NOT narrower on its own:**
  all five bands, all roles = **4,506 rows / 3,622 owners — a 20× flood.**
- **P5 `aged_building_value_add` is 83% of it** (58 → 1,681) and is the weakest signal in the set.
  ⚠️ **`aged_props` is NOT gov-scoped** — no `source_domain` filter, so **P5 covers dia** (26 → 565).
  Touching it is a cross-domain change; nothing in this arc has been. **P5 keeps the role gate.**
- **The design that works — per-asset PLUS the P112 reachability precondition, P1/P2/P3/P8 only:**
  **P1 74→149 · P2 32→95 · P3 62→163 · P8 76→213 = 244 → 497 rows / 303 owners.** ~2×, not 14×,
  and every emitted row is callable. **Reachability is what converts a flood into a call list.**
## 2026-08-29 — B6b-lead: the lead lane was graded, funnelled, and deliberately NOT restarted

**Diagnosis only. Nothing written to `ownership_history`, `prospect_leads`, or any gov table.**
Writeup: `docs/audits/B6b_lead_OWNERSHIP_LEAD_RESTART_2026-08-29.md`. Backlog **B6b-lead**;
contract **I4**; connectivity **§4q**; gov `CLAUDE.md` **§21a**.

**🛑 The restart was not taken, and the reason is not the one the prompt anticipated.** It set a stop
condition on the gate (*if `is_same_owner` cannot separate a re-spelling from a sale, stop*). **The
gate passed** — 91.80% agreement with the alnum-key reference over all 16,492 rows, erring
conservative (it suppresses 9,146 vs the reference's 7,940). What failed is the premise in §0:

- **⚠️ THE LANE HAS NO HUMAN CONSUMER.** All 7,729 `ownership_change` leads: `assigned_to` **0**,
  `last_contacted_at` **0**, `next_action` **0**, `sf_lead_id` **0**; `sf_sync_status` `'pending'`
  for every one; only `new` and `filtered_multi_tenant` have ever appeared in `pipeline_status`.
  The three numbers that justified the restart reproduce **exactly** and are all mislabelled —
  *2,041 worked* is an automated exclusion filter, *208 pushed to Salesforce* is `sf_contact_id`
  (a matched existing contact), *2,149 touched in 30d* is **1,216 of them on one day**. A5 and P119
  landing together on the one lane whose liveness nobody re-checked because it was already
  "verified." Per the Consumption-Layer rule, a producer with no consumer does not get restarted.
- **⚠️ 59% of that evidence is another lane's.** `route_to_pipeline` hard-codes
  `lead_source='ownership_change'` for every row regardless of `data_source`: only **3,199** leads
  trace to `gsa_lease_diff`, **4,530** to `county_deed`. **That is why the badge never went quiet
  when the lane died.** Its input today is 4,369 rows with **zero** `gsa_lease_diff` — 2,776 are
  B5's sale-derived transitions from the day before. It also reads `ownership_history`, not the
  events, so **the lead lane is downstream of the ownership-fact write** and "restart the leads
  without writing facts" is impossible as coded.
- **⚠️ Both top-2 would-write rows by value are false acquisitions** — `LCOR` → `LCOR ALEXANDRIA`
  at **$75.4M** (arm 3's `length > 5` guard blocks short sponsor names) and a `JPMORGAN` → `MORGAN`
  truncation at $26.3M. An agreement rate is not a safety property when errors sit at the top of the
  ranking. `normalize_entity` also mangles names via unanchored `str.replace` (`ACME CORPORATION` →
  `ACMEORATION`; live: `ALACHUA,UNTY OF`, `GRAHAMMPANIES`), order-dependently.
- **Blast radius 584 / 568 properties / $433.4M — the backlog's 10,635 is 18× too high** (it counted
  usable events without applying the gate or the dedup). Only **42** arrived since the lane died;
  **158 (27.1%)** clear the $500k floor. ✅ **B5a's fill-forward guard is live and decisive** —
  without it this restart would have nulled recorded owners on up to 568 properties.
- **Sequenced recommendation:** 👤 **Scott decides retire-vs-restart first** (nobody has worked one
  of these 7,729 leads) → fix the provenance laundering → fix the three gate defects → then restart
  value-gated at 584 rows. **B6e stays a genuine prerequisite.**
- **Guard shipped (gov):** `tests/unit/test_changed_fields_jsonb_probe.py` — 14 tests, **9 mutations
  RED**, pinning the Class-11 jsonb-string trap (`changed_fields ? 'k'` → a silent 0 of 233,666)
  that produced two published wrong findings. ⚠️ One assertion **passed its own mutation** on the
  first pass and had to be re-anchored on the comment-ONLY case; and `#` cannot be stripped naively
  in Python because `#>>` is the operator the guard looks for.
- **Suite:** gov 936 pass / 10 fail — the 10 are **pre-existing** in `test_sos_detail_fetcher.py`
  (922 pass / same 10 fail without this change) and are sandbox dependency-version artifacts, not
  touched by this work.

## 2026-08-28 — C5: 224 owners callable today, and the `buyer` exclusion is the larger half (diagnosis only)

**NOTHING WRITTEN.** Audit:
[`docs/audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](../audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md);
canonical **§4p**. Answers **C4e**; adds **C5/C5a/C5b**.

- **1,924 owners hold a current gov property with a P1/P2/P3 signal and are invisible to the queue**
  — 1,052 `buyer`, 871 `unknown`. **224 are contactable today.**
  ⚠️ **C4's "56 contactable" was P1-only and `unknown`-only** — easily misread as the total. **224.**
- ⚠️ **C4e answered: the `buyer` exclusion is a CATEGORY ERROR, not a bad label. 578 owners /
  $410.4M** — bigger than the `unknown` half. Boyd Watterson (45 gov assets), Prologis, RMR,
  HC Government Realty Trust are all correctly typed `buyer` **and** are the current owner of a
  building whose lease is expiring. `owner_role` is a party-level identity; the bands ask a
  per-asset question — **and the CTE already joined `is_current=true`, then discarded it.**
- ⚠️ **Firing the band is not choosing the pitch** — acquisitions vs disposition are different
  contacts and tones (`account-based-contact-intelligence.md`). The bucket stays C4a.
- ⏰ **173 owners have a gov lease expiring within 90 days and are on no surface; 14 contactable.**
  **Boyd Watterson is 2026-08-31 — three days out.** ⚠️ **Not verified whether that lease is
  renewing, extended or terminal — the attributes row carries a date, not an outcome.**
- **The names are the ones the Tier 0 arc already resolved** — Boyd, Easterly, NGP, RMR, Gardner
  Tanenbaum, GI Partners. The contacts were confirmed, the signal existed, and **the role gate sat
  between them.**
- **Recommendation shifts:** the **per-asset fix (C5)** is narrower and better founded than widening
  to `unknown` — no new classifier, no doctrine call. Still pair with the P112 reachability
  precondition.

## 2026-08-29 — B6c-dup: the two sale stores disagreed about which is canonical (SHIPPED)

Full writeup: [`docs/audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`](../audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md) ·
connectivity **§4p** · contract **I1**.

**Decision, in writing: `sales_transactions` is the canonical comps spine; `property_sale_events` is
a capture surface that propagates into it.** 77 of 77 gov views that read a sale store read the
spine (all 30 `cm_gov*` CM views); zero read PSE. `detail.js` said the opposite in its own comments
— corrected at 4 sites, each `B6c-dup`-marked with the old wording quoted.

**The leak was real, confirmed behaviourally** (one rolled-back INSERT: PSE +1, spine **+0**,
`latest_sale_price` set). Shipped `trg_gov_pse_propagate_to_sale` — AFTER INSERT on PSE, the single
owner of that transition, keyed `(property, YEAR-MONTH, price-to-$1k)`, fill-blanks, ledgered
(`gov_pse_propagation_log`), kill-switched, batch-reversible; `field_source_priority` @5.
Also: `B6c-feed` **retired** (not resolved) — the expectation moved to feed `sales_transactions`,
which has an actual cadence.

⚠️ **THE DAMAGE WAS ZERO AND ALL THREE PRIOR ORPHAN FIGURES WERE WRONG — 330/$4.48B, 9/$558.8M, and
my own first re-measure of 6/$29.2M. The true count is 0.** Three lessons, in order of how much they
would have cost:

1. **The exact-date join was the wrong key.** `sales_transactions.sale_date` is **month-truncated**
   for its dominant source (`costar_sidebar` 87.4% day-1). Re-keyed on `(property, YEAR-MONTH)`:
   **0 of 1,694**, positive-controlled at 1,694. ⚠️ `dedup_natural_key` already stated that
   granularity. **Run the neighbouring key before believing an anti-join.**
2. **`property_id IS NULL` ≠ dangling** — dangling is 0 and impossible under
   `fk_pse_property … ON DELETE SET NULL`. ⚠️ I reproduced the brief's error first: **a
   `LEFT JOIN … WHERE prop_live=false` lumps NULL in with dangling.**
3. **`transaction_state` was never read.** The "$529.6M invisible" is **quarantine**
   (`needs_review` / `duplicate_superseded`, `exclude_from_market_metrics=true`). The spine is
   complete: 1,687 live twins, 7 quarantined, 0 absent.

⚠️ **The first propagator filtered its twin lookup to `transaction_state='live'` and would have
resurrected those quarantined comps as live CM rows.** Caught by the live probe, one pass before it
mattered. **A filter that narrows a lookup to the rows you want to ACT on hides the rows that should
STOP you** (the A5c mint/probe asymmetry).

⚠️ **A complete downstream store is not evidence that propagation exists** — gov's spine held every
priced event because both bulk importers wrote both tables independently, not because anything
connected them.

Guards: `test/b6cdup-sale-store-canonical.test.mjs` (5 tests, 5/5 mutations RED) — ⚠️ **the one guard
here that cannot strip comments, because the defect IS a comment**; resolved by proximity to an
annotated correction. `tests/unit/test_b6cdup_pse_propagation.py` (gov, 11 tests, 12/12 RED) —
⚠️ **one assertion passed its own mutation** (it grepped a predicate that also appears in an
`ORDER BY`) and was re-anchored on the branch. LCC suite 4,833 pass / 0 fail.

**Not done, by design:** no backfill (nothing to backfill) · the 376 unlinked events untouched
(`B6c-orphan` re-scoped) · the 7 quarantined twins untouched · **dia not ported** — it is 72:2, not
77:0, and has real PSE consumers (`B6c-dup-dia`).

## 2026-08-28 — C4 §5 self-correction: widening the BD gate admits 2,521, not 62,554 (diagnosis only)

**NOTHING WRITTEN.** Same-day follow-up to the C4 entry below, sizing the decision it left to Scott.
New Dead-End **Class 23**. Backlog **C4a** rewritten, **C4e** added.

⚠️ **The C4 audit's own §5 warning was wrong by 25× and is corrected in place.** It said widening
`gov_owner_props`'s role gate to `unknown` admits **62,554 entities** — "every junk name, every SPE
husk." The CTE **already joins** `lcc_entity_portfolio_facts` (current, gov) and
`lcc_property_attributes`, which bound the population to **2,521**, of which **3** are placeholder
or brokerage names. **The predicted flood does not exist.**

- **Class 23 — a predicate's blast radius belongs to the QUERY, not the column it names.** Reading
  the `WHERE` and reaching for the column's fleet-wide distribution skips the JOINs above it.
  ⚠️ An overstated blast radius fails **as a refusal**: it reads as caution, gets written down, and
  is quoted as a reason not to ship. **Wrong-and-cautious is not a safe default.**
- **Sizing:** widening produces P1 **74 → 553**, P2 **32 → 242**, P3 **62 → 414**, **997 distinct
  owners**. The P1 delta is 479 rows / **449 owners / $148.0M**, named rows reading as genuine gov
  landlords (`1101 WILSON OWNER, LLC`, `131 SOUTH DEARBORN LLC`).
- ⚠️ **The binding constraint is REACHABILITY, not noise — only 56 of 449 (12.5%) are contactable**,
  39 have a cadence. Widening alone emits ~393 owners nobody can call: the documented **P112**
  failure. **Recommendation is sequencing, not refusal** — gate the widening on the reachability
  precondition the cadence engine already applies; the 56 are actionable day one.
- **Newly visible:** **`buyer` is 2,432 reachable entities**, excluded deliberately and never
  re-examined (**C4e**); an `operator` role exists (2 entities).

## 2026-08-28 — C4: the ranked call list measured for the first time (diagnosis only)

**NOTHING WRITTEN — no migration, no flag, no cron.** Audit:
[`docs/audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md`](../audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md);
canonical **§4o** of `docs/architecture/connectivity-and-open-threads.md`; backlog **C4/C4a–C4d**;
new Dead-End **Class 22**.

⚠️ **Numbered C4, not C3** — `C3` is already a C1-lane doctrine row in `PLANNED-BACKLOG.md`.

This closes the last hop of Scott's chain (the ranked call list) after the T1 + T2a mints took gov
asset coverage to 57.8% and resolved owners to 5,992. **Cache freshness was ruled out first.**

- **The gate is one column.** Every gov deal-timing band (P1/P2/P3/P8) reads `gov_owner_props`,
  filtered `effective_owner_role IN ('developer','user_owner')`. It reconciles **to the row**:
  1,216 candidate gov facts → **74** after the role predicate = the observed P1 count. Not value-,
  cadence- or opportunity-gated.
- ⚠️ **`user_owner` is 0 of 66,874 live entities** — half the gate has never matched anything, and
  a gate arm that never matches is indistinguishable from one that is absent (**Class 22**).
  `developer` is 715 (1.07%) from a classifier that is **exhausted, not broken** (285 rows lifetime,
  2 candidates left). `unknown` is **62,554 (93.5%)**.
- **Only 256 of 5,992 resolved owners (4.3%)** reach the queue; **931 of 1,267 rows (73%)** are
  data-completion work rather than calls.
- ⚠️ That classifier is the **N18 view** — which N18 found was ranked arbitrarily, not knowing it
  sits upstream of the entire ranked call list.
- **Broker assignment is 48 of 2,301 cadences (~2%).** The obvious fix is the documented
  three-user-table FK trap; go through `lcc_cadence_point_person()`.
- 👤 **C4a is Scott's and it is doctrine, not code:** what recorded evidence promotes an owner out
  of `unknown`. ⚠️ Widening the gate to `unknown` admits 62,554 entities and is refused;
  a name-based role classifier is refused (~25%/7% measured precision in this arc).

**Cleanup in this change:** two same-round C3-named drafts deleted; connectivity §0 index, the
audit evidence trail, and the playbook updated in the same commit.

## 2026-08-28 — Cross-lane property identity contract and build queue documented (design only)

**DOCUMENTATION ONLY — nothing activated, migrated, promoted, or written to live systems.** Canonical design:
[`docs/architecture/property-identity-and-address-resolution.md`](../architecture/property-identity-and-address-resolution.md).
Backlog: **PI1–PI8** in `docs/os/PLANNED-BACKLOG.md` P10a. The ASC integration contract now names
the shared dependency without authorizing extraction or adoption.

The restricted frozen ASC sample established that repeated capture failures are a platform class, not just
bad strings: suite/floor versus parent building, shared campuses, suffix/directional/locality/range variants,
compound street spacing, historical frozen-token drift, explicit tenant corroboration, valid source
missingness, stale sidebar candidate state, and ambiguous database-function output. The new contract turns
those aggregate lessons into a versioned match hierarchy, structured decision object, rule lifecycle,
de-identified golden corpus, sidebar diagnostics, shadow evaluation, governed alias-ledger design, and
aggregate quality measures.

**Boundaries preserved:** no private candidate rows, source payloads, run IDs, or licensed evidence entered
Git; no full-universe ingestion, canonical promotion, Salesforce write, outreach, opportunity creation,
unattended licensed-source scraping, evidence deletion, or IDTF activation. An on-box model is advisory only
and can never decide or write identity. **Next gate:** finish the frozen 50-property sample, review its
aggregate outcomes, then separately decide whether PI2/PI3 (corpus + pure matcher) should begin.



## 2026-08-28 — B6c: `property_sale_events` — answered, and deliberately not repaired

**Diagnosis only. No migration, no column dropped, no type changed.** Writeup:
`docs/audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`. The brief said to answer *"does this table
have a consumer"* **before** fixing the `bigint`/`uuid` link columns §4j found. Answer: **the table
does, the two link columns do not, and the audit found something that outranks both.**

**The three verdicts.** The **table is load-bearing — keep it**: 6 live gov triggers (close-listing,
propagate-sale-to-`properties`, cap-rate snapshot), the LCC detail panel's *declared canonical write
target* (2 write paths), read+write allowlisted on both domains. **`ownership_history_id` has ZERO
readers anywhere** — 0 hits across **620 gov objects**, 0 across dia, 0 in `api/`; 0 of 5,208 gov
rows; **1.9% (52/2,730) on dia after four months**; no FK on either domain. Retyping it builds a link
nobody follows (**Class 2**) into a population that is **56% `ownership_change_stub*`**, the retired
circular source. **`sales_transaction_id` has exactly one reader, dia-only** (`fn_listing_close_if_sold`);
gov has none, and gov's own close-listing trigger does not want one — **held, not retyped**, because
if the two stores consolidate the column disappears rather than getting fixed.

**🚨 What outranks it (`B6c-dup`).** `detail.js` says in its own comments that `property_sale_events`
is canonical and `sales_transactions` is *"legacy, retired for write paths."* The database says the
opposite: **76 of 76** gov views that read a sale store read `sales_transactions` and **ZERO** read
`property_sale_events` (30 of them are the `cm_gov*` CM views). Nothing propagates PSE →
`sales_transactions`, though the reverse direction exists. **So a sale an operator types into the
property panel never reaches the comps spine** — already **6 real priced comps, up to $10.8M with cap
rates**, invisible to every chart in the book. PSE is also **92.6% duplicative** of
`sales_transactions` on exact `(property_id, sale_date)`. ⚠️ **Both stores are individually correct
with coherent consumers; nothing errors and no component test can see it, because it is a property
of the CONNECTION.**

**D2 swept all three projects** — 10 genuine defects, 3 low-severity, 5 accepted false positives;
SQL published as I3's detector (audit §7e), and I3's status row moves **❌ none → ⚠️ manual**. Two
refinements the sweep earned: **a declared FK is authoritative and Postgres already type-checks it**,
so only *unFK'd* columns need examining (`available_portfolios.portfolio_id` was a false positive on
exactly that basis); and **every genuinely mismatched undeclared column found is 0% populated** — a
column that cannot hold its value never gets one — so **triage by populated-ness before reading
names**, since a *populated* mismatch is nearly always an external vendor id or a uuid-as-text.

**⚠️ Three honest limits, stated rather than smoothed over.** (1) **LCC Opps' zero is BOUNDED** — 151
of 559 `_id` columns evaluated; the other 408 were **not examined**, so this is not "LCC is clean."
(2) **The `feed_stale` alert is to be re-scoped, not resolved** (`B6c-feed`): the bulk producer was
retired on purpose and the only live producer is an operator form with no cadence, so a 45-day
expectation alerts whenever nobody types a sale for six weeks and then sits open forever — the B6a
*"expectation nobody chose"* failure inside the freshness registry. (3) **Nothing was shipped, so
there is no guard** — when B6c-dup acts, the guard ships with it, and it must strip comments before
matching, because this audit quotes the broken predicate repeatedly (the N18/A5c lesson).

**Canonical docs updated in the same change:** `PLANNED-BACKLOG.md` (B6c ✅, D2 ✅, plus new
`B6c-dup` 🔴 / `B6c-oh` / `B6c-feed` / `D2-dia` / `D2-shape`), `data-coherence-invariants.md` (I3
body + detector row), `connectivity-and-open-threads.md` (**new §4l**, and the §4j bullet annotated
where its last sentence did not survive re-measurement).

## 2026-08-28 — B6b: the GSA landlord-change detector restarted (gov)

**Shipped.** `gsa_lease_change_facts` **356,291 → 374,257**, max snapshot **2026-02-01 → 2026-07-01**;
`gsa_lease_timeline` **16,471 → 16,779**, max **2025-12-01 → 2026-07-01**. **Both `feed_stale` alerts
AUTO-RESOLVED** — verified on the alert row (`resolved_note = 'Auto-resolved: feed refreshed within
SLA'`), not on a run log. Derivable backlog **5 → 0**; the re-run is a clean no-op. gov suite **921
pass / 1 skip**; 14 new tests, **13 mutations RED**. Writeup:
`docs/audits/B6b_GSA_LANDLORD_CHANGE_RESTART_2026-08-28.md`; migration
`government-lease/sql/20260828_gov_b6b_gsa_change_layer_from_snapshots.sql`; caller
`src/gsa_change_layer.py` wired into the existing Monday `gsa-sync` on **both** paths.

**What it cost / what it corrected.** Three premises in the brief were wrong and each correction
changed the build:

1. **The raw feed was never dead.** `gsa_source_pull_log` shows a pull on **2026-08-24** recording
   `skipped_duplicate` / `consecutive_unchanged=3` — GSA has not published past 2026-07-01, cadence
   measured at 28–31 days. A feed early in its cycle and a dead feed read identically from
   `max(snapshot_date)`; the ledger is the instrument.
2. **The derived layer read a DIFFERENT TABLE** — `gsa_inventory_snapshot_lines` (manual, frozen)
   vs `gsa_snapshots` (live). **Scheduling the old code unchanged would have derived nothing.**
   Repoint gated by a full-history digest (137 dates, 136 identical; 22,030 field-level pairs, 0
   diffs) positive-controlled at 6,223 diffs when mis-keyed — and it is **not a clean superset**:
   10 dates exist only in the manual panel, which a three-month sample had shown as clean.
3. **"Undiffed" ≠ "derivable."** 21 undiffed dates, **15 already SPANNED** by an existing diff.
   Deriving those double-observes conveyances — the A2b fan-out in the time dimension.

**Two traps worth carrying forward.** A **dry run cannot catch a write-time constraint**: one row in
17,966 (a `$1.00` placeholder rent corrected to `$10,418.00`, ratio 10,417 against `numeric(8,4)`)
aborted the batch after five clean dry runs. And the **client timed out while the work committed** —
verified by the row delta, never the return value.

**Deflated honestly:** raw **+1,336** → **+72 net-new conveyances / +63 properties** (18.6× on the
increment). ⚠️ Non-oscillating went **DOWN 47** — the new months supplied return legs, so more data
made the P138 guard stricter.

**Not done, named:** nothing fed to `ownership_history`; the `ownership_change` lead lane was **not**
restarted (**B6b-lead** — 10,635-row blast radius, no credentials to dry-run it, and its only gate is
a name heuristic). ⚠️ **B6's G3 row is REFUTED**: `gsa_lease_events` does carry lessor pairs (16,907
rows) — B6's zero came from `changed_fields ? 'key'` against a jsonb **string**. Also filed:
**B6b-june** (2026-06-01 is a merged snapshot of two source files, 7,919 leases vs a 7,348–7,495 norm).

## 2026-08-28 — C2h: the "silent feeder" was answering a different question. It is the sponsor↔SPE gap.

Evidence: [`C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md`](../audits/C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md);
canonical **§4n**. Diagnosis only — nothing written.

**C2g called these 79 "the genuine feeder defect." They are not a defect.** **All 79 properties are
resolved.** The feeder resolved the **SPE that holds title** — the correct recorded owner — while
the Salesforce person works for the **sponsor**. Both sides are right.

| SF person's employer *(a gov `true_owner`)* | LCC resolved owner *(title holder)* |
|---|---|
| **Avery Capital** | **AC** ORLANDO SPV LLC |
| **Ball Ventures** | **BV**GC PARCEL C, LLC |
| **Browman Development Co.** | **BDC** Livermore L.P. |
| **Carmel Partners** | **CP** VI Van Gordon, LLC |

**The SPE initials are the sponsor's initials.** Split: **69 sponsor↔SPE · 8 true duplicates · 2
probable.** Guards explained almost nothing — brokerage 2, placeholder 0, not-prospected 0.

### ⚠️ One column turned the diagnosis around, and the lesson generalises

`prop_resolved_to_someone` equalled `props_with_asset` on **all 79**. C2g's framing —
*"everything the feeder needs is present and it produced nothing"* — was wrong because it never
asked whether the property had resolved **to someone else**. **When a producer looks silent, check
whether it answered a DIFFERENT question before calling it silent.** That is a new variant of the
family this arc keeps meeting, and the fourth time a "silent producer" turned out to be working.

⚠️ Also: `lcc_looks_like_person` returned true for **40 of 79** and was used for nothing — it
carries the documented `CITY OF SALEM` / `BROOME COUNTY` false positive (A3/P196).

### The recommendation is to build NOTHING new

Two sponsor surfaces already exist and are **human-confirm by design** —
`lcc_owner_sponsor_domain` (P190) and `lcc_ownership_sponsor_family` (A3) — because A3 measured a
lexical sponsor detector at **~25% precision** raw and P196 at 4-of-6 even with three guards.
**A third detector is the normaliser drift this repo has paid for repeatedly.** Feed the 69 in as
candidates (**C2i**); they arrive with stronger evidence than either surface normally has, since the
sponsor is independently attested as a gov `true_owner` *and* carries Salesforce people.

### Real residue found while reading (C2j)

**`Casa De Chupita` → `Undisclosed` at confidence 0.57 — a placeholder won a resolution**, and
`lcc_is_placeholder_owner_name` does not list `Undisclosed`. **`Chiapelone Trust` → `BGC-Havasu
Project LLC by Newmark Knight Frank`** — brokerage pollution inside a resolved owner name (P116).
Two more at confidence 1.00 are unexplained and want individual reading.

## 2026-08-28 — C2b + C2g: the SF bridge self-healed, and both hypotheses for the residue were wrong

Evidence: [`C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md`](../audits/C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md)
· [`C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md`](../audits/C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md).
Canonical **§4l / §4m**. Measurement only — nothing written.

**The bridge doubled with no bridge code.** SF-linked people reaching a resolved property owner:
**669 (6.8%) → 1,486 (15.2%), +817**, purely because T1 + T2a built the far bank. C2 said the bridge
had *"no far bank"*; there are now 8,636 owner rows over 5,992 owners. **Diagnosis and remedy both
vindicated — and the lesson is to re-measure a downstream gap after fixing an upstream one, before
building anything for it.**

**⚠️ The residue is 91.5% NOT-AN-OWNER.** Of 7,646 still unconnected across 6,816 orgs, only **489
orgs / 652 people** are at companies that own properties in our domains. The rest are brokers,
vendors, tenants, lenders. **So Scott's opening figure — "8–10k Salesforce opportunities not
connected" — is, measured, ~652 people at 489 owner-orgs.**

### ⚠️ C2g: both leading hypotheses for those 489 were REFUTED

| hypothesis | measured | verdict |
|---|---|---|
| the **0.55 confidence gate** | **444 of 489 were NEVER a candidate** in `lcc_property_owner_evidence` | ❌ the gate never saw them |
| **P113 operator trap** | `true_owner_is_operator` = **0** across all 489 | ❌ |

They were the two documented causes closest to hand. The residue is three populations: **dia 248 of
271 have no property in the mirror**; **gov 74 of 222 have a property with no asset entity** (the
minting slice — *exactly* the 74 overlapping the T2b plan, reconciling with C2b's independent
count); **gov 79 of 222 have a property WITH an asset entity and still no evidence** ← the genuine
defect, filed as **C2h**. Join controlled first: 19,851 of 20,123 facts key correctly.

**T2b now has a THIRD independent reading against it** — contactability 3.7% (T2a), only 74 of 489
reachable (C2b), those same 74 the only slice of this residue (C2g). Safe, low-value, not run.
## 2026-08-28 — C2b: the Salesforce bridge SELF-HEALED, and the opening premise is retired

Evidence: [`C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md`](../audits/C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md);
canonical **§4l**. Measurement only — nothing written.

**No bridge code was written and the bridge doubled.** Same query, two dates:

| | C2 (pre-mint) | **now** |
|---|---:|---:|
| SF-linked people reaching a **resolved property owner** | **669 (6.8%)** | **1,486 (15.2%)** |

**+817 people, +122%, purely because T1 + T2a built the far bank.** C2 said the bridge had *"no far
bank — only 4,065 property→owner rows for 32,289 properties"*; there are now **8,636 rows over 5,992
owners**. That is the cleanest confirmation in this arc that **hop 3 was the binding constraint** —
diagnosis and remedy both vindicated, and it argues for re-measuring a downstream gap after fixing an
upstream one **before** building anything for it.

### ⚠️ The residue is 91.5% NOT-AN-OWNER — and that retires the framing this whole thread opened with

Of the 7,646 still unconnected, across **6,816 distinct orgs**: only **489 orgs (7.2%) / 652 people
(8.5%)** are at companies that are property owners in our domains. The other **6,994 (91.5%)** are at
brokerages, vendors, tenants, lenders and counsel — edged to their employer by the `works_at`
Salesforce-account edge. **Their employers do not own our properties. No minting or reconcile will
connect them, and none should.**

**So Scott's opening figure — *"8–10k Salesforce opportunities… not yet connected"* — is, measured,
~652 people at 489 owner-orgs.** The rest are correctly unconnected. That is a much smaller and much
more actionable number than the one this topic started from.

### ⚠️ It settles T2b on a second, independent axis

Only **74 of the 489** unresolved owner-orgs appear in the T2b plan — **3.6%** of its 2,054 owners.
Combined with T2a's measured collapse in contactability to **3.7%** in that band, **T2b is weak on
two independently measured axes.** It stays *safe* (graph cost settled across 4,570 minted entities),
so it can be revisited if the ranked queue runs dry. **Recommendation: do not run it now.**

### The next question, deliberately undiagnosed

**415 of the 489 owner-orgs are NOT reachable by minting** — anchored, with SF people attached, and
still unresolved for some other reason. **That is a resolution gap, not an asset-identity gap — a
different lever from everything C2a–C2e pulled.** Filed as **C2g**, with candidates ranked and none
assumed: the `lcc_reconcile_property_owner` **0.55 confidence gate** (CLAUDE.md documents 876 assets
with evidence still reading "Unresolved"), a dia **operator** in the owner slot, or cross-domain
anchoring.

## 2026-08-28 — C2e-T2a MINTED: gov asset coverage 39.2% → 57.8%

Evidence: [`C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md`](../audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md);
canonical **§4k**. Batches `c2e_gov_eligible_t2a_20260828` + `c2e_t2a_evidence_20260828`, gov only.

| | C2a baseline | after T1 | **after T2a** |
|---|---:|---:|---:|
| **gov asset coverage** (of 13,837 non-archived) | 24.7% | 39.2% | **57.8%** |
| asset anchors, both domains | 5,096 | 7,147 | **9,717** |
| `lcc_property_owner` rows | 4,065 | 6,065 | **8,636** |
| **distinct resolved owner entities** | 2,768 | 3,743 | **5,992** |
| plan remaining | 6,811 | 4,811 | **2,241** |

**2,570 minted · 2,570 resolved an owner · 0 evidence-less · 0 orphans**, and the population
reproduced C2e §6 exactly *before* the write. Gates held **and were attributed** per the §4i rule —
merge candidates 5,194 → 5,194, `auto_mergeable` 3,006 → 3,006, drift 0 → 0, readings timestamped
seven minutes apart.

**The gate that starved the whole chain has now moved from 24.7% to 57.8% in two staged passes,
with the noise cost measured across 4,570 entities rather than assumed.**

### ⚠️ Predicted +44 duplicate groups, measured +46 — and chasing the 2-row gap found a real defect

`lcc_mint_gov_asset_entities` passes `lcc_normalize_entity_name(m.name)` as `canonical_name`, and
**the N15c `BEFORE INSERT` trigger overwrites it.** Only **2,497 of 2,570 (97.2%)** matched what the
function supplied. Re-running the prediction against the key actually **persisted** gives 46 exactly.

**The trigger is working as N15c intended — one writer for the dedup key.** But the argument inside
the mint is now **dead code that reads like the answer**, and it is what produced the wrong
prediction. **Durable rule: predict a canonical-key effect with the key the WRITER persists, not the
one the caller passes** — where a `BEFORE` trigger owns a derived column, the caller's argument is a
suggestion. Same family as P157/P182. Filed as **N15g** (cosmetic).

**This is also the value of predicting before measuring**: a +46 against no prediction reads as
"about right" and the defect stays hidden.

### ⚠️ Tier 0 moved +4, not the predicted ~+20 — a population signal, not a miss

Only **7.0%** of T2a's owners carry a second identity, against tranche one's 12.9%. **Resolving an
owner makes "who do we call there" askable; it does not manufacture a bench.**

### 👤 T2b — safe to run, low-value to run. No default taken.

2,241 properties / 2,054 owners. **The graph argument is settled** — T2b's predicted duplicate rate
(1.16%) is **lower than T2a's actual (1.79%)**, computed against the live post-T2a graph with the
corrected key. What remains is the **owner cliff**, exactly where C2a predicted: contactability
**21.3% → 17.2% → 3.7%**, known-beyond-gov 12.9% → 7.0% → **1.9%**. Cities, counties, DOTs,
corporate occupiers, private individuals. **A prospect-quality judgement, not a technical risk.**

## 2026-08-28 21:50 UTC — TIER0_AUTO_ATTACH: the flag was in the wrong place, and my doc made it a deadlock

**The dated verification came due and FAILED — then resolved.** Cron 241 fired at 06:55 UTC on both
08-27 and 08-28, `cron.job_run_details` said **succeeded** both times, and `tier0_auto` writes stayed
**0** with 9 auto cards waiting.

**Root cause: the flag lives in two places and only one is the gate.** Scott set
`TIER0_AUTO_ATTACH=true` as a **Railway environment variable**. The handler reads the
**`feature_flags_registry` TABLE** — `tier0-auto-attach-tick.js:208`,
`flagEnabled(await fetchFeatureFlag(FLAG))`. The env var did nothing.

**The tick's own run log is what proved it**, and it is the only durable record:

| ran | flag_enabled | auto_candidates | planned | attached |
|---|---|---:|---:|---:|
| 2026-08-28 06:55 | **false** | 9 | 9 | **0** |
| 2026-08-27 06:55 | **false** | 9 | 9 | **0** |

It found every card and planned every card, then was refused by the flag. ⚠️ **`net._http_response`
had already pruned** (~6-hour retention, P123) — 15 hours after the run there was no response body
left to read. **`cron.job_run_details` only ever tells you the POST succeeded.**

### ⚠️ And the documentation made it unresolvable — that part is mine

The canonical page said *"registry flips to `on` only after a tick reports `writes > 0`."* For a
**registry-gated** flag that is a **deadlock**: the tick cannot write until the registry says on, and
the policy said don't flip the registry until it writes. Written as a safety rule, it functioned as
a permanent off switch.

**Resolved: registry flipped to `on` 2026-08-28**, with the cause recorded in the flag's own notes.
Scott's intent had been unambiguous since 08-27 — the mechanism was wrong, not the decision. **The
next 06:55 run is the real test**: expect `active_source='tier0_auto'` 0 → 9, all reversible via
`lcc_tier0_confirm_log`. Recorded as trap **13** on the canonical page.

## 2026-08-28 — C2e-T2a drafted: tranche two, step one

**Prompt** → `prompts/C2e-T2a-tranche-two-step-one-2026-08-28.md`. **2,570 properties / 2,300
owners** at `owner_gov_rent >= 100000` — verified against `v_lcc_c2e_asset_mint_plan` (4,811 / 4,354
remaining, splitting 2,570/2,300 and 2,241/2,054 exactly as C2e §6 predicted). **17.2% already
contactable**, indistinguishable from tranche one's 21.3%, and it covers the whole $2M–$20M sweet
spot ($140k–$1.4M of rent at ~7% cap).

**The prompt front-loads what tranche one did NOT establish:** its cut landed at **$543,782 of owner
rent — entirely above the old $500k floor**, so it tested the safest population in the system and
exercised none of the low-rent tail. C2e measured tranche two as mildly worse (duplicate-group
formation 1.5× the rate), not catastrophically.

**Two attribution traps are written in explicitly**, both already hit in this arc: **`auto_mergeable`
has two threads moving it** (C2e's 3,038 → 3,005 was 64 merges from the other window, not the mint —
read `lcc_entity_merge_log` before attributing a delta), and **predict the duplicate-group delta
(~+38) before measuring, then reconcile it** rather than accepting a number that moves "about right".

**The step that must not be skipped:** drive `lcc_ingest_domain_owner_evidence` explicitly after the
mint. Cron 225 caps at 400/run daily, so a 2,570-row tranche would sit evidence-less for most of a
week — matching the retire predicate the eligible-set design exists to prevent.

**T2b is deliberately out of scope** and stays Scott's call; the prompt asks only what T2a's outcome
implies for it.
## 2026-08-28 — B6a-follow-up SHIPPED: the monitor went quiet at the moment it went blind

**LCC Opps LIVE + one dia grant.** Writeup:
`docs/audits/B6a_FOLLOWUP_FRESHNESS_MONITOR_2026-08-28.md`. Contract **I11** (now ✅ detector live),
playbook **Class 21**. **gov NOT touched.** Visibility only — the four producers are still dead (B6b).

- **Acceptance met, and it is a state delta, not a status.** `feeds_evaluated` **2 → 25**,
  `feeds_excluded_stale_mirror` **18 → 0**, mirror `synced_at` **33d (gov) / 30d (dia) stale → today**.
  **6 `feed_stale` alerts opened — all four B6a producers among them** (170/170/150/144d), plus dia
  `medicare_clinics` 64d and gov `sam_lease_opportunities` 32d. Re-run is idempotent (`new_alerts 0`).
- **⚠️ THE TRANSPORT WAS TWO UNRELATED CAUSES THREE DAYS APART, NOT ONE.** All 18 feeds froze in the
  same week, which reads like one bug in the shared pull. **gov** = a **marginal cold-cache statement
  timeout** — `500`/`57014` against `anon`'s **3 s** budget; warm the sweep is **231 ms**, but cold it
  measured **2,601 ms across just its top 8 feeds** and the 05:30 cron is the first touch of the day by
  construction. **Positive control: the identical request, same key — `500` cold at 17:41, `200` with
  all 18 feeds warm at 17:44.** **dia** = a **hard revoked `anon` EXECUTE** (`401`/`42501`). Fixing
  either alone leaves the other silent. **A `500` from a marginal cost is not a break — try it twice.**
- **⚠️ AND THE BRIEF'S OWN PREMISE WAS PARTLY REFUTED.** §2c said *"do not touch gov, its view is
  correct."* Its view **is** correct **and was not servable to the caller that reads it** — a different
  property, and the one that failed. gov is still untouched (mitigated LCC-side by a bounded retry),
  but *"the view is correct"* was not grounds to stop looking.
- **The exclusion was KEPT — deleting it is the wrong fix and worse than the bug** (the check would
  then alert on ages it explicitly cannot vouch for). What changed is that the excluded set became its
  own deduped, auto-resolving **`feed_mirror_stale`**, and `feeds_evaluated` /
  `feeds_excluded_stale_mirror` are now separate honest counts. **Both halves are pinned**, because
  each is a plausible "fix" for the other.
- **Three further silent paths closed alongside `(0,0)`:** a `RAISE NOTICE`-and-continue on a missing
  vault secret; a **`200` carrying an empty array** (the P157 shape — a status-code check passes while
  nothing arrives, so read the body); and a **`lost` class** — `net._http_response` prunes at **~6 h**
  while the inflight row lingered **24 h**, so a response arriving after finalize ran could **never** be
  consumed. *Ask what happens to a request that is neither answered nor answerable.*
- **The dia GRANT could not ship alone.** dia's registry ACL was `anon=arwdDxt`; `anon` EXECUTE on a
  **SECURITY DEFINER** function over a registry `anon` can write lets any anon caller repoint a feed at
  an arbitrary table — **the hole B6a closed on gov, still open on dia.** Both halves or neither.
- **⚠️ §2e sweep: this was the only one of ten `lcc_check_*` with the shape**, and
  `lcc_check_bd_sync_freshness` **already does it right** — it is the precedent this fix reuses rather
  than a new alert system. `lcc_check_cron_health` is the nearest neighbour and is covered by a
  *separate* sibling, so retiring that sibling would open the shape. Named, not fixed.
- **⚠️ Two self-inflicted traps worth carrying.** (1) `CREATE OR REPLACE` does not replace a function
  of different arity — all three signatures changed, and missing the `DROP` on
  `lcc_check_feed_freshness()` alone would have made cron 193 ambiguous (**42725**) and taken the hourly
  tick's **other three checks** down with it: a monitoring fix that silences monitoring. (2) plpgsql
  resolves an identifier to a **DECLAREd variable before a SQL alias**, so aliasing
  `net._http_response` as `r` beside `DECLARE r record` **plans fine and dies only when executed**
  (`55000`). Found by *running the function*; then the regexp fix **over-reached into the `FOR r IN`
  loop** and was caught by listing every affected line rather than trusting the substitution.
- **⚠️ Four of fifteen mutations left the test GREEN and had to be tightened** — `'lost'` also appears
  in a `FILTER`, the return columns are also *assigned* in the body, the watermark table is also named
  in an `ON CONFLICT` qualifier, and the mirror predicate also lives in the blind-spot scan. **A
  body-wide `includes()` is a weak assertion wherever the token recurs.** 17 tests, **15 mutations RED**.
- **⚠️ NOT fixed, read before quoting the monitor as healthy.** gov's timeout is **mitigated, not
  cured** — the first attempt each morning will still usually fail and the margin shrinks with every
  feed registered; watch `lcc_feed_freshness_sync_status.last_attempt_no` and raise **that**, never the
  retry cap (**B6a-follow-up-b**). The four producers remain dead (**B6b**, now unblocked — its premise
  was being able to tell whether a restart holds). And **B6a's `record_skip` has STILL not been
  exercised by a real run**: gov `run_log` carries **0 rows with `skip_reason` ever and 0 rows of any
  kind since B6a shipped** (newest 2026-08-27 18:52), so the RED producers prove the **registry** rows,
  not the emission fix. Until a run passes through, *no bad rows* and *no rows at all* read identically.


## 2026-08-28 — B6a SHIPPED: a skipped step emits nothing, and the health view was built on emitted rows

**gov DB LIVE + committed.** Writeup:
`docs/audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`. Playbook **Class 21**, contract **I4**,
gov `CLAUDE.md` §16. **No producer was restarted — B6b owns that; only visibility moved.**

- **Acceptance met.** The four producers dead since March–April 2026 now read **RED**:
  `gsa_lease_change_facts` 170d · `gsa_lease_timeline` 170d · `prospect_leads.ownership_change` 150d ·
  `property_sale_events` 144d, against a 45-day SLA. Feeds 14 → 18, stale 1 → 5, **0 pre-existing rows
  changed in either direction**.
- **⚠️ THE REGISTRY THE PROMPT ASKED FOR ALREADY EXISTED, WIRED END TO END.** R56's
  `feed_freshness_registry` + `compute_feed_freshness()` + the LCC cross-DB mirror + a deduped,
  auto-resolving `lcc_health_alerts` row — and `feed_stale` has genuinely fired 8 times. It read
  healthy over four dead producers **because nobody registered them**. Three registries already
  existed; a fourth would have been the drift this repo warns about. **Check what you have before
  building.**
- **⚠️ "A SKIPPED STEP IS NO ROW" IS ONLY HALF THE MECHANISM, AND THE PRESCRIBED FIX WOULD HAVE MISSED
  THE LIVE INSTANCE.** `gsa_ingest_+_diff` was **not absent** from `v_pipeline_task_health` — it carried
  `status='ok'`, *"Task completed"*, **2026-06-22, 67 days stale**, on a step whose own history says it
  ran every 7 days. `status` read the last outcome's `event_type` and nothing compared it to when that
  outcome should have been superseded. So *"enumerate declared steps, not logged ones"* returns nothing
  for it: **the missing dimension is cadence, not enumeration.**
- **The evidence was inside the green row's own payload.** `find_latest_gsa_inventory` logged *"Task
  completed"* with **`result: null`, `duration_seconds: 0`** six weeks running; the view projected
  `details->>'error'` and never `details->>'result'`.
- **The fix is at the EMISSION POINT — and it dissolves the enumeration problem.** `record_skip` /
  `run_guarded_task` make **both branches of a guard write**, so the logged set IS the declared set and
  no step registry is needed. Five guard sites rewired. **`declared` has no default**: a skip somebody
  chose is healthy and must be visible without alerting; an undeclared skip is the finding. **Not
  emitted for scope selection.** `tasks_skipped` previously counted **dry runs** — split, and
  **`tasks_skipped_undeclared`** added as the number that means something.
- **⚠️ A PRODUCER IS NOT A TABLE.** A plain `prospect_leads` registry row stays **green** (0d — other
  lead sources are live) while its `ownership_change` lane is 150 days dead. Structured
  `filter_column`/`filter_value` through `%I`/`%L` (never free SQL — the function is `SECURITY
  DEFINER` and runs dynamic `EXECUTE`), both-or-neither CHECK. Also **revoked anon/authenticated
  write grants** on that config table (anon could repoint the function's targets or delete the
  registry); SELECT retained for the LCC pull.
- **The cadence statistic was measured, not chosen.** `is_overdue = age_days > 3 × the step's own p90
  inter-run gap`. **p90, not median** — clustered runs deflate the median and false-positive healthy
  monthly steps (`census_demographics` median 3.99d vs p90 28.78d; at 23d the median rule flags it,
  p90 does not). **NULL below 3 observed gaps**, never false.
- **Positive-controlled (§2a).** A healthy weekly step read not-overdue; **the same step silenced 60
  days read overdue**; declared and undeclared skips are distinguishable — all in a self-rolling-back
  transaction, **0 residue**. A hostile `filter_value` returns `no_data`, not everything. 23 tests,
  **18 mutations verified RED** (two guards were caught blind by the mutation run and strengthened);
  comments and docstrings stripped before matching, positive-controlled.
- **⚠️ FOUND, NAMED, NOT FIXED — the instrument one level up is blind.** The cross-DB freshness monitor
  has evaluated **no gov or dia feed since 2026-07-26**. Crons 140/141 fire daily and record
  `succeeded`; the mirror's `synced_at` is stuck; `lcc_finalize_feed_freshness` consumes only
  `status_code = 200` and **silently drops anything else**, returning `(0,0)`; and
  `lcc_check_feed_freshness` **excludes mirror rows older than 3 days**, so it evaluates zero feeds and
  returns `stale: []`. **When the sync stops, the check stops checking and reports nothing wrong.**
  Live proof: gov reads a stale feed today with **no open `feed_stale` alert**. So B6a's four RED
  producers **will not reach an alert until this is fixed** — backlog **B6a-follow-up**.
- **Also named, not fixed:** 10 `step_NN_*` steps of `src/run_pipeline.py` now read overdue at 121–150
  days (true — CI runs `pipeline_runner`, not that orchestrator); and **the GSA skip is documented in
  `ci.yml` and compensated by the weekly `gsa-sync` job**, so it is a genuine instance of the class but
  was **not** the load-bearing cause of the four-producer blindness — that was B6 §8(a) plus the fact
  that no instrument watched those four tables.


## 2026-08-28 — B5 SHIPPED: gov's sales table becomes ownership history (+ a destructive trigger fixed)

**gov DB LIVE. LCC JS pending a Railway deploy.** Writeup:
`docs/audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`.

- **The feeder.** gov had never consumed `sales_transactions` as ownership history — 169 of 9,515
  named, dated sellers (1.8%). `gov_feed_sales_transitions` (dry-run default, batch-reversible) wrote
  **2,776 transitions over 2,000 properties**. Transitions view **9,595 → 12,371** rows,
  **4,698 → 5,555** properties; **2+ guard-passing links 1,376 → 2,118 (+742)**. Idempotent — a
  re-run plans 0. Reverse: `gov_unfeed_sales_transitions('b5_gov_20260828')`.
  **Ceiling graded down 3,080 → 2,776 / 2,114 → 2,000.**
- **⚠️ THE HEADLINE IS THE BUG IT SURFACED.** `trg_propagate_ownership_to_property` had **no guard on
  `NEW.recorded_owner_id`**, so any dated `ownership_history` row naming its parties as TEXT
  **overwrote `properties.recorded_owner_id` with NULL** — silently, with no ledger, unrecoverably.
  **7,567 live rows are in that shape**; B5's first run alone would have destroyed the recorded owner
  on **1,446 of the 9,312 gov properties that hold one (15.5%)**. Proven on property 7370 and rolled
  back, before *and* after the fix. Fixed fill-forward by
  `sql/20260828_gov_b5a_ownership_propagate_fill_forward.sql`; `props_with_recorded_owner` held at
  9,312 across the real 2,776-row batch. **Do not revert it to unblock a producer.**
- **⚠️ A2b's earliest-wins rule does not reproduce here** — the sale row is later **217** times and
  earlier **34** against an already-recorded pair (A2b measured 26 of 26 the other way), so the
  anti-join keys on the **party pair**, not the date. Quote A2b for its own population.
- **⚠️ Depth at the SOURCE is not `chain_2plus`.** 1,376 view-level 2+ properties convert to 178
  facts today (12.9%). LCC is deliberately unmoved as of this entry: any_history 2,238, chain_2plus
  178, lane completed 1,302, **human_actionable 55**.
- **⚠️ Stale-draft trap, third arrival** (after A4b and A2b). 527 of 579 open tasks already carry a
  pre-B5 draft and the drafter prepares only `fresh` = open ∧ undrafted. `runB5RedraftPass` (keyed on
  STATE, so it catches the next source too) closes it — **JS, so it needs the deploy**; without it B5
  converts on 52 tasks, not 579.
- **B5 is the missing consumer for a producer that already mints the parties** — `r9_chain_connect`
  (cron 104) has read gov sales seller/buyer for months with nothing attaching its output.
- Guards: `tests/unit/test_b5_sales_transition_feeder.py` (gov, 13, **all mutation-verified RED**),
  `test/b5-chain-redraft-pass.test.mjs` (LCC, 10, **9 mutations RED**). Suite **4,815 / 0 fail**.
## 2026-08-28 — B6: the owner/lessee change-signal sweep. Most sources are already consumed; the gaps are four dead producers, two unpopulatable columns, and a health view that cannot see a skipped step.

**AUDIT + DESIGN, nothing built.** Full writeup:
[`docs/audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`](../audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md).
Folded into `docs/architecture/connectivity-and-open-threads.md` §4j; backlog rows **B6a–B6g**.

Nineteen signals swept across gov + dia against Scott's three requirements — coverage, corroboration,
next action. **The framing that "we are missing sources" is largely wrong.** Deeds are **98.5%**
consumed, the CoStar sidebar writes both parties, and gov's sales table turns out to be ~97%
represented in `ownership_history` under other provenance labels.

⚠️ **Both numbers I filed the B6 prompt under are corrected.**

- **38,213 landlord-change rows deflate 28.6× → 1,338 net-new / 1,202 properties.** The stages:
  **46.7% of the flag is a pure name re-spelling** (it is computed on raw string inequality, not a
  normalized key); then transition-clean guards; then **−33% for property resolution**; then the A2b
  per-lease fan-out collapses 13,225 → 4,845 conveyances; then P138 oscillation. Still worth
  building — it spans **2013→2026**, so it adds DEPTH, and it is a **FLOOR** (four monthly snapshots
  sit undiffed).
- **`property_sale_events`' two link columns are a TYPE DEFECT, not neglect.**
  `ownership_history_id` and `sales_transaction_id` are **`bigint` against `uuid` PKs with no FK** —
  a writer raises `22P02`. **dia's identical table has a compatible `integer` PK and 52 populated
  rows**, which is the positive control that makes gov's zero structural. This is the comp↔ownership
  join Scott's framing names, and in gov it has never existed.

**⚠️ The lesson worth keeping: A SKIPPED STEP EMITS NOTHING, AND A HEALTH VIEW BUILT ON EMITTED ROWS
CANNOT SEE IT.** Four producers died in March–April 2026 —`gsa_lease_change_facts` and
`gsa_lease_timeline` (2026-03-11), `prospect_leads.ownership_change` (2026-03-31, 7,729 leads of
which **2,041 were actually worked**), `property_sale_events` (2026-04-06). `pipeline_runner.py`
guards the diff with `if latest_file and not runner.dry_run:`, and `find_latest_gsa()` globs a
**local folder** that is always empty on a CI checkout: it returns `None` and is logged **"Task
completed"**. The guarded `run_task` is then never invoked, writes **no `run_log` row**, and has
**no row in `v_pipeline_task_health`** — which today reports one failing step (SAM, 401) and
otherwise all green. **gov `CLAUDE.md` §16 built that view to stop a green `completed` masking a
FAILED sub-task; the SKIPPED case was left open, and it is invisible in a different way — a failed
step is a red row, a skipped step is no row.** It is A5a's lesson in a health view: a producer that
never emitted has no row to `GROUP BY`. **Enumerate declared steps, not logged ones (B6a).**

**Separately: the landlord-change detector has no scheduled caller at all.**
`gsa_lease_change_facts`/`gsa_lease_timeline` are written **only** by `src/ingest_gsa_historical.py`
(a manual CLI, reachable from `run_pipeline.py:172`, which CI does not run). The live Monday job
`src/gsa_auto_sync` writes `gsa_snapshots` + `gsa_lease_events` and **not** the change layer — **the
raw feed and the derived layer have different writers and only one is scheduled.**

**⚠️ B5 is in flight and its ceiling should be re-derived before it builds.** I could not reproduce
`3,080 / 2,114`, and **the anti-join is scope-sensitive by 26×**: against the `sales_transaction`
provenance bucket → **9,517 rows**; against the **whole store** → **366** on the same exact-date key,
or **269 / 215 props** without the date. 3,080 sits between the two, so I am **not** claiming to have
found its bug — the ceiling is simply uninterpretable without its scope. **And 3,313 of the 9,686
named-seller rows are `ownership_change_stub*`, a mechanism gov R37 explicitly RETIRED** (ranked
priority 9 in every sales-dedup pass), minted *from* ownership history — **feeding them back is
circular**. Honest target: **~270–370 rows / ~215–291 properties**, mostly `costar_export`. That does
not refute B5's premise; it resizes the prize by an order of magnitude.

**The corroboration Scott asked for already exists — its verdict just has no reader.**
`parcel_owner_xref` runs every 30 minutes and produces **8,838 `corroborates` / 561 `diverges` / 362
properties**. ⚠️ **319 of those 362 already carry the assessor's name as `new_owner` in
`ownership_history`** — so that is a **propagation gap between the store and
`properties.recorded_owner_id`**, the cheapest correction in the audit; only **43** are genuine
net-new. `diverges` produces no task, card or lead (B6h, renamed from B6d 2026-08-29). And the ladder that should adjudicate
disagreements **has no rung for `gsa_lease_diff` (6,648 rows, its largest source) or
`sales_transaction`** (B6e).

**Measured and refuted — three would have been expensive builds.** `ownership_research_queue`
(17,665 rows) is **100% complete**, not a stalled backlog. **Deeds are 98.5% consumed — the gap is
EXTRACTION** (876 grantors of 5,804), which independently supports B1a/B5's finding that county-deed
acquisition is the wrong first lever. **gov `CLAUDE.md` §21's "state-lease producer silent 6+ weeks"
is SUPERSEDED** — 617 rows, all within 90 days, events to 2026-08-05 (its `property_id`-is-NULL half
still stands). And `gsa_lease_events` is not a landlord signal at all — it is the **LESSEE** half of
Scott's ask, and it is the healthiest lane in the matrix (7,522 leads, **2,863 worked**).

**⚠️ Detector hygiene, for the next Class-20 sweep:** `ownership_source` is **not** a controlled
vocabulary — **2,978 distinct values over 14,076 rows**, embedding record ids
(`county_deed:<uuid>`, `gov_master_backfill_r71|h=<md5>`). Split on `:` and `|` before grouping, or
gov `county_deed` reads as **1 row instead of 1,614**. And **69% of dia's own `ownership_history`
carries a NULL `ownership_source`**, so the detector is structurally blind to it (B6g).


## 2026-08-31 — 🎯 THE CMS OUTAGE IS ROOT-CAUSED. It was never a hang — it is a 30-day throttle keyed on the last ATTEMPT.

**From the Railway logs Scott pulled (1,001 lines, 2026-08-31 06:03 → 16:42, one deployment).** The
decisive three lines, from **today's** run:

```
06:03:21  WARNING:__main__:CMS ingestion recently run (3 days ago < 30); skipping. Use --force-run to override.
06:03:21  CMS ingestion recently run; skipping.
06:03:21  [2026-08-31T06:03:21Z] Cron complete
```

**The cron fires daily, decides it ran recently, exits CLEANLY with zero errors, and ingests
nothing.**

⚠️ **The mechanism is the whole outage: "3 days ago" is measured from the last ATTEMPT — 2026-08-27,
which was `abandoned` — not from the last SUCCESS, 2026-06-25.** So **a failed run buys 30 days of
silence**, and the next failure buys another 30. That is exactly how a two-month gap forms without
anything erroring.

⚠️ **AND THIS IS THE THROTTLE B6d-cms REPORTED REMOVING.** The log is from **2026-08-31, after that
PR merged** — so either the Dialysis PR is not deployed to this Railway service, or the fix did not
cover this path. **Verify the DEPLOYED code, not the merge** (*merged is not running*, a fourth time).

✅ **Immediate unblock: run it with `--force-run`.**

⚠️ **A correction to my own framing, and it is the useful lesson.** I reported *"no attempts since
08-27, against a daily schedule"* and read that as the cron having stopped. **It had not. The cron
ran every day — a SKIP writes no `ingestion_tracker` row, so it leaves no trace.** *"No rows" and
"no runs" are different facts*, which is **Class 21 one layer up**: B6a made a skipped step visible
inside the pipeline runner, and here a skipped step is invisible *to the tracker itself*.

### 🚨 And the same service is failing ~1,000 times a day while reporting success — filed as `B6d-pri`

The `public-record-ingest` service produced **502 error lines and 499 info lines in one day**, from
**three distinct live defects**:

1. **496× `null value in column "reason" of relation "pending_updates" violates not-null
   constraint`** (23502) — the writer omits a NOT NULL field, so **every** pending-update write fails.
2. **486× `Failed to mark stale <uuid>: Supabase Postgres DSN not configured`** (`SUPABASE_DB_DSN` /
   `SUPABASE_DB_POSTGRES_URL` / `SUPABASE_DB_URL`) — **a missing env var on the Railway service.**
   The entire mark-stale path is dead.
3. **10× `column properties._new_property does not exist`** (42703) — a stale column reference in the
   comparison step.

⚠️ **And it logs `Pending updates cleanup complete` immediately after ~500 consecutive failures.**
That is the honest-count failure this whole arc has been about, in a single line — **and none of it
alerted, because the service exits 0.**

## 2026-08-29 — AUTH contradiction SETTLED, and B6d-cms was pointed at the wrong producer

### ✅ Auth: enforced. `CURRENT-STATE.md` was wrong; `CLAUDE.md` was right.

`GET /api/diag?kind=auth-ready` → **`lcc_env: production`, `enforcing: true`,
`api_key_configured: true`**. One command, contradiction closed, and the wrong page corrected in
place.

⚠️ **`would_pass_in_production: false` in that same response is NOT a failure, and the docs invite
misreading it.** It describes **the calling request** — that curl sent no key, so rejection is
correct behaviour and is itself the proof. **`CLAUDE.md` rule 0 tells you to verify readiness with
`would_pass_in_production == true`, which is guidance for BEFORE the flip.** Post-enforcement, an
unauthenticated probe returning `false` is expected. Noted on the row so nobody reads it as a break.

### 🚨 B6d-cms: I named the wrong producer, and this failure was already diagnosed in June

**(1) The producer is a RAILWAY CRON, not the GitHub workflow.**
`audit/data-flow-2026-05-30/DIA_OVERVIEW_TILE_AUDIT_2026-06-23.md` says it outright: the live path
is **Railway cron → `scripts/cron/cms-ingestion.sh` → `python -m src.run_cms_ingestion`**, and
**`cms-ingestion-daily.yml` is a `workflow_dispatch` MANUAL FALLBACK ONLY.** **My B6d-cms prompt
named the workflow as the producer.** A fix landing there would not touch the daily run — **which is
exactly consistent with zero attempts since 2026-08-27.**

**(2) This exact failure was diagnosed on 2026-06-23 and the write-up is still in the repo.**
`CLAUDECODE_PROMPT_CMS_INGEST_hangguard.md`: *"The cron FIRES, but runs HANG… stuck in `'started'`
for 9-24h and marked `abandoned`… each daily tick reclaims the prior orphan, starts, hangs, dies."*
Root cause named there: **no per-step timeout in `run_cms_ingestion`'s steps loop**
(`src/run_cms_ingestion.py` ~679-746). **The symptom then — last success 2026-05-13 — is
byte-for-byte the symptom now, last success 2026-06-25.**

**So this is a RECURRENCE or a never-applied fix, not a new defect.** ⚠️ **Check whether the
hangguard ever shipped before diagnosing from scratch** — that is the *re-measure a dated blocker*
rule, and I skipped it: I drafted B6d-cms without grepping for prior work on the same producer.

⚠️ **And the prior fix as specified would not have been sufficient anyway.** The hangguard proposes
**SIGALRM**, which `CLAUDE.md` later established is **not enough**: *SIGALRM does not bound a blocked
C-level socket read — every network call in the Python pipelines MUST carry its own `timeout=`.*
**A SIGALRM-only fix would look applied and still hang**, which may be precisely what happened.

## 2026-08-29 — 👤 DECISION: credential rotation DEFERRED until a second LCC user

**Scott, 2026-08-29:** *"Skip all the key rotation until we add another user to the LCC. I'm not too
worried about it since we are single user for now and still building."*

**Recorded as a risk acceptance with a trigger, not dropped.** `SEC2` (the committed `LCC_API_KEY`),
`I1` (the PA webhook secret) and `SEC3` (Supabase keys in ten of seventeen PA packages) stay open and
marked ⏸️ **DEFERRED** in both `PLANNED-BACKLOG.md` §P0s and `OPERATOR-ACTIONS.md`. The rationale is
sound: single-user, still building, private repo — **the exposure has no second party to reach.**

⚠️ **One correction to the trigger, and it is the reason this is written down rather than assumed:
the PRIVATE REPO is what carries the risk, so "another user" is not the only event that fires it.**
Rotate before **any** of: a second LCC user · **making the repo public** · **sharing it with a
contractor, vendor or Northmarq IT** · a lost or compromised laptop · LCC leaving "still building"
for anything a client touches. **Several of those could happen without anyone thinking of them as a
security event**, which is exactly why the trigger is enumerated.

✅ **SEC4 stays ACTIVE and is now the more valuable half.** It is a *guard*, not a rotation — a
pre-commit/CI check for JWT-shaped, `sb_secret_` and long-hex strings in flow exports and config
files. **Deferring rotation is a decision about the keys already exposed; SEC4 is what stops the
next PA export adding more.** Without it, the eventual rotation is against a moving target.

**And the order is recorded now, while it is cheap to write down:** rotate → update Railway →
`git rm --cached` + `.gitignore` → **only then** consider history. `git rm --cached` alone leaves the
value in history and in every clone, and **`filter-branch` is the tool that nearly cost this repo a
475 MB mailbox.**

## 2026-08-29 — D1 drafted, and sizing it corrected the invariant it was written from.

**Prompt: `prompts/D1-cross-database-provenance-diff-2026-08-29.md`.** Audit + a standing detector;
**builds no feeder.**

⚠️ **I2's stated query has a POPULATION OF ONE, and I only found that by trying to size it.** The
invariant says *group the fact store by its provenance column, split by domain*. Measured on LCC
Opps: **exactly one table carries both a domain column and a provenance column —
`lcc_entity_portfolio_facts`, the very table that found B5.** Writing that as *the* detector
overstated its reach, and a prompt built on it would have swept one table and reported a
comfortable result.

**The form that generalises is a CROSS-DATABASE diff of parallel tables (gov vs dia)** — which is
how B5 was *actually* found, and how B6c found dia's `property_sale_events` differs from gov's.
**Twelve parallel pairs carry a provenance column.** I2 is corrected in place.

**Two traps the sizing already surfaced, both now in the prompt:**

- 🚨 **A naive cross-DB query breaks on the first pair it meets** — `properties` uses **`data_source`
  in gov and `source` in dia.** *Resolve the provenance column per table from the catalogue; never
  hard-code it.* Several values also carry a `:<uuid>` / `|h=<hash>` suffix, so `split_part` before
  grouping or the diff drowns in one-row buckets.
- ⚠️ **Row-count disparity is NOT the signal — the producer SET is.** `property_financials` is
  **98,510 (gov) vs 676 (dia)**, a 145× gap that may be entirely legitimate. **Diff the distinct
  sources; report volume only as context.** A detector that flags volume would have opened with a
  false headline.

**Three guardrails carried in:** a difference is not a defect and the surface must let one be
**marked explained with a reason** (*a detector reporting 40 legitimate differences every run is
noise, and will be ignored within a month — the exact failure B6d just fixed one layer up*); the
detector must **re-find B5, B6c and B6b from cold** as its positive control, since *a run that
surfaces nothing is a bug signal, not a clean bill of health*; and it must **not manufacture a
finding** — if every difference is legitimate, that is a real result and its value is preventing the
next divergence.

⚠️ **Kept distinct from its two siblings, deliberately:** **I2/D1** asks *does the other domain have
this producer at all* · **I3/D2** asks *can this link column hold its target's key* · **B6c-orphan**
asks *does the key it holds still exist*. Three questions, three detectors, one family.

## 2026-08-29 — B6d-cms root-caused and fixed IN CODE. ⚠️ Verified: the outage is NOT yet fixed, and that distinction is the whole point.

Merged: `Dialysis#7379` (the code fix — removes a **throttle** and a **crashed-run latch**) plus the
LCC half (audit doc, backlog, **I4**). **The cross-repo link is no longer dangling** — the Dialysis
`CLAUDE.md` points at `docs/audits/B6d_cms_INGESTION_REPAIR_2026-08-29.md`, which is now on `main`.

**⚠️ I measured the only metric that counts, and it has not moved:**

| check | result |
|---|---|
| `max(medicare_clinics.source_last_seen)` | **still `2026-06-25`** |
| clinics refreshed since | **0** |
| newest CMS attempt | **`2026-08-27 06:12` — `abandoned`, `rows_upserted` NULL** |
| attempts on 08-28 / 08-29 | **NONE**, against a daily `0 6 * * *` schedule |

**That silence is itself evidence the fix targets a real mechanism** — a crashed-run latch left set
by an abandoned run would stop everything after it, which is exactly the pattern. **But it is
unproven until a run completes.**

⚠️ **"Root-caused and fixed in code" is not "fixed", and CC said so explicitly rather than letting
the merge read as success** — *"the PR does not fix the outage on its own… the state delta to check
is `max(source_last_seen)` moving past 2026-06-25, not CI going green."* **That is the doctrine
working at the moment it is least convenient**, and it is the third layer of the same rule this arc
keeps re-learning: *merged is not running · running is not working · a green check is not a state
delta.*

**The verification is the next 06:00 UTC execution.** Check `source_last_seen` advancing and the
`feed_stale` alert auto-resolving — **not the merge, not the redeploy, not CI.**

⚠️ **And the deeper cause is still open.** The runs were **abandoned** — killed mid-flight, no
terminal status — and **nothing yet explains what was killing them.** Removing the latch clears the
*consequence*; if the next run also abandons, **the latch was never the cause.** Filed as
**`B6d-cms-restart`**, and it needs **Railway deploy logs no agent can reach** (👤 Scott). Candidates:
an OOM/timeout on the runner, a CMS API or schema change dated ~2026-06-25, an expired credential
(⚠️ **check whether one rotation also took out SAM — B6d-sam**), or a changed dataset id.

## 2026-08-29 — ✅ B6d SHIPPED. The alert surface is graded, and the ONE SLA I guessed was wrong was a REAL two-month outage.

Merged: `life-command-center#1933` · `Dialysis#7378` · `government-lease#393`.
**Live: 25 registered feeds, every one carrying a graded expectation OR a recorded reason for having
none. `feed_stale` 4 → 2, and both survivors are genuine outages. 0 alerts describing a decision.
0 `feed_mirror_stale`. 2 feeds unwatched-by-decision, still emitting their age.**

**⚠️ THE RULE THAT EARNED ITS KEEP WAS THE ONE I WROTE AGAINST MY OWN HYPOTHESIS.** I predicted
`medicare_clinics` was *"probably the SLA is wrong — CMS publishes slowly"*, and added §3c: **do not
weaken an SLA to silence a real defect; measure CMS's actual cadence first.** Measured: the feed's own
history is **p50 gap 2d, p90 18.5d, max 41d** — and the current age is **65d, above the largest gap it
has ever had.** **The 45-day bound was never the problem.** Widening it would have buried a two-month
ingestion outage.

**I re-verified it independently and it is WORSE than the audit recorded, because it is still
accruing:** `ingestion_tracker` for CMS now reads **116 success (newest 2026-06-25) · 40 FAILED
(newest attempt 2026-08-26) · 16 ABANDONED (newest 2026-08-27)** — and the abandoned rows carry
**`dataset_modified_date = 2026-08-25`**. **CMS published four days ago, we tried, and the runs
failed.** The audit's "27 failed + 6 abandoned" was correct when written; **failures accrue daily**.

⚠️ **My first three verification queries were all against the wrong objects** — `ingestion_runs` (empty),
`ingestion_log`, and `cms_dataset_updates` (which tracks only `cms_patient_counts`, last published
2026-03-24). I briefly could not reproduce the audit's claim and nearly reported a discrepancy.
**What resolved it was reading the registry's own `ts_column` — `source_last_seen`, not `updated_at`
— and its `expectation_basis` field, which records the entire reasoning inline.** *That field is
B6d's real deliverable: it made a shipped conclusion re-checkable by someone who did not write it,
which is exactly what the whole cleanup arc is for.*

**Two more caught before they fired**, both non-defects, exactly as predicted: `opm_workforce`
(age 120 vs SLA 120 — would have alerted the next day) and `gsa_leases_snapshot` (GSA has not
published August).

### ⚠️ And the round turned its own theme on itself — a security claim that was FALSE when written

`compute_feed_cadence` is SECURITY DEFINER over registry-derived dynamic SQL. The first narrowing —
`REVOKE EXECUTE ... FROM anon, authenticated` — **was a no-op**, because **Postgres grants EXECUTE on
a new function to PUBLIC by default**, and both roles still reached it that way. Measured on the live
object *after* the "fix" shipped: `proacl = {=X/postgres, ...}` (**the leading `=X` IS the PUBLIC
grant**) and `has_function_privilege('anon', oid, 'EXECUTE') = TRUE` on gov and dia. **An
unauthenticated caller could invoke a definer function running dynamic full-table scans over every
registered source table.** Corrected by `REVOKE ... FROM PUBLIC`; verified with
`has_function_privilege`, **not by reading the grant that was just written.**

**Caught by a review bot, not by its author** — and it is this round's own §3d (*positive-control the
change*) applied to everything except the security assertion. Already in `CLAUDE.md`.

## 2026-08-29 — B6d drafted: grade the feed EXPECTATIONS. Two more alerts fire imminently for non-defect reasons.

> ⚠️ **SUPERSEDED THE SAME DAY BY THE SHIPPED ENTRY AT THE TOP OF THIS FILE** (`B6d: the feed
> expectations are graded…`). The framing held and the two imminent non-defect fires were real, but
> **three of the four predicted verdicts were refuted by measurement**: `sam_lease_opportunities` is
> **not** a rate-limit case (that is `SAM_GOV_API_KEY` on a different endpoint — this is a genuine 401
> on `SAM_API_KEY`, so its bound was tightened and deliberately left violated); `medicare_clinics` is
> **a real two-month ingestion outage**, not a mis-sized SLA; and the population is **25 feeds, not
> 23**. Retiring `property_sale_events` was right, but **not by dropping the row** — that is what
> stranded its alert. **Read the shipped entry, not this one, for what is true.**

**Prompt: `prompts/B6d-grade-the-feed-expectations-2026-08-29.md`.** It closes the
B6a → B6a-follow-up → B6b arc honestly, **grades expectations only, and writes no data.**

**B6b-lead's refusal is what makes it urgent.** We *decided* not to restart
`prospect_leads_ownership_change` — so its alert now **describes a decision and will sit open
forever**. ⚠️ **An alert describing a decision is the badge-that-is-noise failure, inside the
alerting system we just spent three prompts repairing.**

**Live: 23 feeds · 4 alerting · 19 ok.** The four have three non-defect explanations and one genuine
hypothesis: retire the ownership-lead expectation (no human consumer); re-scope `property_sale_events`
(**its only live producer is an operator form with no cadence** — a 45-day SLA alerts whenever nobody
types a sale for six weeks); re-scope `sam_lease_opportunities` (a 14-day SLA against a documented
**~10 lookups/day** limit is unachievable); and **measure CMS's actual cadence** for
`medicare_clinics` before touching it — ⚠️ **that one is still a hypothesis, and widening an SLA to
silence a real break would bury it.**

🚨 **Two more fire imminently, and neither is a defect:** **`opm_workforce` is age 120 against an SLA
of 120 — it alerts tomorrow**, and **`gsa_leases_snapshot` (59 vs 65) fires in ~6 days because GSA
has not published August.** *A publisher that has not published is not a broken pipeline.* Catching
these before they fire is the difference between a graded surface and a surface people learn to
ignore.

⚠️ **The tell that these were never graded: `expected_max_age_days = 45` appears on 10 of 23 feeds.**
A default, not a measurement — which is why the prompt grades **all 23**, not just the six in
trouble, and requires each to state its **cadence class**: continuous (operator), scheduled (cron),
or **external publication** (GSA monthly, CMS ~annual, OPM slow, SAM rate-limited). **An
external-publication feed's SLA is a property of the PUBLISHER, not of our pipeline** — conflating
those is exactly why `gsa_leases_snapshot` is about to alert.

**Two rules carried in from what this arc has cost us:** a retirement must be **recorded, not
deleted** (otherwise B6a's "a skipped step must emit, not vanish" is undone one layer up), and the
detector must be **seen firing after the change** — *an SLA set so wide nothing can trip it is the
same failure as no monitor at all* (I11).

## 2026-08-29 — 🛑 B6b-lead GRADED AND CORRECTLY NOT RESTARTED. My §0 premise was refuted, and it was the whole justification.

`docs/audits/B6b_lead_OWNERSHIP_LEAD_RESTART_2026-08-29.md`. **The right outcome, reached by
refuting the prompt that asked for it.**

**I wrote in §0: *"Its consumer is CONFIRMED ALIVE, with a measured working record — 7,729 leads ·
2,041 worked · 208 pushed to Salesforce · 2,149 touched in 30 days. Most restarts cannot say
that."*** That was the entire reason this producer was worth restarting. **Every number is real.
Every one means something else.** Verified independently by Cowork:

| I quoted | it actually is |
|---|---|
| **2,041 worked** | `pipeline_status = 'filtered_multi_tenant'` — an **automated exclusion filter**. The lane has exactly **two** status values ever (`new`, that one). **No human has ever set a status.** |
| **208 pushed to Salesforce** | `sf_contact_id IS NOT NULL` = a **matched EXISTING contact**. ⚠️ **`sf_lead_id` is non-null on 0 of 7,729; `sf_sync_status='pending'` on ALL 7,729. Nothing has ever been pushed.** |
| **2,149 touched in 30 days** | **1,216 on a single day** — a bulk sweep, not use. |

**The lane has NO human consumer. It is Class 2 — precisely what I claimed it was not.**

⚠️ **This is the A5 lesson, repeated by me, four days after I wrote it up.** A5's 596 `gap_resolved`
"completions" were all a truncated auto-close; I documented that, then inherited three status counts
from B6b §9 and repeated them without asking **what writes those values**. Filed as **playbook Class
26** and `CLAUDE.md`, because *knowing the rule did not prevent the mistake* — which is the only
reason it earns its own class rather than a footnote.

**The three questions, one query each:** who or what SETS this status · does the "sent" column mean
sent (a **destination** id means *matched*; an **emitted** id means *sent*) · is the activity a
distribution or a spike.

⚠️ **The correction did not reverse the decision — it replaced the reason, and that distinction
matters.** The safety gate I demanded be graded, `is_same_owner`, came back **91.80% agreement and
errs conservative — it PASSED its stop test.** Had the grade been the only check, this would have
restarted. **It was refused on the consumer finding, which the gate grade could never have
surfaced.** *Grade the gate AND the consumer; either can disqualify.*

**Also corrected: the population.** Real figures are **584 total / 42 since the lane died** — far
below the backlog's 10,635 *and* below my own deflated ≈4,987. ⚠️ **And `normalize_entity` has a real
defect found on the way**: unanchored `str.replace` mangles names — **`ABC INCOME LLC` → `ABCOME`,
`ABC CORPORATION` → `ABCORATION`.** The reference comparator that reproduced 7,940 exactly is the
A2-sanctioned alnum key (`lower()` then strip non-alphanumerics).

**Two things deliberately NOT done, both correctly:** the restart, and **registering it in B6a's
producer registry** — *registering a producer nobody will restart adds a permanent RED row describing
a decision*, which is the badge-that-is-noise failure.

## 2026-08-29 — B6b-lead drafted. The deflation is measured, and the "no lessor signal" claim is refuted by a probe bug.

**Prompt: `prompts/B6b-lead-restart-ownership-lead-lane-2026-08-29.md`.** The last of the four open
`feed_stale` alerts that is a genuine restart candidate.

**Why this one earns a restart when most dead producers do not: its consumer is confirmed alive with
a measured working record** — 7,729 leads, **2,041 worked, 208 pushed to Salesforce, 2,149 touched
in 30 days.** Dead since 2026-03-31, correctly alerting at 150 days.

**⚠️ The jsonb-string trap, confirmed live and quantified.** `changed_fields` is a jsonb **STRING**
on **201,212 of 233,666 rows (86%)**, so the naive `changed_fields ? 'lessor_name'` returns **0**
while the correct `(changed_fields #>> '{}')::jsonb ? 'lessor_name'` returns **16,907**. **B6 and
B6b's first probe both read that zero and wrote the producer off.** Playbook Class 11; the rule is
**check `jsonb_typeof` before trusting any containment result.**

**⚠️ And the deflation is now measured, which changes the target substantially:**
**16,907** → −415 missing a side → **−7,940 PURE RE-SPELLINGS (47.0%)** → **8,552 genuine across
2,760 properties** → **−3,565 (42% of genuine) carry `property_id IS NULL` and cannot reach a
property-keyed store at all** → **≈4,987 genuine and property-linked**, still before the A2b
per-lease fan-out and the P138 oscillation guard.

**The 47.0% re-spelling rate independently corroborates B6's 46.7% on `landlord_change_flag`** —
two different populations, two different queries, the same answer. That is the kind of agreement
worth noticing, because most of this arc has been measurements disagreeing.

⚠️ **The backlog's own "10,635 usable pair-events" is PRE-deflation and is now marked as such.** And
only **995 of them arrived since the lane died** — **9,640 are historical residue**, so *resuming the
producer* and *backfilling five months* are two decisions the prompt keeps separate.

⚠️ **`is_same_owner` is the only gate and has never been graded.** The prompt grades it head-to-head
against the normalized comparison before anything writes, and says plainly: **if it cannot separate
a re-spelling from a sale, STOP** — manufacturing thousands of false ownership leads into a lane a
human actually works is strictly worse than leaving it dead.

⚠️ **Expect the lane to stay QUIET after a correct restart.** Newest lessor event is **2026-07-01** —
the same ceiling as the raw GSA feed, because GSA has not published August (pull ledger 2026-08-24,
`consecutive_unchanged=3`). **A correct restart drains the backlog and then waits**, and that must
not be read as failure — the mistake B6b nearly made in the other direction.

## 2026-08-29 — ✅ B6c-dup SHIPPED. The collision was real, the write path did leak, and the orphan count was ZERO — after three wrong answers, two of them mine.

`docs/audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`. **Decision, in writing:
`sales_transactions` is the canonical comps spine; `property_sale_events` is a CAPTURE surface that
propagates into it.** 77 of 77 gov views that read a sale store read the spine (all 30 `cm_gov*` CM
views); zero read PSE. **`detail.js` said the opposite in its own comments — corrected at 4 sites,
each marked and quoting the old wording.** Shipped `trg_gov_pse_propagate_to_sale` (AFTER INSERT,
**the single owner of that transition**), `field_source_priority` @5, ledger + kill switch + batch
reversal.

**The leak was confirmed BEHAVIOURALLY, in a rolled-back transaction — PSE +1, spine +0,
`latest_sale_price` set — not by reading the propagation code.** That is the right way to prove a
gap between two stores.

⚠️ **BLAST RADIUS TODAY IS ZERO, AND THAT IS THE POINT.** The operator path has **never** produced a
row; all 5,208 PSE rows are bulk importers that wrote the spine independently, and inserts stopped
2026-04-06. **Fix-before-it-bites, so the build is small** — the right time to close a leak is
before it has leaked.

### ⛔ ALL THREE ORPHAN FIGURES WERE WRONG. THE TRUE COUNT IS ZERO.

**330 / $4.48B (mine) → 9 / $558.8M (mine, "corrected") → 6 / $29.2M (CC's own first re-measure) →
ZERO.** Three root causes, all in one anti-join, now **playbook Class 25**:

1. **The exact-date join was the wrong key.** `sales_transactions.sale_date` is **month-truncated
   for its dominant source** — `costar_sidebar` **87.4% day-1**, ownership stubs **100%**. Re-keyed
   on `(property, YEAR-MONTH)`: **0 orphans of 1,694**, impossible-price positive control **1,694**.
   Every named orphan had an **exact price twin 3–21 days away, every twin on the 1st.**
   ⚠️ **`dedup_natural_key` had been stating that granularity all along** (`property | price | YYYY-MM`).
   **Look for the dedup/natural key before writing an anti-join, then run the neighbouring key.**
2. **`property_id IS NULL` ≠ dangling.** Dangling was **0 and structurally impossible** —
   `ON DELETE SET NULL`. The 321 are **NULL-link rows, 321 detached in ONE batch on 2026-04-03** by a
   bulk property deletion. **A `LEFT JOIN … WHERE pk IS NULL` cannot tell "points nowhere" from
   "points at nothing."**
3. **`transaction_state` was never read.** The "$529.6M invisible to the spine" is **quarantine** —
   `needs_review` / `duplicate_superseded` with `exclude_from_market_metrics = true`. **The store had
   already judged its own residue.** An exclusion check means every membership column, **state
   machines included**, not just the ones named `exclude_*`.

**True population: 1,687 live twins · 7 quarantined ($604.1M) · 0 absent · 0 live twins with a null
price. The spine was COMPLETE.**

⚠️ **The lesson I most need to carry: the FINDING and its SIZE are separate claims, and I conflated
them twice.** The collision was real and the fix was right; only the number was wrong — three times.
Reported separately, a corrected number does not read as a retracted defect. **And this is the third
time this arc I led with an alarming figure that measurement deflated** (the GSA raw feed, then this
twice). The checking is working; **my ordering of alarm-before-caution is the part that keeps
failing.**

⚠️ **Two process notes worth keeping:** the parallel window merged `main` into this branch
concurrently and **both resolutions of the same `STATUS.md` conflict were correct** — both kept both
entries, newest-first, no markers (the §4a lesson, resolved well on both sides). And **gov #391
merged 31 seconds after opening, before CI finished** — no harm, Test & Lint went green 31 seconds
later, but that is the PR #1793 pattern and it was flagged factually rather than let pass.

## 2026-08-28 — 🗄️ CLEANUP COMPLETE: root `.md` 70 → 10 across five topic passes

**Final pass moved the Dialysis-book copy/emails to `docs/capital-markets/` and the DIA-demographics
+ lease-abstract worklogs to `docs/history/`.**

**The 10 that remain are all defensible:** `CLAUDE.md`, `AGENTS.md`, `LCC-OS.md` (entry points) ·
`WRITE_SURFACE_POLICY.md` (**canon-bound — `canon/00-INDEX.md` invariant #4 binds to it by name**) ·
`SALESFORCE_LCC_INGESTION_PLAN.md` (**cited by path in a user-visible runtime error string**) ·
`BRIGGS-WRITING-VOICE.md` · four `SPEC_*` files (low-risk; a future pass can triage them).

**Across five passes: 62 items recovered that existed in NO tracker** — P14 (M1–M11), P14b (R1–R14),
P14c (I1–I23), P14d (J1–J14), P14e (AI1–AI10) — **plus SEC2–SEC4 and two defects fixed in flight**
(the Vercel-era pre-commit hard fail; the canon write-policy naming deleted files).
**Not one of them would have survived a move-first cleanup.**

## 2026-08-28 — B6c-dup drafted, and the sizing check I demanded settled it AGAINST ME

**Prompt: `prompts/B6c-dup-two-sale-stores-disagree-2026-08-28.md`.**

⛔ **I reported 330 orphaned priced comps / $4.48B this morning. It was inflated ~8× and is now
corrected in place.** The exclusion check I insisted on as "step one" is what caught it: **321 of the
330 have a `property_id` that does not exist in `properties` at all.** They are a
dangling-reference / stale-import defect, **not** missing comps.

**The honest figure is 9 orphaned priced sale events on LIVE properties — 4 `costar_export` + 5
`excel_master` — $558.8M, 5 with a cap rate.** ⚠️ **And the value is concentrated: one row is
$379.5M of the $558.8M**, so the nine get inspected individually and the sum is never quoted as a
portfolio. **B6c's original ~6 was close to right; mine was not.**

**The lesson, and it is mine: check what a row points AT before counting it as absent from somewhere
else.** This is the **second time this arc** I have led with an alarming number that measurement
deflated — the first was *"the raw GSA feed is stale too"* (it wasn't; GSA hadn't published August).
**Both times the guard I had written into my own prompt is what caught it, and both times I put the
alarm in the headline and the caution in a footnote.** The protocol's step ① is doing its job; my
ordering of alarm-vs-caution is the part that still needs discipline.

**Filed as its own row — `B6c-orphan`** — with the generalisation stated: **D2/I3 asks whether a link
column can HOLD its target's key; this asks whether the key it holds still EXISTS.** A repo-wide
dangling-reference sweep is the natural sibling.

**What did NOT change:** the finding itself. **76 of 76 gov views read `sales_transactions`, zero
read `property_sale_events`, including all 30 `cm_gov*` Capital Markets views**, and nothing
propagates PSE → `sales_transactions`. **A sale an operator types into the property panel still
never reaches the comps spine.** The prompt fixes the write path before any backfill (Class 8), and
requires `detail.js`'s comment — which asserts the opposite of the database — to be corrected either
way, *because that comment is how this survived.*

## 2026-08-28 — 🗄️ CLEANUP PASS 4: AI-chat / Copilot / architecture. Root `.md` 70 → 17, and a landmine defused.

**13 files read in full. No secrets — the SEC2 pattern did not repeat here.** Two defects were
**FIXED rather than filed**, because both were small, unambiguous and actively dangerous:

- 🚨 **`.github/hooks/pre-commit` hard-failed every commit when `api/*.js` > 12, citing *"Vercel will
  reject this deployment."* `api/` holds 21.** It was **never installed**, so a landmine rather than
  a fire — but **its own header tells you how to install it**, and doing so would have blocked all
  work against a platform retired three months ago. **Defused:** it now emits a non-blocking notice
  and records why, preserving the ≤12 *structure* convention (`CLAUDE.md` rule 1) while dropping the
  retired-platform hard fail.
- **`WRITE_SURFACE_POLICY.md`'s exempt-surface list named two DELETED files** (`api/data-proxy.js`,
  `api/contacts.js`). ⚠️ **This is a canon-integrity defect, not a typo** — `canon/00-INDEX.md`
  invariant #4 binds to that file **by name** and `REGISTRY.md` §A calls it canonical at a
  root-anchored path. **Corrected in place and bannered KEEP AT ROOT**: moving it would force a
  `CANON_VERSION` bump and a paste to every surface, which is exactly the kind of cost a tidy-up
  should not incur silently.

**10 more unfiled items (`P14e`, AI1–AI10). The one that matters:**

⭐ **AI1 — the AI-chat routing rollout was specified, tooled, and NEVER VALIDATED.**
`AI_CHAT_ROLLOUT_RESULTS_TEMPLATE.md` is **blank in every field** — no date, no policy, no tester —
while `AI_CHAT_POLICY` / `AI_CHAT_FEATURE_PROVIDERS` are **live** at `api/_shared/ai.js:181–190` and
**five assistants route through them.** **Nobody knows which provider `global_copilot` actually
hits.** ⚠️ And it must be asserted on the dashboard's **observed** provider/model rows, never the
configured policy — *the doc's own "Routing Mismatches Detected" section exists because those two
disagree.* ⚠️ **It may also be silently failing the same way as the Anthropic credit-balance
outage** that kills the cloud Analyst's-Take and capital-markets generation. Unmeasured; `npm run
ai:status` + filling the template settles it.

**Four contradictions found, and canon/code is right in all four** — hosting (a doc recommending a
**Vercel Pro upgrade**), the API file topology (**six `api/*.js` files that no longer exist**, named
across three docs *including the canonical write policy*), the AI chat handler and model (**AI6**:
a doc asserting *"AI chat logic lives outside this repository"* when `/api/chat` is right here), and
the database topology (one doc presenting the **gov** project as *the* database). **All bannered in
place, none deleted.**

**Three path-anchored references were repointed in the same change** (`scripts/ai-rollout-status.mjs`
×3, `.github/AI_INSTRUCTIONS.md` ×3, `REGISTRY.md`) — §6z step 5 doing its job.

## 2026-08-28 — ✅ B6c ANSWERED: keep the table, retire the columns — and the type defect was never the real finding.

`docs/audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`. **Diagnosis only; no migration shipped**, which
was the right call: dia holds 52 real `ownership_history_id` values a `DROP` would destroy, and it
sequences behind the bigger decision below.

**The type question resolved cleanly.** The table **has** a future — six live gov triggers, the LCC
detail panel's declared canonical write target, read+write allowlisted on both domains. **The two
link columns do not.** `ownership_history_id` has **ZERO readers anywhere** — 0 hits across 620 gov
objects, 0 across dia, 0 in `api/`; 0 of 5,208 gov rows; 1.9% on dia after four months; no FK on
either domain. **Retyping it would satisfy I3 and build a link nobody follows.** The invariant was
sharpened in place: *I3 says a link column must be type-compatible; it does not say every
`<table>_id` column deserves to exist.*

### 🚨 The real finding — the two sale stores disagree about which is canonical

**`detail.js` says in its own comments that `property_sale_events` is canonical and
`sales_transactions` is "legacy, retired for write paths." The database says the exact opposite.**
Verified independently by Cowork: **76 of 76 gov views that read a sale store read
`sales_transactions`; ZERO read `property_sale_events`** — including **all 30 `cm_gov*` Capital
Markets views**. Nothing propagates PSE → `sales_transactions`, though the reverse exists.

**So a sale an operator types into the property panel never reaches the comps spine.** Filed as
**B6c-dup**, ranked above every column repair. **Both stores are individually correct with coherent
consumers — nothing errors, and no component test can see it, because it is a property of the
connection.** That is the P0d thesis with an operator-facing cost attached.

⚠️ **I re-measured the orphan population and got a much bigger number than B6c's six. Both are
right, about different questions — quote them separately.** Anti-joining priced PSE rows (stubs
excluded) against `sales_transactions` on (property, exact date): **330 orphaned priced comps, 203
with a cap rate, 2004-12 → 2025-11, $4.48B, max $379.5M** — **325 `costar_export` + 5
`excel_master`**, and **321 of those properties have NO sale in `sales_transactions` at all
($3.92B)**, so it is **not** the A2b date-mismatch class. **Two findings: the ~6 operator entries are
the ONGOING leak (fix the write path); the ~322 properties are a HISTORICAL bulk-load orphan (a
backfill decision).** ⚠️ **Neither I nor B6c checked them against `exclude_from_property_linking` /
`sales_exclusion_reason` — some may be excluded from the comps spine BY DESIGN. The honest number is
between 6 and 322 and the exclusion check is the first step.**

### D2 swept all three projects — 10 genuine defects, 3 low, 5 accepted false positives

Two refinements it earned while running, both now in the contract: **a declared FK is authoritative
and Postgres already type-checks it**, so only *unFK'd* columns need examining (that killed a whole
false-positive class); and **every genuinely mismatched undeclared column found is 0% populated** —
*a column that cannot hold its value never gets one* — so **triage by populated-ness before reading
names**, since a *populated* mismatch is nearly always a vendor id or a uuid-stored-as-text.

**Two further findings worth carrying:** gov and dia's `property_sale_events` are broken on
**different** columns (dia's `broker_id` is `uuid` against an `integer` PK), so **neither domain is a
safe template for the other** — I2's same-shape invariant failing on TYPES, which I2's provenance
`group by` structurally cannot see. And **`available_listings.true_owner_id` on dia is `integer`
against a `uuid` PK, 0 of 5,334, on a live central table.**

**Three limits stated rather than smoothed over** — the kind of honesty that makes the rest
trustworthy: **LCC Opps' zero is BOUNDED, not clean** (151 of 559 `_id` columns evaluated; **408
unexamined**); the `property_sale_events` `feed_stale` alert should be **re-scoped, not resolved**
(its bulk producer was retired on purpose and its only live producer is an operator form with no
cadence, so a 45-day SLA alerts whenever nobody types a sale for six weeks, then sits open forever);
and **nothing shipped, so there is no guard** — it ships with B6c-dup.

## 2026-08-28 — 🚨 CLEANUP PASS 3 FOUND A LIVE CREDENTIAL EXPOSURE. That outranks the cleanup.

**`wave0-config-values.txt` is TRACKED IN GIT at the repo root and holds `LCC_API_KEY` in
PLAINTEXT.** Verified: 858 bytes, `git ls-files --error-unmatch` confirms tracked, **not in
`.gitignore`**. It also carries `LCC_HOST=https://life-command-center-nine.vercel.app` — **the
retired host that still answers and still holds a service key** (P194) — plus Teams tenant/team/
channel IDs.

⚠️ **This is a DIFFERENT and worse exposure than SEC1**, which records the key as *"pasted in
plaintext during a curl diagnostic."* **A chat paste is transient; a tracked file is in git history,
in every clone, and in every fork.** Filed as **SEC2**.

**And it is not the only one. `SEC3`:** `docs/os/POWER-AUTOMATE-DEPLOYED-CATALOG.md` reports **ten of
seventeen** deployed PA packages contain **literal JWT-like values**, and
`docs/architecture/flows/sync-sf-activities-to-supabase.md` carries an unresolved **P0** —
*"rotate exposed Supabase keys immediately"* — with **`Credential rotation completed: TBD`**.
**I1 covered only the `X-PA-Webhook-Secret`; this is a separate, larger, never-filed item.**

👤 **Scott, order matters: (1) ROTATE `LCC_API_KEY` and update Railway; (2) `git rm --cached` +
`.gitignore`; (3) only then consider history.** ⚠️ **Do not reach for `filter-branch` casually** —
this repo nearly lost a 475 MB mailbox doing exactly that. **Rotation is what makes the committed
value worthless, and that is the outcome that matters.** `SEC4` proposes the standing guard (a
JWT/`sb_secret_`/long-hex check over flow exports and config files) so the next export cannot
re-introduce it silently.

### Cleanup pass 3 — the Power Automate cluster (root `.md` 35 → 29)

**14 more unfiled items (`P14d`, J1–J14).** The four that matter:

- **J1 — `sf-promotion-worker` has NEVER left report-only.** `enforce` defaults `false` **and the
  Salesforce rungs of `field_source_priority` were never seeded**, so **no Salesforce field can ever
  be promoted.** A whole promotion path that reports success and writes nothing.
- **J2 — LCC calls the PA flow with `action:'reschedule'` and the flow has no such branch**, so
  rescheduled dates never reach Salesforce. A caller sending to a branch that does not exist.
- **J13 — archiving the root files did NOT solve the retired-URL problem.**
  `rcm-power-automate.md`, `loopnet-power-automate.md` and `lcc-personal-calendar-sync.md` **still
  record the retired host as their endpoint — inside `docs/architecture/flows/`, the directory this
  pass just confirmed as authoritative.**
- **J14 — FOUR homes for one topic**, two of which near-collide by name (`docs/flows/` vs
  `docs/architecture/flows/`).

**`RCM_LOOPNET_FIX_INSTRUCTIONS.md` got the strongest banner yet** — it instructs an operator to
point two PA flows at the retired host and hands them working `curl` commands against it. Its
**code** half is fully shipped; only the PA half (M8) is outstanding, and its spec **competes with
the authoritative `.github/PA_FLOWS.md` §Flow 3.**

⚠️ **`SALESFORCE_LCC_INGESTION_PLAN.md` was deliberately KEPT AT ROOT** — `intake-salesforce-files/
index.ts` cites it **by path in a user-visible runtime error string**. It contradicts production
(§10 says "every 6 months"; the deployed sync is **hourly**) and itself (§12 vs §5.3) — **J12 fixes
it in place.**

**Two cross-checks strengthened existing rows rather than adding new ones:** **I5** is a *regression
from spec* (the design always mandated capturing the failed slice and a dead-letter listing), and
**I4**'s backfill was designed **manual/button-only**, so *"turn it off"* beats *"fix it."*

## 2026-08-28 — B6c drafted, and re-measuring turned "fix the bigint" into "does this table have a future?"

**Prompt: `prompts/B6c-property-sale-events-decide-before-fixing-2026-08-28.md`.** It also carries
the **D2** sweep, since this is D2's known instance.

**The type defect is confirmed exactly** — `sales_transaction_id` and `ownership_history_id` are
**`bigint` against `uuid` PKs**, no FKs, **both populated on 0 of 5,208 rows**. And the positive
control is stronger than reported: **dia's identical table has `integer` PKs and links 2,432 of
2,730 rows (89%)** on the sales side. The design works; gov's instance is structurally impossible.

**⚠️ But protocol step ① found three things the type defect was hiding, and they change the job:**

1. **56% of the table — 2,919 rows — is `ownership_change_stub*`, the RETIRED CIRCULAR mechanism.**
   It is minted *from* ownership history, so linking it back is a loop. **B6 raised this class
   against B5, where it measured 2 of 2,776 and was correctly dismissed. Here it is the majority.**
   *The same objection can be noise in one population and decisive in another — re-measure it per
   population rather than inheriting the verdict.*
2. **`buyer_id` and `seller_id` are `uuid` and populated on ZERO rows too.** It is not just the two
   link columns — **every id column in this table is empty.** It holds text names only.
3. **The producer is dead** — newest row 2026-04-06, which is exactly the 144-day `feed_stale` alert.

⚠️ **And the strongest argument against a naive fix comes from the positive control itself:** on
dia, where the link CAN be populated, `ownership_history_id` is set on **52 of 2,730 (1.9%)**. The
sales side works at 89%; **the ownership side is barely used even where it is possible.** So *"fix
the type and the join lights up"* is not supported by the one working instance.

**The prompt therefore asks the consumer question first** — grep for readers, ask whether this is a
**third representation of a relationship `ownership_history` and `sales_transactions` already
model**, and decide. **Retiring the table is an explicitly acceptable outcome** (A5, C1, A3, P196,
P198 all ended in *do not build*). What is not acceptable is fixing the types without knowing
whether anything will read them — that is Class 2 with a migration attached.

## 2026-08-28 — 🗄️ CLEANUP PASS 2: infra / hosting / monitoring. 23 more items filed nowhere, and a live contradiction between two canonical pages.

**Root `.md` 50 → 35** (70 → 35 across both passes). Fifteen files read in full before any move.
**23 items existed in no tracker** — §P14c, **I1–I23**.

**The five that matter most:**

- 🔒 **I1 — the `X-PA-Webhook-Secret` was committed INLINE in a Power Automate export and rotation
  was never confirmed.** 👤 Scott, security, do this first.
- ⚠️ **I2 — dia parallel pagination was never reverted or probed, and its gov twin was a
  194-SECOND regression.** QA-33 says *"dia NOT reverted yet"* and nobody went back.
- **I3 — the Supavisor pooler move was filed ONLY as a pointer from the backlog INTO the file being
  archived.** **A pointer into an archive is not a filing.** It now has its own row; the pointer is
  repointed. **This is the cautionary tale of the pass** — the extract-first gate caught it only
  because the gate exists.
- **I4/I5 — a PA flow has been failing daily at ~11:26 UTC since June** ("turn it off" was never
  confirmed), and **the PA fault branch posts only the run header, so `error_detail` is empty and
  every flow failure is undiagnosable.**
- **I9 — six of seven Pipeline Control findings are still true in today's code**, including a banner
  telling operators *"runs are triggered via CLI — contact your administrator"* when they run on
  Railway crons.

**Two obsolete WORKFLOW workarounds are now bannered off.** `AUDIT_PROGRESS` and
`GAPS_AND_FINDINGS_REGISTER` both prescribe writing files via `bash python open('w')` because
*"sandbox writes are invisible to Windows git"* — a 2026-05 mount artifact. **A future session
adopting that would be silently slowed by a bug that no longer exists.** Stale *process* advice is
worse than stale facts: nothing contradicts it.

**A name collision ended.** There were **two `ROLLOUT_STATUS.md`**. The live one is
`docs/audits/ROLLOUT_STATUS.md` (250 KB, cited by `api/admin.js:263`); the root copy had **zero
inbound references** and its own banner redirected readers elsewhere — *a document everyone thought
they had found.* Archived under a disambiguated name.

**Four root files named four different hosting targets** — Vercel (ROLLOUT AD6, a "locked
architecture decision"), Railway (INFRASTRUCTURE), Render (RENDER_MIGRATION_PLAN), GitHub Pages
(VERIFICATION-SUMMARY). **Railway is right**, and **none of the four recorded that the retired Vercel
deployment still answers and still holds a service key** — the fact an infra reader most needs.
**I16 makes the Render contingency a decision instead of a fourth answer.** 👤 Scott.

### ⚠️ A LIVE CONTRADICTION BETWEEN TWO CANONICAL PAGES — surfaced, not resolved

**`CURRENT-STATE.md` says `LCC_API_KEY` is "production-ready but NOT enforced". `CLAUDE.md` says
`/api/*` IS auth-enforced** — on the strength of my own probe returning **HTTP 401** while
`/version` answered normally. **Both cannot be right about the same thing.** Most likely one
describes the env state and the other a route-level guard. **The resolver is
`GET /api/diag?kind=auth-ready`.** Flagged in place on `CURRENT-STATE.md`; **neither page should be
quoted on auth until it is run.**

## 2026-08-28 — ✅ B6b SHIPPED. The change layer is live and self-healing — and it corrected THREE of my premises, including one I raised as an alarm.

Merged: `government-lease#390` (`9b7dfda`, post-merge Test & Lint green on main — **verified on the
run, not assumed**, after it merged ~30s from opening) · `life-command-center#1903`.

**Verified live by Cowork:** `gsa_lease_change_facts` **336,303 → 374,257** rows, now current to
snapshot **2026-07-01** (was 2026-02-01) · `gsa_lease_timeline` **16,779** · `landlord_change_flag`
**38,213 → 39,549** · derivable backlog **0** · **the layer now derives on the Monday `gsa-sync` on
both paths, so it self-heals whenever GSA publishes.**

**🎯 THE ACCEPTANCE TEST WAS MET IN THE LEDGER, NOT IN A RUN LOG.** Both `feed_stale` alerts —
`gsa_lease_change_facts` and `gsa_lease_timeline` — **opened AND resolved on 2026-08-28**. The
monitor repaired yesterday detected the producer repaired today and closed itself. That is the
whole point of having sequenced B6a → B6a-follow-up → B6b.

### ⚠️ Three corrections to MY prompt's premises — and the first one was my alarm

1. **🚨 "THE RAW FEED IS STALE TOO" WAS WRONG. The raw feed was never dead.** The pull ledger shows a
   **2026-08-24 pull with `consecutive_unchanged=3`** — **GSA simply has not published August.** I
   led the prompt with `gsa_snapshots` at 2026-07-01 (~58 days) as a 🚨 finding. **My own prompt
   warned against exactly this error** (*"a feed early in its cycle and a dead feed look identical
   from `max(snapshot_date)`"*) — so the guard worked and the check was made, but **I put the alarm
   in the headline and the caution in a footnote, and the alarm was the wrong half.** Read the
   producer's own ledger before calling a feed dead.
2. **"No scheduled caller" was TRUE BUT INSUFFICIENT.** The derivation read a **different table**
   from the one the live job writes. **Scheduling the old code unchanged would have produced
   nothing** — a green cron over a no-op, i.e. the exact class B6a exists to expose.
3. **"Undiffed" ≠ "derivable."** **15 of 21 undiffed dates are already spanned by an existing diff**,
   and deriving them would have **double-counted conveyances the store already holds.** Backlog
   count and work count are different numbers.

### New durable footgun (recorded in gov's CLAUDE.md)

⚠️ **A DDL batch that ends in a runtime error rolls the DDL back with it.** That is how a 2-arg
`gov_gsa_change_layer_tick` overload survived a `DROP` that appeared to have run — found only by
**censusing the live objects afterwards**. Same family as *merged is not running*: **the statement
executing is not the object existing.**

### Deliberately left open, with reasoning recorded

- **`B6b-lead`** — `prospect_leads_ownership_change` is **still dead and still correctly alerting**
  (150d). `ingest_ownership` IS restartable and **B6's claim that its input carries no lessor signal
  is REFUTED — 16,907 rows do.** But it is a **10,635-row first write gated only by a name
  heuristic** that could not be dry-run from the sandbox. ⚠️ **Its consumer is confirmed alive —
  2,041 leads worked, 208 in Salesforce — which is precisely why it deserves a MEASURED restart
  rather than a blind one.**
- **`B6b-june`** — `gsa_snapshots` 2026-06-01 is a **merged snapshot of two source files**: an
  upstream ingest defect, not a change-layer one.

**Open `feed_stale` alerts now 6 → 4:** `prospect_leads_ownership_change` (B6b-lead) ·
`property_sale_events` 144d (**B6c**, the `bigint`-vs-`uuid` table) · `sam_lease_opportunities` 32d
vs a 14d SLA · `medicare_clinics` (dia) 64d — ⚠️ still **check the SLA before treating as a defect**,
CMS publishes slowly. *(The ledger also shows the alerting worked before the July outage —
`gsa_lease_events` opened 06-20/resolved 06-22, `gsa_leases_snapshot` 07-09/07-14.)*

## 2026-08-28 — B6b drafted, and re-measuring found the raw feed is stale too

**Prompt: `prompts/B6b-restart-gsa-landlord-change-detector-2026-08-28.md`.** B6a + B6a-follow-up
unblocked it — a restarted producer can now be told whether it stays up, which was the whole point
of doing them first.

**⚠️ Protocol step ① earned its keep before the prompt was even written.** B6's finding was *the
derived layer has no scheduled caller* — true, and incomplete. Measured today:

| object | newest | |
|---|---|---|
| `gsa_lease_change_facts` | **2026-02-01** | the derived layer, ~7 months dead |
| **`gsa_snapshots`** | **2026-07-01** | **the RAW feed, ~58 days old** |
| undiffed snapshots | 4 — `2026-03/05/06/07-01` | `2026-04` genuinely absent upstream |
| `prospect_leads` (`ownership_change`) | 2026-03-31 | **7,729 leads, 2,041 historically WORKED** |

**Restarting only the diff would eat the four backlog months, report success, and stop again at
2026-07 with nothing for August** — while the `feed_stale` alert stays open and everyone believes it
is fixed. **That is the B6a lesson repeating one layer up: follow the signal all the way to the
source.** The prompt therefore requires the raw feed to be diagnosed *first*.

⚠️ **And it explicitly warns against the opposite error:** GSA publishes monthly on a lag, so **a
feed early in its cycle and a dead feed look identical from `max(snapshot_date)`** — the same
wrong-SLA-vs-dead-feed ambiguity flagged for dia `medicare_clinics`. Establish the expected cadence
before calling it broken.

**Why this restart is unusual:** the lead lane it revives has **2,041 historically worked leads** —
a measured consumption record, not a speculative producer. Most restarts cannot say that.

**Carried into the prompt as hard rules:** deflate `landlord_change_flag` before quoting it (38,213
→ **1,338 / 1,202 properties**, 28.6×, of which **46.7% is pure name re-spelling** because the flag
is raw string inequality); this producer writes **text parties**, which is the exact shape that
**nulled 7,567 rows** through the propagation trigger before B5 fixed it; register the new step in
B6a's registry with declared skips, or it restarts into the blindness B6a just fixed; and **the
acceptance test is the alert auto-resolving, not a green run log.**

## 2026-08-28 — ✅ B6a-follow-up SHIPPED: the monitor is alive, and its first honest run names the backlog. Plus: the build-turn protocol is now the definition of done.

**Verified live by Cowork (the response transcript ended mid-work, so this is measured, not read):**

| metric | before | after |
|---|---|---|
| gov feeds evaluated | **13, frozen 2026-07-26** | **18, synced TODAY** |
| dia feeds evaluated | 5, frozen 2026-07-29 | **5, synced TODAY** |
| open `feed_stale` alerts | **0** (for 33 days) | **6, and every one is real** |

⚠️ **gov went 13 → 18 feeds** — the transport fix did not merely un-freeze the mirror, it **restored
five feeds that had been failing silently.**

**The first honest run names the backlog, which is the strongest possible evidence it is working:**
`gsa_lease_change_facts` **170d** (⚠️ **the 336k-row landlord-change source B6b exists to restart**) ·
`gsa_lease_timeline` 170d · `prospect_leads_ownership_change` 150d · `property_sale_events` **144d**
(⚠️ **the B6c `bigint`-vs-`uuid` table**) · `sam_lease_opportunities` 32d against a 14d SLA ·
**`medicare_clinics` (dia) 64d — a dia feed nobody was watching.**
⚠️ **Before treating `medicare_clinics` as a defect, check its SLA is right** — CMS publishes on a
slow cadence and `facility_patient_counts` is documented as ~annual, so a 45d SLA may simply be
mis-set. *A wrong SLA and a dead feed render identically.*

**The transport was TWO different causes, one per domain** — which is why "all 18 froze on one date"
was worth diagnosing before patching the consumer: gov was a **cold-start timeout** (same request,
same key, 3 minutes apart: cold → HTTP 500, warm → HTTP 200 with all 18 feeds), dia a **missing
grant**. ⚠️ And restoring dia's grant naively would have **re-opened the privilege-escalation surface
B6a had just closed on gov** — the revoke was mirrored instead.

**§2e answered:** `lcc_check_feed_freshness` was the **only** check with the go-silent shape, and
`lcc_check_bd_sync_freshness` **already implemented the fix correctly** — an in-repo precedent reused
rather than a new pattern invented. **I11 moves from ❌ VIOLATED to ✅ with a standing detector.**

⚠️ **Still open and NOT closed by this:** `record_skip` has **still not been exercised by a real
run**. The four RED producers remain a *registry* result. The check is a `Task skipped` row for
`gsa_ingest_+_diff` in `run_log` with `skip_reason='gsa_download_folder_empty'` after the next
scheduled run (daily `0 8 * * *`).

### 🔁 And the process itself is now the deliverable

Scott: *"incorporate this repository clean and self-improvement process at every turn of every build
… so the latest chat can always pick a topic up fresh."* Written as
**[`docs/os/BUILD-TURN-PROTOCOL.md`](../os/BUILD-TURN-PROTOCOL.md)** and wired in as **`CLAUDE.md`
Rule 00** (so every Claude Code session reads it) and **`DOCUMENTATION-MAP.md` §6y**.

**Eight steps**, each earned by a measured failure from this week: measure before concluding ·
verify on the state delta and positive-control every zero · establish deploy state via `/version` +
`merge-base` · reconcile against the parallel window · **update canonical docs in the same change** ·
correct what is false in place, **your own calls included** · **extract open intent before archiving**
· leave the next step named. **The test is one question: *can the next session pick this topic up
cold, from the canonical pages alone, and be right?*** It explicitly is **not** ceremony — a one-line
fix needs a one-line STATUS entry.

## 2026-08-28 — 🗄️ TOPIC-BASED REPO CLEANUP, pass 1: the ownership/sales/provenance cluster. 25 items were filed nowhere.

**Scott: *"topic based and repository wide, not just the prompts folder — so there is zero confusion
on what the latest status or build or plans or designs are."*** This pass covers **one topic
cluster** end to end. It is not a full repo reorganisation; the rest is sized below.

**Both moves were gated on reading every file first**, because the standing rule is *lose nothing,
especially no planned feature.* **That gate earned its keep: 25 items existed in no backlog, no
audit and no design doc.**

| moved | from → to | items recovered |
|---|---|---|
| **32 session statuses** (2026-05-23 → 05-29) | `docs/ownership_sales_remediation/` → `docs/history/worklogs/ownership_sales_remediation/` | **11** → backlog **§P14, M1–M11** |
| **12 root `.md` files** + 4 coupled | repo root → `docs/history/` and `docs/audits/` | **14** → backlog **§P14b, R1–R14** |
| **3 still-live references** | repo root → `docs/architecture/` | (relocated, not archived) |

**Root `.md` count 70 → 50.** The doc map's own rule is *"the root is code and config; do not add a
new `.md` there"* — it was being violated 70 times.

**The five recovered items that matter most:**

- **R1 — an entire unexecuted Supabase 3→1 consolidation plan**, with rollback, **no backlog row
  anywhere**, still cited as live by a 2026-07 audit. 👤 Scott's call.
- **R2/R3/R4 — the duplicate-property RECURRENCE fix was never built.** `upsertDomainProperty` still
  runs the `address=ilike` fall-through chain; `v_property_address_collisions` has **zero consumers
  on either DB**. **We clean the output nightly via the twin lane and never fixed the producer** —
  Class 8, and exactly the pattern this whole campaign is about.
- **M1 — 617 `ownership_history` rows are grandfathered out of `excl_oh_no_overlap`** and the review
  queue was never drained. **"C5 DONE" meant the constraint shipped, not that the overlaps were
  resolved.**
- **R13 — an unresolved CONTRADICTION that M10 and K10 are sized off.** The remediation plan calls
  the deed/parcel orphaning *"audit overstated"*; the deed spec's whole premise is the opposite
  (9,402 orphans). **One of them is wrong.**
- **M8 / M7 — LoopNet PA Flow 3 has never been built (0 leads ever landed)**, and the `lead-ingest`
  Edge redeploy was never confirmed, leaving sanitization live only on the **retired-but-answering**
  host.

**Two archives carry mandatory-read banners**, because several files assert things that are now
false and would mislead a future session within one paragraph: the A9b cutover design says
**"Status: design / not executed"** when it shipped 2026-05-29; its runbook's **Step 0 gov→hub
re-sync is now actively harmful** (it would import the stale snapshot into the authoritative hub);
and `SPEC_research_task_generator`'s cron snippets **target the retired Vercel host** while its
auto-close **is** the A5a defect that falsely closed 5,763 tasks.

⚠️ **Also recorded: a LETTER COLLISION.** The May campaign's Track A/B/C are unrelated to the Aug
lettered prompts. *"B4"* is a May sales worker **and** the dia-vs-gov chain-depth question.
**Always check the date.**

**Remaining, sized not done: ~50 root `.md` files in other clusters** — capital-markets emails and
book copy, BOV/lease-extractor specs, Power Automate setup guides, hosting strategy
(`LONG_TERM_HOSTING_STRATEGY.md` + `PHASE_0_INVENTORY.md` should move with R1's plan), AI-chat
rollout, and the DQ/intake remainder. **Same discipline required: read, extract unfiled intent,
then move.** Filed as the next cleanup pass.

## 2026-08-28 (evening) — B6a SHIPPED; the four dead producers read RED. And the alert chain that would carry that to a human has been silent for a month.

Evidence: [`B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`](../audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md) §7a ·
contract [`data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) **I4 (shipped) / I11 (new)**.
Merged: `government-lease#389` (code + migrations, Test & Lint ✅) · `life-command-center#1893` (docs, `b31f401`).

**B6a delivered, and delivered the thing I asked for most.** The four producers dead since
March–April 2026 now read **RED** (170/170/150/144 days against a 45-day SLA); skips emit a
first-class `Task skipped` row with a declared reason; `is_overdue` is computed against the step's
**own p90 cadence**; equivalence held at **0-changed in both directions** on every pre-existing feed
and view column. **And the detector was SEEN going red on a deliberate silence and green again** —
the §2a requirement, which is what separates this from the view it replaces.

⚠️ **`record_skip` HAS NOT YET BEEN EXERCISED BY A REAL RUN, and the RED rows are not proof that it
was.** They are a **registry** result — they prove the config rows. The daily pipeline fires
`0 8 * * *` and the weekly `0 6 * * 1`. **The check that matters is a `Task skipped` row for
`gsa_ingest_+_diff` in `run_log` carrying `skip_reason='gsa_download_folder_empty'` and
`skip_declared: true`**, after which its `age_days` resets and it stops reading overdue. **Until a
run passes through, "no bad rows" and "no rows at all" read identically** — the exact trap the work
is about, correctly flagged by the build rather than papered over.

**🚨 THE FOLLOW-ON FINDING IS BIGGER THAN THE FIX, and I verified it independently.** The chain that
carries gov's verdict to an LCC alert **has evaluated nothing since 2026-07-26**, and **every layer
reports success**: gov `v_feed_freshness` is correct (says `sam_lease_opportunities` is 32d stale) →
crons **140/141** fire daily and record **`succeeded`** → `lcc_finalize_feed_freshness` consumes
only `status_code = 200` and **silently drops the rest, returning `(0,0)`** (identical to *nothing to
do*) → `lcc_domain_feed_freshness.synced_at` frozen at **2026-07-26** gov / **2026-07-29** dia →
`lcc_check_feed_freshness` **excludes mirror rows older than 3 days**, so it evaluates **zero** feeds
and returns `new_alerts: 0, stale: []`.

**Verified live 2026-08-28:** gov mirror **33 days** stale across **13 feeds**, dia **30** across
**5**; `feed_stale` alerts — **8 ever, 0 open, last detected 2026-07-24**, **two days before the sync
died.** *The alerts stopped when the monitoring stopped.*

- **New invariant `I11` — a monitor must alert on its own blindness.** *"I cannot see this feed"* and
  *"this feed is fine"* must never render identically. **The staleness guard on the mirror IS the
  silent failure**, and the exclusion is individually defensible, which is why nobody caught it.
- **Corollary:** a fail-soft that swallows a non-200 must **count and surface** it. `(0,0)` may
  never mean both *nothing to do* and *everything failed*.
- **The contract is now three of eleven invariants with a standing detector** — I4 shipped today,
  **I11 was added the same day because it was found violated.**

**Next prompt drafted: `B6a-follow-up`** (LCC-side only; gov is correct and must not be touched).
Sequenced **before B6b**, because B6b's entire premise is being able to tell whether a restarted
producer stays up — and today it cannot be told. ⚠️ It carries three cautions: **diagnose the
transport before patching the consumer** (all 18 feeds froze on the same date — and `200 []` would
pass a status-code check while carrying nothing, the P157 class); **expect a loud, real first run**
and rank rather than suppress it; and **grep the other `lcc_check_*` functions for the same
exclusion shape**, naming them without fixing them.

## 2026-08-28 (later) — B5 SHIPPED and found a destructive trigger on the way; B6 swept 19 signals; the two windows produced CONTRADICTORY measurements of one population and B5 wins.

Evidence: [`B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`](../audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md) ·
[`B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`](../audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md) ·
new contract [`data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) · playbook **Class 21**.

**⚠️ THE HEADLINE IS A BUG, NOT THE FEEDER.** `trg_propagate_ownership_to_property` (gov, AFTER
INSERT) had **no guard on `NEW.recorded_owner_id`**, so any dated `ownership_history` row naming its
parties **as text** — which is how `gsa_lease_diff`, `deed_extraction` **and B5** all write —
**overwrote `properties.recorded_owner_id` with NULL.** Silently, no ledger, unrecoverable.
**7,567 live rows are already in that shape**, and **B5's first run alone would have destroyed the
recorded owner on 1,446 of the 9,312 gov properties that hold one (15.5%).** Proven on property
7370 in a rolled-back transaction, fixed fill-forward, positive-controlled both directions.
**Verified live: the guard is in place and `props_with_recorded_owner` held at 9,312.**

**B5 shipped, and every claim verifies independently:** gov `ownership_history` **16,177 → 18,953**
(+2,776 rows / 2,000 properties) · transitions view **9,595 → 12,371** rows, **4,698 → 5,555**
properties (**+857 with a first transition ever**) · view-level 2+ links **1,376 → 2,118** ·
re-plan 0 · reversal round-tripped on 5 real rows first. My ceiling graded **down**: 3,080 → 2,776,
2,114 → 2,000.

**⚠️ THE LCC SIDE HAS NOT MOVED AT ALL, AND WILL NOT UNTIL THE RAILWAY REDEPLOY.** Verified:
facts **14,076**, lane completed **1,302**, open **579**, gov `chain_2plus` **178**, `any_history`
**2,238** — all identical to pre-B5. **527 of 579 open tasks carry a pre-B5 draft**, and the drafter
only prepares `fresh = open ∧ undrafted` — **the stale-draft trap for the THIRD time** after A4b and
A2b. `runB5RedraftPass` fixes it, is keyed on STATE (so it catches the next source too), and **is
JS: without the deploy B5 converts on 52 tasks, not 579.**

**⚠️ AND THE TWO WINDOWS MEASURED ONE POPULATION AND DISAGREED BY 10×, WITH NEITHER SIDE ERRORING.**
B6 §6 could not reproduce B5's ceiling, found `ownership_change_stub*` at 34% of the source
population (a mechanism gov R37 retired, minted **from** ownership history — so circular), and
recommended *"RESIZE BEFORE BUILDING; may not clear the bar."* **B5 had already shipped.**
Adjudicated live: **2 of 2,776 rows (0.07%)** trace to a stub; the rest are `excel_master` 1,222,
`costar_export` 625, `costar_sidebar` 141, `gov_master_backfill_r71` tail. **The decisive check was
the one that does not depend on the disputed key: 677 of the 2,000 properties had NO ownership
history at all before B5.** A duplicate cannot create history for a property that had none. §6 is
superseded in place; its scope-sensitivity table (a **26×** swing on one population and one key) is
the durable content and stands.

- **Durable:** *merged is not running* has a mirror — **in flight is not unbuilt.** Before writing
  "resize before building" about parallel work, check whether it shipped.
- **Durable:** when two honest measurements of one population disagree, **find the measurement that
  does not depend on the disputed key** rather than adjudicating the keys.
- **A2b's earliest-wins rule does NOT transfer here** — against an already-recorded pair the sale
  row is **later 217 times, earlier 34** (the opposite of A2b's 26-of-26), so B5 keys on the **party
  pair**, not the date. A rule calibrated on one population must be re-graded on the next.

**B6's own findings (19 signals, gov + dia):** most sources are already consumed (deeds **98.5%**).
Both figures I filed B6 under are **corrected** — the 38,213 landlord-change signal deflates
**28.6×** to **1,338 / 1,202 properties** (46.7% of the flag is a **pure name re-spelling** —
computed on raw string inequality, not a normalized key), and `property_sale_events`' link columns
are **`bigint` against `uuid` PKs — unpopulatable (`22P02`), not merely unwired**, with dia's twin
as the positive control at 52 populated rows. **The real gaps are four producers dead since
March–April 2026 behind an all-green health view** — `pipeline_runner` skips on an empty local
folder, logs *"Task completed"*, and emits **no run row at all**, so it has no row in
`v_pipeline_task_health`. **A failed step is a red row; a skipped step is no row.** Filed as
**Class 21** and **B6a**, and it is why nobody saw the other three for five months.
Ranked gaps **B6a–B6g**; two of seven end in *"don't build."*

**🚨 DEPLOY STATE, 2026-08-28 evening — UNKNOWN, and the first probe was worthless.**
`GET /api/ownership-chain-draft-tick` returned **`HTTP 401 {"error":"Authentication required…"}`**,
so grepping its body for `b5_redraft` found nothing **because the body was an auth error**, not
because the field is missing. **I read that empty grep as "the deploy is stale" and said so.**

- ⚠️ **This is the P182 class committed by the detector's own author, twice in two turns** — first
  reading "all written today" off an upserted `updated_at`, then reading a 401 body as a missing
  field. **A text-matching probe must carry a positive control IN THE SAME COMMAND** (here:
  `a2b_redraft`, which shipped pre-B5) **and must print its HTTP status.** A probe that cannot
  distinguish *absent field* from *never reached the handler* is not a probe.
- ⚠️ **`LCC_API_KEY` auth is ENFORCED on `/api/*` in production.** Any future behavioural deploy
  probe must either send `X-LCC-Key` or use an unauthenticated endpoint. **Use `/version` + the
  documented `git merge-base --is-ancestor <fix-sha> <deployed-sha>` check** — that is the repo's
  own doctrine for exactly this question and it does not depend on parsing a handler response.
- ✅ **ANSWERED — DEPLOYED.** Live `/version` = **`e3a0407d25bc`** (`git_pinned: true`), and
  `git merge-base --is-ancestor 385023cf… e3a0407d` returns **0** — `runB5RedraftPass` (commit
  **`385023cf`**) IS in the deployed build. **Tonight's 06:45 drafter → 06:49 apply runs with it.**
  **The check that worked took two commands and parsed nothing** — that is the standing answer to
  "is my fix running", not a handler probe.

**📋 BASELINE FOR TOMORROW'S VERIFICATION (measured 2026-08-28, post-B5, pre-conversion).** B5's
gov-side write is banked; **none of it has reached LCC yet.** Assert on the DELTA against these:

| metric | baseline |
|---|---:|
| `lcc_entity_portfolio_facts` | **14,076** |
| lane `completed` / `open` | **1,302 / 579** |
| gov `chain_2plus` | **178** |
| gov `any_history` | **2,238** |
| `human_actionable` (must stay ~flat) | **55** |
| gov `ownership_history` (source, already banked) | **18,953** |
| transitions view | **12,371 rows / 5,555 properties** |

**Read `b5_redraft`, `written_draftable`, `facts_inserted` and `tasks_completed`. Do NOT read
`already_drafted` or `links_already_present`** — both are re-discovery tallies that read exactly
like throughput (P159a). ⚠️ **Expect coverage (`any_history`) to move much harder than depth
(`chain_2plus`)** — B1 moved them +901 vs +28, and the source is mostly one transition per
property. **A big `any_history` gain with a small `chain_2plus` gain is the expected shape, not a
shortfall.** ⚠️ **`backlog_remaining: 0` is scoped to the scan window** — the lane advances only as
A2 *completes* tasks, so this is a draft→apply cycle over several nights, not one pass.

**Next prompt drafted: `B6a`** — fix the health view's blindness to SKIPPED steps **before**
restarting the four dead producers (B6b). Restarting first leaves you unable to tell whether they
stay up, because the instrument is the broken thing. Acceptance: the four known-dead producers read
RED, and the detector is **seen** red on a deliberate silence.

**Scott's standing requirement is now a contract, not an audit.**
[`docs/architecture/data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) —
**I1–I10**, a new-database onboarding checklist (the planned future domains), and the honest status:
**two of ten invariants have a standing detector.** Campaign **P0d / D1–D5** turns the highest-yield
ones into scheduled checks, D1 (the provenance producer-set diff) and D2 (the link-column type
audit) first because they are cheap and find real defects today.

## 2026-08-28 — B1a merged and refuted its own premise; then MY "we must acquire deeds" conclusion was refuted one query later. gov has never consumed its own sales table.

Evidence: [`B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md`](../audits/B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md);
audit **§3b/§3c** in [`BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md`](../audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md);
canonical [`ownership-history-lane.md`](../architecture/ownership-history-lane.md) §3a.

**B1a shipped and moved the wrong number.** 59 groups / 63 losers merged, `ambiguous_entity`
**126 → 57** links, **+65 completions / +66 facts** (lane **1,237 → 1,302**, `any_history`
2,173 → **2,238**). But `chain_2plus` moved **by one** — **64 of the 65 completed tasks carried
exactly ONE link.** **Duplicates constrained chain EXISTENCE, never DEPTH.** The entire remaining
A2-blocked residue is worth **12** `chain_2plus` properties, 8 of them permanently blocked by
design (the placeholder is the GRANTOR). **That closes the lane as a depth source.**

**Then I got the follow-up wrong, in the most expensive direction available.** Measuring gov's
deed layer — **876 grantor-bearing deed records of 5,804; 325 deed documents of 13,835
properties** — I concluded depth was now an **external acquisition** problem (K10 / county
fetchers) and wrote it into the audit as §3b. **It survived one more query.**

**B4 was the thread, and one `group by` answered it.** Grouping
`lcc_entity_portfolio_facts` by `ownership_source` shows dia's depth comes from
**`sales_transactions_seller_exit` — 2,207 of its 2,757 historical facts** — a feeder that closes
the SELLER's ownership interval when a sale is recorded. **gov has no such feeder.** gov
`sales_transactions`: **14,645 rows / 5,321 properties / 1970→2026, 9,514 with a named seller,
4,697 properties with a dated seller** — and `ownership_history` has consumed
**`data_source='sales_transaction'` = 169 rows, 1.8%.** Anti-joined on (property, normalized
prior-owner, exact date): **3,080 net-new rows across 2,114 properties**, against gov's current
**178** chained and **2,238** with any history.

**Filed as ⭐ B5** (B4 closed as answered; B1b re-scoped to coverage; deed acquisition **deferred,
not refuted** — it is the right answer for the tail B5 cannot reach). ⚠️ **3,080 is a CEILING** —
ID-to-ID resolution takes a share, the exact-date key inflates it via the A2b
one-conveyance-several-dates class, `gsa_lease_diff` already covers 3,704 properties, and a
seller-exit only deepens a chain where the buyer is known too. ⚠️ **The `developer` column is not
the path** — 32 rows / 30 properties.

**The durable lesson, and it is mine to own:** *"the source is exhausted"* is a claim about
**every table that could carry the fact**, not the tables named after it. I measured
`deed_records` and `property_documents`, found them thin, and recommended acquisition — the most
expensive conclusion available — while a source holding **30× more** sat one join away. It is the
A5 rule (*grep for who already writes the gap*) and the A2 rule (*check whether an existing
producer already minted the parties*) arriving as a **recommendation** instead of a code review,
where nothing catches it. **Acquisition earns the highest burden of proof.**

**Also durable:** when one domain out-performs another on a metric, **group that metric by its
provenance column before theorising.** The funnel audit could not see this at all; one
`group by ownership_source` produced it immediately.

**Scott generalised it correctly and it is a CLASS, not an incident.** Two more unconsumed gov
sources inside ten minutes: **`gsa_lease_change_facts`** — 336,303 rows, `landlord_change_flag` on
**38,213 across 8,845 leases**, **38,055 with both old and new lessor names**, spanning
**2013-02 → 2026-02**, against `ownership_history`'s 6,648 `gsa_lease_diff` rows; and
**`property_sale_events`** — **5,208 rows carrying `ownership_history_id` AND
`sales_transaction_id`, both populated on ZERO rows.** The comps↔ownership join table is modelled
and was never wired. ⚠️ 38,213 is a RAW signal — P138 flicker, A2b per-lease fan-out (the table is
keyed on `lease_number`), and name variants all inflate it.

Filed as **playbook Class 20** (*a source one domain consumes and a sibling never wired up*) and
**backlog B6** — the systematic sweep across GSA lease inventory, SAM.gov, public records, sales and
dia, covering **both** stores (comps + ownership history), with corroboration/contradiction routed
to a review lane on the **existing** authority ladder and a next-action for every detected change.
**B6 is audit + design; it builds nothing.**

## 2026-08-28 — C2e tranche one MINTED. The noise cost the floor existed to prevent is mostly not real.

Evidence: [`C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md`](../audits/C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md);
folded into the canonical page as **§4i**. Batch `c2e_gov_eligible_t1_20260828`, gov only, dia untouched.

**The structural finding.** `v_lcc_merge_candidates` and `v_lcc_merge_candidates_normalizer_blind`
filter **`entity_type = 'organization'`**; a minted asset is **`entity_type = 'asset'`** — so it is
**structurally incapable of entering either surface.** The merge-noise cost that justified the rent
floor **cannot occur for asset minting at all.** Measured across 2,000 entities: merge candidates
5,250 → 5,250, `auto_mergeable` 3,038 → 3,038, normalizer-blind 64 → 64, drift 0 → 0. The entire
observable cost was **+20 `v_duplicate_candidates` rows (+0.25%)** and **+23 Tier 0 cards with the
`auto` band flat at 9.**

⚠️ **This does not retire the doctrine.** *"Evidence justifies the entity"* is exactly why the mint
was eligible-set only: **2,000 minted, 2,000 resolved an owner, 0 evidence-less.** What is refuted
is the narrower claim that minting *assets* pollutes the merge surfaces.

**Verified live:** asset anchors **5,096 → 7,145**; `lcc_property_owner` **4,065 → 6,065**; distinct
owner entities **2,768 → 3,743 (+975)**; Tier 0 ask 82 → 91, auto 9 unchanged; drift 0.

### ⚠️ `auto_mergeable` now has TWO threads moving it — and this nearly read as a failed gate

I checked the gate live and got **3,005**, against C2e's reported-unchanged **3,038**. That is the
"unexplained move is a stop" condition. **It was not the mint:** `lcc_entity_merge_log` shows **64
merges in that window from the other Cowork thread** (log 66 → 130, 97 entities tombstoned), and
`v_lcc_merge_candidates` cannot see assets in any case. **C2e's claim was correct at its measurement
time.** New rule recorded in §4i: with parallel windows, *"the gate did not move"* means nothing
without a **timestamp and an attribution** — read `lcc_entity_merge_log` before claiming a delta is
yours.

### 👤 Tranche two — recommended in two steps, not run

**4,811 properties / 4,354 owners remain.** ⚠️ **Tranche one tested the SAFEST population** — its cut
landed at $543,782 of owner rent, entirely *above* the old floor, so it exercised none of the
low-rent tail the no-floor decision was actually about. **T2a (owner rent ≥ $100k: 2,570 properties,
17.2% contactable)** is indistinguishable from tranche one and covers the whole $2M–$20M sweet spot
— recommended. **T2b (below $100k + unknown: 2,241 properties, ~3% contactable, 17.8% public bodies
in the bottom band)** is Scott's call, **and the argument has changed**: C2a said stop to avoid
noise, and that premise is now measured and largely false. What remains is a judgement about
prospect quality, not technical risk.

⚠️ **Whatever runs, drive `lcc_ingest_domain_owner_evidence` explicitly afterwards** — cron 225's
400/run cap would leave a 2,570-row tranche evidence-less for most of a week.

## 2026-08-28 05:10 UTC — repository-wide consolidation on the ownership→contact chain

Scott: *"apply this to all files in the repository on the topic… consolidate the intention into one
living document… a clean and clear paper trail without older files distracting us."*

**Surveyed the whole topic: ~22 architecture docs + ~21 audits touch this chain.** I expected to find
a pile of contradictions. **I did not — and that matters, because the fix is different.** A targeted
conflict scan (the $500k floor, "producer with no consumer", the coverage percentages, `--min-rent`)
returned **zero hits** across the ten oldest candidates. They are not wrong; they are **unindexed**,
and **two of them are dangerously named**.

### ⚠️ The real hazard was naming, not staleness — and I nearly fell into it myself

**`owner-reconciliation-engine.md` does not resolve the property owner.** It resolves the **point
person** — which Northmarq broker works the deal (`lcc_entity_owner_override.owner_user_id`).
`sf-owner-capture.md` is also point-person (the Salesforce Task assignee). The property owner lives
in `lcc_property_owner`. `property-owner-subsystem.md` opens by documenting this exact confusion as
*"the finding that reframed P0.2."* Both files now carry a **NAMING TRAP** banner, and
`touchpoint_cadence_spec.md` (2026-04-13) carries one recording that **BREAK-2's "no consumer"
verdict was overturned**.

### One living document, with a topic index

**`connectivity-and-open-threads.md` is the living doc for the chain**, and it now opens with **§0 —
the topic index**: the three canonical pages and what each owns, the two naming traps, the
supporting design docs, and the full evidence trail. Anyone picking this topic up reads one file and
knows which of the twenty to open.

**Nothing was deleted.** Per `DOCUMENTATION-MAP`, an audit is *evidence for a date* and dated
evidence stays. The rule now stated on §0: **if a number in a canonical page disagrees with an
audit, the page wins and the audit gets a supersession banner in the same change** — as
`C2_CONNECTIVITY_STALL_MAP` now does.

## 2026-08-28 04:50 UTC — C2e drafted (the mint); and C2's own audit was carrying three dead claims

**C2e prompt drafted** → `prompts/C2e-no-floor-eligible-set-asset-mint-2026-08-28.md`. It implements
Scott's decision: **drop the rent predicate, keep the evidence predicate.** Mint only gov properties
whose owner **resolves on the same pass** (C2a: ~6,811 of 10,415), staged — **tranche one only
(~top 2,000 by owner portfolio rent), then measure the noise, then recommend tranche two and stop.**

**The noise measurement is the point of staging, and it has never been done.** C2a could not measure
it because nothing had been minted. The prompt requires a before/after table on
`v_lcc_merge_candidates` **and `auto_mergeable`**, the normalizer-blind population, canonical-name
drift, the Tier 0 lane, and the duplicate surfaces — with the instruction that **an unexplained
`auto_mergeable` move is a stop, not a footnote** (it has held at 3,040 through N15c, N15e, N19 and
P198, every movement explained group by group).

### ⚠️ Consolidation: the C2 audit was still asserting three things later rounds overturned

A future chat reading `C2_CONNECTIVITY_STALL_MAP` cold would have inherited all three. Now
banner-corrected at the top of that file:

| C2 said | truth |
|---|---|
| 32,289 properties · 5,144 anchors · **16%** | **25,633 · 5,096 · 19.9%** — the 32,289 included 6,657 archived gov shells; the 5,144 counted 49 identities pointing at deleted properties |
| *"`lcc_mint_gov_asset_entities` **refuses to run without `--min-rent`**"* | **False** — it takes a row list; the floor was a caller-side convention in the feeder script |
| *"**Do not simply drop the floor**"* | **The floor is dropped** (Scott 2026-08-28) — it gates on *rent*, and $500k ≈ $7.1M of value, excluding two-thirds of the $2M–$20M sweet spot |

**§1's chain shape, §2's Salesforce finding and §4's corrections still stand** — it is the
denominator and the floor conclusion that moved. That distinction is stated on the banner so the
whole file is not discarded.

## 2026-08-28 04:30 UTC — Scott's floor decision: NO rent floor, eligible-set only. And my framing was wrong twice.

Recorded as canonical **§4h**. Scott: *"My inclination is to have no minimum floor… we want to
resolve all ownership and pursue the relative next most valuable contact based on all
considerations… our sweet spot tends to be single-tenant deals from $2M to $20M, through volume with
repeat seller clients."*

### ⚠️ Two facts I had not established before recommending $250k

1. **The gate is on GROSS ANNUAL RENT, not deal value.** At a ~7% cap the $2M–$20M sweet spot is
   **$140k–$1.4M of rent** — so the **$500k floor sits at ≈$7.1M of value and excludes the bottom
   two-thirds of the target range.** A floor calibrated for *"is this worth an entity"* was never
   calibrated for *"is this our kind of deal."* **I recommended $250k without ever converting rent
   to value against the business model.**
2. **There is no `--min-rent` inside the mint.** `lcc_mint_gov_asset_entities(p_rows jsonb, p_batch
   text, p_dry_run boolean)` takes a **row list**; the floor is a caller-side convention in the
   feeder script, not a database constraint. Both C2a and I described it as a floor *in the mint*.

### ⚠️ And Scott's own example was measured and does NOT hold

*"Someone that owns 20-30 properties with rents below $250k."* Measured on gov (non-archived, with a
`true_owner_id`): of **16 owners with 20+ properties, ZERO have all properties under $250k.**
Per-owner aggregation adds only **129 owners** over the $500k per-property floor (93 at $250k), out
of 7,196. **The portfolio mechanism is not the argument — the rent-vs-value mis-calibration is.**
Both halves reported; the conclusion survives on the stronger half.

### The resolution

**The floor decides what to MINT, not who to PURSUE.** Resolving ownership broadly is cheap and
reversible; ranking who to call is `v_priority_queue`'s job, and it already weighs owner-level value,
contactability and signal. **Mint broadly, rank narrowly** — which is exactly what Scott asked for.

**DECISION: no rent floor, eligible-set only** — mint the ~**6,811 of 10,415** gov properties whose
owner resolves on the same pass; skip the ~3,600 that would resolve nothing and match the retire
predicate on day one. Backlog **C2e**.

⚠️ **The one real cost is unmeasured and must be measured on the first tranche:** ~6,811 entities is
**+11% on a 62,368-entity graph**, landing on `v_lcc_merge_candidates`, search and every count
surface. **That is the gate's entire purpose and has never been quantified** — C2a had nothing
minted to measure it on. Stage the mint; gate tranche two on tranche one's measured noise.

⚠️ **gov only. Do not sweep dia in** — 84% of its un-minted owner slots hold an OPERATOR (P113).

## 2026-08-28 04:00 UTC — C2a landed; and the "$500k floor" turns out to be FIVE knobs, not one

Evidence: [`docs/audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`](../audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md).
Folded into the canonical page as **§4f**. **Nothing minted, no floor changed.**

### ⚠️⚠️ Cross-thread collision caught — read this before touching any floor

`CLAUDE.md` (P161) states these are *"the same $500k knob as the gov asset-mint and
`CADENCE_SIGNAL_MIN_VALUE` — one number, not three."* **Measured today, that is FALSE as
implemented — there are FIVE independent objects sharing a value:**
`lcc_mint_gov_asset_entities --min-rent` (CLI) · `gov_research_gate_value_floor()` + its dia twin ·
`lcc_weak_role_value_floor()` · `lcc_chain_human_value_floor()` · `CADENCE_SIGNAL_MIN_VALUE` (env).

**And two Cowork threads are proposing to change two different ones this week** — **C2a** (this
thread) wants the asset-mint floor at $250k; **B1** (the automation window, prompt already drafted)
wants to split the *research-gate* floor by consumer. **Changing one does not move the others, and
the docs say it does.** Recorded as canonical §4g; fixing the CLAUDE.md sentence is backlog **C2d**.

### C2a corrected C2's own denominator

**32,289 / 16% included 6,657 ARCHIVED gov shells** that every feeder filters out by design — and
that are genuinely empty (2 of 6,657 carry a `true_owner_id`). Live: **25,633 properties, 5,096
anchors, 19.9%**. Conclusion unchanged; the quoted number was wrong. *(The 5,144 also counted 49
identities pointing at deleted properties.)*

### The finding: the resolve rate holds — the OWNERS degrade

gov technical resolution stays **58–76%** from $500k to under $50k, so *"does it still resolve"* was
the wrong question. What collapses is owner quality: **already-contactable owners 21.8% → 6.8% →
1.6%**, owners known outside the gov feed 9.7% → 1.3%, and the named rows become **cities, counties,
state DOTs, FedEx and private individuals**.

| floor (cumulative, gov) | minted | resolve | rate | net-new owners | already contactable |
|---|---:|---:|---:|---:|---:|
| ≥ $500k *(today)* | 1,779 | 1,218 | 68.5% | 928 | 170 |
| **≥ $250k** | 3,061 | 2,102 | 68.7% | **1,629** | **323** |
| ≥ $100k | 5,606 | 4,034 | 71.9% | 3,178 | 564 |

⚠️ **Mint the ELIGIBLE SET, not the band.** `lcc_mint_gov_asset_entities` takes its own row list, so
a $250k run mints the **2,102 that resolve on the same pass**, not 3,061 of which 959 sit
evidence-less and match the documented retire predicate on day one. That is the difference between
honouring *"evidence justifies the entity, never the reverse"* and merely citing it.

⚠️ **dia is a different problem and no floor fixes it** — **84% of its un-minted owner slots hold an
OPERATOR** (P113) and 73% of the would-resolve population has no rent on file. **Change nothing on
dia**; its levers are `is_operator_not_owner` and rent coverage (A5e).

**👤 The floor decision is Scott's.** Recommendation: **$250k now → re-measure → $100k as the hard
floor, never below.**

## 2026-08-28 03:20 UTC — C2a drafted; and the consolidation pass overturned a live verdict

**C2a prompt drafted** → `prompts/C2a-asset-mint-floor-resolve-curve-2026-08-28.md`. Pure
measurement: **at what rent floor does a minted asset actually resolve an owner?**, banded by domain,
with the operator exclusion, denominators stated per band, and a positive control. **Mints nothing;
the floor decision stays Scott's.**

### ⚠️ The consolidation caught two stale claims in the canonical connectivity doc

`docs/architecture/connectivity-and-open-threads.md` **already owned this topic** — its §4b is
literally *"the asset → owner → contact → cadence chain"*. So C2 was folded in as **§4e** rather
than left beside it, and the audit now banners to the canonical page. Two corrections that a future
chat would otherwise have inherited:

- **⚠️ BREAK-2's verdict is OVERTURNED.** It concluded *"cadence is a producer with no consumer
  (doctrine violation)"*. **Scott, 2026-08-27: the cadence layer is "absolutely a huge part of this
  build."** The layer is **intended and un-built-out, not orphaned** — it reads empty because Scott
  has not begun using LCC for BD, the effort so far having been the build itself. **So "1,728 never
  touched" measures an un-started pipeline, and the remedy is to finish the consumer, not to gate
  the producer harder.** A future chat reading BREAK-2 cold would have moved to retire it. The
  genuine defects it found still stand: the future-dated `last_touch_at` writer, `owner_user_id`
  present on only 7 rows, and cadences on unreachable parties.
- **⚠️ BREAK-3's "49.2% owner resolution coverage" is *of ASSETS*, not of properties.** It reads
  1,910 of **3,886 assets**; against all **32,289 properties** the same coverage is **13%**. They
  differ ~6× and both are correct. A denominator warning now sits on that heading — this is the same
  scoping trap that made me quote "101 contacts / 157 cadences" when the fleet-wide figures are
  **1,439 and 2,302**.

**Backlog rows C2a / C2b / C2c** carry the measurement, the Salesforce bridge, and the explicitly
unmeasured list.

## 2026-08-28 03:00 UTC — C2: the connectivity stall map. The gate is ASSET IDENTITY, not contacts.

Full writeup: [`docs/audits/C2_CONNECTIVITY_STALL_MAP_2026-08-28.md`](../audits/C2_CONNECTIVITY_STALL_MAP_2026-08-28.md).
**Diagnosis only — nothing written.** Scott reframed the target: measure where the chain
*property → recorded ownership → SPE/LLC control → true owner → the right contact → the right
prospecting bucket and broker → relative priority* actually stalls.

**It stalls at hop 3, and everything downstream is starved by it.**

| hop | count | of prior |
|---|---:|---:|
| properties (gov 20,493 + dia 11,796) | **32,289** | — |
| dia `true_owner` rows that are actually OPERATORS (P113) | 7,941 of 10,293 | — |
| **LCC asset anchors** | **5,144** | **16% of properties** ⚠️ **THE GATE** |
| resolved property→owner rows | **4,065** | 13% |
| distinct owner entities | 2,768 | |
| **owners with an active contact** | **1,439** | **52% of resolved owners** — the healthy hop |
| cadences | 2,302 | |

**⚠️ The Salesforce book is connected to the wrong side.** 9,793 SF-linked people are in LCC, 9,491
with an email, **9,129 (93%) carry a relationship edge — but only 669 (6.8%) reach a resolved
property owner.** They are attached to their employer org via the `works_at` Salesforce-account edge
(the same bare-SF signal **P112** disqualified and **P161** gated out of reachability). **The bridge
has no far bank**: there are only 4,065 property→owner rows for 32,289 properties. Contact
acquisition is *not* the bottleneck.

**The 16% is a DECISION, not a defect.** `lcc_mint_gov_asset_entities` **refuses to run without
`--min-rent`**, and CLAUDE.md states the doctrine directly — *"evidence justifies the entity, never
the reverse"* and *"asset-identity coverage is what gates owner resolution."* ⚠️ **Do not simply
drop the floor** — minting ~27,000 evidence-less assets re-creates the noise the gate prevents. The
measured question is **at what rent floor a minted asset actually resolves an owner**: P141 saw
**612 of 663 resolve at $500k (92%)** and no degradation in lower bands on small samples. Extending
that curve is the input to the decision.

### ⚠️ Corrections to my own earlier figures in this thread

- **"101 owners with a contact / 157 cadences" was scoped to owners above the $500k floor.**
  Fleet-wide it is **1,439 pivot contacts and 2,302 cadences** — ~10× larger. Both correct about
  different populations; quoting the scoped one as the system total understates it badly.
- **Two instrument errors preceded this map**, both caught only by reading named rows: counting
  *any* linked entity as a "person" returned **addresses** (`2 Mill St, Lawrence, MA 01840`) and
  inflated an "unclosed loop" **56×**; and `activity_events` attributes 23,232 events to just **253
  distinct people**, so it cannot answer "do we correspond with this person" — `email_bodies`
  (5,509 distinct addresses) is the record, keyed by **address**.

**Not measured, stated so nobody assumes it was:** historical ownership depth on dia; the
developer/investor/buyer prospecting-type split; Outlook/WebEx per contact (WebEx is not in the
schema at all); whether the 2,302 cadences carry a correct broker.

## 2026-08-28 02:30 UTC — N15d: the producer is proven fixed, by CONTROL rather than by wall clock

**The date rolled over and the check is finally readable — but the decisive evidence is not the
elapsed window.**

**Wall-clock arm (weak, and stated as weak):** 6.41 hours since the trigger, **2 entities created**,
**both keyed correctly**, `v_lcc_canonical_name_drift` still **0**.
`JACO SAVANNAH REALTY, INC.` → `jaco savannah realty`; `asset 4477` (gov mint) → `asset 4477`.
⚠️ **Neither is a case where the old and new normalizations DISAGREE**, so this shows the trigger
breaks nothing — it does not by itself show the trigger *corrects* a drifted writer. Two rows is a
thin sample and is reported as such.

**Positive-control arm (decisive).** A row was inserted through the real writer path carrying a
**deliberately wrong** `canonical_name` — `century park` — exactly what the outgoing aggressive
normalizer produces, inside a self-rolling-back transaction:

> **writer supplied `century park`; the trigger stored `century park partners`; corrected = true.**
> Residue after rollback: **0 rows.**

**The trigger overrides a drifted writer on a live insert.** That is the mechanism proven, not the
absence of failures inferred — the distinction the N15d audit itself drew when it refused to claim
a pass off an empty population.

### ⚠️ And the control closes the exact hazard CLAUDE.md has warned about for months

`Century Park Partners` vs `Century Park Properties LLC` is *the* documented example of why
`lcc_normalize_entity_name` is banned for identity. Measured on the live rule:

| name | new key (live) | old aggressive normalizer |
|---|---|---|
| `Century Park Partners LLC` | `century park partners` | `century park` |
| `Century Park Properties LLC` | `century park properties` | `century park` |

**`would_falsely_link = false`.** Under the old rule both collapse to `century park`, so
`ensureEntityLink` would have linked two different companies **automatically, with no human
review**. That failure mode is now closed and demonstrated side by side.

**Verdict: N15d substantially passed.** The producer is fixed — mechanism proven and no drift over a
real production window. A full-day wall-clock read is still worth taking (daily mint counts range
0–8), but the risk it was guarding is materially retired.

⏳ **Still pending: cron 241 at 06:55 UTC** — `tier0_auto` writes remain **0**; that window has not
come round yet today.

## 2026-08-27 22:25 UTC — N19 executed: 14 groups merged, and Montecito Medical came into view

Scott approved the 19 signal-bearing pairs. **⚠️ They were not 19 pairs — they were 14 GROUPS**, and
merging pairwise would have been wrong: `National Government Properties` had an entity that is a
*loser* in one pair and a *winner* in two others, and `American Realty Capital`'s single loser
mapped to **three different winners**. Resolved to one winner per `(canonical key, entity_type)`
group by P195's ownership-first rule, then merged every other member in. **22 losers, all
reversible.**

| | before | after |
|---|---:|---:|
| live entities | 62,368 | **62,346** (−22) |
| `lcc_entity_merge_log` | 44 | **66** (+22) |
| **National Government Properties — relationships** | 349 | **358**; 2 assets, $4,246,846 |
| **American Realty Capital — relationships** | 87 | **95** |
| collision pairs remaining | 73 | **45** (the 24 husks + 9 cross-type) |
| `canonical_name` drift | 0 | **0** |
| Tier 0 ask / auto | 82 / 9 | **82 / 9** |

### ⚠️ Two gated counters moved, and both are the merge WORKING

- **Parked 137 → 141.** All four new cards are **Montecito Medical**. Before the merge its
  **$1.62M of rent sat on a different entity from the one carrying its domain candidates**, so the
  candidate-bearing entity was below the $500k floor and produced no cards at all. Consolidated, one
  entity now carries both and enters the Tier 0 population with 4 domain cards (2
  `employer_on_file_differs`, 2 `no_employer_on_file`). **An owner that was invisible because its
  value and its people lived on separate rows** — precisely the class this arc exists to fix.
- **`auto_mergeable` 3,040 → 3,038.** Verified: **0 of tonight's 14 winners still heads an
  auto-mergeable group**, and **0 winners were themselves merged away** — the −2 is exactly the two
  groups this pass resolved.

**Held deliberately: the 24 husk pairs** ($0 rent, ≤5 edges) and the **9 cross-`entity_type` pairs**
(`David Siegel`, `Dennis Needleman`, `Constance Cincotta`, `Alexandria` each exist as both a person
and an organization — a shared key is correct, identity is not).

⚠️ **Two naming oddities surfaced and are NOT merge questions:** `Constance Cincotta` is typed
**organization** while also existing as a person, and `Alexandria` is typed **person** though it
reads as a city. The org↔org and person↔person merges are still correct — these are data-quality
items for the junk/naming lane, recorded so they are not mistaken for merge errors.

## 2026-08-27 22:10 UTC — N15d still vacuous; the N15e collision set is the actionable output

### ⏳ N15d re-checked and it is STILL not readable — 2.08 hours, ZERO entities created

Measured 22:09 UTC: **0 entities created since the trigger went live at 20:05**, so the detector
still has an empty population and would return 0 regardless of what the producer does. **Not run,
not claimed.** The wall-clock arm remains due 2026-08-28, and this second empty read is itself
evidence the ~4/day rate is bursty rather than steady — a full day is the minimum honest window.

### ⭐ The 47 entities / 73 pairs N15e surfaced are a real, value-ranked decision set

`v_lcc_n15e_canonical_collision_candidates`, split:

| slice | pairs | note |
|---|---:|---|
| byte-identical **and** same `entity_type` | **46** (43 unordered) | the safe population |
| …of those, carrying **rent** | **6** | **$8.13M** combined |
| …no rent but real deal history (>5 edges) | **13** | |
| …husks (≤5 edges, no rent) | **24** | batch-able |
| **cross-`entity_type`** | **9** | ⚠️ **never merge** — person↔organization |

**Head of the list is the Gardner shape again: `National Government Properties` — 2 assets,
$4.25M rent, and 354 relationships across the pair.** A firm in the core government market whose
deal history is split, invisible until the key collapsed. Then `Montecito Medical` ($1.62M, and it
appears in two pairs so it may be a 3+ member group), `American Realty Capital` (×2),
`1121 California Avenue LLC`, `DP Brighton LLC`, `The Fischbach Company LLC`.

**695 relationships sit across the 43 pairs.** This is the same class as N3h — duplicates carrying
transaction history that the survivor under-reports (P177) — and it is the direct product of N15c
+ N15e collapsing the key. **Nothing merged; awaiting Scott.**

⚠️ **The 9 cross-type pairs are excluded by construction, not by judgement.** `David Siegel`,
`Dennis Needleman`, `Constance Cincotta` and `Alexandria` each exist as both a person and an
organization. A shared canonical key is correct there; treating it as identity is the person/org
conflation `sf-account-link.js` exists to prevent.

## 2026-08-27 20:45 UTC — N15e and N18 both landed; and BOTH corrected numbers I had briefed

Audits: [`N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md`](../audits/N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md)
· [`N18_ATTRIBUTED_RENT_SELF_COMPARISON_2026-08-27.md`](../audits/N18_ATTRIBUTED_RENT_SELF_COMPARISON_2026-08-27.md).

### N15e — applied. Every live entity now keys correctly.

**537 rewritten, `v_lcc_canonical_name_drift` 537 → 0, no class at all.** All 62,368 live entities
key to `lcc_entity_canonical_key(name)`. Gates: `auto_mergeable` **3,040 → 3,040**, Tier 0
**82 / 9 / 137 unmoved**, `lcc_owner_domain_core` byte-identical (same md5 before and after),
ledger 537/537, round trip run and rolled back, suite 4,772 pass. **47 entities / 73 pairs**
surfaced as duplicate candidates — surfaced, not merged, as specified.

### ⏳ N15d did NOT pass — and refusing to claim it did is the right call

The trigger landed 20:03–20:05 UTC; the check ran at 20:26. **Elapsed window 21 minutes, entities
created in it ZERO.** At ~4/day — one per six hours — a detector over an empty population returns 0
regardless of what the producer does. **That is exactly the Class 11 "a detector that cannot fail is
not evidence" trap, and reporting a pass would have been literally true and completely
uninformative.** **The wall-clock re-run is still due 2026-08-28**, and even a full day at ~4/day is
weak (daily counts range 0–8).

⚠️ **N15b's recurrence query is not published**, so "re-run it" was not literally executable. Three
reconstructions were built against pre-backfill values rebuilt from the ledger; all three reproduce
the burst (1,760–1,789 vs 1,789) and the most-recent date exactly, and put the trickle at **70–94
against the quoted 79**. Quote the band, not the 79 as if reproduced.

### ⚠️ My briefed UNIQUE figure was stale — 3,930 is now 6,608

I wrote *"3,930 groups violate it today"* into both the backlog and the N15d prompt. That is the
**pre-N15c** number: **collapsing keys is precisely what creates collisions.** 3,930 → **6,584**
after N15c's backfill → **6,608** after N15e. **The honest input to Scott's UNIQUE-key decision is
6,608**, 68% above the figure the question was framed against. My own dated-claim trap, caught on a
number rather than a blocker, and one query would have caught it.

### N18 — fixed, and it corrected the mechanism I had described

**1 → 5 distinct values** ($431,643 – $2,226,661); **1,602 ms → 128 ms**; buffers **2,102,242 →
3,904**. Guard `test/sql-self-comparison-guard.test.mjs`, 5 mutations verified RED.

⚠️ **The fabricated value is the domain-wide MAX, not the SUM** — N15c §6 said "sum" and **I
repeated it in the N18 brief**. The gov-wide sum is **$3.52B**; $34,920,891.77 is the gov-wide
`max(annual_rent)`. The real shape is `props × domain_max`. ⚠️ **And "one distinct value" was a
property of the surviving 6-row slice, not an invariant** — all six carry `props = 1`; across the
full 277-candidate population the broken expression takes **11 distinct values, up to $279M**. The
Class 11 signal was real; the explanation attached to it was not.

⚠️ **The ranking was not merely wrong, it was arbitrary.** Both sort keys were constant, so the
"value-prioritized" worker returned whatever the plan emitted. Corrected, **every position moved
except rank 4** (Heritage 5→1; one row overstated 20.4×).

⚠️ **It was a LIVE-ONLY defect — the repo never carried it.** The newest committed body was correct;
the live view had been hand-patched twice and never committed. Same class as the gov A4b migration
found this afternoon. A rebuild from the repo would have silently reverted N15c's repoint
(**267 → 196**). The migration therefore carries the WHOLE view body.

**Recorded as playbook Class 19** — *a predicate that constrains nothing* — with the detector, the
comment-stripping caveat, and all three traps.

## 2026-08-27 20:25 UTC — two prompts drafted; and the N15e objection shrank under measurement

**Two prompts, deliberately not three.** `prompts/N15d-producer-check-and-held-row-recompute-2026-08-27.md`
folds N15d and N15e into one because **N15d GATES N15e** — if the producer is still minting
key-disagreement duplicates, recomputing the residue is polishing the output of a live leak. The
prompt says stop-and-report if Unit 1 fails. `prompts/N18-developer-attributed-rent-self-comparison-2026-08-27.md`
is the second.

### ✅ Scott approved recomputing the 537 — and the measurement makes it a stronger yes

The stated objection was *"recomputing discards a captured string some of them preserve."*
Measured: that applies to **58 of 537 (11%)**, not all of them — and
`lcc_n15c_canonical_backfill_log.old_canonical_name` **already preserves the old value**, so for
those 58 nothing is destroyed; it moves from a key column to a ledger, which is where provenance
belongs. **A dedup key is not an archive.**

**⚠️ 39 held rows will collide with a live entity, and that is the BENEFIT.** Read on named rows,
the collisions are **byte-identical names the stale key was hiding**: `1121 California Avenue LLC` ↔
`1121 California Avenue LLC`, `Alex Lyman` ↔ `Alex Lyman`, `Crest Properties` ↔ `Crest Properties`,
`Block RE Services` ↔ `Block Re Services`. The prompt requires them **surfaced, never merged** —
merging stays a human confirm through `lcc_merge_entity`.

**⚠️ Several collide ACROSS `entity_type`** — `David Siegel`, `Dennis Needleman`,
`Constance Cincotta` and `Alexandria` each exist as both a **person** and an **organization**. A
shared key is correct; reading it as identity is the person/org conflation `sf-account-link.js`
exists to prevent, and the prompt forbids a cross-type merge proposal. And **`American Realty
Capital` colliding with `American Realty Capital Trust` is Scott's adopted rule working**, not a
defect — named so nobody "fixes" it later.

### N18 confirmed still broken, live

`v_lcc_developer_classification_candidates.attributed_rent`: **6 rows, exactly 1 distinct value —
$34,920,892**, the gov-wide sum, on every row. The predicate correlates
`pof.source_property_id = pof.source_property_id`, a column against itself. A single distinct value
across every row is the Class 11 signal. It is also ~1,509 ms of the view's 1,666 ms (a P118
correlated subplan at `loops=385`). The prompt requires the corrected **ranking** to be graded on
named rows — an operator has been classifying against a constant.

## 2026-08-27 20:05 UTC — N15c COMPLETE: `canonical_name` has ONE writer, live

Full writeup: [`docs/audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md`](../audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md).
**The trigger is applied, the backfill has run, and every gate held.**

**Deploy precondition verified BEFORE applying the trigger, not assumed.** Live `/version` on
`tranquil-delight` returns **`d8fcfbfef94a`** — the N15c merge commit itself — and `git_pinned` was
corroborated by reading the SOURCE at that sha: `legacyCanonicalName` + the dual-read
`canonical_name=in.(current,legacy)` present, the `entities-handler.js` inline copies gone,
`sync.js`/`domains.js` routed through the shared function. That check is the whole reason the order
was safe (P131: *check the fix against the deployed sha*).

| gate | result |
|---|---|
| **invisible to `ensureEntityLink`'s own lookup** | **10,336 → 537** — and the 537 are *exactly* the held rows |
| `v_lcc_canonical_name_drift` | only `held_stale_name_repair` = **537**; nothing else |
| rows rewritten / ledgered | 15,402 / **15,402** (reversible by `batch_tag='n15c_go'`) |
| **`auto_mergeable`** | **3,040 → 3,040** — the gate that proves the merge detector was untouched |
| Tier 0 lane | ask **82** / auto **9** — unmoved |
| rows keyed to the empty string | **114 → 0** (98 now on the `dc:` namespaced fallback) |

**Named rows read correctly, including Scott's decision:** `Rainier Rockford DST Trust` and
`Rainier Rockford Llc` **both key `rainier rockford`** — a DST and its LLC are one true owner, as
decided. `671 Poplar LLC` → `671 poplar`; `BALTARA ENTERPRISES, L.P.` → `baltara enterprises l p`.

**⚠️ The writer census was wrong three times running — 7 → 8 → 10**, plus a twelfth normalization
hiding in a dead defensive ternary in `operations.js`. `api/sync.js` and `api/domains.js` were both
missed by grep. **That is the argument for fixing it at the DATABASE**: a `BEFORE INSERT OR UPDATE
OF name` trigger does not care how many writers exist, and it closes the staleness class in the
same stroke. It returns `NEW` unconditionally (P196) and is `UPDATE OF name`, not a bare `UPDATE`,
so the 537 held rows stay held.

**A real firm was rescued from the empty key.** 114 entities shared `canonical_name = ''` — among
them **18 copies of `Partners Group`**, a real firm whose two semantic tokens are *both* stripped by
the outgoing normalizer, leaving it keyed identically to `--` junk. It now keys `partners group`,
which also makes it visible to the merge detector for the first time — **that is N10's held
`partnersgroup` group**, now groupable.

**⏳ The Class 8 check is tomorrow, and it is the one that matters.** A backfill is not a fixed
producer. Re-run the recurrence query: post-fix mints of disagreeing pairs should read **0** against
the pre-fix **~4/day** (79 in 21 days — never the burst-blended 1,879/30d, off ~24×).

**👤 Two decisions still Scott's:** the **537 held rows** (`canonical_name` left stale after `name`
was repaired — recomputing discards a captured string some preserve, e.g. `Scott W. Beynon` still
keyed `buyer contactsscott w beynon 801 568 1031 p`), and whether `canonical_name` becomes an
**enforced UNIQUE key** (3,930 groups violate it today).

## 2026-08-27 19:15 UTC — N15c drafted: the BUILD prompt, and two measurements that changed its shape

**Lane split confirmed with Scott:** this thread continues the **N15b → N15c** line (entity
identity / `canonical_name`); **the other thread owns A5 and the `gap_resolved` auto-close class**
(playbook Class 18). N15c says so explicitly and tells Claude Code not to touch
`handleGenerateResearchTasks` or the research lanes.

**Checked first that the build was unclaimed** — no N15b/N15c migration, no competing prompt, and
`lcc_r2_w1_canonicalizer_source_registry` (which *sounds* like this machinery) is provenance
bookkeeping for `field_source_priority`, not a dedup key. Reviewing existing machinery before
building, per doctrine.

**⚠️ Two live measurements changed the prompt's shape, and the first would have been a real bug:**

- **Do NOT point `canonical_name` at `lcc_owner_domain_core`.** N15b recommended it and Scott's
  decision endorsed its *token rule* — but the function ends `string_agg(tok, '')`, **no
  separator**. It matches only **1,973 of 62,368** rows today. Measured over 43,219 organization
  entities: **space-joined gives 37,519 distinct keys, no-separator gives 37,404 — those 115 fewer
  keys are false collisions** (the `Gate Way`/`Gateway` hazard). The adopted key is the **token
  stoplist, joined with SPACES**, built as **one token list with two join styles** so
  `lcc_owner_domain_core` keeps byte-identical output for P187/P188/P198.
- **The writer census missed one — there are EIGHT.** `field_source_priority` carries
  `entities.canonical_name → w8_u5_naming_hygiene@40`. It also means this column sits inside the
  provenance system, so the new writer must be registered or `v_field_provenance_unranked` flags
  drift.

Also sized for the prompt: **75 organization entities reduce to an empty key** under the adopted
rule and need a named fallback (the P189 blind-spot precedent). And the producer is confirmed live
again — **+5 live entities in ~40 minutes** between two of today's measurements.

**Still Scott's, and the prompt says surface-don't-guess:** the 540 stale rows (recomputing
discards a captured string some preserve) and whether `canonical_name` becomes an enforced UNIQUE
key (**3,930 groups violate it today**).

## 2026-08-27 19:00 UTC — A5 was ALREADY DONE and I recommended re-sending it; playbook Class 18

**⚠️ My recommendation to send A5 to Claude Code was wrong — it had already completed and merged**
(PR #1840, `docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`, 182 lines, plus 50 lines
into `CLAUDE.md` and 8 into the backlog). **The prompt file was still sitting in `prompts/`
un-filed, and I read the prompt folder as the record of what is outstanding.** It is not — the
**audit** is. Filed to `done/` now. *Check `docs/audits/` for the round's output before
recommending that a prompt be sent.*

### Why A5 matters more than the filing slip: two "healthy" lanes were instrument readings

**`815 open` is `1000 − 185`** — the leftover of a truncated window. `handleGenerateResearchTasks`
reads a **29,643-row** feed with `limit=2000`, PostgREST caps the response at **1,000**, and the
auto-close guard is written `if (feed.length < limit)` → **1000 < 2000 → true**, so it fires over a
truncated slice and closes everything outside it as `gap_resolved`. **All 596 "completions" are that
auto-close; 170 of 183 sampled owners still have `salesforce_id IS NULL` — 93% false.**

**⚠️ And it invalidates the lane the re-audit had just called healthiest.** gov
`property_missing_recorded_owner` — *"908 completions in 30 days, ~23/day, clears in ~7 weeks, leave
it alone"* — has its open count pinned at **exactly 1,000**, **885 of 885** completions are the same
auto-close, and **146 of 146** sampled properties still have `recorded_owner_id IS NULL`. **Zero
real work in 30 days, and it cannot clear, because its open count is a constant.**

Recorded as **playbook Class 18** — *an open count that is really a query window, and a terminal
status nobody earned*. The durable rules: **compare the guard against the RETURNED row count, never
the limit you asked for** (same footgun as `CAND_LIMIT = 1200`, P123); **check who writes the
terminal status before ranking lanes by completion rate** — the re-audit switched to rates
specifically to avoid being fooled and was fooled anyway; and **a round number is a bug signal**.

### Parallel windows — the division, for the record

Two Cowork threads plus Claude Code share this repo. **This thread is the P-series** (P186–P198,
Tier 0 owner-contact, entity merges). **The other thread is the A-series** (A0–A5, the
ownership-history lane and the automation re-audit) — branches `docs/reaudit-and-a5-diagnosis`,
`docs/kickoff-refresh-and-a2b-a4b-reconcile`. Claude Code lands on `claude/*` branches.
**Neither chat reads the other; the handoff is the repo** — `CLAUDE.md`, `STATUS.md`, the canonical
pages and the playbook. That is the design, and it is why a prompt left un-filed causes a
cross-thread duplicate-work risk (§4a's "check whether the other audit window already fixed it",
now demonstrated on a prompt rather than a workflow file).

## 2026-08-27 18:45 UTC — the gov lock hid a migration that was RUNNING BUT NOT MERGED

Clearing GovernmentProject's orphaned `.git/HEAD.lock` (0 bytes, sandbox-owned, dated **2026-08-20**)
revealed **two files staged and never committed**:
`sql/20260827_gov_a4b_transition_clean_legal_form_gate.sql` and
`tests/unit/test_a4b_transition_clean_gate.py`.

**⚠️ `add` and `commit` take DIFFERENT locks.** `add` takes `index.lock`; `commit` takes
`HEAD.lock`. With an orphaned `HEAD.lock`, **staging succeeds and committing fails — and
`git status` looks tidy**, which is why this sat for a week without anyone noticing.

**Verified live before assuming a gap: the gov database is CORRECT.** All three functions exist on
`scknotsqkcheojiaewwh` and read **8 of 8 on named rows** — `EGP 17101 BROOMFIELD LLC`,
`CA-10880 WILSHIRE LIMITED PARTNERSHIP` and `JBG/12420 PARKLAWN, L.L.C` clean; `Houston, Harris
County, Texas 77007` and the other two junk names rejected.

**So this is the MIRROR of the doctrine this repo documents everywhere.** CLAUDE.md carries
*"merged is not running"* in several places; this is **running and not merged**. A DB-only change
ships instantly, which is precisely why nothing forces the commit, and the repo quietly stops being
a record of what the database does. Recorded as gov `CLAUDE.md` critical rule **12**, plus a row in
`GITHUB-WORKFLOW.md`'s error table. **The check is `git log --oneline -3 -- sql/<file>`, never "the
function works."** Same family as P194: a second copy that is correct beats no copy at all.

## 2026-08-27 18:30 UTC — N15b decision 1 ANSWERED; N17 recorded; and a false "lost work" alarm

**✅ Scott's decision on the N15b token rule: a DST, its Trust and its LLC are ONE entity — the
TRUE OWNER.** `Rainier Rockford DST Trust` = `Rainier Rockford Llc`; `SE VALPO LLC` = `Se Valpo
Dst`; Syndicated Equities likewise. **So `lcc_owner_domain_core`'s `trust|dst|reit` strip is
CORRECT and is the adopted rule** — what the N15b audit listed as that rule's "named residue" is
the *desired* behaviour, not a defect. N15b is now **ready to build**; decisions 2 (recompute the
540 stale rows) and 3 (enforce UNIQUE — 3,930 groups violate it today) remain open.

**New backlog row N17 — the aspirational feature, recorded so it is not lost:** individual
investors as direct owners in our target markets, *and* knowing they hold **partial positions in a
DST / TIC / JV** on similar deals. ⚠️ **This must NOT be built by splitting the `canonical_name`
dedup key** — that decision went the other way. Fractional interest is a **relationship, not an
identity split**: model it on `entity_relationships` the way `lcc_owner_sponsor_domain` models
sponsor→SPE. Unsized.

### ⚠️ A false "my edits were lost" alarm — the third instrument failure in this arc

After the two genuine lock incidents, the reflex became *rewrite it.* **Wrong twice running.** A
`grep -rl` over a file list containing one non-existent path exited **2**, the `$( )` came back
empty, and the loop reported **`MISSING` for every pattern** — including ones plainly present.
Harness "changed on disk" notices rendered a **cached older copy** and corroborated it.
**The data was fine**: disk and `HEAD` both matched (`grep -c` 2 = 2), local `HEAD` == `origin/main`,
mtimes seconds old. **Rule added to `GITHUB-WORKFLOW.md` §2a: before concluding content was lost,
compare DISK against HEAD with `cat-file` — index-free and safe — and never trust a `grep -rl`
sweep over an explicit file list.** Nothing was rewritten.

**👤 GovernmentProject has an orphaned `.git/HEAD.lock`** — 0 bytes, owned by the sandbox uid,
dated **2026-08-20 12:32**, i.e. a week old. Same class as the life-command-center incident; the
sandbox cannot remove it. PowerShell one-liner supplied.

## 2026-08-27 17:05 UTC — N15b landed (measurement only); N3h executed; Gardner's deal history reunited

### N3h — 9 merges, and the one that mattered

Scott approved; all 9 merged, **all 9 reversible**. **Gardner Tanenbaum Holdings: relationships
270 → 512 (+242)**, assets 17 → 22. That firm's transaction history was split across two live
entities, so the survivor every surface points at was reporting **half its own deal history** — the
P177 failure, and prospecting ranks on precisely that signal. Live entities 62,365 → 62,356;
`ask` 84 → 83; `auto` 9 and parked 137 unchanged; **`auto_mergeable` 3,043 → 3,040, which is exactly
the three groups resolved**; 0 duplicate groups left on the three winners.

**At $0 current rent on all nine losers, no rent-ranked surface would ever have surfaced this.** It
was found only by chasing a guard counter that moved by 2 — the discipline, not a detector.
⚠️ Gardner's `min_loser_sim` 0.667 was read before merging: it is `Gardner Tanenbaum` vs
`Gardner Tanenbaum Holdings`, a suffix, not a different party.

### N15b — measurement only, nothing written, and it corrected TWO of my prompt's premises

Full writeup: [`docs/audits/N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md`](../audits/N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md).

**Headline: 10,340 live entities (16.6%) are invisible to `ensureEntityLink`'s own lookup by their
own name.** That is the duplicate factory stated as one number. `canonical_name` has **seven
authors**, four live and distinguishable — including **two JS copies of the same rule that drifted
apart on a single character** (`[^a-z0-9\s]` → space vs deleted). ⚠️ It has **no unique
constraint** — a de-facto dedup key nothing enforces.

**⚠️ My prompt was wrong twice, and both corrections matter:**
- **"3,400 rows match no known normalization → a third author"** → adding the two JS rules takes the
  unexplained set to **540**, and they are not a normalizer at all: they are `canonical_name` left
  **stale after `name` was later repaired** (`Scott W. Beynon` still keyed
  `buyer contactsscott w beynon 801 568 1031 p`). That is the *inverse* failure and needs a
  different fix — recompute on name change.
- **The entire `auto_mergeable` gate I specified is unsatisfiable**: `v_lcc_merge_candidates`
  **does not read `canonical_name`**. It groups on `lcc_normalize_entity_name(e.name)`; the column
  is a dead passthrough. **Rewriting it cannot move `auto_mergeable`.** I asserted a blast radius
  without checking the view definition — the exact "read the function, not its name" failure this
  file keeps recording.

**The real blast radius is elsewhere and one surface is already broken:**
`v_lcc_developer_classification_candidates` joins `canonical_name` against
`lcc_normalize_entity_name(developer_name)` and is **~19% blind — 222 of 274 resolve today, 269
would if aligned**. Nobody had noticed.

**Recurrence is a burst plus a trickle: quote 79 in 21 days (~4/day), never the blended 1,879/30d**
— off by ~24×. Confirmed live: entities rose 62,363 → 62,365 in the ~30 minutes between two of
today's measurements.

**Recommendation (not applied):** adopt the `lcc_owner_domain_core` **token rule** (pure legal forms
only, keep every semantic token), enforced by a `BEFORE INSERT OR UPDATE OF name` trigger that
returns NEW unconditionally, and delete the inline copy in `entities-handler.js`. ⚠️ **Not**
`lcc_normalize_entity_name` — banned for identity, NULL for 1,070 entities, and as a *link* key it
would silently auto-link `Century Park Partners` to `Century Park Properties LLC` with no human
review.

**👤 Three questions for Scott** in §6 of the audit: which token rule (the `trust|dst|reit` residue
is a real judgement — should a DST and its LLC share a dedup key?); whether the 540 stale rows get
recomputed (it discards a captured string some of them preserve); and whether `canonical_name`
becomes an enforced unique key (**3,930 groups would violate it today**).

## 2026-08-27 16:40 UTC — merge state confirmed; docs cross-linked; N15b drafted

**Everything is on `main`.** PR #1830 (P198 view + audit + migration) and #1833 (the merge results
+ lock postmortem + backlog cleanup) both merged; all eight files verified present in
`origin/main` by content, not by `git status`. Two other branches landed in parallel: **#1831/#1832
(A4b — the corrected P138 street-number guard, with `test/a4b-guard-redraft.test.mjs`)** and a fix
for a future-dated timestamp in the ownership-lane doc.

**Housekeeping:** the A4b prompt is filed to `prompts/done/` (its audit and code shipped).
~~**`A2b-repeat-transfer-flicker` correctly stays open — it has no audit and was never run.**~~
**A2b SHIPPED later the same day and is now filed to `prompts/done/` too** — see
`docs/audits/A2b_REPEAT_CONVEYANCE_COLLAPSE_2026-08-27.md`. ⚠️ Its prompt name is a misnomer that
this arc kept repeating: **the mechanism is NOT the `gsa_lease_diff` flicker** (that one has a
return leg and is caught by `is_oscillating_pair`); it is per-lease fan-out plus cross-source lag.

**⚠️ Two canonical pages now exist for one entity graph, and they did not know about each other.**
`tier0-owner-contact-system.md` (person↔owner, P186–P198) and `ownership-history-lane.md`
(A1–A4b) **share `lcc_merge_entity`, `lcc_owner_sponsor_domain` and the owner entities themselves**
— a merge confirmed in one changes the chains in the other. Reciprocal pointers added to both, and
to `CURRENT-STATE.md` §6. That is the failure the consolidation pass exists to prevent: not a
missing doc, but two correct docs with no edge between them.

**Next prompt drafted: `prompts/N15b-canonical-name-one-normalizer-2026-08-27.md`** — the producer
behind every duplicate round we have run. Grounded fresh: of **62,363** live entities only
**46,045 (73.8%)** have `canonical_name` matching `lcc_normalize_entity_name`, **42,260** match
`lower(name)` verbatim, and **3,400 match NEITHER** — a third author, or a stale rule. The two big
buckets overlap, which is exactly why it survived: the disagreement is invisible until two writers
meet on the same name.

## 2026-08-27 16:28 UTC — P198 §5: three merges DONE; 9 more duplicates surfaced; and a lost-work postmortem

Easterly, Cambridge and Gardner merged through `lcc_merge_entity`. **Six cards became three.**
Easterly is now ONE card: **$114,864,150 / 89 assets / 7 eligible people** — the pre-merge combined
total exactly, 0 lost. Lane `ask` **87 → 84**; `auto` 9 and parked 137 unchanged; pairs 696 → 684;
live entities 62,366 → 62,363. **All three `reversible = true`** (snapshots 67 / 27 / 14 rows).
Winners by P195's **ownership-first** rule, not rent (Easterly REIT owns 79 assets vs 10).

**Both pairs already carried the SAME confirmed contact on both sides** — Alison Bernard on both
Easterly entities, Constance MacOn on both Cambridge entities. Scott had confirmed the same person
twice, once per duplicate. Nothing lost to the pivot fold, and the double-confirm is independent
evidence the duplicates were real.

**⚠️ `auto_mergeable` moved 3,041 → 3,043 and chasing it found the next thing.** Benign in itself
(each winner now heads a byte-identical group that was already auto-mergeable; the added assets
flipped two winner selections) — but it surfaced **9 MORE duplicate entities on the same three
firms, all at $0 current rent** and therefore invisible to every rent-ranked surface: Easterly 3,
Cambridge 2, **Gardner 4 — one of which alone holds 240 relationships while the asset-holding
entity holds 13 assets. That firm's deal history is split across two live entities** (the P177
failure). **Not merged — an approval of three named pairs is not extended by inference.** Backlog
**N3h**.

### ⚠️ POSTMORTEM — Cowork's own `git status` orphaned `.git/index.lock`, and clearing it discarded a turn of doc edits

The lock that blocked three of Scott's commands was **0 bytes and owned by the sandbox uid** —
`git status` is not read-only, it refreshes the index and takes the lock, and the sandbox can
neither reuse nor unlink it. `GITHUB-WORKFLOW.md` §2a previously blamed "a Windows git process";
that was wrong and is corrected, and §6 rule 4 no longer exempts `status`/`diff`.

**Worse, and now recorded: after the stale lock was removed, the next index-writing command
reconciled the working tree to HEAD and SILENTLY DISCARDED all seven uncommitted doc edits.**
`git status` went from 7 modified files to clean between two commands, `git add` staged nothing,
and `git commit` reported *"nothing to commit."* Nothing warned. The edits were reconstructed by
hand. **A long-held stale lock means the index and the working tree have diverged — treat clearing
it as a destructive operation and commit or stash BEFORE the first git command after removal.**

## 2026-08-27 15:10 UTC — P198: the tightening I recommended was measured and REFUTED

Full writeup: [`docs/audits/P198_PREFIX8_ARM_IS_LOAD_BEARING_2026-08-27.md`](../audits/P198_PREFIX8_ARM_IS_LOAD_BEARING_2026-08-27.md).
Migration `20260827230000_lcc_p198_tier0_coproposed_owner_duplicates.sql`, applied live.
**Lane unchanged by construction: ask 87 / auto 9 / parked 137 / pairs 696, before and after.**

**Last turn I recommended tightening `ev_company_matches_owner` because two `ask` cards rest on a
generic word stem (`innovati`, `corporat`). Measured: the prefix-8 arm is the ONLY link evidence
on 28 of 87 ask cards / $146.9M**, including Easterly at $85.0M, and it is the un-park mechanism
for **25 of 32 `weak_partial`** cards (P194 un-parks on `n_link_evidence > 0`, and for those 25
this arm *is* that evidence — the `no link evidence` column reads **0** for that whole band).
Tightening it would have parked ~$147M of reach to remove five wrong cards worth ~$5.6M.
**Not shipped. Closed, do not re-raise.**

**P179 Class 2, read backwards.** That rule says measure the throughput of whatever a *promotion*
would displace. The mirror: **before demoting a rule, measure what depends on it.** A rule's false
positives are visible on the surface; what it holds up is not.

Read all 44 prefix-8 rows: the top by rent is entirely correct (Easterly, Cambridge, Carnegie,
Franklin Street, Woodbranch, Westfield, the Briarcliff SPE family). **5 of 30 cards are wrong** —
a shared given name (Michael Downing ← Michael Development), place words (Westlake ← Westlake
Farms; Maple Tree ← Mapletree), generic words (Corporate Plaza, Innovation 2100 ← an *operator*).
Stated residue, each a one-second reject because P188 put the employer and match key on the card.

**Built instead: 3 owner-merge decisions.** Easterly is the #1 *and* #3 card — one firm as two
entities, both proposing Andrew Pulliam. New read-only view
`v_lcc_tier0_coproposed_owner_duplicates`. ⚠️ **The broad signal was rejected on the way**:
co-proposal alone (same person + same domain on two owners) is **95 pairs, 88 of them unrelated
names — 7% precision, worse than the domain-keyed fix P189 already rejected at 25%.** Narrowed to
a shared 8-char core opening it is 7 pairs: Easterly ✅, Gardner-Tannenbaum ✅ (spelling variant),
Cambridge ⚠️ probable, and 4 sibling-SPE pairs that must never merge (UIRC Douglas AZ / Van Horn
TX are different properties in different states). **No `auto_mergeable` column, deliberately** —
`lcc_apply_fuzzy_merges` loops on that flag.

**⚠️ Two instrument failures, both caught by implausibility.** `min(a.owner_name)` collapsed both
sides of each pair to one string, reporting **95 / 95 identical / 0 / 0** — everything in one
bucket and nothing anywhere else is a bug signal (P182); keyed properly it is 0 / 7 / 88, the
opposite conclusion. And **`lcc_name_has_spe_marker` is named backwards** — it detects a
PORTFOLIO marker and returns FALSE for every name containing the literal string "SPE".

## 2026-08-27 14:30 UTC — DOC CONSOLIDATION: twelve Tier 0 audits now have ONE door

**New canonical page: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md).**
Anything about matching a person to an owner, the Decision Center Tier 0 lane, the sponsor map, or
owner-entity merges starts there. It carries live state (measured 2026-08-27 14:26 UTC), the objects
that exist, **seven decisions already made that must not be re-litigated**, **ten traps already paid
for**, and open items split three ways — ⏳ pending a dated verification · 👤 needs Scott · 🔴 build.

**The per-round audits are unchanged and they stay** — they are the evidence, and a claim in the
canonical page is only as good as the round that measured it. All seven Tier 0 audit files
(P186/P188/P189/P194/P195/P196/P197) now open with a banner pointing at the canonical page, so a
future chat reads ~4 KB to decide which ~118 KB it actually needs.

**Why this was worth a turn.** The arc spans twelve documents and the same four mistakes were
available to make in each of them — the sorted-token core, evidence that attests the person rather
than the link, a gate that re-creates the join it filters, and dormancy measured on the wrapper. Two
of those were in fact made twice. A trap list is only a guard if it is on the path someone walks.

**Housekeeping in the same pass:** prompt 197 and its response filed to `done/`; the response folder
is empty of live items. ⚠️ The sandbox cannot delete on the mounted drive — the two originals are
removed by a `Remove-Item` line in the PowerShell, not by Cowork.

## 2026-08-27 — A3: the ownership `mismatch` lane is a REPRESENTATION question (74 chains → 12 decisions)

Full writeup: [`docs/audits/A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md`](../audits/A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md).
Migration `20260827180000_lcc_a3_ownership_mismatch_sponsor_family.sql`, applied live to LCC Opps.
**Nothing writes. No confirmation is seeded. `mismatch` is still 74 until Scott confirms.**

**Re-measured the POPULATION first.** The brief said 73; A2 landed in between and drained `agrees`
380 → 90, so the lane is **74 chains / 46 owners / $403.0M**. Split:
`sponsor_family_candidate` **32 chains / 12 owners / 12 DECISIONS** (Boyd Watterson 20:1),
`unexplained` 31 / 27 / $344.6M, `name_variant` 11 / 10. Per-class rent double-counts — three owners
span two classes, so quote the distinct $403.0M.

**The prescribed key was measured and rejected.** A bare sponsor token is not bounded — `east` names
**226** live entities, `boyd` **129** (including the surname `Boyd Alexander`) — and
`lcc_owner_sponsor_domain`'s `sponsor_token` PK cannot carry `madison` (proposed by two owner
entities) or `egp` (Easterly **and** EastGroup). The confirm registry `lcc_ownership_sponsor_family`
is therefore keyed **(sponsor entity, token)**, resolved through `lcc_entity_survivor`. This is not
the second-registry drift: the **detector** is shared — P196's guards are extracted into
`lcc_name_reads_as_street` / `lcc_name_has_spe_marker` and P196 re-issued to call them (0 of 696
Tier 0 rows changed).

**P196's SPE-marker arm drops 24 of 27 genuine rows here** (a GSA SPE is named for its city and
agency, not "Propco") — not applied, predicate not weakened. The other three guards are applied with
measured cost: street fires 3× changing **0** outcomes, brokerage 0, person costs exactly **2** real
false negatives (`City of Oakland`, `Glenn Olds` — both `lcc_looks_like_person` false positives,
named not patched).

**A contact confirm does not settle an ownership fact** (P188 restated): the 8 existing
`lcc_owner_sponsor_domain` rows resolve **0 of 74**, so inheriting buys nothing and would let a
~4-of-6 gate decide ownership. It rides the card as `also_confirmed_for_contacts`; nothing inherits.

`sponsor_spe` is a **fifth action, deliberately not `agrees`** — folding it there would hand it to
A2's write path. Positive control (self-rolling-back): with `boyd` confirmed, mismatch **74 → 54**,
sponsor_spe **0 → 20**, human_actionable **92 → 72**, and `agrees`/`no_records`/`all_guarded`
**unmoved**; rolled back with 0 residue. P180 equivalence on the split view: **0 rows differ** both
directions. `npm test` 4,684 pass / 0 fail. New guard mutation-verified RED on six mutations.

**Residue sized, surface NOT built** (31 chains / 27 owners / $344.6M). Follow-on **A3b**, named not
built: teach A2's apply path to consume `sponsor_spe`.

## 2026-08-27 13:00 UTC — P197: the Tier 0 lane read ONE employer source, by ONE key

Full writeup: [`docs/audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md`](../audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md).
Migration `20260827170000_lcc_p197_tier0_employer_resolver.sql`, applied live to LCC Opps.

**`no_employer_on_file` 67 → 54 cards** ($131.2M → $113.6M); parked 142 → 137; `ask` 82 → **87**
(+$7.6M). `auto` unchanged at 9 — **the same 9 cards**, 0 lost / 0 gained. Card universe 233 → 233,
0 in / 0 out. **Nothing was minted** — no `unified_contacts` row, no pivot write, no entity touched.

### The prompt's premise was half right, and the wrong half is the finding

P197 framed the parked pile as *"a missing hub row"* and prescribed reconciling 92 people into
`unified_contacts`. Measured, the blocking population is **73 eligible people** and only **4** lack a
hub row that exists. For the rest the employer is already on file somewhere the lane cannot read:
**20** in `lcc_sf_list_membership.company_name` (6,781 such rows — the lane has never read one),
**20** on `entities.metadata->>'company'`, **56** genuinely nowhere. So the defect is that the lane
resolves "employer on file" from ONE table by ONE key. Shipped `lcc_tier0_employer_on_file` —
one ranked resolver, `hub_email > hub_entity_id > sf_campaign > entity_capture` — instead of a
reconciler. Minting hub rows would have fixed 4 of 73.

### ⚠️ The obvious version is destructive, and it was measured on named rows before being rejected

"Copy whatever company we hold onto the card" manufactures employers. Neither non-hub source is an
employer register: over the parked population they carry **city/zip strings** (`Southbury, CT 06488`,
`Hollywood, FL 33021`), the **person's own name** (`Steve Blumer`), a P188-named junk label
(`Inco Commercial`, on two people sharing ONE mailbox) and stale firms (`Pop Local` for someone
@edwardsrealtyco.com, `The Carpet Shop` @corporaterealty1.com, `Community Trust Bk` proposed against
a **health-centre** owner). `contact_company` feeds `ev_company_matches_owner` — the only signal that
attests the LINK — so an invented employer colliding with an owner name manufactures exactly the
claim P188 established these signals cannot make. **The gate is email-domain corroboration**; the hub
tiers stay ungated because the hub IS the system of record. Probed on 8 named rows with stated
expected answers (4 resolve, 4 reject): **8 of 8 correct** — the positive control that makes the
zeros believable (P182).

### ⚠️ The 5,440 orphan count is 247 too high, and the producer is Salesforce, not the sidebar

**247 of those person entities DO have a hub row** — linked by `entity_id`, which the email-keyed
detector structurally cannot see. True count **5,193**. The producer is **live**: 542 in 30 days, 94
in 7, one the day of the audit — and it is Salesforce (`metadata->'salesforce'` on 3,994;
`external_identities` `salesforce/Contact` 4,032 vs `costar/contact` 1,767), not the hypothesised
CoStar sidebar. Duplicate risk on any future reconcile was checked rather than assumed: of 3,874
orphans carrying an SF contact id, **exactly 1** already has a hub row under it.

### The general rule was sized, not chosen

Gate populations over the 5,193, quoted before choosing: **SF campaign 1,475** (the only
discriminating gate) · correspondence **33** · has an edge 4,903 (94%) · person-shaped 5,131 (99%).
**No hub rows minted** — 1,475 rows into the surface Scott works is a decision with a blast radius,
and it would not have cleared the Tier 0 blockage anyway (a hub row with no `company_name` answers
nothing the lane asks). Filed as backlog **N14** for Scott.

### Left honestly

54 cards / $113.6M still park as `no_employer_on_file` **and that is correct** — a genuine
acquisition gap, not plumbing. Of the 13 that moved, **5 became `ask`** and **8 became
`employer_on_file_differs`** (honest rejects — progress over a non-judgement, but not a call;
reported separately). ⚠️ **Two of the 5 new `ask` cards rest on a generic word stem** —
`ev_company_matches_owner`'s shared-8-char arm fires on `innovati` (*Innovation 2100 LLC* ←
"Innovative Renal Care", a dialysis **operator**) and `corporat`. Pre-existing property of that
comparator, now exercised more often; stated rather than papered over, and the card shows the
employer, its source and the match key so a wrong one is a one-second reject.

**Proven, not asserted:** `auto` is the same 9 cards; `match_strength`/`n_eligible` changed on 0 of
233; and the view got **faster** — 793.9 ms → 553.6 ms, buffers 32,841 → 22,820, because the plan
was pushing the old hub join down to all 7,890 people and the resolver is bounded to the ~600 matched
pairs. Guard `test/tier0-employer-resolver.test.mjs` (7 tests, **all 7 mutation-verified RED**).
Suite 4,673 pass / 0 fail.


## 2026-08-27 06:00 UTC — P196: the shared merge path is REVERSIBLE (N11 ✅), and parked Tier 0 cards say why (N3e ✅)

Full writeup: [`docs/audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md`](../audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md).
Migrations `20260827150000_lcc_p196_merge_entity_reversible.sql` and
`20260827160000_lcc_p196_tier0_park_reasons.sql`, both applied live to LCC Opps.

### Unit 1 — `lcc_merge_entity` had no undo, and it is not the dormant path

`lcc_merge_entity` now snapshots the whole loser side, **folds `owner_contact_pivot` fill-blanks
before the dedup DELETE can destroy it**, calls the reconcile with `p_snapshot => true`, and writes
an action-labelled backup row before every P160 dedup/repoint. `lcc_unmerge_entity(loser)` is the
reversal; `lcc_entity_merge_log` is the ledger; `v_lcc_entity_merge_reversibility` is the instrument.

**Three corrections to N11 as filed, each of which changes what the fix had to be:**

1. **⚠️ "DORMANT, NOT ARMED" DESCRIBES THE LOOP, NOT THE FUNCTION.** N11's measurement was right that
   nothing calls `lcc_apply_fuzzy_merges` (re-confirmed: 0 cron rows, 0 repo callers). But
   `lcc_merge_entity` itself has **nine human-verdict call sites in `api/`** and the entity table
   says they fire — **285 merges in the last 30 days, 176 in the last 7.** The irreversible pivot
   delete has been running all along. Reading the loop's disposition as the function's is how a live
   path gets filed as latent.
2. **⚠️ "UNCORRELATED EXISTS" IS NOT THE BUG.** `owner_contact_pivot` and `lcc_property_owner` are
   both PRIMARY KEY `(entity_id)`, so at most one row exists per entity and the un-correlated
   `EXISTS` is *equivalent* to a correlated one. Correlating it changes nothing. The bug is that the
   statement **DELETES content instead of FOLDING it**, with no ledger. Worth stating because
   "correlate the EXISTS" is a one-line change that would have looked like the fix.
3. **⚠️ `p_snapshot => true` ALONE WOULD HAVE LEFT THE WORST PATH UNTOUCHED.** The reconcile covers
   portfolio facts, identities, relationships, watchers and cadence. The four backrefs the **P160
   block inside `lcc_merge_entity`** handles — `lcc_property_owner`, `lcc_property_owner_evidence`,
   `owner_contact_pivot`, `bd_opportunities` — live in the caller, and **neither function
   snapshotted them in any mode.** The prescribed one-line fix would have made four tables
   recoverable and left the pivot exactly as it was.

**⚠️ AND THE ROUND TRIP CAUGHT A BUG REVIEW DID NOT — which is the whole reason the prompt demanded
one.** The first cut restored `entity_relationships` / `external_identities` / `watchers` with
`INSERT … ON CONFLICT (id) DO UPDATE`. Both tables carry a **BEFORE INSERT** survivor-resolving
trigger (P177/P178), and **P177's SKIPS a row that duplicates an edge the resolved entity already
holds** — it returns NULL, so the row never reaches `ON CONFLICT` and the `DO UPDATE` never runs.
Live on `Monaco Holdings`, three **byte-identical** `(loser → 4f1b724a, 'purchases')` edges: edge 1
restored, edges 2 and 3 were then duplicates of it, were silently skipped, and stayed on the
**winner** — while the unmerge returned `restored`. Fixed by repointing surviving rows with `UPDATE`
(both triggers are INSERT-only) and INSERTing only what was deleted, plus a
`restored_with_residue:relationships_not_restored=N` count so a partial restore can never read clean.

**Verified live before calling it done:** real merge → unmerge on `Monaco Holdings` → `Monaco
Holdings LLC` (an `auto_mergeable` byte-name duplicate; the merge dedup-DELETED a portfolio fact and
the loser's pivot and repointed 3 relationships, 1 identity, 1 property-owner edge). Full-row diff
over ten tables for both entities: **16 rows before, 16 after, 0 lost, 0 new**, `auto_mergeable`
**3,053 → 3,053**. The FOLD path — which Monaco could not exercise, both its pivots being blank — was
proven by a self-rolling-back gate: the loser's *"Alex Bias Test"* lands on the blank winner with
`active_source` **still `tier0_confirm`** (carried VERBATIM, never restamped — P194) and
`pivot_history[0].source='entity_merge_fold'`, then unwinds cleanly. 0 residue.

**Stated honestly:** `v_lcc_entity_merge_reversibility` reports **2,411 existing tombstones,
`reversible = false` for every one.** Those merges have no snapshot and never will.

**Not done, deliberately:** nothing wires up `lcc_apply_fuzzy_merges`. Reversibility lowers the cost
of being wrong; it does not make P195 §1's grading unnecessary. That is a decision, not a consequence.

**A2a is unblocked** — merge the 45 ambiguous parties and cron 244 applies the chains the same night.

### Unit 2 — the parked cards now say why, and the sponsor-shaped ones have a route

| park_reason | cards | owners | rent |
|---|---:|---:|---:|
| `employer_on_file_differs` | 76 | 67 | $96.3M |
| `no_employer_on_file` | 68 | 56 | $132.3M |
| `employer_not_comparable` | 2 | 2 | $1.9M |
| **parked, total** | **146** | **105** | **$180.3M** |

N3e's "$98M / 75 owners" is the **`differs` slice specifically**, not the whole pile. Those cards are
parked because the employer on file is not this owner — the gate working. `employer_not_comparable`
is kept separate on purpose: the comparator has a 6-char floor on both sides, so for those 2 it could
not run at all, and "could not run" is a different fact from "ran and disagreed" (the P181 shape).

**⚠️ ONE OF THE TWO PRESCRIBED FIXES WAS IMPLEMENTED, MEASURED AND REJECTED.** Normalising the company
string (strip `www`/`com`/punctuation) unparks **0 of 146 cards**, and the motivating row does not
survive its own fix: `Savlan Cc Property LLC` → `savlanccproperty` vs `savlancapital` fails
containment and then fails the 8-char prefix arm on `savlancc` vs `savlanca`. **The mismatch is at
character 8, not in the www/com noise.** The comparator is unchanged; Savlan is a sponsor-shaped park
and is routed as one.

**⚠️ AND THE NAIVE SPONSOR DETECTOR IS A NOISE GENERATOR AT ~25% PRECISION** — the same number P189
measured and rejected for domain-keyed merge grouping. Leading-brand-token equality alone returns 19
pairs dominated by **shared given names** (`George Kurz` ← *George's Inc*, which is P188's Gary
George trap in a new dress; two `JAMES` trusts ← a shared CPA at `jameshowardcpa.com`) and **place
words** (`MAPLE HILL` ← *Mapletree Investments*, a Singapore REIT; `Steel Station Rd` ← *Steel
Equities*). Three guards — the owner must carry an SPE/portfolio marker, must not read as a street,
must not be person-shaped — take it to **4 of 6, and the 4 are the top 4 by rent** (Gardner $8.0M,
Salus $5.3M, Oxford $2.5M, Savlan $2.0M; the 2 false ones sit at $1.26M and $0.84M). The view is
value-ranked for exactly that reason.

**⚠️ The un-park was NOT widened.** ask 77 / auto 9 / parked 146, before and after. Admitting person
evidence restores the Gary George noise P192 removed, and the guard goes RED if `n_person_evidence`
ever appears in that CASE.

**Operator surface:** `GET /api/tier0-auto-attach-tick` (already the ungated dry-run grade) now also
returns `parked.by_reason`, ten value-ranked examples with both compared strings, and
`sponsor_map_proposals` with the confirm SQL. Confirming is the existing curated
`insert into lcc_owner_sponsor_domain(...)` — one decision covering an SPE family. Nothing in Unit 2
writes.

**Verify by owners moved out of parked, never cards touched:** 105 parked owners / $180.3M today, of
which 4 confirmable sponsor proposals cover 4 owners / $17.7M.

## 2026-08-27 11:55 UTC — ⭐ 49% of person entities are not in the contacts hub; 92 block $132.3M

**The parked pile splits exactly, and the split is the finding.** Of 189 candidate people behind the
142 parked Tier 0 cards:

| | people | meaning |
|---|---|---|
| have a `unified_contacts` row | **97 — and all 97 carry an employer** | the `employer_on_file_differs` parks. **The gate working.** |
| **no hub row at all** | **92** | no employer, no title, no SF, no Outlook — **not a judgement, a missing row** |

So `no_employer_on_file` (**68 cards / $132.3M**) was never a decision anyone declined to make. The
data to make it is absent.

**Fleet-wide: `entities` (person, live, with an email) = 11,107; reconciled to `unified_contacts` =
5,667; ORPHANED = 5,440 (49%).** `unified_contacts` is what carries `company_name`, `title`,
`sf_contact_id`, `outlook_contact_id` — an orphan has none of them.

**⚠️ 49% orphaned is very likely CORRECT and must not be read as a defect count.** `entities` is the
graph (everyone ever seen — CoStar brokers, deed grantees, OM-extracted names); `unified_contacts`
is the hub (people we actually track). Playbook Class 9's corollary applies exactly: the detector
produces CANDIDATES. **A bulk reconcile would pour thousands of untracked broker records into the
surface Scott works** — the Consumption-Layer failure this codebase documents repeatedly.

**The actionable population is 92, not 5,440** — the ones already proposed as contacts for a named
owner above the rent floor. Each either resolves its card or converts it to an honest
`employer_on_file_differs` reject. **Prompt 197** specifies it, and insists the *cause* be diagnosed
first: if a live producer is still minting orphans, a one-shot reconcile is a chore repeated forever
(Class 8). Check `created_at` on the orphans.

### ⚠️ N9v is STILL UNVERIFIED — and the reason is timing, not failure
`TIER0_AUTO_ATTACH=true` is set and the redeploy is live. But **cron 241 last ran 06:55 UTC, which
was BEFORE the redeploy**, and that run is the one that reported `flag_off`. `active_source=
'tier0_auto'` is still 0 because **the tick has not run since**. The next run is **06:55 UTC
tomorrow** and is the first honest test — expect 0 → 9. *(A `GET` of the tick would settle it
immediately; `web_fetch` returned nothing usable from here, so this is unverifiable from Cowork.)*
**Do not diagnose before that run.** `feature_flags_registry` stays `off` until a tick reports
`writes > 0` — it describes the runtime, not the intent.


## 2026-08-27 11:45 UTC — four sponsor entries confirmed by Scott; 6 cards unparked, $19.8M

Scott confirmed the top four of P196 Unit 2's six sponsor proposals and rejected the bottom two.
`lcc_owner_sponsor_domain` **4 → 8 rows**.

| sponsor → domain | rent | corroborating employer on file |
|---|---|---|
| `gardner` → gardnercompanies.com | $7.99M | Douglas Gardner — **"Gardner Companies"** |
| `salus` → salusgroup.us | $5.28M | James Jacobson — "Salus Healthcare Real Estate Group LLC" |
| `oxford` → oxforddevelopment.com | $2.46M | Stephen Nicotra — "Oxford Development Company" |
| `savlan` → savlancapital.com | $1.99M | Zusha Tenenbaum — "WWW Savlancapital COM" *(the junk string that defeated the comparator)* |

**Rejected:** `royal` → royalamerican.com ($1.26M) and `maple` → maplestmanagement.com ($0.84M) —
a common word and a place-word collision (the Mapletree trap P196 measured at ~25% precision).

**⚠️ Blast radius measured BEFORE writing, because a sponsor token matches fleet-wide.** Each token
was checked against every owner in scope: `oxford` and `salus` match exactly 1 owner; `gardner` and
`savlan` match 2 — and in both cases the second is **the same firm** (`Gardner-Tannenbaum`, a
spelling-variant duplicate entity; `Savlan Capital`, the sponsor itself). No collateral.

**Effect — assert on the state delta, not the row count:** `parked` **146 → 142**, `ask`
**77 → 82** (6 cards moved, 2 of them the bonus same-firm owners), lane rent askable now **$254.9M**.

**⚠️ A correction to my own earlier reading, caught before writing.** In the P187 bench I recorded
*"Gardner Tanenbaum Holdings → Douglas Gardner @gardnercompanies.com — Achen-Gardner Construction"*
and marked it a probable false positive. Reading the authoritative row: his employer on file is
**"Gardner Companies"**, not Achen-Gardner. I had conflated two different rows. **A dated note in
my own write-up is a hypothesis to re-check, exactly like a dated blocker.**

**⚠️ Flagged on the Oxford card, and it is not a reason to reject the mapping:** the only candidate
at `oxforddevelopment.com` is Stephen Nicotra, title **"Summer Internship"**. The domain↔sponsor
link is sound; the *person* is not a pursuit target. This is the doctrine working as designed —
"do the people at this domain work for this owner" and "who do we call" are two decisions, and only
the first is answered by the map.


## 2026-08-27 11:35 UTC — ⚠️ N9v FAILED, diagnosed; P196 corrected three of my own claims

### ⚠️ THE AUTO-ATTACH FLAG IS SET IN RAILWAY AND **OFF AT THE RUNTIME**
The dated check came due and failed. Cron 241 fired **06:55:00 UTC**, `cron.job_run_details` says
**`succeeded`** — and that only means `lcc_cron_post` dispatched the HTTP request. Reading the
handler's own response instead:

```json
{"ok":true,"skipped":"flag_off","flag":"TIER0_AUTO_ATTACH","writes":0,"would_attach":9}
```

**HTTP 200, and the process does not see the variable.** Scott set `TIER0_AUTO_ATTACH=true` in the
Railway `tranquil-delight` env, but the *running* build was never redeployed after the change (or
the variable landed on a different service/environment). **A flag set is not a flag read.**

**The handler behaved correctly** — it named `skipped: flag_off` rather than silently writing
nothing, which is the whole reason this was diagnosable in one query instead of a hunt.

**⚠️ And I had made `feature_flags_registry` lie.** I flipped it to `on` when Scott set the
variable — recording the *intent*. The registry drives the daily brief's Dormant Capabilities
section, so it must describe the **runtime**. Reset to `off` with the evidence in `notes`.
**Flip it back only after a redeploy AND a tick reporting `writes > 0`.**

**Operator fix:** redeploy the `tranquil-delight` service, then re-run
`GET /api/tier0-auto-attach-tick` and confirm it no longer says `flag_off`.

### P196 shipped (#1809) — and corrected three things I had written

**Unit 1 — `lcc_merge_entity` is now reversible.** `lcc_unmerge_entity(loser)`,
`lcc_entity_merge_log` as ledger, `v_lcc_entity_merge_reversibility` as instrument.

1. **⚠️ "Dormant, not armed" described the LOOP, not the FUNCTION — and I measured the wrong
   thing.** I checked callers of `lcc_apply_fuzzy_merges` (still 0, correct) and concluded the
   irreversible path was not firing. **`lcc_merge_entity` has NINE human-verdict call sites, and
   285 entities were merged in 30 days — 176 in 7.** The irreversible pivot delete had been running
   all along. *Count the callers of the FUNCTION, not of the one wrapper you were told about.*
2. **"The uncorrelated `EXISTS` is the bug" was wrong.** Both tables are PK `(entity_id)`, so the
   predicate is already equivalent to a correlated one. The bug is that it **DELETES instead of
   FOLDING**, with no ledger. *Correlating it would have looked like a fix and moved nothing.*
3. **`p_snapshot => true` alone would have left the worst path untouched** — the four P160 backrefs
   live in `lcc_merge_entity`, not in the reconcile, and neither snapshotted them in any mode.

**The round trip caught a bug review did not** — exactly what the prompt insisted on. P177's
`BEFORE INSERT` trigger skips a duplicate edge, so `ON CONFLICT DO UPDATE` never fires: restoring
three byte-identical Monaco Holdings edges brought back **one**, left two on the winner, and the
unmerge still reported `restored`. Verified live: full-row diff over ten tables, 16 rows before and
after, 0 lost. **Honest limit: 2,411 pre-P196 tombstones read `reversible = false` and always will.**

**Unit 2 — parked cards now say why.** **146 parked / 105 owners / $180.3M** —
`employer_on_file_differs` 76 / $96.3M (the slice my "$98M" actually meant — the gate working),
`no_employer_on_file` 68 / $132.3M, `employer_not_comparable` 2. Decidability unchanged
(ask 77 / auto 9 / parked 146). **Both fixes I prescribed were measured rather than assumed, and
one was rejected:** company-string normalisation unparks **0 of 146** (Savlan fails at character 8,
`savlancc` vs `savlanca`, not on the `www`/`com` noise), and a naive sponsor detector reads **~25%
precision — the same figure P189 rejected**, with false positives on shared given names
(George Kurz ← George's Inc) and place words (MAPLE HILL ← Mapletree). Three guards take it to
**4 of 6, and the 4 are the top 4 by rent**, so the view is value-ranked and human-confirm-only.


## 2026-08-27 05:00 UTC — repo fully synced; CI skip path PROVEN; two git traps recorded

**State verified:** local `main` == `origin/main` (0 ahead / 0 behind), **zero conflict markers
anywhere in the repo** (the `claude/conflict-marker-guard-sxcpoy` branch merged as #1803 and
repaired `panel-redesign-verification.md`), A0 and A2 correctly filed in `prompts/done/`, and the
live prompt queue is exactly **196**. The only working-tree noise is the long-standing
`test/fixtures/healthcare-discovery/*.csv` modifications, which pre-date this arc.

**✅ The docs-only CI skip is proven.** It executed on the `fix/status-conflict-markers` PR and
reported green in seconds. Worth logging as its own event: §6 rule 3 says a CI job is not shipped
until green once on `main`, and **the skip branch of a conditional job is a second code path
needing its own first green run** — the PR that introduced it touched `.github/workflows/`, so it
ran the full suite and proved nothing about the skip.
⚠️ The docs-only path deliberately still runs `test/no-conflict-markers.test.mjs`: both marker
instances were `docs/*.md`, and the `STATUS.md` one **arrived through a documentation-only PR**.

### ⚠️ Two git traps, both caused by Cowork instructions, both now in `GITHUB-WORKFLOW.md`

**§2a — while `.git/index.lock` is held, sandbox `git status` is not trustworthy.** Cowork read the
tree as "two modified, two untracked" and drafted a recovery on it. There was an **unresolved merge
in progress** (`STATUS.md` was `UU`) that never appeared, because git cannot refresh the index
while the lock exists and answers from stale state. Every subsequent command assumed a clean tree:
`checkout -b` refused, the cherry-pick refused, and a later `git add -A` re-staged the very markers
§2b exists to prevent. **Same class as everything else in this file — a surface that answers
confidently instead of erroring.** Compounding it, the Cowork call piped `git status` through
`grep -v test/fixtures`, which would have hidden a `UU` line anyway: **filter what you show, never
what you judge from.**

**Resolution was the right one:** `git reset --hard origin/main`. It moves the branch pointer and
**does not delete commits** — the discarded work stayed reachable by sha. Two documentation notes
were rewritten from scratch rather than recovered, which is the cheaper trade against another
conflict resolution on the repo's hottest file.

**Dated checks at 04:32 UTC — both still pending, both still expected:** N9v auto-attach `0` writes
(cron 241 fires **06:55 UTC**); N9w sidebar `0.0%` stamped, last row **2026-08-26 22:49 UTC**, still
pre-reload.


> **📦 ARCHIVE (2026-09-02, second cut):** the contiguous block that sat here — the 2026-08-26/27 Cowork
> entries (Tier 0 P186–P198, A1–A5c, C1, B1), two 2026-08-28 Cowork entries, and the P121–P130 /
> draft-assist entries (2026-08-20 → 08-26) — was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-20_to_2026-08-28_cowork-block.md`](../history/STATUS_claude-code_2026-08-20_to_2026-08-28_cowork-block.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.

> **📦 ARCHIVE:** entries for **2026-08-20 → 2026-08-21** were moved verbatim to
> [`docs/history/STATUS_claude-code_2026-08-20_to_2026-08-21.md`](../history/STATUS_claude-code_2026-08-20_to_2026-08-21.md)
> on 2026-09-02. Nothing was dropped; every still-open item was already carried into
> `PLANNED-BACKLOG.md`.
