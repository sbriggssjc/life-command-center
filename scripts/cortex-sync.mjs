// ============================================================================
// cortex-sync.mjs - Mirror the Cortex Tier-1 brain docs into public.cortex_documents
//
// Canonical source of truth stays in OneDrive\Personal\_FileSystem\Cortex.
// Reads those markdown files and UPSERTS them into LCC Opps so the context-broker
// `cortex_context` packet type (Build A1) can serve them. Same pattern as
// folder_feed_seen mirroring SharePoint: DB holds a served index, not the editable copy.
//
// Run:  node --env-file=.env.local scripts/cortex-sync.mjs
// Env:  OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY (or OPS_SUPABASE_KEY) required;
//       CORTEX_DIR (default: desktop OneDrive Cortex path)
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_SERVICE_KEY || process.env.OPS_SUPABASE_KEY;
const CORTEX_DIR = process.env.CORTEX_DIR || "C:\\Users\\scott\\OneDrive\\Personal\\_FileSystem\\Cortex";

if (!OPS_URL || !OPS_KEY) {
  console.error("Missing OPS_SUPABASE_URL / OPS_SUPABASE_(SERVICE_)KEY");
  process.exit(1);
}

const ROOT_INCLUDE = /^0[0-6]_.*\.md$/;

const DOMAIN_MAP = {
  "domains/01-Business-LCC": { domain: "business", sensitivity: "normal" },
  "domains/02-Personal": { domain: "personal", sensitivity: "private" },
  "domains/03-Family": { domain: "family", sensitivity: "normal" },
  "domains/04-Coaching": { domain: "coaching", sensitivity: "normal" },
  "domains/05-Home": { domain: "home", sensitivity: "normal" },
  "domains/06-Travel": { domain: "travel", sensitivity: "normal" },
};
const DOMAIN_DOCS = new Set(Object.keys(DOMAIN_MAP).map((id) => id.replace("domains/", "") + ".md"));

function docIdFromPath(file) {
  return relative(CORTEX_DIR, file).split(sep).join("/").replace(/\.md$/, "");
}

function parseMeta(body) {
  const head = body.split("\n").slice(0, 12).join("\n");
  const version = (head.match(/\bv(\d+\.\d+)\b/) || [])[1] || null;
  const last_updated = (head.match(/last updated[:\s]+(\d{4}-\d{2}-\d{2})/i) || [])[1] || null;
  const title = (body.match(/^#\s+(.+)$/m) || [])[1] || null;
  return { version, last_updated, title: title ? title.trim() : null };
}

function sectionize(body) {
  const out = {};
  const parts = body.split(/^##\s+/m);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const nl = seg.indexOf("\n");
    const heading = (nl === -1 ? seg : seg.slice(0, nl)).trim();
    out[heading] = seg.trim();
  }
  return out;
}

function classify(docId) {
  return DOMAIN_MAP[docId] || { domain: "global", sensitivity: "normal" };
}

function collect() {
  const files = [];
  for (const name of readdirSync(CORTEX_DIR)) {
    if (ROOT_INCLUDE.test(name)) files.push(join(CORTEX_DIR, name));
  }
  const domainsDir = join(CORTEX_DIR, "domains");
  try {
    for (const name of readdirSync(domainsDir)) {
      if (DOMAIN_DOCS.has(name)) files.push(join(domainsDir, name));
    }
  } catch (_) { /* no domains dir */ }
  return files.filter((f) => statSync(f).isFile());
}

async function upsert(rows) {
  const res = await fetch(OPS_URL + "/rest/v1/cortex_documents", {
    method: "POST",
    headers: {
      "apikey": OPS_KEY,
      "Authorization": "Bearer " + OPS_KEY,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error("upsert failed " + res.status + ": " + (await res.text()));
}

const files = collect();
const skipped = [];
const rows = [];
for (const file of files) {
  let body_md;
  try {
    body_md = readFileSync(file, "utf8");
  } catch (e) {
    skipped.push(docIdFromPath(file) + " (" + (e.code || e.message) + ")");
    continue;
  }
  const doc_id = docIdFromPath(file);
  const meta = parseMeta(body_md);
  const cls = classify(doc_id);
  rows.push({
    doc_id,
    domain: cls.domain,
    title: meta.title,
    version: meta.version,
    last_updated: meta.last_updated,
    body_md,
    sections: sectionize(body_md),
    sensitivity: cls.sensitivity,
    updated_at: new Date().toISOString(),
  });
}

await upsert(rows);
console.log("cortex-sync: upserted " + rows.length + " docs");
for (const r of rows) {
  console.log("  " + r.doc_id + "  [" + r.domain + "/" + r.sensitivity + "]  " + (r.version || "?") + "  " + (r.last_updated || "?"));
}
if (skipped.length) {
  console.log("\ncortex-sync: skipped " + skipped.length + " unreadable (e.g. OneDrive online-only):");
  for (const s of skipped) console.log("  - " + s);
}
