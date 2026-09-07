// ============================================================================
// w41-corpus-export — W4.1 training-data export (LCC Audit Rollout Plan)
// Life Command Center
//
// Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Synced to this repo 2026-09-07
// (DRIFT1 Unit 2) from the live deployment (version 3) via Supabase MCP
// `get_edge_function`. This function had NO committed source in the repo
// before this sync — see docs/architecture/edge-function-deploy-drift.md.
//
// LIVE: called nightly by `w44-retrain-tick` (`?action=export`), itself fired
// by pg_cron job `w44-resolver-retrain-nightly` (30 7 * * *) on Dialysis_DB —
// see supabase/functions/w44-retrain-tick/index.ts. Also callable directly
// (documented in docs/resolver/W4_1_CORPUS_REPORT.md and
// docs/resolver/RUNBOOK_railway_resolver_service.md).
//
// Assembles the labeled entity-pair training corpus for the resolver from the
// live DBs (gov + dia + ops), entirely server-side, and uploads it as JSONL to
// LCC Opps Storage at entity-resolution/w4_1/labeled_pairs.jsonl (the exact
// object the resolver's /train fetches — see resolver/app/config.py defaults).
//
// Sources (positives):
//   gov/dia dq5_owner_merge_map        survivor/duplicate recorded-owner names
//   gov/dia dq5_true_owner_merge_map   survivor/duplicate true-owner names
//   ops entities soft merges           merged_into_entity_id pairs (incl. Boyd
//                                      Watterson reconciliation 20260725120000)
//   ops entity_match_labels            W3.2 human labels (same_party -> 1)
//   ops lcc_decisions owner_reconcile  approve verdicts (owner vs candidate)
//   ops lcc_decisions exact_name_merge merged verdicts (exact-string pairs)
// Negatives:
//   generated same-state different-owner pairs (gov + dia recorded_owners,
//   ops entities same-city), guarded: a candidate negative is dropped when the
//   two names share any rare token (len>=5) or collide with a known positive —
//   so an accidental same-party pair is very unlikely to be mislabeled.
//
// Split: union-find over positive pairs -> entity components; component hashed
// (FNV-1a) to train/valid/test 80/10/10. Negatives adopt name_a's component.
// Split-by-entity (not by pair) per the W4.1 spec, to avoid leakage.
//
// Actions (auth: X-PA-Webhook-Secret == PA_WEBHOOK_SECRET):
//   GET  ?action=preview  assemble + return summary only (no writes)
//   POST ?action=export   assemble + upload JSONL + report to ops Storage
//
// This function performs NO domain-table writes. Storage upload only.
//
// Before redeploying this file, re-diff it against the live deployment
// (Supabase MCP `get_edge_function`, project zqzrriwuavgrquhisnoa, slug
// w41-corpus-export).
// ============================================================================

const BUCKET = "entity-resolution";
const OBJECT = "w4_1/labeled_pairs.jsonl";
const REPORT_OBJECT = "w4_1/corpus_report.json";

type Env = { url: string; key: string };

function env(name: string): string | undefined { return Deno.env.get(name); }
function dbEnv(which: "gov" | "dia" | "ops"): Env | null {
  const map = {
    gov: ["GOV_SUPABASE_URL", "GOV_SUPABASE_KEY"],
    dia: ["DIA_SUPABASE_URL", "DIA_SUPABASE_KEY"],
    ops: ["OPS_SUPABASE_URL", "OPS_SUPABASE_SERVICE_KEY"],
  } as const;
  const [u, k] = map[which];
  const url = env(u), key = env(k);
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

async function rest(e: Env, path: string): Promise<unknown[]> {
  const res = await fetch(`${e.url}/rest/v1/${path}`, {
    headers: { apikey: e.key, Authorization: `Bearer ${e.key}` },
  });
  if (!res.ok) throw new Error(`REST ${path.split("?")[0]} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Paginate past PostgREST's 1000-row cap.
async function restAll(e: Env, base: string, pageSize = 1000, hardCap = 20000): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const sep = base.includes("?") ? "&" : "?";
    const page = await rest(e, `${base}${sep}limit=${pageSize}&offset=${offset}`);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ── pair shape ──────────────────────────────────────────────────────────────
interface Pair {
  name_a: string; name_b: string;
  addr_a?: string | null; addr_b?: string | null;
  state_a?: string | null; state_b?: string | null;
  sf_account_a?: string | null; sf_account_b?: string | null;
  email_a?: string | null; email_b?: string | null;
  label: 0 | 1; source: string; domain?: string | null;
  decided_at?: string | null; entity_group?: string; split?: string;
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function pairKey(a: string, b: string): string {
  const [x, y] = [norm(a), norm(b)].sort();
  return `${x}||${y}`;
}
const STOP = new Set(["llc", "inc", "corp", "trust", "company", "group", "partners", "properties", "holdings", "realty", "capital", "estate", "family", "limited", "management"]);
function rareTokens(name: string): Set<string> {
  return new Set(norm(name).split(" ").filter((t) => t.length >= 5 && !STOP.has(t)));
}
function shareRareToken(a: string, b: string): boolean {
  const ta = rareTokens(a);
  for (const t of rareTokens(b)) if (ta.has(t)) return true;
  return false;
}

// FNV-1a for the deterministic split hash (no Math.random in this function —
// results must be reproducible run-to-run).
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// ── union-find (positive pairs only) ────────────────────────────────────────
class UF {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== c) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

// ── source extractors ───────────────────────────────────────────────────────
async function dq5Maps(which: "gov" | "dia", pairs: Pair[]): Promise<Record<string, number>> {
  const e = dbEnv(which);
  if (!e) throw new Error(`${which} DB not configured`);
  const counts: Record<string, number> = {};
  for (const [table, ownerTable, idCol] of [
    ["dq5_owner_merge_map", "recorded_owners", "recorded_owner_id"],
    ["dq5_true_owner_merge_map", "true_owners", "true_owner_id"],
  ] as const) {
    const rows = await restAll(e, `${table}?select=survivor_id,survivor_name,duplicate_name,created_at`) as Record<string, unknown>[];
    // survivor state lookup (duplicates are gone post-merge; survivor state is the anchor)
    const ids = [...new Set(rows.map((r) => String(r.survivor_id || "")).filter(Boolean))];
    const stateById = new Map<string, string>();
    for (const ch of chunk(ids, 150)) {
      const inList = ch.map((i) => `"${i}"`).join(",");
      const owners = await rest(e, `${ownerTable}?${idCol}=in.(${inList})&select=${idCol},state`) as Record<string, unknown>[];
      for (const o of owners) if (o.state) stateById.set(String(o[idCol]), String(o.state));
    }
    let n = 0;
    for (const r of rows) {
      const a = String(r.survivor_name || "").trim(), b = String(r.duplicate_name || "").trim();
      if (!a || !b) continue;
      const st = stateById.get(String(r.survivor_id)) ?? null;
      pairs.push({ name_a: a, name_b: b, state_a: st, state_b: st, label: 1, source: table, domain: which, decided_at: r.created_at ? String(r.created_at) : null });
      n++;
    }
    counts[`${which}.${table}`] = n;
  }
  return counts;
}

async function opsSoftMerges(pairs: Pair[]): Promise<number> {
  const e = dbEnv("ops");
  if (!e) throw new Error("ops DB not configured");
  const losers = await restAll(e, `entities?merged_into_entity_id=not.is.null&select=name,address,city,state,email,merged_into_entity_id,updated_at`) as Record<string, unknown>[];
  const winnerIds = [...new Set(losers.map((l) => String(l.merged_into_entity_id)))];
  const winners = new Map<string, Record<string, unknown>>();
  for (const ch of chunk(winnerIds, 100)) {
    const inList = ch.map((i) => `"${i}"`).join(",");
    const ws = await rest(e, `entities?id=in.(${inList})&select=id,name,address,city,state,email`) as Record<string, unknown>[];
    for (const w of ws) winners.set(String(w.id), w);
  }
  let n = 0;
  const addr = (r: Record<string, unknown>) =>
    [r.address, r.city, r.state].filter(Boolean).join(", ") || null;
  for (const l of losers) {
    const w = winners.get(String(l.merged_into_entity_id));
    if (!w) continue;
    const a = String(l.name || "").trim(), b = String(w.name || "").trim();
    if (!a || !b) continue;
    pairs.push({
      name_a: a, name_b: b, addr_a: addr(l), addr_b: addr(w),
      state_a: l.state ? String(l.state) : null, state_b: w.state ? String(w.state) : null,
      email_a: l.email ? String(l.email) : null, email_b: w.email ? String(w.email) : null,
      label: 1, source: "ops_soft_merge", domain: "ops",
      decided_at: l.updated_at ? String(l.updated_at) : null,
    });
    n++;
  }
  return n;
}

async function opsLabelsAndDecisions(pairs: Pair[]): Promise<Record<string, number>> {
  const e = dbEnv("ops");
  if (!e) throw new Error("ops DB not configured");
  const counts: Record<string, number> = {};

  const labels = await restAll(e, `entity_match_labels?select=owner_a,owner_b,verdict,source_domain,decided_at`) as Record<string, unknown>[];
  let n = 0;
  for (const r of labels) {
    const a = String(r.owner_a || "").trim(), b = String(r.owner_b || "").trim();
    if (!a || !b) continue;
    pairs.push({ name_a: a, name_b: b, label: r.verdict === "same_party" ? 1 : 0, source: "entity_match_labels", domain: r.source_domain ? String(r.source_domain) : null, decided_at: r.decided_at ? String(r.decided_at) : null });
    n++;
  }
  counts["ops.entity_match_labels"] = n;

  const recon = await restAll(e, `lcc_decisions?decision_type=eq.owner_reconcile&verdict=eq.approve&decided_at=not.is.null&select=context,decided_at`) as Record<string, unknown>[];
  n = 0;
  for (const r of recon) {
    const c = (r.context ?? {}) as Record<string, unknown>;
    const a = String(c.owner_name || "").trim();
    const b = String(c.candidate_company || c.candidate_display || "").trim();
    if (!a || !b) continue;
    pairs.push({
      name_a: a, name_b: b,
      addr_a: [c.owner_property_address, c.owner_property_city, c.owner_property_state].filter(Boolean).join(", ") || null,
      addr_b: [c.candidate_city, c.candidate_state].filter(Boolean).join(", ") || null,
      state_a: c.owner_property_state ? String(c.owner_property_state) : null,
      state_b: c.candidate_state ? String(c.candidate_state) : null,
      email_b: c.candidate_email ? String(c.candidate_email) : null,
      label: 1, source: "owner_reconcile_approve", domain: c.domain ? String(c.domain) : null,
      decided_at: r.decided_at ? String(r.decided_at) : null,
    });
    n++;
  }
  counts["ops.owner_reconcile_approve"] = n;

  const exact = await restAll(e, `lcc_decisions?decision_type=eq.exact_name_merge&verdict=eq.merged&decided_at=not.is.null&select=verdict_payload,decided_at`) as Record<string, unknown>[];
  n = 0;
  for (const r of exact) {
    const v = (r.verdict_payload ?? {}) as Record<string, unknown>;
    const nm = String(v.name || "").trim();
    if (!nm) continue;
    pairs.push({ name_a: nm, name_b: nm, label: 1, source: "exact_name_merge", domain: "ops", decided_at: r.decided_at ? String(r.decided_at) : null });
    n++;
  }
  counts["ops.exact_name_merge"] = n;
  return counts;
}

// Deterministic shuffle (seeded LCG — Math.random is nondeterministic).
function shuffled<T>(xs: T[], seed: number): T[] {
  const a = xs.slice();
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function hardNegatives(pairs: Pair[], positiveKeys: Set<string>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const targets: Array<["gov" | "dia" | "ops", string, string, number]> = [
    ["gov", `recorded_owners?state=not.is.null&name=not.is.null&select=name,state&order=recorded_owner_id`, "state", 700],
    ["dia", `recorded_owners?state=not.is.null&name=not.is.null&select=name,state&order=recorded_owner_id`, "state", 700],
    ["ops", `entities?city=not.is.null&name=not.is.null&merged_into_entity_id=is.null&select=name,city,state&order=id`, "city", 400],
  ];
  for (const [which, q, groupCol, want] of targets) {
    const e = dbEnv(which);
    if (!e) { counts[`${which}.hard_negative`] = 0; continue; }
    const rows = shuffled(await restAll(e, q, 1000, 4000) as Record<string, unknown>[], fnv(which));
    const byGroup = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const g = norm(r[groupCol]);
      if (!g) continue;
      (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(r);
    }
    let n = 0;
    outer: for (const [, members] of byGroup) {
      for (let i = 0; i + 1 < members.length && n < want; i += 2) {
        const a = String(members[i].name || "").trim(), b = String(members[i + 1].name || "").trim();
        if (!a || !b) continue;
        if (norm(a) === norm(b)) continue;                    // same party, obviously
        if (shareRareToken(a, b)) continue;                    // could be same party — refuse to mislabel
        if (positiveKeys.has(pairKey(a, b))) continue;        // known positive
        pairs.push({
          name_a: a, name_b: b,
          state_a: members[i].state ? String(members[i].state) : null,
          state_b: members[i + 1].state ? String(members[i + 1].state) : null,
          addr_a: groupCol === "city" ? String(members[i].city || "") || null : null,
          addr_b: groupCol === "city" ? String(members[i + 1].city || "") || null : null,
          label: 0, source: `hard_negative_same_${groupCol}`, domain: which,
        });
        n++;
        if (n >= want) break outer;
      }
    }
    counts[`${which}.hard_negative_same_${groupCol}`] = n;
  }
  return counts;
}

// ── assembly ────────────────────────────────────────────────────────────────
async function assemble(): Promise<{ pairs: Pair[]; counts: Record<string, number> }> {
  const pairs: Pair[] = [];
  const counts: Record<string, number> = {};
  Object.assign(counts, await dq5Maps("gov", pairs));
  Object.assign(counts, await dq5Maps("dia", pairs));
  counts["ops.soft_merge"] = await opsSoftMerges(pairs);
  Object.assign(counts, await opsLabelsAndDecisions(pairs));

  // dedupe positives by unordered normalized pair key (keep first)
  const seen = new Set<string>();
  const deduped: Pair[] = [];
  for (const p of pairs) {
    const k = pairKey(p.name_a, p.name_b);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(p);
  }
  counts["deduped_dropped"] = pairs.length - deduped.length;

  const positiveKeys = new Set(deduped.filter((p) => p.label === 1).map((p) => pairKey(p.name_a, p.name_b)));
  Object.assign(counts, await hardNegatives(deduped, positiveKeys));

  // entity groups: union positives; negatives adopt name_a's component
  const uf = new UF();
  for (const p of deduped) if (p.label === 1) uf.union(norm(p.name_a), norm(p.name_b));
  const groupIds = new Map<string, string>();
  for (const p of deduped) {
    const root = uf.find(norm(p.name_a));
    if (!groupIds.has(root)) groupIds.set(root, `g${(groupIds.size + 1).toString().padStart(5, "0")}`);
    p.entity_group = groupIds.get(root)!;
    const h = fnv(root) % 10;
    p.split = h < 8 ? "train" : h === 8 ? "valid" : "test";
  }
  counts["entity_groups"] = groupIds.size;
  return { pairs: deduped, counts };
}

function summarize(pairs: Pair[], counts: Record<string, number>) {
  const by = (f: (p: Pair) => string) => {
    const m: Record<string, number> = {};
    for (const p of pairs) { const k = f(p); m[k] = (m[k] ?? 0) + 1; }
    return m;
  };
  return {
    total_pairs: pairs.length,
    class_balance: by((p) => p.label === 1 ? "positive" : "negative"),
    by_split: by((p) => p.split ?? "?"),
    by_split_and_label: by((p) => `${p.split}:${p.label}`),
    by_source: by((p) => p.source),
    entity_groups: counts["entity_groups"],
    source_counts: counts,
  };
}

async function uploadOps(path: string, body: string, contentType: string): Promise<void> {
  const e = dbEnv("ops");
  if (!e) throw new Error("ops DB not configured");
  // ensure bucket (409 = exists, fine)
  await fetch(`${e.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  const res = await fetch(`${e.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, "Content-Type": contentType, "x-upsert": "true" },
    body,
  });
  if (!res.ok) throw new Error(`storage upload ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const secret = env("PA_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-pa-webhook-secret") !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  try {
    if (action === "preview" || action === "export") {
      const { pairs, counts } = await assemble();
      const summary = summarize(pairs, counts);
      if (action === "preview") {
        return new Response(JSON.stringify({ ok: true, mode: "preview", ...summary }), { headers: { "Content-Type": "application/json" } });
      }
      const jsonl = pairs.map((p) => JSON.stringify(p)).join("\n") + "\n";
      const sha = await sha256Hex(jsonl);
      const report = { generated_at: new Date().toISOString(), object: `${BUCKET}/${OBJECT}`, sha256: sha, bytes: jsonl.length, ...summary };
      await uploadOps(OBJECT, jsonl, "application/x-ndjson");
      await uploadOps(REPORT_OBJECT, JSON.stringify(report, null, 2), "application/json");
      return new Response(JSON.stringify({ ok: true, mode: "export", uploaded: [`${BUCKET}/${OBJECT}`, `${BUCKET}/${REPORT_OBJECT}`], sha256: sha, bytes: jsonl.length, ...summary }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, actions: ["preview (GET)", "export (POST)"], target: `${BUCKET}/${OBJECT}` }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
