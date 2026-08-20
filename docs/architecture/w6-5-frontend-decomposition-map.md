# W6.5 — Front-end decomposition map & staged extraction plan

> **Grounding:** `LCC_Audit_Rollout_Plan.md` §W6.5. The SPA monoliths — `detail.js`
> (~950 KB), `app.js` (~640 KB), `ops.js` (~470 KB) — are the riskiest edit surface
> in the repo. Every surgical edit into them is a truncation hazard. W6.5 breaks
> them into loadable regions **staged**, lowest-coupling first, with **byte-identical
> behavior** at each stage (no feature changes ride along).
>
> **Status:** Stage 1 COMPLETE (this doc + `dc-lanes.js` extraction). Stages 2+ are
> planned below and ship as separate prompts.

---

## 1. The loading seam (no bundler)

**Decision: classic ordered `<script>` split, not ES modules.**

Production is the Railway Express server serving these JS files **statically from
the repo root** (`ops.js?v=…`, `app.js?v=…`, …). There is **no bundler** and no
build step for the front-end. `index.html` loads the app as a sequence of **classic
(non-module) `<script src>` tags** — only `review-shared.js` is `type="module"`.

Classic scripts on one page **share a single global scope**: a top-level
`function foo(){}` / `var`/`let`/`const` in one file is visible to every other
classic script (functions and `var` via `window`; top-level `let`/`const`/`class`
via the shared global lexical environment). The monoliths rely on this everywhere —
`ops.js` calls `esc`/`opsApi` defined in `app.js`; `detail.js` calls
`switchUnifiedTab`; etc.

Two options were considered:

| Option | Verdict |
|---|---|
| **ES modules** (`<script type="module">` + `import`/`export`) | ❌ Rejected for the split regions. Modules get their **own scope** — every cross-file reference (hundreds of them: `esc`, `opsApi`, `showToast`, `navTo`, `openUnifiedDetail`, …) would need an explicit `import`, and every function used from an inline `onclick="…"` HTML string would need an explicit `window.X = X` export. That is a large, error-prone rewrite that cannot be byte-identical. Reserve modules for genuinely leaf/new code. |
| **Classic ordered `<script>` split** (extract a region into a new classic file, load it in dependency order) | ✅ **Chosen.** The extracted file stays in the same shared global scope, so **no reference rewiring is needed** and behavior is byte-identical. Load order is the only new invariant: a file must be loaded before any top-level (eval-time) use of its bindings. Because virtually all cross-file use is at *call time* (inside functions/onclick), order is forgiving; we still load dependencies-first to be strict. |

**How a region is extracted (the Stage-1 recipe, reusable):**
1. Pick a contiguous, low-coupling region (its symbols are referenced elsewhere
   only via `onclick="…"` strings, comments, or call-time calls — never a
   top-level eval-time read).
2. Move the region **verbatim** into a new classic file `<region>.js` at the repo
   root (sibling of `ops.js`).
3. Add `<script src="<region>.js?v=…"></script>` in `index.html` immediately
   **before** the file it was extracted from; bump the extracted file's `?v=` too.
4. Leave a pointer comment where the region was.
5. Update any guard test that reads the moved region's **file path** (read the
   concatenation of the two files) — assertions unchanged.
5b. **⚠️ ALSO fix any test that SLICES a moved function and `eval`s it in
   isolation — step 5 does not cover those, and Stage 1 shipped one broken.**
   `_fedCardHTML` moved to `dc-lanes.js` but still calls `_cleanAssistHTML`,
   which stayed in `ops.js`. Production is fine — that is the whole point of the
   classic-script shared global scope — but an isolated `new Function(...)`
   sandbox has only the stubs the test declares, so the cross-file callee is a
   **ReferenceError**. Two `w3-6-display-name-resolution` tests failed this way
   from Stage 1 until 2026-08-20. **The load-order guard cannot catch it** (it
   asserts file structure, not eval-ability), and neither can the tab-registry
   guard. Before extracting, grep the test dir for the moved function name; any
   `sliceFn(... , 'function <moved>(')` needs a stub for every callee left
   behind. Prefer a faithful minimal stub (match the real fn's return for the
   fixture's shape), and say in a comment why it exists.
6. Add/extend the load-order smoke test.
7. **Bump the cache buster on the WHOLE coupled set, not just the file you
   edited.** `panel-redesign.test.mjs` enforces that `app.js` / `detail.js` /
   `detail-rent.js` / `ops.js` / `styles.css` share one `?v=`, because a client
   that gets fresh CSS and a cached old script is an unrecoverable UI. Add each
   newly-extracted file to that set — a fresh parent paired with a cached
   extracted child is the same stale mix. (This guard caught Unit 1 mid-flight.)
8. **After the redeploy, confirm the NEW FILE IS ACTUALLY SERVED.**
   `npm run verify:deploy` now probes every local `<script src>` in index.html
   (added 2026-08-20, prompted by Unit 1). Before that it only checked `/version`
   and `/api/*`, so a newly-added front-end file that failed to ship would 404 in
   the browser — every symbol it defines undefined at call time — while the gate
   stayed green. The SPA catch-all makes it worse: a missing `.js` can return
   **HTTP 200 with index.html in the body**, so the check asserts on the BODY,
   not the status code.
   ⚠️ Run it only AFTER Railway finishes rebuilding — running it immediately
   after `git push` reports a SHA mismatch that is just a timing race, not a
   stale deploy.

> **Path note:** the W6.5 prompt suggested `public/js/dc-lanes.js`, but this repo
> serves front-end JS from the **repo root** (there is no `public/js` on the served
> path — `public/` holds only `reports/`). To match the existing model (`ops.js`,
> `app.js`, `detail.js` all at root) the new module is `./dc-lanes.js` at the root.

Hash-routing is unaffected: `applyRoute()` and the `ROUTE_*` maps stay in `app.js`;
splitting a renderer out of `ops.js`/`detail.js` does not touch the router.

---

## 2. Seam inventory (region → coupling → target module)

### 2a. `ops.js` (~470 KB) — Ops / Review Console / Decision Center / Priority Queue / Draft-&-Log

| Region (approx lines, pre-Stage-1) | What it is | Coupling | Target module | Stage |
|---|---|---|---|---|
| Review Console + Ops Health (1671–1826) | lane console shell, health tiles | med (shares lane list) | keep in ops.js (core shell) | — |
| **Decision Center partition + SUBLANES + seeded-lane renderers** (1827–2596) | `_DC_FEDERATED` set, `_dcIsVerdictLane`, `SUBLANES`, `renderReviewConsolePage`, badge overrides, `_dcCardHTML`, buyer-parent lane | **high** — the lane partition + page shell; referenced by both seeded and federated code | **keep in ops.js** (the partition primitive `_DC_FEDERATED` must stay; the W8 wiring + DC-partition guards key on it) | — |
| **Federated decision lanes** (2597–3608) | `_DC_FED_META`, `_fedMoney`, `_fedCardHTML` (17 `_dcFedType` branches), `renderFederatedLane`, `_DC_BULK_SAFE`, `dcFedBulkSafe`, `dcFedBulkHygieneRenames`, per-verdict helpers (`dcImplausibleCorrect`, `dcOwnerParentSet`, `dcConfirmSuspectedSale`, `dcResolveConfirmSale`), `dcFed`, `dcFedU3Pick`, `dcMergeGroup`, `cclLink`, `dcCmsUnlink`, `_dcAdvanceFed` | **LOW** — external references are ONLY `onclick="renderFederatedLane('…')"` strings in SUBLANES + comments; uses ops.js globals at call time; self-contained state (`_dcFedArr`/`_dcFedType`) | **✅ `dc-lanes.js`** | **1 (DONE)** |
| Seeded-lane verdict tail (3610–3760) | `dcStale`, `_dcSfCand`, `dcSf*`, `dcMap`, `dcVerdict`, `_dcAdvance` | med (seeded lanes) | keep in ops.js | — |
| Priority Queue (3761–~4039) | `_pqBandColor`, band renderers | med | candidate → `pq.js` | 2c |
| Draft & Log / Outreach (4040–~5048) | email draft bridge, log+reschedule | med | candidate → `ops-draft-log.js` | 2c |
| Research worklists (5049+) | metadata backfill, SOS worklist | low–med | candidate → `ops-research.js` | 2c |

**Stage 1 extracted the federated block only** — the single lowest-coupling region,
and the one the W8 campaign touched most (so it carries the most future edit risk),
already covered by the 75-assertion lane-wiring guard + the DC partition guard.

### 2b. `detail.js` (~950 KB) — the property/entity/contact slide-over, **by tab**

`openUnifiedDetail` (78) builds the shell + tab strip; `switchUnifiedTab` (889)
dispatches to per-tab renderers. Tabs are the natural seam. Candidate extraction
order (lowest coupling first), each a classic file loaded before `detail.js`:

| Tab / region | Target | Notes |
|---|---|---|
| ~~Rent source-tier policy + escalation parser (3403–3620)~~ | `detail-rent.js` | ✅ **DONE 2026-08-20 (Unit 1)** — real range was 3549–3826 |
| ~~Documents tab (9089+)~~ | `detail-tab-documents.js` | ✅ **DONE 2026-08-20 (Unit 2)** — real range 9240–9452; also carried the client-dossier builders |
| Entity tabs — Overview/Relationships/History/Activity/Deals/Portfolio/Contacts (13363–15267) | `detail-entity.js` | ⚠️ **RANGE IS WRONG — see the correction below. Do not use it.** |
| Contact 360 + Contact tabs (13149–15460) | `detail-contact.js` | ⚠️ **RANGE IS WRONG — overlaps the row above. See below.** |
| Companion docks (13792–14029) | fold into `detail-entity.js` | ⚠️ **NO — this is the panel shell, and it is its own module. See below.** |

> ### ⚠️ CORRECTION 2026-08-20 — the entity/contact rows above do not survive contact with the file
>
> Re-measured after Units 1 and 2 (line numbers below are post-extraction and
> will shift again). **Three things are wrong with the original plan:**
>
> 1. **The two ranges OVERLAP** (13363–15267 vs 13149–15460). They were written as
>    if each were a contiguous block. They are not — entity and contact functions
>    interleave.
> 2. **The PANEL SHELL sits in the middle of them**, and the proposed
>    `detail-entity.js` range would swallow it whole:
>    `DUAL_DOCK_MIN_WIDTH`, `_PANEL_W`, `_panelClampWidth/SetWidth/GetWidth/
>    RestoreWidths/InitResizers/SyncResizers/AnchorResizer`, the tray
>    (`_panelTrayRender/ParkSig/Park/Drop/Restore`), `_panelSwap`,
>    `minimizePrimary`, `openCompanionProperty/Entity`, `minimize/restore/
>    closeCompanion`. That is window management, not entity-tab rendering, and
>    `detail-tab-registry.test.mjs` explicitly requires the shell to stay put.
> 3. **The entity tabs are SPLIT around it** — 21 entity/contact functions before
>    the panel cluster, 25 after. Neither half is contiguous with the other, so
>    "extract the entity tabs" is not one region-move.
>
> **What the file actually supports (revised order):**
>
> | # | Region | Target | State |
> |---|---|---|---|
> | 3 | panel geometry + tray + companion dock | `detail-panel-shell.js` | ✅ **DONE** — 13838–14546, 702 lines, 19 window exports |
> | 4 | entity tabs block B (`_ENTITY_REL_SECTIONS` … `_entityTabDeal`) | `detail-entity-tabs.js` | ✅ **DONE** — 13846–14615, 763 lines |
> | 5 | the entity tab bodies Unit 4 MISSED (`_entityGenerateDossier` … `_entityTabContacts`) | `detail-entity-tabs.js` (appended) | ✅ **DONE** — 13854–14198, 345 lines |
> | 6 | `_entityTabOverview` + its render-helper cluster | `detail-entity-tabs.js` | ✅ **DONE** — 13435–13836, 402 lines; the guard's carve-out for it is now GONE |
> | 7 | the subject OPENERS + "Log call" modal | **`detail-openers.js`** | ✅ **DONE** — 13075–13385, 311 lines. ⚠️ the map's name `detail-contact.js` was WRONG: `openEntityDetailByName` is an ENTITY opener in the same resolve-and-open family (all four share `_entityApiFetch`), so the file is named for what it is |
> | — | entity DISPATCHER (`ENTITY_DETAIL_TABS`, `openEntityDetail`, `switchEntityTab`, `_renderEntityTab`) + the shared completeness-rail / Next-Step chrome | **STAYS in detail.js** | 🔒 pinned by guard — shell, not content |
>
> **STAGE 2 COMPLETE — UNITS 1–7 (2026-08-20):** `detail.js` **18,481 → 15,505 lines**
> (1,037,393 → 859,844 bytes, **17.1% smaller**). SIX siblings, every region
> byte-identical (sha256 verified before/after), every unit mutation-tested.
> Guards: **115 assertions** across `detail-tab-registry`, `frontend-module-load-order`
> and `panel-redesign`. The map's seam inventory was wrong **four times** (stale
> ranges every unit; the panel shell mis-filed under entity tabs; overlapping
> entity/contact ranges; and `detail-contact.js` as a name for a module holding an
> entity opener) — each caught by measuring the file instead of trusting the doc.
> **Nothing of `detail.js` remains on the mapped inventory.** What is left is
> pinned by design: the property-tab renderers, the entity dispatcher, the shared
> completeness-rail / Next-Step chrome, and `_entityApiFetch`.
>
> **⚠️ UNIT 4 SILENTLY LEFT WORK BEHIND, and no guard noticed.** It moved 7 of 12
> `_entityTab*` bodies; five stayed in a second block further down. Everything
> passed, because the tab-registry guard asks whether a tab reaches a renderer
> that EXISTS — and it did. **"Reachable" and "in the right module" are different
> properties.** The load-order guard now asserts the second one too: no
> `_entityTab*` body may remain in `detail.js` (documented exclusions:
> `_entityTabsForRole`, a dispatcher helper; `_entityTabOverview`, pending #6).
> Before declaring any future unit done, grep the parent for what you claimed to
> have moved.
>
> **⚠️ STEP 5b HAZARD ON #3 — this one WILL bite.** `panel-redesign.test.mjs`
> (89 tests) slices panel functions straight out of `detail.js`:
> `sliceFn(detailSrc, '_panelClampWidth')` (line 72) and
> `sliceFn(detailSrc, '_panelParkSig')` (line 120). Moving the cluster breaks
> both unless `detailSrc` is first repointed at the concatenation of `detail.js`
> + every `detail-*.js`. Do that in the SAME change, per step 5b.

Shell (`openUnifiedDetail`, `switchUnifiedTab`, tab strip, beforeunload guard) stays
in `detail.js`. **Guard to add before Stage 2:** a tab-registry test asserting every
tab label in the strip has a reachable renderer (mirror of the W8 lane-wiring guard).

### 2c. `app.js` (~640 KB) — shell, nav, **hash router**, task store, treasury chart

| Region | Target | Notes |
|---|---|---|
| Custom modal (`lccPrompt`/`lccConfirm`) (1945+) | `app-modal.js` | leaf utility, **best first candidate** |
| Treasury yield chart (6889+) | `app-treasury-chart.js` | self-contained Chart.js block |

### Stage 3, Unit 3 — `app-export-comps.js` (SHIPPED 2026-08-20)

`exportCompsToXlsx` + its `window` export, app.js 12615–12686 (sha256 `e97dba86c3f8f9d2`,
byte-identical). A genuine leaf — reads only its arguments, calls the CDN-global `XLSX`,
reports via `showToast`. 96 lines out; `app.js` 12,712 → 12,646.

**The load-bearing detail: its ONLY callers are inline `onclick` strings built by OTHER
files** — `dialysis.js` (~10197) and `gov.js` (~9336) both emit
`onclick="exportCompsToXlsx(<domain>FilteredSalesData, 'sales')"`. Nothing calls it
lexically. Drop `window.exportCompsToXlsx = exportCompsToXlsx;` and both Export buttons
render perfectly and do nothing, silently — the exact hazard §2b warns about, here in its
purest form. The guard asserts the export by name AND that both callers still invoke it
by that name, so renaming either half fails.

Four mutations, all fail correctly: drop the window export (1 suite); break the
`dialysis.js` onclick (1); leave a copy behind in `app.js` (**2** — load-order and the
duplicate detector catch it independently); load the sibling after `app.js` (1).

Neighbours deliberately left in `app.js`: the LiveIngest window exports immediately above
the region, the iOS install banner immediately below. Adjacent in the file, unrelated in
purpose — the third unit running where the file's line order carried no grouping meaning.

| Export-comps-to-Excel (12920+) | `app-export-comps.js` | leaf, XLSX only |
| **Hash router** (`ROUTE_*`, `applyRoute`, `_routeParseHash`, `navTo`, `_detailStack*`) (988–2300) | **keep in app.js** | the router is the spine — extract last, if ever |
| Shared task store + SF task sync (**5304–5564**, corrected) | `app-tasks.js` | SHIPPED — see below |

Router stays put; extract leaves first. **Do not** move `applyRoute`/`ROUTE_*` in an
early stage — hash routing is the load-bearing invariant.

---

## 3. Staged plan (each stage = one prompt, byte-identical, guards green)

- **Stage 1 (DONE):** loading seam + `ops.js` federated lanes → `dc-lanes.js`.
  Guards: W8 lane-wiring (75-assertion) + DC-partition + new load-order smoke.
- **Stage 2 (detail.js by tab):** start with `detail-rent.js` (pure helpers), then
  `detail-tab-documents.js`, then the entity/contact tab clusters. Add the
  tab-registry guard first.
- **Stage 3 (app.js by leaf):** `app-modal.js` → `app-treasury-chart.js` →
  `app-export-comps.js` → `app-tasks.js`. Router extracted last, if at all.
- **Stage 4 (ops.js remainder):** ⚠️ **RE-MEASURED 2026-08-20 — the original three-module
  proposal does not survive contact with the file. See §3a below before starting.**

Ordering rule: **lowest coupling first, load dependencies-first, one region per
prompt, re-run guards + `npm run verify:deploy` each time.**

---

## 4. Stage 1 result (this change)

- **New file:** `dc-lanes.js` (repo root, classic script) — the federated Decision
  Center lane meta + card renderers + verdict handlers, moved **verbatim** from
  `ops.js` (lines 2597–3608). `ops.js` shrank ~1,010 lines; a pointer comment marks
  the old location.
- **`index.html`:** `dc-lanes.js` loads immediately **before** `ops.js` (both `?v=`
  bumped). Same global scope ⇒ byte-identical behavior; hash routing untouched.
- **`_DC_FEDERATED` and the seeded-lane renderers stay in `ops.js`** — they are the
  lane partition and page shell the guards key on.
- **Guards:**
  - `test/w8-federated-lane-wiring.test.mjs` — path widened to read
    `ops.js` **+** `dc-lanes.js` (both halves are one runtime surface); all 75
    assertions unchanged, green.
  - `test/decision-center-partition.test.mjs` — no change needed (`_DC_FEDERATED`
    stayed in `ops.js`), green.
  - `test/w3-6-display-name-resolution.test.mjs` — source read widened to the
    concatenation so the `_fedCardHTML` slice resolves from `dc-lanes.js` (2
    pre-existing eval-stub failures on `_cleanAssistHTML` are unchanged by this
    change — they fail identically on `main`).
  - **New:** `test/frontend-module-load-order.test.mjs` — pins that `dc-lanes.js`
    loads as a classic script **before** `ops.js`, both parse (`node --check`), the
    federated surface lives in `dc-lanes.js`, and the partition stays in `ops.js`.
- `npm run verify:deploy` is unaffected (it probes `/version` + `/api/*` JSON, not
  front-end file layout).

### Stage 3, Unit 4 — `app-tasks.js` (SHIPPED 2026-08-20)

app.js 5304–5564 (sha256 `8c2fddebb3d370fb`, byte-identical). `app.js` 12,646 → 12,392.
The shared task store, the fire-and-forget Salesforce outbound sync, and the three
public actions `completeTask` / `rescheduleTask` / `dismissTask`.

**⚠️ THIS ROW OF THE MAP WAS WRONG IN BOTH DIRECTIONS — the worst miss in W6.5 so far.**
It said 5361–6260. That range starts **57 lines too late**, excluding
`_updateTaskInAllStores` — the store the entire module exists to own — and runs
**~700 lines too far**, which would have swept FOUR unrelated subsystems into a file
named `app-tasks.js`:

| swept in by the map's range | what it actually is |
|---|---|
| `mktReclassifyDeal`, `mktMatchLead`, `mktUpdateStatus`, `openMktEmail` | Marketing actions |
| `renderProspects`, `initProspectsSearch`, `execProspectsSearch` **+ 3 top-level `let`s** | Prospects search |
| `showDetail`, `closeDetail`, `switchDetailTab`, `renderDetail*` + `window._detailRecord` | detail-record view |
| `openLogCall`, `openLogAndReschedule`, `submitLogReschedule`, `var _lrData` | two modals |

The "reclassify" in the map's own label is `mktReclassifyDeal` — **Marketing, not tasks**.
The three Prospects `let`s make it worse than mis-filing: a top-level `let` declared in two
classic scripts is a runtime SyntaxError that kills the whole app, so "finish the range
later" was a live hazard. The guard now pins all ten functions and all three `let`s on the
`app.js` side, and a mutation that drags `mktReclassifyDeal` across fails.

**Passenger flagged, not silently absorbed:** `_rerenderCurrentView` is a generic view
dispatcher (`currentBizTab`/`currentGovTab`/`currentDiaTab` → `renderMarketing` /
`renderDomainProspects`), not task logic. It travels because it was authored inside the
block and 3 of its 4 callers are task actions; the 4th is `submitLogReschedule`, still in
app.js. Re-home it if a later unit gives the view dispatchers a home.

**Not a leaf, and that is fine.** `submitLogReschedule` (app.js ~6327/6347/6348) reaches
back into `_updateSfTaskDate`, `_updateTaskInAllStores` and `_rerenderCurrentView`, and the
Marketing rows build `onclick="completeTask(...)"` at ~4520/4522. All top-level `function`
declarations, so they are on `window` automatically — no explicit export line exists to
lose. What the split requires is only that the file stay CLASSIC and load before app.js.

Five mutations, all fail correctly: partial move (leave `_updateTaskInAllStores` behind);
duplicate a Prospects `let`; drag `mktReclassifyDeal` across (**the map's own range**);
break the `completeTask` onclick; load after app.js.

**Standing lesson, now five-for-five across Stage 2 + Stage 3: every range in this map has
been wrong. Re-measure the file before every extraction; the map is a hypothesis.**


---

## 3a. Stage 4 re-measured (2026-08-20) — before any ops.js extraction

Stage 3 finished four-for-four, and **every range this map supplied was wrong** (5 of 5
across Stages 2–3). Stage 4 supplied *no* ranges at all — three module names and nothing
else — so it was measured from the file before starting rather than one unit at a time.

`ops.js`: **7,176 lines, 207 top-level functions, 72 `window` exports.**

### Finding 1 — `ops-draft-log.js` IS NOT A SEAM. Drop it from the plan.

The name is a word that appears across unrelated code, not a subsystem. Its eight
candidate members belong to **three different subsystems plus one false match**:

| fn | line | actually belongs to |
|---|---|---|
| `submitListingBdDrafts`, `showListingBdDraftsModal` | 1006, 1030 | W3.5 Listing-BD inbox consumer |
| `pqLogTouch` | 3200 | priority queue |
| `cadDraft`, `cadCopyDraft`, `cadLogTouch`, `cadDraftAndLog` | 3961–4107 | R10 cadence dashboard |
| `_renderReviewSourceBacklog` | 4984 | **false match — "back·LOG"**, a review-lane renderer |

Extracting "the draft/log module" would have cut across three subsystems on the strength
of a substring. There is no draft/log banner in the file and no draft/log seam in it.

### Finding 2 — the `RESEARCH` banner at 4973 is ORPHANED. Do not extract from it.

Two section banners are stacked with nothing between them:

```
4973  // ===========================================
4974  // RESEARCH — research task queue
4975  // ===========================================
4976  // ===========================================
4977  // W3.4 — Comp reconciliation review lane ...
```

The comp-review lane was inserted directly beneath the RESEARCH header and runs to ~5220.
**The research functions do not start until 5225.** Trusting the banner drags ~250 lines
of an unrelated Decision-Center lane into `ops-research.js`. Real research members:
5225, 5237, 5441–5860, plus `researchAssistantPanelHTML` at **261** — 5,000 lines away,
in the file's helper preamble. Research is *not* one contiguous region.
(When the extraction happens, correct the banner in the same change.)

### Finding 3 — ops.js has a SHARED MUTABLE STATE HEADER. This is the real structural difference.

Lines **45–126** declare ~30 top-level `let`/`const`s — `opsMyWorkData`, `opsInboxData`,
`opsResearchData`, `opsEntityFilter`, `opsPagination`, `useV2` … — read by every
subsystem in the file. detail.js and app.js kept their state local to the region that
owned it; ops.js does not. The research state alone (`opsResearchData` 84,
`opsResearchFilter` 93, `opsResearchTypeFilter` 94, `opsResearchPage` 96,
`opsResearchAssistantState` 107) is interleaved with myWork/inbox/entities state, so it
**cannot be moved byte-identically** with its functions, and it is read from **262** and
**6562** — both outside any research region.

**Consequence — the pattern still works, but the rule changes.** Leave the state header
in `ops.js`; move only functions. A sibling loaded *before* ops.js is still correct,
because every read of that state happens at CALL time (including the default parameter
`renderResearchPage(page = opsResearchPage)`, which evaluates per call). What a Stage 4
guard must add over the Stage 2/3 guards is an assertion that **the sibling contains no
top-level statement that reads ops state at EVAL time** — that, and only that, is what
the shared header makes newly dangerous.

### Corrected Stage 4 order (measured, from the file's own banners)

| # | region | lines | why this order |
|---|---|---|---|
| 1 | Performance dashboard | 6766–7145 | manager-only, terminal, lowest coupling |
| 2 | Sync health | 6346–6539 | self-contained connector status |
| 3 | Domain health summary | 6145–6345 | self-contained |
| 4 | Metrics | 6025–6144 | reads shared state, no writers elsewhere |
| 5 | Research (**not** the banner's range) | 5225–~5860 **+ 261** | non-contiguous; fix the orphaned banner in the same change |
| 6 | Comp reconciliation review lane | 4976–~5220 | W3.4; sits under the wrong banner today |

`pq.js` is **deferred**: only 5 pq-named functions exist and the priority-queue code is
entangled with the R60 row-pagination block (2946–3482) and `_opsRowStore`, which other
surfaces use. It is not the cheap win the original plan implied.

**Standing rule, earned six times now: this map is a hypothesis. Re-measure the file
before every extraction, and correct the row in the same change.**
