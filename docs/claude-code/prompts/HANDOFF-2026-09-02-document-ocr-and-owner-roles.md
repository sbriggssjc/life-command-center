# Session handoff — 2026-09-02 · document/OCR pipeline + owner-role classification

> **Paste this whole file into a fresh Cowork window to pick this thread up clean.**
> It carries the state, the open items, the standing working agreement, and the traps already paid
> for. **Read the three canonical pages named in §2 before doing anything else.**

---

## 1. Who you are working with, and how

You are helping **Scott Briggs** run **Life Command Center (LCC)** — a CRE business-development
platform (Northmarq / Team Briggs; **dialysis + government net-lease**, and per Scott 2026-09-01
*"we want to sell all net lease product"*). Sweet spot: **single-tenant deals $2M–$20M, through
volume with repeat seller clients.**

**Read first, every session:** `CLAUDE.md` · `docs/os/CURRENT-STATE.md` ·
`docs/os/PLANNED-BACKLOG.md` · `docs/claude-code/STATUS.md`.

**The working loop:** you diagnose and write prompts; **Claude Code executes them** on a branch;
Scott merges and redeploys. Responses land in `docs/claude-code/responses/`. **You never merge.**

## 2. ⚠️ START HERE — the three canonical pages for this thread

| topic | page |
|---|---|
| **the document pipeline** | `docs/architecture/document-capture-ocr-and-deeds.md` — **opens with a CURRENT STATE block; §0 below it is a dated worklog.** |
| **AI/OCR cost & where compute runs** | `docs/architecture/ai-and-ocr-cost-strategy.md` — **the local-vs-Microsoft-vs-Google decision** |
| **owner-role classification** | `docs/architecture/owner-role-classification.md` — §7 the shipped state, §8 the `user_owner` confirmations, §9/§10 C13c |

## 3. Where things stand

**Document pipeline — the arc that just closed.** A cron had been returning `eligible: 0` over 695
waiting documents (a fixed 60-row window, no cursor — **Dead-End Class 12, third instance**). Fixed,
plus the gpt-4o spend escalation and a covered-fragment correctness defect. **Live: deeds 325/325,
drain 771 → ~419, `bov_ready` 5 → 39, and ZERO gpt-4o escalations since the redeploy.**

**In flight right now:** **DOC18** (the three-call sync route) is with Claude Code. It clears the
**42** `over_docai_page_cap` documents for **~$3.30** with no GCS. **DOC17 settled its contract:
30 pages per call contiguously from page 1 (imageless), 15 pages anywhere else — the cap is measured
against the SELECTION, not the document.**

**Owner roles.** `v_lcc_entity_roles` is live — one row per (entity, role), **10,655 entities with
≥1 role, 954 with ≥2**, derived from the spine as a VIEW, never stamped. `user_owner` confirmed at
**10** (10 confirmed / 4 rejected / 1 undecided).

**🟢 The next strategic item is OCR1 — a bake-off, prompt staged at
`docs/claude-code/prompts/OCR1-local-ocr-bakeoff.md`.** Tier 1 free OCR is designed, has a producer,
and is **NOT WIRED** (`deps.freeOcr` has no server-side producer), so every OCR call has always
started at a paid tier.

⚠️ **BUT DO NOT ARGUE IT ON COST, AND THE PROMPT SAYS SO FIRST.** Measured: **185 of 362 documents
(51%) already extract FREE**, only **111 ever needed OCR**, and **total DocAI spend to date is 574
billed pages ≈ $0.86** (corpus scale: $23–53). **The real prize is that a local engine has NO PAGE
CAP** — ⚠️ **every hard problem in this arc (DOC8, DOC14, DOC16, DOC17, DOC18) was about Google's
15/30-page limit, not money.** Five prompts, a refuted design, a blocked GCS build and a live probe,
all to work around a page cap that a local engine simply does not have. Then **confidentiality**
(today the complete PDF of every under-cap lease is sent to Google) and **resilience**.

## 4. Open items, in priority order

| id | what |
|---|---|
| **DOC18** | 🔄 **in flight** — three-call sync extract. **Reconcile its response first.** |
| **OCR1** | 🟢 **THE RECOMMENDED NEXT BUILD — an exploratory BAKE-OFF, not a build.** Local engine vs DocAI on ≥10 real OCR'd documents (≥3 leases over 30pp). ⚠️ **The metric is FIELD AGREEMENT from `extractTenantFromLease`, never `char_len`** — a garbled OCR produces plenty of characters, and gpt-4o's 1,511-char rows passed every count-based check while being useless. **Justify on the PAGE CAP and confidentiality, not cost.** Wiring is **OCR1b**, only if this measures a winner. |
| **OCR2** | 🔴 the deed lane never tiers — calls gpt-4o directly, bypassing DocAI. **All 325 deeds went to the 6–14× tier.** Small and self-contained; good pairing with OCR1. |
| **C18** | 🟠 `ownership_start_date` is 50.7%, so **pacing** — the dimension Scott says drives seller-vs-buyer treatment — is half unmeasurable. ⚠️ **The route is UNMEASURED.** |
| **C19** | 🟠 *"clients first, not the product type"* ⇒ **every domain filter on a BD surface is a candidate defect**; nobody has swept |
| **OCR3/4/5** · **DOC2/3/4/5/6/15** · **C13d** | see the backlog |
| **DOC14** | 👤 **Scott's** — should probably be CLOSED now that DOC17 made the cheap route viable |
| **OCR6 · DOC7** | ⛔ **decided against — do not re-propose** (Microsoft OCR; widening cron 160) |

## 5. ⚠️ The standing working agreement — follow this every turn

### 5a. GitHub sync, and the locks

**⚠️ NEVER run a git command that takes a lock from the Linux sandbox.** The sandbox **cannot unlink
lock files it creates** on the Windows mount (`Operation not permitted`). This happened **four
times** in the last session before it was diagnosed — and ⚠️ **the warning was being grepped out of
my own output**, which is why it took four. **`pull`, `fetch`, `merge`, `reset` and even
`git status` all leave one.** Use `git log` / `git show origin/main:<path>` / plain file reads only.

**When a lock appears, diagnose before deleting:**

```powershell
Get-Process git -ErrorAction SilentlyContinue     # should return nothing
cd C:\Users\scott\life-command-center
git status --short ; git log --oneline origin/main..HEAD    # is anything staged or unpushed?
Remove-Item .git\index.lock, .git\ORIG_HEAD.lock -Force -ErrorAction SilentlyContinue
```

⚠️ **Never `git reset --hard` to clear a lock** — unstaged doc edits are lost. `GITHUB-WORKFLOW.md`
§2a records the incident that nearly cost a 475 MB mailbox.

**Every change ships as: branch → PR → CI green → Scott merges.** `main` is protected; **both *"App
boots"* and *"npm test"* must be green BEFORE merge.** Give Scott copy/paste PowerShell in this
shape, with the commit body carrying the reasoning (not just the what):

```powershell
cd C:\Users\scott\life-command-center
git add <explicit paths>          # never `git add -A` — test fixtures churn
git commit -m "<subject>

<body: what was measured, what was corrected, what was refuted>

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: <slug>"
git branch <branch> ; git checkout <branch>
git push -u origin <branch> ; gh pr create --fill --base main
git branch -f main origin/main
```

⚠️ **A JS change does nothing until the Railway redeploy** (both services). *Merged is not running* —
confirm with `/version` + `git merge-base --is-ancestor <sha> <deployed-sha>`, or behaviourally.

### 5b. Documentation — the definition of done

**A change is not finished when the code works. It is finished when the canonical pages are true.**

1. **Update the canonical topic page, `STATUS.md`, `PLANNED-BACKLOG.md` and `CURRENT-STATE.md` in
   the SAME change.**
2. ⚠️ **Correct what is now false IN PLACE — including your own earlier calls.** Last session
   corrected: a `repeat_buyer` count wrong by **8×**, a "100% leases" claim **refuted**, a "lossless"
   claim that **inverted**, and a page-count ceiling that went **57 → 141**. **A page that argues
   with itself misdirects the next reader exactly as reliably as a stale one.**
3. **Record what was REFUTED, not just what shipped** — with the reason. Several backlog rows exist
   purely so a bad idea is not re-proposed (DOC7, OCR6, DOC16).
4. **Never lose an unbuilt plan.** Consolidation means *collapsing resolved detail and pointing at
   the canonical page*, **never deleting a design that has not been built.**

### 5c. Consolidation — do a pass every turn

**Scott's standing instruction:** *"clean and consolidate the repository by topic so only the latest
and most accurate version is left, without losing any not-yet-built features, so a future chat can
pick a topic up clean and not get misdirected by older data in other locations."*

⚠️ **Duplicate backlog rows are a RECURRING defect — not a one-off.** Last session found **two DOC13
rows**, then **two DOC8 and two DOC9 rows**. **Check for them explicitly:**
`grep -o "^| \*\*[A-Z]*[0-9]*\*\*" docs/os/PLANNED-BACKLOG.md | sort | uniq -d`

**When a topic accumulates a dated worklog, put a CURRENT STATE block at the top** so a new reader
gets truth in ten lines instead of reading the diary backwards. **Banner superseded files as
narrative/design rather than deleting them.**

### 5d. ⚠️ The measurement discipline — this is where the value is

Every significant finding last session came from measuring rather than reasoning. **The recurring
traps, each of which actually bit:**

- **A rate moves as the sample grows — it happened THREE times** (the gpt-4o escalation, `repeat_buyer`
  8×, the over-cap rate 8.1% → 17%). **Quote a rate with its denominator AND its sample size.**
- ⚠️ **Check the denominator.** `over_cap ÷ page_counted_leases` reads 32%; ÷ all drained leases it
  is 8.1%. **A 4× error, caught only by measuring instead of multiplying two estimates.**
- **A zero is often a property of the instrument** (Class 11). The discovery document lists no page
  limits **because it is a schema, not a quota surface.** **Positive-control every zero.**
- **Assert on the STATE DELTA, never a worker's own tally.** `already_annotated` and
  `skipped_already_in_spine` read exactly like throughput.
- **Read named rows before naming a mechanism.** Three classification errors last session would have
  passed a count.
- **Verify an API contract against the live schema, never a prompt's framing.** `imagelessMode` is a
  **top-level boolean**; the plausible nesting is a **silent no-op**.
- ⚠️ **Grep for who already writes the gap before building a consumer** — and **read what a
  producer's external call actually talks to** before trusting its name.

### 5e. Boundaries

- ⚠️ **Never fabricate.** Render "Not on file" / "Derived" / "Conflict". Supabase is reconcilable,
  never automatic truth.
- **Review existing machinery before building.** Several rounds found the thing already built.
- **Fill-blanks, reversible, idempotent, dry-run-able, provenance-tagged.**
- **Stopping is a legitimate outcome.** DOC14 stopped at a blocked prerequisite and built nothing —
  that was correct, and its refutation of two of my own assumptions was the deliverable.
- **Databases:** LCC Opps `xengecqvemvfknjvbvrq` · Dialysis `zqzrriwuavgrquhisnoa` · Government
  `scknotsqkcheojiaewwh`.

## 6. First actions in the new window

1. **Read** `CURRENT-STATE.md`, then the three §2 pages.
2. **Re-measure before quoting anything** — §7b of the document page is the standing status check,
   and every number in these docs is dated.
3. **Ask Scott whether DOC18 has come back**, and reconcile its response if so.
4. **Then run OCR1** (`docs/claude-code/prompts/OCR1-local-ocr-bakeoff.md`) — ⚠️ **leading with its
   §0, because the cost case does not survive the numbers and the prompt says so.** The case is the
   **page cap** and **confidentiality**. **Field agreement is the deliverable; character counts are
   context.**

### Recommended order after DOC18

**OCR1** (bake-off — decides whether the whole page-cap problem class goes away) → **OCR2** (the
un-tiered deed lane; small, independent, and a live 6–14× waste) → **OCR1b** *only if OCR1 wins* →
**OCR3** (is the default cloud path failing rather than spending?) → then the BD thread: **C18**
(pacing blindness) and **C19** (domain filters as candidate defects).

⚠️ **If OCR1 measures a clear win, revisit DOC18's partial-extract ceiling and DOC14 immediately** —
a local engine with no page cap makes both unnecessary, and leaving them standing would be carrying
a workaround past the thing that removed the need for it.
