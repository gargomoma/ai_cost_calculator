# Copy-paste this prompt to refresh stale prices for an existing provider.

---

You are helping maintain an LLM cost-comparison site. I will give you:
1. The CURRENT provider JSON file (possibly outdated), and
2. Fresh pricing information (page text / table).

Task: return the UPDATED provider JSON with corrected prices.

Rules:
- Keep every `id` stable. Only add/remove models if the vendor added/removed them —
  list those changes explicitly afterwards.
- Update `"last_updated"` to today (YYYY-MM-DD).
- Keep the same `type` per model unless the vendor fundamentally changed the billing
  model (if so, flag it and ask before converting).
- Normalize units to **price per 1M tokens** (per 1K → ×1000, per 1B → ÷1000).
- If the vendor has no cache-hit discount, `cache_hit` must equal `cache_miss`.
- Output: (1) one-line changelog (what changed), (2) the complete updated JSON in one
  fenced block (valid JSON, no comments), (3) anything ambiguous you had to guess.

## Current file
[PASTE data/providers/<slug>.json here]

## Fresh pricing source (<provider>, <date>)
[PASTE pricing page text / table here]
