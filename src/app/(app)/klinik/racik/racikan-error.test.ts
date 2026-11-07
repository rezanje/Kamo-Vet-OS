import { describe, expect, it } from "vitest";
import { pesanRacikanError, KODE_RACIKAN_DITERJEMAHKAN } from "./racikan-error";

const err = (message: string, code = "P0001") => ({ code, message });

describe("pesanRacikanError — penolakan database racikan jadi arahan Indonesia biasa", () => {
  const tabel: [string, string, RegExp][] = [
    ["INVOICE_PAID: tagihan kunjungan sudah dibayar", "INVOICE_PAID",
      /^Kunjungan ini sudah punya DP\/pembayaran, jadi racikan tidak bisa dikembalikan dari sini\. Hubungi Owner\/Reza untuk koreksi tagihan\.$/],
    ["RECIPE_LINKED: racikan sudah dipakai pada invoice", "RECIPE_LINKED", /sudah masuk tagihan.*Hubungi Owner\/Reza/],
    ["RECIPE_LINKED: komposisi resep resmi tidak dapat diubah", "RECIPE_LINKED", /resep resmi/],
    ["RECIPE_LINKED: histori stok racikan tidak konsisten", "RECIPE_LINKED", /riwayat stok.*tidak konsisten/i],
    ["RECIPE_INVALID: racikan sudah diserahkan", "RECIPE_INVALID", /sudah diserahkan ke pasien/],
    ["RECIPE_INVALID: racikan tidak dapat diubah lagi", "RECIPE_INVALID", /void atau sudah diserahkan/],
    ["RECIPE_INVALID: minimal satu bahan racikan", "RECIPE_INVALID", /minimal satu bahan/i],
    ["RECIPE_INVALID: bahan racikan tidak valid", "RECIPE_INVALID", /bahan atau jumlah/i],
    ["RECIPE_INVALID: bahan atau jumlah racikan tidak valid", "RECIPE_INVALID", /bahan atau jumlah/i],
    ["RECIPE_INVALID: status pemulihan tidak konsisten", "RECIPE_INVALID", /tidak konsisten.*Reza/],
    ["RECORD_POSTED: pemeriksaan tersimpan tidak dapat diubah atau dihapus", "RECORD_POSTED", /rekam medis.*terkunci/i],
    ["REASON_REQUIRED: alasan pengembalian bahan wajib diisi", "REASON_REQUIRED", /alasan.*3.*500/i],
    ["ACCESS_DENIED: pengguna tidak terautentikasi", "ACCESS_DENIED", /masuk ulang/i],
    ["ACCESS_DENIED: cabang racikan tidak diizinkan", "ACCESS_DENIED", /akses cabang/i],
    ["ACCESS_DENIED: racikan tidak ditemukan", "ACCESS_DENIED", /tidak ditemukan/i],
    ["COST_MISSING: histori stok racikan lama tidak tersedia", "COST_MISSING", /harga pokok.*Reza/i],
    ["STOCK_SHORT: Amoxicillin", "STOCK_SHORT", /Stok tidak cukup.*Amoxicillin/],
    ["LAYER_SHORT: Amoxicillin", "LAYER_SHORT", /Amoxicillin/],
    ["INGREDIENT_INVALID: bahan tidak aktif", "INGREDIENT_INVALID", /bahan.*tidak aktif/i],
    ["WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan", "WAREHOUSE_MISSING", /gudang klinik/i],
  ];
  it.each(tabel)("%s -> pesan Indonesia, kode asli tetap ada", (raw, kode, pola) => {
    const hasil = pesanRacikanError(err(raw));
    expect(hasil.pesan).toMatch(pola);
    expect(hasil.pesan).not.toContain(kode);
    expect(hasil.detail).toBe(raw);
    expect(KODE_RACIKAN_DITERJEMAHKAN).toContain(kode);
  });

  it("kode tak dikenal tidak disembunyikan: pesan umum tetap membawa kode asli di detail", () => {
    const hasil = pesanRacikanError(err("ZZZ_BARU: sesuatu yang belum dipetakan"));
    expect(hasil.detail).toBe("ZZZ_BARU: sesuatu yang belum dipetakan");
    expect(hasil.pesan).toMatch(/belum dikenali/i);
  });

  it("error non-P0001 (jaringan/DB) tetap meneruskan teks aslinya sebagai detail, bukan pesan palsu", () => {
    const hasil = pesanRacikanError({ code: "57014", message: "canceling statement due to statement timeout" });
    expect(hasil.detail).toBe("canceling statement due to statement timeout");
    expect(hasil.pesan).not.toMatch(/DP\/pembayaran/);
  });

  it("kode lama di tengah kalimat tidak dianggap INVOICE_PAID (hanya awalan kode)", () => {
    const hasil = pesanRacikanError(err("catatan: INVOICE_PAID di tengah"));
    expect(hasil.pesan).not.toMatch(/DP\/pembayaran/);
  });

  it("detail dipotong aman dan baris baru dibuang (muat di URL)", () => {
    const hasil = pesanRacikanError(err("X_Y: " + "a\n".repeat(400)));
    expect(hasil.detail.length).toBeLessThanOrEqual(300);
    expect(hasil.detail).not.toContain("\n");
  });
});
