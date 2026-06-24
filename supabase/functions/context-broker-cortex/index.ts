// ============================================================================
// context-broker-cortex - A1 canary: standalone Cortex context-pack assembler.
// Validates cortex_context assembly + the personal/business boundary against the
// real public.cortex_documents, WITHOUT touching the live context-broker.
// Production cutover folds this logic into context-broker (patched index.ts) via
// the repo's Supabase deploy pipeline. Self-contained: no ../_shared imports.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

async function opsGet(path: string) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
  });
  if (!res.ok) throw new Error("opsGet " + res.status + ": " + (await res.text()));
  return res.json();
}

async function assembleCortexPacket(domain: string, maxTokens: number | null) {
  const allowPrivate = domain === "personal";
  const docsRaw = await opsGet(
    "cortex_documents?select=doc_id,domain,title,version,last_updated,sensitivity,body_md&order=doc_id.asc"
  );
  const docs = (docsRaw as Array<Record<string, unknown>>).filter(
    (d) => (d.domain === "global" || d.domain === domain) && (allowPrivate || d.sensitivity !== "private")
  );
  const provenance = docs.map((d) => ({
    doc_id: d.doc_id, version: d.version, last_updated: d.last_updated, domain: d.domain,
  }));
  const PRIORITY: Record<string, number> = {
    "01_CONTEXT-SPINE": 1, "04_ORCHESTRATION": 2, "02_AGENT-REGISTRY": 3,
    "03_DOMAIN-MAP": 5, "00_CORTEX-CHARTER": 6, "05_ARCHITECTURE-PRINCIPLES": 7,
    "06_ARCHITECTURE-AND-BUILD-PLAN": 8,
  };
  const rank = (d: Record<string, unknown>) =>
    (String(d.domain) !== "global" ? 4 : (PRIORITY[String(d.doc_id)] ?? 9));
  const ordered = [...docs].sort((a, b) => rank(a) - rank(b));
  const sections: Array<Record<string, unknown>> = [];
  let running = 0;
  for (const d of ordered) {
    const body = String(d.body_md || "");
    const t = estimateTokens({ body });
    if (maxTokens && running + t > maxTokens && sections.length > 0) continue;
    running += t;
    sections.push({
      doc_id: d.doc_id, domain: d.domain, title: d.title,
      version: d.version, last_updated: d.last_updated, body_md: body,
    });
  }
  return {
    kind: "cortex_context",
    requested_domain: domain,
    boundary: allowPrivate ? "personal (private docs included)" : "private docs excluded",
    doc_count: sections.length,
    token_count: running,
    provenance,
    docs: sections,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return Response.json({ service: "context-broker-cortex", build: "A1-canary", ok: true });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* empty body ok */ }
  const domain = (body.domain as string) || "global";
  const maxTokens = (body.max_tokens as number) || null;
  try {
    return Response.json(await assembleCortexPacket(domain, maxTokens));
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
});
