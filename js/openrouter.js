export const DEFAULT_OPENROUTER_URL =
  "https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&order=discount-high-to-low&output_modalities=text&variant=standard";

export const BIG_LABS = new Set([
  "openai", "anthropic", "google", "deepseek", "meta",
  "qwen", "mistralai", "x-ai", "moonshotai", "z-ai",
  "minimax", "inclusionai", "amazon", "nvidia", "cohere",
  "microsoft", "ai21", "inception", "xiaomi",
]);

export const SMALL_PATTERNS = ["nano", "tiny", "0.5b", "1b", "1.5b", "3b", "7b", "8b"];

export function paramBillions(slug) {
  const m = /(\d+(?:\.\d+)?)b/i.exec(slug || "");
  return m ? parseFloat(m[1]) : null;
}

// Single-label model type, derived from modalities + reasoning flag.
// Priority: image-gen > audio-out > reasoning > vision > multimodal > chat.
export function deriveModelType({ input = [], output = [], reasoning = false } = {}) {
  const has = (arr, ...xs) => xs.some((x) => arr.includes(x));
  if (has(output, "image")) return "image-gen";
  if (has(output, "audio")) return "audio";
  if (reasoning) return "reasoning";
  if (has(input, "image", "video")) return "vision";
  if (has(input, "audio", "file")) return "multimodal";
  return "chat";
}

function toPerMillion(val) {
  const f = parseFloat(val);
  return Number.isFinite(f) ? f * 1_000_000 : 0;
}

function modelList(raw) {
  // Supports both shapes: {data:{models:[...]}} and {data:[...]} and {models:[...]}
  if (!raw) return [];
  if (Array.isArray(raw?.data?.models)) return raw.data.models;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.models)) return raw.models;
  return [];
}

export function openrouterToCatalog(openrouterData, opts = {}) {
  const {
    minContext = 0,
    minOutputPrice = 0,
    requireReasoning = false,
    bigLabsOnly = false,
    dropSmallByName = false,
    minParamsB = 0,
    authorContains = "",
  } = opts;

  const authorNeedle = (authorContains || "").trim().toLowerCase();
  const out = [];

  for (const m of modelList(openrouterData)) {
    if (!m) continue;
    if ((m.context_length || 0) < minContext) continue;
    if (requireReasoning && !m.supports_reasoning) continue;
    if (bigLabsOnly && !BIG_LABS.has((m.author || "").toLowerCase())) continue;
    if (authorNeedle) {
      const hay = `${m.author || ""} ${m.author_display_name || ""} ${m.name || ""} ${m.slug || ""}`.toLowerCase();
      if (!hay.includes(authorNeedle)) continue;
    }
    if (dropSmallByName) {
      const n = (m.name || "").toLowerCase();
      if (SMALL_PATTERNS.some((p) => n.includes(p))) continue;
    }
    const size = paramBillions(m.slug || "");
    if (size !== null && size < minParamsB) continue;

    const pricing = (m.endpoint || {}).pricing || {};
    const cacheMiss = toPerMillion(pricing.prompt);
    const output = toPerMillion(pricing.completion);
    // House rule (see AGENTS.md): no cache price => bill hits at full input price, never 0.
    const cacheHit = toPerMillion(pricing.input_cache_read) || cacheMiss;
    if (cacheMiss === 0 && output === 0 && cacheHit === 0) continue;
    if (output < minOutputPrice) continue;

    const inMods = m.input_modalities || ["text"];
    const outMods = m.output_modalities || ["text"];
    const reasoning = !!m.supports_reasoning;
    const paramsB = paramBillions(m.slug || "");
    // House convention: pulled-from-OpenRouter rows always carry provider
    // "OpenRouter"; the serving endpoint goes in the note.
    const ep = (m.endpoint || {}).provider_display_name || (m.endpoint || {}).provider_name || null;

    out.push({
      id: `openrouter-${m.slug || "unknown"}`,
      name: m.name || m.slug || "Unknown",
      type: "pay_as_you_go",
      provider: "OpenRouter",
      currency: "USD",
      pricing_per_1m: {
        cache_hit: Math.round(cacheHit * 1e6) / 1e6,
        cache_miss: Math.round(cacheMiss * 1e6) / 1e6,
        output: Math.round(output * 1e6) / 1e6,
      },
      note: `OpenRouter · ${m.slug || ""}` + (ep ? ` via ${ep}` : ""),
      // --- model metadata (from OpenRouter API) ---
      model_type: deriveModelType({ input: inMods, output: outMods, reasoning }),
      context_length: m.context_length || 0,
      params_b: paramsB,
      input_modalities: inMods,
      output_modalities: outMods,
      supports_reasoning: reasoning,
    });
  }
  return { currency_rates: { USD_TO_CNY: 7.15 }, models: out };
}
