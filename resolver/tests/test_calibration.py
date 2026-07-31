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


# --- W4.4 defect 1: the auto_link band floor is a HARD invariant ---

def test_band_floor_lifts_a_subfloor_sweep():
    # Easy negatives (far below the positives) let the precision sweep pick a tiny
    # threshold — exactly the W4.3 calibration-transfer gap. The floor must override it.
    scored = [(0.99, 1), (0.98, 1), (0.60, 1), (0.02, 0), (0.01, 0), (0.005, 0)]
    bands = select_bands(scored, target_precision=0.995, band_floor=0.5)
    assert bands["auto_link_raw"] < 0.5          # the sweep genuinely found a sub-floor band
    assert bands["auto_link"] == 0.5             # …but the floor governs
    assert bands["auto_link_floored"] is True    # …and the drift signal fires
    assert bands["auto_reject"] < bands["auto_link"]


def test_band_floor_does_not_bind_when_sweep_is_above_floor():
    # A hard negative sitting at 0.5 forces the sweep above the floor — floor is inert.
    scored = [(0.99, 1), (0.90, 1), (0.55, 1), (0.50, 0), (0.30, 0), (0.10, 0)]
    bands = select_bands(scored, target_precision=0.995, band_floor=0.5)
    assert bands["auto_link_raw"] > 0.5
    assert bands["auto_link"] == bands["auto_link_raw"]
    assert bands["auto_link_floored"] is False


def test_band_floor_is_configurable():
    scored = [(0.99, 1), (0.98, 1), (0.60, 1), (0.02, 0), (0.01, 0)]
    # A higher floor lifts the band further; a 0.0 floor disables the invariant.
    assert select_bands(scored, band_floor=0.7)["auto_link"] == 0.7
    assert select_bands(scored, band_floor=0.7)["auto_link_floored"] is True
    assert select_bands(scored, band_floor=0.0)["auto_link_floored"] is False


def test_calibration_report_surfaces_floor():
    train, test = _test_split()
    fs = count_estimate(train, "owner_owner")
    report = calibration_report(fs, test, target_precision=0.995, band_floor=0.5)
    assert "band_floor" in report and "auto_link_floored" in report
    assert report["bands"]["auto_link"] >= 0.5
