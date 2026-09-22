# LEASEJUNK1 — response (Claude Code, 2026-09-22)

Full record: `docs/claude-code/STATUS.md` entry "2026-09-22 — `LEASEJUNK1` (CC)". Summary:

- **Mechanism:** not an OM rent-roll parse. The Tacoma OM extractions are clean. The header strings came from
  `entities.metadata.tenants[]` (the extension's CoStar Tenants-panel parse), and an OM promote merged into that
  entity, so `upsertDomainLeases` wrote them stamped `email_intake`. The 2029-02-28 date is the real DaVita
  lease's expiration, inherited from property-level metadata. It is not a placeholder.
- **Size (dia):** 25 distinct header values / 56 rows / 25 properties / 1 active (lease 18398). The broader
  "≤2 tokens, no operator" heuristic (189 rows / 14 active) is mostly real retailers. Report-only; untouched.
- **Quarantine (live):** `leases.data_quality_flag='om_table_header_tenant'` + `is_active=false` +
  `status='quarantined_header_tenant'`. Prior values are logged in `dia_leasejunk1_quarantine_log`, restorable via
  `dia_leasejunk1_restore_quarantine('leasejunk1_20260922')`. Nothing deleted.
- **Writer fix:** DB BEFORE trigger (every writer) + `isJunkTenant` header list (JS, lock-step with SQL) +
  `firstOfWhere` on both OM promote paths. Readers filter flagged rows.
- **Test:** `test/leasejunk1-header-tenant-guard.test.mjs`: the four Tacoma strings are rejected, real names
  (including "Shopping Center Dialysis LLC") pass, and the SQL/JS lists match; 11/11 mutations RED.
- **Open:** 29671 has no active lease left (DaVita 16828 was already inactive); extension-side reject list;
  CoStar industry-category values as tenants.
