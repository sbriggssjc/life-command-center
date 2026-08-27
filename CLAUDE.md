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

## Rules

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
  - **The fix is small and offered:** a `pull_request` job running `npm ci && npm test`. The suite
    runs fully offline — no secrets, no network, no DB. It is **not** built yet because widening a
    docs/lane PR into a CI-policy change was not Claude Code's call to make.
    Backlog row **N9** in `docs/os/PLANNED-BACKLOG.md`.

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

### The failure mode that matters looks exactly like success

Every silent failure found on 2026-08-19/20 reported healthy: `pages_fired: 6` with every page empty;
`rate_limited:true` with `api_calls:0` behind a fail-soft that skips the "checked" mark so a 98%
throttled pipeline is indistinguishable from a slow healthy one; `drillthrough: 37` while the queue
drained 6; `HTTP 200 []` from a view anon cannot read; cron 136/137 green daily for three weeks while
writing nothing. **Assert on the STATE DELTA — rows written, queue drained, population changed — never
on the worker's own tally, its exit status, or "the cron is active".**

### Producer/Consumer (Consumption Layer)

LCC produces work (research tasks, cadences, decisions, queue rows, inbox items) at ingestion scale and
historically under-consumed it, so surfaces filled with un-worked noise that buried the actionable few (the
worst failure mode: a `5,447` / `999+` badge that is mostly noise trains the operator to ignore the surface).
**Every code path that emits operator-facing work MUST satisfy all five:**

1. **Value-gate the producer.** Emit only above an actionability/value floor — never one item per captured row.
   The floor is a single tunable knob (e.g. `$500k` chain-task floor; `CADENCE_SIGNAL_MIN_VALUE`).
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

### Deploy ordering (constant rule)

When a change spans DB + JS: **apply the additive/DB migration first, then ship the JS on the Railway
redeploy.** A DB `CHECK` constraint that enforces new writer output must be applied **AFTER** the writer deploy
(else the still-deployed old writer 500s every write). "Constraint after writer deploy; additive schema before."

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
  curated field, register a `field_source_priority` row** or this view flags drift.
- **`v_field_provenance_actionable`** / `v_field_provenance_current` / `v_field_provenance_conflicts` — drive
  the Decision Center provenance lanes.

Full rollout plan: `docs/architecture/data_quality_self_learning_loop.md`. Schema:
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
  - Ruled out already, do not re-walk: stale deploy (live `/version` **includes** the P61
    commit), a second writer (exactly one insert site, `intake-extractor.js:751`, with both
    guards on the lines above it), a flow writing the table directly (none).
    Full measurement + the open hypothesis: `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`.
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
- **Caps:** DocAI sync ~15 pages (`over_page_cap` → gpt-4o last resort), `INTAKE_OCR_MAX_BYTES` 12MB
  default; bigger scans go off-box via the `ocr_text` resubmit seam
  (`POST /api/intake?_route=lease-backfill&id=<id>`). Optional: `AI_OCR_MODEL=gpt-4o-mini`.

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
  (`v_field_provenance_unranked` still returns **35** rows for other tables — pre-existing drift.)
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
- **Tier 0 owner-contact confirm lane (P186→P188→P194):** `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`
  (the bench, its precision curve, and the decision not to build a promoter) →
  `docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md` (the lane that turns it into calls) →
  `docs/audits/P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md` (the auto-attach sweep, the
  `<>`-exclusion trap that would have hidden live cards, and the measured refutation of P192's
  un-park and learn-from-rejects claims).
- **On-box daily-brief narrative (Analyst's Take), R8 Stage 1:** `docs/architecture/briefing-analyst-take-onprem.md` — the first net-new on-prem GENERATION surface, its fabrication guard, and the operator gate.
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
