"""Apply sql/001_init.sql, sql/003_acled.sql, and sql/004_exposure.sql to TigerData."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env  # noqa: E402


def main() -> None:
    load_repo_env()
    if not database_configured():
        print(
            "DATABASE_URL is empty. Paste the Tiger connection string into .env "
            "(see .env.example), then run: python -m jobs.ingest.apply_schema"
        )
        raise SystemExit(1)
    import psycopg

    with psycopg.connect(database_url(), connect_timeout=30) as conn:
        with conn.cursor() as cur:
            for name in ("001_init.sql", "003_acled.sql", "004_exposure.sql"):
                sql_path = REPO_ROOT / "sql" / name
                for statement in _statements(sql_path.read_text(encoding="utf-8")):
                    cur.execute(statement)
                print(f"Applied sql/{name}")
        conn.commit()


def _statements(sql: str) -> list[str]:
    chunks: list[str] = []
    buffer: list[str] = []
    for line in sql.splitlines():
        if line.strip().startswith("--"):
            continue
        buffer.append(line)
        if line.rstrip().endswith(";"):
            text = "\n".join(buffer).strip()
            if text:
                chunks.append(text)
            buffer = []
    tail = "\n".join(buffer).strip()
    if tail:
        chunks.append(tail)
    return chunks


if __name__ == "__main__":
    main()
