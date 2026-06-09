# Claude Code prompt — E2E#3: cadence owner FK points at auth.users, breaking the whole BD payoff

Paste into Claude Code, run from the **life-command-center** repo. This is a
one-line DB fix on **LCC Opps** (`xengecqvemvfknjvbvrq`) recorded as a migration.

---

## Context (root-caused live 2026-06-03 — don't re-investigate)

Clicking **"Open opportunity →"** on a Priority Queue P0.5 row toasts
`open_opportunity_failed`. The real error (captured from the endpoint):

```
23503: insert or update on table "touchpoint_cadence" violates foreign key
constraint "touchpoint_cadence_owner_user_id_fkey".
Key (owner_user_id)=(b0000000-0000-0000-0000-000000000001) is not present in table "users".
```

Diagnosis:
- `lcc_open_prospect_opportunity` inserts a `bd_opportunities` row → the
  `bd_opportunity_auto_seed_cadence` trigger inserts a `touchpoint_cadence` row
  with `owner_user_id = <caller's user.id>` → **FK violation → whole txn rolls back.**
- The constraint is `touchpoint_cadence_owner_user_id_fkey → **auth.users(id)**`.
  It is the **only** BD-engine owner FK pointing at `auth.users` — `bd_opportunities`,
  `activity_events`, `bd_opportunity_history`, `lcc_onboarding_schedule` have no
  such FK. The app's owner ids live in **`public.users`** (the seeded/dev owner
  `b0000000-…-0001` exists in `public.users` + `workspace_memberships` but has no
  `auth.users` row, since it never went through Supabase auth signup).
- **Blast radius (all three terminal BD actions):** `open_opportunity` hard-fails;
  `initiate_cadence` (Add to cadence) hard-fails; `create_lead` opens its
  `bd_opportunities` insert which fires the same trigger → the opportunity+cadence
  silently fail (the handler logs the opp insert as non-fatal and returns ok, so
  the lead is created but no opportunity/cadence is). **`bd_opportunities` has 0
  rows** — opening an opportunity has never once succeeded in production.

Safe to fix: **305** `touchpoint_cadence` rows, **0** with an `owner_user_id`
absent from `public.users` — re-pointing the FK validates cleanly.

## Fix (LCC Opps migration, idempotent)

Drop and recreate the FK to reference `public.users(id)` instead of
`auth.users(id)`, preserving the existing delete behavior and nullability:

```sql
ALTER TABLE public.touchpoint_cadence
  DROP CONSTRAINT IF EXISTS touchpoint_cadence_owner_user_id_fkey;
ALTER TABLE public.touchpoint_cadence
  ADD CONSTRAINT touchpoint_cadence_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES public.users(id);
```

(If the column is `NOT NULL` keep it; if nullable, consider `ON DELETE SET NULL`
to match the rest of the engine — check the column first and keep behavior
consistent with `bd_opportunities.owner_user_id`.)

Record it as `supabase/migrations/<ts>_lcc_touchpoint_cadence_owner_fk_public_users.sql`
and apply it to LCC Opps (`xengecqvemvfknjvbvrq`).

**Also check** whether any *other* table in LCC Opps still FKs a user/owner column
to `auth.users` while the app populates it from `public.users` (same query I used:
`pg_constraint` where the def references `auth.users` and the column is an owner/
user/actor id). If you find more outliers, fix them the same way and list them in
the PR — this class of bug silently breaks any write through the seeded owner.

## Verify
- After applying: re-run the failing call — `POST /api/operations?action=open_opportunity`
  with a real P0.5 `entity_id` returns **200 `{ ok:true, bd_opportunity_id }`**, and
  a row appears in `bd_opportunities` (was 0). Confirm `initiate_cadence` and
  `create_lead` now also seed the opportunity/cadence without error.
- No app code change required (migration only); function count unaffected.
- End with the merge note (migration file) + confirmation the live RPC now succeeds.
