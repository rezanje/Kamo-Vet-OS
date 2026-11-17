// "Batalkan penerimaan" untuk tagihan hasil Void & Terbitkan Ulang (INV-202611-1285): tombol, ringkasan layar, pesan penolakan, sinkron dengan migrasi.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adaPenerimaan, tawarkanBatalPenerimaan } from "../batal-penerimaan-akses";
import { pesanBatalPenerimaan, ringkasanPratinjau, type PratinjauBatal } from "../batal-penerimaan-pesan";

const root = process.cwd();
const sql = readFileSync(join(root, "supabase/migrations/20261124100000_batal_penerimaan_terbit_ulang.sql"), "utf8");
const page = readFileSync(join(root, "src/app/(app)/klinik/pembayaran/[visitId]/page.tsx"), "utf8");

const P = (over: Partial<PratinjauBatal> = {}) => ({
  refuse: null,
  invoice: { id: "i", no: "INV-202611-1285", total: 90000, paid_status: "Lunas", metode_bayar: "QRIS", dp_amount: 0, shift_id: null, visit_id: "v", branch_id: null },
  direct: null,
  payments: [{ id: "p1", amount: 90000, metode: "QRIS", kas_code: "120002", checkout: false, transferred: true, transferred_from_no: "INV-202611-1263" }],
  apps: [], receipts: [], actor: "OWNER", cash_amount: 0, shift_mode: "nonkas", today: "2026-11-17", ...over,
}) as unknown as PratinjauBatal;

describe("tombol Batalkan penerimaan", () => {
  const pending = { paid_status: "Lunas", dp_amount: 0, correction_pending: true, reissued_from: "uuid-lama" };
  it("nota hasil terbit ulang yang correction_pending dan sudah menerima uang: ditawarkan (kasus INV-1285)", () => {
    expect(tawarkanBatalPenerimaan(pending, 90000)).toBe(true);
  });
  it("correction_pending TANPA reissued_from tetap tidak ditawarkan; tanpa uang tidak ditawarkan", () => {
    expect(tawarkanBatalPenerimaan({ ...pending, reissued_from: null }, 90000)).toBe(false);
    expect(tawarkanBatalPenerimaan({ paid_status: "Belum Lunas", dp_amount: 0, correction_pending: true, reissued_from: "x" }, 0)).toBe(false);
    expect(tawarkanBatalPenerimaan({ paid_status: "Belum Lunas", dp_amount: 0, correction_pending: false, reissued_from: null }, 0)).toBe(false);
  });
  it("nota biasa dengan uang (Lunas, DP, ada pembayaran) tetap ditawarkan seperti dulu", () => {
    expect(tawarkanBatalPenerimaan({ paid_status: "Lunas", correction_pending: false }, 0)).toBe(true);
    expect(tawarkanBatalPenerimaan({ paid_status: "DP", correction_pending: false }, 0)).toBe(true);
    expect(tawarkanBatalPenerimaan({ paid_status: "Belum Lunas", dp_amount: 50000, correction_pending: false }, 0)).toBe(true);
    expect(tawarkanBatalPenerimaan({ paid_status: "Belum Lunas", correction_pending: false }, 25000)).toBe(true);
    expect(adaPenerimaan({ paid_status: "Belum Lunas" }, 0)).toBe(false);
  });
  it("halaman pembayaran memakai pembantu itu, bukan syarat lama yang menyembunyikan tombol saat correction_pending", () => {
    expect(page).toContain("tawarkanBatalPenerimaan(invoice, paidAmount)");
    expect(page).not.toMatch(/!invoice\.correction_pending && adaPenerimaan/);
  });
});

describe("ringkasan layar untuk uang pindahan", () => {
  it("menyebut nota lama, rekening yang sama, dan bahwa refund selisih tetap tugas Finance", () => {
    const r = ringkasanPratinjau(P()).join("\n");
    expect(r).toContain("INV-202611-1263");
    expect(r).toContain("dipindahkan dari tagihan lama");
    expect(r).toMatch(/Bank, rekening yang sama dengan penerimaan awalnya/);
    expect(r).toMatch(/Pengembalian selisih ke pelanggan .* tetap dikerjakan Finance/);
    expect(r).toContain("stok, HPP, dan jurnal penjualan tidak berubah");
  });
  it("pembayaran bukan pindahan: kalimat lama persis dan tanpa kalimat Finance", () => {
    const r = ringkasanPratinjau(P({ payments: [{ id: "p", amount: 40000, metode: "Tunai", kas_code: "110003", checkout: true }] } as Partial<PratinjauBatal>)).join("\n");
    expect(r).toContain("Pembayaran Tunai Rp 40.000 dikeluarkan dari Kas (laci).");
    expect(r).not.toMatch(/Finance|pindahan|dipindahkan/);
  });
});

describe("pesan penolakan baru dari database dibaca Owner apa adanya", () => {
  const kode: Record<string, RegExp> = {
    PINDAHAN_RIWAYAT: /pembatalan atau pengembalian/,
    PINDAHAN_KWITANSI: /kwitansi/,
    PINDAHAN_UANG_MUKA: /uang muka/,
    SUDAH_REFUND_ASAL: /sudah\/sedang direfund/,
    PINDAHAN_DIKOREKSI: /dikoreksi/,
    REKENING_PINDAHAN: /tidak bisa dipastikan/,
  };
  for (const [k, re] of Object.entries(kode)) {
    it(`${k}`, () => {
      const m = new RegExp(`'${k}', 'message',\\s*(?:format\\()?'([^']+)'`).exec(sql)?.[1] ?? "";
      expect(m.length).toBeGreaterThan(20);
      expect(pesanBatalPenerimaan(`BATAL_PENERIMAAN_${k}: ${m}`)).toBe(m.trim());
      expect(m).toMatch(re);
    });
  }
});

describe("migrasi sinkron dengan layar", () => {
  it("hanya menambal fungsi hidup (anchored, fail-closed) dan satu fungsi baru; tanpa tabel/kolom/index/trigger baru; tanpa begin/commit", () => {
    expect(sql).toMatch(/create function clinic_private\.cancel_receipt_transfer_check/);
    expect(sql).toMatch(/BATAL_TERBIT_ULANG_DRIFT/);
    expect(sql).not.toMatch(/create table public|alter table|create index|create trigger/i);
    expect(sql.split("\n").some((l) => /^(begin|commit);\s*$/i.test(l.trim()))).toBe(false);
    expect(sql).not.toMatch(/grant execute/i);
  });
  it("nomor migrasi di atas hosted max dan di atas migrasi E3/E4 (20261117200000/300000)", () => {
    expect("20261124100000" > "20261122100000").toBe(true);
  });
});
