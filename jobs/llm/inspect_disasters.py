"""
Inspect sample disaster data from TigerData to design enrichment strategy.

Usage:
    python -m jobs.llm.inspect_disasters
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env


def inspect_live_disasters():
    """Fetch sample disasters from TigerData."""
    import psycopg

    conn = psycopg.connect(database_url(), connect_timeout=20)
    cursor = conn.cursor()

    # Get counts
    cursor.execute("""
        SELECT category, COUNT(*) as count
        FROM mart.event
        GROUP BY category
        ORDER BY count DESC
    """)

    print("=" * 80)
    print("DISASTER DATA IN TIGERDATA")
    print("=" * 80)
    print("\nEvent Counts by Category:")
    counts = {}
    for row in cursor.fetchall():
        category, count = row
        counts[category] = count
        print(f"  {category:15} {count:6,} events")

    # Sample events from each category
    categories = ['earthquake', 'wildfire', 'cyclone', 'flood', 'volcano', 'drought']

    for category in categories:
        if category not in counts:
            continue

        print("\n" + "=" * 80)
        print(f"{category.upper()} SAMPLE")
        print("=" * 80)

        cursor.execute(f"""
            SELECT
                e.event_id,
                e.source,
                e.title,
                e.summary,
                e.occurred_at,
                e.lat,
                e.lng,
                e.significance,
                e.entities,
                CASE e.category
                    WHEN 'earthquake' THEN row_to_json(eq.*)::jsonb - 'event_id' - 'footprint'
                    WHEN 'wildfire' THEN row_to_json(wf.*)::jsonb - 'event_id' - 'footprint'
                    WHEN 'cyclone' THEN row_to_json(cy.*)::jsonb - 'event_id' - 'footprint'
                    WHEN 'flood' THEN row_to_json(fl.*)::jsonb - 'event_id' - 'footprint'
                    WHEN 'volcano' THEN row_to_json(vo.*)::jsonb - 'event_id' - 'footprint'
                    WHEN 'drought' THEN row_to_json(dr.*)::jsonb - 'event_id' - 'footprint'
                END as attributes
            FROM mart.event e
            LEFT JOIN mart.earthquake eq ON eq.event_id = e.event_id
            LEFT JOIN mart.wildfire wf ON wf.event_id = e.event_id
            LEFT JOIN mart.cyclone cy ON cy.event_id = e.event_id
            LEFT JOIN mart.flood fl ON fl.event_id = e.event_id
            LEFT JOIN mart.volcano vo ON vo.event_id = e.event_id
            LEFT JOIN mart.drought dr ON dr.event_id = e.event_id
            WHERE e.category = %s
            ORDER BY e.occurred_at DESC
            LIMIT 2
        """, (category,))

        for i, row in enumerate(cursor.fetchall(), 1):
            event_id, source, title, summary, occurred_at, lat, lng, significance, entities, attributes = row

            print(f"\nSample {i}:")
            print(f"  ID: {event_id}")
            print(f"  Source: {source}")
            print(f"  Title: {title}")
            print(f"  Summary: {summary or 'N/A'}")
            print(f"  Occurred: {occurred_at}")
            print(f"  Location: {lat}, {lng}")
            print(f"  Significance: {significance}")
            print(f"  Current entities: {json.dumps(entities, indent=2)}")
            print(f"  Attributes: {json.dumps(attributes, indent=2)}")

    cursor.close()
    conn.close()


def show_mock_examples():
    """Show mock disaster examples based on ingestion code structure."""

    print("=" * 80)
    print("MOCK DISASTER DATA EXAMPLES")
    print("=" * 80)
    print("\nNOTE: DATABASE_URL not set. Showing expected structure from ingestion code.")
    print("Set DATABASE_URL in .env to inspect real data from TigerData.\n")

    examples = {
        "earthquake_usgs": {
            "event_id": "usgs:us7000example",
            "source": "usgs",
            "title": "M 6.2 - 15 km SW of Napa, California",
            "summary": "15 km SW of Napa, California",
            "lat": 38.2, "lng": -122.3,
            "significance": 62,
            "entities": [{"type": "place", "text": "15 km SW of Napa, California", "confidence": 0.9}],
            "attributes": {
                "magnitude": 6.2,
                "mag_type": "mww",
                "depth_km": 10.5,
                "tsunami": False,
                "felt": 1234,
                "alert": "orange",
                "status": "reviewed",
                "place": "15 km SW of Napa, California"
            }
        },
        "earthquake_gdacs": {
            "event_id": "gdacs:EQ:1234:0",
            "source": "gdacs",
            "title": "Earthquake in Japan",
            "summary": "Strong earthquake near coast",
            "lat": 35.6, "lng": 139.7,
            "significance": 70,
            "entities": [],
            "attributes": {
                "gdacs_event_id": 1234,
                "episode_id": 0,
                "magnitude": 6.5,
                "alert_level": "Orange",
                "alert_score": 2.3,
                "population": 500000,
                "glide": "EQ-2024-000123-JPN"
            }
        },
        "wildfire_firms": {
            "event_id": "firms-cluster:2024-10-01:34.0:-118.0",
            "source": "firms",
            "title": "VIIRS hotspot cluster 34.0, -118.0",
            "summary": "NASA FIRMS cluster. Cite NASA FIRMS.",
            "lat": 34.0, "lng": -118.0,
            "significance": 85,
            "entities": [],
            "attributes": {
                "hotspot_count": 45,
                "max_frp": 85.3,
                "mean_frp": 42.1,
                "satellite": "N",
                "confidence": "h",
                "daynight": "D"
            }
        },
        "wildfire_gdacs": {
            "event_id": "gdacs:WF:5678:1",
            "source": "gdacs",
            "title": "Wildfire in Australia",
            "summary": "Major wildfire threatening communities",
            "lat": -33.9, "lng": 151.2,
            "significance": 90,
            "entities": [],
            "attributes": {
                "gdacs_event_id": 5678,
                "episode_id": 1,
                "alert_level": "Red",
                "alert_score": 3.5,
                "population": 100000,
                "burned_area_ha": 15000,
                "glide": "WF-2024-000456-AUS"
            }
        },
        "cyclone": {
            "event_id": "gdacs:TC:9012:2",
            "source": "gdacs",
            "title": "Typhoon Haiyan",
            "summary": "Category 4 typhoon",
            "lat": 11.0, "lng": 125.0,
            "significance": 90,
            "entities": [],
            "attributes": {
                "gdacs_event_id": 9012,
                "episode_id": 2,
                "storm_name": "Haiyan",
                "max_wind_kmh": 215,
                "storm_class": "Super Typhoon",
                "alert_level": "Red",
                "alert_score": 3.8,
                "population": 2000000,
                "country": "Philippines",
                "iso3": "PHL",
                "glide": "TC-2024-000789-PHL"
            }
        },
        "flood": {
            "event_id": "gdacs:FL:3456:0",
            "source": "gdacs",
            "title": "Flooding in Bangladesh",
            "summary": "Severe flooding from monsoon rains",
            "lat": 23.8, "lng": 90.4,
            "significance": 70,
            "entities": [],
            "attributes": {
                "gdacs_event_id": 3456,
                "episode_id": 0,
                "flood_severity_score": 2.8,
                "severity_text": "Severe flooding",
                "alert_level": "Orange",
                "alert_score": 2.5,
                "population": 500000,
                "country": "Bangladesh",
                "iso3": "BGD",
                "glide": "FL-2024-000234-BGD"
            }
        },
        "volcano": {
            "event_id": "gdacs:VO:7890:1",
            "source": "gdacs",
            "title": "Mount Etna eruption",
            "summary": "Explosive eruption",
            "lat": 37.8, "lng": 15.0,
            "significance": 60,
            "entities": [],
            "attributes": {
                "gdacs_event_id": 7890,
                "episode_id": 1,
                "volcano_name": "Etna",
                "vei": 3.0,
                "severity_text": "Moderate explosive eruption",
                "alert_level": "Orange",
                "alert_score": 2.0,
                "population": 50000,
                "country": "Italy",
                "iso3": "ITA",
                "glide": "VO-2024-000567-ITA"
            }
        },
        "drought": {
            "event_id": "gdacs:DR:2345:0",
            "source": "gdacs",
            "title": "Drought in Horn of Africa",
            "summary": "Extended drought conditions",
            "lat": 2.0, "lng": 45.0,
            "significance": 80,
            "entities": [],
            "attributes": {
                "gdacs_event_id": 2345,
                "episode_id": 0,
                "affected_area_km2": 500000,
                "drought_index": 0.25,
                "alert_level": "Red",
                "alert_score": 3.2,
                "population": 10000000,
                "country": "Somalia",
                "iso3": "SOM",
                "glide": "DR-2024-000890-SOM"
            }
        }
    }

    for disaster_type, example in examples.items():
        print("\n" + "=" * 80)
        print(disaster_type.upper().replace("_", " "))
        print("=" * 80)
        print(json.dumps(example, indent=2))


def analyze_enrichment_needs():
    """Analyze what keywords would be valuable for each disaster type."""

    print("\n\n" + "=" * 80)
    print("KEYWORD ENRICHMENT ANALYSIS")
    print("=" * 80)

    strategies = {
        "earthquake": {
            "current_fields": [
                "magnitude", "depth_km", "place", "alert_level", "felt"
            ],
            "keyword_sources": [
                "Disaster type: 'earthquake', 'seismic event', 'tremor'",
                "Magnitude descriptor: 'magnitude 6.2', 'M6.2'",
                "Location: Extract country, region, city from place/title",
                "Severity: 'strong', 'moderate', 'major', based on magnitude",
                "Alert level: 'orange alert', 'red alert' if present",
                "Impact: 'tsunami warning' if tsunami=true",
                "Technical: 'seismic activity', 'aftershock', 'tectonic'"
            ],
            "example_keywords": [
                {"text": "earthquake", "relevance": 1.0, "type": "event"},
                {"text": "magnitude 6.2", "relevance": 0.95, "type": "concept"},
                {"text": "California", "relevance": 0.90, "type": "location"},
                {"text": "Napa", "relevance": 0.88, "type": "location"},
                {"text": "seismic activity", "relevance": 0.80, "type": "topic"},
                {"text": "orange alert", "relevance": 0.75, "type": "concept"}
            ]
        },
        "wildfire": {
            "current_fields": [
                "hotspot_count", "max_frp", "burned_area_ha", "alert_level", "satellite"
            ],
            "keyword_sources": [
                "Disaster type: 'wildfire', 'bushfire', 'forest fire'",
                "Data source: 'VIIRS', 'NASA FIRMS', 'satellite detection'",
                "Intensity: 'high FRP', 'major fire', based on max_frp",
                "Scale: 'X hectares burned', 'large wildfire'",
                "Location: Extract from title/coordinates",
                "Alert: 'red alert', 'orange alert'",
                "Impact: 'evacuation', 'air quality', 'smoke'"
            ],
            "example_keywords": [
                {"text": "wildfire", "relevance": 1.0, "type": "event"},
                {"text": "VIIRS satellite", "relevance": 0.90, "type": "concept"},
                {"text": "fire radiative power", "relevance": 0.85, "type": "concept"},
                {"text": "Australia", "relevance": 0.88, "type": "location"},
                {"text": "bushfire", "relevance": 0.82, "type": "topic"},
                {"text": "red alert", "relevance": 0.80, "type": "concept"}
            ]
        },
        "cyclone": {
            "current_fields": [
                "storm_name", "max_wind_kmh", "storm_class", "alert_level", "population"
            ],
            "keyword_sources": [
                "Disaster type: 'cyclone', 'typhoon', 'hurricane', 'tropical storm'",
                "Storm name: Use storm_name directly",
                "Intensity: 'Category X', storm_class, wind speed descriptor",
                "Wind: 'X km/h winds', 'sustained winds'",
                "Location: Country, region from attributes",
                "Impact: 'storm surge', 'coastal flooding', based on pop_storm_surge",
                "Alert: 'red alert', 'evacuation'"
            ],
            "example_keywords": [
                {"text": "typhoon", "relevance": 1.0, "type": "event"},
                {"text": "Typhoon Haiyan", "relevance": 1.0, "type": "entity"},
                {"text": "super typhoon", "relevance": 0.95, "type": "concept"},
                {"text": "215 km/h winds", "relevance": 0.92, "type": "concept"},
                {"text": "Philippines", "relevance": 0.90, "type": "location"},
                {"text": "storm surge", "relevance": 0.85, "type": "topic"}
            ]
        },
        "flood": {
            "current_fields": [
                "flood_severity_score", "severity_text", "alert_level", "population"
            ],
            "keyword_sources": [
                "Disaster type: 'flood', 'flooding', 'inundation'",
                "Severity: Use severity_text, or map score to descriptor",
                "Cause: 'monsoon', 'river flooding', 'flash flood' (if in summary)",
                "Location: Country, region",
                "Alert: 'red alert', 'orange alert'",
                "Impact: 'displacement', 'evacuation', based on population",
                "Scale: 'widespread', 'severe', 'catastrophic'"
            ],
            "example_keywords": [
                {"text": "flood", "relevance": 1.0, "type": "event"},
                {"text": "severe flooding", "relevance": 0.95, "type": "concept"},
                {"text": "Bangladesh", "relevance": 0.90, "type": "location"},
                {"text": "monsoon rains", "relevance": 0.88, "type": "concept"},
                {"text": "displacement", "relevance": 0.82, "type": "topic"},
                {"text": "orange alert", "relevance": 0.80, "type": "concept"}
            ]
        },
        "volcano": {
            "current_fields": [
                "volcano_name", "vei", "severity_text", "alert_level", "population"
            ],
            "keyword_sources": [
                "Disaster type: 'volcano', 'volcanic eruption', 'eruption'",
                "Volcano name: Use volcano_name directly",
                "Intensity: 'VEI X', map VEI to descriptor",
                "Type: Extract from severity_text ('explosive', 'effusive')",
                "Location: Country, volcano name",
                "Hazards: 'ash cloud', 'lava flow', 'pyroclastic' (if in summary)",
                "Alert: 'aviation alert', 'red alert'"
            ],
            "example_keywords": [
                {"text": "volcanic eruption", "relevance": 1.0, "type": "event"},
                {"text": "Mount Etna", "relevance": 1.0, "type": "entity"},
                {"text": "VEI 3", "relevance": 0.92, "type": "concept"},
                {"text": "explosive eruption", "relevance": 0.90, "type": "concept"},
                {"text": "Italy", "relevance": 0.88, "type": "location"},
                {"text": "ash cloud", "relevance": 0.82, "type": "topic"}
            ]
        },
        "drought": {
            "current_fields": [
                "affected_area_km2", "drought_index", "alert_level", "population"
            ],
            "keyword_sources": [
                "Disaster type: 'drought', 'water shortage', 'dry conditions'",
                "Scale: 'X km² affected', 'widespread', 'regional'",
                "Severity: Map drought_index to descriptor",
                "Location: Country, region",
                "Duration: 'extended', 'prolonged', 'multi-year' (if in summary)",
                "Impact: 'food security', 'famine', 'crop failure', 'water crisis'",
                "Alert: 'red alert', 'humanitarian crisis'"
            ],
            "example_keywords": [
                {"text": "drought", "relevance": 1.0, "type": "event"},
                {"text": "Horn of Africa", "relevance": 0.92, "type": "location"},
                {"text": "Somalia", "relevance": 0.90, "type": "location"},
                {"text": "extended drought", "relevance": 0.88, "type": "concept"},
                {"text": "food security", "relevance": 0.85, "type": "topic"},
                {"text": "humanitarian crisis", "relevance": 0.82, "type": "concept"}
            ]
        }
    }

    for disaster_type, strategy in strategies.items():
        print(f"\n{'=' * 80}")
        print(f"{disaster_type.upper()}")
        print(f"{'=' * 80}")
        print(f"\nCurrent fields available:")
        for field in strategy["current_fields"]:
            print(f"  • {field}")
        print(f"\nKeyword extraction strategy:")
        for source in strategy["keyword_sources"]:
            print(f"  • {source}")
        print(f"\nExample enriched keywords:")
        print(json.dumps(strategy["example_keywords"], indent=2))


def main():
    load_repo_env()

    if database_configured():
        print("\n✓ DATABASE_URL is set. Fetching real disaster data...\n")
        try:
            inspect_live_disasters()
        except Exception as e:
            print(f"\nError connecting to database: {e}")
            print("\nFalling back to mock examples...\n")
            show_mock_examples()
    else:
        show_mock_examples()

    analyze_enrichment_needs()

    print("\n\n" + "=" * 80)
    print("NEXT STEPS")
    print("=" * 80)
    print("""
1. Review the keyword extraction strategy above
2. Implement jobs/llm/enrich_disasters.py with disaster-specific prompts
3. Key differences from news enrichment:
   - NO geocoding (already have precise coordinates)
   - NO significance scoring (already have from alert systems)
   - ONLY keyword extraction based on disaster type
   - Different prompt per disaster type (earthquake vs wildfire vs cyclone, etc.)
4. Test enrichment on sample disasters
5. Run full enrichment pipeline
""")


if __name__ == "__main__":
    main()
