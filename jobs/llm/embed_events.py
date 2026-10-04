"""
Embed events and onboarding interests for My Feed's taste vector.

Writes data/cache/embeddings.json:
  {"model": ..., "dims": 768, "vectors": {"<event_id>": [...], "interest:<id>": [...]}}
Incremental: only events and interest seeds without a vector are embedded, in batches.
Run after ingest:  python -m jobs.llm.embed_events [--rebuild]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import fetch_mart_events, load_repo_env  # noqa: E402

MODEL = "gemini-embedding-001"
DIMS = 768
BATCH = 90  # texts per call (the API accepts up to 100)
# The free tier counts each text as a request: 100 per minute. Pace batches to stay under it.
PACE_SECONDS = 62
CACHE = REPO_ROOT / "data" / "cache" / "embeddings.json"
CATALOGUE = REPO_ROOT / "data" / "interests.json"


def event_text(event: dict) -> str:
    """What an event is about: headline, summary, and its strongest keywords or actors."""
    terms = [term["text"] for term in (event.get("keywords") or []) + (event.get("entities") or [])][:8]
    parts = [event.get("title") or "", (event.get("summary") or "")[:600], ", ".join(terms)]
    return "\n".join(part for part in parts if part)


def interest_text(interest: dict) -> str:
    return f"{interest['label']}: {interest['seed']}"


def load_cache() -> dict:
    if CACHE.is_file():
        data = json.loads(CACHE.read_text(encoding="utf-8"))
        if data.get("model") == MODEL and data.get("dims") == DIMS:
            return data
    return {"model": MODEL, "dims": DIMS, "vectors": {}}


def embed(client, texts: list[str]) -> list[list[float]]:
    result = client.models.embed_content(
        model=MODEL, contents=texts,
        config={"output_dimensionality": DIMS, "task_type": "SEMANTIC_SIMILARITY"},
    )
    return [list(item.values) for item in result.embeddings]


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed events and interests for My Feed")
    parser.add_argument("--rebuild", action="store_true", help="Ignore the cache and embed everything again")
    args = parser.parse_args()

    load_repo_env()
    key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not key:
        raise SystemExit("GOOGLE_API_KEY is not set")
    from google import genai  # type: ignore

    client = genai.Client(api_key=key)
    events, ping = fetch_mart_events()
    if events is None:
        raise SystemExit(f"Could not read events: {ping.detail}")
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))["interests"]

    cache = {"model": MODEL, "dims": DIMS, "vectors": {}} if args.rebuild else load_cache()
    vectors = cache["vectors"]
    # Interest seeds first: only ~30, and the free tier also caps embeddings per day.
    pending = [(f"interest:{item['id']}", interest_text(item)) for item in catalogue if f"interest:{item['id']}" not in vectors]
    pending += [(event["id"], event_text(event)) for event in events if event["id"] not in vectors]
    print(f"{len(vectors)} cached, {len(pending)} to embed")

    for start in range(0, len(pending), BATCH):
        if start:
            time.sleep(PACE_SECONDS)
        batch = pending[start:start + BATCH]
        for attempt in range(4):
            try:
                for (item_id, _), values in zip(batch, embed(client, [text for _, text in batch]), strict=True):
                    vectors[item_id] = [round(value, 6) for value in values]
                break
            except Exception as exc:  # noqa: BLE001 — wait out quota/network blips, then give up
                if attempt == 3:
                    raise
                print(f"  waiting to retry batch {start // BATCH + 1}: {str(exc)[:100]}")
                time.sleep(PACE_SECONDS)
        print(f"  embedded {min(start + BATCH, len(pending))}/{len(pending)}")
        # Save after every batch, so an interrupted run keeps its progress.
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache), encoding="utf-8")

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache), encoding="utf-8")
    print(f"done: {len(vectors)} vectors in {CACHE.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
