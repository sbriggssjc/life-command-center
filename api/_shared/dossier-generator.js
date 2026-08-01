// api/_shared/dossier-generator.js
// ============================================================================
// Grounded dossier author — property & deal.
//
// Turns a pre-reconciled DATA PACKET into a fixed-format HTML dossier using the
// LOCAL Ollama model (via invokeExtractionAI, which tries Ollama first, then
// falls back to the cloud chain), then stores the result in Supabase Storage and
// returns a row ready for lcc_dossiers.
//
// The model authors PROSE + LAYOUT only — never FACTS. Every fact must trace to a
// field in the packet; absent fields render "Not on file"; computed values are
// labeled "Derived" with inputs; conflicts are surfaced, not resolved. See
// docs/architecture/dossier-standard-and-llm-contract.md (§1 the contract, §3
// property sections, §4 deal sections, §7/§8 v2 fields) and the gold-standard
// renders dossier-example-5247-airways-v2.html + deal-dossier-fresenius-woodland-hills.html.
//
// Wiring notes:
//   - LLM seam:   invokeExtractionAI({ prompt })  (api/_shared/ai.js) — Ollama-first.
//                 Configure OLLAMA_URL + OLLAMA_MODEL (default qwen2.5:14b) in the env.
//   - Storage:    uploadArtifactToStorage(...) into the lcc-om-uploads bucket.
//   - Registry:   returns a dossierRow for lcc_dossiers (entity_id is NOT NULL —
//                 the caller must supply an asset entity; see recordDossier()).
// ============================================================================

import { invokeExtractionAI } from './ai.js';
import { artifactObjectPath, uploadArtifactToStorage, ARTIFACT_BUCKET } from './artifact-storage.js';

export const DOSSIER_BUCKET = ARTIFACT_BUCKET; // lcc-om-uploads

// ---------------------------------------------------------------------------
// §1 — the grounding contract (goes verbatim into the system prompt).
// ---------------------------------------------------------------------------
export const DOSSIER_SYSTEM_CONTRACT = `You are the Life Command Center dossier author for Team Briggs (Northmarq),
net-lease dialysis and government-leased assets. You write a grounded PROPERTY or DEAL dossier as a single
self-contained HTML document. You author PROSE and LAYOUT only — you never author FACTS.

NON-NEGOTIABLE GROUNDING RULES:
1. Only use what is in the DATA PACKET below. Every fact must trace to a packet field. If it is not in the
   packet, it does not go in the dossier.
2. Never invent, infer, estimate, round-to-impress, or "fill in." No made-up rents, dates, sizes, names, cap
   rates, market color, or comps. An absent field renders exactly: Not on file.
3. Every material figure shows its provenance when the packet provides it (source system + as-of + confidence).
4. Derived values are allowed ONLY when every input is present in the packet, and must be labeled "Derived"
   with the formula shown (e.g. "Implied cap 5.78% — Derived: rent 181,959 / sale 3,150,000"). Never derive
   from a missing input.
5. Conflicts are surfaced, not resolved silently: show the reconciled value and add a one-line "Conflict" note.
6. Owner is never the operator. The owner is the packet's reconciled property owner; the operator/tenant is
   named only in the tenancy section.
7. Facts vs. Analysis are separated. Interpretive lines live under a clearly marked "Analysis (not a stated
   fact)" block, may only recombine stated facts, and introduce no new data.
8. No external knowledge — nothing you "know" about DaVita, Fresenius, a market, or a REIT. Only the packet.
9. Output ONLY the HTML document (starting with <!doctype html>). No commentary before or after, no code fences.

One-line rule: "If it's not in the packet, it's 'Not on file.' If you compute it, label it 'Derived' and show
the inputs. Owner is never the operator."`;

// ---------------------------------------------------------------------------
// Section order per dossier kind — the model fills these, matching the examples.
// ---------------------------------------------------------------------------
const PROPERTY_SECTIONS = [
  'Header (property name/address · domain · "Property Dossier" · generated date · Team Briggs · Northmarq)',
  'Snapshot (type, building SF, land, year built, stations w/ capacity, ownership type, LCC value estimate w/ basis + $/SF)',
  'Location & Trade Area (map thumbnail from geocode; 1/3/5-mi demographics or coverage-gap note; ZIP census proxy; dialysis payer-mix market context; fenced trade-area read)',
  'Ownership (owner of record = reconciled; operator/tenant marked NOT the owner; original developer; owner-is-SPE)',
  'Tenancy & Lease (tenant; guarantor w/ scope; Year-1 rent + $/SF and Current escalated rent + $/SF [Derived]; term; term remaining [Derived]; expense structure; escalations verbatim; renewal options + bumps-in-options; roof/structure/parking/HVAC responsibilities)',
  'Operations (CMS: stations, patient count + trend, annual treatments, est. revenue/EBITDA only if computed else Not on file, certification date, relocation paragraph, market competition)',
  'Transaction & Marketing Timeline (prior listings → sale w/ cap + firm-term-at-close → current listing w/ $/SF, brokers, DOM, portfolio flag)',
  'BD Efforts (owner-entity cadence / touches / ROE, if present)',
  'Documents on File (each source + date + reconciled status badge)',
  'Analysis (not a stated fact) — Derived-only',
  'Footer (verification disclaimer + Not-on-file/Derived/Conflict legend)',
];

const DEAL_SECTIONS = [
  'Header (deal/property name · stage badge · point person · "Deal Dossier" · generated date · Northmarq role)',
  'Hero metrics (for a closed deal: close date, sale price, cap rate, firm term at sale)',
  'The Property (compact identity + geocode)',
  'Transaction (close date, price, cap, firm term remaining at sale, Northmarq role, source)',
  'Tenancy & Guaranty (tenant, guarantor, base rent + $/SF, term, expense structure, escalations w/ conflict note, renewal options, landlord responsibilities)',
  'Parties (seller, buyer/new owner, listing broker, procuring broker, lender — Not on file where absent)',
  'Location & Trade Area (ZIP census proxy; radius rings or coverage-gap note)',
  'Deal Spine (correspondence · offers/LOIs · cadence · ROE — render a gap note if there is no asset entity)',
  'Documents on File (source + reconciled status)',
  'Analysis (not a stated fact) — Derived-only',
  'Footer (verification disclaimer + legend)',
];

// ---------------------------------------------------------------------------
// buildDossierPrompt — the full self-contained prompt (contract + packet + sections).
// ---------------------------------------------------------------------------
export function buildDossierPrompt(kind, packet) {
  const isDeal = String(kind).toLowerCase() === 'deal';
  const sections = isDeal ? DEAL_SECTIONS : PROPERTY_SECTIONS;
  const title = isDeal ? 'DEAL DOSSIER' : 'PROPERTY DOSSIER';
  return [
    DOSSIER_SYSTEM_CONTRACT,
    ``,
    `Produce a ${title} as one self-contained HTML document. Use clean inline CSS in a <style> block (no`,
    `external resources except an optional static-map <img> when the packet supplies a map_url). Match the`,
    `visual style of the LCC gold-standard examples: a boxed .doc, indigo (property) or teal (deal) accents,`,
    `key/value tables, "Not on file" in muted red italic, "Derived" notes in the accent color, "Conflict"/gap`,
    `callout boxes. Render these sections in order (omit a section only if the packet has no data AND the`,
    `section is optional; otherwise render the header + "Not on file"):`,
    ...sections.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `DATA PACKET (the ONLY source of facts — JSON; every value is tagged with source/as_of/confidence where`,
    `known; missing fields are omitted and MUST render "Not on file"):`,
    '```json',
    JSON.stringify(packet ?? {}, null, 2),
    '```',
    ``,
    `Output ONLY the HTML document, beginning with <!doctype html>. No preamble, no code fences.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// generateDossier — packet → Ollama → HTML → Supabase Storage.
// Returns { ok, storage_path, html, model, tried, dossierRow } or an error with `stage`.
// ---------------------------------------------------------------------------
export async function generateDossier({
  kind,               // 'property' | 'deal'
  packet,             // reconciled DATA PACKET (assembled by the caller from live loaders)
  entityId,           // LCC asset entity uuid (required to record in lcc_dossiers)
  title,              // human title, e.g. "5247 Airways Blvd — Property Dossier"
  workspaceId = null,
  generatedBy = null,
  opsUrl,             // OPS_SUPABASE_URL
  opsKey,             // OPS_SUPABASE_KEY (service role)
  fetchImpl,          // fetchWithTimeout or global fetch
}) {
  if (!packet || typeof packet !== 'object') {
    return { ok: false, stage: 'input', detail: 'missing packet' };
  }
  const kindNorm = String(kind || 'property').toLowerCase() === 'deal' ? 'deal' : 'property';

  // 1) Author via the local Ollama model (falls back to cloud chain automatically).
  const prompt = buildDossierPrompt(kindNorm, packet);
  const ai = await invokeExtractionAI({ prompt });
  if (!ai?.ok) {
    return { ok: false, stage: 'llm', detail: ai?.data?.error || 'llm_failed', tried: ai?.tried };
  }

  // 2) Extract + sanitize the HTML the model returned.
  let html = String(ai?.data?.response || '').trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!/^<!doctype html|^<html/i.test(html)) {
    return { ok: false, stage: 'render', detail: 'model_did_not_return_html', raw: html.slice(0, 400), tried: ai?.tried };
  }

  // 3) Store the HTML in Supabase Storage (lcc-om-uploads bucket).
  const createdAt = new Date().toISOString();
  const keyBase = `dossier-${kindNorm}-${entityId || packet?.identity?.property_id || packet?.property_id || 'x'}`;
  const objectPath = artifactObjectPath({
    key: keyBase,
    fileName: `${(title || keyBase).replace(/[^\w.\-]+/g, '-')}.html`,
    mimeType: 'text/html',
    createdAt,
  });
  const up = await uploadArtifactToStorage({
    opsUrl, opsKey, bucket: DOSSIER_BUCKET, objectPath,
    mimeType: 'text/html; charset=utf-8',
    buffer: Buffer.from(html, 'utf8'),
    fetchImpl,
  });
  if (!up.ok) {
    return { ok: false, stage: 'storage', detail: up.detail || 'upload_failed', html };
  }

  // 4) Build the lcc_dossiers row (entity_id is NOT NULL — caller records it).
  const dossierRow = {
    entity_id:    entityId || null,
    dossier_type: kindNorm,                 // 'property' | 'deal'
    storage_ref:  up.storage_path,          // "<bucket>/<objectPath>"
    format:       'html',
    title:        title || keyBase,
    generated_at: createdAt,
    generated_by: generatedBy,
    workspace_id: workspaceId,
    metadata: {
      model:        ai?.data?.model || null,
      tried:        ai?.tried || null,
      property_id:  packet?.identity?.property_id ?? packet?.property_id ?? null,
      domain:       packet?.identity?.domain ?? packet?.domain ?? null,
      contract_version: 'v2-2026-08-01',
    },
  };

  return { ok: true, storage_path: up.storage_path, html, model: ai?.data?.model, tried: ai?.tried, dossierRow };
}

// ---------------------------------------------------------------------------
// recordDossier — insert the row into lcc_dossiers via PostgREST.
// Skips gracefully when entity_id is absent (the deal-without-entity case) so the
// generated HTML is still stored + returned; surface `skipped_no_entity` to the UI.
// ---------------------------------------------------------------------------
export async function recordDossier({ dossierRow, opsUrl, opsKey, fetchImpl }) {
  if (!dossierRow?.entity_id) {
    return { ok: false, skipped: 'no_entity', detail: 'lcc_dossiers.entity_id is NOT NULL; create the asset entity first' };
  }
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(`${opsUrl}/rest/v1/lcc_dossiers?on_conflict=entity_id,dossier_type`, {
      method: 'POST',
      headers: {
        'apikey':        opsKey,
        'Authorization': `Bearer ${opsKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(dossierRow),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: detail.slice(0, 300) };
    }
    const rows = await res.json().catch(() => []);
    return { ok: true, row: Array.isArray(rows) ? rows[0] : rows };
  } catch (err) {
    return { ok: false, detail: err?.message?.slice(0, 200) || 'record_error' };
  }
}
