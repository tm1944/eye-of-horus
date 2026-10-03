# Repository Guidelines

## Project structure and module organization

`README.md` defines the MVP and issue priorities. Read `docs/architecture.md`
before changing API contracts, data flow, or map behavior. Read
`docs/business-model.md` when changing product scope or demo messaging.

- `apps/api/` contains Track C's FastAPI app, optional Snowflake adapter, and tests.
- `packages/schema/` holds the shared Event and EventLink JSON schemas.
- `data/fixtures/` contains bundled events and links. `data/snapshots/` holds
  generated fallback data; runtime JSON files are ignored by Git.
- `apps/web/`, `jobs/ingest/`, `jobs/llm/`, `sql/`, and `eval/` remain planned
  locations for the other tracks. Dedicated UI assets are not present yet.

Follow the track assignments in issue #21. Track C owns #2 and #9; coordinate
loader, warehouse, and generated-link handoffs with their owners.

## Build, test, and development commands

Use Python 3.12+. From `apps/api`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 43124
python -m unittest discover -s tests -v
```

These commands create the environment, install dependencies, run the API, and
execute tests. Leave `SNOWFLAKE_ACCOUNT` unset for fixtures. Read
`apps/api/README.md` for environment variables and current integration limits.
Run `git diff --check` before submitting changes. No frontend build exists yet.

## Coding style and naming conventions

Match existing Python code: four-space indentation, snake_case helpers, and
type hints on application functions. Preserve JSON contract names such as
`sourceUrl`, `occurredAt`, and `geoPrecision`. Use two spaces in JSON examples.
No formatter or linter is configured. Keep Markdown links relative within docs.

## Testing guidelines

Use standard-library `unittest` and FastAPI `TestClient`. Name files `test_*.py`
under `apps/api/tests/`. Tests must isolate caches in temporary directories and
simulate warehouse failures without credentials. Cover filters, schema
compatibility, fallback behavior, and authorization when changing those paths.
There is no coverage threshold. Distinguish simulated checks from live-service
validation in PRs.

## Commit and pull request guidelines

Existing commits use imperative subjects, such as `Add business and architecture
briefs`. Keep PRs focused, link their issue, describe behavior changes and
validation, and include screenshots for UI changes. Call out shared-contract
changes explicitly.

## Architecture and configuration

Keep FastAPI as the browser-facing API; access Snowflake and Gemini server-side.
Preserve fallback data, keep credentials out of commits, and retain source
attribution. Report unknown feed health honestly. `/ingest/run` executes only
the server-configured `INGEST_COMMAND`; coordinate its loader with Track B.
