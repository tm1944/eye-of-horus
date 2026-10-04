"""
Helper for building verification prompts - extracted for clarity.
"""


def build_verification_prompt(hypothesis: dict, news_a: dict, news_b: dict) -> str:
    """
    STAGE 2: Verify a hypothesis with factual evidence.
    """
    chain_text = " → ".join(hypothesis.get('causal_chain', []))

    return f"""You are verifying whether a hypothesized connection between two news articles has factual merit.

HYPOTHESIS:
Type: {hypothesis['type']}
Causal Chain: {chain_text}
Mechanism: {hypothesis['mechanism']}
Plausibility: {hypothesis['plausibility']}
Reasoning: {hypothesis.get('reasoning', 'N/A')}

ARTICLE A (SOURCE):
Title: {news_a['title']}
Summary: {(news_a.get('summary') or 'N/A')[:400]}...
Published: {news_a['occurred_at']}
Location: {news_a['lat']}, {news_a['lng']}
Keywords: {', '.join([kw['text'] for kw in news_a.get('keywords', [])[:10]])}

ARTICLE B (TARGET):
Title: {news_b['title']}
Summary: {(news_b.get('summary') or 'N/A')[:400]}...
Published: {news_b['occurred_at']}
Location: {news_b['lat']}, {news_b['lng']}
Keywords: {', '.join([kw['text'] for kw in news_b.get('keywords', [])[:10]])}

Your task: Verify this hypothesis using TWO sources of evidence:

1. EXPLICIT EVIDENCE from articles:
   - Direct mentions of entities, events, or topics
   - Shared locations, people, organizations
   - Timing correlations
   - Causal language ("led to", "caused by", "due to", "resulted in")

2. WORLD KNOWLEDGE:
   - Known causal mechanisms (e.g., oil production affects gas prices)
   - Economic/political connections (e.g., major producers, trade relationships)
   - Historical patterns (e.g., conflicts typically affect commodity markets)
   - Domain expertise you have

CONFIDENCE SCORING:

Plausibility (how likely is the causal chain?):
- 0.8-1.0: STRONG - Well-established mechanism with clear precedent
- 0.5-0.79: MODERATE - Plausible mechanism with some evidence
- 0.3-0.49: WEAK - Speculative but has logical basis
- 0.0-0.29: NONE - No logical connection

Evidence (how much supports it?):
- 0.8-1.0: STRONG - Explicit mentions + validated mechanism + timing
- 0.5-0.79: MODERATE - Some explicit evidence + plausible timing
- 0.3-0.49: WEAK - Timing correlation + logical mechanism
- 0.0-0.29: NONE - No supporting evidence

Overall confidence: Average of plausibility and evidence scores

ACCEPTANCE CRITERIA:
- Accept if overall confidence >= 0.3
- We PREFER false positives that spark insights over false negatives that hide connections
- It's OK to accept connections that are speculative but fact-based

RESPOND WITH JSON:
{{
  "verdict": "STRONG | MODERATE | WEAK | NONE",
  "explicit_evidence": ["fact from articles 1", "fact 2", "..."],
  "world_knowledge": ["knowledge 1", "knowledge 2", "..."],
  "confidence_plausibility": 0.0-1.0,
  "confidence_evidence": 0.0-1.0,
  "confidence_overall": 0.0-1.0,
  "reasoning_chain": "Compressed one-sentence causal explanation",
  "accept": true/false
}}

Set accept=true if confidence_overall >= 0.3
"""
