import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adalahKekuranganStok, angkaStok, angkaTampil, formatKekuranganStok, kekurangan, uraiKekuranganStok,
} from "../stok-kurang";

const urai = (pesan: string) => uraiKekuranganStok(pesan);

describe("kalimat yang dibentuk sendiri bisa dibaca kembali utuh", () => {
  it("nama, jumlah, satuan, dan kekurangannya kembali seperti semula", () => {
    const baris = [
      { nama: "Obat A", butuh: 500, tersedia: 250, satuan: "pcs" },
      { nama: "Obat B", butuh: 30, tersedia: 25, satuan: "box" },
    ];
    const pesan = formatKekuranganStok(baris);
    expect(pesan).toBe("Obat A butuh 500 pcs, tersedia 250 pcs; Obat B butuh 30 box, tersedia 25 box");
    expect(urai(`Stok gudang pengirim tidak cukup. ${pesan}. Kurangi jumlah kirim atau tunggu stok masuk`)?.baris)
      .toEqual(baris.map((b) => ({ ...b, gudang: "Gudang pengirim" })));
  });

  it("pecahan ditulis tanpa pemisah ribuan supaya titik tidak pernah rancu", () => {
    const pesan = formatKekuranganStok([{ nama: "Infus", butuh: 1234.5, tersedia: 0.25, satuan: "ml" }]);
    expect(pesan).toBe("Infus butuh 1234.5 ml, tersedia 0.25 ml");
    expect(urai(`Stok gudang asal tidak cukup. ${pesan}. Kurangi kuantitasnya`)?.baris[0])
      .toMatchObject({ butuh: 1234.5, tersedia: 0.25 });
  });

  it("angkaStok mengikuti stock_qty_text; angkaTampil baru melokalkan untuk mata manusia", () => {
    expect(angkaStok(1234.5)).toBe("1234.5");
    expect(angkaStok(500)).toBe("500");
    expect(angkaTampil(1234.5)).toBe("1.234,5");
    expect(angkaTampil(null)).toBe("—");
  });

  it("kekurangan = butuh − tersedia, tidak pernah minus, null bila angkanya tidak diketahui", () => {
    expect(kekurangan({ nama: "A", butuh: 500, tersedia: 250 })).toBe(250);
    expect(kekurangan({ nama: "A", butuh: 1, tersedia: 9 })).toBe(0);
    expect(kekurangan({ nama: "A", butuh: null, tersedia: 9 })).toBeNull();
  });
});

describe("setiap bentuk penolakan yang dipakai hari ini jadi baris popup", () => {
  it("permintaan barang — persetujuan: petunjuknya menyuruh menurunkan jumlah disetujui", () => {
    const hasil = urai("Stok gudang pengirim tidak cukup. Obat A butuh 500 pcs, tersedia 250 pcs. Turunkan jumlah yang disetujui");
    expect(hasil?.baris).toEqual([{ gudang: "Gudang pengirim", nama: "Obat A", butuh: 500, tersedia: 250, satuan: "pcs" }]);
    expect(hasil?.petunjuk).toContain("Setujui sebanyak stok yang ada");
  });

  it("permintaan barang — pengiriman: petunjuknya menawarkan kirim sebagian", () => {
    const hasil = urai("Stok gudang pengirim tidak cukup. Obat A butuh 500 pcs, tersedia 250 pcs. Kurangi jumlah kirim atau tunggu stok masuk");
    expect(hasil?.baris[0]).toMatchObject({ nama: "Obat A", butuh: 500, tersedia: 250 });
    expect(hasil?.petunjuk).toContain("kirim sebagian");
  });

  it("pemindahan barang — pemeriksaan layar dan penolakan stock_transfer_fifo_exact", () => {
    expect(urai("Stok gudang asal tidak cukup. Obat A butuh 500 pcs, tersedia 250 pcs. Kurangi kuantitasnya")?.baris)
      .toEqual([{ gudang: "Gudang asal", nama: "Obat A", butuh: 500, tersedia: 250, satuan: "pcs" }]);
    // Bentuk database: "perlu/tersedia", selalu dalam satuan dasar, tanpa satuan tertulis.
    expect(urai("Stok gudang asal tidak cukup: Obat A perlu 500, tersedia 250")?.baris)
      .toEqual([{ gudang: "Gudang asal", nama: "Obat A", butuh: 500, tersedia: 250, satuan: null }]);
    expect(urai("Stok gudang asal tidak cukup")?.baris)
      .toEqual([{ gudang: "Gudang asal", nama: "Barang yang dipindahkan", butuh: null, tersedia: null }]);
  });

  it("klinik — rekam medis, rawat inap, dan racikan", () => {
    // Pemeriksaan di layar (daftar polos, varian "stok" bukan "tersedia").
    expect(urai("Obat A: butuh 6 pcs, stok 5 pcs; Sirup B: butuh 30 ml, stok 20 ml")?.baris).toEqual([
      { nama: "Obat A", butuh: 6, tersedia: 5, satuan: "pcs" },
      { nama: "Sirup B", butuh: 30, tersedia: 20, satuan: "ml" },
    ]);
    // Penolakan database lewat parseClinicPostingError (STOCK_SHORT: <nama>).
    expect(urai("Stok tidak cukup: Obat A")?.baris)
      .toEqual([{ gudang: null, nama: "Obat A", butuh: null, tersedia: null }]);
  });

  it("kasir/POS dan penjualan daring — penolakan polos tanpa rincian", () => {
    expect(urai("Stok tidak cukup")?.baris)
      .toEqual([{ gudang: null, nama: "Barang yang dijual", butuh: null, tersedia: null }]);
  });

  it("pengiriman penjualan grosir menyebut barang dan jumlah perlunya", () => {
    expect(urai("Stok Obat A tidak cukup untuk 12.5 satuan dasar.")?.baris)
      .toEqual([{ gudang: null, nama: "Obat A", butuh: 12.5, tersedia: null, satuan: "satuan dasar" }]);
  });

  it("produksi merek sendiri, koreksi faktur, koreksi stok, dan penyesuaian persediaan", () => {
    expect(urai("Stok bahan tidak cukup")?.baris[0].nama).toBe("Bahan produksi");
    expect(urai("Stok bahan tidak cukup atau jumlah tidak valid")?.baris[0].nama).toBe("Bahan produksi");
    expect(urai("Stok gudang tidak cukup untuk mengurangi qty faktur")?.baris[0].nama).toBe("Barang faktur");
    expect(urai("Stok tidak cukup. Seluruh pengeluaran ini dibatalkan")?.baris[0].nama).toBe("Barang yang dikeluarkan");
    const koreksi = urai("Stok tidak cukup untuk koreksi. Barang sudah terpakai/terjual; rekonsiliasi dependensi dahulu");
    expect(koreksi?.baris[0].nama).toBe("Barang yang dikoreksi");
    expect(koreksi?.petunjuk).toContain("sudah terpakai");
  });
});

describe("pesan yang BUKAN soal kekurangan stok tidak memunculkan popup", () => {
  it.each([
    "Permintaan sudah berstatus Dikirim",
    "Hanya Kepala Gudang / Manajer yang bisa mengirim",
    // Stoknya ada; yang kurang catatan harga pokoknya — "Ubah jumlah" bukan jalan keluarnya.
    "Lapisan stok tidak cukup",
    "Lapisan FIFO tidak cukup untuk koreksi",
    "Lapisan stok Obat A tidak cukup.",
    "Lapisan stok tidak cukup untuk HPP FIFO",
    "Stok/lapisan biaya tidak cukup atau tidak konsisten. Rekonsiliasi diperlukan",
    // Bukan stok barang sama sekali.
    "Saldo poin pelanggan tidak cukup",
    "Rincian pengiriman Obat A tidak cukup untuk alokasi HPP.",
    // Pembatalan penerimaan: tidak ada jumlah yang bisa diubah petugas di layar itu.
    "Stok pembelian langsung tidak cukup untuk pembatalan",
    "",
  ])("%s", (pesan) => {
    expect(uraiKekuranganStok(pesan)).toBeNull();
    expect(adalahKekuranganStok(pesan)).toBe(false);
  });

  it("null dan undefined aman", () => {
    expect(uraiKekuranganStok(null)).toBeNull();
    expect(uraiKekuranganStok(undefined)).toBeNull();
  });
});

describe("pesan lama dan bentuk tak terduga tidak membuat popup salah baca", () => {
  it("angka bergaya Indonesia dari pesan lama tetap terbaca", () => {
    expect(urai("Stok gudang asal tidak cukup. Obat A butuh 1.234,5 ml, tersedia 250 ml. Kurangi kuantitasnya")?.baris[0])
      .toMatchObject({ butuh: 1234.5, tersedia: 250 });
  });

  it("spasi berlebih dan baris baru dirapikan dulu", () => {
    expect(urai("Stok gudang asal tidak cukup.\n  Obat A butuh 500 pcs,  tersedia 250 pcs.")?.baris[0])
      .toMatchObject({ nama: "Obat A", butuh: 500 });
  });

  it("segmen yang tidak dikenali dilewati, bukan menggagalkan seluruh daftar", () => {
    expect(urai("Stok gudang pengirim tidak cukup. Obat A butuh 500 pcs, tersedia 250 pcs; entah apa ini")?.baris)
      .toHaveLength(1);
  });

  it("selubung tanpa daftar yang bisa dibaca tetap menghasilkan satu baris, memakai teks aslinya", () => {
    expect(urai("Stok gudang pengirim tidak cukup. entah apa ini")?.baris)
      .toEqual([{ gudang: "Gudang pengirim", nama: "entah apa ini", butuh: null, tersedia: null }]);
  });
});

describe("penjaga: kalimat 'tidak cukup' baru di database harus ikut diputuskan", () => {
  // Pengurai hanya bisa dipercaya kalau daftar kalimat yang dipakai database tidak
  // diam-diam bertambah. Kalau tes ini gagal, putuskan kalimat barunya: tambahkan ke
  // pengurai (bila soal stok barang) atau ke daftar di bawah beserta alasannya.
  const DIKENAL = [
    "Lapisan FIFO tidak cukup untuk koreksi",
    "Lapisan stok % tidak cukup.",
    "Lapisan stok tidak cukup untuk HPP FIFO",
    "Rincian pengiriman % tidak cukup untuk alokasi HPP.",
    "STOCK_SHORT: obat koreksi tidak cukup",
    "Saldo poin pelanggan tidak cukup",
    "Stok % tidak cukup untuk % satuan dasar.",
    "Stok bahan tidak cukup",
    "Stok bahan tidak cukup atau jumlah tidak valid",
    "Stok gudang asal tidak cukup",
    "Stok gudang asal tidak cukup: % perlu %, tersedia %",
    "Stok gudang pengirim tidak cukup. %. Kurangi jumlah kirim atau tunggu stok masuk",
    "Stok gudang pengirim tidak cukup. %. Turunkan jumlah yang disetujui",
    "Stok gudang tidak cukup untuk mengurangi qty faktur",
    "Stok pembelian langsung tidak cukup untuk pembatalan",
    "Stok tidak cukup",
    "Stok tidak cukup untuk koreksi. Barang sudah terpakai/terjual; rekonsiliasi dependensi dahulu",
    "Stok tidak cukup. Seluruh pengeluaran ini dibatalkan",
    "Stok/lapisan biaya tidak cukup atau tidak konsisten. Rekonsiliasi diperlukan",
  ];

  it("tidak ada kalimat baru yang belum diputuskan", () => {
    const dir = "supabase/migrations";
    const ditemukan = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      for (const m of readFileSync(`${dir}/${file}`, "utf8").matchAll(/'([^']*tidak cukup[^']*)'/g)) {
        ditemukan.add(m[1]);
      }
    }
    expect([...ditemukan].sort()).toEqual([...DIKENAL].sort());
  });
});
