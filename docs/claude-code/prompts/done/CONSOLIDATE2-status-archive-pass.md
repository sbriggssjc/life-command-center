# CONSOLIDATE2 — STATUS.md is 8,912 lines against its own ~8,000 rule

> **CONSOLIDATE1 did the backlog and the method worked** — 116 rows archived, 12 folded, open-ID set
> provably unchanged, and the one trap it was written to avoid (`~~` matching two populations) was
> real. **This is the same pass for the bigger file**, which is the single biggest obstacle to a cold
> chat picking the work up clean.

**Repo:** `life-command-center` · **Files:** `docs/claude-code/STATUS.md`, a new `docs/history/`
archive. **No code, no DB, no migrations.**

---

## 1. Measured shape (2026-09-08 — re-measure)

| | |
|---|---:|
| `STATUS.md` lines | **8,912** |
| dated `## 2026-…` entries | **216** |
| entries dated 2026-08 | 104 |
| entries dated 2026-09 | 112 |
| existing archives in `docs/history/` | 3 (`…2026-08-03_to_08-12`, `…08-20_to_08-21`, `…08-20_to_08-28_cowork-block`) |

The file's own header states a **~8,000-line rule**; the last archive was cut on 2026-09-02 for
exactly this reason.

---

## 2. 🚨 The trap, and it is written down in the last archive's own header

> ⚠️ *"`STATUS.md` is NOT strictly date-sorted (two windows append to it) — this block was chosen as
> a contiguous span, not a date range."*

**Two windows append to this file** — the data-process/automation window (lettered prompts) and the
app-audit window (numeric + `C*`/`DOC*`/`N*`). **Newest-first ordering therefore holds only
locally.** Live proof: the first `2026-08` heading is at **line 3985**, and a `2026-09-01` entry sits
**below it at line 5020**.

- ⚠️ **DO NOT archive "everything dated before X."** That predicate will strand September entries in
  the archive and leave August entries in the live file, and it will look like it worked.
- **Choose a CONTIGUOUS SPAN BY LINE**, exactly as the 2026-09-02 cut did, and **name the span in the
  archive header** rather than describing it as a date range.
- **Print the first and last heading of the chosen span before moving anything**, so the boundary is
  reviewable.

---

## 3. Units

### Unit 1 — choose and state the span

Target roughly the oldest contiguous ~4,000–4,500 lines, landing the live file near the ~8,000 rule
with headroom. **State the exact line range and its first/last headings.** Do not optimise for a
round number of lines at the cost of splitting an entry.

⚠️ **Never split a `## ` entry across the boundary.** The span ends at a heading boundary or it is
wrong.

### Unit 2 — the safety check, which is the whole unit

The previous archive's header states the standard: *"Nothing was dropped. Every still-open item from
this span was already carried into `PLANNED-BACKLOG.md` and the canonical topic pages."*

**Prove that for this span, do not assert it.** For every entry in the span, confirm any still-open
item it describes has a home outside STATUS — a `PLANNED-BACKLOG.md` row, or a canonical page.
✅ **This is materially easier than last time because CONSOLIDATE1 just made the backlog clean** and
the arcs each have a canonical page (`field-provenance-ladder.md`, `costar-sidebar-capture-pipeline.md`,
`entity-identity-and-dedup.md`, `gov-property-duplicates.md`, `edge-function-deploy-drift.md`,
`producer-health-and-ci-enforcement.md`, `tier0-owner-contact-system.md`, …).

🚨 **Where an entry is the ONLY record of something still open, that is a finding, not an
obstacle**: file the backlog row or update the canonical page **first**, then archive. Report every
such rescue — **an empty rescue list is only credible with the method that produced it** (CONSOLIDATE1
reported empty and said how it checked; match that standard).

### Unit 3 — the pointer, so nothing becomes unfindable

`STATUS.md`'s header already lists its archives. **Add the new one with a one-line description of
what the span contains**, in the same form as the existing three.

---

## 4. Out of scope

- **No re-wording, re-dating or re-ordering of retained entries.** Moving only.
- **No deletion.** Verbatim move.
- **No `PLANNED-BACKLOG.md` changes** except rows created by Unit 2's rescue — and each of those is
  reported.
- **No attempt to make the file date-sorted.** Two windows append to it; that is the reality, and
  imposing an order would rewrite history to look tidier than it was.

## 5. Deliverables

1. The archive file, with a header naming the **line span**, its first/last headings, and what it
   contains.
2. `STATUS.md` under ~8,000 lines with the archive listed in its header block.
3. **Line conservation**, shown: `lines_before == lines_kept + lines_archived` (± the header text
   added), and **entry conservation** by heading count.
4. **The rescue list** from Unit 2 — every item whose only record was in the span, with where it now
   lives. If empty, **say how that was checked.**

## 6. Verify on

- **Entry-count conservation by heading**: every `## 2026-…` heading in the span is present in the
  archive, asserted by heading text, not by count.
- **The rescue list**, which is the "nothing was dropped" guarantee.
- ⚠️ **Not on the line count.** A shorter STATUS that stranded an open item is a worse document —
  and the date-sort trap in §2 will produce exactly that while looking correct.
