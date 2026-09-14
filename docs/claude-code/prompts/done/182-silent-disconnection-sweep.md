# Prompt 182 — the silent-disconnection sweep

> **Origin:** 2026-08-26. A single day's work found nine defects that all read as healthy, and
> two of them were entirely new classes. This prompt turns that day into a repeatable sweep.
> Read `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` first — Classes 1–10 and their detectors.

---

## The question

**Where else is something built, wired, and silently not connected?**

Not "what is broken" — broken things error. These do not. Every defect found on 2026-08-26
reported success: a green cron, a non-zero count, a populated table, a passing test, a flow
that ran for 88 minutes and said "Succeeded". The failure mode is **a surface that answers
confidently instead of erroring.**

---

## What was found on 2026-08-26 (the seed)

Nine live defects, all invisible, in one day:

| # | defect | class | scale |
|---|---|---|---|
| 1 | portfolio facts re-created on tombstones nightly | 8 | 119 ghosts, $71.8M |
| 2 | junk-lane cards re-minted from a seed flag the cleanup left | 8 | 78 re-mint surface, undid its own repair in 24h |
| 3 | relationship edges written against merged-away parties | 8 | 184 edges, 41 survivors under-reporting deal history |
| 4 | external identities minted on tombstones | 8 | 45 |
| 5 | research lane with no way to record an answer | 3 | 545 tasks |
| 6 | NPI lane escalating undecidable work to a human | 9* | 141 of 203 unanswerable |
| 7 | classifier filing business contacts as personal on domain alone | 4 | 38% of SF campaign members |
| 8 | identity email taken from position, not picked | new | would misfile principals under personal/former-employer addresses |
| 9 | **Outlook contact receiver built, never fed** | **9** | 0 of 31,038 → 2,809 landed, 98 acquisitions contacts |
| 10 | **exclusion with no counterpart that promotes** | **10** | 11 owners, $240.5M invisible |

\* value-gated but not decidability-gated.

---

## Run these, in order

### 1. Class 9 — receivers with no senders

Run the detector in the playbook's Class 9 section. **Known open candidates as of 2026-08-26**
(verify they are still zero before investigating):

- `unified_contacts.last_synced_calendar` — 0 / 32,833, yet `ingest_calendar_contacts` exists
- `unified_contacts.webex_person_id` — 0, yet `ingest_webex_calls` and `send_webex` exist
- `unified_contacts.teams_user_id` — 0, yet `send_teams` exists
- `unified_contacts.icloud_contact_id` — 0
- `lcc_sf_list_membership.sf_lead_id` — 0 / 7,186
- `listing_bd_runs.sf_deal_id` — 0 / 1,472

**For each: is there a sender, and should there be?** Webex/Teams may simply be unused at
Northmarq — that is a legitimate answer. **Record the verdict either way**, so the next sweep
does not re-investigate. A zero column with a documented "not used here" is resolved; a zero
column with no note is an open question forever.

Then widen beyond id columns: **for every integration the codebase can RECEIVE, does anything
SEND?** Grep `api/` for POST handlers and ingest actions, then count the rows they write.

### 2. Class 10 — exclusions with no promoter

Run the `pg_views` detector in the playbook's Class 10 section. For each exclusion, answer:

- what population does this exclude?
- what is supposed to serve that population instead?
- **does it, measurably?** (count the excluded rows that reached the downstream surface)

Start with the surfaces that gate BD work: `v_owner_contact_worklist` (fixed subject aside),
`v_owner_contact_enrich_queue`, `v_lcc_bd_worklist`, `v_priority_queue`, the Decision Center
lane sources. An exclusion that says "already has X" is the highest-yield shape.

### 3. Class 8 — re-run the producer sweep

Four producers were closed on 2026-08-26. **Re-run the Class 8 detector** — a verified result
has a shelf life, and P172 proved a repair can be undone inside 24 hours. This should now
report only by-design history (61 `exact_name_merge`, 8 void self-referential edges, backup
tables). Anything new is a regression.

### 4. The flows themselves

Power Automate flows are outside the repo and outside every guard we have.

- List every flow and when it last ran successfully. A flow that stopped months ago looks
  exactly like one with nothing to do.
- **`continue on failure` makes a flow report success with silent gaps.** For each flow that
  writes, compare *records sent* against *rows landed*. The 2026-08-26 Outlook sync was clean
  (2,809 vs ~2,800) — that comparison is the only honest measure, and most flows have never
  had it made.
- Check high-water marks. A flow with `hwMark` stuck at an epoch re-sends everything every
  run; one that advances on a *partial* batch silently skips a window.

---

## Method — the part that actually matters

Six wrong conclusions were reached on 2026-08-26 before being caught by measurement. Each was
plausible enough to ship:

1. **"Nothing has arrived, the sync is broken"** — wrong database. `unified_contacts` exists in
   two projects and `govQuery()` routes by path, so the *name* says nothing about where a write
   lands. The stale copy answered happily with 9-day-old data. → **Confirm which datastore a
   writer targets before quoting any count from it.**
2. **"These tables are unmeasurable, they have no `updated_at`"** — they had `created_at`,
   which answers the question *better*. → **Before declaring something unmeasurable, check the
   columns that ARE there.** A detector that looks for one column name manufactures blockers.
3. **"This lane is dead — 203 open, 0 completed"** — it was three weeks old. → **Check the age
   before calling anything dead.**
4. **"It needs a capture path"** — the destination could not accept an answer (NPI is
   display-only). → **Verify the destination can accept an answer before routing anyone to it.**
5. **"Top owners are suppressed by broker links we may not call"** — visibly true on Easterly,
   and fleet-wide it measured **zero**. → **A pattern seen on one named row is a hypothesis.**
6. **"Ranking it will make it reachable"** — it moved to page 62; the lanes above had 4,772 and
   595 completions and demoting them would have been the real defect. → **Measure the
   throughput of whatever a promotion would displace.**

**The discipline that caught all six:** name the expected answer before running the query, and
prefer a named row with a stated expectation over an aggregate. Every aggregate above was
plausible. The named rows were not.

---

## Deliverable

For each finding: the class, the detector output, the **scale in dollars or rows**, whether it
is a genuine defect or a documented non-issue, and a reversible fix or an explicit "not worth
fixing, here is why". Add any genuinely new class to the playbook with its detector and its
first-run result — that is what made Classes 9 and 10 reusable rather than anecdotes.

**Do not fix on suspicion.** Every repair on 2026-08-26 was dry-run first, gated on named rows,
tagged with a batch, and reversible. Two of them (P164 previously, and the P175a dedup rule)
would have destroyed real data had the "obvious" version shipped.
