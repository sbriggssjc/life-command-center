# SEC1-property — the property merge/unmerge pair is SECURITY DEFINER and anon-executable on BOTH domains

**Repo: `life-command-center`.** Targets **dia `zqzrriwuavgrquhisnoa`** and **gov
`scknotsqkcheojiaewwh`**. **Small, sharp, and one of the few remaining items where a mistake is
irreversible in the wrong direction** — over-revoking silently breaks a live caller, under-revoking
leaves a destructive function reachable by `anon`.

**Read first:** `CLAUDE.md` § ENTC (`lcc_p195_unmerge` / `lcc_unmerge_entity` / `lcc_a2a_unmerge`
were narrowed to `service_role` on 2026-09-03 — the same class, already solved once for ENTITIES)
and § "the provenance ladder" bullet on `REVOKE` (both halves of the trap) → backlog
**SEC1-property**, **SEC1** → `docs/architecture/costar-sidebar-capture-pipeline.md` §3.

## The measured state (2026-09-04)

| function | domain | definer | anon EXECUTE | note |
|---|---|---|---|---|
| `dia_merge_property_reversible` | dia | ✅ | **true** | mutates every FK to `properties` |
| `dia_unmerge_property` | dia | ✅ | **true** | |
| `gov_merge_property_reversible` | gov | ✅ | **true** | |
| `gov_unmerge_property` | gov | ✅ | **true** | |
| `dia_merge_property` | dia | ✅ | false | already locked — the precedent |
| `gov_merge_property_apply` | gov | ✗ | false | **locked in Cowork 2026-09-04** after the ADDR1b-merge rename left it open |

**ENTC narrowed the three ENTITY unmerge functions for exactly this reason.** The PROPERTY pair was
never given the same pass, and it is arguably more dangerous: a property merge repoints sales,
leases, deeds, listings and documents in one call.

## Do this

1. **Census the callers first, and do not assume zero.** Grep `api/`, `supabase/functions/`,
   `scripts/`, and the cron commands (`cron.job`) for each of the four names. ⚠️ **A PostgREST
   `rpc/` call from the browser runs as `anon` or `authenticated`** — if the Decision Center's
   `property_twin` lane invokes `dia_merge_property_reversible` from the client, revoking `anon`
   **breaks that lane**. `CLAUDE.md`'s property-twin section says the verdict path is
   server-mediated via `domainQuery` (service key), which would make this safe — **verify that, do
   not take my word or the doc's**. Report the caller list per function before changing anything.
2. **Revoke from `public` AND `anon` AND `authenticated`** — all three, in one statement per
   function. The documented trap has two halves and this repo has paid for both: `REVOKE … FROM
   public` does **not** remove the explicit role grants Supabase's `ALTER DEFAULT PRIVILEGES` adds at
   CREATE time, and `REVOKE … FROM anon, authenticated` does **not** remove the PUBLIC grant (the
   leading `=X` in `proacl`). Handle every overload — iterate `pg_proc` by `proname`, not a
   hand-written signature.
3. **Assert with `has_function_privilege()`, never by reading the REVOKE you just wrote.** Report
   `proacl` before and after for each. Expected after: `{postgres=X/postgres, service_role=X/postgres}`.
4. **Do NOT touch `compute_feed_freshness`-style functions that keep an explicit `anon` grant BY
   DESIGN** — `CLAUDE.md` names one where revoking `anon` would silently blind the freshness monitor.
   This prompt is scoped to the four property merge/unmerge functions **only**.
5. **Commit the change as a migration on both domains** so a rebuild reproduces it — a privilege
   applied only live is invisible to the repo (the "running but not merged" class).

## Then: the wider SEC1, sized only

Backlog **SEC1** records **91 of 195 SECURITY DEFINER functions anon-executable** on LCC Opps (filed
by PR8, never worked). **Re-measure that number on all three projects and bucket it** — how many are
(a) mutating, (b) read-only, (c) deliberately anon by design like the freshness monitor. **Do not
revoke anything outside the four.** The deliverable is a bucketed count so the real pass can be
scoped; a blanket revoke across 91 functions is exactly how a monitor goes silently blind.

## Verify on

- Caller census per function, with the property-twin lane's invocation path named explicitly.
- `proacl` and `has_function_privilege('anon'|'authenticated'|'service_role', …)` before/after, all four.
- Migrations committed on both domains.
- The property-twin lane still works (or is confirmed server-mediated and therefore unaffected).
- SEC1 re-measured and bucketed across the three projects; nothing outside the four revoked.

## What NOT to do

- Do not revoke beyond the four functions. Do not touch functions with a documented deliberate `anon`
  grant. Do not apply live without committing the migration.

## Report back

The caller census · before/after privileges asserted with `has_function_privilege` · the twin-lane
verdict · the SEC1 bucketed re-measure · anything that outranks this.
