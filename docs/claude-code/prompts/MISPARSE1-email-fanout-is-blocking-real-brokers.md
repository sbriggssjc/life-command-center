# MISPARSE1 — `person_junk_name` is working. `email_fanout` is blocking real brokers.

**Repo: `life-command-center`.** HP1-P2misparse has carried the worry that the contact guard "blocks
real people." Cowork measured the unreviewed queue on 2026-09-15 and the worry is **confirmed — but it
is one rule, not the guard.** Do not touch the rule that is working.

**Read first:** `docs/os/PLANNED-BACKLOG.md` **MISPARSE-BACKLOG1, HP1-P2misparse, SIDEBARGUARD1
(retracted)** · `api/_handlers/sidebar-pipeline.js` (`recordContactGuardBlocks`, the rejection reasons,
and whatever emits `email_fanout`).

## Measured: 44 unreviewed reviews, 100 rejections, split sharply by rule

**`person_junk_name` — 71 rejections, ~99% correct. LEAVE IT ALONE.**

| rejected | × | verdict |
|---|---:|---|
| Marcus & Millichap | 16 | ✅ brokerage, not a person |
| Demographics | 7 | ✅ page furniture |
| Cushman & Wakefield | 5 | ✅ brokerage |
| View Less | 4 | ✅ UI chrome |
| Equity Funds / Vice Chairman / Public REIT / CoStar Property Contact / Executive Vice Chairman | 2–3 each | ✅ titles and labels |
| **Brian Lane** | 1 | ⚠️ **the one miss — a plausible person** |

**`email_fanout` — 26 rejections, roughly half are real named brokers.**

Real-looking people it blocked: **Edward C. Mann** (2×), **Bradley Lagomarsino**, **Clifford L. Lamar**,
**Conrad Buhler**, **Dail Longaker**, **Debbie Gallimore, CCIM, CIPS**, **Drew A. Flood**,
**Jacob Fahner**, **James D. Collins**, **Nancy J. Bouton**, **Paul J. Collins**, **William M. Collins**.

Genuine junk it also blocked, correctly: `Gross Income`, `Other Income`, `Revenue`, `Vacancy`, `Trust`,
`PO Box 61381`, `View Less`, `Special Projects & Consulting`, and a whole listing headline
(`Absolute NNN leased, Corporate guaranteed Davita Dialysis`). Plus firms: `NAI Columbia`, `NAI DESCO`,
`Southpace Properties, Inc.`, `Gallimore & Associates, LLC`.

`misparse_name` — only 3, mixed (`336 At South Medical Ii Llc`, `The Mansour Group of Marcus & Millichap`,
and **Brian Lane** again).

## The diagnosis

`email_fanout` is **one signal carrying two meanings** — the fourth instance of that shape in this
program, after `producer_stall_not_flag_gated`, `flag_long_dark` and the table-pipe guard:

- *"many contacts share one email"* because it is a **generic/shared inbox** (`info@`, a form address) —
  a real reason to distrust the mapping; and
- *"many contacts share one email"* because **a CoStar listing legitimately lists several brokers on one
  team**, all of whom are real people Scott would want.

The rule cannot tell those apart, so it rejects both. These are exactly the brokers Team Briggs
transacts with — `CCIM, CIPS` after a name is a credential, not noise.

## What to do

1. **Split the signal.** Decide what actually distinguishes the two cases and say so in the code — the
   shape of the email local-part (`info@`, `leasing@`, `admin@` vs a personal one), the count, whether
   names on the shared address look person-shaped, or the source surface. Measure the split on the 26
   before committing to a rule.
2. **Do not weaken `person_junk_name`.** 1 miss in 71 is good precision; its misses are the cheap
   direction (a blocked real name gets reviewed). ⚠️ A change that "fixes" Brian Lane by loosening the
   person test would re-admit `Vice Chairman` and `Demographics` — measure both directions before
   touching it.
3. **`Brian Lane` appears under two different reasons** (`person_junk_name` and `misparse_name`).
   Worth understanding why one contact trips two rules — it may indicate double-processing.
4. **Then drain the 44.** Once the rule is fixed, most should resolve automatically; report how many
   remain and why.

## What NOT to do

Don't auto-accept the blocked contacts in bulk — several are genuinely junk and would pollute the
contact store, which is the failure the guard exists to prevent. Don't touch `sidebar_contact_guard`'s
`producer_runs` accounting (settled under XB2-counter). Don't widen the guard to "notify on everything";
the dedupe is correct and 105 of 149 were already dismissed by a human.

## Ship + record

Report the before/after on the 26 `email_fanout` rejections specifically — how many of the named people
above are admitted, and how many junk entries stay blocked. **That table is the deliverable.** Update
`docs/os/PLANNED-BACKLOG.md` (**MISPARSE-BACKLOG1**, **HP1-P2misparse**) and `STATUS.md` (≤12 lines).
