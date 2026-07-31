// ============================================================================
// discovery.ts — pure Salesforce file-discovery helpers (W3.7b)
// Life Command Center
//
// Server-side discovery of Salesforce Files (ContentDocumentLink → ContentVersion)
// for the SF → LCC bridge. Historically discovery only swept Comp__c records
// (via a Power Automate flow), so OMs attached to a Listing or Deal never landed
// in sf_files — the Fort Wayne USDVA OM (attached to Listing a0jVs000005AqaLIAS)
// is the proof case. This module extends the sweep to Listing__c and the Deal
// (Opportunity) object as well.
//
// Everything here is PURE (no Deno, no network, no DB) so it is unit-testable
// with the repo's `node --test` harness. The edge function (index.ts) wires
// these to the Connected-App SOQL layer + Storage + sf_files inserts.
// ============================================================================

// Which Salesforce objects we sweep for attachments, and which sf_files
// convenience column each stamps for the om-comp-resolver traversal
// (comp review → sf_comp_staging.{sf_comp_id,sf_listing_id,sf_deal_id} → sf_files).
export interface DiscoveryObject {
  key: string;            // logical key used by callers / staging config
  sfType: string;         // ContentDocumentLink.LinkedEntity.Type value
  stagingTable: string;   // where the parent SF ids are staged
  sfIdColumn: string;     // the SF id column on the staging table
  traversalColumn: "sf_comp_id" | "sf_listing_id" | "sf_deal_id";
}

// Order matters only for reporting. Comp is kept for parity/backfill even though
// the Power Automate flow already covers it — a server-side sweep is idempotent
// (dedup on content_version_id) so re-covering Comp is harmless.
export const DISCOVERY_OBJECTS: DiscoveryObject[] = [
  { key: "comp",    sfType: "Comp__c",     stagingTable: "sf_comp_staging",    sfIdColumn: "sf_comp_id",    traversalColumn: "sf_comp_id" },
  { key: "listing", sfType: "Listing__c",  stagingTable: "sf_listing_staging", sfIdColumn: "sf_listing_id", traversalColumn: "sf_listing_id" },
  { key: "deal",    sfType: "Opportunity", stagingTable: "sf_deal_staging",    sfIdColumn: "sf_deal_id",    traversalColumn: "sf_deal_id" },
];

// Map a ContentDocumentLink LinkedEntity Type back to the sf_files convenience
// column. Returns null for an entity type we don't traverse.
export function traversalColumnForType(linkedEntityType: string): string | null {
  const t = String(linkedEntityType || "");
  for (const o of DISCOVERY_OBJECTS) if (o.sfType === t) return o.traversalColumn;
  // Tolerate the logical key too (e.g. a caller passing "listing").
  const lk = t.toLowerCase();
  for (const o of DISCOVERY_OBJECTS) if (o.key === lk) return o.traversalColumn;
  return null;
}

// SOQL uses a quoted, comma-separated id list. Salesforce ids are alphanumeric
// (15/18 char); we still hard-filter to [A-Za-z0-9] so a malformed value can
// never break out of the quoted literal.
export function sanitizeSfId(id: unknown): string | null {
  const s = String(id ?? "").trim();
  return /^[A-Za-z0-9]{15,18}$/.test(s) ? s : null;
}

function idInList(ids: string[]): string {
  return ids.map((i) => `'${i}'`).join(",");
}

// ── SOQL builders ────────────────────────────────────────────────────────────
// ContentDocumentLink is queryable only with a bounded LinkedEntityId filter
// (Salesforce refuses an unbounded CDL scan), so we always pass an explicit id
// batch. SOQL IN() is limited; callers chunk ids (see CDL_ID_CHUNK).
export const CDL_ID_CHUNK = 200;

export function buildContentDocumentLinkSoql(entityIds: string[]): string {
  const clean = entityIds.map(sanitizeSfId).filter(Boolean) as string[];
  return (
    "SELECT ContentDocumentId, LinkedEntityId, LinkedEntity.Type " +
    "FROM ContentDocumentLink " +
    `WHERE LinkedEntityId IN (${idInList(clean)})`
  );
}

// Latest ContentVersion per ContentDocument — one row per document (IsLatest).
export function buildContentVersionSoql(documentIds: string[]): string {
  const clean = documentIds.map(sanitizeSfId).filter(Boolean) as string[];
  return (
    "SELECT Id, ContentDocumentId, Title, FileExtension, PathOnClient, " +
    "VersionNumber, ContentSize, Checksum " +
    "FROM ContentVersion " +
    `WHERE ContentDocumentId IN (${idInList(clean)}) AND IsLatest = true`
  );
}

// Salesforce blob download path for a ContentVersion's bytes.
export function versionDataPath(contentVersionId: string, apiVersion = "v60.0"): string {
  return `/services/data/${apiVersion}/sobjects/ContentVersion/${contentVersionId}/VersionData`;
}

// ── file-type gate ───────────────────────────────────────────────────────────
// Document extensions worth discovering (OMs/flyers/financials). The downstream
// stage-queued worker only extracts pdf today, but discovering the sibling doc
// types is harmless (they sit queued) and future-proofs the corpus. Thumbnails
// and stray images are excluded so a Listing Thumbnail never masquerades as an OM.
export const DISCOVER_EXTENSIONS = new Set(["pdf", "docx", "doc", "xlsx", "xls"]);

export function isDiscoverableExtension(extension: unknown): boolean {
  return DISCOVER_EXTENSIONS.has(String(extension || "").toLowerCase().replace(/^\./, ""));
}

// ── ContentVersion → sf_files discovered row ─────────────────────────────────
export interface ContentVersionRow {
  Id: string;
  ContentDocumentId: string;
  Title?: string | null;
  FileExtension?: string | null;
  PathOnClient?: string | null;
  VersionNumber?: string | null;
  ContentSize?: number | null;
  Checksum?: string | null;
}

// Build the sf_files "discovered" row for one ContentVersion linked to one
// Comp/Listing/Deal record. linked_entity_type / linked_entity_sf_id record the
// record the ContentDocumentLink hangs off; the matching convenience column
// (sf_comp_id / sf_listing_id / sf_deal_id) is stamped for direct traversal.
export function mapVersionToFileRow(args: {
  cv: ContentVersionRow;
  linkedEntityType: string;
  linkedEntityId: string;
  batchId: string;
  nowIso: string;
  apiVersion?: string;
}): Record<string, unknown> {
  const { cv, linkedEntityType, linkedEntityId, batchId, nowIso, apiVersion } = args;
  const ext = String(cv.FileExtension || "").toLowerCase().replace(/^\./, "") || null;
  const title = cv.Title ?? null;
  const fileName = cv.PathOnClient || (title ? `${title}${ext ? "." + ext : ""}` : null);
  const row: Record<string, unknown> = {
    content_document_id: cv.ContentDocumentId ?? null,
    content_version_id: cv.Id ?? null,
    linked_entity_type: linkedEntityType,
    linked_entity_sf_id: linkedEntityId,
    title,
    file_name: fileName,
    extension: ext,
    version_number: cv.VersionNumber ?? null,
    size_bytes: typeof cv.ContentSize === "number" ? cv.ContentSize : null,
    sf_download_url: versionDataPath(cv.Id, apiVersion),
    source_system: "salesforce",
    import_batch: batchId,
    ingestion_status: "discovered",
    extraction_status: "pending",
    discovered_at: nowIso,
    updated_at: nowIso,
  };
  const col = traversalColumnForType(linkedEntityType);
  if (col) row[col] = linkedEntityId;
  return row;
}

// Dedup contract: never re-insert a row whose content_version_id already exists
// (the durable file identity). sha256 is the SECOND dedup key, computed at fetch
// time — two files with distinct ContentVersionIds but identical bytes collapse
// to one stored object because storagePath() is keyed by version and the fetch
// step records sha256 for cross-version identity checks. Discovery only guards
// the content_version_id key here.
export function filterNewVersions(
  rows: Record<string, unknown>[],
  existingContentVersionIds: Set<string> | string[],
): Record<string, unknown>[] {
  const existing = existingContentVersionIds instanceof Set
    ? existingContentVersionIds
    : new Set(existingContentVersionIds);
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const cvid = String(r.content_version_id || "");
    if (!cvid || existing.has(cvid) || seen.has(cvid)) continue;
    seen.add(cvid);
    out.push(r);
  }
  return out;
}

// Group ContentDocumentLink rows by the linked entity's SF type so each
// discovered file is stamped with the correct linked_entity_type. A CDL row's
// LinkedEntity.Type is the authoritative object name.
export function linkedTypeFromCdl(cdl: Record<string, unknown>): string | null {
  const le = cdl.LinkedEntity as Record<string, unknown> | undefined;
  const t = le && typeof le === "object" ? le.Type : null;
  return t ? String(t) : null;
}

// Chunk a list into fixed-size batches (for SOQL IN() limits).
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ============================================================================
// W3.7c — PA-collector helpers (pure). The server-side Connected-App sweep
// (getSfToken/sfQuery/handleDiscover/handleFetch) is RETIRED — the org cannot
// provision a Connected App (SSO-gated, no admin; SALESFORCE_LCC_INGESTION_PLAN
// §2). Power Automate is the ONLY Salesforce transport: a scheduled PA flow reads
// the worklist, does the ContentDocumentLink/ContentVersion reads through its
// interactive-SSO SF connection, and POSTs metadata + bytes back to the webhook
// actions below. These helpers are the pure (Deno-free, DB-free) logic those
// actions and the worklist wrap, so they unit-test under `node --test`.
// ============================================================================

// The three staged objects the worklist serves, with the sf_files traversal
// column each stamps. Mirrors DISCOVERY_OBJECTS (same source of truth).
export const WORKLIST_OBJECTS = DISCOVERY_OBJECTS;

// Default "no discovery attempt in N days" lease window for the worklist.
export const DEFAULT_WORKLIST_STALE_DAYS = 7;

export function normalizeVertical(v: unknown): "dia" | "gov" | null {
  const s = String(v ?? "").toLowerCase();
  return s === "dia" || s === "gov" ? s : null;
}

// A single worklist row handed to Power Automate: enough for PA to (1) read the
// record's ContentDocumentLinks via the SF connector and (2) echo the vertical +
// object type back on ?action=discover-webhook so routing needs no re-derivation.
export interface WorklistItem {
  vertical: "dia" | "gov";
  object_type: string;            // logical key: comp | listing | deal
  sf_type: string;                // SObject API name: Comp__c | Listing__c | Opportunity
  linked_entity_sf_id: string;    // the Comp/Listing/Deal SF id to inspect
}

export function makeWorklistItem(
  vertical: "dia" | "gov", obj: DiscoveryObject, sfId: string,
): WorklistItem {
  return {
    vertical, object_type: obj.key, sf_type: obj.sfType, linked_entity_sf_id: sfId,
  };
}

// The ISO cutoff for "attempted more than N days ago" — the worklist selects
// staging rows whose last_file_discovery_at is NULL or older than this. Pure:
// the caller passes `now` (edge passes Date.now via isoNow) so tests are stable.
export function staleCutoffIso(nowMs: number, staleDays: number): string {
  const days = Number.isFinite(staleDays) && staleDays >= 0 ? staleDays : DEFAULT_WORKLIST_STALE_DAYS;
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

// ── ?action=discover-webhook payload → sf_files row ──────────────────────────
// PA posts back the metadata it read from Salesforce. Shape (per file):
//   { linked_entity_type, linked_entity_id, content_document_id,
//     content_version_id, title, file_name, extension, version_number,
//     size_bytes, vertical? }
// Returns a discovered sf_files row, or null when the item is unusable (no
// content_version_id / no valid linked id / non-document extension). Reuses the
// SAME dedup contract (content_version_id) via filterNewVersions downstream.
export interface DiscoverWebhookFile {
  linked_entity_type?: string | null;
  linked_entity_id?: string | null;
  content_document_id?: string | null;
  content_version_id?: string | null;
  title?: string | null;
  file_name?: string | null;
  extension?: string | null;
  version_number?: string | null;
  size_bytes?: number | null;
  vertical?: string | null;
}

export function mapDiscoveredFileToRow(args: {
  file: DiscoverWebhookFile;
  batchId: string;
  nowIso: string;
  apiVersion?: string;
}): Record<string, unknown> | null {
  const { file, batchId, nowIso, apiVersion } = args;
  const cvid = sanitizeSfId(file.content_version_id);
  const linkedId = sanitizeSfId(file.linked_entity_id);
  if (!cvid || !linkedId) return null;
  const ext = String(file.extension || "").toLowerCase().replace(/^\./, "") || null;
  if (!isDiscoverableExtension(ext)) return null;

  const linkedType = String(file.linked_entity_type || "");
  const title = file.title ?? null;
  const fileName = file.file_name || (title ? `${title}${ext ? "." + ext : ""}` : null);
  const row: Record<string, unknown> = {
    content_document_id: sanitizeSfId(file.content_document_id) ?? file.content_document_id ?? null,
    content_version_id: cvid,
    linked_entity_type: linkedType || null,
    linked_entity_sf_id: linkedId,
    title,
    file_name: fileName,
    extension: ext,
    version_number: file.version_number ?? null,
    size_bytes: typeof file.size_bytes === "number" ? file.size_bytes : null,
    sf_download_url: versionDataPath(cvid, apiVersion),
    source_system: "salesforce",
    import_batch: batchId,
    ingestion_status: "discovered",
    extraction_status: "pending",
    discovered_at: nowIso,
    updated_at: nowIso,
  };
  const col = traversalColumnForType(linkedType);
  if (col) row[col] = linkedId;
  return row;
}

// ── ?action=file-content — size + sha decision (pure) ────────────────────────
// PA posts one file's bytes (base64) keyed by content_version_id. The edge
// function decodes + hashes; this pure function decides whether to accept. The
// caller enforces the verdict (413 too_large / 422 sha_mismatch / ok).
export type FileContentVerdict = "ok" | "too_large" | "sha_mismatch" | "empty";

export function fileContentDecision(args: {
  sizeBytes: number;
  maxBytes: number;
  providedSha?: string | null;
  computedSha: string;
}): { verdict: FileContentVerdict } {
  const { sizeBytes, maxBytes, providedSha, computedSha } = args;
  if (!sizeBytes || sizeBytes <= 0) return { verdict: "empty" };
  if (sizeBytes > maxBytes) return { verdict: "too_large" };
  // sha256 is optional on the wire, but when PA sends it a mismatch is a hard
  // reject — corrupted/wrong bytes must never reach the extractor.
  if (providedSha) {
    const a = String(providedSha).trim().toLowerCase();
    const b = String(computedSha).trim().toLowerCase();
    if (a && a !== b) return { verdict: "sha_mismatch" };
  }
  return { verdict: "ok" };
}
