# Dossier Generator — Production Wiring & Operator Runbook (2026-08-01)

Wires the grounded property/deal dossier into production: server-side packet
assembly → `generateDossier` (facts rendered in code, Analysis authored by the
local Ollama seam) → `recordDossier` (Supabase Storage + versioned
`lcc_dossiers` row) → SharePoint push → panel UI. This doc is the code map +
the operator handoff for the steps that require infra access (Railway env,
Ollama, live end-to-end).

## What shipped (code, committed)

| Piece | File |
|---|---|
| Generator (`generateDossier`, `recordDossier`) | `api/_shared/dossier-generator.js` |
| Packet assemblers (`buildPropertyPacket`, `buildDealPacket`) | `api/_handlers/entities-handler.js` |
| `POST /api/entities?action=generate_dossier` | `api/_handlers/entities-handler.js` |
| `GET  /api/entities?action=dossiers&id=<uuid>` (list) | `api/_handlers/entities-handler.js` |
| `GET  /api/entities?action=dossier_url&dossier_id=<uuid>` (signed link) | `api/_handlers/entities-handler.js` |
| Header "Dossier" button → server generate + open (client blob fallback) | `detail.js` `_udOpenPropertyDossier` |
| Dossiers listed in the Documents tab | `detail.js` `_udRenderDossiers` / `_udOpenDossier` |
| Unit tests (no-fabrication contract) | `test/dossier-generator.test.mjs` |

### Grounding / no-fabrication architecture
FACT sections are rendered **deterministically in code** from the tagged packet
(`{v, source, as_of, confidence}`), so the LLM never touches a fact and cannot
invent one. Absent field → `Not on file`. Computed value → `Derived:` + inputs.
Source conflict → reconciled value + a `Conflict` note (never silently averaged).
Owner is the reconciled property owner (recorded deed owner when the true owner
is flagged `is_operator_not_owner`); the operator/tenant is named only in the
tenancy section. The Ollama seam (`invokeExtractionAI`) authors ONLY the optional
fenced "Analysis (not a stated fact)" block and is bounded by
`DOSSIER_ANALYSIS_TIMEOUT_MS` (default 20s) — if the model is unreachable the
dossier still renders, facts-only.

## Live data verification (via Supabase MCP, 2026-08-01)

**Property 23654 (5247 Airways Blvd — DaVita, gold standard):** packet resolves
to building 6,308 SF · land 2.51 ac · 2016 · fee simple · value ~$3,137,221 →
**price/SF $497 (Derived)**; **stations 13** (CMS) with the property denorm 171
surfaced as a **Conflict** (reconciled 13); lease $181,959 (2018-06-06 →
2033-06-06, NN, "2, 5yr") → **rent/SF $28.85 (Derived)** + term-remaining derived;
TTM treatments 4,283; owner reconciles to **"Kingsbarn Realty"** (true owner is
flagged operator, so it correctly falls back to the recorded owner) and **DaVita
is shown as operator, not owner**; 1 live sale. Matches the v2 gold-standard
render; no fabricated facts.

**Property 35724 (Fresenius Woodland Hills — closed deal):** asset entity
**already exists** = `d118b3a1-ec3b-4e44-aca8-5f76c754ae7a` (dia). Property is
21,080 SF Healthcare, operator/tenant Fresenius, 1 live lease, 1 live sale
($15,729,896 · 2026-07-24). **No CMS clinic, no owner names, and the sale has no
`sf_deal_id`** → the property dossier renders those as "Not on file" (honest
gaps), and the **deal dossier's Parties/Correspondence/Offers show "Not on file"
until the Salesforce deal is linked** (see operator step 3 below).

## Operator handoff — steps that need infra (not reachable from the build sandbox)

### 1. Railway env (Settings → Variables) — set, then redeploy `main`
```
OLLAMA_URL=https://<garybuilt-tunnel-host>        # e.g. the Cloudflare named tunnel; NO trailing /v1
OLLAMA_MODEL=qwen2.5:14b                           # or your pulled authoring model
# If the tunnel is behind a Cloudflare Access service-token policy:
CF_ACCESS_CLIENT_ID=<service-token-id>
CF_ACCESS_CLIENT_SECRET=<service-token-secret>
# Already required for storage/signing (confirm present):
OPS_SUPABASE_URL=... ; OPS_SUPABASE_KEY=<service-role>
# SharePoint push (Power Automate flows) — optional; push is best-effort:
SHAREPOINT_UPLOAD_URL=<PA create-file flow>       # enables the HTML push
SHAREPOINT_LINK_URL=<PA sharing-link flow>        # lets dossier_url resolve a SharePoint web link
SHAREPOINT_DOSSIER_ROOT=Team Briggs - Documents/PROPERTIES   # default if unset
# Optional tuning:
DOSSIER_ANALYSIS_TIMEOUT_MS=20000
```
Ollama seam reference: `docs/setup/garybuilt-local-model.md`. The generator hits
`${OLLAMA_URL}/v1/chat/completions` (OpenAI-compatible).

### 2. Pull the authoring model on the Ollama box
```
ollama pull qwen2.5:14b        # or whatever OLLAMA_MODEL you set
ollama list                    # confirm it's present
# smoke test through the tunnel from anywhere with the CF headers if applicable:
curl -s $OLLAMA_URL/v1/chat/completions -H 'content-type: application/json' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -d '{"model":"'"$OLLAMA_MODEL"'","messages":[{"role":"user","content":"ok"}],"stream":false}'
```

### 3. Link property 35724's Salesforce deal (so its DEAL dossier is populated)
The asset entity exists; only the SF deal link is missing. Confirm the SF deal
id, then (dia `zqzrriwuavgrquhisnoa`):
```sql
-- attach the SF deal to the live sale so the deal spine resolves it
update sales_transactions set sf_deal_id = '<SF opportunity id>'
 where property_id = 35724 and transaction_state = 'live';
```
Correspondence/offers surface from `activity_events` anchored to the asset entity
(`entity_id = d118b3a1-…` or `metadata.deal_entity_id`); backfill/associate the
deal's emails to that entity for a full deal dossier. (Per the agreed scope this
link was documented, not applied from the sandbox.)

### 4. End-to-end verification (after redeploy)
```
npm run verify:deploy   # confirms /version == merge SHA + routes return JSON
```
Then, authenticated in the app:
1. Open property 23654 → header **Dossier** → a new tab opens the stored HTML
   (signed URL). Spot-check: land shows a value not "Not on file"; stations 13
   with the Conflict note; rent/SF $28.85 "Derived"; owner "Kingsbarn Realty",
   DaVita "the operator, not the owner"; footer verification line; the Analysis
   block appears only if Ollama answered.
2. Documents tab → a **Dossiers** section lists the version(s); "Open ↗" works.
3. Re-click Dossier with no data change → server returns `reused:true` (same
   `source_hash`, no new version).
4. Open property 35724 → Dossier renders with honest "Not on file" for the
   absent owner/CMS fields; after step 3's SF link, its **deal** dossier
   (`kind:'deal'`) shows parties/correspondence/offers.
5. Confirm the SharePoint copy landed under
   `…/PROPERTIES/<property>/property-dossier-v1.html` and
   `lcc_dossiers.metadata.sharepoint_url` is set (only when `SHAREPOINT_UPLOAD_URL`
   is configured).

## Known limitation — PDF render
No HTML→PDF renderer exists in the repo (no puppeteer/pdf-lib/edge PDF fn). The
dossier is pushed to SharePoint as **HTML**; the print-ready `@media print` CSS
means browser "Print → Save as PDF" produces a clean PDF today. A server-side
PDF (new edge function or a headless-Chromium dep) is a follow-up — it is
**not** faked here, per the no-fabrication doctrine.
