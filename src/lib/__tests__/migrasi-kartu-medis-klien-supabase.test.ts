import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buatMaster, masterDasar } from "./fixtures/master-kartu-medis";
import { masukOwner, opsiDariEnv, pastikanTarget, PROYEK_PRODUKSI } from "@/lib/migrasi-kartu-medis/klien-supabase";

const URL_PROD = `https://${PROYEK_PRODUKSI}.supabase.co`;
const jwt = (iss: string) => `x.${Buffer.from(JSON.stringify({ iss, sub: "u1" })).toString("base64url")}.y`;

type Panggilan = { url: string; method: string; headers: Record<string, string>; body: string | null };

function fetchPalsu(iss: string) {
  const panggilan: Panggilan[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    panggilan.push({ url, method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : null });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/auth/v1/token")) {
      return json({ access_token: jwt(iss), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: { id: "u1", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
    }
    if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
    if (url.includes("/rest/v1/rpc/")) return json([{ ok: 1 }]);
    if (url.includes("/rest/v1/customers") && init?.method === "POST") return json([{ id: "c1" }], 201);
    if (url.includes("/rest/v1/")) return json([{ id: "p1" }]);
    return json({}, 404);
  };
  return { f: f as typeof fetch, panggilan };
}

const opsi = (f: typeof fetch, extra: Partial<Parameters<typeof masukOwner>[0]> = {}) => ({
  url: URL_PROD, anonKey: "anon-publik", email: "owner@contoh.test", password: "RAHASIA-JANGAN-BOCOR",
  konteks: { mode: "semua-cabang" as const }, proyek: PROYEK_PRODUKSI, fetch: f, ...extra,
});

describe("klien Supabase migrasi (login OWNER biasa, RLS)", () => {
  it("signs in with the public anon key + password and calls only RPC/REST as the user (no service role)", async () => {
    const { f, panggilan } = fetchPalsu(`${URL_PROD}/auth/v1`);
    const k = await masukOwner(opsi(f));
    await k.rpc("import_legacy_identity_scan", { p_source_keys: [] });
    await k.pilih("customers", "id,name", ["p1"]);
    await k.buatPemilik({ name: "A / B", phone: "0812", address: null, imported_at: "2026-10-30T00:00:00Z" });
    await k.keluar();
    expect(panggilan[0].url).toBe(`${URL_PROD}/auth/v1/token?grant_type=password`);
    const rpc = panggilan.find((p) => p.url.includes("/rpc/"))!;
    expect(rpc.headers.authorization).toBe(`Bearer ${jwt(`${URL_PROD}/auth/v1`)}`);
    expect(rpc.headers.apikey).toBe("anon-publik");
    expect(rpc.headers["x-kamo-operational-branch"]).toBeUndefined();
    const insert = panggilan.find((p) => p.method === "POST" && p.url.includes("/rest/v1/customers"))!;
    expect(JSON.parse(insert.body!)).toEqual({ name: "A / B", phone: "0812", address: null, imported_at: "2026-10-30T00:00:00Z" });
    expect(panggilan.some((p) => p.url.includes("/logout"))).toBe(true);
  });
  it("sends the branch header in branch mode", async () => {
    const { f, panggilan } = fetchPalsu(`${URL_PROD}/auth/v1`);
    const cabang = "0f000000-0000-4000-8000-0000000000b1";
    const k = await masukOwner(opsi(f, { konteks: { mode: "cabang", cabangId: cabang } }));
    await k.rpc("riwayat_bersama_hewan", {});
    expect(panggilan.find((p) => p.url.includes("/rpc/"))!.headers["x-kamo-operational-branch"]).toBe(cabang);
  });
  it("refuses a token issued by another project and signs out", async () => {
    const { f, panggilan } = fetchPalsu("https://proyeklainxxxxxxxxxxxx.supabase.co/auth/v1");
    await expect(masukOwner(opsi(f))).rejects.toThrow("bukan dari proyek target");
    expect(panggilan.some((p) => p.url.includes("/rest/v1/"))).toBe(false);
  });
  it("refuses a URL that is not the confirmed project before any network call", async () => {
    const { f, panggilan } = fetchPalsu("x");
    await expect(masukOwner(opsi(f, { url: "https://lain.supabase.co" }))).rejects.toThrow("tidak cocok");
    await expect(masukOwner(opsi(f, { proyek: "abc" }))).rejects.toThrow("tidak cocok");
    expect(panggilan).toHaveLength(0);
    expect(() => pastikanTarget("http://koaglxcyjqfmgfzxszkj.supabase.co", PROYEK_PRODUKSI)).toThrow();
  });
  it("names missing environment variables without echoing any value", () => {
    expect(() => opsiDariEnv({ KAMO_OWNER_PASSWORD: "RAHASIA" }, { mode: "semua-cabang" }, PROYEK_PRODUKSI))
      .toThrow(/^Variabel environment belum diisi: KAMO_SUPABASE_ANON_KEY, KAMO_OWNER_EMAIL\.$/);
    const o = opsiDariEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", KAMO_OWNER_EMAIL: "e", KAMO_OWNER_PASSWORD: "p" }, { mode: "semua-cabang" }, PROYEK_PRODUKSI);
    expect(o.url).toBe(URL_PROD);
  });
  it("login failure message never contains the credentials", async () => {
    const f = (async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch;
    const e = await masukOwner(opsi(f)).catch((x: Error) => x);
    expect(String(e)).toMatch(/Login OWNER gagal/);
    expect(String(e)).not.toMatch(/RAHASIA|owner@contoh/);
  });
});

describe("runner produksi (guard sebelum jaringan)", () => {
  const jalankan = async (args: (berkas: string, sha: string, dir: string) => string[], env: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "mkm-prod-"));
    const bytes = await buatMaster(masterDasar(1));
    const berkas = join(dir, "master.xlsx");
    writeFileSync(berkas, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    return spawnSync(process.execPath, [
      "--import", "data:text/javascript,globalThis.fetch=()=>{throw new Error('NETWORK')}",
      "scripts/migrasi-kartu-medis-produksi.mjs", ...args(berkas, sha, dir),
    ], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
  };
  const dasar = (berkas: string, sha: string, dir: string) => [
    "--berkas", berkas, "--setujui-berkas", sha, "--hari-ini", "2026-10-30", "--konfirmasi-proyek", PROYEK_PRODUKSI, "--laporan", join(dir, "l.json"),
  ];
  it("stops before any network call when credentials are not in the environment", async () => {
    const r = await jalankan((b, s, d) => ["validasi-db", ...dasar(b, s, d)]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Variabel environment belum diisi");
    expect(r.stderr).not.toContain("NETWORK");
  }, 60_000);
  it("refuses a file whose SHA-256 differs from the approval, and a ledger inside the repo", async () => {
    const beda = await jalankan((b, _s, d) => ["validasi-db", ...dasar(b, "0".repeat(64), d)]);
    expect(beda.stderr).toContain("SHA-256 berkas berbeda");
    const dalam = await jalankan((b, s, d) => ["terapkan", ...dasar(b, s, d), "--ledger", "ledger-uji"]);
    expect(dalam.stderr).toContain("--ledger harus di luar repo");
  }, 60_000);
});
