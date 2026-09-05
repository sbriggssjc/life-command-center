# Data-process & automation audit — window handoff

> **This is the kickoff document for a fresh chat continuing the Cowork "data-process & automation
> audit" window.** It replaces reading the whole of `STATUS.md`.
>
> **Written 2026-09-02.** Re-measure anything dated before you act on it — that doctrine has bitten
> this file's predecessors repeatedly.

---

## 1. Which window you are

Two audit windows run in parallel against this repo and they must not collide:

| window | prompts | owns |
|---|---|---|
| **this one — data-process & automation** | **lettered** (`A*`, `B*`, `C1`, `D*`, `PR*`, `DE*`, `BR*`) | ingestion, producers, CI enforcement, data coherence, source lanes |
| app audit (Scott's desktop) | **numeric** (`189`, `194`…) and `C4`–`C13`, `DOC*`, `N*` | the LCC app surfaces, Tier 0, prospecting brief, OCR |

⚠️ **Prompts in `docs/claude-code/prompts/` starting `C6/C8/C10/C11/C13/DOC*/OCR*` belong to the
OTHER window. Do not action them.** This window's queued prompts are the lettered ones; check
`prompts/` for what is currently drafted (the `done/` folder holds everything already run).

## 2. The through-line of everything below

**Every producer failure found in this arc reported success.** Not one errored, not one alerted.
CMS was dead 67 days, FRED had never once written a row, `public_record_ingest` failed ~1,950×/day,
and the Dialysis test suite had never executed a test in the repo's history — all green throughout.

> **Assert on the STATE DELTA — rows written, queue drained, population changed — never on a
> worker's own tally, its exit status, a green cron, or a green badge.**

## 3. Where things stand

### ✅ Closed this arc

- **CMS ingestion** repaired (67-day outage; throttle keyed on last *attempt* not last *success*).
- **FRED** proven alive — `max(observation_date)` 2026-08-28, first rows ever written from CI.
- **The Dialysis suite RUNS**: `0 executed → 3,132`, `55 fail → 5`, `executed` up at every step.
  `timeout-minutes` on all four jobs, sized from a measured 6 m 12 s.
- **PR1a/PR1b** — the model-leg sentinel purged: dia `assessed_value` 8,700 zeros → **0** (262 real
  values preserved), `tax_amount` 9,025 → **0**, `tax_delinquent` `false` on 11,802 → **NULL**.
- **DE1** — both CM econ exhibits gated on `payer_mix_source`. **Both moved**; the operator exhibit
  was live-wrong, understating Satellite's revenue/clinic by **41%**.
- **BR2** — broker FK backfill **with its producer fix in the same change**: `listing_broker_id`
  181 → **1,027**, `id_set_name_null` held at **0**.
- **A1→B1a** ownership-chain arc: `establish_ownership_history` 0 completions in 69 days → **1,302**;
  gov `ownership_history` 16,177 → **18,953**.

- **B6e-ci-last5 / B6e-ci-unmask (2026-09-02, Dialysis PR #7393)** — the pytest `|| echo` is gone
  and the step is green once on `main`: **3,147 collected / 3,139 passed / 0 failed**, read from
  the job log. `baseline39` closed by supersession (`main` at `ff712e0` measured **3**, never 39).
  ⚠️ **Not yet a merge gate — see 🔄 below.**

- **The provenance ladder arc (2026-09-02, PR8 → PR5/PR7 → PR12 → PR5c → PR5c-entities)** — all
  closed, all live-verified, all on one canonical page: **`docs/architecture/field-provenance-ladder.md`**
  (§3 dated live state, §4 arc index, §5 the lessons verbatim). Headlines only: the registry is the
  allowlist (PR8); 39 never-written sources triaged, 25 not defects, 7 live on a second ledger (PR5);
  the `::bytea` hash silently lost every quoted/newlined value, fixed with no rewrite, exposure ~1,101
  not 67 (PR12); 33 zero-row internal rungs were five callers sending an invalid `target_database`
  — `lcc_merge_field` always inserts, so zero rows = the call never completed (PR5c); the two
  `entities` contact writers now consult the ladder — recording only, every rung is `record_only`
  (PR5c-entities).
- **Entity identity (2026-09-02/03, PR5c-entities-b-dupes + -c)** — `entities.domain` was scoping the
  canonical_name identity tier (9 of 11 duplicates, fixed `d5b0ac8`); the email tier keeps the filter on
  purpose (27% precision without it). Canonical page: **`docs/architecture/entity-identity-and-dedup.md`**.
- **CONTACT1 (2026-09-03)** — both `entities` ladders are empty because the wiring landed on dead code;
  PR10 answered, PR5c-enforce given a numeric unblock condition, `CONTACT1a` filed for the scope call.
- 📍 **The CoStar capture producer now has ONE canonical page —
  `docs/architecture/costar-sidebar-capture-pipeline.md`** (PR2 · SALE1 · SALE1a · ADDR1 · ADDR1a in
  one arc table, the guards, the live state, and the transferable lessons). Read it before touching
  `extension/content/costar.js` or `sidebar-pipeline.js`.
- **SEC1-property (2026-09-05)** — all four property merge/unmerge functions locked to `service_role`
  on both domains, migrations committed; the break-risk disproved by a sibling already living under
  the constraint. SEC1 re-measured + bucketed (89/13/9), nothing else revoked.
- **ADDR1b-merge (2026-09-04)** — gov can now merge a property reversibly (FK walk at call time,
  round trip fingerprint-verified, destructive name raises). ⚠️ The rename left the mutator
  anon-executable; closed in Cowork. Residuals: SEC1-property (✅ shipped 2026-09-05), GOVDUP1.
- **CONTACT1a (2026-09-04)** — the `entities` contact ladder is wired at `ensureEntityLink`'s CREATE
  choke point and deployed; 0 rows so far is *quiet*, not *unreachable* (the 2 creates today predate
  the code). Residual: UPDATE path → CONTACT1b.
- **SALE1c / ADDR1b (2026-09-04)** — 7 of 8 "undecidable" rows resolved by splitting the ledger on
  `event_type`; the 902/903 index collision never existed (the index covers LIVE rows); gov quarantined
  because it cannot merge safely.
- **ADDR1a (2026-09-04)** — dia address-bleed review view at **0**; the bare-`Buyer` worry refuted by
  the code path (regex correctly NOT widened); the real closure is the role-agnostic server-side belt.
- **SALE1a/SALE1b (2026-09-04)** — 29 propagated prices NULLED (none reset: zero deed corroboration);
  `ledger_disagreement` 129 → 100; gov measured and **NOT clean** (127 rows). Follow-ups SALE1c / SALE1c-gov.
- **SALE1 + ADDR1 (2026-09-03)** — two defects in the SAME producer (`sidebar-pipeline.js` /
  the CoStar scanner), both shipped and verified: a re-match PATCH silently overwrote a non-null
  `sold_price` with a later capture's figure (Hillsboro's 2009 deed moved from $1,233,000 to the
  current LISTING price), and dia stamped `sale_notes_raw` on every sale where gov already gated it
  to `isMostRecentSale`; and the Contacts tab's broker-office address won the property street because
  `FOREIGN_PARTY_HEADER_RE` lacked four section headers. **Follow-ups: SALE1a (read the 45, not the
  132), SALE1b (gov unmeasured), ADDR1a (2 open rows from a DIFFERENT capture surface).**
- **PR2** — the sidebar writer dropped the parcel stats it was handed; the lot parser read acres as
  sq ft (43,560×). dia backfilled (767/734/714/232); gov writer fixed, backfill Scott's call.

### 🔄 In flight

**Nothing is with CC.** The Dialysis gate prep is DONE (#7395 + #7397): `paths-ignore` gone, Scope
job, `Run Tests` always reports, **seen RED** (run 33647155312), docs-only path **proven**
(#7397, 5 s), `exit code 128` **gone** from a checkout log. 👤 **Three operator steps close the B6
CI arc:** merge #7397 → delete `claude/tmp-red-gate-proof` + `claude/tmp-docs-only-proof` in the UI
→ require `Run Tests` on `main`. ⚠️ Ruff stays masked, correctly — **5,738 findings, not the "11"
the first handoff said** (GitHub's ten-annotation cap; A5's `815 = 1000 − 185` again).
**PR5c (2026-09-02) CLOSED — and it corrects PR12 §4 and PR5 §1a in place.** The cause was one
CHECK: `field_provenance_target_database_check` accepts only `lcc_opps`/`dia_db`/`gov_db`, and
**five call sites sent `'dia'`/`'gov'`/`'lcc'`/`'lcc_db'` → 23514 on 100% of calls** into a bare
`catch`. **`lcc_merge_field` ALWAYS inserts a row** (write/skip/conflict), so zero rows means the
RPC never completed — replayed rolled-back, 6 of 6 PR5 §2 sources fail, 5 with 23514; the sixth
(`lcc_generated`) succeeds and its lane just has not run. ⚠️ **PR12 §4's "~0.03% break-class"
measured the stored COLUMN, not the payload** — three sites `JSON.stringify` a jsonb param, so
their rate was ~100%. All 33 rungs carry a `pr5c_verdict`; nothing retired; rung fingerprint
unchanged. ✅ **Merged #2060 (`06a3ee5`) and DEPLOYED 20:38 UTC** (`/version` = `06a3ee5de325`).
🚧 **Verify-next (Class 8) is STILL OPEN and its zero is a NO-POPULATION zero:** at 20:59 the six
tables read 0 with **0 CRE registrations since the deploy**. The CRE folder feed is **human-driven,
7 active days in 30, last one 2026-08-27** — week-long gaps are normal, so do not poll it and do
not read the 0 as a failure. Any row on `public.lcc_cre_property_documents` is the proof.
⚠️ `entity_relationships` stays 0 regardless (`unreached_and_broken`). ⚠️ **`availability-checker` is a THIRD deploy surface,
fixed in source and NOT deployed** (PR5c-deploy).
**PR12 (2026-09-02, #2057) closed** — hash fixed in place (no rewrite), 1,979 live rows since incl. 8
break-class, all hashing. **Exposure was ~1,101, not 67** — the newline in `sales_transactions`
narrative on NON-rung columns; the ladder-scoped census could not see it. JS failure signal
(`provenance_failed` + alert) ships on the Railway redeploy. PR12b filed (flush watermark skips an
errored event permanently).
**PR5d (2026-09-03) CLOSED** — the CoStar CMBS arm is (c): scanner, writer and URL match all live;
the page has never been captured (`costar_loan_id` 0 of 2,219 both domains). 121 rungs verdicted
94 `page_never_captured` / 27 `page_never_captured_flag_off` (dia's `track_cmbs_snapshots` false on
11,803 of 11,803 — a SECOND blocker). Supersedes R54 Unit 3's mechanism; reconciles UX-T1a's
"no LCC table" claim (superseded by UX-T1a-gates — the residual debt gap is DISTRESS, not maturity).
Not retired: R54's `is_distressed` arm is starved (0 of 178) and only this arm feeds it → 👤 PR5d-a/b.
**PR2-gov backfill RUN 2026-09-03 server-side** — 1,230 rows, 0 unit errors, reversible by batch tag.
**PR5 (2026-09-02, #2051) closed with PR7** — 426 verdicts + 49 orphan markers live on
`v_field_source_priority_triage`; no deploy gap (no `api/` change). **`never_written` stays 39 BY
DESIGN** (rungs are soft-retired in `notes`, never deleted — "unregistered" is a different
`lcc_merge_field` branch). Seven of the 39 are live on the property-owner ledger. PR9 → Scott.
**PR2 verify-next (Class 8):** the dia backfill is proven (767/734/714/232 reproduce live); the
PRODUCER is not — 0 `costar_sidebar` parcel rows since the merge and the Railway redeploy of
`98248e18` is ✅ **CONFIRMED deployed** (2026-09-02 20:38 UTC, `/version` = `06a3ee5de325`, which
carries it) — so the remaining PR2 gap is the PRODUCER, not the deploy. Assert on a **new**
sidebar parcel row carrying `building_sf`, never on
today's totals. gov backfill (1,527 rows) is Scott's call → `OPERATOR-ACTIONS.md` §3 **PR2-gov**.
**PR8 verify-next:** `field_provenance where source='agency_classifier'` reads 0 and it is a
no-population zero (0 unflushed gov events, last one pre-migration) — it flips on the next gov write
that fires `gov_classify_agency()`; do not read it as broken.
**Nothing is with CC.** What is open is DEPLOY + PRODUCER proof, not code:

| verify-next | the honest reading today | what proves it |
|---|---|---|
| ~~Railway redeploy~~ | ✅ **CONFIRMED 22:08 UTC — live `/version` = `886cdf86` = `main` HEAD.** Read via `net.http_get('https://tranquil-delight-production-633f.up.railway.app/version')` from LCC Opps, then `net._http_response` ~15 s later (the sandbox has no Railway egress; the bare host without `-633f` 404s). | done |
| PR5c-entities-b (SF bridge CREATE path) | `source='salesforce'` on `entities` = 0 — **0 SF-Contact mints since 2026-09-02** (the lane is quiet, not broken) | first mint → rows; ~12/day when the lane runs |
| PR5c-entities-b-dupes rate | baseline 3.37% (11/326); **not yet measurable post-fix** — 0 mints since `d5b0ac8` | the §6 query in `PR5c_entities_c_…md` over the next 30 days; expect ~0.6% (races) |
| PR2 producer | 0 `costar_sidebar` parcel rows since 2026-08-31 — nobody has captured a dia page since; the code is live | 👤 one sidebar capture on a dia property page → a NEW parcel row carrying `building_sf` |
| PR5c callers | `field_provenance` on the six internal tables = 0, correctly | a row on `public.lcc_cre_property_documents` after the next CRE folder-feed registration, post-deploy |
| ~~PR5c-entities~~ | ✅ **TICKED 2026-09-03 (Cowork): `field_provenance` on `entities` 0 → 4** (`domain_owner_contact`, batch `ocp_20260903`; tick also filled 4 org phones + queued 31 reviews) | done |
| PR8 | `source='agency_classifier'` = 0 — no-population zero | the next gov write that fires `gov_classify_agency()` |
| ~~PR5c-deploy~~ | ✅ **DEPLOYED 2026-09-03 (Cowork): v21, health green, live 3-listing run clean** | done |
| Dialysis CI gate | prep DONE (#7395 + #7397: `paths-ignore` gone, Scope job, seen RED, docs-only proven) | 👤 three operator steps: merge #7397 → delete the two `claude/tmp-*` branches → require `Run Tests`. ⚠️ Ruff stays masked, correctly — **5,738** findings, not "11" (annotation cap). |

### 🔴 Next, in recommended order

1. **`BR1`** — repair the firm registry **before** anything matches against it. `broker_companies`
   is 131 rows of which **73 (56%) contain a `;`**, 28 are single-token abbreviations, 9 read as
   person names, 7 are the Colliers family. **`cbre; smyth & colliers; patel` is minted as one
   company.** Start with **`BR1-confirm`** — 12 brokerage-evidenced orgs ready for a one-decision
   human confirm.
2. ~~**`PR5c-entities-c-junk80`** / **`PR5c-entities-c-p195-unmerge`**~~ — ✅ **BOTH CLOSED
   2026-09-03 (ENTC).** The 80 are censused (`v_lcc_entities_c_junk80`) and are **not one class**:
   41 sweep candidates, 39 holds — including **6 rows that ARE their own mailbox's person**, which
   a blanket sweep would have de-emailed. The producer is gated (the ENTITY mint had a weaker
   guard than the `contacts` write beside it; 47.5% reach, 0 false positives). `lcc_p195_unmerge`
   is **FIXED, not retired** — 66 open merges have no P196 ledger row, so retiring it would have
   made them irreversible. 👤 **`junk80-apply` is Scott's** (seed the review lane; dry run first).
   Residue: `junk80-gate-p131` (the JS gate needs the P131 row-label vocabulary without a second
   regex copy), `p195-unmerge-callers` (`test/p195-merge-gate.test.mjs` slices a superseded body).
   Record: `docs/audits/ENTC_JUNK80_AND_P195_UNMERGE_2026-09-03.md`.
   ⚠️ **`SEC1` moved a step**: all three definer *unmerge* functions are now `service_role` only;
   the other 88 anon-executable definer functions are untouched.
3. ✅ **`GOVDUP1` SHIPPED 2026-09-05** (LCC #2127, gov #397) — lane live at **397 groups / 797
   properties**, 154 husks archived reversibly, **0 merges**. Canonical page:
   `docs/architecture/gov-property-duplicates.md`. **Two conclusions were corrected by verification
   and both make the picture worse**, so the follow-ups are ordered by that:
   - 🚨 **`MERGE1` FIRST** (was `GOVDUP1-b`, widened). gov: `gov_merge_property_apply`'s generic
     `WHEN unique_violation` arm **DELETEs** while the wrapper snapshots child *ids*, and
     `investment_scores` is UNIQUE on `property_id` **alone** — so **397 of 397 lane groups
     collide**, ~1,321 rows, **no pair round-trips cleanly**. 🚨 **The same class is LIVE on dia and
     has already run: 585 merges, 206 collisions, 205 on a CASCADE table, and the human-verdict
     `dc_twin_verdict` lane collides on 78%.** ⚠️ The two domains lose the row by different routes
     (gov `DELETE`s; dia records `*_error` and `ON DELETE CASCADE` kills it), so a grep for one finds
     nothing on the other. **dia first — it is live.** Fix = FOLD per table with a stated
     re-derivable / substantive / queue policy. **P196 one layer down**, in a handler generic over
     every child table. Prompt written.
   - 🚨 **`GOVDUP1-a`** — the husk producer IS identified: a **Salesforce auto-create path that does
     not dedupe on `sf_property_id`** (`pending_updates.field_name='_new_property'`). **808 gov
     properties from 125 SF properties, 8 still live, newest 2026-08-25**, already cleaned once in
     June and recurred. ⚠️ A `data_source`-keyed hunt cannot find it — it wears both
     `costar_sidebar` and `unknown_writer`.
   - Then `GOVDUP1-c` (154 orphaned `pending_updates`), `-d` (`verdict_hint` is a synonym for
     `address_match`), `-e` (94 live `.0` zips), `-guard` (3 mutations, not 9).

   Then **`SEC1-wider`** — 63 mutating-like
   anon-executable definer functions on LCC Opps need itemizing before anything is revoked, and
   `compute_feed_freshness` is deliberately anon on both domains.
4. **`CONTACT1b`** — CONTACT1a shipped the CREATE path; **the UPDATE path still records nothing**,
   and `salesforce-sync.js`/`sf-list-import.js` carry 0 direct `recordFieldWrites`. **Measure first:
   of `writeEntitySalesforceLink`'s 195 links in 30 days, how many are creates through the choke
   point vs updates?** If most are updates the ladder still sees nothing and PR5c-enforce stays
   blocked regardless. ⚠️ An UPDATE is where `shouldWriteField` genuinely matters — there IS a prior
   value to protect, unlike the CREATE path CONTACT1a correctly left ungated.
5. **`DE3`/`DE4`** (DE4's input is settled: FY2026's 73.66% Medicare is the fallback bucket),
   **`B6e-clinic-metadata`**, **`D2`–`D5`**, **`PR10`** (one source, two ladders), **`SEC1`**
   (91 of 195 SECURITY DEFINER functions anon-executable — filed by PR8, needs its own pass).

### 👤 Waiting on Scott

`ENTC-confirm` (the 15-pair merge plan — `v_lcc_entities_c_review_merge_plan`, reverse only via `lcc_unmerge_entity`) ·
`N15e` (make `(workspace_id, canonical_name)` UNIQUE? 6,608 violating groups; blocks the last 2 duplicate-mint races) ·
`PR9` (should a human-confirmed clinic↔property link outrank `auto_link_*`, or stay recorded-only @20?) ·
`PR2-gov` (run the gov parcel backfill; the `98248e18` redeploy is confirmed) · `B6e-ci-required-check` (Dialysis branch protection — until flipped the unmasked suite gates nothing) ·
`BR1-confirm` (12 brokerages) · `B6d-sam` (re-issue `SAM_API_KEY`, 401) · `PR1d` (`REGRID_API_KEY` —
a complete vendor client that has never run) · `I16b` (delete the dormant `life-command-center`
Railway service) · `B6e-fred-cm-exposure` (did a book go out after 2026-08-07?).

⏸️ **Deferred by decision, not dropped:** key rotation (`SEC2`–`SEC4`), until a second LCC user
exists. That trigger is enumerated in `docs/os/OPERATOR-ACTIONS.md` §1.

## 4. The turn protocol — do this every turn, without being asked

`docs/os/BUILD-TURN-PROTOCOL.md` is the definition of done. In practice, each turn:

1. **Read the response** in `docs/claude-code/responses/`.
2. **Verify its load-bearing claims live** against Supabase before recording them. ⚠️ **Several of
   this thread's biggest corrections came from re-measuring a claim that sounded right** — including
   two of my own that had already shipped into canonical pages.
3. **Update every affected doc in the same change**: `STATUS.md` (newest first),
   `PLANNED-BACKLOG.md`, `CURRENT-STATE.md`, `CLAUDE.md`, and the canonical topic page.
4. **Correct what is now false IN PLACE**, including your own prior claims, and say so plainly.
5. **Consolidate by topic** (§5).
6. **File the prompt and response to `done/`.**
7. **Hand Scott the git commands** (§6).
8. **Name the next step and draft its prompt.**

## 5. Consolidation rules — how the repo stays true

**The goal: any future chat can pick up a topic cold and be right, and no unbuilt plan is ever
lost.**

- **One canonical page per topic**, carrying live state, decisions already made, and traps already
  paid for. Current set: `producer-health-and-ci-enforcement.md` ·
  `public-records-source-lane.md` · `dialysis-economics-and-medicare-data.md` ·
  `broker-and-firm-identity.md` · `property-metadata-coverage.md` ·
  `data-coherence-invariants.md` · `ownership-history-lane.md` · `tier0-owner-contact-system.md` ·
  `bd-ranking-and-priority-queue.md`.
- **Audits stay as EVIDENCE for their date** and carry a banner pointing at the canonical page.
  **Where they disagree, the page wins**, and the audit gets a supersession note in the same change.
- **Never delete a plan. Extract it.** Before archiving anything, pull every unbuilt intention into
  `PLANNED-BACKLOG.md` with its provenance. 62 items were recovered this way that existed in no
  tracker.
- **A page that reaches a "don't build" verdict must carry its REFUTATIONS**, with reach numbers —
  or the next session re-proposes the same thing.
- **Record what is NOT a defect.** `dialysis-economics-and-medicare-data.md` and
  `broker-and-firm-identity.md` both lead with that section, specifically so understood behaviour
  stops being re-raised as a bug.
- **Archive `STATUS.md` when it passes ~8,000 lines** to `docs/history/STATUS_claude-code_<range>.md`,
  verbatim, with a pointer left behind. Last cut: 2026-08-20 → 08-21, on 2026-09-02.

## 6. GitHub sync — the exact sequence, every time

**Never run git from the sandbox.** Hand Scott copy/paste PowerShell:

```powershell
cd C:\Users\scott\life-command-center
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
git checkout main; git pull --rebase origin main; git status
git checkout -b docs/<topic-slug>
git add docs/ CLAUDE.md
git commit -m "<subject>

<body: what was measured, what was corrected, what was deliberately NOT done>

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: cowork-data-process-audit-<date>"
git push -u origin docs/<topic-slug>
```

- ⚠️ **`Remove-Item .git\index.lock` is not optional** — dropping it has cost this thread real time.
- ⚠️ **Verify `git status` after the rebase** before branching.
- **`main` is protected**: branch → PR → CI green → merge. A direct push is rejected.
- ⚠️ **Merged is not running; green is not enforced; a check that finished AFTER the merge is
  neither.** Five merge-before-CI instances were recorded in two days.

## 7. Traps this thread paid for — do not re-walk them

- **A detector that cannot fire returns a comfortable zero.** Positive-control every zero.
  `definition ILIKE '%confidence_tier%'` matches the SELECT projection, not a filter — it reported
  three views as careful that were not.
- **A roundness statistic that counts zeros.** `0 % 100000 = 0`. Exclude zeros and NULLs, and state
  the non-zero denominator.
- **Read what a producer's external call actually TALKS TO before trusting its name.**
  `*_enrichment` names an intent; two modules so named ask a model to *recall* facts.
- **A one-shot repair of a live producer is a chore repeated forever.** Ship the producer fix in the
  same change as the backfill.
- **Scope a SOURCE to what it populates, never to one consumer's gap list.**
- **A year-based guard and a quality-based guard are not substitutes.**
- **Isolation before traceback** — one `pytest <file>` per failing file separates harness pollution
  from product failures before any error text is read.
- **"Fails the job" ≠ "blocks the merge."** An unmasked step on a repo with no branch protection
  is a badge again. Read the workflow header and the PR merge timing, not the PR body.
- **A "within 0.3%" that four pages repeated did not reproduce (−4.90%).** A figure that sounds
  right and has been copied is not thereby measured — re-run it before it lands on a canonical page.
- **A count that equals a UI window is a reading of the instrument.** "11 ruff errors" was
  GitHub's ten-annotation cap; the real number was 5,746. Same shape as `815 = 1000 − 185`. Before
  quoting a count off any paginated/capped surface, ask what the cap is.
- **`paths-ignore` is a masking idiom at the trigger.** `**/*.txt` matched `requirements*.txt`; a
  dependency bump skipped every job with no status. Decide inside the run, gate steps not jobs.
- **Grouping-for-review ≠ identity-for-write.** Never fuzzy-match a residue of abbreviations,
  surnames and co-listings.

## 8. Standing doctrine

Never fabricate — render "Not on file" / "Derived" / "Conflict". Supabase is reconcilable, never
automatic truth. Review existing machinery before building. Private corpora never egress to a cloud
model. Document at every step.
