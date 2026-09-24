# SIDEBAR-AGENCY-OVERWRITE — a sidebar Save must not downgrade an existing gov property's agency, address or dates

Backlog: `SIDEBAR-AGENCY-OVERWRITE`. Source: Cowork round 75 (2026-09-24), live on Saginaw gov 16297 right after the twin merge Scott asked for.

## Measured (Cowork, live)

Cowork force-re-ran LCC entity `6c85fe57…` (Saginaw, 1040 N Towerline Rd) through `/api/entities?action=process_sidebar_extraction` on `a0fe34ab`. It linked correctly to gov **16297**: the existing-record check found one match, and the diag now names Saginaw (the GOV-CLASSIFY1-diag-race fix works). But the property upsert **degraded the existing gov row**:

1. **Agency overwritten.** `agency` and `agency_full_name` went from `Saginaw County Community Mental Health Authority` (the municipal lessee) to the CoStar tenant string `Max System Of Care`, one of the Authority's programs. That string is unresolved in the ID3a registry, so the Available list would have shown an unresolved tenant where a resolved agency stood. **Cowork restored both fields by hand** (pre-run values measured at 09:55 UTC; logged in `gov_property_twin_review` id 2's `decision_note`).
2. **Address lowercased.** Stored `address` went from `1040 N Towerline Rd` to `1040 n towerline rd`. Cowork restored it too. GOV-AVAIL2's display layer hides this, but the stored value regressed.
3. **Capture date written as a transfer.** An `ownership_history` row appeared with `data_source='costar_sidebar'`, `new_owner='JTS Management LLC'`, `transfer_date=2026-09-21` (CoStar's "updated on" date, not a deed), and `properties.latest_deed_date=2026-09-21`. Live population: **13** `costar_sidebar` ownership rows whose transfer date falls within a week of their creation and carry no sale or price.
4. **Stale error on success.** After the run, `_pipeline_status=success` and the summary links 16297, but `metadata._pipeline_last_error` still reads `no_domain` from the failed run days earlier.

Population hint: **307** gov properties with `data_source='costar_sidebar'` have an agency that resolves to neither `agency_canonical` nor `agency_id`. Some of those may be the same overwrite.

## Ask

1. **Find the writer** in `upsertDomainProperty` / the gov update path, then fix it:
   - **Agency:** never replace a registry-resolved agency (`agency_id` / `agency_canonical` present) with a string that doesn't resolve. Put the CoStar tenant string somewhere non-destructive: an existing tenant or occupant field if there is one; otherwise report it and don't add a column.
   - **Address:** don't lowercase stored `address`; match on the normalized key and keep the stored display text.
2. **Ownership:** find why a capture's "updated on" date becomes `transfer_date` / `latest_deed_date`. Fix it, and repair the 13 rows reversibly (log and restore, GOV-AVAIL1 pattern) after reading each one. Anything that is a real transfer stays.
3. **Stale error:** clear `_pipeline_last_error` (and its detail) when a run succeeds, or scope it to the run. Test it.
4. **Measure the 307:** how many had a resolved agency before a sidebar write? Check backups, `provenance_event_log`, or the ID3a alias history, whatever exists; say what's unknowable. Restore only what the evidence supports, logged.

Tests: resolved agency + unresolved tenant string → agency unchanged; address casing kept; capture date not stored as a transfer; error cleared on success. Each needs a mutation that turns it red.

## Done means

- Backlog row updated with the evidence.
- Deploy = redeploy BOTH Railway services.
- Scott re-saves Saginaw once; Cowork checks that 16297 still reads the Authority.
