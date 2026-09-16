# Claude Code / Cowork Instructions — Life Command Center

> **🧭 START HERE for architecture: [`LCC-OS.md`](LCC-OS.md) → `docs/os/README.md`.**
> **START HERE for "where are we / what's left": [`docs/os/CURRENT-STATE.md`](docs/os/CURRENT-STATE.md)
> (LIVE · flag-gated OFF and why · canonical-doc map) + [`docs/os/PLANNED-BACKLOG.md`](docs/os/PLANNED-BACKLOG.md)
> (every unbuilt-but-intended item, with provenance).**
> **Operational reference (surfaces, comps engine, deploy map, Cowork setup):** [`docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`](docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md) + [`docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md`](docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md).
> **Round narratives (P131 → OWN-T0, Aug 14 – Sep 2) are archived verbatim** at `docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`; the index near the end of this file lists them. This file carries rules, architecture, doctrines and footguns — not state.
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

### 🗄️ THE LIVE CATALOG IS THE INVENTORY — ENUMERATE WRITERS FROM `pg_proc`, `cron.job`, `pg_trigger` BEFORE CHANGING A COLUMN'S MEANING (GOVDEED5b / C1B-GOV-GATE, 2026-09-16)

Two rounds in one day inventoried the `sql/` tree and shipped against it. C1B-GOV-GATE: the view being
fixed (`v_ownership_gaps`) had **no committed source anywhere** — it was live-only, so the repo's copy was
the wrong arm. GOVDEED5: the split found three `latest_deed_date` writers in the tree; `pg_proc` had
**six**, one on a 03:30 UTC cron and two as triggers, and the cron re-planted 3,310 values twenty minutes
after the migration reported success. The rule: before a semantic change to a column, list every writer
from the **live** catalog (`pg_get_functiondef` grep, `cron.job`, `pg_trigger`), put the list in the
migration header, and add a test that fails when the list grows. A repo grep is a hypothesis about the
database, not a fact about it.

### 🗄️ ONE REPO OWNS EACH DATABASE'S OBJECTS (Scott, 2026-09-12)

`government-lease` owns the **government** DB's migrations, functions, views and triggers. This repo's
`supabase/migrations/government/*` (213 files) is **historical** — the record of what was applied, not a place to add
to. Do not write new gov DB objects here, and do not re-apply an old one: found 2026-09-12, LCC's committed
`canonicalize_agency()` is older than live (no state-qualifier guard, old ICE/CBP branch order), so re-running it would
silently restore `TEXAS DEPARTMENT OF AGRICULTURE → USDA` and `Immigration & Customs Enforcement → CBP`. Before editing
any DB object, read its **deployed** definition and know which repo owns it (invariant I16). **Ownership table (Scott, 2026-09-12):**

| database | owning repo | note |
|---|---|---|
| government | **`government-lease`** | LCC's `supabase/migrations/government/*` (213 files) is historical — **188 of the 194 objects they define are live right now**, so re-applying one overwrites a running object |
| Dialysis_DB | **`life-command-center`** | where the work happens: operator registry, aliases, write guards, comps engine, market-brief producers. The Dialysis repo owns its CMS/NPI **ingestion** (rows, not schema) — if it needs a schema change, it lands here. This applies identically to a Claude Code / Cowork session with live Supabase MCP access — apply the migration from a session working in this repo, or not at all; ID3d-reconcile (2026-09-16) is the second time a session with MCP access applied a Dialysis_DB schema object live and then committed the record to `Dialysis` instead (DEED1-reconcile-2 was the first, hours earlier) |
| LCC Opps | **`life-command-center`** | this repo is the app |
any DB object, read its **deployed** definition and know which repo owns it (invariant I16).

✅ **ID3a-d SHIPPED 2026-09-12 — every database now has a named owner, measured, not guessed.**

| database | ref | owning repo | evidence | migration count in owning repo | migration count in non-owning repos | newest file |
|---|---|---|---|---:|---|---|
| **government** | `scknotsqkcheojiaewwh` | **`government-lease`** (settled by Scott) | `government-lease` is the canonical repo per its own CLAUDE.md §1; carries `sql/*.sql`; ID3a-c's live fix (PR #398) shipped there | 294 (`sql/*.sql`) | `life-command-center` **213** (`supabase/migrations/government/*.sql`) — **retired, historical, this round** | both repos: 2026-09-12 (the same-day ID3a-c work) |
| **Dialysis_DB** | `zqzrriwuavgrquhisnoa` | ⚠️ **THIS ROW IS NOT AN OWNERSHIP VERDICT — READ THE DOCTRINE TABLE ABOVE + `supabase/migrations/dialysis/README.md` FOR THAT.** This row is a **migration-FILE-LOCATION census only**, and it was wrongly read as settling ownership once already (DEED1-reconcile-2, 2026-09-16: a reconciliation migration for a `Dialysis_DB` view/function/table was committed to the `Dialysis` repo on the strength of this line, when the doctrine table above — and the dia README, unambiguous since 2026-09-16 — already name `life-command-center` as owner). `Dialysis` carries by far the larger migration-FILE set and does its own CMS/NPI ingestion migrations there (see the doctrine table's carve-out); that is a fact about where files sit, not about which repo's ownership claim wins a conflict. Two repos apply schema to this database today. | `Dialysis` carries `supabase/migrations/*.sql` (+ `sql/migrations/`, `migrations/`) | 555 files across all migration dirs in `Dialysis` | `life-command-center` **277+** (`supabase/migrations/dialysis/*.sql`) — **not retired; this directory is where NEW dia schema work lands per the README, so its count is expected to keep growing, unlike the retired `government/` directory** | `Dialysis`: 2026-09-11 (`dia_pdr14a_property_redirects`); `life-command-center`'s dia copy: same window |
| **LCC Opps** | `xengecqvemvfknjvbvrq` | **`life-command-center`** (this repo — the entities/BD-spine/priority-queue/decisions/cadence/provenance-registry app IS this repo) | This repo's own CLAUDE.md names LCC Opps as "the brain: entities, BD spine, priority queue, decisions, cadence, provenance registry, health alerts, auth (GoTrue), most crons" and every `lcc_*` function/table in this file is defined by this repo's root-level `supabase/migrations/*.sql` | 865 (root `supabase/migrations/*.sql`, excluding the `dialysis/` and `government/` subdirectories) | none found — no other repo in this session's scope carries LCC-Opps-targeted migrations | this repo, 2026-09-12 |

**⚠️ `life-command-center`'s `supabase/migrations/dialysis/*` is NOT the government-directory shape,
and must not be retired the same way.** The government directory was retired because
`government-lease` is the sole owner and the LCC copy was a stale, dangerous historical duplicate.
Dialysis_DB is different: the doctrine table above (Scott, 2026-09-12) already names
`life-command-center` as the owner of **schema** here, with `Dialysis` owning its own CMS/NPI
**ingestion**; `supabase/migrations/dialysis/README.md` (2026-09-16) confirms new dia schema work
lands and is applied FROM here. So `life-command-center`'s dia directory is the live schema-of-record,
not historical residue — do not stamp it retired, and do not treat the `Dialysis` repo's larger
file count (above) as evidence to the contrary. See `docs/os/PLANNED-BACKLOG.md` §P0d **ID3a-d-dia**
for the follow-up this row originally filed, which needs re-scoping to "reconcile the two
migration sets" rather than "retire one" — DEED1-reconcile-2 (2026-09-16) is a worked example of
what goes wrong when this row's file-location count is read as an ownership call.

**I16 drift detector:** designed, documented, ready to run, **not yet executed** (no Supabase
network access from this sandbox) — `scripts/db-drift/gov-deployed-vs-committed-drift.sql` +
`scripts/db-drift/README.md`. Run it once under real credentials, record the result in
`docs/claude-code/STATUS.md`, and only then consider scheduling it on the I11 alert path.

### 🧭 TRUTH IS FIXED AT ITS SOURCE OF RECORD — NEVER PATCHED WHERE IT SHOWS (Scott, 2026-09-11)

Scott: *"for any of these factual errors, we want to track the source to ensure that the truth persists in all
places, not just a patch for the purposes of these updates."* When a wrong, split, stale, or duplicated fact
surfaces anywhere (a brief, a comps band, a CM chart, a dossier, an export), the fix is **not** in the surface that
exposed it. Do these instead:

1. **Trace it to the source of record.** That's the table and column that owns the fact, and **every writer**
   that sets it: ingesters, sync jobs, sidebar capture, intake promoters, manual SQL, the Dialysis repo.
2. **Fix it there, with provenance.** Repair or merge the record (reconcilable, never automatic truth). Ambiguous
   cases go to a review lane, not a guess.
3. **Guard every writer** so the defect cannot be re-minted. One resolver (JS plus a lock-step SQL mirror) that
   every write path calls, and a CI or DB constraint that fails on a bypass.
4. **Move every consumer to the canonical key** (an id, never a display string), then **measure every surface
   that reads the fact** and confirm they agree.
5. **Look one level deeper.** A naming split usually means a missing identity model, a stale number usually means
   a dead feed, and a round-number cap usually means a truncated import. Name the underlying defect class and sweep
   for its siblings before closing.

A consumer-side normalizer (a map in the renderer, a `CASE` in a view) is allowed only as a **labelled, temporary
bridge** with a backlog row pointing at the source fix. It is never the fix. *Worked example: the 2026-09-11
operator split (backlog **ID1**): "Fresenius" vs "Fresenius Medical Care" in the market brief traced back to
free-text `dia.properties.operator`, a duplicated `operators` registry, and two conflicting "canonical" spellings.*


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
- **⚠️ AND THE FIRST ATTEMPT AT THAT NARROWING WAS A NO-OP** — `REVOKE … FROM anon, authenticated`
  left the **PUBLIC** grant standing, so both roles still reached `compute_feed_cadence` after the
  "fix" shipped, and four artifacts repeated the claim unverified until a review bot caught it.
  📍 **The mechanism (and OCR2's mirror-image half) is stated ONCE, in
  *"A PRIVILEGE SWEEP THAT ENUMERATES BY NAME…"* below — do not restate it here.** The B6d-specific
  fact worth keeping in place: **`compute_feed_freshness` keeps its explicit `anon` grant BY
  DESIGN** (the LCC cross-DB pull reads `v_feed_freshness` as anon), so *"revoke PUBLIC from every
  definer function"* is exactly the over-generalisation to avoid — it would silently blind the
  freshness monitor.

### 🔐 SECURITY DEFINER PRIVILEGES — the canonical statement (consolidated 2026-09-05; B6d, OCR2, ADDR1b and SEC1 all point here)

**A newly created function is anon-executable through TWO independent grants**, and removing either
one alone is a no-op:

| grant | who adds it | removed by |
|---|---|---|
| `PUBLIC` | Postgres, on every new FUNCTION | `revoke … from public` |
| explicit `anon` + `authenticated` | Supabase's `ALTER DEFAULT PRIVILEGES` | `revoke … from anon, authenticated` |

- ⚠️ **A migration carrying `REVOKE ALL FROM PUBLIC` is NOT evidence the function is closed** —
  measured live 2026-09-05 on `gov_apply_om_confirmed_noi`, which had exactly that on file and was
  **still `anon`-executable**, because Supabase's explicit role grants are a separate grant. The
  author believed it was closed. **Read `has_function_privilege()`, never the migration.**
- **Revoke from all three, then ASSERT with `has_function_privilege()` / `has_table_privilege()`.**
  **Never read a privilege off the GRANT or REVOKE you just wrote** — that is the one rule covering
  both halves, and it was paid for twice: B6d revoked the roles and left PUBLIC
  (`proacl = {=X/postgres, …}` — **the leading `=X` IS PUBLIC**), OCR2 revoked PUBLIC and left the
  explicit role grants (`proacl = {postgres=X,anon=X,authenticated=X,service_role=X}`).
- **A VIEW gets no default PUBLIC grant** — which is why B6d's view half was effective and its
  function half was not, on the same migration.
- **Do NOT generalise to "revoke PUBLIC from every definer function."** `compute_feed_freshness`
  keeps an explicit `anon` grant **by design** on both domains; revoking it silently blinds the
  freshness monitor.
- **Prove the constraint is safe by finding a SIBLING already living under it** on the same code
  path (SEC1-property), not from a doc — `supabase-keys.js` documents a fallback to a historically
  anon key, so "it is server-mediated" is not evidence.
- **When you port or rename a function, diff `has_function_privilege()` against the sibling, not
  just the body** (ADDR1b: the rename landed without re-applying the revoke).
- ✅ **Enforced since 2026-09-05 by `test/sql-definer-privilege-stanza.test.mjs`** — see the
  SEC1-definer-default note at the end of the next section.

**Instances, in order:** B6d `compute_feed_cadence` (2026-08-29) → OCR2
`<dom>_merge_document_extracted_data` (09-02) → ADDR1b `gov_merge_property_apply` (09-04) →
MERGE1's four fold helpers (09-05, shipped by the same PR that fixed a data-loss defect).

### ⚠️ A PRIVILEGE SWEEP THAT ENUMERATES BY NAME CANNOT FIND THE SIBLING THAT DOES THE SAME THING (SEC1-merge-family, 2026-09-05)

SEC1-property locked `{dia,gov}_merge_property_reversible` and `*_unmerge_property`; MERGE1-sec
locked the four fold helpers. Both were correct and both were **complete only with respect to the
list they started from.** Measured across all three projects afterwards:
**`dia_consolidate_property_reviewed(p_keep_id, p_drop_id, …)` is a keep/drop property merge —
exactly the capability that was locked — and it is anon-executable**, along with
`dia_reverse_property_consolidation`, `dia_merge_twins`, and `p31_property_consolidation_apply` /
`p31_same_event_sales_apply` on **both** domains.

- **This is ADDR1b's rule (*porting a function carries its logic, not its privileges*) applied one
  level up — to the AUDIT rather than the function.** A **name** census structurally cannot see a
  sibling that does the same thing under a different name. **Before declaring a privilege sweep
  complete, ask "what else can do this?", never "did I finish my list?"**
- **A `p_dry_run` default is not a mitigation** — an anon caller passes `false`.
- ✅ **Unit 1 shipped 2026-09-05 (PR #2136): all seven locked and behaviourally re-probed after the
  revoke.** dia anon+mutating **9 → 4**, gov **7 → 5** — *the census moved by exactly the predicted
  amount, which is the check that a revoke hit its intended population and nothing else.*
- ⚠️ **A TRIGGER function is not RPC-callable, and that axis cuts both ways.** PostgREST does not
  expose `returns trigger`, and Postgres does not check `EXECUTE` when a trigger fires, so an anon
  grant on one is not a reachable path. It takes gov's residue from 5 to 4
  (`gov_pse_propagate_to_sale`) and does **nothing** to LCC Opps' 62 — **0 of those return
  trigger.** Tested and refuted there; do not re-spend the query.
- ⚠️ **And a shape matched by a regex over `pg_get_functiondef` is a hypothesis, not a ranking.**
  `lcc_apply_cleared_tombstones` was filed as "anon + mutating + dynamic SQL — the MERGE1 shape" and
  told to lead the triage; read live, its dynamic SQL is over a **hard-coded `VALUES` map of column
  names**, not a caller-supplied table, so it lacks the property that made MERGE1's helpers severe.
  **Read the function before ordering the work by a regex's output.**
- ✅ **The guard that stops NEW instances shipped** — `test/sql-definer-privilege-stanza.test.mjs`
  (SEC1-definer-default): any migration creating a `SECURITY DEFINER` function must carry a
  `revoke … from public, anon, authenticated` **and** a `has_function_privilege()` assertion in the
  same file; 219 pre-existing offenders are allowlisted by path with a stale-entry test, and it is
  positive-controlled in both directions (the pre-fix MERGE1 shape is flagged; the real MERGE1-sec
  fix is recognised). ⚠️ **Its literal-blanking is scoped to definer DETECTION only** — the
  production revokes are built with `execute format(...)` and live inside string literals, so
  blanking literals for the stanza check would blind the guard to every real fix in the repo.
  **OCR1c's strip-comments-then-blank-literals rule is PER-ASSERTION; where the deliverable IS a
  constructed string, blanking is the bug.**

### ⚠️ A COLLISION HANDLER THAT *DELETES* MAKES THE SURROUNDING REVERSIBILITY A LIE (GOVDUP1-b, 2026-09-05)

✅ **FIXED 2026-09-05 (MERGE1)** — both `dia_merge_property` and `gov_merge_property_apply` now
consult a per-table `{dia,gov}_merge_child_policy` on `unique_violation` (`re_derivable` /
`fold_fill_blanks` / `resolve_status`, defaulting an unclassified table to `fold_fill_blanks`
rather than a blind delete). All four measured dia collision tables and all three measured gov
collision tables are classified; verified live via rolled-back positive controls on both domains
(fold fills the keep row's blanks from the drop row, never loses either side). **Read this section
below for the mechanism — it is accurate history — but the defect it describes is closed.**
`docs/audits/MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md`; guard `test/merge1-fold-on-collision.test.mjs`
(8/8 pass). The 205 historical dia losses are NOT backfilled — they are gone, recorded as a number
and a date. `gov_property_merge_backup` remains 0 rows; this migration merged nothing on either domain.

**SEC1-definer-default (2026-09-05):** the MERGE1 fold helpers above shipped anon-executable
(no revoke stanza in the same migration) and were fixed 10 minutes later in a companion file —
exactly the recurring class this section and the B6d/OCR2 sections describe. A CI-runnable guard
now catches a NEW instance of it: `test/sql-definer-privilege-stanza.test.mjs` requires every
migration that creates a `SECURITY DEFINER` function to carry a `revoke ... from public, anon,
authenticated` + `has_function_privilege()` stanza in the SAME file, with a named, non-rotting
allowlist for the 219 pre-existing offenders. Triage notes:
`docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md`.

`gov_merge_property_reversible` snapshots the dropped property row and its child **ids** into
`gov_property_merge_backup`, then calls `gov_merge_property_apply`, whose generic
`WHEN unique_violation` arm runs `DELETE FROM %s WHERE %I = $1`. **The row is gone and the id in the
backup points at nothing.** Measured across all 397 review-lane groups against the real unique
constraints: `investment_scores` is UNIQUE **on `property_id` alone**, so **397 of 397 groups
collide**; `property_embeddings` (PK on `property_id`) 334; `property_financials`
`(property_id, fiscal_year)` 316 — **~1,321 child rows destroyed unrecoverably** if the lane were
merged today.

- **The fix is to FOLD on collision** — fill-blanks from the drop row into the keep row, then delete
  — **never to document the loss better.** `gov_unmerge_property` already reports `_lost` per table
  plus an explicit `note`, and that honesty is what made this findable; it is not sufficiency.
- **This is P196 one layer down.** There, `lcc_merge_entity`'s pivot DELETE *destroyed content
  instead of folding it*, and correlating the predicate would have looked like a fix while moving
  nothing. Here the identical shape sits in the **generic** handler serving *every* gov child table
  at once, so one defect spans all of them.
- ⚠️ **Read the UNIQUE INDEXES, not one probe.** A single round-trip found three tables losing rows
  and supported the reasonable-sounding conclusion *"a pair with disjoint children may round-trip
  cleanly."* The index definitions say no such pair exists. **A per-pair check answers "did this one
  lose"; the constraint answers "can any pair not lose."**
- 🚨 **AND THE SAME CLASS IS LIVE ON dia, WHERE IT HAS ALREADY RUN 205 TIMES (MERGE1).**
  `dia_property_merge_backup`: **585 merges, 206 collisions, 205 on a CASCADE table** — and
  **`dc_twin_verdict`, the human-verdict Decision Center lane, collides on 90 of 116 (78%)**. An
  operator confirming a twin destroys a child row four times in five, told it is reversible.
- ⚠️ **THE TWO DOMAINS LOSE THE ROW BY DIFFERENT ROUTES, SO A GREP FOR ONE FINDS NOTHING ON THE
  OTHER.** gov `DELETE`s and records `*_deleted_on_collision`; **dia records `<tbl>.<col>_error`,
  moves on, and the row dies to `ON DELETE CASCADE`** when the property is deleted afterwards.
  Keying on gov's vocabulary undercounted dia at **76** before re-keying on `%\_error` gave **206**.
  **Establish the mechanism per domain before counting, and check `pg_constraint.confdeltype`** — a
  `'c'` turns a recorded error into a silent destruction, `'a'` would have aborted, `'n'` orphans.
  Three different outcomes that must never be reported as one.
- ⚠️ **Split the census by WHAT was lost.** The one merge directed from Cowork
  (`addr1a_20260904`) collided only on `pending_updates` — a queue row — while all 7 leases, the
  deed, the listing and the document repointed correctly. **"205 merges lost data" overstates that
  row and understates a `cap_rate_history` loss.** Substantive / re-derivable / queue are three
  policies, and the fold must state which applies per table rather than infer it from the name.

### 🚨 TWO BRANCHES THAT BOTH *ADD* TO A SHARED DOC MERGE CLEANLY AND SILENTLY DUPLICATE IT — ONLY A GUARD CATCHES IT (BACKLOG-ids, 2026-09-12)

`PLANNED-BACKLOG.md` and `STATUS.md` are append-mostly files that every session and every parallel agent writes
to. Git's 3-way merge sees two pure **insertions** at different offsets, finds **no textual conflict**, and keeps
**both**. Nobody is warned, and nothing is wrong with either side in isolation.

Measured, the same day, twice over:
- A dedupe PR fixed 27 duplicate backlog IDs correctly. A concurrent PR then merged `MB2a`/`MB3`/`MB4` restatement
  rows into `main`. The merge was clean; the duplication the PR existed to remove was **reintroduced on its own
  branch**, plus malformed extra table columns from the earlier bad merges.
- `STATUS.md` passed its line budget locally at 2,465, then a merge from `main` added 74 lines and it failed CI at
  **2,503**. Twice, on two different PRs.

**Therefore:**
1. **A shared append-mostly doc needs a CI guard, not a convention.** Prose conventions have failed here five
   times in one day on a single rule. Live guards: `test/backlog-id-uniqueness.test.mjs` (one row per ID),
   `test/backlog-table-shape.test.mjs`, `test/status-header-integrity.test.mjs` (H1 on line 1),
   `test/status-line-budget.test.mjs` (≤ 2,500 lines).
2. **A green local run proves nothing about the merge.** Re-run the doc guards **after** merging `main` into your
   branch, before pushing — and for the line budget, archive an old span to `docs/history/` **before** you push,
   leaving 200+ lines of headroom rather than trimming to fit.
3. **Never resolve a doc duplicate by deleting a row.** Classify first: two unrelated issues sharing an ID is a
   **collision** — rename the newer one, keep the ID where more citations already point (count them), and leave a
   pointer so old references resolve. The same issue written twice is a **restatement** — collapse it keeping
   every distinct fact, and where two copies disagree on a number, **report the conflict and keep both readings
   with their dates**; never silently pick one.
4. **Edit the row, don't restate it.** Every one of the 14 restatement groups began as a session appending a fresh
   row instead of amending the existing one.

### ⚠️ A CANONICAL TOPIC PAGE GOES STALE ON ITS OWN TOPIC FIRST — UPDATE IT IN THE SAME CHANGE (2026-09-08)

Twice in one week the arc's *canonical page* was the last thing to learn what the arc found, while
STATUS and the backlog were current: `field-provenance-ladder.md` still justified a write "per the
ladder's own `manual`@1 rung" **after** that rung was proven not to exist, and
`edge-function-deploy-drift.md` carried nothing about DRIFT1-routing-gap **while that finding came
out of DRIFT1 itself.** The failure mode is structural, not careless — a turn's work naturally lands
in the running log and the task list, and the topic page is the one artifact nobody is prompted to
touch.

- **A topic page that is stale on its own topic is worse than no page**, because it is the artifact
  a future reader trusts *instead of* re-measuring. Both instances were actively misleading: one
  stated a rung that does not exist, the other omitted the reason its own subject changed.
- **The rule: when a unit changes what a canonical page asserts, the page moves in the SAME change**
  — not in the reconcile turn afterwards. `BUILD-TURN-PROTOCOL.md` already says a change is finished
  when the canonical pages are true; this is the specific failure that rule exists to catch.
- ⚠️ **And correct it IN PLACE with the measurement**, never by deleting the wrong sentence — the
  wrong sentence is the record of why the next reader would have believed it.

### ⚠️ GREP THE SYMBOL, NOT THE FILE (DRIFT1-routing-gap, 2026-09-08)

Cowork recorded that `GOV_STATE_SIGNALS` was "used by `sf-promotion-worker`" — from
`grep -rln sf-deal-promotion`, which showed the worker importing the **module**. The worker imports
only `planDealSalePromotion`; the constant had **zero production consumers** and lived in its test
file alone. **A module import is not a symbol import**, and the inference was published as fact in
two documents.

- **Read the import list, not the import path** — `import { X } from "./m.ts"` is the evidence.
- The finding it supported (two definitions of "gov") was correct; the *mechanism* claim was not, and
  the correction **strengthened** it: with no second live consumer, merging the lists could not
  change anyone's behaviour. **A wrong supporting detail can make a right conclusion look
  better-founded than it is** — which is why the detail has to be checked at the same standard.

### 🚨 A PRODUCER WHOSE DEPLOYED CODE IS AHEAD OF THE REPO IS INVISIBLE TO EVERY CODE SEARCH (GOVDUP1-a, 2026-09-05)

The gov SF fan-out producer is **`intake-salesforce`, a Supabase edge function on Dialysis_DB,
deployed `version 23` while the committed source is v1-era — ~400 lines of drift.** Its
`handleCrawlComplete → linkProbe(autoCreate=true) → autoCreateProperty()` path POSTs straight into
`gov.properties`. **GOVDUP1's "producer NOT FOUND" was not sloppy: it read the committed file, which
genuinely has no insert path.**

- **This is "running but not merged" — the inverse of the doctrine stated all over this file — and
  it is the SECOND instance.** P194 was the same shape on the client side (the extension's
  hard-coded Vercel URLs). **Neither is visible to a repo grep, a test, a guard or a reviewer.**
- 🚨 **AND IT RECURRED ON OUR OWN WORK THE NEXT DAY, IN THE WORSE DIRECTION (SEC1-unit2,
  2026-09-05).** The gov privilege lockdown was **applied live and left on an unmerged branch**, so
  `main` did not describe the database and **a rebuild would have silently restored the anon
  grants** — with nothing erroring, because the live DB was correct and only the repo was wrong.
  **A live-applied change is not shipped until the migration is on `main`; confirm with
  `git ls-tree -r origin/main`, not with the fact that the SQL ran.** Knowing the lesson did not
  prevent it — the same 24 hours it was written down.
- 🚨 **AND IT IS NOT ONE FUNCTION — MEASURED 2026-09-06 (DRIFT1): ≈10 DEPLOYED EDGE FUNCTIONS HAVE
  NO COMMITTED SOURCE AT ALL.** `supabase/functions/` holds 28 directories against **dia 25 /
  LCC Opps 11 / gov 2** deployments; the sourceless ones are dia `sf-test`,
  `salesforce-enrichment`, `test-function`, `ai-copilot-v2`, `w41-corpus-export`,
  `w43-sf-link-export`; LCC Opps `cortex-webex-sync`, `docai-diag`; gov `bulk-import-awards`,
  `sam-entity-lookup`. ⚠️ **`version` counts DEPLOYMENTS, not content** — to detect drift compare a
  content-derived marker, not the number. ⚠️ **Never "tidy up" by redeploying from the committed
  file** — where the repo is behind, that rolls production back.
- ✅ **CLOSED 2026-09-07 (DRIFT1)** — all 38 deployments censused with a verdict each; five
  sourceless functions committed with liveness proven from `cron.job`, `intake-salesforce`
  committed verbatim at `sf-2026-05-v8`, **and its false "never writes a domain table" header
  removed** — that sentence is what made the original "producer NOT FOUND" read as conclusive.
  Canonical page: `docs/architecture/edge-function-deploy-drift.md`. ⚠️ **A repo-side test cannot
  close this class** — it can assert every committed function is deployed, but is structurally
  blind to a deployment with no committed source, which is the entire population. The unit shipped
  an operator runbook instead of a guard implying coverage it lacks.
- **When a producer cannot be found in source, enumerate the DEPLOYED artifacts before concluding
  it does not exist**: `list_edge_functions` on all three projects (compare `version` against what
  the repo last deployed), `cron.job` command text, Power Automate flows, and the Chrome extension.
- ⚠️ **A dedupe key containing a per-run value is not a dedupe key.**
  `uq_sf_property_staging_dedup (sf_property_id, source_system, import_batch)` looks like identity
  and **can never collide**, because `import_batch` changes every crawl. **Read the existing key
  before replacing it** — the fix was a `BEFORE INSERT` pre-link on `sf_property_id` alone.
- ⚠️ **BEFORE ASSERTING A PRODUCER IS FIXED BY AN *ABSENCE*, PROVE THE PRODUCER RAN (2026-09-06).**
  The confirmation specified for this fix was *"new `_new_property` rows staying flat"* — it read
  **0**, and it proved nothing, because the newest row predated the fix by **ten days**. An absence
  over a dormant producer is indistinguishable from a fix. **The zero only became evidence once the
  producer's own arrival rate was measured** (`sf_property_staging`: 3 rows in 24h, 23 in 7d, 109 in
  30d — the crawl is live and minted nothing). Same shape as `already_annotated` reading like
  throughput, one level up; it applies to every "the count stayed flat" check.
- ✅ **Fixed and proven behaviourally**, and the pre-link **prefers a LIVE row over an archived one**
  when both exist — falling back to an archived row only when every candidate is archived, which
  beats re-minting.

### ⚠️ A CHILD ROW WRITTEN 1:1 WITH ITS PARENT IS A CO-WRITER, NOT A DOWNSTREAM CONSUMER (GOVDUP1-a, 2026-09-05)

A gov producer minted **154 empty copies of one address** and was written up as *"producer NOT
FOUND"* after the SF promotion worker, the CoStar sidebar and `auto_apply_property_links.py` were
each correctly ruled out on structural grounds. **The producer names itself in a child row the same
investigation had already discovered**: every husk carries a `pending_updates` row with
`field_name='_new_property'` and `reason='Salesforce auto-created property — verify accuracy and
check for duplicates'`, all 154 sharing **one `sf_property_id`** with a different `staging_id` each
time. The rows were classified as *"a downstream matcher proposed something against them"* without
opening the payload.

- **When a child row appears 1:1 with its parent in the same second, read its payload before
  classifying it.** Class-wide this is **808 gov properties minted from 125 Salesforce properties**,
  8 still live, newest 2026-08-25.
- ⚠️ **A `data_source`-keyed hunt cannot find a producer that wears more than one label.** Two rows
  for the same SF property, minted a day apart, carry `costar_sidebar` and `unknown_writer`. The
  invariant was `field_name='_new_property'` + `sf_property_id`.
- ⚠️ **It had already been cleaned once (June) and recurred** — P176, committed by a unit that cited
  P176 in its own prompt. **A retire that does not name the producer schedules its own repeat.**
- ⚠️ **And the husks were not inert: each carries an `investment_scores` row with NO DECLARED FK.**
  P160's lesson again — *declared FKs alone MISS `owner_contact_pivot.active_contact_entity_id`;
  match on column NAME* — so "enumerate every FK to `properties`" is still not enumerating every
  reference.

### ⚠️ A DUPLICATE COUNT IS A PROPERTY OF THE KEY — CHECK THE KEY BEFORE CALLING A RE-MEASUREMENT A RETRACTION (GOVDUP1, 2026-09-05)

Sizing gov's property duplicates, an earlier figure of **399 groups / 953 properties** was
re-measured as **132 / 419** and was one sentence from being published as *"my earlier number does
not reproduce."* **It reproduces exactly** — the two used different keys:
`regexp_replace(lower(address),'[^a-z0-9]','','g')` vs `lower(trim(address))`. The 267-group
difference is `1000 Terminal Dr` / `1000 Terminal Dr.` and `100 NE Loop 410` / `100 N.e. Loop 410`,
**same city, same state, punctuation only** — i.e. the *cleanest* duplicates in the population, and
the stricter key cannot see one of them.

- **Never report a duplicate/dedup population without the key that produced it**, and when two
  honest measurements disagree, **diff the keys before adjudicating the numbers** (the B5 lesson —
  *find the measurement independent of the disputed key* — arriving one layer earlier).
- **A self-correction is a claim like any other and must be verified before it is written.** The
  retraction here would have been more damaging than the original imprecision, because it would have
  argued for the *narrower* population and silently dropped 534 properties.
- ⚠️ **And in the same sizing: `lpad('',5,'0')` is `'00000'`, not NULL.** An empty `zip_code`
  normalized into a *present and disagreeing* zip, giving **46 agree / 82 differ / 0 missing** —
  plausible, and wrong. Requiring ≥4 digits before padding gives **42 / 15 / 71**. Same family as
  PR1a's retracted roundness statistic (which measured zeros) and P157/P182: *a comparator
  structurally unable to express the question returns a plausible number instead of an error.*
  **Keep `missing` a third state, never folded into `differs`** (P180).

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
backlog §P16.** ✅ **In the canon since 1.7.0 (2026-09-03): `docs/os/canon/blocks/operator-doctrine.md` + Global invariant 8; QUANTIFIED in 1.8.0 the same day** (newer lease relative to the swimlane's standard term · reason to sell = death / debt / divorce / value creation · $2.5M–$25M per property sale · not-reached = no touch by anyone · 7 touches / 6 months then ≈1/quarter · Today = Significant / Important / Urgent; source `app-ux-review-2026-09-02.md` §0b) — the canon is the source now; this paragraph is the pointer.

### ⚠️ A BAND NAMED FOR THE DOCTRINE CAN SELECT THE OPPOSITE POPULATION — MEASURE THE OVERLAP (UX-T1a, 2026-09-03)

Scott quantified the seller queue (canon 1.8.0) and the existing `v_priority_queue` was measured against
it: **of 259 in-band newer-lease assets, 27 appear in the queue and 232 do not — 89.6% disjoint.** P1
`lease_expiry_24mo`, P2 `firm_term_ending_24mo` and P3 `ten_year_window` all select assets **late** in
term; the doctrine's sweet spot is the **first 2–3 years**. Every band was individually reasonable and
the queue as a whole ranked the wrong end of the lease. **The doctrine's queue is therefore a NEW view,
not a re-rank** — and the number that decides that is the overlap, which nobody had computed. Audit:
`docs/audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md`; canonical page
`docs/architecture/bd-ranking-and-priority-queue.md`.

- **⚠️ VALIDATE A DERIVED VALUE AGAINST SOMETHING IT WAS NOT DERIVED FROM.** Checking the value ladder
  against `facts.sale_price` read gov **p75 = exactly 1.000** — because gov derives `noi = price × cap`
  (§12), so `noi / cap` divided by `price` is a tautology on 280 rows. Exclude own-`cap_rate` rows first.
- **⚠️ `sale_price` IS NOT PER-PROPERTY VALUE ON gov.** Ratio p50 runs **0.949** where one property
  carries the price, **0.164** where 5+ share it — portfolio trades attributed per property. "Individual
  property sale price" reads like the right column and is the wrong one.
- **⚠️ "REACHED" HAS A FALSE FLOOR AND A FALSE CEILING.** Owner-entity-only touches = 19 (touches land on
  the PERSON — C11/P188); any-link touches = 1,024 (imports machine-written asset events:
  `rca_deed_record`, `intake_om`, `copilot_action`). Person links + human categories = **34**. The
  binding constraint is missing LINKS (847 of 6,480 owners have a linked person), not missing touches.
- **⚠️ THE DEATH/DIVORCE ARMS MEASURED 42% FALSE-POSITIVE ON FIRST CONTACT** — 111 of 265 matched on
  the phrase "REAL ESTATE"; `UIRC` and `Gardner-Tanenbaum` read as individuals (C13c). Written by an
  author who had read the warning. Sized, never a write; `reason_to_sell` is restricted to the RECORDED
  `developer` signal plus an explicit `reason_to_sell_unmeasured` state until debt (Unit 2 of
  UX-T1a-gates) lands.
- **⚠️ A LABEL IN THE RENDERER IS NOT A LANE.** `renderTodayBdActions` labels `loan_maturity`,
  `suspected_sale` and `owner_source_conflict`; `v_lcc_bd_worklist` has **never** emitted any of them
  (positive-controlled). The Today BD tile serves **100% automation/plumbing** — both of its lanes already
  have automated consumers. The strongest reason-to-sell (192 loans maturing ≤24 mo at source) ~~has no LCC
  table at all~~ — ⚠️ **superseded 2026-09-03: UX-T1a-gates shipped `lcc_loan_maturity` (568 rows,
  exactly those 192) and `v_lcc_bd_worklist` emits 172 owner-attributed rows. PR5d re-verified the
  192 and found `costar_cmbs_loan` supplied 0 of them; the residual debt gap is DISTRESS, not
  maturity.**
- **Quote both the CONFIGURED and the REALISED cadence.** `PROSPECTING_SEQUENCE` sums to 67 days for 7
  touches (2.7× the doctrine's 6 months) while the realised median gap is 28 days; tier is inert (41 A /
  2 C), role is not an input, and `current_touch` reads max **8,198** on a 7-step sequence — cadence
  position is unreadable until UX-T1a-touchcount.
- **Say which grain you quote** — rows ≠ assets ≠ owners (756 properties carry >1 current owner; one
  sponsor↔SPE pair appears twice in a 23-row set), and `v_lcc_entity_roles` is multi-label so a join
  fans out.

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
     dia half of that lane has no source view at all. See the B1 section (archived: `docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`).
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

- ⚠️ **A SOURCE STRING IS PART OF THE CONTRACT — CHECK THE REGISTERED SPELLING, NOT THE CONCEPT
  (CONTACT1b, 2026-09-06).** Three human-verdict writers shipped `source: 'manual'`; the registered
  rung-1 names are **`manual_edit`** and **`manual_resolution`**, and fleet-wide those carry
  **207 and 203 rungs across 28 tables each** while bare `manual` has **one rung on one table**.
  Because the registry is the allowlist, an unregistered source is relabelled `domain_trigger` and
  takes `lcc_merge_field`'s unregistered branch (fills a blank, never overrides, overridable by
  anyone) — so **the highest-authority write on the ladder lands at the weakest tier, silently.**
  **Query `field_source_priority` for the exact string before writing a new source**, and note the
  guard pinned the wrong literal too: *a guard that asserts a VALUE rather than a PROPERTY defends a
  defect as readily as a fix.*
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
- **⚠️ A RUNG WITH NO WRITES HAS AN EIGHTH CAUSE: THE CAPTURE EXISTS AND THE PAGE IS NEVER
  VISITED (PR5d, 2026-09-03).** `costar_cmbs_loan` is **121 rungs — the ladder's largest source** —
  and its scanner (`extension/content/costar.js parseCmbsLoanDetail`), its writer
  (`sidebar-pipeline.js upsertLoanRecords`) and the extension's `https://*.costar.com/*` match are
  **all live and correct**; the CoStar loan sub-page has simply never been captured. **Ruling out
  the rename class needed a column only that arm writes** — `loans.costar_loan_id` and
  `loans.source_url` are **0 of 2,219 rows across both domains**, and `loan_snapshots` /
  `loan_top_tenants` / `loan_commentary` are 0 rows on both. **A zero is evidence only while exactly
  one writer could have made it non-zero**, so that single-writer property is now guarded: a second
  writer would destroy the detector without breaking anything. ⚠️ **And a blocker can be LAYERED** —
  27 of the 121 additionally sit behind dia's `properties.track_cmbs_snapshots`, **false on 11,803 of
  11,803**, so capturing the page would still write nothing there. Two blockers, two verdicts
  (`page_never_captured` 94 / `page_never_captured_flag_off` 27 on
  `v_field_source_priority_triage.pr5d_verdict`). ⚠️ **It also SUPERSEDES R54 Unit 3's mechanism**
  (*"the captures so far are the basic loan layout"*): the rows are not partial CMBS captures, they
  come from a different scanner on the property page, and the wrong explanation is what made this
  read as a coverage question for 75 days. **Not retired** — R54's `is_distressed` arm is built,
  ranked and starved (**0 of 178 gov watch rows**, with watchlist/delinquency/DSCR at 0 across 285
  CMBS loans), and only this arm can feed it. Backlog **PR5d-a** / **PR5d-b**; audit
  `docs/audits/PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md`.
- **`target_database` is a CLOSED vocabulary** (`lcc_opps`/`dia_db`/`gov_db`, CHECK-enforced) and
  is NOT part of the rung lookup, so a wrong value passes every ladder check and fails 23514 at the
  INSERT. Single owner: `provenanceTargetDatabase()` in `api/_shared/field-priority-guard.js`.
  **A comment naming a sibling call site as correct is not evidence** (PR5c).
- **Never cast text to `bytea` to feed a digest — use `convert_to(t,'UTF8')` (PR12).** The old
  generated `value_text_hash` aborted `lcc_merge_field` on any backslash-rendering value (quotes,
  **newlines** — ~1,101 exposed, mostly `sales_transactions` narrative on NON-rung columns). Plain
  column + BEFORE trigger now; `DROP EXPRESSION` is metadata-only, no rewrite. **Never backfill a
  lost provenance row** — record the loss as a number and a date.
- ⚠️ **TO PROVE A CONSTRAINT IS SAFE, FIND A SIBLING ALREADY LIVING UNDER IT (SEC1-property, 2026-09-05).**
  Before revoking `anon` from the property merge/unmerge pair, the doc said the Decision Center lane
  is server-mediated — but `supabase-keys.js` documents a **fallback to the historically-anon
  `DIA_SUPABASE_KEY`**, so the doc was not evidence. The proof used instead: **the same lane already
  calls `dia_merge_property`/`gov_merge_property` through the identical `domainQuery` path, and those
  were already locked to `service_role`** — a live, working caller of an already-constrained sibling
  proves the path resolves to `service_role`. **Prefer a working sibling over a documented claim.**
- ⚠️ **PORTING A FUNCTION CARRIES ITS LOGIC, NOT ITS PRIVILEGES (ADDR1b-merge, 2026-09-04).**
  gov's destructive property merge was renamed to `gov_merge_property_apply` and the old name made to
  raise — correct, and the NEW name was left **`anon` and `authenticated` executable**, so the
  destructive path stayed reachable under a different name while dia's equivalent was already locked.
  **When you port or rename a function, diff `has_function_privilege()` against the sibling, not just
  the body** — and revoke from **`public` AND `anon` AND `authenticated`**, because revoking one
  leaves the others (Supabase grants the roles explicitly at CREATE time).
- ⚠️ **A ZERO FROM AN INSTRUMENTED PATH: *quiet* vs *unreachable* (CONTACT1, 2026-09-03).**
  PR5c-entities-b instrumented `insertEntity`, reachable only from `handleSalesforceContactUpsert` —
  **0 `salesforce.contact.upsert` jobs ever.** `provenance_write_failed = 0` reads as reassurance and
  is the tell: **a path that never runs cannot fail.** Prove execution from a RUN LEDGER before
  instrumenting, and trace real traffic by a per-writer stamp, not by the file that looks like the writer.
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
  serves *(re-measured 2026-09-08 21:44 UTC: `/api/daily-briefing` → 200 with a briefing generated at that
  instant; `/version` → Vercel NOT_FOUND only because the route postdates the frozen build)*, and it still holds the LCC Opps service key — so the extension's POSTs did not fail,
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
  - **⚠️ GREP THE HOSTNAME, NOT THE BRAND — AND NEVER CASE-SENSITIVELY (DOCMAP2 reconcile, 2026-09-08).**
    A sweep for docs still pointing at this deployment grepped `Vercel` (capitalised) and reported 2
    defects. `grep -ri life-command-center-nine` over the same 855 files found **12**: six flow docs in
    `docs/architecture/flows/` carry the host ONLY inside a lowercase URL and never say the word "Vercel".
    The same sweep was scoped to `*.md`, so it could not see the three root `flow-*.json` Power Automate
    definitions and the Copilot Studio `manifest.json`/`ai-plugin.json`/`LCC-Assistant.zip` that still name
    the host — importable artifacts, which are worse than prose (J13a). **A retired dependency is found by
    its machine identifier (hostname, table, function name), across every file type, case-insensitively;
    the brand name is what the correctly-framed history mentions.** Same family: `docs/architecture/` "grew
    181 → 232" was a non-recursive count — the 51 were subdirectories that had never been classified.
    - ✅ **J13a-guard SHIPPED (2026-09-08) — this class is now a CI test, not a fourth sweep.**
      `test/retired-identifiers-guard.test.mjs` scans every TRACKED file (`git ls-files`, all types,
      case-insensitive, comment-stripped for JS/TS) for the identifiers in
      `test/fixtures/retired-identifiers.json` and fails on any hit outside `docs/history/`,
      `docs/audits/`, a `STALE (DOCMAP…`/`RETIRED`-bannered doc, or a named allowlist entry (BY PATH,
      with a reason + re-measure date, itself asserted non-stale). **Add a newly-retired
      host/path/symbol by editing the fixture — never by widening the exempt set to silence a hit.**
      The three root `flow-*.json` files and the Copilot Studio `manifest.json`/`ai-plugin.json`/
      `LCC-Assistant.zip`/Teams-Toolkit build artifacts that carried the retired host were moved to
      `docs/archive/retired-vercel-artifacts/` (never hand-edited) — see that directory's README for
      the live replacement of each.
      - 🚨 **A WORD IS NOT A BANNER — AN EXEMPTION MUST BE SHAPED LIKE THE ARTIFACT IT EXCUSES (Cowork
        reconcile, 2026-09-08).** The guard's first cut exempted any file whose first 40 lines matched
        `/RETIRED/i`. Measured: **40+ tracked files rode the bare word** — live `api/_shared/*.js`,
        `dc-lanes.js`, four `.github/workflows/*.yml`, `CURRENT-STATE.md`, `AGENTS.md`. Positive control:
        a hardcoded retired host appended to `api/_shared/share-extractor.js` left the suite **GREEN** —
        the P194 shape, the one thing the guard exists for, and it had already been "seen red" on an
        allowlist removal. **Seen red on one path is not seen red on the path that matters.** Now
        `.md`-only, blockquote-only; two positive controls pin it. When a guard passes, ask what its
        exemptions would ALSO excuse, and try the defect you built it for inside one of them.
      - ⚠️ **`life-command-center-production.up.railway.app` IS NOT DORMANT — it answers as the live
        standalone MCP server** (`/health` → `lcc-mcp-server 1.0.0`, measured 2026-09-08 21:43 UTC via
        `net.http_get` from LCC Opps). Two docs in this repo called it "the dormant Railway service
        (I16b)" — both struck. Whether it is the same Railway *service* I16b wants deleted is a **Conflict**
        only the Railway dashboard resolves; until then **I16/I16b's "delete it" is frozen** (see backlog
        I16b). CC was right to refuse seeding it as retired — measure before you retire.
        ✅ **RESOLVED 2026-09-09 — read off the Railway dashboard with Scott: service `life-command-center` IS
        the MCP server (port 3100).** There is no dormant Railway service; I16/I16b retracted. **A "dormant"
        label that nobody has probed is a hypothesis that can delete production.**
      - ⚠️ **CAPTURE THE BODY BEFORE YOU DELETE A DEPLOYMENT — `get_edge_function` first, `functions delete`
        second, every time (2026-09-09).** `sf-test` was deleted on a May "DELETE" verdict whose "source is on
        record in git history" line was false; nothing had ever committed it. The two functions kept that day
        had their bodies pulled first — the one deleted did not. A "scratch stub" can be the only working
        instance of a capability (here: SOAP login to Salesforce with no Connected App). **Retire = commit the
        body to `docs/archive/` + record the capability + then delete.** Secrets stay until the capability's
        replacement consumes them.
  - **Diagnose it from Supabase `edge_logs`, not app logs.** Every PostgREST write carries the
    calling server's `request.headers.cf_connecting_ip`. Railway is a small set of STABLE
    addresses (`152.55.x`, `162.220.232.x`) carrying tens of thousands of requests; a serverless
    stand-in is a rotating pool of ephemeral AWS IPs each appearing for 40–255 requests with one
    narrow path fingerprint. ⚠️ **IP class alone is HALF a fingerprint — read `request.headers.user_agent`
    too (J13 preflight, 2026-09-09).** The Supabase edge runtime egresses from the SAME AWS pool; a
    10:00 UTC upsert to `briefing_intel_snapshot` was attributed to the frozen Vercel build until the UA
    read `Deno/2.1.4 (SupabaseEdgeRuntime/1.74.3)` — the `briefing-intel-snapshot` cron. The frozen
    build's real tell is UA `node` plus **400s on views the schema has moved past** (`v_my_work`,
    `mv_user_work_counts`), at 12:30:00 UTC on weekdays the desktop is awake. Joining those log lines to `created_at` separated 25 of 25 rows on
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
  Dry-run surface `v_lcc_domain_owner_candidates`; ambiguity lane `lcc_domain_owner_ambiguous`. Fill-blanks
  by default — **plus, since C2k (2026-09-16), `candidate_kind='supersede'`:** an asset resolved at a tier
  below `domain_true_owner` (never `manual`) whose gov facts row is `true_owner_attested` (SOS/SAM manager
  on the SPE names the true owner) is superseded, ledgered with the prior owner, reversible via
  `lcc_c2k_unsupersede(batch)`. Unattested domain rows stay fill-only; a name pattern is never attestation.
- **Ownership Resolution Engine (ORE):** multi-signal authority-weighted reconciliation
  (`lcc_reconcile_owner`, `lcc_signal_authority`, `lcc_reconcile_config.match_threshold`), owner-address
  observations store (append-only, never-collapse), SOS/deed/institution-registry enrichment. Full design:
  **government-lease** repo `docs/OWNERSHIP_RESOLUTION_ENGINE.md`.

---

## Known footguns (read before the matching change)

- **⚠️ `verify_jwt:false` + no `authenticateWebhook()` in the body = OPEN TO THE INTERNET — and the repo copy is not
  the proof; the DEPLOYED body is.** Found 2026-09-09 on `ai-copilot` (Dialysis_DB v79): 25 routes, a service-role
  client, zero auth, CORS `*` — reachable by CI runners with no key (TEST-NET-LEAK proved it by accident). Before
  calling any edge function "gated", fetch its deployed body (`get_edge_function`) and grep it for the door;
  before gating one, inventory its callers from `function_edge_logs` by path × user-agent × IP class and ship the
  gate in log-only mode first (COPILOT-OPEN). A browser caller can never be given the secret — route it through
  Railway (P194).
  **A "Railway-first" resolver is not a Railway-only resolver** — P194 made Railway the default when nothing
  was stored; a profile that still stored the retired origin kept using it for six weeks (EXT-HOST,
  2026-09-10, found by writer IP on `staged_intake_items`). When a host is retired, the resolver must
  *refuse* it, not merely stop *preferring* it — and the proof is the writer IP of a real capture, never the
  installed version number.
  **An edge function's `version` number is not its identity** — the counter moved +3 on every function in the
  project overnight with no deploy (2026-09-10). Compare `ezbr_sha256` and `updated_at`; quote the version only
  as the dashboard's label.
- **⚠️ A TEST THAT "EXPECTS THE AI TO THROW" MAY BE PROVING THE NETWORK IS UP — the suite is
  hermetic by guard since 2026-09-09 (TEST-NET-LEAK).** `test/lease-extractor.test.mjs` and
  `test/dossier-generator.test.mjs` assumed *"no AI key in the test env → the extractor throws"*,
  but `invokeChatProvider`'s default `edge` route needs no key — it POSTs straight to the live
  `ai-copilot/chat` edge function on Dialysis_DB, gets a 400, and the fallback chain swallows it
  before the assertion sees a difference. Measured: **14 live calls per `npm test` run**, matching
  `function_edge_logs` bursts from GitHub-hosted CI runners. `npm test` now loads
  `test/_helpers/net-guard.mjs` (`--import`, wraps `fetch`, throws on any non-loopback host) and
  `api/_shared/ai.js::invokeChatProvider` refuses the edge route before fetching under
  `NODE_TEST_CONTEXT`/`LCC_HERMETIC_TESTS`. **A NEW test that reaches a real host fails loudly
  (`net-guard`) instead of silently phoning production** — stub `fetch` (the `marketing-reassign`
  pattern) rather than relying on "there's no key so it'll fail." Guard:
  `test/hermetic-suite.test.mjs`.
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

## Entity identity & dedup — invariants (P189→P195→N15c/d/e→PR5c-entities-b-dupes→PR5c-entities-c→-review/-oldest; canonical page `docs/architecture/entity-identity-and-dedup.md`)

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
  - ✅ **`lcc_p195_unmerge` IS FIXED (ENTC, 2026-09-03) — and the recommendation to RETIRE it was
    refused on a measurement.** It reported `restored` while **stranding byte-identical edges on
    the winner**: three identical `(from, to, 'brokers')` edges are all snapshotted, and P196's own
    `trg_lcc_entity_rel_resolve_survivor` (BEFORE INSERT) skips the 2nd and 3rd as duplicates so
    they never reach `ON CONFLICT (id) DO UPDATE` — **P196's exact finding in the one reversal path
    that never got P196's fix.** It now uses P196's shape (UPDATE the survivors, INSERT only what
    was deleted) and reports want-vs-have residue in a new `note` column. Round trip on the same
    pair, rolled back: **24/24, 0 lost, 0 stranded, `restored` 17 → 19.**
    - ⚠️ **RETIRING IT WOULD HAVE MADE 66 LIVE MERGES IRREVERSIBLE.** `lcc_p195_merge_log` holds
      **66 open merges and ZERO of them have a `lcc_entity_merge_log` row** — they ran hours before
      P196 taught `lcc_merge_entity` to self-snapshot, so `lcc_unmerge_entity` answers
      `no_open_merge_log_row` for every one. Both ledgers start on 2026-08-27, which is exactly why
      "it is redundant now" reads true and is false. **Before retiring a superseded function, check
      the population it still owns — not the date the successor shipped.**
    - **The row COUNT is identical in both runs — only an identity-keyed fingerprint exposes it**,
      so a count-based verification of any unmerge is worthless.
    - All three definer unmerge functions (`lcc_p195_unmerge`, `lcc_unmerge_entity`,
      `lcc_a2a_unmerge`) were **narrowed to `service_role`** in the same change (0 PostgREST
      callers, censused), revoking from **both** `public` and the explicit `anon`/`authenticated`
      grants and asserting with `has_function_privilege()`.
      Writeup: `docs/audits/ENTC_JUNK80_AND_P195_UNMERGE_2026-09-03.md`.
- **`entities.domain` is a PROVENANCE tag (`dia`/`gov`/`lcc`/`cre`), not an identity scope.**
  `ensureEntityLink`'s canonical_name tier carried `&domain=eq.` and minted duplicates on 9 of 11
  same-email pairs (fixed `d5b0ac8`). **The email tier keeps the same filter ON PURPOSE** — read on
  named rows, 40 of 55 cross-domain same-email pairs are two real brokers on one mailbox, firms filed
  as persons, or P131 row labels; **an attach is worse than a duplicate** (a duplicate merges
  reversibly later; a wrong attach folds two people at write time). Guard goes RED if it is removed.
  - ✅ **THE 80 JUNK ROWS ARE CENSUSED AND THE PRODUCER IS GATED (ENTC, 2026-09-03) —
    `v_lcc_entities_c_junk80`.** ⚠️ **They are NOT one class and a blanket sweep clears a real
    person's mailbox**: 41 `sweep_candidate` · 27 `hold_salesforce_identity` · **6
    `hold_email_corroborated`** (a ≥4-char name token sits inside the mailbox's own localpart —
    `Eyal (Al) Elkayam`/`eyal@`, `Hunt`/`hunt@`, `Jackson`/`kjackson@` — the row IS that mailbox's
    person) · 4 `hold_inbound_reference` · 2 `hold_name_repairable` (a real person behind a CoStar
    `Seller Contacts…` prefix — `rename`, not retire). Only `sweep_candidate` proposes `dismiss`;
    every hold seeds `uncertain` at confidence 0. Path is the EXISTING `junk_entity_review` lane,
    whose confirm effect (`unstampMisparseMember`) clears the email + identities, is reversible via
    `junk_review_batch`, and **never touches relationships** — so the 480-edge vendor rows keep
    their deal history. **⚠️ The un-stamp was keyed on `heuristic === TM_MISPARSE_HEURISTIC`, so a
    junk80 dismiss would have soft-retired WITHOUT clearing the mailbox**; it is keyed on the CLASS
    now (`EMAIL_CONFLATION_HEURISTICS`) rather than relabelling these rows `tm_misparse`, which
    would have been a lie in the ledger.
    - ⚠️ **THE ENTITY MINT HAD A WEAKER GUARD THAN THE WRITE BESIDE IT.** `upsertSidebarContacts`
      always dropped a candidate failing `isJunkContactName`; `unpackContacts` (the ENTITY mint)
      applied only the TrafficMetrix detector, so a firm name / section label / verification
      sentence carrying a real mailbox minted a **person entity**. `planContactMinting` now takes an
      **injected** `personJunkName` filter (injected, not imported — sidebar-pipeline imports
      tm-misparse, so importing back is circular and a second regex copy is normaliser drift), and
      it is **PERSON-ONLY**: `isJunkContactName` rejects firm suffixes, so running it on an
      organization candidate would block every legitimate company mint. **Measured reach: 38 of the
      80 names (47.5%), and 0 of the 6 corroborated real people** — the residue needs
      `lcc_p131_is_document_row_label`, which has no JS twin.
    - ⚠️ **Two corrections to the prior audit: 11 of the 80 DO carry `metadata.junk_name_flagged`
      (not 0), and "37 alone on their mailbox" is domain-scoped — by email address it is 31.** The
      view emits both counts.
    - ⚠️ **The brief's two verification targets are in tension and the protective one wins:** the
      simulated sweep takes junk-oldest contested mailboxes **14 → 3** but `alone` only **37 → 29**,
      because 23 of the 37 carry a Salesforce identity and go to review by design.
  - ⚠️ **AND THE OLDEST-ROW-WINS GATE WAS MEASURED AND REFUSED (2026-09-03).** The email tier takes
    the oldest match without checking it is person-shaped, so an inbound real person can attach to a
    P131 document row label. Over the 193 same-domain mailboxes holding ≥2 live person entities,
    **26 oldest rows are clearly not one person and every SQL guard combined catches 12 of them**
    (`lcc_looks_like_person` PASSES 16); **171 of 193 groups have ≥2 rows passing every guard**, so
    a shape gate cannot pick; and **37 of the 80 junk-named rows are alone on their mailbox**, where
    no tiebreak exists. **Retire the junk rows instead** (`PR5c-entities-c-junk80`) — none of the 80
    is in `junk_entity_review` or carries `metadata.junk_name_flagged` today. Also unstated in every
    prior note: the tier's `.find` runs over the **oldest 10 rows only**, and an inbound with **no**
    domain searches the whole workspace.
- **Before fixing a lookup, prove from a run ledger that it RAN.** The dupes brief named
  `findEntityForUpsert` (the SF bridge); `bridge_runs` showed **zero** bridge runs in the window —
  the writers were the `lcc-sf-contact-resolve` tick (cron 165) and the CoStar sidebar. And
  **`git rev-parse --is-shallow-repository` before dating anything from history** — a shallow clone
  reports the graft boundary as the "add" (published as a finding, retracted the same day).
- **THREE ~0.14 s intra-request races remain and no predicate fixes them** (re-measured
  2026-09-03: the third is two live `Matthew Dodson` entities on one gov mailbox, created 0.107 s
  apart, which the prior audit read as a duplicate view row) — they need the
  `(workspace_id, canonical_name)` unique constraint, which is N15e's open operator decision
  (**6,608** violating groups on the N15c key — up from 3,930 because collapsing keys is what
  creates collisions; surfacing them is the fix working). Expect ~0.6% residual duplicate mint.
- **Honest rates, with definitions:** 326 SF-Contact creates / 13 on an existing live key (3.99%) /
  11 probable duplicates (3.37%) → post-fix not yet measurable (0 mints since). Re-derive, never quote.

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

## Round lessons, 2026-08-14 → 2026-09-02 — archived verbatim (pass 1 of the CLAUDE.md consolidation, 2026-09-16)

The 34 dated round narratives that lived here were moved **verbatim** to
[`docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md).
Nothing was reworded or dropped. Each title *is* its lesson; the doctrine each one earned already lives in
"Core doctrines" or "Known footguns" above. Read the archive when you need the numbers and the mechanism of a
specific round; do not quote its counts as current — several have moved (the C1 Salesforce lanes were retired
2026-09-16, C1C). State questions go to `docs/os/CURRENT-STATE.md`.

| round | lesson (the section title, verbatim) |
|---|---|
| [P131](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p131-the-dead-research-queues-draft-then-confirm-2026-08-26) | P131 — the dead research queues: draft-then-confirm (2026-08-26) |
| [A1](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a1-one-lane-four-jobs-split-it-before-automating-any-of-them-2026-08-27) | A1 — one lane, FOUR jobs: split it before automating any of them (2026-08-27) |
| [A2](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a2-the-lanes-first-completion-and-four-traps-in-getting-there-2026-08-27) | A2 — the lane's first completion, and four traps in getting there (2026-08-27) |
| [A2a](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a2a-merging-the-duplicates-that-blocked-the-chains-the-producer-was-not-r9-2026-08-27) | A2a — merging the duplicates that blocked the chains; the producer was NOT r9 (2026-08-27) |
| [A2b](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a2b-one-conveyance-recorded-on-several-dates-the-mechanism-was-not-the-flicker-2026-08-27) | A2b — one conveyance recorded on several dates; the mechanism was NOT the flicker (2026-08-27) |
| [A3](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a3-the-mismatch-lane-is-a-representation-question-74-chains-12-decisions-2026-08-27) | A3 — the `mismatch` lane is a REPRESENTATION question; 74 chains → 12 decisions (2026-08-27) |
| [P138 / R8 Stage 1](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p138-r8-stage-1-the-briefs-analysts-take-generated-on-box-2026-08-26) | P138 / R8 Stage 1 — the brief's "Analyst's Take", generated ON-BOX (2026-08-26) |
| [P134](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p134-an-llm-assist-is-only-as-good-as-the-context-payload-2026-08-26) | P134 — an LLM assist is only as good as the CONTEXT payload (2026-08-26) |
| [P137](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p137-the-provenance-lane-punted-because-the-items-never-arrived-2026-08-26) | P137 — the provenance lane punted because the ITEMS NEVER ARRIVED (2026-08-26) |
| [P139](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p139-two-incomparable-rank-scales-sharing-one-budget-2026-08-26) | P139 — two incomparable rank scales sharing one budget (2026-08-26) |
| [P188](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p188-the-tier-0-confirm-lane-evidence-attests-the-person-not-the-link-2026-08-26) | P188 — the Tier 0 confirm lane: EVIDENCE ATTESTS THE PERSON, NOT THE LINK (2026-08-26) |
| [P194](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p194-the-tier-0-auto-attach-sweep-and-three-traps-it-hit-on-the-way-2026-08-26) | P194 — the Tier 0 auto-attach sweep, and three traps it hit on the way (2026-08-26) |
| [P196](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p196-a-park-needs-a-reason-and-the-two-prescribed-fixes-were-measured-2026-08-27) | P196 — a park needs a REASON, and the two prescribed fixes were measured (2026-08-27) |
| [P198](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p198-before-demoting-a-rule-measure-what-depends-on-it-2026-08-27) | P198 — ⚠️ BEFORE DEMOTING A RULE, MEASURE WHAT DEPENDS ON IT (2026-08-27) |
| [P197](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#p197-the-tier-0-lane-read-one-employer-source-by-one-key-2026-08-27) | P197 — the Tier 0 lane read ONE employer source, by ONE key (2026-08-27) |
| [N18](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#n18-a-column-compared-to-itself-returns-a-plausible-wrong-number-2026-08-27) | N18 — a column compared to ITSELF returns a plausible, wrong number (2026-08-27) |
| [A5](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a5-a-truncated-feed-auto-closed-the-work-it-could-not-see-2026-08-27) | A5 — a truncated feed auto-closed the work it could not see (2026-08-27) |
| [A5a](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a5a-fixed-and-the-blast-radius-was-15-the-diagnosis-2026-08-27) | A5a — FIXED, and the blast radius was 15× the diagnosis (2026-08-27) |
| [A5c](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#a5c-the-producer-had-no-value-gate-71448-2530-admitted-2026-08-27) | A5c — the producer had no value gate: 71,448 → 2,530 admitted (2026-08-27) |
| [C1](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#c1-the-salesforce-lanes-already-had-a-consumer-on-a-different-surface-2026-08-27) | C1 — the Salesforce lanes already had a consumer, on a different surface (2026-08-27) |
| [B1](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#b1-a-value-gate-belongs-on-what-reaches-a-human-not-on-what-a-cron-applies-2026-08-28) | B1 — a value gate belongs on what reaches a HUMAN, not on what a cron applies (2026-08-28) |
| [C2e](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#c2e-the-eligible-set-asset-mint-the-floors-stated-cost-was-measured-and-is-mostly-not-real-2026-08-28) | C2e — the eligible-set asset mint: the floor's stated cost was measured and is mostly not real (2026-08-28) |
| [C2e-T2a](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#c2e-t2a-tranche-two-step-one-the-prediction-missed-by-2-and-the-2-were-the-finding-2026-08-28) | C2e-T2a — tranche two step one: the prediction missed by 2, and the 2 were the finding (2026-08-28) |
| [B6c-dup](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#b6c-dup-two-stores-for-one-fact-each-naming-itself-canonical-2026-08-29) | B6c-dup — two stores for one fact, each naming ITSELF canonical (2026-08-29) |
| [C10](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#c10-a-consumer-can-read-columns-its-source-has-never-had-and-nothing-errors-2026-08-31) | C10 — a CONSUMER can read columns its source has never had, and nothing errors (2026-08-31) |
| [C11](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#c11-the-call-sheet-named-a-person-and-never-said-why-2026-08-31) | C11 — the call sheet named a person and never said why (2026-08-31) |
| [C13b](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#c13b-the-owner-role-classification-is-a-set-and-three-of-its-inputs-were-wrong-2026-09-01) | C13b — the owner-role classification is a SET, and three of its inputs were wrong (2026-09-01) |
| [C13c](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#c13c-an-escalation-must-carry-its-confidence-and-the-fourth-column-answered-2026-09-01) | C13c — an escalation must carry its confidence, and the fourth column answered (2026-09-01) |
| [UX-T0](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#ux-t0-the-app-defect-sweep-four-hypotheses-refuted-two-removals-refused-2026-09-02) | UX-T0 — the app defect sweep: four hypotheses refuted, two removals refused (2026-09-02) |
| [UX-T1a-gates](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#ux-t1a-gates-a-mirror-gap-a-slot-with-the-wrong-producer-and-941-rows-off-the-human-surface-2026-09-03) | UX-T1a-gates — a mirror gap, a slot with the wrong producer, and 941 rows off the human surface (2026-09-03) |
| [OWN-T0](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#own-t0-the-panel-showed-four-ownership-stores-and-reconciled-none-of-them-2026-09-02) | OWN-T0 — the panel showed four ownership stores and reconciled none of them (2026-09-02) |
| [dia property "address twins"](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#dia-property-address-twins-decision-center-lane-propertytwin-2026-08-14) | dia property "address twins" — Decision Center lane `property_twin` (2026-08-14) |
| [dia Deals ▸ Ownership](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#dia-deals-ownership-a-curated-allowlist-wearing-a-detectors-clothes-2026-08-29) | dia Deals ▸ Ownership — a curated allowlist wearing a detector's clothes (2026-08-29) |
| [CM export](docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md#cm-export-a-kpi-tile-and-its-data-tab-must-read-one-view-prompt-119-2026-08-18) | CM export — a KPI tile and its data tab must read ONE view (Prompt 119, 2026-08-18) |

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
