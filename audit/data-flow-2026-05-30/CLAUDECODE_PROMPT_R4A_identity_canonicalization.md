# Claude Code prompt — R4-A: external_identities canonicalization (4th alias-class fix, systemic)

Paste into Claude Code, run from the **life-command-center** repo. Found in the
2026-06-04 round-4 live audit. This is the dia/gov alias bug class, 4th
occurrence, worst form: it fragments the entity graph itself.

---

## Verified evidence (LCC Opps, 2026-06-04 — don't re-investigate)

`external_identities` domain-DB rows use FIVE source_system spellings and two
source_type conventions for the same concepts:

```
gov_supabase/true_owner 3,397 · dia_db/property 1,341 · gov_db/property 1,178
dia_supabase/true_owner 631 · dia_supabase/asset 348 · email_intake/property 231
gov_supabase/asset 3
```

(Non-domain rows — costar/rca/salesforce/crexi/loopnet — are fine; leave them.)

**Proven symptom:** the new create-from-intake flow (PR #1044) wrote dia prop
44309's identity as `(dia_db, property)` → the unified detail page (which
checks the `dia` + `asset` convention used by ensureEntityLink/E2E#6 cleanup)
renders "(Unknown)" header, "Showing summary from search record", "LCC Entity
Not Registered" and "Ownership Not Resolved" — all FALSE: entity
`dd832dde-90d6-4291-aff6-28ffc2c6d6a2` exists and is linked, listing 12772 is
active, lease + broker contacts landed. Every om_intake-created property gets
this degraded detail experience, and cross-flow dedupe misses these identities.

## Task

1. **Pick the canonical scheme and document it** in CLAUDE.md (suggest:
   `source_system IN ('dia','gov')` for domain DBs — matching the BD engine's
   canonical short forms from migration 20260603130000 — with `source_type IN
   ('asset','true_owner','property')` kept as-is BUT define which one each
   flow uses: asset = the property-anchor entity; property = a property-record
   identity; true_owner = owner-entity identity. If the codebase reality is
   that 'asset' and 'property' mean the same thing for domain rows, collapse
   to one and say so.)
2. **Migration on LCC Opps** (idempotent): normalize existing rows —
   `dia_db|dia_supabase → dia`, `gov_db|gov_supabase → gov`; `email_intake`
   rows: keep a provenance trace (e.g. metadata/note) but normalize
   source_system the same way if they point at domain property ids. Handle
   unique-constraint collisions (same entity+system+id existing under two
   spellings) by keeping the older row and deleting the duplicate — log counts.
3. **Writer sweep:** find every code path that INSERTs `external_identities`
   with a domain-DB source_system (create-property/intake promoter wrote
   `dia_db`; check sidebar pipeline, entity-link helpers, BD sync, email
   intake) and route them ALL through one shared helper (e.g.
   `canonicalIdentitySystem(domain)`) so a 6th spelling can never appear.
   Add a CHECK constraint or trigger on external_identities limiting
   source_system to the known set (canonical domains + external vendors) so
   bad writes fail loudly.
4. **Consumer sweep:** detail-page resolution badges, ensureEntityLink,
   any `source_system=eq.` filters in frontend/backend — point them at the
   canonical form (during transition accept both via `in.()` where cheap).
5. **Junk entity-name guard (small, same data-hygiene family):** Priority
   Queue P0.5 shows entity "Seller ContactsCraig Burrows(916) 768-5544 (p)".
   Entity creation/sync lacks a junk-name filter while the sidebar pipeline
   already has `isJunkContactName`. Apply the same class of filter at the
   entity-sync/creation boundary (reject/flag names containing phone-number
   patterns, "Seller Contacts"/"Buyer Contacts" header fragments, emails).
   Disposition the existing junk entity (soft: flag/rename candidate or merge
   queue — do not hard-delete).

## Verify + ship

- After migration: `SELECT source_system, count(*) FROM external_identities
  GROUP BY 1` shows only canonical + vendor systems; zero dia_db/gov_db/
  dia_supabase/gov_supabase remain.
- Live: dia prop 44309's detail shows its real header (815 S. Watson Rd),
  entity-link badge green ("LCC Entity Registered"), and the next-step banner
  instead of the false resolution ladder. Spot-check one gov property whose
  identity was previously gov_supabase.
- A fresh create-property run writes the canonical form.
- `node --check`; `ls api/*.js | wc -l` = 12; migration idempotent; note any
  deploy-ordering (constraint AFTER writer deploy, same rule as always).
