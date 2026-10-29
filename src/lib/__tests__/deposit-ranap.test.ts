import { describe, expect, it } from "vitest";
import {
  AKUN_DEPOSIT_RANAP, bolehBatalDeposit, bolehKelolaDeposit, depositDipakai, depositKasShift,
  jurnalDepositDilepas, jurnalDepositDipakai, jurnalDepositKeluar, jurnalDepositMasuk,
  kelebihanDeposit, periksaJumlahDeposit, pesanErrorDeposit, saldoDeposit, sisaDeposit,
  sisaSetelahDeposit,
} from "../deposit-ranap";

const seimbang = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((a, l) => a + l.debit, 0) === lines.reduce((a, l) => a + l.credit, 0);

describe("jurnal deposit rawat inap", () => {
  it("menerima titipan: kas bertambah, utang ke pemilik bertambah — bukan pendapatan", () => {
    const lines = jurnalDepositMasuk("1101", 500000);
    expect(lines).toEqual([
      { code: "1101", debit: 500000, credit: 0 },
      { code: AKUN_DEPOSIT_RANAP, debit: 0, credit: 500000 },
    ]);
    expect(seimbang(lines)).toBe(true);
    expect(lines.some((l) => l.code.startsWith("4"))).toBe(false);
  });

  it("memakai rekening bank saat metodenya bukan tunai", () => {
    expect(jurnalDepositMasuk("1102", 250000)[0]).toEqual({ code: "1102", debit: 250000, credit: 0 });
  });

  it("pembatalan dan pengembalian sisa memakai jurnal yang sama persis: kebalikan dari terima", () => {
    const lines = jurnalDepositKeluar("1101", 500000);
    expect(lines).toEqual([
      { code: AKUN_DEPOSIT_RANAP, debit: 500000, credit: 0 },
      { code: "1101", debit: 0, credit: 500000 },
    ]);
    expect(seimbang(lines)).toBe(true);
  });

  it("deposit dipakai menutup tagihan tidak menyentuh kas sama sekali", () => {
    const lines = jurnalDepositDipakai(300000);
    expect(lines).toEqual([
      { code: AKUN_DEPOSIT_RANAP, debit: 300000, credit: 0 },
      { code: "1201", debit: 0, credit: 300000 },
    ]);
    expect(seimbang(lines)).toBe(true);
    expect(lines.some((l) => l.code === "1101" || l.code === "1102")).toBe(false);
  });

  it("void tagihan membalik pemakaian: piutang hidup lagi, titipan kembali", () => {
    const pakai = jurnalDepositDipakai(300000);
    const lepas = jurnalDepositDilepas(300000);
    expect(seimbang(lepas)).toBe(true);
    for (const code of [AKUN_DEPOSIT_RANAP, "1201"]) {
      const net = (rows: typeof pakai) => rows.filter((l) => l.code === code).reduce((a, l) => a + l.debit - l.credit, 0);
      expect(net(pakai) + net(lepas)).toBe(0);
    }
  });

  it("nominal nol atau negatif tidak pernah menghasilkan jurnal", () => {
    for (const builder of [jurnalDepositMasuk, jurnalDepositKeluar]) expect(builder("1101", 0)).toEqual([]);
    expect(jurnalDepositDipakai(-5)).toEqual([]);
    expect(jurnalDepositDilepas(0)).toEqual([]);
  });
});

describe("saldo deposit", () => {
  const dep = (p: Partial<{ jumlah: number; terpakai: number; dikembalikan: number; status: string }>) =>
    ({ jumlah: 100000, terpakai: 0, dikembalikan: 0, status: "aktif", ...p });

  it("sisa = jumlah dikurangi yang terpakai dan yang sudah dikembalikan", () => {
    expect(sisaDeposit(dep({ terpakai: 30000, dikembalikan: 10000 }))).toBe(60000);
  });
  it("deposit yang dibatalkan tidak punya sisa", () => {
    expect(sisaDeposit(dep({ status: "batal" }))).toBe(0);
  });
  it("saldo kunjungan menjumlahkan semua deposit aktif", () => {
    expect(saldoDeposit([dep({}), dep({ jumlah: 50000, terpakai: 50000 }), dep({ status: "batal" })])).toBe(100000);
  });
  it("tidak pernah memotong lebih besar daripada tagihannya", () => {
    expect(depositDipakai(500000, 300000)).toBe(300000);
    expect(depositDipakai(100000, 300000)).toBe(100000);
    expect(depositDipakai(-5, 300000)).toBe(0);
  });
  it("kelebihan titipan tetap menjadi saldo pemilik", () => {
    expect(kelebihanDeposit(500000, 300000)).toBe(200000);
    expect(kelebihanDeposit(100000, 300000)).toBe(0);
  });
  it("sisa yang harus dibayar = tagihan dikurangi pembayaran lain dan deposit", () => {
    expect(sisaSetelahDeposit(300000, 50000, 100000)).toBe(150000);
    expect(sisaSetelahDeposit(300000, 0, 400000)).toBe(0);
  });
  it("batal hanya untuk deposit yang belum menempel di tagihan", () => {
    expect(bolehBatalDeposit(dep({}))).toBe(true);
    expect(bolehBatalDeposit(dep({ terpakai: 1 }))).toBe(false);
    expect(bolehBatalDeposit(dep({ dikembalikan: 1 }))).toBe(false);
    expect(bolehBatalDeposit(dep({ status: "batal" }))).toBe(false);
  });
  it("hanya pemilik, admin, dan keuangan yang boleh membatalkan atau mengembalikan", () => {
    expect(["OWNER", "ADMIN", "FINANCE"].every(bolehKelolaDeposit)).toBe(true);
    expect(["DOCTOR", "STAFF", "", null].some(bolehKelolaDeposit)).toBe(false);
  });
});

describe("deposit di kas shift", () => {
  const baris = {
    jumlah: 200000, dikembalikan: 0, metode: "Tunai",
    shift_id: "shift-a", void_shift_id: null as string | null, refund_shift_id: null as string | null,
  };
  it("titipan yang diterima menambah kas shift penerimanya", () => {
    expect(depositKasShift([baris], "shift-a")).toEqual([{ total: 200000, metode_bayar: "Tunai" }]);
  });
  it("shift lain tidak ikut menanggung titipan shift ini", () => {
    expect(depositKasShift([baris], "shift-b")).toEqual([]);
  });
  it("pembatalan mengurangi kas shift yang mengeluarkan uangnya", () => {
    expect(depositKasShift([{ ...baris, shift_id: "shift-a", void_shift_id: "shift-b" }], "shift-b"))
      .toEqual([{ total: -200000, metode_bayar: "Tunai" }]);
  });
  it("pengembalian sisa mengurangi kas sebesar yang benar-benar dikembalikan", () => {
    expect(depositKasShift([{ ...baris, dikembalikan: 75000, refund_shift_id: "shift-a" }], "shift-a"))
      .toEqual([{ total: 200000, metode_bayar: "Tunai" }, { total: -75000, metode_bayar: "Tunai" }]);
  });
  it("deposit yang hanya dipakai menutup tagihan tidak menggerakkan kas shift mana pun", () => {
    expect(depositKasShift([{ ...baris, shift_id: null }], "shift-a")).toEqual([]);
  });
});

describe("validasi dan pesan", () => {
  it("menolak nominal nol, negatif, pecahan sen, dan di atas batas", () => {
    expect(periksaJumlahDeposit(0)).toMatch(/lebih besar dari nol/);
    expect(periksaJumlahDeposit(-100)).toMatch(/lebih besar dari nol/);
    expect(periksaJumlahDeposit("abc")).toMatch(/lebih besar dari nol/);
    expect(periksaJumlahDeposit(100.005)).toMatch(/dua angka/);
    expect(periksaJumlahDeposit(2_000_000_000_000)).toMatch(/batas/);
    expect(periksaJumlahDeposit(150000)).toBeNull();
    expect(periksaJumlahDeposit(1500.25)).toBeNull();
  });
  it("menerjemahkan kode error database ke kalimat kasir", () => {
    expect(pesanErrorDeposit({ message: "DEPOSIT_CLOSED: pasien sudah pulang" })).toMatch(/layar Pembayaran/);
    expect(pesanErrorDeposit({ message: "SHIFT_INVALID: shift klinik aktif tidak ditemukan" })).toMatch(/shift klinik/i);
    expect(pesanErrorDeposit({ message: "DEPOSIT_USED: x" })).toMatch(/void tagihan/i);
    expect(pesanErrorDeposit(null)).toMatch(/belum tersimpan/i);
  });
});
