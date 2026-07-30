"""Labeled-pairs corpus loader.

Source of truth (once W4.1 lands): a JSONL file in Supabase Storage, one labeled pair
per line:

    {"name_a","name_b","addr_a","addr_b","state_a","state_b",
     "sf_account_a","sf_account_b","email_a","email_b",
     "label": 0|1, "source": "...", "entity_group": "...", "split": "train|valid|test"}

Until then (W4.1 is ⬜ not started), the STUB loader reads the committed fixture file
`resolver/fixtures/pairs.jsonl`, which carries the same schema and includes the W3.3
false-merge negatives + address-anchored positives. `/train` re-runs against the real
corpus the moment `RESOLVER_STORAGE_KEY`/`SUPABASE_URL` point at the Storage object —
no code change, just env + a `/train` call (see docs/resolver/RUNBOOK).
"""
from __future__ import annotations

import json
import os
from typing import Dict, List, Optional, Tuple

from .config import settings


def _fixture_path() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(here), "fixtures", "pairs.jsonl")


def load_stub_pairs() -> List[dict]:
    """Load labeled pairs from the committed fixture file."""
    path = _fixture_path()
    rows: List[dict] = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            rows.append(json.loads(line))
    return rows


def load_storage_pairs(bucket: str, path: str) -> Tuple[List[dict], str]:
    """Download the JSONL corpus from Supabase Storage. Returns (rows, source_label).

    Uses the Storage REST endpoint with a read-only key; NO writes. Raises on failure so
    /train can report an honest error instead of silently training on nothing.
    """
    if not settings.supabase_url or not settings.supabase_storage_key:
        raise RuntimeError("Supabase Storage not configured (SUPABASE_URL/RESOLVER_STORAGE_KEY unset)")
    import httpx  # local import so the module imports without httpx in minimal envs

    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{path}"
    headers = {"Authorization": f"Bearer {settings.supabase_storage_key}"}
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        text = resp.text
    rows: List[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rows.append(json.loads(line))
    return rows, f"storage://{bucket}/{path}"


def load_corpus(prefer_storage: bool = True) -> Tuple[List[dict], str]:
    """Return (pairs, source_label). Storage when configured+reachable, else the stub."""
    if prefer_storage and settings.supabase_url and settings.supabase_storage_key:
        rows, label = load_storage_pairs(settings.corpus_bucket, settings.corpus_path)
        return rows, label
    return load_stub_pairs(), "fixtures"


def pair_to_records(pair: dict) -> Tuple[dict, dict, int]:
    """Split a flat labeled pair into (left, right, label)."""
    left = {
        "name": pair.get("name_a"),
        "address": pair.get("addr_a"),
        "state": pair.get("state_a"),
        "sf_account": pair.get("sf_account_a"),
        "email": pair.get("email_a"),
    }
    right = {
        "name": pair.get("name_b"),
        "address": pair.get("addr_b"),
        "state": pair.get("state_b"),
        "sf_account": pair.get("sf_account_b"),
        "email": pair.get("email_b"),
    }
    return left, right, int(pair.get("label", 0))


def split_of(pair: dict) -> str:
    return str(pair.get("split", "train")).lower()
