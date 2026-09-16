# ID3d-reconcile — the guarantor-registry migration was applied live from a CC session and committed to the `Dialysis` repo; Dialysis_DB schema lands here

**Filed:** 2026-09-16 (Cowork), reconciling the ID3d round. **Owner:** LCC (`supabase/migrations/dialysis/`),
with a one-file removal PR on `Dialysis`. **Read first:** `CLAUDE.md` → "ONE REPO OWNS EACH DATABASE'S
OBJECTS" (Dialysis_DB schema → `life-command-center`; the `Dialysis` repo owns CMS/NPI *ingestion rows*),
`supabase/migrations/dialysis/README.md`, and `prompts/done/DEED1-reconcile-2-…md` + its response — the
identical incident, fixed the same day, whose CLAUDE.md wording change this round then walked past.

## What the ID3d round did (verified live by Cowork 2026-09-16)

Applied directly to Dialysis_DB via Supabase MCP, no PR first: `guarantors` rows for the DaVita and
Fresenius subsidiaries (parent-linked, never collapsed), `dia_guarantor_aliases` (58), `dia_resolve_guarantor()`,
backfill `leases.guarantor_id` **1 → 628 of 715** (87 to review), a **new FK `fk_leases_guarantor_id`**
(the column was described as an FK and was not), write guard `trg_dia_leases_guarantor_resolve_biu`
(fill-blanks only), parity view `v_dia_guarantor_backfill_parity`. All present live. The result is
right; the record is in the wrong place: migration `20260916120000_dia_id3d_guarantor_registry_resolver.sql`
+ `tests/test_id3d_guarantor_registry_resolver.py` were committed to **`Dialysis`** (PR #7415, merged).

## What to build

1. Port the migration **byte-identical** into `supabase/migrations/dialysis/` here (same timestamp
   name), header-stamped "applied live 2026-09-16 from a Claude Code session before this file existed;
   this file is the record, not a re-apply". Pin the live objects first —
   `md5(pg_get_functiondef('dia_resolve_guarantor'::regproc))`, the trigger definition, the view
   definition — and assert the ported file reproduces them (emit, then hash; do not transcribe).
2. Port the 9 guard tests to `test/` here as `node --test` (they are structural checks over the SQL
   text: subsidiaries get their own parent-linked rows, the generic sentinel routes, `dia_operator_aliases`
   is never joined, fill-blanks only, FK present). Keep the positive control (a mutated resolver that
   joins `dia_operator_aliases` must go RED).
3. Open the removal PR on `Dialysis` (the file + test), citing this prompt and the doctrine, exactly as
   DEED1-reconcile-2's #7414 did.
4. The 87 unresolved guarantor strings: list them by count in the response (no matching, no minting);
   they are the review lane for a later ID3d-b.
5. Add one sentence to `CLAUDE.md`'s doctrine table row for Dialysis_DB: *"applies to a CC session with
   Supabase MCP too — apply from here or not at all"* — so the third occurrence does not happen.

## Prohibitions

- ⛔ Nothing is applied to the database; both hashes must be unchanged at the end. Report them.
- ⛔ Do not re-scope ID3a-d-dia here; it is its own row.
