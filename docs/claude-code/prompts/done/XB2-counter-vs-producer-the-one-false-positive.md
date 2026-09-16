# XB2-counter — the build brief's only producer finding is a false positive, and it will train us to ignore it

**Repo: `life-command-center`.** Very small. XB2-precision landed well (findings **32 → 24**, lane
findings **11 → 3**, `branch_debt` now present). Exactly **one** finding in the current snapshot is
wrong — and it is the only `producer_*` finding there is, so it is load-bearing for whether that rule
gets trusted at all.

**Read first:** `docs/os/PLANNED-BACKLOG.md` **SIDEBARGUARD1 (retracted), XB2-precision, HP1-P2misparse** ·
`api/_handlers/sidebar-pipeline.js` → `recordContactGuardBlocks()` (~L2119) ·
`supabase/migrations/20260915120000_lcc_xb1xb2_build_brief_db_audit.sql` (the
`producer_stall_not_flag_gated` rule).

## The finding, and why it is wrong

Snapshot 13 reports `producer_stall_not_flag_gated` → `sidebar_contact_guard`, on the reasoning that it
has many runs and **zero completions**. Cowork investigated the source before writing this prompt, and
the premise does not hold:

**`sidebar_contact_guard` is not a scheduled producer. It is an event counter.** It is written on every
sidebar capture (`trigger_source='sidebar_capture'`, `lane='misparse_block'`), and its status means
something different from every other producer in the ledger:

| | scheduled producer | `sidebar_contact_guard` |
|---|---|---|
| `status='ok'` | the run succeeded | **a NEW misparse review item was raised** |
| `status='skipped'` | it did not run | it ran fine and found nothing new to escalate |
| 0 completions | **stall** | **correct steady state** once dedupe has notified a key |

Measured live 2026-09-15: 73 runs blocked **166** contacts (136 duplicate + 30 silent chrome), and
separately **149 `contact_misparse_review` items exist** (2026-08-10 → 2026-09-14), of which a human has
**dismissed 105**. The surfacing path works. The dedupe (`fetchNotifiedMisparseKeys`) is why `notified`
is 0 now — that is the design, not a fault.

## Why this matters more than one wrong row

It is the **only** producer finding in the brief. A rule whose single visible output is a false positive
is the "monitor nobody trusts" failure this program has now paid for three times (FEED2's Monday alerts,
MB2e's green-but-empty feeds, and the 11-of-32 lane inflation XB2-precision just fixed). Left alone, the
first real producer stall will arrive next to a known-wrong row and be read as more of the same.

## What to do

Teach the rule the difference, structurally — the same way `producer_stall_not_flag_gated` already
excludes `^flag \S+ is off$` in SQL rather than relying on a reader to remember:

- **Prefer an explicit signal over a name list.** A hardcoded `producer <> 'sidebar_contact_guard'` fixes
  today and breaks at the next counter. The ledger already carries usable discriminators —
  `trigger_source` (`sidebar_capture` vs `cron`) and `lane` (`misparse_block`) — and a producer that only
  ever runs on an external event is structurally not a scheduled one. Pick a discriminator that a new
  counter inherits for free, and say in the migration comment why it was chosen.
- **Do not simply suppress it.** An event counter still has a failure mode worth surfacing (e.g. it stops
  being written at all). If that is worth a rule, give it its own named one — per the "distinct alert per
  fault shape" rule MB2e established. If it is not worth one, say so explicitly rather than leaving it
  implied.
- Add the positive/negative control pair: a scheduled producer with operational skips still fires; an
  event counter with zero completions does not.

## Also file, separately (do not fix here)

**44 `contact_misparse_review` items are still `new`**, oldest **2026-08-10** (~36 days), average age
4.9 days — blocked contacts nobody has adjudicated. That matters because **HP1-P2misparse** is precisely
the thread about this guard rejecting **real people**, and `person_junk_name` is the dominant rejection
reason. Tracked as **MISPARSE-BACKLOG1**; this prompt should not touch it.

## What NOT to do

Don't touch the other rules — `branch_debt`, the aggregated lane findings and `flag_long_dark` are all
behaving correctly now. Don't build XB3/XB4. Don't change `sidebar_contact_guard` itself; it is working.

## Ship + record

Apply, redeploy **both** Railway services, confirm `/version` moved, run the collector, and report the
findings table before/after — the expected outcome is **24 → 23** with `producer_stall_not_flag_gated`
now reporting **nothing**, and a stated reason why that empty result is correct rather than broken.
Update `docs/os/PLANNED-BACKLOG.md` (**SIDEBARGUARD1**, **XB2-precision**) and `STATUS.md` (≤12 lines).
