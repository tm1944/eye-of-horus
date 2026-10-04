# Two-Stage Causal Linking - Implementation Summary

**Status:** ✅ Implemented in `jobs/llm/link_events.py`

---

## What Changed

### Architecture: Single-Stage → Two-Stage

**Before (Conservative):**
```
Candidates → AI: "Are these related?" → Accept if confidence ≥ 0.7
```

**After (Exploratory):**
```
Candidates → AI Stage 1: "Find ANY connection" → Hypotheses
           → Filter: plausibility ≥ 0.5
           → AI Stage 2: "Verify with evidence" → Accept if confidence ≥ 0.3
```

---

## Key Changes

### 1. Configuration Updates

```python
# OLD
MIN_CONFIDENCE = 0.7  # Conservative
BATCH_SIZE_NEWS = 5

# NEW  
MIN_CONFIDENCE = 0.3  # Exploratory
MIN_PLAUSIBILITY = 0.5  # Stage 1 threshold
BATCH_SIZE_NEWS = 3  # Reduced (2 API calls per batch now)
```

### 2. New Relationship Types

**Direct:**
- SAME_EVENT
- SAME_TOPIC

**Causal:**
- CAUSES (direct causation)
- CONTRIBUTES_TO (one factor)
- ENABLES (makes possible)

**Indirect:**
- AFFECTS_MARKET (economic transmission)
- AFFECTS_POLICY (political response)
- SHARES_CONTEXT (common cause)
- TEMPORAL_CORRELATION (timing + mechanism)

### 3. Quality Filters: Strict → Exploratory

**OLD (rejected):**
- Generic mechanisms ("both involve")
- Speculative language ("might", "could")
- Short mechanisms (<20 chars)

**NEW (required):**
- Has causal chain (≥2 steps)
- Has some evidence (explicit OR world knowledge)
- Confidence ≥ 0.3

**Philosophy:** False positives > false negatives

### 4. Two-Dimensional Confidence

**Plausibility Score (0-1):**
- How likely is the causal mechanism?
- Based on world knowledge and historical patterns

**Evidence Score (0-1):**
- How much evidence supports it?
- Based on explicit facts in articles

**Overall Confidence:**
- Average of plausibility and evidence
- Both dimensions stored in database

---

## Implementation Details

### Stage 1: Hypothesis Generation (Liberal)

**File:** `_build_news_news_hypothesis_prompt()`

**Approach:**
- "Find ANY potential connection, no matter how indirect"
- Encourages multi-hop reasoning (A → B → C → D)
- Considers economic/political/social transmission
- Uses world knowledge (e.g., commodity production, trade)
- Returns: hypotheses with causal chains + plausibility scores

**Output:**
```json
{
  "article_id": "...",
  "type": "AFFECTS_MARKET",
  "causal_chain": [
    "Middle East conflict",
    "Threatens oil supply",
    "Market uncertainty", 
    "Oil prices rise"
  ],
  "mechanism": "Geopolitical risk affects commodity markets",
  "plausibility": 0.85,
  "reasoning": "Iran produces 3.5M barrels/day; conflicts historically affect prices"
}
```

### Stage 2: Verification (Grounded)

**File:** `_verify_news_hypothesis.py` + `_verify_hypothesis()`

**Approach:**
- Verify hypothesis using TWO evidence sources:
  1. Explicit evidence from articles (mentions, timing, facts)
  2. World knowledge (mechanisms, patterns, connections)
- Rate both plausibility and evidence independently
- Accept if overall ≥ 0.3

**Output:**
```json
{
  "verdict": "MODERATE",
  "explicit_evidence": [
    "Article A mentions conflict in Iran",
    "Article B discusses oil price surge",
    "Timing: 2 days apart"
  ],
  "world_knowledge": [
    "Iran is 7th largest oil producer",
    "Oil markets react to Middle East conflicts",
    "Price transmission occurs within 24-48 hours"
  ],
  "confidence_plausibility": 0.85,
  "confidence_evidence": 0.70,
  "confidence_overall": 0.77,
  "reasoning_chain": "Conflict → supply risk → futures trading → price increase",
  "accept": true
}
```

---

## Database Changes

### Link Record Structure

**Before:**
```json
{
  "link_id": "link:...",
  "source_id": "...",
  "target_id": "...",
  "relation": "same-event",
  "confidence": 0.95,
  "rationale": "Short mechanism",
  "citations": [],
  "model": "gemini-3.5-flash-lite"
}
```

**After:**
```json
{
  "link_id": "link:...",
  "source_id": "...",
  "target_id": "...",
  "relation": "affects-market",
  "confidence": 0.77,
  "rationale": "Detailed mechanism\n\nCausal chain: A → B → C → D\n\nEvidence: fact 1; fact 2; fact 3",
  "citations": {
    "plausibility": 0.85,
    "evidence": 0.70,
    "verdict": "MODERATE",
    "world_knowledge": ["fact 1", "fact 2"]
  },
  "model": "gemini-3.5-flash-lite"
}
```

**Key additions:**
- `rationale` now includes causal chain + evidence
- `citations` stores two-dimensional confidence + world knowledge
- `relation` supports new types (affects-market, causes, etc.)

---

## Expected Impact

### Quantitative Predictions

**Current Results (Conservative):**
- 5 links from 78 articles (~6% connection rate)
- Types: Mostly SAME_EVENT, SAME_TOPIC
- High precision, low recall

**Expected Results (Exploratory):**
- 15-30 links from 78 articles (~20-40% connection rate)
- Types: Mix of direct + causal + indirect
- Moderate precision, higher recall

### Qualitative Improvements

**New Connection Types Found:**
- Economic transmission: Regional conflict → commodity prices
- Policy responses: Event → government action → market impact
- Market reactions: Announcement → trading activity → price change
- Knock-on effects: Regulation → industry shift → employment impact

**Example:**
```
Article A: "Tensions Escalate in Middle East"
    ↓ AFFECTS_MARKET (conf=0.77, plaus=0.85, evid=0.70)
Article B: "Oil Prices Surge on Supply Concerns"

Causal chain: Conflict → supply risk → market trading → price surge
Evidence: Article B mentions "geopolitical tensions"; Iran produces 3.5M barrels/day
```

---

## API Cost Impact

### Per Run Cost

**Before (Single-Stage):**
- 93 candidate pairs / 5 per batch = ~19 batches
- 19 API calls × $0.001 = **$0.019**

**After (Two-Stage):**
- Stage 1 (hypothesis): ~19 calls
- Stage 2 (verify): ~5-10 high-plausibility hypotheses = ~5-10 calls
- Total: ~24-29 calls × $0.001 = **$0.024-$0.029**

**Increase:** ~50% cost for 3-6× more connections

### Time Impact

**Before:** ~2 minutes (19 calls × 4.5s delay)

**After:** ~3-4 minutes (24-29 calls × 4.5s delay + verification delays)

---

## UI Considerations

### Visual Differentiation

**Solid line (HIGH confidence ≥ 0.8):**
- SAME_EVENT
- Direct connections with strong evidence

**Dashed line (MODERATE confidence 0.5-0.8):**
- CAUSES
- AFFECTS_MARKET
- AFFECTS_POLICY
- Causal connections with moderate evidence

**Dotted line (LOW confidence 0.3-0.5):**
- SHARES_CONTEXT
- TEMPORAL_CORRELATION
- Speculative but fact-based

### Hover Information

```
Connection Type: AFFECTS_MARKET
Confidence: 0.77
  • Plausibility: 0.85 (mechanism likelihood)
  • Evidence: 0.70 (supporting facts)
Verdict: MODERATE

Causal chain:
Middle East conflict → supply risk perception → 
futures market activity → oil price increase

Evidence:
• Article mentions "supply concerns" and "geopolitical"
• Iran produces 3.5M barrels/day (7th globally)
• Historical pattern: conflicts affect prices within 48h

[View full details →]
```

---

## Testing Strategy

### Phase 1: Validate on Current Data

Run on existing 78 news articles:

```bash
cd jobs/llm
python link_events.py --news-only
```

**Expected outcomes:**
- 15-30 links created (vs 5 before)
- Mix of relationship types
- Causal chains visible in rationale
- Two-dimensional confidence scores

### Phase 2: Evaluate Quality

**Check for:**
- False positives (unrelated articles linked)
- Interesting indirect connections found
- Causal chain plausibility
- Evidence quality

**Quality indicators:**
- Plausibility ≥ 0.7: Strong mechanisms
- Evidence ≥ 0.7: Well-supported
- Causal chain ≥ 3 steps: Multi-hop reasoning

### Phase 3: User Feedback

Deploy to UI and collect feedback:
- Are indirect connections insightful?
- Are false positives acceptable?
- Should thresholds be adjusted?
- Are confidence dimensions helpful?

---

## Code Files Modified

1. **`jobs/llm/link_events.py`** - Main implementation
   - Updated configuration (MIN_CONFIDENCE, MIN_PLAUSIBILITY)
   - Added `_has_causal_chain()`, `_has_evidence()`
   - Replaced `_build_news_news_prompt()` with `_build_news_news_hypothesis_prompt()`
   - Added `_generate_hypotheses_batch()`
   - Added `_verify_hypothesis()`
   - Rewrote `_verify_news_news_batch()` for two-stage processing
   - Updated `link_news_to_news()` to handle new fields

2. **`jobs/llm/_verify_news_hypothesis.py`** - NEW
   - Stage 2 verification prompt builder
   - Detailed evidence requirements
   - Two-dimensional confidence scoring

3. **`TWO_STAGE_IMPLEMENTATION.md`** - Documentation (this file)

4. **`CAUSAL_LINKING_PROPOSAL.md`** - Research document

---

## Next Steps

### Immediate
1. ✅ Implementation complete
2. ⏳ Run on current data
3. ⏳ Review results
4. ⏳ Tune thresholds if needed

### Short-term
- Apply same architecture to news→disasters linking
- Update frontend to visualize confidence dimensions
- Add user controls (filter by confidence, show/hide speculative)

### Long-term
- Collect user feedback on connection quality
- Build feedback loop (users vote on connections)
- Use feedback to fine-tune prompts and thresholds
- Add citation verification with external sources

---

## Philosophy

> "It's ok to make mistakes. Even if events may not truly be related, having a connecting line for users may create insights that otherwise may have been hidden."

**Translation to code:**
- Lower acceptance threshold (0.3 vs 0.7)
- Encourage exploratory reasoning
- Show two-dimensional confidence (let users judge)
- Accept speculative connections with factual grounding

**Goal:** Surface indirect causal relationships that conservative systems would miss.

**Example success case:**
```
Middle East conflict → oil supply concerns → energy prices rise globally
(This is exactly the kind of "leap in logic" that was missing before)
```
