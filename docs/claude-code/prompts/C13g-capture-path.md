# C13g — the entity_type capture-path fix (the real defect, not the per-row patch)

**Read first:** `docs/audits/C13c_ONE_OFF_OWNER_CONFIDENCE_2026-09-01.md` · `docs/architecture/owner-role-classification.md`
§9 (all of it — the whole C13g-min/lane/mutation/placeholder arc is the patch this prompt is meant to
make unnecessary) · `docs/architecture/entity-identity-and-dedup.md` (canonical for `ensureEntityLink`,
duplicate-mint rates — the same discipline applies to type-mint rates) · `docs/architecture/ownership-truth-pipeline-state.md`
(this row is named there as the single highest-leverage open item in the whole ownership pipeline) ·
`docs/os/PLANNED-BACKLOG.md` row `C13g`.

## Why this, now

Over the last two days, 13 entities were hand-retyped from `person` to `organization` through the
`entity_type_review` Decision Center lane — real fixes, each reversible and decision-logged. But the
lane refills: C13c's sizing put the non-lexical floor at **414 of 56,192 entities (0.74%)**, and the
only defensible estimate from a hand-read sample is **~1,950**. Every retype done by hand through the
lane is bailing a boat with a hole nobody has patched. This prompt is that patch.

## What's already known — do not re-derive it

C13c already identified the SHAPE: **115 of a 142-row sample carry `rca/contact`, 32 carry
`costar/contact`** — the deal-record party slot where a COMPANY is captured as a "contact," and
whatever writes `entities.entity_type` from that party slot defaults or infers `'person'`. What is
NOT yet known and IS this prompt's job: which code path actually does that write, whether it's one
producer or several, and whether the fix is "stop defaulting to person" or "infer type from the party
slot's own semantics" (a `rca/contact` row that names an LLC is not evidence of personhood).

## 1. Find the producer(s) — read before writing

`grep -rln "entity_type.*'person'"` across `api/` turns up **eleven** files (`intake.js`, `operations.js`,
`sync.js`, `_handlers/contact-acquisition.js`, `_handlers/contact-writeback.js`,
`_handlers/entities-handler.js`, `_handlers/owner-contact-enrich.js`, `_handlers/search-handler.js`,
`_shared/action-schemas.js`, `_shared/cadence-engine.js`, `_shared/institution-registry.js`,
`_shared/sf-list-import.js`) — that is a starting list, not a conclusion; several of these are
consumers or schema validators, not the producer that actually inserts a new `entities` row from an
RCA/CoStar transaction-vendor party slot. Trace `ensureEntityLink` (or whatever the real entity-mint
call is — read `entity-identity-and-dedup.md` first) back to its RCA and CoStar callers specifically,
since those are the two sources C13c measured. Name the ACTUAL producer(s) in the response before
touching anything — if it turns out to be more than one distinct code path, say so; do not assume a
single fix covers both.

## 2. Measure before fixing

For whichever producer(s) you find: what does the RCA/CoStar payload actually carry that could signal
organization-vs-person at capture time (a company-suffix in the name, a `contact_type` field, an
absence of a first/last name split, whatever the raw payload shape is)? Read a real sample of the
raw payloads for the 115+32 measured rows (or a fresh equivalent sample if that one isn't preserved) —
do not guess at the payload shape from the schema alone. State the blast radius of any change: how many
of the ~56,192 entities would this touch going forward, and does the fix risk mistyping anything
currently correct (a genuine person captured through the same party slot)? If a clean signal doesn't
exist at capture time, the honest fix may be "leave `entity_type` unset/null at capture and let the
existing classifier + retype lane resolve it" rather than inventing a new heuristic — decide and say
which, with the measurement that justifies it.

## 3. Fix + guard

Whatever the fix, it must be defensible against the same standard as every prior unit in this arc:
reversible where it touches existing rows (do not bulk-retype live entities from here — that's the
lane's job, human-verdicted), a positive control on real data, and a regression guard proving the
producer no longer mints the defect (seed a synthetic RCA/CoStar-shaped payload naming an obvious
company, confirm it does NOT write `entity_type='person'`; a real person payload still resolves
correctly). If existing entities are newly detectable as mistyped once the producer is fixed, that's
new population for the EXISTING `entity_type_review` lane — do not build a second retype path.

## 4. Ship + record

Branch `build/c13g-capture-path`. STATUS.md entry naming the actual producer(s) found (this is the
main thing worth recording — the current docs only have the SHAPE, not the mechanism). Backlog row
`C13g` — do not mark it ✅ unless the fix is actually deployed and the guard is green; if this turn
only gets through §1–2 (investigation), say so plainly and leave it 🟠 with the finding recorded,
rather than overstating what shipped.
