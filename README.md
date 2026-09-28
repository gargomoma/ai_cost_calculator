# AI Cost Calculator — Collaborative Sourcing Cost Comparator

A collaborative, dependency-free tool for comparing AI/LLM sourcing costs. Enter token
usage once (historical daily logs, or a direct monthly total) and compare projected
monthly costs across pay-as-you-go rates, credit subscriptions, fixed quotas and hybrid
plans. Vendor pricing is community-maintained in `data/providers/*.json`.

- **Live:** https://gargomoma.github.io/ai_cost_calculator (GitHub Pages)
- **Source:** https://github.com/gargomoma/ai_cost_calculator

Vanilla modular app (no build step). Serve locally (fetch requires http — `file://` won't work):

```powershell
python -m http.server 8000
# http://localhost:8000/
```

## Structure
- `index.html` → shell
- `css/styles.css`, `js/{app,calc,store,i18n,openrouter}.js`
- `locales/{es,en}.json`
- `data/manifest.json` + `data/providers/*.json` (one file per provider) + `data/sample-logs.json`

## Add / update a provider
1. Edit `data/providers/<slug>.json` (`last_updated`, `models[]`).
2. If new provider, add entry to `data/manifest.json → providers[]`.
3. Model schema (4 types): `pay_as_you_go` (`pricing_per_1m`, `currency`, `daily_free_tokens?`), `credit_subscription` (`credit_multipliers`, `credit_formula_divisor?`, `tiers[]`), `fixed_quota_subscription` (`price_usd`, `monthly_token_quota`), `hybrid_monetary_subscription` (`subscription_price_usd`, `included_dollars`, `pricing_per_1m`).
4. Validate: `node scripts/validate.mjs` (checks schema rules, id uniqueness, manifest counts).

## Generating provider files with an LLM
- `prompts/add-provider.md` — copy-paste prompt: attach a pricing page, get back a ready-to-save provider JSON (covers all 4 model types + unit-normalization rules).
- `prompts/update-prices.md` — copy-paste prompt to refresh stale prices in an existing file.
- `prompts/import-logs.md` — copy-paste prompt to convert raw usage data (CSV, exports, screenshots) into the Import JSON format. Also embedded in the app's Import window under a dropdown, with a copy button (bilingual).
- `AGENTS.md` — repo instructions for AI coding agents (conventions, validation, i18n rules).

## Contributing
Provider data is community-maintained. To add or refresh a vendor, follow
`prompts/add-provider.md` (new) or `prompts/update-prices.md` (refresh), register new files
in `data/manifest.json`, run `node scripts/validate.mjs`, and open a pull request against
`main`. `main` deploys automatically.

## Deploy
Pushing to `main` triggers Actions → Pages (`.github/workflows/pages.yml`). Settings →
Pages → Source: GitHub Actions. Published at **https://gargomoma.github.io/ai_cost_calculator**.

## Share links
`?mode=logs&hit=..&miss=..&out=..&cny=7.15&lang=es` or `?mode=direct&days=30&hit=..&miss=..&out=..` or `?logs=<base64url>`. State also persists in `localStorage (llmcalc.v1)`.
