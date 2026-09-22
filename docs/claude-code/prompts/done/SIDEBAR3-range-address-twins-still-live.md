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

## Response (2026-09-22, Cowork)

**Identification (part 1) — all three measured live before any write:**

| twin (range address) | survivor (single number) | evidence |
|---|---|---|
| **37640** `4550-4666 S Kirkman Rd`, Orlando FL | **22887** `4578 S Kirkman Rd`, medicare_id 682661, 24 chairs, 4 leases | 37640 is a whole-**shopping-center** CoStar sidebar capture, not a lease-junk header-row class — 50 of its 51 leases are `status='superseded', is_active=false, data_source='costar_sidebar'`, one row each for Publix, Burger King, Subway, State Farm, etc. (the center's other tenants). Its **one active lease** is `DaVita Kidney Care`, `lease_start 2017-12-31`, `data_source='costar_import'` — a duplicate of the real clinic already on 22887 (which carries `Davita Metrowest Dialysis`, active to 2028-06-30). Confirmed: 22887 is the survivor. |
| **51243** `920-1000 S Washington Ave`, Scranton PA | **28547** `920 South Washington Ave`, medicare_id 392761, 13 chairs, 2 leases | Exactly the RECON1/Banning shape — twin has 0 leases, 1 sale ($2.1M, 1998); survivor has the real DaVita Commonwealth Dialysis lease history. |
| **39982** `2604 N Hospital Rd`, Goldsboro NC | **NO real sibling among the candidates named in the prompt** | `27677` (`2609 Hospital Rd`, 5 leases/5 sales) is **not** 39982's twin — different street number, and its lease history mixes **both** a DaVita lease AND a superseded `Fresenius Medical Care` lease (`lease_id 14242`, same `annual_rent 190806.96`, same `lease_expiration 2030-10-31`). 39982 carries the **active** version of that exact Fresenius lease. Read together: 39982 is a genuinely distinct Fresenius facility at 2604, and the superseded Fresenius row on 27677 is a smaller, separate data-quality residue (an old capture that landed the wrong tenant on the DaVita property before self-correcting) — not a duplicate-property defect. **Not merged.** Separately: 39982's `canonical_property_id` points at **39111, which does not exist** in `properties` — a dangling reference, left untouched here (out of this prompt's scope; flagging for its own small fix).

**Merges run (part 2), via `dia_merge_property_reversible(keep, drop, batch_tag)` — the exact RECON1 machinery, no new code:**

- `dia_merge_property_reversible(22887, 37640, 'sidebar3_kirkman_20260922')` → `backup_id 596`. 51 leases, 1 loan, 2 contacts, 1 ownership_history row, 2 llc_research_queue rows, 1 property_document, 1 sale, 2 property_public_records, 1 property_metadata_backfill_queue row all repointed to 22887. **0 collisions, 0 dedup-dropped, 0 set-null.** `merge_function_version: dia_merge1_fold_on_collision_2026_09_05`.
- `dia_merge_property_reversible(28547, 51243, 'sidebar3_scranton_20260922')` → `backup_id 597`. 1 loan, 2 ownership_history rows, 1 llc_research_queue row, 1 property_document, 1 sale, 2 property_public_records repointed to 28547. **0 collisions.**

Both dropped rows (37640, 51243) confirmed gone from `properties`; both backups are in `dia_property_merge_backup` and reversible with `dia_unmerge_property(596)` / `dia_unmerge_property(597)` if ever needed.

**Part 3 — Scott's re-send verification: NOT done in this round.** That step needs Scott to actually re-trigger the CoStar sidebar sends for Goldsboro / Orlando / Dixon / Scranton and this session to read the resulting payload + written row per send — it is an action on his side, not something triggerable from here. **Parked, next step named:** once Scott re-sends the Orlando (Kirkman) and Scranton leases, confirm they land on 22887 and 28547 respectively (not re-minting a range-address row — `SIDEBAR2-b`'s create-path fix should already prevent that, but this is the first real-traffic check of it against these two specific addresses).

**Part 4 — 39982:** documented above as its own finding rather than forced into a merge. It is NOT a range-address parsing defect either (its own address `2604 N Hospital Rd` is a plain single-number address, not a range) — it is simply an unrelated, adjacent Fresenius facility that happens to share the street with a DaVita clinic captured earlier as 27677 with some contaminated Fresenius lease residue. No write made to 39982 or 27677 this round.

**Not done / parked:** the dangling `39982.canonical_property_id = 39111` (nonexistent row) was found but not touched — outside this prompt's stated scope; worth a one-line fix in a future round (`SET canonical_property_id = 39982` or `NULL`, whichever the canonical-id convention prefers).
