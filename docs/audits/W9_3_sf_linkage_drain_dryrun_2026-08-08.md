# W9.3 — SF linkage drain + live re-score — dry-run sheet (2026-08-08)

**Unit:** Wave 9 (data connectedness), unit 3 (Prompt 90). **Flags:** `W9_3_SF_ASSIST`,
`W9_3_RESCORE`, `W9_3_DONOR_HANDOFF` (all OFF). **Routes:** `/api/sf-link-assist-tick`,
`/api/sf-link-rescore-tick`, `/api/sf-donor-handoff-tick`. **Migrations (applied live):**
`20260827120000_lcc_w9_3_sf_linkage_drain.sql` (LCC Opps `xengecqvemvfknjvbvrq`) +
`government/` + `dialysis/` `20260827120000_*_w9_3_rescore_and_donor_ledgers.sql`.

W9.3 unlocks W9.2's input-starved donor pool. W9.2 shipped correctly but both arms are starved:
owner contacts don't appear in intake docs, and only ~20 blank contacts carry an SF identity key.
SF is where the emails/phones already live; **linkage is the unlock.**

## The backlog (grounded live 2026-08-08)

| Table | gov | dia | note |
|---|---|---|---|
| `sf_link_research_queue` no_match | **21,499** | **2,361** | judged vs the STALE local registry at W4.3 (2026-07-31) |
| needs_review (the assist-ranked review lane) | 2,981 | 376 | ~3.3k human-review pool |
| linked | 3,125 | 369 | |
| SF-account registry (external_identities salesforce/Account) | — | — | **16,210** (was 15,987 at W4.3 → **+223 new** accounts to re-score against) |

## WS1 — assist pre-rank on the review lane (annotation-only)

The `sf_link_candidate` lane is mint-at-verdict, so — per the prompt-80 pattern — the assist is
stored in `lcc_clean_assist_proposals` (source `w9_3_sf_assist`, the federated-lane assist store the
lane already renders + attaches), **never a verdict**. A nightly bounded (~20) resumable Ollama pass
ranks each candidate owner↔SF-account pair `merge`/`not`/`uncertain` + confidence + one-line evidence.
The lane then sorts **easy-first** (`attachSfLinkAssist` → `sfAssistSortKey`: decisive high-confidence
first), a one-click "assist agrees" rides the existing verdict path, and each human verdict
self-measures agree/disagree into `v_lcc_w9_3_sf_assist_accuracy` (U4). Structural guarantee: the
assist tick writes only `lcc_clean_assist_proposals` — it never PATCHes the queue and never writes
`entity_match_labels` (proven by the `annotation-never-verdict` test).

- **Model dry-run** (`GET /api/sf-link-assist-tick?score=1`) runs post-deploy (needs Ollama egress);
  the ranking sample is reviewed before the flag flips.

## WS2 — live re-score of the no_match backlog (bands 0.9/0.1, conservative)

No JS Fellegi-Sunter math exists in the repo (W4.3 scored offline; the scorer was never committed),
and porting libpostal to JS was measured to drift the bands. Every W4.3 auto-link was in practice an
**exact/near-exact name match** (P≥0.98929). So the re-score reproduces that conservative tier
**deterministically**: exact clean-name **unique** → auto_link (0.99, splink_v2 provenance); exact
clean **ambiguous** or **core-only** (legal-form-stripped) → needs_review (assist-ranked lane); else
no_match. Auto-link is **null-guarded** (a different pre-existing id → conflict → review, never an
overwrite). Resumable via `score_resolved` (a re-scored row gets a score and drops out of the cursor);
reversible via `w9_3_rescore_log` + batch tag `w9_3_splink_v2_<date>_refreshed_registry`.

**Projected match report (live probe, top-200 highest-priority gov no_match names vs the current
16,210-account registry, planner-identical normalization):**

| outcome | count / 162 distinct | rate |
|---|---|---|
| exact clean-name UNIQUE → **auto_link** | **5** | ~3% |
| exact clean AMBIGUOUS → needs_review | 0 | 0% |
| no exact-clean match | 157 | 97% |

The gate is conservative as designed — e.g. `postal realty trust` uniquely resolves to its SF account
(sane); well-known REITs that aren't a unique clean hit are NOT force-linked. ~3% of the
highest-value slice newly auto-links; the rate tapers down-list. The full live report is
`GET /api/sf-link-rescore-tick?score=1` post-deploy. (Core-tier near-exact adds further needs_review
candidates on top of the exact-clean count above.)

**Registry-refresh note:** the registry is live-synced (`external_identities` salesforce/Account, last
Account 2026-08-07), already grown +223 since W4.3 — the re-score reads the CURRENT registry each run,
so it does NOT need `sf-account-import` re-run first; widening the synced set later only increases yield.

## WS3 — donor handoff (account→contacts expansion; the acceptance metric)

W9.2's deterministic donor arm keys on the **person-level** `contacts.sf_contact_id`; W4.3/W9.3 land
the **org-level** owner `sf_account_id`/`sf_company_id`. A direct copy is semantically invalid
(account ≠ person). The handoff enumerates a linked account's SF contacts from the local bridge
(gov `sf_contacts_import` 34,002 rows / dia `salesforce_contacts` 5,002 rows), **unique** name-matches
them against the owner's blank domain contacts, and **fill-blanks** stamps the real `sf_contact_id`
(provenance `sf_account_contact_expansion`, reversible `w9_3_donor_handoff_log`). Ambiguous name
matches are skipped (never guessed); an existing key is never overwritten; nothing is fabricated.

**Acceptance metric — blank-reachability contacts carrying an SF key (baseline + addressable pool, live):**

| domain | blank contacts (no email/phone) | **carry an SF key (baseline)** | blank contacts already under an SF-LINKED owner (addressable now) |
|---|---|---|---|
| gov | 10,542 | **5** | **1,813** |
| dia | 4,234 | **15** | **492** |
| **total** | 14,776 | **20** | **2,305** |

The baseline (**20**) matches W9.2's dry-run. **2,305** blank contacts already sit under an
already-SF-linked owner **today** — the pool the donor handoff name-matches into on the first runs,
BEFORE the re-score lands any new owner links. As WS2 auto-links more owners, this pool (and the SF-key
count) grows. `v_lcc_w9_3_donor_coverage` trends the metric per run; **this number RISING is W9.2's
unlock** — when it crosses a useful threshold, Cowork flips `W9_2_REACHABILITY_HARVEST`.

## Operator steps before the flags flip (the gate)

1. Redeploy Railway (merged `main`) so the three routes + the lane assist-sort ship.
2. `GET /api/sf-link-rescore-tick` → confirm backlog (gov 21,499 / dia 2,361) + registry_size (16,210);
   `?score=1` → review the projected auto_link/needs_review sample (exact-unique only auto-links).
3. `GET /api/sf-donor-handoff-tick` → confirm the coverage baseline (gov 5 / dia 15) + addressable
   pool; `?score=1` → review would-stamp sample (each a unique name match under a linked account).
4. `GET /api/sf-link-assist-tick?score=1` → review the Ollama ranking sample (sane merge/not/uncertain).
5. Flip the three flags → `on`. Nightly crons drain: assist 04:50, re-score 05:10, donor 05:30 UTC
   (after the W8/W9.2 chain; each no-ops while OFF). Every re-score auto-link is null-guarded +
   splink_v2-provenanced + reversible; every donor stamp is fill-blanks + reversible; every review-lane
   verdict stays a HUMAN decision.

## Boundaries verified

- SF stays minimum-necessary (no writes to SF; account = org-edge on persons). All writes are additive,
  fill-blanks, provenance-tagged, reversible (ledgers + batch tags), idempotent, dry-run-able.
- `v_field_provenance_unranked` unchanged at its pre-existing backlog (33, none of them W9.3 sources) —
  splink_v2 + sf_account_contact_expansion are registered fsp citizens and preserved by the flush.
- Flags OFF ⇒ every tick no-ops. Tests: `test/w9-3-sf-linkage.test.mjs` (44 pass) — band conservatism
  (auto-link ONLY on exact-unique), annotation-never-verdict, donor propagation, ledger reversibility.
