# HP1-P2f-urgent — Today's Urgent lane is 96% CRM plumbing. It has a working home. Move it there.

**Repo: life-command-center** (owns LCC Opps `xengecqvemvfknjvbvrq`). The **last structural piece** of Scott's
original HP1 report. A routing change, like HP1-P2a — and the destination question is **already answered**.

**Read first:** `docs/os/PLANNED-BACKLOG.md` `HP1-P2f-urgent`, `HP1-P2a` (✅ — the pattern), `HP1-badge` (✅ — the
count that exposed this), `HP1-P2misparse` (✅ — why "check the destination first" is non-negotiable) ·
`api/_shared/today-sections.js` `buildUrgentSection` (~line 130–203) · `api/operations.js::getTodaySections`
(~2055) · `api/queue.js::inboxHygienePointer` (~66, the honest-pointer pattern) · `api/_handlers/contact-writeback.js`
· `ops.js` ~3777–3805 (the BD worklist chips) · `CLAUDE.md` **P159a**, **P180**, **B6a**.

---

## 1. Why now — Scott's own words, and the number the badge fix uncovered

> *"The homepage should be a view of the work that needs the broker's attention and review in priority order."*

HP1-badge stopped `total_open` reporting the page length. The honest number it revealed **is the finding**:

| Urgent lane component | count | is this deal work? |
|---|---|---|
| `action_items` (open/in_progress, deal correspondence) | **66** | **yes** |
| `v_lcc_bd_worklist` `contact_writeback` | **1,598** | no — CRM plumbing |
| **true population** | **~1,664–1,730** *(it moves; re-measure)* | **96% is not deal work** |

This is the same class HP1-P2a removed from the Inbox, sitting in the Urgent lane of Today.

## 2. ✅ The destination question — answered, with evidence, before you start

HP1-P2misparse cost us the lesson: `contact_misparse_review` had **zero readers**, so routing it off would have
deleted the only place it was visible, and it correctly stayed. **`contact_writeback` is the opposite case:**

- `api/_handlers/contact-writeback.js` — its own handler.
- `ops.js:3785` — rendered in the BD worklist as a **"Push to CRM"** action.
- `ops.js:3803` — it already has its own **chip filter** in that surface.

So routing it off Today **moves** it; it does not hide it. **Verify all three yourself before acting** — if any is
not what this says, stop and report rather than proceeding on my reading.

## 3. Build

1. **Urgent = deal work.** Remove `contact_writeback` from the Urgent lane's union in `buildUrgentSection`. Leave
   the `action_items` arm, its ordering, and the `owner_source_conflict` handling exactly as they are.
2. **🚨 Excluding is not hiding — the P2a gate, and it is what makes this shippable.** Urgent must render a
   persistent pointer carrying the **true, uncapped population** — *"Pipeline hygiene — N contacts to push to CRM
   →"* — linking to the BD worklist's existing `contact_writeback` chip. Reuse `inboxHygienePointer()`'s shape:
   exact count off the source, never a capped page, `null` (→ *unknown*) on failure, never `0` (**P180**).
   **If you cannot render the pointer, do not ship the exclusion.**
3. **Keep the badge honest.** `HP1-badge` just made `total_open` the true population via parallel count probes.
   Urgent's `total_open` must now be the true count of **what the lane actually contains** (~66), and the pointer's
   count must be the true count of **what was moved** (~1,598). Two honest numbers, neither derived from an array
   length. Do not undo the badge work to simplify this.

## 4. The gate

Paste every reading, from the live DB and the live endpoint:

1. Urgent's `total_open` and rendered item count, **before and after**, beside the SQL populations.
2. The pointer's rendered text and count, and confirmation it matches `select count(*) from v_lcc_bd_worklist
   where signal_type='contact_writeback'` exactly.
3. **Reachability, proven not assumed:** the BD worklist surface returning those rows under its
   `contact_writeback` chip after the change — a count, plus the fact that `contact-writeback.js` still serves
   them.
4. A **failure** reading: force the pointer's count probe to fail, show *unknown* — not `0`, not the page length.
5. Significant and Important lanes **unchanged** — items, order and `total_open` byte-identical.

⚠️ **No target number in this prompt, deliberately.** HP1-P2a's §5 set one that contradicted its own §3, and CC was
right to report 182 rather than force 65. Report what Urgent actually reads and stop if it surprises you.

## 5. What NOT to do

- Don't touch `action_items`, its ordering, or `owner_source_conflict`.
- Don't change how `contact_writeback` rows are produced, ranked or worked — this moves a surface, it writes no data.
- Don't dispose, bulk-push, or drain the 1,598. That writes to the CRM; it is a separate decision.
- Don't revert or "simplify" `HP1-badge`'s count probes or `HP1-P0`'s `Promise.allSettled`/`timeoutMs`/`source_error`.
- Don't take on `HP1-P2b` (the personal `email_alert` class) or `HP1-P2c/P2e` (ranking) here.

## Guard + ship

Tests: the Urgent union no longer admits `contact_writeback`; the pointer renders with a **true** population (a
test that fails if it is absent or capped); a failed count renders unknown (**positive control, not a comment**);
Significant/Important untouched. Full suite green.

⚠️ **Doc guards — four of them now, and two have already cost PRs today.** `status-line-budget` (≤2,500):
**archive an old span to `docs/history/` BEFORE you push**, leaving 200+ lines of headroom — STATUS.md grows on
`main` while your branch is open. `status-header-integrity` (H1 on line 1 — prepend **below** the convention
block). `backlog-id-uniqueness` and `backlog-table-shape` — **a concurrent PR adding backlog rows merges cleanly
and silently duplicates yours**, so re-run these after merging `main`, not just locally (see CLAUDE.md, *"TWO
BRANCHES THAT BOTH ADD TO A SHARED DOC…"*). Branch → PR → CI → merge → redeploy **both** Railway services.

## Ship + record

Update `PLANNED-BACKLOG.md` (`HP1-P2f-urgent`), `CURRENT-STATE.md` (its HP1 paragraph describes the old Urgent
union), `STATUS.md`. Report all five gate readings, and state plainly what Today's three lanes now contain —
that sentence is the answer to the question Scott asked at the start of HP1.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
