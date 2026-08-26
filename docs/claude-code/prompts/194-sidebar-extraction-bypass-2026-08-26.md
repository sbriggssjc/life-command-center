# Prompt 194 — The sidebar channel has never run the hardened extraction prompt. Find out why.

## The measurement (already done — do not re-derive it, verify it and move on)

Live on LCC Opps `xengecqvemvfknjvbvrq`, last 30 days, `staged_intake_extractions` joined to
`staged_intake_items.raw_payload->>'channel'`:

| channel | rows | `_provider` stamped | carries the P61 schema |
|---|---|---|---|
| **sidebar** | **350** (56%) | 67 | **0** |
| email | 261 | 87 | 69 |
| folder_feed | 9 | 8 | 7 |

The seven Prompt-61 keys (`agency_full_name`, `government_type`, `government_type_evidence`,
`credit_tier`, `financial_projections`, `sold_price`, `sold_cap_rate`) are **structurally absent**
from every sidebar snapshot — not null within the object, missing from it. That is a different
prompt, not a coverage shortfall. Today alone: **21 sidebar extractions, 0 stamped, 0 hardened.**

Full write-up, including the OM-class coverage split and the reproduction queries:
`docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`.

## Ruled out — do NOT re-walk these

1. **Stale deploy.** Live `/version` = `bb26453abc01`;
   `git merge-base --is-ancestor db4fc3fa bb26453a` passes — the deployed build **includes** the
   Prompt-61 commit. Email rows from the same service on the same day stamp correctly.
2. **A second writer.** Repo-wide grep: exactly **one** insert site,
   `api/_handlers/intake-extractor.js:751`, with `stripNonSaleKeys(mergedSnapshot)` and
   `ensureProviderStamp(...)` on the two lines immediately above it.
3. **A flow writing the table directly.** No `flow-*.json` references `staged_intake_extractions`.

## The puzzle

`channel='sidebar'` is a declared value of the shared `stageOmIntake` envelope
(`api/_shared/intake-om-pipeline.js:71,151`), and that pipeline calls `processIntakeExtraction` —
the hardened path. On a static read these rows *should* be hardened. They never are, and they
never have been.

### ⚠️ The `seed_data` hypothesis is REFUTED — do not spend time on it

The obvious answer was a `seed_data` passthrough. It was tested and it is wrong. **The sidebar
channel is itself two populations:**

| sidebar sub-population | rows | OM-class | cap | NOI |
|---|---|---|---|---|
| **rich seed** — CoStar *property page* capture (`asking_price`, `cap_rate`, `tenant_name`, `lease_expiration`, `domain_property_id`) | 101 | **0** | **0%** | **0%** |
| **bare seed** — document capture (`tags` only) | 249 | 76 | 36% (**87%** in the OM subset) | 34% |

**65 of the 101 rich-seed rows carry a `cap_rate` in the seed; 0 carry one in the snapshot.**
`cap_identical` / `price_identical` / `tenant_identical` all measure **0**. The seed is never
copied into the snapshot, and the high-coverage OM rows are the ones with *no* structured hints.
**Sidebar's quality is a real extraction, not an echo of CoStar.**

**Corrected hypothesis:** a **distinct sidebar document-extraction path carrying its own, older
prompt** — good enough to out-recall the email path, predating Prompt 61, never routed through
`buildExtractionPrompt` / `ensureProviderStamp` / `stripNonSaleKeys`. Find that path.

Candidates worth tracing, in rough order:
- **`api/_handlers/sidebar-pipeline.js` and the "OM live-tab path"** `CLAUDE.md` refers to — the
  most likely home of a second prompt. Start here.
- the `defer_extraction` / `intake-extract-drain` branch,
- the extraction **race timeout** path in `intake-om-pipeline.js` (~line 529–563) — what gets
  written when the race times out,
- the `!context.forceReextract` **reuse short-circuit** (`intake-extractor.js:589`),
- `mergeExtractions` behaviour when the only input is a seed.

### Second, separate question while you are in there

The 101 rich-seed CoStar **page** captures carry `asking_price`, `cap_rate`, `tenant_name`,
`lease_expiration` and a `domain_property_id`, and **none of it reaches the extraction snapshot**
(0% cap, 0% NOI, 0 OM-class, 72 of 101 with no doctype at all). `CLAUDE.md` says
`sidebar-pipeline.js` writes the domain DBs directly, so this may be routed elsewhere rather than
dropped. **That is a docs assertion, not a verified fact — check it.** If the structured CRE data
IS being discarded, that is a real capture loss on 101 rows in 30 days and worth its own fix. If
it is being written to the domain DBs, say so and close the question.

## What I want

1. **Runtime evidence, not a static read.** Trace **one** sidebar intake end to end through the
   Railway logs and say precisely which branch persists its snapshot. This is why it is your job
   and not Cowork's — Cowork has DB and repo access but no runtime logs.
2. **Name the branch, then decide whether it is a defect or a design.** It may be entirely correct
   for a structured CoStar capture to skip an LLM extraction — in which case the defect is that it
   **writes to the same table under the same schema-free shape**, making every grade over that
   table uninterpretable. Say which it is.
3. **If it is a design:** the fix is *provenance*, not forcing sidebar through an LLM. Stamp the
   snapshot with its real origin (`_provider = {final_provider:'none', source:'sidebar_capture'}`
   or a sibling marker) so the two populations are separable at query time, and update
   `docs/architecture/om_intake_pipeline.md` to state that the three channels converge on the
   pipeline but **not** on the prompt.
4. **If it is a defect:** fix the writer, and pair it with a sweep — the post-93 "100% stamp
   coverage" was a **backfill**, and the daily rate decayed straight back to zero (08-10 64/64 →
   08-26 **0 of 21**). A one-shot repair of a recurring producer is a chore repeated silently
   forever (P176). Backfilling again without fixing the producer is explicitly **not** the ask.
5. **Report honestly.** `already_stamped` is a re-discovery tally, not throughput — report the
   **new-row stamp rate over the last 7 days, split by channel**, before and after.

## Guardrails

- **Do not "fix" sidebar by making it look like email.** Its structured coverage is an asset; if
  those fields are as good as they read, the interesting question is whether the email path should
  seed from equivalent structured capture. Do not act on that here — just don't foreclose it.
- Additive/reversible only. No backfill without the producer fix landing in the same change.
- **Do not re-grade W5.3 in this prompt.** The grade is meaningless until the channels are
  separable; it is backlog **L8** and it comes after this.

## Optional second unit — only if you want it in the same PR, otherwise say so and skip

**CI runs no tests.** `.github/workflows/boot-check.yml` is the only PR check and it runs
`npm run check:boot`. The 4,551-test suite never executes on a PR — which is how #1786 merged green
with a red suite and duplicated `<script>` tags. You offered this in the Prompt 139 response and
correctly did not widen that PR on your own. **Scott's answer is: yes, ship it as its own PR** — a
`pull_request` job running `npm ci && npm test`, no secrets, no network, no DB. Keep it separate
from the intake work above.

## Deliverables

- The named branch + a verdict (defect vs design), with the log evidence quoted.
- The fix or the provenance stamp, whichever the verdict calls for, plus its sweep.
- `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md` §3 updated with the answer —
  the hypothesis table has a row waiting.
- A `CLAUDE.md` footgun entry if the cause generalises beyond this one channel.
