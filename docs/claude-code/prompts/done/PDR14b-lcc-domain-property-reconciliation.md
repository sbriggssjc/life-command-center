# PDR14b — LCC self-heals dangling dia property links, and never lets this go silent again

**Repo: `life-command-center`.** Send this AFTER `PDR14a-dia-canonical-property-redirect.md` (Dialysis
repo) has merged — this prompt calls the resolver that one ships.

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P17 PDR14 (this finding, measured 2026-09-11) and PDR2/PDR3/
PDR6/PDR13 (the specific symptom this unblocks) · `PDR14a-dia-canonical-property-redirect.md`'s shipped
response, for the exact shape of `dia_resolve_property_id` (or whatever it ended up named) · wherever
`entities.metadata.domain_property_id` is read today (`get_property_context`'s property-context
assembly path is the one already exercised by this investigation — find it and any siblings).

## Why this, why now

LCC's `entities.metadata.domain_property_id` is a one-way pointer into dia's `properties` table, set
once and never revisited. When dia merges/drops a property row, LCC never finds out. Measured live
2026-09-11: **89 of 1,245 dia-linked LCC entities (7.1%) already point at a property_id that no longer
exists** — including, right now, the DaVita/Donna-TX property this whole PDR arc has been tracking,
where `get_property_context` currently returns `documents: []`, `lease_data: null`, `transactions: []`,
and null ownership — a **regression** from PDR1's own confirmed fix (PDR4 was showing 3 documents as of
2026-09-10; it shows zero again today, silently, with no error anywhere in the app).

Root-cause investigation (see PLANNED-BACKLOG.md PDR14) found only 28 of the 89 trace to a known dia
merge ledger; the other 61 are unexplained, likely (not certain) pre-dating dia's own audit logging.
**Scott's direction: build for correctness regardless of whether the 61's cause is ever known, and make
the two databases actively reconcile with each other going forward, in both directions — not a one-time
patch.**

## 1. One-time sweep, using PDR14a's canonical resolver

For every LCC entity with `domain='dia'` and a `metadata.domain_property_id` that does not resolve in
dia's live `properties` table, call `dia_resolve_property_id` (from PDR14a). Where it returns a live
survivor, update `entities.metadata.domain_property_id` to the resolved id (record the correction —
`metadata.domain_property_id_corrected_from` and a timestamp, or whatever pattern this repo already uses
for a value that gets silently repaired, so the change is auditable, not silent). Report the real count
resolved this way before moving to step 2 — expect it to land close to the 28 measured, not assume more.

## 2. Fallback: confident re-resolution for cases with no redirect trace

For entities PDR14a's resolver can't explain (the ~61), attempt a confident re-resolution against dia's
live `properties` by address + parcel/CCN, mirroring PDR13's own strong-id scoring approach (do not
invent a new scoring scheme — reuse or closely mirror that one, since it was already measured and
guard-tested against this same class of problem). **Do not lower the bar to resolve more of them** — a
wrong auto-repoint here silently reattaches an entity's whole history (documents, activity, deals) to
the wrong physical property, worse than the current visible-empty state. Where no confident match exists,
leave the entity's `domain_property_id` alone but flag it (see step 3) rather than guessing. Report the
real split: N resolved via PDR14a's redirect / N resolved via confident fallback match / N flagged with
no resolution.

## 3. Ongoing monitoring — this can never again go unnoticed for months

Build a way for a dangling `domain_property_id` to surface immediately rather than silently degrade the
app, in both directions:
- A recurring check (mirror this repo's existing flag-gated tick pattern — GET ungated dry run / POST
  gated behind a new flag) that re-scans all `domain='dia'` entities (and, if the same class of gap could
  exist there, `domain='gov'` entities against the government database — check whether it does before
  assuming symmetry) for a `domain_property_id` that no longer resolves, and either self-heals it (steps
  1–2's logic, applied going forward) or logs it to a reviewable queue.
- Consider whether `get_property_context`'s own resolution path should opportunistically self-heal
  inline when it notices a dangling pointer during a normal read (cheap, since it's already fetching) —
  weigh this against just relying on the recurring sweep, and say which you chose and why.
- Whatever the shape, this needs to be genuinely visible — a STATUS-style signal, a Decision Center lane,
  or a metric on an existing dashboard, not a table only a SQL query would ever surface. Match this
  repo's existing pattern for something that needs a human's attention rather than inventing a new one.

## 4. What NOT to do in this pass

- Do not attempt to determine the cause of the 61 unexplained cases from before — that investigation is
  done; build for correctness regardless.
- Do not touch `PDR2` (the ownership guard-gap in `api/operations.js`'s `assemblePropertyPacket()`) —
  unrelated, filed separately, much larger blast radius (4,026 properties), its own prompt.
- Do not build a new merge/scoring mechanism from scratch for the fallback in step 2 — reuse PDR13's
  strong-id approach or explain concretely why it doesn't fit.

## Guard + ship

Mutation-guarded tests: an entity with a live `domain_property_id` is never touched. An entity with a
resolvable dangling pointer gets corrected exactly once, auditably. An entity with no confident match is
flagged, never guessed. Positive control: confirm live, after this ships, that `get_property_context` for
entity `d90be440-c4f2-4e6c-a50e-8a0be44c9d76` (DaVita/Donna-TX) correctly shows `domain_property_id=39874`
and that documents/transactions/ownership populate again — this is the acceptance test PDR3/PDR6 have
been waiting on since PDR13 shipped.

## Ship + record

Branch of your choice. `STATUS.md` entry naming the real resolved/fallback-matched/flagged split.
`PLANNED-BACKLOG.md` PDR2 (unaffected), PDR3/PDR6/PDR14 rows updated from "blocked by PDR14" to their
real, live-confirmed outcome.
