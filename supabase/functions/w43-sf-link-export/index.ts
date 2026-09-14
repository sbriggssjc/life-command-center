// ============================================================================
// w43-sf-link-export — W4.3 data export + staged-batch loader (LCC Audit Plan)
//   POST ?action=export        dump queue + SF-account registry to Storage
//   POST ?action=stage         body = JSONL of scored linked/review rows → bulk
//                              insert into gov/dia w43_splink_batch (the ledger)
// Auth: X-PA-Webhook-Secret == PA_WEBHOOK_SECRET. No domain writes besides the
// dedicated w43_splink_batch staging/ledger table.
//
// Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Synced to this repo 2026-09-07
// (DRIFT1 Unit 2) from the live deployment (version 4) via Supabase MCP
// `get_edge_function`. Had NO committed source before this sync.
//
// This is the operator tool that ran the W4.3 30k-row Salesforce-account-link
// backlog on 2026-07-31 (docs/audits/ROLLOUT_STATUS.md, row "W4.3"). It is a
// reusable batch export/stage utility, not a scheduled job: no cron.job entry
// on any project calls it and it is not invoked by another edge function.
// Re-run it by hand for the next backlog pass exactly as documented there.
//
// Before redeploying this file, re-diff it against the live deployment
// (Supabase MCP `get_edge_function`, project zqzrriwuavgrquhisnoa, slug
// w43-sf-link-export).
// ============================================================================

type Env = { url: string; key: string };
function dbEnv(which: "gov" | "dia" | "ops"): Env | null {
  const map = {
    gov: ["GOV_SUPABASE_URL", "GOV_SUPABASE_KEY"],
    dia: ["DIA_SUPABASE_URL", "DIA_SUPABASE_KEY"],
    ops: ["OPS_SUPABASE_URL", "OPS_SUPABASE_SERVICE_KEY"],
  } as const;
  const [u, k] = map[which];
  const url = Deno.env.get(u), key = Deno.env.get(k);
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

async function restAll(e: Env, base: string, pageSize = 1000, hardCap = 40000): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const sep = base.includes("?") ? "&" : "?";
    const res = await fetch(`${e.url}/rest/v1/${base}${sep}limit=${pageSize}&offset=${offset}`, {
      headers: { apikey: e.key, Authorization: `Bearer ${e.key}` },
    });
    if (!res.ok) throw new Error(`REST ${base.split("?")[0]} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = await res.json() as Record<string, unknown>[];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

async function bulkInsert(e: Env, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${e.url}/rest/v1/${table}`, {
      method: "POST",
      headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, "Content-Type": "application/json", Prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!res.ok) throw new Error(`insert ${table} chunk ${i} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function uploadOps(path: string, body: string): Promise<void> {
  const e = dbEnv("ops");
  if (!e) throw new Error("ops not configured");
  const res = await fetch(`${e.url}/storage/v1/object/entity-resolution/${path}`, {
    method: "POST",
    headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, "Content-Type": "application/x-ndjson", "x-upsert": "true" },
    body,
  });
  if (!res.ok) throw new Error(`upload ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("PA_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-pa-webhook-secret") !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const action = new URL(req.url).searchParams.get("action") ?? "";
  try {
    if (action === "stage") {
      const text = await req.text();
      const rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) as Record<string, unknown>[];
      const byV: Record<string, Record<string, unknown>[]> = { gov: [], dia: [] };
      for (const r of rows) {
        const v = String(r.vertical);
        if (v !== "gov" && v !== "dia") continue;
        byV[v].push({
          queue_id: r.queue_id, band: r.band, probability: r.probability,
          sf_account_id: r.sf_account_id, sf_account_name: r.sf_account_name,
          source_table: r.source_table, source_id: r.source_id,
        });
      }
      for (const v of ["gov", "dia"] as const) {
        const e = dbEnv(v);
        if (!e) throw new Error(`${v} not configured`);
        if (byV[v].length) await bulkInsert(e, "w43_splink_batch", byV[v]);
      }
      // Archive the staged rows for durability.
      await uploadOps("w4_3/staged_batch.jsonl", text);
      return new Response(JSON.stringify({ ok: true, staged: { gov: byV.gov.length, dia: byV.dia.length } }), { headers: { "Content-Type": "application/json" } });
    }
    if (action === "export") {
      const queue: Record<string, unknown>[] = [];
      for (const which of ["gov", "dia"] as const) {
        const e = dbEnv(which);
        if (!e) throw new Error(`${which} not configured`);
        const rows = await restAll(e,
          `sf_link_research_queue?status=eq.queued&select=queue_id,source_table,source_id,owner_name,canonical_name,state,property_count,priority_score`);
        for (const r of rows) queue.push({ vertical: which, ...r });
      }
      const ops = dbEnv("ops");
      if (!ops) throw new Error("ops not configured");
      const ids = await restAll(ops,
        `external_identities?source_system=eq.salesforce&source_type=eq.Account&select=external_id,entity_id`);
      const entIds = [...new Set(ids.map((r) => String(r.entity_id)))];
      const entById = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < entIds.length; i += 100) {
        const inList = entIds.slice(i, i + 100).map((x) => `"${x}"`).join(",");
        const es = await restAll(ops, `entities?id=in.(${inList})&select=id,name,canonical_name,city,state,domain,entity_type`, 200);
        for (const e2 of es) entById.set(String(e2.id), e2);
      }
      const accounts: Record<string, unknown>[] = [];
      for (const r of ids) {
        const e2 = entById.get(String(r.entity_id));
        if (!e2 || !e2.name) continue;
        accounts.push({
          sf_account_id: r.external_id, entity_id: r.entity_id, name: e2.name,
          canonical_name: e2.canonical_name ?? null, city: e2.city ?? null,
          state: e2.state ?? null, domain: e2.domain ?? null, entity_type: e2.entity_type ?? null,
        });
      }
      await uploadOps("w4_3/queue.jsonl", queue.map((q) => JSON.stringify(q)).join("\n") + "\n");
      await uploadOps("w4_3/sf_accounts.jsonl", accounts.map((a) => JSON.stringify(a)).join("\n") + "\n");
      return new Response(JSON.stringify({
        ok: true, queue_rows: queue.length,
        by_vertical: { gov: queue.filter((q) => q.vertical === "gov").length, dia: queue.filter((q) => q.vertical === "dia").length },
        sf_accounts: accounts.length,
        uploaded: ["entity-resolution/w4_3/queue.jsonl", "entity-resolution/w4_3/sf_accounts.jsonl"],
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, actions: ["export (POST)", "stage (POST, JSONL body)"] }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
