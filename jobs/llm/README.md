# Part D — Personalisation, Globe Pins, and Gemini Links

## What this module delivers

| File | Purpose |
| --- | --- |
| `personalize.py` | Two-stage event scoring. Returns a ranked feed, a geographically spread pin list, or a Gemini re-ranked feed. |
| `links.py` | Gemini event-web generation. Finds related event pairs in the personalised feed, stores links with AI rationale and source citations. |

User preferences are read from `data/user_config.json` at runtime (written by the frontend). Full algorithm spec is in `docs/personalization_algorithm.md`.

---

## Setup

```bash
pip install -r jobs/llm/requirements.txt
```

**Required environment variables**

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_API_KEY` | For Gemini calls | Without it, `get_feed_smart` skips re-ranking and `generate_links` returns fixture data |
| `DATABASE_URL` | For live data | Without it, all functions fall back to `data/fixtures/events.json` and `data/fixtures/links.json` |

---

## Endpoints (for Student C — FastAPI)

All four endpoints read preferences from `data/user_config.json`. No `user_id` in the path for the demo.

### `GET /feed`

Returns the top 100 events ranked by relevance score (keyword + coordinate + significance + recency). Fast, no Gemini call.

```python
from jobs.llm.personalize import get_feed
events = get_feed(n=100)
```

Query params to expose: `n` (default 100).

---

### `GET /feed/smart`

Same scoring pipeline, but triggers a Gemini re-ranking step when keyword scores are uniformly weak (vocabulary mismatch). Falls back to keyword order silently if `GOOGLE_API_KEY` is unset.

```python
from jobs.llm.personalize import get_feed_smart
events = get_feed_smart(n=100)
```

Query params to expose: `n` (default 100).

---

### `GET /feed/pins`

Returns `n` events spread geographically across the globe for the spinning 3D pin display. Uses greedy farthest-point selection — no two pins will be within 30° of arc of each other.

```python
from jobs.llm.personalize import get_globe_pins
pins = get_globe_pins(n=10)
```

Query params to expose: `n` (default 10), `spreadDegrees` (default 30).

Response shape is the same Event object list as `/feed`.

---

### `GET /feed/links`

Generates (or returns cached) Gemini event links for the current personalised feed. Returns a list of EventLink objects including `rationale` and `citations`.

```python
from jobs.llm.links import generate_links
links = generate_links()  # fetches its own feed internally
```

Or pass a pre-fetched event list to avoid a double fetch:

```python
events = get_feed(n=50)
links = generate_links(events=events)
```

Response shape matches `packages/schema/link.schema.json` with the additional `citations` field.

---

## Temporary data and dependencies on other members

These are things we need other team members to confirm so we can update the algorithm. **Please flag any changes in the team channel.**

### Student B (Ingest + TigerData)

| What we assume | What to tell us if it changes |
| --- | --- |
| `mart.event.category` is the map layer | The API exposes it as `layerId` |
| `mart.event` has `lat` and `lng` | Kind tables hold measurements such as magnitude and `max_wind_kmh` |
| Keywords live in `mart.event_tag` | Scoring still falls back to entity text and title tokens |
| `mart.event_link` exists after `sql/001_init.sql` | `sql/002_links_update.sql` adds `rationale` and `citations` on an older table |

### Student C (FastAPI)

| What we need | Notes |
| --- | --- |
| Wire up the four endpoints above | Import paths are `jobs.llm.personalize` and `jobs.llm.links` |
| Serve `data/user_config.json` via `GET /user/config` | Frontend needs to read it back |
| Accept `PUT /user/config` to update the file | Frontend writes preferences; all feed endpoints pick them up on the next call |
| CORS for the Vite dev origin | Already in scope for your track |

### Student A (Map UI / Frontend)

| What we need from you | Notes |
| --- | --- |
| Write `data/user_config.json` when user changes preferences | Shape is in `packages/schema/user_profile.schema.json` |
| `coordinates` field: send lat/lng as provided by the user clicking on the globe | We use proximity to these points for scoring |
| Use `GET /feed/pins` to populate the initial spinning globe pins | Returns `n=10` well-spread events by default |
| Use `GET /feed/links` to build the arc web | Each link has `sourceId`, `targetId`, `relation`, `confidence`, `rationale`, and `citations` |

---

## What is currently placeholder / fixture data

| Item | Status | Will be replaced by |
| --- | --- | --- |
| `data/user_config.json` default preferences | Placeholder — Napa Valley area | Frontend writes real user selections |
| `data/fixtures/events.json` | 3 fixture events | Live TigerData rows once ingest is running |
| `data/fixtures/links.json` | 1 fixture link | Live Gemini output once `GOOGLE_API_KEY` is set |
| `keyword_score` labels fallback | Currently matches only entity text + title tokens | Will improve once Student B confirms the `labels`/`keywords` DB column name |

---

## Running locally (without a database URL or Gemini key)

```python
# From the repo root
from jobs.llm.personalize import get_feed, get_globe_pins

feed = get_feed()          # returns fixture events filtered + scored
pins = get_globe_pins()    # returns fixture events spread geographically
```

```python
from jobs.llm.links import generate_links
links = generate_links()   # returns data/fixtures/links.json
```
