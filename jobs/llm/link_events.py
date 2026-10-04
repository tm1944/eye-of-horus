"""
Unified event linking for Hypothesis Globe.

Links events using mechanism-first AI reasoning:
  - News ↔ News: Related stories, same events, causal relationships
  - News ↔ Disasters: Reportage, mentions, impact analysis

Architecture: Smart candidate generation + batch AI reasoning + quality filtering
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"

if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env  # noqa: E402

# Configuration
MODEL = "gemini-3.5-flash-lite"
MIN_CONFIDENCE = 0.3  # Lower threshold for exploratory linking (was 0.7)
MIN_PLAUSIBILITY = 0.5  # Minimum plausibility to run verification stage
BATCH_SIZE_NEWS = 3  # Reduced for two-stage processing (hypothesis + verify)
BATCH_SIZE_DISASTERS = 10  # Disasters per batch for news↔disaster (larger batch, all recent data)
RATE_LIMIT_DELAY = 4.5  # Seconds between API calls (15 per minute limit = 4 second minimum)

# News ↔ disaster candidate filter
DISASTER_TIME_WINDOW_DAYS = 7  # News can report on a disaster up to 7 days after it
DISASTER_DISTANCE_KM = 500  # Nearby news is a candidate even without a keyword match

DISASTER_KEYWORDS = {
    'earthquake': ['earthquake', 'quake', 'seismic', 'tremor', 'aftershock', 'tsunami'],
    'wildfire': ['wildfire', 'bushfire', 'forest fire', 'brush fire', 'blaze', 'smoke'],
    'cyclone': ['cyclone', 'typhoon', 'hurricane', 'tropical storm', 'landfall'],
    'flood': ['flood', 'flooding', 'floods', 'inundation', 'deluge', 'flash flood'],
    'volcano': ['volcano', 'volcanic', 'eruption', 'erupts', 'lava', 'ash cloud'],
    'drought': ['drought', 'water shortage', 'famine', 'crop failure'],
}

# Quality filter phrases for news ↔ disaster mechanisms
GENERIC_MECHANISM_PHRASES = [
    'same region', 'same area', 'same country', 'same time', 'same period',
    'both occurred', 'both happened', 'nearby', 'close proximity',
    'geographic proximity', 'similar location', 'around the same',
]
SPECULATIVE_PHRASES = [
    'could potentially', 'might have', 'may have', 'possibly', 'perhaps',
    'it is possible', 'could be related', 'may be related', 'might be related',
    'speculative', 'unclear whether', 'no direct',
]


# =============================================================================
# SHARED UTILITIES
# =============================================================================

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance between two points in kilometers."""
    R = 6371  # Earth radius in km
    lat1, lng1, lat2, lng2 = map(radians, [lat1, lng1, lat2, lng2])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


def _keyword_overlap(keywords_a: list[dict], keywords_b: list[dict]) -> float:
    """
    Calculate keyword overlap between two events.

    Returns: 0.0-1.0 score based on matching keywords
    """
    if not keywords_a or not keywords_b:
        return 0.0

    # Extract keyword text (lowercase)
    terms_a = {kw.get('text', '').lower() for kw in keywords_a}
    terms_b = {kw.get('text', '').lower() for kw in keywords_b}

    # Calculate Jaccard similarity
    intersection = len(terms_a & terms_b)
    union = len(terms_a | terms_b)

    return intersection / union if union > 0 else 0.0


def _has_causal_chain(hypothesis: dict) -> bool:
    """Check if hypothesis contains a causal chain."""
    chain = hypothesis.get('causal_chain', [])
    return isinstance(chain, list) and len(chain) >= 2


def _has_evidence(verification: dict) -> bool:
    """Check if verification has supporting evidence."""
    explicit = verification.get('explicit_evidence', [])
    world_knowledge = verification.get('world_knowledge', [])
    return len(explicit) >= 1 or len(world_knowledge) >= 1


def _contains_phrase(text: str, phrases: list[str]) -> bool:
    """Check if text contains any phrase as whole words (case-insensitive)."""
    text = text.lower()
    return any(re.search(rf"\b{re.escape(phrase)}\b", text) for phrase in phrases)


def _is_generic_mechanism(mechanism: str) -> bool:
    """Reject mechanisms that only cite shared place/time, not a real connection."""
    return _contains_phrase(mechanism, GENERIC_MECHANISM_PHRASES)


def _is_speculative(mechanism: str) -> bool:
    """Reject hedged mechanisms ("may have", "could potentially")."""
    return _contains_phrase(mechanism, SPECULATIVE_PHRASES)


def _mentions_disaster_type(news: dict, category: str) -> bool:
    """Check if news title or keywords mention terms for this disaster type."""
    terms = DISASTER_KEYWORDS.get(category, [])
    text = ' '.join([news.get('title') or ''] +
                    [kw.get('text', '') for kw in news.get('keywords', [])])
    return _contains_phrase(text, terms)


def _insert_link(cursor, link: dict):
    """Insert link into mart.event_link table."""
    cursor.execute("""
        INSERT INTO mart.event_link (
            link_id, source_id, target_id, relation,
            confidence, rationale, citations, model
        ) VALUES (
            %(link_id)s, %(source_id)s, %(target_id)s, %(relation)s,
            %(confidence)s, %(rationale)s, %(citations)s::jsonb, %(model)s
        )
        ON CONFLICT (link_id) DO UPDATE SET
            relation = EXCLUDED.relation,
            confidence = EXCLUDED.confidence,
            rationale = EXCLUDED.rationale,
            citations = EXCLUDED.citations,
            model = EXCLUDED.model
    """, link)


# =============================================================================
# NEWS ↔ NEWS LINKING
# =============================================================================

def _find_news_news_candidates(news_events: list[dict]) -> dict[str, list[dict]]:
    """
    Find candidate news-news pairs using smart strategies.

    Returns: Dict mapping news_id → list of candidate news events
    """
    candidates_by_news = {}

    for i, news_a in enumerate(news_events):
        candidates = []

        for j, news_b in enumerate(news_events):
            if i >= j:  # Skip self and already-compared pairs
                continue

            # Strategy 1: Keyword overlap (semantic similarity)
            kw_overlap = _keyword_overlap(
                news_a.get('keywords', []),
                news_b.get('keywords', [])
            )

            if kw_overlap >= 0.4:  # 40% keyword overlap
                candidates.append(news_b)
                continue

            # Strategy 2: Geographic clustering
            distance = _haversine_km(
                news_a['lat'], news_a['lng'],
                news_b['lat'], news_b['lng']
            )

            time_diff_hours = abs(
                (news_a['occurred_at'] - news_b['occurred_at']).total_seconds() / 3600
            )

            if distance < 200 and time_diff_hours < 48:  # Same region, recent
                candidates.append(news_b)
                continue

            # Strategy 3: Same category + recent
            if (news_a.get('category') == news_b.get('category') and
                time_diff_hours < 72):  # Same topic, within 3 days
                candidates.append(news_b)

        if candidates:
            candidates_by_news[news_a['id']] = candidates

    return candidates_by_news


def _build_news_news_hypothesis_prompt(news_a: dict, candidates: list[dict]) -> str:
    """
    STAGE 1: Generate hypotheses about potential connections (liberal, exploratory).
    """
    candidates_text = ""
    for idx, news_b in enumerate(candidates, 1):
        candidates_text += f"""
Article {idx}:
  ID: {news_b['id']}
  Title: {news_b['title']}
  Summary: {(news_b.get('summary') or 'N/A')[:200]}...
  Category: {news_b['category']}
  Published: {news_b['occurred_at']}
  Location: {news_b['lat']}, {news_b['lng']}
  Keywords: {', '.join([kw['text'] for kw in news_b.get('keywords', [])[:5]])}
"""

    return f"""You are an expert at finding connections between news events.

Your task: Find ANY potential relationship between the source article and these candidates, including INDIRECT causal connections.

THINK BROADLY AND EXPLORATIVELY:
- Could one event influence the other through economic channels (markets, supply chains, commodities)?
- Could they share a common underlying cause or be part of the same broader trend?
- Could one trigger policy/market responses mentioned in the other?
- Could they be connected through multi-step causal chains? (A → B → C → D)

TRANSMISSION MECHANISMS TO CONSIDER:
- Economic: Market reactions, commodity prices, supply chain effects, financial impacts
- Political: Policy responses, diplomatic reactions, regulatory changes
- Social: Public sentiment shifts, behavior changes, migration patterns
- Temporal: One event enables, triggers, or sets the stage for another

RELATIONSHIP TYPES:

DIRECT:
- SAME_EVENT: Same story from different sources/angles
- SAME_TOPIC: Related stories on same specific subject

CAUSAL:
- CAUSES: Event A directly led to event B
- CONTRIBUTES_TO: Event A is one contributing factor to B
- ENABLES: Event A makes B possible or likely

INDIRECT:
- AFFECTS_MARKET: Economic transmission (conflict → commodity prices → market reaction)
- AFFECTS_POLICY: Political response chain (event → government action → policy impact)
- SHARES_CONTEXT: Common underlying cause or trend
- TEMPORAL_CORRELATION: Happened around same time with plausible causal mechanism

IMPORTANT:
- Be CREATIVE and EXPLORATORY - we verify facts later
- Consider indirect effects and multi-hop causal chains
- Include "could lead to" reasoning
- Think about world knowledge (e.g., which countries produce what commodities)
- Don't reject connections yet - that happens in verification

SOURCE ARTICLE:
Title: {news_a['title']}
Summary: {(news_a.get('summary') or 'N/A')[:300]}...
Category: {news_a['category']}
Published: {news_a['occurred_at']}
Location: {news_a['lat']}, {news_a['lng']}
Keywords: {', '.join([kw['text'] for kw in news_a.get('keywords', [])[:8]])}

CANDIDATE ARTICLES:
{candidates_text}

RESPOND WITH JSON ARRAY of hypotheses:

[
  {{
    "article_id": "...",
    "type": "SAME_EVENT|CAUSES|AFFECTS_MARKET|AFFECTS_POLICY|SHARES_CONTEXT|etc",
    "causal_chain": ["step 1", "step 2", "step 3", "..."],
    "mechanism": "One-sentence description of the connection",
    "plausibility": 0.0-1.0,
    "reasoning": "Why this connection makes sense, including world knowledge"
  }}
]

If no plausible connections exist, return empty array: []
"""


def _generate_hypotheses_batch(client, news_a: dict, candidates: list[dict]) -> list[dict]:
    """
    STAGE 1: Generate hypotheses about potential connections (liberal).

    Returns: List of hypothesis dicts with plausibility scores
    """
    try:
        prompt = _build_news_news_hypothesis_prompt(news_a, candidates)

        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        data = json.loads(response.text.strip())

        if not isinstance(data, list):
            print(f"Warning: Expected list response, got {type(data)}")
            return []

        return data

    except Exception as e:
        print(f"Error in hypothesis generation: {e}")
        return []


def _verify_hypothesis(client, hypothesis: dict, news_a: dict, news_b: dict) -> dict | None:
    """
    STAGE 2: Verify a single hypothesis with factual evidence.

    Returns: Verification dict or None if verification fails
    """
    try:
        # Import helper
        sys.path.insert(0, str(Path(__file__).parent))
        from _verify_news_hypothesis import build_verification_prompt

        prompt = build_verification_prompt(hypothesis, news_a, news_b)

        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        data = json.loads(response.text.strip())

        if not isinstance(data, dict):
            print(f"Warning: Expected dict response, got {type(data)}")
            return None

        return data

    except Exception as e:
        print(f"Error in hypothesis verification: {e}")
        return None


def _verify_news_news_batch(client, news_a: dict, candidates: list[dict]) -> tuple[list[dict], int]:
    """
    Two-stage verification: Generate hypotheses → Verify with evidence.

    Returns: (verified link dicts with two-dimensional confidence, verification API calls made)
    """
    # STAGE 1: Generate hypotheses (1 API call)
    hypotheses = _generate_hypotheses_batch(client, news_a, candidates)

    if not hypotheses:
        return [], 0

    print(f"    Generated {len(hypotheses)} hypotheses")

    # Filter to high-plausibility hypotheses
    high_plausibility = [h for h in hypotheses if h.get('plausibility', 0) >= MIN_PLAUSIBILITY]

    if not high_plausibility:
        print(f"    No hypotheses above plausibility threshold ({MIN_PLAUSIBILITY})")
        return [], 0

    print(f"    {len(high_plausibility)} hypotheses above plausibility threshold")

    verified_links = []
    verify_calls = 0

    # STAGE 2: Verify each high-plausibility hypothesis
    for hypothesis in high_plausibility:
        article_id = hypothesis.get('article_id')
        # Only accept IDs from this batch; drops hallucinated or out-of-batch IDs
        news_b = next((n for n in candidates if n['id'] == article_id), None)

        if not news_b:
            print(f"    Skipping unknown article_id from model: {article_id}")
            continue

        # Verify with evidence (1 API call per hypothesis)
        verification = _verify_hypothesis(client, hypothesis, news_a, news_b)
        verify_calls += 1
        time.sleep(RATE_LIMIT_DELAY)  # Rate limit

        if not verification or not verification.get('accept'):
            continue

        # Combine hypothesis + verification into link data
        link_data = {
            'article_id': article_id,
            'relationship': True,
            'type': hypothesis['type'],
            'confidence': verification['confidence_overall'],
            'confidence_plausibility': verification['confidence_plausibility'],
            'confidence_evidence': verification['confidence_evidence'],
            'mechanism': verification['reasoning_chain'],
            'causal_chain': hypothesis.get('causal_chain', []),
            'evidence': verification.get('explicit_evidence', []),
            'world_knowledge': verification.get('world_knowledge', []),
            'verdict': verification.get('verdict', 'UNKNOWN'),
        }

        verified_links.append(link_data)

    return verified_links, verify_calls


def link_news_to_news(conn, client) -> dict:
    """
    Link news articles to each other.

    Uses mechanism-first AI reasoning with batch processing.

    Returns: Summary dict with counts and statistics
    """
    print("\n=== LINKING NEWS ↔ NEWS ===")

    cursor = conn.cursor()

    # Fetch news events
    cursor.execute("""
        SELECT
            event_id, category, title, summary,
            occurred_at, lat, lng, keywords
        FROM mart.event
        WHERE source IN ('gnews', 'wikifeeds')
          AND keywords IS NOT NULL
          AND jsonb_array_length(keywords) > 0
        ORDER BY occurred_at DESC
    """)

    news_events = []
    for row in cursor.fetchall():
        news_events.append({
            'id': row[0],
            'category': row[1],
            'title': row[2],
            'summary': row[3],
            'occurred_at': row[4],
            'lat': row[5],
            'lng': row[6],
            'keywords': row[7] or [],
        })

    print(f"Found {len(news_events)} news events")

    # Generate candidates
    print("\nGenerating candidates...")
    candidates_by_news = _find_news_news_candidates(news_events)

    total_candidates = sum(len(cands) for cands in candidates_by_news.values())
    print(f"Found {total_candidates} candidate pairs across {len(candidates_by_news)} news articles")

    if client is None:  # Dry run: report candidates only, no API calls or writes
        cursor.close()
        return {
            'type': 'news_news',
            'dry_run': True,
            'news_count': len(news_events),
            'candidates_evaluated': total_candidates,
        }

    # Verify relationships with Gemini (batched)
    links_created = 0
    links_rejected = 0
    api_calls = 0

    print("\nVerifying relationships with AI (two-stage)...")

    for news_id, candidates in candidates_by_news.items():
        # Find the source news event
        news_a = next(n for n in news_events if n['id'] == news_id)

        print(f"\n  Analyzing: {news_a['id'][:40]}...")

        # Process in batches
        for batch_start in range(0, len(candidates), BATCH_SIZE_NEWS):
            batch = candidates[batch_start:batch_start + BATCH_SIZE_NEWS]

            # Two-stage verification (hypothesis generation + verification calls)
            verified, verify_calls = _verify_news_news_batch(client, news_a, batch)
            api_calls += 1 + verify_calls  # Hypothesis generation + verifications

            # Rate limiting for hypothesis call
            time.sleep(RATE_LIMIT_DELAY)

            # Process verified links
            for link_data in verified:
                if not link_data.get('relationship'):
                    links_rejected += 1
                    continue

                confidence = float(link_data.get('confidence', 0.0))
                mechanism = link_data.get('mechanism', '')

                # Quality filtering (relaxed for exploratory linking)
                if (confidence < MIN_CONFIDENCE or
                    not _has_causal_chain(link_data) or
                    not _has_evidence(link_data)):
                    links_rejected += 1
                    continue

                # Build detailed rationale with causal chain
                causal_chain_text = " → ".join(link_data.get('causal_chain', []))
                full_rationale = f"{mechanism}\n\nCausal chain: {causal_chain_text}\n\nEvidence: " + \
                                "; ".join(link_data.get('evidence', [])[:3])

                # Create link with two-dimensional confidence
                link = {
                    'link_id': f"link:{news_a['id']}:{link_data['article_id']}",
                    'source_id': news_a['id'],
                    'target_id': link_data['article_id'],
                    'relation': link_data['type'].lower().replace('_', '-'),
                    'confidence': confidence,
                    'rationale': full_rationale,
                    'citations': json.dumps({
                        'plausibility': link_data.get('confidence_plausibility', 0),
                        'evidence': link_data.get('confidence_evidence', 0),
                        'verdict': link_data.get('verdict', ''),
                        'world_knowledge': link_data.get('world_knowledge', []),
                    }),
                    'model': MODEL,
                }

                _insert_link(cursor, link)
                links_created += 1

                # Show results with two-dimensional confidence
                plaus = link_data.get('confidence_plausibility', 0)
                evid = link_data.get('confidence_evidence', 0)
                print(f"    ✓ {link_data['article_id'][:30]:30} "
                      f"({link['relation']:20} conf={confidence:.2f} p={plaus:.2f} e={evid:.2f})")

        # Commit per source article so a crash only loses the article in progress
        conn.commit()

    cursor.close()

    return {
        'type': 'news_news',
        'news_count': len(news_events),
        'candidates_evaluated': total_candidates,
        'api_calls': api_calls,
        'links_created': links_created,
        'links_rejected': links_rejected,
        'avg_confidence': 0.0,  # TODO: calculate from created links
    }


# =============================================================================
# NEWS ↔ DISASTERS LINKING
# =============================================================================

def _build_news_disaster_prompt(news: dict, disasters: list[dict]) -> str:
    """
    Build batch prompt for news-disaster relationship reasoning.

    Key: Distinguish PRIMARY_STORY (merge in UI) from MENTIONS/ANALYZES (link in UI)
    """
    disasters_text = ""
    for idx, disaster in enumerate(disasters, 1):
        # Build disaster description with metadata
        details = []
        if disaster['category'] == 'earthquake':
            attrs = disaster.get('attributes', {})
            if attrs.get('magnitude'):
                details.append(f"Magnitude {attrs['magnitude']}")
            if attrs.get('depth_km'):
                details.append(f"{attrs['depth_km']}km deep")
            if attrs.get('alert_level'):
                details.append(f"{attrs['alert_level']} alert")
        elif disaster['category'] == 'wildfire':
            attrs = disaster.get('attributes', {})
            if attrs.get('max_frp'):
                details.append(f"FRP {attrs['max_frp']}")
            if attrs.get('hotspot_count'):
                details.append(f"{attrs['hotspot_count']} hotspots")
        elif disaster['category'] == 'cyclone':
            attrs = disaster.get('attributes', {})
            if attrs.get('storm_name'):
                details.append(f"Named: {attrs['storm_name']}")
            if attrs.get('max_wind_kmh'):
                details.append(f"{attrs['max_wind_kmh']} km/h winds")

        details_str = ', '.join(details) if details else 'No additional details'

        disasters_text += f"""
Disaster {idx}:
  ID: {disaster['id']}
  Type: {disaster['category']}
  Title: {disaster['title']}
  Occurred: {disaster['occurred_at']}
  Location: {disaster['lat']}, {disaster['lng']}
  Significance: {disaster.get('significance', 'N/A')}
  Details: {details_str}
"""

    return f"""You are an expert at identifying relationships between news articles and natural disaster events.

Your task: Determine which, if any, of these disasters are connected to this news article.

CRITICAL DISTINCTION:

PRIMARY_STORY: The news article is PRIMARILY ABOUT this specific disaster
  - Article headline/summary describes THIS specific disaster
  - Article's main subject is THIS event
  - Location, timing, and details match THIS disaster
  - This is THE disaster being reported on

MENTIONS: Article references this disaster but isn't primarily about it
  - Article mentions disaster in broader context
  - Disaster is one of several topics discussed
  - Related topic but not the main focus

ANALYZES: Article analyzes impacts/aftermath of this disaster
  - Economic, social, or policy impacts
  - Recovery or response discussion
  - Long-term effects analysis

NONE: No meaningful connection

RULES:

1. Only use PRIMARY_STORY when:
   - Article is EXPLICITLY about THIS SPECIFIC disaster
   - Details match (location, severity, timing)
   - This is the article's PRIMARY subject
   - BE CONSERVATIVE: When in doubt, use MENTIONS instead

2. Use MENTIONS when:
   - Article references disaster but has other main focus
   - Disaster mentioned in passing or as context
   - Part of broader discussion

3. Use ANALYZES when:
   - Article discusses disaster impacts/effects
   - Policy or response discussion
   - Economic or social analysis

4. Provide SPECIFIC EVIDENCE from BOTH article and disaster

5. Reject generic connections (merely same region/time)

NEWS ARTICLE:
Title: {news['title']}
Summary: {(news.get('summary') or 'N/A')[:400]}...
Published: {news['occurred_at']}
Location: {news['lat']}, {news['lng']}
Keywords: {', '.join([kw['text'] for kw in news.get('keywords', [])[:10]])}

CANDIDATE DISASTERS:
{disasters_text}

RESPOND WITH JSON ARRAY:

Return only disasters where a meaningful relationship exists.

[
  {{
    "disaster_id": "...",
    "relationship": true,
    "type": "PRIMARY_STORY | MENTIONS | ANALYZES",
    "confidence": 0.0-1.0,
    "mechanism": "Specific sentence explaining HOW they connect",
    "evidence": [
      "Fact from article showing it references the disaster",
      "Fact about disaster supporting the connection"
    ]
  }}
]

If no meaningful relationships exist, return empty array: []

Remember:
- PRIMARY_STORY only when article is ABOUT this specific disaster
- Be conservative with PRIMARY_STORY
- Generic mechanisms ("both in same region") → reject
- Speculative connections → reject
"""


def _verify_news_disaster_batch(client, news: dict, disasters: list[dict]) -> list[dict]:
    """
    Verify news-disaster relationships using Gemini (batch processing).

    Returns: List of verified link dicts
    """
    try:
        prompt = _build_news_disaster_prompt(news, disasters)

        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        data = json.loads(response.text.strip())

        if not isinstance(data, list):
            print(f"Warning: Expected list response, got {type(data)}")
            return []

        return data

    except Exception as e:
        print(f"Error in Gemini call: {e}")
        return []


def link_news_to_disasters(conn, client) -> dict:
    """
    Link news articles to disaster events.

    Uses same AI-first architecture as news↔news, with special handling
    for PRIMARY_STORY relationships (merge in UI).

    Returns: Summary dict with counts and statistics
    """
    print("\n=== LINKING NEWS ↔ DISASTERS ===")

    cursor = conn.cursor()

    # Fetch news events
    cursor.execute("""
        SELECT
            event_id, category, title, summary,
            occurred_at, lat, lng, keywords
        FROM mart.event
        WHERE source IN ('gnews', 'wikifeeds')
          AND keywords IS NOT NULL
          AND jsonb_array_length(keywords) > 0
        ORDER BY occurred_at DESC
    """)

    news_events = []
    for row in cursor.fetchall():
        news_events.append({
            'id': row[0],
            'category': row[1],
            'title': row[2],
            'summary': row[3],
            'occurred_at': row[4],
            'lat': row[5],
            'lng': row[6],
            'keywords': row[7] or [],
        })

    # Fetch disasters with attributes
    cursor.execute("""
        SELECT
            e.event_id,
            e.category,
            e.title,
            e.occurred_at,
            e.lat,
            e.lng,
            e.significance,
            CASE e.category
                WHEN 'earthquake' THEN (to_jsonb(eq) - 'event_id' - 'footprint')
                WHEN 'wildfire' THEN (to_jsonb(wf) - 'event_id' - 'footprint')
                WHEN 'cyclone' THEN (to_jsonb(cy) - 'event_id' - 'footprint')
                WHEN 'flood' THEN (to_jsonb(fl) - 'event_id' - 'footprint')
                WHEN 'volcano' THEN (to_jsonb(vo) - 'event_id' - 'footprint')
                WHEN 'drought' THEN (to_jsonb(dr) - 'event_id' - 'footprint')
                ELSE '{}'::jsonb
            END AS attributes
        FROM mart.event e
        LEFT JOIN mart.earthquake eq ON eq.event_id = e.event_id
        LEFT JOIN mart.wildfire wf ON wf.event_id = e.event_id
        LEFT JOIN mart.cyclone cy ON cy.event_id = e.event_id
        LEFT JOIN mart.flood fl ON fl.event_id = e.event_id
        LEFT JOIN mart.volcano vo ON vo.event_id = e.event_id
        LEFT JOIN mart.drought dr ON dr.event_id = e.event_id
        WHERE e.source IN ('usgs', 'gdacs', 'firms')
        ORDER BY e.occurred_at DESC
    """)

    disasters = []
    for row in cursor.fetchall():
        disasters.append({
            'id': row[0],
            'category': row[1],
            'title': row[2],
            'occurred_at': row[3],
            'lat': row[4],
            'lng': row[5],
            'significance': row[6],
            'attributes': row[7] or {},
        })

    print(f"Found {len(news_events)} news events")
    print(f"Found {len(disasters)} disasters")

    # Candidate filter: news published 0-N days after the disaster, and either
    # nearby or mentioning the disaster type (catches coarsely geocoded news)
    window_secs = DISASTER_TIME_WINDOW_DAYS * 24 * 3600
    candidates_by_news = {}
    for news in news_events:
        candidates = []
        for disaster in disasters:
            lag = (news['occurred_at'] - disaster['occurred_at']).total_seconds()
            if lag < 0 or lag > window_secs:
                continue
            distance = _haversine_km(news['lat'], news['lng'], disaster['lat'], disaster['lng'])
            if distance <= DISASTER_DISTANCE_KM or _mentions_disaster_type(news, disaster['category']):
                candidates.append(disaster)
        if candidates:
            candidates_by_news[news['id']] = candidates

    total_candidates = sum(len(c) for c in candidates_by_news.values())
    est_calls = sum(-(-len(c) // BATCH_SIZE_DISASTERS) for c in candidates_by_news.values())
    print(f"Found {total_candidates:,} candidate pairs across {len(candidates_by_news)} news articles "
          f"(~{est_calls} API calls, ~{est_calls * RATE_LIMIT_DELAY / 60:.0f} min)")

    if client is None:  # Dry run: report candidates only, no API calls or writes
        cursor.close()
        return {
            'type': 'news_disasters',
            'dry_run': True,
            'news_count': len(news_events),
            'disasters_count': len(disasters),
            'candidates_evaluated': total_candidates,
            'estimated_api_calls': est_calls,
        }

    links_created = 0
    links_rejected = 0
    api_calls = 0
    primary_story_count = 0
    mentions_count = 0
    analyzes_count = 0

    print("\nVerifying relationships with AI...")
    print(f"(Processing {len(candidates_by_news)} news articles...)")

    for news_idx, (news_id, candidates) in enumerate(candidates_by_news.items(), 1):
        news = next(n for n in news_events if n['id'] == news_id)
        print(f"\n[{news_idx}/{len(candidates_by_news)}] {news['id'][:30]}... "
              f"({len(candidates)} candidate disasters)")

        # Batch candidate disasters
        for batch_start in range(0, len(candidates), BATCH_SIZE_DISASTERS):
            batch = candidates[batch_start:batch_start + BATCH_SIZE_DISASTERS]
            batch_ids = {d['id'] for d in batch}

            verified = _verify_news_disaster_batch(client, news, batch)
            api_calls += 1

            # Rate limiting (15 requests per minute on free tier)
            time.sleep(RATE_LIMIT_DELAY)

            # Process verified links
            for link_data in verified:
                if not link_data.get('relationship'):
                    links_rejected += 1
                    continue

                # Only accept IDs from this batch; drops hallucinated or out-of-batch IDs
                if link_data.get('disaster_id') not in batch_ids:
                    print(f"    Skipping unknown disaster_id from model: {link_data.get('disaster_id')}")
                    links_rejected += 1
                    continue

                confidence = float(link_data.get('confidence', 0.0))
                mechanism = link_data.get('mechanism', '')
                link_type = link_data.get('type', 'MENTIONS')

                # Quality filtering
                if (confidence < MIN_CONFIDENCE or
                    _is_generic_mechanism(mechanism) or
                    _is_speculative(mechanism) or
                    len(mechanism) < 20 or
                    len(link_data.get('evidence', [])) < 1):
                    links_rejected += 1
                    continue

                # Map to display mode
                display_mode = 'merge' if link_type == 'PRIMARY_STORY' else 'link'

                # Create link
                link = {
                    'link_id': f"link:{news['id']}:{link_data['disaster_id']}",
                    'source_id': news['id'],
                    'target_id': link_data['disaster_id'],
                    'relation': link_type.lower().replace('_', '-'),
                    'confidence': confidence,
                    'rationale': mechanism,
                    'citations': json.dumps([]),
                    'model': MODEL,
                }

                _insert_link(cursor, link)
                links_created += 1

                # Count by type
                if link_type == 'PRIMARY_STORY':
                    primary_story_count += 1
                elif link_type == 'MENTIONS':
                    mentions_count += 1
                elif link_type == 'ANALYZES':
                    analyzes_count += 1

                print(f"    ✓ {link_data['disaster_id'][:30]:30} "
                      f"({link['relation']:15} {display_mode:6} {confidence:.2f})")

        # Commit per news article so a crash only loses the article in progress
        conn.commit()

    cursor.close()

    return {
        'type': 'news_disasters',
        'news_count': len(news_events),
        'disasters_count': len(disasters),
        'candidates_evaluated': total_candidates,
        'api_calls': api_calls,
        'links_created': links_created,
        'links_rejected': links_rejected,
        'by_type': {
            'primary_story': primary_story_count,
            'mentions': mentions_count,
            'analyzes': analyzes_count,
        },
    }


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def link_all_events(
    link_news_news: bool = True,
    link_news_disasters: bool = False,
    dry_run: bool = False,
) -> dict:
    """
    Generate links between all events.

    Args:
        link_news_news: Link news articles to each other
        link_news_disasters: Link news to disasters
        dry_run: Count candidates only; no Gemini calls or database writes

    Returns:
        Summary dict with results from each linking type
    """
    load_repo_env()

    if not database_configured():
        return {
            "ok": False,
            "status": "needs_database_url",
            "detail": "DATABASE_URL not set",
        }

    client = None
    if not dry_run:
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            return {
                "ok": False,
                "status": "needs_google_api_key",
                "detail": "GOOGLE_API_KEY not set for Gemini",
            }

        from google import genai  # type: ignore

        client = genai.Client(api_key=api_key)

    import psycopg

    conn = psycopg.connect(database_url(), connect_timeout=20)

    try:
        results = {
            "ok": True,
            "status": "dry_run" if dry_run else "complete",
        }

        # News ↔ News linking
        if link_news_news:
            results['news_news'] = link_news_to_news(conn, client)

        # News ↔ Disasters linking
        if link_news_disasters:
            results['news_disasters'] = link_news_to_disasters(conn, client)

        return results

    finally:
        conn.close()


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Unified event linking (default: news↔news only)")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--disasters", action="store_true",
                       help="Link news↔news and news↔disasters")
    scope.add_argument("--disasters-only", action="store_true",
                       help="Only link news↔disasters")
    parser.add_argument("--dry-run", action="store_true",
                        help="Count candidates only; no Gemini calls or database writes")

    args = parser.parse_args()

    print("=" * 80)
    print("UNIFIED EVENT LINKING" + (" (DRY RUN)" if args.dry_run else ""))
    print("=" * 80)

    result = link_all_events(
        link_news_news=not args.disasters_only,
        link_news_disasters=args.disasters or args.disasters_only,
        dry_run=args.dry_run,
    )

    print("\n" + "=" * 80)
    print("LINKING COMPLETE")
    print("=" * 80)
    print(json.dumps(result, indent=2, default=str))

    if not result.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
