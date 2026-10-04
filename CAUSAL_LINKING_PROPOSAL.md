# Causal & Indirect Linking - Enhanced Proposal

**Problem:** Current system finds direct/obvious connections but misses indirect causal relationships

**Example:** Middle East conflict → oil supply concerns → energy prices rise globally

---

## Current System Issues

### What Works Well ✅
- Finding duplicate stories (same event, different source)
- Identifying when articles explicitly reference each other
- High precision (few false positives)

### What It Misses ❌
- **Causal chains:** Event A causes B causes C
- **Economic transmission:** Regional conflict → commodity prices
- **Policy responses:** Disaster → government action
- **Knock-on effects:** Tech regulation → market impact

**Root cause:** Prompts are too conservative
- "Do NOT connect unless directly stated"
- "Reject speculative connections"
- "Only use facts explicitly in articles"

---

## Research: How AI Can Reason About Causality

### 1. Chain-of-Thought Prompting

**Technique:** Ask AI to work through reasoning steps

**Example:**
```
Middle East conflict
  → Major oil-producing region
  → Potential supply disruption
  → Market uncertainty
  → Oil futures increase
  → Energy prices article

Connection: Plausible causal chain
```

**Source:** Wei et al., "Chain-of-Thought Prompting Elicits Reasoning in LLMs"

### 2. Counterfactual Reasoning

**Technique:** Ask "Would B happen without A?"

**Example:**
```
Would energy prices article exist without Middle East conflict?
→ Possibly, but the TIMING suggests connection
→ Article published 2 days after conflict escalation
→ Article cites "geopolitical tensions"
→ Likely related
```

### 3. Two-Stage Verification

**Stage 1: Generate Hypothesis**
- Liberal threshold
- Encourage creative connections
- Focus on "could be related"

**Stage 2: Verify Hypothesis**
- Check factual basis
- Look for evidence
- Rate confidence

**Source:** Common in scientific reasoning systems

### 4. Knowledge-Grounded Reasoning

**Technique:** Use world knowledge + article facts

**Example:**
```
Facts from articles:
- Article A: "Conflict in Iran"
- Article B: "Oil prices surge"

World knowledge:
- Iran is 7th largest oil producer
- Oil markets respond to geopolitical risk
- Price changes follow within days

Conclusion: Strong indirect connection
```

---

## Proposed Two-Stage Architecture

### Stage 1: Hypothesis Generation (Liberal)

**Prompt:**
```
Your task: Find ANY potential connection between these articles, 
no matter how indirect.

Think step-by-step:
1. What are the key entities/topics in each article?
2. What causal chains could connect them?
3. What shared economic/political/social systems link them?
4. What knock-on effects could one have on the other?

For each potential connection:
- Describe the causal chain (A → B → C)
- Note transmission mechanism
- Rate plausibility (0-1)

IMPORTANT:
- Be creative and exploratory
- Consider indirect effects
- Include "could lead to" reasoning
- Don't reject based on lack of direct evidence YET
```

**Output:**
```json
{
  "hypotheses": [
    {
      "type": "causal_chain",
      "chain": [
        "Middle East conflict",
        "Threat to oil production",
        "Market uncertainty",
        "Oil price increase",
        "Energy market impact"
      ],
      "mechanism": "geopolitical_risk_transmission",
      "plausibility": 0.8
    }
  ]
}
```

### Stage 2: Verification (Grounded)

**Prompt:**
```
For this hypothesis, verify if it has factual merit.

Hypothesis: {hypothesis}

Check:
1. Do articles contain supporting evidence?
   - Explicit mentions
   - Timing correlation
   - Shared entities/locations
   
2. Does world knowledge support this?
   - Known causal mechanisms
   - Economic/political connections
   - Historical patterns

3. What's the confidence level?
   - STRONG: Explicit evidence + known mechanism
   - MODERATE: Timing + plausible mechanism
   - WEAK: Speculative but possible
   - NONE: No factual basis

Return:
- Verification verdict (STRONG/MODERATE/WEAK/NONE)
- Evidence from articles
- World knowledge used
- Confidence score (0-1)
```

**Output:**
```json
{
  "verdict": "MODERATE",
  "evidence": [
    "Article A published Oct 1, conflict started Sept 30",
    "Article B mentions 'geopolitical tensions' affecting markets",
    "Both reference Middle East region"
  ],
  "world_knowledge": [
    "Iran produces 3.5M barrels/day",
    "Oil markets react to Middle East conflicts historically",
    "Price transmission occurs within 24-48 hours"
  ],
  "confidence": 0.75,
  "reasoning_chain": "Regional conflict → supply risk perception → futures trading → price increase"
}
```

---

## Enhanced Relationship Types

### Direct Relationships (Current)
- SAME_EVENT: Duplicate stories
- MENTIONS: Explicit reference

### Causal Relationships (NEW)
- CAUSES: Event A directly led to B
  - Example: "Policy announced" → "Markets react"
  
- CONTRIBUTES_TO: Event A is one factor in B
  - Example: "Tech layoffs" + other factors → "Economic concerns"
  
- ENABLES: Event A makes B possible
  - Example: "New regulation" → "Compliance industry growth"

### Indirect Relationships (NEW)
- AFFECTS_MARKET: Economic transmission
  - Example: "Regional conflict" → "Commodity prices"
  
- AFFECTS_POLICY: Political response
  - Example: "Disaster" → "Government funding bill"
  
- SHARES_CONTEXT: Common underlying cause
  - Example: Two articles about different inflation impacts
  
- TEMPORAL_CORRELATION: Happened around same time with plausible link
  - Example: "Tech announcement" → "Stock movement"

---

## Confidence Scoring Framework

### Two-Dimensional Confidence

**Dimension 1: Connection Plausibility**
- How likely is the causal chain?
- 0.0-0.3: Speculative
- 0.4-0.7: Plausible
- 0.8-1.0: Strong mechanism

**Dimension 2: Evidence Strength**
- How much evidence supports it?
- 0.0-0.3: Timing only
- 0.4-0.7: Timing + mentions + mechanism
- 0.8-1.0: Explicit evidence

**Combined Score:** Average or weighted combination

**Display in UI:**
- Show both dimensions
- "Plausible connection (0.8) with moderate evidence (0.6)"
- Let users filter by either dimension

---

## Example: Middle East → Oil Prices

### Stage 1: Hypothesis Generation

**Article A:**
```
Title: "Tensions Escalate in Iran-Israel Conflict"
Date: Sept 30, 2026
Content: "Military strikes... regional stability concerns..."
```

**Article B:**
```
Title: "Oil Prices Surge on Supply Concerns"
Date: Oct 2, 2026
Content: "Crude jumped 5%... traders worried about disruptions..."
```

**AI Hypothesis:**
```json
{
  "type": "AFFECTS_MARKET",
  "causal_chain": [
    "Iran-Israel military conflict",
    "Iran is major oil producer",
    "Conflict threatens oil infrastructure",
    "Market perceives supply risk",
    "Traders buy futures as hedge",
    "Oil prices increase",
    "Energy markets article"
  ],
  "mechanism": "geopolitical_risk_premium",
  "plausibility": 0.85,
  "reasoning": "Middle East conflicts historically affect oil markets within 24-48 hours due to supply risk concerns"
}
```

### Stage 2: Verification

**Evidence Check:**
```json
{
  "explicit_evidence": [
    "Article B mentions 'supply concerns'",
    "Article B references 'geopolitical'",
    "Timing: 2 days between events"
  ],
  "implicit_evidence": [
    "Iran produces 3.5M barrels/day (7th globally)",
    "Strait of Hormuz nearby (20% of oil trade)",
    "Historical pattern: 2019 Iran tensions → +15% oil prices"
  ],
  "world_knowledge_used": [
    "Iran oil production capacity",
    "Oil market response times",
    "Historical conflict-price correlations"
  ],
  "verdict": "STRONG",
  "confidence_plausibility": 0.85,
  "confidence_evidence": 0.70,
  "confidence_overall": 0.77
}
```

**Link Created:**
```json
{
  "source": "article:iran-conflict",
  "target": "article:oil-prices",
  "type": "AFFECTS_MARKET",
  "confidence": 0.77,
  "mechanism": "Middle East military conflict creates oil supply risk perception, leading to futures market activity and price increases within 24-48 hours",
  "causal_chain": "conflict → supply risk → market trading → price surge",
  "evidence": {
    "explicit": ["Article B mentions supply concerns", "Timing correlation"],
    "world_knowledge": ["Iran 7th largest producer", "Historical precedents"]
  },
  "dimensions": {
    "plausibility": 0.85,
    "evidence": 0.70
  }
}
```

---

## Prompt Templates

### Stage 1: Liberal Hypothesis Generation

```
You are an expert at finding connections between news events.

Your task: Find ANY potential relationship between these articles, 
including indirect causal connections.

THINK BROADLY:
- Could one event influence the other through economic channels?
- Could they share a common cause?
- Could one trigger policy/market responses mentioned in the other?
- Could they be part of the same broader trend?

REASONING APPROACH:
1. Identify key entities, locations, topics in each article
2. Consider causal chains: A → B → C → D
3. Think about transmission mechanisms:
   - Economic: markets, supply chains, commodities
   - Political: policy responses, diplomatic reactions
   - Social: public sentiment, behavior changes
   - Temporal: one event enables/triggers another

For each potential connection, provide:
- Causal chain (step by step)
- Transmission mechanism
- Plausibility score (0-1)

Be EXPLORATORY and CREATIVE. We'll verify later.

ARTICLE A:
{article_a}

ARTICLE B:
{article_b}

Respond with JSON array of hypotheses:
[
  {
    "type": "CAUSES | AFFECTS_MARKET | AFFECTS_POLICY | SHARES_CONTEXT",
    "causal_chain": ["step 1", "step 2", "step 3"],
    "mechanism": "one-line description",
    "plausibility": 0.0-1.0,
    "reasoning": "why this connection makes sense"
  }
]

If no plausible connection exists, return empty array [].
```

### Stage 2: Grounded Verification

```
You are verifying whether a hypothesized connection has factual merit.

HYPOTHESIS:
Type: {type}
Causal Chain: {chain}
Mechanism: {mechanism}
Plausibility: {plausibility}

ARTICLES:
{article_a}
{article_b}

Your task: Verify this hypothesis using:
1. EXPLICIT EVIDENCE from articles
   - Direct mentions
   - Shared entities/locations
   - Timing correlations
   - Causal language

2. WORLD KNOWLEDGE
   - Known causal mechanisms
   - Economic/political connections
   - Historical patterns
   - Domain expertise

SCORING:
- STRONG (0.8-1.0): Explicit evidence + validated mechanism
- MODERATE (0.5-0.79): Timing + plausible mechanism + some evidence
- WEAK (0.3-0.49): Speculative but has some basis
- NONE (0-0.29): No factual support

Respond with JSON:
{
  "verdict": "STRONG | MODERATE | WEAK | NONE",
  "explicit_evidence": ["fact 1", "fact 2"],
  "world_knowledge": ["knowledge 1", "knowledge 2"],
  "confidence_plausibility": 0.0-1.0,
  "confidence_evidence": 0.0-1.0,
  "confidence_overall": 0.0-1.0,
  "reasoning_chain": "compressed causal explanation",
  "accept": true/false
}

Accept if confidence_overall >= 0.3 (we prefer false positives over false negatives).
```

---

## Implementation Changes

### Code Structure

```python
def find_causal_links(article_a, article_b):
    """Two-stage causal linking."""
    
    # Stage 1: Generate hypotheses (liberal)
    hypotheses = generate_hypotheses(article_a, article_b)
    
    if not hypotheses:
        return None
    
    # Stage 2: Verify each hypothesis (grounded)
    verified_links = []
    for hypothesis in hypotheses:
        verification = verify_hypothesis(
            hypothesis, 
            article_a, 
            article_b
        )
        
        if verification['accept']:
            link = create_link(hypothesis, verification)
            verified_links.append(link)
    
    return verified_links
```

### API Calls

**Current:** 1 call per batch
**Proposed:** 2 calls per batch (hypothesis + verification)

**Cost:** ~2x current cost
**Benefit:** Much richer connections

**Optimization:** Only run verification on high-plausibility hypotheses (>0.5)

---

## Acceptance Threshold Changes

### Current (Conservative)
```python
accept = (
    confidence >= 0.7
    and not is_generic(mechanism)
    and not is_speculative(mechanism)
    and directness == 'DIRECT'
)
```

### Proposed (Exploratory)
```python
accept = (
    confidence_overall >= 0.3  # Much lower!
    and has_causal_chain(hypothesis)
    and has_some_evidence(verification)
    # Allow INDIRECT connections
    # Allow speculative reasoning with evidence
)
```

**Philosophy:** False positives that spark insights > false negatives that hide connections

---

## UI Considerations

### Visual Differentiation

**Direct Links (solid line):**
- SAME_EVENT
- MENTIONS
- High confidence (>0.8)

**Causal Links (dashed line):**
- CAUSES
- AFFECTS_MARKET
- AFFECTS_POLICY
- Medium confidence (0.5-0.8)

**Speculative Links (dotted line):**
- SHARES_CONTEXT
- TEMPORAL_CORRELATION  
- Lower confidence (0.3-0.5)

### Hover Display

```
Connection Type: AFFECTS_MARKET
Confidence: 0.77 (plausibility: 0.85, evidence: 0.70)

How they're connected:
Middle East military conflict creates oil supply risk 
perception, leading to futures market activity and price 
increases within 24-48 hours

Evidence:
• Article mentions "supply concerns"
• Timing: 2 days between events
• Iran produces 3.5M barrels/day
• Historical pattern: conflicts affect prices

[View full reasoning chain →]
```

---

## Testing Strategy

### Test Pairs

1. **Direct:** "Company announces product" → "Product review"
   - Should: HIGH confidence direct link

2. **Causal:** "Central bank rate hike" → "Housing market slows"
   - Should: MODERATE confidence causal link

3. **Market:** "Tech regulation proposed" → "Tech stocks drop"
   - Should: MODERATE confidence market link

4. **Speculative:** "Celebrity scandal" → "Brand stock dips"
   - Should: WEAK confidence, accept if timing + evidence

5. **Unrelated:** "Sports game" → "Weather report"
   - Should: Reject, no plausible mechanism

---

## Migration Path

### Phase 1: Test on Sample
- Run two-stage on 10 news pairs
- Compare to current system
- Validate quality

### Phase 2: Adjust Thresholds
- Based on Phase 1 results
- Tune acceptance threshold
- Adjust prompt wording

### Phase 3: Full Deployment
- Run on all news pairs
- Monitor false positive rate
- Collect user feedback

### Phase 4: User Controls
- Let users filter by confidence
- Let users see/hide speculative links
- Let users provide feedback on connections

---

## Expected Outcomes

### Quantitative

**Current System:**
- 5 links from 78 articles
- ~6% connection rate
- Mostly duplicates/direct

**With Causal Linking:**
- 20-40 links estimated
- ~25-50% connection rate
- Mix of direct + causal + speculative

### Qualitative

**New Connection Types:**
- Economic transmission (conflict → prices)
- Policy responses (event → legislation)
- Market reactions (announcement → stock movement)
- Knock-on effects (regulation → industry impact)

---

## Cost Analysis

**Current:** 1 API call per batch = $0.05 for news-news

**With Two-Stage:**
- Hypothesis: 93 calls
- Verification: ~30 calls (only high-plausibility)
- Total: ~123 calls = $0.12

**Cost increase:** 2.4x
**Link increase:** ~4-8x
**Value per link:** Higher (richer insights)

---

## Risks & Mitigations

### Risk 1: Too Many False Positives
**Mitigation:** 
- Two-stage verification
- Evidence requirements
- User filtering options
- Feedback loop

### Risk 2: Computationally Expensive
**Mitigation:**
- Only verify high-plausibility hypotheses
- Batch processing
- Cache common knowledge

### Risk 3: Confusing to Users
**Mitigation:**
- Clear visual differentiation
- Confidence scores visible
- "Show reasoning" option
- Educational tooltips

---

## Recommended Next Steps

1. **Implement two-stage prompts** in `link_events.py`
2. **Test on 10 sample pairs** manually
3. **Evaluate quality** of hypotheses and verifications
4. **Tune thresholds** based on results
5. **Run on full dataset** with new approach
6. **Compare results** to current 5 links
7. **Document causal chains** found

Would you like me to implement this two-stage approach?
