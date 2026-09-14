# HP1-P2misparse-fp — the contact guard blocks real people whose surname is a street word

**Repo: life-command-center.** Small, bounded, and a **correctness bug, not a design question**: a Northmarq
colleague is being silently discarded on every CoStar capture. The gate is two-sided and non-negotiable (§5).

**Read first:** `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md` (the HP1 map) ·
`docs/os/PLANNED-BACKLOG.md` `HP1-P2misparse-fp`, `HP1-P2misparse` (✅), `-titleparse`, `-junkents` ·
**`api/_shared/tm-misparse.js`** — `STREET_SUFFIX_RE` at **line 42**, `tmMisparseReason()` (~125) ·
**`api/_shared/misparse-disposition.js`** — `localPart()` (141) and **`localPartMatchRule(email, name)`** (150),
shipped by HP1-P2misparse · `test/tm-misparse.test.mjs` (the fixture set that must keep blocking) ·
`api/_handlers/sidebar-pipeline.js` ~189–199 (where the reasons are emitted) · `CLAUDE.md` **Class 11**
(a zero from a text-matching detector needs a positive control), **P131**.

---

## 1. The defect — exact, and confirmed live

`STREET_SUFFIX_RE` (tm-misparse.js:42) matches a street-suffix token **at the end of the name**. A person whose
**surname is a street word** therefore flags as a misparsed address:

| blocked name | email | reasons it fired under |
|---|---|---|
| **`Brian Lane`** | **`blane@northmarq.com`** — **a Northmarq colleague, Scott's own firm** | `misparse_name` **and** `person_junk_name` |
| `Jim Street` | `mgreencre@gmail.com` | `person_junk_name` |

Measured in the misparse-review lane: **3 rejections / 2 distinct people, both person-shaped, both carrying an
email, and zero of the street-suffix blocks in that lane start with a house number.** Re-measure; do not inherit
these numbers.

**Every CoStar capture of Brian Lane has been discarded, silently, for as long as the arm has been live.** The
same class covers Street, Park, Hill, Ford, Banks, Rivers, Terrace, Walker, Place — this will recur.

## 2. ⛔ The file's own comment is now false, and fixing that is part of the job

`tm-misparse.js` states, of the Prompt-95 arms: *"Real people (`Jane G. Polen`, `Richard Ehmer`) must NOT flag —
the never-flag-clean-'First Last' guarantee is preserved."* That guarantee holds for `sentence_fragment`,
`doc_label` and `bare_title`. **It does not hold for `street_suffix`, and the comment does not say so.** A comment
asserting a guarantee the code no longer keeps is itself a defect (the repo's canonical-page-goes-stale rule).
Correct it in the same change, whatever fix you choose.

## 3. 🚨 Name shape ALONE cannot fix this — check before you reach for it

The obvious fix ("only flag if it doesn't look like `First Last`") **fails against this file's own fixtures**:
`'Hinckle Walk'` and `'Jack Kerouac Aly SE'` are real TrafficMetrix street captures that are **exactly as
person-shaped as `Brian Lane`**. A shape rule that admits Brian Lane admits Hinckle Walk. **Verify this yourself
against `test/tm-misparse.test.mjs`'s list before designing** — if you conclude otherwise, show the rule and the
fixture it separates.

## 4. The discriminator is the corroborating email — and it already exists

A street capture has **no personal mailbox**. A real person has one whose **local part corroborates the name**:
`blane@` ↔ **B**rian **Lane**. That is exactly what **`localPartMatchRule(email, name)`
(`api/_shared/misparse-disposition.js:150`)** already does — shipped by HP1-P2misparse for the `email_fanout`
recovery. **Reuse it. Do not write a second matcher** (a second copy of a matching shape is the normaliser drift
this repo keeps getting bitten by — see `inbox_items.domain`'s four spellings).

Shape and corroboration are **both** required, and the burden sits on the corroboration:
- person-shaped **and** the email corroborates → **not a misparse**; let it mint.
- anything else → **stays blocked**, exactly as today.

## 5. ⚠️ Be honest about what this does NOT rescue

`Jim Street <mgreencre@gmail.com>` has a **generic mailbox that corroborates nothing**. Under §4 he **stays
blocked** — correctly, because nothing in the data distinguishes him from a street capture. **Do not widen the
rule to catch him.** Report him as a known residual with the reason, and file a row if a second corroborating
signal (a captured phone, a title, a company match) would resolve that class. **A fix that rescues one real person
and says so beats one that rescues two and cannot prove the second.**

## 6. The gate — two-sided, and this is the deliverable

**Class 11: a guard change needs a positive control on BOTH sides.** Paste all of it:

1. **Nothing that should block starts minting.** Every name in `test/tm-misparse.test.mjs`'s fixture list —
   `Bush St`, `Halleck St N`, `Jack Kerouac Aly SE`, `Columbus Ave`, `Hinckle Walk`, `Clay St N`, all of them —
   still returns `signal: 'street_suffix'`. **A single fixture flipping to "clean" fails this prompt.**
2. **The real person mints.** `Brian Lane <blane@northmarq.com>` passes the guard, with the rule that admitted
   him named. Show the same for at least two invented-but-realistic cases (`Sarah Park <spark@cbre.com>`,
   `Tom Rivers <trivers@…>`), and show that the **same names with a non-corroborating email stay blocked**.
3. **Live re-measure** of the misparse lane before/after, and whether any previously-blocked capture now mints.
4. `entities` **unchanged in count** by the code change itself — this changes what the guard *decides going
   forward*. If you also repair the already-blocked historical captures, that is a **write to curated identity**:
   do it as a separate, reversible, explicitly-reported step, or file it and leave it.
5. The corrected comment from §2, quoted.

If the two sides conflict — no rule separates the fixtures from the real people — **report that and stop.**
Leaving a known false positive documented and open is a legitimate outcome; widening the guard until the fixtures
pass by luck is not.

## 7. What NOT to do

- Don't delete or disable the `street_suffix` arm. It catches real TrafficMetrix contamination.
- Don't write a second local-part matcher (§4), and don't hand-list surnames — `Lane`/`Street` today, `Park` and
  `Rivers` tomorrow; an allow-list of names is a list that rots.
- Don't touch the `sentence_fragment`, `doc_label`, `bare_title` or `email_fanout` arms.
- Don't take on `-titleparse` (the extension-side parser bug), `-junkents` or `-fanout-legacy` here.

## Guard + ship

Tests: both sides of §6 as real assertions, plus a case proving a corroborating email does **not** rescue a name
that is *only* a street (`Bush St <bstreet@…>` must still block). Full suite green.

⚠️ **Doc guards — four, and two have cost PRs already.** `status-line-budget` (≤2,500): **archive an old span to
`docs/history/` BEFORE you push**, 200+ lines of headroom — STATUS.md grows on `main` while your branch is open.
`status-header-integrity` (H1 on line 1; prepend **below** the convention block). `backlog-id-uniqueness` +
`backlog-table-shape` — **a concurrent PR adding rows merges cleanly and silently duplicates yours**, so re-run
these *after* merging `main` (CLAUDE.md, *"TWO BRANCHES THAT BOTH ADD TO A SHARED DOC…"*). Branch → PR → CI →
merge → redeploy **both** Railway services, then confirm `/version` matches `main` — *merged is not running*.

## Ship + record

Update `PLANNED-BACKLOG.md` (`HP1-P2misparse-fp`; file the §5 residual), `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md`
§7 (it names this row as the last 🔴), `CURRENT-STATE.md`, `STATUS.md`. Report all five gate items and, plainly,
**which real people this rescues and which it does not**.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
