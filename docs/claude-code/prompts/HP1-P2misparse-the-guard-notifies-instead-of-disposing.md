# HP1-P2misparse — 117 Inbox rows are success notifications. The guard is working; it just tells the broker every time.

**Repo: life-command-center** (owns LCC Opps `xengecqvemvfknjvbvrq`). Closes the largest remaining block of the
homepage Inbox. ⚠️ **The framing in the backlog row was wrong and this prompt supersedes it** — see §0.

**Read first:** `docs/os/PLANNED-BACKLOG.md` rows `HP1-P2misparse`, `HP1-P2a` (✅), `HP1-P2b`, `BR1` ·
`docs/claude-code/STATUS.md` 2026-09-12 entries · `api/_handlers/sidebar-pipeline.js` **~line 2114** (the only
writer) and its surrounding guard (`person_junk_name` / `email_fanout` / `misparse_name`) ·
`docs/claude-code/prompts/BR1-firm-registry-repair.md` · `CLAUDE.md` Core doctrines (**B6a** a skipped step must
emit; **P131** a coverage gap is filed never faked; **P180** NULL is not zero).

---

## 0. ⚠️ Correct the framing before building anything

`HP1-P2misparse` was filed as *"117 rows with no resolution surface — give the lane a review surface, or decide
they are machine-fixable."* **Measured, that is the wrong question.** These rows are not work awaiting a decision.
**They are the contact guard announcing, one Inbox row at a time, that it successfully blocked something.** A
correct block needs no broker judgment. The lane's defect is not a missing surface — it is **B6a over-applied**: a
skipped step must emit, but it must emit to a counter, not to the broker's homepage.

So the question this prompt answers is: **for each class of block, what is the right disposition — and what real
signal, if any, is being thrown away with it?**

## 1. What is actually in there — measured live 2026-09-12, do not re-derive, do verify

**117 inbox rows carry 294 rejected contacts — but only 42 distinct names across ~26 properties.** The same
rejection is re-notified over and over (`View Less` blocked **23** times, `Equity Funds` **31**). Four classes,
and they are **not** the same problem:

| class | example names | n | correct disposition |
|---|---|---|---|
| **A. CoStar UI chrome** | `View Less`, `Demographics`, `Public REIT`, `Equity Funds`, `CoStar Property Contact` | ~100 | Block **and say nothing**. Page furniture. Zero broker value, ever. |
| **B. Firms parsed as persons** | `Marcus & Millichap`, `Colliers`, `Cushman & Wakefield`, `NAI Columbia`, `Encore Real Estate Investment Services`, `Southpace Properties, Inc.` | ~60, most **with a real email** | Blocking as a *person* is right; **discarding is not** — these are organizations. Route to the firm registry (**BR1**), don't drop. |
| **C. Job titles in the name slot** | `Executive Vice Chairman`, `Vice Chair`, `General Mgr \| CEO`, `Special Projects & Consulting` | ~25, **with emails** | A **parser bug**, not a contact. A title landed in the name field — find out what happened to the person it belonged to. |
| **D. `email_fanout`** | `Edward C. Mann`, `James D. Collins`, `Clifford L. Lamar`, `Conrad Buhler`, `Drew A. Flood` | **86 rejections / 15 names / 4 properties** | See §2 — this is the only class with a recoverable real contact in it. |

## 2. 🔑 `email_fanout` — the guard is right, and there is a real person inside each batch

`email_fanout` fires when the scraper staples **one** broker's email onto **every** name on the page. Live:

- `jcollins@southpace.com` → **5** names: *James D. Collins*, *Clifford L. Lamar*, *Conrad Buhler*,
  *Southpace Properties, Inc.*, *Special Projects & Consulting*
- `william.collins@cushwake.com` → **3** names: *William M. Collins*, *Paul J. Collins*, *Drew A. Flood*
- `dlongaker@trinity-partners.com` → **4** names, including *NAI Columbia* and *View Less*

Blocking the batch is **correct** — 4 of those 5 are misattributions. But look at which name survives inspection:
**`jcollins@` ↔ James D. Collins. `william.collins@` ↔ William M. Collins. `jfahner@` ↔ Jacob Fahner.** The email's
local part identifies its true owner. **That one contact per batch is real, correctly paired, and currently thrown
away with the collateral.**

**Recover it mechanically, conservatively:** where a rejected name matches its email's local part under a strict
rule (initial+surname, first.last, firstname, and the obvious variants), that pairing is not fanout — it is the
one true contact, and it should mint. ⚠️ **Every other name in the batch stays blocked.** ⚠️ **A tie or an
ambiguous match mints nothing** and is reported. Expect this to be **small** — roughly 4–8 people. Say the exact
number you recover and name them; do not estimate.

## 3. Build

1. **Stop notifying on class A.** Suppress the inbox row entirely for blocks that are pure UI chrome / known
   non-contact tokens. ⚠️ **Suppress ≠ unobserved (B6a):** increment a counter the existing producer/health surface
   can read — `producer_runs` now carries `facts_written`/`skip_reason` and HP1-P1d made it live, so **use it
   rather than inventing a second ledger**. A reader must still be able to ask "what is the guard blocking?"
2. **Dedupe what remains.** 294 rejections, 42 distinct names: notify **once per (property, name, reason)**, not
   once per capture. This alone removes most of the 117 without changing a single guard decision.
3. **Class B → the firm registry.** Say what BR1 already does before writing anything. If BR1's machinery takes
   these, hand them over; if it does not yet exist, **file the handoff (P131) and leave the rows** — do not build
   a second firm path here.
4. **Class C is a bug report, not a queue.** Find where a job title reaches the name field and report the cause.
   **Do not fix the parser in this prompt** unless the fix is provably one line; file it with the evidence.
5. **Class D per §2.**

## 4. The gate — measured, not asserted

Paste all of these:

1. `select count(*) from inbox_items where status='new' and source_type='contact_misparse_review'` — before and
   after. **Before is 117.** State the after and what each of the four classes contributed to the reduction.
2. The live Inbox total, before and after (**182 before**), and confirmation `mv_work_counts.inbox_new` still
   agrees with the list (HP1-P2a's own invariant — do not break it).
3. The **exact list** of contacts recovered by §2, by name and email, with the matching rule each satisfied.
4. Proof the guard's decisions are **unchanged** for everything else: the same blocks still block. A class-A
   suppression must be a *notification* change, never a *guard* change.
5. The counter from §3.1 reading a real number, and where a human can see it.

⚠️ **If the after-count is not what you expected, report it and stop rather than tuning the rules to hit a
number.** (HP1-P2a's §5 set a target that contradicted its own §3; CC correctly reported 182 instead of forcing
65. Same discipline here — there is deliberately **no** target count in this prompt.)

## 5. What NOT to do

- Don't build a review surface for this lane. §0 is the whole point: these are not decisions.
- Don't weaken the guard. Every block measured here is **correct**. This changes what gets *announced*, and
  recovers one provably-correct contact per fanout batch.
- Don't mint anything in classes A, B or C.
- Don't touch `email_alert` / the announcement classes (**HP1-P2b**) or the ranking work (**P2c/P2e**).
- Don't delete `inbox_items` rows. Dispose via `status`, per the existing convention.

## Guard + ship

Tests: the class-A suppression list, the per-(property,name,reason) dedupe, the §2 local-part matcher **including
its refusals** (a tie, an ambiguous match, a firm name that happens to resemble an email), and a guard test that
fails if a previously-blocked name starts minting. Full suite green; `test/status-line-budget.test.mjs` **and**
`test/status-header-integrity.test.mjs` (STATUS.md H1 stays on line 1 — prepend below the convention block).
Branch → PR → CI → merge → redeploy **both** Railway services.

## Ship + record

Update `PLANNED-BACKLOG.md` (`HP1-P2misparse`; correct its framing per §0 rather than just ticking it), `BR1` if
you hand class B over, `CURRENT-STATE.md`, `STATUS.md`. Report: the four class counts before/after, the recovered
contacts by name, what you found about the class-C parser bug, where the suppression counter lives, and anything
the measurement contradicted in §1 — **§1 is a live reading from 2026-09-12, and it is allowed to be wrong.**

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
