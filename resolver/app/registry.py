"""In-process model registry: load/cache trained models by name.

Model files live in `settings.resolved_model_dir()` as `model_<name>.json`. The repo
ships defaults there (fixtures/). /train overwrites them. This service is stateless
across restarts except for these on-disk model files (baked into the image or mounted).
"""
from __future__ import annotations

import os
from typing import Dict

from .config import settings
from .model import FSModel, seed_model
from .features import MODELS


class Registry:
    def __init__(self):
        self._cache: Dict[str, FSModel] = {}

    def _path(self, model: str) -> str:
        return os.path.join(settings.resolved_model_dir(), f"model_{model}.json")

    def get(self, model: str) -> FSModel:
        if model not in MODELS:
            raise KeyError(f"unknown model '{model}' (valid: {', '.join(MODELS)})")
        if model in self._cache:
            return self._cache[model]
        path = self._path(model)
        if os.path.exists(path):
            fs = FSModel.load(path)
        else:
            fs = seed_model(model)  # ship-time default when no trained file present
        self._cache[model] = fs
        return fs

    def set(self, model: str, fs: FSModel, persist: bool = True) -> str:
        self._cache[model] = fs
        path = self._path(model)
        if persist:
            fs.save(path)
        return path

    def reload(self, model: str) -> None:
        self._cache.pop(model, None)


registry = Registry()
