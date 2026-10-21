// Offline visual evidence of the real guidance component; no Supabase client.
// npm ci; npm install --prefix /tmp/kamo-reset-browser playwright
// node scripts/preview-reset-guidance.mjs
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "/tmp/kamo-reset-browser/node_modules/playwright/index.mjs"));
const output = path.join(root, "docs/evidence/2026-10-21-reset-safe-ui");
fs.mkdirSync(output, { recursive: true });

function loadSource(relative) {
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => name === "@/lib/simulasi-reset"
    ? loadSource("src/lib/simulasi-reset.ts") : require(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { ResetSimulasiForm } = loadSource("src/app/(app)/pos/stok/ResetSimulasiForm.tsx");
// Plain app CSS, excluding uncompiled Tailwind directives. Wrapper is fictional.
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")
  .replace(/@import[^;]+;/g, "").replace(/@theme inline\s*\{[^}]*\}/g, "");
const markup = renderToStaticMarkup(React.createElement(ResetSimulasiForm, { role: "OWNER" }));
const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview panduan reset KAMO</title><style>${css}\n*{box-sizing:border-box}body{margin:0;padding:20px;background:var(--bg)}main{max-width:900px;margin:auto}a{text-decoration:none}h1{font-size:20px}small{display:block;margin-bottom:16px;color:var(--tm)}</style><main><h1>Stok per Gudang</h1><small>Preview lokal • OWNER fiktif • tanpa koneksi database</small>${markup}</main></html>`;
const htmlPath = path.join(output, "preview.html");
fs.writeFileSync(htmlPath, html);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  const results = [];
  for (const [name, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const network = [];
    await page.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
    await page.setContent(html);
    assert.equal(await page.locator("form, button, input").count(), 0);
    assert.equal(await page.locator("nav a").count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Lihat master SKU");
    assert.deepEqual(network, []);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    results.push({ viewport: name, width, overflow: false, submitControls: 0, reviewLinks: 3, firstKeyboardLink: "Lihat master SKU", externalRequests: 0 });
    await page.close();
  }
  fs.writeFileSync(path.join(output, "checks.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
