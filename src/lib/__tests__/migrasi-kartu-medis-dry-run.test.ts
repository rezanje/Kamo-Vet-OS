import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dryRunOffline, hariIniWib } from "@/lib/migrasi-kartu-medis/dry-run";
import { buatMaster, masterDasar } from "./fixtures/master-kartu-medis";

const PHI = ["UJI PEMILIK", "081234567890", "UJI KUCING", "UJI DIAGNOSIS", "UJI TERAPI", "Jl. Fiktif", "uji pemilik::"];

describe("dry-run offline (bawaan)", () => {
  it("reports counts, reasons and fingerprints without PHI and with an explicit not-authorized note", async () => {
    const f = masterDasar(3);
    f.riwayat[2].decision = null;
    const laporan = await dryRunOffline(await buatMaster(f), { hariIni: "2026-10-30" });
    expect(laporan).toMatchObject({ ok: true, mode: "dry-run-offline", versi: "legacy-master-v0", hitungan: { riwayat: 3, siap: 2, dikecualikan: 1 } });
    expect(laporan.catatan).toContain("BUKAN otorisasi produksi");
    expect(laporan.catatan).toContain("status di database tidak diketahui");
    const teks = JSON.stringify(laporan);
    for (const p of PHI) expect(teks).not.toContain(p);
  });
  it("returns whole-file errors without partial plans", async () => {
    const laporan = await dryRunOffline(await buatMaster({ ...masterDasar(), versi: "v2" }));
    expect(laporan).toMatchObject({ ok: false, hitungan: null, baris: [] });
    expect(laporan.galat.join(" ")).toContain("tidak dikenal");
  });
  it("uses the WIB calendar date for 'today'", () => {
    expect(hariIniWib(new Date("2026-10-30T17:30:00Z"))).toBe("2026-10-31");
    expect(hariIniWib(new Date("2026-10-30T16:59:00Z"))).toBe("2026-10-30");
  });
});

describe("CLI scripts/migrasi-kartu-medis.mjs", () => {
  it("runs the offline dry-run with zero network modules loaded and writes a PHI-free report outside the repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mkm-cli-"));
    const berkas = join(dir, "master.xlsx");
    writeFileSync(berkas, await buatMaster(masterDasar(2)));
    const laporan = join(dir, "laporan.json");
    // Pengaman: modul jaringan tidak boleh ikut termuat; fetch dibuat melempar.
    const out = execFileSync(process.execPath, [
      "--import", "data:text/javascript,globalThis.fetch=()=>{throw new Error('NETWORK')}",
      "scripts/migrasi-kartu-medis.mjs", "dry-run", "--berkas", berkas, "--laporan", laporan, "--hari-ini", "2026-10-30",
    ], { encoding: "utf8" });
    const ringkas = JSON.parse(out);
    expect(ringkas).toMatchObject({ ok: true, mode: "dry-run-offline", hitungan: { riwayat: 2, siap: 2 } });
    const isi = readFileSync(laporan, "utf8");
    for (const p of PHI) { expect(out).not.toContain(p); expect(isi).not.toContain(p); }
    const { MODUL_OFFLINE } = await import("../../../scripts/migrasi-kartu-medis.mjs");
    expect(MODUL_OFFLINE.some((m: string) => /klien|eksekutor|identitas|buku-besar|supabase/.test(m))).toBe(false);
  });
  it("refuses unknown commands/options and a report path inside the repo", () => {
    const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/migrasi-kartu-medis.mjs", ...args], { encoding: "utf8" });
    expect(run("jalankan", "--berkas", "x.xlsx").stderr).toContain("Hanya perintah `dry-run`");
    expect(run("dry-run", "--berkas", "x.xlsx", "--kirim", "ya").stderr).toContain("Opsi tidak dikenal");
    expect(run("dry-run", "--berkas", "x.xlsx", "--laporan", "laporan.json").stderr).toContain("di luar repo");
  });
});
