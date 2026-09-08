# DOCMAP2 — extend DOCMAP1's technique to the ~990 files it did not reach

> **DOCMAP1 classified `docs/architecture/` (181 files) and stated its own boundary honestly:
> 87 of 181 verdicts were `title+skim`, and only 5 files were verified against live state.** It also
> named the technique that actually worked — **grep the whole surface for ONE known-retired thing at
> a time** — which found all 4 STALE documents in a single pass. **This unit applies that technique
> to the rest of the repo.**

**Repo:** `life-command-center` · **No code, no DB, no migrations.**

---

## 1. What DOCMAP1 left, in its own words

- **Files outside `docs/architecture/` were not classified at all**: `docs/audits/` (108),
  `docs/setup/`, `docs/os/canon/`, `docs/copilot/`, `docs/data-quality/`, `docs/flows/`,
  `docs/resolver/`, and the repo-root `.md` files (`SPEC_*.md`,
  `SALESFORCE_LCC_INGESTION_PLAN.md`, `WRITE_SURFACE_POLICY.md`, …). **~990 files.**
- **`docs/claude-code/done/` (84 files)** handled as one unit with a README banner, not individually.
- **87 `title+skim` rows** in `docs/architecture/` — *"any of them could carry the same class of stale
  claim the Vercel grep found, just under a different retired dependency, flipped flag, or superseded
  schema."*

---

## 2. ⚠️ The trap, and Cowork walked into it while sizing this unit

Sizing the residue, a grep found **58 docs mentioning Vercel outside `docs/history/`**, of which
**23** matched a retirement-phrase list — reading as *"35 candidate false-current claims."*

**Spot-checking one refuted it.** `docs/architecture/infrastructure-topology.md` is accurate and
explicitly headed **"Why LCC moved off Vercel"** — it simply phrases the retirement outside the
grep's vocabulary. **35 was an inflated upper bound produced by a narrow phrase list, not a defect
count.**

🚨 **So: a mention is a CANDIDATE, never a defect.** The verdict requires reading the sentence and
asking *does this document tell a reader to do something that is now false?* Same class as
CONSOLIDATE1's `~~` trap and the `lpad('',5,'0')` zip trap — **a comparator that cannot express the
question returns a plausible number.** Report candidates and defects as **two separate numbers**,
always.

---

## 3. Units

### Unit 1 — the retired-dependency sweep

Enumerate the "known-retired / renamed / superseded" facts from `CLAUDE.md` and the canonical pages,
then grep the whole doc surface for each. Starting list (extend it — the enumeration is part of the
work):

| term | docs outside `history/` mentioning it |
|---|---:|
| `Vercel` / `vercel.json` | 58 / 16 |
| `SOS-direct` | 20 |
| `CONTACTS_HUB` (gov vs ops cutover) | 10 |
| `owner-contact-websearch` (paused) | 5 |
| `GOV_STATE_SIGNALS` (merged into `GOV_SIGNALS`) | 5 |
| `queue_v2_enabled` | 4 |
| `exec_sql` | 4 |

**Per hit: read the sentence, classify CANDIDATE vs DEFECT, and for a DEFECT cite the measurement or
the `CLAUDE.md` line that refutes it.** Fix in place with a banner, preserving the original text —
the DOCMAP1 convention.

⚠️ **Add terms that are RENAMES, not just retirements** — a doc naming a dropped table or an old
function name misdirects exactly as badly. `CLAUDE.md` is full of these (e.g. the
`gov_merge_property` → `gov_merge_property_apply` rename, `GOV_STATE_SIGNALS` → `GOV_SIGNALS`).

### Unit 2 — classify `docs/audits/` (108) at index level, not file level

Audits are point-in-time by nature — **an audit is not stale for being old**, it is stale if it is
cited as current state. **Do not classify 108 audits individually.** Instead: confirm each is
discoverable from its arc's canonical page or the map, and **banner the directory** with the rule
that an audit records a measurement on a date and is superseded by its canonical page.

### Unit 3 — the repo-root `.md` files

10 files at repo root (`SPEC_*.md`, `SALESFORCE_LCC_INGESTION_PLAN.md`, `WRITE_SURFACE_POLICY.md`,
…). ⚠️ **`CLAUDE.md` says the repo root is code and config and "do not add a new `.md` there"** —
so every one of these predates that rule. **Classify each: fold into a canonical page, move to
`docs/`, or keep with a stated reason.** These are the highest-visibility files in the repo; a stale
one at root misdirects a future chat before it reaches `docs/` at all.

---

## 4. Out of scope

- **`docs/history/`** — archive, leave it.
- **`docs/capital-markets/`** (156) — separate product surface.
- **No deletion.** Banner, move, or fold.
- **No re-classification of the 181 files DOCMAP1 already did**, except where a Unit 1 grep turns up
  a defect in a `title+skim` row — **which is expected, and is the point.**

## 5. Deliverables

1. **Per term: candidates found, defects confirmed, defects fixed** — three numbers, never one.
2. The `docs/audits/` directory banner + discoverability check.
3. The repo-root classification with a decision each.
4. **An explicit NOT REACHED boundary**, in DOCMAP1's format. That section was its most useful
   output; match it.

## 6. Verify on

- **Defects fixed, with the refuting citation each** — not "files reviewed".
- ⚠️ **A term yielding many candidates and zero defects is a RESULT** (as `Vercel` largely was in
  `docs/architecture/`), not a failed sweep — record it so the next pass does not re-grep it.
- ⚠️ **Not on the number of files touched.**
