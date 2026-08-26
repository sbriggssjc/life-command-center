# W5.3 re-opened — the intake grade has been averaging two different channels

**Measured 2026-08-26 (Cowork), live against LCC Opps `xengecqvemvfknjvbvrq`.**
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
pass does not re-walk them:

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
4. **Sidebar's high structured coverage is an asset, not a problem.** If those fields are as good
   as they look, the question is whether the email path should seed from equivalent structured
   capture — not whether sidebar should be "fixed" to look like email.

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
