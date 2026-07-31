#!/usr/bin/env python3
"""Train the shipped default models from the fixture corpus and emit CALIBRATION.md.

Run from the repo root:  python -m resolver.scripts.gen_models_and_calibration
(or  cd resolver && python scripts/gen_models_and_calibration.py)

This is the offline artifact builder. When the real W4.1 corpus lands in Storage, the
SAME logic runs live via POST /train — this script simply reproduces it for the models
committed to the image and for the docs/resolver/CALIBRATION.md report.
"""
from __future__ import annotations

import os
import sys

# Allow running as a plain script (resolver/scripts/…) or as a module.
_HERE = os.path.dirname(os.path.abspath(__file__))
_RESOLVER = os.path.dirname(_HERE)
_REPO = os.path.dirname(_RESOLVER)
for p in (_REPO, _RESOLVER):
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from app.calibration import calibration_report
    from app.corpus import load_corpus, load_stub_pairs, split_of
    from app.features import MODELS
    from app.train import splink_available, train_model
    from app import __version__
except ImportError:  # module-style import
    from resolver.app.calibration import calibration_report
    from resolver.app.corpus import load_corpus, load_stub_pairs, split_of
    from resolver.app.features import MODELS
    from resolver.app.train import splink_available, train_model
    from resolver.app import __version__

FIXTURES = os.path.join(_RESOLVER, "fixtures")
DOCS = os.path.join(_REPO, "docs", "resolver")


def _fmt_curve(curve, keep=(0.0, 0.2, 0.5, 0.7, 0.8, 0.9, 0.92, 0.95, 0.99)):
    rows = []
    have = {round(r["threshold"], 2): r for r in curve}
    for t in keep:
        r = have.get(round(t, 2))
        if r:
            rows.append(r)
    return rows


def main():
    # Real corpus when SUPABASE_URL/RESOLVER_STORAGE_KEY are set (same path /train
    # uses); the committed fixture stub otherwise. W4.1 landed 2026-07-31, so CI/dev
    # without creds still regenerates from the stub, while the release artifacts are
    # built from storage://entity-resolution/w4_1/labeled_pairs.jsonl.
    pairs, corpus_label = load_corpus(prefer_storage=True)
    train_pairs = [p for p in pairs if split_of(p) in ("train", "valid")]
    test_pairs = [p for p in pairs if split_of(p) == "test"]

    os.makedirs(DOCS, exist_ok=True)
    lines = []
    lines.append("# Entity-Resolution Resolver — Calibration Report")
    lines.append("")
    lines.append(f"**Service version:** {__version__}  ")
    lines.append("**Audit unit:** W4.2 (LCC Audit Rollout Plan)  ")
    lines.append(f"**Corpus:** `{corpus_label}`  ")
    lines.append(f"**splink installed in this build:** {splink_available()}  ")
    lines.append("")
    if corpus_label == "fixtures":
        lines.append(
            "> ⚠️ **This report is computed on the committed fixture stub, not the live W4.1 "
            "training set** (SUPABASE_URL/RESOLVER_STORAGE_KEY were unset when it was "
            "generated). Set them and re-run to regenerate against the real corpus."
        )
    else:
        lines.append(
            "> ✅ **This report is computed on the live W4.1 corpus** (delivered "
            "2026-07-31 — see docs/resolver/W4_1_CORPUS_REPORT.md for composition and "
            "known gaps: sf_account/email are null in this corpus, so the owner_sf and "
            "contact models are effectively name/address-calibrated until W4.3 feeds "
            "back SF-linked pairs)."
        )
    lines.append("")
    lines.append(f"- Train pairs: **{len(train_pairs)}**  ")
    lines.append(f"- Test pairs: **{len(test_pairs)}**  ")
    lines.append("- Split key: `entity_group` (no group spans train+test → no leakage).")
    lines.append("")

    for model in MODELS:
        fs = train_model(train_pairs, model)
        report = calibration_report(fs, test_pairs, target_precision=0.995)
        fs.auto_link = report["bands"]["auto_link"]
        fs.auto_reject = report["bands"]["auto_reject"]
        fs.meta["corpus"] = corpus_label
        out_path = os.path.join(FIXTURES, f"model_{model}.json")
        fs.save(out_path)

        al = report["auto_link"]
        ar = report["auto_reject"]
        lines.append(f"## Model `{model}`")
        lines.append("")
        lines.append(f"- Trainer: `{fs.meta.get('trainer')}`  ")
        lines.append(f"- Prior (P(match) among candidates): `{fs.prior}`  ")
        lines.append(f"- **Auto-link band:** `probability ≥ {report['bands']['auto_link']}` "
                     f"→ precision **{al['precision']}** "
                     f"(true links {al['true_links']}, false links {al['false_links']}, "
                     f"recall {al['recall_of_positives']})  ")
        lines.append(f"- **Auto-reject band:** `probability ≤ {report['bands']['auto_reject']}` "
                     f"→ correct rejects {ar['correct_rejects']}, positives lost {ar['positives_lost']}  ")
        lines.append(f"- **Needs-review (middle band):** {report['needs_review_count']} test pairs  ")
        lines.append("")
        lines.append("| threshold | precision | recall | f1 | tp | fp | fn |")
        lines.append("|---|---|---|---|---|---|---|")
        for r in _fmt_curve(report["curve"]):
            lines.append(
                f"| {r['threshold']} | {r['precision']} | {r['recall']} | {r['f1']} | "
                f"{r['tp']} | {r['fp']} | {r['fn']} |"
            )
        lines.append("")
        # Comparison weight table (match weight per level).
        lines.append("**Learned match weights (log2 m/u) by comparison level:**")
        lines.append("")
        lines.append("| comparison | level | m | u | weight (log2) |")
        lines.append("|---|---|---|---|---|")
        for cmp_name, cfg in fs.comparisons.items():
            for lvl, mu in sorted(cfg.get("levels", {}).items(), reverse=True):
                import math
                m = float(mu["m"]); u = float(mu["u"])
                w = math.log2(max(m, 1e-6)) - math.log2(max(u, 1e-6))
                lines.append(f"| {cmp_name} | {lvl} | {m} | {u} | {round(w, 3)} |")
        lines.append("")

    lines.append("## How the bands are chosen")
    lines.append("")
    lines.append(
        "- **Auto-link** = the lowest probability threshold whose precision on the test "
        "split is ≥ the target (0.995) with non-zero recall. Pairs at/above it are safe to "
        "write through the existing sf-link / owner_reconcile paths with "
        "`source='splink_v1'` and the probability as confidence.\n"
        "- **Auto-reject** = the highest threshold below which no true positive falls "
        "(recall-safe). Pairs at/below it close as `no_match`.\n"
        "- **Needs-review** = everything between. These flow to the W3.2 owner_reconcile / "
        "entity_match_candidates lane; every human verdict there becomes an "
        "`entity_match_labels` row = retraining data (W4.4 loop)."
    )
    lines.append("")
    lines.append("## Reproduce")
    lines.append("")
    lines.append("```bash")
    lines.append("cd resolver && pip install -r requirements.txt")
    lines.append("python scripts/gen_models_and_calibration.py   # regenerates models + this report")
    lines.append("# or, against the live W4.1 Storage corpus once it exists:")
    lines.append("curl -XPOST $RESOLVER_URL/train -H 'content-type: application/json' \\")
    lines.append("     -d '{\"model\":\"owner_owner\",\"use_storage\":true,\"target_precision\":0.995}'")
    lines.append("```")
    lines.append("")

    with open(os.path.join(DOCS, "CALIBRATION.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"Wrote models to {FIXTURES} and CALIBRATION.md to {DOCS}")


if __name__ == "__main__":
    main()
