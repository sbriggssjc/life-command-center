# Warner Robins entity merge — 509 N Houston Rd

Date: 2026-04-27
Round: 76ad
Operator: manual SQL transaction via Supabase MCP

## Symptom

User captured 509 N Houston Rd, Warner Robins, GA from CoStar in the
Chrome extension and the LCC sidebar showed three entities for the same
address:

- `333b451b-...` — created by CoStar sidebar capture (richer relationships)
- `10085f0a-...` — created by OM email intake
- `00ce5405-...` — created by a second OM email intake (re-flagged)

Plus: `Tenants: DaVita, DaVita Kidney Care, Sale Highlights, MD/DDS` —
the OM extractor + sidebar parser were treating section labels as tenant
names ("Sale Highlights", "MD/DDS", "Office/Medical").

## Root cause

1. **Tenant noise** — extractor + extension regexes were missing several
   OM section headers and CoStar UI labels:
   - `Sale Highlights`, `Property Highlights`, `Key Highlights`
   - `MD/DDS`, `MD/Dental`, `Medical/Office`, `Office/Medical`
   - `My Data`, `Shared Data`, `Sale Notes`
   See Round 76ad regex extension below.

2. **Entity duplication** — the OM intake matcher created new entities for
   the two OM email captures because the address had not yet been
   normalized when the CoStar sidebar entity (`333b451b`) was first
   created. The matcher_property_id trust fix (Round 76y) prevents *new*
   duplicates but doesn't retro-merge existing ones — that requires a
   manual merge.

## Resolution

### Code (Round 76ad)

- `api/_handlers/sidebar-pipeline.js` — extended `CLASSIFIER_TENANT_JUNK_RE`
- `extension/content/costar.js` — extended `OM_SECTION_REJECT`

Both regexes now reject the section labels and CoStar UI tokens listed
above.

### Data — entity merge

Kept: `333b451b-...` (CoStar entity with richest relationships).
Dropped: `10085f0a-...` and `00ce5405-...` (OM intake entities).

Pre-merge, copied any non-null OM-only fields onto the keep entity:

- `asking_price` = $1,500,000 (from OM)
- `cap_rate`     = 7.00% (from OM)

Then rewired:

- `external_identities` → keep entity
- `staged_intake_promotions` → keep entity
- `entity_relationships` → keep entity (both source and target sides)
- `entity_aliases` → keep entity

Stamped audit trail on keep entity:

```json
{
  "_merged_from_entities": ["10085f0a-...", "00ce5405-..."],
  "_merged_at": "2026-04-27T...Z",
  "_merge_round": "76ad"
}
```

Drop entities deleted after rewiring.

## Verification

```sql
SELECT entity_id, name, tenant_name, asking_price, cap_rate, domain,
       metadata->>'_merged_from_entities' AS merged_from
FROM entities
WHERE name ILIKE '%509 N Houston%'
   OR address ILIKE '%509 N Houston%';
```

Expected: 1 row — `333b451b` with tenant_name=`DaVita`,
asking_price=`1500000`, cap_rate=`7.00`, domain=`dialysis`.

## Followups

- Round 76ae: wire `upsertDomainLeases` + `upsertDomainProperty` to call
  `shouldWriteField()` (Phase 5 hard enforcement) — so the next time the
  sidebar tries to write `tenant='Sale Highlights'`, the registry blocks
  the UPDATE outright instead of relying on the JS regex alone as the
  last line of defense.
- Watch warn-mode signal in `v_field_provenance_would_block` for one
  week before strict-mode flip.
