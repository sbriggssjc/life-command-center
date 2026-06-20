# Activation Runbook — switching on the R46→R56 build arc (2026-06-20)

The build side is done and DB-verified; the value is realized by activating it. Work top-down —
phases are ordered by dependency. Each item: **what · why · do · verify**. "Flag" = an environment
variable; the location (Railway = LCC app; GovernmentProject env = the gov Python pipeline) is
noted per flag. Nothing here is destructive without a dry-run first.

---

## Phase 0 — merge + redeploy the open branches (unblocks the JS-dependent items)
Already merged/deployed earlier: R46–R51, and R52/R53/R54 (you confirmed). **Still open:**
- **R55** — LCC #1264, gov #291, dia #7307 (the `bd_worklist` + `activation_review` endpoints +
  the corrected owner-deed autofix). JS — needs the Railway redeploy to be callable.
- **R56** — LCC #1267, gov #292, dia #7308 (feed-freshness monitor). Pure DB, already live; the
  merge is just source-of-truth, no redeploy needed for behavior.

**Do:** merge the R55 three + R56 three; redeploy Railway for R55.
**Verify:** `GET /api/operations?action=bd_worklist&summary=1` returns counts; `GET
/api/admin?_route=...activation_review` responds.

---

## Phase 1 — operational catch-ups (no flags; clear the monitor alerts + unblock signals)

### 1a. GSA diff catch-up (HIGH — unblocks R53's suspected sales + clears a feed_stale alert)
**Why:** `gsa_lease_events` stuck at 2026-03-01; it's the feed under R53's lessor-change suspected
sales. Snapshots are current through 06-01.
**Do:** in GovernmentProject, run the three Mar→Jun pairs per `docs/RUNBOOK_gsa_monthly_diff.md`:
`python -m src.gsa_monthly_diff --diff 2026-03-01 2026-04-01`, then `…04-01 05-01`, then `…05-01
06-01`. Then ensure the diff step runs with each monthly snapshot ingest going forward.
**Verify:** `v_feed_freshness` row for `gsa_lease_events` flips `is_stale=false`; `v_gsa_lessor_change`
/ `v_suspected_sale` pick up new leads; the `feed_stale` alert auto-resolves.

### 1b. OPM workforce re-run (LOW — clears the other feed_stale alert)
**Why:** `opm_agency_location_rollups` stuck at January (170d). Manual FedScope feed.
**Do:** download the latest FedScope employment cube, then `python -m src.ingest_opm_workforce
--path "<file>"` (dry-run first with `--dry-run`).
**Verify:** the `opm_workforce` `feed_stale` alert auto-resolves.

### 1c. Apply R49 v3 to gov (HIGH — the one silent deploy gap; prerequisite for v3 review/flip)
**Why:** gov `investment_scores` has **0 v3 columns** — the v3 migration + scorer never landed, so
the risk-aware grade can't be computed *or* reviewed.
**Do:** apply `sql/20260620_gov_r49_investment_scores_v3.sql` to the live gov DB, then run the v3
scorer (the GovernmentProject investment scorer with the v3 model — Claude Code can give the exact
invocation). This computes v3 **alongside** v2; it does NOT change `deal_grade` yet.
**Verify:** `information_schema` shows the v3 columns; `?action=activation_review` (r49) now returns
a real v2-vs-v3 diff instead of the precondition message.

---

## Phase 2 — gated flags (review the dry-run first, THEN flip)
Order doesn't matter between these, but each has a review-first step. Flip = set the env var; revert
= delete it.

### 2a. `DECISION_OWNER_DEED_WINS` (Railway/LCC) — R51 owner-deed bulk autofix (NOW SAFE)
**Why:** R55 corrected the auto-subset (gov 219→40; rebrand traps excluded; survivors are real
recent transfers).
**Do:** `GET /api/admin?_route=owner-deed-autofix` (dry-run) → eyeball the 40 → set
`DECISION_OWNER_DEED_WINS=on` → `POST` the same route to apply. Per-row lane verdicts work without
the flag.
**Verify:** the 40 rows' `recorded_owner` updated to the deed grantee; R47 parent re-resolved; the
conflict count drops.

### 2b. `SCORING_MODEL_ACTIVE=v3` (GovernmentProject env) — R49 risk-aware grade
**Depends on 1c.** **Do:** after 1c, review the v2-vs-v3 diff (`?action=activation_review` r49 —
who downgrades, esp. high-risk/footprint-reduction props that *should* drop) → set
`SCORING_MODEL_ACTIVE=v3` → re-run the scorer so `deal_grade` repopulates on v3.
**Verify:** `deal_grade` reflects v3; risk-elevated properties score lower (the R49 backwards
correlation gone).

### 2c. `SF_CONTACT_WRITEBACK` (Railway/LCC) — R52 contact writeback
**Depends on a PA flow.** **Do:** wire the `upsert_contact` Power Automate flow (mirror
`create_opportunity`), set its URL env + `SF_CONTACT_WRITEBACK=on`, then `GET` the
contact-writeback dry-run → small batch via the worker → confirm contacts appear in Salesforce with
**no dupes** (upsert-by-email). 1,166 candidates queued, value-ranked.
**Verify:** SF Contact identity coverage rises; no duplicate SF Contacts; reversible via the
`r52_contact_writeback` batch tag.

### 2d. `DECISION_DEVELOPER_WRITEBACK` (Railway/LCC) — R46 gov developer write-back
**Do:** eyeball a couple of `set_developer`/`confirm_developer` dry-run previews in the
ownership-chain lane → set the flag → the gov developer write-back engages (fill-blanks, reversible).
**Verify:** a confirmed developer lands on `properties.developer` with manual/90 provenance.

### 2e. (Optional, your call) earlier-round flags still open
`CADENCE_TEMPLATE_AUTOSELECT` (after template send-stats accrue), `DECISION_PROVENANCE_LEARN`
(registry learning), `CM_CANONICAL_FILTERS=1` (R36 CM cutover — time with marketing, after a
before/after). All Railway/LCC. Leave off until you want them.

---

## Phase 3 — work the unified worklist (the daily driver)
**Do:** open the **Top BD actions** surface (R55 `bd_worklist`) and work top-down by value. It
merges: loan maturities (172), suspected sales (784), owner conflicts (61), contact-writeback
(1,170), ownership chains (3,445). Top items: $62M LCOR Alexandria suspected sale, $26M USPS, $24M
USGBF maturity. The per-row lanes (suspected-sale `confirm_sale`, owner-conflict `accept_deed`,
maturity `pursue_refi`/`pursue_disposition`) are all safe to work now.

---

## Standing items (not blocking)
- Rotate `SAM_API_KEY` (already renewed for ingest) + `GEOCODIO_API_KEY` in the GitHub Production
  env when convenient.
- The feed-freshness monitor (R56) will keep surfacing `gsa_lease_events` + `opm` in the daily
  briefing until 1a/1b are done — that's it working as intended.

## Why this order
JS-dependent surfaces need Phase 0. R49's flag (2b) can't be reviewed until its migration lands
(1c). Everything else is review-then-flip, independent. Work Phase 3 in parallel — the worklist is
usable now for the safe per-row actions even before the bulk flags flip.
