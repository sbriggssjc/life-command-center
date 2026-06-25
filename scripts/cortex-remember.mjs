// ============================================================================
// cortex-remember.mjs - Append a durable Cortex memory (Build A3) to public.cortex_memory.
// The runtime/§6 self-maintenance loop: record decisions/facts/outcomes/preferences
// that the A1 cortex_context pack then surfaces to every surface.
//
// Usage:
//   node --env-file=.env.local scripts/cortex-remember.mjs <domain> <kind> "<summary>" ['<detailJSON>'] [sensitivity] [source]
//   kind: decision | fact | outcome | preference | note
//   sensitivity: normal (default) | private
// Env: OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY (or OPS_SUPABASE_KEY)
// ============================================================================

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_SERVICE_KEY || process.env.OPS_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error("Missing OPS_SUPABASE_URL / OPS key"); process.exit(1); }

const [domain, kind, summary, detailRaw, sensitivity, source] = process.argv.slice(2);
if (!domain || !kind || !summary) {
  console.error('Usage: cortex-remember.mjs <domain> <kind> "<summary>" [\'<detailJSON>\'] [sensitivity] [source]');
  process.exit(1);
}
let detail = {};
if (detailRaw) { try { detail = JSON.parse(detailRaw); } catch { detail = { note: detailRaw }; } }

const row = {
  domain, kind, summary, detail,
  sensitivity: sensitivity || "normal",
  source: source || "cortex-remember-cli",
};

const res = await fetch(OPS_URL + "/rest/v1/cortex_memory", {
  method: "POST",
  headers: {
    apikey: OPS_KEY, Authorization: "Bearer " + OPS_KEY,
    "Content-Type": "application/json", Prefer: "return=representation",
  },
  body: JSON.stringify(row),
});
if (!res.ok) { console.error("insert failed", res.status, await res.text()); process.exit(1); }
const out = await res.json();
console.log("remembered:", out[0]?.id, "|", domain + "/" + kind, "|", summary);
