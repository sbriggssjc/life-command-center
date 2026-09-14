# ENTC — the junk80 census (and why it is not one class), and `lcc_p195_unmerge` FIXED not retired (2026-09-03)

Target LCC Opps `xengecqvemvfknjvbvrq`. **No entity was retired, renamed, merged or swept.
No seeder was applied.** Half B is a live function fix, proven by round trip. Half A is a
census + a producer gate + a dry-run projection.

Migrations `20261014120000_lcc_entc_p195_unmerge_fix.sql`,
`20261015120000_lcc_entc_junk80_census.sql` (both applied).
Guard `test/entc-junk80-and-p195-unmerge.test.mjs` — 13 tests, **19/19 mutations RED**.

Sibling reading: `docs/architecture/entity-identity-and-dedup.md` ·
`docs/audits/PR5c_entities_c_review_oldest_2026-09-03.md`.

---

## Half B — `lcc_p195_unmerge`: the decision was FIX, and the backlog's recommendation is refused

### ⚠️ RETIRING IT WOULD HAVE MADE 66 LIVE MERGES IRREVERSIBLE

The backlog said *"the wrapper is also now redundant; retire it or repoint it at
`lcc_unmerge_entity`."* One query refutes it:

| | |
|---|---:|
| `lcc_p195_merge_log` rows | 67 |
| …**open** (not unmerged) | **66** |
| …of those that have a `lcc_entity_merge_log` row | **0** |

`lcc_unmerge_entity` reads `lcc_entity_merge_log` and returns `no_open_merge_log_row` when
there is none. The P195 batches ran on 2026-08-27 **hours before P196 taught
`lcc_merge_entity` to self-snapshot into that ledger**, so `lcc_p195_unmerge` is the only
path that can reverse them. Both ledgers show `2026-08-27` as their first day, which is
exactly why "it is redundant now" reads true and is false.

**The durable rule: before retiring a superseded function, check the population it still
owns — not the date the successor shipped.** A successor that keeps its own ledger does not
inherit the predecessor's history.

### The defect, reproduced and fixed

Round trip on the Harrison pair (loser `66cf6d78` *Jamie Harrison*, winner `37895fbc`
*James Harrison*), inside a self-rolling-back transaction, fingerprinting by identity
(`id:from>to:type`) rather than by count:

| | rows before | rows after | `rows_restored` | lost | new / stranded |
|---|---:|---:|---:|---|---|
| before the fix | 24 | 24 | 17 | 0 | **2 `brokers` edges left on the winner** (`1d7e8618`, `5aae123c`) |
| **after the fix** | 24 | 24 | **19** | **0** | **0**, `note = 'restored'` |

Cause, unchanged from the earlier audit: the loser holds three byte-identical
`(from, to, 'brokers')` edges (`entity_relationships` has no unique constraint on that
triple, P177); all three are snapshotted; on restore the first comes back and
`trg_lcc_entity_rel_resolve_survivor` — a **BEFORE INSERT** trigger — returns NULL for the
other two as duplicates of an edge the now-live loser already holds, **so they never reach
`ON CONFLICT (id) DO UPDATE`**. The function reported `restored` throughout.

The fix is P196's shape, applied to both `entity_relationships` and `external_identities`:
**UPDATE the rows that survived** (a repoint the trigger cannot block) and **INSERT only the
rows that were actually deleted**. Plus a want-vs-have count that puts any residue in a new
`note` column (`relationships_not_restored=N` / `identities_not_restored=N`) — a
trigger-skipped row is now reported, never silent.

- ⚠️ **THE ROW COUNT IS IDENTICAL IN BOTH RUNS (24 → 24).** Only the identity-keyed
  fingerprint exposes it. **A count-based verification of any unmerge is worthless.**
- The return type gained `note`, so the function is `DROP`ped first — `CREATE OR REPLACE`
  cannot change OUT columns.
- Residue after both probes: probe ledger rows 0, probe snapshots 0, tombstone 0,
  `lcc_p195_merge_log` open still **66**, drift **0**, blind pairs **55**, plan **15**.

### Caller census

`lcc_p195_unmerge` has **no PostgREST caller and no cron** — the only references outside
docs are `test/p195-merge-gate.test.mjs` (source assertions) and the operator instruction in
`OPERATOR-ACTIONS.md`. Same for `lcc_unmerge_entity` and `lcc_a2a_unmerge`.

**So the definer surface was narrowed in the same change.** All three were reachable by
`anon` and `authenticated` — SECURITY DEFINER functions that move ownership and relationship
rows between entities. Now `service_role` only.
⚠️ `REVOKE … FROM anon, authenticated` does not remove the **PUBLIC** grant, and
`REVOKE … FROM public` does not remove Supabase's **explicit default-privilege** grants.
Both are revoked, and the migration **asserts with `has_function_privilege()`** rather than
reading the REVOKE it just wrote.

---

## Half A — junk80: the census, and the class split that changes the answer

### The predicate (it reproduces the 80 exactly)

A **live** `person` entity, with an email that is **not** a generic inbox localpart, whose
name fails at least one of the four shared guards — `lcc_looks_like_person` (negated),
`lcc_is_rejected_contact_name`, `lcc_owner_name_is_junk`, `lcc_p131_is_document_row_label`.
**83 before the generic-inbox exclusion, 80 after.** No new name regex was written.
`lcc_owner_name_has_org_marker` fires on **0** of this population and is not in the union.

Frozen as `v_lcc_entities_c_junk80` (read-only).

### ⚠️ THE 80 ARE NOT ONE CLASS, AND A BLANKET SWEEP WOULD CLEAR A REAL PERSON'S MAILBOX

| disposition | rows | edges | alone (domain-scoped) | proposes |
|---|---:|---:|---:|---|
| `sweep_candidate` | **41** | 1,506 | 8 | `dismiss` |
| `hold_salesforce_identity` | 27 | 90 | 23 | `uncertain` |
| `hold_email_corroborated` | **6** | 26 | 5 | `uncertain` |
| `hold_inbound_reference` | 4 | 43 | 1 | `uncertain` |
| `hold_name_repairable` | 2 | 2 | 0 | `rename` |

- **`hold_email_corroborated` is the finding.** A ≥4-character alphabetic token of the name
  appears inside the mailbox's own localpart — `Eyal (Al) Elkayam` / `eyal@`, `Hunt` /
  `hunt@`, `Jackson` / `kjackson@`, `Lew (Doug) Hodge` / `louhodges5901@`,
  `Buyer ContactsStephen R. Perry` / `srperry91@`, and the listing TEAM
  `Daniel Chumbley, Sean Sharko, Austin Weisenbeck` / `daniel.chumbley@`. **The row IS that
  mailbox's person; clearing its email is the harm, not the fix.** The detector fires on
  **6 of 80** — not 0 and not 80 — and all six read correct on named rows.
- **`hold_name_repairable`** — a real person behind a CoStar section-label prefix
  (`Seller ContactsDon H. Doyle`, `Seller ContactsSubhash Kumar`). `stripContactLabelPrefix`
  already exists to fix the NAME; retiring the row loses a person. They seed as `rename`, the
  lane's existing verdict. ⚠️ Note the two signals are **independent**: Don H. Doyle's name is
  repairable *and* his mailbox (`mnieman@naicapital.com`) belongs to somebody else, so the
  human sees both facts on the card rather than one disposition standing for both.
- ⚠️ **Only `sweep_candidate` proposes an action.** Every hold seeds `uncertain` at
  `confidence 0`, so a confirm can never be a default and the holds sort last.

### ⚠️ TWO CORRECTIONS TO THE PRIOR AUDIT

1. **"0 of the 80 carry `metadata.junk_name_flagged`" is wrong — 11 do.** (The
   "0 in `junk_entity_review`" half reproduces exactly.) The 11 span four dispositions, so
   the flag is not a proxy for any of them.
2. **"37 are ALONE on their mailbox" is right for one scope and not the other, and the
   view now emits both.** By email address it is **31**; scoped to `entities.domain` —
   which is what `ensureEntityLink` actually filters on when the caller supplies a domain —
   it is **37**, reproduced to the row. Quoting one number without the scope is the ambiguity
   that made this worth chasing.

### The producers, and the gate

Identities on the 80: `costar/contact` **59** (through 2026-07-31), `salesforce/Lead` 22 (one
day, 2026-07-16), `salesforce/Contact` 10, `rca` 8, `costar/company` 4.

**The producer is LIVE.** No junk80-shaped row has been minted since July, but the CoStar
sidebar minted junk-shaped person entities as recently as **2026-08-26** (`Demographics`,
`Population`, `Households`, `One Towne Sq, Suite 1600`) — they simply carried no email.

⚠️ **The entity mint had a WEAKER guard than the write beside it.** `upsertSidebarContacts`
(the domain `contacts` table) has always dropped a candidate failing `isJunkContactName`.
`unpackContacts` (the **entity** mint, via `ensureEntityLink`) applied only
`planContactMinting`'s TrafficMetrix street/label + fan-out detector — so a firm name, a
section label or a CoStar verification sentence carrying a real mailbox minted a **person
entity**, which is precisely what the email tier then resolves inbound people onto. Two
writers, one capture, two different definitions of "junk".

Gate shipped: `planContactMinting` takes an **injected** `personJunkName` filter and
`sidebar-pipeline` passes `contactEntityType(c) === 'person' && isJunkContactName(c.name)`.
Suppressed candidates are **routed to review** (`reason: 'person_junk_name'`), never dropped.

- **Injected, not imported** — `sidebar-pipeline` imports `tm-misparse`, so importing back is
  circular, and a second copy of the regex is the normaliser drift this repo keeps paying for.
- **PERSON-ONLY, and that is the calibration.** `isJunkContactName` rejects firm suffixes by
  design; running it on an organization candidate would block **every legitimate company
  mint**.
- **Opt-in per caller** — with no filter injected the planner is byte-identical to before.
- ⚠️ **MEASURED REACH: the gate catches 38 of the 80 names (47.5%), and that is the honest
  number.** It correctly misses **0 of the 6 corroborated real people** — but it also misses
  `Taxes`, `Condo`, `Public`, `Canada`, `Government`, `User`, `Debt Service`: those are caught
  by `lcc_p131_is_document_row_label`, a SQL guard with **no JS twin**. Writing one would be a
  second copy of a normaliser, so the gate halves the inflow rather than stopping it. Filed,
  not papered over.

### The retirement path: (a) the existing review lane, not a direct sweep

Chosen because `unstampMisparseMember` — the lane's existing confirm effect — is **exactly**
the remedy this class needs and nothing more: it clears `entities.email`, sets
`junk_name_flagged`, detaches the conflated `external_identities`, snapshots all of it into
`junk_review_batch.reversal` first, and **never touches relationships**. So the 480-edge
`JLL`, 380-edge `Public` and 245-edge `View Less` rows keep their vendor deal history while
losing the mailbox that makes them a landmine. Nothing is hard-deleted; the FK guard still
routes a genuinely-referenced row to a conflict card.

⚠️ **One wiring change was required and it is the honest one.** The un-stamp fired only for
`review.heuristic === TM_MISPARSE_HEURISTIC`, so a junk80 row seeded under its own heuristic
would soft-retire **without** clearing the mailbox — the half that stops the harm. Labelling
these rows `tm_misparse` to reach that branch would have been a lie in the ledger (they are
vendor party-slot and P131 row labels, not TrafficMetrix misparses). The gate is now keyed on
the **class**: `EMAIL_CONFLATION_HEURISTICS = {tm_misparse, junk80_email_holder}`, i.e. *this
row holds someone else's mailbox*, which is the fact the remedy is actually about.

Seeder: `GET /api/admin?action=junk80-seed` (dry run, default) /
`POST …&apply=true`. Idempotent on `subject_ref`; skips rows already in the lane.
**Not applied** — it needs a live authenticated call, and the dry-run projection below was
computed in SQL first.

### ⚠️ THE BRIEF'S TWO VERIFICATION TARGETS ARE IN TENSION, AND THE PROTECTIVE ONE WINS

The brief asks that the contested-mailbox count and the alone-37 both go to ~0 in the dry-run
projection. Simulating the confirmed sweep (the 41 `dismiss` rows lose their mailbox):

| metric | before | after |
|---|---:|---:|
| contested mailboxes (≥2 live person entities, same domain) | 198 | 183 |
| …whose **oldest** row fails the name guards | **14** | **3** |
| junk80 rows alone on their mailbox (domain-scoped) | **37** | **29** |
| distinct mailboxes freed | — | 35 |
| identities detached | — | 49 |
| relationships touched | — | **0** |

**`alone` reaches 29, not ~0, and that is the correct outcome**: 23 of the 37 alone rows
carry a Salesforce identity, and the brief itself says those go to review "regardless".
Driving `alone` to zero requires bulk-retiring exactly the population the brief protects.
The 3 residual junk-oldest mailboxes are holds whose email we are deliberately keeping.

⚠️ The prior audit's **26** junk-oldest mailboxes was a **human read** of 193 oldest names;
the guard-measurable figure on the same population is **14** — consistent with that audit's
own finding that every guard combined catches 12 of the 26. **Do not read 14 → 3 as
"26 → 3".**

---

## Verify on

- `select disposition, count(*) from v_lcc_entities_c_junk80 group by 1;` → 41 / 27 / 6 / 4 / 2.
- `select count(*) from lcc_p195_merge_log where unmerged_at is null;` = **66** (nothing was
  reversed here) and `pg_get_functiondef` of `lcc_p195_unmerge` contains **no**
  `on conflict (id) do update`.
- `has_function_privilege('anon', 'public.lcc_p195_unmerge(text)', 'EXECUTE')` = **false**.
- `v_lcc_canonical_name_drift` = **0**; `v_lcc_entity_email_tier_blind_pairs` = **55**;
  `v_lcc_entities_c_review_merge_plan` = **15** — all unmoved.
- ⚠️ Blind pairs are **unchanged at 55 and expected to stay there**: the sweep removes an
  email, and the blind-pair view is built from mailboxes holding ≥2 live person entities, so
  a confirm reduces it only where a junk80 row is one of exactly two members. Read the
  disposition split, never the blind-pair count, as the sweep's effect.

## Open, filed not fixed

- **junk80-apply** — nobody has run the seeder. It is a live authenticated call and the dry
  run is the gate.
- **junk80-gate-p131** — the JS mint gate reaches 47.5%; the rest needs
  `lcc_p131_is_document_row_label` reachable from JS **without** a second copy of the regex
  (an RPC at mint time, or moving the vocabulary to one owner).
- **junk80-producer-noemail** — the CoStar sidebar still mints junk-shaped person entities
  with no email (4 in August). They are not this landmine, but they are the same producer.
- **PR5c-entities-c-p195-unmerge-callers** — `test/p195-merge-gate.test.mjs` slices the
  ORIGINAL P195 migration for its unmerge assertions, so it now describes a superseded body.
  It still passes (the old file is unchanged on disk) but it no longer guards what ships.
