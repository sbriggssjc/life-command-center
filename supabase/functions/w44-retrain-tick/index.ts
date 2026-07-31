// ============================================================================
// w44-retrain-tick — nightly resolver retrain loop (W4.4)
// Life Command Center
//
// Hosting: Dialysis_DB (zqzrriwuavgrquhisnoa) — the one project holding gov+dia
// +ops creds. Invoked nightly by pg_cron with X-PA-Webhook-Secret (the
// sf-files-stage-queued-15m pattern). NEVER GitHub Actions.
//
// Steps (sequenced — a failed corpus refresh MUST NOT train against a stale
// object; the export is atomic via x-upsert so ordering is the only concern):
//   1. Refresh the labeled corpus: POST w41-corpus-export?action=export on this
//      same project (new entity_match_labels rows — incl. the accruing
//      sf_link_review verdicts — flow in automatically; deterministic + idempotent).
//   2. For each model (owner_owner / owner_sf / contact): POST the Railway
//      resolver /train with use_storage + target_precision. This ALSO heals the
//      ephemeral-model problem after any resolver redeploy (Railway fs is
//      ephemeral; a redeploy reverts to fixture-trained defaults until /train).
//   3. Record the run + alarm drift/failure via the ops RPC
//      lcc_record_resolver_retrain (calibration history + lcc_health_alerts).
//
// Loud, never silent: a corpus-refresh failure, a train failure, or an unset
// RESOLVER_URL all reach lcc_record_resolver_retrain, which opens a
// resolver_retrain_failure alert (deduped). Drift (precision drop / band-floor
// hit / unexpected trainer) opens resolver_calibration_drift.
//
// This function performs NO domain writes: it triggers the export (which writes
// only to Storage) and the resolver (read-only scorer), and records to ops.
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { isoNow } from "../_shared/utils.ts";
import { opsClient } from "../_shared/supabase-client.ts";

const MODELS = ["owner_owner", "owner_sf", "contact"];
const TRAIN_TIMEOUT_MS = 180_000; // resolver /train can be slow (libpostal + corpus)

interface ModelResult {
  model: string;
  ok: boolean;
  trainer?: string;
  n_train?: number;
  n_test?: number;
  target_precision?: number;
  auto_link?: number;
  auto_reject?: number;
  band_floor?: number;
  auto_link_floored?: boolean;
  precision?: number;
  recall?: number;
  needs_review?: number;
  raw?: unknown;
  error?: string;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (!authenticateWebhook(req)) return errorResponse(req, "unauthorized", 401);
  if (req.method === "GET") {
    return jsonResponse(req, {
      function: "w44-retrain-tick",
      purpose: "nightly resolver corpus-refresh + /train + calibration-drift alerting (W4.4)",
      models: MODELS,
      resolver_url_configured: Boolean(Deno.env.get("RESOLVER_URL")),
    });
  }

  const runId = `w44-${isoNow()}`;
  const resolverUrl = (Deno.env.get("RESOLVER_URL") || "").replace(/\/$/, "");
  const targetPrecision = Number(Deno.env.get("RESOLVER_TARGET_PRECISION") || "0.995");
  const selfBase = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const paSecret = Deno.env.get("PA_WEBHOOK_SECRET") || "";

  // ── Step 1: refresh the corpus ──
  let corpusRefreshed = false;
  let refreshError: string | null = null;
  let corpusLabel: string | null = null;
  try {
    const r = await fetch(`${selfBase}/functions/v1/w41-corpus-export?action=export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PA-Webhook-Secret": paSecret },
      body: "{}",
    });
    const txt = await r.text();
    if (!r.ok) {
      refreshError = `export ${r.status}: ${txt.slice(0, 300)}`;
    } else {
      corpusRefreshed = true;
      try {
        const j = JSON.parse(txt);
        corpusLabel = j.object || j.path || j.corpus || j.corpus_path || null;
      } catch { /* label is best-effort */ }
    }
  } catch (e) {
    refreshError = `export threw: ${String(e).slice(0, 300)}`;
  }

  // ── Step 2: train each model (ONLY if the corpus refreshed) ──
  const models: ModelResult[] = [];
  if (corpusRefreshed) {
    for (const m of MODELS) {
      if (!resolverUrl) {
        models.push({ model: m, ok: false, error: "RESOLVER_URL unset on the edge runtime" });
        continue;
      }
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), TRAIN_TIMEOUT_MS);
        const r = await fetch(`${resolverUrl}/train`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m, use_storage: true, target_precision: targetPrecision }),
          signal: ctrl.signal,
        });
        clearTimeout(to);
        const txt = await r.text();
        if (!r.ok) {
          models.push({ model: m, ok: false, error: `train ${r.status}: ${txt.slice(0, 300)}` });
          continue;
        }
        const j = JSON.parse(txt);
        const cal = j.calibration || {};
        const al = cal.auto_link || {};
        if (!corpusLabel) corpusLabel = j.corpus || null;
        models.push({
          model: m,
          ok: true,
          trainer: j.trainer,
          n_train: j.n_train_pairs,
          n_test: j.n_test_pairs,
          target_precision: targetPrecision,
          auto_link: j.bands?.auto_link,
          auto_reject: j.bands?.auto_reject,
          band_floor: j.band_floor,
          auto_link_floored: j.auto_link_floored,
          precision: al.precision,
          recall: al.recall_of_positives,
          needs_review: cal.needs_review_count,
          raw: cal,
        });
      } catch (e) {
        const msg = String(e).includes("AbortError") ? "train timed out" : `train threw: ${String(e).slice(0, 300)}`;
        models.push({ model: m, ok: false, error: msg });
      }
    }
  }

  // ── Step 3: record + alarm (ops RPC) ──
  const run = {
    run_id: runId,
    corpus: corpusLabel,
    corpus_refreshed: corpusRefreshed,
    refresh_error: refreshError,
    models,
  };
  let recorded: unknown = null;
  let recordError: string | null = null;
  try {
    const { data, error } = await opsClient().rpc("lcc_record_resolver_retrain", { p_run: run });
    if (error) recordError = error.message;
    else recorded = data;
  } catch (e) {
    recordError = String(e).slice(0, 300);
  }

  return jsonResponse(req, {
    run_id: runId,
    corpus_refreshed: corpusRefreshed,
    refresh_error: refreshError,
    models: models.map((m) => ({
      model: m.model,
      ok: m.ok,
      trainer: m.trainer,
      auto_link: m.auto_link,
      precision: m.precision,
      auto_link_floored: m.auto_link_floored,
      error: m.error,
    })),
    recorded,
    record_error: recordError,
  });
});
