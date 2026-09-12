# HP1-P2a — 94% of the homepage Inbox is data hygiene. Route it to the surface that already exists.

**Repo: life-command-center** (owns LCC Opps `xengecqvemvfknjvbvrq`). The last untouched symptom of Scott's
original HP1 report. **This is a ROUTING change, not a build** — the destination surface already exists, is
value-ranked, and already has both a per-item and a bulk path.

**Read first:** `docs/os/PLANNED-BACKLOG.md` §HP1 (`HP1-P2a` … `HP1-P2e`, `HP1-badge`) ·
`docs/claude-code/STATUS.md` 2026-09-12 entries · `api/queue.js::v2GetInbox` (~line 514) and the `v_inbox_triage`
view · `api/operations.js` §R28/R29/R59 — `v_lcc_contact_qualify_worklist`, `bridgeQualifyContact`,
`bridgeQualifyContactsBulk`, `_contactQualifyDeps` · `api/_handlers/sidebar-pipeline.js:2114` (the
`contact_misparse_review` writer) and `:2262` (`new_contact_qualify`) · `CLAUDE.md` Core doctrines (**P131** a
coverage gap is filed never faked; **B6a** a skipped step must emit; **P159a** rendered count ≠ population).

---

## Why this, why now — Scott's own words, and the live measurement

> *"My work and inbox have topics that are well behind where the actual status of each deal is or still contain
> data and emails and notices that should be automated and not the top of our inbox's homepage. The homepage
> should be a view of the work that needs the broker's attention and review in priority order."*

The 500 is fixed (HP1-P0). The stale-deal half is fixed and watched (HP1-P1a-fix, HP1-P1d). **This is the third
symptom, and nothing has touched it.**

Measured live **2026-09-12**, `inbox_items WHERE status='new'`:

| source_type | n | is this broker judgment? |
|---|---|---|
| `new_contact_qualify` | **876** | No — captured CoStar contacts awaiting activation |
| `contact_misparse_review` | **111** | No — parser output awaiting correction |
| `email_om` / `sidebar_om` / `folder_feed_om` | 33 | **Yes** |
| `email_alert` (`domain='personal'`) | 20 | No — see HP1-P2b |
| `flagged_email` | 12 | **Yes** |
| **TOTAL** | **1,052** | **65 are broker work. 987 (93.8%) are not.** |

⚠️ **This is not a classifier problem and must not be treated as one.** `inbox_items` holds **13,496** rows in a
non-`new` status — the machine already disposes at enormous scale. The 987 are not misclassified; they are
*correctly* classified as hygiene and then *shown on the wrong surface*.

✅ **The destination already exists.** `v_lcc_contact_qualify_worklist` is a junk-filtered, value-ranked worklist
over exactly these rows (**865 rows live**, i.e. 876 minus the 11 the view already drops as junk/orphan/
firm-as-person). `bridgeQualifyContact` works one; `bridgeQualifyContactsBulk` drains the high-confidence subset
in a pass. **Build nothing that duplicates these.**

---

## 1. Decide WHERE the exclusion lives — and justify it

- **(a) At `v_inbox_triage`** — excludes hygiene from every consumer of the view.
- **(b) In `v2GetInbox` (`api/queue.js`)** — excludes it from the homepage lane only.

**Enumerate every consumer of `v_inbox_triage` before choosing**, and say what each one would lose under (a).
If another surface legitimately wants the hygiene rows, (b) is the answer. State the reasoning; don't assume.

## 2. 🚨 Excluding is not hiding — this is the gate that makes or breaks the change

A count that silently drops 987 rows is the **P159a** defect this same module already carries in `HP1-badge`, and
a filter that emits nothing is the **B6a** skipped-step failure. So:

- The homepage Inbox must render **one persistent pointer row**, not an absence:
  *"Data hygiene — 987 items (876 contacts to qualify · 111 misparses) → "* linking to the existing surfaces.
- The count in that pointer must be the **true population**, not a capped page length. Do not repeat HP1-badge.
- The Inbox header's own count must then honestly read **65**, and must say what it is counting.

**If you cannot render the pointer, do not ship the exclusion.** A quiet homepage that is quiet because 987 rows
were filtered out of view is worse than a loud one.

## 3. ⚠️ `contact_misparse_review` — verify the destination exists BEFORE routing it off

`new_contact_qualify` has a proven surface. **`contact_misparse_review` (111 rows) may not.** It is written at
`api/_handlers/sidebar-pipeline.js:2114`; find where it is *read and resolved*. If there is no working review
surface for it, then routing it off the homepage **deletes the only place it is visible** — file the gap (P131),
route only `new_contact_qualify`, and say so. **Do not build a new misparse surface in this prompt.**

## 4. Normaliser drift, found in passing — name it, don't silently absorb it

`inbox_items.domain` carries **four spellings for two domains**: `government` (505) / `gov` (8), `dialysis` (314)
/ `dia` (1), plus **NULL** (48+). A rule keyed on `domain` strands 57 rows. **Key this change on `source_type`,
which is clean** — and file the domain drift as its own row rather than fixing it here.

## 5. Measure before and after — this is the deliverable

Paste both readings, from the live DB, not from fixtures:

1. `select source_type, count(*) from inbox_items where status='new' group by 1 order by 2 desc` — before.
2. The **actual homepage Inbox response** after the change: the item count, the header count, and the pointer
   row's count, with the rendered payload.
3. Proof the hygiene rows are still **reachable and workable** at their own surface afterwards — a count from
   `v_lcc_contact_qualify_worklist` and one successful `bridgeQualifyContact` round trip (rolled back or on a
   throwaway row).

⛔ **CORRECTED AFTER THE FACT (2026-09-12) — this target was wrong and it contradicted §3 of this same prompt.**
It read *"Target: the homepage Inbox shows 65 items and one pointer"*, which silently assumed **both** hygiene
lanes would leave — while §3 above explicitly instructed the opposite if `contact_misparse_review` had no
resolution surface. It has none, so it correctly stayed, and `email_alert` (HP1-P2b's scope) stayed too.
**The right answer was 182, and CC reported it rather than bending the filter to hit my number** — which is what
the sentence below actually asks for, and the reason to keep that sentence in every prompt:

> If it shows anything else, report the number and stop rather than adjusting the filter to hit it.

## 6. What NOT to do

- Don't bulk-run `bridgeQualifyContactsBulk` to "drain" the 987. Draining is a separate decision with real
  writes (it links people to entities and stamps cadences); this prompt **moves a surface**, it changes no data.
- Don't touch `inbox_items.status` on any row. Nothing here is dispositioned.
- Don't build a new worklist, view, or page. Three already exist.
- Don't implement `priority_score` ranking here — that is **HP1-P2c/P2e**, and it comes *after* this. **Ranking a
  list that is 94% noise is ranking noise.** Say nothing about ordering beyond leaving the existing
  `received_at.desc` alone.
- Don't touch the `email_alert`/announcement classes — that is **HP1-P2b**.

## Guard + ship

Tests: the exclusion predicate, the pointer row rendering **with a true population count** (a test that fails if
the pointer is absent or shows a capped number), and a consumer test for whichever of (a)/(b) you chose. Full
suite green; mind `test/status-line-budget.test.mjs` (STATUS.md ≤ 2,500 lines — archive the oldest span to
`docs/history/` if you approach it, never reword or drop an entry). Branch → PR → CI → merge → redeploy **both**
Railway services.

## Ship + record

Update `PLANNED-BACKLOG.md` (`HP1-P2a`; add the `inbox_items.domain` drift row), `CURRENT-STATE.md`, `STATUS.md`.
Report: where the exclusion lives and why, every consumer of `v_inbox_triage`, whether
`contact_misparse_review` has a resolution surface (and what you did if it does not), both measurements pasted,
and the pointer row's rendered text.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
