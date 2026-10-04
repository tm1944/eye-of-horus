"""Load data/backup_csvs/finalconflictCSV.csv without calling live feeds."""

from __future__ import annotations

import json

from jobs.ingest.run import database_configured, database_url, load_conflict_csv, load_repo_env


def main() -> None:
    load_repo_env()
    if not database_configured():
        print("DATABASE_URL is empty. Paste the Tiger connection string into .env, then run this again.")
        raise SystemExit(1)
    import psycopg

    with psycopg.connect(database_url(), connect_timeout=30) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                result = load_conflict_csv(cur)
        # Each row links to a news article; use its image as the card thumbnail.
        from jobs.ingest.images import fill_missing_images

        result["images"] = fill_missing_images(conn, sources=("conflict_csv",), log=lambda _line: None)
    print(json.dumps(result, indent=2))
    if result.get("status") != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
