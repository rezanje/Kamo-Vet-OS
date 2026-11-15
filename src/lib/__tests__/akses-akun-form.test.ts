// E3 (meeting 12 Nov 2026): formulir "Akses khusus akun ini" — validasi, pesan galat, ringkasan.
import { describe, expect, it } from "vitest";
import { bacaFormAksesAkun, parseDataAksesAkun, pesanGalatAksesAkun, ringkasAkses, ringkasAksesAkun } from "../akses-akun-form";
import { terapkanAksesAkun } from "../akses-akun";
import { selectableSubmenus } from "../submenu-access";

const ID = "a0000000-0000-4000-8000-000000000001";
const KEY = "b0000000-0000-4000-8000-000000000002";
const form = (entries: [string, string][]) => { const f = new FormData(); for (const [k, v] of [["profile_id", ID], ["request_key", KEY], ...entries]) f.append(k, v); return f; };
const semuaPenjualan = () => selectableSubmenus("penjualan").map(x => [`sub_${x.id}`, "on"] as [string, string]);

describe("bacaFormAksesAkun", () => {
  it("Hanya akses khusus: Penjualan › Penjualan Online", () => {
    expect(bacaFormAksesAkun(form([["mode", "khusus"], ["mod_penjualan", "on"], ["subs_penjualan", "1"], ["sub_penjualan.online", "on"], ["reason", "  staf online  "]])))
      .toEqual({ ok: true, profileId: ID, requestKey: KEY, mode: "khusus", modules: { penjualan: ["penjualan.online"] }, reason: "staf online" });
  });
  it("semua sub-menu dicentang = seluruh modul; modul tanpa sub-menu = null; sub-menu modul tak dicentang diabaikan", () => {
    const r = bacaFormAksesAkun(form([["mode", "tambah"], ["mod_penjualan", "on"], ["subs_penjualan", "1"], ...semuaPenjualan(), ["mod_kasir", "on"], ["subs_crm", "1"], ["sub_crm.promo", "on"]]));
    expect(r).toMatchObject({ ok: true, mode: "tambah", modules: { penjualan: null, kasir: null }, reason: null });
  });
  it("Ikuti peran: tanpa daftar menu (centang yang tersembunyi diabaikan)", () => {
    expect(bacaFormAksesAkun(form([["mode", "ikuti"], ["mod_penjualan", "on"]]))).toMatchObject({ ok: true, mode: "ikuti", modules: null });
  });
  it.each([
    ["tanpa mode", [], "Pilih salah satu"],
    ["mode asing", [["mode", "semua"]], "Pilih salah satu"],
    ["tidak ada menu dicentang", [["mode", "khusus"]], "Centang minimal satu menu"],
    ["menu dicentang, sub-menu kosong", [["mode", "khusus"], ["mod_penjualan", "on"], ["subs_penjualan", "1"]], "Menu Penjualan dicentang tetapi semua sub-menunya kosong"],
    ["menu tidak dikenal", [["mode", "khusus"], ["mod_rahasia", "on"]], "tidak dikenal"],
    ["sub-menu tidak dikenal", [["mode", "khusus"], ["mod_penjualan", "on"], ["subs_penjualan", "1"], ["sub_penjualan.x", "on"]], "tidak dikenal"],
    ["alasan terlalu panjang", [["mode", "khusus"], ["mod_kasir", "on"], ["reason", "x".repeat(1001)]], "maksimal 1000"],
  ] as [string, [string, string][], string][])("menolak: %s", (_n, entries, pesan) => {
    const r = bacaFormAksesAkun(form(entries));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain(pesan);
  });
  it("menolak identitas formulir yang rusak", () => {
    const f = new FormData(); f.append("profile_id", "x"); f.append("request_key", KEY); f.append("mode", "ikuti");
    expect(bacaFormAksesAkun(f)).toMatchObject({ ok: false });
  });
});

describe("pesanGalatAksesAkun: kalimat ramah, tanpa isi galat database", () => {
  it.each([
    [{ code: "42501", message: "ACCOUNT_ACCESS_OWNER_REQUIRED: hanya pemilik" }, "Hanya pemilik (Owner)"],
    [{ code: "22023", message: "ACCOUNT_ACCESS_TARGET_OWNER: x" }, "Akun OWNER selalu punya akses penuh"],
    [{ code: "22023", message: "ACCOUNT_ACCESS_MODULES_INVALID: x" }, "Pilihan menu tidak valid"],
    [{ code: "22023", message: "ACCOUNT_ACCESS_REQUEST_KEY_REUSED: x" }, "Muat ulang halaman"],
    [{ code: "PGRST202", message: "Could not find the function public.save_account_access_override" }, "belum aktif di database"],
    [{ code: "55P03", message: "could not obtain lock on row" }, "sedang diubah"],
    [{ code: "XX000", message: "internal PRIVATE detail" }, "belum tersimpan"],
  ])("%j", (error, pesan) => {
    const m = pesanGalatAksesAkun(error);
    expect(m).toContain(pesan);
    expect(m).not.toContain("PRIVATE");
    expect(m).not.toContain("ACCOUNT_ACCESS");
  });
});

describe("parseDataAksesAkun + ringkasan", () => {
  const raw = {
    profile_id: ID, role: "STAFF", is_active: true,
    override: { mode: "khusus", modules: { penjualan: ["penjualan.online"] }, updated_at: "2026-11-13T01:00:00Z", updated_by_name: "Owner Fiktif" },
    history: [{ id: "h1", created_at: "2026-11-13T01:00:00Z", created_by_name: "Owner Fiktif", reason: null, before: null, after: { mode: "khusus", modules: { penjualan: ["penjualan.online"] } } }],
  };
  it("membaca jawaban Owner; id akun lain / bentuk aneh = null", () => {
    const d = parseDataAksesAkun(raw, ID)!;
    expect(d.override).toMatchObject({ mode: "khusus", modules: { penjualan: ["penjualan.online"] }, updated_by_name: "Owner Fiktif" });
    expect(d.history[0]).toMatchObject({ before: null, after: { mode: "khusus" } });
    expect(parseDataAksesAkun({ ...raw, profile_id: "lain" }, ID)).toBeNull();
    expect(parseDataAksesAkun({ ...raw, override: { mode: "x" } }, ID)).toBeNull();
    expect(parseDataAksesAkun([], ID)).toBeNull();
  });
  it("ringkasan untuk Owner", () => {
    expect(ringkasAksesAkun(null)).toBe("Ikuti peran");
    expect(ringkasAksesAkun({ mode: "khusus", modules: { penjualan: ["penjualan.online"] } })).toBe("Hanya akses khusus: Penjualan: Penjualan Online");
    expect(ringkasAkses("STAFF", terapkanAksesAkun("STAFF", [], { mode: "tambah", modules: { penjualan: ["penjualan.online"] } })))
      .toEqual(["Klinik (semua)", "Penjualan: Penjualan Online", "Kasir", "Quest Staff"]);
    expect(ringkasAkses("ADMIN", [])).toBe("penuh");
  });
});
