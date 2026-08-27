# W5.3 re-opened — the intake grade has been averaging two different channels

**Measured 2026-08-26 (Cowork), live against LCC Opps `xengecqvemvfknjvbvrq`.**
**§3 ANSWERED 2026-08-27 (Prompt 194): the sidebar channel was posting to the RETIRED Vercel
deployment, which still serves a pre-Prompt-61 build. Verdict = defect. Jump to
[§3 ✅ ANSWERED](#-answered-prompt-194-2026-08-27--it-was-never-a-second-prompt-it-was-a-second-host).**
Picks up the thread left off by `W53_AND_OLLAMA_HYGIENE_KICKOFF.md` →
`W5_3_LOCAL_LLM_EVALUATION_2026-08-06.md` (+ its 2026-08-11 re-grade addendum) →
prompts 61 / 82 / 93.

> **Headline: the 2026-08-11 verdict "the prompt-61 hardening WORKED — NOI 89%, cap 89%,
> tenant 79%" is not safe as stated.** It is a fleet-wide average over
> `staged_intake_extractions`, and that table is fed by **three channels with different INPUT
> types**, only two of which ever run the hardened prompt. A number that moves with the channel
> **mix** is not a measurement of the **prompt**.
>
> Nothing here says the hardening failed. It says the evidence offered for it cannot carry the
> claim, and the channel split — measured below for the first time — points the other way.

---

## 1. What the table actually contains (last 30 days)

`staged_intake_extractions` joined to `staged_intake_items.raw_payload->>'channel'`:

| channel | rows | `_provider` stamped | carries the hardened (P61) schema |
|---|---|---|---|
| **sidebar** | **350** | 67 (19%) | **0 — zero, of 350, ever** |
| email | 261 | 87 (33%) | 69 |
| folder_feed | 9 | 8 | 7 |

**The sidebar channel is the largest single producer (56% of rows) and has never once emitted the
Prompt-61 schema.** Its snapshots lack all seven keys the hardening added — `agency_full_name`,
`government_type`, `government_type_evidence`, `credit_tier`, `financial_projections`,
`sold_price`, `sold_cap_rate` — which is a structural signature, not a coverage shortfall: the
keys are absent from the object, not null within it.

**Today alone: 21 sidebar extractions, 0 stamped, 0 hardened-schema.**

### The "100% stamp coverage" claim was a backfill, not a fixed writer

The addendum's post-93 correction records *"post-82 stamp coverage now 100% (87/87
backfilled)."* Read the daily series and the shape is unmistakable — **2026-08-10: 64 rows,
64 stamped** (the backfill), then a steady decay after it: 08-14 1/9, 08-19 0/4, 08-25 0/1,
**08-26 0/21**.

This is the repo's own documented class — *a one-shot repair of a RECURRING producer is a chore
you repeat silently forever* (`CLAUDE.md` P176) — and it is why the metric read healthy for two
weeks while the writer was never touched.

## 2. The channel split, on OM-class documents only

The addendum's numbers are OM-class, so this restricts identically
(`document_type in (om, flyer, marketing_brochure, offering_memorandum)`), last 30 days:

| channel | OM rows | NOI | cap | tenant | building SF | responsibilities | P61 schema |
|---|---|---|---|---|---|---|---|
| **sidebar** (never hardened) | 76 | **80%** | **87%** | **72%** | **96%** | **78%** | 0% |
| **email** (hardened) | 93 | 52% | 65% | 60% | 65% | 44% | 16% |
| folder_feed | 7 | 29% | 29% | 57% | 29% | 14% | 71% |

**The channel that never runs the hardened prompt outscores the one that does, on every single
field.** That is not evidence the hardening hurt anything — the two channels do not do the same
job. Sidebar reads **structured CoStar page data** captured in an authenticated tab; email runs
**AI extraction over a PDF**. Comparing them measures the input, not the model.

Which is the whole point: **any fleet-wide coverage number rises and falls with how sidebar-heavy
the window is.** The Aug 7–11 window the addendum graded is exactly the window in which the
sidebar backfill landed 64 stamped rows. The 89% may be a mix artifact.

**The honest reading of the hardened channel, measured on its own:** email OM-class NOI **52%**,
tenant **60%**, responsibilities **44%** over 30 days — materially below the 89 / 79 / 79 the
addendum reported fleet-wide. Whether that is a regression, a harder document mix, or simply the
first unmixed measurement **is not yet established** and must not be asserted either way.

## 3. Why the sidebar rows are unhardened — hypotheses tested

Three obvious causes were checked and **all three are ruled out**. Recording them so the next
pass does not re-walk them. (**The answer is at the end of this section** — none of these, and
none of the corrected hypothesis either: it was a second HOST, not a second prompt.)

| hypothesis | verdict | evidence |
|---|---|---|
| Stale Railway deploy serving an old build | ❌ **ruled out** | live `/version` = `bb26453abc01`; `git merge-base --is-ancestor db4fc3fa bb26453a` passes — the deployed build **includes** the Prompt-61 commit. Email rows on the same day stamp correctly from the same service. |
| A second writer into `staged_intake_extractions` | ❌ **ruled out** | repo-wide grep: exactly **one** insert site, `api/_handlers/intake-extractor.js:751`, and `stripNonSaleKeys` + `ensureProviderStamp` are called on the two lines immediately above it. |
| A Power Automate / edge flow writing the table directly | ❌ **ruled out** | no `flow-*.json` references the table. |

**What is NOT yet explained:** `channel='sidebar'` is a declared value of the shared
`stageOmIntake` envelope (`intake-om-pipeline.js:71,151`), and that pipeline calls
`processIntakeExtraction` — the hardened path. So on a static read these rows *should* be
hardened, and they never are.

### ⚠️ The `seed_data` hypothesis was TESTED AND REFUTED (same session)

The obvious candidate was the **`seed_data` passthrough**: the sidebar supplies CoStar hints, and
the 96%-building-SF / 87%-cap profile looks exactly like a structured page capture. **It is wrong,
and the test was one query.**

**The sidebar channel is itself TWO populations** (last 30 days):

| sidebar sub-population | rows | seed keys | OM-class | cap | NOI |
|---|---|---|---|---|---|
| **rich seed** — CoStar *property page* capture | 101 | `address, asking_price, cap_rate, city, doctype, domain, domain_property_id, lease_expiration, source_url, state, tags, tenant_name` | **0** | **0%** | **0%** |
| **bare seed** — document capture | 249 | `tags` only | 76 | 36% (**87%** within the OM subset) | 34% |

Of the 101 rich-seed rows, **65 carry a `cap_rate` in the seed and 0 carry one in the snapshot** —
`cap_identical`, `price_identical` and `tenant_identical` all measure **0**. The seed is *not*
copied into the extraction snapshot. So the high-coverage OM rows come from the **bare-seed**
group, which has no structured hints at all: **sidebar's quality is a genuine extraction, not an
echo of CoStar.**

**This answers the sizing question directly and negatively: seeding the email/PDF path from
structured capture would NOT buy sidebar-like coverage,** because the seed is not where sidebar's
coverage comes from. Do not build that.

**The corrected hypothesis** (still untested, still needs runtime evidence): a **distinct sidebar
document-extraction path with its own, older prompt** — good enough to beat the email path on
recall, predating Prompt 61, and never routed through `buildExtractionPrompt` /
`ensureProviderStamp` / `stripNonSaleKeys`.

**A second, separate finding falls out of the same table:** the 101 rich-seed captures carry
`asking_price`, `cap_rate`, `tenant_name`, `lease_expiration` and a `domain_property_id`, and
**none of it reaches the extraction snapshot** (0% cap, 0% NOI, 0 OM-class, 72 of 101 with no
doctype at all). `CLAUDE.md` states that `sidebar-pipeline.js` writes the domain DBs directly, so
this may be routed elsewhere rather than lost — **that is asserted in the docs and NOT verified
here.** Verify before treating it as either a leak or a non-issue.

**Both remaining questions need Railway logs for one sidebar intake end to end, which is why they
go to Claude Code rather than being guessed at** → prompt `194`.

---

### ✅ ANSWERED (Prompt 194, 2026-08-27) — it was never a second prompt. It was a second HOST.

**Verdict: DEFECT, not design.** The corrected hypothesis above — *"a distinct sidebar
document-extraction path with its own, older prompt"* — is right about the symptom and wrong
about the mechanism. There is no second prompt in this repo, and there never was. There is a
second **deployment**.

**The named branch:** `extension/background.js` resolved the intake host as
`syncConfig.LCC_VERCEL_URL || 'https://life-command-center-nine.vercel.app'` — **six hardcoded
fallbacks** (plus a seventh, `chrome.storage.local.lccHost`, for
`/api/intake-outlook-message`) covering `prepare-upload`, `stage-om` and `document-notify`. The
comment above them stated the reason, and it had become false:

> *"The intake endpoints (prepare-upload, stage-om, extract) live on Vercel, not on the Railway
> MCP server — so `LCC_RAILWAY_URL` is the wrong host to use here. Hardcode the Vercel origin…"*

That was true until **2026-07-20**, when Vercel was retired and `server.js` became the single
source of `/api/*` routing on Railway. **The Vercel deployment was never torn down.** It still
serves, and it still holds the LCC Opps service key — so the sidebar's POSTs did not fail. They
succeeded, against a build frozen before Prompt 61, writing into this very table.

That is why the row shape is *exactly* the Prompt-61 key set **minus the seven keys Prompt 61
added** (43 keys observed vs 50 declared in `EXTRACTION_SCHEMA_KEYS`), and why `_provider` is
absent even though `ensureProviderStamp` is unconditional at the write site: the sidebar rows
never reach that write site.

#### The runtime evidence

Railway logs were not reachable from the session, so the trace was taken one layer down, where it
is actually stronger: **every PostgREST write is logged by Supabase with the calling server's
IP.** For 2026-08-26 the `POST /rest/v1/staged_intake_extractions` log lines join to the DB rows
1:1 on millisecond timestamps. All 25 rows written that day, in order:

| row `created_at` | channel | stamped / hardened | writer IP | host |
|---|---|---|---|---|
| 14:09:10.161 | email | ✅ / ✅ | `152.55.177.106` | **Railway** |
| 14:30:49.058 | sidebar | ❌ / ❌ | `3.235.172.208` | AWS us-east-1 |
| 14:46:59 · 14:49:53 · 14:51:33 | sidebar ×3 | ❌ / ❌ | `32.197.125.63` | AWS us-east-1 |
| 15:25:32.041 | sidebar | ❌ / ❌ | `3.80.87.42` | AWS us-east-1 |
| 15:57:26 · 15:57:40 | email ×2 | ✅ / ✅ | `162.220.232.32` | **Railway** |
| 21:33:08.682 | email | ✅ / ✅ | `152.55.176.197` | **Railway** |
| 21:37:15.841 | sidebar | ❌ / ❌ | `52.205.204.153` | AWS us-east-1 |
| 21:58:03 · 21:59:44 | sidebar ×2 | ❌ / ❌ | `18.206.224.24` | AWS us-east-1 |
| 22:06 → 22:18 (×7) | sidebar ×7 | ❌ / ❌ | `98.84.35.201` | AWS us-east-1 |
| 22:26:26 · 22:31:59 · 22:38:16 · 22:49:51 | sidebar ×4 | ❌ / ❌ | `3.235.147.184`, `100.56.12.176`, `3.84.183.231`, `34.229.11.72` | AWS us-east-1 |

**25 of 25 separate cleanly, with zero crossovers.** Every stamped-and-hardened row was written
from a stable Railway IP (`152.55.x` / `162.220.232.x` — the same ranges that carry 21,365 and
9,217 requests each in a 3-hour window, i.e. the whole app). Every unstamped, pre-P61 row was
written from an **ephemeral** AWS us-east-1 address that appears for 40–255 requests and then
never again — a serverless invocation pool, and each one's path fingerprint is *only*
`workspace_memberships → storage/v1/object/upload/sign/lcc-om-uploads/… → users →
connector_accounts → inbox_items → staged_intake_items → staged_intake_artifacts →
staged_intake_extractions`. That is the stage-om sequence and nothing else.

Two same-hour pairs make it airtight: **14:09 email (Railway, hardened) vs 14:30 sidebar
(lambda, bare)**, and **21:33 email (Railway, hardened) vs 21:37 sidebar (lambda, bare)**. Same
minute of the same day, same table, opposite results — which rules out deploy timing, model
drift, and rate-limit fallback in one stroke.

#### Why it hid for six weeks

- **The stale host does not error.** A retired deployment that still answers 200 and still holds
  the DB key is indistinguishable from the live one at every surface the operator looks at. The
  sidebar "worked" the entire time.
- **The 67 stamped sidebar rows are all backfill.** They date `2026-08-08 … 08-11`, **48 of them
  on a single day carrying `final_provider: 'none'`**, and **0 of 67 are hardened**. There has
  never been one organic sidebar stamp. Prompt 82's own test header attributes the gap to *"the
  sidebar / cloud-fallback channels wrote bare snapshots"* — it named the channel correctly and
  then fixed a code path that channel was not running.
- **Nothing in the repo could see it.** The producer lives in a Chrome extension; the symptom
  lives in a Postgres table; the only object connecting them is a URL string in a comment.

#### The second question — CLOSED, nothing is being discarded

The docs assertion was checked, not repeated. All **101 of 101** rich-seed rows carry a
`domain_property_id`, which means the sidebar pipeline had already resolved and written the
domain property *before* staging the document. Spot-checked both domains:

- gov `properties.property_id = 31516` (`11618 Hwy 70 E`, Clayton NC) carries a live
  `available_listings` row with **`asking_price = 6,500,000`** and **`asking_cap_rate = 0.0700`**
  — byte-for-byte the seed's `$6,500,000` / `7.00%`.
- dia `properties.property_id = 51173` (`227 N Lee St`, Americus GA) exists and was updated the
  same day.

**So the structured CRE data is not lost — `sidebar-pipeline.js` writes the domain DBs directly,
as `CLAUDE.md` says, and the seed on the intake is a receipt for a write that already happened.**
No capture loss on those 101 rows. Question closed; do not build a rescue path for it.

*(One smaller finding falls out and is deliberately NOT fixed here: those 101 intakes are marked
`status='discarded'`, `discard_reason='non_deal_no_address'`, because the disposition reads only
the snapshot and the brochure PDF extracted to all-nulls — even though the seed carries a known
address, domain and `domain_property_id`. That is a disposition bug, separate from this one.)*

#### What shipped

1. **The producer fix.** `extension/background.js` now has ONE owner of the host decision —
   `pickIntakeHost()` / `getIntakeHost()`, resolving `LCC_RAILWAY_URL` **first** (already
   configured; the side panel has used it all along), keeping `LCC_VERCEL_URL` only as a
   deliberate staging override, and defaulting to the Railway origin. All seven call sites route
   through it. Manifest `1.0.44 → 1.0.45`. **⚠️ Operator step: the unpacked extension must be
   reloaded before any of this takes effect.**
2. **The guard.** `test/extension-intake-host.test.mjs` — the retired hostname may appear in
   prose but not in executable code; exactly one `DEFAULT_INTAKE_HOST`, pointing at Railway; no
   intake endpoint built from a literal origin; `LCC_VERCEL_URL` dereferenced exactly once.
   Verified **3/3 RED** against the pre-fix `background.js` and 3/3 green after.
3. **The sweep — a detector, deliberately NOT a backfill.** Migration
   `20261002090000_lcc_p194_intake_extraction_provenance.sql` (applied live) adds
   `v_lcc_intake_extraction_provenance` (per-channel **new-row** coverage over a trailing 7 days)
   and `lcc_check_intake_extraction_provenance()`, cron `lcc-intake-extraction-provenance`
   (06:58 UTC). Its predicate is a **provenance invariant, not a quality metric**: `_provider` is
   stamped unconditionally at the single write site, so a channel writing ≥5 rows in 7 days with
   **zero** stamped did not come through this codebase at all. It opens a deduped
   `lcc_health_alerts(alert_kind='intake_extraction_foreign_writer')` and auto-resolves when
   coverage returns — so this fires for the *next* stale host, forked build or second writer too,
   without knowing anything about prompts. It is **live and open on `intake_channel:sidebar`
   right now**, and will close itself once the reloaded extension writes its first stamped row.

   Auto-resolve proven by a self-rolling-back synthetic gate: stamp one live sidebar row →
   `open_before=1, open_after=0, alerts_resolved=1` → `RAISE` rolled it back, **0 residue**
   verified.

**No backfill was run.** The 350 existing rows stay as they are; they are honestly separable at
query time (absent `_provider` = not written by us) and re-extracting them would be the same
one-shot repair that produced the 08-10 spike. Re-grading W5.3 is still backlog **L8** and still
comes after the channel actually separates.

### ⚠️ And the lesson generalises past this table

"Split by channel" was right and **not sufficient** — the channel that mattered had to be split
again. A population defined by *where a row entered* can still contain two populations defined by
*what kind of thing entered*. **Before quoting any per-channel number, check whether the channel
has sub-populations with different input types** — the unsplit sidebar average (36% cap) and the
document-only average (87%) differ by 51 points and describe different things.

## 4. What this changes

1. **`staged_intake_extractions` is not one population.** Every future intake grade must **split
   by channel** and say which one it is grading. An unsplit number is uninterpretable.
2. **The W5.3 verdict reverts to OPEN** for the email/PDF path. The 2026-08-11 "validated"
   upgrade stands only as *"not measured against the right population"* — it is not overturned,
   it is unproven. Per the standing doctrine the note is corrected in the same change
   (`ROLLOUT_STATUS.md` W5.3, `PLANNED-BACKLOG.md` L8).
3. **`_provider` stamp coverage is a live defect, not a closed one.** Assert on the **rate for
   new rows in the last 7 days**, never on a cumulative percentage a backfill can carry.
   *(P194: that rate is now a view — `v_lcc_intake_extraction_provenance` — and a 0% channel
   opens a health alert. Before the fix: sidebar 0/23, email 21/21, folder_feed 5/5.)*
4. **Sidebar's high structured coverage is an asset, not a problem.** If those fields are as good
   as they look, the question is whether the email path should seed from equivalent structured
   capture — not whether sidebar should be "fixed" to look like email.
5. **P194 adds one more, and it is the general one: a retired deployment that is still reachable
   and still holds live credentials is a SECOND WRITER.** Retiring a platform is not finished when
   traffic moves — it is finished when the old origin can no longer answer. Until then every
   client holding the old URL keeps running the old code, successfully, against production data.
   Grep for a retired origin in *clients* (extensions, flows, scripts, docs), not just in the repo
   that used to deploy there.

## 5. Reproduction queries

```sql
-- channel population + hardened-schema signature
select i.raw_payload->>'channel' chan, count(*) n,
 count(*) filter (where e.extraction_snapshot->'_provider' is not null) stamped,
 count(*) filter (where e.extraction_snapshot ? 'government_type') p61_schema
from staged_intake_extractions e join staged_intake_items i on i.intake_id=e.intake_id
where e.created_at > now() - interval '30 days' group by 1 order by n desc;

-- the stamp decay after the 2026-08-10 backfill (read the DAILY rate, never the cumulative)
select e.created_at::date d, count(*) n,
 count(*) filter (where e.extraction_snapshot->'_provider' is not null) stamped
from staged_intake_extractions e join staged_intake_items i on i.intake_id=e.intake_id
where i.raw_payload->>'channel'='sidebar' and e.created_at > now() - interval '21 days'
group by 1 order by 1;
```

The OM-class coverage query is §2's, restricted on
`lower(extraction_snapshot->>'document_type') in ('om','flyer','marketing_brochure','offering_memorandum')`.

## 6. Status of the rest of the W5.3 / Ollama-hygiene thread

The **hygiene half (W8) is complete** — U1 junk pre-screen, U2 dup-pairs, U3 link propagation,
U4 findings report, U5 naming hygiene all shipped and all read `on`. Its open items are
production-health, not build: the two lanes that have written nothing (`PLANNED-BACKLOG.md`
V1/V2, both re-confirmed stalled today).

**The W5.3 half is what was still open, and this is it.**
