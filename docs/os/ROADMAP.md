# LCC — ROADMAP (the category-level view: live / partial / open / next unit)

> **What this file is.** One screen per category of the build, answering *"in this lane, what is live,
> what is half-built, what is open, what is the next unit of work, and what is waiting on Scott?"*
> It sits **above** `PLANNED-BACKLOG.md` (the row-level truth — every row ID here is a row there) and
> **beside** `CURRENT-STATE.md` (the measured state of the live system). It carries no rules
> (`canon/`) and no history (`docs/history/`). When a row changes state, the backlog row changes first;
> this file is re-cut at the end of the round that changed it.
>
> **Why it exists.** The INVENTORY1/1b gap map (2026-09-16, `docs/audits/INVENTORY1_GAP_MAP_2026-09.md`,
> 1,789 intent rows) showed that findings were landing in the backlog **by adjacency** — a deed row
> under "Executive briefs", an owner-gap row under a property walkthrough — so no reader could see a
> lane whole. The backlog was regrouped (§P19/§P20/§P21) and this file was added the same day.
>
> **Reading the states.** ✅ live = merged, deployed and measured; 🟡 partial = some of it runs;
> 🔴 open = a prompt exists or is owed; 👤 = Scott's decision; 📐 = designed, nothing authorized.
> Counts are as of the date on the line; re-measure before quoting (`CLAUDE.md` → dated blockers).
>
> First cut 2026-09-16 (Cowork). Sections are ordered roughly by how close they are to BD outcomes.

---

## 1. Ownership evidence & the owner gap — backlog §P19, §P15, Open-threads *Deed / owner-conflict* and *Research lanes / owner gap*

- ✅ **Live:** gov `latest_deed_*` split to deed-only with one writer (GOVDEED4/5/5b, gov PRs #400–#405); the deed accept gate conjunctive on placeholders (GOVDEED3, gov PR #406 — runtime check V1); DEED1-reconcile-2 done; the 478 manufactured conflicts dispositioned (GOVDEED-478); Salesforce research lanes retired on both databases (C1C, ledgered, reversible); the gov gate on the right arm (C1B-GOV-GATE); **39 assessor-sourced owners written** — Philadelphia 20 (city open API), Harris 19 (HCAD bulk PDATA) — every one citing its source record (OWNERGAP2, -harris, -harris-b); `get_property_context` shows dia-only properties (MCP1).
- 🟡 **Partial:** Harris — the full HCAD roll is staged (71,282 F1/F2 accounts, 2026-09-16); **20 of 50 applied**, 2 sit on C2-class accounts (S5), **27 are house numbers HCAD does not carry as situs** — a property-identity gap (§P10a), not a matcher gap. Both defects found on the real file/apply are fixed and running (OWNERGAP2-harris-c, -ledger-order; PRs #2541, #2540).
- 🔴 **Open:** DEED1-emptycompare, DEED1-rentrank, CANON-OWNERSHIP1 (👤 proposal ready), the `18003 Longenbaugh` Rd/Dr duplicate property surfaced by the Harris apply; 1,346 `owner_needs_sos` tasks still the feed with no other consumer.
- ⏭️ **Next unit:** the 27 situs-gap properties as the first §P10a case (parcel discriminator), or the next free-bulk jurisdiction from OWNERGAP1-decision's list, same contract. The 27 situs-gap properties are the first concrete case for §P10a.
- 👤 **Decisions:** CANON-OWNERSHIP1 (who owns Dialysis_DB's schema in `CLAUDE.md`).

## 2. Entity identity at the source of record (ID-series) — backlog §P0d, Open-threads *Identity / operator canonicalization* and *gov agency canonicalization*

- ✅ **Live:** ID2b/ID2b-caps/-caps-2 (operator canonicalization, third comp source fixed at source); ID3a–ID3e (gov agency canonicalization, live-verified); the repo-ownership hazard I16 closed (gov migrations belong to `government-lease`).
- ✅ **Live (new):** ID3d — `leases.guarantor_id` 1 → 628 of 715, subsidiaries kept distinct from DaVita/Fresenius, real FK, fill-blanks trigger.
- 🔴 **Open:** ID3d-b (81 guarantor strings / 87 leases for review — filed, not prompted); D3 (merge the Dialysis removal PR #7416); ID3a-drift (the Home gaps widget reads a column ID3a's fold never writes — §P20).
- ⏭️ **Next unit:** ID3d-b when a review rule for multi-party and personal guarantors is decided; ID3a-drift rides with HOME2.

## 3. Domain truth, sponsors and SPEs (C2 series) — backlog §P0d, Open-threads *C2g / sponsor↔SPE gate*

- ✅ **Live:** C2k attested-only widening (LCC PR #2506): 218 supersessions, 40/43 pairs to sponsor, controls untouched, reversible.
- 📐 **Designed:** sponsor-as-edge (C2h/C2i) — future work, nothing authorized.
- ⏭️ **Next unit:** none queued; re-open when the gov side exposes more attested rows.

## 4. BD pipeline funnel & operator funnel — backlog §P0b, §HP1, Open-threads *Operator funnel*

- ✅ **Live:** HP1 Today-500 badge; HP1-P1a-fix (608 `bd_opportunities` rows updated in Salesforce — the first LCC→SF UPDATE); BROKER1 prospect assignment (1,303 assigned); **BR1/BR3** — `broker_companies` repaired (131 → 75, `;` composites collapsed, write guard) and `broker_company_id` 7.2% → 14.4%.
- 🟡 **Partial:** the funnel itself — the 2026-08-28 audit measured 1.1% of gov properties with 2+ historical owner links; the rows in §P0b are the ladder from there.
- 🔴 **Open:** the §P0b rows (re-measure before acting; the audit is three weeks old); BROKER1-sf (SF write-back) deliberately unbuilt; **BR4** (broker dedupe — its input is now the 661 unmatched `brokers.company` strings BR1 queued) and **BR5** (firm/agent as two fields) unblocked, not prompted.
- ✅ **Live (new):** BR4 — 25.0% of brokers firm-linked, 52 firms minted with evidence.
- ⏭️ **Next unit:** BR4-b (the firm-shaped broker rows and the 468 review rows, as Scott-readable lists) then BR5.

## 5. App surfaces — Home, Priority, Dialysis Overview, review workbench — backlog §P20, §P16, §HP1, Open-threads *App feedback intake (SBN)* and *App / UX*

- ✅ **Live:** `daily-briefing` edge fn v26 (HOME1-deploy); DIA1/DIA1b (tiles verified, NPI tile → lane count, "as of"); PRI1 (bands explained); the SB-notes intake loop (`docs/claude-code/SB notes/`, `TRIAGE.md` SBN-1…11) — Scott's in-app observations become rows within a turn.
- 🟡 **Partial:** HOME1 (§C fix live, §B three-lane spec unbuilt); ASC50 review workbench built and locally verified, publication pending.
- ✅ **Live (new):** DIA1c — 33 canonical operators, one `US Renal Care`, 0 unresolved; the Operators tile reads the canonical count.
- 🔴 **Open:** HOME2 (three-lane Home, after PRI2), ID3a-drift.
- ✅ **Live (new):** PRI2-on — the Priority tab is one ranked list, reason-first, one card per property (flag ON 2026-09-17).
- ⏭️ **Next unit:** HOME2-on (flag ON 2026-09-17, Scott's look pending — keep or fix round); SETTINGS-FLAGS1 (no flags panel exists though the app points to one); then ID3a-drift.
- 👤 **Decisions:** none open (R1 delegated; S2 decided).

## 6. Flows, intake and artifact health (Power Automate ↔ LCC) — backlog §P20, `docs/setup/POWER-AUTOMATE-FLOW-FIXES-2026-09-16.md`

- ✅ **Live:** F1–F7 applied by Scott and verified from his exports; F1c (Get Artifact: metadata first, size condition, bytes for small files) verified; LCC accepts both Get-Artifact shapes and treats `too_large` as a named terminal reason with a 30-day ceiling instead of ~48 retries (FLOWS1-artifact); FLOWS1-order **refuted** — LCC does not relay the move.
- 🟡 **Partial:** the digest has not yet cycled since the fixes — the Saturday "N flows have failed" mail into `SB notes/` is the verification.
- 🔴 **Open:** FLOWS1-path (stale SharePoint deal-folder path writer), FLOWS1-artifact-b (size-aware skip at discovery, real backoff — low), F6 durable async version (needs an LCC callback route).
- ✅ **Live (new):** F8 — one intake flow (*LCC Flagged Email Intake*) does attachments, intake, web link and card; the Move Queue Executor is the only mover; the Hardened and Move-Message flows are off.
- ⏭️ **Next unit:** Saturday's digest against F1–F8 (and `already_out` staying at 2); then FLOWS-consolidate-lcc.
- 👤 **Decisions:** none open; the F8 pre-check (does a Move Queue Executor flow exist?) is a fact to report, not a decision.

## 7. Market briefs & executive briefs — backlog §P18, Open-threads *Market briefs (MB/EB)*

- ✅ **Live:** `MARKET_BRIEF_PSQL` + `MARKET_BRIEF_RENDER` on; daily email carries the Lane Briefs block (cap-rate bands, on-market, CMS-staleness gaps).
- 🔴 **Open:** the §P18 rows that are not ✅ (CTO/CDO build brief follow-ups) — re-read the section; nothing prompted.

## 8. Public records, CoStar sidebar & CMS ingestion (PR5 / PRI / HCRIS) — backlog §P0, Open-threads *CoStar sidebar / public records*

- ✅ **Live:** PR-scanner-3 (`county_records_needed` action); PRI6 reliability sweep (both repos).
- 🔴 **Open:** HCRIS-TIMEOUT — four rounds deep, root cause isolated 2026-09-16 (tracker discards its run id; `aux_cms_tables` swallows its step timeout), **fix not yet written**; the QIP/deficiency ingestors share the old bare-timeout bug.
- ⏭️ **Next unit:** the HCRIS fix prompt (Dialysis repo) — the two structural bugs, then a live run.

## 9. Buyer engagement — Open-threads *Buyer engagement (BUY0)*

- ✅ **Live:** Phase 0 for Geller Round 1 (client deliverable + email draft).
- 🔴 **Open:** BUY1a/1b, BUY-G1…G6 (build handoff written, not prompted).
- ⏭️ **Next unit:** BUY1a when Scott wants the next buyer round.

## 10. Contacts, accounts & outbound — backlog §P3, §P4, §P1 (Tier 0 owner-contact system)

- ✅ **Live:** the Tier 0 owner-contact rows summarised in `docs/architecture/tier0-owner-contact-system.md` (read that; it carries the live numbers).
- 📐 **Designed:** account-based contact intelligence (§P3), contact reconciliation outbound (§P4, measured 2026-08-26). REGISTRY-contacts-hub note is wrong on LCC Opps (live) vs gov (stale) — §P21.
- ⏭️ **Next unit:** none authorized; this lane waits on lanes 1–2 delivering owners to contact.

## 11. Deal intelligence, next-best-action, marketing, edge layers — backlog §P5, §P6, §P7

- 📐 **Designed, not built** — catalogs date from 2026-07-27/28; re-measure any row before acting.
- ✅ **Live pieces:** the MCP tool surface (`get_deal_dossier`, `log_offer`, comps synthesis — see `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`).

## 12. Data coherence & known defects — backlog §P0d, §P10, §P10a, §P14, §P21

- ✅ **Live:** the DEPLOY2 unapplied-migration detector (first real catch C1C-UNAPPLIED; its coverage fix has not had a live run, and it missed the geocode-cap and PRI2-on migrations on 2026-09-17 — the loop now checks migrations by hand until it does — `DEPLOY2-live` ran 2026-09-17: 149 objects / 0 unapplied, and a CI job now runs on every merge); doc guards in CI (STATUS header/line budget, backlog ID uniqueness, table shape).
- ✅ **Live (new):** MISPARSE1 — `email_fanout` split by mailbox genericness, 4 → 9 of 12 real brokers recovered on the live fixture.
- 🔴 **Open:** **RECON2** (the fleet `reconcile_property()` build from RECON1's merged spec — 2,454 expired-but-active leases, 235 unattributed Northmarq sales, ~75 duplicate-address candidates; waits on Scott's holdover rule) and **RECON1-b** (Banning residue: deed task never created, sentinel party name, listing status swap, trace table, lease abstract); RECON1 itself merged + reconciled 2026-09-17 (was: prompted 2026-09-17 — one clinic as three `properties` rows with listings, sales, leases and owners that never reconcile; the post-ingest `reconcile_property()` is §P10a's first build); REMEDIATION-2026-05 (the May TODOs, now rows, DB-verified); §P10 sized unfixed defects; BR1-misparse-handoff / titleparse / fp (the rest of the contact-guard family); the Longenbaugh duplicate (lane 1); the 27 Harris situs-gap properties (same class as RECON1).
- 📐 **Designed:** cross-lane property identity / address resolution (§P10a) — the Harris street-shape bugs are the same class, solved lane-locally again.
- ⏭️ **Next unit:** **Q37 — pause the propagation job + send `DIA-PROPAGATOR1` to the Dialysis repo** and **Q36 — run `commit-dialysis-recon2d-reconcile.ps1`**, then **`SIDEBAR4`** (twin contact entities; prompt next), `SIDEBAR3`, `RECON2-d-render`, `PERF-SPQ2` (20-s cold request measured), `RESOLVER1`; HOME2-e live 09-18 (the three-lane Home is done) — previously: Q37, Q36, **`HOME2-e`**, **`SIDEBAR4`** (twin contact entities), **`SIDEBAR3`**, `RECON2-d-render`, `PERF-SPQ2`, `RESOLVER1`; RECON2-d live + ported 09-18, HOME2-d merged but ineffective — previously: **`RECON2-d`** and **`HOME2-d`**, then **`SIDEBAR3`** (merge the three range-address twins, re-send), `PERF-SPQ2`, `RESOLVER1`; HOME2-c and SIDEBAR2 (c) live 09-18 — previously: **HOME2-c** (prompted, option b) and **SIDEBAR2** (prompted: double-posted inbox items, lease expiration not landed, twin rows), then `RECON2-d` (rename `holdover_confirmed` → `occupied_term_unknown`; prompt-ready), `PERF-SPQ2`, `RESOLVER1`, **SIDEBAR-LEASE1**, **PERF-SPQ2** (materialise the seller queue for a cold Home load); PERF-SPQ1-c merged, applied by Cowork and reconciled 09-18 — previously: 🚨 **PERF-SPQ1-c** (revert #2581 + #2583 — Today still dark after -b; then the one-pass counts), then **RECON2-c** (evidence rules + confirm-with-successor, prompt-ready) and **SIDEBAR-LEASE1** — previously: 🚨 **PERF-SPQ1-b** (revert #2581 — the route 500s and Today is dark; then the one-pass counts properly), then **RECON2-c** (classifier evidence rules from the Sierra Vista field check); HOME2-c after Scott's pick — previously: **PERF-SPQ1** (seller-prospect-queue 14 s — seven serial chip counts; prompted 09-18), then HOME2-c once Scott picks the placement; HOME2-b + DEPLOY2-drop-aware merged and reconciled 09-18 — previously: **HOME2-b** (lanes render but BD/Inbox carry wrong data; prompted 09-18), **DEPLOY2-drop-aware** (CI red on a deliberate DROP; prompted 09-18), then RECON2-render + the 7-row confirmation once Scott reads them; RECON2-b + HOME2-fix merged and reconciled 09-18 — previously: **RECON2-b** (the classifier called 1,481 leases on operating clinics "confirmed expired" — `status='removed'` is not a closure; prompted 2026-09-17) and **HOME2-fix** (three-lane Home has no markup; prompted); RECON2 unit 1 + RECON1-b merged and reconciled — previously: RECON2 unit 1 + RECON1-b — **prompted 2026-09-17** on Scott's rule (a lease goes inactive only on confirmed expiration; sample of 25 first); ahead of everything in the app lane: **VERCEL-LIVE1** (Scott's daily window is a stale Vercel build) — previously: once the holdover rule is answered (was RECON1 — Scott's "one accurate view" ask, with the deterministic reconciler first and a local model only for the fuzzy tail); then BR1-misparse-handoff.

## 13. Consumption layer & multi-party ownership — backlog §P1a, §P1b, §P1c

- 🟡 **Partial:** §P1a is no longer the top priority (superseded by C2g/C2k); §P1b repairs are owned by the automation chat; §P1c JV/fund structures designed only.
- ⏭️ **Next unit:** none here until lanes 1–3 settle what an owner *is*.

## 14. Security & hygiene — backlog §P0s, §P9

- 👤 **Decided:** credential rotation deferred until a second user is added (recorded risk acceptance with a trigger, 2026-08-29).
- ✅ **Live (new):** Geocodio tier on, capped 2,400/day in a ledger; Google off by decision; ~3,300 unplaced properties draining at ~120 per 10-minute tick.
- ✅ **Live (new):** EDGE-GATES1 — eight more Dialysis_DB edge functions log-gated with the shared helper (16 of 16 ungated-or-gated now reviewed); Q1 fixed (second calendar flow), `ai-copilot` enforce clock: **all four flows clean since 16:01 UTC 09-18** (last miss 12:01) → earliest enforce 2026-09-21 ~12:00 UTC, after the Vercel delete (the stale Vercel client was the PL-14 `/chat` caller).
- 🔴 **Open:** EDGE-GATES1-b (calendar shim drift, four zero-traffic callers, caldav-push destructive routes, `/calendar-ics-sync` and `POST /chat node other` callers unnamed); §P9 rows, by design at the end.
- ⏭️ **Next unit:** the `ai-copilot` enforce flip on 2026-09-20 if the log stays clean and PL-14 is named; then EDGE-GATES1-b.

## 15. Process, documentation & consolidation — backlog §P21, `docs/os/BUILD-TURN-PROTOCOL.md`, `docs/claude-code/README.md`

- ✅ **Live:** the prompt → response → reconcile loop with STATUS/backlog/CURRENT-STATE kept current each turn; SB-notes intake (④); leak-class rules (⑤); INVENTORY1/1b done; CLAUDE.md pass 1 (5,503 → 3,268 lines, rounds archived verbatim); backlog regrouped by category (P19/P20/P21); this file; rule ⑤-CC (a CC round appends and updates its own row, never restates); Cowork commits as 3-way patches, not whole-file copies (PROCESS-MERGE-CLOBBER).
- 🔴 **Open:** ~~GUARD-CLOBBER1~~ ✅ live on `main` 2026-09-17 (PR #2566) (was: prompted 2026-09-17 after PR #2563 silently reverted STATUS + the backlog to a week-old snapshot — the second clobber; restored by hand, the CI guard from round 17 was never built); the **Scott's queue** (checklist Q1–Q28 — 67 backlog rows that were waiting on him and were mirrored nowhere; tiers A–B are the ones to clear first); INVENTORY2 (ghosts, root-report internals, history prose); CLAUDE.md pass 2 (with Scott: which doctrines merge); INVENTORY-process items not yet exercised by a full cycle.
- ⏭️ **Next unit:** CLAUDE.md pass 2 in chat; re-cut this file after each lane closes a unit.

## 16. Not on the roadmap by decision — backlog §P11 (new verticals, design-only), §P12 (excluded), §P13 (decision forks)

Nothing here is built past the fork. Read §P13 before proposing work in any of these areas.

---

### How to keep this file honest

- A lane's line changes only after its backlog row changed; never the other way round.
- Every "✅ live" must be traceable to a merged PR **and** a measurement in STATUS or CURRENT-STATE. "Merged is not running" (edge functions v41/v25 were the lesson).
- If a category is missing, add it here **and** give its rows a backlog section — a lane that exists only in this file is the adjacency problem in a new coat.
