const LS_KEY = "llmcalc.v1";

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function saveState(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
}

export function clearState() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}

// ---- Share links (URL params) ----
function b64urlEncode(obj) {
  const s = JSON.stringify(obj);
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  try {
    let b = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return JSON.parse(decodeURIComponent(escape(atob(b))));
  } catch { return null; }
}

export function stateToParams(state) {
  const p = new URLSearchParams();
  p.set("mode", state.mode || "logs");
  p.set("lang", state.lang || "es");
  if (state.cnyRate) p.set("cny", String(state.cnyRate));
  if (state.mode === "direct") {
    p.set("days", String(state.direct.days));
    p.set("hit", String(state.direct.hit));
    p.set("miss", String(state.direct.miss));
    p.set("out", String(state.direct.output));
  } else {
    if (state.logs && state.logs.length === 1) {
      p.set("hit", String(state.logs[0].hit));
      p.set("miss", String(state.logs[0].miss));
      p.set("out", String(state.logs[0].output));
    } else if (state.logs) {
      p.set("logs", b64urlEncode(state.logs));
    }
  }
  return p;
}

export function paramsToState(params) {
  const mode = params.get("mode") === "direct" ? "direct" : "logs";
  const lang = params.get("lang") === "en" ? "en" : "es";
  const cnyRate = parseFloat(params.get("cny")) || null;
  if (mode === "direct") {
    return {
      mode, lang, cnyRate,
      direct: {
        days: parseInt(params.get("days")) || 30,
        hit: parseInt(params.get("hit")) || 0,
        miss: parseInt(params.get("miss")) || 0,
        output: parseInt(params.get("out")) || 0,
      },
    };
  }
  const logsParam = params.get("logs");
  if (logsParam) {
    const logs = b64urlDecode(logsParam);
    if (Array.isArray(logs) && logs.length) return { mode, lang, cnyRate, logs };
  }
  if (params.has("hit") || params.has("miss") || params.has("out")) {
    return {
      mode, lang, cnyRate,
      logs: [{ time: new Date().toISOString().slice(0, 10), hit: parseInt(params.get("hit")) || 0, miss: parseInt(params.get("miss")) || 0, output: parseInt(params.get("out")) || 0 }],
    };
  }
  return null;
}

export function buildShareUrl(state) {
  const url = new URL(window.location.href.split("#")[0]);
  const p = stateToParams(state);
  url.search = p.toString();
  return url.toString();
}
