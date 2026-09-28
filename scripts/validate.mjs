#!/usr/bin/env node
// Validates data/manifest.json + data/providers/*.json (no dependencies).
// Usage: node scripts/validate.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const provDir = join(dataDir, "providers");
let errors = [];
const err = (m) => errors.push(m);

const manifest = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
try { JSON.parse(readFileSync(join(provDir, "schema.json"), "utf8")); }
catch (e) { err(`schema.json: invalid JSON (${e.message})`); }
const files = readdirSync(provDir).filter((f) => f.endsWith(".json") && f !== "schema.json");
const manifestFiles = new Set(manifest.providers.map((p) => p.file));

for (const f of files) {
  const doc = JSON.parse(readFileSync(join(provDir, f), "utf8"));
  const slug = f.replace(/\.json$/, "");
  if (doc.slug !== slug) err(`${f}: slug '${doc.slug}' != filename '${slug}'`);
  if (!doc.provider) err(`${f}: missing top-level provider`);
  if (!doc.source_url) err(`${f}: missing source_url`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.last_updated || "")) err(`${f}: bad last_updated`);
  if (!Array.isArray(doc.models) || !doc.models.length) err(`${f}: empty models[]`);
  const ids = new Set();
  for (const m of doc.models) {
    if (ids.has(m.id)) err(`${f}: duplicate id '${m.id}'`);
    ids.add(m.id);
    if (!/^[a-z0-9][a-z0-9.\-]*$/.test(m.id)) err(`${f}: id '${m.id}' must be kebab-case`);
    if (!m.provider) err(`${f}: model '${m.id}' missing provider`);
    // Convention: id must be slug-prefixed; model provider == file provider.
    if (!m.id.startsWith(`${slug}-`)) err(`${f}: id '${m.id}' must start with '${slug}-'`);
    if (m.provider !== doc.provider) err(`${f}: model '${m.id}' provider '${m.provider}' != file provider`);
    const req = { pay_as_you_go: ["currency", "pricing_per_1m"], credit_subscription: ["credit_multipliers", "tiers"], fixed_quota_subscription: ["price_usd", "monthly_token_quota"], hybrid_monetary_subscription: ["subscription_price_usd", "included_dollars", "pricing_per_1m"] }[m.type];
    if (!req) err(`${f}: model '${m.id}' unknown type '${m.type}'`);
    else for (const k of req) if (m[k] === undefined) err(`${f}: model '${m.id}' missing '${k}'`);
    if (m.type === "pay_as_you_go" && m.pricing_per_1m && m.pricing_per_1m.cache_hit === 0 && m.pricing_per_1m.cache_miss > 0)
      err(`${f}: model '${m.id}' cache_hit=0 with cache_miss>0 (no-discount vendors must set cache_hit=cache_miss)`);
    if (m.model_type !== undefined && !["chat", "reasoning", "vision", "multimodal", "audio", "image-gen"].includes(m.model_type))
      err(`${f}: model '${m.id}' bad model_type '${m.model_type}'`);
    if (m.context_length !== undefined && (!Number.isInteger(m.context_length) || m.context_length < 0))
      err(`${f}: model '${m.id}' bad context_length`);
    if (m.params_b !== undefined && m.params_b !== null && (typeof m.params_b !== "number" || m.params_b < 0))
      err(`${f}: model '${m.id}' bad params_b`);
    if (m.promo !== undefined) {
      const pr = m.promo;
      const pct = typeof pr.discount_pct === "number" && pr.discount_pct > 0 && pr.discount_pct < 100;
      const price = pr.pricing_per_1m && typeof pr.pricing_per_1m.cache_miss === "number";
      if (!pct && !price) err(`${f}: model '${m.id}' promo needs discount_pct (0-100) or pricing_per_1m`);
      if (price && !["pay_as_you_go", "hybrid_monetary_subscription"].includes(m.type))
        err(`${f}: model '${m.id}' promo pricing_per_1m only applies to pay_as_you_go/hybrid`);
      if (pr.ends_at && !/^\d{4}-\d{2}-\d{2}$/.test(pr.ends_at)) err(`${f}: model '${m.id}' bad promo ends_at`);
    }
  }
  const entry = manifest.providers.find((p) => p.file === `providers/${f}`);
  if (!entry) err(`manifest: missing entry for providers/${f}`);
  else if (entry.count !== doc.models.length) err(`manifest: count ${entry.count} != actual ${doc.models.length} for ${f}`);
  else if (entry.slug !== doc.slug) err(`manifest: slug mismatch for ${f}`);
}

// global id uniqueness + manifest orphans
const allIds = new Map();
for (const f of files) {
  const doc = JSON.parse(readFileSync(join(provDir, f), "utf8"));
  for (const m of doc.models) {
    if (allIds.has(m.id)) err(`duplicate global id '${m.id}' in ${f} and ${allIds.get(m.id)}`);
    else allIds.set(m.id, f);
  }
}
for (const p of manifest.providers) {
  try { readFileSync(join(dataDir, p.file), "utf8"); }
  catch { err(`manifest: file not found: ${p.file}`); }
}

if (errors.length) { console.error(`FAIL: ${errors.length} problem(s):\n- ` + errors.join("\n- ")); process.exit(1); }
console.log(`OK: ${files.length} providers, ${allIds.size} models, manifest consistent.`);
