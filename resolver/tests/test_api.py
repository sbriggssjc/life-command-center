"""End-to-end API tests via FastAPI TestClient."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["no_db_writes"] is True
    assert "libpostal" in body["backends"]


def test_normalize_endpoint():
    r = client.post("/normalize", json={
        "names": ["Cedar Point Holdings LLC"],
        "addresses": ["100 Main St, Dallas, TX 75201"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["names"][0]["core"] == "cedar point holdings"
    assert body["addresses"][0]["clean"]


def test_match_endpoint_returns_scored_pairs():
    r = client.post("/match", json={
        "model": "owner_owner",
        "left": [{"id": "L1", "name": "Cedar Point Holdings LLC", "address": "100 Main St, Dallas, TX", "state": "TX"}],
        "right": [
            {"id": "R1", "name": "Cedar Point Holdings LP", "address": "100 Main St, Dallas TX", "state": "TX"},
            {"id": "R2", "name": "Unrelated Ventures LLC", "address": "9 Z Blvd, Miami FL", "state": "FL"},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "owner_owner"
    # the legal-form variant should be the top pair and land in a high band
    top = body["pairs"][0]
    assert top["right_id"] == "R1"
    assert top["probability"] > 0.5
    assert "comparison_vector" in top


def test_match_unknown_model_400():
    r = client.post("/match", json={"model": "nope", "left": [], "right": []})
    assert r.status_code == 400


def test_match_empty_inputs():
    r = client.post("/match", json={"model": "owner_owner", "left": [], "right": []})
    assert r.status_code == 200
    assert r.json()["pairs"] == []


def test_train_on_stub_corpus_recalibrates(monkeypatch, tmp_path):
    # Point the model dir at a temp path so the test doesn't overwrite shipped models.
    from app import config, registry as reg_mod
    monkeypatch.setattr(config.settings, "model_dir", str(tmp_path))
    reg_mod.registry._cache.clear()

    r = client.post("/train", json={"model": "owner_owner", "use_storage": False, "persist": True})
    assert r.status_code == 200
    body = r.json()
    assert body["corpus"] == "fixtures"
    assert body["n_train_pairs"] > 0
    assert body["n_test_pairs"] > 0
    assert 0.0 <= body["bands"]["auto_reject"] <= body["bands"]["auto_link"] <= 1.0
    # auto-link precision target honored on the test split
    assert body["calibration"]["auto_link"]["precision"] >= 0.99
    reg_mod.registry._cache.clear()
