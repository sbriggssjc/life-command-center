# Documents (OM viewer) + Property/Deal Dossiers — design (2026-07-31)

Scott: "I believe we've stored these OMs in Supabase. Review where they're ingested when the sidebar
LCC ingestor or OM Intake sends them from CoStar, etc., and spec the OM viewer + the future property/deal
dossiers." This is the trace of the real pipeline + the design that builds on it.

## 1. Where OMs actually live (the trace — Scott was right)

**They ARE in Supabase Storage.** A private bucket **`lcc-om-uploads`** holds **3,126 objects** (OM PDFs,
marketing flyers, PSAs, email bodies), keyed `lcc-om-uploads/<yyyy-mm-dd>/<uuid>-<filename>`.

**Ingestion — one unified pipeline, two entry points, both land in the same place:**
- **OM Intake (email):** an Outlook-flagged deal email → `intake.js` `handleOutlookMessage` →
  **`stageOmIntake`** (`_shared/intake-om-pipeline.js`) → writes `staged_intake_items` +
  `staged_intake_artifacts`, and stores the file bytes via the **storage adapter**.
- **Sidebar LCC ingestor (CoStar / browser):** the Chrome sidebar / Copilot pulls the OM (e.g. from
  CoStar) → `handleIntakeStageOm` → the **same `stageOmIntake`** pipeline → same tables + storage.
- So "OM Intake" and "the sidebar ingestor" are two front doors to ONE staging pipeline; CoStar-sourced
  OMs arrive through the sidebar door. No separate CoStar store.

**Storage adapter (`_shared/storage-adapter.js`) — one interface, two backends:**
- `putArtifact(...)` writes bytes to the **effective backend** (`STORAGE_BACKEND` env, default
  `supabase`): **Supabase** → `lcc-om-uploads/<object>` (`storage_path`/`storage_ref`), or **SharePoint**
  (`sharepoint_pa`, Team Briggs `Storage OM's/Intake` library via a Power Automate flow) → a server-
  relative `storage_ref`. The ref shape is self-describing (`/sites/...` = SharePoint, `bucket/obj` = Supabase).
- Current mix in `staged_intake_artifacts`: ~3,533 pdf + 3,291 txt (email bodies) on Supabase, **656 pdf
  on `sharepoint_pa`**, 467 tagged `supabase`. (There's also junk: contact-name `.bin` rows from an
  entity-resolution batch — filter to real doc file_types.)
- **`resolveArtifactDownload({storageRef})`** already mints a **browser-openable URL**: a Supabase
  **signed URL** (1-hour TTL) for bucket refs, or a SharePoint **sharing-link** (PA `SHAREPOINT_LINK_URL`
  flow) for SharePoint refs. **This is the whole "view it" primitive — already built.**
- A download action already exists: **`intake.artifact_download.v1`** → `handleIntakeArtifactDownload`.

**Document → property linkage (verified):**
`staged_intake_artifacts.intake_id` → **`staged_intake_promotions.intake_id → entity_id`** (the promoted
**OPS asset entity**) — the SAME entity the property panel resolves via `lookup_asset`. Verified:
**2,294 PDF/doc artifacts on 1,306 asset entities.** So given the panel's resolved asset entity id, the
property's documents are one join away.

**A second, parallel store:** `lcc_cre_property_documents` (1,053 rows: 68 OM, 78 BOV, 444 lease, 134
comp, 250 DD, 79 master) from the **`folder_feed_cre`** SharePoint folder feed, keyed by `cre_property_id`
with server-relative `source_url`. This is the "files saved in our SharePoint PROPERTIES folders" store
(vs. the intake artifacts = "OMs we just pulled"). The viewer should surface BOTH.

## 2. OM / Document Viewer — design (mostly wiring)

**Backend — list:** `GET /api/entities?action=documents&id=<entity>` returns the property's documents,
grouped by type, from BOTH stores:
- Intake artifacts: `staged_intake_artifacts ⋈ staged_intake_promotions (entity_id=@id)` — filter to real
  doc file_types (`pdf/doc/docx/xlsx`), drop email-body `txt` + `.bin` junk.
- CRE property docs: `lcc_cre_property_documents` where `cre_property_id` maps to this property (needs the
  cre_property↔asset map — see open item).
- Each row: `{ id, file_name, doc_type, backend, storage_ref, source, created_at }`.
- **Doc-type classifier** (heuristic on file_name + existing `document_type`): `om` (OM|Offering|
  Marketing Brochure|Flyer), `bov`, `lease` (Lease), `psa_dd` (PSA|Purchase|DD|Agreement), `comp` (Comp),
  `master` (Master), else `other`. Ordered OM → BOV → Lease → PSA/DD → Comps → Master → Other.

**Backend — open:** reuse **`resolveArtifactDownload`** (via the existing `intake.artifact_download.v1`
action, or a thin `GET /api/entities?action=document_url&ref=<storage_ref>`) to mint a fresh signed/
sharing URL on click. Never store long-lived URLs; mint per click (1-hour TTL, private bucket, auth-gated).

**Frontend — a "Documents" section on the property panel** (Overview or its own tab):
- Grouped list (OM / BOV / Lease / PSA·DD / Comps / Master), each a row with the file name, source badge
  (Supabase / SharePoint), and date.
- Click → `POST` the download action → open the returned `signed_url` in a **new tab/window**
  (`window.open(url, '_blank')`). PDFs render in-browser; xlsx downloads.
- Empty state honest ("No OM / documents ingested for this property yet").
- **Reuses the companion pattern option:** could also open in the side dock as an embedded `<iframe>`
  viewer for PDFs, so the OM sits beside the property — matches Scott's "separate tab or window" ask with
  an in-app option.

**Build phases:** (D1) the `action=documents` list endpoint over the intake-artifact join; (D2) the
property-panel Documents section + open-in-new-tab via the existing download action; (D3) fold in
`lcc_cre_property_documents` (needs the cre_property↔asset map); (D4) optional in-dock PDF iframe viewer.

**Open items:** the `cre_property_id ↔ asset entity` mapping (for store #2); the 656 SharePoint-backed OMs
need `SHAREPOINT_LINK_URL` (the PA sharing-link flow) configured to be viewable — Supabase-backed ones
work today.

## 3. Property & Deal Dossiers — design (the future functionality)

A **dossier** is a generated, structured, *saved* brief that replaces the ad-hoc ChatGPT/Claude brief
links — authored by the local LLM from the LCC's own data, stored as an artifact, versioned, and surfaced
as a one-click "View dossier" on the panel.

**Property Dossier** — everything we know about a PROPERTY as an underwriting/BD brief: identity + site,
current ownership (the corrected owner ladder), tenant/operator + lease economics (post-dedup lease),
operations (CMS/clinic for dia; GSA/agency for gov), sales & ownership history, the document set (§2), and
a comps snapshot. Audience: BOV/OM prep, quick property recall.

**Deal Dossier** — everything about an active DEAL (Scott's ~40 open listings): the BD context — parties
(owner/buyer/broker via the party graph), the correspondence thread (the 872 ingested deal emails),
offers/LOIs, the cadence + next best action, ROE/territory, and open to-dos. Audience: pre-call prep,
deal status, handoff.

**Generation pipeline (reuses existing seams):**
1. **Assemble** the source context from the spine — property dossier ← `buildContact360`/property panel
   loaders + `fetchEntityPortfolio` + lease/CMS + `action=documents`; deal dossier ← the deal entity's
   correspondence + cadence + offers + party graph (`lcc_party_relationships`).
2. **Synthesize** via the **local LLM** (`invokeExtractionAI` / GaryBuilt/Ollama seam) into a structured
   HTML (sectioned, brand-styled) — deterministic template + LLM prose, so it degrades to a data-only
   dossier when the LLM is unconfigured.
3. **Store** the rendered dossier via the **storage adapter** (`putArtifact` → `lcc-om-uploads` or a new
   `lcc-dossiers` bucket) and register a row in a new **`lcc_dossiers`** table
   `(id, entity_id, dossier_type[property|deal], storage_ref, format, version, generated_at, generated_by,
   source_hash)`. `source_hash` over the inputs → a **staleness** flag when the underlying data changes.
4. **Serve** via `resolveArtifactDownload` (signed URL) — open in a new tab, or embed in the side dock.
5. **Write-back (optional):** for a deal, `uploadDocToFolder` can drop the dossier into the property's
   SharePoint folder so the folder + record stay one object (the existing BOV/OM write-back path).

**Surfacing / link points:** a **"View property dossier ↗"** button in the property panel header (regen +
last-generated timestamp + stale badge); a **"View deal dossier ↗"** button on the deal (My Work / deal
view / the pipeline card); both also reachable from the companion. When absent, the button reads
"Generate dossier."

**Build phases:** (X1) `lcc_dossiers` table + storage + the `resolveArtifactDownload` serve; (X2) the
property dossier assembler + HTML template (data-only first); (X3) local-LLM prose layer; (X4) the deal
dossier assembler over the deal spine; (X5) staleness (`source_hash`) + regen UX; (X6) SharePoint
write-back. X1–X2 stand alone and deliver value before the LLM is wired.

## 4. Why this is largely connect-the-dots
The hard parts already exist: the files are in Supabase (`lcc-om-uploads`), the storage adapter mints
signed/sharing URLs (`resolveArtifactDownload`), a download action is live
(`intake.artifact_download.v1`), and documents link to the panel's asset entity via
`staged_intake_promotions`. The **new** work is a list endpoint + a Documents UI section (§2), and — for
dossiers — a `lcc_dossiers` table, an assembler, and a serve/surfacing UI (§3), all riding the same
storage + LLM seams already in the codebase.
