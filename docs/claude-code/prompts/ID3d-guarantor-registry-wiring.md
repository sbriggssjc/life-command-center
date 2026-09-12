# ID3d — Wire `leases.guarantor` to the (already-existing, empty) `guarantors` registry — a resolver of its own, never the operator alias table

**Repo: `life-command-center`.** Scott's #4 identity class (2026-09-12, ranking: ID3a → ID3e → ID3b → **ID3d** →
ID3c-last). Dialysis_DB. Same wiring shape as ID3a/ID2a: a registry table and an FK column already exist,
neither is used. **The trap here is sharper than ID3a's: the tempting shortcut (reuse ID2a's operator alias
table) is measured live to be actively WRONG for this column, not just incomplete.**

**Read first:** `docs/os/PLANNED-BACKLOG.md` ID3d, ID1, ID2a rows · the ID2a migration (registry + alias + resolver
+ hard guard + reviewed backfill — the pattern to copy, NOT the table to reuse) · the ID3a audit for "measure the
traps before touching anything."

## Why this, why now

Measured live against Dialysis_DB (Cowork, 2026-09-12):

- `leases.guarantor` (free text): **713 of 12,833 leases carry a value, 169 distinct strings** — matches ID0's
  original count, this population hasn't drifted.
- `leases.guarantor_id` (integer FK column, already exists): **1 of 12,833 leases populated.** Unwired, same shape
  as ID3a's `properties.agency_id` before that build.
- A dedicated **`guarantors` registry table already exists** with exactly the right shape for this job —
  `name`/`guarantor_name`/`normalized_name`, `guarantor_type`, **`parent_company_id`** (subsidiary → parent
  linking, self-referential — the exact mechanism this row's own scope note asked for), `true_owner_id`,
  `contact_id`. **It carries ONE row.** Nothing is wired to it; nothing is seeded into it.

**The trap, confirmed live — do not take the obvious shortcut:** `dia_operator_aliases` (ID2a's operator alias
table) would resolve **17 of the 169 guarantor strings (189 of 713 rows, 26%)** if naively joined against it. But
reading which 17: `Total Renal Care, Inc.`, `DVA Healthcare Renal Care, Inc.`, `DVA Renal Healthcare, Inc.`,
`Renal Treatment Centers-Southeast, L.P.` **all resolve to `operator_id=4` "DaVita" as pure aliases** — the
operator table treats these DaVita subsidiaries as interchangeable with the parent, which is correct for
"who operationally runs this clinic" but **wrong for "who legally signed this guaranty."** A guarantor is the
specific legal entity on the hook — `Total Renal Care, Inc.` is a real, distinct signer from `DaVita, Inc.`, even
though DaVita owns it. **Blindly pointing `guarantor_id` at the operator alias resolution would silently erase
that legal distinction on exactly the credit-critical column this row exists to protect.** This is why ID3d's own
original scope note said "do not assume ID2's `operator_id` backfill closes this" — now measured and confirmed,
not just asserted.

**A second, separate bucket, also confirmed live:** **114 of 713 rows (16%) carry a GENERIC placeholder, not a
party name** — `Corporate` (74), `Corporate Guarantee` (33), `corporate` (3), `Corporate Signature` (2),
`Corporate Guarantee, Credit Rated` (2). These mean "a corporate guaranty exists, entity unspecified" — they are
not an unresolved identity to chase down, and must never be force-matched to any specific company. Route them to
their own sentinel value, separate from both "resolved" and "review."

## 1. Measure before wiring (repeat live — the numbers above are a 2026-09-12 snapshot)

Re-run the counts above. For the 169 distinct strings, confirm the DaVita-family spellings (`DaVita, Inc.` /
`DaVita Inc.` / `DAVITA, INC.` / `Davita Inc.` etc. — ~230 rows across the top-40 alone) and the Fresenius family
(`Fresenius Medical Care Holdings, Inc.` / `FMCH, Inc.` / `Fresenius Medical Care Holdings` etc. — ~180 rows) as
true spelling variants of ONE legal guarantor entity each (verify FMCH really is Fresenius Medical Care Holdings,
not a different Fresenius subsidiary, before folding it in). Separately confirm the subsidiary set (`Total Renal
Care, Inc.`, `DVA Healthcare Renal Care, Inc.`, `DVA Renal Healthcare, Inc.`, `Renal Treatment Centers-*`) as
**distinct guarantor entities that should each get their own `guarantors` row with `parent_company_id` pointing at
the DaVita guarantor row** — never merged into it.

## 2. Wire it (the ID2a pattern, a NEW alias table — do not extend `dia_operator_aliases`)

- Seed `guarantors` from the enumerated, evidence-backed spelling groups above (DaVita family → one row; Fresenius
  family → one row; each subsidiary → its OWN row with `parent_company_id` set to the relevant parent's
  `guarantor_id`).
- A dedicated `dia_guarantor_aliases` table (raw string → `guarantor_id`, provenance) — new, parallel to
  `dia_operator_aliases`, never a join against it. One resolver, `dia_resolve_guarantor(text)`, mirroring
  `dia_resolve_operator`'s fail-closed shape (never mints, hop-capped, returns null on anything not an exact/alias
  match).
- Backfill `leases.guarantor_id` from it. **Auto-apply only exact/alias matches on named entities; the 114
  generic-placeholder rows go to a distinct `guarantor_id` sentinel (or a `guarantor_kind='generic'` flag) — never
  into the review lane as if they were unresolved names, and never auto-matched to any company.** Report the
  three-way split (auto-resolved / generic-placeholder / genuinely-unresolved-review) up front.
- Hard write guard on `leases.guarantor_id`/`guarantor`, matching ID2a/ID3a's shape.
- Parity view: lease counts per guarantor before/after — the only movement should be spelling variants merging;
  no subsidiary should ever end up pointing at the same row as its parent.

## 3. What NOT to do

No agency/owner/broker work (ID3a/ID3b shipped or in flight; ID3c waits on BR1–BR5). No extending or joining
against `dia_operator_aliases` for this column — that IS the trap this measurement found; build a parallel
resolver, don't reuse the operator one, even though it looks like less work. No detector generalization here —
that's ID4's call once this is the third proven population. No touching `guarantors.true_owner_id`/`contact_id` —
out of scope, those are separate identity surfaces.

## Guard + ship

Tests: the subsidiary-vs-parent non-merge (the DaVita-family case above must NOT collapse `Total Renal Care, Inc.`
into `DaVita`'s row), the generic-placeholder routing (must NOT auto-match to any company), alias resolution on
fixtures, guard rejection, backfill three-way split. Full suite green. Branch → PR → CI → merge (no Railway
redeploy needed unless a consumer changes).

## Ship + record

Report: the spelling-variant collapse (DaVita family, Fresenius family — before/after counts), the subsidiary rows
created with their parent links, the generic-placeholder count routed to its sentinel, FK coverage before/after,
and the review lane left for a human. Update `PLANNED-BACKLOG.md` (ID3d), `STATUS.md`, `CURRENT-STATE.md`.
