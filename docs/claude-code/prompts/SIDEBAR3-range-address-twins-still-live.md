# SIDEBAR3 — three range-address twin properties are still live in Dialysis_DB, and Scott's CoStar sidebar sends keep landing on them instead of the real lease-bearing rows

**Filed:** Cowork round 42 (2026-09-17), reconciled and re-confirmed still live 2026-09-22 (Cowork
round 57) — all three twin rows still exist, unmerged, five days later. **Owner:** LCC
(`api/_shared/` merge machinery, `supabase/migrations/dialysis/`). **Read first:**
`docs/architecture/property-identity-and-address-resolution.md` (§P10a), RECON1's response
(`docs/claude-code/prompts/done/RECON1-one-clinic-three-properties-ingestion-never-reconciles.md` —
same defect class, same fix mechanism, different property), the migration that actually ran RECON1's
merge live (`supabase/migrations/dialysis/20260917180000_dia_recon1_banning_clinic_reconcile.sql` —
read its header, it documents the existing `dia_merge_property()` / `merge_function_version
dia_merge1_fold_on_collision_2026_09_05` machinery this prompt should reuse, not reinvent). Backlog
row `SIDEBAR3`.

## What's true (Dialysis_DB, re-verified live 2026-09-22)

`SIDEBAR2-b` fixed the *create* path — the sidebar capture no longer mints a NEW twin when an
address-range form doesn't match a single-number intake. It did not touch the twins that already
existed before that fix shipped. Three are still live, confirmed today:

- `property_id 37640` — `4550-4666 S Kirkman Rd` (51 leases, 1 sale on this row alone — this is
  **not** a small shell like RECON1's Banning shells; treat it as its own investigation, not an
  assumed-empty twin). A same-street single-number row also exists, `property_id 22887` —
  `4578 S Kirkman Rd` (4 leases) — plausibly the Orlando DaVita `RECON2-d` already reconciled lease
  expirations for; confirm before assuming which row (if either) is the true survivor.
- `property_id 51243` — `920-1000 S Washington Ave` (0 leases, 1 sale). A same-street single-number
  row exists, `property_id 28547` — `920 South Washington Ave` (2 leases, 1 sale) — the shape here
  (twin has 0 leases, sibling has 2) matches RECON1's Banning pattern most closely of the three.
- `property_id 39982` — `2604 N Hospital Rd` (1 lease, 1 sale). No obvious exact-match single-number
  sibling turned up in a quick address search (closest is `2609 Hospital Rd`, `property_id 27677`,
  5 leases/5 sales — different street number, may be a genuinely different property, not this one's
  twin). **Confirm whether 39982 has a real sibling at all before assuming it's a RECON1-shaped case**
  — it may be a standalone address-range parsing defect instead (worth documenting either way).

Scott's four re-sends this arc has referenced (Goldsboro / Orlando / Dixon / Scranton, the same four
CoStar leases `RECON2-d` asked him to read expiration dates for) landed on these rows — meaning his
own manual data-quality work from that round may have partly gone into a twin instead of the property
these leases are meant to inform going forward.

## What this prompt asks for

1. **For each of the three properties above, do the identification work RECON1 already modeled**:
   confirm (or refute) which row is the survivor and which is the twin/shell, the way RECON1's own
   migration header laid out its evidence (sale count, lease count, listing count, a completeness
   score) before merging — do not assume symmetry with Banning's exact shape, `37640` in particular
   looks structurally different (51 leases is a lot for one clinic; check whether some of those are
   themselves a different defect, e.g. a `LEASEJUNK1`-shaped header-row class, before merging them onto
   a survivor).
2. **Run the existing ledgered merge path** (`dia_merge_property()` / RECON1's own migration as the
   template) for whichever pairs turn out to be genuine twins — alias the range address onto the
   canonical property, move/verify child rows, a `dia_recon1_run_log` entry, never delete. Reuse
   RECON1's collision/fold machinery rather than hand-rolling new merge logic.
3. **After merging, ask Scott to re-send Goldsboro / Orlando / Dixon / Scranton from CoStar** and show,
   per send, the payload's lease fields and the row actually written (`lease_expiration_source_state`
   stamped) — confirming his re-sends now land on the right property, not just that the merge itself
   ran clean.
4. If `39982` (`2604 N Hospital Rd`) turns out NOT to have a real sibling, say so plainly rather than
   forcing a merge — file it as its own smaller finding (a parsing/address defect, not a duplicate-row
   defect) instead.

⛔ Same discipline as RECON1: no delete, ledgered and reversible, reuse the existing merge function
rather than writing a new one-off. This is `§P10a`'s case in miniature — three rows, not the 27 Harris
situs-gap properties that lane is still working through separately.
