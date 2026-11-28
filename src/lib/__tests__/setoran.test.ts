import { describe, expect, it } from "vitest";
import { BIDANG_KEUANGAN, bacaDaftar, bacaDetail, bacaRekap, barisExcel, basisAman, bisaDiedit, bolehVoid, isPemutus, isPenyetuju, labelPeriode, pesanSetoran, periodeBawaan, rp, tanggalPanjang, warnaBadge } from "../setoran";

const dasar = () => ({
  id: "11111111-1111-4111-8111-111111111111", no_setoran: "SET-2026-0001", branch_id: "b1", cabang: "Toko A", periode_mulai: "2026-11-06", periode_selesai: "2026-11-08", jadwal: "2026-11-09", batas_jam: "12:00",
  status: "Draft", revision: 3, penyetuju: false, pemutus: false, catatan: null, kewajiban: 3000000, pengeluaran: 1000000, transfer: 0, sisa: 2000000, persen: 33,
  harian: [{ tanggal: "2026-11-06", total: 1000000 }, { tanggal: "2026-11-07", total: 1200000 }, { tanggal: "2026-11-08", total: 800000 }], shift_baru: 0, dibuat_oleh: "Rina", diajukan_oleh: null, diajukan_at: null,
  alasan_tolak: null, shift: [], pengeluaran_shift: [], pengeluaran_baris: [], transfer_baris: [], riwayat: [], badge: "Belum lunas", status_periode: "Aktif", terlambat: false,
});
const keu = () => ({ diharapkan: 2000000, bersih_shift: 3000000, pengeluaran_setoran: 1000000, transfer_dikonfirmasi: 2100000, transfer_menunggu: 0, selisih_sementara: 100000, selisih: null, jenis: null, penjelasan_lebih: null, penyelesaian: null, journal_id: null, pembalik_journal_id: null, catatan_keuangan: null, penanggung_otomatis: [], kasbon: [], rincian_shift: [] });

describe("bacaDetail — privasi staf", () => {
  it("angka referensi Andri terbaca apa adanya", () => {
    const d = bacaDetail(dasar());
    expect([d.kewajiban, d.pengeluaran, d.transfer, d.sisa, d.persen]).toEqual([3000000, 1000000, 0, 2000000, 33]);
    expect(d.harian.reduce((a, h) => a + h.total, 0)).toBe(3000000);
  });
  it("staf: bagian keuangan diabaikan sekalipun server salah mengirimnya", () => {
    const d = bacaDetail({ ...dasar(), penyetuju: false, keuangan: keu() });
    expect(d.keuangan).toBeUndefined();
    for (const k of BIDANG_KEUANGAN) expect(Object.keys(d)).not.toContain(k);
    expect(JSON.stringify(d)).not.toContain("100000,");
  });
  it("penyetuju: bagian keuangan dibaca", () => {
    const d = bacaDetail({ ...dasar(), penyetuju: true, status: "Diajukan", keuangan: keu() });
    expect(d.keuangan?.selisih_sementara).toBe(100000);
    expect(d.keuangan?.diharapkan).toBe(2000000);
  });
  it("sisa negatif dipatok 0 dan persen dipatok 100", () => {
    const d = bacaDetail({ ...dasar(), sisa: -50000, persen: 140 });
    expect(d.sisa).toBe(0); expect(d.persen).toBe(100);
  });
  it("menolak bentuk tak dikenal dan status liar", () => {
    expect(() => bacaDetail(null)).toThrow(); expect(() => bacaDetail([])).toThrow();
    expect(() => bacaDetail({ ...dasar(), status: "Lunas" })).toThrow(/Status/);
    expect(() => bacaDetail({ ...dasar(), kewajiban: "abc" })).toThrow(/tidak lengkap/);
    expect(() => bacaDetail({ ...dasar(), transfer_baris: [{ id: "t", tanggal: "2026-11-09", jumlah: 1, status: "Aneh" }] })).toThrow(/transfer/);
  });
  it("lampiran dengan path berbahaya dibuang", () => {
    const d = bacaDetail({ ...dasar(), pengeluaran_baris: [{ id: "p", tanggal: "2026-11-07", kategori: "ATK", jumlah: 5, lampiran: [{ path: "../x", nama: "a" }, { path: "/abs", nama: "b" }, { path: "setoran/b1/ok.jpg", nama: "ok" }] }] });
    expect(d.pengeluaran_baris[0].lampiran.map((l) => l.path)).toEqual(["setoran/b1/ok.jpg"]);
  });
});

describe("bacaDaftar / bacaRekap", () => {
  const baris = { id: "i", no_setoran: "S1", branch_id: "b", cabang: "A", periode_mulai: "2026-11-06", periode_selesai: "2026-11-08", jadwal: "2026-11-09", batas_jam: "12:00", status: "Diajukan", kewajiban: 10, pengeluaran: 0, transfer: 10, sisa: 0, transfer_menunggu: 0, umur_hari: 2, badge: "Menunggu persetujuan", status_periode: "Aktif", terlambat: false, dibuat_oleh: "R", diharapkan: 10, selisih_sementara: 5, selisih: null, jenis: null, penyelesaian: null };
  it("staf tidak menerima kolom selisih walau ada di payload", () => {
    const r = bacaDaftar({ penyetuju: false, baris: [baris] });
    expect(r.baris[0].selisih_sementara).toBeUndefined(); expect(r.baris[0].diharapkan).toBeUndefined();
  });
  it("penyetuju menerima kolom selisih", () => {
    const r = bacaDaftar({ penyetuju: true, baris: [baris] });
    expect(r.baris[0].selisih_sementara).toBe(5);
  });
  it("rekap", () => {
    const o = { jumlah: 1, menunggu: 1, terlambat: 0, kewajiban: 10, pengeluaran: 0, diharapkan: 10, disetor: 10, kurang: 0, lebih: 3 };
    const r = bacaRekap({ cabang: [{ branch_id: "b", cabang: "A", ...o }], total: o, umur_menunggu: { hari_0_1: 1, hari_2_3: 0, hari_4_7: 0, hari_8_plus: 0 }, menunggu_persetujuan: 1, terlambat: 0 });
    expect(r.total.lebih).toBe(3); expect(r.cabang).toHaveLength(1);
    expect(() => bacaRekap({})).toThrow();
  });
  it("penyetuju menerima penanda pengeluaran_melebihi; staf tidak (walau dikirim)", () => {
    const ada = bacaDaftar({ penyetuju: true, baris: [{ ...baris, pengeluaran_melebihi: true }] });
    expect(ada.baris[0].pengeluaran_melebihi).toBe(true);
    const staf = bacaDaftar({ penyetuju: false, baris: [{ ...baris, pengeluaran_melebihi: true }] });
    expect(staf.baris[0].pengeluaran_melebihi).toBeUndefined();
  });
  it("kolom keuangan baru (peringatan, pengeluaran_melebihi) tercatat sebagai bidang terlarang untuk staf", () => {
    expect(BIDANG_KEUANGAN).toContain("peringatan"); expect(BIDANG_KEUANGAN).toContain("pengeluaran_melebihi");
  });
  it("Excel: setoran Draft/Ditolak belum dihitung -> selisih dikosongkan, bukan 0 (tampak pas)", () => {
    const { baris: b } = barisExcel(bacaDaftar({ penyetuju: true, baris: [{ ...baris, status: "Draft", selisih_sementara: undefined, diharapkan: 10 }, { ...baris, status: "Ditolak", diharapkan: 10, selisih_sementara: 5 }] }).baris);
    expect(b[0][10]).toBe(""); expect(b[1][10]).toBe("");
  });
  it("Excel: satu baris per setoran, selisih memakai sementara bila belum final", () => {
    const { judul, baris: b } = barisExcel(bacaDaftar({ penyetuju: true, baris: [baris] }).baris);
    expect(b).toHaveLength(1); expect(b[0]).toHaveLength(judul.length); expect(b[0][10]).toBe(5);
  });
});

describe("peran dan tampilan", () => {
  it("penyetuju termasuk ADMIN_UMUM; void hanya Owner/Finance", () => {
    for (const r of ["OWNER", "FINANCE", "ADMIN", "ADMIN_UMUM"]) expect(isPenyetuju(r)).toBe(true);
    for (const r of ["STAFF", "DOCTOR", "ADMIN_ONLINE", "", null, undefined]) expect(isPenyetuju(r as string)).toBe(false);
    expect(bolehVoid("OWNER")).toBe(true); expect(bolehVoid("FINANCE")).toBe(true); expect(bolehVoid("ADMIN")).toBe(false); expect(bolehVoid("ADMIN_UMUM")).toBe(false);
  });
  it("SETORAN-FINANCE-ONLY: pemutus (setujui/tolak/konfirmasi transfer) hanya Owner dan Finance; Admin/Admin Umum tetap penyetuju (baca)", () => {
    for (const r of ["OWNER", "FINANCE"]) expect(isPemutus(r)).toBe(true);
    for (const r of ["ADMIN", "ADMIN_UMUM", "STAFF", "DOCTOR", "ADMIN_ONLINE", "", null, undefined]) expect(isPemutus(r as string)).toBe(false);
    expect(isPenyetuju("ADMIN")).toBe(true); expect(isPenyetuju("ADMIN_UMUM")).toBe(true);
  });
  it("bacaDetail: pemutus hanya benar bila server mengirim penyetuju dan pemutus keduanya benar", () => {
    expect(bacaDetail({ ...dasar(), penyetuju: true, pemutus: true }).pemutus).toBe(true);
    expect(bacaDetail({ ...dasar(), penyetuju: true, pemutus: false }).pemutus).toBe(false);
    expect(bacaDetail({ ...dasar(), penyetuju: true }).pemutus).toBe(false);
    expect(bacaDetail({ ...dasar(), penyetuju: false, pemutus: true }).pemutus).toBe(false);
  });
  it("rupiah, tanggal, periode", () => {
    expect(rp(3000000)).toBe("Rp3.000.000"); expect(rp(-1000000)).toBe("-Rp1.000.000");
    expect(tanggalPanjang("2026-11-09")).toBe("Senin, 9 November 2026");
    expect(labelPeriode("2026-11-06", "2026-11-08")).toBe("Jumat – Minggu"); expect(labelPeriode("2026-11-06", "2026-11-06")).toBe("Jumat");
  });
  it("periode bawaan: Jumat–Minggu lalu, jadwal Senin", () => {
    expect(periodeBawaan("2026-11-09")).toEqual({ mulai: "2026-11-06", selesai: "2026-11-08", jadwal: "2026-11-09" });
    expect(periodeBawaan("2026-11-11")).toEqual({ mulai: "2026-11-06", selesai: "2026-11-08", jadwal: "2026-11-09" });
    expect(periodeBawaan("2026-11-08").selesai).toBe("2026-11-01");
  });
  it("badge, suntingan, alamat aman, pesan galat", () => {
    expect(warnaBadge("Lunas").fg).toBe("#166534"); expect(warnaBadge("Terlambat").fg).toBe("#991b1b"); expect(warnaBadge("Belum lunas").fg).toBe("#9a3412");
    expect(bisaDiedit("Draft")).toBe(true); expect(bisaDiedit("Ditolak")).toBe(true); expect(bisaDiedit("Diajukan")).toBe(false); expect(bisaDiedit("Disetujui")).toBe(false); expect(bisaDiedit("Void")).toBe(false);
    expect(basisAman("/kasir/setoran")).toBe("/kasir/setoran"); expect(basisAman("https://evil.example")).toBe("/kas-bank/setoran"); expect(basisAman(null)).toBe("/kas-bank/setoran");
    expect(pesanSetoran("SETORAN_ALASAN: alasan wajib")).toBe("alasan wajib"); expect(pesanSetoran("ADMIN_ONLINE_FUNCTION_DENIED x")).toMatch(/Admin Online/); expect(pesanSetoran("lain")).toBe("lain");
  });
});
