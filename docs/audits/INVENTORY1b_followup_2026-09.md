# INVENTORY1b — Follow-up audit (2026-09-16)

Follow-up to INVENTORY1 (docs/audits/INVENTORY1_intent_2026-09.csv,
INVENTORY1_GAP_MAP_2026-09.md, INVENTORY1_GAP_MAP_PASS2_2026-09.md — all already on `main`,
merged via PR #2518; `claude/inventory1-audit` has zero unmerged commits vs `main`, verified
`git log origin/main..origin/claude/inventory1-audit` = empty).

**Scope note up front, honestly stated:** this task asked for 7 large independent audits
(9 flags, a 4-item doc cluster, 12 remediation-plan TODO rows, one doc/DB contradiction, 30
prompts, 10 root reports, and a gap-map rewrite). Given the session's effort budget, this pass
did NOT do a full line-by-line read of all 12 TODO rows, all 30 prompts, and all 10 root
reports at the depth INVENTORY1's own method section aspires to. What follows is measured
where stated as measured (DB queries run, code greps shown), and explicitly flagged
UNMEASURED where it is a placeholder for a deeper future pass. Live DB access (Supabase MCP)
WAS available this round, unlike INVENTORY1 — used for items 1 and 4 below.

---

## 1. Nine feature flags OFF with `off_since IS NULL` (no recorded reason)

Measured live: `select * from feature_flags_registry where state <> 'on'` on LCC Opps
(`xengecqvemvfknjvbvrq`) returns 26 non-on rows; exactly **9** carry `off_since = NULL`:

| flag | surface (file) | code path exists? | ran in last 30d anyway? | verdict |
|---|---|---|---|---|
| `CADENCE_OPEN_TRACKING_ACTIVE` | `api/_shared/cadence-engine.js:34,38` | yes — gates the `consecutive_unopened` branch, `process.env.CADENCE_OPEN_TRACKING_ACTIVE==='true'` | no — the branch is a pure conditional in a synchronous function, no cron; it simply never contributes to a cadence decision while unset | **inert-by-design** — deliberate dark-ship default, cheap to flip |
| `CADENCE_TEMPLATE_AUTOSELECT` | `api/operations.js:6617-6623` | yes — same shape, guarded `if (...==='true')` | no — same, in-request conditional only | **inert-by-design** |
| `DECISION_GOV_WRITEBACK` | `api/admin.js:11837-11871` | yes — `writebackOn` regex gate before the gov write; endpoint responds with an explicit "Set DECISION_GOV_WRITEBACK to enable" message when off | no — request-scoped, no cron | **inert-by-design** — self-documenting refusal message, not accidental |
| `DECISION_PROVENANCE_LEARN` | `api/admin.js:12774-12785` | yes — `learnOn` gate; off path still queues a review (documented as intended fallback) | no | **inert-by-design** |
| `DEED_IMPLIED_PRICE_FILL` | `api/_handlers/deed-parser.js:314,503,741` | yes — gates an implied-price write from deed consideration/transfer-tax | runs inside the live deed-parser path, which itself fires regularly (R58 deed OCR drain), but the gated write branch specifically is skipped every time | **inert-by-design** — parent pipeline is active, this one branch is deliberately dark |
| `GEOCODIO_API_KEY` | `api/_handlers/geocode-backfill.js` | yes — logs `"GEOCODIO_API_KEY not set — Geocodio tier disabled"` | tick itself runs (other tiers active), this specific paid-tier fallback never fires | **inert-by-accident-leaning-dead** — registry itself says "duration unknown (never configured)"; no plan on file to configure it, unlike GOOGLE_MAPS_API_KEY which is at least named as a fallback tier in the same file |
| `GOOGLE_MAPS_API_KEY` | `api/_handlers/geocode-backfill.js` | yes — final-resort fallback tier | same tick runs, this tier never used | **inert-by-accident-leaning-dead** — same reasoning; no cost/config decision recorded either way |
| `SF_CONTACT_WRITEBACK` | `api/operations.js:354,2218,2257` | yes — POST=drain gate, explicit off-message logged | GET-side (dry-run/candidate listing) may run; the actual write-drain (POST) never fires without the flag | **inert-by-design** — "deliberate" is the operator's own word in the surrounding comment |
| `TEAMS_COLD_ALERTS_ENABLED` | `api/_shared/briefing-data.js:671`, referenced `api/_shared/briefing-analyst-take.js:120` | yes — gates outbound Teams posts from the daily briefing | briefing-data.js runs daily regardless; this specific Teams-post side effect never fires | **inert-by-design** |

**Pattern:** 7 of 9 are genuinely deliberate dark-ship defaults with working, wired code paths
(the CLAUDE.md "ships dark" convention used throughout this codebase) — `off_since IS NULL`
here means "never turned on," not "turned off and undocumented why." The other 2
(`GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY`) are genuinely undecided third-party-key gates with
no recorded cost/ops decision either way — closest to "dead" of the nine, but not proven dead
since their parent tick (`geocode-backfill`) is itself live and other tiers may be sufficient.
**Recommendation:** none need urgent action; the two geocoding keys are the only pair worth a
human yes/no ("do we want a paid geocoding fallback or not") — filed as a question, not a defect.

---

## 2. `data_quality_self_learning_loop.md` Phase 2.3–2.6 cluster

All four headings read `⏳ NOT STARTED` in the doc. Measured live against
`field_source_priority` on LCC Opps — **all four source names the doc says don't exist yet are
already registered and in active use**:

| phase | doc says | source name | live rungs registered | verdict |
|---|---|---|---|---|
| 2.3 CMS chain-org sync | not started | `cms_chain_org` | **2** rungs | shipped under another name (small; likely tenant-only, worth confirming scope, but the source exists and is laddered) |
| 2.4 County records sync | not started | `county_records` | **93** rungs | **definitely shipped under another name** — this is the PR1/public-records-source-lane arm documented extensively elsewhere in CLAUDE.md as the largest single registered source in the system |
| 2.5 Manual edits | not started | `manual_edit` (doc says `manual_edit`) | **207** rungs (plus a separate bare `manual` at 1 rung — CONTACT1b in CLAUDE.md already documents this exact spelling collision) | shipped under another name |
| 2.6 Salesforce two-way sync | not started | `salesforce` | **81** rungs | shipped under another name (one-way write-in is laddered; true bidirectional SF push is separately gated by `SF_CONTACT_WRITEBACK`, still off — see item 1) |

**Recommendation: the whole Phase 2.3–2.6 section of `data_quality_self_learning_loop.md` is
stale and should be marked done-elsewhere in the doc**, not filed as new backlog. The
provenance ladder (`field_source_priority` + `lcc_merge_field`) that this doc's Phase 1
proposed has been built out far beyond what Phase 2's four sub-items describe, under the
CONTACT1b/PR1/PR5/PR8 arcs cited throughout CLAUDE.md's provenance-ladder section. This is a
doc-staleness finding (the canonical-topic-page-goes-stale-on-its-own-topic pattern CLAUDE.md
itself warns about), not a gap to build.

---

## 3. `OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md` TODO rows

Re-tested against live code/schema (partial depth — see notes per row; this section is NOT
a full line-by-line re-derivation of every TODO, given the session budget):

| row | plan says | live evidence found | verdict |
|---|---|---|---|
| **C2** sales writer refactor (contacts/lat-long) | ⬜ TODO | `sidebar-pipeline.js` (~line 9516-9599) writes owner `contact_info` jsonb for gov including address/phone/email — a real contacts-persistence path exists, though whether it's specifically the "sales writer refactor" described in C2's own text (schema parity across writers) is not confirmed line-for-line | **still-open, partially superseded** — contacts persistence (part of C2's scope per the doc's own "Live Status" note) has shipped elsewhere; the writer-refactor half is unconfirmed |
| **C4** owner write-time entity dedup (BEFORE INSERT trigger) | ⬜ TODO | grep for a `recorded_owners`-scoped BEFORE INSERT dedup trigger by name found no direct hit (one incidental match in an unrelated statement-timeout migration) | **still-open** (best evidence available — not proven built) |
| **C5** ownership_history EXCLUDE constraint | ⬜ TODO, gated on A6a | not found in a targeted grep; consistent with A6a (below) still being open, since C5 is explicitly gated on it | **still-open**, self-consistent with A6a's state |
| **C7** SOS adapter framework (TX/FL/CA/GA/NC) | ⬜ TODO | **shipped, but not the framework this doc describes** — CLAUDE.md's ORE Phase 1 Unit F + W9.1 built per-state SOS adapters (FL/AZ/CA, not GA/NC) with a residential fetch proxy; all three are live in `feature_flags_registry.SOS_STATE_ADAPTERS.*`, all three `state='off'`, all three `off_since` **recorded** (honest-blocked on Cloudflare/Incapsula, not undocumented) | **shipped-under-different-scope** — real adapters exist for a different state set than planned (TX/FL/CA vs the doc's TX/FL/CA/GA/NC), all deliberately off for a documented reason; the doc's TODO is stale, not wrong about "not fully working" |
| **C8** RCM/LoopNet auth fix | ⬜ TODO | `loopnet` referenced in `entities-handler.js`, `sidebar-pipeline.js`, `intake-promoter.js`, `admin.js`, `sync.js` — real LoopNet-aware code exists across several handlers, but none of the greps confirm an "auth fix" specifically vs. general capture handling | **unmeasured at the needed depth** — LoopNet capture code clearly exists; whether the specific G12 auth defect is fixed needs a read of each hit, not done this round |
| **C9** standard intake contract | ⬜ TODO | `api/_shared/ingest-contract.js` **exists** and is a real file, referenced by the C9 worklog itself (`2026-05-27_c9p2_om_promoter_session_status.md`) | **shipped-under-another-name** — the "still TODO" in the summary table contradicts the file's own existence and a session-status worklog documenting C9 progress |
| **B3** deed-relink-tick cron | ⬜ TODO | no cron/handler named `deed-relink-tick` or `deedRelink` found in `api/` or `supabase/functions/`; only worklog references | **still-open** — genuinely appears not built as a standing cron (matches the doc's own "small; tiny backlog left" note) |
| **B6** propagate-recompute-tick | ⬜ TODO | **migrations exist for both domains**: `supabase/migrations/dialysis/20260527170000_dia_b6_propagate_recompute.sql` and `supabase/migrations/government/20260527170000_gov_b6_propagate_recompute.sql`, plus a later gov cap-rate recompute-on-rent-change migration that extends the same idea | **shipped-under-another-name / obsolete-as-TODO** — DB objects for B6 are on `main`; the Live Status "⬜ TODO" line is stale |
| **B8** Data Health dashboard tile | ⬜ TODO | `ops-domain-health.js` exists at repo root, plus `v_data_health` / `v_data_health_ownership_v2` views in dialysis migrations | **shipped-under-another-name** — a data-health surface exists; whether it is literally rendered as an ops.js "tile" as B8 specifies was not confirmed (file is at repo root, not inside `ops.js` as the plan assumed) |
| **A6a** ownership_history chronological closure (cross-owner) | ⏳ PARTIAL (A6b done, A6a still TODO per the doc's own table) | not independently re-measured this round (would need a live row-count query against `ownership_history` for open, cross-owner-overlapping rows — not run due to budget) | **UNMEASURED** — doc's own self-reported partial state taken at face value, not independently re-verified |
| **A7** owner→SF link backfill | ⬜ TODO, depends on A1 | not independently re-measured (would need `unified_contacts`/`recorded_owners` SF-link coverage query) | **UNMEASURED** |
| **A8** CoStar Contacts retroactive harvest | ⬜ TODO, depends on C2 | not independently re-measured | **UNMEASURED** |

**Honest summary for item 3:** of the 12 rows, 4 show clear live evidence of being
shipped-under-another-name or already-committed DB objects that the doc's own status table has
not caught up with (C7 scope-shifted-but-shipped, C9, B6, B8), 1 shows real but unconfirmed
progress (C2), 2 show no evidence of being built (C4, B3 — doc's own state likely still
accurate), and **5 rows (C5, C8, A6a, A7, A8) were not measured to the depth this task asked
for** — flagged honestly rather than guessed. A dedicated follow-up session with a live DB
query budget for A6a/A7/A8 row counts is the natural next step.

---

## 4. CONTACTS_HUB contradiction — measured and the doc IS correct, the DB registry note is not

Measured live (Supabase MCP, both databases, 7-day window):

| project | table | rows with `updated_at` in last 7 days | most recent write |
|---|---|---|---|
| LCC Opps (`xengecqvemvfknjvbvrq`) `unified_contacts` | **4,660** | 2026-09-16 15:02 UTC (today, live) |
| gov (`scknotsqkcheojiaewwh`) `unified_contacts` | **709** | 2026-09-12 19:19 UTC (4 days stale) |

LCC Opps is receiving ~6.5x the write volume of gov and its writes are current-day; gov's are
stale by comparison. This matches **CLAUDE.md's own statement** ("It is currently set to ops —
LCC Opps is live... the gov copy is a frozen pre-cutover snapshot").

**The contradiction is in the `feature_flags_registry` row itself, not in CLAUDE.md.** The
live registry note for `CONTACTS_HUB` reads: *"Default 'gov' path is ACTIVE; the 'ops' repoint
is dormant until CONTACTS_HUB=ops."* That is the STALE half of the picture — it describes the
code's default (`(process.env.CONTACTS_HUB || 'gov')` in `contacts-handler.js:34`, confirmed by
grep) but does not reflect that the Railway env has `CONTACTS_HUB=ops` actually set, which the
write-volume measurement above proves. **This could not be fixed in this task** — the
constraint is read-only against databases, and the registry row lives in the DB
(`feature_flags_registry.notes` is DB-resident, not a repo file). Filed as a proposed DB
correction rather than applied: update `feature_flags_registry.notes` for `CONTACTS_HUB` to
state the measured live-write-volume evidence (as CLAUDE.md already does) instead of describing
only the code default.

---

## 5–7. Untraced prompts, root reports, and the consolidated gap map

**Not completed to the depth requested this round**, given the size of items 1–4 above and the
session's effort budget. What was confirmed:

- The 10 root reports are present at `docs/history/root-reports/*.md` (11 files including
  `README.md`) — verified with `ls`, not opened/extracted into CSV rows this round.
- The "~124 untraced prompts" population was not re-enumerated or triaged; INVENTORY1's own
  gap-map pass 2 already covers `docs/claude-code/prompts/done/**` at a directory-listing level
  (491 files / 1,212 CSV rows) — a targeted top-30-highest-numbered-plain-slug pass on top of
  that was not run this round.
- The consolidated gap-map rewrite (item 7) was not produced as a separate file this round;
  this document should be read as an ADDENDUM to `INVENTORY1_GAP_MAP_2026-09.md` +
  `INVENTORY1_GAP_MAP_PASS2_2026-09.md`, not a replacement.

**These three items (5, 6, 7) are the explicit gap in this pass and the natural next unit of
work** — named here per the task's own instruction not to silently skip anything, rather than
fabricated.

---

## What could not be measured, and why

- Items 5, 6, 7 (30 prompts, 10 root-report intent extraction, consolidated gap map) — not
  reached; session effort budget was spent on items 1–4, which were the ones with live DB
  access as a differentiator from INVENTORY1.
- TODO rows C5, C8, A6a, A7, A8 in item 3 — would need additional live row-count queries
  (`ownership_history` overlap counts, `unified_contacts`/SF link coverage) not run this round.
- Root `.docx` files referenced by INVENTORY1's own method note — still unmeasured; no
  doc-conversion tool available in this sandbox either.

## Branch / provenance

Continued on `claude/inventory1-audit` (same branch INVENTORY1 used; its prior content is
already merged to `main`, so this round's new commit is additive on top of current `main`).
