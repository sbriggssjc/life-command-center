# CONTACTS-GOV-WRITER — something still writes the retired gov `unified_contacts` copy (split brain)

Backlog: `CONTACTS-GOV-WRITER`. Source: DOCMAP3 agent read of `CONTACTS_SPLIT_BRAIN_*`, re-measured by CC on 2026-09-24. Read the backlog row first; it holds the measurements.

## Measured (CC, 2026-09-24)

- `CONTACTS_HUB=ops` made LCC Opps canonical on 2026-08-17.
- The gov `unified_contacts` copy still has **30,874** rows. **165** were created and **877** updated since 2026-08-18; the newest was created at 2026-09-24 01:53 UTC.
- Root `CLAUDE.md` called that copy frozen (corrected in DOCMAP3).
- `contact_merge_queue` on gov has the same shape (see the `CLAUDE.md` P184 note).

## Ask

1. **Find every producer.** Candidates:
   - Supabase `edge_logs` / `postgres_logs` on gov: PostgREST writes to `unified_contacts` / `contact_merge_queue`, grouped by user agent and IP.
   - `pg_cron` jobs and triggers on gov that insert into `unified_contacts`.
   - LCC code: `domainQuery('government', …unified_contacts…)`.
   - The government-lease repo's jobs.
   - Power Automate: the flow registry.
   - Name each writer, with evidence.
2. **Repoint or stop each one** so it writes the LCC Opps hub, with the same fields and the same dedup, or is retired if it's redundant. Don't delete gov rows.
3. **Reconcile the 165 created / 877 updated rows** into LCC Opps. Use the hub's own merge path (whatever `CONTACTS_HUB=ops` introduced), dry-run first, and report matched / new / conflict counts. Conflicts stay rendered as "Conflict", never resolved by guess.
4. **Guard.** After the fix, a gov trigger or check that makes new writes to the retired copy loud (log + alert, or a refuse if safe). Test it.

## Done means

- Backlog row updated with the evidence.
- Gov migrations recorded in government-lease.
- Deploy = redeploy BOTH Railway services if LCC code changes.
- Report the writers found, what changed for each, and the count of new gov writes 24 hours later (Cowork re-measures).
