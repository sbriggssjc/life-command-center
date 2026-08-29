> 📍 **CANONICAL PAGE: [`docs/architecture/bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md) §6.**
> **Diagnosis only — nothing written, and the recommendation is NOT to build.**

# C7 — the broker-assignment bridge works, is empty, and has nothing to fill it

**Measured live 2026-08-29 on LCC Opps, after C6 shipped.**

> ## The one-line finding
>
> **C4c is not a plumbing defect. The point-person machinery is correct and complete — 161 of 161
> overrides resolve through `v_lcc_entity_point_person`.** What is missing is *assignments*: **0 of
> the 303 C6 owners has one**, the 161 that exist are a **disjoint set**, and there is no signal to
> derive them from — **only 13 of 303 have ever been emailed by anyone, by a single sender.**
> **Building a propagator now would be a consumer with no producer.**

---

## 1. The bridge is not broken

| | |
|---|---:|
| `lcc_entity_owner_override` rows | **161** |
| …that resolve through `v_lcc_entity_point_person` | **161 (100%)** |
| `lcc_cadence_point_person(uuid)` exists | ✅ |
| `v_lcc_entity_point_person` exists | ✅ |

**The documented three-user-table trap is real and is already solved.**
`touchpoint_cadence.owner_user_id` FKs `users(id)`; `lcc_entity_owner_override.owner_user_id` FKs
`lcc_users(lcc_user_id)`; none of the `lcc_users` ids exist in `public.users`. The email bridge
handles it and resolves **100%** of what it is given. ⚠️ **Nothing here needs fixing, and
re-deriving the mapping in JS remains the documented way to break it.**

## 2. ⚠️ It is empty, and the two populations are disjoint

| | |
|---|---:|
| C6 deal-timing owners (P1/P2/P3/P8) | **303** |
| …carrying an `lcc_entity_owner_override` | **0** |
| …for whom a point person resolves | **0** |
| `touchpoint_cadence` rows with `owner_user_id` | 48 of 2,304 (2%) |
| `v_priority_queue` rows with `owner_user_id` | 14 of 1,646 (0.9%) |

**Zero overlap.** A propagation from `lcc_entity_owner_override` → `touchpoint_cadence` would move
**0 rows for the population C6 just surfaced**. That is the **P137** class — a consumer wired to a
producer that does not exist for its population — and it would report success while moving nothing.

## 3. ⚠️ There is no signal to derive an assignment from

The obvious derivation is *"whoever has corresponded with this contact owns the relationship."*
Measured against `email_bodies`:

| | |
|---|---:|
| C6 owners whose active contact carries an email | **263 of 303** |
| …that anyone on the team has ever emailed | **13** |
| distinct senders across all of them | **1** |

**13 of 303, from one mailbox.** There is no correspondence graph to assign from, because only one
mailbox has ever been ingested. Every other derivation candidate is worse: Salesforce ownership is
a read-only proxy this repo does not clean; geography is not recorded per broker; portfolio value
does not name a person.

## 4. ⚠️ The deeper reason — the team has 4 users and one of them is active

`lcc_users` holds **4** rows: `sabriggs@`, `klargent@`, `nberwaldt@`, `smartin@`. Scott's own
framing, this arc: *"I have not yet started to use the LCC in our BD efforts as I have focused our
time until now on the build of the app."*

**Distributing 303 owners across four people, one of whom is the only active user, solves a problem
nobody has yet.** The queue does not belong to nobody because the bridge is broken — **it belongs to
nobody because the team has not started working it.**

## 5. Recommendation — do NOT build C4c yet

**Assignment is a human act that has not happened, and no automation can manufacture it.** The
honest sequence:

1. **Work the 303 first.** If Scott is the only active user, the effective owner of all 303 is
   Scott, and a `owner_user_id` column stamped with one name adds nothing a filter cannot do.
2. **Assignment becomes real when a second person works the queue.** At that point the question is
   *how do we split it* — a doctrine question with a real answer (by vertical, by geography, by
   existing relationship), and by then correspondence will exist to inform it.
3. **The mailbox coverage is the actual precondition.** One ingested mailbox means one sender in
   every relationship signal in the system — this constrains far more than assignment (cf.
   `contact-reconciliation-outbound.md`, where the same single-mailbox limit bounds the outbound
   payload). **Widening it is the higher-value move and is not filed anywhere.** → **C7a.**

⚠️ **What NOT to do:** do not default-stamp all 303 to Scott in the database. That writes a fact
nobody asserted into the column every downstream surface reads as a real assignment, and it is not
reversible by inspection later — the same "a status nobody earned" failure as A5's `gap_resolved`
and B6b-lead's `filtered_multi_tenant`. A UI default or a filter is free; a written row is not.

## 6. What was NOT measured

- **Whether the 161 existing overrides are correct or current.** They resolve; nobody read them.
- **dia.** The C6 population is gov-only.
- **Salesforce Account/Opportunity ownership** as an assignment source — named and dismissed on
  doctrine (SF is a read-only, uncleaned proxy here), **not measured**. If the doctrine changed, it
  would need sizing.
- **Whether `smartin@` / `klargent@` / `nberwaldt@` are active in LCC at all** — only that one
  sender appears in `email_bodies` for this population.
