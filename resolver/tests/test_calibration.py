"""Calibration: band selection is precision-targeted and recall-safe."""
from app.calibration import calibration_report, pr_curve, select_bands
from app.corpus import load_stub_pairs, split_of
from app.train import count_estimate


def _test_split():
    pairs = load_stub_pairs()
    train = [p for p in pairs if split_of(p) in ("train", "valid")]
    test = [p for p in pairs if split_of(p) == "test"]
    return train, test


def test_pr_curve_monotone_recall():
    scored = [(0.9, 1), (0.8, 1), (0.4, 0), (0.1, 0), (0.05, 1)]
    curve = pr_curve(scored, steps=11)
    recalls = [r["recall"] for r in curve]
    # recall is non-increasing as threshold rises
    assert all(recalls[i] >= recalls[i + 1] for i in range(len(recalls) - 1))


def test_bands_are_ordered_and_recall_safe():
    scored = [(0.97, 1), (0.93, 1), (0.5, 1), (0.2, 0), (0.1, 0), (0.02, 0)]
    bands = select_bands(scored, target_precision=0.995)
    assert 0.0 <= bands["auto_reject"] < bands["auto_link"] <= 1.0
    # no positive falls at/below the reject band
    assert all(p > bands["auto_reject"] for p, y in scored if y == 1)


def test_report_hits_precision_target_on_stub():
    train, test = _test_split()
    fs = count_estimate(train, "owner_owner")
    report = calibration_report(fs, test, target_precision=0.995)
    assert report["auto_link"]["precision"] >= 0.995
    # recall-safe reject band: no positive lost
    assert report["auto_reject"]["positives_lost"] == 0
    assert report["n_pos"] > 0 and report["n_neg"] > 0
