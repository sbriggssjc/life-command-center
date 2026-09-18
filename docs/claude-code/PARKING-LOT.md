# Parking lot — things noticed on the way, not yet triaged

**What this is.** A one-line-per-item intake for anything Cowork, Claude Code or Scott notices while
doing something else: a smell in a log, a doc that reads wrong, a flag with no reason, a number that
does not add up. It is **not** a backlog — nothing here is planned, sized or owned. It is the place
where an observation waits so it is neither lost nor allowed to derail the turn it appeared in.

**How it works.**
- Anyone drops a line: date · where it was seen · what · who saw it. No analysis; a link if there is one.
- Every Cowork turn (README step ③b) triages the open lines: each becomes a **backlog row** (with its
  category section), a **checklist line** (if it is Scott's), a **prompt**, a **decision**, or is
  **dropped with a one-word reason**. The line then moves to *Triaged* with its destination.
- Claude Code rounds feed it through the **`Parked:`** section every prompt now asks for in its
  Reporting block: "anything you noticed out of scope, one line each" — Cowork copies those lines in.
  A round that writes here directly uses the **next free PL number in the file at the time it writes**
  (two rounds on 2026-09-17 both used PL-7…9; renumbered).
- Scott feeds it however is easiest: a line here, a note in `SB notes/`, or a sentence in chat.
- A line older than seven days that nobody has triaged is a process failure; the triage step says so.

Sibling ledgers: `SB notes/TRIAGE.md` (Scott's in-app observations — richer intake, same idea),
`OPERATOR-CHECKLIST.md` (what only Scott can do), `docs/os/PLANNED-BACKLOG.md` (the state).

## Open

| # | seen | where | what | by |
|---|---|---|---|---|

## Triaged

| # | triaged | destination |
|---|---|---|
| PL-1 | 2026-09-17 | → backlog `EDGE-GATES1` (prompted) — *Beyond `ai-copilot` and `salesforce-enrichment`, **eight more** edge functions run `verify_jwt:false` with no …* |
| PL-2 | 2026-09-17 | → folded into `EDGE-GATES1` (drift check) — *reports `"version":52` while the deployed function is v84 — the version string in the source is hand-maintaine…* |
| PL-3 | 2026-09-17 | → checklist Q2 (enforce ≈2026-10-09) — *v27 (the log-only gate) has been live since 2026-09-09; **no `[sfenrich-auth]` line in the last 24 h**. Whethe…* |
| PL-4 | 2026-09-17 | → backlog `DIA-DUP1` — *`18003 Longenbaugh` exists in dia as both `Rd` and `Dr` (property 22269 + another) — a duplicate property to f…* |
| PL-5 | 2026-09-17 | recorded on `GOVDEED3`; no action (dropped: existing state, decided elsewhere) — *the gov deed ingest runs on GitHub Actions while the gov repo's own note says compute crons belong on Railway …* |
| PL-6 | 2026-09-17 | → backlog `OWNER-WRITERS1` — *`properties.updated_at` moved on 3 non-Harris rows during the H7 window (`1325 Hwy 4 East`, `1360 N Shenandoah…* |
| PL-7 | 2026-09-17 | → noted on `HOME2` row (no due-date field) — *`v_inbox_triage` carries no `due_date`/overdue concept, only `status IN ('new','triaged')` — the Inbox lane's …* |
| PL-8 | 2026-09-17 | → `HOME2-on` gate (measure before the flip) — *Could not measure how often `today_top_5` (the old My-Priorities snapshot) came back empty over the last 14 da…* |
| PL-9 | 2026-09-17 | → noted on `HOME2` row (perf nit) — *`_home3ResearchItems` inherits nbaSnapshot's existing 15-item fetch (`limit=15`) and slices to 5 client-side r…* |
| PL-10 | 2026-09-17 | → noted on `HOME2` row (perf nit) — *The BD lane's fetch (`/api/seller-prospect-queue?chip=all&limit=5&offset=0`) is a SEPARATE network round trip …* |
| PL-11 | 2026-09-17 | → backlog `BR4-b` — *123 `brokers.broker_name` rows are firm/operator-shaped, not people (flagged into `dia_broker_company_composit…* |
| PL-12 | 2026-09-17 | → backlog `BR4-b` — *`dia_broker_company_composite_review` still holds 468 open rows: 120 same-name-one-linked-one-blank groups (ne…* |
| PL-13 | 2026-09-17 | → checklist Q29 (Scott, 30 s) — *Own name ("Scott Briggs") appears 3x in `brokers` (ids 1373/2076/2437), one linked to `broker_company_id=126`,…* |
| PL-14 | 2026-09-17 | → noted on `COPILOT-OPEN` + `EDGE-GATES1-b` — *`ai-copilot` logs `DENY-WOULD` for `POST /chat` with caller class `node other` (not browser, not Railway) — an unnamed chat caller that breaks on the enforce flip; seen by Cowork in the 24 h log 2026-09-17…* |
| PL-15 | 2026-09-17 | → backlog `EDGE-GATES1-b` (e) — *`calendar-ics-sync` v21 logs `DENY-WOULD` from a caller of unknown class within hours of the gate landing — a real caller nobody has named…* |
| PL-16 | 2026-09-17 | → design input on backlog `RECON1` (no separate row) — *Scott 2026-09-17: "maybe deploy an Ollama local model on a regular cleaning and connecting task" — source of truth and accuracy lacking, many gaps to close…* |
| PL-17 | 2026-09-17 | → checklist Q1 + backlog `EDGE-GATES1-b` — *PL-14's `POST /chat node other` caller seen again 19:19:39 UTC: UA `node`, AWS Ashburn, 400 — not Railway; derived: the retired Vercel deployment is still up and being called (Cowork, edge log)…* |
| PL-18 | 2026-09-17 | → backlog `RECON1-b` (b) — *RECON1 stored the literal `Not on file (pending deed)` in `sales_transactions.buyer_name/seller_name`; "not on file" is a render, not a party name (Cowork, reconcile)…* |
| PL-19 | 2026-09-17 | → backlog `RECON2` — *RECON1's lease trigger flips `is_active` silently (no ledger) whenever a writer touches one of 2,454 expired-but-active leases; rent rolls will change with no record of why (Cowork, reconcile)…* |
| PL-20 | 2026-09-17 | → decision: said in STATUS round 28; prompts keep the `Parked:` ask — *neither RECON1 nor GUARD-CLOBBER1 returned a `Parked:` section, and RECON1 wrote no STATUS entry or row edit (⑤-CC) (Cowork, reconcile)…* |
| PL-21 | 2026-09-17 | → backlog `VERCEL-LIVE1` + checklist Q30 — *Scott's daily LCC window is `life-command-center-nine.vercel.app`, a stale build; `CLAUDE.md` calls Vercel retired (Cowork, from Scott's Vercel log export)…* |
| PL-22 | 2026-09-17 | → noted on backlog `RECON2` (out of scope there, no row yet) — *`leases.status` is free text: `Active`/`active`/NULL/`MTM`/`Terminated`-but-active… 17 status×is_active combinations (Cowork, measuring for RECON2)…* |
| PL-23 | 2026-09-17 | → backlog `VERCEL-LIVE1` (4) — *Vercel `/api/priority-queue` logs `band-counts query threw: This operation was aborted` after 8 s (Vercel log 21:08 UTC); check whether Railway does the same (Cowork)…* |
| PL-24 | 2026-09-17 | → backlog `RECON2-b` — *`medicare_clinics.status='removed'` on 90% of rows while `is_operating=true` on the same rows; two fields, two truths, used as closure evidence (Cowork, reconcile)…* |
| PL-25 | 2026-09-17 | → decision: said in both new prompts — *CC's RECON2 round titled its STATUS entry "Round 30 (Cowork)"; CC entries are labelled (CC) and do not take Cowork round numbers — this Cowork round is 31 (Cowork)…* |
| PL-26 | 2026-09-17 | → backlog `HOME2-fix` (generalised test) — *a flag-gated feature can ship JS whose DOM ids exist nowhere and pass 200 lines of tests (Cowork, from Scott's look)…* |
| PL-27 | 2026-09-18 | → backlog `HOME2-b` — *HOME2's Inbox lane reads `dailyBriefingSnapshot.inbox_summary`, a key the live snapshot never had; a lane built against an imagined shape (Cowork, browser look)…* |
| PL-28 | 2026-09-18 | → backlog `DEPLOY2-drop-aware` — *DEPLOY2 treats an object a later migration DROPs as "never applied" (Cowork, from SBN-13)…* |
| PL-29 | 2026-09-18 | → checklist Q31 — *a response docx saved as 0 bytes with a `~$` lock file beside it; Word had it open when Scott saved (Cowork)…* |
| PL-30 | 2026-09-18 | → backlog `PERF-SPQ1` — *`/api/seller-prospect-queue` 14.6 s in the browser vs 0.86 s for the view: seven serial `count=exact` chip requests (Cowork, HOME2-b look)…* |
| PL-31 | 2026-09-18 | → checklist Q1 + `EDGE-GATES1-b` — *a Power Automate header key with a trailing newline (`X-PA-Webhook-Secret\n`) is silently a different header; the dashboard shows nothing (Cowork, flow export)…* |
| PL-32 | 2026-09-18 | → backlog `HOME2-c` / checklist Q32 — *"place it after Today" put the widget at 1,878 px because Today is 1,800 px tall; placement needs a decision, not another move (Cowork)…* |
| PL-33 | 2026-09-18 | → noted on STATUS round 33 (process) — *HOME2-b's round wrote no STATUS entry (⑤-CC); DEPLOY2-drop-aware's did, labelled (CC) as asked (Cowork)…* |
| PL-34 | 2026-09-18 | → backlog `PERF-SPQ1-b` + checklist Q33 — *a "perf" round merged with `node --check` only and no browser timing; the route went from slow-200 to fast-500 and Home's Today panel went dark (Cowork probe 14:15 UTC)…* |
| PL-35 | 2026-09-18 | → backlog `RECON2-c` — *a `demoted_duplicate` CMS row of a different operator, on a twin property row, passed as "closure" evidence; caught by Scott's CoStar + locator check, not by any rule (Cowork)…* |
| PL-36 | 2026-09-18 | → backlog `RECON1`/`RECON2-c` (R1 example) — *properties 22471 "629 North Hwy 90" and 35849 "629 N Highway 90 Byp, Ste 6" are the same Sierra Vista address as two rows — the Banning class again (Cowork)…* |
| PL-37 | 2026-09-18 | → backlog `SIDEBAR-LEASE1` — *four CoStar sidebar sends today updated twin property rows and no lease expiration landed; the capture path drops the field the lease model most needs (Cowork, measured)…* |
| PL-38 | 2026-09-18 | → backlog `PERF-SPQ1-c` (process) — *two consecutive CC rounds on a perf route merged without a browser probe; each said it could not probe from the sandbox — the prompt now forbids the merge, not the probe (Cowork)…* |
| PL-39 | 2026-09-18 | → backlog `**J13-teardown**` — *Railway names `LCC_DEFAULT_WORKSPACE_ID`, Vercel `LCC_PRIMARY_WORKSPACE_ID`; which does `main` read? (Cowork, from the variables docx)…* |
| PL-40 | 2026-09-18 | → backlog `PERF-SPQ1-c` (recorded) — *a merged migration was again not applied live (`lcc_seller_prospect_chip_counts`) — the round said "applied" nowhere and the JS shipped calling an RPC that did not exist; step 4a caught it (Cowork)…* |
| PL-41 | 2026-09-18 | → backlog `PERF-SPQ2` — *the same route measured 1.5 s alone and 16 s during page load: the bottleneck is the view under concurrency, not the route (Cowork)…* |
| PL-42 | 2026-09-18 | → runbook Step 3b + checklist Q3 ④ — *Railway Raw-Editor exports carry values; five such docx now sit in a synced folder (gitignored, never committed) (Cowork)…* |
| PL-43 | 2026-09-18 | → CURRENT-STATE §1 (done) — *a fourth Railway service, `gracious-radiance` (owner resolver), was not in the runtime-truth row (Cowork, from the env export)…* |
| PL-44 | 2026-09-18 | → backlog `**J13-teardown**` (recorded) — *`life-command-center.vercel.app` (no `-nine`) serves a third-party "Command Center" app; 36 repo references point at a stranger's site (Cowork, teardown proof)…* |
| PL-45 | 2026-09-18 | → backlog `RESOLVER1` — *the resolver's `/extract-parties` (W5.1 channel A) exists while RECON1's sale 15042 has no buyer/seller — R3 never calls it? (Cowork)…* |
| PL-46 | 2026-09-18 | → checklist Q34 — *`RESOLVER_RETRAIN_LOOP` has read `partial` since W4.4 for want of one edge secret; labels frozen at 335 since 08-14 (Cowork)…* |
| PL-47 | 2026-09-18 | → backlog `RECON2-d` — *`holdover_confirmed` written where CoStar says an active lease exists; wrong in kind, right on `is_active` (Cowork, RECON2-c reconcile)…* |
| PL-48 | 2026-09-18 | → backlog `RECON2-d` — *`medicare_clinics.chain_organization` NULL on an operating CCN (35849) blinds operator-match; how many more? (CC round, from its own report)…* |
| PL-49 | 2026-09-18 | → backlog `RECON1` (R1 population) — *`twin_operating` = 48 leases on properties whose address-twin carries an operating clinic — the first measured size of the Banning class (Cowork)…* |
| PL-50 | 2026-09-18 | → STATUS round 39 (process) — *third CC round in two days with no STATUS entry; the prompt line "STATUS entry labelled (CC)" is being read as optional (Cowork)…* |
| PL-51 | 2026-09-18 | → backlog `SIDEBAR2` (c) — *every sidebar-created `inbox_items` row appears twice within ~1 s (6 pairs in 2 days); Home's INBOX lane shows the Gaffney OM twice (Cowork, from Scott's screenshot + `inbox_items`)…* |
| PL-52 | 2026-09-18 | → backlog `RECON2-d` — *CoStar shows no lease expiration for Goldsboro/Dixon/Scranton; `holdover_confirmed` and `renewed_confirmed` both assert more than is known — a state for "occupied, term not on file" is missing from the vocabulary (Scott's read + Cowork)…* |
| PL-53 | 2026-09-18 | → backlog `SIDEBAR2` (c) — *code comments cite `idx_inbox_items_dedup (workspace_id, external_id, source_type)` from `schema/028_email_dedup_constraint.sql`; the live index is `inbox_items_workspace_external_id_unique (workspace_id, external_id)`. PostgREST `resolution=merge-duplicates` merges on the PK, so a retry now returns 409 on the unique index rather than merging silently — dedup holds, but the caller's 409 path should be read as success (Cowork)…* |
| PL-54 | 2026-09-18 | → backlog `RECON2-d` — *two "no date" markers on `leases`: `expiration_state = expiration_unknown` (RECON2) and `lease_expiration_source_state = source_no_date` (SIDEBAR2-a); one writer per column, one meaning, decided in RECON2-d (Cowork)…* |
| PL-55 | 2026-09-18 | → STATUS round 42 (process) — *CC titled its HOME2-c entry "Round 41 (CC)" (Cowork's next number) and wrote no entry at all for SIDEBAR2; Cowork renumbers itself to 42. Prompt line to add: "STATUS heading = `Round N (CC)` where N is the prompt's round number + `-CC`, never a bare integer" (Cowork)…* |
| PL-56 | 2026-09-18 | → backlog `SIDEBAR2` — *CC reports 2 pre-existing failures on `main` (`test/hermetic-suite.test.mjs` "guard is actually installed" + 1 skip). Not verified by Cowork this round; if real, it is a red suite on main that CI does not gate on — check in the next CC round's report (Cowork)…* |
