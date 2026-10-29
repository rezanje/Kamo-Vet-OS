import { describe, expect, it } from "vitest";
import {
  bacaAksesDiskonManual, barisDiskonManual, bolehDiskonManual, bolehDiskonManualBawaan,
  diskonBawaanBaris, PERAN_DISKON_MANUAL, PESAN_DISKON_MANUAL,
} from "../akses-diskon";
import { loadRoleCapabilities, roleCapabilities } from "../role-capabilities";

/** Klien Supabase palsu: satu baris profil + satu baris kemampuan peran. */
function klien(profil: unknown, kemampuan: unknown = null, gagal?: "profil" | "kemampuan") {
  return {
    from(table: string) {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => table === "profiles"
          ? { data: profil, error: gagal === "profil" ? { message: "x" } : null }
          : { data: kemampuan, error: gagal === "kemampuan" ? { message: "x" } : null },
      };
      return q;
    },
  };
}

describe("siapa yang boleh memberi diskon manual", () => {
  it("bawaannya pemilik, admin kantor, dan keuangan", () => {
    expect([...PERAN_DISKON_MANUAL]).toEqual(["OWNER", "ADMIN", "FINANCE"]);
    for (const peran of ["OWNER", "ADMIN", "FINANCE"]) expect(bolehDiskonManualBawaan(peran)).toBe(true);
    for (const peran of ["STAFF", "DOCTOR"]) expect(bolehDiskonManualBawaan(peran)).toBe(false);
  });

  it("peran yang tidak terbaca selalu ditolak (gagal tertutup)", () => {
    expect(bolehDiskonManual(null)).toBe(false);
    expect(bolehDiskonManual(undefined)).toBe(false);
    expect(bolehDiskonManual("")).toBe(false);
  });

  it("setelan pemilik menang atas bawaan, kecuali untuk pemilik sendiri", () => {
    expect(bolehDiskonManual("STAFF", { manual_discount: true })).toBe(true);
    expect(bolehDiskonManual("FINANCE", { manual_discount: false })).toBe(false);
    // OWNER tidak bisa mengunci dirinya sendiri keluar.
    expect(bolehDiskonManual("OWNER", { manual_discount: false })).toBe(true);
  });

  it("kolom kosong berarti ikut bawaan, bukan dilarang", () => {
    expect(bolehDiskonManual("ADMIN", { manual_discount: null })).toBe(true);
    expect(bolehDiskonManual("STAFF", { manual_discount: null })).toBe(false);
  });

  it("memakai matriks kemampuan peran yang sama dengan hak cabang & akun", () => {
    expect(roleCapabilities("STAFF").manual_discount).toBe(false);
    expect(roleCapabilities("FINANCE").manual_discount).toBe(true);
    expect(roleCapabilities("OWNER", { manual_discount: false }).manual_discount).toBe(true);
    // Nilai tersimpan menang per kolom: hak cabang yang sudah disetel tidak
    // menghapus hak diskon yang belum pernah disetel.
    expect(roleCapabilities("FINANCE", { all_branches: false }).manual_discount).toBe(true);
  });

  it("pembaca kemampuan ikut membawa kolom diskon manual", async () => {
    const caps = await loadRoleCapabilities(klien(null, { all_branches: true, create_accounts: false, manual_discount: false }), "FINANCE");
    expect(caps.manual_discount).toBe(false);
    expect((await loadRoleCapabilities(klien(null, null, "kemampuan"), "FINANCE")).manual_discount).toBe(false);
  });
});

describe("baca hak diskon manual pengguna yang login", () => {
  it("mengizinkan pemilik tanpa membaca tabel kemampuan", async () => {
    expect(await bacaAksesDiskonManual(klien({ role: "OWNER", is_active: true }), "u")).toBe(true);
  });

  it("menolak kasir, dan mengizinkannya hanya bila pemilik menyalakannya", async () => {
    expect(await bacaAksesDiskonManual(klien({ role: "STAFF", is_active: true }), "u")).toBe(false);
    expect(await bacaAksesDiskonManual(klien({ role: "STAFF", is_active: true }, { manual_discount: true }), "u")).toBe(true);
  });

  it("gagal tertutup saat profil tidak terbaca, akun nonaktif, atau tabel kemampuan error", async () => {
    expect(await bacaAksesDiskonManual(klien(null), "u")).toBe(false);
    expect(await bacaAksesDiskonManual(klien({ role: "ADMIN", is_active: false }), "u")).toBe(false);
    expect(await bacaAksesDiskonManual(klien({ role: "ADMIN", is_active: true }, null, "profil"), "u")).toBe(false);
    expect(await bacaAksesDiskonManual(klien({ role: "ADMIN", is_active: true }, null, "kemampuan"), "u")).toBe(false);
  });
});

describe("diskon default barang vs diskon manual (temuan audit S-6)", () => {
  it("barang tanpa diskon default: potongan apa pun dihitung manual", () => {
    expect(barisDiskonManual({ item_discount_type: null, item_discount_value: 0 }, 0)).toBe(false);
    expect(barisDiskonManual({ item_discount_type: "nominal", item_discount_value: 5000 }, 0)).toBe(true);
    expect(barisDiskonManual({ item_discount_type: "percent", item_discount_value: 5 }, 0)).toBe(true);
  });

  it("diskon default yang tidak diubah bukan diskon manual", () => {
    expect(barisDiskonManual({ item_discount_type: "percent", item_discount_value: 20 }, 20)).toBe(false);
  });

  it("diskon default yang diubah — dinaikkan, diturunkan, atau diganti rupiah — dihitung manual", () => {
    expect(barisDiskonManual({ item_discount_type: "percent", item_discount_value: 25 }, 20)).toBe(true);
    expect(barisDiskonManual({ item_discount_type: "percent", item_discount_value: 10 }, 20)).toBe(true);
    expect(barisDiskonManual({ item_discount_type: "nominal", item_discount_value: 20 }, 20)).toBe(true);
    expect(barisDiskonManual({ item_discount_type: null, item_discount_value: 0 }, 20)).toBe(true);
  });

  it("nilai bawaan baris diambil dari master, bukan dari layar", () => {
    expect(diskonBawaanBaris(0)).toEqual({ item_discount_type: null, item_discount_value: 0 });
    expect(diskonBawaanBaris(20)).toEqual({ item_discount_type: "percent", item_discount_value: 20 });
    expect(diskonBawaanBaris(-5)).toEqual({ item_discount_type: null, item_discount_value: 0 });
  });

  it("memakai satu kalimat penolakan untuk semua layar", () => {
    expect(PESAN_DISKON_MANUAL).toBe("Diskon manual hanya untuk akun berwenang");
  });
});
