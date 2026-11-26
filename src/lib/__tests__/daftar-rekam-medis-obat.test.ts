import { describe, expect, it } from "vitest";
import {
  BANTUAN_CARI_OBAT, MAKS_CARI_OBAT, PESAN_OBAT_TERLALU_BANYAK, PESAN_OBAT_TERLALU_PANJANG, PESAN_OBAT_TERLALU_PENDEK,
  bacaObatCocok, fungsiObatBelumAda, gabungObatCocok, normalisasiObat, periksaCariObat, teksObatCocok,
} from "@/lib/daftar-rekam-medis-obat";

describe("periksaCariObat (aturan sama dengan RPC daftar_rekam_medis_halaman p_obat)", () => {
  it("kosong, spasi, hanya koma = tanpa filter", () => {
    for (const mentah of [undefined, null, "", "   ", ",", " , , ", "\t\n"]) expect(periksaCariObat(mentah)).toEqual({ ok: true, aktif: false });
  });

  it("satu produk: dipangkas, tanpa beda huruf/aksen/spasi ganda", () => {
    expect(periksaCariObat("  RC   Recovery ")).toEqual({ ok: true, aktif: true, teks: "RC   Recovery", istilah: ["rc recovery"] });
    expect(periksaCariObat("CAFÉ Crème")).toMatchObject({ ok: true, aktif: true, istilah: ["cafe creme"] });
  });

  it("koma memisahkan produk; istilah kosong dibuang", () => {
    expect(periksaCariObat("rc recovery, Icare ,")).toMatchObject({ aktif: true, istilah: ["rc recovery", "icare"] });
    expect(periksaCariObat(" ,rc recovery, ,")).toMatchObject({ aktif: true, istilah: ["rc recovery"] });
  });

  it("tiap produk minimal 2 huruf, total maksimal 100, maksimal 5 produk", () => {
    expect(periksaCariObat("r")).toEqual({ ok: false, pesan: PESAN_OBAT_TERLALU_PENDEK });
    expect(periksaCariObat("rc recovery, a")).toEqual({ ok: false, pesan: PESAN_OBAT_TERLALU_PENDEK });
    expect(periksaCariObat("ab")).toMatchObject({ ok: true, aktif: true });
    expect(periksaCariObat("x".repeat(MAKS_CARI_OBAT))).toMatchObject({ ok: true, aktif: true });
    expect(periksaCariObat("x".repeat(MAKS_CARI_OBAT + 1))).toEqual({ ok: false, pesan: PESAN_OBAT_TERLALU_PANJANG });
    expect(periksaCariObat("aa,bb,cc,dd,ee")).toMatchObject({ ok: true, aktif: true });
    expect(periksaCariObat("aa,bb,cc,dd,ee,ff")).toEqual({ ok: false, pesan: PESAN_OBAT_TERLALU_BANYAK });
  });

  it("% dan _ biasa (bukan wildcard) dan batas panjang sama dengan database (100)", () => {
    expect(periksaCariObat("vit 100%")).toMatchObject({ aktif: true, istilah: ["vit 100%"] });
    expect(periksaCariObat("_x")).toMatchObject({ aktif: true, istilah: ["_x"] });
    expect(MAKS_CARI_OBAT).toBe(100);
    expect(BANTUAN_CARI_OBAT).toContain("RC Recovery");
  });

  it("normalisasiObat", () => {
    expect(normalisasiObat("  ÜNIQUE   Crème ")).toBe("unique creme");
  });
});

describe("keping obat_cocok", () => {
  it("bacaObatCocok membuang bentuk salah, menjaga yang benar", () => {
    expect(bacaObatCocok([{ nama: "RC Recovery", qty: 2, sumber: "resep" }, { nama: "", qty: 1, sumber: "resep" },
      { nama: "X", qty: "1", sumber: "resep" }, { nama: "Y", qty: 1, sumber: "lain" }, null, 5, { nama: "Z", qty: 1, sumber: "tagihan" }]))
      .toEqual([{ nama: "RC Recovery", qty: 2, sumber: "resep" }, { nama: "Z", qty: 1, sumber: "tagihan" }]);
    expect(bacaObatCocok(undefined)).toEqual([]);
    expect(bacaObatCocok("bukan array")).toEqual([]);
    expect(bacaObatCocok({ nama: "A" })).toEqual([]);
  });

  it("gabungObatCocok menjumlahkan qty per (sumber, nama), urut nama", () => {
    expect(gabungObatCocok([
      [{ nama: "RC Recovery", qty: 2, sumber: "resep" }],
      [{ nama: "RC Recovery", qty: 1, sumber: "resep" }, { nama: "RC Recovery", qty: 5, sumber: "tagihan" }, { nama: "Icare Can Recovery", qty: 1, sumber: "resep" }],
    ])).toEqual([
      { nama: "Icare Can Recovery", qty: 1, sumber: "resep" },
      { nama: "RC Recovery", qty: 3, sumber: "resep" },
      { nama: "RC Recovery", qty: 5, sumber: "tagihan" },
    ]);
    expect(gabungObatCocok([])).toEqual([]);
  });

  it("gabungObatCocok tidak mengubah masukan", () => {
    const a = [{ nama: "A", qty: 1, sumber: "resep" as const }];
    gabungObatCocok([a, a]);
    expect(a[0].qty).toBe(1);
  });

  it("teksObatCocok: 'Nama ×qty' + keterangan sumber", () => {
    expect(teksObatCocok({ nama: "Icare Can Recovery", qty: 2, sumber: "resep" })).toBe("Icare Can Recovery ×2");
    expect(teksObatCocok({ nama: "Obat Racik", qty: 1, sumber: "racikan" })).toBe("Obat Racik ×1 (racikan)");
    expect(teksObatCocok({ nama: "Churu", qty: 10, sumber: "tagihan" })).toBe("Churu ×10 (ditagihkan kasir)");
  });
});

describe("fungsiObatBelumAda", () => {
  it("hanya PGRST202/42883 yang menyebut daftar_rekam_medis_halaman", () => {
    const pesan = "Could not find the function public.daftar_rekam_medis_halaman(p_batas, p_cabang, p_cari, p_obat, p_offset, p_pet, p_tampilan) in the schema cache";
    expect(fungsiObatBelumAda({ code: "PGRST202", message: pesan })).toBe(true);
    expect(fungsiObatBelumAda({ code: "42883", message: pesan })).toBe(true);
    expect(fungsiObatBelumAda({ code: "PGRST202", message: "fungsi lain tidak ada" })).toBe(false);
    expect(fungsiObatBelumAda({ code: "57014", message: pesan })).toBe(false);
    expect(fungsiObatBelumAda({ code: "22023", message: "DAFTAR_REKAM_MEDIS_HALAMAN: batas harus 1-200" })).toBe(false);
    expect(fungsiObatBelumAda(null)).toBe(false);
    expect(fungsiObatBelumAda(undefined)).toBe(false);
  });
});
