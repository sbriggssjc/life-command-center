# STATUS.md archive -- 2026-09-16 (FLOWS1-artifact through C1C-SPLIT)

Archived 2026-09-22 (Cowork, Round 54) per `test/status-line-budget.test.mjs`'s own procedure --
`docs/claude-code/STATUS.md` crossed its 2,400-line soft-warn mark (2,587 lines, round 53) and kept
growing (2,608 lines, round 54). This is a single contiguous span, moved VERBATIM (byte-for-byte, no
rewording, no drops) from the tail of that file -- the oldest entries at the time of the cut, all dated
2026-09-16, running from the "FLOWS1-artifact live" round through "C1C-SPLIT: `lcc_c1c_retire_sf_lanes`
gains lane scoping" (the last entry in the file before this cut).

**Nothing open was lost.** Every backlog ID referenced in this span was checked against
`docs/os/PLANNED-BACKLOG.md` before the cut and is already tracked there (most rows have since moved to
a done/closed state, which is exactly why this span was safe to archive). The one apparent miss on a
mechanical grep, `DIA_OWNERSHIP1` (an informal underscore spelling used once, in the CANON-OWNERSHIP1
discussion below), refers to the same finding tracked as `DIA-OWNERSHIP-CONFLICT` in the backlog (now
retracted as a duplicate of `CANON-OWNERSHIP1`) -- not a dangling reference.

The prior archive in this series is `STATUS_claude-code_2026-09-15_to_09-16_tail14.md` (entries through
2026-09-16, up to what was then the live tail); this file picks up immediately where that one's live
content continued growing.

---

## 2026-09-16 — FLOWS1-artifact live; FLOWS1-order refuted by the round — the race is two flows on one trigger, not LCC; F1c verified from the export (Cowork)

**FLOWS1-artifact ✅ live** (PR #2528, Railway `c6fda4e7`): `fetchSharepointBytes()` reads both Get
Artifact shapes and returns a named `too_large`; the CRE longdoc lane rides its 30-day ceiling; the
plain doc-text lane gets `artifact_too_large` and leaves the eligible queue;
`GET /api/document-text-tick?mode=dead-letter` lists both. Not done, filed: size-aware skip at
discovery and real backoff for non-terminal failures. **F1c verified from Scott's second export:**
metadata first from the trigger path, `Size < 20000000`, content fetch inside the True branch, the
bytes `Response` exactly as specified; the False branch is the plain metadata JSON without
`ok/reason`, which LCC already treats as `too_large`. Test passed on Scott's side.

**FLOWS1-order ❌ refuted, and I was wrong.** I wrote the prompt "from the code" after seeing
`await emitPC(...)` on six paths and assuming the emit relayed the move. The round read
`emitProcessingComplete()` to the end: it writes a `processing_log` row (`move_status='pending'`)
and returns — it never imports or calls `pa-move-message.js`. The move happens two ways, both
after the card: the flow's own `HTTP_ProcessingComplete` step, and the 15-minute Move Queue
Executor (P120/P121, live since 2026-08-20; 113 moves in 14 days, 2 benign `already_out`
races, worklist empty). No code changed. So what *does* move the message before
`GetEmailWebLink` runs? The exports answer it: **two flows fire on the same `When an email is
flagged (V3)` trigger** — *LCC Flagged Email Intake* ends with `Flag → Mark → Move email`, and
*Outlook Intake to Teams (Hardened)* reads the message a few seconds later. Flow vs flow, not LCC.
Scott's F2 (web link first) and F3 (retry + run-after) are the mitigation; the durable fix is one
flow per trigger, which is Scott's design call (`FLOWS-consolidate`, decision). Correction applied
in place to the 2026-09-16 entries that said otherwise, per ⑥.

**Lesson, filed:** a partial code read produced a confident wrong mechanism; the round's full read
plus live counts refuted it. "Confirmed from code" means the *whole* call chain, to the side effect.

---

## 2026-09-16 — Harris: stage table applied and seeded from the real export, first dry run 0/50 for a matcher-shape reason, harris-b written; F1c re-specified after Scott's first test (Cowork)

**F1c.** Scott's first test failed one step earlier than before — `Get file metadata using path` was
referencing `body('Get_file_content_using_path')`, which trips the same chunked-content rule. The
corrected shape (metadata first from the trigger path, Condition on Size, content fetch *inside* the
small-file branch) is in the flow guide and the checklist; large files no longer enter the 24-second
fetch at all. `FLOWS1-artifact` merged (PR #2528) — LCC reads both response shapes.

**Harris.** Scott downloaded `Real_acct_owner.zip` and the codebook; the loader died on the 889 MB
`real_acct.txt` (`RangeError: Invalid string length` — it reads the whole file as one string) and has
no local Dialysis credentials. I read the file directly: tab-delimited, headers exactly as the parser
expects, **F1 68,811 / F2 2,465** (the assumed codes are right; L1/L2 live in a separate personal-property
file), and `owners.txt` holds the clean owner name while `mailto` carries care-of text. The stage
migration had never been applied — applied it — and loaded a **37-row targeted subset** (every account
on the 50 target streets and house numbers) with `owner_name` from `owners.txt`. Dry run on the deployed
route: **0 resolved / 50 refused** — 47 `no_staged_rows` because the matcher queries `str=eq.'CRENSHAW RD'`
while HCAD stores `CRENSHAW` with the suffix in `str_sfx`; 3 `no_matching_record` because the comparison
demands a suffix LCC's address lacks. Proved the rest of the pipeline locally: `5040 Crenshaw Rd` resolves
`exact` against the real staged row the moment the fetch shape is right. → **OWNERGAP2-harris-b**
(fetch shape, optional suffix, streaming loader, owners.txt mapping, creds). Expected on the rerun:
roughly 25 of the 50 resolve from the subset alone; the rest need the full-roll load.

---

## 2026-09-16 — Five rounds reconciled (PRI2, DIA1b, MCP1, OWNERGAP2-harris, INVENTORY1b ×3), Scott's seven flow edits verified from their exports, and one of them changed a contract LCC still expects (Cowork)

Railway auto-deployed `8ab35ec9` = main, so PRI2 (flag OFF), DIA1b and MCP1 are running. **MCP1 verified
live**: `get_property_context(28398, dia)` now returns a labelled facts-only context naming
`EPISCOPAL HOSPITAL` with the operator flagged — OWNERGAP2's gate #6 finally passes.

**PRI2 ✅ built, flag `priority_tab_v2` OFF.** V1 untouched behind a router; V2 = one ranked list from
`v_lcc_seller_prospect_queue` with a footer naming each hidden code-doable band's count and producer
(`/api/priority-hidden-band-counts`). The side-by-side gate is the next step, and it is Scott's read.

**DIA1b ✅.** NPI tile now shows the gated lane (81) with the raw diff (~1,019) as a labelled second line;
"as of" stamps from an unused `computed_at` on the MV; lease-backfill relabelled as raw backlog (26
completions ever, all one April bulk); the 45-vs-21 operators question is answered — **both real**: 45
distinct raw name strings, 21 canonical ids, **878 properties with an operator name and no
`operator_id`** — the ID1 fragmentation, second instance. Which number the tile should show is Scott's
call (→ `DIA1b-operators`).

**OWNERGAP2-harris 🟡 built, not run.** Stage table, header-driven parser, matcher on the shared
Philadelphia matcher (Commercial-over-Personal, FM 1960 alias, refusals), loader CLI. hcad.org is
proxy-blocked from the sandbox (and from Cowork's container — the download page is JS-rendered), so
the commercial `state_class` codes are stated assumptions; the run is an operator sequence in
`OPERATOR-CHECKLIST.md` (download → codebook check → dry-run loader → apply → tick).

**INVENTORY1b ✅ three rounds, merged.** With DB access: 7 of the 9 dark flags are deliberate, 2
(`GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY`) are a cost call for Scott; Phase 2.3–2.6 is a **stale doc**,
not a gap (all four sources registered and active — doc fixed in this change); of the twelve May TODOs,
C7/C9/B6/B8 shipped under other names, C5 is open on gov and shipped on dia, A6a partial, C8/A7/A8/C4/B3
still open, C2 partial — now one backlog row instead of a dead table; CONTACTS_HUB: `CLAUDE.md` is right,
the registry note is the stale one; and pass 2's "132 untraced prompts" was an **under-scoped search**
— all 30 sampled resolved once `migrations/`, `test/`, `api/` and `responses/` were included. 1,789
rows, ~1,700 still UNMEASURED, and the process recommendations per leak class are in the gap map; the
one that binds the loop is class 3: *a plan doc's TODO rows either are backlog rows or are retired
with a pointer the moment the work ships*.

**Scott's flow exports, read.** F2 (web link first), F3 (retry 3×PT20S + run-after), F4 (Flag before
Move), F5 (`triggerBody()?['Id']`), F7 (concurrency 1) are exactly as specified. F6 already had a
dead-letter and a timeout response. **F1 took option B** — the flow now returns `{name,size,link,path}`
— and `fetchSharepointBytes()` still expects `content_base64`, so every Get Artifact call from LCC now
fails softly instead of loudly. → **FLOWS1-artifact** (both shapes, size cap, dead-letter; supersedes
FLOWS1-crons) with a one-condition flow addendum F1c. And the export settles FLOWS1-order: the flow
*also* emits processing-complete at its end, so LCC's early await-and-relay inside the intake
response is the only reason the move ever runs first → **FLOWS1-order** prompt written from the code.
⚠️ **Correction (2026-09-16, later that day):** wrong — `emitProcessingComplete` only writes `processing_log`; the move is
flow-driven or the Move Queue Executor. The race is two flows on one trigger. See the later entry.

---

## 2026-09-16 — OWNERGAP2-harris: the free HCAD bulk PDATA loader + matcher, built without a live sample (Claude Code)

Prompt: `docs/claude-code/prompts/done/OWNERGAP2-harris-use-hcad-bulk-pdata-not-the-portal.md`. **hcad.org is
unreachable from this sandbox** — the outbound proxy answers `CONNECT tunnel failed, response 403` (a policy
denial, not HCAD's bot wall this time) — so neither `Real_acct_owner.zip` nor the codebook PDF could be
fetched. Built the full pipeline anyway, honest about every unverified assumption, ready to run the moment an
operator hands it a real download:

- **`supabase/migrations/dialysis/20261012090000_dia_ownergap2_harris_hcad_pdata_stage.sql`** — new
  `hcad_real_acct_stage` table (`acct, owner_name, owner_name_2, mailing fields, str_num/str/str_sfx,
  site_addr_1-3, state_class, is_commercial_class, raw_row, source_file, file_year`), unique on
  `(acct, file_year)` for idempotent re-loads. `is_commercial_class` uses the Texas Comptroller's PUBLISHED
  taxonomy (F1/F2 real commercial+industrial, L1/L2 personal commercial+industrial) — **not independently
  verified against `pdataCodebook.pdf`**, stated in the migration header + column comment as needing operator
  confirmation. `raw_row` keeps every column the loader saw so a wrong mapping is correctable without a
  re-download.
- **`api/_shared/hcad-pdata-parse.js`** (pure) — HEADER-DRIVEN parser (never a fixed column order) for
  `real_acct.txt` + `owners.txt`; sniffs the delimiter (assumed tab, per every documented consumer of this
  dataset, but auto-detects); refuses rather than guesses when the one required column (`acct`) is missing.
  Also carries the commercial-class classification + `harrisStateClassToAccountType()`, mapping onto the SAME
  `'commercial'`/`'personal'` vocabulary the existing payload-only Harris adapter already uses.
- **`api/_shared/ownergap2-harris-pdata-match.js`** — turns staged rows into OWNERGAP2 candidates and resolves
  through the SAME shared matcher (`ownergap2-address-match.js`) Philadelphia and the payload path use: the
  Commercial account is preferred over a co-located Personal account (PDR2 rule, never re-derived from name
  text), the FM 1960/Cypress Creek Pkwy alias applies, multi-account ambiguity refuses. `fetchHarrisPdataForProperty()`
  queries the stage via `domainQuery` and fails closed (never a fabricated match) when the stage is empty or
  unreachable.
- **`api/_handlers/ownergap2-owner-resolve-tick.js`** — Harris now tries the PDATA stage FIRST; an
  operator-supplied payload (the pre-existing manual capture route) remains a fallback for anything the loaded
  export doesn't cover. Nothing auto-runs — same no-cron discipline as the rest of OWNERGAP2.
- **`scripts/hcad-pdata-load.mjs`** — the operator-facing loader. Takes a LOCAL path (a downloaded
  `Real_acct_owner.zip`, an extracted `real_acct.txt`, or a directory holding either) — **no network access
  required**, dry-run by default. Verified end-to-end against a synthetic zip (jszip, now a direct
  `package.json` dependency — it was already resolved transitively, pinned explicitly for a stable install).
- **21 + 4 new tests** (`test/ownergap2-harris-hcad-pdata.test.mjs`, `test/hcad-pdata-loader.test.mjs`): header-
  driven parsing + refusal on a missing required column, the commercial-class filter's positive AND negative
  control (F1/F2/L1/L2 in, A1/B/C1 out), the matcher refusing a Personal-only account and preferring Commercial
  over co-located Personal, the FM 1960 alias, multi-account ambiguity refusal, and the provenance-required-to-
  write guard reused from the existing OWNERGAP2 suite. **Full suite: 6,401 pass / 0 fail / 6 skipped** (up
  from 6,380 pass before this change — nothing else moved).
- **What remains before a real Harris run**: an operator downloads `Real_acct_owner.zip` from
  `https://hcad.org/pdata/pdata-property-downloads.html` (no login/CAPTCHA), ideally reads
  `pdataCodebook.pdf` to confirm the F1/F2/L1/L2 commercial mapping, runs
  `node scripts/hcad-pdata-load.mjs --file <path> --file-year <YYYY>` dry-run first then `--apply`, then a
  GET (dry-run) on `?_route=ownergap2-owner-resolve-tick&jurisdiction=harris_tx` to see the by-cause table
  before a real POST apply. Full detail + the exact commands:
  `docs/claude-code/responses/OWNERGAP2-harris-use-hcad-bulk-pdata-not-the-portal.response.md`.

---

## 2026-09-16 — `daily-briefing` deployed (v26), INVENTORY1 merged, the flow fixes written as click-paths, and Harris turns out not to need Scott (Cowork)

Scott deployed `daily-briefing` — live **v26**, verified — so HOME1 §C's routing fix is running; the
behavioural check is tomorrow's briefing. INVENTORY1's branch is merged; INVENTORY1b can run.

The seven Power Automate fixes are now a step-by-step guide with exact clicks and a suggested
order (`docs/setup/POWER-AUTOMATE-FLOW-FIXES-2026-09-16.md`; F1 has a quick option and a durable one
that hands LCC a link instead of the bytes). While writing F2 I confirmed the LCC-side half from the
code: `api/intake.js` **awaits `emitProcessingComplete` before it responds**, and that emit POSTs the
*(⚠️ corrected later the same day: it does not POST — it writes `processing_log` only; the FLOWS1-order round refuted this)*
move instruction to the Move flow immediately — so the message is moved while the intake flow is still
waiting on our response. `FLOWS1-order` is real, not inferred.

Harris: OWNERGAP2 built it payload-only because the HCAD *portal* is bot-walled, but HCAD publishes
the entire roll as free bulk PDATA files. That makes Harris a prompt (**OWNERGAP2-harris**), not a
hand-fetch; P1 is withdrawn from the operator checklist. Nothing for Scott to gather.

---

## 2026-09-16 — FLOWS1 and INVENTORY1 reconciled: the flows are diagnosed (and I disagree with the round on one), the inventory is honest about being half an inventory (Cowork)

**FLOWS1 ✅ diagnosis complete**, no LCC code changed. The round read the same 17 screenshots and
reached the same per-flow causes; it also checked the dead-letter plane (`v_flow_run_failures_open`
had 2 rows against 750+ digest failures — the webhook records *that* a run failed, never *why*) and
tied Get Artifact's 709/week to two overlapping 30-minute crons (`lcc-document-text`,
`lcc-cre-doc-text-backfill`, ~96 ticks/day). Its conclusion — "nothing on the LCC side to fix" — I
don't accept on two flows and have said so in the row: a cron re-requesting a file that fails
deterministically ~100 times a day is an LCC defect (no dead-letter, no backoff) whatever the flow does
about chunking; and the Outlook-Intake 404 happens because our completion callback fires the Move flow
before the intake flow has read the message — tolerating the 404 hides the ordering. Both are now
their own rows (**FLOWS1-crons**, **FLOWS1-order**). Scott's seven flow edits are in the new
**`docs/claude-code/OPERATOR-CHECKLIST.md`** — the one list of steps only he can do, now a standing file. List Folder's stale path (`… MOVED TO R DRIVE …`) is open: the
round says LCC escapes correctly, so the stored path is wrong, and nobody has named its writer yet.

**INVENTORY1 🟡 two passes, stated limits.** 1,779 CSV rows from headings across architecture, audits,
history and `prompts/done`; ~20 files deep-read; **no DB, no code, no root `.docx`** (no pandoc in the
sandbox). Findings worth the round: nine feature flags OFF with no recorded reason; a six-item
never-tracked cluster in `data_quality_self_learning_loop.md` Phase 2.3–2.6; a ⬜ TODO table from
2026-05-23 (12 rows) never closed; CONTACTS_HUB described as dormant by its seed and live by
`CLAUDE.md`; ~124 prompts with no discoverable trace — a worklist, not a verdict. It is on
`claude/inventory1-audit`, unmerged. The round asked whether to keep scraping or start re-testing;
re-testing is the answer → **INVENTORY1b**, with DB access and the root reports now readable:
`docs/history/root-reports/` holds a pandoc conversion of all ten `.docx` files, headers saying they
are copies, not truth.

Deploy state: Railway `0b6e75b8` = main; `daily-briefing` edge function **still v25** (HOME1-deploy).

---

## 2026-09-16 — Three app rounds reconciled (HOME1, PRI1, DIA1), the flow screenshots read, and one merged fix that is not running (Cowork)

Each round found the same shape under Scott's observation: the surface was showing something other
than what its caption claimed, and in two cases the deployed artefact was months behind the repo.

**PRI1 ✅** (PR #2511): readable band labels are live. The measurement matters more than the labels:
941 of 1,635 queue rows are code-doable plumbing, the tab is 89.6% disjoint from the seller doctrine,
and **`v_lcc_seller_prospect_queue` — shipped 2026-09-03, 520 rows — already implements exactly what
Scott described and has no UI**. That is **PRI2**, written.

**DIA1 🟡** (PR #2512): the dead button was the deployed Dialysis `data-query` edge function sitting at
v41 from July while the repo's allowlist had the econ views — every call 403'd into a silent catch.
Redeployed, and the handler now tells the user when it fails. §A/§C were diagnosed, not finished, and
the round's report went to a scratchpad that no longer exists → **DIA1b** restates and finishes it.

**HOME1 🟡** (PR #2513): cleanup classes are out of the gaps widget (live on Railway `0b6e75b8`); the
three-lane spec exists (→ **HOME2**); the DaVita-under-Government bug was a real one — `inferDomain()`
compared long-form domain strings the data never carries. Fixed with a test. ⚠️ **Not deployed**: the
live `daily-briefing` edge function is v25 from May. Merged is not running, again, and this time it is
the fix for the bug Scott photographed → **HOME1-deploy**. Also found: ID3a's fold doesn't write the
column the drift check reads → **ID3a-drift**.

**Flow screenshots (SBN-9).** All 17 read. The eight failures are now diagnosed and split: four are
ours (Get Artifact builds a `Response` from chunked `body()`; Outlook Intake and Flagged Intake read a
message the Move flow already moved — our completion callback fires the move too early; List Folder
sends a path with an apostrophe; the Switch flow's Salesforce lookups outrun the caller's timeout),
three are Scott's in Power Automate, one is benign. FLOWS1 updated in place; ready to run.

Railway is at `0b6e75b8` = main. STATUS archived (twentieth span). Queue: HOME1/PRI1/DIA1 to `done/`;
new: PRI2, DIA1b; backlog-only: HOME2, ID3a-drift, HOME1-deploy.

---

## 2026-09-16 — OWNERGAP2 applied: the first 20 owners in the arc; CLAUDE.md pass-1 cut; INVENTORY1 and MCP1 drafted (Cowork)

**OWNERGAP2 ✅ applied (Philadelphia).** After Scott's Railway redeploy (`/version` = `0235c31a` = main)
I ran the dry run against the deployed route — through pg_net with the vault key, so the key never
entered this chat — and got the build's exact numbers: 26 → 20 resolved / 6 refused. Scott chose apply.
Batch `ownergap2_philadelphia_pa_20260916` wrote 20: properties with an owner **5,474 → 5,494**,
`recorded_owners` +17 (three owners span two addresses), ledger 26 rows, every new row's `source`
citing its OPA record id, PA `true_owner_id` fingerprint unchanged. **Twenty of the 4,021 now have an
owner from a public record**, and the method is proven; Harris needs an operator-supplied HCAD payload.
Gate #6 failed for a reason that is its own finding → **MCP1**: `get_property_context` cannot see a dia
property that is not among the 1,784 minted LCC assets, and its address path throws
`(rows \|\| []).filter is not a function`.

**CLAUDE.md pass 1 (CONSOLIDATE4).** 5,503 → **3,268** lines. The 34 dated round narratives (Aug 14 –
Sep 2) went verbatim to `docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`; an index of their
titles (each title is its lesson) stands where they were, and the header says so. Every rule,
doctrine, footgun and invariant stayed. Pass 2 — condensing the doctrines and footguns themselves —
waits for Scott, section by section.

**INVENTORY1 drafted.** Scott's ask: every plan, design and discussion ever, against what is actually
built and running, to find what is slipping through the cracks and aim the next rounds. The prompt is
read-only, extracts intent from every source including the loose `.docx` reports, measures state
rather than reading it, and ends with the process change per leak class.

---

## 2026-09-16 — GOVDEED5b + OWNERGAP2 reconciled; the SB-notes intake exists now, and its first pass produced four app prompts (Cowork)

**GOVDEED5b ✅ live** (gov PR #405): the three sale propagators re-pointed to `latest_transfer_*`;
`pg_proc` writers of `latest_deed_date` 4 → **1**; `latest_deed_date` 3,340 → **43** and holding after a
hand-run of the 03:30 cron and a trigger fire in rolled-back transactions. Re-measured here: 43 / 43 /
1 writer. GOVDEED2 → 4 → 478 → 5 → 5b is the whole deed arc, and it is done except GOVDEED3 (the
accept gate) and the Python writer's deployed state, which the round scoped out and said so.

**OWNERGAP2 🟡 merged, not run** (LCC PR #2508): Philadelphia 20/26 live, Harris payload-only (HCAD is
bot-walled — the prompt's rule, honoured), guard intact and refusing a real `ABC INC`. Nothing applied
by design. The next step is an operator sequence: redeploy both Railway services, confirm `/version`,
dry-run tick, review, apply, and then the number the whole arc exists for — how many of the 4,021.

**SB notes — the intake.** Scott's new folder (`docs/claude-code/SB notes/`) holds what he notices in
the app. It now has a protocol (`README.md`), a ledger (`TRIAGE.md`, `SBN-n`), a line in
`BUILD-TURN-PROTOCOL.md` §④, and `docs/claude-code/README.md` was rewritten — it still described
`NN-slug.response.md` files and a dossier-era trail doc nobody uses; that was the exact misdirection a
future chat would have walked into. First pass, two files → **8 rows, 4 prompts**: **FLOWS1** (eight PA
flows failed in a week, Get Artifact 709×; the LCC side first, Scott supplies one failed-run screenshot
per flow), **HOME1** (the gaps list is 9/10 agency-drift cleaning — ID3a's class — and one real human row;
Home mirrors Priority; a DaVita deal under *Government highlights* is a lane-key bug to fix), **PRI1**
(P-bands → one ranked human-only list; spec + label change only), **DIA1** (six action items graded
human/code/noise; the Market Economics Exhibit button fails silently at `dialysis.js:1744`; tiles are
stale by 22 rows and one counts a different thing: 45 "operators" vs 21 distinct `operator_id`).

Every screenshot number was checked against the database before it became a row.

---

## 2026-09-16 — `HCRIS-TIMEOUT-5` fixed both bugs, confirmed merged/redeployed, and a fresh post-fix run still shows the identical failure — plus a content-loss regression from a parallel session's merge, now recovered

**Recovery note first, since it affects trust in this file's history**: this entry (and the `HCRIS-TIMEOUT-5`
STATUS entry, and the round-5 update to the Open-threads table above) was **written once already earlier
today, merged to `main` at `ab14c9cf`/PR #2516 — and then silently reverted** by a parallel Cowork session's
later merge (`8cda70b9`, "docs(round8)... STATUS archived tail12"), which appears to have branched from a
stale checkout and overwrote this shared section back to its pre-`HCRIS-TIMEOUT-5` state without any conflict
being raised. Caught by independently re-checking this file against `origin/main` before reporting live-run
status, rather than assuming a prior write stuck. Re-applying the full content now. This is the same
doctrine-collision shape `CANON-OWNERSHIP1`/`DIA_OWNERSHIP1` already named for this repo (two branches
touching a shared append-only doc, one clobbering the other on merge) — worth a guard, not just a one-off fix;
flagged separately below.

**HCRIS-TIMEOUT-5 (original content, restored)**: Fifth round, first fix round since `HCRIS-TIMEOUT-4`
isolated the two structural bugs. CC fixed both same day:

- **Discarded run id**: `start_run()` now builds an actual query-builder object and passes it (with
  `return_representation=True`) into `safe_execute()`, instead of a bare lambda with `.execute()` already
  baked in — the fix the prior round called for. All named call sites (`main.py:3177`, `run_cms_ingestion.py:
  852/1786/1833`, `acquire_ingestion_lock()`) route through `start_run()` directly, so **one fix repairs all
  of them**, confirming the "fix once, fixes everywhere" framing from the `-5` prompt.
- **Swallowed timeout**: CC reports the loop-vs-hang question this round was specifically asked to resolve
  **couldn't be settled from the error-log evidence alone** (the ledger only flushes between steps, not
  per-row) — disclosed plainly rather than guessed. Found independent structural evidence instead: `aux_cms_
  tables`'s direct `psycopg` calls carry no `statement_timeout`/keepalive tuning (every other DB call in the
  codebase does), and `SIGALRM` can't interrupt a blocked native socket read. Fixed both angles: `TimeoutError`
  now re-raised before the per-row `except Exception:`, plus a 60s statement timeout + keepalives on the
  direct connections.

10 new regression tests, full suite 3,280 passed / 1 pre-existing unrelated failure (confirmed by CC to also
fail on unmodified `main`). Pushed to `claude/compassionate-hamilton-geof1p`, commit `226f7e3`, `Dialysis` PR
#7413 — **Scott confirmed both this PR and the corresponding `life-command-center` docs PR merged and
redeployed.**

**New, since the original entry — live proof attempted, and it did not pass.** Scott triggered a fresh CMS
ingestion run at 2026-09-16 14:39:20 UTC (confirmed live: the two prior stuck runs from before the fix were
cleanly reclaimed/closed at that same moment — `593e1e75…`→abandoned, `1fb8af07…`→failed — one small confirming
sign the fix's reclaim path works). **The new run shows the identical failure shape as every pre-fix round**:
errors burst from 14:39:32–14:54:55 (~15 min, the same `ratings`/`clinic_quality_metrics` circuit-breaker
errors as always), then total silence — zero errors of any kind for 5+ hours since. `ingestion_tracker.notes`
is still `'{}'`, and `facility_cost_reports` hasn't moved off 2026-03-16. **One genuinely new detail**: the
`"step 'aux_cms_tables' exceeded 900s"` timeout message that fired on every prior run **did not appear at all**
this time — different behavior, but not yet understood whether that's the fix changing how the timeout
surfaces or a different blocking point upstream of that check. Scott's own log upload for this run turned out
to be an unrelated sub-job (`facility_patient_counts` revenue propagation, confirmed genuinely still live via
`properties.updated_at` moving in real time) — not the `aux_cms_tables`/HCRIS pipeline being tested.

`HCRIS-TIMEOUT` **stays 🔴**. Both bug rows move from "fixed, unproven live" back toward needing a sixth round,
since the live proof this round exists specifically to get did not materialize. Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-5-fix-the-two-structural-bugs-start-run-header-and-aux-cms-timeout-swallow.response.md`.

## 2026-09-17 — `HCRIS-TIMEOUT-6`'s fix, live-tested overnight on a scheduled run, did not work — the `StepTimeout` still never fires

Scott confirmed `Dialysis` PR #7417 merged and redeployed. The scheduled 06:00 UTC cron run (started
2026-09-17 06:04:28 UTC) was the first genuinely clean live test this arc has had: no ambiguity about whether
the fix was live, because Scott's Railway screenshot shows the active deployment is PR #7417, dated ~14 hours
before the check (i.e., deployed well before this run started).

**Checked live at DB time 11:51 UTC (~5h47m into the run) and again via Scott's Railway screenshot (6h13m,
still running)**: the same 13-minute startup error burst (06:04–06:17 UTC, the usual `ratings`/
`clinic_quality_metrics` circuit-breaker errors), then the identical pattern `HCRIS-TIMEOUT-6` diagnosed —
sustained real `properties` writes with zero `ingestion_run_errors` after the burst. **This run has already
touched 9,964 properties (more than the 6,879 that triggered `HCRIS-TIMEOUT-6` in the first place) and is still
writing in near-real-time.** No `StepTimeout` has appeared anywhere in `ingestion_run_errors`. `notes` is still
`'{}'`; `facility_cost_reports` is still frozen at `2026-03-16`.

**Plain reading: `HCRIS-TIMEOUT-6`'s fix did not solve the problem.** The `except TimeoutError: raise` change
only matters if the 900s `SIGALRM` actually fires — re-raising a signal that never arrives changes nothing.
Either the alarm isn't being armed for this step at all (maybe `propagate_financials()`/the `patient_counts`
step was never wrapped in `run_with_timeout()` to begin with, unlike `aux_cms_tables`), or it's armed but not
being delivered during this specific call pattern. That's a materially different, likely deeper question than
what round 6 answered, and `HCRIS-TIMEOUT-7` needs to check whether the timeout mechanism is even reachable
here before proposing another fix.

Still being live-monitored as this is written — how the run eventually ends (finishes and reaches
`hcris_cost_reports` for the first time in this whole arc, or gets killed again around the 4–7 hour mark like
the prior run) is itself useful evidence not yet in hand.

## 2026-09-16 — `HCRIS-TIMEOUT-6`: root cause confirmed against the deployed code — a third swallowed-timeout site, matching this session's own live evidence exactly; two backlog bugs now confirmed genuinely fixed

Sixth round. This session's own `-6` prompt (drafted right after correcting the "genuine hang" misread below)
asked CC to confirm, against the actual deployed code, whether the `facility_patient_counts`→`properties`
propagation step is unbatched, and what stops execution right after it finishes without ever calling
`finish_run()`. **CC's answer matches the live evidence exactly rather than reinterpreting it**:
`propagate_financials()` in `src/propagation_utils.py` does 2 sequential Supabase round trips per property
(`SELECT`+`UPDATE`) in a plain per-row loop — the same N+1 shape already fixed once for `hcris_propagation`'s
old path, never ported here — and its `except Exception:` swallows the 900s `StepTimeout` the identical way
`aux_cms_tables` used to. Since the alarm is one-shot, that permanently disarmed timeout enforcement for the
rest of the step, turning a 15-minute budget into the 4h18m, 6,879-property run this session watched live. The
whole-run 90-minute budget never caught it because (per this session's own guess in the prompt, now confirmed)
it's only checked *between* steps. The missing `finished_at` is attributed to a platform-level (Railway) kill
landing before Python could finalize — CC notes the existing SIGTERM handler's own comment already
acknowledges it can't cover SIGKILL, rather than presenting this as a new discovery.

**Fixed** (`Dialysis` PR #7417, branch `claude/hcris-timeout-6-8f3k2a`): `TimeoutError` re-raised before the
generic handler at 4 call sites (`propagate_financials()`, `_resolve_property_id_for_financials()`, both call
sites in `patient_count_ingestor.py`); a batched prefetch added for the SELECT side, with the UPDATE side
deliberately left per-row — disclosed as a scope call, not silently skipped, with a safe per-id fallback. 16
new tests, full suite 3,292 passed / 1 pre-existing unrelated failure. **PR merge status not yet confirmed by
Scott — asked directly.**

**Two backlog rows this arc has carried since `HCRIS-TIMEOUT-4` are now confirmed genuinely fixed, not just
patched-and-hoped**: `HCRIS-START-RUN-HEADER-BUG` and `HCRIS-AUX-CMS-TIMEOUT-SWALLOWED` both move to ✅ — the
live evidence that the run advanced clean past `aux_cms_tables` into a much later step and held a lock for
4h18m is only possible if both fixes are genuinely working (the old header bug would have orphaned the lock
immediately; the old `aux_cms_tables` swallow would never have let the run past step 3 at all). Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-6-not-a-hang-a-slow-unbatched-propagation-step-that-never-hands-off-to-finish_run.response.md`.

`HCRIS-TIMEOUT` stays 🔴, but for the first time in this arc the next live test is cheap: watch the next run die
fast and cleanly (~15 minutes, a genuine `StepTimeout` logged to `ingestion_run_errors`) instead of running for
hours — a very different signal to wait for than anything prior rounds could check for.

## 2026-09-16 — `HCRIS-TIMEOUT`, live-monitoring the post-`HCRIS-TIMEOUT-5` run to a stop: NOT a hang — a ~4h18m real, slow, unfinished step, then the run stopped without ever reaching `finish_run()`

**Correction on the record first**: the same-day entry immediately below this one (originally posted with the
heading "...went silent at minute 15, and its tracker row was never closed") called this a likely "genuine
hang." That reading is now known to be wrong, on better evidence gathered minutes later — not deleted, but
corrected here rather than silently overwritten, per this file's own recovery discipline earlier today.

Continuing to live-monitor the run triggered 14:39:20 UTC rather than accept status secondhand. Scott reported
the `cms-ingestion` Railway service (confirmed by name as the one he's been triggering) started ~9:38 local, ran
4h18m, and is no longer running on Railway; he then supplied a Railway dashboard screenshot (Cron Runs tab,
confirming the 09:38 execution ran exactly 4h18m) and a 25-second log slice from its tail (18:56:46–18:57:11
UTC). **Checking `properties.updated_at` minute-by-minute across the full run window — not just two point
snapshots, which is what produced the wrong "silent for 6 hours" reading — shows continuous, accelerating write
activity from 14:55 UTC through 18:57 UTC** (5–10 writes/minute early on, ramping to 60–100/minute), **6,879
distinct properties touched, stopping within a minute of Railway's own reported end time.** The log slice
confirms what it is: `src.propagation_utils` writing `estimated_annual_revenue` to `properties`, tagged
`facility_patient_counts` — real, legitimate work, not a stuck process. **The earlier theory that this write
activity belonged to a separate, concurrently-running job was also wrong** — it's this same run.

So the run wasn't hung — it spent essentially its whole 4h18m runtime inside one very slow step (~2 seconds per
property across 6,879 properties, the signature of an unbatched sequential-write loop, the same anti-pattern
already found and fixed elsewhere in this codebase for `hcris_propagation`'s old `save_estimate()` path). Then,
within a minute of that step's last write, **the run simply stopped**: `facility_cost_reports` never moved off
`2026-03-16`; `ingestion_tracker.notes` is still `'{}'` on both the `cms-ingestion` row (`d45f27ff…`) and the
`facility_patient_counts` lock row (`ec39768b…`); neither got `finished_at` set; zero new
`ingestion_run_errors` since `14:54:55`. No crash, no exception logged — it stopped without reaching whatever
comes after that step, which should include `hcris_cost_reports` and `finish_run()`.

**Open questions for `HCRIS-TIMEOUT-6`, now much narrower than "hang vs. loop"**: (1) is this
`facility_patient_counts`→`properties` step genuinely unbatched/sequential, and can it be batched the same way
`hcris_propagation` already was; (2) what stops execution right as that step ends — does it hit a wall-clock
budget, an unhandled exception the per-row handlers are swallowing the same way `aux_cms_tables` used to, or a
Railway-side execution/timeout limit on the cron job itself; (3) did this run actually carry `HCRIS-TIMEOUT-5`'s
fix (PR #7413) at all, or does the fact that it got much further than any prior round (past `aux_cms_tables`
entirely) already answer that. Asked Scott for the deploy timestamp and, if available, this execution's actual
exit/crash status from Railway's Deployments tab (not just the Cron Runs duration).

Two smaller notes on the record: (1) Scott's initial "it looks like that run has completed" claim was checked
directly and was not correct — `run_status='started'` at the time, ~5h47m in; corrected in-conversation, not
carried into this file as fact until independently confirmed. (2) A log upload Scott provided for this run
(`logs.1789573371348.json`) was confirmed to be an unrelated sub-job (`facility_patient_counts` revenue
propagation, zero hits on any HCRIS/`aux_cms_tables`/tracker term) — not useful for this pipeline, flagged to
Scott rather than mined for false signal.

`HCRIS-TIMEOUT` stays 🔴, now with a concrete "hang, not loop" data point for round 6 to build on, pending the
Railway deploy-timing/crash-log confirmation.

## 2026-09-16 — `HCRIS-TIMEOUT-4`: root cause finally isolated — two structural bugs, neither one HCRIS-specific, and this round deliberately did not fix them

Fourth round on this defect, and the first one framed as triage rather than another single-hypothesis fix —
after three rounds each independently correct on their own terms (PR #7410 fixed a real timeout bug,
`HCRIS-TIMEOUT-3`/PR #7411 fixed a real tracker-blindness bug) with the symptom unmoved, this round asked CC to
step back rather than extend the pattern a fourth time. **This session independently re-verified every
load-bearing claim live against Dialysis_DB before filing it** — most held up exactly as described; one
needed a real correction, noted below.

**Bottom line CC reported, verified true**: HCRIS was never the step hanging. Two independent bugs compound:

1. **`ingestion_tracker.start_run()` silently discards its own run id on every call.** `get_supabase_client()`
   sets a client-wide default `Prefer: return=minimal` header; `safe_execute()` only overrides it to
   `return=representation` when handed a live query-builder object, not a pre-built `.execute()` closure.
   `start_run()` passes a bare lambda, so a genuinely successful insert (HTTP 201) comes back with an empty
   body and reads as a failure — `_CURRENT_RUN_ID` is `None` for the entire life of every run, which is why
   `HCRIS-TIMEOUT-3`'s heartbeat/notes instrumentation could never write anything no matter how many retries
   it got. **Same call, same bug, also used by `acquire_ingestion_lock()`** — this is why the ingestion-lock
   rows have been orphaned every run, a repo-wide defect (4+ more `start_run()` call sites named, not
   individually traced) rather than anything CMS/HCRIS-specific.
2. **`aux_cms_tables` (step 3 of ~15, several steps before `hcris_cost_reports` at step ~8) swallows its own
   900-second `SIGALRM` step-timeout inside a per-row `except Exception:`**, so the pipeline never advances
   past it and never reaches HCRIS at all. `facility_cost_reports` freezing at 2026-03-16 is a direct,
   mechanical consequence of the run never getting there — not a separate HCRIS-side defect.

**Independently confirmed live, exactly as claimed**: `ingestion_tracker.notes='{}'` on every relevant row back
to 2026-09-10 (the last populated `notes` on record for this dataset is 2026-08-31, well before this whole
arc started); zero `ingestion_run_errors` rows with `table_name='ingestion_tracker'`; the `aux_cms_tables`
900s timeout firing exactly on schedule (17:52:36 UTC, ~15 min after run 1's 17:37:29 start); `facility_cost_
reports` still frozen at exactly 2026-03-16 15:35:48; both orphaned lock rows present with the described
timestamps.

**One correction filed**: CC's response describes "a massive, continuous stream of errors ... for the entire
observed [12.7-hour] lifetime," ~17,753 total. Checked by the minute — that's actually **two separate
15-minute startup bursts** (run 1's own, 17:37–17:52, ~8,877 errors, ending exactly when its own timeout
fired; run 2's own startup burst the next morning, 06:03–06:18, ~8,876 errors) with **zero errors of any kind
in the ~12h09m between them**. Total silence, not continuous activity — the same burst-then-silence shape
every prior round already found, not new behavior. This matters for the fix: a per-row loop that's genuinely
"still going, just not hitting these particular tables" would look different from a process that's actually
hung/deadlocked after the swallowed signal. CC's fix-round instruction now includes confirming which one it
actually is, not assuming "keeps looping obliviously" the way this round's prose implied.

**No fix attempted this round** — correctly, per the prompt's explicit instruction not to make a fifth narrow
patch before full triage. `HCRIS-TIMEOUT` stays 🔴. **Next step**: a dedicated fix round for both structural
bugs, plus resolving the loop-vs-hang question above. Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-4-full-triage-run-log-still-silent-after-the-fix-built-to-fix-it.response.md`.

## 2026-09-16 — `HCRIS-TIMEOUT` live-monitored across two full run cycles post-fix: same failure shape both times, and a new, more basic problem found — `run_log` has written nothing at all in 28 hours

Watched the post-`HCRIS-TIMEOUT-3`/`PR #7411` run live rather than waiting for another log upload. Two
full cycles have now completed since the fix merged, and neither tells a different story than before.

**Run 1** (`593e1e75…`, started 2026-09-15 17:37:36 UTC): ran until it was reclaimed as `abandoned` at
2026-09-16 06:02:56 — **~12h25m**, well past the 90-minute budget. **Run 2** (`64e34e14…`, started
2026-09-16 06:03:24 UTC, the daily scheduled run) was still live as of this check, ~5h17m in, `properties`
being written to seconds before the query ran. Both runs show the **identical error-burst-then-silence
shape**: ~8,880 `ingestion_run_errors` in the first ~15 minutes (unrelated `medicare_ingestion` writes), then
total silence. `facility_cost_reports` remains frozen at 2026-03-16 through both cycles, and
`public_data_snapshots` still has zero HCRIS rows, ever.

**The new finding, more basic than HCRIS itself: `run_log` has not received a single write since
2026-09-15 07:33:40 UTC — 28 hours and two full run cycles ago.** That's the run that predates the fix
entirely. Neither of the two post-fix runs logged anything — not a startup summary, not a step heartbeat,
not the `step_errors` map `HCRIS-TIMEOUT-3` added specifically so this wouldn't require another manual
cross-check. **`ingestion_tracker.notes` is also still blank (`'{}'`) on both runs, including the one that's
now fully closed out** (`593e1e75…`, `run_status='abandoned'`, `finished_at` populated) — a finished, closed
run with populated `notes` is exactly the case `HCRIS-TIMEOUT-3`'s fix was built to handle, and it didn't.

**This points back at the same open question `HCRIS-TIMEOUT-2` raised and never got a direct answer to:
is the Railway service genuinely running the merged commit (`651c630`)?** Two consecutive runs producing
zero diagnostic output despite a fix specifically designed to produce that output is hard to explain any
other way. Not re-diagnosing the fix's logic again without that answer first — same discipline as before.
`HCRIS-TIMEOUT` stays 🔴. Nothing filed as a new backlog row yet — this is additional evidence on the
existing `HCRIS-TIMEOUT` row, not a new defect.
## 2026-09-16 — OWNERGAP2: the first BUILD in the owner arc; verified against the live Philadelphia API; nothing applied (Claude Code)

Two adapters, as scoped. Built, tested, migration applied live, **zero owner rows written anywhere.**

**Verified against the real API, not only against tests.** The sandbox has no direct egress to
`phl.carto.com` (proxy 403), so the production matcher was run over the production query's real
responses fetched through `pg_net` from Dialysis_DB, across the WHOLE Philadelphia population:
**20 of 26 resolved = 76.9%**, above the 68% §8 measured by hand. 19 of the 25 that fired, plus
property 36738 (a duplicate address of 28606, which resolved). Recovered owners include
UNIV CITY ASSOCIATES (OPA 882000790), EPISCOPAL HOSPITAL (777012002), 3020 MARKET OPERATING LP,
PHILA SUBURBAN, RS REALTY PARTNERS L P. **Three refusals were correct** — `3300 Henry Ave` carries
5 distinct owning LPs, and two Walnut St properties sit inside a range holding 3–4 owners.

⚠️ **THE PRESCRIBED FIX WAS INSUFFICIENT AND THE MEASUREMENT IS WHAT SHOWED IT.** §8 said the
Philadelphia misses were *"fixed by prefix matching"*; implemented, **prefix-only resolves 16 of
26**. It cannot see a range **containment** row (`3823 Market St` ⊂ `3817-39 MARKET ST`). Prefix +
containment + **odd/even parity** gives 20 — and parity is load-bearing, not tidiness: `3823` falls
inside both `3817-39` (odd) and `3816-40` (even), so without it the property returns two owners and
a **FALSE `needs_parcel_discriminator`, which reads exactly like the safety rule working.**

⚠️ **A leading directional was being eaten by the house-number regex, costing 5 of 26 as silent
"no record".** `^(\d+)\s*(?:-\s*\d+)?\s*([A-Z])?\b` captured the `E` of `100 E. Lehigh Ave`
as a sub-parcel letter, leaving street `LEHIGH AVE`. No error, no null — the instrument answered
confidently. Fixed by requiring the letter be attached (`2910R`) and exempting directionals.

⚠️ **THE FIRST QUERY WOULD HAVE SHIPPED A SILENT TRUNCATION.** It fetched the whole street at
`LIMIT 100`; MARKET ST holds **1,218** parcels and WALNUT ST **1,923**. It survived a first
verification only because that run happened to narrow to `38%MARKET ST`. Shipped: a numeric band on
the house number, `ORDER BY … DESC` so the containing range is reachable, and an explicit
`truncated` flag → `source_response_truncated`. Four live requests hit the 250 cap; all four still
resolved.

**Harris is `fetches: false`, decided by measurement per §2 of the prompt.** Probed live via
`pg_net`: `search.hcad.org` → **403 Cloudflare managed challenge**, `hcad.org` → **521**,
`public.hcad.org/records/quicksearch.asp` → **404**, `download.hcad.org` → 200 but a shell page
with no file index. No reachable free API or enumerable bulk path, and §6 forbids automating a
bot-protected portal. Harris therefore ships as a **parser + `Personal`/`Commercial` account-type
discriminator over an operator-supplied payload** — never a fetcher. §9's 86% stands as a rate; it
was never evidence the fetch is automatable.

⚠️ **THE CITY OF PHILADELPHIA RECORDS `ABC INC` AS A REAL OWNER, AND THE OWNERGAP1 GUARD FLAGS
IT.** `dia_is_fabricated_placeholder_owner('ABC INC')` → true. **The guard was NOT weakened** — one
real name is worth less than the containment. The writer pre-checks and refuses with
`blocked_by_fabrication_guard`, keeping the name and its citation in the ledger, surfaced on
`v_dia_ownergap2_fabrication_guard_collisions`. Guard positive-controlled both directions the same
day: `XYZ Dialysis Centers LLC`/`unknown` → true; `UNIV CITY ASSOCIATES`/`RALSTON MERCY-DOUGLASS
HO` → false.

⚠️ **`county ilike '%harris%'` RETURNS 52 AND TWO ARE HARRISON COUNTY** (Marshall, TX — a different
appraisal district ~200 miles away). Harris proper is **50**, matching §9. The adapter keys on
equality and a guard pins it.

**Provenance is CHECK-enforced, and the constraints were positive-controlled in both directions.**
`chk_ownergap2_resolved_must_cite` refused all four malformed shapes (no citation / empty
`source_record_ids` / no `source_query` / unresolved with no cause) and **accepted** both
well-formed shapes, inside a self-rolling-back transaction — **0 residue** afterwards. A constraint
that only ever refuses is indistinguishable from a broken one.

👤 **NOTHING IS APPLIED, AND THAT IS THE STATE TO CARRY.** GET is a dry run; no POST was issued.
Measured at close: `dia_ownergap2_resolution_log` **0 rows** · `recorded_owners` **7,585, 0 of them
`ownergap2*`-sourced** · properties with a `recorded_owner_id` **5,473** · `true_owner_id`
untouched (10,308). The JS half needs the Railway redeploy before the tick exists in production
(the migration shipped instantly — the documented half-applied-deploy split).

⚠️ **Population drift, stated not reconciled:** owner-unknown is **4,014** (OWNERGAP1 said 4,021),
`recorded_owners` **7,585** (said 7,487), owned properties **5,473** (said 5,467).

Files: `api/_shared/ownergap2-{address-match,sources,owner-writeback}.js`,
`api/_handlers/ownergap2-owner-resolve-tick.js`, migration
`supabase/migrations/dialysis/20261010120000_dia_ownergap2_owner_resolution_ledger.sql` (applied
live), fixtures `test/fixtures/ownergap2-live-samples.json`, guard
`test/ownergap2-owner-resolution.test.mjs` (**55 tests, 33 mutations verified RED**). Audit §10;
backlog `OWNERGAP2`, `OWNERGAP1-decision`.

---


## 2026-09-16 — All four rounds landed; C1C closed on both arms; GOVDEED5 was undone by a nightly cron twenty minutes after it applied (Cowork)

Reconciled the four responses against live state on both databases.

**C1B-GOV-GATE ✅** (gov PR #403): SF arm sealed (0 passing), SOS unsealed (2,019). `v_ownership_gaps`
had no committed source anywhere before this — it was live-only. Then ran **C1C's gov arm** here:
dry run 1,851 / real run `c1c-gov-20260916` **1,851 retired**; watch view `{dia 839, gov 1851}`;
the SF lane is gone from the lane summary. C1C is closed. Consequence to carry: LCC now holds
**1,346 open `owner_needs_sos`** tasks and nothing consumes them — OWNERGAP2 is next, not someday.

**GOVDEED-478 ✅** (gov PR #402): 4,995 deed rows marked `rejected_placeholder` (kept, not deleted);
290 grantees cleared, 91 grantee+price, 97 held because a sale corroborates them; conflicts
899 → 518 at the time.

**C2k ✅** (gov attestation 856 → LCC PR #2506): 234 eligible (13 fill / 221 supersede), 218
superseded, 40/43 A-class pairs to the sponsor (the other 3 were already there), 16/16 controls
untouched, unsupersede round-trips 218/218. CI caught `lcc_c2k_unsupersede` created with the default
anon grant — a function that rewrites ownership, callable unauthenticated — fixed before merge.
That is the SEC1 test doing exactly its job.

**GOVDEED5 🟡** (gov PR #404): the split landed and reported 43/43 truthfully — at 03:09 UTC. At
03:30 the `gov-propagate-recompute-tick` cron ran `propagate_sales_recompute`, whose candidate
predicate treats a NULL `latest_deed_date` as 1900 and whose write is `latest_deed_date =
sale_date`: **3,310** properties got a sale date back by 03:35. `pg_proc` has **six** writers; the
round inventoried the `sql/` tree and found three. Two more are triggers on the sales tables. Live
now: 3,340 / 2,743 / conflicts 1,295. → **GOVDEED5b** handoff written. Same class as C1B-GOV-GATE:
the live catalog, not the repo, is the inventory.

Queue: four prompts + responses to `done/`; GOVDEED5b in `prompts/`.

---

## 2026-09-16 — Four open decisions walked through and closed; four prompts written (Cowork)

Scott took each with the same shape — the recommended option, the measured alternative, the cost —
and chose the recommended one on all four. Every choice is the "Not on file over a plausible value"
rule applied to a different column.

**GOVDEED5 → split by source** (👤 gov). `latest_deed_date` was three writers deep and 94% sale dates;
`latest_deed_grantee` is set on 5,787 properties, 5,744 without a dated deed behind them. New
`latest_transfer_{date,party,source,ref}` backfilled from evidence with the source written beside it;
`latest_deed_*` become deed-only (≈43); the 75 untraceable go to NULL, snapshotted; every writer
must be able to clear (GOVDEED4 needed a hand-run clear because none can).

**C2k → attested-only widening** (gov step 1, then LCC). The domain `true_owner` may supersede a
lower-tier resolution only where an SOS/SAM manager on the SPE names it (≈858 gov); unattested rows
stay gap-fill. Ledgered, reversible, dry run with a 20-row hand read, and the 16 no-evidence C2g pairs
are the positive control that nothing unattested moved. Full lift (1,036 at once) and sponsor-as-edge
were not chosen; the latter is noted as future work.

**C1B-GOV-GATE → seal SF, unseal SOS** (👤 gov). Re-measured: `owner_needs_salesforce` 1,838 passing,
`owner_needs_sos` sealed — still the wrong arm a week on. The test must read which arm carries the
marker. Once live, C1C's gov arm runs (≈1,851, dry run first).

**GOVDEED-478 → exclude placeholder deeds + clear the planted grantee** (👤 gov). Conflicts today: 899 =
478 dateless (all from the 4,995 no-date/no-instrument rows) + 405 sale-backed (real, must stay) +
16 other. Mark rejected, don't delete (GOVDEED3 still reads them); view and propagators ignore them;
grantee NULLed only where it traces solely to a rejected row.

Queue: four prompts in `prompts/` — three gov handoffs, one LCC build with a gov precondition.
Nothing applied.

---

## 2026-09-16 — GOVDEED4 applied live: 676 dates demoted, 147 properties reconciled (12 repointed, 135 cleared), and `latest_deed_date` turns out to have three writers (Cowork)

Gov PR #401 merged; read the migration first. Confirmed what the response left unsaid: it never
touches `properties`, and `propagate_deed_to_property` only ever SETs. Measured before applying:
**147** properties (⚠️ not 493 — that earlier figure counted join rows, not distinct properties;
corrected in the backlog and the entry below) carried a `latest_deed_date` from a soon-to-be-demoted
deed; 12 had another real dated deed to fall back to, 135 did not. Scott chose apply + clear.

Applied `20260916_gov_govdeed4_low_confidence_date_guard` to `scknotsqkcheojiaewwh`: **168 dated /
676 approx / 676 in the snapshot**, 0 `low` rows still dated, remaining dated by confidence
∅ 145 · medium 21 · high 2 — exactly the migration's own expected numbers. Then, ledgered in
`_gov_govdeed4_cleared_properties_20260916` (147 rows, prior date + grantee, `outcome`): ran
`propagate_deed_to_property` → `latest_deed_set = 12` (the predicted 12), then NULLed
`latest_deed_date` + `latest_deed_grantee` on the properties still pointing at a demoted deed with no
surviving dated source → **135 cleared**. Ledger reads `{cleared: 135, repointed: 12}`.
`properties.latest_deed_date = '2023-10-01'` went 130 → **5** (those 5 come from `sales_transactions`,
not deeds — see below). 17 `ownership_history` rows still carry a demoted deed's date; left as-is for the
GOVDEED-478 disposition, as the handoff said.

⭐ Side-finding while verifying: of **2,401** properties with a `latest_deed_date`, only **43** trace to
a bridged dated deed. **2,263** match `sales_transactions.sale_date` — written by the intel sweep
(`20260508_gov_intel_sweep_tier3c_and_true_owner.sql` l.191, `latest_deed_date = l.sale_date`) —
and a third writer, `sync_properties_from_sources.py` l.1723, also SETs from deeds. The column is
mostly a sale date wearing a deed name; **75** values trace to nothing at all. Not this defect (a
CoStar sale month is a different convention from a model guess), but it belongs in the backlog as
**GOVDEED5** before anyone reads `latest_deed_date` as "there is a deed." Nothing else changed.

---

## 2026-09-16 — GOVDEED4 reconciled: built in gov (PR #401), migration NOT yet applied; two deviations from the handoff, one of them a disposition decision (Cowork)

The round (gov branch `claude/modest-wozniak-kyexxl`, commit `ce1d5bc`, tracking **PR #401**, not merged)
did the four steps: `deed_records.recording_date_approx` + a real `date_confidence` column;
`save_deed_record` demotes the date into the approx column and `has_chronology_key` no longer
counts it, so a placeholder-grantor row with only a guessed date is now **rejected**; prompt rule 5
asks for `null` when the day is unknown; 5 new tests with both positive controls (57/57 in file).
📊 Live check: columns absent, snapshot table absent, **844 dated / 676 low — unchanged**, so
nothing has run against `scknotsqkcheojiaewwh` yet (no credentials in the round's sandbox — stated).

Two departures, both worth knowing before the apply. ① **Narrower than asked:** the guard fires only
on `low` **AND** day-of-month = 01, not on any `low` date — the round's own positive control asserts a
non-day-01 low date still writes as recorded. Today that is the same population (676/676 are day-01),
and with rule 5 changed the model should now emit `null` instead; but a `low` non-01 date remains a
recorded date. Follow-up, not a blocker. ② **Wider than asked:** the migration **demotes the 676
existing rows in place** (`recording_date` → approx, `recording_date` set NULL), snapshotting the ids
to `_gov_govdeed4_demoted_dates_20260916` for reversal. The handoff deferred that to the GOVDEED-478
disposition round. It is ledgered and reversible, and it is the disposition that round would most
likely have chosen — so acceptable, but it makes the apply a **data change**, not a guard. ⚠️ What the
response does **not** say: the `properties.latest_deed_date` values (**147** distinct properties — first written
here as 493, which was join rows) and **25** `ownership_history` rows sourced from those deeds. Demoting the deed does not clear them; unless the
migration re-runs propagation (unreadable from here — no repo access to gov from this session), those
493 keep a date whose source row no longer has one. That is the first thing to read in the SQL.

Next: merge #401, pull `GovernmentProject`, read the migration for the 493/25 question, apply, re-measure
(`recording_date IS NOT NULL` before/after, `latest_deed_date` on the 493), then GOVDEED3/GOVDEED-478
inherit a smaller problem. Queue: `GOVDEED4` prompt + response filed to `done/` — and the four moves PR #2502 *claimed*
(DEED1-autofix, GOVDEED1, GOVDEED2, ID3b) had not happened (the apply script only moved C1C-SPLIT);
done for real here. STATUS archived to ~2,350 (eighteenth span, `tail10`).

---

## 2026-09-16 — GOVDEED4: the dated gov deeds are 80% invented dates, and GOVDEED2 just promoted them to winner (Cowork)

Ran down the two C2g side-findings. The "seller" resolutions are **not a class** — `Scannell` and
`Park De Ville Trio` each have real, older evidence (a 2017 `rel_purchase`, a 2021 lease-diff
transition); the later deeds never became LCC evidence because **there is no deed-grantee feeder** —
deeds reach LCC only via gov's `true_owner`, behind C2k's gate. Folded into C2k, with one more
structural note: `v_lcc_owner_supersession_candidates` has the same `unresolved`-only gate, so
**whichever feeder touches an asset first wins forever**.

The `2023-10-01` sentinel is real, and bigger than 130 properties. `deed_records` has **844** dated
rows; **676 (80%) carry `raw_payload.date_confidence='low'`**, every one day-01, 667 with no document
number, 451 with a placeholder grantor. The extraction prompt's rule 5 *tells* the model to emit
`YYYY-MM-01` with `date_confidence='low'` when the day is unknown; the recall path does it when
nothing is known (`2023-10-01` ×486). `save_deed_record` writes the date as recorded, keeps the flag
only inside `raw_payload`, and lets it satisfy the accept gate. ⚠️ **GOVDEED2's NULL guard made these
the winning deed** — 493 properties now source `latest_deed_date` from a `low` row. Only **2** dated
rows are `high` with a document number. dia: 230 dated, 0 low, clean. 👤 `government-lease` →
**GOVDEED4** handoff written; the 676 join GOVDEED-478's disposition question. Nothing applied.

---

## 2026-09-16 — C1C-SPLIT applied and run live: 839 dia tasks retired, gov untouched — and the dry run was counting lanes (Cowork)

Ran the sequence the round asked for, on LCC Opps: applied `20260908130300` (the nine
objects DEPLOY2 caught absent; **C1C-UNAPPLIED closed**), applied `20260916120000`, positive-controlled
both guards live (empty array and `owner_needs_sos` each RAISE with the documented message), one
signature in `pg_proc`.

⚠️ **Then the dry run said `tasks_to_retire = 1`** next to `by_type = {dia: 839}`. The `count(*)`
in the dry-run `jsonb_build_object` runs over the per-lane `GROUP BY` subquery, so it counts lanes
— 1 for dia alone, 2 for both. The defect is in `20260908130300` as well and was never seen because
that file never ran. The write path counts the ledger's `RETURNING` and is right; but the dry run is
the function's safety property, and the prompt's own stop rule reads exactly that field. Fixed as
**`20260916130000_lcc_c1csplit_b_dry_run_counts_tasks.sql`** (`sum(n)`), applied live before any
write, guard test added with a positive control that the original still carries the defect.

Corrected dry run: **839 dia / 0 gov** — 838 plus one row minted 2026-09-15 after the round measured.
Explained, so not a stop; noted that the dia trickle is 2 in 9 days, not 0. Real run, batch
`c1c-dia-20260916`: **839 retired**, 839 ledger rows, 839 stamped `terminal=true`, watch view 839
with 0 gov, and `v_lcc_research_lane_summary` no longer lists the dia lane while gov
`owner_needs_salesforce` reads **1,851, unchanged**. Reversal handle:
`lcc_c1c_unretire('c1c-dia-20260916')`. C1B-GOV-GATE untouched, as instructed. Prompt-queue
hygiene in the same PR: DEED1 (autofix), GOVDEED1, GOVDEED2, ID3b filed to `done/`.

---

## 2026-09-16 — C1C-SPLIT: `lcc_c1c_retire_sf_lanes` gains lane scoping; dia retire is ready, gov stays out (Claude Code)

C1c (`20260908130300`) can only retire BOTH `owner_needs_salesforce` (gov) and
`true_owner_needs_salesforce` (dia) at once — its plan CTE hardcodes
`_lcc_c1c_lane_types()`. That is now wrong: **C1B-GOV-GATE** found the gov gate
guards `owner_needs_sos`, not `owner_needs_salesforce`, so the gov lane is still
being fed (175 rows minted 2026-09-08..15) while the dia lane genuinely holds
(1 row minted in the same window, gate confirmed live).

Shipped `supabase/migrations/20260916120000_lcc_c1csplit_scope_retire_by_lane.sql`:
`lcc_c1c_retire_sf_lanes` gains a 4th, trailing `p_research_types text[] default
null` parameter. `NULL` still means the full lane set (both lanes) — the
reversal runbook and any future gov retirement depend on that default not
narrowing. A non-null array is validated against `_lcc_c1c_lane_types()` and
**raises** on an empty array or an unrecognised lane name; there is no
zero-row silent success. The pre-split 3-arg signature is `drop function if
exists`-ed before the new `create or replace` (the N15d/N15g 42725 overload
trap), and the migration asserts live — via `pg_proc`, in a `do $$ ... raise
exception` block — that exactly one signature survives, rather than trusting
the DROP. `_lcc_c1c_lane_types()`, `lcc_c1c_unretire`,
`lcc_c1c_reopen_tasks` and `lcc_c1c_reopen_relinked` are untouched.

Guard: `test/c1c-split-scope-retire-by-lane.test.mjs` — 12 structural
assertions over both migration files (comment-stripped), all passing,
including a positive control that the unknown-lane RAISE interpolates the
real bad values rather than a static string.

⚠️ **The live apply and run are PENDING.** This sandbox has no Supabase egress
(the same constraint DEPLOY2 already documented), so nothing here executed
against LCC Opps. Cowork applies in order: (1) `20260908130300` — DDL only,
defines functions, runs nothing inline; (2) this scoping migration; (3)
`select lcc_c1c_retire_sf_lanes(true, 'c1c-dia-<date>', null,
array['true_owner_needs_salesforce'])` — **expect `tasks_to_retire = 838`,
`research_types = ["true_owner_needs_salesforce"]`, 0 gov rows touched; any
other number is a STOP, re-measure rather than proceed**; (4) the same call
with `p_dry_run => false`; (5) re-read `v_lcc_research_lane_summary`: dia lane
→ 0 open, gov `owner_needs_salesforce` unchanged at ~1,851.

C2 stays open until the dia retirement is confirmed live. C1B-GOV-GATE stays
open and is explicitly out of scope for this change — do not retire the gov
lane, do not touch the gov gate, do not re-apply the retired `government/`
copy of C1b. Backlog: **C1C-SPLIT** row updated to shipped/live-run-pending.

---

> **📦 ARCHIVE (2026-09-18, twenty-second span):** the 2026-09-15 → 2026-09-16 entries from the C2g
> read-through down to DEPLOY2-unapplied (and the tail13 / thirteenth-span pointers) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-15_to_09-16_tail14.md`](../history/STATUS_claude-code_2026-09-15_to_09-16_tail14.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
