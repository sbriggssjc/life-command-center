// ============================================================================
// personal-search - F2: query the personal-domain file index (public.personal_files).
// SEPARATE from business /api/search by design (Cortex §3 boundary): this function
// ONLY reads personal_files (domain=personal) and never touches business sources.
// Returns NORMAL-sensitivity files only; private (F3) requires an explicit scope.
// Self-contained: reads the injected SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function computeScore(term: string, name: string, path: string): number {
  const s = (term || "").toLowerCase();
  const n = (name || "").toLowerCase();
  const p = (path || "").toLowerCase();
  if (!s) return 0;
  if (n === s) return 100;
  if (n.startsWith(s)) return 80;
  if (n.includes(s)) return 60;
  if (p.includes(s)) return 40;
  return 20;
}

async function opsGet(path: string) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
  });
  if (!res.ok) throw new Error("opsGet " + res.status + ": " + (await res.text()));
  return res.json();
}

async function searchPersonal(q: string, limit: number) {
  const enc = encodeURIComponent(q);
  const rows = await opsGet(
    `personal_files?sensitivity=eq.normal&or=(name.ilike.*${enc}*,rel_path.ilike.*${enc}*)` +
    `&select=id,rel_path,name,ext,top_folder,size_bytes,modified_at&order=modified_at.desc.nullslast&limit=${limit}`
  ) as Array<Record<string, unknown>>;
  return rows
    .map((r) => {
      const year = r.modified_at ? String(r.modified_at).slice(0, 4) : null;
      const sub = [r.top_folder, r.ext, year].filter(Boolean).join(" · ");
      return {
        id: "pf:" + r.id,
        type: "personal_file",
        title: r.name,
        subtitle: sub || null,
        domain: "personal",
        top_folder: r.top_folder,
        rel_path: r.rel_path,
        score: computeScore(q, String(r.name || ""), String(r.rel_path || "")),
      };
    })
    .sort((a, b) => b.score - a.score);
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return Response.json({ service: "personal-search", scope: "personal (normal)", ok: true });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* empty ok */ }
  const q = String(body.q ?? "").replace(/[%_]/g, "").trim();
  const limit = Math.min(Math.max(parseInt(String(body.limit ?? "20"), 10) || 20, 1), 50);
  if (q.length < 2) return Response.json({ error: "q must be at least 2 characters" }, { status: 400 });
  try {
    return Response.json(await searchPersonal(q, limit));
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
});
