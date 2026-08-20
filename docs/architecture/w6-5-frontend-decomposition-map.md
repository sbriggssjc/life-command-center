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
| Rent source-tier policy + escalation parser (3403–3620) | `detail-rent.js` | pure helpers, near-zero UI coupling — **best first candidate** |
| Documents tab (9089+) | `detail-tab-documents.js` | self-contained OM/BOV/lease/comps list |
| Entity tabs — Overview/Relationships/History/Activity/Deals/Portfolio/Contacts (13363–15267) | `detail-entity.js` | mirrors `switchUnifiedTab` via `switchEntityTab`; large but cohesive |
| Contact 360 + Contact tabs (13149–15460) | `detail-contact.js` | reuses `buildContact360` |
| Companion docks (13792–14029) | fold into `detail-entity.js` | |

Shell (`openUnifiedDetail`, `switchUnifiedTab`, tab strip, beforeunload guard) stays
in `detail.js`. **Guard to add before Stage 2:** a tab-registry test asserting every
tab label in the strip has a reachable renderer (mirror of the W8 lane-wiring guard).

### 2c. `app.js` (~640 KB) — shell, nav, **hash router**, task store, treasury chart

| Region | Target | Notes |
|---|---|---|
| Custom modal (`lccPrompt`/`lccConfirm`) (1945+) | `app-modal.js` | leaf utility, **best first candidate** |
| Treasury yield chart (6889+) | `app-treasury-chart.js` | self-contained Chart.js block |
| Export-comps-to-Excel (12920+) | `app-export-comps.js` | leaf, XLSX only |
| **Hash router** (`ROUTE_*`, `applyRoute`, `_routeParseHash`, `navTo`, `_detailStack*`) (988–2300) | **keep in app.js** | the router is the spine — extract last, if ever |
| Shared task store, SF sync, reassign/reclassify (5361–6260) | `app-tasks.js` | med coupling |

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
- **Stage 4 (ops.js remainder):** `pq.js`, `ops-draft-log.js`, `ops-research.js`.

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
