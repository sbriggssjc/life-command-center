# Prompt 112 — Cadence: make "overdue" mean something (BREAK-2)

**Origin:** proving the 2026-08-15 property/owner panel redesign end-to-end
(`docs/architecture/panel-redesign-verification.md` §3, `connectivity-and-open-threads.md` §4b BREAK-2).

**Why now.** The redesign put a **read-only prospecting strip** on the property Ownership tab and a
**cadence cockpit** on the owner panel. Both read `touchpoint_cadence`. Measured against live data, that
strip will say **"overdue"** on essentially every owner it can say anything about — which is *accurate* and
therefore worse than useless. This is the textbook Consumption-Layer failure the repo's own doctrine warns
about: *"a `5,447` / `999+` badge that is mostly noise trains the operator to ignore the surface."*

---

## Grounded baseline — verify before changing anything

`public.touchpoint_cadence`, LCC Opps `xengecqvemvfknjvbvrq`, 2026-08-15. SQL in
`panel-redesign-verification.md` §3.2.

| Metric | Value | Reading |
|---|---|---|
| rows total | 1,905 | |
| **never touched** (`last_touch_at IS NULL`) | **1,728 (91%)** | the producer ran; the consumer did not |
| overdue < 90 days | 1,803 | one bulk stamp that then went stale |
| overdue > 1 year | 68 | oldest `next_touch_due` **2021-09-06** |
| **due in the future** | **23** | the entire live pipeline |
| carrying a rep (`owner_user_id`) | **7** | the documented producer gap; ROE line renders blank |
| suppressed / unsubscribed | 0 | |
| distinct entities on cadence | 1,903 | ~1 row per entity, so not a duplication artefact |
| **`last_touch_at` in the FUTURE** | **3** (max `2026-10-15`) | **data defect — see Unit C** |
| owner-entities on cadence that are **UNREACHABLE** | **94** | un-actionable work by construction |

---

## Unit A — the value gate the producer never had

**94 owners on a cadence have no contact method at all** (no email, no phone, no named person — see
prompt 111). A touchpoint cadence for a party you cannot contact can never advance; it is guaranteed to
age into "overdue" and pollute every count that reads the table.

Determine which producer creates these (`growCadenceFromOutreach`, `bridgeCreateLead`, `_udAddToCadence`,
the bulk seeding that stamped ~1,800 rows) and add a **reachability precondition** consistent with the
doctrine's "value-gate the producer":
- Do **not** create a prospecting cadence for an entity with no contact method AND no named person.
- Route those to the contact-acquisition lane instead (the correct predecessor step), so the work item is
  *"find the decision-maker"*, not *"send touch #1 into the void"*.
- Existing rows: **auto-retire, reversibly** (pause with a reason, never hard-delete) — the doctrine's
  "auto-retire + auto-resolve" requirement. They should return automatically once the owner becomes
  reachable.

## Unit B — why 91% were never touched

1,728 rows with `last_touch_at IS NULL` and 1,803 overdue by <90 days looks like **one bulk generation event**
that no consumer ever worked. Establish which, from `created_at` clustering.

Then answer the doctrine's five questions for this producer, honestly, in the response file:
1. Is there a **named consumer**? (If the only consumer is "a human eventually opens the owner panel," that
   is not a consumer.)
2. What is the **value gate**? (`CADENCE_SIGNAL_MIN_VALUE` exists — is it applied on this path?)
3. What is the **auto-retire predicate**?
4. Is the surface **actionable-only, value-ranked, capped**?
5. Does it **advance from real activity** (Outlook/SF) rather than a manual queue?

**If the answer is that this cadence population should never have been emitted at scale, say that** and
propose the retirement rather than building more consumption around it. A smaller honest pipeline beats
1,905 rows of noise.

## Unit C — the `last_touch_at` in the future (small, definite bug)

3 rows carry a **completed** touch dated up to two months ahead of today (max `2026-10-15`). A "last touch"
cannot be in the future — a writer is stamping a **scheduled** date into the completed-touch column.

- Find the writer (`advanceCadence` is the single advance owner per CLAUDE.md; also
  `bridgeDraftAndLog`'s optimistic draft-time advance, and the `lcc_activity_event_advance_cadence` trigger).
- Fix at source, then correct the 3 rows reversibly.
- Add a `CHECK`-style guard or a health-alert predicate so it cannot silently recur — but note the deploy
  ordering rule: **constraint AFTER the writer deploy**, additive schema before.
- This one renders as a nonsense "last touch" date on the owner card, so it is user-visible.

## Unit D — the rep (`owner_user_id`) producer gap

Only **7 of 1,905** rows carry a rep, so the owner panel's ROE line ("Kelly owns this relationship") is blank
almost everywhere.

**Do not attempt a backfill** — `property-tab-ux-review.md` already established that as a dead end
(0 rows have a `bd_opportunity_id`, 0 have SF-owner metadata, only 3 map to a deal point-person; the
assignment is simply not in the data). The fix is **upstream**: stamp the point-person / SF activity owner
at cadence **create and advance** time. Confirm that is still true before building, then implement the
producer stamp.

---

## Deliverable

1. Findings appended to `connectivity-and-open-threads.md` §4b BREAK-2 — including, explicitly, whether the
   1,728-row population is **worth consuming or worth retiring**.
2. The producer value-gate (Unit A) + the reversible auto-retire sweep, dry-run default.
3. The Unit C writer fix + the 3-row correction.
4. The Unit D upstream rep stamp.
5. **Re-run the §3.2 cadence SQL and report before/after.** The success metric is NOT "more cadence rows" —
   it is **fewer, all actionable**: every remaining row reachable, value-gated, and either due in the future
   or genuinely awaiting a human today.

## Discipline
Reversible (pause/skip with a reason, **never hard-delete**) · idempotent · dry-run default ·
provenance-tagged · honest counts (every badge is actionable work, not raw output).
