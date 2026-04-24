#!/usr/bin/env python3
"""
Integration test for the intake-matcher feedback loop.

Exercises:
    POST /api/intake/feedback   — record approval / rejection / correction
    GET  /api/intake/feedback   — list decisions for an intake
    GET  /api/intake/accuracy   — rollup stats (with ?fresh=true to recompute)

Usage:
    LCC_API_KEY=... python scripts/test_feedback_loop.py <existing-intake-id>

Pass an intake_id that already has a match row so the snapshot fields
(original_*) populate. The five intakes staged earlier this session are
good candidates:
    96d633b9-1b7e-4330-87e8-e207bc9a68af  (Johnstown Rd, matched LCC)
    df9fa272-7582-46c3-8f06-1ab5acae25dc  (Sandy OR, matched dialysis)
    766341b7-5de6-4ff0-9c07-a0e007fcc9bf  (Plano courthouse, matched gov)

The test records an 'approved' decision, reads it back, then a 'corrected'
decision (which should upsert via merge-duplicates, not insert a duplicate),
and finally pulls the accuracy rollup with ?fresh=true.

Requires Python 3.9+. No third-party packages.
"""
import sys
import os
import json
import argparse
import urllib.request
import urllib.error


def http_json(method, url, headers=None, json_body=None):
    data = None
    hdrs = dict(headers or {})
    if json_body is not None:
        data = json.dumps(json_body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def pretty(label, status, body):
    print(f"\n{label}  HTTP {status}")
    try:
        print(json.dumps(json.loads(body), indent=2)[:3000])
    except Exception:
        print(body[:1000].decode(errors="replace"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("intake_id", help="UUID of an existing staged intake")
    ap.add_argument("--api-key", default=os.environ.get("LCC_API_KEY", ""))
    ap.add_argument(
        "--host",
        default=os.environ.get(
            "LCC_VERCEL_URL", os.environ.get("LCC_BASE_URL", "https://tranquil-delight-production-633f.up.railway.app")
        ).rstrip("/"),
    )
    args = ap.parse_args()
    if not args.api_key:
        print("ERROR: set --api-key or LCC_API_KEY env var")
        sys.exit(1)

    hdrs = {"X-LCC-Key": args.api_key}
    intake = args.intake_id

    # ---- 0. Fetch the current matcher suggestion so we can pass it to ---
    # ----    the feedback call (mimics what a triage UI would do) -------
    status, body = http_json(
        "POST",
        f"{args.host}/api/intake-extract?intake_id={intake}",
        headers=hdrs,
    )
    pretty("[0] POST extract (get current match)", status, body)
    match_fields = {}
    try:
        extract = json.loads(body)
        mr = extract.get("match_result") or {}
        match_fields = {
            "match_reason":      mr.get("reason"),
            "match_domain":      mr.get("domain"),
            "match_property_id": mr.get("property_id"),
            "match_confidence":  mr.get("confidence"),
        }
    except Exception:
        pass

    # ---- 1. Approve ------------------------------------------------------
    status, body = http_json(
        "POST",
        f"{args.host}/api/intake/feedback",
        headers=hdrs,
        json_body={
            "intake_id": intake,
            "decision":  "approved",
            "reason_text": "Integration test — approval path",
            **match_fields,
        },
    )
    pretty("[1] POST feedback (approved, with match snapshot)", status, body)

    # ---- 2. List history -------------------------------------------------
    status, body = http_json(
        "GET",
        f"{args.host}/api/intake/feedback?intake_id={intake}",
        headers=hdrs,
    )
    pretty("[2] GET feedback (list)", status, body)

    # ---- 3. Correct (upsert — same user, should NOT duplicate) ----------
    status, body = http_json(
        "POST",
        f"{args.host}/api/intake/feedback",
        headers=hdrs,
        json_body={
            "intake_id": intake,
            "decision":  "corrected",
            "corrected_domain":      "lcc",
            "corrected_property_id": "00000000-0000-0000-0000-000000000000",
            "reason_text": "Integration test — correction path (should upsert, not insert)",
            **match_fields,
        },
    )
    pretty("[3] POST feedback (corrected, upsert)", status, body)

    # ---- 4. Re-list — expect single row with updated decision -----------
    status, body = http_json(
        "GET",
        f"{args.host}/api/intake/feedback?intake_id={intake}",
        headers=hdrs,
    )
    pretty("[4] GET feedback (after upsert)", status, body)

    # ---- 5. Accuracy rollup ----------------------------------------------
    status, body = http_json(
        "GET",
        f"{args.host}/api/intake/accuracy?days=30&fresh=true",
        headers=hdrs,
    )
    pretty("[5] GET accuracy (fresh=true)", status, body)


if __name__ == "__main__":
    main()
