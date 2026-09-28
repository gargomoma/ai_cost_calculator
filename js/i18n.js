let dict = {};
let lang = "es";

export async function loadLocale(nextLang) {
  lang = nextLang === "en" ? "en" : "es";
  try {
    const res = await fetch(`locales/${lang}.json`, { cache: "no-store" });
    if (res.ok) dict = await res.json();
  } catch {}
  applyI18n();
  document.documentElement.lang = lang;
  return lang;
}

export function getLang() { return lang; }

export function t(key) { return dict[key] || key; }

export function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.getAttribute("data-i18n");
    if (dict[k]) el.textContent = dict[k];
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    const k = el.getAttribute("data-i18n-ph");
    if (dict[k]) el.placeholder = dict[k];
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const k = el.getAttribute("data-i18n-title");
    if (dict[k]) el.title = dict[k];
  });
}
