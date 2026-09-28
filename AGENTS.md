# AGENTS.md — instructions for AI coding agents working on this repo

Repository: `ai_cost_calculator` · live at https://gargomoma.github.io/ai_cost_calculator

Static vanilla-JS site (no build step) deployed to GitHub Pages. Please respect the
conventions below; they keep the calculator's math correct.

## Quick orientation

| Path | What it is |
|---|---|
| `index.html` | App shell (Tailwind CDN + Chart.js + FontAwesome CDNs, ES modules) |
| `js/calc.js` | **Pure pricing engine** — no DOM. Unit-test any math change via `node` |
| `js/app.js` | UI + state (imports `calc.js`, `store.js`, `i18n.js`, `openrouter.js`) |
| `js/store.js` | localStorage (`llmcalc.v1`) + share-URL params |
| `js/i18n.js`, `locales/{es,en}.json` | Bilingual strings; ES and EN must keep identical key sets |
| `data/manifest.json` | Provider index (`providers[]` with `slug`, `file`, `count`) + `currency_rates` |
| `data/providers/<slug>.json` | One file per provider (validated by `scripts/validate.mjs`) |
| `data/providers/schema.json` | JSON Schema for provider files |
| `prompts/add-provider.md` | Copy-paste prompt to generate a provider file from a pricing page |
| `prompts/update-prices.md` | Copy-paste prompt to refresh stale prices |
| `prompts/import-logs.md` | Copy-paste prompt(s) to convert raw usage data into the Import JSON format |

Serve locally with `python -m http.server 8000` (`file://` breaks `fetch()`).
Validate data with `node scripts/validate.mjs`. Syntax-check JS with `node --check js/<file>.js`.

## Adding or updating a provider (most common task)

1. Read `prompts/add-provider.md` — it documents all 4 model types with examples and
   the unit-normalization rules. Follow it, don't improvise new fields.
2. Key rules:
   - Prices are ALWAYS **per 1M tokens** (`pricing_per_1m`). Per-1K → ×1000, per-1B → ÷1000.
   - `cache_miss` = normal input price. No cache discount → `cache_hit` = `cache_miss` (never 0).
   - `id`: kebab-case, globally unique, prefixed with slug. `provider` in each model must
     equal the file's top-level `provider` exactly.
   - **Big labs are always vendor-priced from the lab's own endpoint — NEVER OpenRouter.**
     OpenAI, Anthropic, Google, Meta, Qwen, Mistral, xAI, Moonshot, Cohere, Amazon,
     Microsoft, DeepSeek, MiniMax, Z.AI, etc. each keep the lab as `provider` and their
     own pricing page as `source_url`. Vendor-priced files keep the vendor as provider.
   - OpenRouter is only for models with no first-party endpoint. OpenRouter rows live in
     the live importer (`js/openrouter.js`, the "OpenRouter Live" modal) rather than as
     committed vendor duplicates. Those rows use `provider: "OpenRouter"` (never the lab
     name); the serving endpoint goes in `note` as `OpenRouter · <slug> via <Provider>`,
     plus `or_slug` for refreshes.
   - If a big lab publishes no per-token pricing (e.g. NVIDIA: per-GPU/AI-Enterprise
     licensing only), omit it rather than pulling its OpenRouter prices.
   - Peak/off-peak splits → separate entries with `-peak` / `-offpeak` suffixes.
   - Promos go in an optional `promo` key (`discount_pct` 0–100, or explicit
     `pricing_per_1m` for payg/hybrid; optional `ends_at` YYYY-MM-DD auto-expires,
     optional `label`). Never bake promo prices silently into `pricing_per_1m` —
     keep base prices + `promo` so the app can show 🏷️ and the non-promo base cost.
   - Set `last_updated` to today (YYYY-MM-DD) and keep `source_url` pointing at the pricing page.
3. Register new files in `data/manifest.json` (`slug`, `file: "providers/<slug>.json"`, `count` = models array length).
4. Run `node scripts/validate.mjs` and fix everything it reports.

## Code conventions

- `js/calc.js` stays DOM-free and bilingual-neutral: user-facing strings there go through
  the `STR = { es, en }` table and `calculateResults(..., lang)` — never hardcode Spanish/English.
- User-facing strings in UI code must use `t("key")` + new keys in BOTH locale files.
- Static HTML text uses `data-i18n="key"` (text), `data-i18n-ph` (placeholder), `data-i18n-title` (title).
- Modals: `hidden` class + inline `display` style are synced by the MutationObserver snippet at
  the bottom of `index.html` — when adding a modal, register it in that `fix(...)` list.
- Element IDs are referenced from `js/app.js` — renaming an ID requires updating both files.
- `localStorage` schema lives in `js/store.js` — bump `LS_KEY` if you change its shape.
- Prefer editing existing files over creating new ones. Don't add frameworks, bundlers, or
  npm dependencies; this project is intentionally dependency-free.
