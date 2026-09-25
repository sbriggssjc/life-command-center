# SEC7-PHASE2A — close the two anon write routes CC proved (writable definer views + `WITH CHECK (true)` policies)

Backlog: `SEC7-views`, `SEC7-policy-withcheck` (phase 2a of `SEC7`). Source: SEC7-LEDGERS (CC, 2026-09-24). CC asked Scott whether to close the view route. Cowork recommends yes because it keeps every SELECT; this prompt is that go-ahead once Scott sends it.

## Measured (CC, proven with rolled-back anon writes)

- **Writable definer views** (single-table views without `security_invoker`; the write runs as the view owner, past RLS):
  - anon `UPDATE` through gov `v_ownership_history_portfolio` matched **all 12,697** `ownership_history` rows;
  - through dia `v_sales_feed_portfolio`, **all 5,009** `sales_transactions` rows.
  - Population: dia 9 / gov 7 / LCC Opps 21 views.
- **`USING (service_role) WITH CHECK (true)` policies** let anon INSERT:
  - dia `ingestion_tracker`: one `run_status='watermark'` row can silence CMS ingestion;
  - dia `cmbs_loans`, `cmbs_loan_properties`;
  - explicit anon-write policies on dia `salesforce_accounts`, `lease_rent_schedule` / `_extensions` / `_options`, `facility_patient_counts`, `ingestion_log`, `bd_execution_log`;
  - gov `property_sale_events` (it feeds `sales_transactions`), `research_queue_outcomes`.

## Ask

1. **Writer inventory first.** 7 days of `edge_logs` / `postgres_logs` on each DB: any anon or authenticated `POST/PATCH/DELETE` to a `v_*` path or to the listed tables. Name every writer, and the key and role it uses. The Chrome extension, the SPA (which fetches the LCC anon key at runtime) and Power Automate are the likely anon writers. If a legitimate writer uses anon, route it through the service role or a narrow SECURITY DEFINER RPC **before** revoking, and say which.
2. **Views:** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` from anon/authenticated on all 37 writable views, and keep SELECT. Extend `<dom>_sec7_ledger_privilege_violations()` (or add a sibling) so any writable definer view reachable by anon counts as a violation. The live check reads 0 after.
3. **Policies:** replace each `WITH CHECK (true)` / anon-write policy with `TO service_role` (or a named-role policy where the inventory shows a real non-service writer), one table at a time. Exercise each legitimate writer after its lock (rolled back where possible).
4. **Re-count phase 2** (RLS-off tables writable by anon: dia 58 / gov 48 / LCC 124) and update `SEC7-phase-2` with the next top 10. Don't flip those here.
5. **`SEC7-gov-invoker-views`:** answer whether any `authenticated` reader of gov `v_available_listings` / `v_sales_comps` exists. If none, record that and close the row.

Tests: an anon write through a view fails and a read still works; an anon INSERT on `ingestion_tracker` fails and the service-role writer succeeds; the violations function counts a re-opened hole. Each needs a mutation that turns it red.

## Done means

- The SEC7 rows updated with the evidence.
- Migrations in the repo that owns each DB.
- No Railway deploy unless LCC code changes.
- Say what each broken-then-fixed writer was, if any.
