// ============================================================================
// personal-files-index.mjs - Index personal OneDrive files (METADATA ONLY) into
// public.personal_files (Build F1). NORMAL folders only; private folders + the
// Personal Vault are intentionally NOT walked. No file contents are read.
//
// Run: node --env-file=.env.local scripts/personal-files-index.mjs
// Env: OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY (or OPS_SUPABASE_KEY);
//      PERSONAL_DIR (default C:\Users\scott\OneDrive\Personal)
// ============================================================================
import { readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_SERVICE_KEY || process.env.OPS_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error("Missing OPS env"); process.exit(1); }
const ROOT = process.env.PERSONAL_DIR || "C:\\Users\\scott\\OneDrive\\Personal";

// NORMAL folders only (see F-connect-everything-SCOPING.md). Private/Vault/other-domain excluded.
const NORMAL = ["Ancestry","Food","Productivity","Letters","Resume","CE",
  "Early Career & School","Speeches","Writing","Reading","Hobbies","Gaming"];

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith("~$") || e.name.toLowerCase() === "desktop.ini") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); continue; }
    if (!e.isFile()) continue;
    let st; try { st = statSync(full); } catch { continue; }
    const rel = relative(ROOT, full).split(sep).join("/");
    out.push({
      rel_path: rel, name: e.name,
      ext: (extname(e.name).replace(/^\./, "").toLowerCase()) || null,
      top_folder: rel.split("/")[0], domain: "personal", sensitivity: "normal",
      size_bytes: st.size, modified_at: new Date(st.mtimeMs).toISOString(),
    });
  }
}

const rows = [];
for (const f of NORMAL) walk(join(ROOT, f), rows);

async function upsert(chunk) {
  const res = await fetch(OPS_URL + "/rest/v1/personal_files?on_conflict=rel_path", {
    method: "POST",
    headers: { apikey: OPS_KEY, Authorization: "Bearer " + OPS_KEY,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(chunk),
  });
  if (!res.ok) throw new Error("upsert " + res.status + ": " + (await res.text()));
}
for (let i = 0; i < rows.length; i += 500) await upsert(rows.slice(i, i + 500));

const byFolder = {};
for (const r of rows) byFolder[r.top_folder] = (byFolder[r.top_folder] || 0) + 1;
console.log("personal-files-index: upserted " + rows.length + " files (metadata only)");
for (const [k, v] of Object.entries(byFolder).sort((a,b)=>b[1]-a[1])) console.log("  " + k + ": " + v);
