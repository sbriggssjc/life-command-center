# STATUS archive — Claude Code queue, 2026-09-12 (sixteenth span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-15 to keep that file under its
3,000-line budget. Nothing was reworded or dropped; every still-open item named here is tracked in
`docs/os/PLANNED-BACKLOG.md`, which is the canonical open-work list.

---

## 2026-09-12 🚨 — 26 backlog IDs are used twice, and `SEC2` is two different issues. One of them bit me today. (Cowork)

Two prompts are already queued for CC (**HP1-P2misparse**, **HP1-badge**), so rather than deepen the queue I took
stock of the HP1 block — and found the misdirection Scott has been asking me to remove, partly of my own making.

**`PLANNED-BACKLOG.md` has 26 IDs appearing on more than one row**, and they split into two classes needing
**opposite** fixes:

**Class A — COLLISION, one ID on two unrelated issues.** **`SEC2` is `wave0-config-values.txt` is tracked in git**
(§P0s, line 263) **and** **rotate the Supabase `service_role` key** (§P9, line 624). Same shape on `SEC1`/`SEC3`/
`SEC4`, `A5d`/`A5e`, `D1`. 🚨 **This already misfired: I folded `HP1-P1a-sec` into "the pre-existing SEC2" without
knowing there were two.** The reference is now pinned to §P0s by hand, but it was ambiguous when written, and
anything else citing SEC2 — `OPERATOR-ACTIONS.md` does — still is.

**Class B — RESTATEMENT, the same issue written repeatedly:** `MB3`×4, `MB4`×4, `MB2a`×3, `B6d-cms-restart`×3 and
others, accumulated exactly the way `PR5c-enforce`'s four copies did before today's consolidation — sessions
restating a row instead of editing it.

**Fixed in place now, because all three were provably mine:** three **byte-identical** `HP1-P1a-sec` rows → one;
two `HP1-P1a-fix` rows → the richer (the shorter predated the parallel-session note); and `| HP1-P1b |✅`'s missing
pipe space, which had been hiding the row from ID greps entirely. 28 → 26.

**The remaining 26 are NOT a bulk edit and I did not treat them as one.** A collision that gets "collapsed"
destroys one of two real issues; a restatement that gets "renamed" mints a second ID for one problem. Classifying
each pair is judgment against citation counts. Written up as **`prompts/BACKLOG-ids-collisions-and-restatements.md`**,
which requires: rename collisions (keeping the ID on whichever row more citations already point at, counted not
guessed) with a pointer left on the renamed row so old references still resolve — the never-delete rule applied to
an identifier; collapse restatements keeping **every** distinct fact, and **report rather than silently pick**
where two copies disagree on a number.

✅ **And the durable fix: a CI guard.** A duplicate ID should fail the build, the way
`test/status-header-integrity.test.mjs` now catches a STATUS H1 burial — written today after a prose convention
note failed five times to stop the same mistake. The prompt specifies the two things that guard must get right or
it will be disabled by the first person it annoys: deliberate cross-references are not duplicates, and an
unresolvable duplicate is allowlisted **by ID with a reason and a re-measure date**, with a stale entry itself a
failure.

⚠️ Flagged explicitly in the prompt: §P0s `SEC2` carries Scott's ⏸️ deferral decision and its trigger condition —
**carry it across intact, do not restate it.**

## 2026-09-12 — HP1-badge prompt: the count lies, and fixing it honestly exposes that Urgent is 96% hygiene (Cowork)

REPO1 sweep confirmed in `main` (`docs/flows/README.md` present, root `err.txt` gone). Drafted the next prompt and
re-measured all three Today lanes live first.

**The defect:** `total_open: all.length` (`today-sections.js` 79/103/182) is the **capped page length**, not the
population — while the module header promises *"the full population"* and cites **P159a**. The honest-counts rule
failing inside the module written to enforce it.

| lane | badge | true | |
|---|---|---|---|
| Significant | **200** | **516** | −61% |
| Important | 46 | **46** | ✅ correct — only because it sits under the cap |
| Urgent | **≤200** | **1,664** | −88% |

Ranking is unaffected — `order by` precedes the cap, so the rendered eight really are the top eight. Only the
count lies.

⚠️ **Two dead ends measured, so CC does not walk into either.** Re-enabling `count=exact` is precisely what
**HP1-P0** removed — ~750 ms on the seller view alone, on the endpoint that was 500ing all three lanes; fixing a
badge by reintroducing the outage is not a trade worth making. And `countMode:'estimated'` **cannot work here at
all**: `reltuples` on `v_lcc_seller_prospect_queue` is **-1** — a view, never analyzed — so PostgREST has no
estimate to hand back. The current setting is not a slightly-wrong number; for these lanes it is **no number**.
✅ The answer is likely the pattern HP1-P2a already shipped: `inboxHygienePointer()` — exact probe, `limit=1`,
read off the base table never the capped view, `null` on failure. **P180** made explicit: a failed count renders
*unknown*, never `0`.

🚨 **The part that matters more than the badge.** Fixing the count honestly makes Urgent read **1,664** — and
**1,598 of those (96%) are `contact_writeback`**, CRM plumbing, against just **66** `action_items` of real deal
correspondence. **That is the same class HP1-P2a removed from the Inbox, sitting in the Urgent lane of Today.** The
prompt fixes the count and **files** the population as **HP1-P2f-urgent** rather than folding them together —
leaving the cap in place to keep the number comfortable would be choosing a pretty lie, which is the exact failure
the row exists to correct. And it carries P2a's expensively-learned caution forward: **establish where
`contact_writeback` is actually worked before routing it anywhere** — `contact_misparse_review` had zero readers,
and routing it off would have deleted the only place it was visible.

Prompt also warns about the line-budget trap that cost two PRs today: **archive before you push, 200+ lines of
headroom**, because STATUS.md grows on `main` while a branch is open.
