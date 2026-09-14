# Dossier generation — Ollama wiring, storage & access architecture (2026-08-01)

How the grounded property/deal dossier gets authored by the **local Ollama model** and where it lives so it's
reachable from the app and from the Team Briggs SharePoint. Built against the **existing** LCC machinery — no
new LLM stack, no new storage stack.

## The pipeline (end to end)

```
 property/deal ─▶ PACKET ASSEMBLER ─▶ Ollama author ─▶ HTML ─▶ STORE ─▶ INDEX ─▶ SURFACE
  (entity/id)      (reconciled JSON)   (grounded prose)          (Supabase)  (lcc_dossiers)  (app + SharePoint)
```

1. **Packet assembler** (server) — assembles a reconciled DATA PACKET (the ONLY source of facts) from the
   loaders we already have: `get_property_context` / the property-panel loaders, `leases` (live only),
   `sales_transactions` (live), `available_listings`, CMS `medicare_clinics` + `facility_patient_counts`,
   `census_zcta_demographics`, `v_payer_mix_geo_averages`, `property_demographics`, `action=documents`, and —
   for deals — the deal spine (correspondence/activity_events, offers, `touchpoint_cadence`, ROE,
   `lcc_party_relationships`). Missing fields are **omitted** so the model can never mistake absence for a
   blank to fill.
2. **Ollama author** — `invokeExtractionAI({ prompt })` in `api/_shared/ai.js`. That seam already tries the
   **local Ollama** first (`OLLAMA_URL`, `OLLAMA_MODEL` default `qwen2.5:14b`, temperature 0.1) and only
   falls back to the cloud chain on failure/timeout. The prompt = the grounding contract (§1) + the packet +
   the fixed section list. Because the packet is pre-reconciled and the contract forbids outside data, the
   worst case is "Not on file" — never a fabricated fact.
3. **HTML** — the model returns one self-contained HTML document matching the gold-standard renders.
4. **Store** — `uploadArtifactToStorage(...)` into the **`lcc-om-uploads`** bucket (the same bucket OMs use),
   at `dossiers/<date>/dossier-<kind>-<entity>-<title>.html`.
5. **Index** — a row in **`lcc_dossiers`** (entity_id, dossier_type, storage_ref, format, version, title,
   generated_at, metadata{model, property_id, domain, contract_version}). `v_lcc_dossier_current` already
   exposes the latest version per entity/type.
6. **Surface** — see access below.

## What is built now (this commit)

`api/_shared/dossier-generator.js` implements steps 2–5 against the confirmed seams:
- `DOSSIER_SYSTEM_CONTRACT` — the §1 grounding contract, verbatim, for the system prompt.
- `buildDossierPrompt(kind, packet)` — full self-contained prompt with the property/deal section order.
- `generateDossier({ kind, packet, entityId, title, opsUrl, opsKey, fetchImpl })` — Ollama → HTML →
  Supabase Storage; returns `{ ok, storage_path, html, model, tried, dossierRow }`.
- `recordDossier({ dossierRow, opsUrl, opsKey, fetchImpl })` — upserts the `lcc_dossiers` row; **skips
  gracefully when there is no entity_id** (the deal-without-entity case) and returns `skipped_no_entity`.

It is syntax-clean (`node --check`) and imports only `ai.js` + `artifact-storage.js`.

## Storage & access — the decision (my call)

Three destinations, each with a clear job; the Supabase copy is canonical.

| Destination | Job | Mechanism |
|---|---|---|
| **Supabase `lcc-om-uploads`** (canonical) | in-app viewing; single source of the bytes | `uploadArtifactToStorage`; opened via the existing `resolveArtifactDownload` signed-URL path (same as OMs) |
| **`lcc_dossiers` table** (index) | "what dossiers exist, which is current" | `recordDossier` upsert; `v_lcc_dossier_current` for the latest |
| **SharePoint `Team Briggs - Documents/PROPERTIES`** (human-browsable) | the team's own folder, browsable outside the app, and the reconciliation target for document workflows | push the same HTML (and a PDF render) via `api/_shared/bridge-handlers-sharepoint.js` into the property's PROPERTIES subfolder |

**In-app access points** (all read `lcc_dossiers` / the signed URL):
- The **"Dossier" button** already on the property/entity panel header → generate-or-open (open current if
  fresh, regenerate on demand).
- The **Documents tab** → dossiers listed alongside OMs, with a "Generated <date> · v<n>" badge.
- A compact **Deal Dossier** link on the deal/contact surfaces for deal-type dossiers.
- Optional: surface the current dossier in the daily briefing for active deals.

**Why the OM bucket, not a new one:** the signed-URL mint, the Documents-tab reader, and the SharePoint
bridge already target `lcc-om-uploads`; reusing it means the dossier opens through the exact same click path
as an OM with zero new plumbing. A `dossiers/` path prefix keeps them tidy.

## Remaining activation (deploy/test — belongs to Claude Code)

The generator is wired; these steps light it up in production and must run where Ollama + Railway are live:

1. **Packet assembler** — implement `buildPropertyPacket(entity)` / `buildDealPacket(entity)` server-side,
   reusing the loaders above; every value tagged `{v, source, as_of, confidence}`, missing fields omitted.
2. **Handler action** — add `generate_dossier` to the entities handler: assemble packet → `generateDossier`
   → `recordDossier` → return `{ storage_ref, signed_url }`. Wire the panel "Dossier" button to it.
3. **SharePoint push** — after store, push the HTML/PDF to `Team Briggs - Documents/PROPERTIES/<property>` via
   the SharePoint bridge; write the resulting web URL into `lcc_dossiers.metadata.sharepoint_url`.
4. **Env** — set `OLLAMA_URL` (+ `OLLAMA_MODEL`, and the Cloudflare Access service-token headers if the tunnel
   is protected) in Railway; confirm the model is pulled on the local box.
5. **Entity-id gap** — `lcc_dossiers.entity_id` is NOT NULL. The just-closed **Fresenius Woodland Hills**
   deal has **no asset entity**, so create the asset entity (and link the Salesforce deal) before recording
   its dossier; until then `recordDossier` returns `skipped_no_entity` and the HTML is still stored + viewable.

---

## Copy/paste activation prompt for Claude Code

```
Wire the grounded dossier generator (api/_shared/dossier-generator.js, already committed) into production. It
exports generateDossier({kind, packet, entityId, title, opsUrl, opsKey, fetchImpl}) and recordDossier(...),
and authors via the local Ollama seam invokeExtractionAI in api/_shared/ai.js.

1. Implement buildPropertyPacket(entity) and buildDealPacket(entity) that assemble the reconciled DATA PACKET
   from existing loaders (get_property_context / property-panel loaders, leases live-only, sales_transactions
   live, available_listings, medicare_clinics + facility_patient_counts, census_zcta_demographics,
   v_payer_mix_geo_averages, property_demographics, action=documents; deals also pull correspondence/
   activity_events, offers, touchpoint_cadence, ROE, lcc_party_relationships). Tag every value with
   {v, source, as_of, confidence}; OMIT missing fields.
2. Add a `generate_dossier` action to api/_handlers/entities-handler.js: assemble packet → generateDossier →
   recordDossier → return { storage_ref, signed_url (via resolveArtifactDownload), sharepoint_url }.
3. Wire the property/entity panel "Dossier" header button to call it (open current from lcc_dossiers /
   v_lcc_dossier_current if fresh, else regenerate) and list dossiers in the Documents tab.
4. After store, push the HTML (and a PDF render) to Team Briggs - Documents/PROPERTIES/<property> via
   api/_shared/bridge-handlers-sharepoint.js; save the web URL to lcc_dossiers.metadata.sharepoint_url.
5. Set OLLAMA_URL + OLLAMA_MODEL (and CF Access headers if the tunnel is protected) in Railway; confirm the
   model is pulled. Verify end to end on property 23654 (5247 Airways) and on the closed deal property 35724
   (Fresenius Woodland Hills) — for 35724, first create its LCC asset entity + link the Salesforce deal, since
   lcc_dossiers.entity_id is NOT NULL. Confirm the output matches the gold-standard renders and contains no
   fabricated facts (spot-check "Not on file" / "Derived" / "Conflict" behavior).
```
