# P182 — the silent-disconnection sweep (2026-08-26)

> Ran the Class 9 / Class 10 / Class 8 detectors from
> [`DEAD_END_AUDIT_PLAYBOOK.md`](DEAD_END_AUDIT_PLAYBOOK.md), plus the flow
> landing-side audit. **Four genuine defects, six documented non-issues, one
> regression check clean.**
>
> The highest-value finding is not in the data — it is that **the Class 10
> detector as published could never fire**, and reported a clean bill of health
> over 210 views including the one it was written to describe.

---

## Summary

| # | finding | class | scale | verdict |
|---|---|---|---|---|
| **F1** | calendar bridge built, P116-hardened, **never fed**; a live sync discards every attendee at source | 9 | `meetings` **0 rows**; 1,007 events live | **DEFECT** |
| **F2** | enrich queue excludes owners behind a task nothing ever closes | 10 | **115 owners / $102.4M** | **DEFECT** |
| **F3** | published Class 10 detector matches **0 of 210** views — cannot fire | **NEW (11)** | 22 views were invisible | **DEFECT (tooling)** |
| **F4** | `v_lcc_owner_contact_decidability.rank_value` NULL on every row | 6 (P180 recurrence) | 316 rows; top owner **$24.1M** reads unsized | **DEFECT** |
| N1 | `teams_user_id` 0 | 9 | 32,833 | non-issue — `send_teams` resolves by email |
| N2 | `webex_person_id` 0 | 9 | 32,833 | non-issue — Webex not used; **register the flag** |
| N3 | `icloud_contact_id` 0 | 9 | 32,833 | non-issue — no sender, no intent |
| N4 | `sf_lead_id` 0 | 9 | 7,186 | non-issue — lists are Contact-scoped (7,186/7,186) |
| N5 | `listing_bd_runs.sf_deal_id` 0 | 9 | 1,472 | non-issue — documented as connector-gated |
| N6 | SF list import 36 days stale | — | 7,186 | non-issue — manual import, no schedule to stop |
| R1 | Class 8 producer re-sweep | 8 | — | **CLEAN — no regression** |

---

## F1 — the calendar bridge was built, hardened, and never fed (Class 9)

**Detector:** the Class 9 column sweep, then the flow landing-side freshness check.

Three independent columns written by the same code path all read zero, against a
control that proves the method works:

| column | populated | of |
|---|---|---|
| `meetings` (whole table) | **0 rows** | — |
| `unified_contacts.last_meeting_date` | **0** | 32,833 |
| `unified_contacts.last_call_date` | **0** | 32,833 |
| *control:* `last_synced_outlook` (has a sender) | 2,809 | 32,833 |
| *control:* `last_email_date` (has a sender) | 880 | 32,833 |

The receiver is complete: route `/api/calendar-changes?bridge=calendar.event.link`
→ `handleCalendarEventLink`, which matches attendees to contacts, writes
`entity_links`, upserts `meetings` on `(workspace_id, external_id)`, and appends to
the `activity_events` timeline. It even carries the **P116 fix** —
`resolveSourceUserId` on `meetings.source_user_id` — applied to a table that has
never held a row.

**And the twist that makes this worse than "no sender".** A calendar sync *is*
live and healthy — but it points somewhere else:

- both `flow-outlook-calendar-sync.json` and `flow-personal-calendar-sync.json`
  POST to `zqzrriwuavgrquhisnoa` (**Dialysis_DB**) `/functions/v1/ai-copilot/sync/calendar-events`
- that lands in `dia.calendar_events`: **1,007 rows, synced 2026-08-26, 1,006 in
  the last 365 days, 26 distinct organizers**
- **`dia.calendar_events` has no `attendees` column.** It stores `organizer_name`
  and `organizer_email` only.

So the meetings are captured and **every attendee list is discarded at ingest** —
the exact people-discovery signal the unfed LCC receiver exists to consume. This is
the ORE Phase 1 Unit C shape: *the parser found the addresses, then stripped them.*

**Why it matters.** Per the account-based contact-intelligence doctrine, the
discriminating signal for a buy-side target is **who initiated the deal-flow
thread** — and only 1.9% of contacts carried a title before the Outlook sync. The
directly comparable fix (Outlook contacts, same subsystem, same week) landed
**2,809 contacts, 1,130 titles and 98 acquisitions contacts in 88 minutes.**

**Deliberately not quantified:** how many people the calendar would add. The
attendee lists are discarded at source, so the number is unmeasurable from here.
Quoting the Outlook figure as a forecast would be the "plausible aggregate" error
this playbook exists to prevent.

**Fix (not applied — needs an operator step).** Either point the existing calendar
flow at `/api/calendar-changes?bridge=calendar.event.link` (the receiver is ready
and idempotent on `(workspace_id, external_id)`), or add `attendees` to the
Dialysis path. The first is strictly better: it reuses a built, P116-hardened,
contact-matching receiver instead of widening a lossy schema.

---

## F2 — an exclusion keyed on a state nothing ever clears (Class 10)

**The exclusion.** `v_owner_contact_enrich_queue` excludes any owner with an open
`owner_contact_manual` research task:

```sql
NOT (EXISTS ( SELECT 1 FROM research_tasks t
   WHERE t.entity_id = p.entity_id
     AND t.research_type = 'owner_contact_manual'
     AND t.status = ANY (ARRAY['queued','in_progress'])))
```

Correct in isolation — P159 added it so the automated worker stops burning ticks on
rows only a human can resolve.

**What is supposed to serve that population:** a human, via the P173 "Find the
contact" capture path on the research card.

**Does it?** Partly — and the honest answer required correcting my own first two
readings:

- The lane is **reachable**: `owner_contact_manual` now sits at **row 1, page 1**.
  P174's ranking worked. Judging it by "0 lifetime completions" would be the
  *check-the-age* error — it became reachable the same day.
- But **nothing ever closes a task.** All **316 are `status='queued'`**; not one has
  moved to any other status in the two months since 2026-06-27. There is no
  auto-retire sweep for this lane, so the exclusion is permanent by construction.

**The measurable harm — owners whose premise has already cleared:**

| | owners | rent |
|---|---|---|
| open task **and** a genuine named active contact in `owner_contact_pivot` | **115** | **$102,407,924** |
| open task and a self-echo contact (correctly still open) | 5 | $10.7M |

Named rows, highest value first — each has a **selected active contact**, the exact
field the panel and the enrich engine read, and a card still saying *find the contact*:

| owner | active contact | rent | task age |
|---|---|---|---|
| Gba Associates LP | Vincent Forte | $27.2M | **43 days** |
| Reston Va II FGF, LLC | Joseph Capra | $25.3M | **43 days** |
| Trammell Crow Co | Thomas Finan | $24.1M | 5 days |
| ARLINGTON VA I FGF, LLC | Joseph Capra | $15.6M | **43 days** |
| Durst / The Durst Organization | Durst Family | $10.0M | 5 days |

**Two guards this survived, either of which would have inflated it:**

- **P161 weak-association.** A `works_at` edge is the Salesforce org edge and does
  not make an owner reachable. Split by type: **all 185 edges are
  `associated_with`, zero `works_at`.** The finding is not the P161 trap.
- **P131 self-echo.** 5 of the 120 pivot contacts merely restate the owner name
  (Grey Harbor → "Grey Harbor"). Excluded via the existing
  `lcc_p131_candidate_restates_owner`, leaving 115.

**And one number deliberately *not* headlined.** Lane-wide, 115/316 = 36% are
already answered — but on **page 1, only 3 of 25 rows** are. Reading the rows the
consumer actually processes, rather than the population, keeps this honest: the
page-1 noise is real but modest **today**, and grows monotonically because nothing
ever closes a task.

**Fix prepared, not applied:** `lcc_p182_retire_cleared_owner_contact_manual()` —
dry-run default, batch-tagged, reversible, paired with a daily cron (the P176 rule:
a one-shot repair of a recurring producer is a chore you repeat forever). It closes
only tasks whose premise has genuinely cleared, using the *existing* P131 predicate
rather than a second definition.

---

## F3 — the Class 10 detector could not fire (NEW CLASS)

**The published detector greps `pg_views.definition` for `NOT\s+EXISTS` / `NOT\s+IN`.**
Postgres does not store what you wrote — it stores a **deparsed** form:

| you write | Postgres stores |
|---|---|
| `NOT EXISTS (SELECT …)` | `NOT (EXISTS ( SELECT …))` |
| `x NOT IN (SELECT …)` | `NOT (x IN ( SELECT …))` / `<> ALL` |

`NOT\s+EXISTS` requires whitespace between the tokens. The stored form has `(`.
**It matches nothing, ever, on any Postgres schema.**

Measured on LCC Opps:

| pattern | views matched |
|---|---|
| `NOT\s+EXISTS` (**as published**) | **0** of 210 |
| `NOT \(EXISTS` (deparsed) | **21** |
| `<> ALL` (deparsed `NOT IN`) | **10** |
| `LEFT JOIN … IS NULL` (anti-join idiom — never considered) | 72 |

The detector returned **empty** and I nearly filed "no Class 10 exclusions exist."
It also fails on its own first-run subject: `v_owner_contact_worklist` contains
**four** exclusions and matches zero.

**Corrected detector** (in the playbook, with the anti-join idiom added): **22
candidate views**, from which F2 came.

**The general rule, and why this is its own class:** *a detector that greps for
source syntax a datastore normalizes away reports a clean bill of health forever.*
It is the playbook's own failure mode — a surface that answers confidently instead
of erroring — turned on the audit tooling. **Validate every detector against a
known-positive before trusting a zero.**

---

## F4 — a value-ranked view that cannot rank (Class 6 / P180 recurrence)

`v_lcc_owner_contact_decidability` (shipped by P131 to surface the answerable few)
sources its value as:

```sql
(NULLIF((rt.metadata ->> 'rank_value'), ''))::numeric AS rank_value
```

**The seeder never writes that key.** Metadata keys actually present on all 316
tasks: `batch, notice_address, ranked_by, prior_priority, property_links, bench,
tried, kind, owner_name, google_queries, enrichment_action, inferred_state`.

Result: **`rank_value` is NULL on 316 of 316 rows** — genuinely NULL, not zero
(checked, per P180: 0 literal zeros). The view is value-ranked in name only, and
the six decidable owners it exists to surface come back unsized:

| decidable owner | view says | actual rent |
|---|---|---|
| **Trammell Crow Co** | `NULL` | **$24,146,509** |
| Adel B & Gihan M Bareh | `NULL` | $240,387 |
| David G McAlpin and D Kathryn McAlpin | `NULL` | $240,084 |

This is **P180 recurring inside a view built after P180** — and worse than the
original, because P180 was about rendering NULL as "$0"; here the ordering itself
is inoperative, so the $24.1M owner has no claim on the top slot.

**Fix prepared, not applied:** join `v_entity_portfolio_all` (the canonical
per-entity source, verified one row per entity) instead of reading a denormalized
metadata copy the seeder never writes — the same principle as the CM rule that a
KPI tile must *read* the view rather than restate it. Self-heals as rent changes.

---

## Documented non-issues (recorded so the next sweep does not re-litigate)

- **N1 `teams_user_id` (0/32,833) — not a defect.** `sendTeamsMessage` resolves via
  `contact.email || contact.teams_user_id`; email is the primary path and is
  populated. Teams *is* used (three flows). The column is an unused optimisation.
- **N2 `webex_person_id` (0/32,833) — not a defect, but make it visible.** Requires
  `WEBEX_CLIENT_ID` / `WEBEX_ACCESS_TOKEN`; no flow, no evidence Northmarq uses
  Webex (they use Teams). **It is absent from `feature_flags_registry`** — the
  Class 5 surface exists precisely so a dormant capability is not invisible.
  Recommend a registry row rather than code changes.
- **N3 `icloud_contact_id` (0/32,833) — not a defect.** No sender, no stated intent.
- **N4 `lcc_sf_list_membership.sf_lead_id` (0/7,186) — not a defect.** All 7,186
  members carry `sf_contact_id` and **zero carry neither**; the lists in scope are
  Contact-based campaigns. The receiver is correctly idle.
- **N5 `listing_bd_runs.sf_deal_id` (0/1,472) — not a defect.** The table is live
  (254 runs in 30 days). CLAUDE.md already documents the `sf_deal_id` stamp as
  gated on a live SF connector; `sf_deal_id` is written to `sf_deal_staging`.
- **N6 SF list import 36 days stale — not a stopped flow.** `last_seen_at` clusters
  on four days (2026-07-17/18/19/21) — the bulk-import signature, and no cron
  exists for it. Manual by design. *Caveat:* it is the source of the buyer
  principals, has no refresh cadence, and nothing surfaces its age.

---

## R1 — Class 8 re-sweep: clean, no regression

A verified result has a shelf life (P172 was undone within 24 hours), so the
producer sweep was re-run across every entity-referencing column with a
`created_at`. **Only by-design history remains:**

| table.column | stranded | created after merge | verdict |
|---|---|---|---|
| `lcc_decisions.subject_entity_id` | 296 | 62 | **61 `exact_name_merge` (decided, by design) + 1 held `sf_contact_account_mismatch`** — exactly the documented state |
| `entity_relationships.to_entity_id` | 8 | 8 | all 8 would resolve to a **literal self-loop** — P177's documented skip case |
| `lcc_boyd_reconcile_2026_07`, `sf_account_on_person_cleanup_backup` | 51 | 43 | one-off reconcile / backup tables |
| 13 further columns | 1–131 | **0** | historical residue |

**No `junk_entity_name` re-mint** — P176's cron 238 (`lcc-decisions-merged-subject-retire`,
daily 06:40) is **active** and holding. All three survivor-resolution triggers are
installed and **enabled**: `trg_lcc_entity_rel_resolve_survivor`,
`trg_lcc_external_identity_resolve_survivor`, `trg_lcc_resolve_activity_entity_id`.

**One playbook wording correction.** The 8 residual edges are described as "void
self-referential edges". Checked literally (`from_entity_id = to_entity_id`) that is
**0 of 8** — they are `A → B where B merges into A` (Terreno→Terreno,
Blackstone→Blackstone). They *become* self-loops on resolution (8 of 8), which is
why the trigger skips them. The substance is right; the wording invites a check
that returns zero and looks like a contradiction.

---

## Flow landing-side audit

A flow that stopped looks exactly like one with nothing to do, so each flow was
measured at its landing table rather than by its own run status:

| flow | target | newest | last 7d | verdict |
|---|---|---|---|---|
| **calendar bridge (LCC)** | `meetings` | — | 0 | **NEVER FED (F1)** |
| sf list import | `lcc_sf_list_membership` | 2026-07-21 | 0 | manual (N6) |
| outlook contacts sync | `unified_contacts.last_synced_outlook` | today | 2,809 | live |
| outlook body/sent sweep | `email_bodies` | today | 1,546 | live |
| outlook activity bridge | `activity_events` | today | 1,856 | live |
| email flag → intake | `staged_intake_items` | today | 50 | live |
| email flag → processing | `processing_log` | today | 71 | live |
| mailbox mirror | `lcc_mailbox_reconcile_ledger` | today | 276 | live |
| inbox triage | `inbox_items` | today | 99 | live |
| todo complete | `action_items` | today | 31 | live |

**Not done:** the sent-vs-landed comparison the prompt asks for needs the Power
Automate run history, which is outside the repo and outside this session's reach.
The landing-side freshness above is the half that is measurable from here; the
`continue on failure` gap check remains open and is the right next step for
anyone with portal access.

---

## Method notes — corrections made mid-sweep

Five readings were wrong before measurement corrected them. Each was plausible:

1. **"There are no Class 10 exclusions"** — the detector could not fire (F3).
2. **"`owner_contact_manual` is a dead lane nothing serves"** — it is at **row 1,
   page 1**; P174 fixed reachability the same day. *Check the age.*
3. **"185 owners have a cleared premise"** — 185 by raw edge count; **115** after
   the P131 self-echo guard.
4. **"59% of the operator's first screen is noise"** — 36% lane-wide, but **3 of
   25** on the page the operator actually sees.
5. **"`meetings` is empty because no calendar sync exists"** — a sync is live and
   healthy; it writes to **a different project** with a lossy schema. *Confirm which
   datastore a writer targets before quoting any count.*

The discipline that caught all five: **name the expected answer before running the
query, and prefer a named row with a stated expectation over an aggregate.**
