# STATUS archive — Claude Code queue, 2026-09-14 (twentieth span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-16 to keep that file under its
3,000-line budget. Nothing was reworded or dropped; every still-open item named here is tracked in
`docs/os/PLANNED-BACKLOG.md`. The span covers the 2026-09-14 XB1+XB2 ship, CONSOLIDATE3-never-shipped,
N3c, the county sweeps and pilot, the Tier 0 auto-attach verification, OC-v2, OWNERGAP1 Unit 1 and
reconciliation, OWN-T0d/T0f, and MB2e.

---
## 2026-09-14 — XB1+XB2 shipped: the build-brief collector, live-verified against the hand run (Cowork)

`scripts/build-brief-collector.mjs` (branch debt, orphaned prompts, doc sizes, GENERATED-file
changes) + `public.lcc_build_brief_db_audit()` (flag-long-dark, producer-stall-not-flag-gated,
market-brief lane staleness) write one `build_brief_snapshots` row via
`.github/workflows/build-brief-collector.yml` (push to `main` + nightly), read via
`GET /api/admin?_route=build-brief-latest`. **No dashboard** — `#/exec` is XB3, unbuilt. First live
snapshot **id=1, 32 findings**, reproducing the hand-run's numbers (15 flags off >3wk, 1 producer
stall — `sidebar_contact_guard`, `p_rss` correctly silent). Orphan-prompt false positive fixed
(substring match on leading ID token, recursive across `responses/`). Doc contradictions / dated
re-measure age / flags-no-consumer deliberately deferred (`XB2-followup`) — too fuzzy for v1
without false positives. Guard `test/xb1-xb2-build-brief-collector.test.mjs` (19/19 green), full
suite 6266/0. Detail: `docs/os/PLANNED-BACKLOG.md` XB1/XB2.

---

## 2026-09-14 — CONSOLIDATE3 was never actually shipped, and STATUS had buried its own index (Cowork)

Extracting the test file from the rescued branch `docs/consolidate3-headroom-and-table-fix-2026-09-12`
turned up a **false ✅**: `PLANNED-BACKLOG` has claimed since 2026-09-12 that CONSOLIDATE3 shipped
"budget raised to 3,000 with an 80%-mark soft warning" and a table-placement guard. **`main` had
`LINE_BUDGET = 2500`, no warning, and no guard** — all of it lived only on that unmerged branch. Third
"claimed shipped, actually isn't" of the day, after the undeployed edge function and the unregistered
flag row; precisely the doc-contradiction rule **XB2** is meant to catch without a human looking.
**The guard, once applied, immediately failed against `main` — correctly.** `## Open threads` sat at
line **1,781**, not the first 40. Cause: **this file gave two contradictory instructions.** The
convention block said *"new entries go DIRECTLY BELOW this block"*, while the table's own header said
*"new entries go BELOW the `---`"*. The header won, so every session prepending above the table pushed
it down — **Cowork's own ~8 entries today are the bulk of that drift.**
Fixed: table moved back to the top (now line 25), the convention block rewritten to point at the
table's `---` so the two no longer disagree, and the stale "Line budget: 2,500" text corrected to 3,000
with the 80% warning. Guards: 10/10 green. ⚠️ PRs **#2448** and **#2452** should be **closed unmerged** —
#2448 carries a 2-day-old STATUS snapshot that would overwrite this, and #2452 would revert a
2026-06-20 brand-font fix in the lease-comps template. Both branches stay on origin (BRANCH1).


## 2026-09-14 — N3c decided and shipped: banks/CMBS trustees excluded; full open-decisions list compiled (Cowork)

Scott's call on N3c: banks and CMBS trustees are their own excluded category, same as public bodies
and universities, "for now" -- explicitly revisitable if lender prospecting via Northmarq debt-side
coordination comes up later.

Reviewed existing machinery first: `lcc_owner_name_is_not_prospected` is already the single choke
point excluding public bodies/universities from prospecting, feeding 7 views (Tier 0 lane, seller
prospect universe, loan maturity worklist, etc.). Added `lcc_owner_name_is_bank_or_trustee` and wired
it into that same function rather than building a new mechanism. Sized the regex against live data
before shipping: 11 owner names match today (10 national banks + 1 JPMorgan CMBS trust), 0 false
positives against individual/family trustees (e.g. "Tony Martin, Trustee" correctly stays
prospectable), 0 credit unions swept in (deliberately -- member-owned, can be legitimate
owner-occupant prospects, a different category from a bank/CMBS trustee holding title incidentally).
Verified live: Wells Fargo Bank NA and the JPMorgan CMBS trust are now gone from
`v_lcc_tier0_owner_contact_lane_open`. Migration:
`supabase/migrations/20261102150000_lcc_own_t0_bank_cmbs_trustee_exclusion.sql`.

Also found fcp/tmg's sponsor-domain proposals (the other N3-adjacent open item) have gone stale --
zero live rows in `v_lcc_tier0_sponsor_map_proposals` today, re-checked live. Not re-raising a
decision with no population behind it.

Per Scott's request, compiled every remaining genuine open decision across the whole ownership→contact
chain into one place: `ownership-truth-pipeline-state.md`'s new "Open decisions — needs Scott" section.
Six items: trailing-"The" canonical key (`OWN-T0b/c`), `entities.canonical_name` unique-key enforcement
(`N15c`, blocked by the first), `lcc_finalize_entity_portfolios`'s supersession rule (`OWN-T0g`), 1,475
Salesforce-campaign orphans (`N15`), whether to widen ownership resolution to the remaining 2,241
properties (`T2b`, safe/cheap but low-value -- only 3.7% contactable), and what evidence promotes an
owner out of `unknown` role (doctrine question from `connectivity-and-open-threads.md` §4o). Also added
a "Where we are toward 100%" snapshot table with every load-bearing metric measured this session and
the sessions before it, and an honest read: the mechanisms keep getting fixed (auto-attach now writes,
tombstones cleared, bank/trustee category closed) but the headline 13% owner-to-person linkage number
has barely moved (13.5% now) because the entity-dedup residue upstream is the real blocker.
## 2026-09-14 — Match rate measured: Philadelphia returns ~68%, and it found a two-property owner on the first pass (Cowork)

§7 said download one free file and measure the **match rate**, because coverage is not a hit rate. Done, live,
against Philadelphia's free public open-data endpoint (`phl.carto.com/api/v2/sql`, `opa_properties_public`) — no
scraping, no login, no vendor.

**Pass 1, exact address: 9 of 22 distinct addresses. Pass 2, house-number prefix + street: 6 more. ≈ 68%.**

🔑 **Every pass-1 miss had one cause, and it is trivial:** Philadelphia stores address **ranges**; LCC stores the
lead number. `4126 Walnut St` ↔ `4126-38 WALNUT ST`. `1300 W. Lehigh Ave` ↔ `1300-24 W LEHIGH AVE`.
`1172 S Broad` ↔ `1172-74 S BROAD ST`. That is an **address-normalisation** problem — exactly the lane
`OWNERGAP1-ollama` reserves for a local model — **not** a data-availability one.

**Fifteen real, callable owners came back**, including `UNIV CITY ASSOCIATES` (DaVita 42nd St), `SIX G'S L P`
(DaVita Memphis St), `HASBROOK ASSOCIATES L P` (Fkc Fox Chase), `UMBRIA VENTURES LLC` (Fkc Roxborough) and
`EPISCOPAL HOSPITAL` (Fkc Episcopal).

🚨 **And the first prospecting signal fell out on the first pass, unprompted:** **`FILIPPONE EDWARD J TR`** owns
109 Dickinson St and **`FILIPPONE-NEWMAN LLC`** owns 1172-74 S Broad St — **the same family behind two of Team
Briggs' dialysis properties.** A portfolio seller prospect LCC could not see yesterday, because both properties
read "owner unknown". That is the point of the whole exercise, arriving earlier than expected.

⚠️ **Two honest limits, both recorded rather than smoothed over.** **One jurisdiction is not a rate** —
Philadelphia is a well-run open-data city, so re-measure on a Texas CAD and a Florida county before projecting 68%
onto the 4,021. And **the real hard case is multi-parcel sites**: `3300 Henry Ave` returns **six** owning entities
(the Falls Center LPs) for a single street address; that needs a unit or parcel discriminator, and no amount of
address matching resolves it.

**Next: repeat the identical test on Harris TX (50) and Miami-Dade FL (29)** — two more measurements, still no
build, and the coverage question is then answered with three real rates instead of one projection. Full detail in
the audit doc §8.

## 2026-09-14 — Second county sweep: the question was wrong again, and the free path covers ~20% before we start (Cowork)

Scott ruled out a paid provider and asked whether a local Ollama model could do this. Sampled six more
jurisdictions. **The framing changed a second time, in his favour.**

**The useful question is not *"can we search this county's portal"* but *"does this jurisdiction publish a FREE
BULK FILE that already contains the owner"*** — and several of the largest do:

| jurisdiction | props | owner published? | how |
|---|---:|---|---|
| **Harris, TX** | 50 | **yes** | portal + CSV/XLS/PDF export |
| **Dallas, TX** | 25 | **yes** | owner-name search + COMMERCIAL filter, no CAPTCHA |
| **Miami-Dade, FL** | 29 | **yes** | dedicated **OWNER NAME** search tab |
| **Philadelphia, PA** | 25 | **yes** | address→owner, full grantee/grantor sales history, **+ free bulk dataset download** |
| **NYC (Queens + 4)** | 56 | **yes** | **PLUTO**, free, tax-lot level, **monthly** (26v2, Aug 2026) |
| **Cook, IL** | 73 | gated | CAPTCHA every search — human-only |
| **Los Angeles, CA** | 54 | **no** | not published at all |

Philadelphia's own property page ends *"You can download the property assessment dataset in bulk"*, and its detail
view carries the **grantee/grantor chain** — free. **None of this is scraping.** It is open data, downloaded once
and matched offline.

**Measured coverage of the obvious free-bulk targets: TX 432 + FL 302 + Philadelphia 25 + NYC 56 = 815 of 4,020
(20.3%)** with no portal automation, no CAPTCHAs and no vendor — before checking the other open-data states.

⚠️ **That is COVERAGE, not a hit rate**, and the distinction is the whole risk. A bulk file covering a
jurisdiction does not mean our property matches a row in it — matching is **by address**, and these rows carry
almost no APNs (Cook 0/73, Harris 0/50, LA 1/54). **Measure the match rate on one downloaded file before building
anything.** Philadelphia is the cheapest test: 25 properties, documented bulk download.

🚨 **On Ollama, recorded as `OWNERGAP1-ollama` because Scott asked and the line is sharp.** A local model may
**never** be used to recall an owner. Asked *"who owns 5040 Crenshaw Rd"*, any LLM returns a plausible LLC name —
**exactly the defect we quarantined this week**, since the `ABC`/`XYZ Dialysis Centers` rows came from a `gpt-4o`
call asked to recall a public record. Running that locally makes it free and unlimited, **which is worse, not
better.** ✅ Where it genuinely helps: **matching and normalising text we already fetched** — our address strings
against a downloaded file's (`5040 Crenshaw Rd` ↔ `5040 CRENSHAW RD`, suite noise, abbreviations) and entity names
(`CRENSHAW MOB LLC` ↔ `Crenshaw MOB, L.L.C.`). Transformation of retrieved data, never recall, every output
checkable against its source row. That is the step that turns a free download into matched owners.

**Revised recommendation:** download **one** file (Philadelphia), measure the match rate, and let that number —
not a vendor quote — decide everything downstream. Cook-shaped counties stay manual; LA-shaped are unreachable
from the county at any price, and the vendor conversation can stay deferred indefinitely against a residual that
will be far smaller than 4,021. Appended to the decision doc as §7.

## 2026-09-14 — XB scoped by running the audit by hand first; it found real debt (Cowork)

Two of Scott's three original P18 asks are now live and self-monitoring (market briefs, operator funnel).
**XB — the CDO/CTO build brief — is the third and was never started.** Rather than describe it, ran the
XB2 rules by hand so the prompt carries a measured acceptance target:
**618 local branches** (14 unmerged); **68 flags — 37 on / 29 off, 15 off >3 weeks, 11 off >60 days**,
oldest dark since **2026-05-30**; `sidebar_contact_guard` **31 runs / 31 skipped / 0 completions ever**;
4 of 8 prompts without a matching response; STATUS 2,257 / 2,500 and BACKLOG 1,178 (both guarded).
⭐ **The run produced a rule refinement.** `p_rss` also reads "skipped, never completed" — but its
`skip_reason` is `flag MARKET_BRIEF_PRSS is off`, which is the system working and must stay silent.
`sidebar_contact_guard`'s reason is operational, 31 runs running — a stall wearing a skip's clothes. So
the rule is **not** "no completions" but "skips that are NOT flag-gated, N runs running". Same
dead-vs-silent distinction FEED2 and MB2e each paid for separately; it now has a third instance.
⚠️ The orphan-prompt rule threw a **false positive** (`MB2bc-…` vs `MB2b desktop response.docx`) — the
prompt↔response naming convention is unenforced, so that rule needs a real key before shipping.
Scoped **XB1+XB2 only — no dashboard**: a surface with nothing behind it is exactly how three "looks
live, does nothing" defects happened this week. → `prompts/XB1-XB2-build-brief-collector-and-audit-rules.md`

## 2026-09-14 — County pilot run live: Harris works, Cook is human-only, LA publishes no owner at all (Cowork)

Ran OWNERGAP1's recommended pilot in the browser rather than handing Scott an hour of clicking. It took minutes,
and **it refutes the single-number framing of the question it was meant to answer.**

⚠️ **A constraint the decision doc did not weight:** these properties carry essentially **no APNs** — Cook
**0/73**, Harris **0/50**, LA **1/54** — so every lookup has to work from a **street address alone**. That is what
the pilot actually tested.

**The three counties resolved three different ways:**

| county | props | verdict |
|---|---:|---|
| **Harris, TX** | 50 | ✅ free, address search, **returns the owner**, CSV/XLS/PDF export — looks automatable |
| **Cook, IL** | 73 | ⚠️ free address search exists but **every search is CAPTCHA-gated** — human-only |
| **Los Angeles, CA** | 54 | ⛔ free, no CAPTCHA, **but owner names are not published at all** |

**Harris is a direct hit, and the county draws exactly PDR2's distinction.** `5040 Crenshaw` → three accounts:
`FRESENIUS MEDICAL CARE GREATER SOUTHEAST HOUSTON LLC` and `FUSA MARKETING` as **Personal** property, and
**`CRENSHAW MOB LLC`** (16,915 SF, $1,903,507) as **Commercial** — the real owner, a single-asset LLC, on a
property LCC reports as "owner unknown" today.

**LA is a hard no, established by reading rather than assuming.** Parcel detail for AIN 2350012065 carries situs
address, use code, building characteristics, a 25-row assessment history, and an ownership *events* table with
recording dates, doc numbers and sale prices — **and no owner name anywhere.** Not a scraping difficulty; the
datum is not published.

👤 **What it changes for Scott:** **there is no single "Option A yield."** Behind the 4,021 sit **1,266 distinct
(state, county) combinations**, and the three largest split one-automatable / one-manual / one-impossible. A
national county build would be sized against the worst case while delivering only the Harris-shaped subset.
Revised to three options on **OWNERGAP1-decision**: build for Harris-shaped counties only (**sample 5–10 more
first** — three proves the shapes differ, not how they split); a paid bulk provider, which is the only path that
reaches LA-shaped counties because it does not depend on what a county chooses to publish; or accept "owner
unknown" and rank those properties last — now a measured choice rather than a default.

**The cheapest informative next step is more sampling, not a build** — the same logic that made this pilot worth
running. Appended to `docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md` §6 rather than
filed separately, so the decision and its evidence live in one place.

## 2026-09-14 — Tier 0 auto-attach fix VERIFIED live; owner-to-person linkage re-measured at 13.5% (Cowork)

Scoped Stage 4's contact-linkage gap per my own recommendation, starting with review before building.
`tier0-owner-contact-system.md` explicitly flagged an unverified claim: a 2026-09-12 fix to
`TIER0_AUTO_ATTACH` (a call-site arity bug had silently kept it off for 16 straight days) was never
actually confirmed to write anything in production.

Verified it directly against `lcc_tier0_auto_attach_run_log` and `lcc_tier0_confirm_log`: 09-12 06:55
still shows `attached=0` (fix landed mid-day, after that run); **09-13 06:55 shows `attached=9`** -- the
first non-zero `attached` in the log's history, independently confirmed by 9 new `lcc_tier0_confirm_log`
rows with `actor` NULL (system) and `verdict='attach'`, all dated 09-13, none before. 09-14 06:55 shows
`auto_candidates=0`, which is the expected steady state (pool cleared) rather than a regression. The fix
genuinely works.

Re-measured the "13% owner-to-person linkage" headline figure the same way the 08-27 audit did: **13.5%
(1,377 of 10,187)** today vs. 13% (847/6,480) then. Both the linked count and the universe grew (universe
growth is partly the still-open OWN-T0b/c duplicate-entity residue inflating the owner count with
un-merged duplicates) -- the ratio barely moved. Honest read: the mechanism now works, but 9 links/day
against a gap this size won't move the headline number on its own.

Documented both findings in `tier0-owner-contact-system.md` (§2 headline table + §6) and
`ownership-truth-pipeline-state.md` (`[UX-T1a-reach]`).

Did not build anything further this pass -- Stage 4 is a large, 13-audit-round subsystem with several
genuinely open decisions already sitting there for Scott (fcp/tmg sponsor domain confirmation, N3c
bank/trustee scope, N15 Salesforce-campaign orphans, N15c's canonical_name unique-key call), any of
which is a smaller, well-scoped next step than trying to move the 13% number directly. Flagged back to
Scott rather than picking one unilaterally.

Housekeeping: `docs/claude-code/responses/` had OC-v2 and OWNERGAP1 desktop responses queued; left
untouched -- another concurrent session had the shared checkout mid-edit on exactly those topics
(uncommitted changes across api/, docs/audits/, docs/os/, supabase/migrations/, test/) when checked, so
reconciling them was that session's in-flight work, not mine to touch.
## 2026-09-14 — OC-v2 taken live: the operator funnel now triages, routes, and watches itself (Cowork)

**Applied the migration CC could not** (`20261102140000`): flag row registered, `v_operator_notes_stale_open`,
`lcc_check_operator_notes_stale`, crons `lcc-operator-triage` 07:25 UTC and `lcc-operator-notes-stale-check`
07:30 UTC — **both slots verified free against live `cron.job` first**, which the migration's own comment
explicitly asked an operator to do. Confirmed the deployed build carries the fix (`87042eb63878`,
`merge-base` proves it contains PR #2438) before grading anything — merged is not running.
**Re-graded with the model actually invoked: `scanned 3, triaged 3, routed 2, unclassified 0`** (was
1 / 1 / 2). The dialysis bug note that previously failed now grades `bug` / `lane: dialysis` / `medium`
→ `app/briefing` via `onprem_ollama`; the comps idea now carries `lane: government`.
**`OPERATOR_NOTE_TRIAGE` flipped ON** against that evidence — the gate the migration documented. A POST
run wrote the classifications; all three fixtures were then closed through the normal disposition path,
so that path is exercised too. Stale monitor reads 0 open notes, 0 alerts.
⚠️ **Correction to my own earlier diagnosis, which was wrong.** I reported the model as "declining" on the
bug note. CC found the truth: a plain GET **never called Ollama at all** — `model_declined` meant *never
asked*. That is why the fix was a code path, not a prompt. Worth keeping: a verdict string named the
wrong cause, and I repeated it as measurement.
👤 Residual: the meta note graded `bug` (over-classification) with `routed_to: null`. Triaged-but-unrouted
correctly stays `open` and would age into an alert — the monitor working as designed.

## 2026-09-14 — OWNERGAP1 reconciled: containment verified both ways, CC corrected my premise, one residual gap found (Cowork)

PR #2437 merged. Responses and prompt filed to `done/`. **CC's pass was better than the prompt that asked for it,
in four separate ways, and each is worth naming.**

**1. It corrected my premise.** I named `sidebar-pipeline.js` as the producer. It is not — the fabricated names
come from **`Dialysis/src/public_record_ingest.py`'s `gpt-4o` recall call**, in a *different repo*, asking a model
to "extract" `mailing_owner` from a prompt **seeded with the property's own owner and no county fetch**. That is
fabrication **by construction**, the same class as PR1/PR1a/PR1b. Filed honestly as `OWNERGAP1-producer` 🔴 with
read-only access disclosed rather than claimed as fixed.

**2. The fabrication was bigger than I measured.** I found 228 rows in `tax_records`. CC ran the same detector
across every table that can carry a model-sourced owner string and found **221 more in
`entity_registry_records.entity_name`, 12 in `recorded_owners.name`, and 10 in `true_owners.name`** — the last two
being the **curated** tables `properties.recorded_owner_id`/`true_owner_id` point at. A fabricated row there is a
live landmine for any future name-match reconciler, not a staging-table curiosity.

**3. It caught its own near-miss during verification and corrected it in place.** The single `recorded_owners` row
literally named `"Unknown"` **is referenced by 23 real properties today** — a genuine in-use sentinel from some
other producer, not gpt-4o fabrication. Nulling that FK would have been an undisclosed side effect of a migration
about stopping fabrication. It narrowed the properties-link guard to fire only on `fabricated_placeholder`, proved
it with a rolled-back positive **and** negative control, and documented the correction in the migration header.

**4. Its recommendation is the right one, and it is a decision rather than a build.** The concentration analysis
kills the "narrow path" hope I was hoping for: **top-15 counties = 13.7% of the gap, 1,266 distinct
(state, county) combinations, 640 properties with no county at all.** So instead of committing to a county-portal
build or a vendor contract, it proposes a **bounded one-hour manual pilot** on Cook IL / Los Angeles CA /
Harris TX (177 properties) to learn whether Option A's yield is nearer 40% or 5% **before** anyone spends money.

✅ **What I verified independently rather than reading:** `trg_dia_ownergap1_*_guard` is live and **enabled on all
four tables**; **370 rows quarantined** (228 + 142), rows intact, reasons distinct. I re-ran the control myself in
a rolled-back transaction: `XYZ Dialysis Centers LLC` → nulled + `fabricated_placeholder`; `Unknown` → nulled +
`unstated_placeholder`; **and a real owner, `Decarion Family Trust`, passed through untouched.** Both sides hold.

⚠️ **One residual, filed as `OWNERGAP1-payload`:** the guard protects the **column**, not `raw_payload`. A row
whose fabricated name sits only in `raw_payload->>'mailing_owner'` is **not** flagged (probe `PROBE-RB-4`), and the
228 already-quarantined rows **still carry the invented string in their payload** — which is exactly how I found
them. So *"catches every one going forward"* is true of the column and not of the payload. **Not urgent** (no live
consumer reads that key, and leaving a raw source record unedited is arguably correct) — the likely right answer is
to make the quarantine flag readable beside the payload rather than scrub it. Written down so the next reader of
that payload is not misled.

## 2026-09-14 — OWN-T0f reviewed (no action needed), OWN-T0g sized and deferred pending a decision (Cowork)

Continued the OWN-T0 residue after OWN-T0d shipped. Reviewed existing machinery before building, per the
OWN-T0c lesson.

**OWN-T0f (closed, no build)**: the per-row UUID on `county_deed:<uuid>`/`gov_ownership_chain:<uuid>` in
`ownership_source` looked like producer noise in the audit, but reading `lcc_a2_apply_ownership_chains`
showed it is deliberate citation back to the specific source chain-link record. The one live consumer that
groups on it, `v_lcc_property_ownership_reconciled` via `lcc_ownership_evidence_level()`, already
prefix-matches both patterns correctly -- verified live, `evidence_level` grouping has 0 rows in `other`
across all 27,421 rows. Nothing to build; would have been solving an already-solved problem.

**OWN-T0g (sized, not shipped)**: `lcc_finalize_entity_portfolios` is live, `SECURITY DEFINER`, cron-driven,
and runs both domains' portfolio syncs -- a different risk class from OWN-T0d's one-time data cleanup.
Confirmed by reading its body: gov's supersession window is computed only across the current inflight
request's rows, so a property whose owner history is split across sync calls never gets end-dated across
that split; dia has no supersession logic at all. Real, confirmed gap. Did not build a fix -- the correct
repair needs a decision first (should supersession compare against all historical facts, not just the
current payload; is "new current owner supersedes old" even a safe assumption here, given gov/1708 has two
genuinely-current co-owners from OWN-T0d's investigation). Recommend sizing the live blast radius against
the 747 `multi_current_distinct_parties` population before writing anything.

Both findings documented in `PLANNED-BACKLOG.md`'s OWN-T0b/c/d/f/g row and
`docs/architecture/ownership-truth-pipeline-state.md`.

Housekeeping: MB2e desktop response reconciled (already-merged PR #2433, moved to responses/done/).
## 2026-09-14 — OC-v2 shipped: lane detection + GET-never-calls-the-model bug fixed, flag registered, cron scheduled

Root-caused the two triage findings from the measurement pass below. `lane: null` was structural —
`classifyDeterministic` never set `lane`, only `note_type`/`severity`; added `detectLane` (domain
keyword map: dialysis/government/comps/market-brief/buyer-engagement/automation/data-coherence/canon)
and attached it to every deterministic verdict. `triage_source: null` / "model declined" was a
misread — a plain `GET` dry run never called Ollama at all (only `POST` or `?generate=1` did), so the
bug note was never actually offered to the model. Removed that gate (`?skip_model=1` opts out).
Migration `20261102140000` registers `OPERATOR_NOTE_TRIAGE` (still **off** — the row never existed,
so nothing could flip it), schedules `lcc-operator-triage` (07:25 UTC, not flag-gated), and adds a
distinct stale-note monitor (`v_operator_notes_stale_open` / `lcc_check_operator_notes_stale`,
`operator_note_stale_open` alert ≥3d, cron 07:30). **Not applied live** (no DB access this session) —
flag stays off until a live re-grade. `test/operator-notes.test.mjs` + `test/operator-triage-tick.test.mjs`
+ `test/sql-definer-privilege-stanza.test.mjs` all green.
## 2026-09-14 — OWNERGAP1 Unit 1 shipped: reversible SQL-side quarantine on Dialysis_DB; producer is `Dialysis/src/public_record_ingest.py`, not this repo (Cowork)

Followed up on the entry below (the 228 fabricated `ABC`/`XYZ` owner names + 142 `"Unknown"` placeholders in
`tax_records.raw_payload->>'mailing_owner'`). Attached the `Dialysis` repo read-only and traced the real
producer: **not** `sidebar-pipeline.js` as the originating prompt named — that file never writes
`mailing_owner` (grep: zero hits). It is `Dialysis/src/public_record_ingest.py::write_tax_record`, calling
`gpt-4o` with the property's own recorded/true owner in the prompt and no county fetch anywhere in the module
— the same mechanism PR1/PR1a/PR1b already documented on `assessed_value`/`tax_amount`/`tax_delinquent`,
recurring on a field (`mailing_owner`) those rounds never touched. Corrected in place above.

**Contamination is wider than the prompt described** — measured across all four tables the producer touches,
not just `tax_records`: `entity_registry_records.entity_name` carries the same `ABC`/`XYZ` pattern, and
`recorded_owners.name` / `true_owners.name` carry it too (the curated identity tables `properties` FKs
point at). Migration `20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql` (applied live to
Dialysis_DB `zqzrriwuavgrquhisnoa` via three sequential statements — the base migration plus two live
corrections, both folded into the committed file):

- **One detector, `dia_is_fabricated_placeholder_owner(text)`** — case-insensitive `^(XYZ|ABC)\s` plus
  exact (trimmed, case-insensitive) `= 'unknown'`. Never a `contains` rule (P158a) — a real firm like
  `"AZ Business Trust LLC"` or `"Unknown Holdings of Dallas LLC"` must not flag.
- **`dia_ownergap1_fabrication_quarantine`** — append-only log, idempotent (`ON CONFLICT ... WHERE
  restored_at IS NULL DO NOTHING`), records the pre-quarantine value for every flag.
- **`tax_records.mailing_owner`** — the field the investigation named — is NULLED (the field is not an
  identity column; blank is the honest state) + flagged; guard trigger stops future writes the same way.
- **`entity_registry_records`/`recorded_owners`/`true_owners`** — **flag-only, name preserved.** These are
  identity columns other rows FK to; nulling `name` would either FK-violate or silently rename a real party.
  Each has its own `BEFORE INSERT OR UPDATE` guard trigger.
- **The loophole this closes: `properties.recorded_owner_id`/`true_owner_id`.** A property could still point
  at a fabricated-and-flagged owner row even after the row itself is flagged. `trg_dia_ownergap1_property_owner_link_guard`
  nulls the FK on write — **scoped to `fabrication_quarantine_reason = 'fabricated_placeholder'` only, never
  `'unstated_placeholder'`.** ⚠️ That scoping was corrected live, mid-build: the first version tested
  `fabrication_quarantined_at IS NOT NULL` generically, and a live `recorded_owners` row literally named
  `"Unknown"` is referenced by **23 real properties** — the generic guard would have silently severed those
  on the next write to that row. Caught by testing both directions against production before shipping
  (rolled back, no residue), not by reading the code.
- **`dia_ownergap1_restore_quarantine(batch_tag)`** — full reversal, restores `mailing_owner` from the log
  and clears every flag column for a batch.

**Before/after (live, `zqzrriwuavgrquhisnoa`):** `tax_records.mailing_owner` fabricated 228 → **0** (nulled +
logged), `"Unknown"` literal 142 → **0** (nulled + logged, `unstated_placeholder`); `entity_registry_records` /
`recorded_owners` / `true_owners` fabricated names flagged, names preserved. **Confirmed: 0 properties'
`recorded_owner_id`/`true_owner_id` reference a `fabricated_placeholder`-flagged row** (the link guard's
positive control), and **no property owner FIELD was written by any of this** — only flags, nulls on the
non-identity `mailing_owner` field, and reversible FK-nulls on the loophole.

**Unit 2 (re-measurement) — all four of the prompt's own figures reproduced, live, this session**, beside
the originating measurement: 25,331 `mailing_owner` keys / 24,365 null-or-empty (matches exactly); of the
4,021 owner-unknown properties, 3,048 join tax records and exactly 1 has a non-blank `mailing_owner`
(`"Unknown"`, matches exactly); `deed_records` **204** total / 0 overlap (the prompt said 203 — a genuine
+1 landed in the hours between the two measurements, not a methodology disagreement, called out rather than
silently reconciled); 56 of 4,021 carry a `parcel_number`, 0 of those join a `parcel_records.owner_name`
(matches exactly). **No source the prompt missed was found.** The finding stands as written: the 4,021-
property owner gap is not recoverable from any table LCC or Dialysis_DB holds.

**Unit 3 (costed decision doc):** `docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md`
— county-recorder path (`handleRecorderPortal` is gov-only; `county_authorities` does not exist on
Dialysis_DB at all — verified via `information_schema`, so the prompt's premise there needed correcting too;
the dia-capable path is the manual `handlePublicRecordsCapture` writeback only) vs a paid bulk vendor
(`Dialysis/src/regrid_client.py` — a complete, unused Regrid Parcels client gated on unset `REGRID_API_KEY`)
vs doing nothing; state/county concentration (top 15 = 549/4,021, 13.7%; 640/4,021 carry no county at all;
1,266 distinct state/county combinations — the population is NOT geographically narrow, so a county-by-county
manual pilot does not obviously beat a national paid feed); recommendation to Scott: a small 3-county pilot
before committing to either paid path, given the population's dispersion.

**Guard:** `test/ownergap1-fabricated-owner-quarantine.test.mjs`, 40 tests — positive control on all 12
known fabricated names + `"Unknown"` variants (case/whitespace), negative control on 10 real names
(`"AZ Business Trust LLC"`, `"X Y Z Dialysis Consulting LLC"` as the deliberately adversarial edge cases),
plus structural assertions against the migration's own source (detector, quarantine table, all four+one
guard triggers, the `fabricated_placeholder`-only scoping on the property-link guard, the restore function,
`NOTIFY pgrst`). Full suite: **6,231 passed / 0 failed / 6 skipped** (pre-existing skips, unrelated).

**No Railway redeploy needed or possible for this change** — nothing in `api/`/JS shipped; the entire fix is
a Dialysis_DB migration (live immediately, per this repo's own "Supabase migration changes are live
immediately" rule) plus a test file and two docs. The actual Python producer fix (stop `gpt-4o` emitting
`ABC`/`XYZ` template-shaped names) is filed as **`OWNERGAP1-producer`**, cross-repo, not shippable from this
session's read-only `Dialysis` access.

## 2026-09-14 — OC-v2 de-risked by measuring triage before sending it (Cowork)

Rather than send OC-v2 blind, forced a triage dry run against the deployed handler
(`tranquil-delight` `cf04ae04ae52`, which reports `skipped: flag_off` / `registry_state: null` honestly
and offers `?force=1`). Filed **two realistic notes** first, because the only queued note was meta
("confirming the funnel accepts notes") and a meta note is a bad test of a classifier.
**Result — `scanned 3, triaged 1, routed 1, unclassified 2, errors 0`:** an unambiguous **dialysis bug
report** naming a route, a lane and a mechanism came back `unclassified`
(`no_deterministic_rule_matched_and_model_declined`); the one success was a comps idea routed
`deterministic`ally but with **`lane: null`**, despite "government deals" and "GSA lease".
**So: only keyword rules fire, they lack market-brief/dialysis vocabulary, lane is never populated, and
the model arm declines** (`triage_source: null` on both misses). ⚠️ **Flipping the flag as-is would route
about one note in three and lose the rest silently** — the funnel would look alive while still dropping
most of what Scott puts in it. MB-a measured Ollama reachable from Railway in the RSS path, so OC-v2 must
check whether the TRIAGE path reaches the model at all: unreachable is a wiring bug, conservative is a
prompt question, and they have different fixes. Both test notes left in the queue as fixtures.

## 2026-09-14 — OWN-T0d shipped: 11 tombstone-duplicate-current properties cleaned up (Cowork)

Continuing the ownership-truth-pipeline work after OWN-T0c's revert, picked up OWN-T0d next (my own
recommendation, approved). Re-measured `v_lcc_property_multi_current` on LCC Opps: `tombstone_duplicate_current`
unchanged at 11 properties from the 2026-09-02 audit (unlike OWN-T0c's population, which had nearly tripled).

Reviewed existing machinery *before* building anything (the lesson from OWN-T0c) and found the fix already
built and deployed: `lcc_repair_tombstone_portfolio_facts(p_dry_run, p_batch)` (P175) on `lcc_entity_portfolio_facts`
-- finds current-fact rows still sitting under a tombstoned (`entities.merged_into_entity_id is not null`)
entity_id where the survivor already holds an equal-or-better current row for the same property, and
dedup-deletes the ghost row (or repoints it if the survivor lacks the property). It explicitly leaves alone
any case where the ghost claims current and the survivor claims ended -- a genuine conflicting claim, not a
duplicate -- for `v_lcc_portfolio_ownership_conflict` to surface separately, so it never over-corrects.

Dry run found **12** ghost fact rows (not 11 properties -- one extra, gov/1708, was bucketed under the
*other* defect class `multi_current_distinct_parties` by the view because it also carries a genuine second
rival owner; the repair function operates at the fact-row level so it caught it anyway). Ran live, batch tag
`own_t0d_2026-09-14`, fully logged to `lcc_p175_portfolio_repair_log` (old-row snapshot per fact) and
reversible via `lcc_unrepair_tombstone_portfolio_facts('own_t0d_2026-09-14')`.

Re-measured after: `tombstone_duplicate_current` **0** (was 11/12). `multi_current_distinct_parties` unchanged
at 747/\$876,981,134, confirming no genuine rival-party conflict was touched. gov/1708 now correctly shows
exactly its 2 real current owners (The Greystone Group vs. the Silverstone Company survivor) with only the
duplicate Silverstone ghost row gone. No migration needed -- the repair function pre-existed; this was a
live-data operation only, documented in `PLANNED-BACKLOG.md`'s OWN-T0b/c/d/f/g row and
`docs/architecture/ownership-truth-pipeline-state.md`.

Housekeeping: checked `docs/claude-code/responses/` -- empty, nothing to reconcile.

Next recommendation: Stage 4's contact-linkage gap (13% owner-to-person linkage), or the smaller
mechanical OWN-T0f (`ownership_source` per-row UUID noise) / OWN-T0g (`lcc_finalize_entity_portfolios`
supersession-window gap) follow-ons. OWN-T0b/c (1,183 `duplicate_entity` merges) stay blocked on the
trailing-"The" human decision from the prior entry.
## 2026-09-14 — MB2e verified live; then found the operator funnel has no consumer (Cowork)

**MB2e confirmed independently.** All **13 feeds now contribute ≥1** — Federal Register (GSA) 6→**4**
after cutoff, Tax Foundation 15→**5** — **zero feeds at zero**, zero open alerts of either kind, and the
11:15 UTC cron genuinely calls **both** monitors (checked the cron command, not the claim). The feed
thread is complete and self-monitoring. No doc entry was needed for the confirmation itself.
**Closed a stale blocker:** `MB2a` still read `⛔ blocked on edge-function deploy` two days after that
deploy landed (v21 → v25 since). Now ✅ — and it is exactly the stale-dated-blocker class **XB2** exists
to catch automatically.
🚨 **The operator funnel accepts notes and nothing processes them.** OC-v's blocker #1 IS resolved —
the standalone MCP redeploy happened, `log_operator_note`/`get_operator_inbox` are live, intake works
end to end. But: `operator_notes` holds **1** note, filed 2026-09-12, still `open` / `note_type=null` /
`routed_to=null`; the **`OPERATOR_NOTE_TRIAGE` registry row does not exist at all** (OC2 shipped the
handler and never registered the flag, so it cannot be turned on); and there is **no triage cron**.
This is worse than not having the funnel — Scott was told it is live, so a note filed there looks
captured, is captured, and is then silently ignored. Same class as a dead feed reporting healthy.
→ **OC-v2** (`prompts/OC-v2-notes-go-in-and-nothing-happens.md`).

## 2026-09-14 — MB2e: two more feeds green + contributing nothing (Federal Register GSA, Tax Foundation)

MB2b's `items_after_cutoff` column found its next two customers on day one. Same class as FEED2
(a fixed window vs. a slower producer cadence, worst on Monday): `maxAgeHours` set 24*7 on both
`government/Federal Register (GSA)` and `tax_policy/Tax Foundation` (measured: newest item 82h/92h
old, 5 items each land inside 7d, 0 inside 72h). Deployed to LCC Opps (v24 → v25), body re-read to
confirm. Forced live: both feeds went from `items_after_cutoff: 0` to **4** and **5** respectively
on the same day's real feed. Monitor half also shipped (migration `20260914130000`):
`v_market_brief_feed_health_no_contribution` + `lcc_check_market_brief_feed_no_contribution` — a
DISTINCT alert_kind from `market_brief_feed_stale`, counting consecutive checks (never calendar
days, FEED2's fix applied from the start) that parsed items but contributed 0; rides the same
11:15 UTC cron. Guard `test/mb2e-feed-cutoff-window.test.mjs`. Full suite green (6,212 tests).
Backlog **MB2e** ✅; canonical lesson filed in `docs/architecture/data-coherence-invariants.md` I11
section (fixed-window-vs-cadence is a class, not a one-off).
