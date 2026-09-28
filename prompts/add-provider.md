# Copy-paste this prompt to any LLM (with the pricing page content attached)
// Fill in the bracketed parts, then paste the whole block.

---

You are helping maintain an LLM cost-comparison site. Your task: create ONE provider JSON file
following the schema below, using ONLY the pricing information I paste/provide after the schema.
Do NOT invent prices. If a value is missing or ambiguous, omit that model (or that field) and
tell me what was unclear at the end.

## 1. File shape (must match exactly)

```json
{
  "slug": "[lowercase-hyphenated id, e.g. cohere]",
  "provider": "[Display name, e.g. Cohere]",
  "source_url": "[pricing page URL]",
  "last_updated": "[today as YYYY-MM-DD]",
  "models": [ ... ]
}
```

Rules:
- File must be saved as `data/providers/<slug>.json` (tell me the filename).
- `provider` inside every model MUST equal the top-level `provider` string exactly.
- EXCEPTION: if the prices come from OpenRouter (not the vendor), `provider` must be
  `"OpenRouter"` in every model, and the note must name the serving endpoint:
  `"note": "OpenRouter · <author/slug> via <EndpointProvider>"`
  (endpoint provider = OpenRouter's `provider_display_name`). Keep `or_slug` too.
- `id` must be globally unique, kebab-case, prefixed with the slug: `<slug>-<model>-<variant>`.

## 2. The 4 allowed model types — pick the closest per model/plan

### A. pay_as_you_go (plain per-token API pricing — most common)
```json
{
  "id": "cohere-command-r-plus",
  "name": "Cohere Command R+",
  "type": "pay_as_you_go",
  "provider": "Cohere",
  "currency": "USD",
  "pricing_per_1m": { "cache_hit": 0.0, "cache_miss": 2.5, "output": 10.0 },
  "note": "API list price, Sep 2026"
}
```
- `pricing_per_1m` = price per ONE MILLION tokens in `currency`.
- `cache_miss` = the normal input/prompt price. `cache_hit` = discounted price for
  cached/prompt-reused input. If the vendor has NO cache discount, set
  `cache_hit` EQUAL to `cache_miss` (never 0 unless input is genuinely free).
- `currency`: "USD" normally. Use "CNY" ONLY if the price list is in yuan ¥.
- Optional: `"daily_free_tokens": 500000` if there is a free daily allowance.
- Optional metadata (strongly encouraged — get it from the OpenRouter API,
  `https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards`,
  matching on `slug`):
```json
  "model_type": "reasoning",
  "context_length": 262144,
  "params_b": 30,
  "input_modalities": ["text"],
  "output_modalities": ["text"],
  "supports_reasoning": true,
  "or_slug": "qwen/qwen3-30b-a3b-instruct-2507"
```
  - `model_type`: one of `chat | reasoning | vision | multimodal | audio | image-gen`.
    Derive with priority image-gen > audio-out > reasoning > vision > multimodal > chat
    (reasoning = `supports_reasoning` true; vision = image/video in `input_modalities`).
  - `context_length`: tokens, straight from the API.
  - `params_b`: billions of params parsed from the slug (`qwen3-30b…` → 30).
    `null` when the slug carries no size.
  - `or_slug`: the `author/name` slug, so future refreshes can re-sync metadata.

### B. credit_subscription (vendor sells credit packs; each token burns N credits — e.g. Xiaomi MiMo, Z.AI)
```json
{
  "id": "vendor-model-subscription",
  "name": "Vendor Model (Subscription)",
  "type": "credit_subscription",
  "provider": "Vendor",
  "credit_multipliers": { "cache_hit": 2.0, "cache_miss": 100.0, "output": 200.0 },
  "tiers": [
    { "name": "Lite", "price_usd": 6.0, "credits": 4100000000 },
    { "name": "Pro", "price_usd": 50.0, "credits": 38000000000 }
  ]
}
```
- Multipliers convert TOKENS → CREDITS: credits = hit×cache_hit + miss×cache_miss + output×output.
- If the vendor formula divides by something (e.g. Z.AI divides by 10000), add
  `"credit_formula_divisor": 10000`. Otherwise omit it.
- `tiers` = each purchasable pack: monthly USD price + credits it contains.

### C. fixed_quota_subscription (flat $/month for a fixed token allowance — e.g. MiniMax token plans)
```json
{
  "id": "vendor-plan-plus",
  "name": "Vendor (Plus Plan)",
  "type": "fixed_quota_subscription",
  "provider": "Vendor",
  "price_usd": 20.0,
  "tier_name": "Plus Plan",
  "monthly_token_quota": 1700000000
}
```

### D. hybrid_monetary_subscription (monthly fee that INCLUDES $X of usage, overage billed at API rates — e.g. Ollama Pro, OpenCode Go)
```json
{
  "id": "vendor-model-hybrid",
  "name": "Vendor: Model Name",
  "type": "hybrid_monetary_subscription",
  "provider": "Vendor",
  "subscription_price_usd": 20.0,
  "included_dollars": 60.0,
  "pricing_per_1m": { "cache_hit": 0.014, "cache_miss": 0.15, "output": 0.6 }
}
```

## 3. Unit normalization (CRITICAL — most errors happen here)

Vendors quote prices in different units. ALWAYS convert to **price per 1M tokens**:
- "$X per 1M tokens" → use X as-is.
- "$X per 1K tokens" → multiply by 1000.
- "$X per 1B tokens" → divide by 1000.
- "¥X per 1M tokens" → keep X, set currency to "CNY".
- "N credits per 1K tokens" + "pack: $P for C credits" → this is type B:
  multiplier = N × 1000 (credits per 1M tokens … then divide into packs as needed —
  ask yourself: does 1 token burn N/1000 credits? credits_per_token = N/1000,
  multiplier for 1M-token math = credits_per_token × 1_000_000. Show your arithmetic!).
- Peak/off-peak or standard/flash splits → create SEPARATE model entries with
  `-peak` / `-offpeak` (or `-flash`) id suffixes, like the DeepSeek example.
- If the promo is a DISCOUNT off standard prices (rather than a separate price list),
  keep the STANDARD prices in `pricing_per_1m` and describe the promo in a `promo` key:
```json
  "promo": { "discount_pct": 75 }
```
  Full promo shape (all optional except one price mechanism):
```json
  "promo": {
    "discount_pct": 75,
    "pricing_per_1m": { "cache_hit": 0.025, "cache_miss": 0.125, "output": 0.375 },
    "ends_at": "2026-12-31",
    "label": "−75% launch promo"
  }
```
  - `discount_pct` (0–100) scales every price; `pricing_per_1m` sets explicit promo
    rates (pay_as_you_go/hybrid only — wins if both are present).
  - `ends_at` (YYYY-MM-DD): past dates auto-disable the promo in the app. Omit for
    open-ended promos.
  - `label`: short hover text. Omit it and the app shows `−75%` (or "Promo price").
  - In the app, promo'd rows show 🏷️ before the monthly cost; hovering reveals the
    label, the non-promo base cost, and the end date.

## 4. Output format

1. First, a 3-line summary: how many models, which type(s), which currency.
2. Then the COMPLETE JSON file in one fenced block — valid JSON, no comments,
   no trailing commas, doubles (not strings) for all numbers.
3. Then a bullet list of: assumptions you made, anything you omitted and why.

## 5. Pricing source (paste below this line)
[PASTE pricing page text / table / URL content here — provider: ___]
