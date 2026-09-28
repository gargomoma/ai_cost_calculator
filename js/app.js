import { calculateResults, projectMonthly, formatCompact } from "./calc.js";
import { loadState, saveState, clearState, paramsToState, buildShareUrl } from "./store.js";
import { loadLocale, t } from "./i18n.js";
import { openrouterToCatalog, DEFAULT_OPENROUTER_URL, BIG_LABS, SMALL_PATTERNS } from "./openrouter.js";

const VERSION = "1.0.0";

class App {
  constructor() {
    this.catalog = { currency_rates: { USD_TO_CNY: 7.15 }, models: [] };
    this.catalogMeta = { last_updated: "" };
    this.logs = [{ time: "2026-09-03", hit: 30000000, miss: 1000000, output: 500000 }];
    this.direct = { days: 30, hit: 900000000, miss: 30000000, output: 15000000 };
    this.mode = "logs";
    this.lang = "es";
    this.sortColumn = "cost";
    this.sortAsc = true;
    this.chart = null;
    this.calculatedResults = [];
    this.inputCollapsed = false;
  }

  async init() {
    // 1. URL params take precedence, then localStorage
    const fromUrl = paramsToState(new URLSearchParams(window.location.search));
    const saved = loadState();
    if (fromUrl) {
      if (fromUrl.lang) this.lang = fromUrl.lang;
      if (fromUrl.mode) this.mode = fromUrl.mode;
      if (fromUrl.cnyRate) this.catalog.currency_rates.USD_TO_CNY = fromUrl.cnyRate;
      if (fromUrl.logs) this.logs = fromUrl.logs;
      if (fromUrl.direct) this.direct = fromUrl.direct;
    } else if (saved) {
      this.lang = saved.lang || "es";
      this.mode = saved.mode || "logs";
      if (saved.logs) this.logs = saved.logs;
      if (saved.direct) this.direct = saved.direct;
      if (saved.cnyRate) this.catalog.currency_rates.USD_TO_CNY = saved.cnyRate;
      if (saved.catalogOverride) this.catalog = saved.catalogOverride;
      if (typeof saved.inputCollapsed === "boolean") this.inputCollapsed = saved.inputCollapsed;
    }
    await loadLocale(this.lang);
    this.syncLangButtons();
    this.syncModalityFilterLabels();
    await this.loadCatalog();
    // apply persisted direct inputs to DOM after render
    this.renderLogsTable();
    this.syncDirectInputs();
    document.getElementById("cny-rate-input").value = this.catalog.currency_rates.USD_TO_CNY;
    this.setMode(this.mode, true);
    this.syncInputPanel();
    this.initGlobalDismiss();
    this.initChart();
    this.recalculate();
    this.updateFooterMeta();
  }

  async loadCatalog() {
    // If user has a local override and no URL reset, keep it
    const saved = loadState();
    if (saved?.catalogOverride && !new URLSearchParams(window.location.search).has("reset")) {
      this.catalog = saved.catalogOverride;
      return;
    }
    try {
      const man = await (await fetch("data/manifest.json", { cache: "no-store" })).json();
      const models = [];
      for (const p of man.providers) {
        try {
          const doc = await (await fetch(`data/${p.file}`, { cache: "no-store" })).json();
          models.push(...doc.models);
        } catch (e) { console.warn("provider failed", p.file, e); }
      }
      if (models.length) {
        this.catalog = { currency_rates: man.currency_rates, models };
        this.catalogMeta = { last_updated: man.last_updated };
      }
    } catch (e) {
      console.warn("manifest fetch failed (file:// ?), catalog stays empty", e);
      const ta = document.getElementById("catalog-json-input");
      if (ta) ta.placeholder = t("toast.loadFail");
    }
  }

  syncModalityFilterLabels() {
    ["modality-filter", "m-modality-filter"].forEach((sid) => {
      const sel = document.getElementById(sid);
      if (!sel || !sel.options.length) return;
      sel.options[0].textContent = t("filter.all");
      const map = { pay_as_you_go: "Pay-As-You-Go", credit_subscription: t("filter.credit"), fixed_quota_subscription: t("filter.fixed"), hybrid_monetary_subscription: t("filter.hybrid") };
      for (let i = 1; i < sel.options.length; i++) {
        const v = sel.options[i].value;
        if (map[v]) sel.options[i].textContent = map[v];
      }
    });
  }

  persist() {
    saveState({
      lang: this.lang, mode: this.mode, logs: this.logs, direct: this.direct,
      cnyRate: this.catalog.currency_rates.USD_TO_CNY,
      catalogOverride: this._customCatalog ? this.catalog : null,
      inputCollapsed: this.inputCollapsed,
    });
  }

  toggleInputPanel() {
    this.inputCollapsed = !this.inputCollapsed;
    this.syncInputPanel();
    this.persist();
  }

  syncInputPanel() {
    const body = document.getElementById("input-panel-body");
    const sum = document.getElementById("input-panel-summary");
    const chev = document.getElementById("input-panel-chevron");
    if (!body || !sum) return;
    body.classList.toggle("hidden", this.inputCollapsed);
    sum.classList.toggle("hidden", !this.inputCollapsed);
    if (chev) chev.style.transform = this.inputCollapsed ? "rotate(-90deg)" : "";
    this.updateInputSummary();
  }

  updateInputSummary() {
    const el = document.getElementById("input-panel-summary");
    if (!el) return;
    if (this.mode === "direct") {
      const d = this.direct;
      const reg = (d.hit || 0) + (d.miss || 0) + (d.output || 0);
      const proj = reg * (30 / Math.max(1, d.days || 30));
      el.textContent = t("panel.sumDirect")
        .replace("{reg}", formatCompact(reg)).replace("{d}", d.days || 30).replace("{proj}", formatCompact(proj));
    } else {
      const n = this.logs.length;
      const reg = this.logs.reduce((a, l) => a + (l.hit || 0) + (l.miss || 0) + (l.output || 0), 0);
      const proj = reg * (30 / Math.max(1, n));
      el.textContent = t("panel.sumLogs")
        .replace("{n}", n).replace("{reg}", formatCompact(reg)).replace("{proj}", formatCompact(proj));
    }
  }

  async setLang(l) {
    this.lang = l === "en" ? "en" : "es";
    await loadLocale(this.lang);
    this.syncLangButtons();
    this.syncModalityFilterLabels();
    this.updateImportPromptText();
    this.updateOrLabsHint();
    this.persist();
    this.recalculate();
    this.updateFooterMeta();
  }
  syncLangButtons() {
    const es = document.getElementById("btn-lang-es");
    const en = document.getElementById("btn-lang-en");
    if (!es || !en) return;
    es.className = "px-2 py-1 rounded-md font-medium transition " + (this.lang === "es" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200");
    en.className = "px-2 py-1 rounded-md font-medium transition " + (this.lang === "en" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200");
  }

  setMode(m, skipRecalc) {
    this.mode = m;
    const bL = document.getElementById("btn-mode-logs");
    const bD = document.getElementById("btn-mode-direct");
    const pL = document.getElementById("panel-mode-logs");
    const pD = document.getElementById("panel-mode-direct");
    if (m === "logs") {
      bL.className = "px-3 py-1 rounded-md font-medium transition bg-blue-600 text-white shadow-sm";
      bD.className = "px-3 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200 transition";
      pL.classList.remove("hidden"); pD.classList.add("hidden");
    } else {
      bD.className = "px-3 py-1 rounded-md font-medium transition bg-blue-600 text-white shadow-sm";
      bL.className = "px-3 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200 transition";
      pD.classList.remove("hidden"); pL.classList.add("hidden");
    }
    this.persist();
    if (!skipRecalc) this.recalculate();
  }

  updateCnyRate(v) {
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) { this.catalog.currency_rates.USD_TO_CNY = n; this.persist(); this.recalculate(); }
  }

  syncDirectInputs() {
    document.getElementById("direct-days").value = this.direct.days;
    document.getElementById("direct-hit").value = this.direct.hit;
    document.getElementById("direct-miss").value = this.direct.miss;
    document.getElementById("direct-output").value = this.direct.output;
  }
  readDirectInputs() {
    this.direct = {
      days: Math.max(1, parseFloat(document.getElementById("direct-days").value) || 30),
      hit: parseFloat(document.getElementById("direct-hit").value) || 0,
      miss: parseFloat(document.getElementById("direct-miss").value) || 0,
      output: parseFloat(document.getElementById("direct-output").value) || 0,
    };
  }

  renderLogsTable() {
    const tb = document.getElementById("logs-table-body");
    tb.innerHTML = "";
    this.logs.forEach((log, i) => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-700/30 transition";
      tr.innerHTML = `
        <td class="p-2.5"><input type="text" value="${log.time}" data-i="${i}" data-f="time" class="log-in bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[16px] sm:text-xs text-white focus:outline-none focus:border-blue-500 w-28"></td>
        <td class="p-2.5"><input type="number" value="${log.hit}" data-i="${i}" data-f="hit" class="log-in bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[16px] sm:text-xs text-emerald-400 focus:outline-none focus:border-blue-500 w-full min-w-[110px]"></td>
        <td class="p-2.5"><input type="number" value="${log.miss}" data-i="${i}" data-f="miss" class="log-in bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[16px] sm:text-xs text-blue-400 focus:outline-none focus:border-blue-500 w-full min-w-[110px]"></td>
        <td class="p-2.5"><input type="number" value="${log.output}" data-i="${i}" data-f="output" class="log-in bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[16px] sm:text-xs text-purple-400 focus:outline-none focus:border-blue-500 w-full min-w-[110px]"></td>
        <td class="p-2.5 text-right font-mono font-medium text-amber-300">${(log.hit + log.miss + log.output).toLocaleString()}</td>
        <td class="p-2.5 text-center"><button data-del="${i}" class="text-rose-400 hover:text-rose-300 p-1"><i class="fa-solid fa-trash-can"></i></button></td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll(".log-in").forEach((el) => {
      el.addEventListener("change", (e) => {
        const i = +e.target.dataset.i, f = e.target.dataset.f;
        if (f === "time") this.logs[i].time = e.target.value;
        else this.logs[i][f] = Math.max(0, parseInt(e.target.value) || 0);
        this.renderLogsTable(); this.persist(); this.recalculate();
      });
    });
    tb.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => this.removeLogRow(+b.dataset.del)));
    document.getElementById("logs-count").innerText = this.logs.length;
  }

  addLogRow() {
    const last = this.logs.length ? new Date(this.logs[this.logs.length - 1].time) : new Date();
    if (isNaN(last)) last.setTime(Date.now());
    last.setDate(last.getDate() + 1);
    this.logs.push({ time: last.toISOString().split("T")[0], hit: 30000000, miss: 1000000, output: 500000 });
    this.renderLogsTable(); this.persist(); this.recalculate();
  }
  removeLogRow(i) {
    if (this.logs.length <= 1) { this.showToast(t("toast.needOneDay"), "error"); return; }
    this.logs.splice(i, 1);
    this.renderLogsTable(); this.persist(); this.recalculate();
  }
  async resetAll() {
    clearState();
    this._customCatalog = false;
    try {
      const sample = await (await fetch("data/sample-logs.json")).json();
      if (Array.isArray(sample) && sample.length) this.logs = sample;
    } catch {}
    document.getElementById("cny-rate-input").value = 7.15;
    this.catalog.currency_rates.USD_TO_CNY = 7.15;
    await this.loadCatalogBypassCache();
    this.renderLogsTable(); this.recalculate();
    this.showToast(t("toast.reset"), "success");
  }
  async loadCatalogBypassCache() {
    clearState(); // drop override then reload
    try {
      const man = await (await fetch("data/manifest.json", { cache: "reload" })).json();
      const models = [];
      for (const p of man.providers) models.push(...(await (await fetch(`data/${p.file}`, { cache: "reload" })).json()).models);
      this.catalog = { currency_rates: man.currency_rates, models };
      this.catalogMeta = { last_updated: man.last_updated };
    } catch {}
  }

  recalculate() {
    if (this.mode === "direct") this.readDirectInputs();
    const proj = projectMonthly(this.logs, this.direct, this.mode);
    if (this.mode === "logs") {
      document.getElementById("foot-hit-sum").innerText = (proj.sumHit || 0).toLocaleString();
      document.getElementById("foot-miss-sum").innerText = (proj.sumMiss || 0).toLocaleString();
      document.getElementById("foot-out-sum").innerText = (proj.sumOut || 0).toLocaleString();
      document.getElementById("foot-total-sum").innerText = ((proj.sumHit || 0) + (proj.sumMiss || 0) + (proj.sumOut || 0)).toLocaleString();
    }
    const { m_hit, m_miss, m_output } = proj;
    const { results, m_tokens } = calculateResults(this.catalog.models, m_hit, m_miss, m_output, this.catalog.currency_rates.USD_TO_CNY || 7.15, this.lang);
    document.getElementById("metric-total-tokens").innerText = formatCompact(m_tokens) + " " + t("metric.toks");
    document.getElementById("metric-daily-avg").innerText = "~" + formatCompact(m_tokens / 30) + " " + t("metric.perDay");
    document.getElementById("metric-cache-hit-ratio").innerText = (m_tokens > 0 ? (m_hit / m_tokens) * 100 : 0).toFixed(1) + "%";
    document.getElementById("metric-cache-hit-total").innerText = formatCompact(m_hit) + " " + t("metric.hitsProj");
    this.calculatedResults = results;
    this.populateProviderFilter();
    this.updateTopMetricHighlights();
    this.filterResults();
    this.updateInputSummary();
    this.persist();
  }

  populateProviderFilter() {
    const providers = [...new Set(this.calculatedResults.map((r) => r.provider))].sort((a, b) => a.localeCompare(b));
    ["filter-provider", "m-filter-provider"].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const prev = sel.value || "";
      sel.innerHTML = `<option value="">${t("filter.allProviders")}</option>` + providers.map((p) => `<option value="${p.replace(/"/g, "&quot;")}">${p}</option>`).join("");
      if (providers.includes(prev)) sel.value = prev;
    });
  }

  clearColumnFilters() {
    ["filter-provider", "m-filter-provider"].forEach((id) => { const s = document.getElementById(id); if (s) s.value = ""; });
    ["filter-model", "m-filter-model"].forEach((id) => { const s = document.getElementById(id); if (s) s.value = ""; });
    ["modality-filter", "m-modality-filter"].forEach((id) => { const s = document.getElementById(id); if (s) s.value = "ALL"; });
    ["hide-insufficient", "m-hide-insufficient"].forEach((id) => { const s = document.getElementById(id); if (s) s.checked = false; });
    this.filterResults();
  }

  updateTopMetricHighlights() {
    const payg = this.calculatedResults.filter((r) => r.modality === "pay_as_you_go").sort((a, b) => a.cost - b.cost);
    if (payg.length) {
      document.getElementById("metric-cheapest-payg").innerText = `$${payg[0].cost.toFixed(2)}`;
      document.getElementById("metric-cheapest-payg-name").innerText = payg[0].name;
    }
    const subs = this.calculatedResults.filter((r) => r.modality !== "pay_as_you_go" && !r.is_insufficient).sort((a, b) => a.cost - b.cost);
    if (subs.length) {
      document.getElementById("metric-best-sub").innerText = `$${subs[0].cost.toFixed(2)}`;
      const bn = document.getElementById("metric-best-sub-name");
      bn.innerText = `${subs[0].provider} - ${subs[0].recommended_plan}`;
      bn.title = bn.innerText;
    } else {
      document.getElementById("metric-best-sub").innerText = "N/A";
      document.getElementById("metric-best-sub-name").innerText = t("metric.noQuota");
    }
  }

  // Mobile (<md) uses its own dropdown controls; desktop uses the thead row.
  // Single source of truth per viewport: read the visible set.
  isMobileFilters() { return window.matchMedia("(max-width: 767px)").matches; }

  filterResults() {
    const mob = this.isMobileFilters();
    const mf = (mob ? document.getElementById("m-modality-filter") : document.getElementById("modality-filter")).value;
    const hi = (mob ? document.getElementById("m-hide-insufficient") : document.getElementById("hide-insufficient")).checked;
    const prov = ((mob ? document.getElementById("m-filter-provider") : document.getElementById("filter-provider"))?.value) || "";
    const mod = ((mob ? document.getElementById("m-filter-model") : document.getElementById("filter-model"))?.value || "").toLowerCase();
    const activeCount = (prov ? 1 : 0) + (mod ? 1 : 0) + (mf !== "ALL" ? 1 : 0) + (hi ? 1 : 0);
    const cnt = document.getElementById("mfilter-count");
    if (cnt) cnt.textContent = activeCount ? `(${activeCount})` : "";
    let f = this.calculatedResults.filter((x) =>
      (!prov || x.provider === prov) &&
      (!mod || x.name.toLowerCase().includes(mod)) &&
      (mf === "ALL" || x.modality === mf) && (hi ? (x.pct_used_val === null || x.pct_used_val <= 110) : true));
    f.sort((a, b) => {
      let va = a[this.sortColumn], vb = b[this.sortColumn];
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return this.sortAsc ? -1 : 1;
      if (va > vb) return this.sortAsc ? 1 : -1;
      return 0;
    });
    this.renderResultsTable(f);
    this.renderCards(f);
    this.renderChart(f.filter((x) => !x.is_insufficient));
  }
  sortBy(c) {
    if (this.sortColumn === c) this.sortAsc = !this.sortAsc;
    else { this.sortColumn = c; this.sortAsc = true; }
    this.filterResults();
  }

  badge(mod) {
    const map = {
      pay_as_you_go: [t("modBadge.payg"), "cyan"], credit_subscription: [t("modBadge.credit"), "indigo"],
      hybrid_monetary_subscription: [t("modBadge.hybrid"), "purple"], fixed_quota_subscription: [t("modBadge.fixed"), "amber"],
    };
    const [label, color] = map[mod] || [mod, "slate"];
    return `<span class="px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap bg-${color}-500/10 text-${color}-400 border border-${color}-500/20 font-medium">${label}</span>`;
  }

  esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }

  // Provider chip: deterministic djb2 hash → hue, so colors are stable across
  // reloads, languages and share-links with zero storage. Shape (left-bar box)
  // deliberately differs from modality pills; name text is always kept.
  providerBadge(p) {
    let h = 5381;
    for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
    let hue = h % 360;
    if ([38, 189, 231, 271].some((b) => Math.abs(hue - b) < 12)) hue = (hue + 24) % 360;
    const fg = `hsl(${hue},85%,78%)`, bd = `hsla(${hue},70%,60%,.35)`, bg = `hsla(${hue},70%,60%,.10)`;
    return `<span class="pv-badge" style="color:${fg};border-color:${bd};background:${bg};border-left-color:${fg}">${this.esc(p)}</span>`;
  }

  modelPricingPopover(item) {
    const row = (label, val, cls) => `<div class="flex justify-between items-center ${cls}"><span class="text-slate-400">${label}:</span><span>${val}</span></div>`;
    let title = "", body = "";
    if (item.modality === "pay_as_you_go") {
      const p = item.pricing_info;
      const cur = p.currency === "CNY" ? "¥" : "$";
      title = `${p.currency} · ${t("tip.per1m")}`;
      body = row("Hit", `${cur}${p.cache_hit}`, "text-emerald-400")
        + row("Miss", `${cur}${p.cache_miss}`, "text-blue-400")
        + row("Out", `${cur}${p.output}`, "text-purple-400");
      if (p.daily_free) body += `<div class="border-t border-slate-800 pt-1 text-slate-400">${t("tip.free").replace(" | ", "").replace("{f}", formatCompact(p.daily_free))}</div>`;
    } else if (item.modality === "credit_subscription") {
      const p = item.pricing_info;
      title = `${p.tier.name} — $${p.tier.price_usd}`;
      body = row("Hit", `${p.multipliers.cache_hit}x`, "text-emerald-400")
        + row("Miss", `${p.multipliers.cache_miss}x`, "text-blue-400")
        + row("Out", `${p.multipliers.output}x`, "text-purple-400");
    } else if (item.modality === "hybrid_monetary_subscription") {
      const p = item.pricing_info;
      title = `$${p.subscription_price} · ${t("calc.includes")} $${p.included_dollars}`;
      body = row("Hit", `$${p.pricing_per_1m.cache_hit}`, "text-emerald-400")
        + row("Miss", `$${p.pricing_per_1m.cache_miss}`, "text-blue-400")
        + row("Out", `$${p.pricing_per_1m.output}`, "text-purple-400");
    } else {
      title = `$${item.pricing_info.price_usd}`;
      // NOTE: split/join (not String.replace) — replacement values contain "$",
      // which has special meaning ($$, $&, $1…) in replace() patterns.
      body = `<div class="text-slate-300">${t("tip.fixed").split("{q}").join((item.pricing_info.monthly_token_quota / 1e9).toFixed(1)).split("{p}").join("$" + item.pricing_info.price_usd)}</div>`;
    }
    return `<div class="relative group inline-block cursor-help">
      <span class="hover:text-blue-300 transition underline decoration-slate-600 decoration-dotted underline-offset-4" tabindex="0" role="button" onclick="app.togglePopover(event,this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();app.togglePopover(event,this);}">${item.name}</span>
      <div class="cost-breakdown-popover opacity-0 invisible group-hover:opacity-100 group-hover:visible absolute left-0 top-full mt-1 w-64 p-3 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl text-left z-30 pointer-events-none">
        <p class="text-[11px] font-bold text-white mb-2 border-b border-slate-800 pb-1">${title}</p>
        <div class="space-y-1.5 font-mono text-[11px]">${body}</div>
      </div></div>`;
  }

  renderResultsTable(data) {
    const tb = document.getElementById("results-table-body");
    tb.innerHTML = "";
    if (!data.length) { tb.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500">—</td></tr>`; return; }
    data.forEach((item) => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-700/30 transition border-b border-slate-700/30";
      let usage = item.pct_used_str;
      if (item.pct_used_val !== null) {
        if (item.is_insufficient) usage = `<span class="text-rose-400 font-bold">${item.pct_used_str}</span>`;
        else if (item.is_recommended) usage = `<span class="text-emerald-400 font-semibold">${item.pct_used_str}</span>`;
      }
      let plan = item.recommended_plan;
      if (item.is_recommended) plan = `<span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-medium">${plan}</span>`;
      else if (item.is_insufficient) plan = `<span class="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded font-medium">${plan}</span>`;
      // Promo tag + hover section (🏷️ left of cost when an active promo applies)
      const tag = item.promo ? `<span class="mr-1" aria-hidden="true">🏷️</span>` : "";
      const promoTitle = item.promo ? `<div class="text-amber-300">🏷️ ${item.promo.label}</div>` : "";
      const promoRows = item.promo ? `<div class="flex justify-between text-slate-400"><span>${t("promo.base")}:</span><span>$${item.promo.base_cost.toFixed(2)}</span></div>${item.promo.ends_at ? `<div class="flex justify-between text-slate-400"><span>${t("promo.ends")}:</span><span>${item.promo.ends_at}</span></div>` : ""}` : "";
      const promoBlock = item.promo ? `<div class="border-t border-slate-800 pt-1.5 mt-1.5 space-y-1 font-mono text-[11px]">${promoTitle}${promoRows}</div>` : "";
      let costCell;
      if (item.breakdown) {
        const b = item.breakdown;
        const isHybrid = item.pricing_info.subscription_price !== undefined;
        const usageSum = b.cache_hit + b.cache_miss + b.output;
        const over = isHybrid ? Math.max(0, usageSum - item.pricing_info.included_dollars) : 0;
        // PAYG: cost == usage, so the total is the usage sum. Hybrid: monthly cost is the
        // flat subscription; usage/included/overage are informational (overage never billed into cost).
        const totalBlock = isHybrid
          ? `<div class="border-t border-slate-800 pt-1.5 mt-1.5 space-y-1.5">
              <div class="flex justify-between text-slate-200"><span class="text-slate-400">${t("cost.usage")}:</span><span>$${usageSum.toFixed(2)}</span></div>
              <div class="flex justify-between text-slate-200"><span class="text-slate-400">${t("cost.included")}:</span><span>$${item.pricing_info.included_dollars.toFixed(2)}</span></div>
              ${over > 0 ? `<div class="flex justify-between text-amber-300"><span class="text-slate-400">${t("cost.over")}:</span><span>+$${over.toFixed(2)}</span></div>` : ""}
            </div>
            <div class="border-t border-slate-800 pt-1 text-right text-xs font-bold text-emerald-400">${t("cost.monthly")}: $${item.cost.toFixed(2)}</div>`
          : `<div class="border-t border-slate-800 pt-1 text-right text-xs font-bold text-emerald-400">${t("breakdown.total")}: $${item.cost.toFixed(2)}</div>`;
        costCell = `<div class="relative group inline-block text-right cursor-pointer">
          <span class="font-mono text-sm font-bold text-emerald-400 border-b border-dashed border-emerald-500/50" tabindex="0" role="button" onclick="app.togglePopover(event,this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();app.togglePopover(event,this);}">${tag}$${item.cost.toFixed(2)}</span>
          <div class="cost-breakdown-popover opacity-0 invisible group-hover:opacity-100 group-hover:visible absolute right-0 bottom-full mb-2 w-56 p-3 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl text-left z-30 pointer-events-none">
            <p class="text-[11px] font-bold text-white mb-2 border-b border-slate-800 pb-1">${t("breakdown.title")}</p>
            <div class="space-y-1.5 font-mono text-[11px]">
              <div class="flex justify-between text-emerald-400"><span class="text-slate-400">Hit:</span><span>$${b.cache_hit.toFixed(2)}</span></div>
              <div class="flex justify-between text-blue-400"><span class="text-slate-400">Miss:</span><span>$${b.cache_miss.toFixed(2)}</span></div>
              <div class="flex justify-between text-purple-400"><span class="text-slate-400">Out:</span><span>$${b.output.toFixed(2)}</span></div>
              ${totalBlock}
              ${promoBlock}
            </div></div></div>`;
      } else if (item.promo) {
        costCell = `<div class="relative group inline-block text-right cursor-pointer">
          <span class="font-mono text-sm font-bold text-emerald-400 border-b border-dashed border-emerald-500/50" tabindex="0" role="button" onclick="app.togglePopover(event,this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();app.togglePopover(event,this);}">${tag}$${item.cost.toFixed(2)}</span>
          <div class="cost-breakdown-popover opacity-0 invisible group-hover:opacity-100 group-hover:visible absolute right-0 bottom-full mb-2 w-56 p-3 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl text-left z-30 pointer-events-none">
            <div class="text-[11px] font-bold text-white mb-2 border-b border-slate-800 pb-1">${item.promo.label}</div>
            <div class="space-y-1.5 font-mono text-[11px]">${promoRows}</div>
          </div></div>`;
      } else costCell = `<span class="font-mono text-sm font-bold text-emerald-400">$${item.cost.toFixed(2)}</span>`;
      const metaHtml = item.meta_str ? `<div class="text-slate-300">${item.meta_str}</div>` : "";
      const noteHtml = item.notes ? `<div class="text-slate-500">${item.notes}</div>` : "";
      const notesCell = (metaHtml || noteHtml) ? metaHtml + noteHtml : "—";
      tr.innerHTML = `<td class="p-3">${this.providerBadge(item.provider)}</td>
        <td class="p-3 font-semibold text-white">${this.modelPricingPopover(item)}</td>
        <td class="p-3">${this.badge(item.modality)}</td>
        <td class="p-3 text-right">${costCell}</td>
        <td class="p-3 text-center font-mono">${usage}</td>
        <td class="p-3">${plan}</td>
        <td class="p-3 font-mono text-[11px]">${item.consumption_str}</td>
        <td class="p-3 text-[11px]">${notesCell}</td>`;
      tb.appendChild(tr);
    });
  }

  // Mobile card list (OpenRouter-style): same data as the table, no horizontal scroll.
  // Visible only below md: (container has md:hidden). Details expand via native <details>.
  renderCards(data) {
    const box = document.getElementById("results-cards");
    if (!box) return;
    box.innerHTML = "";
    if (!data.length) {
      box.innerHTML = `<p class="p-6 text-center text-slate-500 text-xs">—</p>`;
      return;
    }
    data.forEach((item) => {
      const tag = item.promo ? "🏷️ " : "";
      // PAYG rows carry "—" placeholders — omit those segments entirely on cards.
      const hasUsage = item.pct_used_val !== null && item.pct_used_str !== "—";
      const hasPlan = item.recommended_plan && item.recommended_plan !== "—";
      const hasCons = item.consumption_str && item.consumption_str !== "—";
      let usageCls = "text-slate-400";
      if (hasUsage) {
        if (item.is_insufficient) usageCls = "text-rose-400 font-bold";
        else if (item.is_recommended) usageCls = "text-emerald-400 font-semibold";
      }
      let planCls = "text-slate-300";
      if (item.is_recommended) planCls = "text-emerald-400 font-semibold";
      else if (item.is_insufficient) planCls = "text-rose-400 font-semibold";
      let detail = "";
      if (hasPlan) detail += `<div class="flex justify-between"><span class="text-slate-500">${t("table.plan")}</span><span class="${planCls} text-right">${item.recommended_plan}</span></div>`;
      if (hasCons) detail += `<div class="flex justify-between"><span class="text-slate-500">${t("table.consumption")}</span><span class="font-mono text-right">${item.consumption_str}</span></div>`;
      if (item.breakdown) {
        const b = item.breakdown;
        detail += `<div class="flex justify-between"><span class="text-slate-500">Hit / Miss / Out</span><span class="font-mono text-right">$${b.cache_hit.toFixed(2)} / $${b.cache_miss.toFixed(2)} / $${b.output.toFixed(2)}</span></div>`;
      }
      if (item.promo) {
        detail += `<div class="flex justify-between"><span class="text-slate-500">🏷️ ${item.promo.label}</span><span class="font-mono text-right text-slate-400">${t("promo.base")}: $${item.promo.base_cost.toFixed(2)}${item.promo.ends_at ? ` · ${t("promo.ends")}: ${item.promo.ends_at}` : ""}</span></div>`;
      }
      const metaNote = [item.meta_str, item.notes].filter(Boolean).join(" · ");
      if (metaNote) detail += `<div class="text-slate-500">${metaNote}</div>`;
      const card = document.createElement("div");
      card.className = "bg-slate-900/60 border border-slate-700/60 rounded-xl p-3" + (item.is_insufficient ? " opacity-80" : "");
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="font-semibold text-white text-sm leading-snug">${item.name}</p>
            <p class="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">${this.providerBadge(item.provider)}${hasUsage ? `<span class="${usageCls} font-mono">${item.pct_used_str}</span>` : ""}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="font-mono font-bold text-emerald-400">${tag}$${item.cost.toFixed(2)}</p>
            <p class="mt-1">${this.badge(item.modality)}</p>
          </div>
        </div>
        <details class="mt-2">
          <summary class="text-[11px] text-blue-400 cursor-pointer py-2 -my-1 min-h-[44px] inline-flex items-center">${t("results.details")}</summary>
          <div class="pt-1 space-y-1 text-[11px]">${detail}</div>
        </details>`;
      box.appendChild(card);
    });
  }

  initChart() {
    const ctx = document.getElementById("costChart").getContext("2d");
    this.chart = new Chart(ctx, {
      type: "bar",
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` $${c.parsed.y.toFixed(2)} USD` } } },
        scales: {
          x: { ticks: { color: "#94a3b8", font: { size: 10 }, maxRotation: 90, minRotation: 45, autoSkip: true, maxTicksLimit: 8 }, grid: { color: "#1e293b" } },
          y: { ticks: { color: "#94a3b8", callback: (v) => "$" + v }, grid: { color: "#334155" } },
        },
      },
    });
  }
  renderChart(data) {
    if (!this.chart) return;
    // Group hybrid rows sharing provider + subscription price: identical flat fees
    // would otherwise render as a wall of duplicate $10 bars. One bar per plan.
    // (Rows are already filtered to sufficient plans by the caller.)
    const groups = new Map();
    for (const d of data) {
      const key = d.modality === "hybrid_monetary_subscription"
        ? `hybrid|${d.provider}|${d.pricing_info.subscription_price}`
        : `single|${d.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    const bars = [...groups.values()].map((rows) => {
      const first = [...rows].sort((a, b) => a.cost - b.cost)[0];
      const label = rows.length > 1
        ? `${first.provider} $${first.pricing_info.subscription_price} ×${rows.length}`
        : first.name;
      return { rows, first, cost: first.cost, label, grouped: rows.length > 1 };
    }).sort((a, b) => a.cost - b.cost).slice(0, 15);
    const short = window.innerWidth < 640;
    const cut = short ? 12 : 22;
    this.chart.data.labels = bars.map((b) => (b.label.length > cut ? b.label.slice(0, cut) + "…" : b.label));
    this.chart.data.datasets[0].data = bars.map((b) => b.cost);
    this.chart.data.datasets[0].backgroundColor = bars.map((b) => {
      const d = b.first;
      if (d.is_insufficient) return "rgba(244,63,94,.7)";
      if (d.modality === "pay_as_you_go") return "rgba(6,182,212,.7)";
      if (d.modality === "credit_subscription") return "rgba(99,102,241,.7)";
      if (d.modality === "hybrid_monetary_subscription") return "rgba(168,85,247,.7)";
      return "rgba(245,158,11,.7)";
    });
    this.chart.options.plugins.tooltip.callbacks.afterBody = (items) => {
      const b = bars[items[0]?.dataIndex];
      if (!b || !b.grouped) return [];
      return b.rows.slice(0, 6).map((r) => `• ${r.name} ($${r.pricing_info.included_dollars})`);
    };
    this.chart.update();
  }

  // modals / import / export / share
  openCatalogModal() {
    document.getElementById("catalog-json-input").value = JSON.stringify(this.catalog, null, 2);
    document.getElementById("catalog-modal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  closeCatalogModal() { document.getElementById("catalog-modal").classList.add("hidden"); document.body.style.overflow = ""; }
  saveCatalogModal() {
    try {
      const p = JSON.parse(document.getElementById("catalog-json-input").value);
      if (!p.models || !Array.isArray(p.models)) throw new Error("needs models[]");
      this.catalog = p; this._customCatalog = true;
      if (p.currency_rates?.USD_TO_CNY) document.getElementById("cny-rate-input").value = p.currency_rates.USD_TO_CNY;
      this.closeCatalogModal(); this.recalculate();
      this.showToast(t("toast.saved"), "success");
    } catch (e) { this.showToast(e.message, "error"); }
  }
  openImportLogsModal() {
    document.getElementById("import-json-text").value = "";
    this.updateImportPromptText();
    document.getElementById("import-logs-modal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  closeImportLogsModal() { document.getElementById("import-logs-modal").classList.add("hidden"); document.body.style.overflow = ""; }
  updateImportPromptText() {
    const pre = document.getElementById("import-prompt-text");
    if (pre) pre.textContent = t("prompt.importLogs");
  }
  async copyImportPrompt() {
    try { await navigator.clipboard.writeText(t("prompt.importLogs")); this.showToast(t("toast.copied"), "success"); }
    catch {
      // clipboard API unavailable (permissions/insecure context): select text for manual copy
      const pre = document.getElementById("import-prompt-text");
      if (pre) {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    }
  }
  openOpenRouterModal() {
    document.getElementById("or-status").textContent = "";
    this.updateOrLabsHint();
    document.getElementById("openrouter-modal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  updateOrLabsHint() {
    const big = document.getElementById("or-tip-biglabs");
    if (big) big.textContent = `${t("or.biglabsList")}: ${[...BIG_LABS].join(", ")}`;
    const small = document.getElementById("or-tip-dropsmall");
    if (small) small.textContent = `${t("or.dropsmallList")}: ${SMALL_PATTERNS.join(", ")}`;
  }
  closeOpenRouterModal() { document.getElementById("openrouter-modal").classList.add("hidden"); document.body.style.overflow = ""; }
  readOpenRouterOpts() {
    return {
      url: DEFAULT_OPENROUTER_URL,
      minContext: (parseFloat(document.getElementById("or-min-context").value) || 0) * 1000,
      minParamsB: parseFloat(document.getElementById("or-min-params").value) || 0,
      minOutputPrice: parseFloat(document.getElementById("or-min-output").value) || 0,
      authorContains: document.getElementById("or-author").value || "",
      requireReasoning: document.getElementById("or-reasoning").checked,
      bigLabsOnly: document.getElementById("or-biglabs").checked,
      dropSmallByName: document.getElementById("or-dropsmall").checked,
      replace: document.getElementById("or-replace").checked,
    };
  }
  applyOpenRouterModels(models, replace) {
    const before = this.catalog.models.length;
    let base = this.catalog.models;
    let removed = 0;
    if (replace) {
      removed = base.filter((m) => (m.id || "").startsWith("openrouter-")).length;
      base = base.filter((m) => !(m.id || "").startsWith("openrouter-"));
    }
    // avoid id collisions when appending
    const ids = new Set(base.map((m) => m.id));
    const fresh = models.filter((m) => !ids.has(m.id));
    this.catalog.models = [...base, ...fresh];
    this._customCatalog = true;
    this.closeOpenRouterModal();
    this.recalculate();
    this.updateFooterMeta();
    this.showToast(t("or.applied").replace("{n}", fresh.length).replace("{r}", removed), "success");
  }
  async fetchOpenRouter() {
    const o = this.readOpenRouterOpts();
    const status = (msg) => (document.getElementById("or-status").textContent = msg);
    try {
      const pasted = document.getElementById("or-paste").value.trim();
      let raw;
      if (pasted) {
        raw = JSON.parse(pasted);
        status(t("or.fromPaste"));
      } else {
        status(t("or.fetching"));
        const resp = await fetch(o.url, { headers: { Accept: "application/json" } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        raw = await resp.json();
      }
      const live = openrouterToCatalog(raw, {
        minContext: o.minContext, minParamsB: o.minParamsB, minOutputPrice: o.minOutputPrice,
        requireReasoning: o.requireReasoning, bigLabsOnly: o.bigLabsOnly,
        dropSmallByName: o.dropSmallByName, authorContains: o.authorContains,
      });
      if (!live.models.length) { status(t("or.empty")); return; }
      status(t("or.found").replace("{n}", live.models.length));
      this.applyOpenRouterModels(live.models, o.replace);
    } catch (e) {
      console.warn("openrouter fetch failed", e);
      status(t("or.error").replace("{e}", e.message));
      this.showToast(t("or.error").replace("{e}", e.message), "error");
    }
  }
  handleLogsFileUpload(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => (document.getElementById("import-json-text").value = ev.target.result);
    r.readAsText(f);
  }
  importLogsFromJSON() {
    const txt = document.getElementById("import-json-text").value.trim();
    if (!txt) { this.showToast(t("toast.emptyJson"), "error"); return; }
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) {
        this.logs = parsed.map((x, i) => ({
          time: x.time || x.date || x.fecha || `${t("calc.day")} ${i + 1}`,
          hit: parseInt(x.hit ?? x.cache_hit ?? x.cacheHit ?? 0) || 0,
          miss: parseInt(x.miss ?? x.cache_miss ?? x.cacheMiss ?? x.input ?? 0) || 0,
          output: parseInt(x.output ?? x.generation ?? x.completion ?? 0) || 0,
        }));
        this.setMode("logs", true); this.renderLogsTable(); this.recalculate();
        this.closeImportLogsModal(); this.showToast(t("toast.imported"), "success");
      } else {
        this.direct = {
          hit: parseInt(parsed.hit ?? 0) || 0, miss: parseInt(parsed.miss ?? parsed.input ?? 0) || 0,
          output: parseInt(parsed.output ?? 0) || 0, days: parseInt(parsed.days ?? parsed.dias ?? 30) || 30,
        };
        this.syncDirectInputs(); this.setMode("direct", true); this.recalculate();
        this.closeImportLogsModal(); this.showToast(t("toast.imported"), "success");
      }
    } catch (e) { this.showToast(e.message, "error"); }
  }
  exportCSV() {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    let csv = t("calc.csvHeader") + "\n";
    const modLabel = (m) => m === "pay_as_you_go" ? "Pay-As-You-Go" : m === "credit_subscription" ? t("modality.credit") : m === "fixed_quota_subscription" ? t("modality.fixed") : m === "hybrid_monetary_subscription" ? t("modality.hybrid") : m;
    this.calculatedResults.forEach((r) => {
      const nz = [r.meta_str, r.notes].filter(Boolean).join(" · ");
      csv += [r.provider, r.name, modLabel(r.modality), r.cost, r.pct_used_str, r.recommended_plan, r.consumption_str, nz].map(esc).join(",") + "\n";
    });
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "costes_llm_30d.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async shareLink() {
    this.readDirectInputsIfNeeded();
    const url = buildShareUrl({ mode: this.mode, lang: this.lang, logs: this.logs, direct: this.direct, cnyRate: this.catalog.currency_rates.USD_TO_CNY });
    try { await navigator.clipboard.writeText(url); this.showToast(t("toast.copied"), "success"); }
    catch { prompt("URL:", url); }
  }
  readDirectInputsIfNeeded() { if (this.mode === "direct") this.readDirectInputs(); }
  updateFooterMeta() {
    const el = document.getElementById("catalog-meta");
    if (el && this.catalogMeta.last_updated) el.textContent = " · " + t("footer.catalog").replace("{date}", this.catalogMeta.last_updated).replace("{count}", this.catalog.models.length);
    const badge = document.getElementById("app-version-badge");
    if (badge) badge.textContent = t("header.badge").replace("{v}", VERSION).replace("{date}", this.catalogMeta.last_updated || "—");
  }
  // Touch/keyboard equivalent of group-hover popovers + modal dismiss helpers.
  // Call once from init().
  initGlobalDismiss() {
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".group")) this.closeAllPopovers();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeAllPopovers();
        this.closeCatalogModal();
        this.closeImportLogsModal();
        this.closeOpenRouterModal();
      }
    });
    ["catalog-modal", "import-logs-modal", "openrouter-modal"].forEach((id) => {
      const m = document.getElementById(id);
      if (m) m.addEventListener("click", (e) => {
        if (e.target === m) {
          if (id === "catalog-modal") this.closeCatalogModal();
          else if (id === "import-logs-modal") this.closeImportLogsModal();
          else this.closeOpenRouterModal();
        }
      });
    });
  }

  togglePopover(e, el) {
    e.stopPropagation();
    const box = el.closest(".group")?.querySelector(".cost-breakdown-popover");
    if (!box) return;
    const wasOpen = box.classList.contains("pop-open");
    this.closeAllPopovers();
    if (!wasOpen) box.classList.add("pop-open");
  }

  closeAllPopovers() {
    document.querySelectorAll(".cost-breakdown-popover.pop-open").forEach((p) => p.classList.remove("pop-open"));
  }

  showToast(msg, type = "info") {
    const box = document.getElementById("toast");
    document.getElementById("toast-msg").innerText = msg;
    document.getElementById("toast-icon").className = type === "error"
      ? "fa-solid fa-circle-exclamation text-rose-400"
      : type === "success" ? "fa-solid fa-circle-check text-emerald-400" : "fa-solid fa-circle-info text-blue-400";
    box.classList.remove("opacity-0", "pointer-events-none");
    setTimeout(() => box.classList.add("opacity-0", "pointer-events-none"), 3000);
  }
}

const app = new App();
window.app = app;
window.addEventListener("DOMContentLoaded", () => app.init());
export default app;
