"""Pick the store from the environment."""

from __future__ import annotations

import os

from overhearth.store.base import Store


def store_from_env() -> Store:
    """OVERHEARTH_STORE=memory (default, seeded by OVERHEARTH_SEED) or dynamo (OVERHEARTH_TABLE)."""
    backend = os.environ.get("OVERHEARTH_STORE", "memory")
    if backend == "dynamo":
        from overhearth.store.dynamo import DynamoStore

        return DynamoStore(os.environ["OVERHEARTH_TABLE"], region=os.environ.get("AWS_REGION"))
    if backend != "memory":
        raise ValueError(f"unsupported OVERHEARTH_STORE={backend!r}")
    seed = os.environ.get("OVERHEARTH_SEED", "town")
    if seed == "town":
        from overhearth.town_seed import seeded_town

        return seeded_town()
    if seed == "dev":
        from overhearth.dev_seed import seeded_store

        return seeded_store()
    raise ValueError(f"unsupported OVERHEARTH_SEED={seed!r}")
