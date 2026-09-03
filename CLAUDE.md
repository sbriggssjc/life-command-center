# Claude Code / Cowork Instructions — Life Command Center

> **🧭 START HERE for architecture: [`LCC-OS.md`](LCC-OS.md) → `docs/os/README.md`.**
> **START HERE for "where are we / what's left": [`docs/os/CURRENT-STATE.md`](docs/os/CURRENT-STATE.md)
> (LIVE · flag-gated OFF and why · canonical-doc map) + [`docs/os/PLANNED-BACKLOG.md`](docs/os/PLANNED-BACKLOG.md)
> (every unbuilt-but-intended item, with provenance).**
> **Operational reference (surfaces, comps engine, deploy map, Cowork setup):** [`docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`](docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md) + [`docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md`](docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md).
> One brain (LCC + Cortex), one instruction/policy canon (`docs/os/canon/`), many surfaces (Copilot, Claude
> Personal/Cowork, Northmarq Claude, ChatGPT). Edit rules in the canon, bump the version, run
> `docs/os/SURFACE-SYNC-PROTOCOL.md` to update every surface. **Never start from scratch, never fork a source,
> never overwrite canon without bumping its version.** Consolidation map: `docs/os/REGISTRY.md`.

> **CRITICAL: Read `.github/AI_INSTRUCTIONS.md` before modifying any files in `/api/`.** It carries the full
> routing/architecture reference and any lettered-section footguns.

> **⚠️ DESTRUCTIVE-OP ORDER (learned the hard way 2026-08-19, nearly lost a 475 MB mailbox):**
> **extract → VERIFY → only then delete the backup and prune.** A 475 MB
> `email_export/*.pst` blocked a push (GitHub rejects >100 MB), so `filter-branch` purged it from
> history. Two mistakes, both about *order*:
> 1. **`git filter-branch` rewrites the WORKING TREE too**, not just history — a file dropped from the
>    rewritten commits is deleted from disk. Do not tell anyone "only history changes".
> 2. **PowerShell `>` is NOT binary-safe.** `git cat-file -p <blob> > file.pst` produced
>    **1,002,334,726 bytes for a 498,017,280-byte blob** — UTF-16LE widening every byte. Use
>    `cmd /c "git cat-file -p <sha> > %USERPROFILE%\...\file.pst"`, which redirects in binary, then
>    check `(Get-Item …).Length` against `git cat-file -s <sha>` **before** deleting the backup ref.
>    (PST magic is `!BDN` in the first 4 bytes if you want a second check.)
> The recovery only worked because `gc --prune=now` happened to leave the unreferenced blob behind.
> Never rely on that. Also: `email_export/`, `*.pst`, `*.ost` are now git-ignored — a mailbox export is
> personal correspondence and does not belong in a repo regardless of size.

> **This file is the durable reference — architecture invariants, DB topology, naming, write-surface rules,
> doctrines, and known footguns.** The full round-by-round worklog (R5→R64, ORE, CONNECTIVITY, UI phases, SF
> reconcile, etc., through 2026-07) was moved verbatim to **[`docs/history/CLAUDE_full_2026-07.md`](docs/history/CLAUDE_full_2026-07.md)** —
> grep there for the implementation log of any specific round. Add durable invariants here; leave per-round
> narrative in history.

---

## ⚠️ PRODUCTION RUNS ON RAILWAY (Vercel retired 2026-07-20)

The live app is the **Railway Express server**: `server.js` mounts the `/api/*` handlers directly
(e.g. `app.all('/api/capital-markets', capitalMarketsHandler)`); build config in `nixpacks.toml` +
`railway.json` (healthcheck `/health`). **`server.js` is the SINGLE source of truth for `/api/*` routing** —
add a route there (sub-routes via `?_route=`). **There is no serverless-function cap.** `vercel.json` is
deleted (Vercel retired after 40+ failed deploys against the old Hobby 12-function cap).

- **JS/code changes ship via a Railway redeploy of merged `main`.**
- **After a redeploy, run the deploy gate:** `npm run verify:deploy` — compares live `/version` to the merge
  SHA and probes that critical routes return JSON, not the SPA HTML. A GET to an unmounted `/api/*` path now
  returns a real JSON 404 (server.js API-scoped 404), never the SPA HTML with a 200, so a stale deploy can no
  longer look healthy.
- **Supabase view/migration changes are live immediately** — the CM export reads views per request
  (`no-store`), so data-layer fixes need no deploy.

## ⛔ `main` IS PROTECTED — branch → PR → CI green → merge. You cannot push to `main`.

Since **2026-08-27**, *"npm test"* is a **required status check**. A direct push to `main`
(`git push origin <branch>:main`) is rejected by the rule engine before anything else happens —
a required check cannot run without a pull request, so **retrying will never work**. Both
*"App boots"* and *"npm test"* must be green **before** you merge; PR #1793 was merged 58 seconds
after opening, before CI finished, carrying a red suite.

**Full procedure, failure-mode table, and the current unlock sequence:
[`docs/os/GITHUB-WORKFLOW.md`](docs/os/GITHUB-WORKFLOW.md).**
**Where every doc, plan, audit and design is filed:
[`docs/os/DOCUMENTATION-MAP.md`](docs/os/DOCUMENTATION-MAP.md)** — the root of the repo is code and
config; **do not add a new `.md` there.**

✅ **The Node-version lockout is RESOLVED (2026-08-27).** `test-suite.yml` was pinned
`node-version: '20'` while four test files import Deno `.ts` edge modules Node 20 cannot load
(`ERR_UNKNOWN_FILE_EXTENSION`), so the required check was red from its first run — 7 of 7. Fixed by
`2883d95`, which pins **Node 24**, the repo's runtime baseline. **The tell was the test COUNT** —
CI reported 4,568 tests / 868 suites against 4,621 / 883 locally; a failing assertion never changes
how many tests exist, a module that cannot load does. ⚠️ `package.json` still says
`"engines": {"node": ">=20.0.0"}`, which is false for the suite (it needs ≥22.18); whether the APP
runs on 20 is unmeasured and affects Railway, so it was left alone. Details:
[`docs/os/GITHUB-WORKFLOW.md`](docs/os/GITHUB-WORKFLOW.md) §4.

Two durable lessons from the fix, both expanded in
[`docs/os/GITHUB-WORKFLOW.md`](docs/os/GITHUB-WORKFLOW.md) §4a/§4b:

- **Before PR-ing a fix to shared infrastructure** (a workflow, `package.json`, a migration),
  **check whether the other audit window already fixed it** — `git log origin/main -5 -- <file>`.
  Both windows diagnosed this identically hours apart and shipped different Node pins. The
  prompt-numbering convention prevents filename collisions and does nothing for shared config.
- **⚠️ A conflict resolution that keeps BOTH sides can be structurally invalid, and no test
  catches it** — resolving that branch left **two `node-version` keys in one `setup-node` step**.
  Each hunk was correct alone, so "keep both" felt safe; for a **mapping** it is not. GitHub could
  not build a run from the file, so the required check **never reported** — a distinctive symptom:
  *"Expected — waiting for status"* that no re-run fixes usually means **an invalid workflow file,
  not a queued run.** In YAML/JSON, ask whether the two sides are alternatives or additions.

- **⚠️ AND THE SAME RESOLUTION COMMITS THE MARKERS THEMSELVES — TWICE IN ONE EVENING, AND
  NOTHING DETECTED IT (A0, 2026-08-27).** `docs/architecture/panel-redesign-verification.md`
  carried **148 lines** of literal `<<<<<<< HEAD` / `=======` / `>>>>>>> f59679a2` as FILE
  CONTENT, on `main`, for **75 days**. **Git does not flag this**: there is no `UU`, because as far
  as git is concerned the conflict *was* resolved — by committing the markers. Prose has no parser,
  so nothing else caught it either. In YAML the identical mistake was LOUD (a workflow that could
  not build a run); in prose it is **completely symptomless** and silently voided half a
  verification document. Guard: **`test/no-conflict-markers.test.mjs`**.
  - **It is a pattern, not one file, and the guard's FIRST CI run proved it.** A second live
    instance was already on `main` — `docs/claude-code/STATUS.md` (PR #1801, ~1 hour earlier) — and
    it came from a **`git stash pop`**, not a merge: `<<<<<<< Updated upstream` /
    `>>>>>>> Stashed changes`. **Match on the marker CHARACTERS, never the label text after them**,
    or the stash flavour walks straight through. (Repaired on `main` by a parallel window in
    PR #1804, independently and identically — the §4a two-windows-one-file lesson, again. Cause and
    prevention live in `GITHUB-WORKFLOW.md` §2b: **`git status` + `git diff --check` after every
    `stash pop`**, because `git add -A` stages a half-merged file and `git commit` does not refuse
    it.)
  - **Both times the two sides were NOT alternatives** — §4.2e vs §4.2f of one verification doc;
    two different entries of one newest-first worklog. Picking a side would have deleted real
    content. **Keep both, restore the document's own ordering, change no number, and where the two
    genuinely disagree (§4.2f is headed 2026-08-15 yet verifies §4.2e, headed 2026-08-16) say so in
    the file rather than adjudicating it.**
  - **⚠️ A bare `=======` is a valid Markdown setext H1 underline** — report it (and diff3
    `|||||||`) **only inside** an open `<<<<<<<`…`>>>>>>>` span. Exclude a legitimate file **by
    path**; weakening the pattern is how a detector starts returning comfortable zeros (P182).
  - **⚠️ The guard was born blind to its own population, and that had to be fixed in the same
    change.** `test-suite.yml` skips the suite when every changed file is documentation — and
    **both instances are `docs/*.md`**, PR #1801 itself being docs-only. Its docs-only branch now
    runs `node --test test/no-conflict-markers.test.mjs` standalone (~1 s, no `setup-node`, no
    `npm ci`). **A guard that cannot see the population it exists for is not a guard** — the same
    failure mode as a `test/*.test.mjs` tripwire that no merge gate runs.

## Rules

00. 🔁 **EVERY TURN CLOSES THE LOOP — [`docs/os/BUILD-TURN-PROTOCOL.md`](docs/os/BUILD-TURN-PROTOCOL.md)
   is the definition of done.** Scott's standing requirement, 2026-08-28: the repository-clean and
   self-improvement pass happens **at every turn of every build**, so the next chat can pick any
   topic up cold and be right. **A change is not finished when the code works — it is finished when
   the canonical pages are true.** Eight steps: measure before concluding · verify on the state
   delta and positive-control every zero · establish deploy state via `/version` + `merge-base`
   (never a handler probe) · reconcile against the parallel window · **update the canonical docs in
   the SAME change** · correct what is now false in place, **your own calls included** · **extract
   open intent BEFORE archiving anything** · leave the next step named.
   ⚠️ **The cost of skipping it is measured, not theoretical** — 25 planned items filed nowhere, a
   design doc reading *"not executed"* about a cutover that shipped three months earlier, and a
   freshness monitor that evaluated nothing for 33 days with zero alerts open. **None of them
   errored.** It is not ceremony: a one-line fix needs a one-line STATUS entry and nothing more.
   The test is *"can the next session pick this up cold and be right?"*

0. **`LCC_API_KEY` auth is production-ready.** Frontend `auth.js` auto-injects `X-LCC-Key` via a global fetch
   interceptor. To enforce: set `LCC_API_KEY` + `LCC_ENV=production` in the Railway env — **in that order**.
   Flipping `LCC_ENV` first (key empty, no `OPS_SUPABASE_URL` JWT path) 401s every request = **total sign-in
   lockout**. Verify readiness first via `GET /api/diag?kind=auth-ready` (`would_pass_in_production` must be
   true). Runbook: `docs/AUTH_ENFORCEMENT_ROLLOUT.md`.
1. Prefer adding endpoints as **sub-routes** of an existing handler (`?action=` / `?_route=`). A brand-new
   `api/*.js` is allowed (no platform cap now), but the sub-route pattern keeps related routes in one handler.
   Historically the codebase held **≤12 `api/*.js`**; many round logs cite that count — it is a structure
   convention now, not a hard limit.
2. New utility/handler code goes in `/api/_shared/` or `/api/_handlers/` — never a new top-level `api/*.js`
   unless deliberate.
3. **Mount every new route in `server.js`.** `test/operations-subroutes.test.mjs` guards that every
   server.js-mounted `_route` has a matching dispatch.
4. Descriptive, Round-numbered commit messages — never generic "GPT changes".
5. `.github/AI_INSTRUCTIONS.md` is the full architecture + routing reference.

## Architecture Quick Reference

- **LCC orchestrates; domain Supabase backends execute domain logic.**
- Consolidated handlers: Contacts + Entities → `entity-hub.js` (routes to `_handlers/`); Bridge + Workflows →
  `operations.js`; Intake → `intake.js`; `admin.js` = workspaces, members, flags, connectors, diagnostics
  (config/diag/treasury), edge proxies (data-query, daily-briefing).
- **Supabase Edge Functions:**
  - **`data-query`** + **`daily-briefing`** deploy on the **Dialysis_DB** project (ref `zqzrriwuavgrquhisnoa`)
    — `api/admin.js` `DATA_QUERY_EDGE_URL` hard-codes that ref. When you bump the data-query allowlist (e.g.
    add an RPC or a read table/view), **deploy to that project, not LCC Opps** (see the allowlist footgun below).
  - `availability-checker`, `artifact-offload`, `docai-ocr`, `owner-contact-websearch` (paused) live on
    **LCC Opps** (`xengecqvemvfknjvbvrq`).
- **`lcc_cron_post()`** reads the API key from Supabase Vault and POSTs via `pg_net` to Railway (`/api/*`) or
  Edge endpoints. pg_cron on LCC Opps runs the scheduled sweeps (queue/decision refresh, health checks,
  offload, syncs, reconciles). Grep the history file for the exact schedule of a named job.
  - ⚠️ **`target = 'vercel'` in an old migration or cron command is a LABEL, not a host (retired
    2026-09-02).** After Vercel was retired the function routed every non-`edge` target to the
    Railway URL, but 50 of 155 jobs still said or defaulted to `'vercel'`, and the C1 audit read one
    of them as "posts to the retired host". Migration `20260902140000` set the default to
    `'railway'`, relabelled all 36 explicit commands live, and keeps `'vercel'` as a silent alias so
    a replayed migration cannot break. **A dead label that reads like a live endpoint will be
    misread by whoever meets it next — retire the label, don't just document it.**

### ⚠️ `unified_contacts` LIVES IN TWO PROJECTS — read the `CONTACTS_HUB` flag first

`unified_contacts` (+ `contact_change_log`, `contact_merge_queue`) exists on **both** gov and
LCC Opps. Which one is live is decided by the **`CONTACTS_HUB`** env var
(`api/_handlers/contacts-handler.js`, the "A9b cutover"): default `gov`, and `ops` repoints all
three tables to LCC Opps. **It is currently set to `ops`** — LCC Opps is live (31,038 rows and
growing); the gov copy is a **frozen pre-cutover snapshot**, 30,709 rows, last written
2026-08-17 (the cutover date), 0 rows touched since.

**⚠️ The function that reads them is called `govQuery()` REGARDLESS** — it does path-based
routing internally, so the NAME tells you nothing about which database a contact write lands
in. On 2026-08-26 this produced two consecutive wrong reports inside five minutes: first
"nothing has arrived" and then "stop the run", about an Outlook contact sync that was working
perfectly and had already written 600+ rows to the other project. **Before quoting any
`unified_contacts` count, confirm which project the flag points at** — and note the stale gov
copy will answer a query happily, with 9-day-old data and a plausible-looking row count.

Same shape as the other measurement traps in this file: the wrong source answered confidently
instead of erroring.

### Database topology (3 projects)

| Project | Ref | Role |
|---|---|---|
| **LCC Opps** | `xengecqvemvfknjvbvrq` | The brain: entities, BD spine, priority queue, decisions, cadence, provenance registry, health alerts, **auth (GoTrue)**, most crons. |
| **Dialysis_DB (dia)** | `zqzrriwuavgrquhisnoa` | dia domain: properties, leases, sales, listings, CMS/medicare_clinics. Hosts the `data-query`/`daily-briefing` edge functions. |
| **Government (gov)** | `scknotsqkcheojiaewwh` | gov domain: GSA-leased properties, leases, sales, listings, deeds. |

## Client routing (UI Phase 1) — hash is the source of truth

The SPA uses **hash routing** (`location.hash`, not History clean URLs) so the Railway static/Express server
needs **no catch-all rewrite**. Empty/unknown hash ⇒ Today. **No PII in the URL** — ids/tab/domain only.

- **Scheme:** `#/<page-slug>[?d=<detail-token>]`. Detail-token: `prop:<db>:<propertyId>:<encodedTab>`
  (→ `openUnifiedDetail`), `entity:<entityId>[:<encodedTab>]` (→ `openEntityDetail`), or
  `sub:<lease|sale>:<db>:<id>` (→ `openSubDetail`). Example: `#/dia?d=prop:dia:24703:Overview`.
- **slug↔pageId map:** `ROUTE_SLUG_TO_PAGE` in `app.js` (reverse `ROUTE_PAGE_TO_SLUG`; legacy aliases
  `ROUTE_PAGE_ALIAS`, e.g. pageMyWork→pagePipeline). `dia`/`gov` are bnav shortcuts rendering `pageBiz`.
- **READ side:** `applyRoute()` is the single `hashchange` + initial-load handler (`_routeParseHash` never
  throws); it drives `navTo` + `openUnifiedDetail`/`openEntityDetail`/`switchUnifiedTab` and does NOT duplicate
  render paths. **WRITE side:** nav + open/close helpers set the hash. **Loop guard:** `_routerApplying` no-ops
  writers while `applyRoute` runs; writers skip when the desired hash equals the current one.
- **Zoom model (4A–4C, COMPLETE):** `_detailStack` (app.js) mirrors the chain of open detail levels; one stack
  level == one `?d=` history entry. In-panel "← Back" (`detailBack()`) + breadcrumb drive `history.back()`;
  `applyRoute` reconciles the stack (`_detailStackSync`, idempotent). Entity/owner detail (`openEntityDetail`)
  renders the SAME slide-over shell as `openUnifiedDetail` (tabs, completeness rail, Next-Step). **Portfolio is
  authoritative** — `GET /api/entities?action=portfolio&id=<uuid>` (BD spine), not a fuzzy name-match.
  **Next-Step reads `v_priority_queue_enriched`** via `/api/priority-band?entity_id=` — same truth as the
  Priority Queue / Decision Center. Deeper-than-top levels are not persisted across reload (best-effort).

---

## Front-end: NO BUNDLER — classic scripts in ONE shared global scope (W6.5)

`index.html` loads the SPA as a sequence of **classic** `<script src>` tags served
statically from the repo root. There is no bundler and no build step. Every file therefore
shares **one global scope** — a top-level `function`/`var` (via `window`) or `let`/`const`
(via the shared global lexical environment) in one file is visible to all the others.
`ops.js` calls `esc`/`opsApi` from `app.js`; `detail.js` calls into its siblings; none of it
imports anything. **LOAD ORDER is the entire dependency mechanism.**

`detail.js` is being decomposed by region (W6.5 Stage 2 — five siblings so far:
`detail-rent.js`, `detail-tab-documents.js`, `detail-panel-shell.js`, `detail-entity-tabs.js`,
plus Stage 1's `dc-lanes.js` out of `ops.js`). Map + the full extraction recipe:
`docs/architecture/w6-5-frontend-decomposition-map.md`. Durable invariants:

- **An extracted sibling loads BEFORE its parent.** Almost all cross-file use is at CALL
  time so order is forgiving, but a moved top-level `let` (e.g. `_companionState`,
  `_activePrimaryKind` in `detail-panel-shell.js`) is read by the parent, so the sibling
  must be initialized first. Guarded by `test/frontend-module-load-order.test.mjs`.
- **NEVER `type="module"` for a split region.** Modules get their own scope; every one of
  the hundreds of cross-file references and every inline-`onclick` target would need
  explicit import/export. That rewrite cannot be byte-identical. Modules are for genuinely
  new leaf code only.
- **⚠️ `window.*` EXPORTS ARE LOAD-BEARING and invisible to structural checks.** Inline
  `onclick=""` in generated HTML resolves off `window` at CLICK time, not through lexical
  scope. Drop one in a move and the UI renders perfectly and dies on interaction. The panel
  shell alone carries 19. Every extraction asserts its exports by name.
- **A split must MOVE, not COPY.** Two definitions of one function in a shared scope means
  the later file silently wins; two top-level `let`s of one name is a **runtime
  SyntaxError that kills the whole app**. Guards forbid redeclaration on both sides.
- **⚠️ 36 CROSS-FILE DUPLICATE DEFINITIONS ALREADY EXIST, and one was a live bug.**
  Measured 2026-08-20 while mapping Stage 3; every pair is genuinely DIFFERENT code, not
  copies. 28 are intentional (`app.js` ships inert placeholder stubs — `renderGovOverview`,
  `diaQuery`, `metricHTML`, … — that `gov.js`/`dialysis.js` override with the real
  implementations); 4 are harmless equivalents (`esc` in `app.js` and `ops.js` do the same
  five escapes); 3 are dead code (`app.js`'s 2,403-byte `loadMergeQueue` sits under
  contacts-ui.js's 303-byte one). **The one that bit: `_opsSparkline`.** `detail.js` built an
  OBJECT census series and defined `_opsSparkline(history)` to read it; `ops.js` loads later
  with `_opsSparkline(series, opts)` expecting NUMBERS, so `Number({total_patients:81,…})`
  → `NaN` → every point filtered → the dialysis Ops tab's census chart returned the literal
  string **"no trend" on every property**, for months, with no error. Fixed by mapping the
  call sites to numbers and deleting the dead definition.
  **`test/frontend-duplicate-definitions.test.mjs` pins the set** — a NEW duplicate fails,
  and a stale allowlist entry also fails, so the list cannot rot into a lie. Before adding a
  top-level `function` to any SPA file, check the name is not already taken by a file that
  loads later; "it works on my page" is not evidence, because the override is silent.
- **Cache busters move as a SET** (`app.js`/`detail.js`/every `detail-*.js`/`ops.js`/
  `styles.css`). Fresh CSS + a cached old script is an unrecoverable UI;
  `panel-redesign.test.mjs` enforces one shared `?v=`.
- **⚠️ Step 5b — a test that SLICES a function and `eval`s it breaks when that function
  moves,** and no structural guard can see it (they assert file shape, not eval-ability).
  Stage 1 shipped one broken this way for weeks. **Grep `test/` for the moved function name
  BEFORE extracting**; stub any callee left behind in the parent.
  - **⚠️ Corollary — a test that SLICES A SOURCE REGION (a block between banners, or a
    `case` handler in a big file) and greps it for a literal is the SAME footgun and it
    recurred THREE times in one arc (2026-08-24): P126 pinned `</table>` as a div-based
    signature's end; P128's `w8-u3-conflict-card` grepped `out.total = (a||0)+(b||0)` that
    P89's null-guard had rewritten; P129's `ollama-clean-assist` asserted its extracted
    block had no `properties?` but the block boundary had DRIFTED into an adjacent
    `admin.js` handler that legitimately calls it — a false "P106 breach," not a real one.
    Anchor block-slice assertions on a STABLE structural boundary (the exact `case '…':` …
    `break;`) or assert the BEHAVIOUR (compile the RHS and check outputs), never a literal
    that moves. And when one of these fails, DETERMINE breach-vs-stale-grep before you
    "fix" — twice this arc the red test was stale and the code was correct.**
  - **⚠️ A FIXED-CHARACTER WINDOW (`source[fn_start:fn_start+N]`) IS THE SAME FOOTGUN AND IT
    FAILS IN BOTH DIRECTIONS — recurred 2026-09-01 in the Dialysis repo.** `sanitize_pending_update`
    grew to **6,845 chars** in B6d-pri-reason, so five guards asserting over `+5000` sat at chars
    5,290–6,794 — **outside the window, red, over completely correct code.** That is the
    UNDERSHOOT case. The **OVERSHOOT** case is worse and silent: a window that runs past the
    function's end asserts against the NEXT function, so **a green guard may be passing on code it
    never named.** ✅ **All 27 in that file were re-anchored 2026-09-01 and the split MEASURED:
    21 undershoot / 6 overshoot / 0 exact — SIX guards were asserting against code outside the
    function they name, i.e. passing on code they never tested.** The overshoot case was filed as a
    hypothesis and turned out to be 6 of 27. **Anchor on the AST span, never a character count** —
    a byte offset is a literal that moves, and a growing function is the normal case.
- **⚠️ "REACHABLE" AND "IN THE RIGHT MODULE" ARE DIFFERENT PROPERTIES.** Unit 4 moved 7 of
  12 `_entityTab*` bodies and left five behind; every guard stayed green because the
  tab-registry guard only asks whether a tab reaches a renderer that EXISTS — and it did.
  Before declaring an extraction done, **grep the parent for what you claimed to move.**
- **`npm run verify:deploy` probes every local `<script src>`,** not just `/version` and
  `/api/*`. A newly-added front-end file that fails to ship 404s in the browser while the
  gate reads green — and the SPA catch-all can return **HTTP 200 with index.html in the
  body**, so the check asserts on the BODY. Use `--wait[=sec]` for the interactive
  push→verify loop (Railway may still be building); CI keeps the hard fail.
  ⚠️ **"CI keeps the hard fail" is only true of the checks CI actually runs — and it does NOT
  run the test suite.** See the next bullet before relying on any guard in `test/`.

- **⚠️ NO WORKFLOW RUNS `npm test` ON A PULL REQUEST — THE 4,551-TEST SUITE NEVER EXECUTES IN CI
  (measured 2026-08-26, Prompt 139).** `.github/workflows/boot-check.yml` is the **only** check
  that runs on a PR, and it runs `npm run check:boot` — a `node --check` sweep plus a `server.js`
  import. The other five workflows (`address-normalize-drift`, `cron-heartbeat`, `daily-db-checks`,
  `field-source-priority-schema`, `supabase-advisor`) are scheduled or ops checks, not PR gates.
  **This is why PR #1786 merged green carrying a red suite and duplicated `<script>` tags.**
  - **Every "guard" this file cites is therefore a guard only if a human runs `npm test` locally.**
    The dozens of `test/*.test.mjs` tripwires documented throughout this file — the duplicate-
    definition pin, the load-order guard, the subroute dispatch check, the research-embed
    invariant — are real and they are green, but **nothing enforces them at merge time.** Do not
    write "guarded by `test/x.test.mjs`" as though it were a merge gate; it is a regression
    detector for whoever remembers to run it.
  - **It is the exact mirror of the 2026-07-20 incident `boot-check.yml`'s own header describes** —
    there the suite stayed green while the app crash-looped, because tests import modules and
    nothing imported the app. The gap nobody closed is the other direction: CI imports the app and
    never runs the tests. One failure mode produced the workflow; its twin was left standing.
  - **~~The fix is small and offered~~ — SHIPPED 2026-08-27 as its own PR (backlog N9).**
    `.github/workflows/test-suite.yml` runs `npm ci && npm test` on every `pull_request` and on
    pushes to `main`. The suite runs fully offline — no secrets, no network, no DB — so it needs
    no environment, exactly like `boot-check.yml`.
    ⚠️ **A workflow existing is not a merge gate.** Until *"npm test"* is added to branch
    protection as a REQUIRED check alongside *"App boots"*, a red suite still merges — it just
    merges with a visible red X instead of silently. **That toggle is an operator step**
    (repo Settings → Branches → main → required status checks), and until it is flipped, every
    "guarded by `test/x.test.mjs`" line in this file remains a regression detector, not a gate.
    Backlog row **N9** in `docs/os/PLANNED-BACKLOG.md`.
  - **⚠️ AND THE NEW WORKFLOW HAS NEVER ONCE BEEN GREEN — INCLUDING ON `main` (2026-08-27).**
    `test-suite.yml` shipped pinned `node-version: '20'`, **copied from `boot-check.yml`**. Three
    test files import Deno edge-function modules (`supabase/functions/**/*.ts`) directly, and
    **Node 20 cannot load a `.ts` file** — `ERR_UNKNOWN_FILE_EXTENSION`, thrown before any test
    body runs, 0 pass. Node 22.18+ strips types by default; the suite is **4,606 pass / 0 fail**
    on Node 22. `boot-check.yml` stays on 20 **deliberately** — it never imports a `.ts` module,
    which is precisely why copying its pin was the wrong default. `engines` stays `>=20.0.0`: the
    server runs fine on 20, only the suite needs type stripping.
  - **The durable rule: a NEW CI job is not shipped until it has been green once on `main`.**
    A job that is red on every run is not a gate — it is **a badge people learn to merge past**,
    which is the exact failure N9 existed to close. PR #1793 demonstrated it live: merged **58
    seconds after opening, before CI finished**, with the suite red.
  - **⚠️ "Red on my PR" is not "my PR is broken."** Check the BASE branch first — this one had
    failed on all four runs since it shipped, twice on `main` itself. And it was **not flaky**;
    "flake" would have been the wrong answer and the expensive one.

## Core doctrines (apply to every change)

### ⚠️ "MERGED" IS NOT "RUNNING" — CHECK THE FIX AGAINST THE DEPLOYED SHA BEFORE CALLING IT BROKEN (2026-08-26)

Three assist fixes landed on 2026-08-26 and **the deploy cutoff cut straight through them.** The
build serving all day was `bb26453a`, cut at **16:03 UTC**:

| fix | merged | vs cutoff | production |
|---|---|---|---|
| P131 ownership-chain drafter | 15:18 UTC | **before** | ✅ 545 rows written |
| P135 property-twin window fix | 18:16 UTC | after | ❌ 0 writes |
| P136 reachability harvest fix | 18:56 UTC | after | ❌ 0 writes |

Same author, same day, same code quality — **the only variable was which side of the deploy they
landed on.** But the SYMPTOM is identical to a broken worker (cron green, flag `on`, zero writes),
and it had already been written up twice as "verified in dry-run but no live delta," then escalated
to "a second stall to diagnose." **That escalation was wrong, and it was one `git merge-base` away
from being obviously wrong.**

- **Before diagnosing a worker that writes nothing, run
  `git merge-base --is-ancestor <fix-sha> <deployed-sha>`.** Get the deployed sha from live
  `/version`. It is one command and it precedes every other hypothesis.
- **⚠️ `/version` reports `git_pinned: true` — treat it as a claim, not proof.** Corroborate with a
  behavioural probe (does a route/field that only exists post-fix respond?) or by checking a
  SIBLING lane that IS writing: if a same-day fix works and yours does not, the boundary between
  them is the answer. That corroboration is what made this diagnosis safe.
- **⚠️ A DB migration ships INSTANTLY; the JS that reads it does not.** This split is why P192/P193
  visibly moved the Tier 0 lane counts (views + migrations, live immediately) while P135/P136 did
  nothing — the same "deploy" was half-applied. **Never infer that a JS change shipped because its
  SQL half is visibly working.**
- **A `pg_cron` job existing proves nothing about the JS it calls** — the cron is a DB object
  created by a migration. Cron 239 existed and fired while its handler's newer half was absent.
- **Corollary — re-measure the deploy itself before recommending one.** The redeploy landed
  (#1789, 23:13 UTC) *during* this very diagnosis; `/version` moved from `bb26453a` to `870445f1`
  mid-session. A recommendation written five minutes earlier would have shipped stale.

### ⚠️ ASSERT ON THE RIGHT OUTPUT — A WORKER'S STATE DELTA MAY BE A *NEGATIVE* RECORD (2026-08-27)

The standing rule is *assert on the state delta, never the flag or the worker's own tally.*
**That is necessary and not sufficient: you also have to assert on the RIGHT delta.**

The reachability harvest (P136) was written up as stalled, and its verification — in the backlog
row *and* in a scheduled check — was "the proposal count must move past 4." Measured 2026-08-27:
**`reachability_harvest_review` is still 4, and the lane is working correctly.**
`reachability_harvest_target_marker` holds **60 markers, all written that morning, the last at
04:40:19** — inside cron 212's run. P136's entire design is a **negative marker** recording
*checked, and empty*, precisely so a target that yields nothing stops being re-selected forever.
**Targets with no evidence correctly produce no proposal**, so the proposal count is the one metric
that reads zero while the fix works perfectly.

- **Before writing a verification, ask what this worker EMITS when it succeeds and finds nothing.**
  If the answer is a marker, a tombstone, a `checked_at`, or any other negative record, **that is
  the delta to assert on.** Asserting only on the positive output reports a false stall — and a
  false stall costs a diagnosis cycle on code that was never broken.
- **This is the mirror of the re-discovery-tally trap.** `already_annotated` reads like throughput
  while nothing moves; a negative-marker worker reads like a stall while everything moves. Both
  come from asserting on the convenient counter instead of the one the design actually advances.
- **⚠️ And a `pg_net` timeout is not a failure.** Cron 212 records `timed_out: true` at exactly
  60,000 ms — `lcc_cron_post` stops listening at 60s while the handler runs to completion (P123).
  Its markers landed 19 seconds in. **Read the worker's own output, never the caller's patience.**

### ⚠️ A MONITOR'S THRESHOLD IS PART OF THE MONITOR — GRADE IT, OR IT GENERATES NOISE AND HIDES BREAKS (B6d, 2026-08-29)

`feed_freshness_registry` carried **`expected_max_age_days = 45` on 10 of 23 domain feeds** — a
default, not a measurement. Four `feed_stale` alerts were open. **Two described DECISIONS** (producers
we had deliberately left dead) and could never close; **two were read as mis-sized SLAs and are
GENUINE INGESTION OUTAGES.** All 25 feeds now carry a `cadence_class` and either a bound with a
mandatory `expectation_basis` or **no bound with a mandatory `unwatched_reason`**, CHECK-enforced.
Full writeup: `docs/audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md`.

- **⚠️ "THE SLA MUST BE WRONG" IS THE COMFORTABLE READING, AND IT WAS WRONG BOTH TIMES.** dia
  `medicare_clinics` reads p50 gap 2d and a **max gap ever of 41d**, so its 45d bound was never the
  issue — **27 failed + 6 abandoned CMS runs** since the last success 2026-06-25, while
  `dataset_modified_date` reads **2026-08-25**: the source is publishing and we are not ingesting.
  gov `sam_lease_opportunities` was re-scoped 14 → 21 **and deliberately left violated at 33d**,
  because the weekly producer is healthy and the SAM call itself returns **401**. **Before widening a
  bound, prove the feed's current age is within its own observed range** — above the largest gap it
  has ever had, the bound is not the problem.
- **⚠️ A FEED'S OWN GAP DISTRIBUTION IS CIRCULAR ONCE IT HAS BEEN DEAD.** An outage is a **closed**
  gap and enters the distribution: `gsa_lease_change_facts` has 2 observation dates and one 170-day
  gap — *the outage B6b repaired* — so a 3×p90 rule derives a **510-day** bound. **B6a's p90 rule is
  correct for pipeline STEPS and does not transfer to FEEDS** (a dead step's gap never closes; a dead
  feed's does, the moment it restarts). Lifetime windows also mix REGIMES. Size from the producer's
  **declared** schedule, corroborate on the current regime, and below three gaps say
  `cannot_be_sized_from_data` rather than dressing a guess up as a measurement.
- **⚠️ THE GRADING INSTRUMENT FELL INTO ITS OWN TRAP.** The first cut of `v_feed_expectation_grade`
  compared the bound to the observed **MAX** gap and flagged **six correctly-sized feeds** — purely
  because they have broken before. **A gap larger than the bound is exactly what the bound EXISTS to
  catch.** It keys on the **median** now; the max is reported separately as
  `observed_silence_exceeds_sla`, meaning *has broken before*, not *is mis-sized*.
- **⚠️ RETIRE AN EXPECTATION BY REMOVING THE BOUND, NEVER THE ROW.** `lcc_check_feed_freshness`
  auto-resolves only a feed that is PRESENT and not stale, so dropping a retired feed off the surface
  (`is_active = false`) makes its open alert **permanent** — live on `property_sale_events` the same
  day B6c-dup retired it. An unwatched feed now EMITS with `status='unwatched'` and a NULL bound, and
  the resolve arm keys on **that positive statement, never on ABSENCE** — absence also covers a feed
  whose query errored or whose mirror went blind. The residual is **counted as `alerts_orphaned`,
  never auto-resolved**: a decision and a disappearance must not close identically. This is B6a's
  *"a skipped step must emit, not vanish"* one layer up.
- **⚠️ FOUR FEEDS FED BY ONE PUBLISHER MUST SHARE A BASIS.** The GSA family carried 65/35/45/45, three
  of them below the publication cycle's own peak (monthly, 21–51d lag ⇒ ~82d peak data age). One was
  **6 days from firing on a healthy feed**; another **would have fired 2026-09-10** because its
  cadence changed three weeks earlier and its bound had not. Keep *"did WE stop pulling"*
  (`gsa_source_pull`, 21d) separate from *"is the publisher publishing"* (`gsa_leases_snapshot`, 90d).
- **⚠️ ENUMERATE EVERY REGISTRY THAT FEEDS THE MONITOR.** The population is **25, not 23** — LCC Opps
  has its own `feed_freshness_registry` (`om_intake`, `salesforce_sync`) evaluated through the check's
  `lcc_local` arm, invisible to a count taken from the domain databases.
- **Standing instruments:** `v_feed_expectation_grade` + `compute_feed_cadence()` on gov and dia put
  the measured distribution beside the configured bound, so this is re-gradeable rather than a
  one-shot that rots (Class 8). ⚠️ `compute_feed_cadence` is SECURITY DEFINER over registry-derived
  dynamic SQL — **service_role only**, never anon (the vector B6a closed on its sibling).
- **⚠️ AND THE FIRST ATTEMPT AT THAT NARROWING WAS A NO-OP: `REVOKE ... FROM anon, authenticated`
  DOES NOT REMOVE THE **PUBLIC** GRANT.** Postgres grants EXECUTE on a newly created FUNCTION to
  PUBLIC by default, so both roles still reached the definer function through PUBLIC — measured
  live *after* the "fix" shipped: `proacl = {=X/postgres, …}` (the leading `=X` IS PUBLIC) and
  `has_function_privilege('anon', oid, 'EXECUTE') = TRUE` on gov and dia. A **VIEW** gets no default
  PUBLIC grant, which is why the view half of the same migration WAS effective and the function half
  was not. **Assert a privilege with `has_function_privilege()` / `has_table_privilege()`, never by
  reading the GRANT or REVOKE you just wrote** — the claim was checkable in one query, and four
  artifacts (migration comment, audit doc, backlog row, guard) repeated it unverified until a review
  bot caught it. ⚠️ **Do not generalise to "revoke PUBLIC from every definer function"**:
  `compute_feed_freshness` keeps an explicit `anon` grant BY DESIGN (the LCC cross-DB pull reads
  `v_feed_freshness` as anon), and revoking it would silently blind the freshness monitor.
- **⚠️ AND THE COMPLEMENTARY HALF BIT OCR2 LIVE (2026-09-02): `REVOKE ... FROM public` DOES NOT
  REMOVE THE **EXPLICIT** `anon`/`authenticated` GRANTS EITHER.** Supabase ships
  `ALTER DEFAULT PRIVILEGES` granting EXECUTE on new functions to both roles, so at CREATE time they
  hold *explicit* grants, not PUBLIC ones. Measured immediately after applying
  `<dom>_merge_document_extracted_data`: `proacl = {postgres=X/postgres,anon=X/postgres,
  authenticated=X/postgres,service_role=X/postgres}` and
  `has_function_privilege('anon', oid, 'EXECUTE') = TRUE` — i.e. revoking PUBLIC alone was a **no-op
  for the two roles that matter**, the exact mirror of the trap above. **Revoke BOTH
  (`from public, anon, authenticated`), then ASSERT with `has_function_privilege()`.** The one rule
  that covers both halves: *never read a privilege off the GRANT or REVOKE you just wrote.*

### ⚠️ RE-MEASURE A DATED BLOCKER BEFORE QUOTING IT (2026-08-20)

This file and its siblings are full of dated findings — "X is blocked", "Y returns 401", "Z yields
nothing from CI". **They were true when written and several are no longer true.** On 2026-08-20 the gov
CLAUDE.md §18 note "`SAM_GOV_API_KEY` returns 401 API_KEY_INVALID" was quoted as current fact and
Scott acted on it. The key had been valid for weeks; the real constraint was a **rate limit** (~10
lookups/day), which is a completely different problem with a completely different fix. One query
against `sam_entities.created_at` would have caught it.

A dated blocker is a **hypothesis to re-test**, never an input to a recommendation. The re-test is
almost always one cheap query or one probe. Corollary: when you *do* re-measure and the note is wrong,
**fix the note in the same change** — that is how these files stay worth reading.

### ⚠️ "WE MUST ACQUIRE THE DATA" IS THE MOST EXPENSIVE CONCLUSION AVAILABLE — ENUMERATE EVERY TABLE FIRST (B4/B5, 2026-08-28)

After B1a closed the ownership lane as a source of chain DEPTH, gov's deed layer was measured —
**876 grantor-bearing `deed_records` of 5,804; 325 deed documents for 13,835 properties** — and the
conclusion written up was *"depth is now an EXTERNAL acquisition problem (county fetchers, K10)."*
**Both numbers were correct and the conclusion was wrong. It survived one more query.**

**The tables NAMED after the answer were not the tables holding it.** One `group by` on the output's
provenance column settles it: `lcc_entity_portfolio_facts.ownership_source` shows dia derives
**2,207 of its 2,757 historical facts** from **`sales_transactions_seller_exit`** — closing the
SELLER's interval when a sale is recorded — and **gov has no such feeder at all.** gov
`sales_transactions` holds **14,645 rows / 5,321 properties / 1970→2026, 9,514 with a named seller,
4,697 properties with a dated seller**, of which `ownership_history` has consumed **169 rows
(1.8%)** — **3,080 net-new rows / 2,114 properties**, against gov's 178 chained / 2,238 with any
history. That is backlog **B5**, and it also answers **B4** (why dia's deepest chain is 14 vs gov's 6).

- **A missing feeder has NO representation anywhere** — no error, no zero row, no queue, nothing to
  audit. Every other detector in this repo examines rows that exist. **Playbook Class 20** is the
  one that finds rows that were never created, and its detector is a single provenance `group by`
  split by domain: **a source bucket present for one domain and absent for another IS the finding.**
- **It is the A5 rule (*grep for who already writes the gap*) and the A2 rule (*check whether an
  existing producer already minted the parties*) arriving as a RECOMMENDATION rather than a code
  review** — where no test, guard or reviewer catches it.
- **⚠️ Do not date a feeder off `updated_at` on an upserted table.**
  `lcc_entity_portfolio_facts` has **no creation timestamp**, and the nightly
  `lcc_finalize_entity_portfolios` re-upsert touches **11,828 of 14,076 rows every day** — so every
  source reads "written today." Find the producer in CODE; **if it is a one-shot, the sibling domain
  has a Class 8 problem of its own.**
- **Quote the ANTI-JOINED count, never the raw one**, and report the **coverage delta and the depth
  delta separately** — B1 moved `any_history` +901 and `chain_2plus` +28.
- **Deed acquisition is DEFERRED, not refuted** — it remains right for the tail B5 cannot reach.
  Size it *after*, when the residual gap is known rather than assumed.
- ✅ **B5 SHIPPED 2026-08-28 and the premise held**: gov `ownership_history` **16,177 → 18,953**
  (+2,776 / 2,000 properties, **677 with no prior history at all**), transitions view 9,595 →
  12,371 / 4,698 → **5,555** properties. **The ceiling graded DOWN** (3,080 → 2,776), which is what
  a ceiling handed over to be disproved is for.
  - ⚠️ **AND IT NEARLY DESTROYED DATA ON THE WAY IN.** `trg_propagate_ownership_to_property` had no
    guard on `NEW.recorded_owner_id`, so any row naming its parties **as text** (`gsa_lease_diff`,
    `deed_extraction`, B5) **nulled the property's recorded owner** — **7,567 rows already in that
    shape; B5's batch would have destroyed 1,446 of 9,312.** Fixed fill-forward. **Any propagation
    trigger must be fill-forward and positive-controlled in BOTH directions** (it preserves when the
    source is null; it propagates when set). Others are unaudited — backlog **D3**.
  - ⚠️ **THE TWO PARALLEL WINDOWS MEASURED ONE POPULATION AND DISAGREED BY 10×, NEITHER ERRORING.**
    B6 §6 sized the same feeder at **~270–370 rows**, objected that 34% of the source is the retired
    circular `ownership_change_stub*`, and advised *"resize before building"* — **after B5 had
    already shipped.** Live: **2 of 2,776 (0.07%)** trace to a stub. **The decisive check was the
    one that does not depend on the disputed key — 677 properties had NO history before B5, and a
    duplicate cannot create history for a property that had none.** Two lessons: *merged is not
    running* has a mirror, **in flight is not unbuilt**; and **when two honest measurements
    disagree, find the measurement independent of the disputed key** rather than adjudicating keys.
  - ⚠️ **A2b's earliest-wins date rule does NOT transfer here** — against an already-recorded pair
    the sale row is **later 217 times, earlier 34** (the inverse of A2b's 26-of-26), so B5 keys on
    the **party pair**. *The hazard travels with the technique*, and so does the calibration.
  - ⚠️ **The LCC side does not move until the Railway deploy.** **527 of 579 open tasks carry a
    pre-B5 draft** and the drafter prepares only `fresh = open ∧ undrafted` — **the stale-draft trap
    for the THIRD time** (A4b, A2b, B5). `runB5RedraftPass` is keyed on STATE so it catches the next
    source too; without it B5 converts on **52** tasks, not 579.
  - ⚠️ **AND `/api/*` IS AUTH-ENFORCED, SO A BEHAVIOURAL DEPLOY PROBE AGAINST A HANDLER RETURNS
    `HTTP 401` — WHICH A GREP READS AS "THE FIELD IS ABSENT."** That happened live on 2026-08-28:
    `GET /api/ownership-chain-draft-tick | grep b5_redraft` matched nothing because the body was
    `{"error":"Authentication required…"}`, and the empty match was reported as a stale deploy.
    **Use `/version` plus `git merge-base --is-ancestor <fix-sha> <deployed-sha>`** — the doctrine
    already in this file — rather than parsing a handler response. If you must probe a handler,
    **print the HTTP status and grep for a control field that shipped EARLIER in the same
    response** (`a2b_redraft`), or the probe cannot tell *absent* from *never reached*.

### 🏛️ Data coherence is a CONTRACT now — `docs/architecture/data-coherence-invariants.md`

Scott, 2026-08-28: *"all data sources and ingestion should propel the entire database forward, not
just a bunch of different component parts or subdatabases or tables"* — **for the current two
domain DBs and every one added later.** Ten invariants (**I1–I10**), a new-database onboarding
checklist, and the honest status: **two of ten have a standing detector.** Every defect behind it
was **individually correct code** that passed component tests, boot checks and health views —
because **these are properties of CONNECTIONS, which nothing asserts.** Campaign **P0d / D1–D5**.
The two cheapest and highest-yield: **D1** the provenance producer-set diff (Class 20 — it found
B5) and **D2** the link-column type audit (`property_sale_events` link columns are `bigint` against
`uuid` PKs — the column **cannot hold the value it is named for**).

### ⚠️ A STATUS VALUE IS NOT A HUMAN VERDICT UNTIL YOU NAME ITS WRITER (B6b-lead, 2026-08-29)

`prospect_leads` where `lead_source='ownership_change'` was cited by two successive audits — and by
the prompt that acted on them — as **"7,729 leads · 2,041 worked · 208 pushed to Salesforce · 2,149
touched in 30 days"**, and that "confirmed alive consumer" was the entire justification for
restarting a dead producer. **Every number is real. Every one means something else.**

- **"2,041 worked"** = `pipeline_status = 'filtered_multi_tenant'` — an **automated exclusion
  filter**. The lane has exactly **two** status values ever, `new` and that one. **No human has ever
  set a status on it.**
- **"208 pushed to Salesforce"** = `sf_contact_id IS NOT NULL`, i.e. a **matched EXISTING contact**.
  ⚠️ **`sf_lead_id` is non-null on 0 of 7,729 and `sf_sync_status='pending'` on ALL 7,729 — nothing
  has ever been pushed.**
- **"2,149 touched in 30 days"** = **1,216 of them on ONE day**. A bulk sweep, not use.

**The lane has no human consumer. It is Class 2, which is exactly what it was claimed not to be.**

- **Three questions, one query each:** *who or what SETS this status* (two machine-written values is
  not a workflow) · *does the "sent" column mean sent* (a destination id means **matched**; an
  emitted id means **sent** — check the emitted one and the sync status) · *is the activity a
  distribution or a spike* (`count(distinct updated_at::date)` plus the largest single day).
- ⚠️ **This is the A5 lesson — 596 `gap_resolved` "completions" that were all a truncated auto-close
  — repeated four days later by the same author on a different lane. Knowing the rule did not
  prevent it.** Third instance of the shape overall, with P159a's `drillthrough: 37`.
  **Playbook Class 26.**
- ⚠️ **The correction did NOT reverse the decision here — it replaced the reason.** The safety gate
  (`is_same_owner`, 91.80% agreement, errs conservative) **passed** its stop test; the restart was
  refused on the **consumer** finding, which the gate grade could never have surfaced.
  **Grade the gate AND the consumer — either can disqualify.**

### ⚠️ `| tee` WITHOUT `pipefail` MASKS THE EXIT CODE — A GREEN CI RUN THAT DID NOTHING (fred_ingest, 2026-09-01)

`.github/workflows/fred-ingest-daily.yml` reported **16 consecutive GREEN scheduled runs** while
writing **ZERO rows**. Verified: `dia.economic_indicators` last took a row **2026-08-07** and none
since **2026-08-10**. **The module dies at import — `ModuleNotFoundError: postgrest` — and the step
pipes through `| tee`, so the shell returns TEE's exit status, not Python's.** In `bash`, a
pipeline's status is its **last** command unless `set -o pipefail` is set.

- **Any CI step of the form `python -m x ... | tee log.txt` needs `set -o pipefail`** (or
  `PIPESTATUS`), or **a crashing job is indistinguishable from a working one.**
- ⚠️ **It was ALSO absent from `INFRASTRUCTURE.md`'s job map** — a producer nobody had written down,
  failing silently, wearing a green badge. **The two defects compound: nothing watched it, and what
  did watch it lied.**
- **It was found only because the producer registry was enumerated from the SCHEDULER rather than
  from the run ledger.** `fred_ingest` writes no run row, so it is invisible to `ingestion_tracker`
  — **building a producer registry from the run table rebuilds the blindness one level up.**
- **Green CI is not a state delta.** The rule this file states for crons applies identically to
  workflows: **assert on rows written, never on the runner's exit status.**
- 🚨 **`| tee` IS ONE MASKING IDIOM. `|| echo` IS ANOTHER, AND IT IS WORSE BECAUSE IT LOOKS
  DELIBERATE.** The FRED sweep found Dialysis `ci.yml` using it **five times** —
  `pytest tests/ … 2>/dev/null || echo "Tests completed…"` — so **3,042 collected tests cannot fail
  a merge**, and `2>/dev/null` discards the traceback. **Every mutation-verified guard in that repo
  is a regression detector no gate enforces.** ⚠️ **This is the same finding as *"no workflow runs
  `npm test` on a PR"* in this repo, in a second repo, in a different idiom** — so **grep for the
  masking SHAPE (`|| echo`, `| tee`, `2>/dev/null`, `continue-on-error`, `exit 0`), never for one
  spelling.**
- 🎯 **And the cruellest form: the repo already had the detector and had muzzled it.** Lines 137–138
  of that same file are `python -c "import src.main" 2>/dev/null || echo` — **exactly the check that
  would have caught FRED's `ModuleNotFoundError: postgrest`.** Twenty-five days of green badges over
  a dead producer, with the guard sitting right there. **Before adding a detector, check whether one
  exists and is silenced.**
- ⚠️ **Do NOT simply remove the masking.** Gating a never-enforced suite is the documented *"never
  green once on `main`"* trap. **Sequence: measure on `main` → fix or quarantine what is red →
  unmask ONE LINE AT A TIME, starting with the cheapest check (the import).**

### ⚠️ A NODE SCRIPT THAT PRINTS NOTHING AND EXITS 0 HAS NOT RUN — check the main guard (OCR1, 2026-09-02)

`scripts/ocr-bakeoff.mjs` guarded `main()` with `import.meta.url === \`file://${process.argv[1]}\``.
On Windows `argv[1]` is `C:\…\x.mjs` and the URL is `file:///C:/…`, so the compare **never matches,
`main()` never runs, and every command exits 0 with no output** — `--self-test`, `--fetch-baselines`
and `--run` all "succeeded" on Scott's first real run having done nothing. The sandbox (Linux) could
not reproduce it. Same shape as `| tee` without `pipefail`: a green exit over zero work.
**Use `import.meta.url === pathToFileURL(process.argv[1]).href` and `fileURLToPath(import.meta.url)`,
never string-built `file://` or `new URL(...).pathname`.** Guard:
`test/scripts-main-guard-windows.test.mjs` (class-wide over `scripts/`, `mcp/`, `api/`; positive
control; comments stripped). **And on the operator side: a bake-off, backfill or probe that returns
to the prompt in under a second with nothing printed is a symptom, not a success.**

### ⚠️ AN AGREEMENT RATE HAS NO MEANING WITHOUT THE MODEL'S SELF-AGREEMENT FLOOR (OCR1c, 2026-09-02)

The bake-off's first real run scored **77% tesseract-vs-DocAI field agreement over 10 documents**,
and the number was **uninterpretable**. Reading the 11 non-agreements — rather than counting them —
found **at least 6 were harness or model artifacts**: 2 were `Kohl's` vs `Kohl’s`, 2 were `""` vs
`null` scored `candidate_only`, 2 were the MODEL doing different arithmetic on text both sides
carried **verbatim**, and 4 date disagreements had **no attributable cause at all**. If the model
disagrees with itself 20% of the time on identical text, 77% is a WIN; at 99% it is a loss.
`--control self` runs the same model twice on the same baseline text and scores run 2 against run 1
with the **same comparator and the same both-null exclusion**, so the two rates are subtractable.
Writeup: `docs/audits/OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md` §8.

- **Wherever a MODEL sits between the thing under test and the metric, measure the model against
  itself first.** Two independent calls, **never `temperature=0`** — pinning a seed measures a
  configuration nobody runs and reports a floor the pipeline never has. `deltaVsSelf` returns
  **null, never 0**, when either side has no decided field (P180: 0 reads as *at parity*, the truth
  is *not measured*).
- **⚠️ NORMALIZE BEFORE COUNTING, AND KEEP THE SENTINEL LIST NARROW.** `""`, `null`, `N/A` and a
  dash all mean *the source did not state this*; scoring one against another reports a disagreement
  that does not exist. But `0` is a VALUE and `Nullarbor Holdings LLC` is a NAME — widening the test
  into "looks empty" is how a genuine miss gets hidden as `both_null`. And **rounding is not a
  tolerance**: `412500` vs `412600` must stay a disagreement, because that digit error is the thing
  the measurement exists to catch.
- **⚠️ A DETECTOR FOR A CODE SHAPE MUST BLANK STRING LITERALS, NOT ONLY COMMENTS — AND THE ORDER IS
  COMMENTS FIRST.** This file's standing rule is *strip comments before grepping source* (A5c, N18,
  B1). OCR1c found the next layer: the harness's own RENDERED REPORT says *"deliberately NOT
  `temperature=0`"* in a pushed string, so the anti-seed-pinning grep matched the sentence
  **explaining** the rule and went red over correct code. Blanking literals fixes it — but blanking
  them BEFORE stripping comments is worse than not blanking at all, because a bare apostrophe in
  ordinary prose (*"the engine's output"*) opens a string the scanner never closes and swallows real
  code behind it. **That is how the positive-control mutation for that assertion survived its first
  mutation run**; it was found by the mutation pass, not by reading the guard.
- **⚠️ A PROBE'S "AVAILABLE" IS A TRI-STATE.** `paddleocr --version` succeeding does not mean the
  engine works — `pip install paddleocr` installs the WRAPPER; the engine is `paddlepaddle`. So the
  probe must distinguish *wrapper only* (unavailable, name the pip package) from *could not check*
  (no python on PATH — **not** the same as missing) from *needs a Docker VLM server* (skip here, keep
  it runnable on the GPU box). Reading a binary's presence as availability cost **36 identical
  failures** whose printed reason was the same `RequestsDependencyWarning` — **show the LAST 300
  characters of stderr, never the first**, because a tool writes its warnings first and its cause
  last.
- **⚠️ A COUNT OF FOUND FIELDS IS NOT READABLE — CARRY THE VALUES.** `5/6 fields found` at OCR
  confidence 68 on a title/docs bundle is indistinguishable from 5/6 on a clean lease until somebody
  reads what was found. They already existed in memory.

### ⚠️ A MODEL'S QUOTE AND ITS LABEL ARE NOT THE SAME EVIDENCE — PARSE THE QUOTE (EXT1, EXT1b, 2026-09-02)

EXT1 stopped the lease extractor doing arithmetic and picking date defaults, and made it QUOTE:
`base_rent {amount, basis, as_stated}` and a date with a `precision` beside the verbatim text. The
floor re-run measured what that bought — rent and date disagreements against DocAI **2 → 0 and
4 → 0**, doc 255 reading **101,568** on all three runs where it had read 8,464 / 89,496 / 84,464 —
and, more usefully, what it did NOT buy: `year1_rent` self-agreement held at **89%** and both dates
sat at **80%**. **The quotes were reliably verbatim and the LABELS beside them were not.** Live:
`as_stated: "$8,796.50 per month"` came back `basis: "per_sf_annual"` with `amount: 8.7965`, and a
plain `"March 15, 2021"` came back `precision: "formula"` on one call and `"day"` on the next.
EXT1b derives basis, amount and precision **from the quote in code**, and the model's label is the
fallback where the quote is silent. Guard `test/ext1b-as-stated-authority.test.mjs` (23 tests,
**16/16 mutations RED**); record `docs/claude-code/responses/EXT1b-basis-precision-quotes.response.md`.

- **The durable rule: when a model reports a value AND a classification of that value, they are two
  different reliabilities.** The verbatim span is transcription; the label is judgement, and it is
  the half that flips between calls. Ask for both, then **decide the label in code from the span**.
  This is the P125 lesson (*a proxy for a fact you already hold is not a measurement*) inverted: here
  the fact you already hold is the QUOTE, and the model's own summary of it is the proxy.
- **⚠️ A SCALING ERROR HAS NO TOLERANCE THAT DISTINGUISHES IT FROM A DIFFERENT FIGURE.** 8.7965 and
  8,796.50 are one figure ÷ 1,000; any numeric threshold wide enough to catch that also swallows a
  genuinely different number on the page. **The test is PRESENCE: the model's number must appear in
  the model's own quote**, else the quote's first `$`-figure wins. Measured on *"a security deposit of
  $10,000 and base rent of $8,796.50 per month"* — a bare first-figure rule takes the deposit.
- **⚠️ A UNIT/BASIS BELONGS TO ONE FIGURE, SO CLASSIFY A WINDOW, NOT THE STRING.** A rent quote
  routinely restates the same rent on a second basis (*"$75,000.00 per year ($6,250.00 per month)"*);
  over the whole string that is ambiguous and abstains, losing the row. The window runs to the **next**
  `$`-figure after the one being classified. And where a window genuinely carries two period markers
  the answer is **null — silence hands the decision back to the model's label, it does not flip a
  coin.**
- **⚠️ A PARSER FOR "IS THIS QUOTE A DATE" MUST CONSUME THE WHOLE QUOTE, NEVER SEARCH IT.**
  *"the earlier of March 1, 2021 or thirty days after Delivery"* CONTAINS a calendar date and IS a
  formula; a `.search()` resolves it and re-commits the exact defect EXT1 removed. Strip a small
  CLOSED set of structural wrappers (a `Label:` prefix, `on the`, `midnight on`, trailing punctuation)
  and then require a full match. **And the quote decides in BOTH directions** — a month-only quote
  under a `day` label drops the day the model invented, which is the half that is easy to omit.
- **ONE parser.** `resolveQuotedDate`'s bare-string branch routes through the same `parseStatedDate`;
  a second date parser beside it is the normaliser drift this file warns about a dozen times.
- **⚠️ MY OWN PREDICTION WAS WRONG IN A NAMED WAY, AND EXT1b's IS THE SAME SHAPE.** EXT1 predicted
  the floor would reach ~100% and it did not, **because it assumed the model's LABELS would be as
  reliable as its QUOTES**. EXT1b predicts ~100% again, from having READ the residual rows — but a
  field can still disagree for a reason nobody has read yet. **Read the rows before predicting the
  aggregate, and say which reading the prediction rests on.** Second caveat, structural: fixing a
  both-null row makes it DECIDED, so **the denominator moves** and the new rate is not directly
  comparable to the old one without reading the counts.
- **EXT2 (2026-09-03) — WHEN THE RESIDUE IS TWO VERBATIM LINES FROM ONE LEASE, THE ANSWER IS A DEFINITION,
  AND SCOTT'S DEFINITION IS "THE LEASE DEFINES IT."** Base rent is whatever the lease labels base/minimum/
  fixed rent (`defined_term` + `definition_as_stated` quoted; separately-stated equipment/additional rent as
  its own `additional_rent` row, NEVER summed — `year1_total_rent` is a second field); year 1 is the schedule
  period at **Rent Commencement** (its own quoted date), with `year1_rent_source` recording which rule fired;
  **the tenant is the counterparty legal entity, and that entity IS the credit** absent an express guaranty
  clause in the lease — `credit_entity` = guarantor only with `guaranty_as_stated`, else the tenant, and a
  `parent_mentioned` is structurally unable to become the credit (a parent is not liable for a subsidiary
  without express authorization; the credit may be a subsidiary of unknown size, and the code says so).
  - **⚠️ A PROMPT'S OWN RULES SATISFY A GREP FOR ITS SCHEMA KEYS.** `assert.match(prompt, /"additional_rent"/)`
    stayed green with the field deleted from the JSON contract, because the rules paragraph names the key
    while explaining it. Comment-stripping cannot help — the prose IS the deliverable. Anchor on the
    **schema line** (`\n\s*"additional_rent": \[`) or a `": string` type token; three assertions were
    found this way by the mutation pass, not by reading them. Guard
    `test/ext2-lease-defines-rent-and-tenant.test.mjs` (32 tests, 28/28 RED).
  - **A COUNT ASSERTION ON A WIRING IS SUPERSEDED BY THE NEXT CORRECT CHANGE.** EXT1b's guard asserted
    *exactly 2* `reconcileQuotedDateWithQuote(resolveQuotedDate(` sites; `rent_commencement` is a third
    quoted date, so a correct change turned it red. It asserts per NAMED date now (the P197 shape).
- **A genuine OCR miss must stay an honest null.** Doc 425's dates came through tesseract as
  `"1st day of A ec | , 2000"`; the model correctly returned `formula`/null and DocAI read both.
  **That is the signal the bake-off exists for** — an "improvement" that turns it into a date is a
  regression.

### Dead-end classes are findable on purpose — `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md`

Nine live defects were found in one session on 2026-08-22, all by accident, and every one
belonged to a **class** with a repeatable detector. The playbook has the query for each and
what it found on first run. Summary:

| class | detector | first run |
|---|---|---|
| entity FK missing from the merge path | `lcc_audit_merge_path_coverage()` | 9 columns, **370 stranded rows** (`lcc_decisions.subject_entity_id` = 286) |
| producer with no consumer | open vs ever-closed **by STATUS, not timestamp** | **1,123 tasks across 7 types, ZERO completions ever** |
| surface notifies but cannot capture | grep the renderer for `<input>` | Research page has **0 input fields** — that is why 316 tasks are unworked |
| guard checks the label, not the substance | ask what other attribute identifies the population | broker guard reads ROLE; 80 broker/own-firm edges wore `prospecting_contact` |
| dormant capability ≈ quiet pipeline | `feature_flags_registry where state <> 'on'` | every external acquisition adapter off since June; 249 owners have no automated route |
| a count that measures state, not throughput | "what changes if the system idles a week?" | queue read 1,406 vs a real working set of 160; rent double-counted 4.65× |
| **a capability that exists but is UNREACHABLE** | after building, ask what is on **page 1** | P173's new button sat at **row 1,869 — page 75**; 142/142 guards passed on a fix no operator could reach |
| **a PRODUCER re-creates what the cleanup cleaned** | was the row written **after** the cleanup? (`max(child.updated_at) > entity.updated_at`) | **119 tombstones carrying 198 live portfolio facts, $71.8M**, re-upserted DAILY — the merge path was correct all along |
| **a WORKER whose cursor is its own OUTPUT** | diff the working set across two consecutive runs — identical ids twice IS the diagnosis | property-twin **0 writes in 7d** behind 1,095 pending (P135); reachability-harvest **16 rows EVER, 0 in 11d** behind ~15k, re-checking the same 120 nightly (P136) |

**Two traps the merge-path detector had to survive, each of which gave a wrong answer first:**
declared FKs alone MISS `owner_contact_pivot.active_contact_entity_id` (no FK constraint — match
on column NAME); and the merge path is **more than one function**, so checking only
`lcc_reconcile_tombstone_backrefs` falsely flags columns P160 repointed inside
`lcc_merge_entity` (28 apparent defects → 20 real).

**Repair per column, never blanket.** P167 proved "repoint to the survivor" is the obvious and
wrong answer — all three survivors were organisations, and repointing would have made Boyd
Watterson its own contact.

**⚠️ A WORKER THAT LEAVES NO TRACE ON AN EMPTY TARGET CANNOT PAGE PAST IT (P136, 2026-08-26).**
P135 unstuck the property-twin assist by lifting a fixed window, because *an annotation is
that lane's cursor* — an annotated row self-excludes. The reachability harvest looked
identical and was not: its proposals are keyed `(arm, contact, field)`, so a target that
yields nothing leaves **no row anywhere**, is re-selected the next night, and yields nothing
again — **16 review rows EVER, 0 in 11 days, behind a ~15k pool**, cron green throughout.
Paging alone would not have fixed it; it needed a NEGATIVE marker
(`reachability_harvest_target_marker` — *checked, and empty*), dated and **expiring** so the
exclusion clears when new evidence lands. Before declaring a paging fix sufficient, ask **what
makes a target stop being selected** — if the only answer is "it produces output", every empty
target is permanent residue.
- **And the ordering was never the bug — the JOIN was missing.** The same diagnostic response
  carried `targets:120, with_evidence:0` next to `evidence_sources {intake:5000,
  comms_names:4305}` and `comms_scan.harvestable:7926`. The tick ranked the unreachable pool
  and *then* asked whether evidence existed for the winners. Selection now joins the evidence
  index first. **Ask what a producer JOINS on, not just what it orders by** — the producer-side
  form of the P179 "three causes of unreachable" lesson.
- **A bigger window is not the fix.** Raising 120 → 1,000 proposes once and stalls at row
  1,001, with the failure now more expensive to see. Cursor that advances + selection that
  joins. Full class: `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 12.
- **⚠️ THE MARKER IS ALSO THE DIAGNOSTIC — a worker with no trace cannot be GRADED, not just
  cannot page (assessor enrichment, 2026-09-01).** P136 framed the negative marker as a *paging*
  fix. The dia assessor drain is the purer case: `--from-queue 25` returned **`processed 25,
  enriched 0, fields_updated 0, errors 0` in 114.8 s** — ~4.6 s/property of real elapsed work, so
  it is reaching *something* — and it writes nothing on **either** outcome (`attempts`,
  `last_attempt_at`, `last_error` unwritten on all 1,365 rows since the queue was minted
  2026-05-21). So *the source genuinely has nothing for these parcels* (a real ceiling ⇒ retire the
  lane) and *every call is failing* (a fixable adapter) are **indistinguishable from the outside**,
  and the run is unrepeatable-with-learning: it re-selects the same 25 rows forever. **When a
  worker escalates or abstains, the reason is the deliverable** — the same lesson P181 drew for
  confidence on human escalations, one layer down.
- **⚠️ RUN AN UNSCHEDULED PRODUCER ONCE BEFORE WIRING A CRON TO IT.** `errors: 0` beside
  `enriched: 0` is the silent-success shape this file catalogues everywhere; a schedule would have
  emitted exactly that weekly, forever, over a **one-shot queue with no enqueuer**. Three defect
  classes (silent success · no cursor · no producer) in one job, all visible in a single manual
  run and **none of them visible from the code, the flag, or a green cron.** The sequence is
  strict and the schedule is last: **marker → verdict → producer → cron.** Scheduling first is how
  the FRED, CMS and public-record producers each became silent.

### The failure mode that matters looks exactly like success

Every silent failure found on 2026-08-19/20 reported healthy: `pages_fired: 6` with every page empty;
`rate_limited:true` with `api_calls:0` behind a fail-soft that skips the "checked" mark so a 98%
throttled pipeline is indistinguishable from a slow healthy one; `drillthrough: 37` while the queue
drained 6; `HTTP 200 []` from a view anon cannot read; cron 136/137 green daily for three weeks while
writing nothing. **Assert on the STATE DELTA — rows written, queue drained, population changed — never
on the worker's own tally, its exit status, or "the cron is active".**

### The operator doctrine for every surface (Scott, 2026-09-02 app review)

Stated five ways across 41 screenshots and recorded once: **the human sees the minimum effective
dose.** A card earns a human only when the step is one only a human can take — **send the email,
make the call, spend money, reach a source the code cannot (SOS bot-wall, a county), or a judgement
no rule can make.** Everything else runs outside human view and the system propels itself until it
cannot. **Buyers are pursued by SHOWING them deals; linking a buyer contact to Salesforce is
plumbing.** The priority queue is **seller prospecting** — $2.5M–$25M, newer lease, a reason to
sell, an owner not yet reached. An SF link is a marker, never evidence we are prospecting someone;
the truth is who we have *actively* and *ever* touched, across the whole ownership chain. Every tab
answers one question exactly. **Full catalog + queue: `docs/architecture/app-ux-review-2026-09-02.md`,
backlog §P16.** ✅ **In the canon since 1.7.0 (2026-09-03): `docs/os/canon/blocks/operator-doctrine.md` + Global invariant 8** — the canon is the source now; this paragraph is the pointer.

### Producer/Consumer (Consumption Layer)

LCC produces work (research tasks, cadences, decisions, queue rows, inbox items) at ingestion scale and
historically under-consumed it, so surfaces filled with un-worked noise that buried the actionable few (the
worst failure mode: a `5,447` / `999+` badge that is mostly noise trains the operator to ignore the surface).
**Every code path that emits operator-facing work MUST satisfy all five:**

1. **Value-gate the producer.** Emit only above an actionability/value floor — never one item per captured row.
   The floor is a single tunable knob (e.g. `$500k` chain-task floor; `CADENCE_SIGNAL_MIN_VALUE`).
   - **⚠️ THE FLOOR BELONGS ON WHAT REACHES A HUMAN, AND THAT IS NOT THE SAME AS "THE PRODUCER"
     ONCE AN AUTOMATED CONSUMER EXISTS (B1, 2026-08-28).** A floor sized for operator attention
     keeps suppressing work the moment a cron starts applying it — measured at **1,548 skips, five
     times the lane's lifetime completions**, for **~8 ms of DB time per item**. Split it by
     CONSUMER (none/low on the automated path, unchanged on anything a person sees), never remove
     it, and **measure which (domain, research_type) pairs the automation actually covers** — the
     dia half of that lane has no source view at all. See the B1 section below.
   - **⚠️ "ACTIONABLE-ONLY" HAS TWO AXES — VALUE **AND** DECIDABILITY (P181, 2026-08-26).**
     `npi_missing_inventory` was correctly capped by patient volume and never asked whether the
     question could be answered at all. An NPPES lookup worker had already run and abstained on
     every row, but stamped them all `low_confidence` — so a genuine judgement call (score 0.80)
     and a hopeless one (0.28) wore the same label. **141 of 203 queued tasks (69%) were
     unanswerable by anyone**, burying the 15 that were. One label covering two different facts
     is what made it invisible. When a worker escalates its residue to a human, **the escalation
     must carry the worker's CONFIDENCE, and the surface must gate on it.**
   - **Before calling a lane dead, check its AGE** — this one was three weeks old, and "0
     completions ever" reads very differently at three weeks than at a year.
2. **Auto-retire + auto-resolve.** A scheduled sweep closes items whose premise cleared and auto-resolves the
   high-confidence subset, leaving genuine judgment calls for a human. Reversible — pause/skip with a reason,
   **never hard-delete**.
   - **⚠️ CLOSING AN ITEM IS NOT CLOSING A LANE — CLEAR THE PRODUCER'S SEED PREDICATE (P176,
     2026-08-26).** P172 superseded 78 `junk_entity_name` cards on merged-away subjects and
     reported a clean 80 → 2. **Within 24 hours 10 of the same subjects were open again**,
     because that lane seeds from a flag on the ENTITY (`metadata->>'junk_name_flagged'`), not
     from `lcc_decisions` — so the nightly seeder correctly re-minted every card the sweep had
     closed. The re-mint surface was exactly the 78 it had "fixed". Before writing anything
     that closes a lane's items, **grep for how that lane is SEEDED and ask what would recreate
     the row tomorrow**; the B9 bulk worker already documents the answer in a comment
     (`delete meta.junk_name_flagged; // drop out of the lane (seed predicate fails)`).
   - **A one-shot repair of a RECURRING producer is a chore you repeat silently forever** —
     pair it with a scheduled sweep (P176 = cron 238, 06:40). Corollary: **a verified result
     has a shelf life.** P172's gate was not wrong, it just could not see the producer; re-run
     the gate a day later, or make it permanent.
3. **Surface actionable-only, value-ranked, capped** (top-N, with a "show all" toggle).
   - **⚠️ "UNREACHABLE" HAS THREE DIFFERENT CAUSES AND ONLY ONE IS FIXED BY RANKING (P179,
     2026-08-26).** Ranking `establish_ownership_history` off a flat priority 100 left it at
     **row 1,528 — page 62** of the global research list. The tempting next move is to demote
     whatever is above it; measured first, the 1,527 rows ahead were two lanes with **4,772 and
     595 lifetime completions**, one completing rows that same day. They were the system
     working, not noise. The three causes: *unranked/flat-defaulted* → rank it (P174);
     *ranked but genuinely behind more valuable work* → a filter/lane picker, NOT a re-rank;
     *reachable but with nowhere to enter an answer* → a capture path (P173/P179). **Measure the
     throughput of whatever a promotion would displace before promoting.**
   - **Capture path BEFORE rank, always.** Ranking an unanswerable lane promotes work nobody can
     complete onto page 1 and displaces work they can — strictly worse than leaving it buried.
4. **Close the loop from real activity** (Salesforce/Outlook activity → cadence advance) rather than a separate
   manual queue.
5. **Honest counts** — every badge is actionable work, not raw output.
   - **⚠️ NULL IS NOT ZERO, AND A LANE SUMMARY IS WHERE THAT BITES (P180, 2026-08-26).**
     `v_lcc_research_lane_summary` first returned `0` for lanes whose tasks carry no
     `entity_id`, which renders "$0" and reads as *worthless*. Six lanes are unsized that way
     and **the two largest are the highest-throughput work in the system**
     (`property_missing_recorded_owner` 4,772 completions, `true_owner_needs_salesforce` 595).
     A "$0" badge on those invites exactly the wrong triage. NULL = "cannot be sized" (render
     an em-dash); a GENUINE $0 (owners present, no known rent) must stay $0 — the two are
     different facts.
   - **Value is per OWNER, never per task**, wherever a producer emits one task per property:
     measured 2× on `establish_ownership_history` and 4.65× on the contact lane. Report the
     task count separately; never blend them into one figure.
   - **An `answerable` flag is CURATED, not inferred** — the UI is the authority on whether a
     capture path exists. When a new capture path ships, update that list in the same change.

**No new producer ships without:** a named consumer (human verdict, worker, or auto-sweep — if none, don't
build the producer); a value-gate; an auto-retire predicate; a ranked/capped actionable-only surface; and where
possible reality-driven advance.

### Data-write discipline (used by nearly every round)

- **Fill-blanks only** — never clobber curated data; only fill NULL/blank fields, or overwrite when the source
  is explicitly more authoritative (priority-gated, below).
- **Conservative / unambiguous matching** — surface ambiguity to a review lane; **never guess**.
- **Provenance-tagged, reversible, idempotent, dry-run-able.** Prefer a snapshot/backup table + a
  `source`/`batch_tag` you can reverse by, over any destructive change. Soft-flag (`metadata.*_flagged`) instead
  of deleting.
- **Never fabricate** — a field the source doesn't state stays blank; a contact/owner is never invented.
- **⚠️ AN "ENRICHMENT" THAT ASKS A MODEL TO RECALL A FACT IS FABRICATION BY CONSTRUCTION, AND IT WEARS
  THE SAME NAME AS A REAL ADAPTER (assessor enrichment, 2026-09-01).** `src/assessor_enrichment.py` is
  named for a county-assessor lookup and **contains no county HTTP call at all** — its one external
  request asks **gpt-4o to recall parcel facts from memory**. A model cannot know a specific parcel's
  year built or lot size; it can only produce a plausible number, and this one would have written that
  number into `properties` as a fact. **It is `[0 fields written on 25 properties]` that saved us**, not
  any guard. **The same class was already recorded one domain over** — gov's ORE Phase A1 rejected
  LLM-recall enrichment for exactly this reason — **and it was never checked on the dia side.**
  - **The rule this generalises to: read what a producer's external call actually TALKS TO before
    trusting its name.** `*_enrichment`, `*_lookup`, `*_fetcher` name an INTENT. Grep the module for
    the host it contacts; if the only outbound call is to a model, it is a generator, not a source, and
    the P131 lens says this is case (c) — **not on-box, not obtainable, build neither.**
  - **And re-run the check across domains whenever one domain records a doctrine rejection.** The
    hazard travels with the TECHNIQUE, not the repo — the same lesson P189/A2/N15c each paid for
    inside one database, one level up.

### Deploy ordering (constant rule)

When a change spans DB + JS: **apply the additive/DB migration first, then ship the JS on the Railway
redeploy.** A DB `CHECK` constraint that enforces new writer output must be applied **AFTER** the writer deploy
(else the still-deployed old writer 500s every write). "Constraint after writer deploy; additive schema before."

### ⚠️ A SHARED jsonb COLUMN NEEDS ONE MERGE OWNER — A `PATCH {col: {...}}` IS A REPLACE (OCR2, 2026-09-02)

The deed drain computed `{method, ocr_tier, ocr_engine, ocr_pages}` on every extraction, returned
them on the tick, and persisted **only** `raw_text` + `ingestion_status` — so gov's 325 deeds with
text and dia's 182 carried **0 OCR provenance** and the tier mix was unauditable. That is the
ordinary half. The half worth carrying:

- **`property_documents.extracted_data` had TWO writers and one REPLACED the whole column.**
  `deed-parser.js` wrote `extracted_data: { deed_extraction, extracted_at }` — a PostgREST PATCH of
  a jsonb column is a **wholesale replace, not a merge** — so a provenance key written beside it was
  destroyed on every deed, and a later `processOneReparse` would destroy one written on an earlier
  tick. **Shipping the provenance write alone would have been a feature that silently no-ops.**
- **The evidence is a KEY CENSUS, not a code read.** gov's 185 rows carry **exactly** the two keys
  that write puts there and nothing else; dia carries **10 rows with a third** (`r59_backfilled_at`,
  from the one call site that already merged). *A sibling key CAN survive; on the replacing path it
  did not.* **`jsonb_object_keys` grouped over the population settles this in one query** — do it
  before adding a key to any shared jsonb column.
- **The fix is ONE merge owner, and it must be an RPC.** PostgREST cannot merge jsonb in a PATCH,
  and a read-then-write from the handler RACES the other writer inside the same tick — so
  `<dom>_merge_document_extracted_data` takes `FOR UPDATE` and both call sites go through it. Per-KEY
  fill-blanks, never whole-object: a patch carrying one new key and one existing key must write the
  new one. A third writer added later inherits the guarantee for free.
- **Keep the legacy write as the RPC-failure FALLBACK.** A half-applied deploy then degrades to
  today's behaviour instead of losing a deed extraction — which would strand the doc in the re-parse
  queue forever.
- **⚠️ THE HAZARD IN AN OPT-OUT IS THE DEFAULT, NOT THE CALLERS.** `extractDocumentText`'s signature
  read `ocrTiered = false`, so *omitting* the flag reached gpt-4o vision directly — the 6–14× tier.
  Both production callers happened to pass `true`, so the census read clean and the risk was entirely
  that a NEW caller inherits the expensive path by writing nothing. Default flipped to `true`, the
  branch REMOVED, and an explicit `false` **refused by name**: a silent bypass of a cost control is
  indistinguishable from the control not existing. `ocrPdfToText` now has exactly ONE call site —
  tier 3 inside `ocrPdfToTextTiered`.
- **⚠️ DO NOT BACKFILL A PROVENANCE YOU CANNOT KNOW, AND MAKE THAT THE VERIFICATION.** 507 deeds
  already carry text; 154 of gov's dated extractions predate DocAI (gpt-4o was the only OCR that
  existed) and 140 carry no date at all. They read `unrecorded`, and **`unrecorded` FALLING is the
  regression signal** — the inverse of the usual "did the number move" check (P180: unknown is not a
  value).
- **Read `provenance_written`, never the `ocr_tier`/`ocr_engine` beside it** — those report what the
  tick COMPUTED, and the gap between computed and persisted was the entire defect. A
  `provenance_reason` of `rpc_non_ok:404` is a **deploy** fact (migration not applied on that
  domain), not a data fact.
- **⚠️ TWO GUARDS PASSED THEIR OWN MUTATION VIA THE IMPORT LINE.** Asserting that the source
  *mentions* `writeTextProvenance` / `mergeExtractedData` survived the mutation that deleted the
  actual call, because the import still carried the identifier — the documented "a guard that matches
  a shape is defeated by a local variable", defeated by an import instead. Both were replaced with
  behavioural tests that INVOKE `processOneDoc` / `processDeedDocument` with stubs, and the ordering
  (`['deed','provenance']`) is asserted directly. Guard
  `test/ocr2-deed-provenance.test.mjs` (18 tests, **16/16 mutations RED**). Writeup:
  `docs/audits/OCR2_DEED_OCR_PROVENANCE_2026-09-02.md`.

### Single-advance-owner (cadence)

`advanceCadence()` (`api/_shared/cadence-engine.js`) is the **single owner** of a cadence advance. Every JS
human-touch writer that advances a cadence tags its `activity_events` row `metadata.skip_cadence_advance='true'`
so the SQL `lcc_activity_event_advance_cadence` trigger skips it — each activity advances exactly once. The
trigger remains the advance owner only for unflagged organic activities.

---

## Field-level data provenance (LCC Opps)

Every cross-table field write to curated tables is observed:

- **`field_provenance`** — append-only log keyed `(target_database, target_table, record_pk_value,
  field_name)`; records source, confidence, source_run_id, decision (`write|skip|conflict|superseded`).
- **`field_source_priority`** — per-field source ranking. **Lower priority = higher trust.** `enforce_mode` is
  `record_only | warn | strict` for gradual rollout. Representative ladder for an owner/recorded field:
  `manual`(1) > `recorded_deed`(3) > `county_records`/`sos_registry`(5–55, source-dependent) >
  `om_extraction`(30–50) > `costar_sidebar`/aggregators(50–70). Consult the row before writing.
- **`lcc_merge_field()`** — the single SQL function that records provenance and returns the write decision;
  application paths consult it. In `record_only` mode UPDATEs still run.
- **`v_field_provenance_unranked`** — schema-drift detector. **Should return 0 rows** — non-zero means a writer
  path was added without a matching `field_source_priority` entry. **Whenever you add a new writer/source to a
  curated field, register a `field_source_priority` row** or this view flags drift. ⚠️ It is a **30-day rolling
  window** and it keys on the **stored** `source`, so **it was structurally blind to a relabelled writer** — see
  the next bullet. ⚠️ **It is a 30-day rolling window and it MOVES — re-measure, never quote.** Live
  2026-09-02 it read **30**, then **29** after PR5 registered one of them; the same day's earlier
  measurement was 22 (a dated figure), and the 35 quoted further below is older still.

### The provenance ladder — invariants (2026-09-02 arc PR1→PR12 + PR5c-entities; full text + measurements in `docs/architecture/field-provenance-ladder.md`)

- **The registry IS the allowlist (PR8).** `lcc_flush_provenance_events()` merges an event under
  its own source name only if a `field_source_priority` row exists for THAT (table, field, source);
  anything else lands as `domain_trigger`. Removing that relabel **armed** every registered source —
  `county_records`@5 is refused explicitly (`v_never_first_class`), never as plumbing.
- **"Unregistered" is NOT a low rung — it is a different branch of `lcc_merge_field` (PR5).** It fills
  a blank, can never override, and is overridable by anyone; ONE registration changes four decision
  classes. So **never delete a rung** — soft-retire in `notes`, predict the merge-outcome delta,
  assert actual == predicted. Verdicts live on `v_field_source_priority_triage`.
- **A rung with no writes is seven different facts.** Seven of PR5's 39 are live on a SECOND ledger
  (`lcc_property_owner_evidence`, which writes no `field_provenance`) — **enumerate the LEDGERS
  before recording a source as never written.** `lcc.`/`dia.`/`gov.` are logical prefixes, not schemas.
- **`lcc_merge_field` ALWAYS inserts a row** (write/skip/conflict), so a (table, field, source) at
  zero rows means **the call never completed**, never that it decided against writing. Test it in
  one rolled-back replay with the caller's exact payload (PR5c).
- **⚠️ WIRING A LADDER ONTO A TABLE WITH AN EMPTY LEDGER BUYS RECORDING, NOT PROTECTION
  (PR5c-entities).** `lcc_merge_field` compares against `field_provenance`, **not the live column**,
  so the first call on every field returns `no_prior_provenance` ⇒ **write**, whatever that column
  already holds — a ladder cannot protect a curated value it has never seen. And `enforce_mode` is
  part of the wiring: `shouldWriteField` blocks only on `strict`, so under **`record_only`** (all ten
  `entities` `email`/`phone` rungs) a `skip` is recorded and the write proceeds anyway. **Read the
  enforce mode before predicting any behaviour change, and never describe such a change as switching
  on fill-blanks protection.** Corollary: where the writer already has its OWN ledger (here
  `metadata.field_sources`), a field the ladder drops must lose its stamp there too — that stamp is
  what the writer reads next run, so a lie in it is self-perpetuating (the PR10 two-ladders shape).
- **⚠️ A GREP DOES NOT FIND THE WRITERS OF A COLUMN, AND PER-FILE COLUMN UNIONS CONFLATE THEM.**
  Censusing `entities` writes by grep gave **24 sites / 13 files**; an AST walk gave **41 / 16**.
  Unioning columns per FILE then reported `bridge-handlers-salesforce.js` as an `email`/`phone`
  PATCHer when only its CREATE path carries them and both PATCHes are `metadata`-only. **Count with
  a parser and read the payload per SITE** (the N15c lesson, at column grain).
- **`target_database` is a CLOSED vocabulary** (`lcc_opps`/`dia_db`/`gov_db`, CHECK-enforced) and
  is NOT part of the rung lookup, so a wrong value passes every ladder check and fails 23514 at the
  INSERT. Single owner: `provenanceTargetDatabase()` in `api/_shared/field-priority-guard.js`.
  **A comment naming a sibling call site as correct is not evidence** (PR5c).
- **Never cast text to `bytea` to feed a digest — use `convert_to(t,'UTF8')` (PR12).** The old
  generated `value_text_hash` aborted `lcc_merge_field` on any backslash-rendering value (quotes,
  **newlines** — ~1,101 exposed, mostly `sales_transactions` narrative on NON-rung columns). Plain
  column + BEFORE trigger now; `DROP EXPRESSION` is metadata-only, no rewrite. **Never backfill a
  lost provenance row** — record the loss as a number and a date.
- **A gate that fails open must leave a trace.** `shouldWriteField` still proceeds on RPC failure
  but records the DB's SQLSTATE, counts `provenance_failed` and opens
  `lcc_health_alerts(provenance_write_failed)`. ⚠️ It cannot see callers that hit the RPC directly
  (PR5c-signal).
- **Measurement traps paid for on this topic, all caught by positive controls:** `split_part(x,':evt',1)`
  invents 9,950 source names when the delimiter is absent; `LIKE '%\%'` means "ends with `%`";
  `to_jsonb(col::text)` over a jsonb column reads 100%; `definition ILIKE` matches the projection not
  the predicate; a census scoped to ladder-governed columns misses `lcc_merge_field`'s unregistered
  callers (16× under-count); a file-wide grep for a predicate that legitimately appears twice is
  not a guard. **State which grain a count is on** (source vs field vs rung).
- **Three deploy surfaces:** migration (instant) · Railway (`/version` + `merge-base`) · Supabase
  edge function (`list_edge_functions.updated_at`). `availability-checker` is fixed in source and
  undeployed (PR5c-deploy). ⚠️ **The sandbox cannot reach Railway, but the DB can:**
  `select net.http_get('https://tranquil-delight-production-633f.up.railway.app/version')` on LCC Opps,
  then read `net._http_response` ~15 s later. The host WITHOUT `-633f` answers 404
  `Application not found` and reads exactly like a dead deploy. Every "`/version` unreachable from the
  sandbox" note elsewhere in this file predates this (2026-09-02).

- **`v_field_provenance_actionable`** / `v_field_provenance_current` / `v_field_provenance_conflicts` — drive
  the Decision Center provenance lanes.

**Canonical topic page: `docs/architecture/field-provenance-ladder.md`** (model, instruments, live state, arc index, and the PR8/PR5/PR12/PR5c lessons in full). Full rollout plan: `docs/architecture/data_quality_self_learning_loop.md`. Schema:
`supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql`.

## OM Intake Pipeline — three channels, one shared path

All three converge on `api/_shared/intake-om-pipeline.js::stageOmIntake`:

1. **Email** (Power Automate flagged-email) → `POST /api/intake?_route=outlook-message`.
2. **Sidebar** (Chrome extension / CoStar capture) → `api/_handlers/sidebar-pipeline.js` (writes domain DBs
   directly; does **not** go through stageOmIntake).
3. **Copilot Studio** → `POST /api/intake/stage-om` → `handleIntakeStageOm`.

- **Email PA footgun:** the HTTP PUT body MUST use `base64ToBinary(items('Apply_to_each')['contentBytes'])`;
  raw `contentBytes` writes base64-text (extractor has a `recoverIfBase64Wrapped` net).
- No OM attachment ⇒ `handleOutlookMessage` synthesizes a `text/plain` artifact from subject+body; the
  extractor feeds `text/*` straight to AI (capped 80K chars vs 200K for PDFs).
- Doctype: `intake-promoter.js::normalizeDocType()` maps extractor synonyms → canonical (`om`/`flyer`/
  `marketing_brochure`); `snapshotLooksLikeListing()` promotes when doctype is null but the data looks like a
  listing.
- **⚠️ `staged_intake_extractions` IS NOT ONE POPULATION — SPLIT BY CHANNEL BEFORE GRADING IT
  (2026-08-26).** Three channels feed the table with **different input types**, and the
  sidebar channel has produced **0 hardened-schema rows out of 350 in 30 days** — it has never
  once run `buildExtractionPrompt` (all seven Prompt-61 keys are structurally ABSENT from its
  snapshots, not null within them), never stamps `_provider`, and never passes through
  `stripNonSaleKeys`. It is also the **largest producer, 56% of rows.**
  - **A fleet-wide coverage number therefore moves with the channel MIX, not with prompt
    quality.** On OM-class docs over 30 days the *unhardened* sidebar channel outscores the
    hardened email channel on every field (NOI 80% vs 52%, cap 87% vs 65%, building SF 96% vs
    65%, responsibilities 78% vs 44%).
  - **⚠️ AND "SPLIT BY CHANNEL" WAS NOT SUFFICIENT — THE CHANNEL ITSELF HAS TWO POPULATIONS.**
    Sidebar splits into **101 CoStar *page* captures** (rich `seed_data`: asking_price, cap_rate,
    tenant_name, domain_property_id — and **0 OM-class, 0% cap, 0% NOI** in the snapshot) and
    **249 *document* captures** (`seed_data` = `tags` only, 76 OM-class, **87% cap**). The
    unsplit sidebar average (36% cap) and the document-only average (87%) differ by 51 points
    and describe different things. **Before quoting a per-channel number, check whether the
    channel carries sub-populations with different INPUT types.**
  - **The seed-passthrough explanation is REFUTED, tested:** 65 of the 101 rich-seed rows carry a
    `cap_rate` in the seed and **0** carry one in the snapshot (identical-value counts all zero).
    Sidebar's quality is a genuine extraction, not an echo of CoStar — so **seeding the email/PDF
    path from structured capture would not buy sidebar-like coverage. Do not build that.**
  - **This invalidates the evidence for, not the conclusion of, the 2026-08-11 W5.3 re-grade**
    ("hardening worked — NOI 89%"). That window is exactly when a 64-row sidebar backfill
    landed. The verdict reverts to *unproven for the email/PDF path*, not *refuted*.
  - **The post-93 "stamp coverage now 100%" was a BACKFILL, not a fixed writer** — the daily
    rate decays straight back to zero after it (08-26: 0 of 21). Assert on the **new-row rate
    over the last 7 days**, never a cumulative percentage a backfill can carry. Same class as
    P176: *a one-shot repair of a recurring producer is a chore you repeat silently forever.*
  - ~~Ruled out already, do not re-walk: stale deploy, a second writer, a flow writing the
    table directly.~~ **ANSWERED P194 — see the next bullet. All three were ruled out
    correctly and all three were the wrong question.**
    Full measurement + the answer: `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`.

- **⚠️ A RETIRED DEPLOYMENT THAT STILL ANSWERS IS A SECOND WRITER — AND THE ONLY THING
  POINTING AT IT MAY BE A URL IN A CLIENT YOU DON'T DEPLOY (P194, 2026-08-27).** The sidebar
  mystery above was never a second prompt. `extension/background.js` carried **seven hardcoded
  fallbacks** to `https://life-command-center-nine.vercel.app` for the intake endpoints, under
  a comment explaining that *"the intake endpoints live on Vercel, not on the Railway MCP
  server."* That was true until **2026-07-20**, when Vercel was retired and `server.js` became
  the single source of `/api/*` routing. **Nobody tore the Vercel deployment down.** It still
  serves, and it still holds the LCC Opps service key — so the extension's POSTs did not fail,
  they SUCCEEDED against a build frozen before Prompt 61, writing into the same table.
  - **The row shape is the fingerprint: the P61 key set MINUS exactly the 7 keys P61 added**
    (43 observed vs 50 in `EXTRACTION_SCHEMA_KEYS`), plus no `_provider` even though
    `ensureProviderStamp` is unconditional at the single write site. When a snapshot is missing
    a guard that cannot be skipped, the row did not come from your build. **Read that as a
    provenance fact, not a bug in the guard.**
  - **THE DEPLOY CHECK THAT RULED THIS OUT WAS RUN AGAINST THE WRONG DEPLOYMENT.** The 2026-08-26
    "not a stale deploy" verdict (`git merge-base --is-ancestor <p61> <live /version>`) was
    correct and irrelevant: it interrogated Railway, and these rows were never on Railway. **A
    `/version` probe answers for the host you asked. Before trusting it, establish that the
    traffic in question actually reaches that host** — the P131 lesson ("check the fix against
    the deployed sha") has a prior step nobody wrote down: *which* deployed sha.
  - **Diagnose it from Supabase `edge_logs`, not app logs.** Every PostgREST write carries the
    calling server's `request.headers.cf_connecting_ip`. Railway is a small set of STABLE
    addresses (`152.55.x`, `162.220.232.x`) carrying tens of thousands of requests; a serverless
    stand-in is a rotating pool of ephemeral AWS IPs each appearing for 40–255 requests with one
    narrow path fingerprint. Joining those log lines to `created_at` separated 25 of 25 rows on
    2026-08-26 with **zero crossovers** — including two same-hour pairs (14:09 email hardened vs
    14:30 sidebar bare; 21:33 vs 21:37), which kills deploy-timing, model-drift and
    rate-limit-fallback in one stroke. **This works for any "two behaviours, one table" puzzle.**
  - **A stale host is invisible to every check this repo runs.** It does not error, does not
    404, does not show in `/version`, and the producer lives in a Chrome extension that CI never
    builds. Prompt 82's own test header names the symptom — *"the sidebar / cloud-fallback
    channels wrote bare snapshots"* — then fixes a code path that channel was not running, and
    the "100% stamp coverage" that followed was a **backfill** over rows the foreign writer had
    produced. **Grep for a retired origin in the CLIENTS (extensions, PA flows, scripts, docs),
    not just in the repo that used to deploy there.**
  - **Detector, live:** `v_lcc_intake_extraction_provenance` + `lcc_check_intake_extraction_provenance()`
    (cron `lcc-intake-extraction-provenance`, 06:58) open a deduped
    `lcc_health_alerts(alert_kind='intake_extraction_foreign_writer')` for any channel whose
    **new rows over 7 days** are 0% `_provider`-stamped, and auto-resolve when coverage returns.
    The predicate is the provenance invariant, not a quality metric, so it catches the *next*
    stale host or forked build without knowing anything about prompts. Guard on the client side:
    `test/extension-intake-host.test.mjs` (verified RED on the pre-fix `background.js`).
    **Read `alerts_opened`/`alerts_resolved`, never `already_open`.**
  - **CLOSED, do not re-open: the 101 rich-seed CoStar page captures are NOT losing data.**
    All 101 carry a `domain_property_id`, i.e. the sidebar pipeline had already written the
    domain row; verified gov `properties` 31516 carries a live `available_listings` row at
    `asking_price 6,500,000` / `asking_cap_rate 0.0700`, byte-for-byte the seed. The seed on the
    intake is a **receipt for a write that already happened**, not an unconsumed payload.
    (Separate, unfixed: those intakes still mark `discarded/non_deal_no_address` because the
    disposition reads only the snapshot and never the seed.)
- Full reference: `docs/architecture/om_intake_pipeline.md`.

### Multi-model AI fallback (extraction)

`intake-extractor.js::callAiExtraction` routes through `invokeExtractionAI` (`_shared/ai.js`): primary
(`invokeChatProvider`, typically Claude via a Supabase edge function) → on 429/5xx walk `AI_EXTRACTION_FALLBACK_CHAIN`
(default `[{"provider":"openai","model":"gpt-4o-mini"}]`) → on final failure sleep 35s + retry primary once.
Requires `OPENAI_API_KEY`. Per-artifact diagnostics record `ai_chain`/`ai_fell_back`/`ai_final_provider`/
`ai_final_model`.

### OCR / document-text foundation

`api/_shared/document-text.js::extractDocumentText` → digital `pdf-parse`; on a sub-floor text layer
(`DOC_TEXT_MIN_CHARS`, exported) falls back to tiered OCR: free OSS (workstation) → **Google Document AI**
(`docai-ocr` edge fn on LCC Opps, cheap-cloud primary, ~$1.5/1k pages) → gpt-4o vision (last resort, flagged).
The `document-text-tick` worker drains scanned deeds; `lease-extractor.js` OCRs thin-text scanned leases.

**LIVE + VERIFIED 2026-08-12 — do NOT re-provision or recommend a new OCR provider from scratch.**
The full chain works end-to-end: Railway `OCR_CLOUD_OCR_URL`/`OCR_CLOUD_OCR_KEY` → `docai-ocr` edge fn
(v19; GET = no-spend health probe echoing the processor) → Enterprise Document OCR processor
`projects/108926230693/locations/us/processors/5ecc6339861c88e1` (GCP project `modular-conduit-450617-h5`).
Registry: `feature_flags_registry.OCR_CLOUD_DOCAI`. Crons 160/167/169 ACTIVE. Full state + runbook:
`docs/architecture/document-capture-and-ocr-status.md` (FINAL STATE box).
- **Footgun (bit us 2026-07→08):** if the edge secret `GOOGLE_DOCAI_PROCESSOR` points at a *Custom
  Extractor* instead of an OCR-type processor, DocAI 400s (`entity_types`) and EVERY scan silently
  falls to gpt-4o at 6–14× cost while receipts still read `enriched`. Symptom: `ocr_tier:'cloud'`
  where `cloud_cheap` is expected → check the health probe's `processor` + the fn's error log.
  The secret is the BARE resource name (no `https://`, no `:process`).
- **Office docs (docx/xlsx) NEVER go to OCR** — `api/_shared/office-text.js` (zero-dep zip+XML)
  extracts them in-process, sniffed from BYTES (the SharePoint PA flow misreports mime as pdf —
  never trust contentType). Legacy OLE `.doc` → terminal `office_no_text:legacy_doc`. Wired in both
  `runLeaseExtraction` and `extractDocumentText` BEFORE the OCR tiers; no config, byte-sniff only.
- **Caps:** ⚠️ **DocAI sync is 30 pages, not 15, since DOC8 (2026-09-01)** — `docai-ocr` v23 sets
  `imagelessMode: true` on the ProcessRequest (a **TOP-LEVEL boolean**, verified against the live v1
  discovery document — **NOT** `processOptions.ocrConfig`, where nesting it is a silent no-op).
  - ⚠️ **"30 pages" IS ONLY TRUE CONTIGUOUSLY FROM PAGE 1, AND THE CAP IS MEASURED AGAINST THE
    SELECTION, NOT THE DOCUMENT (DOC17, 2026-09-02, seven live arms on a 316-page PDF).**
    `ProcessRequest.processOptions` → `individualPageSelector {pages}` / `fromStart` / `fromEnd`
    works on the sync path: `[31..45]` returned **pages 31–45** of a 316-page document, and the
    `fromStart:15` positive control returned pages 1–15. A 31-page selection is refused for being
    **31**, never for being part of 316. But **off page 1 the limit is 15**: 30 pages at 31–60
    fails, and *with* imageless it fails on a third error string, **`At most 15 pages in one call
    please.`** — so a ~50-page document is **three** sync calls (`fromStart:30` imageless +
    `[31..45]` + `[46..50]`), **no GCS required**. Whole 42-doc backlog ≈ **$3.30**.
  - ⚠️ **`metadata.page_limit` IS THE MAXIMUM ACHIEVABLE LIMIT, NOT THE ONE IN FORCE** — the
    30-pages-off-page-1 failure reports `page_limit: "30"` while its own message names **15**.
    DOC8's `pageLimitFromError` prefers the structured field *by design*, and here that field is
    the misleading one; sizing a retry off it re-sends the same rejected selection forever. **And
    the `At most 15 pages` shape carries NO `details[]` at all**, so both the structured read and
    the prose fallback return null. Inert today (the live path sends no selector); load-bearing for
    DOC18. Full measurement: `docs/architecture/document-capture-ocr-and-deeds.md` (DOC17 ANSWER).
  - ✅ **DOC18 BUILT THE ROUTE (2026-09-02) — `?mode=longdoc`, ONE document per tick, no GCS.**
    `planPageWindow` + `ocrCloudCheapWindow` (`api/_shared/document-text.js`) extract the consumer's
    ~50-page window as three cheap sync calls; `docai-ocr` now takes a `page_range` →
    `ProcessOptions`. ✅ **LIVE 2026-09-02 — and the first tick FAILED on a THIRD deploy surface the
    sentence that used to sit here never named.** It said *"the migration must be applied BEFORE the
    Railway redeploy"* — true, and incomplete: the route also changed the `docai-ocr` **Supabase edge
    function**, which deploys with neither the migration nor Railway. With v24 still live the window
    sent the whole 39-page PDF, the `page_range` selector was **ignored silently**, DocAI refused it
    over the 30-page cap, and the route honestly recorded `window_failed / cloud_ocr_non_ok` with
    `window_calls: 0`. Deployed v25 from the repo (health probe reads `page_range_supported: true`);
    the next document (80, 31pp) came back **2 calls, 31 pages, `[[1,31]]`, 0 gaps, 0 duplicates,
    76,346 chars.** ⚠️ **A change that touches `api/`, `supabase/migrations/` AND `supabase/functions/`
    has THREE deploys, and "merged is not running" applies to each independently** — check
    `list_edge_functions` `updated_at` against the merge time, the same way `/version` is checked for
    Railway. Four things worth carrying:
    - **⚠️ THE SEAM IS ASSEMBLED BY PAGE NUMBER, NOT BY BLOB** — DocAI returns the document's REAL
      page numbers for a selected range, so a map keyed on page number makes duplication
      structurally impossible and DETECTS a gap. **A plausible total length is not evidence of a
      clean seam.** And because an unknown body field is **ignored SILENTLY**, a silently-ignored
      selector returns pages 1..N and reads as a clean success — so a segment whose page numbers
      fall outside the range requested is rejected `page_range_ignored`.
    - **⚠️ A WINDOWED EXTRACT IS A THIRD STATE AND `needs_ocr` CANNOT EXPRESS IT.** `true` throws
      away text we paid for; `false` reads as FULL coverage on `v_lcc_cre_bov_ready` about a
      141-page lease read to page 50. It is `needs_ocr=false` + `partial_extract`/`pages_covered`/
      `page_ranges`/`reason='partial_page_window'`, and the view gained `partial_docs` /
      `fully_covered_docs` **appended** — `covered_docs` keeps meaning *consumable* and is qualified,
      never silently redefined (the DOC9 `ocr_by_engine` lesson). **Membership is unchanged on
      purpose**: excluding partials would keep 42 real leases out of BOV extract to avoid
      over-claiming, which is strictly worse than saying so on the row.
    - **⚠️ `page_count` AND `ocr_pages` USED TO BE THE SAME NUMBER, AND THE WINDOW SPLITS THEM.**
      Before it, DocAI either read the whole document or refused it, so `buildDocTextRow` wrote the
      billed count into `page_count` — which for a partial records a 141-page lease as 50 and erases
      the very fact that makes it partial. **`ocr_pages` = what we were BILLED for; `page_count` =
      how long the document is.** Caught by the DOC18 guard's own assertion, not by reading the code.
    - **The budget decision, stated:** a call measured 10–20 s, so three cannot fit the 22 s tick.
      The lane gets **its own 110 s budget and ONE document per tick, with no cross-tick partial
      state** — a document is either a partial WITH text or a dated marker, never mid-flight, and
      **pages already paid for are never discarded**, which is what stops the next attempt
      double-charging. The marker's `extracted_at` **is the cursor** (a failed attempt refreshes it,
      so the head rotates — P135/P136). Two ceiling reasons are kept apart:
      `over_docai_page_cap` = never attempted, `window_failed` = attempted and empty.
      Read `v_lcc_cre_longdoc_backlog`; ⛔ gpt-4o stays unreachable from this path by construction.
  `INTAKE_OCR_MAX_BYTES` 12MB default; bigger scans go off-box via the `ocr_text` resubmit seam
  (`POST /api/intake?_route=lease-backfill&id=<id>`). Optional: `AI_OCR_MODEL=gpt-4o-mini`.
- **⚠️ `over_page_cap` → gpt-4o WAS the documented design and it was MEASURED TO FAIL.** Across every
  OCR row the CRE lane has produced: gpt-4o 19 rows, avg **1,579** chars, 12 under 500, minimum
  **31**; DocAI 6 rows, avg 9,055, none under 500. **The expensive tier returned ~9× LESS text** —
  because DocAI 502'd on the 15-page cap and every long lease fell through. The fall-through is not
  removed (gpt-4o is still the last resort below the cap), but **above the cap the CRE worker now
  stops with a named, dated `over_docai_page_cap` marker and attempts no OCR at all**, from a
  pdf-parse page pre-flight. The cap is **opt-in per caller** (`ocrPageCap`, default null), so cron
  160 and the deed lane are byte-identical.
- **⚠️ A THIN OCR RESULT USED TO COUNT AS COVERED, AND THAT IS A CORRECTNESS DEFECT (DOC10).**
  `gatherPropertyText` admits on `needs_ocr=is.false&raw_text=not.is.null` and `v_lcc_cre_bov_ready`
  counts covered on `NOT needs_ocr` — **a 31-character fragment satisfied both**, so BOV extract
  received it as the lease and it could never be retried. `reason='thin_ocr_result'` was already
  being set and **no consumer has ever read it**. The floor is now page-aware
  (`max(120, pages×200)`; **500 when the page count is unknown**) and writes DOC1's dated marker.
  Backfill 2026-09-01: **12 rows / 9 properties; `v_lcc_cre_bov_ready` 7 → 4 — that number going DOWN
  is the fix working.** ⚠️ **Read `ocr_docs_by_engine` / `ocr_pages_unknown` on the tick, never
  `ocr_by_engine`** — it counted PAGES, gpt-4o reports none, so the spend guard read empty exactly
  when the escalation happened (DOC9). It is REMOVED rather than redefined. Full state:
  `docs/architecture/document-capture-ocr-and-deeds.md` §0d.

#### Durable document capture-at-ingest (store the bytes, don't defer the fetch)

A captured CoStar doc that stores only a `source_url` (CDN link) becomes **unprocessable later** — CoStar
CDN/signed links are **bound to the browser session**, so a server-side (Railway datacenter) re-fetch at OCR
time gets 403/expired and the bytes never land (this stranded ~86% of `property_documents` across dia+gov).
Fix: capture the durable copy **while authenticated**, into each domain's `property-documents` bucket
(`fetchDocBytes` already prefers `storage_path` over `source_url`). Two paths, both domains, best-effort/additive:

- **Server re-fetch (Build 1, `sidebar-pipeline.js::captureDocumentBytesAtIngest`)** — works for non-session-bound
  (public county / CDN) links AND **SharePoint-filed docs** (`fetchAndStoreDocBytes` detects a server-relative
  `/sites/…` `source_url` and fetches via the Power-Automate "Get Artifact" flow `SHAREPOINT_FETCH_URL` instead of
  HTTP — honest no-op `sharepoint_fetch_unset` when that PA flow isn't configured). Kept as the fallback + the
  **backfill** worker `POST /api/intake?_route=doc-bytes-backfill&domain=dia|gov&limit=&before=<cursor>&source=sharepoint|http`
  (keyset-cursor so an un-capturable backlog terminates; counts `bytes_captured`/`sharepoint_captured`/
  `session_bound_or_dead` separately — never silently "done"). Verify the SharePoint flow is live via
  `GET /api/diag?kind=env` (`sharepoint_fetch_url_set`). The url-only backlog is dominated by **SharePoint** lease/
  DD/OM docs (724 dia+gov, zero text) that this branch drains; the rest are non-session-bound CoStar (recovered)
  + non-document broker pages (unrecoverable).
- **Extension in-session capture (the durable forward fix)** — the extension fetches each captured doc's bytes
  **in the authenticated CoStar tab** (`background.js::fetchDocBytesViaTab`, the only way to reach a
  session-bound link) and POSTs them to `POST /api/intake?_route=capture-doc-bytes` (`{domain, source_url,
  content_base64, mime_type}` → `storeClientDocBytes`). Keyed by `(domain, source_url)` — the row already
  exists (`process_sidebar_extraction` awaits `upsertDocumentLinks` before responding), so **bytes never touch
  `entity.metadata`**. Idempotent (a row with `storage_path` is a no-op). Offering material is skipped (it
  already routes through the OM live-tab path). Triggered fire-and-forget after a successful extraction
  (`sidepanel.js` → `CAPTURE_DOC_BYTES_BATCH`). **Requires reloading the unpacked extension after deploy**
  (manifest bumped to 1.0.39). Closes the gov firm-term "Gate 1" byte-fetch blocker
  (government-lease `docs/RUNBOOK_firm_term_coverage_ops_gates.md`).

---

## Domain-DB invariants

- **`vertical` / `source_domain` are canonical short-form `dia`/`gov`.** Writers normalize on the way in
  (`bridgeCreateLead` writes `normDomain`; sync functions CASE-map `dialysis→dia`/`government→gov`). `entities.domain`
  also carries a legit third value **`lcc`** (LCC-internal entities) + **`cre`** (generic CRE registry) — never
  remap those. Consumers filtering `source_domain` should accept both forms during transition (`in.(dia,dialysis)`).
  This class of "dia/gov alias" bug has recurred many times — always canonicalize.
- **`external_identities` (LCC Opps) canonical scheme** — every writer funnels through
  `canonicalIdentitySystem()` + `canonicalDomainSourceType()` (`api/_shared/entity-link.js`); a
  `CHECK (chk_external_identities_source_system)` enforces it at the DB. Never introduce a new spelling.

  | concept | `source_system` | `source_type` | `external_id` |
  |---|---|---|---|
  | domain property-anchor ("asset") | `dia`/`gov` | `asset` | domain `properties.property_id` |
  | domain owner entity | `dia`/`gov` | `true_owner` | `true_owner` id (UUID = entity id) |
  | CMS clinic identity | `cms` | `medicare_ccn` | Medicare CCN |
  | vendor/channel | `costar`/`rca`/`crexi`/`loopnet`/`salesforce`/`email_intake`/`outlook`… | as-is | vendor id |

  `asset`=`property`=`clinic`=`facility` for domain rows (collapsed to `asset`); vendor `property` (costar/rca
  listing ids) stays `property`. Banned spellings: `dia_db`, `dia_supabase`, `dialysis`, `gov_db`,
  `gov_supabase`, `government`. `email_intake` is NOT a domain DB (external_id = `staged_intake_items.intake_id`).
- **Gov-side anon-readable views** expose non-PII slices of RLS-protected gov tables so LCC's `pg_net` anon
  pulls work (`gov.v_ownership_history_portfolio`, `v_property_attributes_portfolio`,
  `v_sales_transactions_portfolio`, `v_property_owner_facts_portfolio`, `v_owner_contact_signals_portfolio`,
  `v_property_id_census`…). **Add BD columns to these views, not the underlying tables** (don't loosen RLS on
  PII). dia has the mirrored set.
  - **⚠️ THE VIEW MUST BE `security_invoker=off` OR IT SILENTLY RETURNS NOTHING TO ANON (P157, 2026-08-20).**
    With `security_invoker=on` the CALLER's RLS applies instead of the view owner's, so anon hits RLS on the
    base tables and PostgREST answers **HTTP 200 with `[]`** — indistinguishable from "no new data". Six gov
    views and four dia views were in that state; `lcc_owner_contact_signals` sat frozen from **2026-07-28 to
    2026-08-20** while crons 136/137 ran daily and *succeeded*, because `lcc_sync_owner_contact_signals`
    returns `pages_fired` (an honest counter that looks like throughput) and every page came back empty.
    Measured: `v_ownership_history_portfolio` 12,697→0, `vw_portfolio_owners` 1,915→0,
    `v_owner_contact_signals_portfolio` 733→0, `v_agency_portfolio` 498→0, `v_portfolio_summary` 163→0,
    `v_cmbs_portfolio` 149→0 (dia: 6,808 / 391 / 42 / 32 → 0).
  - **Diagnose with `SET LOCAL ROLE anon` + `count(*)`, not HTTP.** It is instant, needs no key, and compares
    directly against the service_role count. And **check `reloptions` directly** — the stored value is
    `security_invoker=**on**`, so a test for `ilike '%security_invoker=true%'` returns false and reports the
    exact opposite of the truth (it did).
  - **Never "fix" this by adding an anon SELECT policy to the base table** — that exposes the whole table
    (e.g. `recorded_owners.contact_info`), which is precisely what the view pattern exists to avoid. Flip the
    view. Note the views that *were* working do so via anon policies on `properties`/`true_owners` — the
    looser mechanism, worth tightening on its own terms.
- **Cap rates are stored as decimals** (7.47% → `0.0747`) and are **derived, not trusted-as-ingested**. gov has
  a full cap-rate framework: `cap_rate_history` is the authoritative derived ledger (`gov_compute_cap_rate()`,
  a 7-tier income hierarchy; opex anchors from trusted ingested cap rates). Raw ingested cap rates are preserved
  for audit. See the **government-lease** repo `CLAUDE.md` §12 for the full framework. dia cap rate = net rent
  (NNN), not NOI.
- **`dia.sales_transactions.sale_date` is `NOT NULL`** (CHECK constraint). Writers must populate it.
- **dia `v_sales_comps.rent` is projected to CURRENT_DATE**, not Y1 base. `base_rent` = the Y1 figure;
  `rent_per_sf` = projected. Projection math: `api/_shared/rent-projection.js::projectRentAtDate` mirrored by
  SQL `dia_project_rent_at_date()`.
- **`on_market_date` is THE canonical market-entry date** (dia + gov); `listing_date` is raw capture (audit
  only) — never read it for market timing. **Exception:** the point-in-time CURRENT available STOCK count. See
  the CM/T9d sections in the history file before touching listing-currency views.

## BD spine (LCC Opps) — key artifacts

- **Tables:** `entities`, `external_identities`, `entity_relationships`, `lcc_entity_portfolio_facts`,
  `lcc_property_attributes`, `lcc_property_owner_facts`, `lcc_listing_events`, `touchpoint_cadence`,
  `bd_opportunities`, `lcc_decisions`, `owner_contact_pivot`, `lcc_buyer_parents`, `lcc_institution_contacts`,
  health/alert + `*_cache`/`*_inflight` tables.
- **Views (all SECURITY INVOKER):** `v_priority_queue` (doctrinal bands P0/P0.4/P0.5/P-BUYER/P-CONTACT/P1–P8),
  `v_priority_queue_enriched`, `v_entity_portfolio_all`, `v_bd_cadence_dashboard`, `v_lcc_merge_candidates`,
  `v_owner_contact_worklist`, `v_lcc_owner_address_dimension`, … The queue reads a **materialized cache**
  (`lcc_priority_queue_resolved`, refreshed by cron); a band-moving verdict calls
  `lcc_refresh_priority_queue_resolved()` to update immediately.
- **Entity ops:** `lcc_merge_entity` (two-step DELETE-then-UPDATE; the single "move backrefs loser→winner"
  path — reconciles portfolio/identities/relationships/cadence **plus, since P160, the ownership/BD
  backrefs**), `lcc_normalize_entity_name`,
  - **⚠️ THE MERGE IS REVERSIBLE SINCE P196 (2026-08-27) — AND IT WAS NOT BEFORE, ON A PATH THAT
    RUNS ~285 TIMES A MONTH.** `lcc_merge_entity` now calls
    `lcc_merge_snapshot_loser` → `lcc_merge_fold_pivot` → the reconcile with **`p_snapshot => true`**,
    action-labels every P160 dedup/repoint into `r40_merge_reconcile_backup`, and logs the merge in
    `lcc_entity_merge_log`. Reverse one with **`lcc_unmerge_entity(loser)`**; see which tombstones can
    be reversed at all in `v_lcc_entity_merge_reversibility` (**2,411 pre-P196 tombstones read
    `reversible=false` and always will**). Three durable lessons:
    - **"Dormant" described the LOOP, not the function.** N11 correctly measured that
      `lcc_apply_fuzzy_merges` has no caller (0 cron rows, 0 in `api/`) — but `lcc_merge_entity` has
      **nine human-verdict call sites** and **285 entities were merged in 30 days, 176 in 7**. Before
      filing a shared function as latent risk, count the callers of the FUNCTION, not of the one
      wrapper you were told about.
    - **"Uncorrelated EXISTS" was never the bug.** `owner_contact_pivot` and `lcc_property_owner` are
      both PK `(entity_id)`, so the un-correlated `EXISTS` is equivalent to a correlated one. The bug
      was that the statement **DELETED content instead of FOLDING it** — measured on `bamproperties`,
      the loser held the group's only named contact. Correlating the predicate would have looked like
      a fix and moved nothing.
    - **⚠️ A `BEFORE INSERT` TRIGGER THAT *SKIPS* A ROW SILENTLY DEFEATS `ON CONFLICT DO UPDATE`.**
      P177's `trg_lcc_entity_rel_resolve_survivor` returns NULL for an edge that duplicates one the
      resolved entity already holds, so the row never reaches the conflict clause and the DO UPDATE
      never runs. Restoring three byte-identical `purchases` edges brought back ONE and left two on
      the winner, while the unmerge reported `restored`. **Repoint a surviving row with `UPDATE`
      (both survivor triggers are INSERT-only) and INSERT only what was deleted** — and count what
      came back, because a partial restore otherwise reads exactly like a clean one. Only the live
      round trip found it; the same family as P195's `428C9 is_current is GENERATED ALWAYS`. Guard:
      `test/merge-entity-reversible.test.mjs`. Writeup:
      `docs/audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md`.
    - **Making it reversible is NOT a decision to auto-merge.** `lcc_apply_fuzzy_merges` is still
      unwired and `auto_mergeable` is still 3,053. Reversibility lowers the cost of being wrong; it
      does not replace P195 §1's grading of what a byte-identical name actually proves.
  - **⚠️ WHEN YOU ADD A TABLE WITH AN ENTITY FK, ADD IT TO THE MERGE PATH (P160, 2026-08-20).**
    `lcc_reconcile_tombstone_backrefs` moves portfolio facts, external identities, relationships and
    cadence — and for a long time nothing else. `lcc_property_owner`, `lcc_property_owner_evidence`,
    `owner_contact_pivot` and `bd_opportunities` were never moved, so **every merge LCC ever ran left a
    DEAD OWNER behind**: measured live at 63 assets whose `owner_entity_id` pointed at a merged-away
    entity (plus 99 stranded contact pivots). Nothing errors; the asset still displays an owner that no
    longer exists. `lcc_merge_entity` now repoints all four, dedup-then-update so a PK collision cannot
    abort a merge midway.
  - **It also had NO CYCLE GUARD, and that is not theoretical** — P153 merged a live entity into its own
    May-2026 tombstone (the tombstone was still visible as a prospect, since `v_lcc_top_seller_prospects`
    did not filter merged entities until P154) and created a mutual `A→B, B→A` merge in which NEITHER row
    was a survivor. A one-hop follow cannot detect it and an uncapped follow HANGS on it — which is why
    `lcc_entity_survivor(uuid)` is hop-capped at 20. `lcc_merge_entity` now resolves the winner to its
    terminal survivor (a caller naming a tombstone means the survivor), refuses a genuine cycle, and
    refuses an already-tombstoned loser.
  - **⚠️ CLEANING THE BACKREFS IS NOT ENOUGH IF A PRODUCER RE-CREATES THEM (P175, 2026-08-26).**
    The merge path handles `lcc_entity_portfolio_facts` correctly — dedup-delete the
    collisions, repoint the rest — and **119 tombstones still carried 198 live portfolio
    facts worth $71.8M**, because `lcc_finalize_entity_portfolios` put them back every
    night. Its guard was `EXISTS (SELECT 1 FROM entities e WHERE e.id = …)`, and **a
    TOMBSTONE STILL EXISTS**; `entity_id` arrives as the DOMAIN's `true_owner_id`, and the
    domain DBs know nothing about LCC merges, so each sync re-sends the pre-merge id. Any
    writer keyed on a domain-supplied entity id must **resolve through
    `lcc_entity_survivor()` and require `merged_into_entity_id IS NULL`** — existence is not
    liveness. Resolve **before the GROUP BY**: two ids collapsing to one survivor otherwise
    hit *"ON CONFLICT DO UPDATE command cannot affect row a second time."* The generalised
    detector (was the row written AFTER the merge?) is Class 8 of
    `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md`.
  - **`entity_relationships` resolves BOTH endpoints to the survivor at INSERT (P177,
    2026-08-26).** 184 edges pointed at tombstones, **131 created AFTER the merge, 125 in the
    last 30 days** — transaction history (listing_broker/true_seller/buyer/owner), so **41
    survivors were under-reporting their own deal history**, the exact signal prospecting ranks
    on. Fixed with the writer-agnostic trigger `trg_lcc_entity_rel_resolve_survivor` rather
    than by patching `insertEntityRelationship` (a trigger also covers SQL writers and cannot
    be bypassed by the next producer). It **skips, never raises**, in two cases: a resolved
    SELF-LOOP (`chk_entity_relationships_no_self_loop` would abort the ingestion that wrote it)
    and a DUPLICATE of an edge the survivor already holds (there is **no unique constraint** on
    `(from,to,type)`, so nothing else would catch the double-count).
  - **`external_identities` resolves `entity_id` to the survivor at INSERT (P178).** 45
    stranded, 26 created post-merge (CoStar sidebar-dominated). Its unique key
    `(workspace_id, source_system, source_type, external_id)` **excludes `entity_id`**, so a
    repoint cannot normally collide — 45 repointed, 0 deduped. **None were `asset`/`true_owner`
    anchors**, so the by-ID domain-owner join stayed clean. The trigger does NOT touch
    `source_system`/`source_type`: the canonical scheme above remains the only authority on
    spelling.
  - **A survivor row for the same key is not automatically a DUPLICATE (P175a).** Where the
    ghost reads `is_current` and the survivor reads ENDED, the rows **contradict** each other
    about whether the party still holds the asset — deleting the ghost resolves the conflict
    toward the stale side (Carrington gov 2654 would have dropped $1.7M of live rent). Three
    dispositions, not two; the 12 conflicts live in `v_lcc_portfolio_ownership_conflict` and
    are never auto-resolved.
  `ensureEntityLink` (the R4-A choke point: junk/implausible/federal guards + email-resolution tier +
  SF-account-as-org-edge modeling).
- **Deal spine (living deal dossier, prompt 02/06):** `bd_opportunities` is the deal container;
  `entity_relationships` (effective_from/to + `metadata->>'role'`) is the party role-history store. Added
  `lcc_deal_commission` / `lcc_deal_milestone` / `lcc_deal_diligence` / `lcc_deal_correspondence_summary` /
  `lcc_deal_document` / `lcc_deal_conflict` (`20260820120000_lcc_deal_spine.sql`). Read via
  `lcc_deal_spine(entity)` + `lcc_deal_parties(entity)`; assembled into the tagged deal packet by
  `entities-handler.js::buildDealPacket` and rendered by `dossier-generator.js::renderDealSections`.
  Discipline: SF/Outlook/Sharefile are authoritative for parties/commission/narrative; a CoStar-sourced
  broker edge is `third_party`/"unverified role" until our systems confirm; conflicts go to
  `lcc_deal_conflict` (surfaced, never auto-resolved); absent → "Not on file". SF Opportunity resolve/
  `sf_deal_id` stamp + Outlook thread + Sharefile roster fill are gated on those live connectors.
- **Property-owner feeders → `lcc_property_owner_evidence` → `lcc_reconcile_property_owner`.** Authority
  ladder (`property-owner-source-authority-and-doctrine.md`, registered in `field_source_priority` as
  `lcc.lcc_property_owner/owner_entity_id`): `manual`(8.0) > **`domain_true_owner`(5.0)** > `rel_purchase`(4.0)
  > `sf_seller`(3.5) > `rel_owns`(3.0). `domain_true_owner` (P113, `lcc_ingest_domain_owner_evidence`,
  dry-run default, batch-reversible via `lcc_domain_owner_evidence_log`) outranks `rel_purchase` because it
  is the domain's curated CURRENT owner-of-record, whereas a purchase edge is ONE historical transaction.
  Dry-run surface `v_lcc_domain_owner_candidates`; ambiguity lane `lcc_domain_owner_ambiguous`. Fill-blanks:
  it only ever touches assets with no resolved owner.
- **Ownership Resolution Engine (ORE):** multi-signal authority-weighted reconciliation
  (`lcc_reconcile_owner`, `lcc_signal_authority`, `lcc_reconcile_config.match_threshold`), owner-address
  observations store (append-only, never-collapse), SOS/deed/institution-registry enrichment. Full design:
  **government-lease** repo `docs/OWNERSHIP_RESOLUTION_ENGINE.md`.

---

## Known footguns (read before the matching change)

- **Disk-full on LCC Opps = total sign-in lockout.** Auth (GoTrue) lives here; a full disk forces the DB
  read-only, so GoTrue can't INSERT session rows (`SQLSTATE 25006`) and *only sign-in appears broken* while
  reads work. Bloat is source-fixed + retention-pruned + autovacuum-hardened; `lcc_check_disk_health` +
  `lcc-disk-health-check` cron open a `disk_pressure` alert. Large tables (`sf_sync_log`,
  `staged_intake_artifacts`) externalize payloads and have prune crons. `VACUUM FULL` is a **rare manual op**
  (can't run in a migration tx; takes ACCESS EXCLUSIVE) — drain the backlog FIRST, then VACUUM FULL. A
  disabled maintenance/offload cron is watched by `lcc_check_disabled_critical_crons` (folded into
  `lcc-cron-health-check`).
- **PostgREST caps every response at 1000 rows regardless of `limit`.** Any cross-DB sync/pull that pages must
  stride at **1000/page** — a larger stride silently SKIPS rows. This bit the dia owner-facts sync (loaded only
  6,196 of 12,196).
- **`/api/dia-query` + `/api/gov-query` enforce a table/view ALLOWLIST at the `data-query` edge function**
  (`GOV_READ_TABLES`/`DIA_READ_TABLES` Sets in `supabase/functions/data-query/index.ts`), NOT
  `api/_shared/allowlist.js`. A view not in the Set → **HTTP 403** and the client tile silently shows `[]`/0/
  stuck-loading, even when the DB-level SELECT grants are fine. **Whenever a client tile reads a NEW view via
  `diaQuery`/`govQuery`, add it to the edge allowlist AND redeploy `data-query` to the Dialysis_DB project
  (`zqzrriwuavgrquhisnoa`) — NOT LCC Opps.** Mirror the entry in `api/_shared/allowlist.js` (its WRITE sets are
  live via `apply-change.js`; its READ sets are a documented mirror).
- **PostgREST schema cache can go stale after domain-table DDL** — a newly added column can exist
  in the DB while PostgREST still 400s `PGRST204 "Could not find the '<col>' column ... in the
  schema cache"` on writes to it. Supabase usually auto-reloads on DDL, but not always (bit the
  prompt-78 `property_documents.source` fix, 2026-08-08: migrations correct, failures continued
  until a manual reload). Fix: `NOTIFY pgrst, 'reload schema';` on the affected project. When a
  write 400s on a column you JUST added, check the cache before re-diagnosing the migration.
- **⚠️ `pg_views.definition` IS DEPARSED, NOT WHAT YOU WROTE — a grep over it can be
  STRUCTURALLY UNABLE TO MATCH (P182, 2026-08-26).** Postgres re-renders a view when it
  stores it: `NOT EXISTS (...)` becomes **`NOT (EXISTS (...)`** and `x NOT IN (...)` becomes
  `NOT (x IN (...)` / `<> ALL`. An audit querying `definition ~* 'NOT\s+EXISTS'` therefore
  matched **0 of 210 views** on LCC Opps — including `v_owner_contact_worklist`, which
  carries four exclusions — and reported a clean bill of health. Same family as the P157
  `reloptions` trap, where testing for `'%security_invoker=true%'` returns the exact
  opposite of the truth because the stored value is `security_invoker=on`. **Before
  trusting a zero from any text-matching detector, point it at a known positive**; an
  implausibly clean result is a bug signal, not a finding. Full class + the corrected
  detector: `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 11, and the sweep that found it
  in `docs/audits/P182_SILENT_DISCONNECTION_SWEEP_2026-08-26.md`.
- **⚠️ AN EXCLUSION KEYED ON AN OPEN STATE NEEDS SOMETHING THAT CLEARS THAT STATE (P182).**
  `v_owner_contact_enrich_queue` correctly excludes owners with an OPEN
  `owner_contact_manual` task (the automated worker cannot resolve them) — but **all 316 of
  those tasks are `queued` and none has ever changed status**, so the exclusion never
  expires and the owner is permanently removed from automated processing. Measured: **115
  owners ($102.4M) already carry a genuine named active contact** in `owner_contact_pivot`
  while their card still says "find the contact". This is the auto-retire doctrine (rule 2)
  applied to the EXCLUSION rather than the queue: ask *what event sets this state false, and
  does anything ever fire it?*
- **`CREATE OR REPLACE VIEW` is append-only for columns** (Postgres 42P16 if you insert a column mid-list). All
  view edits add new columns at the END of the SELECT.
- **Profile a slow endpoint with the handler's REAL query shape — `LIMIT 5` without the `ORDER BY` lies.**
  An `ORDER BY` forces the WHOLE view to materialise, so the limit is irrelevant: `v_lcc_bd_worklist` cost
  321 ms at `LIMIT 5` (no order) and **30,610 ms** at `order=rank_value.desc.nullslast&limit=150` — the shape
  the handler actually issues. That gap produced two wrong claims and nearly shipped a no-op `CAP` reduction.
  Read the handler, reproduce its exact PostgREST path (filters included), and check `loops=` in the plan:
  **any node with `loops=` equal to the output row count is a correlated subplan**, and no index or ANALYZE
  can fix one — it needs the aggregate hoisted out of the correlation and LEFT JOINed once (Prompt 115 did
  exactly this to `v_lcc_contact_writeback_candidates`: 3 subplans at `loops=1648` → 0, 51.9×, 46× fewer
  buffers, 0-row equivalence diff both directions). Also note the raw DB timing is **session-variable**
  (19.3 s vs 30.6 s for the same unchanged query on consecutive days) — always measure before AND after in
  ONE session, and treat the structural facts (loops gone, buffer count) as the durable evidence.
  Details: `docs/architecture/panel-redesign-verification.md` §4.2d–4.2e.
  - **P118 corollaries (2026-08-20, all three caught live in one session).**
    (1) **Fix EVERY layer of a tick, not the one the error names.** The `lcc-owner-address-feed` alert's
    CONTEXT pointed at `lcc_resolve_owner_address_observation_entities`; hoisting that correlated subplan
    (45 s → 1.2 s, flat in row count, 0-row equivalence diff) left the cron STILL timing out, because
    `lcc_owner_address_feed_tick()` calls two functions and the *other* one
    (`lcc_feed_owner_signal_addresses`) carried the same full-table normalize scan per row (~86 ms × 433
    rows ≈ 37 s). Time each half separately before claiming a tick is fixed.
    (2) **A per-row API cannot be hoisted — that is exactly when a functional index IS the fix.** The
    doctrine above ("no index can fix a correlated subplan") applies when you control the query and can
    LEFT JOIN once. `lcc_record_owner_address_observation` is called per row from several callers, so it
    needed the index instead: 998.756 ms → **0.099 ms**, 2,903 → 4 buffers. **`lcc_normalize_entity_name(text)`
    IS `IMMUTABLE`** (`pg_proc.provolatile='i'`) — check `provolatile`, don't assume a plpgsql helper isn't.
    (3) **⚠️ A partial index is only usable if the query's own predicates IMPLY the index predicate.**
    Building it `WHERE … AND name IS NOT NULL` produced a valid index the planner NEVER used — the query
    never states `name IS NOT NULL`, and a non-STRICT plpgsql function gives the planner no way to infer it
    from the equality. Dropping that one clause is what made it match. Also: build a small index
    NON-concurrently (a cancelled `CREATE INDEX CONCURRENTLY` leaves an INVALID index to clean up).
    (4) **Verify a batch delete by the row-count DELTA, not the function's return value** — a client
    disconnect rolls the whole function back, so "0 deleted" and "nothing to delete" look identical; probe
    the candidate set with a `LIMIT` to tell them apart, and prefer a one-shot **pg_cron** job (the real
    production path) over a client call for anything near the timeout. Related: `count(*)` over a scalar
    subquery **optimizes the subquery away** — time it with `count(<the column>)` or you will measure nothing.
    (5) **⚠️ A GATE THAT FILTERS A JOIN IS PART OF THAT JOIN — fix both or neither (P188,
    2026-08-26).** P186's entire fix was hoisting `people JOIN owner_tok ON EXISTS(unnest(toks)
    WHERE sld LIKE tok||'%')` — an un-keyed cross product the planner can only serve as a Nested
    Loop with a Join Filter — into a prefix-expansion equality join (58.7 s → 0.47 s). P187 then
    added a fan-out gate written the obvious way, `from owner_tok ot join people p on p.sld like
    ot.tok||'%'`, **re-creating the identical cross product inside the gate**: measured
    `Rows Removed by Join Filter: 6,222,095`, 1.78 s of a 3.10 s view. It was invisible because
    the gate returns only 160 rows. Rewriting it with the SAME identity (`sld LIKE tok||'%'` ⇔
    `left(sld,length(tok)) = tok` for tokens ≥5 chars, i.e. the prefix rows already materialised)
    took the view to 1.26 s with a 0-row pair-set diff both directions.
    **Corollary — a live-data equivalence diff has to survive live data.** The full-row diff
    showed ONE row differing (`contact_company` "Trammell Crow Co" → "Trammell Crow Company") and
    it was the Outlook sync writing between the snapshot and the diff, not the change. Diff the
    columns your change can actually affect, and READ the row before accepting a one-row delta as
    a regression.
- **Overview/snapshot tiles must render SYNCHRONOUSLY from the main data load, reading ONE canonical
  source/summary view.** Never compute a count by filtering a client-loaded array (empty on Overview), never
  gate a tile's value behind a lazy async filler with a `_rendered` once-flag (a re-render strands it forever).
  A round-number count (1000/500) means a tile is reading a paged query, not a count. This class caused the
  "On Market shows 0 / stuck loading…" bugs. Use `Promise.allSettled` (not `Promise.all`) for the detail batch
  so one failed query can't strand every tile.
- **PL/pgSQL `#variable_conflict use_column`** is required in any function whose `RETURNS TABLE` OUT params
  share names with column names (most BD functions).
- **`ON CONFLICT` on a `CREATE UNIQUE INDEX` must use the index-inference/expression form**, not
  `ON CONSTRAINT` (errors 42704). `touchpoint_cadence` uniqueness is the index `uq_cadence_contact_property` on
  `(COALESCE(entity_id,0), COALESCE(property_id,0), COALESCE(sf_contact_id,''))`.
- **GENERATED ALWAYS columns** — omit from INSERT: `bd_opportunities.is_open` (`= closed_at IS NULL`),
  `lcc_entity_portfolio_facts.is_current` (`= ownership_end_date IS NULL`),
  `dia.sales_transactions.dedup_natural_key`.
- **`facility_patient_counts` (dia) is a CMS reporting-period time-series, not a nightly feed** — CMS publishes
  ~annually; re-running ingestion only adds a row when a genuinely new `snapshot_date` lands. Don't imply a
  stale nightly feed or rank <1% re-stamp noise. (See the **Dialysis** repo `CLAUDE.md`.)
- **SIGALRM does not bound a blocked C-level socket read** (ingestion hang-guard) — every network call in the
  Python pipelines MUST carry its own `timeout=`. (See the **Dialysis** repo `CLAUDE.md`.)
- **Salesforce is minimum-necessary and NOT cleaned by LCC** — LCC is the source of truth and reconciles around
  SF's dups/errors (never writes back to clean SF). An SF Account binds as an **org edge** on the person, not an
  identity on the person (`api/_shared/sf-account-link.js`).
- **A bare Salesforce IDENTITY is NOT a BD signal — never re-add it as a cadence gate arm (P112).**
  R63's `bdSignalFromFacts` listed `hasSalesforceIdentity` as sufficient. Measured 2026-08-15 that one
  arm carried **930 of 1,113** prospecting cadences (897 never touched, and **0** prospecting cadences
  had an open `bd_opportunity`) — it admitted the whole SF contact book, which is precisely the
  Consumption-Layer failure ("SF is minimum-necessary and NOT cleaned by LCC" — a capture surface, not a
  relationship). The gate now requires an open opp / real SF activity / value ≥ `CADENCE_SIGNAL_MIN_VALUE`;
  an SF identity is corroboration only. This propagates to `growGateFromFacts` **by design** (the grow
  path keeps its own `outreachEventCount >= N` arm). Auto-seed callers go through
  `cadenceSeedDecision()`, which also applies the **reachability precondition** — never seed a cadence for
  a party with no contact method and no named person, because it can never advance and only ages into
  "overdue". Retire/resume sweeps: `lcc_p112_retire_unworkable_cadences` /
  `lcc_p112_resume_workable_cadences` (reversible pause, never delete). Note the reachability gate fails
  **OPEN** (a read error must not suppress a reachable owner) while the BD-signal gate fails **CLOSED**.
- **`touchpoint_cadence.owner_user_id` and `lcc_entity_owner_override.owner_user_id` FK to DIFFERENT user
  tables.** `touchpoint_cadence.owner_user_id → users(id)`; `lcc_entity_owner_override.owner_user_id →
  lcc_users(lcc_user_id)`, and **none** of the `lcc_users` ids exist in `public.users`. Stamping the
  override id straight onto a cadence FK-violates on every row. The bridge is **email**, resolved once by
  `v_lcc_entity_point_person` / `lcc_cadence_point_person(uuid)` — always go through that, never
  re-derive the mapping in JS.
  - **P116 — the same id-space collision hit the Outlook/Calendar bridges, and it presented as an
    "upsert 409".** `email_bodies.source_user_id`, `meetings.source_user_id` and
    `activity_events.actor_id` ALL FK `public.users(id)`, while `api/bridges.js` takes
    `_source_user_id` **verbatim** from the PA flow's `X-LCC-Source-User-Id` header. The body sweep's
    flow was configured with the `lcc_users` id for sabriggs@northmarq.com (`1d3f7321-…`) instead of
    the `public.users` id (`b0000000-…-0001`), so **10,470 of 10,510** body-carrying `email_bodies`
    writes and 423+/day `activity_events` inserts were rejected — the voice corpus stayed empty for
    two days while every upstream layer (allowlist, payload, sweep, contact resolution) looked
    healthy. Every inbound source-user id now normalizes through
    **`api/_shared/source-user-id.js::resolveSourceUserId`** (pass-through → `lcc_users`→email→`users`
    → null); route any NEW writer to an FK'd user column through it rather than trusting the caller.
- **⚠️ A PostgREST `409` on an upsert is NOT necessarily a conflict — PostgREST maps BOTH `23505`
  (unique_violation) AND `23503` (foreign_key_violation) onto HTTP 409.** A POST with `on_conflict=…`
  + `Prefer: resolution=merge-duplicates` that returns 409 therefore reads convincingly as
  "merge-duplicates didn't take / the unique index isn't being inferred", when the real cause can be
  an unrelated FK on the same row (P116 lost two days to exactly that misread — the merge-duplicates
  upsert was correct the whole time, proven by a self-rolling-back `ON CONFLICT … DO UPDATE` gate).
  **Never diagnose a 409 from the status code — read the DB.** Supabase `query_logs`
  (`source='postgres_logs'`, `event_message ilike '%violates%'`) names the exact constraint; or capture
  `data.code`/`data.message` off the PostgREST body. Writers must record the DB's own code + message,
  not just `upsert_<status>` (see `describeWriteFailure`, `bridge-handlers-outlook.js`). Two things
  NOT worth investigating before the log is read: a plain **UNIQUE INDEX** (not constraint) is a valid
  `ON CONFLICT` arbiter, and a duplicate NON-unique index on the same columns does not break
  inference.
- **A cadence `last_touch_at` can never be in the future.** `lcc_activity_event_advance_cadence` used to
  pass `p_logged_at := NEW.occurred_at` unguarded, so a calendar meeting **scheduled ahead** landed as a
  COMPLETED touch and pushed `next_touch_due` a further quarter out. Guarded in three layers: the trigger
  skips future-dated events, `lcc_advance_onboarding_cadence` clamps to `now()`, and
  `trg_lcc_cadence_future_touch_guard` (BEFORE INSERT/UPDATE on `touchpoint_cadence`) clamps + opens a
  deduped `cadence_future_last_touch` health alert. **A real `CHECK` is impossible** — `now()` is not
  immutable, so Postgres rejects it in a CHECK constraint; the trigger form is the only option.
- **A worklist that publishes a MOVE must gate on the item actually being where it says (P119, 2026-08-20).**
  The W7.6 mailbox mirror acked **3,963 messages and moved zero, ever** — 100% of them
  `not_found_or_not_in_source_folder`, parking 3,960 `mailbox_mirror_parked` alerts = **99.3% of the whole
  open-alert surface**. Three durable rules came out of it:
  - **"The desired end state is already true" is SUCCESS, not a retryable failure.** A mover reporting the
    MESSAGE is not in the source folder means the work is done. It is now terminal
    (`lcc_mailbox_reconcile_ledger.outcome='already_out'`, `action='noop'`) on the FIRST ack — no retry, no
    park, no alert — and any open park alert for it is resolved on the spot. The classifier
    `lcc_mailbox_mirror_error_is_terminal()` is a narrow allowlist and the SINGLE owner of the decision (a JS
    copy is the normaliser drift this file warns about elsewhere; a test enforces there isn't one). A missing
    **DESTINATION** folder (`ErrorFolderNotFound`, a stale `processedFolderId`) is a REAL break and still
    retries/parks/alerts — "X not found" is two different facts, so never collapse them into one predicate.
  - **ONE OWNER PER STATE TRANSITION.** The flagged-intake flow already moves the email to Processed on its
    own success, so two movers were racing for one transition. The intake flow owns Inbox→Processed and
    Inbox→staging; the mirror owns staging→Processed and publishes ONLY messages LCC itself staged
    (`processing_log.outcome='staged'`) — producer anchor **4,051 → 323**.
  - **⚠️ A "triaged away" status is NOT a per-item decision when it was set in bulk.** The worklist's
    `inbox_triaged` arm (`inbox_items.status IN ('dismissed','archived')`) carried **100%** of the 3,960
    parks, because 3,944 of 4,051 flagged items are `archived` — 2,319 of them in ONE bulk sweep on
    2026-06-04 and 580 on 2026-06-16. Before using a status as a closure signal, check whether it clusters on
    a handful of days; a bulk-set status admits the entire historical population and is the same
    Consumption-Layer failure as the P112 bare-SF-identity cadence gate.
  - Sweep: `lcc_mailbox_mirror_retire_cleared_parks(dry_run default true)` + cron `lcc-mailbox-mirror-retire`
    (06:25). Touches `resolved_at IS NULL` only ⇒ idempotent, never rewrites another batch's retire tag;
    returns `alerts_left_open` as the honest count of genuinely stuck moves. Reversible by
    `resolved_note LIKE 'p119-mirror-auto-retire:%'`. **Related honest-count trap:** the ledger's `moved=true`
    now covers BOTH "we moved it" and "it was already gone" — read `outcome`, never quote `moved` as a count
    of moves performed. Full writeup: `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md`.
- **A HANDOFF BETWEEN TWO CONSUMERS MUST BE ANCHORED ON A DURABLE FACT, NEVER A TRANSIENT ONE
  (P121, 2026-08-20).** P119 gave the mailbox mirror a source-folder gate — `processing_log.outcome
  ='staged'` — which was right, but `outcome` is exactly the field the OTHER consumer flips. Flow 6
  (`todo-completion-poll`) flips `staged→filed` on a completed To Do, so whenever it won the race the
  mirror's worklist **dropped the row and the message sat in staging forever while the DB read
  `filed`/`moved`**. Three durable rules:
  - **Anchor on the fact, not the status.** `processing_log.staged_at` records that LCC PLACED the
    message in the staging folder; it is stamped by `lcc_move_queue_ack` only on a genuine move whose
    destination is `lcc_staging_folder_name()`, and never cleared. A status can be flipped by anyone;
    a placement happened or it didn't. Note it is deliberately NOT stamped on an `already_out` ack —
    "the message was not in the Inbox" does not prove "the message is in staging."
  - **A worker must not stamp a field describing work it did not do.** Flow 6 performs no Graph move,
    yet stamped `move_status='moved'` + `moved_at` because "PA already moved it". That stamp is what
    made a stranded message indistinguishable from a filed one. It now goes through
    `lcc_todo_completion_mark_filed`, which records `todo_completed_at` and returns a *disposition*
    (`mirror_owns_move` / `retargeted_to_final` / `no_move_state_change`). **`filed` counts flips, never
    emails moved.**
  - **⚠️ A VERDICT RECORDED BEFORE THE CURRENT STATE IS STALE, AND STALE VERDICTS ARE STICKY.** 61 of
    the 81 messages P120's executor placed in staging were ALREADY invisible to the mirror, excluded by
    `parked=true` / `not_found_or_not_in_source_folder` acks from 2026-08-07..09 — **correct when
    written** (the folder was empty), wrong the instant the executor filled it. P119's retire sweep
    cannot catch this: it only ever moves a row TOWARD terminal, never re-queues. Any ledger that
    excludes work must compare its verdict timestamp against the state the verdict was about
    (`led.acked_at < pl.staged_at`), and ship the inverse of auto-retire — a re-enqueue sweep
    (`lcc_mailbox_mirror_requeue_stranded`, cron 06:35, prior state kept in `requeue_prior`).
  - **Corollary — check the closure arms can actually FIRE for the population you gated in.** The mirror's
    `todos_done` arm is structurally dead for staged emails: the native Flagged-email model creates no
    `action_items`, so **0 of 103** staged messages have any, and 27 had an untriaged `inbox_item` too.
    A completed To Do would have flipped the row to `filed` with nothing ever publishing the move. Hence
    the `todo_completed` arm. A gate that admits rows no arm can ever close is a silent stall.
- **A CATCH-ALL BUCKET IS NOT A CLASSIFICATION — and a voice corpus is where that bites hardest
  (P124, 2026-08-21).** `classifyDraftType()` routed EVERY external non-reply into
  `cold_bd_outreach`, a label earned by nothing. Measured live: **28 of 29 rows were personal/family
  mail** — ten "Bunk Note" messages to Scott's kids at summer camp, "Meal Plan: Week of June 16",
  "Scrimmage", "Football email", plus self-notes to his personal address ("Prompt", "Error",
  "Calendar fix prompt"). **Zero were cold BD outreach.** That is the bucket `/api/draft-assist`
  retrieves its voice from for `purpose=cold_bd`, and `DRAFT_ASSIST` had been ON since 2026-08-14 —
  so a save would have written an Outlook draft to an institutional owner in the voice of a note to
  a nine-year-old, while every surface read healthy (29 exemplars, 100% full bodies,
  `voice_confidence` green). Same shape as the P112 bare-SF-identity cadence gate: **the positive
  case must be EARNED by a signal, never defaulted into by an `else` branch.**
  - **⚠️ The obvious guard was the destructive one.** "Exclude consumer-domain recipients" looks
    obviously right and would have deleted the corpus's BEST BD exemplars — *"RE: Following up on
    the DaVita in Banning, CA"*, *"…in Succasunna, NJ"*, *"Re: Needs List — 1050 Old Camp Road"*,
    all to gmail addresses. Real BD mail to a consumer address is almost always a REPLY, so it lands
    in `external_follow_up` and is untouched. The domain now decides only whether a NON-reply has
    earned the cold-BD label, never whether a message is excluded. (Cf. P158a: `&` in an owner name
    is a married couple, not a firm.)
  - **Filter the residue at LOAD time, not rank time.** `retrieveExemplars` falls back to the WHOLE
    corpus whenever the target bucket is thin — and the thin buckets are exactly the ones that
    trigger the fallback — so a rank-time filter still leaks. `personal_or_unclassified` is dropped
    in `loadCorpus` and the count surfaced as `retrieval.excluded_personal_or_unclassified`.
  - **A distilled "voice profile" inherits every bucketing defect, invisibly.** The ollama-distilled
    attributes for cold-BD read as a family newsletter (*"Good Morning, Claire Bear"*, *"Mom
    continues her full-time job of checking the Kanakuk app"*) and would have been folded into the
    canonical profile as house style. **The verbatim-citation guard cannot catch this** — those
    quotes ARE verbatim; they are just from the wrong corpus. It also covers excerpts ONLY, not the
    model's free-text fields, which carry real garbage (`avg_sentence_words: 323.9` where 323.9 is
    the bucket's *avg_words*; `0` for another bucket). **Fold numbers from the deterministic `shape`
    block only, and re-verify a bucket's MEMBERSHIP before trusting its distilled attributes.**
  - **The `email_bodies`-before-`activity_events` dedup is one character from silent total failure.**
    Ordering the union `src ASC` puts `'ae'` first, so every ~255-char preview wins its key:
    **866 rows / 0 full bodies** versus **614 / 614** correct. Both look like a healthy non-zero
    corpus. Assert on `n_full_body`, never `n`.
- **⚠️ A PROXY FOR A FACT YOU ALREADY HOLD IS NOT A MEASUREMENT — and "short" is not "truncated"
  (P125, 2026-08-21).** draft-assist decided whether an exemplar was a real captured body or an old
  ~255-char Graph preview by its LENGTH (`FULL_BODY_MIN_CHARS = 300`). Scott's voice is *"extremely
  short and punchy"* — the profile's own first rule — so the metric contradicted the trait it was
  measuring. Live over the 777 Scott-authored rows carrying a real `body_html`, after the cleaner
  strips the quoted chain and signature: **438 clean to 12–299 chars**, 268 to ≥300, 71 to under 12
  (correctly dropped as boilerplate — `"AWESOME!"`, `"Just did!"`). **Median cleaned prose: 160
  chars**, so the heuristic misfiled **62% of the genuine full bodies** and `voice_confidence`
  faithfully reported *"preview-era OPENINGS only"* over a corpus that was nothing of the kind.
  Provenance is a fact held at load time — WHICH BODY COLUMN the text came from — so carry it
  (`exemplar.full_body`) instead of re-deriving it; the length test survives only as a fallback that
  announces itself (`exemplarBodyCoverage().basis`). Same class as the P124 `else`-branch bucket and
  the P159a `drillthrough: 37`: plausible, non-zero, and wrong.
  - **⚠️ A WEIGHT THAT CAN LOSE IS INDISTINGUISHABLE FROM ONE THAT IS NOT THERE.**
    `rankExemplarsByEmbedding` scored cosine + a 0.02 bucket nudge and nothing else — it ACCEPTED
    `target.recipientEmail` and ignored it, while `rankExemplarsDeterministic` weighted recipient
    (+2) *below* bucket (+3). So what "relevance" meant depended on **whether Ollama answered**, and
    backfilling 55 full-body emails to the exact recipient changed the retrieved set by **nothing**.
    Two rankers behind one seam must read ONE judgement (`recipientMatchLevel`), and a guarantee you
    actually mean must be a **partition, not a score term**: `selectExemplars` tiers
    `full body + exact recipient` → `full body` → `preview + exact recipient` → `preview`, applied
    around whichever ranker won. **A domain-only match is deliberately NOT a tier** — a colleague at
    the same firm is a different person (cf. the `dup-pair-planner` fuzzy-vs-identity split). And read
    `cc`: 3 of the 55 live rows were cc-only and scored as if the party were not on the message.
  - **A corpus loader must filter at the DB, or the page budget buys someone else's mail.**
    `loadCorpus` paged the newest 3,000 rows of the WHOLE store and applied the author gate in JS
    afterwards: `email_bodies` holds 28,090 body-bearing rows of which 1,188 are Scott's, so the
    window held **565**. Push the author predicate into PostgREST; keep the JS gate as the authority.
    And report `corpus_full_bodies`, never just `corpus_size` — the P124 dedup lesson applies to the
    loader identically.
  - **"It returned nothing" and "nothing ever asked" are different facts.** draft-assist reported
    `facts.source: no_entity_relational` for a live, named, in-progress deal because facts loaded only
    `if (entityId)` and the caller passed none — resolution did not fail, it did not exist. It now
    reads the hourly deal-matcher's OWN verdict (`activity_events.source_type='lcc:deal_match'`,
    `external_id` = the RFC `internetMessageId`, `entity_id` = the deal) rather than inventing a
    second matching heuristic, and it is **thread-scoped** (`conversation_id`) because that matcher is
    budget-bounded and skips already-attributed mail — the exact message being replied to usually
    carries no row while its siblings do. An empty result names the rung
    (`thread_not_attributed_to_a_deal` ≠ "no deal exists").
  - **An outcome nobody can observe will be wrong for as long as it takes someone to look.** The
    Outlook draft seam returned `{ok, draft_id, web_link}` — **byte-identical for a threaded reply and
    a brand-new message** — so the first real save (2026-08-21) landed a STANDALONE draft on a
    correctly-resolved thread and read as a clean success. Every flow response now echoes `threaded`
    (+ `conversationId`), the seam surfaces `conversation_matches_thread`, and `threaded: null` is
    kept distinct from `false` ("an older import" ≠ "it did not thread"). Three flow defects were
    behind it: a **second `Response` running after the If on BOTH branches** (so the reply path
    answered twice, the second reading a null `body('Create_draft')`), a PATCH of `toRecipients` onto
    a reply draft that already carries the thread's recipients, and an unguarded empty `$filter`
    building `/me/messages//createReply`.
  - **⚠️ THE COMMITTED FLOW DEFINITION HAD DRIFTED FROM THE TENANT.** `CreateDraftMessageV3` does not
    exist in this tenant (found while hand-packaging the import), `$authentication` must be declared
    and referenced by every `OpenApiConnection`, and every `HttpRequest` carrying a Body needs
    `ContentType: application/json` or Graph 400s *"Empty Content-Type provided"*. All three are now
    in `flow-lcc-create-outlook-draft.json`. **A definition that only describes a flow nobody can
    import cannot be reasoned about** — when an operator hand-fixes an import, fold the fix back.
- **Web-search enrichment proxy (`owner-contact-websearch`) is PAUSED — do not activate.** Contact acquisition
  goes through the public-records chain (cross-reference resolver → SOS-direct → address reverse-lookup → deed).
- **"Owner is reachable" has FOUR definitions — quote `reachable_hero_qualified` (P161, 2026-08-21).** The owner-panel hero
  (`_nextActionForContact`, detail.js) used to show "Find a contact" unless `buildContact360` produced a
  `subject.email` / `entity.phone`, and c360 never walked `entity_relationships` — so an owner with a
  linked person carrying an email read as unreachable, and attaching a person+edge (the doctrinally
  correct write) changed nothing on screen. **Prompt 114 closed that** (`subject.reachable_via`, resolved
  by `api/_shared/owner-reachable-via.js`; hero renders "Reach via <name> (<role>)"). Read
  `v_lcc_owner_reachability`, which now reports all three side by side:
  `reachable_hero` = the PRE-114 definition, retained ONLY as the before/after yardstick;
  `reachable_hero_effective` = org routes ∪ a linked person surviving the ROLE guards — **no longer the
  number to quote** (see P161 below); `reachable_graph` = any linked person INCLUDING brokers, which
  OVERSTATES what the panel can show; **`reachable_hero_qualified`** = effective MINUS the weak-association
  owners P161 gates out — **quote this one**. `v_lcc_owner_unreachable_worklist` is the value-ranked population.
  - **⚠️ `hero_gap` IS NOT A DEFECT COUNT — the previous sentence here was WRONG and dangerously so.**
    It read "`hero_gap` is the UI-defect residue (47 → 0 on 2026-08-15)", which invites someone to
    drive it back to zero. Read the view: `hero_gap = reachable_hero_effective − reachable_hero`, i.e.
    the **GAIN** delivered by the P114 linked-person route. It measured 274 on 2026-08-21. Driving it
    to 0 would mean destroying 274 owners' only contact route. This is the dated-claim trap the
    doctrine section warns about, caught on a metric rather than a blocker.
  - **P161 — a WEAK-ASSOCIATION edge does not make an owner reachable at scale.** `reachable_hero_effective`
    counted **158** owners whose ONLY route was a `works_at` edge with no contact on the org itself.
    `works_at` is the **Salesforce-account org edge** (8,506 of them, created 2026-07-16..08-20) — the same
    bare-SF signal class **P112** disqualified as a BD signal for cadences, here underwriting the
    reachability claim instead. It proves association, never control, and Scott's doctrine targets *the
    individual in control of the decision*. Gate (`lcc_is_weak_association_role` +
    `lcc_weak_role_value_floor()` = the same **$500k** knob as the gov asset-mint and
    `CADENCE_SIGNAL_MIN_VALUE` — one number, not three): rent **< $500k** ⇒ accepted (65 owners; a small
    LLC/SPE's SF contact is plausibly the principal); **≥ $500k** ⇒ gated (48 owners, **$153.8M** of annual
    rent); **rent unknown ⇒ gated — UNKNOWN IS NOT SMALL** (45). Reachable **389 → 296**; the 93 land in
    **`v_lcc_weak_reach_worklist`** (`reason` = `above_floor` | `value_unknown`) for the
    contact-acquisition engine. **⚠️ Asset COUNT is the wrong knob and was measured to be so** — at
    `assets_held = 1` the list holds Trammell Crow Co ($24.1M), Gba Associates LP ($27.2M), The Claremont
    Group ($13.5M), GI Partners ($8.6M): asset count measures **LCC's coverage**, not the owner's size.
    Brokers remain excluded OUTRIGHT (never value-gated); live check confirms **zero** broker edges exist
    on resolved owners today, so that guard is correct and simply has nothing to catch.
  - **`reachable_via` is NEVER merged into `subject.email`.** That field means "the ORG's own contact
    detail"; a linked person's address is a different claim. Merging them would assert the org has an
    address it does not and re-commit the person/org conflation `sf-account-link.js` guards against.
  - **The winner-selection rule is ranked, pure and regression-tested** (explicit primary → role
    authority → email-over-phone → most-recently-verified → `person_id`). Never "first row wins" — that
    is the gov `ensureTrueOwner` substring defect (gov `CLAUDE.md` §20). Broker-ish roles
    (`NON_REACHABLE_ROLES`) are EXCLUDED, not ranked last; the SQL `via_person_selectable` arm mirrors
    that list, so **add a role to one and you must add it to the other** or measurement and UI drift apart.
- **The owner-contact review lane is mostly REJECTS — never wire a single "confirm" button to it.**
  `lcc_owner_contact_propagate_review` (Prompt 111) was documented as candidate decision-makers; live
  classification of all 101 rows says **22 person-shaped, 77 organization-shaped, 2 blocked**, and the
  organizations are dominated by **transaction counterparties** — the buyer/seller of a sale on the
  owner's property, captured by the CoStar sidebar ("NGP Capital" ← "CoreCivic, Inc."). Confirming those
  writes another company's switchboard onto the owner. The Decision Center lane
  `owner_contact_attach_review` (Prompt 114) therefore has **three shape-aware verdicts** —
  `attach_person` (person entity + `entity_relationships` edge), `same_party` (fill the OWNER's own blank
  from an abbreviation/acronym name variant), `reject` (terminal, never re-proposed) — and `admin.js`
  re-runs the pure shape gate (`owner-contact-verdict-planner.js::validateVerdict`) before writing, so a
  stale card cannot mint a REIT as a person. Three live-caught traps encoded there:
  `looksLikePersonName` alone accepts org names with no legal suffix (**"Global Net Lease"**, **"U.S.
  Department of Veterans Affairs"** both passed) — require `isPersonShaped` (adds an org-marker check);
  acronym matching must read initials from the **unsorted** name, because `strictOwnerCore` sorts tokens;
  and a strict token SUBSET is NOT an abbreviation (**"Government Properties Trust"** ⊄ **"Easterly
  Government Properties"** — different REITs), so require equal token counts and leave subsets undecided.
- **The domain `true_owner` is often the OPERATOR — never promote it to owner without the flag check
  (P113).** dia files the tenant in the owner slot at scale: **7,926 of 11,783** dia properties point at a
  `true_owners` row flagged `is_operator_not_owner`, and on the assets that lacked a reconciled owner the top
  domain "owner" names were DaVita Inc. (348), Fresenius Medical Care (334), DaVita Kidney Care (67). The
  owner feeder `lcc_ingest_domain_owner_evidence` blocked **815 assets** on that flag — more than the 809 it
  promoted. **Use the existing flag** (`dia.true_owners.is_operator_not_owner`, surfaced on
  `v_property_owner_facts_portfolio.true_owner_is_operator` and read by the P0.1 display guard as
  `own.true_owner_is_operator`); never write a second name-based operator test, or the two definitions drift
  and the panel and the feeder disagree. gov has no such conflation (the tenant is a federal agency) — its
  view returns constant `false` so one guard serves both domains.
- **Resolve a domain owner to an LCC entity by ID, never by name.** `external_identities(source_system=
  'dia'|'gov', source_type='true_owner', external_id = properties.true_owner_id::text)` is the canonical
  join and it follows entity merges for free (227 of 15,481 identities already point at a merge survivor).
  The mirror `lcc_property_owner_facts` carries `true_owner_effective_id` (one `merged_into_true_owner_id`
  hop applied domain-side) for exactly this. **`lcc_mirror_tick`'s `select=` list for the
  `property_owner_facts` leg must keep those columns** — `lcc_apply_property_owner_facts_page` writes NULL
  for any key absent from the payload, so dropping one silently NULLs the mirrored column on the next
  incremental page, starving the feeder AND disarming the operator guard.
- **`lcc_reconcile_property_owner` scores an ownership CHAIN as competing claims (known, sized, unfixed).**
  It sums evidence weight with a recency decay **floored at 0.25**, so a building sold three times yields
  three near-equal candidates and confidence lands at 0.33–0.50, under the 0.55 gate. Measured 2026-08-15:
  **876** assets have evidence and still read "Unresolved"; a strict-latest-purchase supersession tier
  (the later purchase SUPERSEDES the earlier — that is what "current owner" means) would resolve **465**
  of them and correctly abstain on the 360 that tie on date. Adding evidence does not fix this class —
  don't reach for another feeder first.
- **`dup-pair-planner.ownerCore` / `nameSimilarity` are for FUZZY PAIRING, never for IDENTITY.** They
  strip a generic-CRE **stoplist** (realty, capital, income, group, holdings, properties, partners,
  services…) on top of legal forms, which is right when scoring a candidate pair and catastrophic when
  asking "is this the same party": `Realty Income Corporation` reduces to the **empty string** (so it
  fails to match ITSELF), and `Agree Realty Corp` / `Agree Holdings LLC` both reduce to `agree` and
  score **1.0**. Both were caught by a live dry-run in Prompt 111, one of them a would-be automatic
  write onto the wrong owner. For identity use the STRICT core that strips **only** pure legal-entity
  forms — `owner-contact-propagate-planner.js::strictOwnerCore` (JS) / **`lcc_owner_strict_core()`** (SQL,
  LCC Opps, added P116) / `gov_owner_strict_core` (SQL, gov `CLAUDE.md` §20) — and require the core to carry
  real material before letting equality drive a write.
  - **`lcc_normalize_entity_name()` is in the SAME banned-for-identity class** (P116, caught live). It
    strips `holdings|properties|partners|capital|group|company|co|trust` on top of legal forms, so
    **"Century Park Partners" == "Century Park Properties LLC"** (both → `century park`). It is correct
    where it is used — GROUPING candidate duplicates in `v_lcc_merge_candidates`, where a human confirms —
    but a P116 dry-run that used it to pick a re-point target would have moved a property onto a
    **different company**. Grouping-for-review ≠ identity-for-write.
  - **Corollary (P116): a brokerage-polluted name is INVISIBLE to the merge detector.**
    `v_lcc_merge_candidates` groups on `lcc_normalize_entity_name` needing ≥2 members, and
    `"DP Brighton LLC by Marcus & Millichap"` normalizes to `dp brighton by marcus millichap` — which never
    groups with `dp brighton`. Cleaning the stored name is therefore what SURFACES a duplicate, not what
    hides it. Whenever you correct a captured name, check whether the correction changes its merge grouping.
  - **⚠️ AND IT RETURNED **NULL** FOR 1,089 LIVE ORGANISATIONS — SO THE MERGE DETECTOR COULD NOT
    SEE THEM AT ALL (P189, 2026-08-26).** `lcc_normalize_entity_name` strips
    `group|partners|capital|holdings|company|trust` on top of legal forms, so an ACRONYM-NAMED firm
    has nothing left: **RMR Group, GI Partners, AVG Partners, NGP Capital, MMI Capital all normalize
    to NULL**, carrying **$185.1M of current annual rent**. `v_lcc_merge_candidates` filters
    `WHERE norm_name IS NOT NULL`, so they were not ranked low or flagged — they were **absent**,
    and the surface reported no duplicates for any of them, forever (playbook Class 11: the zero is
    the instrument). Fixed with a namespaced `dc:<lcc_owner_domain_core>` FALLBACK key
    (`20260827080000`): **+121 groups / 300 entities / $136.5M, 60 of them BYTE-IDENTICAL names**
    (`"NGP Capital"` ×5). **The durable lesson is the meta one — this exact reduce-to-nothing hazard
    was already documented in this file for `dup-pair-planner.ownerCore` and `lcc_owner_strict_core`,
    and nobody checked it on the normalizer the detector actually USES. When a hazard is documented
    for one function, grep every sibling that does the same job; the hazard travels with the
    TECHNIQUE, not the name.**
    - **The fallback is forced `auto_mergeable = false`, and that is not optional.**
      `lcc_apply_fuzzy_merges()` loops `WHERE auto_mergeable = true` → `lcc_merge_entity()`, so
      admitting an ungraded grouping key there would auto-merge 121 unreviewed groups. Safety was
      PROVEN, not asserted: the blind population is **all NULL, zero empty-string**, hence exactly
      the set the old filter excluded and DISJOINT from every existing group — gated against a
      pre-migration snapshot at **`auto_mergeable` 3,053 → 3,053, 0 pre-existing groups changed**.
    - **⚠️ THE OBVIOUS FIX FOR THE *SECOND* BLIND SPOT WAS MEASURED AND REJECTED.** A wording
      difference defeats the normalizer even when it returns a value (Easterly →
      `easterly gov reit` vs `easterly government`), and grouping on the shared Tier 0 bench EMAIL
      DOMAIN looks like far stronger evidence. Graded over every same-domain owner pair: **4
      net-new pairs, exactly 1 a genuine duplicate (Easterly)** — the other 3 plus 13 further NGP
      pairs are **sponsor↔SPE**. **25% precision; a domain-keyed view would be a noise generator.**
      The domain is shared *because an SPE family shares its sponsor's domain* — real evidence
      answering a DIFFERENT question (the P188 Gary George shape, and the P190/P193 sponsor→SPE
      relation already models it). Also caught: `jameshowardcpa.com` groups two unrelated owners
      through a shared **CPA**, and `lcc_is_spe_shell_name` under-detects PLACE-NAMED SPEs
      ("Woodbranch Lafayette VA LLC", "NGP VI PHOENIX AZ LLC") — a stated gap, not patched, because
      a second SPE detector is the normaliser drift this file keeps warning about.
    - **⚠️ `IS NOT DISTINCT FROM` TREATS NULL–NULL AS EQUAL, AND THAT INVERTED AN AUDIT MID-FLIGHT.**
      Bucketing pairs on `na is not distinct from nb` labelled every both-NULL (i.e. blind) pair
      **"already visible to the detector"** — the exact opposite of the truth — reporting 8/17 where
      the corrected split is 4/13/4/4. Same family as the P157 `reloptions` and P182 deparse traps:
      a predicate structurally unable to express the question returns a plausible number. **Any
      audit that buckets on equality must decide what NULL means before it counts anything.**
      Full writeup: `docs/audits/P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md`.
      **P195 merged this population** (66 entities → 56 survivors, $102.2M) and held the 4 groups
      whose names carry no distinctive token — see the P195 section below.
  - **⚠️ `&` IN AN OWNER NAME IS USUALLY A MARRIED COUPLE, NOT A FIRM (P158a, caught pre-apply).** Adding
    `&` to `lcc_owner_name_has_org_marker` looks obviously right — no person's name has an ampersand — and
    would have flagged **1,305 entities, retyped 119 people and touched 66 RESOLVED OWNERS**. The population
    is dominated by joint individual owners: `Amy & Richard Gonzalez`, `Anil M & Rajeshkumar K Khatri`,
    `Adel B & Gihan M Bareh`, `A.R. Venugopala & Padma V. Reddy`. Exactly the individuals Scott's
    2026-08-19 doctrine admits as owners. One firm caught (`Rutherford & Strickland`) is not worth
    misclassifying dozens of couples. **Only the unambiguous half shipped** — plural/business nouns
    (`companies|health|medical|clinic|services|solutions|systems|industries`); note `company` was already
    listed but `\M` is a word boundary so the PLURAL slipped through (`The Graham Companies`).
  - **Adding an org marker without RETYPING silently removes owner eligibility.**
    `lcc_supersede_property_owner` admits `owner_entity_type='organization' OR
    lcc_owner_name_is_credible_person(...)`, and credible_person EXCLUDES org markers — so a name that
    gains a marker while still typed `person` fails BOTH arms. Retype in the same migration (P149 pattern)
    and gate on `0 resolved owners failing both arms`.
- **A brokerage is the agent, never the principal — every owner-writing feeder needs the guard.**
  `lcc_reconcile_property_owner` had none and produced **42 of 46** brokerage-as-owner rows (P116);
  `lcc_supersede_property_owner` carried `and not lcc_owner_name_is_brokerage(...)` and produced **0**.
  The guard now sits on both. Because `lcc_property_owner.source` is derived from the evidence rows the
  reconcile function scores, that one predicate covers `relationship_graph` AND `domain_true_owner`.
  **Re-point the EVIDENCE too, not just `lcc_property_owner`** — otherwise the next reconcile pass
  re-elects the bad candidate and silently undoes the correction. Note the detector matches bare
  `\mmarcus\M`/`\mnai\M`, so a genuine "Marcus Family Trust" would trip it; the
  `guard_blocked_candidate` lane of `v_lcc_p116_brokerage_owner_review` exists so a false positive
  surfaces instead of failing silently (measured 2026-08-17: it blocks exactly the known brokerages).
- **`entities.email` / `entities.phone` had NO `field_source_priority` ladder** until migration
  `20260903120000` (manual@1 → salesforce@20 → `domain_owner_contact`@55 → costar_sidebar@60), so every
  writer to them was invisible to the provenance doctrine. Register a row when you add another.
  (`v_field_provenance_unranked` returns **29** rows for other tables — pre-existing drift; it is a 30-day rolling window, so re-measure rather than quoting this number. It has read 35, 22 and 30 on different days.)
- **TrafficMetrix table-as-contact-list misparse (Prompt 89).** A CoStar/sidebar capture once parsed a
  property page's TrafficMetrix traffic-count TABLE as a contact list — street names / column labels
  ("Collection Street", "Traffic Vol", "Made with TrafficMetrix") minted as PERSON entities, all stamped
  with the page's one real email (fan-out) → garbage person_email clusters. Guard: `api/_shared/tm-misparse.js`
  is the single detector (`isMisparseName` = street-suffix or TM-vocab, never a clean "First Last"). It is
  reused by (1) the one-shot seeder `?action=tm-misparse-seed` (writes DETERMINISTIC `tm_misparse` dismiss
  proposals into `junk_entity_review` — value-gated on the email fan-out `member_count>4`, so lone real
  people with unique emails are never swept in); (2) the sidebar contact-extraction guard (`isJunkContactName`
  + `planContactMinting` fan-out cap → suspects routed to a `contact_misparse_review` inbox item, never
  minted); (3) the U3 person_email pool (clusters with a misparse member are skipped). On confirm of a
  `tm_misparse` dismiss, the verdict path `unstampMisparseMember` clears `entities.email` + detaches the
  conflated `external_identities` (reversible via `junk_review_batch`) so the real broker's email/SF stops
  binding the phantom, then soft-retires it. Never hard-deletes; the seeder is idempotent (`on_conflict=subject_ref`).
- **The SOS-direct fetcher currently yields nothing from CI** (FL/CA Cloudflare/Incapsula 403 to datacenter IPs;
  AZ portal migrated). The handlers are correct + honest-blocked; the weekly `--apply` schedule is DISABLED.
  Needs a non-datacenter egress. See **government-lease** `docs/SOS_ENDPOINT_VERIFICATION_2026-07-22.md`.
  → **W9.1 Stage 2 (Prompt 99) BUILDS that egress:** the GaryBuilt residential fetch proxy
  (**government-lease** `sos-proxy/` + `docs/RUNBOOK_sos_proxy_garybuilt.md`). Set `SOS_PROXY_URL`
  (+ dedicated `SOS_PROXY_CF_ACCESS_CLIENT_ID/SECRET`, **never** the ollama token) and both the gov
  Python fetcher and the LCC contact-acquisition SOS stage route through it. The SOS stage (`STAGE_SOS`,
  `api/_handlers/contact-acquisition-engine.js`) is flag-gated `W9_1_SOS_DIRECT`, proposal-only
  (`contact_acquisition_review` — confirm never auto), and no-ops honest-blocked while off. Adapter
  re-verification through the proxy + the flag flip are Scott's live post-install steps.
- **⚠️ TWO EMBEDS OF ONE TABLE MUST EACH CARRY AN ALIAS, OR PostgREST ABORTS THE WHOLE QUERY
  (P132, 2026-08-26).** `select=*,users!a_fkey(x),users!b_fkey(x)` gives BOTH embeds the same
  internal alias (`<table>_users_1`) and errors *"table name … specified more than once"* — the FK
  hint disambiguates the JOIN, it does NOT name the relation. Correct form is
  **`alias:table!fkey(cols)`** on every embed (the Supabase docs' own two-FKs-to-one-table example:
  `start_scan:scans!scan_id_start(...)` + `end_scan:scans!scan_id_end(...)`); `cadence-engine.js`
  already had it right (`from_entity:`/`to_entity:entities!…`).
  - **It killed the ENTIRE Research page for every lane and every status filter**, because both
    `api/queue.js` research branches (v1 `case 'research':` and v2 `v2GetResearch`) embedded `users`
    twice for assignee + creator. **The badge and the list read different sources**, so
    `?view=research_lanes` kept reporting healthy open counts (e.g. `establish_ownership_history`
    545) off `v_lcc_research_lane_summary` while the list itself 500'd — the surface looked
    populated and produced nothing. That is why every research lane reads "0 completions ever"
    (Dead-End playbook classes 3 + 7), and it also hid the 453 P131 ownership-chain drafts, which
    only render attached to a card. **Assert on `items.length`, never the lane badge.**
  - **v1 swallowed the cause and v2 leaked it.** `case 'research':` returned a generic
    `{"error":"Failed to fetch research tasks"}`; `v2GetResearch` passed `result.data?.message`
    through, which is the only reason the real error was ever seen. A handler that discards the
    DB's own message turns a one-line fix into an outage of unknown duration — same lesson as the
    409-is-not-a-conflict note below.
  - **The same shape was live in `api/operations.js::getOversight`** (escalations embedding `users`
    twice for `escalated_by`/`escalated_to`), and there it is read as `escalations.data || []` with
    **no `.ok` check** — so the 400 rendered as "no open escalations", silently. A full sweep of
    `api/` found exactly these three selects; nothing else embeds one table twice.
  - Guard: `test/research-view-embed.test.mjs` parses every `select=` in `api/` and fails when two
    embeds resolve to the same response key — a general invariant over the whole API surface, not a
    line-anchored grep (see the block-slice footgun above). Verified to go red on the original code.

- **PostgREST's write surface is NARROWER than SQL's, and it reports the difference badly.** Three
  distinct traps, all hit live in one session (P136a/P136b/P141), all costing real rows:
  - **An EXPRESSION or PARTIAL unique index is invisible to PostgREST.** `on_conflict=` takes COLUMN
    NAMES ONLY, so it cannot express a `coalesce()` arbiter. With nothing inferable,
    `Prefer: resolution=ignore-duplicates` silently falls back to the **PRIMARY KEY** — and if that is
    a `bigserial` it never collides, so `ON CONFLICT DO NOTHING` never arms and ONE duplicate 409s its
    entire chunk (10 in-file dups cost 500 rows). **If rows arrive over REST, the dedup key must be a
    single PLAIN column — generate it (`STORED GENERATED`) when the real key needs coalesce().**
    Precedent: `dia.sales_transactions.dedup_natural_key`, `lcc_dia_ownership_master.dedup_key`.
  - **Postgres evaluates NOT NULL BEFORE ON CONFLICT.** A partial-column upsert intended to merge
    (`{id, col_a, col_b}` on a table with other NOT NULL columns) fails **23502**, never reaching the
    conflict. Use an RPC taking a `jsonb` array, not a PostgREST upsert. Per-row PATCH is the other
    option and is thousands of round trips.
  - **A send counter is NOT a write counter.** `chunk.length` summed over successful POSTs counts rows
    SENT; with ignore-duplicates a payload carrying the same key twice lands once (302 sent → 301
    written). Same class as the Dialysis repo's documented "`inserted: N` is a DERIVATION counter."
    **Truth is a `count=exact` delta before vs after**, and a dry run must ALSO report
    already-present vs NEW or a re-run looks like it did nothing when it did everything.
  - **⚠️ AND THE GENERAL FORM (P159a, 2026-08-20): an outcome that reports SUCCESS but does not change the
    row's QUEUE ELIGIBILITY is indistinguishable from progress.** The owner-contact enrich tick reported
    `drillthrough: 37` — which reads as the worker doing real work — while the queue drained **6**. The
    drillthrough branch keys on the NAME and never sets `active_contact_entity_id`, so the same rows
    re-qualified and re-drilled every tick, forever. Only the STATE DELTA exposed it: queue 752→746 (−6)
    against `find_person_at_manager` 45→47 (+2), i.e. 35 of 37 were repeats. **Never judge a worker by its
    tally; judge it by the delta in the population it is supposed to drain.**
- **⚠️ `pg_net:no_response` DOES NOT MEAN THE WORK FAILED — and the count you are shown is a
  RETENTION ARTIFACT (P123, 2026-08-21).** `lcc_cron_post` posts every Railway cron with
  `timeout_milliseconds := 60000`. A handler that takes longer still runs to completion and still
  writes its own success row; pg_net just stops listening and records
  `net._http_response.timed_out = true`. So the health surface says `no_response` while
  `lcc_deal_match_run_log` says `ok=true` for the same hour, and both are telling the truth.
  **`net._http_response` is pruned to a ~6-hour window**, so "6 `no_response` in 24h" was not a 25%
  failure rate — it was **100% of the retained sample**. Join `lcc_cron_post_log` → `net._http_response`
  and read `timed_out` + `error_msg` before you believe any per-day count off that table.
  - **The bottleneck is almost never the SQL — count the ROUND TRIPS.** The matcher's per-deal
    candidate query profiled at **99 ms** (36 deals ≈ 3.6 s of a ~80 s run). The other ~75 s was
    **~680 sequential PostgREST calls**: one idempotency GET and one edge-existence GET *per matched
    email*, 341 matches, every hour, all of them rediscovering already-done work
    (`already_attributed: 341` on every single run). **Be precise about what was wrong here:** the
    matcher is NOT a dead worker — it wrote 282 genuine attributions in 14 days and mail is flowing
    (692 Outlook events in 7 days). What was pathological was the CONSTANT re-discovery cost, paid in
    full every hour regardless of how little was new. That is the P159a lesson applied to COST rather
    than output: `already_attributed` is a re-scan tally, so never read it as throughput, and never
    let the price of confirming "nothing changed" scale with history.
    An existence check inside a per-row loop is an N+1 over HTTP; hoist it to ONE paged prefetch and
    make the check a Set hit. Fail that prefetch **closed** — assuming "nothing is attributed"
    re-POSTs the whole set and reports a fabricated delta.
  - **A recurring worker must be BOUNDED, not just fast.** Give it a deadline inside the 60 s window,
    a write cap, and a cursor it hands to the next run — stopping on an item BOUNDARY so no partial
    state is left. Report the stop (`budget_stopped`), never cap silently.
  - **Open the run-log row BEFORE the work, close it after.** A row written only on the way out cannot
    record a run that died mid-flight: the dropped run leaves nothing and is indistinguishable from one
    that never fired. A row stuck at `status='started'` is the signature of a drop.
  - **And `CAND_LIMIT = 1200` was always a lie** — PostgREST caps a response at 1000 rows regardless of
    `limit=`, so that read silently returned 1000 and dropped real matches. Page at exactly 1000 and
    count the truncation.
- **A value-ranked queue must EXCLUDE its terminal states, or the highest-value rows jam the head forever
  (P159).** `v_owner_contact_enrich_queue` orders `rank_value DESC NULLS LAST, updated_at ASC`. Once
  value-ranking was added (20260729120000), `updated_at` became a mere TIEBREAK — so the rotation the
  handler's comment still claims ("updated_at ASC is the tiebreak that keeps the queue moving",
  `owner-contact-enrich.js:502`, now stale) no longer protects anything. Rows that can never resolve
  (`enrichment_action='manual_research'` — and note that CASE ends in `ELSE 'manual_research'`, so the
  column is NEVER null and a `not.is.null` filter admits everything — plus `find_person_at_manager`, plus
  an open `owner_contact_manual` research task) sat permanently at the top: **17 of the top 25 slots**,
  matching the live tick's `skipped` count exactly. Fixed in the VIEW, not the handler — actionable-only is
  the Consumption-Layer rule, and it needs no redeploy. Queue 4,472 → 757 actionable; useful work per run
  32% → 88%; real drain 6 → 16.
- **`lower()` BEFORE a character-class strip, never after.** `regexp_replace(x,'[^a-z0-9]','','g')`
  carries no `i` flag, so applied to raw text it DELETES every uppercase letter. `lower(regexp_replace(
  'YUKON MEDICAL VA LLC','[^a-z0-9]','','g'))` → **`''`**, and every ALL-CAPS name collapses to the
  empty string and compares EQUAL to every other. This shipped a "32.6% of transitions are
  self-transitions" finding that was really **0.8%** — wrong by 43×, and inverted on both gate rows
  (a case-only variant read FALSE, a real GPT→NGP sale read TRUE). Correct form:
  `regexp_replace(lower(x),'[^a-z0-9]','','g')`.
- **Verify on NAMED rows with stated expected answers, never on an aggregate.** The bug above produced
  a completely plausible 32.6% that would have shipped unchallenged; it was caught only because the
  gate asserted specific properties with expected outcomes. Corollary, hit four times in one session:
  **read the rows the CONSUMER will actually process, not a sample of the population.** They are not
  the same distribution — across all 9,582 gov ownership transitions 3.9% fail the name guards, but
  across the TIED rows a supersession consumer actually touches, **25%** do. A tie exists *precisely*
  where the evidence is messy. Sample the population, conclude "96% clean", be wrong about a quarter
  of your rows.

## gov ownership transitions → LCC supersession (P138–P141, 2026-08-19)

`gov.ownership_history` held **9,582 dated prior→new transfers across 7,057 properties** that LCC could
never see: the anon-readable `v_ownership_history_portfolio` exposes `transfer_date` but **not
`prior_owner`/`new_owner`**, and filters `true_owner_id IS NOT NULL` (hiding 23.5%). gov
`v_ownership_transitions_portfolio` (sibling view, gov repo `sql/20260818_gov_p138*.sql`) exposes them.

**FEED FROM:** `is_latest_for_property AND new_owner_is_clean AND NOT is_self_transition AND NOT
is_oscillating_pair AND new_owner_true_owner_id IS NOT NULL`. Each guard exists because it caught
something live:

- **`new_owner_true_owner_id`** is `true_owner_id` exposed ONLY where the linked `true_owners.name`
  matches the transition's `new_owner`. Measured: the id means the NEW owner 91.4%, the PRIOR owner
  0.6%, **neither 8.1%** — where id and name disagree one is wrong and we cannot tell which. **The
  NAME verifies the ID, the ID carries the identity, neither is trusted alone.** This is what keeps the
  LCC join ID-to-ID via `external_identities(gov, true_owner)` with no fuzzy step anywhere.
- **`is_oscillating_pair`** — a property whose history records BOTH A→B and B→A. `gsa_lease_diff` emits
  an "acquisition" every time the GSA lessor field flickers between an SPE and its parent (property 180:
  GPIT ⇄ Echelon Pkwy four times, six identical rows on one date). The DATE is real, the DIRECTION is
  not. 233 properties; `gsa_lease_diff` is ~93% of the feed and the ONLY source affected — so the flag
  is per-property rather than a down-weight of the whole producer.
- **`gov_strip_brokerage_suffix`** — a `by <brokerage>` suffix is **STRIPPED, not rejected**. Of 214
  brokerage-flagged rows, 197 are REAL owners wearing a capture artifact (`Gardner Tanenbaum Holdings
  by Colliers`, `Boyd Watterson by Newmark Knight Frank`) and only 14 are genuine brokerage-as-owner.
  A rejection guard discards the owner with the artifact. Same lesson as the LCC-side note that
  cleaning a brokerage-polluted name is what SURFACES a duplicate.
- **`is_name_variant`** catches strict prefix extensions ONLY. `1521 N CARPENTER LLC` vs `1521 North
  Carpenter Road LLC` is missed. Catching it needs token-level fuzzy matching — banned for identity —
  so it is a **stated gap, not a patch**.

**LCC side:** `gov_ownership_transition` is registered at supersession **TIER 3 (with `rel_purchase`,
so the DATE decides)** and `field_source_priority` **18** (above rel_purchase 20). The two ladders
differ ON PURPOSE — the tier asks *what kind of claim is this* (both are one historical transaction),
the priority asks *if they disagree, who wins* (the domain's own recorded transfer beats an inferred
edge). Feeder: `scripts/feed-gov-ownership-transitions.mjs`.

### Asset-identity coverage is what gates owner resolution — not evidence

`lcc_property_owner_evidence` / `lcc_property_owner` / supersession all key on an **entity UUID**, so a
property with no `external_identities(domain, 'asset')` row cannot carry owner evidence at all. LCC
holds `lcc_property_attributes` for 13,823 gov properties but asset entities for only 2,235 — and the
first feeder run skipped **2,909 of 3,254** transitions as `no_asset_entity`. **When a domain feeder
under-delivers, check asset-identity coverage before blaming the evidence.**

**Minting is gated, and `--mint` REFUSES to run without a value gate** (`--min-rent`). Doctrine
satisfied four ways: consumer = the supersession engine, *in the same pass*; value gate = the rent
floor; retire predicate = a minted entity with no evidence and no portfolio fact (verified **0**);
honest counts = minted vs already-present, plus the write delta. **Evidence justifies the entity, never
the reverse** — an asset entity with nothing attached is noise in every count, search and merge
candidate. Mint via `lcc_mint_gov_asset_entities()` (RPC, not JS: `entities.canonical_name` and
`external_identities.workspace_id` are both NOT NULL with no default, and canonical_name must come from
the SQL `lcc_normalize_entity_name` — a JS copy is the normaliser drift this file warns about
elsewhere; the RPC also keeps entity+identity in ONE transaction so a failure cannot orphan either).

**Live result 2026-08-19:** 663 minted at a $500k floor → 964 evidence rows → **612 resolved owners**
(2,725 → 3,337) with 51 held in `purchase_tier_no_org_marker` (municipal owners like `City and County
of Denver` and person-shaped names — the guard correctly abstaining). 663 = 612 + 51, zero stray.
Resolve rate does **not** degrade at lower rent (bands under $500k resolve at 100%, though on small
already-modelled samples). Reverse by `metadata->>'mint_batch'` — identities before entities.

---

## P131 — the dead research queues: draft-then-confirm (2026-08-26)

Two never-consumed research lanes (Dead-End playbook Class 2) were told to become
confirm-a-draft surfaces via the local model. **Both premises were refuted by measurement, and the
corrections are the durable lesson.** Capture paths already existed (P173 / P179), so this is purely
about what can honestly be drafted.

- **⚠️ BEFORE BUILDING AN LLM DRAFTER, CHECK WHETHER THE ANSWER IS ALREADY ON-BOX IN STRUCTURED FORM
  — AND WHETHER SOMEONE ALREADY BUILT THE LLM ONE.** `establish_ownership_history` (545 open / 0
  completions) reads "pull county deeds", so an LLM-over-deed-text drafter looks obviously right. Live:
  **544 of 545 properties already have `gov.ownership_history` rows and 453 yield a clean, dated,
  guard-passing chain (707 links)** via the P138 view `v_ownership_transitions_portfolio`. LCC never
  read it — the LCC gap is literally `owner_links <= 1` in `lcc_entity_portfolio_facts`, and the
  P138–P141 feeder only ever fed `is_latest_for_property` (the CURRENT owner), so the HISTORY was never
  populated. Two more facts made the LLM framing untenable: **`gov.deed_records` holds ZERO
  `legal_description` characters across 5,804 rows** (there is no prose to quote — only 876 rows even
  carry a grantor), and **W8 U3 already ships an Ollama proposer for this exact gap and is already ON**
  (32 cards, 27 decided, against **35 dropped `quote_not_verbatim`** ≈ 52% hallucinated citations).
  Result: the drafter is DETERMINISTIC and its citation is a RECORD REFERENCE (ownership_history row id
  + `data_source`), which cannot be hallucinated. `OWNERSHIP_CHAIN_DRAFT` (**on**) →
  `GET/POST /api/ownership-chain-draft-tick`; planner `api/_shared/ownership-chain-draft-planner.js`;
  drafts land in `lcc_clean_assist_proposals` (source `ownership_chain_draft`) and render on the card.
  **P133 — the lane is a RECURRING producer, so the hand-drain is paired with a sweep:** pg_cron
  `lcc-ownership-chain-draft` (jobid 239, **06:45 UTC**, `lcc_cron_post` → POST apply=true limit=100).
  06:45 was picked because it was the only free minute in the block (05:45, 06:20/25/30/35/40 and 06:50
  each already carry 1–4 jobs) **and** it lands after `generate-research-tasks` (06:35), which is what
  mints new lane rows — so a row minted tonight is drafted tonight. The cron is deliberately **NOT gated
  on the flag**: with the flag off the tick no-ops and the run log records the skip, whereas an
  unscheduled job is invisible. Observability is `lcc_ownership_chain_draft_run_log` /
  `v_lcc_ownership_chain_draft_run_health` on the P123 lifecycle — the row is **opened before the work**
  (`status='started'`) and closed on the way out, so a run that dies mid-flight leaves a stalled row
  (`v_lcc_ownership_chain_draft_stalled_runs`) instead of nothing. **Read `written_draftable`, never
  `already_drafted`** — the latter is a re-discovery tally that reads exactly like throughput while
  nothing moves (P159a), and on a correct quiet night it is the WHOLE population against 0 written.
  `capped`/`backlog_remaining` keep a batch-capped night from reading "done"; `lane_scan_capped` marks
  the backlog as a floor rather than a total.
  Honest counts: **453 draftable / 92 not** (74 `no_transitions_on_file`, 18 `all_transitions_guarded`).
  **A break in the chain is REPORTED ("Not on file"), never bridged** — an unrecorded intermediate owner
  is precisely the thing that must not be invented. Ollama survives only as an optional Layer 2 that
  LABELS a transfer type on links it may not add, remove, reorder, re-date or re-name
  (`OWNERSHIP_CHAIN_ROLE_LABELS`, off; a label whose rationale names a party absent from that link is
  dropped).
- **P140 — that Layer 2 is now GRADEABLE before the flip:
  `GET /api/ownership-chain-draft-tick?role_labels=1&generate=1`** (`&sample=N`, default 18, max 25).
  Ungated and write-free by design — gating the grade on the flag would make the layer ungradeable
  until after it shipped (the P138 analyst-take `?generate=1` precedent). It returns each link as
  drafted next to the proposed label, its rationale, and the **party-presence guard verdict**, so the
  DROP RATE is visible: a meaningful one is the guard working (W8 U3 dropped ~52% on this same gap and
  that rate WAS the finding), not the run failing. Full writeup:
  `docs/audits/P140_ROLE_LABEL_GRADE_DRYRUN_2026-08-26.md`. **The flag is still off** — the grade
  decides it. Three durable lessons:
  - **⚠️ THE OBVIOUS WIRING WOULD HAVE GRADED ZERO ROWS AND READ AS A CLEAN RUN.** The tick prepares
    from `fresh` = open ∧ **undrafted**, which is what the WRITE path needs. Measured 2026-08-26: all
    **545** open lane rows already carry a proposal (P131/P133 drained the lane in one pass, 15:50–16:02),
    so `fresh` is **0** and a grade reading `prepared` returns `sample_taken: 0` — indistinguishable
    from a clean grade. Layer 2 labels a chain that ALREADY EXISTS, so an already-drafted row is the
    IDEAL candidate; the grade prepares from the open lane and names its source
    (`candidate_source: 'open_lane_including_already_drafted'`). **A grading tool is not exempt from
    the failure-looks-like-success rule.**
  - **⚠️ A SAMPLE OFF THE VALUE-RANKED HEAD GRADES ONE SHAPE AND CALLS IT ACCURACY.** Measured over
    the 453 draftable chains: **173 priced / 133 single-link / 119 affiliate-name-overlap / 22
    nominal-price (≤$100) / 6 multi-link**. The last two — **26% and 5%** — are exactly the cases the
    grade exists to test (an SPE reshuffle must not read arms-length; a nominal deed must be flagged
    non-arm's-length). `pickGradeSample` round-robins across shape buckets, rarest-first, and is
    deterministic so two runs are comparable. **The shape classifier is SELECTION ONLY** — never
    identity, never a write — which is why `affiliateNameOverlap` may use the loose generic-token
    comparison banned for identity; and the buckets are named for what is OBSERVABLE
    (`nominal_price`, `priced_transfer`), never for the answer under test.
  - **ONE OWNER PER LABEL DECISION, AND IMMUTABILITY PROVEN NOT ASSERTED.** `evaluateRoleLabel` is the
    sole verdict; `applyRoleLabels` = evaluate+mutate, `gradeRoleLabels` = evaluate+report, and a test
    pins that they agree — otherwise the grade describes something other than what ships. Each sample
    fingerprints its chain, runs the REAL applier over a copy and re-fingerprints
    (`chains_altered_by_layer2` must be **0**). Read `providers` too: a sample rescued by the cloud
    fallback is not a grade of the on-box layer the flag turns on. And party-presence is evaluated for
    every resolvable index — including labels already dropped for another reason — or the guard's own
    rate is measured only on the labels that got past every other check.
- **⚠️ A QUEUE IS THE RESIDUE THE AUTOMATION ALREADY PICKED OVER — MEASURE THE QUEUE, NOT THE SOURCE.**
  `owner_contact_manual` (316 open / 0 completions) was to be drafted from SOS `manager_name` +
  signature blocks + notice address. At SOURCE that looks fine: gov has 1,482 owners with a manager, 966
  person-shaped. **In the queue: only 15 of 212 gov-linked owners have a manager distinct from the owner
  name.** Also 0/316 carry a notice address, 0/316 have a linked person, **1/316** has any
  `activity_events` (so no signature corpus), and every row's `tried` reads sos/address/web
  `unconfigured`. The pivot bench holds 202 candidates of which **173 (86%) are SELF-ECHOES** — the SOS
  registry naming the LLC as its own manager ("Browman Development Co." managing "Browman Development
  Co.") — wrongly stamped `is_named_individual` on 176 of 202; the remainder are OM-extraction row
  labels minted as contacts ("Capital Expenditures", "Debt Service", "Fund Name", "Toronto, ON M5K
  2A1"). **So no drafter was built for this lane — drafting there is fabrication, the P124 `else`-branch
  failure.** Shipped instead: `v_lcc_owner_contact_decidability` (**6 decidable / 310 blocked**: 186
  `bench_restates_owner_or_row_labels`, 123 `no_candidate_on_file`, 1 `public_body_not_prospected`) so
  the answerable few stop being buried (P181). The real blocker is external acquisition (SOS-direct,
  §25 bot-wall) — an operator gate, not a modelling gap.
- **⚠️ `lcc_owner_name_is_credible_person` IS NOT SUFFICIENT ON ITS OWN — verified on named rows.** It
  correctly accepts Bill Rothacker / Kyle Frances China / Adel B. Bareh and rejects "Fund Name" /
  "Capital Expenditures", but **accepts "Debt Service" and "Income & Expenses"** (two capitalised
  tokens, no org marker). The decidability gate therefore requires FOUR things together — distinct
  strict core, not an owner-name restatement, credible person, no org marker, not a document row label
  (`lcc_p131_is_document_row_label`, a narrow stoplist scoped to this gate, **not** a general name
  filter). **The obvious guard was again the destructive one:** excluding the OM-extraction source
  wholesale would have killed the row labels AND the real people it also carries — same shape as the
  P124 consumer-domain trap. `lcc_p131_candidate_restates_owner` blocks truncations ("Boyd Watterson"
  for "Boyd Watterson Global") while exempting joint-individual owners (P158a: `&` is a married couple,
  so "Adel B. Bareh" inside "Adel B & Gihan M Bareh" is a real extraction) and honorific-only
  differences ("Robert Robles" / "Robert Robles Md"). It has one **deliberate** false negative —
  "Trammell Crow" vs "Trammell Crow Co" reads decidable — because that is the single-member-LLC case
  `isOwnerNameRestated` deliberately allows: missing a phantom costs one rejectable row, blocking a real
  individual owner deletes a decision-maker.
- **Verify by the drain, not the tally.** The lane's own metric is `completed > 0` for the first time;
  the drafter's tally is not throughput. Note the two producers over this one gap (the W8 U3 decision
  lane and the research lane) drain independently — 27 U3 cards decided did NOT move
  `establish_ownership_history` off 0.

## A1 — one lane, FOUR jobs: split it before automating any of them (2026-08-27)

`establish_ownership_history` sat at **545 open / 0 completions for 68 days** while **545 of 545**
carried a finished, record-cited P131 draft. It was never short of answers — it presented four
structurally different jobs as one "go research this" queue, and an operator facing *confirm what
you already believe* mixed with *your ownership record is contradicted* mixed with *this cannot be
answered* learns to skip all of it. Split by `v_lcc_ownership_history_lane_split` (+ the chip
rollup `v_lcc_ownership_history_lane_actions`), migration `20260827090000`. Full writeup:
`docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`.

| action | tasks | owners | links | rent | consumer |
|---|---:|---:|---:|---:|---|
| `agrees` | 380 | 360 | 450 | $654.9M | A2 applies — a confirmation, not a question |
| `mismatch` | 73 | **45** | 120 | $401.2M | A3 routes — a data-integrity alert |
| `no_records` | 74 | 62 | 0 | $278.5M | A4 retires — unanswerable |
| `all_guarded` | 18 | 18 | 0 | $33.5M | A4b adjudicates — transfers EXIST, all guard-rejected |

- **⚠️ THE PROSE DETECTOR AGREES WITH THE BOOLEAN AND IS STILL WRONG TO BUILD ON.**
  `reason ilike '%does not match the current owner%'` and
  `(proposed_link->>'terminates_at_current_owner')::boolean is false` both return **73** with **0
  disagreements** — so a test comparing their OUTPUT passes over the broken implementation. It is
  wrong structurally: a text detector over prose the drafter generates (P182), and **blind to the
  74/18 split**, which exists only in `insufficient_reason`. **Guard the SHAPE, not the score** —
  `test/ownership-lane-split.test.mjs` asserts the classifier names the boolean fields and asserts
  it contains no `reason ilike`, and was mutation-verified red on each.
- **The SQL `action` CASE is the SINGLE owner.** `api/_shared/ownership-lane-split.js` carries the
  vocabulary and the query shape only; the card's badge is rendered from the action the SERVER
  supplied. A JS mirror of a SQL classifier is the normaliser drift this file warns about a dozen
  times (`lcc_normalize_entity_name`, the P134 re-derived GROUP BY that returned 150 members for a
  2-member group).
- **LEFT JOIN, and name the unclassified states.** A task the drafter has not reached is
  `split_state='awaiting_draft'`, NOT `no_records`. It is 0 today and a non-zero window is NORMAL —
  the seeder runs 06:35, the drafter 06:45. A payload yielding none of the four is
  `unrecognised_payload`, kept distinct so a new `insufficient_reason` surfaces instead of being
  absorbed into a bucket it does not belong to.
- **`human_actionable` is mismatch + all_guarded only — the badge reads 91, not 545.** And
  `v_lcc_research_lane_summary.human_actionable_tasks` is **NULL for every unsplit lane**: not 0,
  and not `open_tasks`. Claiming a lane is fully actionable because nobody measured it is the
  unearned-positive default (P124's `else` branch) wearing a badge.
- **⚠️ A FILTER IMPLEMENTED IN ONE BRANCH SILENTLY STOPS FILTERING IN THE OTHER.** `V2_MAP`
  (`ops.js`) rewrites `/api/queue?view=research` to the v2 handler the moment `queue_v2_enabled`
  flips. `lane_action` in v1 alone would have served the whole 545-row lane under a chip reading
  "mismatch 73", with no error. **Whenever you add a query param to a v1 queue view, add it to v2 in
  the same change** — and pin the call sites, because nothing errors when one goes missing.
- **⚠️ THE RESEARCH PAGE COULD ONLY EVER REACH 50 OF 545 ROWS, and no pager was drawn.**
  `renderResearchPage` sends `page`/`per_page`; v1's `paginationParams` reads only `limit`/`offset`,
  so every page returned the same first 50 — and the response carried no `pagination` block, so
  `paginationHTML` rendered nothing. Fixed here because a chip filtering to 73 that shows 50 with no
  "next" is the P139 "6 of 65" reach failure. Note `opsApi` keys pagination on
  `path.split('&')[0]`, which is exactly the key `paginationHTML` reads — returning the block was
  the whole fix. **Chips filter SERVER-side** for the same reason.
- **Value is per OWNER and the inflation is UNEVEN** — `mismatch` is 73 tasks over **45** owners
  (1.6×), `agrees` 380 over 360 (1.06×). One blended ratio for the lane would overstate A3's target
  by more than half.
- **⚠️ THE SPLIT IS NOT THE VERIFICATION.** This lane has still **never completed a task**, and a
  split alone cannot change that — A2/A3/A4/A4b are what move it. Verify on
  `research_tasks … status='completed'`, never on the view existing or the chips rendering.

## A2 — the lane's first completion, and four traps in getting there (2026-08-27)

`establish_ownership_history` **completed 0 → 288** (open 545 → 257) by applying A1's `agrees`
bucket: **304 historical facts into `lcc_entity_portfolio_facts`**, 280 owners, $579.9M.
Migration `20260827130000`, cron **244** (06:49, after the 05:10 seeder and the 06:45 drafter),
reversible by batch tag. Full writeup: `docs/audits/A2_OWNERSHIP_CHAIN_APPLY_2026-08-27.md`.
A3/A4/A4b are untouched and unchanged at 73 / 74 / 18.

- **⚠️ `on conflict do nothing` + A JOIN BACK TO THE PLAN = A COUNT THAT OVER-REPORTS, AND THE DRY
  RUN CANNOT SEE IT.** The first apply reported `facts_inserted: 365`; the table received **347**.
  The PK is `(entity_id, source_domain, source_property_id)` — one interval per party per property
  — and 14 (grantor, property) pairs carried two or three links, so 18 inserts were silently
  dropped while the ledger, fed from a join back to the plan, logged all 365. **Count from the
  INSERT's own `RETURNING` set, never from the ledger write that follows it**, and reconcile the
  ledger row count against the table before believing either. Same family as the documented "a send
  counter is NOT a write counter" — `intent` and `effect` differ precisely where a conflict clause
  is doing its job. And the rows that collided were not repeat ownership: all 14 were ONE conveyance
  recorded on several dates (`SENTINEL SQUARE I → WASHINGTON DC VI FGF` on 2020-02, 2020-03 AND
  2020-04), surviving P131's `(from, to, date)` dedup because the DATE differs. ⚠️ **This sentence
  used to call it "the `gsa_lease_diff` lessor flicker P138 documents" and that was WRONG — see A2b:
  the flicker has a RETURN LEG and this population has none.**
- **⚠️ AN EXACT-MATCH STOPLIST IS DEFEATED BY A DECORATED PLACEHOLDER.** The gate blocked
  `Previous Owner`; the gov feed also writes `Previous Owner Name`, `Previous Owner Name Unknown`
  and `Previous Owner LLC`, all of which had already been **minted as entities**, and all of which
  sailed through and took 13 portfolio facts with them. **Neither shared guard catches any of
  them** — `lcc_is_placeholder_owner_name` lists `current owner` but not `previous owner`, and the
  JS `isPlaceholderOwnerName` matches bare buyer/seller/escrow but not this. The fix is an ANCHORED
  PREFIX, not a `contains` (P158a: a contains rule swallows real firms), and the blast radius is
  measured before shipping — over all 62,356 live entities it matches **exactly 3 rows, all three
  placeholders, none holding a current portfolio fact**.
- **⚠️ `lcc_owner_strict_core` IS NOT THE UNIVERSAL IDENTITY COMPARATOR — IT WAS TRIED HERE AND
  REJECTED ON NAMED ROWS.** It drops tokens shorter than 2 characters and sorts the rest, so
  **`BAMMF (8) LLC == BAMMF (3) LLC == BAMMF (9) LLC == BAMMF (S) LLC`** (four different SPEs) and
  **`F R M ASSOCIATES, L L C == G B A Associates == J/4 Associates == M.O.B. I ASSOCIATES`** (core:
  `associates`). It matched **393 of 396** grantors against some entity — the implausibly clean
  number that is a bug signal, not a finding (P182). Where the parties are SPE- or initials-named,
  the right comparator is `lcc_ownership_chain_name_key` (lower() **then** strip non-alphanumerics,
  no token removal, no sorting — the same rule `chainNameKey` already used for chain continuity),
  unambiguous-only, resolved through `lcc_entity_survivor`. **The lesson generalises the P189 one:
  the hazard travels with the TECHNIQUE, so a comparator sanctioned for one gate must be re-graded
  on named rows for the next.**
- **⚠️ A PARTIAL APPLY FLIPS A SEED PREDICATE, AND THE RESIDUE THEN GOES INVISIBLE.** Writing ONE
  link of a chain takes `owner_links` to ≥2, which flips
  `v_ownership_chain_worklist.suggested_research_type` — and R60 Sweep A then closes the
  **still-open** task as `skipped / chain_gap_resolved_or_changed` at 05:10, because the worklist no
  longer suggests this type. Measured: **17 tasks partially applied, 19 of the 92 left open would
  have been swept the next morning**, and a skipped task leaves the open lane → leaves the split
  view → leaves the plan and the blocked worklist, so its remaining links are unapplied AND
  invisible forever. **Whenever a writer's output feeds the predicate that decides whether its own
  queue row survives, the unit of work is the whole row, not the individual write.** A2 is
  all-or-nothing per task (18 fewer facts; `partially_applied` and `would_be_swept` both 0 after),
  and its dry run counts the same write set so the grade describes what ships. Note the exemption
  that proves the rule: the current-owner start-date fill UPDATES an existing row rather than adding
  one, so it cannot move `owner_links` and is deliberately left ungated.
- **⚠️ `completed` IS NOT EXCLUDED BY THE SEEDER — THE FACT IS WHAT STOPS THE RE-MINT.**
  `lcc_generate_chain_research_tasks` (cron 144) skips a property only for an OPEN task or a
  TERMINAL skip, so completing a task changes nothing on its own. What closes the loop is that one
  historical fact takes `owner_links` to ≥2, which flips
  `v_ownership_chain_worklist.suggested_research_type` to `trace_ownership_to_developer`. Verified
  after the run: **0 of the 288 completed properties can be re-seeded into this lane**, 284 moved
  to that lane (which is LIVE — 40 lifetime completions). **The corollary is the completion rule: a
  task completed WITHOUT a fact would be re-seeded tomorrow**, so a task completes only when every
  link reached a terminal good disposition. 92 stay open, named.
- **Every fact carries a non-null `ownership_end_date`, and that is structural, not stylistic** —
  `is_current` is `GENERATED ALWAYS AS (ownership_end_date IS NULL)`, so a historical fact without
  one reads as a CURRENT owner on `lcc_owner_known_annual_rent`, the priority queue and the Tier 0
  lane. At a chain gap the START stays NULL (never bridged) and the party whose END is unknown is
  **not written at all** — writing NULL would claim they still own it.
- **A PRODUCER THAT MINTS AND ATTACHES TO NOTHING:** `/api/chain-connect-tick` (`r9_chain_connect`,
  cron 104, every 30 min) mints an entity per chain owner name and never writes a portfolio fact,
  so `owner_links` never grows, `chain_complete` stays false and the property is re-scanned forever.
  **291 of the 331 grantors A2 resolved are its output** — retirable by the gov feeder's own
  predicate ("a minted entity with no evidence and no portfolio fact has no consumer"). A2 is the
  missing consumer. Before building a resolver, check whether an existing producer already minted
  the parties and simply never attached them.
- **Read `facts_inserted` / `tasks_completed`** (`v_lcc_ownership_chain_apply_run_health`), never
  `links_already_present`. Residue is named, not lumped: `ambiguous_entity` 54 (LCC duplicate
  entities — **48** of the 92 open tasks are blocked by that ALONE and need only a P195-style
  merge, after which cron 244 applies them unaided), `repeat_transfer_unrepresentable` 28, `placeholder` 26, `no_entity` 20.
  ⚠️ **Re-measured 2026-08-27: `repeat_transfer_unrepresentable` is 14 tasks / 32 links and A2b
  resolved it in the drafter** — see the A2b section below, which also CORRECTS the mechanism the
  next bullet names.

## A2a — merging the duplicates that blocked the chains; the producer was NOT r9 (2026-08-27)

`establish_ownership_history` completed **288 → 314** (open 182 → 156, `agrees` 90 → 64) by merging
the entities behind A1/A2's `ambiguous_entity` block: **26 groups / 28 losers merged, 17 groups HELD
with reasons named, 30 facts written, 26 of them on an entity this pass created.** Migration
`20260827210000`; plan `v_lcc_a2a_ambiguity_merge_plan`, holds `v_lcc_a2a_ambiguity_hold_watch`,
ledger `lcc_a2a_merge_log`, reversal `lcc_a2a_unmerge(batch)`. **Not scheduled.** Writeup:
`docs/audits/A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md`.

- **⚠️ THE OBVIOUS PERSON GATE WOULD HAVE HELD SIX REAL COMPANIES.** `lcc_looks_like_person` is the
  natural thing to reach for when asking "is this name a human, so a shared name is not identity?"
  Over the 43 ambiguity names it returns TRUE for **`CANO FAMCO`, `Hokanson Companies`,
  `HORAK DEVELOPMENT IV, L.P.`, `Matan Companies`, `Precor Ruffin` and `USAA Real Estate`** — six
  organisations, one of them the $62M group. It is the documented two-capitalised-tokens false
  positive (A3, P196), and using it here would have read as *more* careful while deleting the
  batch's largest win. The gate reads the **recorded `entity_type`** instead: what LCC holds about
  the ROW, not a regex guess about the STRING. Generalises the A2/P189 lesson one step further —
  when a name-based guard is available, ask first whether a recorded FACT answers the same question.
- **⚠️ A DUPLICATE ENTITY CAN MASK A SECOND DEFECT, AND MERGING IT IS WHAT MAKES THAT ONE VISIBLE.**
  28 tasks were predicted to drain; **26 did**. The two that did not moved from `ambiguous_entity` to
  `repeat_transfer_unrepresentable` (`ROSSLYN CENTER ASSOCIATES L.P.` gov 14293;
  `Gate Properties LP`/`GATE PROPERTIES LP` gov 3891). A2 blocks when one `(grantor_entity, property)`
  pair carries links on two dates — and **while the two case-spellings were two entities, each pair
  carried exactly one link.** Both are the per-lease fan-out A2b measured (NOT the P138 flicker, as
  this line used to say), which is *why* they produced two entities. Expect a repair to move rows
  between blocked reasons, not only out of them, and count the destinations.
- **⚠️ `auto_mergeable` MOVING IS NOT AUTOMATICALLY A SIDE EFFECT.** P195 held it at 3,053; A2a took
  it to **3,041**, and the −12 is the point: verified **0** auto-mergeable groups still contain any
  A2a winner or loser, so those 12 left the candidate set because they were resolved. Check *which*
  groups moved before treating a delta on a guarded counter as a regression.
- **⚠️ THE PRODUCER IS `entities.canonical_name` HAVING MORE THAN ONE AUTHOR — `r9_chain_connect` WAS
  MEASURED AND REFUTED.** The obvious suspect mints a prior-owner entity per chain name (cron 104,
  5,207 live, 4,943 unattached). But `ensureEntityLink`'s `normalizeCanonicalName` lowercases **and**
  strips punctuation, so it is strictly looser than `lcc_ownership_chain_name_key` on the axis these
  duplicates differ on — it *cannot* mint a case-variant of a name it can already see. Creation order
  agrees: of the 48 duplicating entities only **12 are r9**, and r9 is the FIRST entity in 18 of 43
  groups. The real mechanism is that **`canonical_name` — the dedup key itself — is written by more
  than one normalizer**: `"671 Poplar LLC"` is stored as both `671 poplar llc` and `671 poplar`,
  `"BALTARA ENTERPRISES, L.P."` as both `baltara enterprises, l.p.` and `baltara enterprises l p`. A
  producer looking up its own normalization misses the row and mints. **Fleetwide 2,037
  byte-identical-name groups / 4,156 live entities carry disagreeing `canonical_name`.** This is the
  normaliser drift this file warns about, sitting *inside the dedup key*. Backlog **N15b** (decide the
  one normalization) and **N16** (retire r9's unattached output) — N16 is downstream, not a substitute.
- **Value is per OWNER, and this population inflates on two axes.** 48 tasks / 52 links / 43 groups /
  **44 owners**; per-owner **$72.0M**, per-task $76.7M, per-link $83.2M. A2's `$210.6M` matched none
  of them and is corrected in that writeup.
- **Held is a decision, not residue:** 10 `name_variant_beyond_case` (9 differ only by punctuation
  inside the legal form and carry no corroborating evidence; the tenth, `Mr Champa LLC` vs
  `M.R. Champa, LLC`, is genuinely undecidable) and 7 `person_typed_member`. Two guards fired on
  **nothing** (`lcc_p195_name_has_distinctive_residue` 43/43 pass, placeholder/brokerage 0/43) and are
  reported as measured rather than dropped — P195 measured the residue gate holding 4 groups on its
  own population, so it discriminates; this one carries no pure-generic names.
- **No third merge driver.** Every write is `lcc_merge_entity`, every reversal `lcc_unmerge_entity`;
  A2a adds a plan and a batch ledger only. Round trip proven on **this** population before the batch —
  `USAA Real Estate`, the only group where the destructive pivot dedup-DELETE fires: 153 rows before,
  153 after, **0 lost / 0 new / 0 changed**, self-loop-deleted edge and folded pivot bench both back
  byte-identical. Guard: `test/a2a-ambiguity-merge.test.mjs` (13 tests, mutation-verified red on 14).

## A2b — one conveyance recorded on several dates; the mechanism was NOT the flicker (2026-08-27)

`repeat_transfer_unrepresentable` **14 tasks / 14 properties / 32 links → 15**, 18 folded away,
12 distinct owners, **$26.2M** (per OWNER — the per-link sum reads $88.5M, a 3.4× overstatement).
Fixed in the DRAFTER (`buildChainDraft` → `collapseRepeatedConveyances`), **never the applier**: the
PK — one interval per party per property — is right, the INPUT was wrong. **No migration, no new
cron.** Writeup: `docs/audits/A2b_REPEAT_CONVEYANCE_COLLAPSE_2026-08-27.md`.

- **⚠️ A SHARED PRODUCER NAME IS NOT A SHARED MECHANISM — A1, A2 and this file all called this
  population "the P138 `gsa_lease_diff` flicker" and it is not.** P138's flicker oscillates between
  an SPE and its parent: it emits **both** `A→B` and `B→A`, which is exactly what
  `is_oscillating_pair` catches. **This population has no return leg** (and A4 measured zero
  oscillating pairs here). It is *one conveyance observed more than once*, two ways: **per-lease
  fan-out** — a GSA building carries many leases and the lessor of record updates on each
  separately, so the diff emits an acquisition per lease (**one distinct `lease_number` per date,
  13 of 13** testable properties; property 3123 is 8 rows across 8 leases over 2020-02..04) — and
  **cross-source lag** (property 3891: `costar_sidebar` has the sale at 2014-07, `gsa_lease_diff`
  the paperwork at 2015-05). **The correction is load-bearing:** if it were the flicker the
  DIRECTION would be untrustworthy and collapsing would be unsafe; it is not, so the only thing
  wrong is that one fact is stored several times.
- **⚠️ THE DATE RULE IS EARLIEST, AND A2's OWN COMMENT SAYING OTHERWISE IS SUPERSEDED BY
  MEASUREMENT.** A2 wrote *"Picking the earliest date would be a guess about which record is real…
  Never guess"* — right without the measurement, wrong with it. Two reasons: **structural**, the
  link's `transfer_date` becomes the GRANTOR's `ownership_end_date`, so a later observation can only
  ever OVERSTATE a tenure (by up to **700 days** here); and **empirical**, over every party pair gov
  holds from BOTH `costar_sidebar` and `gsa_lease_diff` the recorded sale is earlier **26 of 26**,
  0 same-day, **0 later**, mean lag **161 days**. Choosing "latest" would discard the actual sale
  date in favour of lease administration. The applied migration's text is left as the historical
  record.
- **The later dates are NOT wrong data, so nothing is deleted.** Every folded row's `ownership_id`,
  `data_source` and date ride the survivor's `citation.also_recorded_as` — **48 of 48 guarded-clean
  source rows traceable** from the drafts. That required closing a pre-existing gap: P131's
  `(from, to, date)` dedup **silently discarded** the `ownership_id` of a byte-identical same-date
  twin (3123 has three on 2020-03-01 alone); without that fix the claim would have been 33 of 48.
  A price seen only on a later observation is carried and **cited** (`price_from_ownership_id`).
  `gov.ownership_history` is untouched.
- **⚠️ THE SAFETY PROPERTY IS IN THE KEY: it includes the GRANTEE.** A grantor that sold to B and
  later to C is genuine repeat ownership — two distinct keys, no collapse, still blocked for a
  human, which is right because one interval per party cannot represent that either. Verified: all
  14 blocked pairs carry exactly ONE grantee name-key.
- **Collapsing also removes a PHANTOM chain break.** `A→B, A→B` reads as a gap, because link[1]'s
  `from` is not link[0]'s `to`. The chain was never broken; **all 14 now report
  `contiguous: true`**, so the drafts stop claiming a missing intermediate owner that never existed.
  Property 3290 correctly keeps TWO links (`WASHINGTON DESIGN CENTER → MUSEUM OF THE BIBLE` 2013-02,
  then `→ WOC LLC` 2016-11) — not over-collapsed.
- **⚠️ THE PRODUCER IS LIVE, AND READING ONLY THE DORMANT HALF GIVES THE WRONG ANSWER.**
  `gsa_lease_diff` is dormant (newest row **2026-03-27**, **0 in 90 days**) — the obvious check says
  "one-shot is fine". But the population is still GROWING: **323 repeat pairs fleet-wide (91
  cross-source), 58 completed in 90 days, 9 in 30, most recent 2026-08-24**, because live
  `costar_sidebar` (271 rows/30d) lands a SECOND observation of a pair the lease-diff already
  recorded. A one-shot would be a chore repeated silently forever (P176 / Class 8). **Ask what
  completes a repeat pair, not just which producer is still writing.**
- **But it needs NO NEW CRON — because the fix is in the drafter.** Every draft from now on is
  collapsed at birth; the only residue is tasks already carrying a pre-A2b draft, since `fresh`
  excludes anything already proposed (the A4b stale-draft trap). So the sweep is
  `runA2bRedraftPass` inside the drafter's existing 06:45 run, **keyed on STATE** (*this task is
  blocked as `repeat_transfer_unrepresentable` and the drafter now collapses it*), which self-clears
  and equally catches a pair whose second observation lands next month. It **re-runs the real
  planner** rather than trusting the blocked reason, so a failed gov fetch supersedes nothing.
  06:45 draft → 06:49 A2 apply.
- **Read `drafts_superseded` / `links_collapsed`, never `repeat_blocked_checked`** — the last is a
  re-discovery tally that reads exactly like throughput (P159a).
- Guard: `test/ownership-chain-repeat-collapse.test.mjs` (15 tests, **all mutation-verified RED**:
  latest-instead-of-earliest 5, grantor-only key 1, dropped evidence 2, collapse-after-continuity 4,
  dropped same-date twins 2). Source assertions anchor on stable identity tokens, never a line.

## A3 — the `mismatch` lane is a REPRESENTATION question; 74 chains → 12 decisions (2026-08-27)

The A1 `mismatch` bucket (*the last recorded grantee ≠ the owner we hold*) reads like a
data-integrity backlog. Measured, **32 of 74 chains are sponsor ↔ SPE** — the deed names the SPE
holding title, our field names the sponsor, **both correct** — and they collapse into **12
confirmations, one of which (Boyd Watterson) covers 20 chains.** Migration `20260827180000`;
writeup `docs/audits/A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md`. **Nothing writes; no
confirmation is seeded; `mismatch` is still 74 until Scott confirms.**

| class | chains | owners | decisions |
|---|---:|---:|---:|
| `sponsor_family_candidate` | 32 | 12 | **12** |
| `unexplained` (the real integrity lane) | 31 | 27 | — |
| `name_variant` | 11 | 10 | — |

**⚠️ Re-measure the POPULATION, not just the blocker.** The brief said 73; A2 landed in between
and it is **74 / 46 owners / $403.0M**. And **per-class rent double-counts** — three owners span
two classes, so the class sums ($612.6M) exceed the distinct total ($403.0M).

- **⚠️ THE PRESCRIBED KEY WAS MEASURED AND REJECTED. A BARE SPONSOR TOKEN IS NOT BOUNDED.**
  The brief said reuse `lcc_owner_sponsor_domain`, keyed on `sponsor_token`. Live entities
  carrying each proposed token as a standalone word: **`east` 226, `boyd` 129**, `fgf`/`madison`
  67, `arc` 46 — including surnames (`Boyd Alexander`) and addresses (`100 East PropCo LLC`). In
  that table a wrong token merely fails to join to a person; here it would assert a false
  **ownership** fact. Worse, its PK cannot express two cases already in the data: **`madison` is
  proposed by two owner entities**, and **`egp` names both Easterly Government Properties and
  EastGroup Properties** (`EGP 116 Suffolk` vs `EGP 85 Charleston`). So the confirm registry
  `lcc_ownership_sponsor_family` is keyed **(sponsor entity, token)**, resolved through
  `lcc_entity_survivor`. **This is NOT the second-registry drift** — the *detector* is shared
  (see the next bullet); the two tables answer different questions at different scopes.
- **⚠️ A CONTACT CONFIRM DOES NOT SETTLE AN OWNERSHIP FACT (P188, restated).** Letting the 8
  existing `lcc_owner_sponsor_domain` rows resolve chains for free was tested: **0 of 74**, so it
  buys nothing — and it would let a gate that reads ~4-of-6 on named rows decide ownership. It
  rides the card as `also_confirmed_for_contacts`; **nothing inherits.**
- **⚠️ THE P196 SPE-MARKER GUARD DROPS 24 OF 27 GENUINE ROWS ON THIS POPULATION.**
  `lcc_tier0_sponsor_brand_token(grantee, owner)` returns non-null for **3 of 74**: a government
  SPE is named for its city and agency (`BOYD SACRAMENTO GSA, LLC`), not "Propco". A3 does not
  apply that arm and does **not** weaken the predicate — instead the P196 guards are **extracted
  into `lcc_name_reads_as_street` / `lcc_name_has_spe_marker` and P196 re-issued to CALL them**
  (0 of 696 Tier 0 rows change), so both gates share one copy of each regex. **A guard calibrated
  on one population must be re-graded, not inherited** — the same lesson as A2's `strict_core`.
- **The other three guards ARE applied and their cost is MEASURED:** street fires 3× and changes
  **0** outcomes; brokerage 0; **person costs exactly 2 real false negatives** — `City of Oakland`
  ← `PORT DEPARTMENT OF THE CITY OF OAKLAND` and `Glenn Olds …` ← `U-Land, Glenn Olds, LLC`, both
  `lcc_looks_like_person` **false positives** (a pre-existing defect, named not patched). Kept per
  P196's trade: a false negative costs one card, a false positive asserts a stranger's firm over
  an SPE family.
- **⚠️ NOT P187's REJECTED ACRONYM ARM.** P187 *inferred* a fact from ONE name (~30–40%, because
  27.6% of owner names are all-caps). A3 requires the token on **both sides of a deed for the same
  property** — one grantee per chain, and **32 of 32 read genuine on named rows.**
- **`sponsor_spe` is a FIFTH action, deliberately not `agrees`.** Folding it into `agrees` would
  hand it to A2's apply path (cron 244), which **writes** portfolio facts — a materially bigger
  decision nobody has graded. `agrees`/`no_records`/`all_guarded` must not move; the positive
  control proves they don't (74→54 mismatch, 0→20 sponsor_spe, 92→72 human_actionable, other three
  unchanged, rolled back with 0 residue).
- **`name_variant` (11) stays HUMAN-ACTIONABLE.** It rides `lcc_owner_strict_core`, which A2
  measured and rejected for WRITES on this exact population (`BAMMF (8) LLC == BAMMF (3) LLC`).
  Labelling is safe; retiring 11 cards on it is an automated name judgement nobody asked for.
- **Stated gaps:** `lcc_is_spe_shell_name` detects **4 of 31** residue grantees (the documented
  place-named-SPE hole — `Lorton GSA LLC`, `BELTSVILLE GSA FDA, LLC`); **confirming `boyd`
  resolves 20 of Boyd's 24**, the other four carrying no Boyd token; and **two of those four
  carry the `fgf` token** while `FGF Management LLC` is a separate owner also proposing `fgf` —
  a Boyd/FGF JV or an attribution question, surfaced not folded.
- **Verify on the decisions, not the chains.** `select action, count(*) from
  v_lcc_ownership_history_lane_split group by 1` — `mismatch` falls by the confirmed sponsors'
  chain count; the other three actions must not move. The residue (31 chains / 27 owners /
  $344.6M, split `no_shared_brand_token` 25 / `grantee_reads_as_street` 3 /
  `owner_reads_as_person` 3) is **sized, not surfaced** — building its lane is a separate call.

## P138 / R8 Stage 1 — the brief's "Analyst's Take", generated ON-BOX (2026-08-26)

The daily brief has rendered a `renderAnalystTake` section since v2 and the column has
been EMPTY since **2026-07-07** (11 of 67 `briefing_intel_snapshot` rows ever carried a
take). Generation now happens on the GaryBuilt box via `invokeOnPremGeneration`, behind
**`BRIEFING_ANALYST_TAKE_ONPREM`** — ⚠️ **re-measured 2026-08-26: the flag now reads `on` in
`feature_flags_registry`, and today's `briefing_intel_snapshot` carries a 774-char take with
`analyst_take_meta.source = 'onprem_ollama'` (every prior day is length 0). The "off / awaiting
the gate" wording below was true when written and is now stale** — tick
`GET/POST /api/briefing-analyst-take-tick`, planner
`api/_shared/briefing-analyst-take.js`, cron **240** (`18 10 * * 1-5`, between the 10:00
snapshot and the 12:30 send). Full writeup:
`docs/architecture/briefing-analyst-take-onprem.md`.

- **⚠️ THE STATED BLOCKER WAS WRONG AND THE REAL ONE IS BILLING.** The prompt said the
  edge fn is "gated on `ANTHROPIC_API_KEY`; when unset it warns *ANTHROPIC_API_KEY not
  set*". Live, the key IS set and every row since 2026-07-08 carries
  *"Anthropic API 400: … Your credit balance is too low"*. **`capital_markets` is empty
  for the same reason and is NOT fixed by this build** — do not read a working Analyst's
  Take as evidence the cloud path recovered. (The dated-blocker doctrine, hit again.)
- **⚠️ "REUSE THE EXISTING FETCHER" CAN MEAN "RE-FIRE ITS SIDE EFFECT."**
  `buildStrategicPriorities` is the obvious thing for a briefing tick to call, and under
  `TEAMS_COLD_ALERTS_ENABLED` it POSTS up to three outbound *"Warm Contact Going Cold"*
  Teams alerts (plus one `rpc/get_contact_recommendation_weight` per candidate). A 10:18
  cron calling it would DOUBLE-SEND those to Scott — once from the tick, once when the
  brief renders at 12:30. The tick reuses the shared SCORER (`scoreItem`/
  `deriveItemTitle`) and re-applies the selection rule purely in `rankTodayPriorities`.
  **Before reusing a "read" helper from a scheduled job, grep it for writes and outbound
  posts** — a fetcher named `build*`/`fetch*` is not proof it only reads.
- **⚠️ A HARD-CODED 0 IS THE P180 TRAP WEARING A DIFFERENT HAT.**
  `fetchPipelineRollup` returns `total_value: 0` / `weighted_value: 0` **by construction**
  (the SF `Amount`/`Probability` fields are not in the projection it reads). Handing those
  to a narrator yields "your $0 pipeline" — *worthless*, not *unvalued*. The signal block
  states `not on file` and instructs the model not to state a figure; a test asserts `$0`
  never appears in it.
- **⚠️ THE FABRICATION GUARD FOR PROSE-ABOUT-COUNTS NEEDS A STRICTER NUMBER REGEX THAN
  THE ONE FOR PROSE-ABOUT-PRICES.** `draft-assist-core.js::NUM_TOKEN` requires **3+
  digits** for a bare number (`\d[\d,]{2,}`) — correct there, wrong here. In a brief the
  dangerous fabrication is a small COUNT: *"you have 9 overdue actions"* when the truth is
  7 reads perfectly and is a lie. `validateAnalystTake` matches ANY digit run, and an
  ungrounded number or date **rejects the whole take** (one retry naming the tokens, then
  nothing is written) rather than substituting `[Not on file]` into prose. Proper names
  are REPORTED, never fatal — that regex over-fires on ordinary capitalised text and
  killing a take on a false positive is the P158a mistake.
- **ONE OWNER PER COLUMN, ENFORCED ON BOTH SIDES.** The tick PATCHes only
  `analyst_take` + `analyst_take_meta` scoped to `(as_of_date, workspace_id is null)` —
  it can never touch `market_data`/`sector_news`/`capital_markets` nor mint a duplicate
  row (upsert only when today's row is absent, carrying just those keys; PostgREST derives
  the ON CONFLICT UPDATE list from the payload KEYS, so omitted columns are preserved).
  And the edge fn now does `if (row.analyst_take == null) delete row.analyst_take;` —
  without it a manual re-fire after 10:18 upserts NULL over the on-box take and the brief
  goes silently empty again. **That edge-fn change was committed and NOT deployed when this was
  written; as of 2026-08-26 the `briefing-intel-snapshot` fn is at v21 with an `updated_at` of the
  same day, which is consistent with the deploy having been run — CONFIRM the deployed source
  carries the `delete row.analyst_take` line before any manual snapshot re-fire** (a re-fire without
  it upserts NULL over the on-box take). Tracked as backlog **V4**.
- **`flag_off` deliberately raises NO health alert**, while `model_unavailable` /
  `fabrication_rejected` / `write_failed` each open a deduped
  `lcc_health_alerts(alert_kind='briefing_analyst_take_empty')` that a successful write
  auto-resolves. An off flag is a state someone CHOSE and is already surfaced by
  `feature_flags_registry` + Dormant Capabilities; an alert describing a decision sits
  open forever, which is the badge-that-is-noise failure.
- **Verify on `length(analyst_take) > 0` AND `analyst_take_meta->>'source' = 'onprem_ollama'`,
  then READ IT — never on "the tick ran."** ✅ **Measured 2026-08-26: 774 chars,
  `source = 'onprem_ollama'` — the first live on-box take has landed.** (The sandbox has no
  `OLLAMA_URL`, so all 30 tests stub the model; grade real output via `GET …?generate=1`, which is
  ungated and never writes.)

## P134 — an LLM assist is only as good as the CONTEXT payload (2026-08-26)

`OLLAMA_CLEAN_ASSIST` was flipped on for an inert 12-item sample and graded: **6 of 12 proposals were
`uncertain @ 0.00` whose reason was a variant of "the context lacks detail."** The model was not
failing — the safety doctrine held perfectly, it abstained instead of fabricating. It was handed
`context: item.context || {}`, which for a federated lane row is **IDENTIFIERS, not evidence**
(a representative property id, a provenance id, two entity uuids). Shipping that would have filled
the Decision Center with content-free cards, which is the Consumption-Layer noise failure.

- **⚠️ THE MISSING EVIDENCE WAS PARTLY ALREADY ON THE VIEW AND JUST NEVER SELECTED.**
  `v_field_provenance_conflict_classified` has carried `attempted_priority`, `attempted_confidence`,
  `decision_reason` and `current_recorded_at` all along; `api/admin.js`'s select asked for none of
  them. Before building a new enrichment source, **diff the view's columns against the handler's
  `select=`** — the cheapest fix is usually there. What genuinely had to be joined was the CURRENT
  source's rung on `field_source_priority` (measured: **resolves for 454/454 cross-source conflicts**),
  because "which source should win" is unanswerable without both rungs. The gate now hands the model
  a precomputed `ladder_says` plus the ladder itself, with the rule stated (**LOWER priority number =
  HIGHER trust**).
- **⚠️ NEVER RE-DERIVE A VIEW'S GROUPING OUTSIDE THE VIEW — measured wrong on 3 of 7 live rows.**
  `v_property_merge_lane` emits one row per duplicate GROUP, so the assist needs the members. Re-fetching
  them by `(state, whitespace-collapsed address)` — a faithful-looking mirror of the view's `GROUP BY` —
  returned **150 gov properties for a group the view says has 2**, because the view *also* excludes
  `status='archived'`. Same class as the JS-copy-of-a-SQL-normaliser footgun elsewhere in this file. Fix
  was to APPEND `member_property_ids` to the lane view on both domains (migrations
  `supabase/migrations/{government,dialysis}/20260907120000_*_p134_merge_lane_member_ids.sql`, applied
  live, append-only per the `CREATE OR REPLACE VIEW` column rule) and read it.
- **AN ITEM WITH NO COMPARATIVE EVIDENCE IS NOT SENT TO THE MODEL.** `assessCleanAssistEvidence`
  (`api/_shared/clean-assist-context.js`, pure) is the per-lane gate; a failing item is counted
  `skipped_no_evidence` with a NAMED reason (`conflict_values_missing`,
  `sf_link_account_name_unresolved`, `property_merge_members_unresolved`, `intake_no_address_or_tenant`,
  …) instead of paying an Ollama call to hear "insufficient evidence". Live gate pass rates:
  provenance 444/454, sf_link 3,369/3,369 (every row has both names), intake 801/942.
- **⚠️ A DECISIVE VERDICT AT ~0 CONFIDENCE IS INCOHERENT AND MUST NOT RANK AS DECISIVE.** The sample's
  one `merge` (Realty Income) came back at `confidence 0.00`, and the lanes sort easy-first ON
  confidence — so it would have ranked as a confident call carrying none.
  `normalizeCleanAssistProposal` downgrades any decisive verdict below `DECISIVE_MIN_CONFIDENCE` to
  `uncertain` and **says so in the reason** (the model's own reason is preserved after it), so a graded
  sample shows the guard firing rather than hiding it. `research`/`uncertain` at 0 are honest
  non-answers and are left alone.
- **The two name signals are labelled and never merged.** `strictOwnerCore` is the identity signal;
  `dup-pair-planner.ownerCore`/`nameSimilarity` is the FUZZY PAIRING signal (it reduces
  "Realty Income Corporation" to the empty string and scores "Agree Realty Corp"/"Agree Holdings LLC"
  at 1.0). Both ride the payload under distinct keys so the model cannot read one as the other.
  An upstream seeder's own proposal rides as `unverified_upstream_proposal` — the w8_u2 generator
  emits things like *"the abbreviation 'tk' matches the initials of 'Terry Kessler'"*, which is exactly
  the initials-only reasoning this lane must reject, so it is a claim to check, never a fact to inherit.
- **Still OFF.** The flag stays off until a fresh 12–20 item sample grades clean (most proposals quoting
  actual evidence, `uncertain` only on genuine ties). Cron 200 (`22 * * * *`) already exists and no-ops
  while off. Enrichment is read-only GETs; proposals remain human-confirmed and never auto-write.

## P137 — the provenance lane punted because the ITEMS NEVER ARRIVED (2026-08-26)

All 4 `provenance_conflict` proposals in the P134 re-grade punted with *"the evidence does not
specify which source is more authoritative"*. Two independent defects, and **the second is the one
that actually produced the symptom** — the first would not have changed a single proposal on its own.

- **⚠️ A CONSUMER WIRED TO A PRODUCER THAT DOES NOT EXIST FAILS EXACTLY LIKE A CONSUMER BUG.**
  `clean-assist-context.js::assessProvenanceConflict` computes
  `ladder_says = laddersSay(c.attempted_priority, c.current_priority)` and reads `c.priority_ladder`.
  P134's writeup said the current-source rung "resolves 454/454" — but that join was **never wired
  into the data path**: `v_field_provenance_conflict_classified` joins `field_source_priority` on the
  ATTEMPTED source only and carried **neither `current_priority` nor `priority_ladder`**, so
  `laddersSay(ap, undefined)` always returned `unregistered_source_no_ladder_answer` and the model
  correctly refused to guess. Fixed by APPENDING both columns to the view (migration
  `20260826231000`, append-only per the `CREATE OR REPLACE VIEW` rule) and selecting them in
  `api/admin.js`. Measured live: **454/454 cross-source rows resolve a `current_priority`, 433 are
  ladder-decidable, 21 are genuine equal-priority ties** (e.g. `costar_sidebar`@45 vs
  `om_extraction`@45 on `dia.properties.parcel_number`) that must keep abstaining. Both verdict
  directions occur, so a lane that only ever says `keep_current` is echoing a default, not reading
  the ladder. `field_source_priority` is UNIQUE on `(target_table, field_name, source)`, so the
  LEFT JOIN cannot fan rows out — verified: view row count unchanged at 1,162.
- **⚠️ AND THE ITEMS THAT PUNTED WERE NOT THE ONES BEING FIXED — READ THE SUBJECT_REFS BEFORE
  ACCEPTING A ROOT CAUSE.** All 4 were **`prov:dia_xref:*`** — the dia sales-price cross-reference
  arm, which has no ladder BY DESIGN (it is three unlabelled numbers plus a narration, not a
  `field_source_priority` question). **Zero `field_provenance` conflicts have ever reached the
  model.** Cause: `fetchFederatedSource` ranks xref items `1000 + severity` and every live severity
  is **1** → 1001, while `_provImportance` maxes at **1000** — so all 65 xref rows outrank all 454
  field_provenance rows, permanently. Two incomparable rank scales sharing one budget, decided by a
  hard-coded constant one point above the other scale's ceiling.
- **⚠️ AND THE TICK HAD NO CURSOR, SO THAT HEAD JAMMED FOREVER.**
  `handleOllamaCleanAssistTick` asked each lane for exactly `perType` items at **offset 0** and took
  them verbatim. An annotation writes to `lcc_clean_assist_proposals`, **not `lcc_decisions`**, so
  `fetchExcludedRefs` never excludes an annotated subject and it stays at the head — the tick re-read
  the same 4 cards every run, forever. Same class as P135/P136: *what makes a target stop being
  selected?* Here the durable marker already existed — `lcc_clean_assist_proposals` is UNIQUE on
  `(decision_type, subject_ref, proposal_kind, source)` and `listFederatedLane` already attaches it as
  `item.clean_assist` — the selector simply never read it. The tick now over-fetches a window (capped
  at **100**, because `attachCleanAssistProposals` resolves at most 100 refs — beyond that an
  annotated item reads as un-annotated and the head jams again), drops subjects **this source**
  already annotated (`clean_assist.source === CLEAN_ASSIST_SOURCE`, so another producer's annotation
  cannot starve it), and reports `lane_cursor` per lane. **Read `taken`, never `already_annotated`** —
  the latter is a re-discovery tally that reads exactly like throughput (P159a); `window_exhausted`
  distinguishes "nothing left to annotate" from "lane is empty".
- **~~The 65-row xref backlog still sits ahead of every field_provenance row.~~ FIXED IN P139
  (below) — the note above was correct when written; the rank scales HAVE now been collapsed.**
  P137 deliberately left them alone because `rank_value` also orders the human Decision Center lane;
  P139 is that deliberate follow-up decision.
- Guard: `test/provenance-conflict-ladder-wiring.test.mjs` asserts the handler's `select=` carries
  every column the evidence gate reads, anchored on the **VIEW NAME** rather than a line number or a
  source slice (per the block-slice footgun). Verified to go RED on the exact pre-fix select and green
  after. The recurring lesson it encodes is P134's own: **diff the view's columns against the
  handler's `select=`** — and, now, **diff the consumer's reads against what any producer actually
  writes**.

## P139 — two incomparable rank scales sharing one budget (2026-08-26)

P137's ladder work (433 of 454 cross-source conflicts ladder-decidable) was invisible on every
surface, and the cause was ORDERING, not wiring. The `provenance_conflict` lane carries two
structurally different sub-populations and ranked them on **two incomparable scales**:
`field_provenance` on `_provImportance` (ceiling **1000**), dia sales-price xref on
**`1000 + severity`**. Measured live: the dia view hard-codes `1::int AS severity` on that arm, so
`1000 + severity` is the **CONSTANT 1001** for all 65 rows — never a value expression, just an
offset one point above the other scale's ceiling. Every xref row outranked every field_provenance
row, permanently.

- **⚠️ A CONSTANT WEARING A VALUE EXPRESSION'S CLOTHES IS THE HARDEST KIND TO SEE.**
  `1000 + severity` reads as "rank by how bad it is". It is a hard-coded 1 on the producer side,
  6,000 lines away in a dia migration. Same family as the P159 note that "a value gate can be
  present in code and completely inert in the data" — **before trusting a rank term, go read what
  the producer actually puts in it.** The real value signal was on the row all along and unread:
  the disputed sale price spans **$780,915 – $22,750,000** (29×).
- **⚠️ RE-RANKING ALONE ONLY INVERTS WHICH POPULATION IS INVISIBLE.** Both surfaces that read this
  lane are BOUNDED WINDOWS — the human Decision Center fetches `limit=50` and **does not page**
  (`dc-lanes.js renderFederatedLane`), the assist tick takes `perType` (3–20). On the new single
  scale, **155** field_provenance rows score above the xref band (673–691) and 299 below, so strict
  rank order puts **50 of 50 shown cards on field_provenance and drops xref off the operator's
  surface entirely** — the exact mirror of the bug. A homogeneous sub-population plus a bounded
  window means rank decides ORDER but never decides REACH.
- **The fix is therefore two halves, and each fails silently alone:** (1) one comparable 0–1000
  band — *what is in dispute* (money 600 / identity 250 / other 80) + *can it be answered*
  (+300 when the registered ladder decides it, read from the SHARED `CA.laddersSay` so the order
  the operator sees and the answer the model gets cannot drift) + a 0–99 log-scaled magnitude
  tiebreak; and (2) an **explicit interleave key** (`interleaveByKind`, `api/admin.js`) that merges
  the sub-populations on a position key instead of concatenating them. Element *i* of a bucket of
  size *m* in a list of *T* claims position `(i + 0.5) · T/m`.
- **Two fairness modes, because the two windows are different sizes.** `'proportional'` for the
  human lane (share tracks population, so the 50-card window renders **44 field_provenance + 6
  xref**, first xref at position 4, highest-value card still #1); `'equal'` round-robin for the
  assist tick, because at `perType = 3` proportional rounds the smaller population to **zero** and
  it would take ~39 runs to reach the first xref card. A single-kind lane is returned UNCHANGED in
  both modes, so this can only ever affect a genuinely mixed lane.
- **The magnitude tiebreak is a strict SUB-band term.** Every band gap (350, 170) and the
  decidability bonus (300) exceed its 99 ceiling, so a year (`year_built` 1985) or a parcel number
  can never out-rank its own band. `provRankBandsAreSeparable()` asserts that invariant rather than
  leaving it to the constants staying in the right order.
- **A ranked-but-behind population needs a FILTER, not a re-rank (P179 Class 2).** The lane now
  returns `parts { field_provenance, sales_price_xref }` and `dc-lanes.js` renders the same seeder
  chips `owner_reconcile` already uses, so the smaller population is one click away wherever its
  top row lands. **The chip count was made honest in the same change** — the filter is CLIENT-side
  over the cards on the page while `parts` is the whole-lane universe, so a chip reading "65" that
  filters to 6 visible cards is the badge-that-lies failure; it now reads `6 of 65`.
- **Read `taken_by_kind`, never `taken`.** The tick's per-lane cursor now reports `fresh_by_kind` /
  `taken_by_kind`. A lane whose head is one kind and a lane that is genuinely interleaving produce
  the SAME `taken` — the same "looks like success" the cursor exists to prevent (P159a).
- Guard: `test/provenance-lane-interleave.test.mjs` (9 tests) exercises the exported pure functions
  directly and anchors its one source check on the `subject_ref` prefix literals (`prov:` /
  `prov:dia_xref:`) — stable identity tokens, never a line or a sliced region (block-slice footgun).
  It pins the inversion explicitly (*strict rank alone drops xref off the visible page*) so a future
  "simplification" back to plain rank order goes red with the reason attached. Verified RED on the
  pre-fix code and green after; full suite 4,527 pass / 0 fail.
- **NOT changed:** the 21 genuine equal-priority ties still abstain (that is the correct answer),
  the xref arm still earns no decidability bonus (it has no ladder by design), and no verdict path,
  auto-write, or field classification moved — only the order and the share.
## P188 — the Tier 0 confirm lane: EVIDENCE ATTESTS THE PERSON, NOT THE LINK (2026-08-26)

The Tier 0 bench (people we already hold whose email domain matches an owner's name — Boyd
Watterson, RMR incl. Adam Portnoy, Realty Income incl. Sumit Roy) now has a consumer:
the federated Decision Center lane **`tier0_owner_contact`**, source
`v_lcc_tier0_owner_contact_lane_open`, planner `api/_shared/tier0-confirm-planner.js`, reversible
via `lcc_tier0_confirm_log`. **Human verdicts only — never an unattended promoter.** Full writeup:
`docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md`.

- **⚠️ THE EVIDENCE ANSWERS A DIFFERENT QUESTION THAN THE ONE BEING ASKED, AND THAT MUST BE ON THE
  CARD.** Salesforce campaign membership, a Salesforce contact record, an Outlook entry and real
  correspondence all attest *"this person is real and known to us"*. **None of them attests
  *"this person works for THIS owner"*** — only the contact's stated `company_name` matching the
  OWNER does. Gary George at `georgesinc.com` (a poultry company) carries three of the four for
  **George Washington University**. So the lane counts `n_link_evidence` and `n_person_evidence`
  separately, and a card with zero link evidence says so in words. Same family as the P124
  `else`-branch bucket: a plausible green signal that was never earned by the thing being decided.
  - **The two company-name tests are DIFFERENT CLAIMS and were nearly one flag.** P186 §5 measured
    "company_name corroborates the token" as one signal (Gary George passes). Split and measured
    over 558 pairs: `company_confirms_employer` (company ↔ **email domain**) 164 — he passes;
    `company_matches_owner` (company ↔ **owner name**) 99 — he does not. Collapsing them is exactly
    how that row came back green.
  - **Containment alone was not enough** — "Easterly Partners" neither contains nor is contained by
    "Easterly Gov Properties", so the owner test needs a shared-8-char-opening arm. `georges` is 7
    chars and never reaches it. Verified on named rows, not on a rate.
- **⚠️ QUOTE A PRECISION FIGURE ONLY WITH THE RENT BAND IT WAS MEASURED IN — and "top 45 pairs" is
  a SHORTER reach than it sounds.** The 45th pair by rent sits at **$16.38M**, so P187's ~91%
  covers owners at roughly $16M and above — **10 cards / 7 owners / $521M**. From $16M down to $2M
  **nothing has ever been graded**; below $2M it is ~60–70%. `rentBand()` returns `precision: null`
  for the middle band rather than interpolating, and the lane is value-ranked so the operator meets
  the reliable end first.
- **ONE CARD PER (OWNER, DOMAIN), never per pair.** RMR is 19 people at `rmrgroup.com` = ONE
  judgement; asking it nineteen times is the badge-that-is-noise failure. 558 pairs → 283 cards →
  237 actionable / 171 owners / $695M. **And the domain split is load-bearing** — RMR also has
  `rob@rmrgroupinc.com`, a different firm domain and a different question; `subject_ref` is
  `t0:<owner_id>:<domain>` so rejecting one never closes the other.
- **The MATCH KEY is on the card** (`match_arm`/`match_key`, appended to
  `v_lcc_tier0_owner_contact_candidates`). For a lane whose job is *does this person work for THIS
  owner*, "matched on the token `george`" IS the evidence, and it turns a landmine into a
  one-second reject. The view knew it all along and threw it away.
- **The shape gate is three layers and the fourth name always gets through.** SQL applies the HOUSE
  guards (`lcc_is_rejected_contact_name`, `lcc_looks_like_person`) + broker `role_bucket`; JS adds
  `isPersonShaped`/`isJunkEntityName`/`isMisparseName`; the verdict path re-runs all of it. Over
  430 live bench names those catch `Equity Funds`, `Managing Partner`, `Public` — and **miss
  `Tenants In Common`, `Inco Commercial`, `Stephen Block Deceased`, `Authorized Signer`**, which a
  NARROW stoplist scoped to this gate (`isRoleOrFormLabelName`, the `lcc_p131_is_document_row_label`
  precedent) catches with a measured blast radius of exactly those 4 and 0 real people. It is NOT
  exported into the shared guards: there a false positive is destructive, here it costs one
  rejectable card. **A blocked candidate stays ON the card, flagged** — "1 excluded (broker role)"
  is the honest count.
- **`active_authority_level` = 5 ("captured"), never promoted from a job title.** That ladder means
  legal/control authority (1 signatory > 2 controlling > 3 economic > 4 agent > 5 captured);
  "President" in a CRM title field does not establish it. The role bucket goes in
  `active_contact_role`. `confidence='medium'` — a human confirmed the LINK, not the person's
  authority inside the firm.
- **The card is RE-READ from the view at verdict time, never trusted from the request** (a
  federated decision is minted from client-supplied context), and an attach naming a person not on
  the freshly rebuilt card is refused. Fill-blanks: an owner that gained a contact since the card
  rendered is superseded, never overwritten.
- **⚠️ VERIFY BY THE DRAIN — AND `v_owner_contact_enrich_queue` IS THE WRONG DRAIN HERE.** It is
  the obvious choice (it keys on `active_contact_entity_id IS NULL`) and it holds **6 rows in
  total**, of which **2** belong to this lane's 171 owners: P159/P182 exclude
  `enrichment_action IN ('manual_research','find_person_at_manager')` and owners with an open
  `owner_contact_manual` task, which is nearly the whole Tier 0 population (4,031 pivot rows carry
  no active contact; 6 are queue-eligible). Quoting it would report ~0 movement on a lane doing real
  work. The populations that DO move: the lane's own `_open` count (237), this lane's owners on
  **`v_lcc_owner_unreachable_worklist`** (**161 of 171, $642M**), and
  `v_lcc_owner_reachability.reachable_hero_qualified` (**299** today). **18 of the 171 owners
  already carry the edge** (Boyd Watterson's Eric Dowling and Joseph Capra are both
  `already_linked`) — for them the graph was never the gap, the pivot naming nobody was; their gain
  is the pivot write. A count of clicks is not throughput (P159a).

## P194 — the Tier 0 auto-attach sweep, and three traps it hit on the way (2026-08-26)

P192 classified the Tier 0 lane and left `decidability='auto'` (EXACT domain↔owner-core match, exactly
ONE eligible candidate) visible because no sweep wrote it. P194 is that sweep:
`api/_handlers/tier0-auto-attach-tick.js`, flag `TIER0_AUTO_ATTACH` (**off**), cron 241 (06:55, scheduled
anyway per P133). GET is an **ungated dry run**; POST writes. Population re-measured **9 cards / $10.4M,
read 9/9 correct on named rows**. Deliberately NOT extended to `domain_is_core_prefix` (~9/12; it proposes
*JP Morgan Chase CMBS Trust 2018PTC → jpmorgan.com* and *Frontier Hub LLC → frontier.net*). Full writeup:
`docs/audits/P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md`.

- **⚠️ WHEN YOU ADD A VALUE TO A COLUMN THAT AN EXCLUSION TESTS WITH `<>`, GO READ THE EXCLUSION.**
  The lane view hid an owner whose pivot contact came from outside the lane
  (`coalesce(pv.active_source,'') <> 'tier0_confirm'`). The sweep's new `active_source='tier0_auto'`
  **satisfies that inequality**, so the first auto attach on an owner would have hidden EVERY OTHER open
  card for that owner — no error, no log line. Measured before shipping: **3 of the 9 auto owners hold a
  second card, two of them live `ask` questions** (Healthcare Realty Trust's `healthcarerea.com`, Capital
  Square 1031's `capitalsq.com`). Worse, the honest-count metric would have *lied in the safe direction*:
  `cards_drained` would rise because questions were DELETED, not answered. A new enum member silently
  changes the meaning of every `<>` written against the old one; the predicate is now a SET.
- **⚠️ "READ THE LIVE DEFINITION AS THE AUTHORITY" IS NOT A SUBSTITUTE FOR COMMITTING THE VIEW.**
  P190 applied two changes to `v_lcc_tier0_owner_contact_candidates` LIVE — the `sponsor_map` arm and the
  `lcc_owner_name_is_not_prospected` gate — and deliberately did not commit the body, *"to avoid two
  copies drifting apart."* The newest COMMITTED source (P188) therefore no longer described the shipped
  view, and P194's rebuild from it silently dropped both: predicted diff **1 row**, actual **20 removed /
  1 added** (13 `ngpv.com`, 5 `uirc.com`, 1 `jbg.com`; George Washington University resurrected). **A
  migration that changes a view must carry the WHOLE view** — a second copy that is correct beats no copy
  at all, because the alternative makes the repo an unreliable source and guarantees the next rebuild
  regresses. **And the equivalence gate is what caught it**: a predicted 1 against an actual 21 is the
  entire value of running the diff both directions before believing a rebuild.
- **The consumer-mailbox stoplist now has ONE owner** — `lcc_is_consumer_mailbox_domain(text)`, IMMUTABLE.
  It previously existed as copies in three migrations and had already drifted (`frontier.com` listed,
  `frontier.net` not, which is what proposed an ISP as a Tier 0 card). Widening was **measured before
  shipping**, per the P158a `&` lesson: 41 people leave the pool and **exactly ONE card leaves the lane**,
  the known false positive. ⚠️ Note `~` binds tighter than `||`, so a concatenated regex parses as
  `(x ~ 'first') || 'rest'` and fails **42804 naming OR**, not the operator that mis-bound — keep the whole
  alternation in one literal.
- **⚠️ THE LANE'S "PARKED CARDS SELF-UNPARK WHEN EVIDENCE LANDS" CLAIM IS TRUE FOR ONE OF THE SIX SIGNALS
  P192 LISTS.** A `weak_partial` card is un-parked only by `n_link_evidence > 0` — a candidate's
  `contact_company` matching the OWNER — or by a `lcc_owner_sponsor_domain` row. Correspondence, SF
  campaign membership, an SF contact record, an Outlook entry and a job title all move
  `n_person_evidence`, **which the decidability CASE never reads**: measured, **95 of 146 parked cards
  ($118M) already carry person evidence and are parked anyway, permanently.** Class 10 in disguise — the
  exclusion IS self-clearing, but the only event that clears it is not among the events anyone expects.
  **Do NOT "fix" it by un-parking on person evidence**: that is the P188 Gary George finding (green on
  three person signals for George Washington University, employed by a poultry company) and would restore
  exactly the noise P192 removed. The instrument is `v_lcc_tier0_park_watch`; the one genuinely
  link-shaped unwired signal is *a deal shown to that buyer* (`lcc_listing_events`) — a stated gap.
  ⚠️ **Re-measured 2026-08-27 (P196): 146 parked / 105 owners / $180.3M**, and every card now names
  WHY (`park_reason`). The 95/$118M above was true when written; re-read `v_lcc_tier0_park_watch`
  rather than quoting it.
- **⚠️ "LEARN FROM THE REJECTS" HAS NO INPUT, AND THE ATTACH ANALOGUE IS REFUTED.**
  `lcc_tier0_confirm_log` holds **27 attaches and zero rejects** (the 6 `reject` rows in `lcc_decisions`
  are `status='superseded'` — the `owner_already_reachable` no-op, not an operator saying "wrong firm"),
  so a demotion engine there is a consumer with no producer (P137). And the tempting substitute — treat a
  domain already attached to owner A as evidence against owner B — was measured over every colliding pair:
  **16 open cards collide with an attached domain and 0 of 16 are contradictions** (13 NGP SPEs on
  `ngpv.com`; `Cunningham Development`/`Cunningham Development Co`; `Kb Exchange Trust`/`Exchangeright`;
  `Genesis Kc Dev`/`Genesis Financial Group`). **A shared domain across owners is CORROBORATION or a merge
  signal, never a contradiction** — the same 25%-precision trap P189 measured and rejected for
  domain-keyed merge grouping, and demoting them would suppress the sponsor inheritance P193 delivers.
  ⚠️ A **lexical** classifier gets this backwards: `lcc_owner_domain_core` buckets the NGP SPEs as
  "genuinely different" (`ngpviessexvt` vs `ngpcapital`), reporting 14 conflicts where reading the names
  gives 0 — verify on named rows, not on the aggregate.
- **ONE WRITER, TWO CALLERS.** `_shared/tier0-attach-effect.js::applyTier0Attach` owns the pivot write,
  the ledger and the person→owner edge; `admin.js`'s human verdict and the sweep both call it, and a test
  pins that the verdict block no longer PATCHes `owner_contact_pivot` itself. Copying the block into the
  tick would have satisfied the letter of "build it in the JS verdict path" and created the second writer
  this file warns about a dozen times. **Deliberate behaviour change:** the human path now ABORTS when the
  ledger write fails (it previously continued) — the ledger is what closes the card AND what makes the
  write reversible, so a pivot write without one is an irreversible write to the field the whole outreach
  chain reads, on a card that stays open.
- **Judge it by `cards_drained`, never `attached`** (`v_lcc_tier0_auto_attach_run_health`); every
  `skipped_*` is a re-discovery tally. Reverse a batch by `batch_tag LIKE 't0auto_%'`.

## P196 — a park needs a REASON, and the two prescribed fixes were measured (2026-08-27)

Every parked Tier 0 card now carries **`park_reason`** plus both compared strings
(`v_lcc_tier0_owner_contact_lane_triage` → `v_lcc_tier0_park_watch`, and the ungated
`GET /api/tier0-auto-attach-tick` dry run). Live: **146 parked / 105 owners / $180.3M** =
`employer_on_file_differs` 76 / 67 / $96.3M, `no_employer_on_file` 68 / 56 / $132.3M,
`employer_not_comparable` 2 / 2 / $1.9M. Writeup:
`docs/audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md`.

- **The parks are mostly CORRECT — `employer_on_file_differs` is the gate working, not a defect
  count.** Same class as the `hero_gap` correction earlier in this file: a number that reads like a
  backlog and is really the guard doing its job. What was actually missing was VISIBILITY — parked
  cards never reach the Decision Center (`_open` serves only `ask`/`auto`), so before this the
  operator saw a count and nothing else.
- **`employer_not_comparable` is deliberately its OWN reason.** The comparator has a 6-char floor on
  both sides; for those rows it could not run at all, which is a different fact from "it ran and
  disagreed". One label covering two questions is the P181 failure.
- **⚠️ THE PRESCRIBED COMPANY-STRING NORMALISATION UNPARKS 0 OF 146 — IMPLEMENTED, MEASURED,
  REJECTED.** Stripping `www`/`com`/punctuation before comparing looks obviously right and the
  motivating row does not survive its own fix: `Savlan Cc Property LLC` → `savlanccproperty` vs
  `savlancapital` fails containment and then fails the 8-char prefix arm on `savlancc` vs
  `savlanca`. **The mismatch is at character 8, not in the www/com noise.** A change that moves
  nothing is not free — it is a new arm nobody has graded. Savlan is a *sponsor-shaped* park.
- **⚠️ A LEXICAL SPONSOR DETECTOR IS A NOISE GENERATOR AT ~25% PRECISION — THE SAME NUMBER P189
  MEASURED AND REJECTED.** Leading-brand-token equality alone returns 19 pairs over the parked
  population, dominated by **shared GIVEN NAMES** (`George Kurz` ← *George's Inc* — P188's Gary
  George trap wearing a new dress; two `JAMES` trusts ← a shared CPA at `jameshowardcpa.com`, the
  grouping P189 already named) and **PLACE/NATURE words** (`MAPLE HILL` ← *Mapletree Investments*,
  a Singapore REIT; `Steel Station Rd, LLC` ← *Steel Equities*). Three guards in
  `lcc_tier0_sponsor_brand_token` — the owner must carry an SPE/portfolio marker, must not read as a
  street, must not be person-shaped (brokerage companies excluded on principle) — take it to
  **4 of 6, and the 4 are the top 4 by rent** (Gardner $8.0M, Salus $5.3M, Oxford $2.5M, Savlan
  $2.0M; the 2 false ones at $1.26M and $0.84M). `v_lcc_tier0_sponsor_map_proposals` is therefore
  **value-ranked and human-confirm-only** — the confirm is the existing curated
  `insert into lcc_owner_sponsor_domain(...)`, ONE decision covering an SPE family. **Nothing in
  Unit 2 writes.** Stated gaps: `lcc_looks_like_person` calls `Genesis Kc Dev` a person (a plausible
  proposal is dropped — a false negative costs one card, a false positive writes a stranger's firm
  onto an SPE family), and `lcc_owner_name_is_brokerage` misses *Wilson Kibler Commercial Real
  Estate*.
- **⚠️ THE DECIDABILITY CASE IS UNCHANGED — ask 77 / auto 9 / parked 146 before and after.**
  Un-parking on person evidence remains refuted (P188/P192); `test/tier0-park-reasons.test.mjs`
  goes RED if `n_person_evidence` ever appears in that CASE, and RED on any `ilike` in the
  `park_reason` classifier (a text detector over generated prose is the A1 defect even while it
  agrees with the boolean).
- **The SQL CASE is the single owner of both classifications** — the handler renders what the server
  decided; there is no JS mirror.

## P198 — ⚠️ BEFORE DEMOTING A RULE, MEASURE WHAT DEPENDS ON IT (2026-08-27)

> 📍 **All Tier 0 work starts at [`docs/architecture/tier0-owner-contact-system.md`](docs/architecture/tier0-owner-contact-system.md)** —
> one door into twelve rounds (P186–P198), carrying live state, the decisions already made, and
> the traps already paid for.

Two `ask` cards rested on a generic eight-character word stem (`innovati` → *Innovation 2100 LLC*
matched to "Innovative Renal Care", a dialysis **operator**; `corporat` → *Corporate Plaza LP*),
so the prefix-8 arm of `ev_company_matches_owner` was recommended for tightening. **Measured, that
arm is the ONLY link evidence on 28 of 87 ask cards / $146.9M** — including Easterly at $85.0M,
the highest-rent card in the system — and it is the **un-park mechanism** for **25 of 32
`weak_partial`** cards: P194 un-parks on `n_link_evidence > 0`, and that band's `no link evidence`
count is exactly **0**. Tightening would have parked ~$147M of reach to remove ~$5.6M of wrong.
Arm precision read on all 44 rows: **25 of 30 cards correct**. **Not shipped; closed.**

- **This is P179 Class 2 read backwards.** That rule says measure the throughput of whatever a
  *promotion* would displace. A **demotion** displaces something too, and it is harder to see: a
  rule's false positives are visible on the surface, what it holds up is not. Split the consumer
  population by *which arm admitted it* before weakening any arm.
- **A residue is only a defect if it is not individually rejectable.** Each of the five wrong
  cards is a one-second reject because P188 already put the employer string and the `match_key` on
  the card. The cheap fix was shipped three rounds ago; the expensive one was never needed.
- **⚠️ `lcc_name_has_spe_marker` IS NAMED BACKWARDS** — it detects a **PORTFOLIO/sponsor** marker
  (Properties, Holdings) and returns **FALSE for every name containing the literal string "SPE"**
  (all three Briarcliff rows, both UIRC rows). It separates the P198 population correctly
  *because* of that inversion. **Read the function, never the function's name.**
- **⚠️ `min(a.name)` + `min(b.name)` under ONE `GROUP BY` collapses both sides of a pair to the
  same string.** The first co-proposal run reported **95 pairs / 95 identical cores / 0 / 0** —
  everything in one bucket and nothing anywhere else, the Class 11 implausibility signal. Keyed
  properly it is **0 / 7 / 88**, the opposite conclusion.
- **Co-proposal is NOT a merge rule — 7% precision, worse than the signal P189 already rejected
  at 25%.** Two owners proposing the same person on the same domain is 95 pairs, **88 of them
  unrelated names** (sibling SPEs sharing a sponsor's contact). Narrowed to a shared 8-char core
  opening it is 7 pairs → `v_lcc_tier0_coproposed_owner_duplicates` (migration `20260827230000`),
  **read-only, human-confirm, and deliberately carrying NO `auto_mergeable` column** because
  `lcc_apply_fuzzy_merges` loops on that flag and would merge sibling SPEs into each other.
  ⚠️ **`UIRC-GSA V Douglas AZ` and `UIRC-GSA V VAN HORN TX` are different properties in different
  states** — 4 of the 7 rows must never be merged. Full writeup:
  `docs/audits/P198_PREFIX8_ARM_IS_LOAD_BEARING_2026-08-27.md`; playbook **Class 17**.
- **MERGED 2026-08-27 16:28 UTC (Scott approved all three).** Six cards became three; Easterly is
  ONE card at **$114,864,150 / 89 assets** — the combined pre-merge total exactly. Lane `ask`
  **87 → 84**; `auto` 9 and parked 137 unchanged; all three `reversible = true`. Winners by P195's
  **ownership-first** rule, not rent (Easterly REIT owns 79 assets vs 10). **Both pairs already
  carried the SAME confirmed contact on both sides** — the duplicate had been confirmed separately,
  which is independent evidence it was real, and the pivot fold lost nothing.
- **⚠️ CHASING A MOVED GUARD COUNTER FOUND THE NEXT DEFECT.** `auto_mergeable` 3,041 → 3,043:
  benign (each winner now heads a byte-identical group that was already auto-mergeable, and the
  added assets flipped two winner selections) — but it surfaced **9 MORE duplicate entities on the
  same three firms, ALL at $0 current rent and therefore invisible to every rent-ranked surface.**
  **Gardner Tanenbaum's deal history is SPLIT: 240 relationships sit on a live entity separate from
  the one holding its 13 assets** — the P177 failure, a survivor under-reporting the transaction
  history prospecting ranks on. **Not merged: an approval of three named pairs is not extended by
  inference.** Backlog **N3h**.

## P197 — the Tier 0 lane read ONE employer source, by ONE key (2026-08-27)

`no_employer_on_file` **67 → 54** cards ($131.2M → $113.6M), parked 142 → 137, `ask` 82 → **87**.
`auto` unchanged at **9 — the same 9 cards**. Card universe 233 → 233. **Nothing minted.**
`lcc_tier0_employer_on_file(person_id, email)` is the single owner of *"what employer do we hold for
this person"* — ranked `hub_email > hub_entity_id > sf_campaign > entity_capture`. Migration
`20260827170000`. Writeup: `docs/audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md`.

- **⚠️ WHEN A CONSUMER REPORTS "NOT ON FILE", ASK HOW MANY PLACES IT LOOKED.**
  `v_lcc_tier0_owner_contact_candidates` resolved `contact_company` from a single
  `LEFT JOIN unified_contacts ON lower(email)=lower(email)`, so *"we hold no employer for this
  person"* and *"we hold one and cannot reach it"* produced the identical card. Of the 73 eligible
  people blocking `no_employer_on_file`, **only 4** were missing a hub row that exists; **20** were
  in `lcc_sf_list_membership.company_name` (6,781 such rows, **never once read by the lane**) and
  **20** on `entities.metadata->>'company'`. The prompt's prescribed fix — reconcile them into
  `unified_contacts` — would have fixed 4 of 73.
- **⚠️ `company_name` IS SANCTIONED IN THE HUB AND A LANDMINE EVERYWHERE ELSE — the hazard travels
  with the TECHNIQUE, not the column name (P189/A2 again).** `lcc_sf_list_membership.company_name`
  and `entities.metadata->>'company'` are human/capture labels. Measured on named rows over the
  parked population they carry **city/zip strings** (`Southbury, CT 06488`, `Hollywood, FL 33021`),
  the **person's own name** (`Steve Blumer`), a P188-named junk label (`Inco Commercial`, on two
  people sharing ONE mailbox) and stale firms (`Pop Local` for someone @edwardsrealtyco.com,
  `The Carpet Shop` @corporaterealty1.com, `Community Trust Bk` proposed against a **health-centre**
  owner). `contact_company` feeds `ev_company_matches_owner` — **the only signal that attests the
  LINK** (P188) — so writing an invented employer that collides with an owner name manufactures
  exactly the claim P188 established these signals cannot make.
  - **The gate is EMAIL-DOMAIN CORROBORATION** (`lcc_tier0_company_confirms_domain`, now the single
    owner of that rule — the lane CALLS it instead of restating it inline). The label counts only
    when the person's own mailbox agrees. It kills every row above and keeps the real ones.
    **The two hub tiers are deliberately UNGATED**: the hub is the system of record, so whatever it
    says is "on file" by definition, and that is also the pre-P197 behaviour.
  - **Probed on 8 named rows with stated expected answers — 4 resolve, 4 reject — 8 of 8 correct.**
    A gate that only ever rejects is indistinguishable from a broken one (P182 positive control).
- **⚠️ THE 5,440 ORPHANED PERSON ENTITIES ARE 5,193 — A DETECTOR THAT KNOWS ONE KEY REPORTS THE
  OTHER KEY'S POPULATION AS ABSENT.** 247 of them **do** carry a `unified_contacts` row, linked by
  `entity_id`, invisible to the email-keyed detector. Same family as P189's `IS NOT DISTINCT FROM`
  inversion. **Before quoting any orphan/gap count, enumerate every link column the table carries** —
  `unified_contacts` has `entity_id`, `sf_contact_id`, `outlook_contact_id`, `gov_contact_id`,
  `dia_contact_id` besides `email`.
- **The producer is LIVE and it is SALESFORCE, not the sidebar.** 542 orphans in 30 days, 94 in 7,
  one the day of the audit. `metadata->'salesforce'` on 3,994 of 5,440;
  `external_identities` `salesforce/Contact` **4,032** vs `costar/contact` 1,767. So a one-shot
  reconcile is a chore repeated forever (Class 8) — which is a second reason P197 resolves at READ
  time rather than minting. Duplicate risk was checked, not assumed: of 3,874 orphans carrying an SF
  contact id, **exactly 1** already has a hub row under it.
- **The general rule was SIZED, NOT CHOSEN.** Gates over the 5,193, quoted before choosing:
  **SF campaign 1,475** (the only discriminating gate) · correspondence **33** · has an edge 4,903
  (94%) · person-shaped 5,131 (99%). **No hub rows were minted** — and note it would not have cleared
  the blockage anyway, because a hub row with no `company_name` answers nothing the lane asks.
  Backlog **N14**.
- **⚠️ TWO OF THE 5 NEW `ask` CARDS REST ON A GENERIC WORD STEM.** `ev_company_matches_owner`'s
  shared-8-character arm fires on `innovati` (*Innovation 2100 LLC* ← "Innovative Renal Care", a
  dialysis **operator**, $2.93M) and `corporat` (*Corporate Plaza LP* ← "Corporate Realty Inc").
  Pre-existing property of that comparator, now exercised more often — **stated, not papered over**.
  They are `ask` cards, and the card carries the employer, its `employer_source` and the match key,
  so a wrong one is a one-second reject. Tightening the comparator would move the 82 pre-existing
  `ask` cards and was left out of scope.
- **Safety proven, not asserted:** `auto` is the **same 9 cards** (0 lost, 0 gained) and
  `match_strength`/`n_eligible` changed on **0 of 233** — `auto` requires `match_strength='exact'`
  AND `n_eligible=1`, neither of which P197 touches, so **no unattended write can result**. The view
  also got FASTER — **793.9 ms → 553.6 ms**, buffers **32,841 → 22,820** — because the plan was
  pushing the old hub join down to all **7,890** rows of the `people` CTE, and the resolver is
  bounded to the ~600 matched pairs in a MATERIALIZED CTE.
- **Read `park_employer_source`.** All 81 `employer_on_file_differs` cards name their source; all 54
  `no_employer_on_file` correctly name none. A park resting on a corroborated Salesforce label is a
  different quality of judgement from one resting on the hub (P181). The remaining **54 cards /
  $113.6M are CORRECT** — a genuine acquisition gap, not plumbing.
- Guard: `test/tier0-employer-resolver.test.mjs` (7 tests, **all 7 mutation-verified RED**). It also
  re-asserts P196's decidability invariants, because P197 rebuilds the view that carries them and
  `test/tier0-park-reasons.test.mjs` reads the **P196 file**, which no longer describes the shipped
  definition.

## Entity identity & dedup — invariants (P189→P195→N15c/d/e→PR5c-entities-b-dupes→PR5c-entities-c; canonical page `docs/architecture/entity-identity-and-dedup.md`)

- **`entities.canonical_name` has ONE writer — a `BEFORE INSERT OR UPDATE OF name` trigger over
  `lcc_entity_canonical_key(name)` (N15c).** Ten code paths used to write it with five
  normalizations; a grep found seven of them, an AST walk twelve. Drift detector
  `v_lcc_canonical_name_drift` must read 0 — and **0 proves the backfill, not the producer**; the
  producer proof is a NEW `backfillable` row never appearing (confirmed at 4,618 mints, N15d).
- **A shared key is not identity.** `lcc_normalize_entity_name` / `dup-pair-planner.ownerCore` /
  `lcc_owner_strict_core` each reduce real, different parties to one string (`Realty Income` → `''`;
  `BAMMF (8) LLC == BAMMF (3) LLC`; `NGP Capital` → NULL). They GROUP for review; they never decide a
  write. Fuzzy name matching is banned for identity, everywhere.
- **A byte-identical name is not an identity claim when every token is generic** (P195: `Capital`,
  `Partners Group` — three real parties truncated to one word). Gate on distinctive residue before
  merging; **4 of 60 groups held on it.**
- **`lcc_merge_entity` is reversible since P196 and is the ONLY merge writer**; every review view
  carries **no `auto_mergeable` column** (P198 — `lcc_apply_fuzzy_merges()` loops on that flag).
  Merge candidates found by domain/email co-proposal graded at **25% / 7% / 27%** precision three
  separate times — a review lane, never a rule.
- **`entities.domain` is a PROVENANCE tag (`dia`/`gov`/`lcc`/`cre`), not an identity scope.**
  `ensureEntityLink`'s canonical_name tier carried `&domain=eq.` and minted duplicates on 9 of 11
  same-email pairs (fixed `d5b0ac8`). **The email tier keeps the same filter ON PURPOSE** — read on
  named rows, 40 of 55 cross-domain same-email pairs are two real brokers on one mailbox, firms filed
  as persons, or P131 row labels; **an attach is worse than a duplicate** (a duplicate merges
  reversibly later; a wrong attach folds two people at write time). Guard goes RED if it is removed.
- **Before fixing a lookup, prove from a run ledger that it RAN.** The dupes brief named
  `findEntityForUpsert` (the SF bridge); `bridge_runs` showed **zero** bridge runs in the window —
  the writers were the `lcc-sf-contact-resolve` tick (cron 165) and the CoStar sidebar. And
  **`git rev-parse --is-shallow-repository` before dating anything from history** — a shallow clone
  reports the graft boundary as the "add" (published as a finding, retracted the same day).
- **Two 0.14 s intra-request races remain and no predicate fixes them** — they need the
  `(workspace_id, canonical_name)` unique constraint, which is N15e's open operator decision
  (**6,608** violating groups on the N15c key — up from 3,930 because collapsing keys is what
  creates collisions; surfacing them is the fix working). Expect ~0.6% residual duplicate mint.
- **Honest rates, with definitions:** 326 SF-Contact creates / 13 on an existing live key (3.99%) /
  11 probable duplicates (3.37%) → post-fix not yet measurable (0 mints since). Re-derive, never quote.

## N18 — a column compared to ITSELF returns a plausible, wrong number (2026-08-27)

`v_lcc_developer_classification_candidates.attributed_rent` correlated on
**`pof.source_property_id = pof.source_property_id`**, so the scalar subquery degenerated to a
`One-Time Filter` and returned `props × domain_max_current_rent`. Fixed live + committed
(`20260827250000`); guard `test/sql-self-comparison-guard.test.mjs` (5 mutations RED). Distinct
values **1 → 5**, execution **1,602 ms → 128 ms**, buffers **2,102,242 → 3,904**, equivalence diff
**0 rows both directions** on every other column. Writeup:
`docs/audits/N18_ATTRIBUTED_RENT_SELF_COMPARISON_2026-08-27.md`.

- **⚠️ THE VALUE WAS THE DOMAIN-WIDE *MAX*, NOT THE SUM — N15c §6 and the N18 brief both said sum,
  and both were wrong.** The gov-wide sum is **$3.52B**; $34,920,891.77 is the gov-wide
  `max(annual_rent)`. And **"one distinct value" was a property of the surviving 6-row slice, not an
  invariant** — all six carry `props = 1`. Across all 277 candidates the broken expression takes
  **11 distinct values, max $279,367,134.16** (8 × the domain max). The Class 11 signal was real;
  the explanation attached to it was not. **Re-derive the mechanism before quoting a magnitude.**
- **⚠️ IT WAS A LIVE-ONLY DEFECT — THE REPO NEVER CARRIED IT.** The newest committed body
  (`20260609170000`) is correct; the live view had *both* the typo and N15c's uncommitted repoint.
  This is the gov **"running but not merged"** class and the mirror of "merged is not running".
  A rebuild from the repo would have silently reverted the repoint (**267 → 196** resolved). So the
  migration restates the **WHOLE view** — P194 again: *a second copy that is correct beats no copy
  at all.* **After hand-applying any view change live, commit the whole body the same day.**
- **⚠️ THE RANKING WAS NOT WRONG, IT WAS ARBITRARY.** Both sort keys were constant
  (`attributed_rent` tied, `props` all 1), so `order=attributed_rent.desc,props.desc` returned
  whatever the plan emitted while the handler called itself "value-prioritized". Corrected, **every
  position moves except rank 4** (Heritage 5→1 at $2.23M; Curtis 2→5 at $431k, overstated 80.9×).
  **A tie across every sort key is an unordered list wearing a rank.**
- **Impact bounded honestly:** `attributed_rent` is **never persisted** (the classification log has
  no such column), **no value gate reads it**, and at 6 rows against `limit=25` every candidate was
  drained anyway — the cost was sequence and the operator-facing number, not coverage.
- **⚠️ THE CORRECTNESS FIX WAS THE PERFORMANCE FIX, AND THE SUBPLAN IS NOT "GONE" — IT IS NOW
  INDEX-SATISFIABLE.** It still runs at `loops=385`; that is correct for a per-property lookup
  (**P118 corollary 2**: a genuine per-row lookup is exactly when an index IS the fix). The
  pathology was that a self-equality constrains nothing, so each probe scanned all 3,183 current
  facts. Not hoisted — 5 ms is not worth widening the change. Dominant remaining cost is now
  `lcc_match_buyer_parent_by_name` at `loops=277` (~98 ms of 128 ms): surfaced, not fixed.
- **⚠️ A SOURCE DETECTOR MUST STRIP COMMENTS, OR IT REPORTS THE BUG IT JUST REMOVED.** The
  migration's header quotes the broken predicate three times while explaining the fix. This is
  **A5c inverted** (there, prose made assertions pass over deleted code). And with the population at
  **zero across every migration**, the guard carries a positive control — while still not firing on
  a real self-JOIN (`a.parent_id = b.id`) or a shared prefix (`a.x = ab.x`).
- **⚠️ Row count is 6 because 266 of 277 candidate groups are already in the log** — small by
  construction, not a small population. **N15b's "222 of 274" does not reproduce off this view**;
  never quote the two interchangeably.
- 👤 **Ungraded:** the corrected top-10 has never been seen by an operator, and the handler's own
  header gates cron registration on Scott blessing that list — which until now was ordered by a
  constant.

## A5 — a truncated feed auto-closed the work it could not see (2026-08-27)

`true_owner_needs_salesforce` read **815 open / 596 lifetime completions / 1 in the last week** and
was ranked the biggest addressable stall in the system. **It never stalled, because it was never
work.** Diagnosis only, nothing built. Writeup:
`docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`; follow-ups **A5a → A5c → A5d → A5e**.

- **⚠️ `815 open` IS `1000 − 185` — AN OPEN COUNT THAT EQUALS A QUERY WINDOW IS NOT A BACKLOG.**
  `handleGenerateResearchTasks` fetches `v_next_best_research` with `order=priority.desc&limit=2000`;
  **PostgREST caps the response at 1,000** (the invariant already in this file) and the dia feed is
  **29,643 rows**. The gap arm is `20 AS priority` — a **hard-coded literal, no value term and no
  tiebreak** — so the window is `185` rows above priority 20 plus **815** arbitrary rows at exactly
  20. Open tasks: **exactly 815**. **5,509 of the 6,324 real gaps have never had a task at all.**
  The 2026-06-22 "cliff" is simply the date the window saturated.
- **⚠️ THE AUTO-CLOSE GUARD COMPARES THE REQUESTED LIMIT AGAINST A CAPPED RESPONSE.** Its own comment
  says *"never on a capped slice"*, and it tests `feed.length (1000) < limit (2000)` — which passes.
  So it fires over a truncation and closes everything outside the window as `gap_resolved`.
  **Compare against the RETURNED row count, never the number you asked for**; the same footgun that
  makes `CAND_LIMIT = 1200` a lie (P123).
- **⚠️ CHECK WHO WRITES A TERMINAL STATUS BEFORE RANKING LANES BY IT.** All 596 completions carry the
  single value `"gap_resolved"` — the auto-close, not a human, worker, or verdict. **170 of 183
  sampled owners still have `salesforce_id IS NULL`: 93% of the closures were FALSE.** The re-audit
  switched from lifetime totals to completion *rates* precisely to avoid being fooled, and was fooled
  anyway, because the rate was computed over a status nobody ever earns. Same family as P159a's
  `drillthrough: 37` and the `already_annotated` re-discovery tally — **verify on the underlying rows
  that the premise actually cleared.**
- **⚠️ AND IT INVALIDATED THE LANE EVERYONE CALLED HEALTHIEST.** gov `property_missing_recorded_owner`
  was *"908/30d, ~23/day, clears in ~7 weeks, leave it alone."* Its open count is pinned at **exactly
  1,000** (the cap), **885 of 885** completions are the same auto-close, and **146 of 146** sampled
  properties still have `recorded_owner_id IS NULL` — **100% false, zero real work in 30 days, and it
  cannot clear because its open count is a constant.** **An open count that does not move is a
  reading of the instrument, not of the population.**
- **The P131 answer is (a) + (c), with (b) empty — the third time in this arc.** **293** owners
  resolve **ID-to-ID** (dia `true_owner_id` → `external_identities(dia/true_owner)` → an entity
  carrying a `salesforce/Account` identity; 49 of them own a property) = deterministic plumbing.
  **~6,031 are not on-box at all** = CRM lookup, not automation. **ZERO are unstructured-on-box** —
  no corpus anywhere states a Salesforce account id, so **an LLM here would have nothing to read and
  would fabricate.**
- **⚠️ 84% OF THE LANE OWNS NOTHING, AND 81% OF THE APPARENT VALUE IS NOT AN OWNER.** 5,338 of 6,324
  hold zero properties. Ranked by property count the head is **DaVita Inc. 2,626 / DaVita Kidney Care
  1,183 / `Independent` 754 / U.S. Renal Care 342 / `Other` 110** — operators (the documented P113
  tenant-in-the-owner-slot trap) plus **literal placeholder strings**, carrying **5,227 of 6,442**
  properties. Real prospectable owners: **963**, holding 1,215 properties. Also
  ⚠️ **`dia.properties.estimated_annual_revenue` is CLINIC operating revenue, not owner rent** —
  summing it over this population gives **$45.5B** and is not a BD value signal.
- **The handler that looks like the consumer runs the other way.** `sf-link-reconcile.js` reads
  `true_owners.salesforce_id` **where it already exists** and mirrors it onto the LCC entity — it is
  this lane's downstream, not its consumer. The only code that ever *fills* the column is unscheduled
  Python in the **Dialysis** repo. **Read a handler's direction before counting it as a consumer.**

## A5a — FIXED, and the blast radius was 15× the diagnosis (2026-08-27)

`handleGenerateResearchTasks` now settles the auto-close by ASKING the feed which of its open
subjects are still a gap — a chunked membership probe that **fails closed** on any truncated or
failed answer — while minting reads only the ranked head (total order
`priority.desc,research_type.asc,entity_id.asc`) capped at the caller's `limit`. Single owner of
the rules: `api/_shared/nba-feed-sweep.js`; guard `test/nba-feed-truncation-guard.test.mjs`
(14 tests, **all 9 mutations verified RED**). Writeup:
`docs/audits/A5a_AUTOCLOSE_TRUNCATION_FIX_2026-08-27.md`.

- **⚠️ "PAGE THE WHOLE FEED" WAS IMPLEMENTED AND THEN REJECTED ON AN `EXPLAIN` — MEASURE THE READ
  BEFORE YOU CHOOSE THE FIX.** `v_next_best_research` materialises and external-sorts **all 41,805
  gov rows on every ordered request** (1,149 ms, 8 MB spilled to disk, at every offset) — the
  documented *"an `ORDER BY` forces the whole view to materialise, so the `LIMIT` is irrelevant"*
  footgun. A 42-page offset sweep is ~48 s of gov DB time per run and cron 35 fires every 30
  minutes: **~64 min/day of pure re-sorting on the shared PostgREST pool the 2026-08-12 incident
  wedged**, and O(pages²) in work. The SAME query filtered to an id list pushes the predicate into
  every UNION arm: **44 ms**. **Asking a bounded question beat downloading an unbounded answer** —
  and it is the STRONGER guarantee, because a downloaded list only ever supports "close if absent"
  and is only as complete as the fetch that built it, which is precisely how the 1,000-row
  truncation came to mean "the gap resolved".

- **⚠️ A GUARD THAT COMPARES A REQUEST AGAINST A RESPONSE IS NOT A GUARD.** The comment said the
  auto-close fires *"never on a capped slice"*; the code tested `feed.length (1000) < limit (2000)`
  — **the slice it asked for.** Wherever a server-side cap exists, the only honest signal is the
  RETURNED count. Raising `limit` cannot help (the `CAND_LIMIT = 1200` lie, P123).
- **⚠️ THE FEED IS 71,448 ROWS, NOT 29,643 — A5 MEASURED ONE DOMAIN.** gov 41,805 + dia 29,643;
  **69,448 gaps had never had a task**, and **four lane-domains have never minted one in their
  lives** (gov `owner_needs_sos` 16,873, gov `owner_needs_salesforce` 13,724, dia
  `property_missing_county_record` 9,761, dia `owner_needs_sos` 7,204 = **47,562 rows**). They were
  invisible to every audit because **a lane that has never emitted has no row to GROUP BY** —
  enumerate the PRODUCER's population, never the consumer's table. Both domains' open counts read
  **exactly 1,000**: an open count equal to a query window is a reading of the instrument.
- **⚠️ COMPLETENESS AND PRIORITISATION ARE DIFFERENT BUDGETS, AND CONFLATING THEM FORCED A FALSE
  CHOICE.** The close set must see the whole feed (it asserts a gap resolved); the mint set must
  stay ranked and bounded. Splitting them is what let the fix land without minting 71,448 tasks into
  a producer with no value gate (that gate is **A5c**). Emission: **≈+2,000 once, then a plateau**;
  open converges to min(`limit`, feed) per domain.
- **⚠️ THE CORRECTION WAS NOT UNIFORMLY RIGHT EITHER — MEASURE PER LANE, ON NAMED ROWS.** Still-in-
  feed rates: gov `property_missing_recorded_owner` **239/250 (95.6% false)**, dia
  `true_owner_needs_salesforce` 170/183 (92.9%), dia `property_missing_recorded_owner` **195/369
  (52.8%, full census)**, gov `property_missing_true_owner` **0/250 — those 386 closures were
  LEGITIMATE** (its feed genuinely fell to 28 rows). A blanket "all 5,763 were false" would have
  been as inaccurate as the claim it replaced.
- **Decisive safety check: all 1,000 open gov tasks are still in the feed, so the first CORRECT run
  closes 0.** Every closure the old code would have made on gov that night would have been false;
  the ~29/day gov "throughput" was 100% window churn.
- **Read `would_close`/`closed` and `feed_exhausted`, never `feed`** — a rows-scanned tally that
  reads exactly like throughput (P159a). `?dry_run=1` reports the whole plan without writing.
  **⚠️ Open counts going UP is the fix working**; the number that must fall is `gap_resolved`-per-day.
- **A5b-repair is FILED, NOT BUILT** — ≈2,044 of 2,631 distinct closed subjects are genuinely
  re-openable. Recommended: re-label the false closures out of the throughput metric, then let the
  corrected producer re-mint what ranks. Do not re-open before A5c makes the lane finite.

## A5c — the producer had no value gate: 71,448 → 2,530 admitted (2026-08-27)

A5a fixed the auto-close and thereby showed what a CORRECT producer emits — `would_insert`
**2,586** on one run, cron 35 every 30 minutes, into a pool where 69,448 of 71,448 gaps had
never had a task. The gate now lives in each domain's `v_next_best_research`
(`gate_pass`/`gate_reason`/`gate_value`; migrations
`supabase/migrations/{dialysis,government}/20260908120000_*_a5c_research_task_value_gate.sql`)
and the generator's ranked mint head filters on it **server-side**. Crons 34/35 re-enabled.
Writeup: `docs/audits/A5c_RESEARCH_TASK_VALUE_GATE_2026-08-27.md`.

| domain | pool | admitted | dominant exclusion |
|---|---:|---:|---|
| gov | 41,805 | **2,332** | `lane_no_consumer` 16,873 · `value_unknown` 8,551 · `owns_no_property` 7,690 |
| dia | 29,643 | **198** | `lane_no_consumer` 7,204 · `value_unknown` 11,936 · `owns_no_property` 5,184 |

- **⚠️ THE SAME FILTER ON TWO READS OF ONE VIEW IS A CORRECTNESS BUG. The membership probe is
  deliberately UNGATED.** The mint head asks *is this worth working*; the probe asks *does the
  gap still exist*. A probe that read the gated view would find every gated-out subject ABSENT
  and `planAutoClose` would close it `gap_resolved` — the exact A5a defect, wearing the fix's
  clothes and looking like the gate tidying up. **Deciding not to work a gap is not the gap
  resolving.** `nbaFeedGateFilter('probe')` returns null and nothing may ask otherwise; guard
  `test/nba-feed-value-gate.test.mjs` (10 tests, all 9 mutations RED). ⚠️ It strips comments
  before matching, because the file's own prose explaining the asymmetry made two assertions
  pass over a **deleted** assignment — the A1 prose-detector defect inside a test.
- **The gate is in the SELECTION, never a surface filter.** A JS filter after the read leaves the
  head full of rows nobody can work while the valuable tail below never gets reached, and the
  badge still lies.
- **⚠️ EVERY LANE THIS PRODUCER FEEDS HAS ZERO REAL COMPLETIONS — and `establish_ownership_history`
  IS NOT ONE OF THEM.** It and `trace_ownership_to_developer` (314 + 52 real completions, 352 of
  them in 30 days) come from **`v_lcc_ownership_chain_completeness`**, a different generator, so
  this gate cannot starve them. All **5,763** completions `v_next_best_research` has ever recorded
  are the A5a auto-close. Read `outcome NOT ILIKE '%gap_resolved%'` before ranking any lane.
- **Operators: RECORDED FACTS ONLY (P113), and the flag alone is not enough.**
  `is_operator_not_owner` catches 25 owners / 4,343 properties; adding `owner_type='operator'` and
  `owner_role='operator'` takes it to **36 / 4,479**. The extra 11 are Kaiser Permanente, Mayo
  Clinic Dialysis, Atlantis Healthcare Group, Wake Forest University… — real operators the boolean
  has never been set on. **That is a gap in the FLAG (backlog A5f), not a licence to add a regex**:
  the name-based `is_known_operator()` was measured and is worse both ways (it misses
  `U.S. Renal Care` on the period). **gov gets no operator arm at all** — its tenant is a federal
  agency and `true_owner_is_operator` is constant false there; a predicate that can never fire is
  noise, not safety.
- **Placeholders REUSE `<dom>_is_strong_junk_owner_name`** (which already catches Unknown / N/A /
  Various / Undisclosed / TBD / None) plus a NARROW anchored extension for the three it misses —
  `Independent` (754 properties), `Other` (110), `State Owned` (20), which
  `lcc_is_placeholder_owner_name` also misses. Blast radius measured over every live owner name on
  both domains **before** shipping: **7 rows, all genuine placeholders, 0 real firms.** Exact match
  never `contains` (P158a); scoped to this gate, never exported to the shared guards.
- **⚠️ VALUE IS THE CANONICAL RENT, AND UNKNOWN IS GATED.** dia reads
  `v_property_attributes_portfolio.annual_rent` (`proj.rent_now`) — the figure LCC already consumes
  as truth — **not** `properties.last_known_rent`/`rent_imputed`, which would admit more rows and be
  a SECOND definition of value that drifts from the panel's. A null rent is `value_unknown` and is
  **gated** (P161 measured this trade). It is the largest single exclusion at **20,487 rows**, and
  it is a COVERAGE problem, not a value one — dia prices only 4,154 of 11,796 properties (35%).
  Backlog **A5e**. Loosening the floor there would let a coverage gap masquerade as a judgement.
- **The floor is the EXISTING knob** — `{dia,gov}_research_gate_value_floor()` = **$500k**, the same
  number as the gov asset-mint floor, `CADENCE_SIGNAL_MIN_VALUE` and P161's weak-role floor. No
  per-lane floor was invented because no measurement justified one; the same floor admitting 5.6% of
  gov and 0.7% of dia is the two portfolios being different sizes.
- **`owner_needs_sos` (24,077 rows) emits NOTHING — `lane_no_consumer`, recorded per row.** SOS-direct
  is blocked at the bot-wall (government-lease `CLAUDE.md` §25). The gate does not change its
  reachability; it makes its zero an explicit decision instead of an accident of where the priority
  window fell. `gate_value` is still computed, so re-admitting it is one predicate. Backlog **A5g**.
- **⚠️ Value is per OWNER.** gov `owner_needs_salesforce` is 1,675 rows over **1,674 distinct
  owners / $4.01B** and **dominates the admitted population — 66% of everything the fleet will
  mint, and the lane's first-ever emission.** dia `true_owner_needs_salesforce` is **27 owners /
  $21.7M**. ⚠️ **A5's "963 real prospectable owners" is NOT the admitted count** — that was a
  decidability figure with no value floor; both are correct about different questions.
- **The gov SF lane's gap was suspected stale and REFUTED, not assumed.** gov `unified_contacts` is
  the pre-cutover snapshot (30,714 rows, 5 in 7 days), so "no `sf_account_id`" could have been a
  stale verdict. 40 of 40 sampled admitted subjects exist on the LIVE hub and **0** carry one.
  (Also re-measures this file's own claim that the gov copy is frozen at 2026-08-17: it is
  2026-08-26 / 213 rows in 30 days — a trickle, not frozen.)
- **The existing 2,000 open tasks below the gate STAY OPEN and are NOT retired here** — the probe is
  ungated so none is falsely closed, and **at least 1,306 of them are below the gate** (dia
  `property_missing_recorded_owner` measured exactly: **11 of 185 admitted**). Retiring them is a
  bulk state change with its own reversibility and a distinct outcome value; bundling it is how a
  repair becomes indistinguishable from the producer (P176). Backlog **A5d**.
- **Read `admitted_head_exhausted`** — `true` means `feed` IS the whole admitted population, `false`
  means it is a FLOOR. And **`gate_reasons_seen` must contain only `admitted`**; anything else means
  the filter did not take. **The dia research badge now counts gated rows** (198, not the raw 29,643
  pool) — `count=exact`, because the planner's estimate over the gated view is off ~58×.
- **LIVE 2026-08-27 (merge `7de1791`), crons 34/35 re-enabled, first run `inserted` gov 161 + dia
  182 = 343 — hundreds, not thousands.** dia's `feed: 198` with `admitted_head_exhausted: true`
  matches the SQL-measured admitted population exactly — the cross-check that the filter is in the
  SELECTION. Two lanes minted their first tasks ever (dia `property_missing_county_record` 109, gov
  `owner_needs_salesforce` 108). `closed: 0`; the only `gap_resolved` rows in 24h are 10 from cron
  34's 06:00 run *before* A5a deployed. ⚠️ Open counts went **up** (2,000 → 2,343, converging to
  ≈2,530 admitted + ≈1,844 pre-gate residue) — that is the fix working (A5a).
- **⚠️ THE `/version` PROBE IS UNREACHABLE FROM THE SANDBOX (proxy 403), SO THE DEPLOY WAS CONFIRMED
  BEHAVIOURALLY — and that check earned its keep.** `lcc_cron_post` → `?dry_run=1` →
  `net._http_response`, reading for `value_gated`, a field that only exists post-A5c. **Two minutes
  after the merge it was still ABSENT and `would_insert` still read the ungated 2,586** — had the
  crons been re-enabled on the strength of "it merged", cron 34 would have minted the entire flood
  with the gate sitting inert in the DB beside it. The DB half ships instantly; the JS does not.
- **Performance measured both directions:** the gov ranked head got **FASTER** (1,149 → 591 ms — the
  constant-false SOS arm is pruned and the sort set drops 41,805 → 2,332), and the probe is
  unchanged (44 → 51 ms) because the gate's LATERAL aggregates report `never executed` under its id
  predicate. dia head 684 ms, probe 33 ms.

## C1 — the Salesforce lanes already had a consumer, on a different surface (2026-08-27)

`true_owner_needs_salesforce` (837 open) and gov `owner_needs_salesforce` (108 open) have **0 real
completions ever** and were about to get a consumer built. **They already have one.** The Decision
Center lane **`sf_link_candidate`** holds **3,369 owner↔SF-Account candidates**, every one carrying
a resolved `001…` Account id, behind a verdict path (`api/admin.js:10764`) that **PATCHes the exact
column whose NULL-ness defines both research lanes** — null-guarded, provenance-logged, reversible,
with an active Ollama pre-rank (cron 213) and **59 human verdicts recorded**. It already covers
**360 of dia's and 1,347 of gov's** gap subjects. Diagnosis only, nothing built. Writeup:
`docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md`.

- **⚠️ BEFORE BUILDING A CONSUMER, GREP FOR WHO ALREADY WRITES THE GAP COLUMN.** Not who reads the
  lane, not who is named after it — **who writes the field whose NULL-ness IS the gap**. That one
  query (`sf_link_candidate` → `PATCH true_owners.salesforce_id`) turns "build a consumer" into
  "retire a duplicate surface". The generalisation of A5's *read a handler's direction before
  counting it as a consumer*: **`sf-link-reconcile.js` runs domain→LCC and no cron calls it**, and
  the one cron in the family (`cron.job` 48 `lcc-sf-link-tick`) is `active=false`. ~~and posts to
  `'vercel'`, the host retired 2026-07-20~~ ⚠️ **CORRECTED 2026-09-02: that reading was wrong.**
  `'vercel'` was only ever a LABEL on `lcc_cron_post` — the function routes every non-`edge` target
  to the Railway URL from the vault, and never to Vercel after the retirement. The label was
  retired the same day (see the `lcc_cron_post` footgun below); P194's stale-host finding concerns
  the Chrome extension's hard-coded URLs, not pg_cron.
- **⚠️ A LANE'S PREDICATE AND ITS ONLY WRITER CAN BE ON DIFFERENT COLUMNS, AND NOTHING ERRORS.**
  The gov lane reads `unified_contacts.sf_account_id`; the verdict writes
  `recorded_owners.sf_account_id`. Measured: **1,961 gov owners are already linked, 1,292 still
  read as a gap, exactly 29 agree** — so a human who works the DC lane successfully **does not
  clear the research task**, which stays open and is re-minted. **96 of the 1,675 admitted rows
  ($314.7M) are phantom work.** dia is unaffected because both sides read the same column — the
  asymmetry is invisible from either side alone, so **check the writer's column against the
  predicate's column by name, not by concept.**
- **⚠️ "0 RESOLVE TO AN ENTITY" WAS A KEY-SPACE ARTIFACT, AND THE OBVIOUS RE-KEY IS THE WRONG
  PARTY.** The gov lane emits `unified_contacts.unified_id`; `external_identities` indexes gov by
  `gov/true_owner` and `gov/asset` only, so the join returns 0 **structurally** and would after any
  amount of minting (the P197 shape). Re-keyed via the owner's property → `true_owner_id`, **111 of
  114 resolve** — **but the names differ on 70 of 120 pairs**, and read on named rows the difference
  is SPE↔sponsor and sometimes a person: `ARCP GSPLTNY01, LLC` → **`Nicholas Schorsch`**,
  `INGOLD FAMILY INVESTMENTS LLC` → **`Robert Ingold`**, `PORTALS OWNER, LLC` →
  `Republic Properties Corp.` Attaching the sponsor's Salesforce Account to a question asked about
  the SPE is **P188** exactly. Safe subset: 55 name-agreeing pairs → **2** with an SF Account.
  **A wrong-key zero and a real zero look identical; so do a right-key number and a wrong-party one.**
- **⚠️ TWO CORRECT COUNTS THAT ARE THE SAME NUMBER ARE PROBABLY NOT THE SAME SET.** dia's value gate
  admits **27** owners; **27** open dia tasks resolve to an entity carrying an SF Account. **The
  overlap is 3.** One is a value population, the other an automation population.
- **⚠️ HALF THE LANE'S STATED JOB WAS NEVER BUILDABLE — CHECK CAPABILITY BEFORE DOCTRINE.** Both
  lanes' generated instruction reads *"Link **or create** Salesforce account for X"*. LCC's entire
  Salesforce surface is a **read-only Power Automate proxy** (`_shared/salesforce.js` states Scott
  has no admin rights to register a Connected App); a repo-wide grep for `sobjects` /
  `/services/data/v` / a POST to Salesforce returns **nothing**. So "never write back to clean SF"
  is the second reason, not the first. **A doctrine question you can settle with a grep is cheaper
  than one you take to the user.**
- **P131: (a) 27 dia + 2 gov · (b) ZERO · (c) dominant.** (b) is a measurement: a Salesforce Account
  id exists only in Salesforce — no document, email, OM, deed or capture anywhere states one, so a
  model would fabricate an 18-character id that looks exactly like a real one. **Fourth time in this
  arc the top-ranked "LLM opportunity" measured as (a) plus (c).**
- **Completing a task writes nothing and does not stick.** `completeResearch()` posts
  `{research_task_id}` alone; neither lane has a capture button (only `owner_contact_manual` (P173)
  and `establish_ownership_history` (P179) do — Dead-End **Class 3**), and the seeder dedupes on
  `status='queued'` only, so a completion with the gap intact is re-minted. Churn: **4.84**
  tasks/subject on `property_missing_recorded_owner`, 1.95 on `true_owner_needs_salesforce`.
- **Recommendation: automate 27, retire 945, gate 1,702, repair 1,292 — build no consumer.**
  Backlog **C1a** (mirror repair, first — it resizes both lanes) → **C1b** (gate `lane_no_consumer`,
  the `owner_needs_sos` precedent) → **C1c** (retire on the A4 pattern; ⚠️ a bare `skipped` is not
  terminal to the seeder) → **C1d** (the 27, **as a new unit of `sf-link-reconcile.js`, never a
  standalone writer** — the verdict path is the single owner of that column) → **C1e** (register
  `dia.true_owners.salesforce_id` in `field_source_priority`; gov has ladders for both its tables,
  dia has none).
- **⚠️ THE VERIFICATION IS INVERTED AND MUST BE STATED THAT WAY.** If C1b/C1c are taken, real
  completions correctly stay **0** and the lanes disappear instead — open counts to 0,
  `gate_reason='lane_no_consumer'`. That is success, not a failure to move the metric. The numbers
  that move are `dia.true_owners.salesforce_id` non-null (**822 → 849**, C1d) and the gov admitted
  count (**1,675 → 1,579**, C1a).

## B1 — a value gate belongs on what reaches a HUMAN, not on what a cron applies (2026-08-28)

`establish_ownership_history` carried **1,548 `below_value_floor` skips at $500k — five times the
314 the lane had ever completed.** The floor (R60) was **correct when set**: the lane was a human
research queue whose instruction says *"pull the county deed history via the county-recorder
portal"*. ⚠️ **And $500k is NOT "one knob" — C2a measured five independent objects carrying that
literal the same day, refuting this file's own "one number, not three"; B1 makes it six
(`lcc_chain_human_value_floor()`), which is C2d's preferred direction (a NAMED per-gate knob over a
repeated literal) but must be counted, not glossed. B1 touches only this lane's research gate.**
**What changed is the CONSUMER, not the judgement** — since A2 (cron 244) the `agrees`
bucket is applied automatically from a deterministic, record-cited draft and A4 (cron 245)
auto-retires `no_records`. Migration `20260828120000`; writeup
`docs/audits/B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md`. Result: lane completions **336 → 1,237**,
gov `any_history` **1,272 → 2,173**, gov `chain_2plus` **149 → 177**, and the operator's
`human_actionable` badge **unmoved at 55**.

- **⚠️ THE FLOOR IS SPLIT BY CONSUMER, NOT REMOVED — and the boundary was MEASURED, not chosen.**
  `lcc_chain_lane_has_auto_consumer(domain, research_type)` is the single owner of it and admits
  **gov + `establish_ownership_history` ONLY**, because the drafter reads
  `gov.v_ownership_transitions_portfolio` and **dia has no such view** (measured: zero objects
  matching `%ownership_transition%` on `zqzrriwuavgrquhisnoa`; gov holds 9,595 transitions). A dia
  task can never be drafted, never auto-applied, and lands on a human — so lowering its floor mints
  work no automation can touch. `trace_ownership_to_developer` is held for a different reason: its
  consumer (cron 145) has **not been graded** the way A2 has. **1,030 rows held by design and
  reported as `held_by_design`, never silently dropped.**
- **⚠️ THE HUMAN GATE CANNOT LIVE IN THE SEEDER, AND THAT IS STRUCTURAL.** The seeder mints
  **before** the drafter runs, and it is the DRAFT that decides `agrees` (automation) vs `mismatch`
  (a person). So the human floor lives on
  `v_lcc_ownership_history_lane_split.human_actionable` — which
  `v_lcc_research_lane_summary.human_actionable_tasks` already reads. Measured after the drain: 123
  new `mismatch`/`all_guarded` cards, **every one below $500k and held**, badge still 55. **89% of
  the newly-drafted population routed to automation.**
- **⚠️ TWO GATES, OPPOSITE DIRECTIONS ON AN UNKNOWN VALUE — and both are right.** The automated
  path **admits** an unpriced task (drafting is ~free; refusing a free chain because we cannot price
  it buys nothing); the human surface **gates** it ("we cannot size it" is not evidence it is worth
  an operator's time — P180 / A5c `value_unknown`). Writing one rule for both would have been wrong
  in one direction whichever way it went.
- **MEASURE THE COST BEFORE CALLING IT FREE.** The drafter's gov read is **508 ms per 60-property
  chunk and almost entirely FIXED** — `v_ownership_transitions_portfolio` materialises its whole
  `norm` CTE (9,595 rows) plus an oscillating-pair self-join on every request, and only **71 of
  9,595** rows survived a 60-id filter. So cost scales with **CHUNKS, not chains**: the entire
  below-floor population is ~21 chunks ≈ **10.7 s of gov DB time, once** — about **8 ms per chain**,
  against a floor that exists to protect operator hours.
- **⚠️ `backlog_remaining: 0` IS SCOPED TO THE SCAN WINDOW.** The drafter clamps `limit` to 500 and
  scans a **600-row** lane window; `lane_scan_capped: true` says so. The lane advances only as A2
  **completes** tasks and they leave the open lane, so the drain is a draft→apply CYCLE, not one
  pass. Reading `backlog_remaining` as "nothing left in the lane" would have reported the job done
  with 687 tasks untouched.
- **⚠️ CHECK WHICH METRIC THE POPULATION CAN ACTUALLY MOVE.** `any_history` rose **+901** while
  `chain_2plus` rose **+28** — not a shortfall: only **210 of 1,501** below-floor properties have ≥2
  guard-passing transitions, and most of this population is genuinely single-link. **The binding
  constraint on chain DEPTH is now the A2-blocked residue** (`ambiguous_entity` 126 links / 123
  properties — the A2a merge class, which applies unaided once merged), **not the floor.** Quoting
  +28 as the ceiling, or as a disappointment, would both be wrong.
- **The overload trap again (N15d):** adding `p_auto_min_value` with a default makes every 2-arg
  call *"function is not unique"* (42725), so the 2-arg signature is **DROPPED first**. And the
  effective floor is resolved in **both** the skip sweep and the mint — a row admitted by one and
  closed by the other is nightly churn that reads exactly like a working producer.
- **The reversal was RUN before the batch** (P195): a 5-row re-open → un-re-open restored **5 of 5
  byte-identically**. Reverse the whole batch with `lcc_b1_unreopen('b1-reopen-20260828')`; restore
  single-floor behaviour by re-scheduling cron 144 with `500000` as the third argument.
- **⚠️ Observability gap, surfaced not fixed:** `lcc_ownership_chain_draft_run_log` rows open at
  `status='started'` and several never close — today's 06:45 cron run included — while the handler
  returns HTTP 200 and writes its proposals. **Read the pg_net response body or the proposal delta,
  not the run log.**
- Guard: `test/b1-chain-value-floor-split.test.mjs` (11 tests, **all 11 mutations verified RED**,
  comments stripped before matching — the migration header discusses the held lanes at length, so a
  naive grep would pass over the guard's own deletion). `test/ownership-lane-split.test.mjs` now
  also reads this migration, or it would describe a superseded view (P197).

## C2e — the eligible-set asset mint: the floor's stated cost was measured and is mostly not real (2026-08-28)

gov asset coverage **24.7% → 39.2%** (3,425 → 5,425 anchors of 13,837 non-archived);
`lcc_property_owner` **4,065 → 6,065 rows / 2,768 → 3,743 owners**. **2,000 minted, 2,000 carry
evidence AND a resolved owner, 0 evidence-less, 0 orphans.** Plan
`v_lcc_c2e_asset_mint_plan` (migration `20260828140000`), batch `c2e_gov_eligible_t1_20260828`,
reversible by tag. ~~**Tranche two (4,811 props) NOT run.**~~ ⚠️ **T2a IS NOW RUN — see the C2e-T2a section below; 2,241 props / 2,054 owners remain and only T2b is outstanding.** Writeup:
`docs/audits/C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md`; canonical
`docs/architecture/connectivity-and-open-threads.md` §4i.

- **⚠️ THE GATE WAS DEFENDED ON A COST THAT CANNOT EXIST. `v_lcc_merge_candidates` AND
  `v_lcc_merge_candidates_normalizer_blind` FILTER `entity_type = 'organization'`; A MINTED ASSET
  IS `entity_type = 'asset'`.** Across a 2,000-entity mint: merge candidates **5,250 → 5,250**,
  **`auto_mergeable` 3,038 → 3,038**, normalizer-blind **64 → 64**, drift **0 → 0**. The rent floor
  had been justified for years as protection against merge/duplicate noise; for asset minting that
  protection was **structurally unnecessary**, and the whole observable cost was
  `v_duplicate_candidates` **+20** (the one duplicate view that groups ALL entity types on
  `canonical_name`) and +23 Tier 0 cards. **Before paying a real price to avoid a surface cost,
  read the surface's own WHERE clause and ask whether the rows can reach it at all.**
- **⚠️ A STAGED TRANCHE TAKEN "RICHEST FIRST" MEASURES THE SAFEST POPULATION AND LICENSES NOTHING.**
  The rank-1145 cut landed at **$543,782 of owner rent — entirely ABOVE the old $500k floor**, so
  tranche one exercised none of the low-rent tail the decision was about. Contactability
  **21.3% vs 10.8%**, known-beyond-gov **12.9% vs 4.4%**, duplicate-group formation **1.0% vs
  1.5%** for the remainder. **Say which population a staged measurement actually covered**, or the
  next tranche inherits a reassurance it never earned.
- **⚠️ PREDICT THE DELTA BEFORE THE WRITE, THEN RECONCILE.** `v_duplicate_candidates` was predicted
  at **+20 new groups** from the canonical-key collisions and measured at **+20**. A prediction that
  matches is what turns "the number moved a little" into "the number moved for the reason I think"
  (the A2 `on conflict do nothing` lesson, applied forward instead of after the surprise).
- **⚠️ AN EXPECTED-FLAT SURFACE THAT MOVES IS A MECHANISM QUESTION, NOT A FOOTNOTE.** The brief said
  Tier 0 must not move because "assets are not owners". It moved (`ask` 82 → 91). **`ask` +9 matches
  EXACTLY the 9 cards on owners whose only resolved property came from this batch** — resolving an
  owner is what makes "who do we call there" askable. The safety statement is the narrow one:
  **`auto` (the sole band that can trigger an unattended write) held at 9, and zero `auto` cards
  landed on any owner C2e made resolvable.**
- **⚠️ A SHARED MINT FUNCTION HARD-CODED ITS CALLER'S REASON, AND IT WAS FALSE FOR THE NEXT CALLER.**
  `lcc_mint_gov_asset_entities` stamped `metadata.minted_because = 'a verified dated gov ownership
  transition exists and the property cleared the caller's rent floor'` — **false on BOTH clauses**
  for an eligible-set mint that requires no transition and applies no floor. Writing that 2,000
  times would poison the exact field a future reader uses to judge whether the entity is justified.
  Made a caller argument (`p_reason`, migration `20260828140100`), defaulting to the feeder's
  existing string so its behaviour is byte-identical. ⚠️ **DROP the 3-arg signature first** — a
  defaulted 4th parameter otherwise makes every 3-arg call **42725 "function is not unique"**
  (N15d/B1), and **`notify pgrst, 'reload schema'`** or the feeder's next RPC 404s.
- **⚠️ A CRON CAP TURNS "MINT THE ELIGIBLE SET" INTO A LIE FOR A WEEK.** The eligible-set promise is
  that every minted entity carries evidence immediately. **Cron 225 (`lcc-domain-owner-feeder`) is
  capped at 400/run, daily** — left to the schedule, 2,000 entities sit matching the retire
  predicate for ~5 days. `lcc_ingest_domain_owner_evidence` was driven explicitly (~6 s per 400).
  **Whenever a one-shot producer outruns its consumer's per-run cap, drive the consumer in the same
  pass.** (It has no domain parameter, so 4 pre-existing dia rows rode along — the same 4 cron 225
  would have done that night; **no dia asset was minted**.)
- **`2,000` was round BY CONSTRUCTION, not a cap** (the `cum_props <= 2000` cut) — but note the mint
  ran as **direct SQL**. Through the feeder's PostgREST path the row list would have **silently
  truncated at 1,000**.
- **Owners are cut WHOLE, richest gov portfolio first.** Evidence lands per property, so a split
  owner is a half-resolved owner. The plan view **self-excludes minted rows**, so it is also the
  live remaining-backlog surface and tranche two reads the same object.
- **It closed N15d's open item incidentally**: the N15c `canonical_name` trigger had never been
  exercised by a real producer. 2,000 entities through a live write path, **all 2,000 on-key, drift
  still 0**, detector positive-controlled at 64,356.
- **dia untouched, deliberately** — 84% of its un-minted owner slots hold an OPERATOR (P113).


## C2e-T2a — tranche two step one: the prediction missed by 2, and the 2 were the finding (2026-08-28)

gov asset coverage **39.2% → 57.8%** (5,425 → 7,995 anchors of 13,837 non-archived);
`lcc_property_owner` **6,065 → 8,636 rows / 3,743 → 5,992 owners**. **2,570 minted, 2,570 resolved
an owner, 0 evidence-less, 0 orphans.** Batch `c2e_gov_eligible_t2a_20260828`, reversible by tag.
**T2b (2,241 props / 2,054 owners) NOT run — Scott's call.** Writeup:
`docs/audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md`; canonical
`docs/architecture/connectivity-and-open-threads.md` §4k.

- **⚠️ PREDICT A CANONICAL-KEY EFFECT WITH THE KEY THE *WRITER* PERSISTS, NOT THE ONE THE CALLING
  FUNCTION PASSES.** `v_duplicate_candidates` moved **+46** against a predicted **+44**, and the
  2-row gap was a real mechanism, not slop: `lcc_mint_gov_asset_entities` passes
  `lcc_normalize_entity_name(name)` as `canonical_name`, and the **N15c `BEFORE INSERT` trigger
  overwrites it** with `lcc_entity_canonical_key(name)` — all 2,570 rows carry the trigger's key and
  only **2,497 (97.2%)** equal the function's argument. Re-run with the persisted key: **12 + 34 =
  46**, exact. This is the trigger working (N15c made it the single writer); what it leaves behind is
  **an argument inside the mint function that reads like the answer and is dead code**. Where a
  `BEFORE` trigger owns a derived column, the caller's value is a suggestion — same family as the
  P157 `reloptions` and P182 deparse traps: *the stored value is not the value you wrote.* Cleanup
  filed **N15g**.
- **⚠️ A PREDICTION THAT MATCHES IS WORTH MORE THAN A NUMBER THAT MOVES "ABOUT RIGHT" — and the
  discipline only pays if you chase the residual.** +46 against +44 is a 4% error that would have
  been trivially shruggable, and shrugging it would have left the trigger/argument split
  undiscovered.
- **⚠️ TIER 0 MOVED +4 AGAINST A PREDICTED ~+20, AND THAT IS A POPULATION SIGNAL, NOT A MISS.**
  Tier 0 needs a person we already hold whose email domain matches the owner; only **7.0%** of these
  owners carry a second identity against tranche one's 12.9%. **Resolving an owner makes "who do we
  call there" ASKABLE; it does not manufacture a bench.** Safety is exact and narrow: **`auto` held
  at 9 with ZERO cards on any owner T2a made resolvable** — the only band that can trigger an
  unattended write. `ask` +1 / `parked` +3 are *precisely* the 1 and 3 cards on T2a owners.
- **⚠️ "UNCHANGED" NEEDS A TIMESTAMP *AND* AN ATTRIBUTION (§4i.5, applied).** Merge candidates
  5,194 → 5,194, `auto_mergeable` 3,006 → 3,006, normalizer-blind 64 → 64, drift 0 → 0 — and
  **`lcc_entity_merge_log` recorded 0 merges in the window** (newest nine hours prior), so the zero
  is genuinely this batch's rather than a quiet coincidence between two threads.
- **`evidence_written 2578` against a `+2,571` ROW DELTA — a write counter is not a row counter.**
  The 7-row difference is idempotent re-writes, and it matches the 7 candidates still reading
  `eligible`, **all of which are brokerages** (`Stan Johnson Co` ×4, `SVN®`, `NAI Pfefferle`,
  `Bradford Allen Realty Services`). `lcc_reconcile_property_owner` filters brokerages *inside* its
  scoring CTE, so they clear the candidate view and score zero forever — **the sixth guard working,
  not a backlog.**
- **The evidence drive is not optional and cron 225 cannot do it** — capped at 400/run, it would
  have left 2,570 entities matching the retire predicate for most of a week. Driven explicitly at
  `limit 3000` in the same pass. ⚠️ The function takes **no domain argument**, so **1 dia property
  resolved** (work cron 225 would have done that night). **No dia asset was minted.**
- **👤 T2b: safe to run, low-value to run — sized live, not extrapolated.** Predicted **+26**
  duplicate groups (1.16%) — **LOWER than T2a's actual 1.79%** — against contactability collapsing
  **21.3% → 17.2% → 3.7%**. The graph cost is now measured across 4,570 mints and is not the issue;
  the owner cliff arrived exactly where C2a said. The decision is purely whether *"resolve all
  ownership, rank later"* applies to a population ~96% un-contactable. **No default was taken.**

## B6c-dup — two stores for one fact, each naming ITSELF canonical (2026-08-29)

`detail.js` said in its own comments that `property_sale_events` was **canonical** and
`sales_transactions` was *"legacy, retired for write paths."* The database said the reverse and
always had: **77 of 77 gov views that read a sale store read `sales_transactions`** — all 30
`cm_gov*` Capital Markets views among them — and **ZERO read `property_sale_events`**. Both stores
were individually correct with coherent consumers, so nothing errored. **The comment is what let it
survive.** Decision recorded: **the spine is `sales_transactions`; PSE is a CAPTURE surface that
propagates into it.** Shipped `trg_gov_pse_propagate_to_sale` (gov,
`sql/20260829_gov_b6cdup_pse_propagate_to_sales_transactions.sql`), the SINGLE owner of that
transition. Writeup: `docs/audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`; connectivity **§4p**;
contract **I1**.

- **⚠️ CONFIRM A LEAK BEHAVIOURALLY, NEVER BY READING THE PROPAGATION CODE.** One rolled-back
  INSERT settled it: `property_sale_events` +1, `sales_transactions` **+0**,
  `properties.latest_sale_price` set. Faster and more convincing than reading either half.
- **⚠️ A COMPLETE DOWNSTREAM STORE IS NOT EVIDENCE THAT PROPAGATION EXISTS.** gov's spine held
  **every** priced event on a live property — because both bulk importers wrote **both** tables
  independently, not because anything connected them. The operator path had **never produced a
  row** (all 5,208 PSE rows are importers; inserts stopped 2026-04-06), so the leak had done zero
  damage and looked exactly like a working connection. **Ask when a path last ran before reading
  its output as proof it works** — and size the build accordingly: this was fix-before-it-bites,
  not a cleanup.
- **⚠️ THREE SUCCESSIVE ORPHAN COUNTS WERE WRONG — 330/$4.48B, 9/$558.8M, AND MY OWN FIRST
  RE-MEASURE OF 6/$29.2M. THE TRUE COUNT IS ZERO.** Causes, all transferable:
  - **The exact-date join was the wrong key.** `sales_transactions.sale_date` is **month-truncated**
    for its dominant source — `costar_sidebar` **87.4% day-1** (6,871/7,865), ownership stubs 100%.
    All six named "orphans" carry an **exact price twin 3–21 days apart, every twin on the 1st**.
    Re-keyed on `(property, YEAR-MONTH)`: **0 of 1,694**, impossible-price control **1,694**.
    ⚠️ **`dedup_natural_key` already encoded that granularity** (`property | round(price/1000)*1000
    | YYYY-MM`) — the spine had been stating its own join key all along. **Run the neighbouring key
    before believing an anti-join**; a ±31-day variant returned 0 for free. Same family as P189's
    normalizer and A2's `strict_core`: *a comparator structurally unable to express the question
    returns a plausible number instead of an error.*
  - **`property_id IS NULL` is NOT a dangling reference**, and dangling was **0 and structurally
    impossible** — `fk_pse_property … **ON DELETE SET NULL**` nulls the link instead of stranding
    it. ⚠️ **A `LEFT JOIN target … WHERE target.pk IS NULL` lumps "points nowhere" in with "points
    at nothing"** — I reproduced the brief's own error that way before catching it. **Decide which
    one you mean, in SQL, before counting.**
  - **`transaction_state` was never read.** The "$529.6M invisible to the spine" is **quarantine**:
    all three NULL-price twins are `needs_review`/`duplicate_superseded` with
    `exclude_from_market_metrics = true`. Live population: **1,687 live twins · 7 quarantined
    ($604.1M) · 0 absent · 0 live twins with a NULL price.** **An exclusion check means every
    exclusion column, `transaction_state` included** — not just the ones named
    `exclude_*`.
- **⚠️ A FILTER THAT NARROWS A LOOKUP TO THE ROWS YOU WANT TO *ACT ON* HIDES THE ROWS THAT SHOULD
  *STOP* YOU.** The first propagator filtered its twin lookup to `transaction_state = 'live'` — the
  natural thing to write — which made a **quarantined** twin invisible, so it fell through to
  `INSERT` and would have minted a fresh **live** comp for a sale somebody deliberately excluded,
  straight into the CM book. Caught by the live probe one pass before it mattered. Same shape as
  **A5c's mint/probe asymmetry**: one filter cannot serve two different questions.
- **⚠️ A FAIL-SOFT PATH WITHOUT A LEDGER IS A PERMANENT SILENT NO-OP.** The propagation must not
  abort the operator's save, so it catches — and the first probe immediately surfaced **22P02
  `malformed array literal`** (`text[] || <untyped literal>` parses the literal as an array literal;
  cast `::text`) as a logged `outcome='failed'` with its SQLSTATE. Read
  `v_gov_pse_propagation_health`'s `inserted`/`filled_blanks`, **never `skipped_already_in_spine`**
  — a re-discovery tally that reads exactly like throughput (P159a).
- **⚠️ THE GUARD FOR THIS CLASS CANNOT STRIP COMMENTS, BECAUSE THE DEFECT *IS* A COMMENT.** Every
  other source detector here strips comments first (A1, A5c, N18, B1) so a fix's own prose cannot
  satisfy a grep for the bug — but the correction quotes the old wording on purpose, so the naive
  grep matches the fix. `test/b6cdup-sale-store-canonical.test.mjs` resolves it by **proximity, not
  presence**: the false claim may appear only within 8 lines of a `B6c-dup` marker, with a separate
  assertion pinning that the markers still exist so the rule cannot go vacuously true. A fourth test
  guards the *harm* rather than the wording — `detail.js` must never gain a client-side write to
  `sales_transactions`.
- **⚠️ AND ONE ASSERTION PASSED ITS OWN MUTATION.** The gov guard grepped the whole file for
  `transaction_state IS DISTINCT FROM 'live'` — which **also appears in the twin lookup's
  `ORDER BY`** — so deleting the gate left it green. **A file-wide grep for a predicate that
  legitimately appears twice is not a guard; anchor on the branch** (`test_b6cdup_pse_propagation.py`,
  12/12 mutations RED after re-anchoring).
- **NOT ported to dia, deliberately.** dia is **72 views : 2**, not 77 : 0, and has real PSE
  consumers (`fn_listing_close_if_sold` reads `pse.sales_transaction_id` — why dia has that FK and
  gov does not). **Both of the gov propagator's calibrated decisions are gov measurements** (the
  month-truncation key; the quarantine vocabulary) and must be re-derived. Backlog **B6c-dup-dia**.

## C10 — a CONSUMER can read columns its source has never had, and nothing errors (2026-08-31)

`handleProspectingBrief` (the operator call sheet) mapped `v_bd_cadence_dashboard` onto display
fields using **six names the view has never had** — `name`, `contact_name`, `company_name`,
`org_name`, `annual_rent`, `priority_signal` — while the view supplies **`entity_name`** and
**`rank_value`**. PostgREST returned its 37 real columns, JS read `undefined` off the rest, and
**every one of the 126 rows rendered `Unknown — unknown [mixed] … rent unknown … Signal: none`.**
One JS change, no migration. Writeup:
`docs/audits/C10_PROSPECTING_BRIEF_COLUMN_MAPPING_2026-08-31.md`; playbook **Class 30**.

- **⚠️ THE `||` FALLBACK IS WHAT HID IT — THE MORE POLITE THE DEFAULT, THE LONGER IT SURVIVES.**
  `|| 'Unknown'`, `|| ''`, `|| 'none'`, `|| 'rent unknown'` each render as *plausible absence of
  data*, so a WIRING bug presents as a DATA-QUALITY impression, with no error, no null, and **a
  correct row count throughout**. A field that threw would have been reported in a day. It is
  P137 (*a consumer wired to a producer that does not exist*) at the COLUMN grain, and P134's
  *diff the view's columns against the handler's `select=`* asked of the RENDERER instead of the
  query.
- **⚠️ TWO DEFECTS ON ONE SURFACE HIDE EACH OTHER.** C8 had just put Easterly ($114.9M / 85
  properties), NGP Capital and USAA Real Estate onto this sheet **and every one rendered as
  "Unknown"** — and that is plausibly why the role gate C8 fixed went unexamined for months: **a
  sheet where every row is anonymous is not a sheet anyone works.** On finding a legibility defect,
  re-ask whether that surface's SELECTION was ever really reviewed, and vice versa.
- **⚠️ A CORRECT MAPPING WITH A DISHONEST DEFAULT IS THE SAME P180 FAILURE ONE STEP LATER.** Two
  fields mapped correctly and still lied: `[mixed]` for a NULL `domain` (**93 of 126, 74%**)
  asserts the owner spans verticals — and the view carries a real `is_cross_vertical` nothing reads
  — while a `/yr` suffix on `rank_value` asserts an annual basis that
  `COALESCE(NULLIF(current_annual_rent_total,0), connected_property_value)` does not have for a
  relationship-derived row (C9a). **Fix the fallback text, not only the mapping**, and say the same
  rule to the model in the prompt so it cannot re-introduce the mislabel in prose.
- **⚠️ CHECK WHETHER A DEAD DISPLAY FIELD REACHES A WRITE.** `getFollowUpSuggestions` reads
  `contacts[0].name`, so the chip read *"Draft email to Unknown"* and fired `draft_outreach_email`
  with `contact_name: 'Unknown'`.
- **⚠️ THE BRIEF'S OWN PREDICTIONS NEEDED RE-MEASURING — assert on the population, not the plan.**
  *"Every row has a `rank_value`"* is false (**4 of 126 NULL**), so the renderer tests
  `Number.isFinite`, **never truthiness**, and a genuine **$0** stays `$0`.
- **Guard: `test/prospecting-brief-column-mapping.test.mjs` (3 tests, all 5 mutations RED).** Two
  layers, because column-checking the query cannot catch the second: *map reads ⊆ the view's
  columns*, and *renderer reads ⊆ the keys the map produces* — the latter is how `priority_signal`
  survived, read by a template nothing ever set. ⚠️ **It strips comments first, and that is
  load-bearing:** the fix's own comments name every banned column 5 times while explaining the bug,
  so a raw-source detector finds them all present and passes over a regression (A5c / N18).
- ✅ **C10b — SHIPPED 2026-08-31 as C11 (below). The wording here was right and the NUMBER was not:
  corroboration is 22 of 113, not 16.**

## C11 — the call sheet named a person and never said why (2026-08-31)

**121 of the 126 call-sheet rows carry a recorded owner→contact relationship whose role is on
file, and the sheet printed none of it.** C10 made the sheet legible; legibility is exactly what
makes an unjustified contact dangerous, because the sheet now names a person at scale with no
basis for the operator to weigh. One JS change in `handleProspectingBrief` + two appended view
columns (`20260831140000`, applied). **Rows served 126 → 126; gate, ordering and limit untouched.**
Writeup: `docs/audits/C11_CALL_SHEET_CONTACT_BASIS_2026-08-31.md`.

| basis (`metadata->>'role'` on the owner→contact edge) | rows | corroborated | rank value |
|---|---:|---:|---:|
| `prospecting_contact` | 58 | 20 | $714.7M |
| `institution_decision_maker` | 35 | 0 | $56.3M |
| `manager` | 15 | 0 | $52.4M |
| ⚠️ `works_at` | **12** | 2 | **$130.7M** |
| **no edge at all** | 5 | 0 | $3.6M |
| `decision_maker` | 1 | 0 | — |

- **⚠️ COUNT THE VALUE, NOT JUST THE ROWS — IT INVERTS THE PRIORITY.** `works_at` is the
  Salesforce org edge **P161 measured and disqualified** as evidence of control. At 10% of rows it
  looks like a footnote; it carries the **second-largest value block, 2.3× the 35
  `institution_decision_maker` rows**, and **3 of the top 10** (USAA Real Estate $62.0M, Gba
  Associates $27.2M, Beacon Capital $23.8M). The weakest evidence sits at the head of the sheet,
  and it was rendering identically to `decision_maker`. It now says *"association only (Salesforce
  org edge), not evidence of authority"*, and the prompt says the same so the model cannot promote
  it in prose.
- **⚠️ THE CORROBORATION FIGURE WAS AN ARGUMENT-SHAPE ARTIFACT — 22 of 113, NOT 16.**
  `lcc_tier0_company_confirms_domain(p_company, p_sldn)` does bidirectional substring containment
  between `lcc_owner_domain_core(company)` and `p_sldn`, and **`p_sldn` is the second-level LABEL,
  not the domain.** Passing `beaconcapital.com` where it wants `beaconcapital` silently kills the
  **reverse** arm — an owner core never contains a `.com` — losing every
  domain-abbreviates-the-owner case. Six rows, all genuine on named rows: `truist.com` /
  `brookfield.com` / `highwoods.com` / `beaconcapital.com` / `acquestdevelopment.com`, plus
  **`tiaa-cref.org`**, recovered only by the alphanumeric strip. The view reuses
  `v_lcc_tier0_owner_contact_candidates`' own `sldn` expression **verbatim** rather than inventing a
  second one. ⚠️ `lower()` runs BEFORE the `[^a-z0-9]` strip.
- **⚠️ THE CORROBORATION IS AN ADDITIVE POSITIVE AND THAT IS NOT A STYLE CHOICE.** P188 established
  the asymmetry on named rows: a real employee can use a personal address, and **Easterly's own
  confirmed contact sits on `@centurytel.net`**. `false` means *we hold no corroboration*, never
  *wrong person* — so 22 of 113 is a **LOWER BOUND, not "91 are wrong"**. Nothing filters, ranks or
  demotes on it; doing so would drop ~91 real owners and re-create the Class 24 mistake **C8 has
  just finished undoing on this very surface**. Guarded structurally, because an absence cannot be
  observed from one row's output.
- **⚠️ ROLE AND CORROBORATION ARE INDEPENDENT, AND ROW 10 PROVES IT.** Beacon Capital Partners'
  contact is `jbrown@beaconcapital.com` — the domain corroborates the employer perfectly — and the
  only relationship on file is `works_at`. **Corroborating where someone WORKS says nothing about
  whether they DECIDE.** Collapsing the two into one confidence score loses exactly that.
- **⚠️ THE C8 PRE-AGGREGATE PRECEDENT IS THE WRONG SHAPE HERE — MEASURED BEFORE CHOOSING.** C8
  pre-aggregates specifically to avoid a correlated probe, so copying it was the obvious move.
  `entity_relationships` holds **115,726 rows** against `lcc_property_owner`'s 8,636, and a
  `DISTINCT ON (from,to)` pre-aggregate materialises the whole table on every read. On the
  handler's REAL query shape: baseline **275–282 ms / 99,528 buffers** · `LEFT JOIN LATERAL …
  LIMIT 1` (shipped) **253–259 ms / 106,126 (+6.6%)** · pre-aggregate **649 ms / 184,857 (2.6×
  slower)**. **Table size decides which hazard applies; the shape that is right for one join is
  not automatically right for the next.**
- **⚠️ `LIMIT 1` IS THE FAN-OUT GUARD, NOT LUCK.** `entity_relationships` has **no unique
  constraint** on `(from,to,type)` (P177). Today max_edges = 1 and 0 conflicting roles — but under
  `DISTINCT ON (c.id)` a future fan-out would not change the row count, it would **silently pick
  one arbitrarily**. The `ORDER BY` (still-effective → newest → id) makes the pick deterministic.
- **⚠️ COMPUTE AN INDEPENDENT SIGNAL OUTSIDE THE JOIN THAT CARRIES THE OTHER ONE.** Folding the
  corroboration into the role LATERAL would make it NULL for every edge-less row — and **all 5 of
  those carry an email**, so *"no relationship on file"* would have silently swallowed a
  perfectly computable signal.
- **⚠️ THE ROLE VOCABULARY IS NOT CLOSED.** `MGR`, `broker_of_record` and `economic_owner_contact`
  each occur fleet-wide. The token prints **verbatim**: an allowlist with a friendly fallback would
  swallow exactly the tokens worth seeing — a `broker_of_record` on a BD call sheet **is** the
  signal (`account-based-contact-intelligence.md`: brokers are never prospected as principal-buyer
  contacts).
- **⚠️ A LIVE EQUIVALENCE DIFF HAS TO SURVIVE LIVE DATA (P188, again).** The view gate read
  2,304 → 2,304 rows with **3 rows differing each way** — and all three carry
  `next_touch_due = 2026-06-21 19:32:4x`, i.e. `now()` crossed the 70→71-day boundary between
  snapshot and diff. Excluding only the two `now()`-dependent columns the diff is **0 both
  directions**, positive-controlled at 2,304 on a deliberately mutated name (P182).
- **NOT done, deliberately:** no filter and no re-rank on corroboration (C9a owns `rank_value`); no
  corroboration classifier (lexical owner↔person matching measured at ~25% raw / 4-of-6 guarded —
  the edge role is a RECORDED FACT); no change to the pitch (**C4a**, Scott's); and **not routed to
  Tier 0** — only **12 of 126** eligible owners are on that lane, which selects on a different basis.
- **Verify on the basis distribution (58/35/15/12/5/1), never on the row count** — the count is the
  safety property, the basis is the deliverable. Guard
  `test/call-sheet-contact-basis.test.mjs` (7 tests, **all 10 mutations RED**, comments stripped —
  the fix's own comments say `works_at` and "association only" repeatedly). The C10 guard needed
  the two new columns added to its `VIEW_COLUMNS` and **that is the guard working**: it was verified
  RED with the additions removed, which is what forces view and handler to move together.
- 🔴 **Found while shipping, filed not fixed:** **C11a** `institution_decision_maker` is 0-for-35 on
  corroboration against `prospecting_contact`'s 20-of-58 — two very differently-sourced lanes on one
  sheet. **C11b** one cadence contact is **Scott himself** (`Edwin K.S. Ryu` →
  `sabriggs@northmarq.com`). **C11c** 2 of the 5 edge-less rows point at a BROKERAGE mailbox
  (`@srsre.com`, `@triprop.com`) — `is_brokerage` reads the OWNER name, so it structurally cannot
  see a broker in the CONTACT slot.

## C13b — the owner-role classification is a SET, and three of its inputs were wrong (2026-09-01)

`v_lcc_entity_roles` (LCC Opps) is live: **one row per (entity, role)** carrying the evidence arm
that produced it, its dates and its pacing. **10,655 entities carry ≥1 role (was 4,132), 946 carry
≥2 (was structurally impossible), 0 duplicate (entity, role) pairs.** A VIEW over the existing spine
— **not** a table, **not** a second cross-DB roll-up (`lcc_entity_portfolio_facts` IS that roll-up),
**never** a stamped column. `entities.owner_role` is left in place. **P0.4 555 → 555; the deal bands
621 → 621; no consumer repointed; nothing writes.** Migration `20261005120000`; guard
`test/c13b-entity-roles-multilabel.test.mjs` (19/19 mutations RED). Writeup
`docs/audits/C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md`; canonical
`docs/architecture/owner-role-classification.md` **§7**.

- **⚠️ `repeat_buyer` WAS 3,258 AND IS 401 — AN EDGE COUNT IS AN OBSERVATION COUNT.** Scott's
  definition says *"more than one ASSET"*; `entity_relationships` has **no unique constraint on
  `(from, to, type)`** (P177) and `purchases` is fed independently by `costar_sidebar`,
  `costar_deed` and `rca_deed`. Keyed on distinct assets it is 401 (385 after guards). Read on named
  rows the 2,857 difference is address-named single-asset SPEs — **Korea Investment Corporation
  reading as a repeat buyer on ONE property recorded twice**, `Stoneforge Advisors LLC by ARA` with
  five byte-identical edges on one asset, `1300 Pine Avenue Llc` holding `1300 Pine Ave`.
  ⚠️ **The obvious middle key was measured and rejected too**: `(asset, date)` gives 735 and the
  extra 334 are A2b's cross-source lag — *a second observation is not a second acquisition*.
  **The number had been carried through three documents unchallenged**, and it also produced the
  design's *"2,627 repeat buyers dormant 5+ years"*, which is **219** on the corrected population.
  ⚠️ **Before keying an arm on a relationship table, ask what one row of it MEANS** — here, one
  observation of a conveyance, by one source.
- **⚠️ A MANUAL OVERRIDE REPLACES THE COLUMN AN ARM READS; IT DOES NOT SIT BESIDE IT.** In a
  multi-label world "both are true" is the tempting default, and it was wrong: **119 live entities
  carry `owner_role='developer'` AND a human `behavioral_override` of `buyer`** (one more
  `operator`). Those are somebody reading the gov classifier's verdict and saying *this is not a
  developer* — which is what `coalesce(behavioral_override, owner_role)` on
  `v_entities_effective_role` has always meant. Emitting `developer` anyway resurrects exactly the
  machine call the human corrected: **838 → 718**. The mirror `true_owner_is_operator` flag is
  INDEPENDENT evidence and is *not* suppressed by an override of a different value.
  **The override rides VERBATIM** — `buyer` (124) stays `buyer` and is deliberately NOT in the
  derived vocabulary, because remapping it to `investor_owner` hands a consumer a false positive.
  ⚠️ **46 overrides sit on merged-away tombstones** and are excluded (425 total, 379 live).
- **⚠️ `one_off_owner` RESTS ON `entities.entity_type`, WHICH IS WRONG IN BOTH DIRECTIONS — SURFACED,
  NOT PATCHED.** The arm is Scott's definition against the recorded fact (person-typed, one current
  asset, 142). Read on 20 named rows, the top ten by rent are **Jamestown $22.8M, Gates Hudson,
  Metropolitan Life Insurance $11.8M, Gladstone Commercial, SkyREM, Samaritan's Purse** — all typed
  `person` — and the bottom ten add `AvalonBay`, `BREIT`, `Apollo Global RE`. The mirror image is
  live too: **979 `former_owner` rows are typed `organization` and read as individuals**
  (`RICHARD LEBOS`, `MITCHELL IDOL`, `Kristen E Pigman`).
  - **⚠️ AND `first_name`/`last_name` LOOKS LIKE THE CORROBORATION AND IS A RE-SPLIT OF THE SAME
    STRING** — `Metropolitan` / `Life Insurance`, `Samaritan's` / `Purse` — and is ABSENT on a real
    individual (`Kalven Cederberg`). That is P125's *a proxy for a fact you already hold is not a
    measurement*, caught before it shipped as a gate. Genuinely independent signals were checked and
    are all zero: **0 of 142 carry a `salesforce/Account` identity, an inbound `works_at` edge or an
    `org_type`.**
  - A name test is banned by the design **and would not have worked**: `lcc_looks_like_person` flags
    28 of 142 and is the documented two-capitalised-tokens false positive (A2a held six real
    companies on it). So the role is emitted as the recorded fact says and
    `v_lcc_entity_role_ambiguity.one_off_owner_rests_on_recorded_entity_type` states that
    "individual" is unverified. **The blast radius is a label, not a write** — all 142 also carry
    `investor_owner`, so a wrong one removes nothing and admits nobody.
  - ⚠️ **THE "ALL ZERO" SENTENCE ABOVE IS SUPERSEDED — C13c FOUND THE CORROBORATION ON THE FOURTH
    COLUMN NOBODY CHECKED.** `salesforce/Account`, `works_at` and `org_type` are all genuinely 0, and
    **`salesforce/Contact` is 13 of 142** — read on named rows, 12 unmistakable individuals (Martin
    Starr, Denis Rodger, Sarita Mutscher…), and **ZERO of the institutional names carry one.** *Three
    absences are not an exhaustive search*, and the positive control is what made the fourth worth
    building on. See the C13c section below.
- **⚠️ THE OBVIOUS VIEW SHAPE WAS 48× SLOWER ON THE ONE QUERY THE CONSUMER MAPPING ISSUES.** Eight
  `union all` branches over a MATERIALIZED `cand` CTE cannot push `entity_id = ?` down — **a CTE
  referenced nine times is always materialized** — so the `EXISTS (… WHERE entity_id = ? AND role =
  ?)` probe scanned all 13,280 candidates nine times: **39,968 buffers / ~686 ms → 1,787 / ~13 ms**
  once rewritten as ONE `cand` scan (`not materialized`) with the arms as a LATERAL VALUES list.
  ⚠️ **That alone made the ranked scan 2.4× SLOWER** (718 → 1,759 ms), because inlining evaluates an
  expression referenced in all eight VALUES rows eight times per candidate — 106,240 name-guard
  calls instead of ~11,700. **Moving the guards to a single predicate over the surviving
  (entity, arm) pairs is what made the inlined shape faster than the materialized one** (362 ms).
  Both halves were needed; either alone regresses one shape. **Quote BUFFERS** — wall-clock on this
  box moved 2–4× between sessions on unchanged SQL. No `loops=` subplan in either shape, so
  materialization was not required and was not added.
- **⚠️ CHURN ARGUES *FOR* THE VIEW, AND THE DESIGN'S NUMBER DESCRIBED ONE ARM.** 3 holdings ended and
  1 started in 90 days — reproduced exactly — but **`purchases` gained 6,501 edges in the same
  window**, which is what moves `repeat_buyer`. A nightly stamped column would be stale against
  those; a view cannot be. ⚠️ `lcc_entity_portfolio_facts.updated_at` moved on **14,113 of 14,119**
  rows (the nightly re-upsert) and is useless as a churn signal.
- **Absence is never dormancy.** `pacing_unknown` where the date is missing (2,186 `investor_owner`,
  1 `repeat_buyer`); the quiet bucket is `quiet_5y_plus`, never "dormant". ⚠️ **Each arm paces off
  ITS OWN dates and their coverage differs by 33 points** — `repeat_buyer` off `effective_from`
  (98.8% dated), `investor_owner` off `ownership_start_date` (66% of entities). So **the 50.7%
  blindness C18 exists for belongs to `investor_owner`, not to repeat-buyer pacing**, which is a
  correction to the design's own framing.
- **`user_owner` is a human-confirmed lane and reads 0 by design.** 15 candidates (owner core ==
  tenant core on a property it holds), read on named rows: **10 genuine owner-occupiers, 5 of one
  failure shape** — an SPE/DST named after its tenant (`FSC FMC Carbondale IL DST`,
  `USGBF NIAID LLC`, and the two new ones `NOAA Maryland LLC`, `MORGANTOWN GSA USDA, LLC`).
  `lcc_entity_role_confirmation` is the INPUT ledger and ships empty — without it the lane is a
  consumer with no producer. ⚠️ **`lcc_owner_name_is_not_prospected` is SURFACED, never
  suppressing** (228 role-bearing entities carry it, Wake Forest and Mayo among them): a
  classification is a fact about the party; whether we prospect them is a different gate.
- **⚠️ C13's "477 + 35 ambiguous" DO NOT REPRODUCE — the SET dissolved them.** Both were artifacts of
  the precedence ladder and of C13's org-inclusive `one_off_owner`: under a set, an entity holding
  one asset that buys repeatedly is simply BOTH. The real residue is **298 rows** on
  `v_lcc_entity_role_ambiguity` (142 / 129 / 15 / 12). **Say so rather than quietly reporting
  different numbers.**
- **Verify on the ARM POPULATIONS and the overlap matrix, never the row count** — 11,631 rows would
  read identically if every entity carried one wrong label.

## C13c — an escalation must carry its confidence, and the fourth column answered (2026-09-01)

`one_off_owner` **142 = 13 `_sf_corroborated` + 129 `_unverified`**, the count deliberately
unchanged; **21 named institutional rows** routed to
`v_lcc_entity_role_ambiguity.entity_type_contradicted_by_named_review` off the
`lcc_entity_role_confirmation` ledger. Every other arm, `v_lcc_user_owner_candidates` (15), the
multi-role count (954) and **P0.4 (555)** unmoved. Migration
`20261006120000_lcc_c13c_one_off_owner_confidence.sql`; guard
`test/c13c-one-off-owner-confidence.test.mjs` (9 tests, **21/21 mutations RED**). Writeup:
`docs/audits/C13c_ONE_OFF_OWNER_CONFIDENCE_2026-09-01.md`; canonical
`docs/architecture/owner-role-classification.md` §9.

- **⚠️ "NO CORROBORATION EXISTS" WAS THREE ABSENCES, NOT A SEARCH.** C13b checked
  `salesforce/Account` (0), `works_at` (0) and `org_type` (0) and concluded the arm had no
  non-lexical signal. **`salesforce/Contact` is 13 of 142** and separates the population exactly:
  12 of the 13 are unmistakable individuals and **ZERO of Jamestown / BREIT / AvalonBay / Brixmor /
  Alexandria / MIT carry one.** **The positive control is the half that matters** — a signal that
  only ever fires is worthless; this one is silent on precisely the rows that must be excluded.
  **Before recording that a fact has no corroboration, enumerate every identity the table can hold**
  (the P197 lesson — `unified_contacts` has five link columns and the email-keyed detector reported
  the other four's population as absent).
- **⚠️ THE DISPOSITION IS A CONFIDENCE SPLIT — 142 → 13 AND 142-FLAT ARE BOTH WRONG.** Filtering
  membership on the corroboration discards `Maslow Robert C & Michele C` and every genuine
  individual simply absent from Salesforce; asserting all 142 flat is what put a **$22.8M
  institutional manager on a one-off-INDIVIDUAL lane.** So the **`evidence_arm` carries the
  confidence** and the surface gates on it — **P181 one layer down: a genuine judgement call and a
  worthless one must not wear the same label.** The membership predicate is byte-identical to
  C13b's, and a guard goes RED if `has_sf_contact` ever reaches it.
- **⚠️ THE REVIEWED ROWS ARE A LEDGER, NEVER A STOPLIST IN THE CLASSIFIER** (the §8 `user_owner`
  pattern). The classifier holds no name literal; the guard rejects `entity_name = '…'` **and
  `entity_name NOT IN (…)`** — the `NOT` form walked straight past the first cut of that assertion
  and was found by the mutation pass, not by reading it.
- **⚠️ THE PROMPT'S PROSE AND ITS NUMBERS DISAGREED, AND THE NUMBERS WON.** "…so they stop being
  emitted as individuals" against an assertion table reading **142 unchanged, split 13/129**, which
  leaves no room for a suppressed set. Shipped the split, not the suppression, and **proved the
  reason rather than asserting it: all 21 keep `investor_owner`**, so the wrong label removes nobody
  and admits nobody today. Filed **C13f**.
- **⚠️ THE ROUTED SET IS 21, NOT ~15, AND THE EXTRA 6 ARE THE ARM'S BIGGEST ROWS.** The prompt's list
  is drawn from the 28 that FAIL `lcc_looks_like_person`, so it structurally cannot contain
  **`Gates Hudson` ($19.6M)** or **`Metropolitan Life Insurance` ($11.8M)**, which the design page
  had already read and which **pass** the name test. **A list filtered by a failing instrument is
  not the population** — restricting to it would have left #2 and #3 by rent unmarked while marking
  `EJME` at $0.
- **⚠️ THE UNCORROBORATED 129 ARE ~80% RIGHT, AND NOBODY HAD MEASURED IT.** A deterministic 10-row
  sample (`order by md5(entity_id::text)`) reads **8 clear individuals, 1 clearly not, 1 ambiguous**.
  **The 28 name-test failures are not a random sample of the 129** — reasoning from them understates
  the arm badly, which is why the split keeps them rather than deleting them.
- **⚠️ DO NOT QUOTE THE LEXICAL NUMBER WHEN SIZING `entities.entity_type`.**
  `lcc_looks_like_person` flags **13,225 of 43,154 org-typed entities (30.6%, $535.7M)** and on this
  arm it PASSES `Gates Hudson`, `Metropolitan Life Insurance` and `Gladstone Commercial` — it
  measures the regex, not the population (Class 11). The non-lexical floor is **414 of 56,192
  (0.74%)**: 338 person-typed carrying a `salesforce/Account` ($0 rent), **76 org-typed carrying a
  `salesforce/Contact`, $181.8M**. `works_at` yields **0 contradictions in either direction** and
  carries no signal here at all. **The only defensible size is the hand read: 21 of 142 ≈ 15% ⇒
  ~1,950**, offered as an estimate from one non-random sample. Backlog **C13g**.
- **⚠️ THE PRODUCER IS THE TRANSACTION VENDORS, NOT THE CLASSIFIER.** Of the 142, **115 carry
  `rca/contact` and 32 `costar/contact`** — the buyer/seller party slot of a deal record, which is
  where a COMPANY is filed as a "contact" and minted `person`-typed. ⚠️ The tempting inverse (a
  vendor `company` identity on a person-typed row) was measured at **2 of 3** — `Sarita Mutscher` is
  a real individual **and one of the corroborated 13** — and **not wired**, the same n-too-small
  trap as every lexical signal this arc rejected.
- **⚠️ CORROBORATION IS GROWING AND ITS CEILING IS THE POPULATION, NOT THE FEED.** 395 new
  `salesforce/Contact` identities in 30 days across 22 days, newest 2026-08-31 (though July alone
  holds 8,328 of 10,083). But **9,819 of 13,038 live person-typed entities (75%) already carry one
  against 13 of 142 (9%) here** — this arm is RCA/CoStar capture the CRM has never held, so waiting
  will not lift it. Backlog **C13h**.
- **Cost, measured both ways (§7.7 made shape load-bearing).** The corroboration is a **CTE
  mirroring `op`, never a per-row `EXISTS`**. Single-entity probe **60 → 63 buffers** (+3, the
  predicate pushes down — the property §7.7's rewrite protects); ranked scan **39,968 → 50,861
  (+27%) → 44,204 (+10.6%)** once a **partial** index made the `sfc` leg an Index Only Scan
  (10,893 → 4,236). **P118 corollary 2** (the aggregate is already hoisted, so an index IS the fix)
  and **corollary 3** (the query must IMPLY the partial predicate — `sfc` states it verbatim).
  Wall-clock is not quoted; it moved 748 → 349 ms on a box with 2–4× session variance.
- ⚠️ **`test/c13b-entity-roles-multilabel.test.mjs` NOW READS THE C13C MIGRATION.** C13c rebuilds the
  view, so 20261005120000 no longer describes what ships and a guard pointed at it would assert
  invariants over code nobody runs (P197). All 11 C13b invariants pass over the shipped definition.
  **Whoever rebuilds this view next repoints that constant in the same change.**

## UX-T0 — the app defect sweep: four hypotheses refuted, two removals refused (2026-09-02)

Twenty T0 rows from Scott's app walk-through. **9 fixed · 4 owned elsewhere · 4 mechanism
hypotheses REFUTED · 2 removals refused on measurement · 2 not measured.** Writeup
`docs/audits/UXT0_APP_DEFECT_SWEEP_2026-09-02.md`; guard `test/uxt0-defect-sweep.test.mjs`
(22 tests, **15/15 mutations RED**). Headline deltas: sellers **0/$0 → 2,142/$13.48B**,
Overview on-market **461 → 207**, Metrics roster **42 → 4**, building SF **24,044 → 8,646**.

- **⚠️ A CONSUMER CAN ASK FOR A COLUMN ITS SOURCE HAS NEVER HAD — AND THE SIBLING ARM IS THE
  POSITIVE CONTROL.** dia `sales_transactions` carries `buyer_name`, `buyer_type` and
  `seller_name` but **no `seller_type`**. The Players tab's two arms are identical except for
  that column, so buyers worked and **sellers rendered "0 in dataset / $0" over 2,142 sellers and
  $13.48B**: PostgREST 42703 → `diaQuery` returns `[]` → `diaQueryAll` breaks out on the short
  page → the `catch` never fires → `[]` is truthy so the renderer draws zeros. **When one of two
  near-identical surfaces works, diff their column lists before reading either renderer** — it is
  one query against `information_schema`. This is **C10 at the QUERY layer** rather than the
  render layer, and it is the third instance of that class in this arc.
  - **`diaQuery`'s `throwOnError` was added 2026-08-29 for exactly this and left ~70 callers on
    the default.** Sellers was one of them. **Any surface whose empty state asserts something
    about the DATA must opt in** — "0 in dataset" is such an assertion.
- **⚠️ A MIGRATION IN THE REPO IS NOT A MIGRATION IN THE DATABASE, AND A POLITE FALLBACK HIDES
  THAT FOREVER.** `20260429900000_*_v_listing_verification_summary_breakout_inferred.sql` exists
  for BOTH domains, is correct, and had **never been applied to either** — for four months —
  while `dialysis.js` read `s.evidence_verifications_7d` behind a comment saying *"falls back to
  the monolithic count when running against a database that hasn't applied the migration yet."*
  The fallback made *permanently unapplied* indistinguishable from *temporarily unapplied*, and
  the card kept reporting **"1400 checks/7d"** where the honest breakout is **0 evidence / 1400
  cron-only**. *Merged is not running*, in its quietest form: nothing errored.
  - **⚠️ AND BEFORE APPLYING AN OLD MIGRATION, DIFF THE LIVE VIEW AGAINST THE FILE.** gov's body
    is NOT dia's (`listing_status` + `exclude_from_listing_metrics` vs `is_active`); applying
    dia's to gov would have silently rewritten gov's semantics. Reading the live gov definition
    first — and finding it matched the file's first nine columns exactly — is what made the apply
    safe.
- **⚠️ "TOO LARGE" IS A DISTRIBUTION QUESTION BEFORE IT IS A UNIT QUESTION.** The Inventory
  building-size tile was filed under the I12 acres/sq-ft class. It is not: `building_size` is
  genuinely square feet and the **median is 8,646 sf**, right for a dialysis clinic. The tile
  showed the **arithmetic MEAN, 24,044 sf** — dragged **2.78×** by 357 rows carrying the whole
  medical-office building's RBA. **Compare the median to the mean before reaching for a
  conversion**; the ratio names the shape immediately.
- **⚠️ A TILE'S SCOPE BELONGS IN ITS TITLE, NOT ITS SUBTITLE.** "Total Buyers (all dataset)" sat
  beside "Total Deals" that was **top-50 only**, with the scope honestly stated in the small
  print. Two tiles side by side, one counting the dataset and one counting the page, read as one
  population regardless.
- **⚠️ A LATE ASYNC RENDER INTO A SHARED CONTAINER IS A LAST-WRITER-WINS RACE.** Deals' group
  default is `prospects` (Pipeline), whose loader is the slowest in the app; clicking another
  sub-tab mid-load switched the tab correctly and then the in-flight
  `loadMarketing().then(() => renderDomainProspects(...))` wrote Pipeline back into
  `#bizPageInner`. **Seven** such deferred renders existed, none checking its own tab at RESOLVE
  time. Not a navigation bug.
- **⚠️ TWO MEASURED REMOVALS WERE REFUSED, AND BOTH LOOKED SAFE.** *National ST* is one nav button
  and one `else if` — and the **only** route to 18 live `cm_natl_st*` views (480 rows) and the RCA
  upload card that feeds the Single-Tenant quarterly book. *All Other* is not duplicative of
  Prospects: `renderProspects()` is a **search box that renders nothing until you type**, and
  `all_other` holds **6,245 opportunities — the largest domain bucket** (gov 3,176, dia 2,410).
  **"Check nothing is lost" has to be an inventory, not a grep for the route name.**
- **⚠️ FOUR OF THE FIVE MECHANISM HYPOTHESES I WAS HANDED WERE WRONG, AND EACH WAS PLAUSIBLE.**
  The Ownership lane's `limit: 500` and its "covering 500 properties" are **a coincidence** —
  `sum(canonical_total_properties)` over its 16 canonicals is exactly 500 (so the round-number
  footgun *pattern-matched* and the arithmetic refuted it). The verification feed never selected
  the NULL price columns. Kelly's writes land — `email_bodies` is 0 for **three** of the four
  team members, i.e. one mailbox is synced, not a rejected write. `is_northmarq` **is** set on
  Woodland Hills; `sf_deal_id` is non-null on **0 of 4,785** sales. **A named mechanism in a
  brief is a hypothesis to test first, and the cheapest test is usually the arithmetic.**
- **⚠️ MY OWN GUARD PASSED ITS OWN MUTATION TWICE.** A bare `/is_team_member/` search stayed green
  when the `.filter()` was deleted (the token also appears in the `_flagged` probe one line up);
  `/_hidden/` stayed green when the disclosure branch was mutated to `if (false)` (the `const`
  still declared it). Both are the documented *a guard that matches a shape is defeated by a name
  that legitimately appears elsewhere*, and **the mutation pass found them, not reading them.**
  Comment-stripping is also load-bearing here rather than hygiene: every fix explains itself by
  naming the token it removed (`seller_type`, `diaAvailListings`, `'all'`), so a raw-source grep
  finds them all present and passes over a complete revert.
- **⚠️ THE METRICS ROSTER'S DISCRIMINATOR IS `lcc_users`, AND `auth.users` CANNOT DO IT.** The
  roster showed **42** "team members" — ~21 email local-parts title-cased (`Aaminov`, `Ccouch`,
  `Tscrivner`…), 3 system mailboxes (`Noreply`, `Support`, `Powerautomatenoreply`), one literal
  `" <>"`, and **four** Scott Briggs rows (three operators at zero beside the one owner holding
  all 58 active / 49 overdue). The recorded fact already existed: `lcc_users` = **4 active
  people**, bridged to `public.users` by email (the same bridge `v_lcc_entity_point_person`
  uses). **The obvious test — "only show people who can sign in" — returns an EMPTY roster:
  0 of 42 memberships carry an `auth.users` identity, including the real owner.** Shipped as an
  appended `is_team_member` FLAG, never a filter: nothing is deleted, no access is revoked, and
  the surface states how many rows it is not showing. The producer that mints those memberships
  from correspondence is **UX48a, not fixed**.

## OWN-T0 — the panel showed four ownership stores and reconciled none of them (2026-09-02)

> 📍 **The property panel's ownership read is now ONE view:
> `v_lcc_property_ownership_reconciled`.** Canonical page:
> [`docs/architecture/ownership-history-lane.md`](docs/architecture/ownership-history-lane.md)
> § OWN-T0. Audit: `docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md`.

Scott, UX23: *"almost every property I open seems to have similar errors … even conflicting on the
property's own ownership history tab, like no reconciliation is occurring."* He is right at
population scale and **the standing detector read zero**. `_udTabOwnership` assembled its answer
from four stores nothing reconciled — `lcc_property_owner` (the Current Owner card), the domain
`v_ownership_current` (the ladder), `lcc_entity_portfolio_facts` (the portfolio line) and the domain
`v_ownership_chain` (the timeline) — and printed one name in the headline with a different one two
lines below, with no relationship stated between them. Measured: **1,260 of 7,678 (16.4%)** resolved
owner vs domain true_owner · **667 of 5,964 (11.2%)** resolved owner absent from the current facts ·
**756 of 8,068 (9.4%)** properties with more than one CURRENT owner · and, inside gov itself,
**1,509 of 3,474 (43.4%)** latest-transition grantee vs `properties.true_owner_id`.

- **⚠️ FILL-BLANKS ON A PROPERTY FACT IS A QUESTION ABOUT THE PROPERTY, NOT ABOUT ONE OWNER.**
  Every writer of `lcc_entity_portfolio_facts` keys "already recorded?" on
  `(entity_id, source_domain, source_property_id)` — the OWNER-property pair — so none of them asks
  whether the PROPERTY already has a current owner. P117's candidate CTE is the clearest instance
  (`where pf.entity_id is null`, under a comment reading *"FILL-BLANKS: never touch an existing
  row"*) and it accounts for **632 of the 756 (83.6%)**; p117-beside-p117 is 0, so it is a
  CROSS-writer defect, not a within-writer one. The function has **no cron**, and its own drift view
  invites re-running it: a re-run under the old predicate inserts 2,595 rows of which **480 would
  mint a NEW second current owner ($400.3M)**. Fixed at the property grain; the skip is named
  `skip_property_has_current_owner`. Same family as C1's *lane-predicate column vs writer column*,
  one grain up.
- **⚠️ A MULTI-CURRENT PROPERTY IS USUALLY NOT A DATA ERROR — IT IS ONE ASSET HELD AT TWO LEVELS,
  AND THE PRESCRIBED REPAIR WOULD HAVE DESTROYED A TRUE FACT.** The brief said end-date the earlier
  owner, date-ordered. Read on the **top 60 by rent** rather than counted, the class is dominated by
  **sponsor ↔ SPE**: `USAA Real Estate || Usgbf Tsa LLC` ($26.7M), `Trammell Crow Co || USBGF
  SENTINEL SQUARE III` ($24.1M), `Boyd Watterson || Boyd Ashburn LLC`, `NGP Capital || NGP VI FALLS
  CHURCH VA LLC`, `Easterly || EGP 2300 Des Plaines LLC` — Boyd/FGF ×8, NGP ×5, EGP/USGP ×9. The
  sponsor is who we prospect; the SPE is on the deed and the GSA lease; **both rows are true.** It
  was also unexecutable as written: **523 of 756 are only partly dated, 121 not at all** (P117 writes
  a NULL start by design), and `is_current` is `GENERATED ALWAYS AS (ownership_end_date IS NULL)`, so
  un-currenting a row means **writing a date we do not have.** So OWN-T0 end-dates, deletes and
  repoints **nothing**; it fixes the producer, states the conflict in the view, and makes it
  countable. **A ten-row read is what turned a plausible remedy into a refuted one.**
- **⚠️ THE SAME READ FOUND THREE MORE SHAPES INSIDE THE ONE BUCKET, EACH NEEDING A DIFFERENT
  ANSWER** — `George Washington University` vs `George Washington University (The)` is ONE party in
  two entities (a merge, P195/A2a); `Easterly Gov Properties (REIT)` vs `EastGroup Properties, Inc.`
  is **two different REITs** sharing the `egp` token, the exact collision A3 measured and refused to
  key on; `Cira Square Master Tenant LLC` is a master TENANT in the owner slot. **One blanket rule
  could not have been right for any two of them.**
- **⚠️ A P113 OPERATOR IN THE OWNER SLOT IS NOT A CONFLICT.** The view's first cut counted every
  current claim and **884 properties read `conflict`** purely because a known non-owner sits beside
  the real owner — the badge-that-is-noise failure. `property_state` counts OWNER CANDIDATES;
  operator / brokerage / placeholder links stay on the row FLAGGED. That is what surfaces
  `only_non_owner_claims` = **7,678 properties with no owner on file at all**, which the old count
  hid inside "single owner".
- **⚠️ NO LEXICAL SPONSOR GUESS MAY DECIDE AN OWNERSHIP FACT.** A3 measured
  `lcc_tier0_sponsor_brand_token` at **3 of 74** on GSA SPEs (a government SPE is named for its city
  and agency, not "Propco") and ~25% precision generally; P198 measured co-proposal at 7%. Only the
  human-confirmed `lcc_ownership_sponsor_family` clears a pair — **64 properties today against
  ~1,550 unconfirmed**. An unconfirmed sponsor/SPE pair stays `unclassified_rival`, an honest
  non-answer, and **one confirm clears a whole family** (A3 measured `boyd` at 20 of 24) — that lane
  is the highest-leverage follow-up (**OWN-T0e**).
- **⚠️ `not materialized` IS LOAD-BEARING ON A VIEW A PANEL POINT-QUERIES.** Without it the 3-row
  query is **1,013.9 ms / 216,947 buffers**; with it **20.1 ms / 674** — a multiply-referenced CTE is
  ALWAYS materialized so the predicate cannot push down (C13b §7.7), and `fact` was aggregating all
  14,119 portfolio rows on every panel open. **The detector hit the sibling footgun and TIMED OUT at
  60 s** on correlated scalar subqueries before being hoisted to one join. Aggregates byte-identical
  before and after.
- **⚠️ READ THE LABEL DISTRIBUTION, NOT THE CODE.** `evidence_level='other'` held **3,364** links and
  every one was something the map should have named: 1,965 whose source is the STRING
  `'unattributed'` (so the `is null` arm never saw them) and 1,399 A2 rows sourced
  `gov_ownership_chain:<uuid>`. Corrected, `other` reads 0. A label that says "Other" for *we do not
  know where this came from* is P180 one layer up.
- **The detector that read 0 was CORRECT and NARROW, and is left alone.**
  `v_lcc_portfolio_ownership_conflict` requires a tombstone that is CURRENT beside a survivor that has
  **ENDED** (the P175a shape) — structurally unable to see two LIVE entities both current, which is
  745 of the 756. `v_lcc_property_multi_current` is the complement and carries both defect classes
  separately. Positive control: **756 / $903,291,687**, reproducing the independent baseline exactly.
- **⚠️ VERIFY ON `skip_property_has_current_owner` AND THE DETECTOR'S SPLIT — NEVER ON 756 GOING
  DOWN.** Nothing here end-dates a fact, so 756 is expected to HOLD; the number that moves is the
  growth that does not happen. Guard: `test/own-t0-ownership-reconciled.test.mjs` (20 tests,
  **25/25 mutations RED**; comment-stripping is load-bearing, and a literal-blanker on top of it,
  because the function's own `comment on function … 'Reverse: delete from
  lcc_entity_portfolio_facts …'` puts a banned shape inside a string literal — comments first, THEN
  literals, per OCR1c).
- ⚠️ **One guard survived its own mutation and the mutation pass found it, not reading it**: a bare
  search for `is_owner_candidate` stayed green when the alias was renamed, because the token
  legitimately appears in three other places. It asserts the SUBSTANCE now — that `n_current_owners`
  counts candidates and that candidacy excludes operator/brokerage/placeholder.

## Inert-feature registry (audit §4.4.3) — make "off" visible

Every env-gated capability is catalogued in **`feature_flags_registry`** (LCC Opps; migration
`supabase/migrations/20260809120000_lcc_feature_flags_registry.sql`). Columns: `flag` (PK), `purpose`,
`surface`, `env_var`, `state` (`on|off|partial`, CHECK-enforced), `off_since` (NULL = never enabled /
unknown), `owner`, `notes`. The daily briefing email prints a **"Dormant Capabilities"** section — one
line per flag off (or partial) > 30 days — via `fetchDormantCapabilities()`
(`api/_shared/briefing-data.js`) → `renderDormantCapabilities()`
(`api/_handlers/briefing-email-handler.js`, HTML + plain-text). The audit finding: *a flag-gated no-op
looks identical to a healthy quiet pipeline* — this table is the single source of truth that surfaces it.

- **Whenever you add a new `process.env.<FLAG>` / `Deno.env.get()` capability toggle** (not a tuning
  knob — a whole feature that no-ops when unset), **INSERT a `feature_flags_registry` row** (idempotent
  seed uses `ON CONFLICT (flag) DO UPDATE`). Grep `api/` + `supabase/functions/` for `process.env.` /
  `Deno.env.get` when auditing coverage. SOS per-state adapters are gated in code by
  `SOS_STATE_ADAPTERS[X].enabled` AND the shared `OWNER_ENRICH_SOS_URL` webhook — registered as
  `SOS_STATE_ADAPTERS.<ST>` flags.
- **`state`/`off_since` are operator-curated** — flip a flag's row to `on` (or update `off_since`) when
  you actually enable it in the Railway env; `updated_at` auto-touches on UPDATE.

## dia property "address twins" — Decision Center lane `property_twin` (2026-08-14)

The dia repo ships a geospatial address-twin detector + REVERSIBLE merge (dia
`dia_find_property_twins` / `dia_merge_property_reversible` / `dia_unmerge_property` /
`dia_property_twin_review`; auto-merges only blank-operator husks, routes everything
with a competing clinical identity to review). LCC surfaces the review lane:

- **Federated Decision Center lane `property_twin`** (registered in `api/admin.js`
  `FEDERATED_DECISION_TYPES`, `ops.js` `_DC_FEDERATED` + the lane-tile list,
  `dc-lanes.js` `_DC_FED_META` + card renderer, `review-shared.js` lane map). Source =
  the pending slice of dia `dia_property_twin_review` (closest-first). Verdicts:
  **merge** (→ `rpc/dia_merge_property_reversible`, keep = the CCN anchor, drop = the
  shadow, both taken server-side from the row; stamps `status='merged'` + `backup_id`,
  reversible via `dia_unmerge_property`), **not_twin** (`status='rejected'`), **research**
  (spawns a `research_task`). Badge folded into the `merges_dupes` review-counts lane.
- **No edge-allowlist change / no `data-query` redeploy** — the lane is server-mediated
  via `domainQuery` (direct domain PostgREST with the service key), which bypasses the
  `DIA_READ_TABLES`/`DIA_WRITE_TABLES` edge allowlist. That allowlist only gates
  browser-side `diaQuery` tiles. The one live prerequisite is the dia GRANTs
  (`supabase/migrations/20260814_dia_property_twin_review_grants.sql`, applied to
  `zqzrriwuavgrquhisnoa`) so the service_role PostgREST can read/write the lane + call
  the RPCs.
- **Footgun avoided:** co-located ≠ twin (a Fresenius and a DaVita share one plaza), so
  the lane exists precisely for the human call the auto-pass refuses to make. Merge stays
  reversible; never hard-delete without the snapshot.
- **Prompt 106 — deterministic pre-rank + Ollama assist (annotation-only):** the lane is
  pre-ranked/sorted by a two-layer assist that ANNOTATES but NEVER merges. Layer 1 (NO LLM,
  `api/_shared/property-twin-assist-planner.js::classifyTwinDeterministic`, reuses
  `dup-pair-planner.nameSimilarity`) decides the bulk (same-op/near-identical-name → merge,
  bulk-confirmable; diff-op/`same_norm_address:false`/single-anchor → not_twin) and NEVER
  deterministically not_twins a same-address operator change; Layer 2 (Ollama, `invokeExtractionAI`
  surface `property_twin_assist`) scores the residue with a VERBATIM evidence quote (dropped if not
  a substring of the evidence). Annotations reuse `lcc_clean_assist_proposals` (source
  `property_twin_assist`, keyed `twin:dia:<review_id>`). Tick `GET/POST /api/property-twin-assist-tick`
  (flag `PROPERTY_TWIN_ASSIST`, cron 05:45 UTC, no-op while off). The tick NEVER calls
  `dia_merge_property_reversible` — the merge stays a HUMAN verdict; dc-lanes bulk-confirm targets
  deterministic merges only. Self-measure → `v_lcc_property_twin_assist_accuracy`. Migration
  `20260814130000`.

## dia Deals ▸ Ownership — a curated allowlist wearing a detector's clothes (2026-08-29)

The tab rendered 0/0/0/0 with "No canonical clusters yet — run
`dia_unify_canonical_true_owners` to seed." **It was a statement timeout, not an empty
view.** dia `edge_logs` carried `GET | 500` on
`v_recorded_owner_canonical_clusters?select=*&order=canonical_total_properties.desc&limit=500`
and `postgres_logs` "canceling statement due to statement timeout" **exactly 8 s later** —
PostgREST connects as `authenticator` (`statement_timeout=8s`) and the view measured
**13,923 ms**. Fix + full write-up:
`supabase/migrations/dialysis/20261003120000_dia_ownership_clusters_statement_timeout_fix.sql`,
`docs/audits/DIA_OWNERSHIP_LANE_COVERAGE_2026-08-29.md`. Backlog **P15 / OWN1–OWN7**.

- **⚠️ `diaQuery()` RETURNS `[]` ON EVERY NON-OK RESPONSE — a 500 and an empty view are the
  same pixels.** The loader's `catch` never fired, no toast appeared, and the empty state
  then *recommended a real owner-merge write* (`dia_unify_canonical_true_owners`, which
  exists, so the advice reads plausible) on the strength of an error. Its dry run today is
  **0 created / 14 owners / 7 properties** — it would have fixed nothing and moved rows for
  no reason. `diaQuery` now takes an opt-in `throwOnError` (default false, so the ~70 other
  callers are byte-identical). **Any surface whose empty state asserts something about the
  DATA must opt in**, or it is guessing.
- **⚠️ A PER-ROW plpgsql FUNCTION IS THE WHOLE BUDGET, AND THE VIEW WAS THE WRONG PLACE TO
  FIX IT.** `dia_canonicalize_owner_name` runs `SELECT canonical FROM
  owner_canonical_patterns WHERE s ~ match_regex` — 38 regexes — once per row: 7,255 × 38 =
  **275,618 regex evaluations, of which 72 match**, measured at **8,137 ms** on its own
  (`is_known_operator`, the other per-row call, is 55 ms). Three read-time rewrites were
  implemented and **measured before being rejected** — drop the redundant correlated EXISTS
  13.5 s, LATERAL join the pattern table 7.1 s, drive from the 38 patterns 6.7 s. None
  clears 8 s. The work moved to write time: `recorded_owners.canonical_name` behind a
  single-writer `BEFORE INSERT OR UPDATE OF name` trigger → **133 ms, 105×**, 0-row
  equivalence diff both directions.
- **⚠️ THE STORED CANONICAL TRACKS `name`, NOT THE PATTERN TABLE.** Editing
  `owner_canonical_patterns` does NOT retro-fix stored rows — **run
  `select * from dia_recanonicalize_recorded_owners(false);` after any change to it.**
  `v_dia_canonical_name_drift` is the standing detector (must be 0, positive-controlled) and
  is what distinguishes a fixed producer from a one-shot backfill (Class 8).
- **⚠️ THE LANE IS A READOUT OF 38 HAND-WRITTEN REGEXES, NOT A SURVEY OF DUPLICATE OWNERS.**
  The canonicalizer returns `btrim(name)` on a miss, and there are **ZERO byte-identical
  duplicate `recorded_owners.name` values** — so the only way to cluster is for someone to
  have written a pattern. **72 of 7,255 owners (1.0%)** can ever appear. The panel copy said
  "biggest leverage first" and read as coverage; it now states its own scope.
- **⚠️ WIDENING THE GROUPING KEY BUYS GROUPS, NOT PROPERTIES — measured, then rejected.**
  Case+punct 300 groups / **463 properties**; `dia_norm_owner_name` 385 / **652**; today
  16 / **500**. ~20× the groups for the same properties, because the patterns already cover
  the consolidators and the tail is two-row variants holding 1–2 properties. And
  `dia_norm_owner_name` is the **grouping-for-review, banned-for-identity** class
  (`dup-pair-planner.ownerCore` / `lcc_normalize_entity_name` / `lcc_owner_strict_core`).
- **⚠️ "true_owner IS NULL" IS THE WRONG PREMISE — THE SLOT IS OCCUPIED BY THE TENANT.**
  **0** properties have a recorded owner and a null true owner; the propagation already ran.
  But of the 500 lane properties, **395 (79%)** carry a **flagged** operator as true owner
  (Realty Income's 72 read *American Renal*; MassMutual's 47 read *Fresenius*; Elliott Bay's
  25 all read *DaVita*), plus **4,028 more** properties fleet-wide with no recorded owner and
  an operator in the slot. That is **P113** at scale, so "link the buyer to the company
  record" is a **supersession decision, not a fill** — and `dia_unify_canonical_true_owners`
  correctly refuses it (`is_operator_not_owner IS NOT TRUE` in its plan). The flag is already
  set on all 395: **reuse it, never write a second name-based operator test.**
- **⚠️ AND READING THE ROWS FOUND TWO PATTERN PRECISION DEFECTS A RATE WOULD HAVE HIDDEN.**
  `^healthcare\s+realty(\s+trust)?` has no end anchor → **`HealthCare Realty Solutions`**
  (a different company) canonicalizes into Healthcare Realty Trust; the Sumitomo alternation
  matches any `sumitomo mitsui …` → **`Sumitomo Mitsui Trust Bank`** (a different corporate
  group) is folded into SMBC **and already carries SMBC's `true_owner_id`** — a wrong link
  written, not merely proposed. Same pattern swallows
  `SMBC Leasing & Finance Inc, Stanley F & Jane M Banach` (the P158a `&` hazard on a write
  path). **All three hold 0 properties**, which is why to fix it now; surfaced not applied
  (OWN1) because it is a judgement about company identity.

## CM export — a KPI tile and its data tab must read ONE view (Prompt 119, 2026-08-18)

The 2Q-2026 Dialysis book shipped two numbers for the same metric because a KPI-block view and its
sibling data-tab view each computed their own aggregate over the same base. **A KPI tile is a
projection of a series/table the book already renders — it must READ that view, never restate its
filters.** Two live instances, both root-fixed in the dia views (`Dialysis`
`supabase/migrations/20260818_cm_dia_prompt119_kpi_view_reconcile.sql`, applied live — CM reads views
per request, so no redeploy):

- `cm_dialysis_whatsnew_kpis.cap_ttm` read `cm_dialysis_market_quarterly.avg_cap_rate` (a
  single-quarter SIMPLE average, 7.41%) while `Data_Cap_Avg` charts
  `cm_dialysis_cap_ttm_m.ttm_weighted_cap_rate` (7.06% — the number the book quotes). Now reads the
  TTM series.
- `cm_dialysis_inventory_snapshot_kpis` is now an **unpivot of `cm_dialysis_on_market_snapshot_q`**
  (the canonical on-market definition, which carries the year-ago comparison). The three drifted
  filters were `avg_dom` (`0..3650` vs `>0` — the 22-day 10+ cohort gap), `pct_price_change`
  (non-null denominator vs all rows) and the `avg_price` band ($30M vs $200M).

**`checkKpiSeriesConsistency()`** (`api/_shared/cm-excel-export.js`) is the tripwire: it compares
every inventory KPI tile against its `on_market_snapshot` counterpart and the What's-New cap tile
against the cap-TTM series, and pushes any divergence into the export's `driftWarnings` — warn-only,
never blocks. Add a pair here whenever a new KPI tile mirrors a data tab.

Related invariants from the same round:

- **A KPI `primary_format` token that isn't in `FMT` shipped as Excel's `General`** — a percent tile
  rendered as `0.1505`. `resolveKpiTileFormat()` now honors the token first, then infers a percent
  from a percent-shaped token name, then from a percent-natured label at ratio scale (`|v| < 1`, so a
  dollar/count tile can never be mangled). Mirrored in the web KPI renderer (`capital-markets.js`
  `fmtVal`). **Register a new token in `FMT` when a KPI view starts emitting one** —
  `percent_zero_decimal` was live for months without a mapping.
- **Chart-axis display names are an EXPORT-layer concern** — `CHART_COLUMNS` entries take an optional
  `display: 'short_operator'` token (`applyColumnDisplay`) so the source views keep canonical operator
  names while the data tab, and therefore the native chart's category axis, carry the short form.
- **A stacked-bar data label suppresses zeros via the number format `0%;;;`**, not per-point `<c:dLbl>`
  deletion (the series-level emitter has no per-point control). Empty negative/zero/text sections =
  blank label on a 0% series.

## Pointers to canonical docs

- **Architecture start:** `LCC-OS.md` → `docs/os/README.md`; canon in `docs/os/canon/`; consolidation map
  `docs/os/REGISTRY.md`; surface sync `docs/os/SURFACE-SYNC-PROTOCOL.md`.
- **API/routing reference (read before editing `/api/`):** `.github/AI_INSTRUCTIONS.md`.
- **Auth rollout:** `docs/AUTH_ENFORCEMENT_ROLLOUT.md`.
- **OM intake:** `docs/architecture/om_intake_pipeline.md`.
- **Provenance / self-learning loop:** `docs/architecture/data_quality_self_learning_loop.md`.
- **Consumption-layer doctrine (long form):** `audit/data-flow-2026-05-30/CONSUMPTION_LAYER_DOCTRINE_2026-06-23.md`.
- **Account-based contact intelligence (WHO to call at a repeat buyer):**
  `docs/architecture/account-based-contact-intelligence.md`. Scott's doctrine, 2026-08-26:
  **the ACCOUNT is the primary pursuit; who to call there is a SEPARATE, STANDING function** —
  value-based and ongoing, never one-and-done, re-derived as correspondence and transactions
  land. People change firms, so track where they went and leverage the prior relationship.
  **Brokers are NEVER prospected as principal-buyer contacts** — but broker↔buyer history is
  kept as market intelligence (who transacts with this buyer, where the gaps are for a
  buyer's-rep pitch, where competitors are winning). Email correspondence is what reveals a
  person's FUNCTION — demonstrated live: Easterly's panel read "— none" while we held **71
  emails with Andrew Pulliam** (closings/press) and **51 with Lucas Shuler** (prorations),
  neither linked to the owner, while 7 competitor brokers were.
  - **⚠️ THE PURSUIT TARGET IS THE ACQUISITIONS CONTACT, NOT THE HIGHEST-VOLUME ONE.** We
    prospect a buyer by SHOWING THEM DEALS, so the buy-side pitch belongs with acquisitions
    (Easterly: Andy Pulliam, EVP-Acquisitions, 71 emails — pursue; Lucas Shuler, DD/transaction
    manager for one deal, 51 emails — do not). The funnel: the acquisitions contact recommends
    us into disposition conversations, because disposition teams ask their own acquisitions
    team who the best brokers are; the disposition name we then earn is kept **IN ADDITION**,
    pursued in an institutional/REIT disposition tone. Role buckets — acquisitions (buy-side) /
    disposition (seller BD tone) / transaction-DD-asset-mgmt (never a target) / broker (never a
    target, Tier-4 intelligence). **The discriminating signal is which person INITIATED each
    deal-flow thread (the initial showing)**, not message volume.
  - **⚠️ MATCH A PERSON TO AN ACCOUNT BY EMAIL DOMAIN, NEVER COMPANY NAME.** Salesforce already
    holds these buyer principals (`lcc_sf_list_membership`, campaign `GSA Buyer`) — Pulliam is
    filed under **"Government Investment Partners LLC"**, so `company_name ilike '%easterly%'`
    returns NOTHING. Same identity-vs-fuzzy discipline as `lcc_owner_strict_core`: the
    human-entered label is unreliable, the machine key is not. Verified live: the principals for
    Easterly, NGP Capital and Elman Investors are all in SF as entities with
    **`linked_to_owner = false`** — the names were never missing, the LINKS were.
  - **⚠️ ~~OUTLOOK CONTACTS HAVE NEVER SYNCED~~ — FED 2026-08-26. THE SYNC WORKED AND THAT IS
    EXACTLY WHY THERE IS ALMOST NOTHING TO SEND BACK (P184).** The note here used to read
    "`outlook_contact_id` 0, no sender, the highest-leverage enrichment gap." The sender was
    built and ran: **`outlook_contact_id` 2,809**, titles **585 → 1,706** fleet-wide (1,127 of
    them on Outlook rows). Re-measure before quoting it again.
    - **The outbound half has a payload of ~211 field-values, and that is an UPPER BOUND.**
      Read `field_sources` across the 2,809 Outlook-linked rows for values NOT sourced from
      Outlook: `title` **3**, `company_name` **25**, `phone` **39**, `mobile_phone` **144**.
      Everything else in those rows *came from Outlook*, so a PATCH projector would re-send
      Outlook its own data — green tally, unmoved population (P159a). Only the 144 mobiles are
      cleanly fill-blank (`mobile_phone` ranks outlook above salesforce); the 39 phones include
      conflicts, because salesforce OUTRANKS outlook there. **Before building a projector,
      measure what the hub knows that the destination does not.**
    - **⚠️ `email_aliases` IS 98% A SELF-ECHO — it does not preserve employer history.**
      16,811 rows carry an array; **16,612 are the primary email repeated** (all `sf_import`).
      Only **199** carry a distinct alias, **182 of them `outlook_import`** — i.e. captured FROM
      Outlook's `emailAddresses`, so Outlook already holds them and writing them back is a
      no-op. Quote 199, never 16,811.
    - **98 Outlook contacts show a dead `@stanjohnsonco.com` primary and 56 already hold the
      live address** (mostly `@northmarq.com` colleagues). This is NOT an outbound write —
      Outlook has both. `pickBestEmail` returns the first BUSINESS domain and the dead firm
      sorts first, so it is a hub-side selection bug with a hub-side fix. (`email_stale` is
      false on all 2,809 — the flag exists and nothing sets it.) Migration tombstones like
      `khedrick20200306@stanjohnsonco.com` are residue, not employer history.
    - **The real outbound payload is CREATE, not PATCH:** 30,024 contacts are absent from the
      address book, but only **828** have real correspondence (`last_email_date`/meeting/call)
      and **487** are named + touched within 24 months. Pushing the 16,202 email-bearing rows
      would be the Consumption-Layer noise failure. Junk-guard it — the ranked head already
      contains `emails@campaigns.crexi.com` filed as a person, a firm name in `full_name`, and
      **Scott himself** at his own dead address with 26,228 sends.
    - **⚠️ `contact_merge_queue` HAS NEVER HELD A ROW ON EITHER PROJECT (0 ops / 0 gov).** Its
      only writer, `intake-promoter.js::checkBrokerMergeCandidates`, is hard-coded to
      `domainQuery('government', …)` while the reader goes through `govQuery`, which the A9b
      cutover repointed to LCC Opps — **producer and consumer are on different databases**
      (P182 shape, and the `CONTACTS_HUB` trap: the function is called `govQuery` regardless).
      Sizing if it is ever fixed: **zero exact-email duplicates**, and only **24 addresses
      colliding across 45 contacts** over `email ∪ email_secondary ∪ email_aliases`.
      **14,465 of 32,833 rows (44%) carry no email at all** and are undedupable on the identity
      key — a stated ceiling, not a backlog to close with `nameSimilarity` (banned for identity).
    - **⚠️ A PROBE THAT WRITES A FIELD BACK TO ITS EXISTING VALUE CANNOT ANSWER ITS OWN
      QUESTION.** The Graph-writability probe was specced as "PATCH `jobTitle` to its current
      value, then re-read" — but a real write and a silent discard then re-read IDENTICALLY,
      and silent discard is the whole risk (Graph can return 200 and drop the change).
      `flow-lcc-probe-outlook-contact-write.json` writes a sentinel DERIVED from the baseline,
      re-reads to compare, restores, and re-reads again to prove cleanup; the verdict names
      `ACCEPTED_THEN_DISCARDED` rather than folding it into success. Same family as the P125
      draft seam, which returned a byte-identical response for a threaded reply and a
      standalone message. Guard: `test/outlook-contact-write-probe.test.mjs`.
    - Full measurement + sequencing: `docs/architecture/contact-reconciliation-outbound.md`.
  - **⚠️ NAME-KEYED WEB/LINKEDIN ENRICHMENT WILL CONFIDENTLY MOVE PEOPLE TO THE WRONG FIRM.** A
    2026-08-26 search for Pulliam returned a DIFFERENT Andrew Pulliam ("VP Financial Operations
    at Integra"). Key on email domain + employer corroboration, record `source_url`/`confidence`/
    `as_of`, and never overwrite a correspondence-derived employer on a name match. **Do not
    scrape LinkedIn** (ToS); use the user's own connections export, company team pages, SEC
    filings, or a licensed API — see the design doc §5a.
  - **⚠️ AN EXCLUSION NEEDS A COUNTERPART THAT PROMOTES.** `v_owner_contact_worklist` excludes
    owners that already have a linked person (correct — they need no *acquisition*), and
    nothing writes that person into `owner_contact_pivot`. Result: **11 owners, $240.5M,
    suppressed AND invisible.** Whenever a surface excludes a population on the grounds that
    it is "already handled", name the thing that handles it and verify that it does.
- **Asset-mint rent-floor curve (C2a):** `docs/audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md` —
  ⚠️ **a resolve rate that holds flat can still be the wrong thing to measure.** gov's technical
  resolve rate does NOT degrade down the rent curve (68.5% → 58.5%), and that flatness survived a
  mutation control returning **0 in every band across 6,688 rows**. What collapses is the OWNER:
  already-contactable **21.8% → 6.8% → 1.6%**, and the named bottom-band rows are cities, counties,
  state DOTs, FedEx and private individuals rather than landlords. **The per-property vs per-owner
  defence was tested and refuted** — 19 of 1,549 owners at $100–250k reach $500k across their whole
  portfolio. ⚠️ Also: the **20% (not 16%)** asset-coverage correction (6,657 archived gov shells in
  the denominator), and **mint the eligible set, not the band** — the mint RPC takes its own row
  list, so every minted entity can carry evidence on the same pass instead of matching the retire
  predicate on day one.
- **Salesforce lanes — consumer or retire (C1):**
  `docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md` — why a lane with 0 completions did NOT
  need a consumer built (one already existed on another surface), the lane-predicate-vs-writer column split,
  and the wrong-key zero that reads exactly like a coverage gap.
- **Merge reversibility + Tier 0 park reasons (P196):**
  `docs/audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md` — the shared merge path's undo,
  the BEFORE-INSERT trigger that silently defeats `ON CONFLICT DO UPDATE`, and the two prescribed
  Tier 0 fixes that were measured (one refuted at 0 of 146, one taken from 25% to 4-of-6 precision).
- **Byte-identical owner duplicates (P189→P195):** `docs/audits/P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md`
  (the blind spot) → `docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md` (the merge that landed
  it, the generic-name gate, and the unsnapshotted pivot delete inside `lcc_merge_entity`).
- **Tier 0 owner-contact confirm lane (P186→P188→P194):** `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`
  (the bench, its precision curve, and the decision not to build a promoter) →
  `docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md` (the lane that turns it into calls) →
  `docs/audits/P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md` (the auto-attach sweep, the
  `<>`-exclusion trap that would have hidden live cards, and the measured refutation of P192's
  un-park and learn-from-rejects claims).
- **On-box daily-brief narrative (Analyst's Take), R8 Stage 1:** `docs/architecture/briefing-analyst-take-onprem.md` — the first net-new on-prem GENERATION surface, its fabrication guard, and the operator gate.
- **⚠️ A TEST HARNESS CAN REACH INTO PRODUCTION BEHAVIOUR, AND RESTORING A STUB RELOCATES THE
  DAMAGE (2026-09-01, Dialysis #7390).** Replacing a `sys.modules` stub with the genuine package
  **created a new defect**: a fixture doing `sys.modules["openpyxl"].Workbook = DummyWorkbook` and
  never restoring it was harmless while the module was a throwaway stub and **permanently rebinds
  the real package once it is back.** The existing attribute snapshot could not see it — **it ran at
  COLLECTION time and the write happens at RUN time.** The same shape in `dateutil` surfaced as
  **`quarantine_dead_ends` silently deleting 0 rows instead of 1, in a module that never mentions
  `dateutil`** — a harness defect with a data outcome. **Fixing module pollution needs three layers,
  not one: the `sys.modules` object, the ATTRIBUTES on the restored module, and symbols already
  bound into callers' globals by a `from X import Y` executed inside the stub window.**
  - 🎯 **And the triage technique generalises: ISOLATION BEFORE TRACEBACK.** One `pytest <file>` per
    failing file split 55 failures into **36 pollution / 19 genuine before a single traceback was
    read** — two files read **21 passed alone, 21 failed in the suite, on identical source**, and
    *that comparison, not the error text, is what proves harness-vs-product.* It also corrected an
    estimate made by counting error strings (36 actual vs ~12 estimated). **Error messages describe
    the symptom; isolation identifies the class.**
- **📍 DIALYSIS ECONOMICS & MEDICARE — read before flagging any revenue/rate/payer-mix figure:**
  `docs/architecture/dialysis-economics-and-medicare-data.md`. **`clinic_econ_reconciled.confidence_tier`
  separates MEASURED from MODELED and almost nothing filters on it — only 1 of 8 econ views has it in
  a WHERE clause.** ✅ **Recorded as NOT defects so they are not re-opened:** the blended rate is
  genuinely flat (−0.6% across FY2021–24; what drifts is payer mix), `RATES_2025` == `CMS_2023_RATES`
  is defensible **and the two names are kept deliberately**, `facility_patient_counts` is an ~annual
  CMS reporting series rather than a nightly feed, and a future-dated `snapshot_date` is CMS
  fiscal-period convention. 🚨 **The thing to know: FY2026 holds ZERO `hcris_form_265_11` rows — 100%
  default fallback — so its "73.66% Medicare / $297.87 blended" is the fallback signature, not a
  market shift.** ✅ **FIXED 2026-09-02 (DE1): both CM econ exhibits now gate on `payer_mix_source`.**
  ⚠️ **AND THE "LATENT, NOT LIVE" CALL I MADE WAS WRONG — BOTH VIEWS MOVED.** I reasoned about FY2026
  alone (excluded by `HAVING count(*) >= 1000` at 724 rows) and missed that **modeled rows exist in
  EVERY year** — 523 across FY2021–24. Trend view FY2024: clinics 6,754 → 6,536, avg revenue
  $3,476,458 → **$3,584,713 (+3.1%)**. And `cm_dialysis_operator_unit_economics` was **LIVE-WRONG**
  — it filters `is_current_year`, spanning FY2011–2026, so it served the fallback husks directly and
  **understated Satellite's revenue/clinic by 41%**. **A year-based guard and a quality-based guard
  are NOT substitutes** — the row-count threshold protected against thin years, not modeled data, and
  the two populations only partly overlap. ⚠️ The confound was tested and rejected: **modeled ≠ merely
  stale** (measured-but-stale clinics look normal at 8,742 tx/yr; modeled ones are husks at 27).
  - ⚠️ **`definition ILIKE '%confidence_tier%'` REPORTS THE OPPOSITE OF THE TRUTH** — it matches the
    SELECT projection, and three views were nearly recorded as "careful" on that basis. **Test for
    the predicate (`WHERE … confidence_tier`), and treat a comfortable result as a bug signal**
    (P182, committed while auditing for exactly this class).
- **📍 BROKER & FIRM IDENTITY — read before flagging a broker name or a null `listing_broker_id`:**
  `docs/architecture/broker-and-firm-identity.md`. **`broker_name` is NOT a name field — it is a
  composite** holding one person, one firm, firm+agent, or a whole listing team (`;` on 344 of 2,425
  broker rows and **778 sales rows**). ✅ **NOT a defect: the name is kept BESIDE the id by design** —
  `listing_broker_id` set with the name NULL is **0 of 4,783**, so both-columns is the existing
  pattern, not a new requirement. The real gaps: the firm FK is **7.6% populated**, **1,930 sales
  carry a name with no FK** (528 distinct), and **299 `broker_name` values are firms**. ⚠️ **"Clean
  the strings" is the wrong instinct and destroys information** — a co-listing is a real fact; parse
  into the model that already exists and keep the raw string as evidence. **80% (422 of 528) resolves
  on an exact case-insensitive match; the residue is abbreviations, surnames and co-listings and must
  NOT be fuzzy-matched.** ✅ **BR2 SHIPPED 2026-09-02 with its producer fix in the SAME change**:
  `listing_broker_id` 181 → **1,027**, name-with-no-id 1,930 → **1,084**, `id_set_name_null` held at
  **0**. 🚨 **CORRECTION — the firm registry is MIS-populated, not merely unpopulated**: of
  `broker_companies`' 131 rows, **73 (56%) contain a `;`**, 28 are single-token abbreviations, 9 read
  as person names, and 7 are the `colliers%` family — **`cbre; smyth & colliers; patel` is minted as
  ONE company.** The composite defect was written into the firm table too, so **the real distinct-firm
  count is far below 131 and any matcher pointed at it will attach agents to composite pseudo-firms.**
  → `BR1`–`BR5`.
- **📍 CONTINUING THE DATA-PROCESS & AUTOMATION AUDIT WINDOW — START HERE:**
  `docs/os/DATA-PROCESS-AUDIT-HANDOFF.md`. Which window you are, what closed, what is in flight,
  the next steps in order, the turn protocol, the git sequence, the consolidation rules, and the
  traps already paid for. **It replaces reading the whole of `STATUS.md`.**
- **📍 PRODUCER HEALTH & CI ENFORCEMENT — one door into the whole B6 arc (fourteen audits):**
  `docs/architecture/producer-health-and-ci-enforcement.md`. **START HERE for "is our ingestion
  running / does anything watch it / does CI enforce anything".** Live producer state, the CI
  enforcement status of each repo, and the traps already paid for. ✅ **LCC verified clean
  2026-09-01** — `npm test` is a bare unmasked `run:` and a required check, all 7 workflows carry
  `timeout-minutes`. ✅ **Dialysis: the pytest line is UNMASKED (PR #7393, 2026-09-02) and green
  once on `main`, read from the job log: 3,147 collected / 3,139 passed / 0 failed** — the arc ran
  `0 executed → 3,128 → 3,132 → 3,147` and `55 → 14 → 5 → 3 → 0` failed, `executed` UP at every
  step so nothing was skipped or quarantined. ⚠️ **BUT A RED SUITE STILL DOES NOT BLOCK A MERGE
  THERE — Dialysis has no branch protection** (`ci.yml`'s header says CI is not a required check;
  PR #7393 merged 8 s after its test job started). *Fails the job* and *blocks the merge* are two
  facts; the second is an operator toggle → backlog **B6e-ci-required-check**, filed WITH the
  `paths-ignore` docs-only fix (a skipped run reports no status — N9's lesson). **Ruff is the same
  defect one job over**: `continue-on-error: true` on both steps, **red on `main` today** behind a
  green check — ⚠️ **5,738 findings, NOT the "11" this line first said: GitHub caps step
  annotations at ten, and I read page one as the total** (A5's `815 = 1000 − 185`). Ruff correctly
  stays masked → **B6e-ci-mask-ruff** (one rule at a time, F821/F811 first). ✅ **#7395 (2026-09-02)
  removed `paths-ignore`** — it matched `**/*.txt` incl. `requirements*.txt`, so a dependency bump
  skipped every job silently; a ~6 s Scope job now decides inside the run and `Run Tests` always
  reports. **The gate has been seen RED (run 33647155312) and the docs-only path proven (#7397).**
  `pip-audit` (**red**: pypdf2 `PYSEC-2026-1835`) / secrets grep (**red**: 5 fixture matches) / the
  two `src` imports are still masked → **B6e-ci-mask-security / -srcimport**.
  ⚠️ **Correction to what this line used to say:** "the code sits within 0.3% of the live
  reconciled model" did NOT reproduce — measured **−4.90%**, no segment within 1%; the test was
  12.5% high, the verdict (test-side fix, keep both rate constants) stands on the FY table. The
  `listing_broker` pair was cleared by BR2 (`listing_broker_id` 181 → 1,027). ❓ government-lease
  unswept.
- **⚠️ PUBLIC RECORDS ARE A SOURCE, NOT A GAP-FILLER — AND THE LANE IS BUILT AND HAS NEVER WRITTEN A
  FIELD (2026-09-01):** `docs/architecture/public-records-source-lane.md`. **START HERE before
  proposing anything about assessor / parcel / tax / deed data.** `county_records` is registered at
  **priority 5 across 93 field rungs on BOTH domains** and has **ZERO `field_provenance` rows ever**
  (positive-controlled: `recorded_deed` has 2,681). Meanwhile `property_public_records` links
  **9,166 of 11,802 dia properties (78%)**, `tax_records` holds 25,621 rows, and the producer ran
  **2026-08-31**. **`dia.properties.year_built` fills from `salesforce`@20 alone** while the @5
  county source sits unread in the same database. **Class 2 on the most-registered source in the
  system, invisible to every check** — tables non-empty and growing, producer green, ladder
  registered, fields filling from somewhere else.
  - **⚠️ RE-MEASURED 2026-09-01 (PR1) — THE LANE MUST NOT BE WIRED, AND THE REASON INVERTS THE
    REMEDY ABOVE.** `src/public_record_ingest.py` on BOTH domains contains **no county record
    fetch**: dia asks **gpt-4o to recall** parcel/tax facts from a prompt seeded with the property's
    own address *and the owner we already hold* (its parsed result is named `gpt_parcel`); gov
    fetches a ≤4,000-char snapshot of the assessor **portal homepage**, which cannot state a
    parcel's assessed value. Evidence: 186 dia tax rows carry a literal
    `XYZ …` placeholder owner and others are city-templated (*"Santa Rosa Dialysis LLC"*); gov's
    `owner_name` (9,749) is the recorded owner we fed the prompt echoed back; **0 Regrid-shaped
    payloads**, so the vendor path has never run.
    ⚠️ **A roundness statistic was published for this first and RETRACTED the same day: *"100.0% of
    gov's assessed values are exact multiples of $100,000 vs 3.8% on the CoStar leg"* was measuring
    ZEROS, because `0 % 100000 = 0` — 9,264 of the 9,265 are exactly `0.00`.** The metric was
    structurally unable to express the question, which is the P157/P182 trap committed by the author
    of the page documenting it, and it was caught only by running
    `count(*) filter (where assessed_value = 0)` while double-checking a PR body. **The model leg
    does not invent plausible numbers — it emits almost nothing, as zeros**, which then propagate
    into curated columns as a positive assertion of `$0`. **Before quoting any modular-arithmetic or
    roundness statistic, exclude zeros and NULLs first, and state the non-zero denominator.** **Building the consumer
    would promote generated numbers to `county_records`, above `salesforce`@20 and every sidebar.**
    Already curated: **8,842 properties' `tax_amount` and 8,682 `assessed_value` trace to the model
    leg and EVERY ONE OF THOSE TRACED VALUES IS `0`** — live, `dia.properties.assessed_value` is
    8,700 zeros against 262 positives, and `tax_amount` 9,025 zeros against 1. Same class:
    `tax_delinquent` is `false` on **11,802 of 11,802** because `bool(None) is False` turned "the
    source did not say" into a negative finding. **A sentinel written into a curated numeric column
    is a false measurement, not an absence.**
    **The real first step is `REGRID_API_KEY`** — `Dialysis/src/regrid_client.py` is a complete
    vendor client, gated on that key, that has never run. Full measurement + the shipped instrument:
    `docs/architecture/public-records-source-lane.md` §2a. Backlog **PR1a/PR1b**.
  - ✅ **AND THE ONE GENUINE SOURCE IN THE LANE WAS BEING TRUNCATED BY ITS OWN WRITER — PR2, FIXED
    2026-09-02.** The CoStar sidebar is the only real public-record acquisition dia has (932 parcel
    rows, 931 true APNs, 883 properties), and `upsertPublicRecords` built its INSERT from
    `apn/county/state/assessed_value` only — so `building_sf` / `lot_sf` / `year_built` / `zoning`
    were **0 on all 932** while the model leg's APN-less rows were the only ones carrying any. Now
    767 / 734 / 714 / 232. **`tax_amount` was stashed in the parcel `raw_payload` instead of the
    `tax_records.tax_amount` column**, where nothing reads it.
    - 🚨 **THE LOAD-BEARING HALF WAS THE PARSER, AND FIXING THE WRITER ALONE WOULD HAVE SHIPPED A
      43,560× UNIT ERROR.** CoStar renders lot size as **`"1.00 (43,560 sf)"`** — acres with the
      square footage in parentheses — on **68% of live captures**. `parseLotSF` matched
      `/([\d.]+)\s*AC/i`, which that string does not contain, then fell through to `parseSF`,
      which strips the `sf` token and `parseFloat`s the **leading** number: **1 square foot for a
      one-acre lot**. 476 of the 760 backfilled lot values came through that arm.
    - ⚠️ **I12 ONE LEVEL UP: THE KEY CAN LIE ABOUT THE UNIT TOO.** `metadata.lot_sf` names square
      feet and holds **both** — `78300`/`43560`/`100000` beside `1.71`/`0.94`/`0.7`. Preferring it
      *because of its name* turned a 1.71-acre lot into **2 square feet** in the backfill's own dry
      run, caught by auditing the parsed outliers rather than by reading the code. **A key whose
      contents are mixed does not carry a unit.**
    - ⚠️ **`"0.00 (1 sf)"` IS CoStar's NO-DATA RENDERING** — the PR1a sentinel-as-measurement defect
      in a new format. 10 captures fleet-wide, and every parenthetical below 100 sq ft is one of
      them, so a 100 sq ft floor refuses exactly the sentinels and nothing real.
    - ⚠️ **A MEASURED CEILING OF ZERO IS NOT A GAP LEFT SILENT.** `tax_amount`, `land_use` and
      `owner_name` are wired and will read 0: those keys have **never appeared on any of 55,901
      entity captures**, and `tax_amount` is present as a KEY in all 932 parcel `raw_payload`s and
      non-null on 0 — a second store confirming the same zero.
    - ✅ **`field_provenance` COULD NOT STORE A VALUE CONTAINING A DOUBLE QUOTE — FIXED 2026-09-02
      (PR12). The lasting lesson is in the next bullet; this one is the record.**
      `value_text_hash` was `GENERATED AS encode(sha224((value)::text::bytea),'hex')`; jsonb renders
      backslash escapes and bytea's escape parser accepts only `\\`/`\ooo`, so the cast raised
      **22P02 and aborted the whole `lcc_merge_field` call** while `shouldWriteField` caught it and
      **failed open** — the curated write landed, the provenance vanished, no signal. This backfill's
      2,532-of-2,533 is the **only demonstrated loss in the system**. Now a plain column owned by a
      BEFORE trigger using `convert_to(...,'UTF8')`. Writeup:
      `docs/audits/PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md`.
    - ⚠️ **"It needs no new acquisition" was the tell, not the selling point.** No new acquisition
      means the values are whatever the current producer emits — so *the cheapest consumer to build
      is exactly the one whose source nobody re-graded.* **Before wiring any registered-but-unused
      ladder source (PR5's other 38), read what its producer's external call talks to.**
    - 🚨 **THE STATED VERIFICATION COULD NOT HAVE OBSERVED ITS OWN SUCCESS — CHECK THAT BEFORE
      RUNNING IT.** `lcc_flush_provenance_events()` carries
      `v_first_class := ARRAY['splink_v1','sf_link_review_human','splink_v2',
      'sf_account_contact_expansion']` and **relabels every event whose source is not on that list
      to `domain_trigger`.** So the PR1 success criterion — *"assert on `field_provenance where
      source='county_records'` going non-zero"* — would have read **ZERO even from a perfectly
      correct wiring**, because the rows land under a different source name at a rung that does not
      exist for those fields. **Class 11 applied to a VERIFICATION rather than a detector: before
      trusting a check, confirm the value you are asserting on can reach the column you are reading.**
      ⚠️ **It also makes PR5's "39 sources never written" an UPPER BOUND** — anything writing through
      this path is invisible under its own name, and `domain_trigger` carries 17,370 rows / 16,327
      writes that nobody has decomposed. Backlog **PR8**.
    - ⚠️ **A CORRECTION THAT IS LIVE BUT UNMERGED LEAVES THE REPO UNABLE TO REBUILD THE DATABASE —
      "running but not merged", inverted.** Both domain PRs merged the **pre-correction** file, so
      `main` states the retracted claim as the rationale for a live object (Dialysis's `CLAUDE.md`
      included — the durable reference, where a wrong lesson does the most damage). And live
      `v_gov_public_record_acquisition` column 6 is `assessed_value_zero` while the committed file's
      is `with_owner_name`: **`CREATE OR REPLACE VIEW` is append-only for columns, so a replay from
      `main` errors 42P16.** The loud failure is the good outcome here — but **a repo that cannot
      rebuild its own database is not a record of it.** Use `drop view` + `create view` when a
      correction reorders columns, and **land the correction the same day the claim ships.**
  - **⚠️ THE DOCTRINE FAILURE THAT HID IT: I SCOPED A *SOURCE* TO ONE *CONSUMER'S* GAP LIST.** The
    same-day verdict *"don't build — stale sold comps, no leverage"* measured every option against
    the 662-row metadata backfill queue. Against the real denominator — **every property, dia 11,802
    + gov 13,837** — the conclusion inverts. **A sold property's assessor record is still ownership
    history, still a sale, still physical stats.** Scott's correction, and it is the exact inversion
    **I1** exists to prevent, committed by the author of I1. **Ask what a source POPULATES, never
    what one queue needs.**
- **Property metadata coverage (dia) — ⚠️ its "don't build" verdict is queue-scoped and superseded
  in part by the above:**
  `docs/architecture/property-metadata-coverage.md`. **START HERE before proposing any source for
  `year_built` / `building_size` / `land_area` gaps.** Carries the retired assessor lane, invariant
  **I12** (acres vs sq ft, 3,702 paired rows, 0 equal, ratio 43,560 on 91.1%), and **three sources
  measured and REFUTED**: Ollama over our documents reaches **9 of 662**, sidebar in-flow **6**,
  sidebar deliberate lookup **662 searches / 1 URL over 617 SOLD properties**. ⚠️ **The seductive
  wrong number was "554 on-market listings"** — 211 are `synthetic_from_sale` and by `status` only 6
  are active; *check what a population IS before routing work to it*. The concrete residue is
  narrow and named: **82 properties with a sale price and no building size cannot produce a $/SF
  comp.**
- **What the PROPERTY PANEL reads for ownership (ONE view):** `docs/architecture/ownership-history-lane.md` § OWN-T0 + `docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md`.
- **Ownership Resolution Engine:** government-lease `docs/OWNERSHIP_RESOLUTION_ENGINE.md`.
- **Property-owner subsystem + SF-as-a-source doctrine:** `docs/architecture/property-owner-subsystem.md`
  + `docs/architecture/property-owner-source-authority-and-doctrine.md`. **Point person ≠ property owner:**
  `lcc_entity_owner_override.owner_user_id` is the POINT PERSON (lcc_user) who works the deal and drives
  My Work / Team Queue scoping (`v_my_work_scoped`); the PROPERTY owner (which entity owns the building)
  lives in the SEPARATE `lcc_property_owner`. Never feed owner entities through the point-person engine.
  Salesforce is one reconcilable source (authority ladder: manual>deed>rel_purchase>sf_seller>rel_owns);
  write back to SF only for direct team benefit.
- **Access scoping (My Work / Team Queue / correspondence privacy):** `docs/architecture/access-scoping-and-my-work.md`.
- **Deal correspondence ingestion + reconciliation:** `docs/architecture/correspondence-ingestion-design.md`.
- **Property-tab UX review + rollout plan:** `docs/architecture/property-tab-ux-review.md`.
- **Connectivity map + open threads (email/phone/SF route status — START HERE for continuity):**
  `docs/architecture/connectivity-and-open-threads.md`.
- **Contact/owner sidebar (P1) design — layout-as-funnel-to-next-action, reuses `buildContact360`:**
  `docs/architecture/contact-owner-sidebar-design.md`.
- **Full per-round worklog (verbatim archive of everything trimmed here):**
  [`docs/history/CLAUDE_full_2026-07.md`](docs/history/CLAUDE_full_2026-07.md). Round-specific implementation
  logs (R5→R64, R76* ingestion, ORE phases, CONNECTIVITY, OUTREACH, UI Phases, SF-reconcile, T9d, CM) live
  there — grep by round tag.
