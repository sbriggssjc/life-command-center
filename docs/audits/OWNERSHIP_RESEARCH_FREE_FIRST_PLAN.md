# Ownership Research — Free-First Plan (W1.4 resolution)
**Date:** 2026-07-29 · **Status:** Recommended, pending Scott approval · **Home:** docs/audits/
**Question answered:** Can we resolve the LLC-ownership backlog with free public resources (as the pre-LCC manual process did), and where — if anywhere — does OpenCorporates still earn a place?

## 1. Grounding (verified live + from repo history)

**The backlog:** 2,043 deferred LLC-research rows (dia 1,158 / gov 885), 0 queued, 0 failed. 692 have no known state. FL = 0 (already drained by the Sunbiz mirror).

**What already-ingested data covers (live cross-match, exact normalized names):** gov: 66/885 match `entity_registry_records` (only 17 with agent/manager data — the AI-inference era left ~79% of that table empty), 57 are GSA lessors by name, 1 matches local `sam_entities`. dia: 10/1,158 match the registry, 0 parcel mailing matches (the county mailing-address gap). Net: existing tables alone close <10%.

**The decisive gov-side fact:** 380 of 885 gov deferred rows sit on properties with GSA leases. GSA lessors must hold an active SAM.gov registration to be paid rent. The SAM Entity Management API is FREE (api.data.gov key), returns legal name, physical/mailing addresses, and named points of contact. **This machinery is already built** — the `sam-entity-lookup` edge function (healthy, KEEP per EDGE_FUNCTION_AUDIT) and `sam_propagate_to_owners()` (cron `45 */2`, first run produced 210 contacts + 126 owner addresses) — it is simply **underfed**: its candidate query never iterates the owner universe (documented in SPEC_owner_data_ingestion_2026-05-21.md with the prescribed fix). Caveat: POC email/phone are often null in SAM; names + addresses still feed the cross-reference resolver.

**Why SOS automation stalled (from ORE_REALIGNMENT_first_principles_2026-07-15.md and the C7 status):** not code — **egress**. Datacenter IPs (CI sandbox and GitHub runners) are 403-blocked by TX/FL/CA/GA/NC SOS sites; AZ blocked the GitHub runner on all 24 rows of the one live dry-run. The AI-inference workaround (`public_record_ingest.py` asking an LLM to guess managers without fetching) produced managers on only ~21% of registry rows and is why `sos_direct` (verified) now outranks inferred data. Also standing decisions to respect: web-search proxy is PAUSED (do not re-raise); free SOS-direct preferred over paid (CLAUDE.md:613).

**What DID survive contact with reality:** (1) the FL Sunbiz bulk-mirror (end-to-end, cron-linked); (2) the **sidebar human loop** — all 50 states day one, human-as-parser, writes manager/agent/filing + append-only address observations via `/api/sos-writeback`, auto-retires the queue row. Its two frictions have written fix specs: the extension host-permission bug (`CLAUDECODE_PROMPT_sos_scan_permission.md` — scans fail from the side panel without `optional_host_permissions` + a runtime request) and click count (`CLAUDECODE_PROMPT_sos_rapid_ingest.md` — copy-name button, auto-advance to next owner in-state, always-editable form; Scott's words: "truly just clicking our way through ingestion as rapidly and efficiently as we can"). Plus the worklist front-door fix (persistent button on the Property tab).

**The tier the SOS can't solve:** institutional SPEs (~345 contactless owners ≥$1M) — their SOS "manager" is a law firm or agent service. Doctrine (ORE realignment): route Tier A to sponsor-resolution + the curated `lcc_institution_contacts` registry; only Tier B (local/operating owners) goes through county+SOS. The archetype router (`v_owner_archetype`) exists.

## 2. The recommendation — five free lanes, then re-price OpenCorporates

**Lane 1 — SAM feed widening (gov; free; automated; highest certainty).** Point `sam-entity-lookup`'s candidate query at every gov recorded/true owner lacking a SAM match, value-ranked, GSA-lessor rows first (the 380). At the existing 50-per-2h cadence the lessor cohort drains in ~2 days. Expected yield: a large majority of the 380 (federal lessors are near-universally registered), each closing its queue row via the existing propagator.

**Lane 2 — County mailing-address capture (both; free; already planned as W3.1).** The near-free win the 07-14 audit identified: 9,541 parcels already fetched, 7 with mailing addresses — the scraper never grabbed the column. This is Scott's manual step #1 and fuels the ORE's second-strongest evidence signal. No new credentials.

**Lane 3 — Sidebar rapid-ingest (all 50 states; free; human ~30–60s/owner).** Ship the three written specs (host-permission fix, rapid-ingest UX, worklist front door). The worklist is already value-ranked with two-jurisdiction chips. At even 40 owners/session, the ~1,350 known-state rows are a few weeks of short sessions — and every capture is *verified* data at trust-tier 15, above everything the sidebar otherwise writes. This IS the pre-LCC manual process, minus retyping.

**Lane 4 — Bulk-mirror expansion (free; automated; per-state).** Clone the proven FL pattern (bulk file → mirror table → nightly enrich-link) for states that publish free bulk entity data. Candidates by queue volume: CA 181, TX 144, GA 85, IL 59+, NC 50+, VA 33, AZ 33, NY 26, CO 20. Availability must be **verified during build** (from a residential-egress machine): known-promising = CO (state open-data portal), NY (open-data active corps — names/agents, no officers), NC and VA (both have published data-download programs), TX via the **Comptroller franchise-tax datasets** (free; taxpayer names + addresses; officer/director data via free per-entity Public Information Report search — bulk officers is the paid SOSDirect product), WA/OH also publish. CA/GA/IL/AZ likely have no free bulk → those states stay on Lane 3 (sidebar). Rule from FL: verify field formats against real data before enabling; never live-scrape search pages from datacenter IPs.
  *Note on OK:* not in the top backlog states, but as the home market it's worth a one-time availability check in the same session.

**Lane 5 — Institution registry seeding (Tier A; free; operator-curated).** Work `v_institution_registry_gaps` top-down: one sponsor contact fans out across all of that sponsor's SPEs. This attacks the ≥$1M contactless tail that no SOS lookup will ever crack.

**Then OpenCorporates, re-priced by residue.** After Lanes 1–4 run for ~30 days, the paid case shrinks to: unknown-state rows still unresolved by cross-reference (≤692) + known-state rows in no-free-bulk states not yet hand-cleared. If that residue still matters commercially, one paid month clears it via API (name+jurisdiction → officers) and then lapses. Decision deferred to ~Aug 28 with real numbers. This honors the standing "free SOS-direct over paid" preference while keeping the escape hatch.

**Explicitly NOT recommended:** provisioning the web-search proxy (paused by standing decision); resuming datacenter-IP scraping of SOS search pages (blocked, non-compliant with the repo's own fetcher discipline); LLM-inferred managers (the 21% debacle — verified-or-nothing).

## 3. Sequencing & ownership

| # | Lane | Runs as | When |
|---|---|---|---|
| 1 | SAM feed widening | Code session (gov project; small candidate-query change + verify cron drain) | Now — replaces the "W1.4 code half" |
| 2 | Sidebar rapid-ingest bundle (3 specs) | Code session (extension repo + LCC worklist) | Now, parallel |
| 3 | County mailing capture | Already W3.1 (GovernmentProject) | Wave 3 as planned (or pull forward) |
| 4 | Bulk-mirror expansion + per-state availability verification | Code session run FROM Scott's machine (residential egress) | After 1–2 |
| 5 | Institution registry seeding | Scott, 15 min/week from the gaps view | Ongoing |
| 6 | OpenCorporates re-decision | Cowork (residue count + per-row value) | ~Aug 28 |

W1.4 is hereby redefined: "requeue FL" (done, no-op) + Lanes 1–2 as the code half. Tracker updated accordingly.
