# LCC Dead-End Audit (2026-06-06)

Systematic hunt for places a workflow stalls with no way forward: stub
handlers, terminal states without recourse, toast-without-advance, silent
empties, retry loops. Method: static sweep (Explore agent over all frontend
JS) + live walk of every surface + Scott's live finds while working the lanes.

## RESOLVED during the audit (found → fixed → deploy-verified same day)

| # | Dead end | Fix |
|---|---|---|
| R1 | SF-mapping card: one failed search → only "Hold" | Candidate list (top-12 even below threshold), editable query, paste-ID/URL path (PR #1068) |
| R2 | Mapped card stayed rendered (tiny ✓, no clear) | Card collapses, count decrements, next card pulls up — all lanes |
| R3 | Lane inputs invisible (light-on-light) | `.dcsf-input` on theme tokens |
| R4 | P-BUYER post-open dead badge ("✓ open · SF mapped", no CTA) | Contact step: "Select prospecting contact →" → buy-side cadence (`phase='buy_side'`, `lcc_seed_buyer_cadence`) |
| R5 | Contact picker: 18 junk "persons" (capture artifacts), silent-empty SF section | `isImplausiblePersonName` at the writer; 1,009 mistyped persons flagged → junk lane (41→1,050); honest `sf_status`; picker filters |
| R6 | LLC tick 23514 storm (32.5k write failures, 96 retries/row) | CHECK widened (+deferred,+dead), stranded rows parked, `LLC_MAX_ATTEMPTS=8` dead-letter, honest Ops Health 24h + spike alerts |
| R7 | Resolver mis-parented Boyd→NGP (wrong-account opp) | parent_self precedence; 0 mis-resolving parents (was 3) |

Verified post-deploy: write-failure storm halted (residual tail only), LLC
queue in honest states (1,153 queued / 99 deferred / 4 done…), Boyd picker
clean (`sf_status: unavailable`, 0 junk), 2 spike alerts open + watching.

## OPEN — the fix-round backlog (prompt: CLAUDECODE_PROMPT_DEADENDS_round1.md)

**A. Flow gaps (machinery exists, hand-off missing)**
1. Intake card "No matched property" → toast only. The F4 create-property
   machinery exists; the card should offer "Create property →" / "Search to
   match →" (app.js Live Ingest ~660-700).
2. "No document linked to this listing" → toast only; no upload/link path
   (app.js ~481).
3. `prompt()` dialog class: implausible-value Correct, junk Rename/Merge-into,
   true-owner stale-new-owner — native prompts, no context/validation →
   inline forms in the card.
4. Log & Reschedule: two sequential POSTs; partial failure invisible (call
   logged, follow-up silently not scheduled) — per-step feedback + retry of
   the failed step only (detail.js ~5525).
5. Sync Health: disconnected connector's only CTA is "Sync Now" — needs
   Reconnect path; also an apparent duplicate outlook connector row.

**B. Honest/ergonomic states**
6. Entities page header "All (25)" — fetch limit presented as universe
   (R4-B class); needs true counts + pagination/search framing.
7. Widget/page error states: Retry re-runs the same failing call with no
   error detail and no alternative — standardize (retry + status detail +
   reload guidance); applies to queue widgets, gov/dia page-level failures,
   live-ingest "Search error".
8. SF activity log success: toast only — feed doesn't refresh, form doesn't
   clear (toast-without-advance sibling, app.js ~5410).
9. Junk lane at 1,050 rows: needs bucket bulk-verdicts with preview
   ("retype all `by <brokerage>` strings", "merge all `<Parent> JV/Fund/CMBS`
   into parent") — one-by-one is unworkable at this volume.
10. detail-open race: `typeof showDetail !== 'function'` → "Detail panel
    unavailable" toast (script load order) — readiness queue or load-order fix
    (ops.js ~2712).

**C. Polish (real but small)**
11. "No sale recorded" passive note → "Add first sale →" (machinery exists).
12. Excel export CDN race → retry/lazy-load/CSV fallback.
13. "Nothing awaiting confirmation 🎉" → point at the next queue.
14. Team Queue flag-off message → admin enable path (conditional surface).
15. Contacts list "? / —" rendering for unnamed contacts.
16. Consolidate modal: explicit "Not a duplicate / close" semantics.

**D. Data (carried)**
17. Duplicate sale `activity_events` (~1s apart, same sale) — dedupe at writer
    or view.
18. `sf_comps_staging` null-`import_batch` write failures (surfaced by the new
    spike alert — lower-volume offender).

**External (Scott's side, tracked)**
19. Power Automate flow op `find_contacts_by_account` — spec delivered; once
    live, the buyer contact picker fills from SF.

**False positives from the static sweep (verified fine live):** junk lane
renders all four verdicts; Team Queue enabled for this workspace (renders 100
items); SOS research queue has working actions (Open SoS / Mark found / No
match).
