import { describe, expect, it, vi } from "vitest";
import { bacaIzinJurnal, parseJurnalIzin, tentukanJurnalUi } from "../jurnal-izin";

const SEMUA = { lihat: true, buat_manual: true, koreksi_manual: false, lihat_semua_sumber: true };

describe("Jurnal Umum: tombol per peran Admin Umum", () => {
  it("peran lain: tampilan lama persis, tanpa membaca izin", async () => {
    for (const role of ["OWNER", "ADMIN", "FINANCE", "STAFF", null]) {
      const rpc = vi.fn();
      expect(await bacaIzinJurnal({ rpc } as never, role)).toBeNull();
      expect(rpc).not.toHaveBeenCalled();
      expect(tentukanJurnalUi({ role, aktif: true, izin: null })).toEqual({ tolak: false, pesan: "", bolehBuat: true, bolehKoreksi: false, semuaSumber: true });
    }
  });
  it("Admin Umum: bawaan (sama seperti ADMIN) boleh lihat, buat manual, semua sumber; koreksi mati", () => {
    expect(tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: true, izin: SEMUA })).toEqual({ tolak: false, pesan: "", bolehBuat: true, bolehKoreksi: false, semuaSumber: true });
  });
  it("tiap tombol berdiri sendiri", () => {
    expect(tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: true, izin: { ...SEMUA, buat_manual: false } }).bolehBuat).toBe(false);
    expect(tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: true, izin: { ...SEMUA, koreksi_manual: true } }).bolehKoreksi).toBe(true);
    expect(tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: true, izin: { ...SEMUA, lihat_semua_sumber: false } }).semuaSumber).toBe(false);
    const tutup = tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: true, izin: { ...SEMUA, lihat: false } });
    expect(tutup.tolak).toBe(true);
    expect(tutup.pesan).toContain("Akses Grup");
  });
  it("gagal tertutup: izin tak terbaca / akun nonaktif menolak tampilan", async () => {
    expect(tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: true, izin: "gagal" }).tolak).toBe(true);
    expect(tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: true, izin: null }).tolak).toBe(true);
    expect(tentukanJurnalUi({ role: "ADMIN_UMUM", aktif: false, izin: SEMUA }).tolak).toBe(true);
    expect(await bacaIzinJurnal({ rpc: async () => ({ data: null, error: { message: "x" } }) } as never, "ADMIN_UMUM")).toBe("gagal");
    expect(await bacaIzinJurnal({ rpc: async () => { throw new Error("net"); } } as never, "ADMIN_UMUM")).toBe("gagal");
    expect(await bacaIzinJurnal({ rpc: async () => ({ data: { lihat: true }, error: null }) } as never, "ADMIN_UMUM")).toBe("gagal");
    expect(await bacaIzinJurnal({ rpc: async () => ({ data: SEMUA, error: null }) } as never, "ADMIN_UMUM")).toEqual(SEMUA);
  });
  it("parseJurnalIzin menolak bentuk salah", () => {
    for (const v of [null, [], "x", 1, { lihat: 1 }, { ...SEMUA, buat_manual: "true" }]) expect(parseJurnalIzin(v)).toBeNull();
    expect(parseJurnalIzin(SEMUA)).toEqual(SEMUA);
  });
});
