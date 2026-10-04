// Read-only benchmark of a fictional local app. Requires installed Playwright + Chromium.
import fs from "node:fs/promises";
import os from "node:os";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const app = new URL(option("--url", "http://127.0.0.1:3108"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(app.hostname)) {
  throw new Error("This benchmark only runs against a fictional loopback app.");
}
const output = option("--output", "/tmp/vetos-local-tab-benchmark.json");
const manifest = JSON.parse(await fs.readFile(option("--fixture", "/workspace/hris-local-runtime/fixture-manifest.json"), "utf8"));
const email = process.env.VETOS_BENCHMARK_EMAIL ?? "owner@hris-fiction.local";
const password = process.env.VETOS_BENCHMARK_PASSWORD ?? "FictionLocalOnly123!";
const paths = ["/crm/pelanggan", "/klinik/rekam-medis", "/pos/stok"];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ baseURL: app.origin, viewport: { width: 1365, height: 900 }, locale: "id-ID", timezoneId: "Asia/Jakarta" });
// CDN fonts/icons are excluded to measure local navigation rather than external delivery.
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  return url.origin === app.origin || url.protocol === "data:" ? route.continue() : route.abort();
});
const failures = [];
context.on("page", page => {
  page.on("pageerror", error => failures.push({ type: "browser", message: error.message }));
  page.on("response", response => {
    if (new URL(response.url()).origin === app.origin && response.status() >= 500) failures.push({ type: "http", status: response.status(), path: new URL(response.url()).pathname });
  });
});
const report = {
  timestamp: new Date().toISOString(), localOnly: true, app: app.origin,
  runtime: { node: process.version, chromium: browser.version(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  fixture: { period: manifest.period, counts: manifest.benchmarkCounts ?? "Not supplied; results measure the existing fictional fixture only." },
  readiness: "HTTP success, requested route retained, .ct table body visible; warm local navigation; external CDN requests blocked",
  cold: [], samples: [], summaries: [], failures,
};
try {
  const login = await context.newPage();
  await login.goto("/login", { waitUntil: "domcontentloaded" });
  await login.locator('input[name="email"]').fill(email);
  await login.locator('input[name="password"]').fill(password);
  await Promise.all([login.waitForURL("**/mulai", { timeout: 60000 }), login.getByRole("button", { name: "Masuk", exact: true }).click()]);
  await login.close();

  const navigate = async (page, path) => {
    const start = performance.now();
    const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.locator(".ct table tbody").first().waitFor({ state: "visible", timeout: 60000 });
    if (!response?.ok() || new URL(page.url()).pathname !== new URL(path, app).pathname) {
      throw new Error(`Navigation failed for ${path}: HTTP ${response?.status()}, resulting route ${new URL(page.url()).pathname}`);
    }
    return { ms: Math.round(performance.now() - start), renderedRows: await page.locator(".ct table tbody tr").count(), status: response.status() };
  };
  for (const path of paths) {
    const page = await context.newPage();
    report.cold.push({ path, ...(await navigate(page, path)) });
    await page.close();
  }
  for (const path of paths) {
    for (const tabs of [1, 10]) {
      for (let round = 1; round <= 3; round++) {
        const pages = await Promise.all(Array.from({ length: tabs }, () => context.newPage()));
        const start = performance.now();
        const results = await Promise.all(pages.map(page => navigate(page, path)));
        report.samples.push({ path, tabs, round, allReadyMs: Math.round(performance.now() - start), results });
        await Promise.all(pages.map(page => page.close()));
      }
      const rows = report.samples.filter(sample => sample.path === path && sample.tabs === tabs);
      const times = rows.flatMap(sample => sample.results.map(result => result.ms));
      report.summaries.push({ path, tabs, navigations: times.length, medianMs: percentile(times, 0.5), p95Ms: percentile(times, 0.95), medianAllReadyMs: percentile(rows.map(row => row.allReadyMs), 0.5), renderedRows: [...new Set(rows.flatMap(row => row.results.map(result => result.renderedRows)))] });
    }
  }
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, summaries: report.summaries, failures: failures.length }));
  if (failures.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
