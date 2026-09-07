// ============================================================================
// cortex-webex-sync — Webex (personal-integration) call history -> activity_events
// Project: LCC Opps (xengecqvemvfknjvbvrq)
//
// Synced to this repo 2026-09-07 (DRIFT1 Unit 2) from the live deployment
// (version 6) via Supabase MCP `get_edge_function`. This function had NO
// committed source in the repo before this sync — see
// docs/architecture/edge-function-deploy-drift.md for the census that found
// it and the runbook for finding the next one.
//
// LIVE: cron.job jobid 159 on LCC Opps polls it every 30 minutes
//   (`select net.http_get(url := '.../functions/v1/cortex-webex-sync', ...)`).
// WRITES: `activity_events` (matches a Webex call to a contact by phone via
//   `rpc/lcc_entity_by_phone`, inserts one row per matched call, de-duplicated
//   on a synthetic `external_id`). Also reads/writes `cortex_oauth_tokens` for
//   the OAuth token lifecycle (setup/auth/callback/refresh).
//
// Modes (query params): ?action=setup&client_id&client_secret | ?action=auth
// | callback (?code=) | default = poll (refresh token if needed, pull call
// history for placed/missed/received, match by phone, insert activity_events).
//
// Before redeploying this file, re-diff it against the live deployment
// (Supabase MCP `get_edge_function`, project xengecqvemvfknjvbvrq, slug
// cortex-webex-sync).
// ============================================================================

// cortex-webex-sync — Webex (user-level) calls -> activity_events spine.
// Modes (query): ?action=setup&client_id&client_secret | ?action=auth | callback (?code=) | default=poll.
// Auth: personal Webex Integration (spark:calls_read). Forward-capture, matched to contacts by phone.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIRECT = "https://xengecqvemvfknjvbvrq.supabase.co/functions/v1/cortex-webex-sync";
const WS = "a0000000-0000-0000-0000-000000000001";
const ACTOR = "b0000000-0000-0000-0000-000000000001";
const SCOPES = "spark:calls_read spark:messages_read spark:rooms_read spark:kms";

async function rest(path: string, init?: RequestInit) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("rest " + r.status + ": " + t);
  return t ? JSON.parse(t) : null;
}
async function getCfg() { const rows = await rest("cortex_oauth_tokens?provider=eq.webex&limit=1"); return rows && rows[0]; }
async function saveCfg(patch: Record<string, unknown>) {
  patch.provider = "webex"; patch.updated_at = new Date().toISOString();
  await rest("cortex_oauth_tokens?on_conflict=provider", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(patch) });
}
async function accessToken(cfg: Record<string, string>) {
  if (cfg.access_token && cfg.expires_at && new Date(cfg.expires_at).getTime() > Date.now() + 60000) return cfg.access_token;
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token });
  const r = await fetch("https://webexapis.com/v1/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("refresh failed: " + JSON.stringify(j));
  await saveCfg({ access_token: j.access_token, expires_at: new Date(Date.now() + ((j.expires_in || 3600) - 120) * 1000).toISOString(), refresh_token: j.refresh_token || cfg.refresh_token });
  return j.access_token;
}
const digits = (s: string) => (s || "").replace(/\D/g, "");
async function entityByPhone(num: string): Promise<string | null> {
  try { const r = await rest("rpc/lcc_entity_by_phone", { method: "POST", body: JSON.stringify({ p_phone: num }) });
    if (!r) return null; if (typeof r === "string") return r; if (Array.isArray(r)) return (r[0] && (r[0].lcc_entity_by_phone || r[0])) || null; return null;
  } catch { return null; }
}
async function pollCalls(token: string) {
  let matched = 0, inserted = 0, seen = 0;
  for (const type of ["placed", "missed", "received"]) {
    const r = await fetch("https://webexapis.com/v1/telephony/calls/history?type=" + type, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) continue;
    const j = await r.json();
    for (const c of (j.items || [])) {
      seen++;
      const num = c.number || "";
      const eid = await entityByPhone(num);
      if (!eid) continue;
      matched++;
      const ext = "webex:" + type + ":" + (c.time || "") + ":" + digits(num);
      const row = { workspace_id: WS, actor_id: ACTOR, category: "call", source_type: "webex", external_id: ext, entity_id: eid,
        occurred_at: c.time || new Date().toISOString(), title: "Webex call (" + type + ") · " + (c.name || num || "unknown"), domain: "business",
        metadata: { type, name: c.name || null, number: num, privacyEnabled: c.privacyEnabled || false } };
      try { await rest("activity_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }); inserted++; }
      catch (e) { if (!String(e).includes("23505") && !String(e).includes("duplicate")) throw e; }
    }
  }
  return { seen, matched, inserted };
}
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const code = url.searchParams.get("code");
  try {
    if (action === "setup") {
      const cid = url.searchParams.get("client_id"); const sec = url.searchParams.get("client_secret");
      if (!cid || !sec) return new Response("Provide client_id and client_secret", { status: 400 });
      await saveCfg({ client_id: cid, client_secret: sec });
      const auth = "https://webexapis.com/v1/authorize?client_id=" + encodeURIComponent(cid) + "&response_type=code&redirect_uri=" + encodeURIComponent(REDIRECT) + "&scope=" + encodeURIComponent(SCOPES) + "&state=cortex";
      return new Response("Saved. Now click to authorize:\n\n" + auth, { headers: { "Content-Type": "text/plain" } });
    }
    if (action === "auth") {
      const cfg = await getCfg(); if (!cfg?.client_id) return new Response("Run ?action=setup first", { status: 400 });
      const auth = "https://webexapis.com/v1/authorize?client_id=" + encodeURIComponent(cfg.client_id) + "&response_type=code&redirect_uri=" + encodeURIComponent(REDIRECT) + "&scope=" + encodeURIComponent(SCOPES) + "&state=cortex";
      return Response.redirect(auth, 302);
    }
    if (code) {
      const cfg = await getCfg(); if (!cfg?.client_id) return new Response("No client config", { status: 400 });
      const body = new URLSearchParams({ grant_type: "authorization_code", client_id: cfg.client_id, client_secret: cfg.client_secret, code, redirect_uri: REDIRECT });
      const r = await fetch("https://webexapis.com/v1/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      const j = await r.json();
      if (!j.access_token) return new Response("Token exchange failed: " + JSON.stringify(j), { status: 400 });
      await saveCfg({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: new Date(Date.now() + ((j.expires_in || 3600) - 120) * 1000).toISOString(), scope: SCOPES });
      return new Response("✅ Webex connected to Cortex. You can close this tab.", { headers: { "Content-Type": "text/plain" } });
    }
    // default: poll
    const cfg = await getCfg();
    if (!cfg?.refresh_token) return Response.json({ ok: false, error: "not connected — run setup + authorize" }, { status: 400 });
    const token = await accessToken(cfg);
    const res = await pollCalls(token);
    return Response.json({ ok: true, ...res });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
  }
});
