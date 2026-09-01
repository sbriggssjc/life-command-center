# Property metadata coverage (dia) — the canonical entry point

> **START HERE for anything about `year_built` / `building_size` / `land_area` / `tenant` coverage,
> the `property_metadata_backfill_queue`, the retired assessor lane, or "should we point Ollama or
> the sidebar at this?"** Everything measured, decided and rejected on this topic lives here.
>
> **Status 2026-09-01: the assessor lane is RETIRED. No build is queued. The gap is OPEN and
> deliberately UNOWNED.** Read §5 before proposing a source — three of them are already measured
> and refuted, and one of those refutations is the reason the lane was retired.

**Live state · backlog rows `B6d-assessor-*` · invariant `I12` · playbook Class 12b.**

---

## 1. The gap, as it actually stands

`dia.property_metadata_backfill_queue` — **1,365 rows, all enqueued 2026-05-21**, 703 `captured`
and **662 `open`**. Re-measured against `properties` on 2026-09-01, so these are live gaps, not the
May snapshot in `missing_fields`:

| field | queue rows | still genuinely missing |
|---|---:|---:|
| `land_area` | 409 | **393** (neither `land_area` nor `lot_sf`) |
| `year_built` | 404 | **388** |
| `building_size` | 108 | **100** |
| `tenant` | 95 | — |

**The concrete cost is narrow and worth stating plainly: 82 properties have a recorded sale price
and no building size, so they cannot produce a $/SF comp.** That is the CM-book–facing damage.
The `year_built` and `land_area` gaps are descriptive, not valuation-blocking.

⚠️ **`missing_fields` is a 2026-05-21 snapshot and is now stale** — 16 rows listed as missing
`land_area` have since been filled by other paths. **Always re-derive against `properties`; never
report the array.**

## 2. What the queue is, structurally

- **A one-shot with no enqueuer.** `max(enqueued_at)` = 2026-05-21. Nothing has enqueued since, so
  even a working drain empties 662 rows once and then runs on empty forever (Dead-End Class 8; the
  mirror of Class 2).
- **Its drain has never been scheduled.** Operator-confirmed on Railway 2026-09-01: the service
  exists on *both* `life-command-center` and `tranquil-delight` deployments and **neither carries a
  Cron Schedule**. It is deployable code that nothing runs.
- **Self-resolution through other ingestion has COLLAPSED.** ⚠️ The cumulative "51% self-resolved"
  figure is true and misleading — the monthly series is **May 14 → Jun 174 → Jul 510 → Aug 5 →
  Sep 0.** July was a burst, not a run rate. **Do not plan on other paths absorbing this.**

## 3. Why the assessor lane was retired (2026-09-01)

Three findings, all from building the marker (`B6d-assessor-marker`, PR sbriggssjc/Dialysis#7385).
The DB-side ones were verified live in this repo before being recorded.

1. 🚨 **There is no county assessor adapter.** `src/assessor_enrichment.py` contains **zero HTTP
   calls to any county**; its one external request asks **gpt-4o to recall parcel facts from
   memory**. A model cannot know a specific parcel's year built — it can only produce a plausible
   number, which this would have written into `properties` as a fact. **`enriched: 0` is what saved
   us, not a guard.** ⚠️ The gov repo had already rejected LLM-recall enrichment on exactly these
   grounds (ORE Phase A1) and nobody checked the dia side.
2. 🚨 **The largest single blocker is a unit mismatch, not a coverage gap** — see §4.
3. **500 of 662 (75.6%) have no parcel number**, the key the module's own docstring depends on.

**Ceiling at perfect accuracy: 236 of 662 (36%) closable at all.** A lane that is keyless,
fabricating, and capped at 36% cannot be graded into working.

**What retiring does and does not mean.** It retires *the assessor*, not *the gap*. The ~646
genuine gaps in §1 remain open with **no source assigned**. That is a deliberate, documented
ceiling — which is worth more than a job that runs weekly and produces nothing.

**What did ship, and is worth keeping:** the marker itself. All four outcome paths now write
`attempts+1`, `last_attempt_at` and a prefixed reason (`skip:` / `source:` / `error:`), and
selection reads it back (30-day cooldown, `last_attempt_at ASC NULLS FIRST`) — **two-run overlap
25/25 → 0/25**. It also fixed three defects the silence was hiding, including
`fields_updated += len(fields)` against a function returning an `int`: **the first genuine fill this
worker ever produced would have raised `TypeError`.**

## 4. The unit mismatch (invariant I12)

`dia.properties` carries **`land_area` in ACRES and `lot_sf` in SQUARE FEET** — the same measurement
twice, with no conversion and no reconciliation. Across all 3,702 rows holding both:

| ratio `lot_sf / land_area` | rows | share |
|---|---:|---:|
| **exactly 43,560 ±1** | 3,373 | **91.1%** |
| within 1% | 258 | 7.0% |
| within 10% | 44 | 1.2% |
| genuine disagreement | 27 | 0.8% |

**0 of 3,702 are equal.** The queue's closure trigger watches `land_area`; the assessor writer
filled `lot_sf` — so **223 of 662 (34%) carried only gaps that writer could never close.** Nothing
errors: the writer succeeds and the gap persists.

⚠️ **The conversion is PLUMBING, NOT YIELD, and this was initially recorded the other way.**
Measured 2026-09-01: **zero** `dia.properties` rows have `land_area IS NULL AND lot_sf IS NOT NULL`,
so `land_area = lot_sf / 43560` **fills 0 rows today**. It changes what a *future* source could
close (236 → 439 of 662). And any such conversion is **fill-blanks only** — the 27 genuine
disagreements must never be overwritten.

⚠️ **A LATENT version of the same defect sits in the capture writer** —
`sidebar-pipeline.js` line ~4597 sets `land_area` **only when the CoStar string matches `/AC/i`**,
while `lot_sf` is set from either form. A CoStar page rendering "Land SF" would populate `lot_sf`
and leave `land_area` NULL, i.e. mint a permanently unclosable row. **Measured, it has never bitten
— 0 such rows exist fleet-wide — so it is a latent hazard, not the cause of the 393 land_area
gaps.** Record it, guard it, do not present it as the explanation.

## 5. Sources measured and REFUTED — read before proposing one

Scott asked (2026-09-01) whether local Ollama, the LCC sidebar Chrome extension, or some
combination maximises leverage here. **All three were measured against this population first.**

| option | reach on the 662 | verdict |
|---|---:|---|
| **Ollama over our own documents** | **9** with usable text (23 with any document at all) — **1.4%** | ❌ **No corpus to read.** P131 case (b) is empty. |
| **Sidebar capture, in the flow** | **6** are `status='active'` listings | ❌ Essentially zero natural encounters. |
| **Sidebar capture, deliberate lookup** | 662 manual searches, **1 carries a listing URL** | ❌ 617 of 662 are **sold**, 86 superseded. Deliberate lookup of stale comps. |

⚠️ **The seductive wrong number here was "554 are on-market listings."** They are rows in
`available_listings`, but **211 are `data_source='synthetic_from_sale'`** — synthesized from a sale
record, never marketed — and by `status` only **6** are active. *Check what a population IS before
routing work to it.*

⚠️ **The extension is NOT the problem — it already extracts all three fields**
(`extension/content/costar.js`: `year_built` ~1451, `square_footage` ~1446, `lot_size` ~1476, which
handles both "Land Acres" and "Land SF"). **The 393 `land_area` gaps have neither column populated,
i.e. these properties were never captured at all.** This is an **absence of capture**, not a mapping
loss — so a mapping fix buys nothing here.

## 6. What is actually worth doing

**Nothing, on this 662, right now** — and that is the recommendation, not an omission. The
population is stale sold comps with no documents, no live surface and no key. The honest move is a
documented ceiling.

The two things that *do* carry leverage are **forward, not backfill**:

1. **Capture-at-ingest.** These fields should land when a property is first captured, not be
   backfilled 3.5 months later. The extension already extracts them; the question worth answering is
   whether every ingest path lands them, and that is a different (and live) population from this
   queue.
2. **Close the I12 asymmetry in the capture writer** so a SF-denominated CoStar page can never mint
   another permanently-unclosable row. One-line, latent today, cheap.

**And if the 82 no-SF sale comps matter for a specific book, treat that as a targeted, value-ranked
ask — not as draining this queue.** 82 deliberate lookups with a named CM purpose is a defensible
use of Scott's time; 662 is not.

## 7. Where else to look

| for | read |
|---|---|
| the invariant this violates | `docs/architecture/data-coherence-invariants.md` **I12** |
| the worker-with-no-trace class | `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` **Class 12b** |
| the fabrication doctrine | `CLAUDE.md` → *Data-write discipline* → *an "enrichment" that asks a model to recall a fact* |
| open rows | `docs/os/PLANNED-BACKLOG.md` — `B6d-assessor-landarea`, `B6d-assessor-doc`, `B6d-assessor-capture` |
| the run log | `docs/claude-code/STATUS.md`, 2026-09-01 entries |
