# Personalisation Algorithm — Record

This document is a precise record of the personalisation algorithm as implemented in `jobs/llm/personalize.py`. Update this file whenever the weights, thresholds, or logic change.

**Last updated:** 2026-10-03  
**Implementation:** `jobs/llm/personalize.py`

---

## 1. Input

User preferences are read from `data/user_config.json` at runtime. Shape:

```json
{
  "layers": ["earthquake", "wildfire"],
  "coordinates": [
    { "lat": 37.8, "lng": -122.4, "label": "San Francisco Bay Area" }
  ],
  "keywords": ["flooding", "displacement"],
  "significanceFloor": 30
}
```

---

## 2. Stage 1 — Hard Filters (SQL)

Applied in Snowflake (or in-Python against fixture JSON when `SNOWFLAKE_ACCOUNT` is unset).

| Filter | Condition |
| --- | --- |
| Layer | `layer_id IN user.layers` |
| Significance | `significance >= user.significanceFloor` |
| Recency | `occurred_at >= NOW() - 7 days` |

Rows failing any filter are dropped before scoring. Stage 1 typically returns hundreds to a few thousand candidate events depending on layer selection.

---

## 3. Stage 2 — Relevance Scoring (Python)

Each candidate event receives a composite score in `[0, 1]`:

```
score = W_COORD      × coord_score
      + W_KEYWORD    × keyword_score
      + W_SIGNIFICANCE × significance_norm
      + W_RECENCY    × recency_score
```

### Weights

| Component | Weight | Constant |
| --- | --- | --- |
| `coord_score` | 0.30 | `W_COORD` |
| `keyword_score` | 0.40 | `W_KEYWORD` |
| `significance_norm` | 0.20 | `W_SIGNIFICANCE` |
| `recency_score` | 0.10 | `W_RECENCY` |

Weights sum to 1.0.

### coord_score

Measures how close the event is to any of the user's areas of interest.

```
min_dist_km = min(haversine(event, coord) for coord in user.coordinates)
coord_score = max(0.0, 1.0 - min_dist_km / COORD_SCORE_MAX_KM)
```

- `COORD_SCORE_MAX_KM = 5000` — distance at which score reaches 0.
- Returns `0.5` (neutral) when `coordinates` is empty.
- Event coordinates come from the DB (`lat`, `lng` columns).
- User coordinates come from the config file (frontend-provided).

### keyword_score

Measures vocabulary overlap between user keywords and event text fields.

Searchable text is built from:
1. Event `title` tokens (space-split, lowercased)
2. Entity `text` tokens from `entities[]`
3. Any `labels` array field stored in the DB row

For each user keyword:
- If the keyword phrase appears anywhere in the combined token string → **+1.0**
- Else if any single token of the keyword appears in the token set → **+0.5**

```
keyword_score = min(1.0, total_hits / len(keywords))
```

Returns `0.5` (neutral) when `keywords` is empty.

### significance_norm

```
significance_norm = clamp(event.significance / 100, 0.0, 1.0)
```

### recency_score

```
if age_hours <= 24:    return 1.0
if age_hours >= 168:   return 0.5
return 1.0 - (age_hours - 24) / (168 - 24) * 0.5
```

Linear decay from 1.0 at 24 hours to 0.5 at 7 days (168 hours). Events older than 7 days floor at 0.5 rather than 0 because they may still be highly significant.

---

## 4. Output — Feed

`get_feed(n=100)` returns the top `n` events sorted by score descending. Default is 100.

---

## 5. Globe Pin Spread — `get_globe_pins`

For the spinning 3D globe, pins must be spread across the whole surface rather than clustered in the user's preferred region.

**Algorithm:** Greedy farthest-point selection.

1. Sort all events by score descending.
2. Select the highest-scoring event as pin 1.
3. For each subsequent candidate (in score order): select it only if it is ≥ `PIN_SPREAD_DEGREES` of arc away from every already-selected pin.
4. Stop when `n` pins are selected or candidates are exhausted.

**Angular distance** is computed as the great-circle angle from the dot product of 3D unit-sphere vectors:

```
dot = cos(lat1)cos(lng1)cos(lat2)cos(lng2)
    + cos(lat1)sin(lng1)cos(lat2)sin(lng2)
    + sin(lat1)sin(lat2)
angle_deg = degrees(acos(clamp(dot, -1, 1)))
```

**Constants:**

| Constant | Value | Notes |
| --- | --- | --- |
| `PIN_SPREAD_DEGREES` | 30° | Minimum angular separation between pins |
| Default `n` | 10 | Configurable via query param |

A 30° threshold means no two pins are closer than ~3300 km on the surface, preventing visual overlap at standard globe zoom.

---

## 6. Optional Gemini Re-ranking — `get_feed_smart`

Triggered only when all of the following hold:
1. `user.keywords` is non-empty.
2. The maximum `keyword_score` across the top `GEMINI_RERANK_POOL` (20) candidates is below `GEMINI_RERANK_THRESHOLD` (0.2).

When triggered:
- Passes the top 20 events and the keyword list to `gemini-3.5-flash-lite`.
- Asks for a JSON array of up to `GEMINI_RERANK_PICK` (10) indices, most relevant first.
- Re-orders the result; remaining events follow in original score order.

This handles vocabulary mismatch (e.g. user keyword "climate" vs event title "wildfire season") without running Gemini on every request.

If `GOOGLE_API_KEY` is unset or the Gemini call fails, `get_feed_smart` falls back to the keyword-scored order silently.

---

## 7. Fallback Behaviour

| Condition | Behaviour |
| --- | --- |
| `SNOWFLAKE_ACCOUNT` unset | Stage 1 runs against `data/fixtures/events.json` |
| `GOOGLE_API_KEY` unset | `get_feed_smart` skips re-ranking; `generate_links` returns fixture links |
| Empty `coordinates` | `coord_score` returns 0.5 for all events |
| Empty `keywords` | `keyword_score` returns 0.5 for all events |
| Event missing `occurredAt` | `recency_score` returns 0.0 |

---

## 8. Tuning Constants (all in `personalize.py`)

| Constant | Default | Effect of increasing |
| --- | --- | --- |
| `COORD_SCORE_MAX_KM` | 5000 | Widens geographic reach of preference |
| `RECENCY_FULL_HOURS` | 24 | Extends full-score recency window |
| `RECENCY_HALF_HOURS` | 168 | Extends decay period |
| `PIN_SPREAD_DEGREES` | 30° | Spreads pins further apart |
| `GEMINI_RERANK_THRESHOLD` | 0.2 | Lowers bar for triggering Gemini re-rank |
| `GEMINI_RERANK_POOL` | 20 | More candidates sent to Gemini |
| `GEMINI_RERANK_PICK` | 10 | More events returned by Gemini |
