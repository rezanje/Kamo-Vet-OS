// Tanggal efektif "Batalkan penerimaan" klinik: kalimat pratinjau/hasil, pesan penolakan, daftar izin khusus sinkron dengan migrasi.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pesanBatalPenerimaan, ringkasanHasil, ringkasanPratinjau, ringkasanTanggalMundur, type HasilBatal, type PratinjauBatal } from "../batal-penerimaan-pesan";
import { parseClinicPostingError } from "../klinik-posting";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction } from "../role-grant-only-actions";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261115100000_batalkan_penerimaan_klinik_tanggal_efektif.sql"), "utf8");
const P = { refuse: null, invoice: { id: "i", no: "INV-9", total: 63000, paid_status: "Lunas", metode_bayar: "QRIS", dp_amount: 0, shift_id: null, visit_id: "v", branch_id: null }, direct: { amount: 108000, kas_code: "120002", metode: "QRIS" }, payments: [], apps: [], receipts: [], actor: "OWNER", cash_amount: 0, shift_mode: "nonkas", today: "2026-11-12" } as unknown as PratinjauBatal;

describe("kalimat tanggal pembukuan", () => {
  it("tanpa tanggal atau hari ini: tidak ada kalimat tanggal sama sekali", () => {
    for (const t of [undefined, null, "2026-11-12"]) {
      const r = ringkasanPratinjau(P, t).join("\n");
      expect(r).not.toContain("Dicatat di tanggal"); expect(r).not.toMatch(/mundur|efektif|Tetap HARI INI/i);
    }
  });
  it("tanggal diubah: satu kalimat pendek (dicatat di tanggal itu, uang fisik tetap hari ini)", () => {
    const r = ringkasanPratinjau(P, "2026-11-09").join("\n");
    expect(r).toContain("Dicatat di tanggal 2026-11-09; uang fisik tetap hari ini."); expect(r).not.toMatch(/mundur|efektif|Tetap HARI INI/i);
    expect(ringkasanTanggalMundur("2026-11-09")).toEqual(["Dicatat di tanggal 2026-11-09; uang fisik tetap hari ini."]);
  });
  it("hasil dengan tanggal diubah menyebut satu kalimat; hasil biasa tidak", () => {
    const h = { status: "CANCELLED", invoice_no: "INV-9", amount: 108000, paid_status: "Belum Lunas", shift_mode: "nonkas", receipts: [], other_invoices_unpaid: [], applications_released: 0, tanggal: "2026-11-09", effective_date: "2026-11-09", actual_date: "2026-11-12", backdated: true } as unknown as HasilBatal;
    expect(ringkasanHasil(h).join("\n")).toContain("Dicatat di tanggal 2026-11-09; uang fisik tetap hari ini.");
    expect(ringkasanHasil({ ...h, backdated: false }).join("\n")).not.toContain("Dicatat di tanggal");
  });
});
describe("pesan penolakan", () => {
  it("penolakan tanggal dari database diteruskan dalam bahasa biasa", () => {
    expect(pesanBatalPenerimaan("BATAL_PENERIMAAN_TANGGAL_SEBELUM_PENERIMAAN: Tanggal efektif 2026-11-01 lebih awal dari tanggal penerimaan asli (2026-11-09). Pilih tanggal 2026-11-09 atau sesudahnya.")).toMatch(/lebih awal dari tanggal penerimaan asli/);
    expect(pesanBatalPenerimaan("BATAL_PENERIMAAN_GAJI_SUDAH_DIBUAT: Penggajian untuk bulan 2026-11 sudah dibuat.")).toMatch(/Penggajian/);
  });
  it("periode terkunci: petunjuk Tutup Buku dari database tidak diberi tambahan 'hubungi Finance' ganda; pesan lama tetap", () => {
    const m = pesanBatalPenerimaan("BATAL_PENERIMAAN_PERIODE_TERKUNCI: Periode akuntansi sampai 2026-11-09 sudah ditutup. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku.");
    expect(m).toMatch(/Tutup Buku/); expect(m).not.toMatch(/Hubungi Finance/);
    expect(pesanBatalPenerimaan("PERIODE_TERKUNCI: periode akuntansi sampai 2026-11-09 sudah ditutup; pembalikan hari ini (2026-11-12) tidak bisa dibukukan")).toMatch(/Hubungi Finance untuk membuka periode/);
    expect(pesanBatalPenerimaan("BACKDATE_TIDAK_ADA: x")).toMatch(/tidak memakai tanggal pembukuan lain/);
  });
  it("koreksi tagihan / penerimaan ulang: penolakan tanggal efektif terbaca jelas (bukan pesan umum)", () => {
    const err = (message: string) => ({ code: "P0001", message });
    expect(parseClinicPostingError(err("PERIODE_TERKUNCI: periode akuntansi sampai 2026-11-09 sudah ditutup, jadi tanggal 2026-11-09 tidak bisa dibukukan. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku, atau pilih tanggal setelah 2026-11-09"))).toMatch(/Tutup Buku.*Belum ada yang tersimpan/);
    expect(parseClinicPostingError(err("PERSEDIAAN_TERKUNCI: periode persediaan sampai 2026-11-09 sudah ditutup"))).toMatch(/persediaan/);
    expect(parseClinicPostingError(err("BACKDATE_CAMPUR: uang ini akan melunasi tagihan dengan tanggal efektif yang berbeda"))).toMatch(/tanggal efektif yang berbeda/);
    expect(parseClinicPostingError(err("BACKDATE_SISA: nominal melebihi sisa tagihan bertanggal efektif"))).toMatch(/melebihi sisa/);
  });
});
describe("izin khusus tanggal mundur", () => {
  it("terdaftar sebagai izin khusus (bawaan mati) dan sinkron dengan baris katalog migrasi (id, enforced, modul klinik)", () => {
    expect(GRANT_ONLY_ACTIONS).toContain("klinik.batalkan_penerimaan_tanggal"); expect(isGrantOnlyAction("klinik.batalkan_penerimaan_tanggal")).toBe(true);
    expect(sql).toMatch(/action_catalog\(id, label, "group", enforced\)\s*values \('klinik\.batalkan_penerimaan_tanggal', '[^']*', 'Klinik', true\)/);
    expect(sql).toMatch(/action_modules\(id, module_id\)\s*values \('klinik\.batalkan_penerimaan_tanggal', 'klinik'\)/);
    for (const id of GRANT_ONLY_ACTIONS.filter((x) => x.startsWith("klinik."))) expect(sql + readFileSync(join(process.cwd(), "supabase/migrations/20261112100000_batalkan_penerimaan_klinik.sql"), "utf8")).toContain(`'${id}'`);
  });
  it("migrasi tanpa begin/commit sendiri dan semua tambalan berjangkar memakai penanda BACKDATE_KLINIK", () => {
    expect(sql.split("\n").filter((l) => ["begin;", "commit;"].includes(l.trim().toLowerCase()))).toEqual([]);
    expect((sql.match(/BACKDATE_KLINIK/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
});
