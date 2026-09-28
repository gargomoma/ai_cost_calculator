export function formatCompact(n) {
  if (n < 0 || isNaN(n)) return "0";
  if (n >= 1e12) { const v = (n / 1e12).toFixed(1); return (v.endsWith(".0") ? v.slice(0, -2) : v) + "T"; }
  if (n >= 1e9) { const v = (n / 1e9).toFixed(1); return (v.endsWith(".0") ? v.slice(0, -2) : v) + "B"; }
  if (n >= 1e6) { const v = (n / 1e6).toFixed(1); return (v.endsWith(".0") ? v.slice(0, -2) : v) + "M"; }
  if (n >= 1e3) { const v = (n / 1e3).toFixed(1); return (v.endsWith(".0") ? v.slice(0, -2) : v) + "K"; }
  return Math.round(n).toString();
}

// Backwards-compatible alias (original Spanish name)
export const simplificarNumero = formatCompact;

export function projectMonthly(logs, direct, mode) {
  if (mode === "direct") {
    const days = Math.max(1, direct.days || 30);
    const mult = 30 / days;
    return {
      m_hit: (direct.hit || 0) * mult,
      m_miss: (direct.miss || 0) * mult,
      m_output: (direct.output || 0) * mult,
      sampleDays: days,
    };
  }
  const days = Math.max(1, logs.length || 1);
  const sumHit = logs.reduce((a, l) => a + (l.hit || 0), 0);
  const sumMiss = logs.reduce((a, l) => a + (l.miss || 0), 0);
  const sumOut = logs.reduce((a, l) => a + (l.output || 0), 0);
  const mult = 30 / days;
  return {
    m_hit: sumHit * mult, m_miss: sumMiss * mult, m_output: sumOut * mult,
    sampleDays: days, sumHit, sumMiss, sumOut,
  };
}

const STR = {
  es: { insufficient: "Insuficiente", planExcess: (p, e) => `Plan ($${p}) + $${e}`, planOk: (p) => `Plan (${p})`, fixedTier: "Fixed Tier", balance: "incluido", over: "exceso", promoPrice: "Precio promo", unlimited: "Ilimitado" },
  en: { insufficient: "Insufficient", planExcess: (p, e) => `Plan ($${p}) + $${e}`, planOk: (p) => `Plan (${p})`, fixedTier: "Fixed Tier", balance: "included", over: "overage", promoPrice: "Promo price", unlimited: "Unlimited" },
};

// Compact context-window label: 262144→256K, 1048576→1M, 1310720→1.25M.
export function formatContext(n) {
  if (!n || n <= 0) return "";
  if (n >= 1048576) return `${parseFloat((n / 1048576).toFixed(2))}M`;
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`;
  return formatCompact(n);
}

// "T: reasoning · P: 30B · C: 256K" — shown in the Notes column. Empty when unknown.
function buildMeta(m) {
  const parts = [];
  if (m.model_type) parts.push(`T: ${m.model_type}`);
  if (m.params_b !== undefined && m.params_b !== null) parts.push(`P: ${m.params_b}B`);
  const cx = formatContext(m.context_length);
  if (cx) parts.push(`C: ${cx}`);
  return parts.join(" · ");
}

// Promo: m.promo = { discount_pct?, pricing_per_1m?, ends_at?, label? }.
// Active when present, well-formed, and not past ends_at (YYYY-MM-DD).
// discount_pct (0-100) scales prices; pricing_per_1m (payg/hybrid) overrides them.
// If both are set, pricing_per_1m wins.
export function activePromo(m, today = new Date().toISOString().slice(0, 10)) {
  const pr = m.promo;
  if (!pr || typeof pr !== "object") return null;
  if (pr.ends_at && pr.ends_at < today) return null;
  const pct = typeof pr.discount_pct === "number" && pr.discount_pct > 0 && pr.discount_pct < 100;
  const price = pr.pricing_per_1m && typeof pr.pricing_per_1m.cache_miss === "number";
  if (!pct && !price) return null;
  return pr;
}

export function promoLabel(pr, L) {
  if (pr.label) return pr.label;
  if (typeof pr.discount_pct === "number") return `\u2212${pr.discount_pct}%`;
  return L.promoPrice;
}

function scalePer1m(p, factor) {
  return { cache_hit: p.cache_hit * factor, cache_miss: p.cache_miss * factor, output: p.output * factor };
}

export function calculateResults(models, m_hit, m_miss, m_output, cnyRate, lang = "es") {
  const L = STR[lang] || STR.es;
  const m_tokens = m_hit + m_miss + m_output;
  const results = [];
  for (const m of models) {
    const type = m.type;
    if (type === "pay_as_you_go") {
      const p = m.pricing_per_1m;
      const freeMonthly = (m.daily_free_tokens || 0) * 30;
      const adj_miss = Math.max(0, m_miss - freeMonthly);
      let remFree = Math.max(0, freeMonthly - (m_miss - adj_miss));
      const adj_output = Math.max(0, m_output - remFree);
      remFree = Math.max(0, remFree - (m_output - adj_output));
      const adj_hit = Math.max(0, m_hit - remFree);
      const promo = activePromo(m);
      const eff = promo?.pricing_per_1m || (promo ? scalePer1m(p, 1 - promo.discount_pct / 100) : p);
      const triple = (q) => {
        let h = (adj_hit / 1e6) * q.cache_hit;
        let mi = (adj_miss / 1e6) * q.cache_miss;
        let o = (adj_output / 1e6) * q.output;
        if (m.currency === "CNY") { h /= cnyRate; mi /= cnyRate; o /= cnyRate; }
        return { cache_hit: h, cache_miss: mi, output: o };
      };
      const c = triple(eff);
      const hitCost = c.cache_hit, missCost = c.cache_miss, outCost = c.output;
      const bc = triple(p);
      const promoInfo = promo ? { label: promoLabel(promo, L), ends_at: promo.ends_at || null, base_cost: bc.cache_hit + bc.cache_miss + bc.output } : null;
      results.push({
        id: m.id, provider: m.provider, name: m.name,
        modality: "pay_as_you_go", modality_label: "Pay-As-You-Go",
        cost: parseFloat((hitCost + missCost + outCost).toFixed(2)),
        breakdown: { cache_hit: hitCost, cache_miss: missCost, output: outCost },
        pricing_info: { currency: m.currency || "USD", cache_hit: eff.cache_hit, cache_miss: eff.cache_miss, output: eff.output, daily_free: m.daily_free_tokens || 0 },
        pct_used_val: null, pct_used_str: "—", recommended_plan: "—",
        is_recommended: false, is_insufficient: false, consumption_str: "—",
        notes: m.note || "",
        meta_str: buildMeta(m),
        promo: promoInfo,
      });
    } else if (type === "credit_subscription") {
      const mults = m.credit_multipliers;
      let credits;
      if (m.credit_formula_divisor) {
        credits = ((m_miss * mults.cache_miss) + (m_hit * mults.cache_hit) + (m_output * mults.output)) / m.credit_formula_divisor;
      } else {
        credits = (m_hit * mults.cache_hit) + (m_miss * mults.cache_miss) + (m_output * mults.output);
      }
      const firstValid = m.tiers.findIndex((t) => credits <= t.credits);
      const promo = activePromo(m);
      const factor = promo && typeof promo.discount_pct === "number" ? 1 - promo.discount_pct / 100 : 1;
      // One row per subscription: cheapest tier covering usage, else the largest tier (insufficient).
      const tier = firstValid !== -1 ? m.tiers[firstValid] : m.tiers[m.tiers.length - 1];
      {
        const insufficient = credits > tier.credits;
        const pct = (credits / tier.credits) * 100;
        const price = tier.price_usd * factor;
        results.push({
          id: m.id,
          provider: m.provider, name: `${m.name} (${tier.name})`,
          modality: "credit_subscription", modality_label: "credit_subscription",
          cost: parseFloat(price.toFixed(2)), breakdown: null,
          pricing_info: { multipliers: mults, divisor: m.credit_formula_divisor || 1, tier },
          pct_used_val: pct, pct_used_str: `${pct.toFixed(1)}%`,
          recommended_plan: insufficient ? `${tier.name} (${L.insufficient})` : tier.name,
          is_recommended: !insufficient, is_insufficient: insufficient,
          consumption_str: `${formatCompact(credits)} / ${formatCompact(tier.credits)} creds`,
          notes: m.note || "",
          meta_str: buildMeta(m),
          promo: promo ? { label: promoLabel(promo, L), ends_at: promo.ends_at || null, base_cost: tier.price_usd } : null,
        });
      }
    } else if (type === "fixed_quota_subscription") {
      const quota = m.monthly_token_quota;
      const pct = (m_tokens / quota) * 100;
      const insufficient = pct > 100;
      const promo = activePromo(m);
      const factor = promo && typeof promo.discount_pct === "number" ? 1 - promo.discount_pct / 100 : 1;
      const price = m.price_usd * factor;
      results.push({
        id: m.id, provider: m.provider, name: m.name,
        modality: "fixed_quota_subscription", modality_label: "fixed_quota_subscription",
        cost: parseFloat(price.toFixed(2)), breakdown: null,
        pricing_info: { price_usd: m.price_usd, monthly_token_quota: quota },
        pct_used_val: pct, pct_used_str: `${pct.toFixed(1)}%`,
        recommended_plan: insufficient ? `${m.tier_name || L.fixedTier} (${L.insufficient})` : (m.tier_name || L.fixedTier),
        is_recommended: !insufficient, is_insufficient: insufficient,
        consumption_str: `${(m_tokens / 1e9).toFixed(2)}B / ${(quota / 1e9).toFixed(2)}B toks`,
        notes: m.note || "",
        meta_str: buildMeta(m),
        promo: promo ? { label: promoLabel(promo, L), ends_at: promo.ends_at || null, base_cost: m.price_usd } : null,
      });
    } else if (type === "hybrid_monetary_subscription") {
      const p = m.pricing_per_1m;
      const promo = activePromo(m);
      const eff = promo?.pricing_per_1m || (promo ? scalePer1m(p, 1 - promo.discount_pct / 100) : p);
      const usageOf = (q) => (m_hit / 1e6) * q.cache_hit + (m_miss / 1e6) * q.cache_miss + (m_output / 1e6) * q.output;
      const usage = usageOf(eff);
      const sub = m.subscription_price_usd ?? 20.0;
      const included = m.included_dollars ?? 60.0;
      const overage = Math.max(0, usage - included);
      const pct = (usage / included) * 100;
      const insufficient = usage > included;
      results.push({
        id: m.id, provider: m.provider, name: m.name,
        modality: "hybrid_monetary_subscription", modality_label: "hybrid_monetary_subscription",
        // Monthly cost is the flat subscription; usage only informs the plan % and
        // the consumption column (overage never inflates the monthly figure).
        cost: parseFloat(sub.toFixed(2)),
        breakdown: { cache_hit: (m_hit / 1e6) * eff.cache_hit, cache_miss: (m_miss / 1e6) * eff.cache_miss, output: (m_output / 1e6) * eff.output },
        usage_cost: parseFloat(usage.toFixed(2)),
        pricing_info: { subscription_price: sub, included_dollars: included, pricing_per_1m: eff },
        pct_used_val: pct, pct_used_str: `${pct.toFixed(1)}%`,
        recommended_plan: L.planOk(`$${sub.toFixed(2)}`),
        is_recommended: !insufficient, is_insufficient: insufficient,
        consumption_str: included >= 999999 ? L.unlimited : `$${usage.toFixed(2)} / $${included.toFixed(2)} ${L.balance}${insufficient ? ` · +$${overage.toFixed(2)} ${L.over}` : ""}`,
        notes: m.note || "",
        meta_str: buildMeta(m),
        promo: promo ? { label: promoLabel(promo, L), ends_at: promo.ends_at || null, base_cost: sub + Math.max(0, usageOf(p) - included) } : null,
      });
    }
  }
  return { results, m_tokens };
}
