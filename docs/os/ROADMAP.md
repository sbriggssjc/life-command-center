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

- ✅ **Live:** gov `latest_deed_*` split to deed-only with one writer (GOVDEED4/5/5b, gov PRs #400–#405); the 478 manufactured conflicts dispositioned (GOVDEED-478); Salesforce research lanes retired on both databases (C1C, ledgered, reversible); the gov gate on the right arm (C1B-GOV-GATE); **39 assessor-sourced owners written** — Philadelphia 20 (city open API), Harris 19 (HCAD bulk PDATA) — every one citing its source record (OWNERGAP2, -harris, -harris-b); `get_property_context` shows dia-only properties (MCP1).
- 🟡 **Partial:** Harris — the full HCAD roll is staged (71,282 F1/F2 accounts, 2026-09-16); 1 more owner is resolvable (H7), 2 sit on C2-class accounts (S5), and **27 of the 50 are house numbers HCAD does not carry as situs** — a property-identity gap (§P10a), not a matcher gap. The loader has three real defects found on the real file (OWNERGAP2-harris-c, prompted).
- 🔴 **Open:** GOVDEED3 (accept gate, handoff to `government-lease`), DEED1-reconcile-2 (migration in the wrong repo), DEED1-emptycompare, DEED1-rentrank, CANON-OWNERSHIP1 (👤 proposal ready), the `18003 Longenbaugh` Rd/Dr duplicate property surfaced by the Harris apply; 1,346 `owner_needs_sos` tasks still the feed with no other consumer.
- ⏭️ **Next unit:** H7 (apply the 1) and OWNERGAP2-harris-c (loader fixes + C2 switch + placeholder refusal); then the next free-bulk jurisdiction from OWNERGAP1-decision's list, same contract. The 27 situs-gap properties are the first concrete case for §P10a.
- 👤 **Decisions:** S5 (may a C2-class HCAD account resolve on an exact situs match?); CANON-OWNERSHIP1 (who owns Dialysis_DB's schema in `CLAUDE.md`).

## 2. Entity identity at the source of record (ID-series) — backlog §P0d, Open-threads *Identity / operator canonicalization* and *gov agency canonicalization*

- ✅ **Live:** ID2b/ID2b-caps/-caps-2 (operator canonicalization, third comp source fixed at source); ID3a–ID3e (gov agency canonicalization, live-verified); the repo-ownership hazard I16 closed (gov migrations belong to `government-lease`).
- 🔴 **Open:** ID3d guarantor-registry wiring (prompt in `prompts/`, 🟡); ID3a-drift (the Home gaps widget reads a column ID3a's fold never writes — §P20).
- ⏭️ **Next unit:** ID3d when a CC slot opens; ID3a-drift rides with HOME2.

## 3. Domain truth, sponsors and SPEs (C2 series) — backlog §P0d, Open-threads *C2g / sponsor↔SPE gate*

- ✅ **Live:** C2k attested-only widening (LCC PR #2506): 218 supersessions, 40/43 pairs to sponsor, controls untouched, reversible.
- 📐 **Designed:** sponsor-as-edge (C2h/C2i) — future work, nothing authorized.
- ⏭️ **Next unit:** none queued; re-open when the gov side exposes more attested rows.

## 4. BD pipeline funnel & operator funnel — backlog §P0b, §HP1, Open-threads *Operator funnel*

- ✅ **Live:** HP1 Today-500 badge; HP1-P1a-fix (608 `bd_opportunities` rows updated in Salesforce — the first LCC→SF UPDATE); BROKER1 prospect assignment (1,303 assigned).
- 🟡 **Partial:** the funnel itself — the 2026-08-28 audit measured 1.1% of gov properties with 2+ historical owner links; the rows in §P0b are the ladder from there.
- 🔴 **Open:** the §P0b rows (re-measure before acting; the audit is three weeks old); BROKER1-sf (SF write-back) deliberately unbuilt; BR1 firm-registry repair (prompt in `prompts/`).
- ⏭️ **Next unit:** BR1 when a CC slot opens; otherwise this lane advances through lanes 1–3.

## 5. App surfaces — Home, Priority, Dialysis Overview, review workbench — backlog §P20, §P16, §HP1, Open-threads *App feedback intake (SBN)* and *App / UX*

- ✅ **Live:** `daily-briefing` edge fn v26 (HOME1-deploy); DIA1/DIA1b (tiles verified, NPI tile → lane count, "as of"); PRI1 (bands explained); the SB-notes intake loop (`docs/claude-code/SB notes/`, `TRIAGE.md` SBN-1…11) — Scott's in-app observations become rows within a turn.
- 🟡 **Partial:** PRI2 (Priority recomposed on `v_lcc_seller_prospect_queue`) built, **flag OFF** pending S1; HOME1 (§C fix live, §B three-lane spec unbuilt); ASC50 review workbench built and locally verified, publication pending.
- 🔴 **Open:** HOME2 (three-lane Home, after PRI2), ID3a-drift, DIA1b-operators (S2).
- ⏭️ **Next unit:** the PRI2 side-by-side (`docs/audits/PRI2_SIDE_BY_SIDE_2026-09.md`) so S1 can be decided on evidence; then HOME2.
- 👤 **Decisions:** S1 PRI2 flag ON; S2 what "Operators tracked" shows (45 names vs 21 ids).

## 6. Flows, intake and artifact health (Power Automate ↔ LCC) — backlog §P20, `docs/setup/POWER-AUTOMATE-FLOW-FIXES-2026-09-16.md`

- ✅ **Live:** F1–F7 applied by Scott and verified from his exports; F1c (Get Artifact: metadata first, size condition, bytes for small files) verified; LCC accepts both Get-Artifact shapes and treats `too_large` as a named terminal reason with a 30-day ceiling instead of ~48 retries (FLOWS1-artifact); FLOWS1-order **refuted** — LCC does not relay the move.
- 🟡 **Partial:** the digest has not yet cycled since the fixes — the Saturday "N flows have failed" mail into `SB notes/` is the verification.
- 🔴 **Open:** FLOWS1-path (stale SharePoint deal-folder path writer), FLOWS1-artifact-b (size-aware skip at discovery, real backoff — low), F6 durable async version (needs an LCC callback route).
- ⏭️ **Next unit:** triage the next digest against F1–F7; then S4.
- 👤 **Decisions:** S4 FLOWS-consolidate — two flows on one "email flagged" trigger (which one owns the move).

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

- ✅ **Live:** the DEPLOY2 unapplied-migration detector (its first real catch was C1C-UNAPPLIED); doc guards in CI (STATUS header/line budget, backlog ID uniqueness, table shape).
- 🔴 **Open:** REMEDIATION-2026-05 (the May TODOs, now rows, DB-verified); §P10 sized unfixed defects; MISPARSE1 (email fan-out blocking real brokers — prompt in `prompts/`); the Longenbaugh duplicate (lane 1).
- 📐 **Designed:** cross-lane property identity / address resolution (§P10a) — the Harris street-shape bugs are the same class, solved lane-locally again.
- ⏭️ **Next unit:** MISPARSE1 when a CC slot opens.

## 13. Consumption layer & multi-party ownership — backlog §P1a, §P1b, §P1c

- 🟡 **Partial:** §P1a is no longer the top priority (superseded by C2g/C2k); §P1b repairs are owned by the automation chat; §P1c JV/fund structures designed only.
- ⏭️ **Next unit:** none here until lanes 1–3 settle what an owner *is*.

## 14. Security & hygiene — backlog §P0s, §P9

- 👤 **Decided:** credential rotation deferred until a second user is added (recorded risk acceptance with a trigger, 2026-08-29).
- 🔴 **Open:** §P9 rows, by design at the end; FLAGS-geocode (S3 — two geocoding keys OFF with no recorded reason).

## 15. Process, documentation & consolidation — backlog §P21, `docs/os/BUILD-TURN-PROTOCOL.md`, `docs/claude-code/README.md`

- ✅ **Live:** the prompt → response → reconcile loop with STATUS/backlog/CURRENT-STATE kept current each turn; SB-notes intake (④); leak-class rules (⑤); INVENTORY1/1b done; CLAUDE.md pass 1 (5,503 → 3,268 lines, rounds archived verbatim); backlog regrouped by category (P19/P20/P21); this file.
- 🔴 **Open:** CLAUDE.md pass 2 (with Scott: which doctrines merge); INVENTORY-process items not yet exercised by a full cycle.
- ⏭️ **Next unit:** CLAUDE.md pass 2 in chat; re-cut this file after each lane closes a unit.

## 16. Not on the roadmap by decision — backlog §P11 (new verticals, design-only), §P12 (excluded), §P13 (decision forks)

Nothing here is built past the fork. Read §P13 before proposing work in any of these areas.

---

### How to keep this file honest

- A lane's line changes only after its backlog row changed; never the other way round.
- Every "✅ live" must be traceable to a merged PR **and** a measurement in STATUS or CURRENT-STATE. "Merged is not running" (edge functions v41/v25 were the lesson).
- If a category is missing, add it here **and** give its rows a backlog section — a lane that exists only in this file is the adjacency problem in a new coat.
