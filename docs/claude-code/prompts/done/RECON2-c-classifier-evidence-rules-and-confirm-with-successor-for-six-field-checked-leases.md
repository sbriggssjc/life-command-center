# RECON2-c — evidence rules from the field checks, and the first ledgered confirmations: six leases, two plain, four with a successor

**Filed:** 2026-09-18 (Cowork round 38). **Owner:** LCC (`supabase/migrations/dialysis/`, `test/`, `docs/architecture/reconcile-property-spec.md`).
**Read first:** `docs/audits/RECON2-b-confirmed-expired-leases-review-2026-09-18.md` (Scott's per-row field checks —
the evidence this round writes), the RECON2 / RECON2-b migrations, spec R5, backlog `RECON2-b`, `RECON2-c`, `SIDEBAR-LEASE1`.

## Scott's rule (unchanged)
> Let's only allow leases to go inactive once we have confirmation that the lease expired.

## Measured (Cowork, 2026-09-18)
- Row 1 (lease 23273, Sierra Vista): the clinic on the lease's property 22471 is CCN 32654 **Fresenius**, `closed`,
  `dedup_status = demoted_duplicate`; the operating **DaVita** clinic (CCN 032520, seen 2026-01-22) is on **property
  35849** — the same address as an R1 twin. CoStar: lease active; DaVita locator: operating. The classifier's
  strongest "confirmed" row was another operator's demoted duplicate on a twin row.
- Rows 3/5/6/7 (Goldsboro 27677, Orlando 22887, Dixon 25464, Scranton 28547): operating clinics with an **active
  CoStar lease** (Orlando to **Jun 2028**) that is not on the record; the old rows read `Terminated` / expired.
  Scott's sidebar sends (15:43–16:05 UTC) touched twin rows (37640, 51243, 39982) and wrote **no lease expiration**.
- Rows 2 (DC, relocated to 920 Bladensburg Rd NE) and 4 (Cartersville, a restaurant since 2019): expired for real.

## Build
1. **Classifier rules** (`dia_recon2_classify_expired_leases`, migration + tests):
   (a) never read a `medicare_clinics` row with `dedup_status = 'demoted_duplicate'` as evidence;
   (b) `cms_closure` requires the clinic's `chain_organization`/operator to resolve to the lease's tenant
   (`dia_resolve_operator` / `dia_norm_owner_name` path) — a different operator's CCN says nothing about this lease;
   (c) read clinic evidence across the property's **R1 twins** (same normalised street number + street, different
   `property_id`) and, if a twin carries an operating clinic for the tenant, propose `expired_unconfirmed` with
   *"operating on twin <id>"*, never confirmed;
   (d) emit a `conflict` flag when any two sources disagree.
2. **Evidence rows.** `expiration_evidence` becomes an array of `{source, observed, observed_date, recorded_by}` with
   `source ∈ costar_lease, operator_locator, google_hours, cms, deed, sale_om`; write Scott's seven field checks from
   the audit file verbatim (recorded_by `scott`, date 2026-09-18).
3. **Confirmations, ledgered, through `dia_recon2_confirm_lease_expired()`:**
   - lease **23506** (DC) → `expired_confirmed`, evidence cms + operator_locator (relocated to 920 Bladensburg Rd NE);
   - lease **6912** (Cartersville) → `expired_confirmed`, evidence operator_locator/google (restaurant since 2019);
   - leases **23259, 12599, 12678, 13058** → **confirm-with-successor in one transaction each**: insert the successor
     lease (tenant as on the old row, `lease_expiration` = CoStar value — Orlando **2028-06-30**; Goldsboro / Dixon /
     Scranton **`expiration_unknown`** until Scott supplies the CoStar date, `data_source = 'costar_field_check'`,
     `parent_lease_id` → old row, `source_confidence = 'documented'`), then confirm the old row. If the successor
     cannot be inserted, do not confirm. Never leave an operating clinic with zero active leases (Banning).
   - lease **23273** (Sierra Vista) → **no write**; `expiration_state` stays `expired_unconfirmed`, evidence rows
     recorded, conflict flagged; file the 22471 ↔ 35849 twin on the RECON1/R1 list.
4. **Re-run the dry-run**, report counts per state × evidence, and the new (shorter) confirmed list.
5. Amend spec R5 with (1)–(3) and the two-source bar: *no `expired_confirmed` on a single source.*

⛔ No date-only inactivation. ⛔ No guessed expirations — `expiration_unknown` is the honest value. ⛔ STATUS entry
labelled **(CC)**; STATUS/backlog only as on `origin/main` at commit time. **Parked:** one line each.
