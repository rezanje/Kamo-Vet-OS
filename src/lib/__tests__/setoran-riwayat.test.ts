import { describe, expect, it } from "vitest";
import { bacaSaringanRiwayat, hitungRiwayat, labelSelisihSetor, pilihCabangRiwayat, type BarisKas, type ShiftTutup } from "@/lib/setoran-riwayat";

const kas = (tanggal: string, source: string, debit: number, credit: number): BarisKas => ({ tanggal, source, debit, credit });
const shift = (closed_at: string, opening_balance: number, closing_balance: number): ShiftTutup => ({ closed_at, opening_balance, closing_balance });
const dasar = (): { shifts: ShiftTutup[]; baris: BarisKas[] } => ({
  shifts: [shift("2026-11-01T10:00:00Z", 0, 1000000), shift("2026-11-02T10:00:00Z", 100000, 700000), shift("2026-11-03T10:00:00Z", 0, 500000)],
  baris: [
    kas("2026-11-01", "sale", 1000000, 0), kas("2026-11-01", "expense", 0, 40000), kas("2026-11-01", "transfer", 0, 900000),
    kas("2026-11-02", "sale", 600000, 0), kas("2026-11-02", "transfer", 0, 700000), kas("2026-11-02", "expense-reversal", 10000, 0),
    kas("2026-11-03", "sale", 500000, 0), kas("2026-11-03", "transfer", 50000, 0),
  ],
});

describe("hitungRiwayat — per hari", () => {
  it("tutup shift − pengeluaran = harus disetor; selisih = ditransfer − harus; kumulatif berjalan", () => {
    const d = dasar();
    const { hari } = hitungRiwayat({ dari: "2026-11-01", sampai: "2026-11-30", ...d, saldoAwal: 0 });
    expect(hari.map((h) => h.tanggal)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(hari[0]).toMatchObject({ tutupShift: 1000000, pengeluaran: 40000, harusDisetor: 960000, sudahDitransfer: 900000, selisihHarian: -60000, kumulatif: -60000 });
    // hari 2: shift 700000−100000=600000; pengeluaran 0−10000 (pembalik) = −10000 → harus 610000; transfer 700000 → +90000
    expect(hari[1]).toMatchObject({ tutupShift: 600000, pengeluaran: -10000, harusDisetor: 610000, sudahDitransfer: 700000, selisihHarian: 90000, kumulatif: 30000 });
    expect(hari[2].kumulatif).toBe(30000 + (-50000 - 500000));
  });

  it("transfer MASUK (debit) bernilai negatif dan menambah kekurangan setor", () => {
    const { hari, ringkasan } = hitungRiwayat({ dari: "2026-11-03", sampai: "2026-11-03", ...dasar(), saldoAwal: 0 });
    expect(hari).toHaveLength(1);
    expect(hari[0].sudahDitransfer).toBe(-50000);
    expect(hari[0].selisihHarian).toBe(-550000);
    expect(ringkasan.totalDitransfer).toBe(-50000);
  });

  it("pembalik transfer (transfer-reversal) mengurangi transfer; sumber lain tidak dihitung sebagai transfer", () => {
    const { hari } = hitungRiwayat({
      dari: "2026-11-05", sampai: "2026-11-05", shifts: [],
      baris: [kas("2026-11-05", "transfer", 0, 1000000), kas("2026-11-05", "transfer-reversal", 400000, 0), kas("2026-11-05", "purchase-pay", 0, 250000)], saldoAwal: 0,
    });
    expect(hari[0].sudahDitransfer).toBe(600000);
    expect(hari[0].saldoBukuAkhir).toBe(-850000);
  });

  it("saldo Buku Besar akhir hari = saldo awal + semua mutasi sampai hari itu (semua sumber)", () => {
    const { hari, ringkasan } = hitungRiwayat({ dari: "2026-11-01", sampai: "2026-11-30", ...dasar(), saldoAwal: 3391500 });
    expect(hari.map((h) => h.saldoBukuAkhir)).toEqual([3451500, 3361500, 3911500]);
    expect(ringkasan.saldoAkhir).toBe(hari[2].saldoBukuAkhir);
  });

  it("batas hari Asia/Jakarta: shift tutup 00:30 WIB jatuh di hari WIB itu, bukan hari UTC sebelumnya", () => {
    const { hari } = hitungRiwayat({
      dari: "2026-11-27", sampai: "2026-11-28", baris: [],
      shifts: [
        shift("2026-11-26T16:59:59Z", 0, 111), // 26 Nov 23:59:59 WIB → di luar rentang
        shift("2026-11-26T17:00:00Z", 0, 1000), // 27 Nov 00:00:00 WIB
        shift("2026-11-27T16:59:59Z", 0, 2000), // 27 Nov 23:59:59 WIB
        shift("2026-11-27T17:00:00Z", 0, 4000), // 28 Nov 00:00:00 WIB
        shift("2026-11-28T17:00:00Z", 0, 8000), // 29 Nov WIB → di luar rentang
      ], saldoAwal: 0,
    });
    expect(hari.map((h) => [h.tanggal, h.tutupShift])).toEqual([["2026-11-27", 3000], ["2026-11-28", 4000]]);
  });

  it("baris di luar rentang diabaikan; hari tanpa kegiatan tidak muncul; kosong tidak error", () => {
    const k = hitungRiwayat({ dari: "2026-12-01", sampai: "2026-12-31", ...dasar(), saldoAwal: 5 });
    expect(k.hari).toEqual([]);
    expect(k.ringkasan).toMatchObject({ totalHarusDisetor: 0, totalDitransfer: 0, kumulatif: 0, saldoAwal: 5, saldoAkhir: 5, kasSeharusnya: 0, selisihBuku: 5 });
  });

  it("shift tanpa waktu tutup yang terbaca diabaikan", () => {
    const { hari } = hitungRiwayat({ dari: "2026-11-01", sampai: "2026-11-30", shifts: [shift("bukan-tanggal", 0, 999)], baris: [], saldoAwal: 0 });
    expect(hari).toEqual([]);
  });

  it("angka string dari basis data (numeric) terbaca, desimal sen tidak menumpuk", () => {
    const { hari } = hitungRiwayat({
      dari: "2026-11-01", sampai: "2026-11-01", shifts: [shift("2026-11-01T05:00:00Z", "0.10" as unknown as number, "0.40" as unknown as number)],
      baris: [{ tanggal: "2026-11-01", source: "expense", debit: "0" as unknown as number, credit: "0.1" as unknown as number }, { tanggal: "2026-11-01", source: "expense", debit: "0" as unknown as number, credit: "0.2" as unknown as number }], saldoAwal: 0,
    });
    expect(hari[0].tutupShift).toBe(0.3);
    expect(hari[0].pengeluaran).toBe(0.3);
    expect(hari[0].harusDisetor).toBe(0);
  });
});

describe("hitungRiwayat — ringkasan dan uraian selisih", () => {
  it("total dan kumulatif cocok dengan jumlah per hari; positif = kelebihan setor", () => {
    const { hari, ringkasan: r } = hitungRiwayat({ dari: "2026-11-01", sampai: "2026-11-30", ...dasar(), saldoAwal: 0 });
    expect(r.totalHarusDisetor).toBe(hari.reduce((a, h) => a + h.harusDisetor, 0));
    expect(r.totalDitransfer).toBe(hari.reduce((a, h) => a + h.sudahDitransfer, 0));
    expect(r.kumulatif).toBe(hari[hari.length - 1].kumulatif);
    expect(r.kumulatif).toBe(r.totalDitransfer - r.totalHarusDisetor);
    expect(r.kasSeharusnya).toBe(r.totalHarusDisetor - r.totalDitransfer);
    expect(labelSelisihSetor(r.kumulatif)).toBe("Kekurangan setor");
    expect(labelSelisihSetor(5)).toBe("Kelebihan setor");
    expect(labelSelisihSetor(0)).toBe("Pas");
  });

  it("uraian selisih selalu berjumlah sama dengan selisih Buku Besar − seharusnya (semua jenis sumber jurnal)", () => {
    const baris: BarisKas[] = [
      kas("2026-11-01", "saldo-awal-cabang", 3391500, 0), kas("2026-11-01", "sale", 2000000, 0), kas("2026-11-01", "expense", 0, 100000),
      kas("2026-11-01", "transfer", 0, 1500000), kas("2026-11-02", "purchase-pay", 0, 518000), kas("2026-11-02", "manual", 0, 281297),
      kas("2026-11-02", "manual-reversal", 300, 0), kas("2026-11-02", "manual-correction", 0, 50), kas("2026-11-03", "shift", 0, 70000),
      kas("2026-11-03", "shift-reversal", 70000, 0), kas("2026-11-03", "sale-receipt-cancel", 0, 120000), kas("2026-11-03", "sale-receipt-repost", 90000, 0),
      kas("2026-11-03", "opname", 1234, 0), kas("2026-11-04", "setoran", 0, 777),
    ];
    const { ringkasan: r } = hitungRiwayat({ dari: "2026-11-01", sampai: "2026-11-30", shifts: [shift("2026-11-01T12:00:00Z", 0, 1900000)], baris, saldoAwal: 250000 });
    const jumlah = r.penjelasan.reduce((a, p) => a + p.jumlah, 0);
    expect(Math.round(jumlah * 100)).toBe(Math.round(r.selisihBuku * 100));
    const kode = Object.fromEntries(r.penjelasan.map((p) => [p.kode, p.jumlah]));
    expect(kode.awal).toBe(250000);
    expect(kode.penjualan).toBe(2000000 - 1900000);
    expect(kode.pembelian).toBe(-518000);
    expect(kode.manual).toBe(-281297 + 300 - 50);
    expect(kode.shift).toBe(0);
    expect(kode.penerimaan).toBe(-120000 + 90000);
    expect(kode.lain).toBe(3391500 + 1234 - 777);
  });

  it("angka hosted CMGG 1–27 Nov 2026 (dari kueri langsung): harus disetor 44.173.500, ditransfer 37.519.000, saldo akhir 1.484.255", () => {
    const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
    // Total per sumber dari hosted (jurnal akun 110007, cabang CMGG, s.d. 27 Nov). Satu baris per sumber cukup: rumusnya linear.
    const baris: BarisKas[] = [
      kas("2026-10-31", "saldo-awal-cabang", 3391500, 0),
      kas("2026-11-15", "expense", 0, 2060744.5), kas("2026-11-15", "expense-correction", 0, 301500), kas("2026-11-15", "expense-reversal", 47244.5, 0),
      kas("2026-11-15", "manual", 0, 281297), kas("2026-11-15", "manual-reversal", 300, 0), kas("2026-11-15", "purchase-pay", 0, 1615000),
      kas("2026-11-15", "sale", 38373536, 0), kas("2026-11-15", "sale-receipt-cancel", 0, 1274003), kas("2026-11-15", "sale-receipt-repost", 2442222, 0),
      kas("2026-11-15", "shift", 1971726.5, 1416018), kas("2026-11-15", "shift-reversal", 1416018, 1690729.5), kas("2026-11-15", "transfer", 8622300, 46141300),
    ];
    const { ringkasan: r } = hitungRiwayat({ dari: "2026-11-01", sampai: "2026-11-27", shifts: [shift("2026-11-15T05:00:00Z", 0, 46488500)], baris: baris.filter((b) => b.tanggal !== "2026-10-31"), saldoAwal: 3391500 });
    expect(r.totalPengeluaran).toBe(2315000);
    expect(r.totalDitransfer).toBe(37519000);
    expect(r.totalTutupShift).toBe(46488500);
    expect(r.totalHarusDisetor).toBe(44173500);
    expect(r.saldoAkhir).toBe(1484255);
    expect(sum(r.penjelasan.map((p) => p.jumlah))).toBeCloseTo(r.selisihBuku, 2);
  });
});

describe("pilihCabangRiwayat dan bacaSaringanRiwayat", () => {
  const cab = [{ id: "a", name: "Toko A", type: "PETSHOP" }, { id: "k", name: "Klinik K", type: "KLINIK" }, { id: "b", name: "Toko B", type: "PETSHOP" }];
  it("hanya toko; bawaan cabang aktif; permintaan sah menang; id asing jatuh ke bawaan", () => {
    expect(pilihCabangRiwayat(cab, null, "b").terpilih?.id).toBe("b");
    expect(pilihCabangRiwayat(cab, "a", "b").terpilih?.id).toBe("a");
    expect(pilihCabangRiwayat(cab, "k", "k").terpilih?.id).toBe("a"); // klinik bukan pilihan
    expect(pilihCabangRiwayat(cab, "zzz", null).terpilih?.id).toBe("a");
    expect(pilihCabangRiwayat(cab, null, null).daftar.map((c) => c.id)).toEqual(["a", "b"]);
    expect(pilihCabangRiwayat([cab[1]], null, null).terpilih).toBeNull();
  });
  it("bawaan 1 November s/d hari ini; tanggal tak sah dibuang; Dari > Sampai dirapikan; rentang maks 366 hari", () => {
    expect(bacaSaringanRiwayat({}, "2026-11-28")).toEqual({ dari: "2026-11-01", sampai: "2026-11-28", cabang: null, dipotong: false });
    expect(bacaSaringanRiwayat({ dari: "2026-02-31", sampai: "abc" }, "2026-11-28")).toMatchObject({ dari: "2026-11-01", sampai: "2026-11-28" });
    expect(bacaSaringanRiwayat({ dari: "2026-11-20", sampai: "2026-11-10" }, "2026-11-28")).toMatchObject({ dari: "2026-11-10", sampai: "2026-11-10" });
    expect(bacaSaringanRiwayat({ sampai: "2027-01-01" }, "2026-11-28").sampai).toBe("2026-11-28");
    const lama = bacaSaringanRiwayat({ dari: "2020-01-01", sampai: "2026-11-28" }, "2026-11-28");
    expect(lama.dipotong).toBe(true); expect(lama.dari).toBe("2025-11-28");
    expect(bacaSaringanRiwayat({ cabang: "bukan-uuid" }, "2026-11-28").cabang).toBeNull();
    expect(bacaSaringanRiwayat({ cabang: "130cc8e2-e613-4f54-8aef-49cdb2646c6a" }, "2026-11-28").cabang).toBe("130cc8e2-e613-4f54-8aef-49cdb2646c6a");
  });
});
